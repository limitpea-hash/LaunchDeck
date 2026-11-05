import { isIP } from 'node:net';
import { HttpError } from '../validation.js';
import { check, string } from './schema.js';
import { clockSnapshot, validateEnvironmentInput } from './settings.js';
import { providerLocation, normalizeCities, weatherRequest, normalizeWeather } from './provider-data.js';

const UPSTREAM_HOSTS = new Set(['api.open-meteo.com', 'geocoding-api.open-meteo.com', 'ipapi.co']);
const MAX_RESPONSE_BYTES = 256 * 1024;

function publicPeer(address = '') {
  const ip = address.replace(/^::ffff:/, '');
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)) return null;
    return ip;
  }
  // Restrict IPv6 lookups to global unicast, excluding documentation addresses.
  if (isIP(ip) === 6 && /^[23]/i.test(ip) && !/^2001:db8:/i.test(ip)) return ip;
  return null;
}

export function createEnvironmentService({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let active = 0;
  let budgetStart = now();
  let budgetUsed = 0;

  async function fetchJson(url) {
    if (url.protocol !== 'https:' || !UPSTREAM_HOSTS.has(url.hostname) || url.port || url.username || url.password) throw new HttpError(400, '外部数据源不在允许列表中');
    if (now() - budgetStart >= 60000) { budgetStart = now(); budgetUsed = 0; }
    if (active >= 4 || budgetUsed >= 60) throw new HttpError(429, '外部数据请求过于频繁，请稍后重试');
    active += 1;
    budgetUsed += 1;
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(5000), redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/json', 'User-Agent': 'AGY-Navigation/1.0' },
      });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('upstream response rejected');
      if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new Error('upstream response too large'); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('missing upstream body');
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('upstream response too large'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(503, '外部位置或天气服务暂时不可用，请稍后重试或手动设置地点');
    } finally { active -= 1; }
  }

  async function cached(key, ttl, load, staleWindow = 0) {
    const previous = cache.get(key);
    if (previous && previous.expires > now()) {
      if (previous.error) throw previous.error;
      return { ...structuredClone(previous.value), cache: { hit: true, stale: Boolean(previous.stale) } };
    }
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = (async () => {
      try {
        const value = await load();
        const entry = { value, expires: now() + ttl, fetchedAt: now(), stale: false };
        cache.delete(key);
        cache.set(key, entry);
        return { ...structuredClone(value), cache: { hit: false, stale: false } };
      } catch (error) {
        if (previous?.value && now() - previous.fetchedAt <= staleWindow) {
          cache.set(key, { ...previous, expires: now() + 30000, stale: true });
          return { ...structuredClone(previous.value), cache: { hit: true, stale: true } };
        }
        const safeError = error.status === 429 ? error : new HttpError(503, '外部位置或天气服务暂时不可用，请稍后重试或手动设置地点');
        cache.set(key, { error: safeError, expires: now() + 30000 });
        throw safeError;
      } finally {
        inFlight.delete(key);
        while (cache.size > 128) cache.delete(cache.keys().next().value);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  }

  async function searchLocations(query) {
    string(query, 100, '城市关键词');
    check(query.trim().length >= 2, '城市关键词至少需要两个字符');
    const term = query.trim();
    return cached(`search:${term}`, 3600000, async () => {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({ name: term, count: '8', language: 'zh', format: 'json' });
      const raw = await fetchJson(url);
      return normalizeCities(raw);
    });
  }

  async function locateIp(remoteAddress) {
    const peer = publicPeer(remoteAddress);
    return cached(`ip:${peer || 'network-egress'}`, 3600000, async () => {
      const url = new URL(peer ? `https://ipapi.co/${encodeURIComponent(peer)}/json/` : 'https://ipapi.co/json/');
      const raw = await fetchJson(url);
      check(!raw.error, 'IP 定位服务响应不正确');
      const location = providerLocation({ name: raw.city || raw.region || raw.country_name,
        latitude: raw.latitude, longitude: raw.longitude, timeZone: raw.timezone,
        source: peer ? 'ip' : 'network-ip', approximate: true });
      return { location, provider: 'ipapi.co', fetchedAt: new Date(now()).toISOString() };
    });
  }

  async function resolveEnvironment(settings, input, remoteAddress) {
    validateEnvironmentInput(input);
    let location = null;
    const warnings = [];
    if (settings.location.mode === 'manual') location = { ...settings.location.manual, source: 'manual', approximate: false };
    else if (['auto', 'browser'].includes(settings.location.mode) && input.coordinates) {
      location = { ...input.coordinates, name: '浏览器位置', timeZone: input.browserTimeZone || 'UTC',
        source: 'browser', approximate: false, timeZoneSource: input.browserTimeZone ? 'browser' : 'utc-fallback' };
    } else if (settings.location.mode === 'browser') warnings.push({ code: 'LOCATION_REQUIRED', message: '请授权浏览器定位，或改用手动城市/IP 定位' });
    else {
      try { location = (await locateIp(remoteAddress)).location; }
      catch { warnings.push({ code: 'LOCATION_UNAVAILABLE', message: '暂时无法获取近似位置，请手动选择城市' }); }
    }
    return { location, clock: clockSnapshot(settings.clock, { browserTimeZone: input.browserTimeZone, locationTimeZone: location?.timeZone, now: now() }), warnings };
  }

  async function weather(input) {
    const { url, point } = weatherRequest(input);
    return cached(`weather:${url.href}`, 600000, async () => normalizeWeather(await fetchJson(url), point, now()), 3600000);
  }

  return { searchLocations, resolveEnvironment, weather, now };
}
