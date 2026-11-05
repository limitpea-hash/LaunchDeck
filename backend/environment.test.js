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
    return Response.json({ city: '示例城市', latitude: 31.23, longitude: 121.47, timezone: 'Asia/Shanghai' });
  } });
  const settings = defaultDeviceSettings();
  const publicClient = await service.resolveEnvironment(settings, {}, '::ffff:8.8.8.8');
  assert.equal(publicClient.location.source, 'ip');
  assert.equal(urls[0], 'https://ipapi.co/8.8.8.8/json/');
  await service.resolveEnvironment(settings, {}, 'http://169.254.169.254/');
  assert.equal(urls[1], 'https://ipapi.co/json/');
});
