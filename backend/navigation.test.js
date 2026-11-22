import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createApp } from './app.js';
import { resolveFrontendRoot } from './paths.js';
import { defaultWidgetState } from './features/widgets.js';
import { defaultDeviceSettings } from './features/settings.js';
import { createLocalDocuments, STORE_KEY } from './extension/runtime/documents.js';
import { createExtensionApi, RPC_CHANNEL } from './extension/runtime/api.js';
import { createNavigationBackup, validateNavigationBackup, mergeNavigationSites } from './navigation/schema.js';
import { mergeNavigationBackup } from './navigation/merge.js';
import { encodeNavigationBackup, decodeNavigationPacket, createBitwardenImport, decodeBackupText, encodeBackupText } from './navigation/codec.js';

const prefs = { iconMode: 'light', iconSize: 'small', wallpaper: 'ios18-bloom', wallpaperDimmed: false, tintHue: 215, tintSat: 82, focusActive: false };
const site = (id, category = 'dev') => ({ id, category, title: `示例 ${id}`, url: `https://example.com/${id}`, pinned: id === 's1', gradient: 'linear-gradient(180deg, #007aff 0%, #1c1c1e 140%)', accent: '#007aff' });
const pages = ['all', 'ai', 'design', 'dev', 'media', 'page_demo'].map((id, order) => ({ id, title: id, icon: 'sparkles', isSystem: order < 5, order }));
function fixture() {
  const widgets = defaultWidgetState();
  widgets.layout = widgets.layout.map(w => ({ ...w, enabled: w.id === 'calendar' }));
  widgets.todos = [{ id: 't1', text: '本机待办应保留', completed: false }];
  widgets.layout.find(w => w.id === 'calendar').config.weekStartsOn = 0;
  widgets.desktop = { schemaVersion: 2, pages, placements: [
    { kind: 'site', id: 's1', pageId: 'all', order: 0 },
    { kind: 'widget', id: 'calendar', pageId: 'all', order: 1 },
    { kind: 'folder', id: 'folder_demo', pageId: 'page_demo', order: 0 },
  ], folders: [{ id: 'folder_demo', title: '示例夹', siteIds: ['s2', 'custom1'] }] };
  const sites = [site('s1'), site('s2'), site('custom1', 'page_demo')];
  return { sites, widgets, portal: { sites: [site('local')], prefs, note: '本机便签应保留' },
    backup: createNavigationBackup({ sites, pages, desktop: widgets.desktop, layout: widgets.layout }) };
}
const bad = fn => assert.throws(fn, e => e.status === 400);

test('plain HTTP navigation JSON export works without secure-context randomUUID', () => {
  const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const getRandomValues=crypto.getRandomValues.bind(crypto);
  try {
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues}});
    const first=fixture().backup, second=fixture().backup;
    assert.match(first.backupId,/^[a-f0-9]{32}$/); assert.notEqual(first.backupId,second.backupId);
  } finally { Object.defineProperty(globalThis,'crypto',original); }
});

test('navigation export is a strict content-free whitelist; merge preserves local notes, todos and widget config', () => {
  const f = fixture();
  const backup = createNavigationBackup({ sites: f.sites, pages, desktop: f.widgets.desktop, layout: f.widgets.layout, note: 'secret' });
  assert.deepEqual(Object.keys(backup).sort(), ['backupId', 'desktop', 'exportedAt', 'format', 'pages', 'sites', 'version', 'widgetSlots'].sort());
  assert.ok(backup.widgetSlots.every(slot => Object.keys(slot).sort().join() === 'id,type'));
  const merged = mergeNavigationBackup(backup, f.portal, f.widgets);
  assert.equal(merged.portal.note, f.portal.note);
  assert.deepEqual(merged.portal.prefs, prefs);
  assert.deepEqual(merged.widgets.todos, f.widgets.todos);
  assert.equal(merged.widgets.layout.find(w => w.id === 'calendar').config.weekStartsOn, 0);
  assert.deepEqual(merged.portal.sites.map(s => s.id), ['s1', 's2']);
  assert.deepEqual(merged.browserData.customSites.map(s => s.id), ['custom1']);
  assert.deepEqual(merged.widgets.desktop, backup.desktop);
  assert.deepEqual(f.portal.sites.map(s => s.id), ['local']);
});

