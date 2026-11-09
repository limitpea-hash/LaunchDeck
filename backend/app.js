import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HttpError, validatePatch } from './validation.js';
import { getAllowedHosts } from './network.js';
import { createEnvironmentService } from './features/environment.js';
import { createFeatureRoutes } from './features/routes.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/backend-client.js', ['backend-client.js', 'text/javascript; charset=utf-8']],
]);

export function createApp({ root, databasePath, allowedHosts = getAllowedHosts, environmentService = createEnvironmentService() }) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS portal_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  const select = db.prepare('SELECT revision, payload, updated_at FROM portal_state WHERE id = 1');
  const insert = db.prepare('INSERT INTO portal_state (id, revision, payload, updated_at) VALUES (1, 1, ?, ?)');
  const update = db.prepare('UPDATE portal_state SET revision = revision + 1, payload = ?, updated_at = ? WHERE id = 1');

  function snapshot() {
    const row = select.get();
    return row ? { revision: row.revision, state: JSON.parse(row.payload), updatedAt: row.updated_at } : { revision: 0, state: null, updatedAt: null };
  }

  function json(res, status, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  }

  async function readBody(req, maxBytes = 1024 * 1024) {
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, '请使用 application/json');
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maxBytes) {
        req.resume();
        throw new HttpError(413, `请求不能超过 ${maxBytes / 1024} KB`);
      }
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'JSON 格式不正确'); }
  }

  const handleFeature = createFeatureRoutes({ db, readBody, json, environment: environmentService });

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      let base;
      try {
        base = new URL(`http://${req.headers.host}`);
        if (!req.headers.host || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('invalid Host');
      } catch { throw new HttpError(400, '访问地址格式不正确'); }
      const hosts = typeof allowedHosts === 'function' ? allowedHosts() : allowedHosts;
      if (!hosts.includes(base.hostname)) throw new HttpError(403, '访问地址不在允许列表中');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '不接受跨站请求');
      if (req.headers.origin && req.headers.origin !== base.origin) throw new HttpError(403, '请求来源不正确');
      const url = new URL(req.url, base);
      const path = url.pathname;
      if (path === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'ok', storage: 'sqlite' });
      if (path === '/api/state') {
        if (req.method === 'GET') {
          const value = snapshot();
          return json(res, 200, value, { ETag: `"${value.revision}"` });
        }
        if (req.method !== 'PATCH') {
          res.setHeader('Allow', 'GET, PATCH');
          throw new HttpError(405, '请求方法不支持');
        }
        if (!/^"\d+"$/.test(req.headers['if-match'] || '')) throw new HttpError(428, '需要通过 If-Match 提交当前数据版本');
        const patch = await readBody(req);
        db.exec('BEGIN IMMEDIATE');
        let value;
        try {
          const previous = snapshot();
          if (req.headers['if-match'] !== `"${previous.revision}"`) throw new HttpError(409, '数据已在其他页面更新，请刷新后再试');
          validatePatch(patch, previous.state === null);
          const next = { ...previous.state, ...patch };
          const time = new Date().toISOString();
          if (previous.state === null) insert.run(JSON.stringify(next), time);
          else update.run(JSON.stringify(next), time);
          value = snapshot();
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return json(res, 200, value, { ETag: `"${value.revision}"` });
      }
      if (await handleFeature(req, res, url)) return;
      if (path.startsWith('/api/')) throw new HttpError(404, '接口不存在');
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        throw new HttpError(405, '请求方法不支持');
      }
      if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
      const moduleAsset = /^\/(?:widgets|lib)\/[a-z0-9/_-]+\.(?:js|css)$/i.test(path)
        ? [path.slice(1), path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'] : null;
      const asset = assets.get(path) || moduleAsset;
      if (!asset) throw new HttpError(404, '页面不存在');
      const frontendRoot = await realpath(typeof root === 'function' ? root() : root);
      const assetPath = await realpath(resolve(frontendRoot, asset[0]));
      if (!assetPath.startsWith(`${frontendRoot}${sep}`)) throw new HttpError(404, '页面不存在');
      const content = await readFile(assetPath);
      res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.destroyed) return;
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return json(res, 404, { error: '页面不存在' });
      if (!error.status) console.error('Request failed:', error);
      json(res, error.status || 500, { error: error.status ? error.message : '服务器暂时无法处理请求' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => db.close());
  return server;
}
