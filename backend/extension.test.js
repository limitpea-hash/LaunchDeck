import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, cp, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExtensionApi, RPC_CHANNEL, LEGACY_RPC_CHANNEL } from './extension/runtime/api.js';
import { STORE_KEY, LEGACY_STORE_KEY } from './extension/runtime/documents.js';
import { createBrowserEnvironment, createLocationPermissions } from './extension/runtime/environment.js';
import { installFetchBridge } from './extension/runtime/bridge.js';
import { createExtensionNotificationClient } from './extension/runtime/notifications.js';
import { defaultWidgetState } from './features/widgets.js';
import { defaultDeviceSettings } from './features/settings.js';
import { buildExtension, projectRoot } from './extension/build.js';
import { exportWebData } from './extension/export-data.js';
import { DatabaseSync } from 'node:sqlite';
import { inspectUpgradePackage } from './features/upgrade-package.js';
import { createHash } from 'node:crypto';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const SENDER = { id: ID, url: `chrome-extension://${ID}/index.html`, documentId: 'first-page' };
const NOW = Date.parse('2026-11-05T00:00:00.000Z');
const prefs = { iconMode: 'light', iconSize: 'small', wallpaper: 'ios18-bloom', wallpaperDimmed: false, tintHue: 215, tintSat: 82, focusActive: false };
const portal = { sites: [], prefs, note: '离线便签' };

function memoryStorage() {
  const values = {};
  return {
    values,
    async get(key) { return structuredClone(Object.hasOwn(values, key) ? { [key]: values[key] } : {}); },
    async set(data) { Object.assign(values, structuredClone(data)); },
  };
}

function setup({ storage = memoryStorage(), environment, permissions, notificationFetch, now = () => NOW } = {}) {
  let calls = 0;
  const service = environment || createBrowserEnvironment({ permissions: { contains: async () => false }, fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); }, now: () => NOW });
  const api = createExtensionApi({ storage, extensionId: ID, environment: service, permissions, notificationFetch, now });
  const request = (path, method = 'GET', body, revision, sender = SENDER) => api({ channel: RPC_CHANNEL, path, method, body, ifMatch: revision === undefined ? undefined : `"${revision}"` }, sender);
  return { storage, api, request, get externalCalls() { return calls; } };
}

test('notification feeds require a user-approved HTTPS host and preserve read state through refresh and restart', async () => {
  const authorized = new Set();
  const requests = [];
  const permissions = {
    async request({ origins }) {
      requests.push(origins);
      origins.forEach(origin => authorized.add(origin));
      return true;
    },
    async contains({ origins }) { return origins.every(origin => authorized.has(origin)); },
  };
  const calls = [];
  let now = NOW;
  const first = { id: '42', title: '<b>构建完成</b>', publishedAt: new Date(NOW).toISOString(), url: 'javascript:example' };
  let messages = [first, first];
  const notificationFetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ messages });
  };
  const app = setup({ permissions, notificationFetch, now: () => now });
  const path = '/api/notifications';
  const source = { name: '构建', url: 'https://feed.example.com:8443/notifications' };
  assert.equal((await app.request(path, 'POST', { action: 'addSource', source })).status, 403);
  assert.equal((await app.request(path, 'GET', undefined, undefined, { id: 'different-extension', url: SENDER.url })).status, 403);
  assert.equal(calls.length, 0);
  const client = createExtensionNotificationClient({ permissions, request: async body => {
    const response = await app.request(path, body ? 'POST' : 'GET', body);
    assert.equal(response.status, 200);
    return response.body;
  } });
  await assert.rejects(client.addSource({ ...source, url: 'http://feed.example.com/notifications' }), { status: 400 });
  assert.equal(requests.length, 0);
  const { sources } = await client.addSource(source);
  assert.deepEqual(requests, [['https://feed.example.com/*']]);
  await Promise.all([client.refresh(), client.refresh()]);
  assert.deepEqual(calls, [source.url]);
  const inbox = await client.getSnapshot();
  assert.equal(inbox.unreadCount, 1);
  assert.equal(inbox.messages[0].url, null);
  assert.equal(inbox.messages[0].title, '<b>构建完成</b>');
  await client.markRead(sources[0].id, first.id);
  now += 60001;
  messages = [first, { id: '43', title: '新消息', publishedAt: new Date(now).toISOString() }];
  assert.equal((await client.refresh()).unreadCount, 1);
  const restored = setup({ storage: app.storage, permissions, notificationFetch, now: () => now });
  assert.deepEqual((await restored.request(path)).body.messages.map(item => [item.id, item.read]), [['43', false], ['42', true]]);
  assert.equal((await restored.request(path, 'POST', { action: 'markAllRead' })).body.unreadCount, 0);
  assert.equal((await restored.request(path, 'POST', { action: 'removeSource', id: sources[0].id })).body.messages.length, 0);
});