test('widget dimensions survive compressed navigation and full extension backups, with old backups defaulting to compact', async () => {
  const { sites, widgets, portal, backup: legacyBackup } = fixture();
  const calendar = layout => layout.find(item => item.type === 'calendar');
  calendar(widgets.layout).size = 'wide';
  portal.prefs = { ...portal.prefs, nightMode: true };
  const backup = createNavigationBackup({ sites, pages, desktop: widgets.desktop, layout: widgets.layout });
  assert.deepEqual(calendar(backup.widgetSlots), { id: 'calendar', type: 'calendar', size: 'wide' });
  const decoded = await decodeNavigationPacket(await encodeNavigationBackup(backup));
  const docs = createLocalDocuments(storageFixture());
  await docs.patch('portal', portal, '"0"');
  await docs.patch('widgets', widgets, '"0"');
  await docs.importNavigation({ backup: decoded, portalRevision: 1, widgetRevision: 1 });
  const full = await docs.exportData();
  assert.equal(full.portal.prefs.nightMode, true);
  assert.equal(calendar(full.widgets.layout).size, 'wide');
  assert.deepEqual(calendar(full.widgets.layout).config, calendar(widgets.layout).config);
  assert.deepEqual(full.widgets.todos, widgets.todos);
  for (const size of ['medium', 'resize(1)', '__proto__', 4, null]) {
    const invalid = structuredClone(backup);
    calendar(invalid.widgetSlots).size = size;
    bad(() => validateNavigationBackup(invalid));
  }
  const invalid = structuredClone(full);
  invalid.widgets.layout.find(item => item.type === 'focus-timer').size = 'wide';
  await assert.rejects(docs.importData(invalid), { status: 400 });
  await docs.importNavigation({ backup: legacyBackup, portalRevision: 2, widgetRevision: 2 });
  assert.equal(calendar((await docs.read('widgets')).state.layout).size, undefined);
  assert.equal((await docs.read('portal')).state.prefs.nightMode, true);
  await docs.importData(full);
  assert.equal(calendar((await docs.read('widgets')).state.layout).size, 'wide');
});

test('mixed custom/system Dock order survives restore and reload, with later remote system reorders respected', () => {
  const f=fixture(); f.backup.sites=[f.backup.sites[2],f.backup.sites[0],f.backup.sites[1]];
  f.backup.sites.forEach(site=>{site.pinned=true;});
  const merged=mergeNavigationBackup(f.backup,f.portal,f.widgets);
  assert.deepEqual(merged.browserData.siteOrder,['custom1','s1','s2']);
  const restored=mergeNavigationSites(merged.portal.sites,merged.browserData.customSites,merged.browserData.siteOrder);
  assert.deepEqual(restored.map(site=>site.id),['custom1','s1','s2']);
  const reloaded=mergeNavigationSites(merged.portal.sites,restored.filter(s=>s.category==='page_demo'),restored.map(s=>s.id));
  assert.deepEqual(reloaded.filter(s=>s.pinned).map(s=>s.id),['custom1','s1','s2']);
  const remoteChanged=mergeNavigationSites(merged.portal.sites.toReversed(),merged.browserData.customSites,merged.browserData.siteOrder);
  assert.deepEqual(remoteChanged.filter(s=>s.category!=='page_demo').map(s=>s.id),['s2','s1']);
});

