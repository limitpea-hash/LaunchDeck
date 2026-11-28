import { HttpError } from '../validation.js';
import { EXCHANGE_RATE_ORIGIN, validateCurrencyPair } from './currencies.js';
import { dateOnly } from './schema.js';

const FRESH_FOR = 60 * 60 * 1000;
const STALE_FOR = 7 * 24 * FRESH_FOR;
const MAX_RESPONSE_BYTES = 4096;

async function readRate(response, pair) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Rate response has no body');
  try {
    if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      throw new Error('Unexpected rate response');
    }
    let size = 0;
    let text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Rate response too large');
      text += decoder.decode(value, { stream: true });
    }
    const { base, quote, rate, date } = JSON.parse(text + decoder.decode());
    if (base !== pair.base || quote !== pair.quote || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('Invalid rate');
    }
    dateOnly(date);
    return { ...pair, rate, date };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createExchangeRateService({ fetchImpl = globalThis.fetch, now = Date.now, authorize = () => {} } = {}) {
  const cached = new Map();
  const pending = new Map();
  let budgetStart = now();
  let budgetUsed = 0;

  function response(value, hit = false, stale = false) {
    return { ...value, cache: { hit, stale } };
  }

  function entryTime() {
    return new Date(now()).toISOString();
  }

  async function rate(input) {
    const pair = validateCurrencyPair(input);
    if (pair.base === pair.quote) return response({ ...pair, rate: 1, date: null, fetchedAt: entryTime() });
    const key = `${pair.base}/${pair.quote}`;
    const old = cached.get(key);
    const elapsed = now() - Date.parse(old?.fetchedAt);
    if (old && elapsed < FRESH_FOR) return response(old, true);
    if (pending.has(key)) return pending.get(key);
    if (now() - budgetStart >= 60000) { budgetStart = now(); budgetUsed = 0; }
    if (pending.size >= 4 || budgetUsed >= 30) {
      if (old && elapsed <= STALE_FOR) return response(old, true, true);
      throw new HttpError(429, '汇率查询过于频繁，请稍后重试');
    }
    budgetUsed++;
    const load = Promise.resolve().then(async () => {
      try {
        await authorize();
        const upstream = await fetchImpl(new URL(`/v2/rate/${key}`, EXCHANGE_RATE_ORIGIN), {
          credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
          signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' },
        });
        const value = { ...await readRate(upstream, pair), fetchedAt: entryTime() };
        cached.delete(key);
        cached.set(key, value);
        while (cached.size > 128) cached.delete(cached.keys().next().value);
        return response(value);
      } catch (error) {
        if (error.status === 403) throw error;
        if (old && now() - Date.parse(old.fetchedAt) <= STALE_FOR) return response(old, true, true);
        throw new HttpError(503, '汇率服务暂不可用，请稍后重试');
      } finally {
        pending.delete(key);
      }
    });
    pending.set(key, load);
    return load;
  }

  return { rate };
}