test('a malformed or oversized notification feed and revoked permission retain the prior inbox', async () => {
  let now = NOW;
  let allowed = true;
  let response = () => Response.json({ messages: [{ id: '1', title: '保留通知', publishedAt: new Date(NOW).toISOString() }] });
  let calls = 0;
  const app = setup({ permissions: { contains: async () => allowed }, now: () => now, notificationFetch: async () => {
    calls++;
    return response();
  } });
  const refresh = async () => {
    now += 60001;
    return (await app.request('/api/notifications', 'POST', { action: 'refresh', force: false })).body;
  };
  const input = { action: 'addSource', source: { name: '站点', url: 'https://feed.example.com/notifications' } };
  assert.equal((await app.request('/api/notifications', 'POST', input)).status, 200);
  const first = await refresh();
  assert.equal(first.unreadCount, 1);
  const failures = [
    () => Response.json({ messages: [{ id: 2 }] }),
    () => new Response(' '.repeat(128 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('redirect', { status: 302 }),
  ];
  for (const fail of failures) {
    response = fail;
    const snapshot = await refresh();
    assert.ok(snapshot.sources[0].error);
    assert.equal(snapshot.sources[0].lastSuccessAt, first.sources[0].lastSuccessAt);
    assert.deepEqual(snapshot.messages, first.messages);
  }
  allowed = false;
  const revoked = await refresh();
  assert.match(revoked.sources[0].error, /允许访问/);
  assert.deepEqual(revoked.messages, first.messages);
  assert.equal(calls, 4);
});

test('extension stores portal, widgets and device settings offline and recovers after worker recreation', async () => {
  const app = setup();
  assert.equal((await app.request('/api/health')).body.mode, 'extension');
  assert.equal((await app.request('/api/state')).body.state, null);
  const initialWidgets = (await app.request('/api/widgets/state')).body.state;
  assert.deepEqual(initialWidgets.layout.map(item => item.size ?? 'compact'), [
    'square', 'compact', 'compact', 'compact', 'square', 'compact',
  ]);
  assert.equal((await app.request('/api/state', 'PATCH', portal, 0)).status, 200);
  assert.equal((await app.request('/api/widgets/state', 'PATCH', { todos: [{ id: 't1', text: '离线完成', completed: false }] }, 0)).status, 200);
  const clock = { ...defaultDeviceSettings().clock, mode: 'manual', offsetSeconds: 120 };
  assert.equal((await app.request('/api/device/settings', 'PATCH', { clock }, 0)).status, 200);
  const restored = setup({ storage: app.storage });
  assert.deepEqual((await restored.request('/api/state')).body.state, portal);
  const restoredWidgets = (await restored.request('/api/widgets/state')).body.state;
  assert.equal(restoredWidgets.todos[0].text, '离线完成');
  assert.deepEqual(restoredWidgets.layout, initialWidgets.layout);
  const time = (await restored.request('/api/time?browserTimeZone=Asia%2FShanghai')).body;
  assert.equal(time.displayEpochMs, NOW + 120000);
  assert.equal(time.timeSource, 'device');
  assert.equal(app.externalCalls + restored.externalCalls, 0);
});

test('simultaneous tabs cannot overwrite a newer revision and separate document writes are serialized', async () => {
  const app = setup();
  await app.request('/api/state', 'PATCH', portal, 0);
  const two = await Promise.all([
    app.request('/api/state', 'PATCH', { note: '标签 A' }, 1),
    app.request('/api/state', 'PATCH', { note: '标签 B' }, 1, { ...SENDER, documentId: 'second-page' }),
  ]);
  assert.deepEqual(two.map(result => result.status).sort(), [200, 409]);
  await Promise.all([
    app.request('/api/widgets/state', 'PATCH', { layout: [] }, 0),
    app.request('/api/device/settings', 'PATCH', { weather: { temperatureUnit: 'fahrenheit' } }, 0),
  ]);
  assert.deepEqual((await app.request('/api/widgets/state')).body.state.layout, []);
  assert.equal((await app.request('/api/device/settings')).body.state.weather.temperatureUnit, 'fahrenheit');
});

test('storage failure is visible and does not advance local revisions or clear saved data', async () => {
  const storage = memoryStorage();
  const app = setup({ storage });
  await app.request('/api/state', 'PATCH', portal, 0);
  storage.set = async () => { throw new Error('quota'); };
  const failed = await app.request('/api/state', 'PATCH', { note: '未写入' }, 1);
  assert.equal(failed.status, 503);
  assert.equal((await app.request('/api/state')).body.revision, 1);
  assert.equal((await app.request('/api/state')).body.state.note, portal.note);
  storage.values[STORE_KEY].schemaVersion = 99;
  assert.equal((await app.request('/api/state')).status, 503);
  assert.equal(storage.values[STORE_KEY].schemaVersion, 99);
});

test('LaunchDeck reads legacy storage without data loss and migration failures preserve the previous release', async () => {
  const old = setup();
  await old.request('/api/state', 'PATCH', portal, 0);
  const previous = structuredClone(old.storage.values[STORE_KEY]);
  const storage = memoryStorage();
  storage.values[LEGACY_STORE_KEY] = structuredClone(previous);
  const migrated = setup({ storage });
  assert.deepEqual((await migrated.request('/api/state')).body.state, portal);
  assert.equal(storage.values[STORE_KEY], undefined);
  const save = storage.set;
  storage.set = async () => { throw new Error('quota'); };
  assert.equal((await migrated.request('/api/state', 'PATCH', { note: 'failed' }, 1)).status, 503);
  assert.equal(storage.values[STORE_KEY], undefined);
  assert.deepEqual(storage.values[LEGACY_STORE_KEY], previous);
  storage.set = save;
  assert.equal((await migrated.request('/api/state', 'PATCH', { note: 'migrated' }, 1)).status, 200);
  assert.equal((await migrated.request('/api/state')).body.state.note, 'migrated');
  assert.deepEqual(storage.values[LEGACY_STORE_KEY], previous);
  assert.equal(storage.values[STORE_KEY].portal.revision, 2);
  // A corrupt new document must never silently fall back to an older snapshot.
  storage.values[STORE_KEY].schemaVersion = 99;
  assert.equal((await migrated.request('/api/state')).status, 503);
});

test('newly branded exports accept old backup formats and old open tabs retain version conflict protection', async () => {
  const app = setup();
  await app.request('/api/state', 'PATCH', portal, 0);
  const backup = (await app.request('/api/extension/backup')).body;
  assert.equal(backup.format, 'launchdeck-new-tab');
  assert.equal((await app.request('/api/extension/import', 'POST', { ...backup, format: 'agy-new-tab' })).status, 200);
  const legacy = await app.api({ channel: LEGACY_RPC_CHANNEL, path: '/api/state', method: 'PATCH', body: { note: 'old tab' }, ifMatch: '"1"' }, SENDER);
  assert.equal(legacy.status, 409);
  assert.equal((await app.api({ channel: LEGACY_RPC_CHANNEL, path: '/api/state' }, { ...SENDER, id: 'other' })).status, 403);
});

test('extension message boundary rejects web pages, different IDs, arbitrary URLs, and unversioned writes', async () => {
  const app = setup();
  for (const sender of [
    { ...SENDER, id: 'other' },
    { ...SENDER, url: 'https://example.com' },
    { ...SENDER, url: `chrome-extension://${ID}.evil/index.html` },
    { ...SENDER, url: 'chrome://newtab/', origin: 'https://example.com' },
  ]) assert.equal((await app.request('/api/state', 'GET', undefined, undefined, sender)).status, 403);
  assert.equal((await app.request('/api/state', 'GET', undefined, undefined, { ...SENDER, url: 'chrome://newtab/', origin: `chrome-extension://${ID}` })).status, 200);
  assert.equal((await app.request('https://example.com/api/state')).status, 400);
  assert.equal((await app.request('/api/weather?latitude=0&longitude=0&url=http://169.254.169.254/')).status, 400);
  assert.equal((await app.request('/api/state', 'PATCH', portal)).status, 428);
  assert.equal((await app.request('/api/state', 'PATCH', { ...portal, script: 'alert(1)' }, 0)).status, 400);
});

test('missing network permissions leave offline functions and clock usable without any network attempt', async () => {
  const app = setup();
  const resolved = await app.request('/api/environment/resolve', 'POST', { browserTimeZone: 'Asia/Shanghai' });
  assert.equal(resolved.body.location, null);
  assert.equal(resolved.body.warnings[0].code, 'NETWORK_PERMISSION_REQUIRED');
  assert.equal(resolved.body.clock.timeSource, 'device');
  assert.equal((await app.request('/api/weather?latitude=31&longitude=121')).status, 403);
  assert.equal(app.externalCalls, 0);
});

test('extension city search grants only city and weather origins, and automatic location prefers browser coordinates', async () => {
  const granted = new Set();
  const permissions = {
    request: async ({ origins }) => {
      for (const origin of origins) granted.add(origin);
      return true;
    },
    contains: async ({ origins }) => origins.every(origin => granted.has(origin)),
  };
  const calls = [];
  const environment = createBrowserEnvironment({ permissions, fetchImpl: async url => {
    calls.push(url.href);
    if (url.pathname === '/api/v1/network/myip') return Response.json({ region: '中国 上海', latitude: 31.23, longitude: 121.47 });
    return Response.json({ results: [
      { adcode: '310000', name: '上海市', level: 'province', province: '上海市', country_code: 'CN', center: { lat: 31.23, lng: 121.47 } },
    ] });
  } });
  const app = setup({ environment });
  const query = '/api/location/search?q=' + encodeURIComponent('上海市');
  assert.equal((await app.request(query)).status, 403);
  await createLocationPermissions(permissions).requestCitySearch();
  assert.deepEqual([...granted], ['https://uapis.cn/*', 'https://geocoding-api.open-meteo.com/*', 'https://api.open-meteo.com/*']);
  assert.equal((await app.request(query)).body.locations[0].name, '上海市');
  assert.equal(new URL(calls[0]).searchParams.get('adcode'), '310000');
  const exact = await app.request('/api/environment/resolve', 'POST', {
    browserTimeZone: 'Asia/Shanghai', coordinates: { latitude: 31.1, longitude: 121.2 },
  });
  assert.equal(exact.body.location.source, 'browser');
  assert.equal(calls.length, 1);
  const fallback = await app.request('/api/environment/resolve', 'POST', {});
  assert.equal(fallback.body.location.source, 'ip');
  assert.equal(fallback.body.location.approximate, true);
  assert.equal(calls[1], 'https://uapis.cn/api/v1/network/myip');
});

test('granted extension weather requests use only the fixed HTTPS provider and stop networking after revocation', async () => {
  let allowed = true;
  let now = NOW;
  const calls = [];
  const environment = createBrowserEnvironment({ now: () => now,
    permissions: { contains: async ({ origins }) => { assert.equal(origins[0], 'https://api.open-meteo.com/*'); return allowed; } },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ timezone: 'Asia/Shanghai',
        current: { time: NOW / 1000, temperature_2m: 20, apparent_temperature: 19, relative_humidity_2m: 50, is_day: 1, weather_code: 0, wind_speed_10m: 12 },
        daily: { temperature_2m_max: [23], temperature_2m_min: [15] } });
    } });
  const input = { latitude: 31.23456, longitude: 121.47456, timeZone: 'Asia/Shanghai' };
  const first = await environment.weather(input);
  assert.equal(first.current.condition, '晴朗');
  assert.equal(calls[0].url.hostname, 'api.open-meteo.com');
  assert.equal(calls[0].url.searchParams.get('latitude'), '31.23');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal((await environment.weather(input)).cache.hit, true);
  assert.equal(calls.length, 1);
  allowed = false; now += 600001;
  await assert.rejects(environment.weather(input), error => error.status === 403);
  assert.equal(calls.length, 1);
});

