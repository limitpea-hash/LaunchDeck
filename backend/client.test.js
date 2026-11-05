import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { resolveFrontendRoot } from './paths.js';

const source = await readFile(join(resolveFrontendRoot(), 'backend-client.js'), 'utf8');
const OUTBOX = 'ios18_nav_outbox_v1';

function client(fetch, storage = new Map(), protocol = 'http:') {
  const timers = new Map();
  const events = [];
  const elements = new Map();
  let id = 0;
  function element(tag) {
    return {
      tag, style: {}, children: [], listeners: {},
      append(...children) { this.children.push(...children); for (const child of children) if (child.id) elements.set(child.id, child); },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      showModal() {}, close() {}, remove() { elements.delete(this.id); },
    };
  }
  const window = { dispatchEvent: event => events.push(event) };
  runInNewContext(source, {
    window, fetch, structuredClone, AbortSignal,
    location: { protocol, reload() {} },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { body: element('body'), addEventListener() {}, getElementById: id => elements.get(id), createElement: element },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    api: window.PortalBackend, storage, events, elements,
    async tick(delay = 350) {
      const current = [...timers];
      for (const [id, timer] of current) if (timer.delay === delay && timers.delete(id)) await timer.fn();
    },
  };
}

const reply = (body, status = 200) => ({ ok: status === 200, status, json: async () => structuredClone(body) });
const state = { sites: [], prefs: { iconMode: 'light' }, note: '数据库便签' };

test('adapter batches edits and retains edits made while an earlier save is in flight', async () => {
  let finish;
  const requests = [];
  const app = client(async (url, options) => {
    if (!options.method) return reply({ revision: 1, state });
    requests.push(options);
    if (requests.length === 1) return new Promise(resolve => { finish = () => resolve(reply({ revision: 2 })); });
    return reply({ revision: 3 });
  });
  await app.api.load();
  app.api.save({ note: '第一版' });
  app.api.save({ sites: [] });
  const saving = app.tick();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(requests[0].body), { note: '第一版', sites: [] });
  app.api.save({ note: '保存过程中继续输入' });
  finish();
  await saving;
  assert.equal(JSON.parse(app.storage.get(OUTBOX)).patch.note, '保存过程中继续输入');
  await app.tick(3000);
  assert.equal(requests[1].headers['If-Match'], '"2"');
  assert.deepEqual(JSON.parse(requests[1].body), { note: '保存过程中继续输入' });
  assert.equal(app.storage.has(OUTBOX), false);
});

test('offline changes survive reload and are sent when the database version is unchanged', async () => {
  const storage = new Map([['ios18_nav_revision_v1', '4']]);
  const offline = client(async () => { throw new Error('offline'); }, storage);
  assert.equal(await offline.api.load(), null);
  offline.api.save({ note: '离线便签' });
  const requests = [];
  const online = client(async (url, options) => {
    if (!options.method) return reply({ revision: 4, state });
    requests.push(options);
    return reply({ revision: 5 });
  }, storage);
  assert.equal((await online.api.load()).note, '离线便签');
  await online.tick();
  assert.equal(requests[0].headers['If-Match'], '"4"');
  assert.equal(storage.has(OUTBOX), false);
});

test('a conflict stays paused across reloads until the user explicitly chooses a version', async () => {
  const storage = new Map([[OUTBOX, JSON.stringify({ revision: 1, patch: { note: '本机版本' } })]]);
  const requests = [];
  const fetch = async (url, options) => {
    if (!options.method) return reply({ revision: 2, state });
    requests.push(options);
    return reply({ revision: 3 });
  };
  const first = client(fetch, storage);
  assert.equal((await first.api.load()).note, '本机版本');
  await first.tick(0);
  assert.ok(first.elements.has('backendSyncConflict'));
  assert.equal(JSON.parse(storage.get(OUTBOX)).blocked, true);
  const second = client(fetch, storage);
  await second.api.load();
  second.api.save({ note: '继续编辑' });
  await second.tick();
  assert.equal(requests.length, 0);
  await second.api.resolveConflict('local');
  assert.equal(requests[0].headers['If-Match'], '"2"');
  assert.equal(JSON.parse(requests[0].body).note, '继续编辑');
  assert.equal(storage.has(OUTBOX), false);
});

test('a lost save response is reconciled if the database already has the queued values', async () => {
  const storage = new Map([[OUTBOX, JSON.stringify({ revision: 1, patch: { note: '已成功保存' } })]]);
  const app = client(async () => reply({ revision: 2, state: { ...state, note: '已成功保存' } }), storage);
  await app.api.load();
  assert.equal(storage.has(OUTBOX), false);
});

test('opening the static HTML directly does not make backend requests', async () => {
  const app = client(async () => { throw new Error('must not fetch'); }, new Map(), 'file:');
  assert.equal(await app.api.load(), null);
  app.api.save({ note: '本地模式' });
  await app.tick();
  assert.equal(app.storage.has(OUTBOX), false);
});
