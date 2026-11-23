import { HttpError } from '../../validation.js';
import { clockSnapshot } from '../../features/settings.js';
import { UAPI_HOST, GEOCODING_HOST, ipLocationRequest, normalizeIpLocation, normalizeCityQuery, searchCityLocations, weatherRequest, normalizeWeather } from '../../features/provider-data.js';

const WEATHER_ORIGIN = 'https://api.open-meteo.com/*';
const CITY_ORIGIN = `https://${GEOCODING_HOST}/*`;
const UAPI_ORIGIN = `https://${UAPI_HOST}/*`;
export const NETWORK_ORIGINS = [WEATHER_ORIGIN, CITY_ORIGIN, UAPI_ORIGIN];

export function createLocationPermissions(permissions) {
  return Object.freeze({
    requestCitySearch: () => permissions.request({ origins: [UAPI_ORIGIN, CITY_ORIGIN, WEATHER_ORIGIN] }),
    requestWeather: () => permissions.request({ origins: [WEATHER_ORIGIN] }),
  });
}

export function createBrowserEnvironment({ permissions, fetchImpl = globalThis.fetch, now = Date.now }) {
  const cache = new Map();
  const pending = new Map();
  let active = 0;
  let used = 0;
  let windowStart = now();

  async function fetchJson(url) {
    const origin = `${url.origin}/*`;
    if (url.protocol !== 'https:' || !NETWORK_ORIGINS.includes(origin) || url.username || url.password) throw new HttpError(400, '不允许的数据源');
    if (!await permissions.contains({ origins: [origin] })) throw new HttpError(403, '请先在设置中启用联网天气与城市搜索');
    if (now() - windowStart >= 60000) { used = 0; windowStart = now(); }
    if (active >= 4 || used >= 60) throw new HttpError(429, '天气查询过于频繁，请稍后重试');
    active += 1;
    used += 1;
    try {
      const response = await fetchImpl(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
        signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('invalid upstream');
      if (Number(response.headers.get('content-length')) > 262144) { await response.body?.cancel(); throw new Error('too large'); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('missing body');
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 262144) { await reader.cancel(); throw new Error('too large'); }
        text += decoder.decode(value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } catch { throw new HttpError(503, '天气或位置服务暂不可用，导航和便签仍可离线使用'); }
    finally { active -= 1; }
  }

  async function cached(key, ttl, load, allowStale = false) {
    const previous = cache.get(key);
    if (previous?.until > now()) return { ...structuredClone(previous.value), cache: { hit: true, stale: Boolean(previous.stale) } };
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => {
      try {
        const value = await load();
        cache.delete(key);
        cache.set(key, { value, until: now() + ttl, fetchedAt: now(), stale: false });
        return { ...value, cache: { hit: false, stale: false } };
      } catch (error) {
        if (allowStale && error.status !== 403 && previous && now() - previous.fetchedAt <= 3600000) {
          cache.set(key, { ...previous, until: now() + 30000, stale: true });
          return { ...structuredClone(previous.value), cache: { hit: true, stale: true } };
        }
        if ([403, 429].includes(error.status)) throw error;
        throw new HttpError(503, '天气或位置数据暂不可用，请稍后重试');
      } finally {
        pending.delete(key);
        while (cache.size > 64) cache.delete(cache.keys().next().value);
      }
    })();
    pending.set(key, promise);
    return promise;
  }

  async function search(term) {
    const query = normalizeCityQuery(term);
    return cached(`search:${query}`, 3600000, () => searchCityLocations(query, fetchJson));
  }

  async function resolve(settings, input) {
    let location = null;
    const warnings = [];
    if (settings.location.mode === 'manual') location = { ...settings.location.manual, source: 'manual', approximate: false };
    else if (['auto', 'browser'].includes(settings.location.mode) && input.coordinates) {
      location = { ...input.coordinates, name: '浏览器位置', timeZone: input.browserTimeZone || 'UTC', source: 'browser', approximate: false };
    } else if (settings.location.mode === 'browser') warnings.push({ code: 'LOCATION_REQUIRED', message: '请授权定位或手动选择城市' });
    else {
      try {
        const value = await cached(`ip:${input.browserTimeZone || ''}`, 3600000, async () => ({
          location: normalizeIpLocation(await fetchJson(ipLocationRequest()), 'ip', input.browserTimeZone),
        }));
        location = value.location;
      } catch (error) { warnings.push({ code: error.status === 403 ? 'NETWORK_PERMISSION_REQUIRED' : 'LOCATION_UNAVAILABLE', message: error.message }); }
    }
    return { location, clock: { ...clockSnapshot(settings.clock, { browserTimeZone: input.browserTimeZone, locationTimeZone: location?.timeZone, now: now() }), timeSource: 'device' }, warnings };
  }

  async function weather(input) {
    const { url, point } = weatherRequest(input);
    return cached(url.href, 600000, async () => normalizeWeather(await fetchJson(url), point, now()), true);
  }

  return { search, resolve, weather };
}