test('backup import validates all fields before replacing any document and retains custom navigation data', async () => {
  const app = setup();
  await app.request('/api/state', 'PATCH', portal, 0);
  const original = (await app.request('/api/extension/backup')).body;
  const broken = { ...original, device: { ...original.device, clock: { ...original.device.clock, timeZone: 'Bad/Zone' } } };
  assert.equal((await app.request('/api/extension/import', 'POST', broken)).status, 400);
  assert.equal((await app.request('/api/state')).body.revision, 1);
  const pages = ['all', 'ai', 'design', 'dev', 'media'].map((id, order) => ({ id, order, title: id, icon: 'sparkles', isSystem: true }));
  const browserData = { pages: [...pages, { id: 'page_reading', title: '阅读', icon: 'book', order: 5, isSystem: false }], customSites: [] };
  const backup = { ...original, portal: { ...portal, note: '迁移的数据' }, browserData };
  assert.equal((await app.request('/api/extension/import', 'POST', backup)).status, 200);
  assert.equal((await app.request('/api/state')).body.state.note, '迁移的数据');
  assert.deepEqual((await app.request('/api/extension/browser-data')).body, browserData);
  assert.equal((await app.request('/api/state', 'PATCH', { note: '旧标签覆盖' }, 1)).status, 409);
  const unsafe = { ...backup, browserData: { ...browserData, pages: [...pages, { id: 'page_reading', title: '阅读', icon: 'https://evil.test/icon.js', order: 5, isSystem: false }] } };
  assert.equal((await app.request('/api/extension/import', 'POST', unsafe)).status, 400);
});

