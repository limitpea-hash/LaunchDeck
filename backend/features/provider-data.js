import { check, string, coordinates, timeZone } from './schema.js';

const CONDITIONS = { 0: '晴朗', 1: '大部晴朗', 2: '多云', 3: '阴', 45: '雾', 48: '冻雾', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪', 95: '雷暴', 96: '雷暴伴冰雹', 99: '雷暴伴强冰雹' };

export const UAPI_HOST = 'uapis.cn';
export const GEOCODING_HOST = 'geocoding-api.open-meteo.com';

const MAINLAND_PROVINCES = Object.freeze({
  11: '北京市', 12: '天津市', 13: '河北省', 14: '山西省', 15: '内蒙古自治区',
  21: '辽宁省', 22: '吉林省', 23: '黑龙江省', 31: '上海市', 32: '江苏省',
  33: '浙江省', 34: '安徽省', 35: '福建省', 36: '江西省', 37: '山东省',
  41: '河南省', 42: '湖北省', 43: '湖南省', 44: '广东省', 45: '广西壮族自治区',
  46: '海南省', 50: '重庆市', 51: '四川省', 52: '贵州省', 53: '云南省',
  54: '西藏自治区', 61: '陕西省', 62: '甘肃省', 63: '青海省', 64: '宁夏回族自治区',
  65: '新疆维吾尔自治区',
});
const MUNICIPALITIES = new Set(['11', '12', '31', '50']);
const PROVINCE_CODES = new Map(Object.entries(MAINLAND_PROVINCES).flatMap(([code, name]) => [
  [name, code], [name.replace(/(?:省|市|(?:壮族|回族|维吾尔)?自治区)$/, ''), code],
]));

function uapiRequest(path, params) {
  const url = new URL(path, `https://${UAPI_HOST}/`);
  url.search = new URLSearchParams(params);
  return url;
}

export function ipLocationRequest(peer = '') {
  return peer
    ? uapiRequest('/api/v1/network/ipinfo', { ip: peer })
    : uapiRequest('/api/v1/network/myip');
}

export function normalizeIpLocation(raw, source, browserTimeZone) {
  const region = string(raw?.region, 120, 'IP 地区').trim();
  const mainland = /^(?:中国(?:大陆)?|China)(?:\s|$)/i.test(region);
  const name = mainland ? region.split(/\s+/).slice(1).join(' · ') || region : region;
  const knownTimeZone = raw.time_zone || (mainland ? 'Asia/Shanghai' : null);
  return providerLocation({
    name, latitude: raw.latitude, longitude: raw.longitude,
    timeZone: knownTimeZone || browserTimeZone || 'UTC',
    timeZoneSource: knownTimeZone ? 'location' : browserTimeZone ? 'browser' : 'utc-fallback',
    source, approximate: true,
  });
}

export function providerLocation(value) {
  coordinates({ latitude: value.latitude, longitude: value.longitude });
  string(value.name, 120, '地点名称');
  timeZone(value.timeZone);
  return value;
}

export function normalizeCityQuery(query) {
  string(query, 100, '城市关键词');
  const term = query.trim();
  check(term.length >= 2, '城市关键词至少需要两个字符');
  return term;
}

export function normalizeCities(raw) {
  check(raw && (raw.results === undefined || Array.isArray(raw.results)), '地点服务响应不正确');
  const locations = [];
  const ids = new Set();
  for (const item of raw.results || []) {
    if (!Number.isSafeInteger(item?.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim()) continue;
    if (item.country_code === 'CN' && !/^PPL(?:C|A[2-5]?)$/.test(item.feature_code)) continue;
    try {
      locations.push(providerLocation({
        id: String(item.id), name: item.name, latitude: item.latitude, longitude: item.longitude,
        timeZone: item.timezone, country: String(item.country || '').slice(0, 120), region: String(item.admin1 || '').slice(0, 120),
      }));
      ids.add(item.id);
    } catch (error) {
      if (error.status !== 400) throw error;
    }
    if (locations.length === 8) break;
  }
  return { locations, provider: 'Open-Meteo / GeoNames' };
}

function normalizeMainlandCities(raw, provinceCode) {
  check(raw && (raw.results === null || Array.isArray(raw.results)), '行政区划服务响应不正确');
  const unique = new Map();
  for (const item of raw.results || []) {
    const code = item?.adcode;
    if (item?.country_code !== 'CN' || typeof code !== 'string' || !/^\d{6}$/.test(code) || unique.has(code)) continue;
    const prefix = code.slice(0, 2);
    const region = MAINLAND_PROVINCES[prefix];
    if (!region || PROVINCE_CODES.get(item.province) !== prefix) continue;
    const isMunicipality = MUNICIPALITIES.has(prefix) && code === `${prefix}0000` && item.level === 'province';
    if (provinceCode && (provinceCode !== prefix || (!isMunicipality && item.level !== 'city'))) continue;
    if (!isMunicipality && !['city', 'district'].includes(item.level)) continue;
    try {
      unique.set(code, providerLocation({
        id: code, name: isMunicipality ? region : item.name,
        latitude: item.center?.lat, longitude: item.center?.lng,
        timeZone: 'Asia/Shanghai', country: '中国', region,
      }));
    } catch (error) {
      if (error.status !== 400) throw error;
    }
  }
  return [...unique.values()];
}

export async function searchCityLocations(query, fetchJson) {
  const provinceCode = PROVINCE_CODES.get(query);
  if (provinceCode) {
    const raw = await fetchJson(uapiRequest('/api/v1/misc/district', { adcode: `${provinceCode}0000`, limit: '100' }));
    return { locations: normalizeMainlandCities(raw, provinceCode).slice(0, 40), provider: 'UAPI' };
  }
  const term = /^[\p{Script=Han}]{2,}市$/u.test(query) ? query.slice(0, -1) : query;
  if (/\p{Script=Han}/u.test(term)) {
    const raw = await fetchJson(uapiRequest('/api/v1/misc/district', { keywords: term, country: 'CN', limit: '24' }));
    const places = normalizeMainlandCities(raw);
    const exact = places.filter(place => place.name.replace(/市$/, '') === term);
    if (places.length) return { locations: (exact.length ? exact : places).slice(0, 8), provider: 'UAPI' };
  }
  const url = new URL(`https://${GEOCODING_HOST}/v1/search`);
  url.search = new URLSearchParams({ name: term, count: '8', language: 'zh', format: 'json' });
  return normalizeCities(await fetchJson(url));
}

export function weatherRequest({ latitude, longitude, timeZone: zone = 'UTC', temperatureUnit = 'celsius' }) {
  coordinates({ latitude, longitude });
  timeZone(zone);
  check(['celsius', 'fahrenheit'].includes(temperatureUnit), '温度单位不正确');
  const point = { latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)), timeZone: zone, temperatureUnit };
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude), timezone: zone,
    temperature_unit: temperatureUnit, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,is_day,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min', forecast_days: '2', timeformat: 'unixtime' });
  return { url, point };
}

