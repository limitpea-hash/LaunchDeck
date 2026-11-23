import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { resolveFrontendRoot } from './paths.js';
import { createEnvironmentService } from './features/environment.js';
import { createExchangeRateService } from './features/exchange-rates.js';
import { readWidgetPackage } from './features/widget-package.js';
import { getChinaHoliday, hasChinaHolidaySchedule } from './features/china-holidays.js';
import { defaultWidgetState } from './features/widgets.js';
import { DatabaseSync } from 'node:sqlite';

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
    else if (url.pathname === '/api/v1/misc/district') data = { results: [
      { adcode: '310000', name: '上海市', level: 'province', country_code: 'CN', province: '上海市', center: { lat: 31.23, lng: 121.47 } },
    ] };
    else data = { region: '中国 上海', latitude: 31.23, longitude: 121.47 };
    return Response.json(data);
  };
}

async function start(t, { databasePath = ':memory:', root = resolveFrontendRoot, fetchImpl, now, exchangeRateService } = {}) {
  const calls = [];
  const environment = createEnvironmentService({ fetchImpl: fetchImpl || fakeProviders(calls), now: now || (() => NOW) });
  const server = createApp({ root, databasePath, environmentService: environment, exchangeRateService });
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
  assert.deepEqual(registry.widgets.filter(item => item.defaultEnabled !== false).map(item => item.type),
    ['clock-weather', 'focus-timer', 'quick-note', 'todo', 'calendar', 'world-clock']);
  assert.deepEqual(Object.fromEntries(registry.widgets.filter(item => item.defaultEnabled !== false && item.defaultSize)
    .map(item => [item.type, item.defaultSize])), {
    'clock-weather': 'square', calendar: 'square',
  });
  const initial = await (await app.request('/api/widgets/state')).json();
  assert.equal(initial.revision, 0);
  assert.equal(initial.state.layout.length, 6);
  assert.deepEqual(initial.state.layout.map(item => item.size ?? 'compact'), [
    'square', 'compact', 'compact', 'compact', 'square', 'compact',
  ]);
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

test('daily widgets are opt-in and persist bounded countdown and habit settings', async t => {
  const app = await start(t);
  const { widgets } = await (await app.request('/api/widgets')).json();
  const { state } = await (await app.request('/api/widgets/state')).json();
  const daily = widgets.filter(item => item.defaultEnabled === false && !item.importOnly && item.type !== 'currency-converter');
  assert.deepEqual(Object.fromEntries(daily.map(item => [item.type, item.defaultSize])), {
    'weather-badge': 'single', 'date-tile': 'single', 'focus-launcher': 'single', countdown: 'single',
    habits: 'tall', 'today-dashboard': 'large', 'weather-strip': 'strip',
  });
  const layout = [...state.layout, ...daily.map((item, index) => ({
    id: item.type, type: item.type, enabled: true, order: state.layout.length + index,
    size: item.defaultSize, config: item.defaultConfig,
  }))];
  const countdown = layout.find(item => item.type === 'countdown');
  countdown.config = { title: '旅行', targetDate: '2028-02-29' };
  const habits = layout.find(item => item.type === 'habits');
  const habit = { id: 'read', title: '阅读', checkedDates: ['2026-11-22', '2026-11-23'] };
  habits.config = { habits: [habit] };
  const patch = (next, revision) => app.request('/api/widgets/state', {
    method: 'PATCH', revision, body: { layout: next },
  });
  for (const invalid of [
    { ...countdown, size: 'large' },
    { ...countdown, config: { ...countdown.config, targetDate: '2026-02-29' } },
    { ...countdown, config: { ...countdown.config, html: '<b>旅行</b>' } },
    { ...habits, config: { habits: [habit, habit] } },
    { ...habits, config: { habits: [{ ...habit, checkedDates: ['2026-11-23', '2026-11-23'] }] } },
  ]) {
    const next = layout.map(item => item.id === invalid.id ? invalid : item);
    assert.equal((await patch(next, 0)).status, 400);
  }
  assert.equal((await patch(layout, 0)).status, 200);
  const stored = await (await app.request('/api/widgets/state')).json();
  assert.deepEqual(stored.state.layout, layout);
});

test('widget packs validate the preview and the stored layout by the same card schema', async t => {
  const app = await start(t);
  const base = { format: 'launchdeck-widget', version: 1, size: 'square', card: {
    type: 'text', title: '学习提示', text: '今天读两章', icon: 'note', palette: 'teal', layout: 'stacked',
  } };
  const load = data => readWidgetPackage(new Blob([JSON.stringify(data)]));
  assert.deepEqual(await load(base), { size: 'square', config: base.card });
  assert.deepEqual(await load({ ...base, size: 'wide' }), { size: 'square', config: base.card });
  const currency = { ...base.card, type: 'currency', icon: 'currency', base: 'JPY', quote: 'CNY' };
  delete currency.text;
  assert.deepEqual(await load({ ...base, size: 'single', card: currency }), { size: 'single', config: currency });
  for (const invalid of [
    { ...base, version: 2 },
    { ...base, size: 'large' },
    { ...base, card: { ...base.card, url: 'https://example.test/card' } },
    { ...base, card: { ...base.card, script: 'external.js' } },
    { ...base, card: { ...base.card, type: 'constructor' } },
    { ...base, card: { ...currency, base: 'invalid' } },
    { ...base, card: { ...base.card, title: ' '.repeat(61) } },
  ]) await assert.rejects(load(invalid), error => error.status === 400);
  await assert.rejects(readWidgetPackage(new Blob([new Uint8Array(16 * 1024 + 1)])), /16 KiB/);
  const layout = [
    { id: 'imported_abc', type: 'imported-card', order: 0, enabled: true, size: 'square', config: base.card },
    { id: 'currency-converter', type: 'currency-converter', order: 1, enabled: true,
      size: 'single', config: { base: 'USD', quote: 'HKD' } },
  ];
  const save = rows => app.request('/api/widgets/state', { method: 'PATCH', revision: 0, body: { layout: rows } });
  assert.equal((await save([{ ...layout[0], config: { ...base.card, html: '<p>任意 HTML</p>' } }])).status, 400);
  assert.equal((await save(layout)).status, 200);
  assert.deepEqual((await (await app.request('/api/widgets/state')).json()).state.layout, [
    layout[0], { ...layout[1], size: 'square' },
  ]);
});

test('legacy sizes are projected on read at the same revision and saved canonically', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'launchdeck-retired-sizes-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const databasePath = join(folder, 'portal.sqlite');
  const legacy = defaultWidgetState();
  legacy.layout.find(item => item.type === 'clock-weather').size = 'tall';
  const cal = legacy.layout.find(item => item.type === 'calendar');
  cal.size = 'large';
  cal.config = { weekStartsOn: 0, marks: [{ date: '2027-02-05', title: '出行', color: 'green' }] };
  legacy.layout.push({ id: 'currency-converter', type: 'currency-converter', enabled: true, order: 6,
    size: 'single', config: { base: 'USD', quote: 'HKD' } });
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE feature_documents (key TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.prepare('INSERT INTO feature_documents VALUES (?, ?, ?, ?)').run('widgets', 7, JSON.stringify(legacy), new Date(NOW).toISOString());
  db.close();
  const app = await start(t, { databasePath });
  const registry = await (await app.request('/api/widgets')).json();
  assert.ok(registry.widgets.every(definition => !definition.sizes.includes('wide')));
  assert.deepEqual(registry.widgets.find(definition => definition.type === 'currency-converter').sizes, ['square']);
  assert.deepEqual(registry.widgets.find(definition => definition.type === 'clock-weather').sizes, ['square', 'landscape']);
  assert.deepEqual(registry.widgets.find(definition => definition.type === 'calendar').sizes, ['square', 'full']);
  const current = await (await app.request('/api/widgets/state')).json();
  assert.equal(current.revision, 7);
  const expected = { 'clock-weather': 'square', calendar: 'full', 'currency-converter': 'square' };
  for (const [id, size] of Object.entries(expected)) assert.equal(current.state.layout.find(item => item.id === id).size, size);
  assert.deepEqual(current.state.layout.find(item => item.type === 'calendar').config, cal.config);
  const result = await app.request('/api/widgets/state', { method: 'PATCH', revision: 7, body: { layout: legacy.layout } });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).state.layout, current.state.layout);
  const withNewWeatherSize = current.state.layout.map(item =>
    item.type === 'clock-weather' ? { ...item, size: 'landscape' } : item);
  const resized = await app.request('/api/widgets/state', { method: 'PATCH', revision: 8, body: { layout: withNewWeatherSize } });
  assert.equal(resized.status, 200);
  assert.deepEqual((await resized.json()).state.layout, withNewWeatherSize);
});

