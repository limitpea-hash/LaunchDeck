import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { createApp } from './app.js';
import { validatePatch } from './validation.js';
import { resolveFrontendRoot } from './paths.js';
import { getAllowedHosts, getLocalIPv4Addresses, parseAllowedHosts } from './network.js';

const prefs = { iconMode: 'light', iconSize: 'small', wallpaper: 'ios18-bloom', wallpaperDimmed: false, tintHue: 215, tintSat: 82, focusActive: false };
const site = { id: 'demo', title: '示例', url: 'https://example.com', category: 'dev', pinned: false, gradient: 'linear-gradient(180deg, #007aff 0%, #1c1c1e 140%)', accent: '#007aff', keywords: '示例' };
const initial = { sites: [site], prefs, note: '第一条便签' };

function appRequest(t, options) {
  const server = createApp({ root: resolveFrontendRoot, databasePath: ':memory:', ...options });
  t.after(() => server.close());
  const [handleRequest] = server.listeners('request');

  return async (url, { method = 'GET', headers = {}, body } = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url, headers, socket: {} });
    const response = { headers: new Headers() };
    await handleRequest(req, {
      setHeader(name, value) { response.headers.set(name, value); },
      writeHead(status, headers) {
        response.status = status;
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
      end(data) { response.body = JSON.parse(data); },
    });
    return response;
  };
}

test('parses and deduplicates allowed hosts from comma and whitespace separated entries', () => {
  assert.deepEqual(parseAllowedHosts(), []);
  assert.deepEqual(parseAllowedHosts(' \t\n'), []);
  assert.deepEqual(parseAllowedHosts(' NAV.Example.COM, 192.168.1.50\t[FD00:0::1]\nnav.example.com, [fd00::1] '),
    ['nav.example.com', '192.168.1.50', '[fd00::1]']);
  assert.deepEqual(getAllowedHosts('LOCALHOST, nav.example.com'), [...new Set([
    'localhost', '127.0.0.1', '[::1]', '0.0.0.0', ...getLocalIPv4Addresses(), 'nav.example.com',
  ])]);
});

test('rejects malformed allowed hosts and entries with URL components', () => {
  for (const host of ['*', '*.example.com', 'http://example.com', 'example.com:3000', 'example.com:80',
    'example.com:', 'example.com/a', 'example.com/', 'example.com\\a', 'user:secret@example.com',
    'example.com?', 'example.com#', 'example..com', '-example.com', 'bad_name.example',
    '192.168.1', '192.168.1.256', 'fd00::1', '[fd00::1]:80', '[fd00::1]/[x]']) {
    assert.throws(() => parseAllowedHosts(`nav.example.com, ${host}`), /ALLOWED_HOSTS.*无效/, host);
  }
});

test('ignores forwarded HTTPS when proxy trust is disabled and rejects hosts outside the allowlist', async t => {
  const send = appRequest(t, { allowedHosts: ['nav.example.com', '192.168.1.50'], trustProxy: false });
  const headers = { host: 'nav.example.com', 'x-forwarded-proto': 'https' };
  assert.equal((await send('/api/state', { headers: { ...headers, origin: 'https://nav.example.com' } })).status, 403);
  assert.equal((await send('/api/state', { headers: { ...headers, host: 'unknown.example' } })).status, 403);
  const device = await send('/api/device/settings', { headers: { ...headers, origin: 'http://nav.example.com' } });
  assert.equal(device.status, 200);
  assert.match(device.headers.get('set-cookie'), /^agy_device=/);
  assert.doesNotMatch(device.headers.get('set-cookie'), /; Secure\b/);
  assert.equal((await send('/api/state', { headers: { host: '192.168.1.50:3000', origin: 'http://192.168.1.50:3000' } })).status, 200);
});

