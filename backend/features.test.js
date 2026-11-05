import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { resolveFrontendRoot } from './paths.js';
import { createEnvironmentService } from './features/environment.js';

const NOW = Date.parse('2026-11-04T09:00:00.000Z');
const clock = { mode: 'manual', timeZoneMode: 'manual', timeZone: 'Asia/Shanghai', offsetSeconds: 3600 };
const city = { name: '上海', latitude: 31.23, longitude: 121.47, timeZone: 'Asia/Shanghai' };
const forecast = {
  timezone: 'Asia/Shanghai',
  current: { time: NOW / 1000, temperature_2m: 20, apparent_temperature: 19, relative_humidity_2m: 55, is_day: 1, weather_code: 2, wind_speed_10m: 10 },
  daily: { temperature_2m_max: [23], temperature_2m_min: [15] },
};

function fakeProviders(calls) {
  return async (url, options) => {
    calls.push({ url: new URL(url), options });
    let data;
    if (url.hostname === 'api.open-meteo.com') data = forecast;
    else if (url.hostname === 'geocoding-api.open-meteo.com') data = { results: [{ id: 1, name: '上海', latitude: 31.23, longitude: 121.47, timezone: 'Asia/Shanghai', country: '中国' }] };
    else data = { city: '上海', latitude: 31.23, longitude: 121.47, timezone: 'Asia/Shanghai' };
    return Response.json(data);
  };
}

async function start(t, { databasePath = ':memory:', root = resolveFrontendRoot, fetchImpl, now } = {}) {
  const calls = [];
  const environment = createEnvironmentService({ fetchImpl: fetchImpl || fakeProviders(calls), now: now || (() => NOW) });
  const server = createApp({ root, databasePath, environmentService: environment });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  t.after(async () => { if (server.listening) await close(); });
  const request = (path, { method = 'GET', body, revision, cookie, headers = {} } = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { request, calls, close };
}

test('widget registry, layout and todos have their own versioned persistent document', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-feature-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'portal.sqlite');
  let app = await start(t, { databasePath });
  const registry = await (await app.request('/api/widgets')).json();
  assert.equal(registry.schemaVersion, 1);
  assert.deepEqual(registry.widgets.map(item => item.type).slice(-3), ['todo', 'calendar', 'world-clock']);
  const initial = await (await app.request('/api/widgets/state')).json();
  assert.equal(initial.revision, 0);
  assert.equal(initial.state.layout.length, 6);
  const todos = [{ id: 'todo_1', text: '检查 DIY 模块接口', completed: false, dueDate: '2026-11-04' }];
  const saved = await app.request('/api/widgets/state', { method: 'PATCH', revision: 0, body: { todos } });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('etag'), '"1"');
  assert.equal((await app.request('/api/widgets/state', { method: 'PATCH', revision: 0, body: { todos: [] } })).status, 409);
  await app.close();
  app = await start(t, { databasePath });
  const restored = await (await app.request('/api/widgets/state')).json();
  assert.equal(restored.revision, 1);
  assert.deepEqual(restored.state.todos, todos);
  assert.equal(restored.state.layout.length, 6);
  assert.equal((await (await app.request('/api/state')).json()).state, null);
  assert.equal((await app.request('/api/widgets/state', { method: 'PATCH', revision: 1, body: { layout: [], todos: [] } })).status, 200);
});

test('widget validation rejects executable configuration, broken dates, duplicates and invalid zones', async t => {
  const app = await start(t);
  const { state } = await (await app.request('/api/widgets/state')).json();
  const widget = state.layout[0];
  for (const body of [
    { layout: [{ ...widget, type: 'https://evil.example/plugin.js' }] },
    { layout: [{ ...widget, config: { showSeconds: true, script: 'alert(1)' } }] },
    { layout: [widget, widget] },
    { layout: [widget, { ...state.layout[1], order: 0 }] },
    { layout: [{ ...state.layout[5], config: { zones: [{ label: '未知', timeZone: 'Mars/Base' }] } }] },
    { todos: [{ id: '1', text: '错误日期', completed: false, dueDate: '2026-02-31' }] },
    { todos: [{ id: '1', text: '内容', completed: false, html: '<script>alert(1)</script>' }] },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ]) assert.equal((await app.request('/api/widgets/state', { method: 'PATCH', revision: 0, body })).status, 400);
  assert.equal((await app.request('/api/widgets/state', { method: 'PATCH', body: { todos: [] } })).status, 428);
  assert.equal((await (await app.request('/api/widgets/state')).json()).revision, 0);
  assert.equal({}.polluted, undefined);
});