test('calendar markers validate real dates, unique days and colors and persist with week preference', async t => {
  const app = await start(t);
  const { state } = await (await app.request('/api/widgets/state')).json();
  const item = state.layout.find(widget => widget.type === 'calendar');
  const mark = { date: '2026-10-01', title: '出行', color: 'green' };
  const save = (marks, revision = 0) => app.request('/api/widgets/state', { method: 'PATCH', revision,
    body: { layout: [{ ...item, order: 0, size: 'full', config: { weekStartsOn: 0, marks } }] } });
  for (const invalid of [[{ ...mark, date: '2026-02-29' }], [mark, { ...mark, title: '重复' }],
    [{ ...mark, color: 'transparent' }], [{ ...mark, title: '  ' }], [{ ...mark, script: 'example.js' }]]) {
    assert.equal((await save(invalid)).status, 400);
  }
  assert.equal((await save([mark])).status, 200);
  const saved = await (await app.request('/api/widgets/state')).json();
  assert.deepEqual(saved.state.layout[0].config, { weekStartsOn: 0, marks: [mark] });
  assert.equal((await save([], saved.revision)).status, 200);
  assert.deepEqual((await (await app.request('/api/widgets/state')).json()).state.layout[0].config, { weekStartsOn: 0, marks: [] });
});