test('trusted proxy accepts same-origin HTTPS state requests and secures the device cookie', async t => {
  const send = appRequest(t, { allowedHosts: ['nav.example.com', '192.168.1.50'], trustProxy: true });
  const headers = { host: 'nav.example.com:8443', origin: 'https://nav.example.com:8443', 'x-forwarded-proto': ' HTTPS , http' };
  const before = await send('/api/state', { headers });
  assert.equal(before.status, 200);
  assert.equal(before.body.revision, 0);
  const saved = await send('/api/state', { method: 'PATCH', headers: {
    ...headers, 'content-type': 'application/json', 'if-match': before.headers.get('etag'),
  }, body: initial });
  assert.equal(saved.status, 200);
  assert.deepEqual((await send('/api/state', { headers })).body.state, initial);
  const device = await send('/api/device/settings', { headers });
  assert.equal(device.status, 200);
  assert.match(device.headers.get('set-cookie'), /^agy_device=[a-f0-9]{64};.*; Secure$/);

  for (const override of [
    { origin: 'https://evil.example' },
    { origin: 'https://nav.example.com' },
    { host: 'unknown.example:8443', origin: 'https://unknown.example:8443', 'x-forwarded-host': headers.host },
    { 'sec-fetch-site': 'cross-site' },
    { 'x-forwarded-proto': 'http, https' },
  ]) {
    assert.equal((await send('/api/state', { headers: { ...headers, ...override } })).status, 403);
  }
  assert.equal((await send('/api/state', { headers: { host: 'nav.example.com:443',
    origin: 'https://nav.example.com', 'x-forwarded-proto': 'https' } })).status, 200);
});

async function start(databasePath = ':memory:', root = resolveFrontendRoot) {
  const server = createApp({ root, databasePath });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server, base,
    get: (path = '/api/state', options) => fetch(`${base}${path}`, options),
    patch: (patch, revision = 0, headers = {}) => fetch(`${base}/api/state`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': `"${revision}"`, ...headers }, body: JSON.stringify(patch),
    }),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('serves the page, exposes health, and keeps internal files private', async t => {
  const app = await start();
  t.after(app.close);
  const page = await app.get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /img-src 'self' data: blob: https:;/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /script-src[^;]*blob:/);
  assert.match(await page.text(), /app.js/);
  assert.deepEqual(await (await app.get('/api/health')).json(), { status: 'ok', storage: 'sqlite' });
  for (const path of ['/backend/app.js', '/backend/data/portal.sqlite', '/server/app.js', '/data/portal.sqlite', '/package.json', '/.env', '/TASK.md', '/api/missing']) {
    assert.equal((await app.get(path)).status, 404);
  }
  assert.equal((await app.get('/app.js', { method: 'HEAD' })).status, 200);
  const tileStyle = await app.get('/site-tiles.css', { method: 'HEAD' });
  assert.equal(tileStyle.status, 200);
  assert.match(tileStyle.headers.get('content-type'), /^text\/css/);
  assert.equal((await app.get('/api/state', { method: 'DELETE' })).status, 405);
});

test('imports existing browser data, patches components, and persists empty values after restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-backend-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'portal.sqlite');
  let app = await start(path);
  t.after(async () => { if (app.server.listening) await app.close(); });
  assert.deepEqual(await (await app.get()).json(), { revision: 0, state: null, updatedAt: null });
  const saved = await app.patch(initial);
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('etag'), '"1"');
  assert.deepEqual((await saved.json()).state, initial);
  assert.equal((await app.patch({ note: '', sites: [] }, 1)).status, 200);
  await app.close();
  app = await start(path);
  const restored = await (await app.get()).json();
  assert.equal(restored.revision, 2);
  assert.deepEqual(restored.state, { sites: [], prefs, note: '' });
  assert.ok(restored.updatedAt);
});