test('navigation rejects executable URLs, unknown/private fields, dangling references and malformed layout', () => {
  for (const mutate of [
    b => { b.note = 'not navigation'; },
    b => { b.sites[0].url = 'javascript:alert(1)'; },
    b => { b.sites[0].url = 'https://user:password@example.com'; },
    b => { b.widgetSlots[0].config = {}; },
    b => { b.widgetSlots[0].type = '../../malicious'; },
    b => { b.desktop.placements = {}; },
    b => { b.desktop.placements[0].id = 'missing'; },
    b => { b.desktop.folders[0].siteIds[0] = 'missing'; },
    b => { b.desktop.placements.push({ ...b.desktop.placements[1], pageId: 'dev' }); },
    b => { b.sites.push({ ...b.sites[0] }); },
    b => { b.pages[0].title = 'mismatch'; b.desktop.pages = structuredClone(pages); },
    b => { b.desktop.folders[0].siteIds[0] = 'folder_demo'; },
    b => { b.widgetSlots = Array.from({ length: 25 }, (_, i) => ({ id: `w${i}`, type: 'calendar' })); },
  ]) { const backup = structuredClone(fixture().backup); mutate(backup); bad(() => validateNavigationBackup(backup)); }
  const prototype = JSON.parse(JSON.stringify(fixture().backup).replace('"version":1', '"version":1,"__proto__":{}'));
  bad(() => validateNavigationBackup(prototype));
  const f = fixture(); f.widgets.layout[0].id = 'local_config';
  const merged = mergeNavigationBackup(f.backup, f.portal, f.widgets);
  assert.equal(merged.widgets.layout.find(w => w.id === 'local_config').enabled, false);
  assert.deepEqual(merged.widgets.layout.find(w => w.id === 'local_config').config, f.widgets.layout[0].config);
  assert.throws(() => mergeNavigationBackup(f.backup, null, f.widgets), e => e.status === 428);
});

test('navigation gzip chunks and single Bitwarden login round-trip; truncation, mixed batches and whole vaults fail', async () => {
  const b = fixture().backup;
  for (let i = 3; i < 180; i++) b.sites.push({ ...site(`s${i}`), keywords: createHash('sha256').update(String(i)).digest('hex') });
  const packet = await encodeNavigationBackup(b);
  assert.ok(packet.chunks.length > 1);
  assert.deepEqual(await decodeNavigationPacket(packet), b);
  assert.deepEqual(await decodeBackupText(encodeBackupText(packet)), b);
  assert.deepEqual(await decodeBackupText(JSON.stringify(b)), b);
  const bw = await createBitwardenImport(b, 'https://example.com/restore.html');
  assert.equal(bw.items.length, 1);
  assert.equal(bw.items[0].login.uris[0].match, 3);
  assert.ok(bw.items[0].fields.every(f => f.type === 1 && f.value.length <= 3000));
  assert.deepEqual(await decodeBackupText(JSON.stringify(bw)), b);
  for (const altered of [
    { ...packet, chunks: packet.chunks.slice(1) },
    { ...packet, chunks: packet.chunks.toReversed() },
    { ...packet, chunks: [packet.chunks[0].slice(1), ...packet.chunks.slice(1)] },
    { ...packet, manifest: packet.manifest.replace(b.backupId, 'f'.repeat(32)) },
  ]) await assert.rejects(decodeNavigationPacket(altered));
  await assert.rejects(decodeBackupText(JSON.stringify({ ...bw, items: [bw.items[0], bw.items[0]] })));
  await assert.rejects(decodeBackupText(JSON.stringify({ encrypted: true, items: bw.items })));
  const invalid = structuredClone(bw); invalid.items[0].fields.shift();
  await assert.rejects(decodeBackupText(JSON.stringify(invalid)));
  await assert.rejects(createBitwardenImport(b, 'https://example.com/restore.html#token'));
});

test('navigation decoding bounds compressed bombs, malformed manifests and huge text', async () => {
  const zipped = gzipSync(' '.repeat(1024 * 1024 + 1)).toString('base64');
  const packet = { chunks: [zipped], manifest: JSON.stringify({ format: 'launchdeck-bitwarden-navigation', version: 1, codec: 'gzip-base64', backupId: 'a'.repeat(32), chunks: 1, characters: zipped.length, sha256: createHash('sha256').update(zipped).digest('hex') }) };
  await assert.rejects(decodeNavigationPacket(packet), /大小限制/);
  await assert.rejects(decodeBackupText('x'.repeat(2 * 1024 * 1024 + 1)), /2MiB/);
  for (const count of [-1, 1000000000, null, '2']) {
    const bw = await createBitwardenImport(fixture().backup, 'https://example.com/restore.html');
    const manifest = JSON.parse(bw.items[0].fields[0].value); manifest.chunks = count;
    bw.items[0].fields[0].value = JSON.stringify(manifest);
    await assert.rejects(decodeBackupText(JSON.stringify(bw)));
  }
});