test('HTTP mixed desktop persists page placement and rejects non-atomic widget removal', async t => {
  const app = await start(t);
  const doc = await (await app.request('/api/widgets/state')).json();
  assert.equal(doc.state.desktop, null);
  const desktop = {
    schemaVersion: 1,
    pages: ['all', 'ai', 'design', 'dev', 'media'].map((id, order) => ({ id, title: id, icon: 'folder', isSystem: true, order })),
    placements: doc.state.layout.map((w, order) => ({ kind: 'widget', id: w.id, pageId: order % 2 ? 'design' : 'all', order })),
  };
  const saved = await app.request('/api/widgets/state', { method: 'PATCH', revision: 0, body: { desktop } });
  assert.equal(saved.status, 200);
  const layout = doc.state.layout.map((w, i) => ({ ...w, enabled: i !== 0 }));
  const invalid = await app.request('/api/widgets/state', { method: 'PATCH', revision: 1, body: { layout } });
  assert.equal(invalid.status, 400);
  assert.equal((await (await app.request('/api/widgets/state')).json()).revision, 1);
  desktop.placements = desktop.placements.filter(p => p.id !== layout[0].id);
  assert.equal((await app.request('/api/widgets/state', { method: 'PATCH', revision: 1, body: { layout, desktop } })).status, 200);
  const restored = await (await app.request('/api/widgets/state')).json();
  assert.deepEqual(restored.state.desktop, desktop);
  assert.equal(restored.state.layout[0].enabled, false);
  assert.equal((await app.request('/api/widgets/state', { method: 'PATCH', revision: 1, body: { desktop } })).status, 409);
});

test('device cookies isolate manual location, time zone and clock calibration across devices and restarts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-device-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'portal.sqlite');
  let app = await start(t, { databasePath });
  const first = await app.request('/api/device/settings');
  const cookieA = first.headers.get('set-cookie').split(';')[0];
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/api/);
  const second = await app.request('/api/device/settings');
  const cookieB = second.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookieA, cookieB);
  const patch = { location: { mode: 'manual', manual: city }, clock, weather: { temperatureUnit: 'fahrenheit' } };
  assert.equal((await app.request('/api/device/settings', { method: 'PATCH', revision: 0, cookie: cookieA, body: patch })).status, 200);
  const a = await (await app.request('/api/device/settings', { cookie: cookieA })).json();
  const b = await (await app.request('/api/device/settings', { cookie: cookieB })).json();
  assert.equal(a.state.location.manual.name, '上海');
  assert.equal(b.state.location.mode, 'auto');
  assert.equal(b.revision, 0);
  const time = await (await app.request('/api/time?browserTimeZone=America%2FNew_York', { cookie: cookieA })).json();
  assert.equal(time.timeZone, 'Asia/Shanghai');
  assert.equal(time.displayEpochMs, NOW + 3600000);
  assert.equal(time.serverEpochMs, NOW);
  const resolved = await (await app.request('/api/environment/resolve', { method: 'POST', cookie: cookieA,
    body: { browserTimeZone: 'Europe/London', coordinates: { latitude: 0, longitude: 0 } } })).json();
  assert.equal(resolved.location.source, 'manual');
  assert.equal(resolved.location.name, '上海');
  assert.equal(app.calls.length, 0);
  await app.close();
  app = await start(t, { databasePath });
  assert.deepEqual((await (await app.request('/api/device/settings', { cookie: cookieA })).json()).state, patch);
});

test('browser coordinates take priority in auto mode, are not persisted, and manual settings are strictly validated', async t => {
  const app = await start(t);
  const profile = await app.request('/api/device/settings');
  const cookie = profile.headers.get('set-cookie').split(';')[0];
  const result = await (await app.request('/api/environment/resolve', { method: 'POST', cookie,
    body: { browserTimeZone: 'Europe/London', coordinates: { latitude: 51.5, longitude: -0.12 } } })).json();
  assert.equal(result.location.source, 'browser');
  assert.equal(result.clock.timeZone, 'Europe/London');
  assert.equal(app.calls.length, 0);
  assert.equal((await (await app.request('/api/device/settings', { cookie })).json()).state.location.manual, null);
  for (const body of [
    { clock: { ...clock, timeZone: 'Mars/Base' } },
    { clock: { ...clock, offsetSeconds: Number.MAX_SAFE_INTEGER } },
    { location: { mode: 'manual', manual: null } },
    { location: { mode: 'manual', manual: { ...city, latitude: 91 } } },
    { weather: { temperatureUnit: 'kelvin' } },
    { clock: { ...clock, command: 'date' } },
  ]) assert.equal((await app.request('/api/device/settings', { method: 'PATCH', cookie, revision: 0, body })).status, 400);
  assert.equal((await app.request('/api/environment/resolve', { method: 'POST', body: { coordinates: { latitude: '31', longitude: 121 } } })).status, 400);
  assert.equal((await app.request('/api/environment/resolve', { method: 'POST', body: { ip: '8.8.8.8' } })).status, 400);
});