test('stale and simultaneous edits do not overwrite a newer version', async t => {
  const app = await start();
  t.after(app.close);
  await app.patch(initial);
  const results = await Promise.all([app.patch({ note: '标签页 A' }, 1), app.patch({ note: '标签页 B' }, 1)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = await (await app.get()).json();
  assert.equal(saved.revision, 2);
  assert.ok(['标签页 A', '标签页 B'].includes(saved.state.note));
});

test('site tile dimensions persist as optional 1×1 and 2×2 settings', async t => {
  const app = await start();
  t.after(app.close);
  assert.equal((await app.patch(initial)).status, 200);
  const largeSite = { ...site, size: 'square' };
  assert.equal((await app.patch({ sites: [largeSite] }, 1)).status, 200);
  assert.deepEqual((await (await app.get()).json()).state.sites, [largeSite]);
  const smallSite = { ...site, size: 'single' };
  assert.equal((await app.patch({ sites: [smallSite] }, 2)).status, 200);
  assert.deepEqual((await (await app.get()).json()).state.sites, [smallSite]);
});

test('validates input and rejects cross-origin writes without changing the database', async t => {
  const app = await start();
  t.after(app.close);
  assert.equal((await app.patch({ note: '不完整的初始化' })).status, 400);
  await app.patch(initial);
  for (const patch of [
    { sites: [{ ...site, url: 'javascript:alert(1)' }] },
    { sites: [site, site] },
    { sites: [{ ...site, gradient: 'url(https://example.com)' }] },
    { sites: [{ ...site, size: 'large' }] },
    { sites: [{ ...site, size: ['square'] }] },
    { prefs: { ...prefs, tintHue: 361 } },
    { prefs: { ...prefs, focusActive: 'true' } },
    { note: 'x'.repeat(100001) },
    { unsupported: true }, null, [],
  ]) assert.equal((await app.patch(patch, 1)).status, 400);
  assert.equal((await app.patch({ note: '跨站' }, 1, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await app.patch({ note: '跨站' }, 1, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${app.base}/api/state`, { headers: { Host: 'attacker.example' } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await app.get('/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 428);
  assert.equal((await app.patch({ note: '错误内容类型' }, 1, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await app.get('/api/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: '{' })).status, 400);
  assert.equal((await app.patch({ note: 'x'.repeat(1024 * 1024) }, 1)).status, 413);
  assert.deepEqual((await (await app.get()).json()).state, initial);
});

test('all existing frontend default sites match the backend contract', async () => {
  const source = await readFile(join(resolveFrontendRoot(), 'app.js'), 'utf8');
  const match = source.match(/const DEFAULT_SITES = (\[[\s\S]*?\n\]);/);
  const { runInNewContext } = await import('node:vm');
  const sites = runInNewContext(`(${match[1]})`);
  assert.ok(sites.length > 20);
  assert.doesNotThrow(() => validatePatch({ sites, prefs, note: '' }, true));
});

test('allows same-origin LAN requests while rejecting unrelated hosts and cross-origin writes', async t => {
  const address = getLocalIPv4Addresses()[0];
  if (!address) return t.skip('No LAN IPv4 interface available');
  const app = await start();
  t.after(app.close);
  const port = app.server.address().port;
  const host = `${address}:${port}`;
  const origin = `http://${host}`;
  const send = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(`${app.base}${path}`, {
      method: options.body ? 'PATCH' : 'GET',
      headers: { Host: host, ...options.headers },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
  assert.equal((await send('/')).status, 200);
  assert.equal((await send('/api/health')).status, 200);
  assert.equal((await send('/api/state', {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'If-Match': '"0"' },
    body: JSON.stringify(initial),
  })).status, 200);
  assert.deepEqual(JSON.parse((await send('/api/state')).body).state, initial);
  assert.equal((await send('/api/state', {
    headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', 'If-Match': '"1"' },
    body: JSON.stringify({ note: '跨站请求' }),
  })).status, 403);
  assert.equal((await send('/api/health', { headers: { Host: '192.0.2.254:3000' } })).status, 403);
});

test('static serving follows a frontend directory switch without restarting or exposing backend files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-frontend-move-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const oldRoot = join(dir, 'old');
  const newRoot = join(dir, 'frontend');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(oldRoot);
  await mkdir(newRoot);
  await writeFile(join(oldRoot, 'index.html'), '<h1>before migration</h1>');
  await writeFile(join(newRoot, 'index.html'), '<h1>after migration</h1>');
  let currentRoot = oldRoot;
  const app = await start(':memory:', () => currentRoot);
  t.after(app.close);
  assert.match(await (await app.get('/')).text(), /before migration/);
  await app.patch(initial);
  currentRoot = newRoot;
  assert.match(await (await app.get('/')).text(), /after migration/);
  assert.deepEqual((await (await app.get()).json()).state, initial);
  assert.equal((await app.get('/backend/index.js')).status, 404);
});
