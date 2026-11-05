import { HttpError } from '../validation.js';
import { createFeatureStore, deviceKey } from './store.js';
import { widgetDefinitions, defaultWidgetState, validateWidgetPatch, validateWidgetDocument } from './widgets.js';
import { defaultDeviceSettings, validateSettingsPatch, validateEnvironmentInput, clockSnapshot } from './settings.js';
import { check, timeZone } from './schema.js';

function validateQuery(url, allowed) {
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    check(allowed.includes(key) && !seen.has(key), '查询包含未知或重复字段');
    seen.add(key);
  }
}

function numberParam(url, name) {
  const value = url.searchParams.get(name);
  check(value !== null && /^-?\d+(?:\.\d+)?$/.test(value), `${name}必须为数字`);
  return Number(value);
}

export function createFeatureRoutes({ db, readBody, json, environment }) {
  const store = createFeatureStore(db);
  const requests = new Map();
  const methods = new Map([
    ['/api/widgets', ['GET']], ['/api/widgets/state', ['GET', 'PATCH']],
    ['/api/device/settings', ['GET', 'PATCH']], ['/api/time', ['GET']], ['/api/timezones', ['GET']],
    ['/api/location/search', ['GET']], ['/api/environment/resolve', ['POST']], ['/api/weather', ['GET']],
  ]);

  function rateLimit(req, res) {
    const key = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = requests.get(key);
    if (!entry || now >= entry.until) {
      entry = { count: 0, external: 0, until: now + 60000 };
      requests.delete(key);
      requests.set(key, entry);
    }
    const external = ['/api/location/search', '/api/environment/resolve', '/api/weather'].includes(new URL(req.url, 'http://localhost').pathname);
    if (++entry.count > 120 || (external && ++entry.external > 30)) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.until - now) / 1000))));
      throw new HttpError(429, '请求过于频繁，请稍后重试');
    }
    while (requests.size > 2048) requests.delete(requests.keys().next().value);
  }

  function documentResponse(res, value) {
    json(res, 200, value, { ETag: `"${value.revision}"` });
  }

  function settings(req, res) {
    return store.read(deviceKey(req, res), defaultDeviceSettings).state;
  }

  return async function handle(req, res, url) {
    const path = url.pathname;
    const allowed = methods.get(path);
    if (!allowed) return false;
    if (!allowed.includes(req.method)) {
      res.setHeader('Allow', allowed.join(', '));
      throw new HttpError(405, '请求方法不支持');
    }
    rateLimit(req, res);
    if (path === '/api/widgets') {
      validateQuery(url, []);
      json(res, 200, { schemaVersion: 1, widgets: widgetDefinitions });
    } else if (path === '/api/widgets/state') {
      validateQuery(url, []);
      const value = req.method === 'GET' ? store.read('widgets', defaultWidgetState)
        : store.patch('widgets', defaultWidgetState, await readBody(req, 512 * 1024), req.headers['if-match'], validateWidgetPatch, validateWidgetDocument);
      documentResponse(res, value);
    } else if (path === '/api/device/settings') {
      validateQuery(url, []);
      const key = deviceKey(req, res);
      const value = req.method === 'GET' ? store.read(key, defaultDeviceSettings)
        : store.patch(key, defaultDeviceSettings, await readBody(req, 16 * 1024), req.headers['if-match'], validateSettingsPatch);
      documentResponse(res, value);
    } else if (path === '/api/timezones') {
      validateQuery(url, []);
      json(res, 200, { timeZones: ['UTC', ...Intl.supportedValuesOf('timeZone')] });
    } else if (path === '/api/time') {
      validateQuery(url, ['browserTimeZone']);
      const browserTimeZone = url.searchParams.get('browserTimeZone') ?? undefined;
      if (browserTimeZone !== undefined) timeZone(browserTimeZone);
      const value = settings(req, res);
      json(res, 200, clockSnapshot(value.clock, { browserTimeZone,
        locationTimeZone: value.location.mode === 'manual' ? value.location.manual.timeZone : undefined,
        now: environment.now() }));
    } else if (path === '/api/location/search') {
      validateQuery(url, ['q']);
      json(res, 200, await environment.searchLocations(url.searchParams.get('q')));
    } else if (path === '/api/environment/resolve') {
      validateQuery(url, []);
      const input = validateEnvironmentInput(await readBody(req, 4096));
      json(res, 200, await environment.resolveEnvironment(settings(req, res), input, req.socket.remoteAddress));
    } else if (path === '/api/weather') {
      validateQuery(url, ['latitude', 'longitude', 'timeZone', 'temperatureUnit']);
      json(res, 200, await environment.weather({ latitude: numberParam(url, 'latitude'), longitude: numberParam(url, 'longitude'),
        timeZone: url.searchParams.get('timeZone') ?? 'UTC', temperatureUnit: url.searchParams.get('temperatureUnit') ?? 'celsius' }));
    }
    return true;
  };
}
