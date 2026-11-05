import { check, record, string, integer, timeZone, coordinates } from './schema.js';

export function defaultDeviceSettings() {
  return {
    location: { mode: 'auto', manual: null },
    clock: { mode: 'automatic', timeZoneMode: 'browser', timeZone: 'Asia/Shanghai', offsetSeconds: 0 },
    weather: { temperatureUnit: 'celsius' },
  };
}

export function validateSettingsPatch(patch) {
  record(patch, ['location', 'clock', 'weather'], '设备设置');
  check(Object.keys(patch).length > 0, '至少提交一个设置字段');
  if ('location' in patch) {
    const location = record(patch.location, ['mode', 'manual'], '位置设置');
    check(['auto', 'browser', 'ip', 'manual'].includes(location.mode), '位置模式不正确');
    check(location.manual === null || typeof location.manual === 'object', 'manual 必须为地点对象或 null');
    if (location.manual !== null) {
      coordinates(location.manual, ['name', 'timeZone']);
      string(location.manual.name, 120, '地点名称');
      timeZone(location.manual.timeZone);
    }
    if (location.mode === 'manual') check(location.manual !== null, '手动模式必须设置地点');
  }
  if ('clock' in patch) {
    const clock = record(patch.clock, ['mode', 'timeZoneMode', 'timeZone', 'offsetSeconds'], '时钟设置');
    check(['automatic', 'manual'].includes(clock.mode), '时钟模式不正确');
    check(['browser', 'location', 'manual'].includes(clock.timeZoneMode), '时区模式不正确');
    timeZone(clock.timeZone);
    integer(clock.offsetSeconds, -315576000, 315576000, '校时时间差（秒）');
  }
  if ('weather' in patch) {
    record(patch.weather, ['temperatureUnit'], '天气设置');
    check(['celsius', 'fahrenheit'].includes(patch.weather.temperatureUnit), '温度单位不正确');
  }
}

export function validateEnvironmentInput(input) {
  record(input, ['browserTimeZone', 'coordinates'], '环境请求');
  if (input.browserTimeZone !== undefined) timeZone(input.browserTimeZone);
  if (input.coordinates !== undefined) coordinates(input.coordinates);
  return input;
}

export function clockSnapshot(clock, { browserTimeZone, locationTimeZone, now = Date.now() } = {}) {
  let zone;
  let source;
  if (clock.timeZoneMode === 'manual') { zone = clock.timeZone; source = 'manual'; }
  else if (clock.timeZoneMode === 'location' && locationTimeZone) { zone = locationTimeZone; source = 'location'; }
  else if (browserTimeZone) { zone = browserTimeZone; source = 'browser'; }
  else if (locationTimeZone) { zone = locationTimeZone; source = 'location'; }
  else { zone = 'UTC'; source = 'utc-fallback'; }
  const offsetSeconds = clock.mode === 'manual' ? clock.offsetSeconds : 0;
  return {
    serverEpochMs: now, serverTime: new Date(now).toISOString(),
    displayEpochMs: now + offsetSeconds * 1000,
    timeZone: zone, timeZoneSource: source, mode: clock.mode, offsetSeconds,
  };
}