test('mainland China schedules show official breaks and makeup workdays across months', () => {
  for (const [year, holidays, workdays] of [[2025, 28, 5], [2026, 33, 6], [2027, 29, 5]]) {
    assert.equal(hasChinaHolidaySchedule(year), true);
    const counts = { holiday: 0, workday: 0 };
    for (let day = Date.UTC(year, 0, 1); day < Date.UTC(year + 1, 0, 1); day += 86400000) {
      const event = getChinaHoliday(new Date(day).toISOString().slice(0, 10));
      if (event) counts[event.kind]++;
    }
    assert.deepEqual(counts, { holiday: holidays, workday: workdays });
  }
  assert.deepEqual(getChinaHoliday('2025-06-02'), { kind: 'holiday', name: '端午节' });
  assert.deepEqual(getChinaHoliday('2026-10-10'), { kind: 'workday', name: '国庆节' });
  assert.deepEqual(getChinaHoliday('2027-01-31'), { kind: 'workday', name: '春节' });
  assert.equal(getChinaHoliday('2027-02-01'), null);
  assert.equal(hasChinaHolidaySchedule(2028), false);
});

test('reference exchange rates validate pairs, deduplicate requests, and mark stale data', async t => {
  let now = NOW;
  let calls = 0;
  let available = true;
  const exchangeRateService = createExchangeRateService({
    now: () => now,
    async fetchImpl(url, options) {
      calls++;
      assert.equal(url.href, 'https://api.frankfurter.dev/v2/rate/CNY/USD');
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      if (!available) throw new Error('offline');
      return Response.json({ base: 'CNY', quote: 'USD', rate: 0.14, date: '2026-11-03' });
    },
  });
  const app = await start(t, { exchangeRateService });
  for (const query of ['base=CNY&quote=USD&amount=100', 'base=CNY&quote=ZZZ', 'base=USD&base=CNY&quote=USD']) {
    assert.equal((await app.request(`/api/exchange-rate?${query}`)).status, 400);
  }
  const rateRequest = () => app.request('/api/exchange-rate?base=CNY&quote=USD');
  const responses = await Promise.all([rateRequest(), rateRequest()]);
  assert.deepEqual(await responses[0].json(), {
    base: 'CNY', quote: 'USD', rate: 0.14, date: '2026-11-03', fetchedAt: new Date(NOW).toISOString(),
    cache: { hit: false, stale: false },
  });
  assert.equal(responses[1].status, 200);
  assert.equal(calls, 1);
  const identity = await (await app.request('/api/exchange-rate?base=JPY&quote=JPY')).json();
  assert.equal(identity.rate, 1);
  assert.equal(identity.date, null);
  assert.equal(calls, 1);
  assert.equal((await (await rateRequest()).json()).cache.hit, true);
  available = false;
  now += 3600001;
  assert.deepEqual((await (await rateRequest()).json()).cache, { hit: true, stale: true });
  now += 7 * 24 * 3600000;
  assert.equal((await rateRequest()).status, 503);
  assert.match((await (await app.request('/api/update/version')).json()).version, /^\d+\.\d+\.\d+$/);
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
  assert.equal(app.calls[0].url.href, 'https://uapis.cn/api/v1/network/myip');
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
  assert.equal(locations.provider, 'UAPI');
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
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self' https:;/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await app.request('/widgets/todo.js')).status, 200);
  const notifications = await app.request('/platform/features/notifications.js');
  assert.equal(notifications.status, 200);
  assert.match(notifications.headers.get('content-security-policy'), /connect-src 'self';/);
  assert.equal((await app.request('/api/notifications')).status, 404);
  for (const path of ['/widgets/escape.js', '/widgets/../backend/app.js', '/widgets/%2e%2e%2fsecret.js', '/backend/features/store.js']) assert.equal((await app.request(path)).status, 404);
});
