import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentService } from './features/environment.js';
import { defaultDeviceSettings } from './features/settings.js';

const NOW = Date.parse('2026-11-04T09:00:00.000Z');
const point = { latitude: 31.23, longitude: 121.47, timeZone: 'Asia/Shanghai' };
const forecast = {
  timezone: 'Asia/Shanghai',
  current: { time: NOW / 1000, temperature_2m: 20, apparent_temperature: 19, relative_humidity_2m: 55, is_day: 1, weather_code: 2, wind_speed_10m: 10 },
  daily: { temperature_2m_max: [23], temperature_2m_min: [15] },
};

test('weather cache coalesces concurrent requests, labels stale data and refuses expired fallback', async () => {
  let now = NOW;
  let calls = 0;
  let release;
  const service = createEnvironmentService({ now: () => now, fetchImpl: async () => {
    calls += 1;
    if (calls > 1) throw new Error('offline');
    return new Promise(resolve => { release = () => resolve(Response.json(forecast)); });
  } });
  const concurrent = Array.from({ length: 4 }, () => service.weather(point));
  assert.equal(calls, 1);
  release();
  const results = await Promise.all(concurrent);
  assert.ok(results.every(result => result.cache.stale === false));
  assert.deepEqual(results[0].hourly, []);
  now += 600001;
  const stale = await service.weather(point);
  assert.equal(calls, 2);
  assert.equal(stale.cache.stale, true);
  assert.equal(stale.fetchedAt, new Date(NOW).toISOString());
  assert.equal((await service.weather(point)).cache.stale, true);
  assert.equal(calls, 2);
  now += 3600001;
  await assert.rejects(service.weather(point), error => error.status === 503);
});

test('hourly forecast crosses local midnight and keeps only valid upcoming points in order', async () => {
  const now = Date.parse('2026-11-04T15:40:00.000Z');
  const hour = index => Date.UTC(2026, 10, 4, index) / 1000;
  const service = createEnvironmentService({ now: () => now, fetchImpl: async url => {
    assert.equal(url.searchParams.get('forecast_days'), '2');
    assert.equal(url.searchParams.get('temperature_unit'), 'fahrenheit');
    assert.deepEqual(url.searchParams.get('hourly').split(','),
      ['temperature_2m', 'weather_code', 'is_day', 'precipitation_probability']);
    return Response.json({
      ...forecast,
      current: { ...forecast.current, time: now / 1000 },
      hourly: {
        time: [15, 18, 16, 17, 16, 19, 20, 21, 22].map(hour),
        temperature_2m: [70, 62, null, 65, 66, 61, 59, 57, 55],
        weather_code: [2, 61, 0, 2, 0, 3, 45, 0, 0],
        is_day: [0, 0, 0, null, 0, 0, 0, 0, 0],
        precipitation_probability: [0, 80, 13, 13, 0, 101, null, 10, 0],
      },
    });
  } });
  const result = await service.weather({ ...point, temperatureUnit: 'fahrenheit' });
  assert.equal(result.temperatureUnit, 'fahrenheit');
  assert.deepEqual(result.hourly.map(({ forecastAt }) => Date.parse(forecastAt) / 1000), [16, 18, 19, 20, 21, 22].map(hour));
  assert.deepEqual(result.hourly[0], {
    forecastAt: '2026-11-04T16:00:00.000Z', temperature: 66, weatherCode: 0,
    condition: '晴朗', isDay: false, precipitationProbability: 0,
  });
  assert.equal(result.hourly[1].condition, '小雨');
  assert.equal(result.hourly[1].precipitationProbability, 80);
  assert.equal(Object.hasOwn(result.hourly[2], 'precipitationProbability'), false);
});

test('hourly forecast returns 16 future slots even near local midnight', async () => {
  const now = Date.parse('2026-11-04T15:55:00.000Z');
  const nextHour = Math.floor(now / 3600000) + 1;
  const time = Array.from({ length: 18 }, (_, index) => (nextHour + index - 1) * 3600);
  const service = createEnvironmentService({ now: () => now, fetchImpl: async () => Response.json({
    ...forecast,
    current: { ...forecast.current, time: now / 1000 },
    hourly: {
      time, temperature_2m: time.map((_, index) => 20 - index), weather_code: time.map(() => 2),
      is_day: time.map((_, index) => index >= 7 ? 1 : 0),
    },
  }) });
  const result = await service.weather(point);
  assert.equal(result.hourly.length, 16);
  assert.deepEqual(result.hourly.map(({ forecastAt }) => Date.parse(forecastAt) / 1000), time.slice(1, 17));
});

