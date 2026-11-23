import { HttpError } from '../validation.js';
import { check, record, string } from './schema.js';

const MAX_SOURCES = 8;
const MAX_MESSAGES = 40;
const MAX_FEED_BYTES = 128 * 1024;
const REFRESH_INTERVAL = 60000;
const MANUAL_INTERVAL = 10000;

export function notificationSource(input) {
  record(input, ['name', 'url'], '通知来源');
  const name = string(input.name, 60, '来源名称').trim();
  const value = string(input.url, 1500, '订阅地址').trim();
  let url;
  try { url = new URL(value); }
  catch { throw new HttpError(400, '请输入有效的 HTTPS 订阅地址'); }
  check(url.protocol === 'https:' && !url.username && !url.password && !value.includes('#'),
    '订阅地址必须使用 HTTPS，且不得含账号、密码或片段');
  check(url.href.length <= 1500, '订阅地址过长');
  return { name, url: url.href };
}

function messageLink(value) {
  if (typeof value !== 'string' || value.length > 1500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 1500 ? url.href : null;
  } catch { return null; }
}

function newInbox() {
  return { sources: [] };
}

function sortMessages(a, b) {
  return b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);
}

function normalizeFeed(value) {
  check(Array.isArray(value?.messages) && value.messages.length <= 100, '订阅源应返回最多 100 条的 messages 数组');
  const messages = new Map();
  for (const item of value.messages) {
    const id = string(item?.id, 128, '通知 ID').trim();
    const title = string(item?.title, 120, '通知标题').trim();
    const body = item.body === undefined ? '' : string(item.body, 500, '通知正文', true).trim();
    const publishedAt = string(item.publishedAt, 40, '通知时间');
    check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(publishedAt) &&
      Number.isFinite(Date.parse(publishedAt)), '通知时间必须为带时区的 ISO 8601 时间');
    if (!messages.has(id)) messages.set(id, { id, title, body, url: messageLink(item.url), publishedAt: new Date(publishedAt).toISOString() });
  }
  return [...messages.values()].sort(sortMessages).slice(0, MAX_MESSAGES);
}

async function readFeed(response) {
  if (!response.ok || !/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError(400, '订阅源未返回成功的 JSON 响应');
  }
  const reader = response.body?.getReader();
  check(reader, '订阅源没有返回消息内容');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    check(Number(response.headers.get('content-length')) <= MAX_FEED_BYTES, '订阅消息超过 128 KiB');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(size <= MAX_FEED_BYTES, '订阅消息超过 128 KiB');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
  let document;
  try { document = JSON.parse(text + decoder.decode()); }
  catch { throw new HttpError(400, '订阅源的 JSON 格式不正确'); }
  return normalizeFeed(document);
}

function snapshot(document) {
  const sources = [];
  const messages = [];
  for (const { id, name, url, error, lastSuccessAt, messages: items } of document.sources) {
    sources.push({ id, name, url, error, lastSuccessAt });
    messages.push(...items.map(item => ({ ...item, sourceId: id, sourceName: name })));
  }
  messages.sort(sortMessages);
  return { sources, messages, unreadCount: messages.filter(item => !item.read).length };
}

function mergeMessages(saved, incoming) {
  const byId = new Map(saved.map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, { ...item, read: byId.get(item.id)?.read ?? false });
  return [...byId.values()].sort(sortMessages).slice(0, MAX_MESSAGES);
}

export function createNotificationService({ store, fetchImpl = globalThis.fetch.bind(globalThis),
  canFetch = async () => true, now = Date.now } = {}) {
  async function getSnapshot() {
    return snapshot((await store.read()) ?? newInbox());
  }

  async function update(change) {
    return snapshot(await store.update(document => change(document ?? newInbox())));
  }

  async function addSource(input) {
    const source = notificationSource(input);
    return update(document => {
      const existing = document.sources.find(item => item.url === source.url);
      if (existing) return { sources: document.sources.map(item => item === existing ? { ...item, name: source.name } : item) };
      check(document.sources.length < MAX_SOURCES, '最多可以订阅 8 个通知来源');
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      return { sources: [...document.sources, { ...source, id, messages: [], lastAttemptAt: null, lastSuccessAt: null, error: null }] };
    });
  }

  function removeSource(id) {
    string(id, 64, '来源 ID');
    return update(document => ({ sources: document.sources.filter(source => source.id !== id) }));
  }

  function markRead(sourceId, messageId) {
    string(sourceId, 64, '来源 ID');
    string(messageId, 128, '通知 ID');
    return update(document => ({ sources: document.sources.map(source => source.id === sourceId
      ? { ...source, messages: source.messages.map(item => item.id === messageId ? { ...item, read: true } : item) }
      : source) }));
  }

  function markAllRead() {
    return update(document => ({ sources: document.sources.map(source => ({
      ...source, messages: source.messages.map(item => ({ ...item, read: true })),
    })) }));
  }

  async function loadSource(source) {
    try {
      const url = new URL(source.url);
      if (!await canFetch(url)) throw new HttpError(403, '请重新添加此订阅并允许访问来源域名');
      const response = await fetchImpl(url.href, { method: 'GET', headers: { Accept: 'application/json' },
        credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      return { messages: await readFeed(response), lastSuccessAt: new Date(now()).toISOString(), error: null };
    } catch (error) {
      return { error: error instanceof HttpError ? error.message : '无法读取订阅源，请检查网络和跨域访问设置' };
    }
  }

  async function refresh({ force = false } = {}) {
    const stamp = now();
    const interval = force ? MANUAL_INTERVAL : REFRESH_INTERVAL;
    const due = [];
    const previous = await update(document => {
      const sources = document.sources.map(source => {
        if (source.lastAttemptAt !== null && stamp - source.lastAttemptAt < interval && stamp >= source.lastAttemptAt) return source;
        due.push(source);
        return { ...source, lastAttemptAt: stamp };
      });
      return due.length ? { sources } : document;
    });
    if (!due.length) return previous;
    const loaded = new Map(await Promise.all(due.map(async source => [source.id, await loadSource(source)])));
    return update(document => ({ sources: document.sources.map(source => {
      const result = loaded.get(source.id);
      if (!result || source.lastAttemptAt !== stamp) return source;
      if (result.error) return { ...source, error: result.error };
      return { ...source, messages: mergeMessages(source.messages, result.messages), lastSuccessAt: result.lastSuccessAt, error: null };
    }) }));
  }

  return Object.freeze({ getSnapshot, addSource, removeSource, refresh, markRead, markAllRead });
}

// The web origin stores its inbox in an atomic IndexedDB document and fetches
// directly from the browser, including on LAN HTTP origins.
export function createWebNotifications() {
  let opened;
  function database() {
    opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('launchdeck-notifications-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('inbox');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('无法打开通知存储'));
    }).catch(error => { opened = undefined; throw error; });
    return opened;
  }
  async function access(change) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('inbox', change ? 'readwrite' : 'readonly');
      const objectStore = tx.objectStore('inbox');
      const request = objectStore.get('state');
      let value;
      let failure;
      request.onsuccess = () => {
        const previous = request.result;
        try {
          value = change ? change(previous) : previous;
          if (change && value !== previous) objectStore.put(value, 'state');
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure || new Error('无法读写通知存储'));
    });
  }
  return createNotificationService({ store: { read: () => access(), update: access } });
}
