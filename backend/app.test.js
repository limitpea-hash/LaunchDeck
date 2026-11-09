import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from './app.js';
import { validatePatch } from './validation.js';
import { resolveFrontendRoot } from './paths.js';
import { getLocalIPv4Addresses } from './network.js';

const prefs = { iconMode: 'light', iconSize: 'small', wallpaper: 'ios18-bloom', wallpaperDimmed: false, tintHue: 215, tintSat: 82, focusActive: false };
const site = { id: 'demo', title: '示例', url: 'https://example.com', category: 'dev', pinned: false, gradient: 'linear-gradient(180deg, #007aff 0%, #1c1c1e 140%)', accent: '#007aff', keywords: '示例' };
const initial = { sites: [site], prefs, note: '第一条便签' };

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

test('validates input and rejects cross-origin writes without changing the database', async t => {
  const app = await start();
  t.after(app.close);
  assert.equal((await app.patch({ note: '不完整的初始化' })).status, 400);
  await app.patch(initial);
  for (const patch of [
    { sites: [{ ...site, url: 'javascript:alert(1)' }] },
    { sites: [site, site] },
    { sites: [{ ...site, gradient: 'url(https://example.com)' }] },
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
