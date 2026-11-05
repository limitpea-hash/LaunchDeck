import { check, string, coordinates, timeZone } from './schema.js';

const CONDITIONS = { 0: '晴朗', 1: '大部晴朗', 2: '多云', 3: '阴', 45: '雾', 48: '冻雾', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪', 95: '雷暴', 96: '雷暴伴冰雹', 99: '雷暴伴强冰雹' };

export function providerLocation(value) {
  coordinates({ latitude: value.latitude, longitude: value.longitude });
  string(value.name, 120, '地点名称');
  timeZone(value.timeZone);
  return value;
}

export function normalizeCities(raw) {
  check(raw && (raw.results === undefined || Array.isArray(raw.results)), '地点服务响应不正确');
  return { locations: (raw.results || []).slice(0, 8).map(item => providerLocation({
    id: String(item.id), name: item.name, latitude: item.latitude, longitude: item.longitude,
    timeZone: item.timezone, country: String(item.country || '').slice(0, 120), region: String(item.admin1 || '').slice(0, 120),
  })), provider: 'Open-Meteo / GeoNames' };
}

export function weatherRequest({ latitude, longitude, timeZone: zone = 'UTC', temperatureUnit = 'celsius' }) {
  coordinates({ latitude, longitude });
  timeZone(zone);
  check(['celsius', 'fahrenheit'].includes(temperatureUnit), '温度单位不正确');
  const point = { latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)), timeZone: zone, temperatureUnit };
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude), timezone: zone,
    temperature_unit: temperatureUnit, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min', forecast_days: '1', timeformat: 'unixtime' });
  return { url, point };
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
    fetchedAt: new Date(now).toISOString() };
}