function storageFixture() {
  const values = {}; let fail = false;
  return { values, setFail(value) { fail = value; }, async get(key) { return structuredClone({ [key]: values[key] }); },
    async set(next) { if (fail) throw Error('quota'); Object.assign(values, structuredClone(next)); } };
}
test('extension navigation restore is one write with two revisions; failure, conflicts and worker recreation preserve data', async () => {
  const storage = storageFixture(), docs = createLocalDocuments(storage), f = fixture();
  await docs.patch('portal', f.portal, '"0"'); await docs.patch('widgets', f.widgets, '"0"');
  const before = structuredClone(storage.values[STORE_KEY]);
  storage.setFail(true);
  await assert.rejects(docs.importNavigation({ backup: f.backup, portalRevision: 1, widgetRevision: 1 }), e => e.status === 503);
  assert.deepEqual(storage.values[STORE_KEY], before);
  storage.setFail(false);
  const input = { backup: f.backup, portalRevision: 1, widgetRevision: 1 };
  const results = await Promise.allSettled([docs.importNavigation(input), docs.importNavigation(input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  const fresh = createLocalDocuments(storage);
  assert.equal((await fresh.read('portal')).state.note, f.portal.note);
  assert.deepEqual((await fresh.read('widgets')).state.todos, f.widgets.todos);
  assert.deepEqual((await fresh.read('device')).state, defaultDeviceSettings());
  const browser = await fresh.readNavigationBrowserData();
  assert.equal(browser.data.customSites.length, 1); assert.ok(browser.restoreId);
  const again = await fresh.importNavigation({ ...input, portalRevision: 2, widgetRevision: 2 });
  assert.notEqual(again.restoreId, browser.restoreId);
  const full=await fresh.exportData();
  assert.deepEqual(full.browserData.siteOrder,f.backup.sites.map(site=>site.id));
  const broken=structuredClone(full);broken.browserData.siteOrder=['s1','s1','custom1'];
  await assert.rejects(fresh.importData(broken),e=>e.status===400);
  assert.equal((await fresh.read('portal')).revision,3);
  await fresh.importData(full);
  assert.deepEqual((await fresh.readNavigationBrowserData()).data.siteOrder,full.browserData.siteOrder);
});

test('extension navigation RPC rejects foreign senders, query parameters and stale versions', async () => {
  const storage = storageFixture(), id = 'abcdefghijklmnopabcdefghijklmnop';
  const api = createExtensionApi({ storage, environment: {}, extensionId: id });
  const sender = { id, url: `chrome-extension://${id}/index.html` };
  const call = (path, body, who = sender) => api({ channel: RPC_CHANNEL, path, method: body ? 'POST' : 'GET', body }, who);
  assert.deepEqual((await call('/api/navigation/browser-data')).body, { restoreId: null, data: null });
  const input = { backup: fixture().backup, portalRevision: 0, widgetRevision: 0 };
  assert.equal((await call('/api/navigation/import', input)).status, 428);
  assert.equal((await call('/api/navigation/import', input, { ...sender, url: 'https://example.com' })).status, 403);
  assert.equal((await call('/api/navigation/import?url=evil', input)).status, 400);
  assert.equal((await call('/api/navigation/import', { ...input, portalRevision: 1 })).status, 409);
});

async function start(t) {
  const dir = await mkdtemp(join(tmpdir(), 'launchdeck-navigation-'));
  const databasePath = join(dir, 'test.sqlite');
  const server = createApp({ root: resolveFrontendRoot, databasePath });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, revision) => fetch(base + path, { method,
    headers: { 'Content-Type': 'application/json', ...(revision === undefined ? {} : { 'If-Match': `"${revision}"` }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { request, databasePath };
}
test('HTTP restores atomically, checks both versions and exposes only allowlisted pure modules', async t => {
  const { request } = await start(t), f = fixture();
  assert.equal((await request('/api/navigation/import', 'POST', { backup: f.backup, portalRevision: 0, widgetRevision: 0 })).status, 428);
  await request('/api/state', 'PATCH', f.portal, 0); await request('/api/widgets/state', 'PATCH', f.widgets, 0);
  const input = { backup: f.backup, portalRevision: 1, widgetRevision: 1 };
  const results = await Promise.all([request('/api/navigation/import', 'POST', input), request('/api/navigation/import', 'POST', input)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const result = await results.find(r => r.status === 200).json();
  assert.deepEqual(result.revisions, { portal: 2, widgets: 2 });
  assert.deepEqual(result.browserData.siteOrder,f.backup.sites.map(site=>site.id));
  const portal = await (await request('/api/state')).json(), widgets = await (await request('/api/widgets/state')).json();
  assert.equal(portal.state.note, f.portal.note); assert.deepEqual(portal.state.prefs, prefs);
  assert.deepEqual(widgets.state.todos, f.widgets.todos);
  assert.deepEqual(await (await request('/api/navigation/browser-data')).json(), { restoreId: result.restoreId, data: result.browserData });
  assert.equal((await request('/api/navigation/import', 'POST', { ...input, portalRevision: 2 })).status, 409);
  assert.equal((await request('/api/navigation/import', 'POST', { ...input, widgetRevision: 2 })).status, 409);
  for (const path of ['/platform/navigation/codec.js', '/platform/navigation/schema.js', '/platform/features/widgets.js', '/platform/validation.js']) assert.equal((await request(path)).status, 200);
  for (const path of ['/platform/app.js', '/platform/navigation/http.js', '/platform/features/store.js', '/platform/extension/runtime/documents.js']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/api/navigation/browser-data?x=1')).status, 400);
  assert.equal((await request('/api/navigation/import')).status, 405);
});

test('HTTP versioned writes validate widget sizes and night mode without changing legacy defaults', async t => {
  const { request } = await start(t);
  const { portal, widgets } = fixture();
  assert.equal((await request('/api/state', 'PATCH', portal, 0)).status, 200);
  assert.equal((await request('/api/state', 'PATCH', { prefs: { ...prefs, nightMode: 'true' } }, 1)).status, 400);
  assert.equal((await request('/api/state', 'PATCH', { prefs: { ...prefs, nightMode: true } }, 1)).status, 200);
  assert.equal((await request('/api/widgets/state', 'PATCH', widgets, 0)).status, 200);

  const layout = structuredClone(widgets.layout);
  const calendar = layout.find(item => item.type === 'calendar');
  calendar.size = ['wide'];
  assert.equal((await request('/api/widgets/state', 'PATCH', { layout }, 1)).status, 400);
  calendar.size = 'square';
  assert.equal((await request('/api/widgets/state', 'PATCH', { layout }, 1)).status, 200);
  assert.equal((await request('/api/widgets/state', 'PATCH', { layout: widgets.layout }, 1)).status, 409);
  const docs = await Promise.all(['/api/state', '/api/widgets/state', '/api/widgets'].map(async path => (await request(path)).json()));
  assert.equal(docs[0].state.prefs.nightMode, true);
  assert.deepEqual(docs[1].state.desktop, widgets.desktop);
  assert.equal(docs[1].state.layout.find(item => item.id === calendar.id).size, 'square');
  assert.deepEqual(docs[2].widgets.find(item => item.type === 'focus-timer').sizes, ['compact', 'square']);
});

test('top-level links can open static pages while cross-site API reads and writes stay blocked', async t => {
  // Real navigation headers are generated by browsers, never granted to an API URL.
  const server = createApp({ root: resolveFrontendRoot, databasePath: ':memory:' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  const status = path => new Promise((resolve, reject) => {
    const req = httpRequest(base + path, { headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(await status('/'), 200);
  assert.equal(await status('/api/state'), 403);
});

test('HTTP storage failure rolls back portal, widgets and browser metadata together', async t => {
  const { request, databasePath } = await start(t), f = fixture();
  await request('/api/state', 'PATCH', f.portal, 0); await request('/api/widgets/state', 'PATCH', f.widgets, 0);
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TRIGGER fail_navigation BEFORE INSERT ON feature_documents WHEN NEW.key = 'navigation-browser-data' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal((await request('/api/navigation/import', 'POST', { backup: f.backup, portalRevision: 1, widgetRevision: 1 })).status, 503);
  const portal = await (await request('/api/state')).json(), widgets = await (await request('/api/widgets/state')).json();
  assert.equal(portal.revision, 1); assert.deepEqual(portal.state, f.portal);
  assert.equal(widgets.revision, 1); assert.deepEqual(widgets.state, f.widgets);
  assert.deepEqual(await (await request('/api/navigation/browser-data')).json(), { restoreId: null, data: null }); db.close();
});