test('fetch bridge supports extension-origin relative APIs, status codes and aborted requests', async () => {
  const app = setup();
  const target = {};
  const runtime = { sendMessage: message => app.api(message, SENDER) };
  let nativeCalls = 0;
  installFetchBridge({ target, runtime, pageLocation: { href: SENDER.url, protocol: 'chrome-extension:', host: ID }, nativeFetch: async () => { nativeCalls += 1; return new Response('local file'); } });
  const initial = await target.fetch('/api/state');
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('etag'), '"0"');
  const saved = await target.fetch('/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' }, body: JSON.stringify(portal) });
  assert.equal(saved.status, 200);
  assert.equal((await target.fetch('/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' }, body: JSON.stringify(portal) })).status, 409);
  await target.fetch('./styles.css');
  assert.equal(nativeCalls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(target.fetch('/api/state', { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal((await target.fetch('/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
});

test('extension exchange rate requests only reach the provider after specific host permission', async () => {
  let granted = false;
  let calls = 0;
  const api = createExtensionApi({
    storage: memoryStorage(), extensionId: ID, now: () => NOW,
    permissions: { async contains(value) {
      assert.deepEqual(value, { origins: ['https://api.frankfurter.dev/*'] });
      return granted;
    } },
    async exchangeRateFetch(url) {
      assert.equal(url.href, 'https://api.frankfurter.dev/v2/rate/USD/CNY');
      calls++;
      return Response.json({ base: 'USD', quote: 'CNY', rate: 7, date: '2026-11-04' });
    },
  });
  const request = path => api({ channel: RPC_CHANNEL, path }, SENDER);
  assert.equal((await request('/api/exchange-rate?base=USD&quote=CNY')).status, 403);
  assert.equal((await request('/api/exchange-rate?base=USD&quote=USD')).body.rate, 1);
  assert.equal(calls, 0);
  granted = true;
  assert.equal((await request('/api/exchange-rate?base=USD&quote=CNY')).body.rate, 7);
  assert.equal((await request('/api/exchange-rate?base=USD&quote=CNY')).body.cache.hit, true);
  assert.equal((await request('/api/exchange-rate?base=USD&quote=CNY&url=bad')).status, 400);
  assert.equal(calls, 1);
});

test('build contains local modules and minimal permissions, applies package-only protocol adaptation and never copies private files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-extension-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = await readFile(join(projectRoot, 'frontend/app.js'), 'utf8');
  const built = await buildExtension({ outputRoot: directory });
  const manifest = JSON.parse(await readFile(join(built.directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'LaunchDeck');
  const zip = await readFile(built.archive);
  const file = new Blob([zip]);
  const expectedSha256 = createHash('sha256').update(zip).digest('hex');
  assert.deepEqual(await inspectUpgradePackage(file, { currentVersion: '0.1.0', expectedSha256 }), {
    version: manifest.version, currentVersion: '0.1.0', comparison: 'newer', integrity: 'matched',
  });
  assert.equal((await inspectUpgradePackage(file, { currentVersion: manifest.version })).comparison, 'same');
  assert.equal((await inspectUpgradePackage(file, { currentVersion: '100.0.0' })).comparison, 'older');
  await assert.rejects(inspectUpgradePackage(file, { expectedSha256: '0'.repeat(64) }), /不匹配/);
  await assert.rejects(inspectUpgradePackage(file.slice(0, -1)), /ZIP/);
  assert.equal(built.directory, join(directory, 'launchdeck-new-tab'));
  const marker = JSON.parse(await readFile(join(built.directory, '.launchdeck-generated.json'), 'utf8'));
  assert.equal(marker.generatedBy, 'LaunchDeck');
  assert.equal(manifest.chrome_url_overrides.newtab, 'index.html');
  assert.deepEqual(manifest.permissions, ['storage', 'favicon', 'geolocation']);
  assert.equal(manifest.optional_permissions?.includes('geolocation'), undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(manifest.optional_host_permissions.every(origin => origin.startsWith('https://') && !origin.includes('localhost')));
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-eval/);
  assert.match(manifest.content_security_policy.extension_pages, /img-src 'self' data: blob:;/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /script-src[^;]*blob:/);
  const html = await readFile(join(built.directory, 'index.html'), 'utf8');
  assert.match(html, /<title>新标签页<\/title>/);
  assert.match(html, /platform\/extension\/runtime\/entry.js/);
  assert.doesNotMatch(html, /<script[^>]+src="app.js"/);
  const adapted = await readFile(join(built.directory, 'lib/feature-client.js'), 'utf8');
  assert.match(adapted, /'chrome-extension:'/);
  assert.equal(await readFile(join(projectRoot, 'frontend/app.js'), 'utf8'), before);
  const appSource = await readFile(join(built.directory, 'app.js'), 'utf8');
  const entrySource = await readFile(join(built.directory, 'platform/extension/runtime/entry.js'), 'utf8');
  assert.match(appSource, /window\.LaunchDeckIcons/);
  assert.match(entrySource, /window\.LaunchDeckIcons/);
  assert.doesNotMatch(appSource, /window\.AGYIcons/);
  assert.deepEqual((await readdir(built.directory)).filter(name => /sqlite|backup|\.env/.test(name)), []);
  await writeFile(join(directory, 'do-not-package-backup.json'), 'private');
  const second = await buildExtension({ outputRoot: directory, zip: false });
  assert.equal(second.directory, built.directory);
  assert.equal(await readFile(join(directory, 'do-not-package-backup.json'), 'utf8'), 'private');
});

test('actual worker entry registers a listener synchronously and answers extension messages', async () => {
  let listener;
  const previous = globalThis.chrome;
  const storage = memoryStorage();
  storage.setAccessLevel = async () => {};
  globalThis.chrome = { runtime: { id: ID, onMessage: { addListener(fn) { listener = fn; } } }, storage: { local: storage }, permissions: { contains: async () => false } };
  try {
    await import(`./extension/runtime/worker.js?test=${Date.now()}`);
    assert.equal(typeof listener, 'function');
    const response = await new Promise(resolve => assert.equal(listener({ channel: RPC_CHANNEL, path: '/api/health' }, SENDER, resolve), true));
    assert.equal(response.body.mode, 'extension');
    assert.equal(listener({ channel: 'other' }, SENDER, () => {}), false);
  } finally { if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous; }
});

test('build refuses symlinked inputs and never overwrites an unmarked user directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-build-guards-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'launchdeck-new-tab'));
  await writeFile(join(directory, 'launchdeck-new-tab/important.txt'), 'keep');
  await assert.rejects(buildExtension({ outputRoot: directory, zip: false }), /构建标记/);
  assert.equal(await readFile(join(directory, 'launchdeck-new-tab/important.txt'), 'utf8'), 'keep');
  const source = join(directory, 'source');
  await mkdir(source);
  await cp(join(projectRoot, 'frontend'), join(source, 'frontend'), { recursive: true });
  await mkdir(join(source, 'backend/extension'), { recursive: true });
  await cp(join(projectRoot, 'backend/extension/manifest.json'), join(source, 'backend/extension/manifest.json'));
  await symlink(join(directory, 'launchdeck-new-tab/important.txt'), join(source, 'frontend/leak.js'));
  await assert.rejects(buildExtension({ sourceRoot: source, outputRoot: join(directory, 'other-output'), zip: false }), /符号链接/);
});

test('web data migration export is read-only, excludes other device profiles and refuses file overwrite', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agy-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'portal.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE portal_state (id INTEGER PRIMARY KEY, revision INTEGER, payload TEXT); CREATE TABLE feature_documents (key TEXT, payload TEXT)');
  db.prepare('INSERT INTO portal_state VALUES (1, 7, ?)').run(JSON.stringify(portal));
  db.prepare('INSERT INTO feature_documents VALUES (?, ?)').run('widgets', JSON.stringify(defaultWidgetState()));
  db.prepare('INSERT INTO feature_documents VALUES (?, ?)').run('device:private-token-hash', JSON.stringify({ secret: 'must-not-export' }));
  db.close();
  const output = join(directory, 'backup.json');
  await exportWebData({ databasePath, output });
  const text = await readFile(output, 'utf8');
  const backup = JSON.parse(text);
  assert.deepEqual(backup.portal, portal);
  assert.deepEqual(backup.device, defaultDeviceSettings());
  assert.doesNotMatch(text, /must-not-export|private-token-hash/);
  await assert.rejects(exportWebData({ databasePath, output }), error => error.code === 'EEXIST');
  const check = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(check.prepare('SELECT revision FROM portal_state WHERE id = 1').get().revision, 7);
  check.close();
});
