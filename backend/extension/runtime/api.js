import { HttpError } from '../../validation.js';
import { widgetDefinitions } from '../../features/widgets.js';
import { clockSnapshot, validateEnvironmentInput } from '../../features/settings.js';
import { check, timeZone } from '../../features/schema.js';
import { createLocalDocuments } from './documents.js';
import { browserFaviconUrl, faviconPageUrl } from './favicons.js';

export const RPC_CHANNEL = 'launchdeck-extension-api-v1';
export const LEGACY_RPC_CHANNEL = 'agy-extension-api-v1';

function query(url, names) {
  const seen = new Set();
  for (const name of url.searchParams.keys()) {
    check(names.includes(name) && !seen.has(name), '查询字段不正确或重复');
    seen.add(name);
  }
}

function numeric(url, key) {
  const value = url.searchParams.get(key);
  check(value !== null && /^-?\d+(?:\.\d+)?$/.test(value), `${key}必须为数字`);
  return Number(value);
}

export function createExtensionApi({ storage, environment, extensionId, permissions, now = Date.now }) {
  const documents = createLocalDocuments(storage, { now });
  const rate = new Map();

  async function dispatch(request) {
    check(typeof request.path === 'string' && /^\/api\//.test(request.path) && request.path.length <= 2000, '接口路径不正确');
    const url = new URL(request.path, 'https://extension.invalid');
    check(url.origin === 'https://extension.invalid', '接口地址不正确');
    const method = request.method || 'GET';
    check(['GET', 'POST', 'PATCH'].includes(method), '请求方法不支持');
    if (request.body !== undefined && new TextEncoder().encode(JSON.stringify(request.body)).byteLength > (url.pathname === '/api/extension/import' ? 2 : 1) * 1024 * 1024) throw new HttpError(413, '请求体过大');
    const body = request.body;
    const path = url.pathname;
    if (path === '/api/icons/favicon') {
      query(url, ['pageUrl', 'size']);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      const pageUrl = faviconPageUrl(url.searchParams.get('pageUrl'));
      const size = url.searchParams.has('size') ? Number(url.searchParams.get('size')) : 64;
      const imageUrl = browserFaviconUrl(pageUrl, { extensionId, size });
      if (!permissions || !await permissions.contains({ permissions: ['favicon'] })) throw new HttpError(403, '需要在扩展管理页确认 favicon 图标权限');
      return { body: { source: 'browser-favicon', pageUrl, imageUrl, size } };
    }
    if (path === '/api/extension/browser-data') {
      query(url, []);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      return { body: await documents.readBrowserData() };
    }
    const documentKinds = { '/api/state': 'portal', '/api/widgets/state': 'widgets', '/api/device/settings': 'device' };
    if (Object.hasOwn(documentKinds, path)) {
      query(url, []);
      if (!['GET', 'PATCH'].includes(method)) throw new HttpError(405, '请求方法不支持');
      const value = method === 'GET' ? await documents.read(documentKinds[path]) : await documents.patch(documentKinds[path], body, request.ifMatch);
      return { body: value, headers: { ETag: `"${value.revision}"` } };
    }
    if (path === '/api/extension/backup') {
      query(url, []);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      return { body: await documents.exportData() };
    }
    if (path === '/api/extension/import') {
      query(url, []);
      if (method !== 'POST') throw new HttpError(405, '请求方法不支持');
      return { body: await documents.importData(body) };
    }
    if (path === '/api/health') {
      query(url, []);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      return { body: { status: 'ok', storage: 'chrome.storage.local', mode: 'extension' } };
    }
    if (path === '/api/widgets') {
      query(url, []);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      return { body: { schemaVersion: 1, widgets: structuredClone(widgetDefinitions) } };
    }
    if (path === '/api/timezones') {
      query(url, []);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      return { body: { timeZones: ['UTC', ...Intl.supportedValuesOf('timeZone')] } };
    }
    if (path === '/api/time') {
      query(url, ['browserTimeZone']);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      const zone = url.searchParams.get('browserTimeZone') ?? undefined;
      if (zone !== undefined) timeZone(zone);
      const settings = (await documents.read('device')).state;
      return { body: { ...clockSnapshot(settings.clock, { browserTimeZone: zone,
        locationTimeZone: settings.location.mode === 'manual' ? settings.location.manual.timeZone : undefined, now: now() }), timeSource: 'device' } };
    }
    if (path === '/api/environment/resolve') {
      query(url, []);
      if (method !== 'POST') throw new HttpError(405, '请求方法不支持');
      validateEnvironmentInput(body);
      return { body: await environment.resolve((await documents.read('device')).state, body) };
    }
    if (path === '/api/location/search') {
      query(url, ['q']);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      return { body: await environment.search(url.searchParams.get('q')) };
    }
    if (path === '/api/weather') {
      query(url, ['latitude', 'longitude', 'timeZone', 'temperatureUnit']);
      if (method !== 'GET') throw new HttpError(405, '请求方法不支持');
      return { body: await environment.weather({ latitude: numeric(url, 'latitude'), longitude: numeric(url, 'longitude'),
        timeZone: url.searchParams.get('timeZone') ?? 'UTC', temperatureUnit: url.searchParams.get('temperatureUnit') ?? 'celsius' }) };
    }
    throw new HttpError(404, '接口不存在');
  }

  return async function handle(message, sender) {
    try {
      const prefix = `chrome-extension://${extensionId}/`;
      const ownUrl = typeof sender?.url === 'string' && sender.url.startsWith(prefix);
      const newTab = ['chrome://newtab/', 'edge://newtab/'].includes(sender?.url) && sender.origin === prefix.slice(0, -1);
      if (sender?.id !== extensionId || (!ownUrl && !newTab)) throw new HttpError(403, '只接受当前扩展页面的请求');
      if (![RPC_CHANNEL, LEGACY_RPC_CHANNEL].includes(message?.channel)) throw new HttpError(400, '消息格式不正确');
      const key = sender.documentId || String(sender.tab?.id ?? sender.url);
      const previous = rate.get(key);
      const entry = previous && previous.until > now() ? previous : { count: 0, until: now() + 60000 };
      rate.set(key, entry);
      while (rate.size > 128) rate.delete(rate.keys().next().value);
      if (++entry.count > 600) throw new HttpError(429, '操作过于频繁，请稍后重试');
      const result = await dispatch(message);
      return { status: 200, headers: result.headers || {}, body: result.body };
    } catch (error) {
      return { status: error.status || 503, headers: error.status === 429 ? { 'Retry-After': '60' } : {},
        body: { error: error.status ? error.message : '扩展本地服务暂时不可用，请保留当前修改并重试' } };
    }
  };
}