test('malformed, oversized, redirected and failed upstream responses are rejected', async () => {
  const responses = [
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('ok', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' } }),
    () => new Response(' '.repeat(256 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('', { status: 302, headers: { Location: 'http://169.254.169.254/', 'Content-Type': 'application/json' } }),
    () => Response.json({ timezone: 'Asia/Shanghai', current: {} }),
    () => { throw new DOMException('Timed out', 'TimeoutError'); },
  ];
  for (const response of responses) {
    const service = createEnvironmentService({ fetchImpl: async (url, options) => {
      assert.equal(url.protocol, 'https:');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return response();
    } });
    await assert.rejects(service.weather(point), error => error.status === 503);
  }
});

test('browser-only location does not secretly fall back to IP when permission is missing', async () => {
  let calls = 0;
  const service = createEnvironmentService({ fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); }, now: () => NOW });
  const settings = defaultDeviceSettings();
  settings.location.mode = 'browser';
  const resolved = await service.resolveEnvironment(settings, { browserTimeZone: 'Europe/London' }, '8.8.8.8');
  assert.equal(calls, 0);
  assert.equal(resolved.location, null);
  assert.equal(resolved.warnings[0].code, 'LOCATION_REQUIRED');
  assert.equal(resolved.clock.timeZone, 'Europe/London');
});

test('public client IP selection cannot inject an arbitrary external endpoint', async () => {
  const urls = [];
  const service = createEnvironmentService({ fetchImpl: async url => {
    urls.push(url.href);
    return Response.json({ region: '中国 上海', latitude: 31.23, longitude: 121.47 });
  } });
  const settings = defaultDeviceSettings();
  const publicClient = await service.resolveEnvironment(settings, {}, '::ffff:8.8.8.8');
  assert.equal(publicClient.location.source, 'ip');
  assert.equal(publicClient.location.timeZone, 'Asia/Shanghai');
  assert.equal(urls[0], 'https://uapis.cn/api/v1/network/ipinfo?ip=8.8.8.8');
  await service.resolveEnvironment(settings, {}, 'http://169.254.169.254/');
  assert.equal(urls[1], 'https://uapis.cn/api/v1/network/myip');
});

test('city search accepts the municipal suffix and keeps valid results when a provider row is incomplete', async () => {
  const valid = { adcode: '510100', name: '成都市', province: '四川省', level: 'city', country_code: 'CN', center: { lat: 30.67, lng: 104.06 } };
  const service = createEnvironmentService({ fetchImpl: async url => {
    assert.equal(url.hostname, 'uapis.cn');
    assert.equal(url.searchParams.get('keywords'), '成都');
    return Response.json({ results: [{ ...valid, center: null }, valid] });
  } });
  const { locations } = await service.searchLocations(' 成都市 ');
  assert.deepEqual(locations.map(({ name, timeZone }) => ({ name, timeZone })), [{ name: '成都市', timeZone: 'Asia/Shanghai' }]);
});

test('mainland city and province searches use district codes, remove duplicates and reject an inconsistent province', async () => {
  const meizhou = { adcode: '441400', name: '梅州市', province: '广东省', level: 'city', country_code: 'CN', center: { lat: 24.28, lng: 116.12 } };
  const jieyang = { ...meizhou, adcode: '445200', name: '揭阳市', center: { lat: 23.55, lng: 116.38 } };
  const wrong = { ...meizhou, adcode: '500100', name: '广东', province: '广东省' };
  const service = createEnvironmentService({ fetchImpl: async url => {
    assert.equal(url.hostname, 'uapis.cn');
    const keyword = url.searchParams.get('keywords');
    if (keyword === '揭阳') return Response.json({ total: 1, results: [jieyang] });
    if (keyword === '梅州') return Response.json({ total: 3, results: [meizhou, meizhou, { ...meizhou, level: 'street' }] });
    assert.equal(url.searchParams.get('adcode'), '440000');
    assert.equal(url.searchParams.get('limit'), '100');
    return Response.json({ total: 3, results: [meizhou, jieyang, wrong] });
  } });
  assert.deepEqual((await service.searchLocations('揭阳')).locations.map(city => city.id), ['445200']);
  assert.deepEqual((await service.searchLocations('梅州')).locations.map(city => [city.name, city.region]), [['梅州市', '广东省']]);
  assert.deepEqual((await service.searchLocations('广东')).locations.map(city => city.id), ['441400', '445200']);
});

test('international searches still work with an English name or a translated name', async () => {
  const service = createEnvironmentService({ fetchImpl: async url => {
    if (url.hostname === 'uapis.cn') return Response.json({ total: 0, results: null });
    return Response.json({ results: [{ id: 1, name: '伦敦', latitude: 51.5, longitude: -0.12,
      timezone: 'Europe/London', country_code: 'GB', country: '英国' }] });
  } });
  for (const query of ['London', '伦敦']) {
    assert.equal((await service.searchLocations(query)).locations[0].timeZone, 'Europe/London');
  }
});