test('LAN clients use network egress geolocation and spoofed forwarded headers do not select an IP', async t => {
  const app = await start(t);
  const response = await app.request('/api/environment/resolve', { method: 'POST', body: {}, headers: { 'X-Forwarded-For': '8.8.8.8', 'X-Real-IP': '1.1.1.1' } });
  const result = await response.json();
  assert.equal(result.location.source, 'network-ip');
  assert.equal(result.location.approximate, true);
  assert.equal(app.calls[0].url.href, 'https://ipapi.co/json/');
});

test('weather is cached, reports actual observation time and rejects arbitrary URLs and invalid coordinates', async t => {
  const app = await start(t);
  const path = '/api/weather?latitude=31.23456&longitude=121.47456&timeZone=Asia%2FShanghai';
  const first = await (await app.request(path)).json();
  const second = await (await app.request(path)).json();
  assert.equal(first.current.temperature, 20);
  assert.equal(first.current.condition, '多云');
  assert.equal(first.current.observedAt, new Date(NOW).toISOString());
  assert.equal(first.latitude, 31.23);
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].options.redirect, 'error');
  assert.equal(app.calls[0].url.hostname, 'api.open-meteo.com');
  for (const invalid of [
    '/api/weather?latitude=91&longitude=10',
    '/api/weather?latitude=&longitude=10',
    '/api/weather?latitude=31&longitude=121&url=http://169.254.169.254/',
    '/api/weather?latitude=31&latitude=0&longitude=121',
    '/api/weather?latitude=31&longitude=121&timeZone=Bad%2FZone',
  ]) assert.equal((await app.request(invalid)).status, 400);
  assert.equal(app.calls.length, 1);
});

test('city search and time zones use bounded structured responses', async t => {
  const app = await start(t);
  const locations = await (await app.request('/api/location/search?q=%E4%B8%8A%E6%B5%B7')).json();
  assert.equal(locations.locations[0].timeZone, 'Asia/Shanghai');
  assert.equal(locations.provider, 'Open-Meteo / GeoNames');
  assert.equal((await app.request('/api/location/search?q=A')).status, 400);
  const zones = await (await app.request('/api/timezones')).json();
  assert.ok(zones.timeZones.includes('UTC'));
  assert.ok(zones.timeZones.includes('Asia/Shanghai'));
  assert.equal((await app.request('/api/widgets', { method: 'DELETE' })).status, 405);
});

test('upstream failures are explicit and leave a working clock and manual location fallback', async t => {
  const app = await start(t, { fetchImpl: async () => { throw new Error('network unavailable'); } });
  assert.equal((await app.request('/api/weather?latitude=31&longitude=121')).status, 503);
  const resolved = await (await app.request('/api/environment/resolve', { method: 'POST', body: { browserTimeZone: 'Asia/Shanghai' } })).json();
  assert.equal(resolved.location, null);
  assert.equal(resolved.warnings[0].code, 'LOCATION_UNAVAILABLE');
  assert.equal(resolved.clock.timeZone, 'Asia/Shanghai');
  assert.equal(resolved.clock.displayEpochMs, NOW);
});

test('external route rate limits use the socket peer and cannot be bypassed with forwarded headers', async t => {
  const app = await start(t);
  for (let i = 0; i < 30; i++) assert.equal((await app.request('/api/weather?latitude=31&longitude=121', { headers: { 'X-Forwarded-For': `8.8.8.${i}` } })).status, 200);
  const limited = await app.request('/api/weather?latitude=31&longitude=121');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(app.calls.length, 1);
});

test('reviewed frontend modules can load but traversal, symlink escapes, and backend files stay private', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-module-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'frontend');
  await mkdir(join(root, 'widgets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<h1>safe</h1>');
  await writeFile(join(root, 'widgets/todo.js'), 'export const type = "todo";');
  await writeFile(join(directory, 'secret.js'), 'secret');
  await symlink(join(directory, 'secret.js'), join(root, 'widgets/escape.js'));
  const app = await start(t, { root });
  const page = await app.request('/');
  assert.match(page.headers.get('content-security-policy'), /script-src-attr 'none'/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await app.request('/widgets/todo.js')).status, 200);
  for (const path of ['/widgets/escape.js', '/widgets/../backend/app.js', '/widgets/%2e%2e%2fsecret.js', '/backend/features/store.js']) assert.equal((await app.request(path)).status, 404);
});