const HOURLY_FORECAST_HOURS = 16;

function normalizeHourlyWeather(hourly, after) {
  const { time, temperature_2m: temperatures, weather_code: codes, is_day: daylight,
    precipitation_probability: probabilities } = hourly ?? {};
  if (![time, temperatures, codes, daylight].every(Array.isArray)) return [];

  const forecasts = new Map();
  const end = after + HOURLY_FORECAST_HOURS * 3600;
  for (const [index, stamp] of time.entries()) {
    const temperature = temperatures[index];
    const weatherCode = codes[index];
    const day = daylight[index];
    if (!Number.isSafeInteger(stamp) || stamp <= after || stamp > end || stamp > 4102444800 || forecasts.has(stamp)) continue;
    if (!Number.isFinite(temperature) || !Number.isInteger(weatherCode) || ![0, 1].includes(day)) continue;
    const forecast = {
      forecastAt: new Date(stamp * 1000).toISOString(), temperature, weatherCode,
      condition: CONDITIONS[weatherCode] || '天气状况未知', isDay: day === 1,
    };
    const chance = Array.isArray(probabilities) ? probabilities[index] : null;
    if (Number.isFinite(chance) && chance >= 0 && chance <= 100) forecast.precipitationProbability = chance;
    forecasts.set(stamp, forecast);
  }
  return [...forecasts.entries()].sort(([a], [b]) => a - b)
    .slice(0, HOURLY_FORECAST_HOURS).map(([, forecast]) => forecast);
}

export function normalizeWeather(raw, point, now) {
  const current = raw?.current;
  const daily = raw?.daily;
  const values = [current?.time, current?.temperature_2m, current?.apparent_temperature, current?.relative_humidity_2m,
    current?.weather_code, current?.wind_speed_10m, daily?.temperature_2m_max?.[0], daily?.temperature_2m_min?.[0]];
  check(values.every(value => typeof value === 'number' && Number.isFinite(value)), '天气服务响应不完整');
  check([0, 1].includes(current.is_day) && current.time >= 0 && current.time <= 4102444800, '天气时间格式不正确');
  timeZone(raw.timezone);
  return { provider: 'Open-Meteo', attributionUrl: 'https://open-meteo.com/', ...point, timeZone: raw.timezone,
    current: { observedAt: new Date(current.time * 1000).toISOString(), temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature, humidity: current.relative_humidity_2m,
      weatherCode: current.weather_code, condition: CONDITIONS[current.weather_code] || '天气状况未知',
      isDay: current.is_day === 1, windSpeedKmh: current.wind_speed_10m },
    daily: { maxTemperature: daily.temperature_2m_max[0], minTemperature: daily.temperature_2m_min[0] },
    hourly: normalizeHourlyWeather(raw.hourly, Math.max(current.time, now / 1000)),
    fetchedAt: new Date(now).toISOString() };
}
