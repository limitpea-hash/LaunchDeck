import { el, clearElement, setText } from '../lib/dom.js';
import { closeAllPopovers, registerPopover, unregisterPopover } from '../lib/ui/index.js';
import * as currencyPlatform from '../platform/features/currencies.js';

const CURRENCIES = currencyPlatform.CURRENCIES || Object.freeze({});
const FALLBACK_REGIONS = Object.freeze([
  Object.freeze({ id: 'asia', label: '亚洲' }),
  Object.freeze({ id: 'europe', label: '欧洲' }),
  Object.freeze({ id: 'americas', label: '美洲' }),
  Object.freeze({ id: 'oceania', label: '大洋洲' }),
  Object.freeze({ id: 'middle-east', label: '中东' }),
  Object.freeze({ id: 'africa', label: '非洲' }),
]);

/* =====================================================================
 * Shared exchange-rate helper (also used by imported-card currency template)
 * - Only currency codes are ever sent: GET /api/exchange-rate?base=..&quote=..
 *   (same call for HTTP and the extension message bridge).
 * - In-flight de-duplication per pair, short-lived memory cache, error cooldown.
 * - Offline fallback: last good rate per pair kept in localStorage up to 7 days.
 * - User amounts never leave the card and are never stored.
 * ===================================================================== */

export const DEFAULT_PAIR = Object.freeze({ base: 'CNY', quote: 'USD' });
const CODE_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRESH_MS = 10 * 60 * 1000;
const OFFLINE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const ERROR_COOLDOWN_MS = 20 * 1000;
const OUTDATED_DAYS = 4;
const STORE_KEY = 'launchdeck_fx_rates_v1';
const MAX_STORED = 80;
const MAX_AMOUNT = 1e12;

const memory = new Map(); // key -> entry
const inflight = new Map(); // key -> Promise<view>
const recentErrors = new Map(); // key -> { at, error }
const listeners = new Set();

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const pad = (n) => String(n).padStart(2, '0');

let cachedCatalog = null;
let cachedCatalogMap = null;
let cachedPopular = null;
let cachedRegions = null;

function buildNormalizedCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const rawRegions = Array.isArray(currencyPlatform.CURRENCY_REGIONS) && currencyPlatform.CURRENCY_REGIONS.length > 0
    ? currencyPlatform.CURRENCY_REGIONS
    : FALLBACK_REGIONS;
  cachedRegions = Object.freeze(rawRegions.map((r) => Object.freeze({
    id: String(r.id || ''),
    label: String(r.label || r.id || ''),
  })).filter((r) => r.id));

  const validRegionIds = new Set(cachedRegions.map((r) => r.id));
  const popularCodes = Array.isArray(currencyPlatform.POPULAR_CURRENCIES) && currencyPlatform.POPULAR_CURRENCIES.length > 0
    ? currencyPlatform.POPULAR_CURRENCIES.filter((c) => isSupportedCurrency(c))
    : currencyCodes().slice(0, 12);
  const popularSet = new Set(popularCodes);

  const rawCatalog = Array.isArray(currencyPlatform.CURRENCY_CATALOG) && currencyPlatform.CURRENCY_CATALOG.length > 0
    ? currencyPlatform.CURRENCY_CATALOG
    : currencyCodes().map((code) => ({
      code,
      name: String(CURRENCIES[code] || code),
      symbol: '',
      country: String(CURRENCIES[code] || code),
      countries: [String(CURRENCIES[code] || code)],
      aliases: [],
      region: 'asia',
      popular: popularSet.has(code),
    }));

  const normalized = [];
  const byCode = new Map();
  for (const raw of rawCatalog) {
    if (!raw || typeof raw !== 'object' || !isSupportedCurrency(raw.code) || byCode.has(raw.code)) continue;
    const name = String(raw.name || CURRENCIES[raw.code] || raw.code);
    const country = String(raw.country || name);
    const countries = Array.isArray(raw.countries) && raw.countries.length > 0
      ? raw.countries.map((c) => String(c).trim()).filter(Boolean)
      : [country];
    if (!countries.includes(country)) countries.unshift(country);
    const aliases = Array.isArray(raw.aliases)
      ? raw.aliases.map((a) => String(a).trim()).filter(Boolean)
      : [];
    const region = validRegionIds.has(raw.region) ? raw.region : cachedRegions[0]?.id || 'asia';
    const entry = Object.freeze({
      code: raw.code,
      name,
      symbol: typeof raw.symbol === 'string' ? raw.symbol : '',
      country,
      countries: Object.freeze(countries),
      aliases: Object.freeze(aliases),
      region,
      popular: popularSet.has(raw.code) || raw.popular === true,
    });
    normalized.push(entry);
    byCode.set(entry.code, entry);
  }
  cachedCatalog = Object.freeze(normalized);
  cachedCatalogMap = byCode;
  cachedPopular = Object.freeze(
    popularCodes.map((code) => byCode.get(code)).filter(Boolean)
  );
  return cachedCatalog;
}

export function currencyCodes() {
  const src = CURRENCIES && typeof CURRENCIES === 'object' ? CURRENCIES : {};
  return Object.keys(src).filter((c) => CODE_RE.test(c));
}

export function isSupportedCurrency(code) {
  return typeof code === 'string' && CODE_RE.test(code) && !!CURRENCIES && hasOwn(CURRENCIES, code);
}

export function currencyName(code) {
  return isSupportedCurrency(code) ? String(CURRENCIES[code]) : String(code || '');
}

export function getCurrencyRegions() {
  buildNormalizedCatalog();
  return cachedRegions;
}

export function getCurrencyCatalog() {
  return buildNormalizedCatalog();
}

export function getPopularCurrencies() {
  buildNormalizedCatalog();
  return cachedPopular;
}

export function getCurrencyMeta(code) {
  buildNormalizedCatalog();
  if (typeof code !== 'string') return null;
  return cachedCatalogMap.get(code) || null;
}

export function currencyCountry(code) {
  const meta = getCurrencyMeta(code);
  return meta ? meta.country : currencyName(code);
}

function scoreCurrencyMatch(entry, q) {
  const codeLower = entry.code.toLowerCase();
  const nameLower = entry.name.toLowerCase();
  const countryLower = entry.country.toLowerCase();

  if (codeLower === q) return { score: 120, matchedCountry: null };
  if (countryLower === q) return { score: 115, matchedCountry: entry.country };
  for (const c of entry.countries) {
    if (c.toLowerCase() === q) return { score: 110, matchedCountry: c };
  }
  if (nameLower === q) return { score: 105, matchedCountry: null };
  if (codeLower.startsWith(q)) return { score: 95, matchedCountry: null };
  if (countryLower.startsWith(q)) return { score: 90, matchedCountry: entry.country };
  for (const c of entry.countries) {
    if (c.toLowerCase().startsWith(q)) return { score: 88, matchedCountry: c };
  }
  if (countryLower.includes(q)) return { score: 82, matchedCountry: entry.country };
  for (const c of entry.countries) {
    if (c.toLowerCase().includes(q)) return { score: 80, matchedCountry: c };
  }
  if (nameLower.startsWith(q)) return { score: 78, matchedCountry: null };
  if (nameLower.includes(q)) return { score: 74, matchedCountry: null };

  let aliasScore = 0;
  for (const a of entry.aliases) {
    const al = a.toLowerCase();
    if (al === q) aliasScore = Math.max(aliasScore, 72);
    else if (al.startsWith(q)) aliasScore = Math.max(aliasScore, 66);
    else if (al.includes(q)) aliasScore = Math.max(aliasScore, 55);
  }
  if (aliasScore > 0) return { score: aliasScore, matchedCountry: null };
  if (entry.symbol && entry.symbol.toLowerCase() === q) return { score: 45, matchedCountry: null };
  return null;
}

/**
 * Search or filter the currency catalog by country/region name, currency name, aliases, or ISO code.
 * Non-empty queries always search across all regions so users never hit false empty states.
 */
export function searchCurrencyCatalog(query = '', { region = 'all' } = {}) {
  const catalog = buildNormalizedCatalog();
  const q = String(query || '').trim().toLowerCase();

  if (!q) {
    if (region === 'popular') {
      return getPopularCurrencies().map((entry) => ({ entry, matchedCountry: null, score: 100 }));
    }
    const list = region && region !== 'all'
      ? catalog.filter((entry) => entry.region === region)
      : catalog;
    return list.map((entry) => ({ entry, matchedCountry: null, score: entry.popular ? 10 : 0 }));
  }

  const hits = [];
  for (let idx = 0; idx < catalog.length; idx++) {
    const entry = catalog[idx];
    const match = scoreCurrencyMatch(entry, q);
    if (match) {
      hits.push({ entry, matchedCountry: match.matchedCountry, score: match.score, idx });
    }
  }
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.entry.popular !== b.entry.popular) return a.entry.popular ? -1 : 1;
    return a.idx - b.idx;
  });
  return hits.map(({ entry, matchedCountry, score }) => ({ entry, matchedCountry, score }));
}

export function normalizePair(raw) {
  const codes = currencyCodes();
  const fallbackBase = isSupportedCurrency(DEFAULT_PAIR.base) ? DEFAULT_PAIR.base : codes[0] || DEFAULT_PAIR.base;
  const fallbackQuote = isSupportedCurrency(DEFAULT_PAIR.quote) ? DEFAULT_PAIR.quote : codes[1] || codes[0] || DEFAULT_PAIR.quote;
  return {
    base: isSupportedCurrency(raw?.base) ? raw.base : fallbackBase,
    quote: isSupportedCurrency(raw?.quote) ? raw.quote : fallbackQuote,
  };
}

const pairKey = (base, quote) => `${base}:${quote}`;

function fxError(code, message, status = 0) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function getStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readStore() {
  const ls = getStorage();
  if (!ls) return {};
  try {
    const parsed = JSON.parse(ls.getItem(STORE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeEntry(raw, base, quote) {
  if (!raw || typeof raw !== 'object') return null;
  const rate = Number(raw.rate);
  const receivedAt = Number(raw.receivedAt);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(receivedAt)) return null;
  return {
    base,
    quote,
    rate,
    date: typeof raw.date === 'string' && DATE_RE.test(raw.date) ? raw.date : null,
    fetchedAt: typeof raw.fetchedAt === 'string' && Number.isFinite(Date.parse(raw.fetchedAt)) ? raw.fetchedAt : null,
    receivedAt,
    serverStale: raw.serverStale === true,
  };
}

function readStored(base, quote) {
  const entry = sanitizeEntry(readStore()[pairKey(base, quote)], base, quote);
  if (!entry) return null;
  const age = Date.now() - entry.receivedAt;
  return age >= 0 && age <= OFFLINE_MAX_MS ? entry : null;
}

function writeStored(entry) {
  const ls = getStorage();
  if (!ls) return;
  try {
    const store = readStore();
    store[pairKey(entry.base, entry.quote)] = {
      rate: entry.rate,
      date: entry.date,
      fetchedAt: entry.fetchedAt,
      receivedAt: entry.receivedAt,
      serverStale: entry.serverStale,
    };
    const now = Date.now();
    const kept = Object.entries(store)
      .filter(([k, v]) => /^[A-Z]{3}:[A-Z]{3}$/.test(k) && Number.isFinite(Number(v?.receivedAt)) && now - Number(v.receivedAt) <= OFFLINE_MAX_MS)
      .sort((a, b) => Number(b[1].receivedAt) - Number(a[1].receivedAt))
      .slice(0, MAX_STORED);
    ls.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // storage full or unavailable: memory cache still works
  }
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isRateDateOutdated(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  const now = Date.parse(`${todayIso()}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return false;
  return (now - t) / 86400000 > OUTDATED_DAYS;
}

function toView(entry, source, extra = {}) {
  const offline = source === 'offline';
  return {
    base: entry.base,
    quote: entry.quote,
    rate: entry.rate,
    date: entry.date,
    fetchedAt: entry.fetchedAt,
    receivedAt: entry.receivedAt,
    source, // network | memory | offline | identity
    offline,
    serverStale: entry.serverStale === true,
    outdated: isRateDateOutdated(entry.date),
    stale: offline || entry.serverStale === true || isRateDateOutdated(entry.date),
    error: null,
    ...extra,
  };
}

function identityView(code) {
  return toView({ base: code, quote: code, rate: 1, date: null, fetchedAt: null, receivedAt: Date.now(), serverStale: false }, 'identity');
}

function emit(evt) {
  for (const fn of Array.from(listeners)) {
    try {
      fn(evt);
    } catch {
      // isolate listener failures
    }
  }
}

/** Subscribe to shared rate updates. Returns an unsubscribe function. */
export function subscribeExchangeRates(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Synchronous best cached view (memory, then stored ≤7 days). Never touches the network. */
export function peekExchangeRate(base, quote) {
  if (!isSupportedCurrency(base) || !isSupportedCurrency(quote)) return null;
  if (base === quote) return identityView(base);
  const mem = memory.get(pairKey(base, quote));
  if (mem) {
    const fresh = Date.now() - mem.receivedAt < FRESH_MS;
    return toView(mem, fresh ? 'memory' : 'offline');
  }
  const stored = readStored(base, quote);
  return stored ? toView(stored, 'offline') : null;
}

function parseResponse(body, base, quote) {
  if (!body || typeof body !== 'object') throw fxError('invalid', '汇率服务返回了无法识别的数据');
  if (body.base !== base || body.quote !== quote) throw fxError('invalid', '汇率服务返回的币对不匹配');
  const rate = Number(body.rate);
  if (typeof body.rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw fxError('invalid', '汇率服务返回的汇率无效');
  const fetchedMs = typeof body.fetchedAt === 'string' ? Date.parse(body.fetchedAt) : NaN;
  const hasFetchedAt = Number.isFinite(fetchedMs);
  const now = Date.now();
  return {
    base,
    quote,
    rate,
    date: typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : null,
    fetchedAt: hasFetchedAt ? body.fetchedAt : null,
    // Age the cache from the upstream fetch time so server-cached replies don't extend offline expiry.
    receivedAt: hasFetchedAt ? Math.min(now, fetchedMs) : now,
    serverStale: body.cache?.stale === true,
  };
}

function fallbackOrThrow(base, quote, error) {
  const key = pairKey(base, quote);
  const cached = memory.get(key) || readStored(base, quote);
  if (cached && Date.now() - cached.receivedAt <= OFFLINE_MAX_MS) {
    return Promise.resolve(toView(cached, 'offline', { error }));
  }
  return Promise.reject(error);
}

async function fetchRate(base, quote) {
  const url = `/api/exchange-rate?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(quote)}`;
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw fxError('network', '网络不可用，无法获取汇率');
  }
  if (res.status === 403) throw fxError('permission', '需要授权访问汇率服务', 403);
  if (!res.ok) {
    throw fxError(res.status >= 500 ? 'upstream' : 'http', res.status >= 500 ? '汇率服务暂不可用' : `汇率请求失败（${res.status}）`, res.status);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw fxError('invalid', '汇率服务返回了无法识别的数据', res.status);
  }
  return parseResponse(body, base, quote);
}

/**
 * Resolve a rate view for a pair. Resolves with cached data (view.error set) when the
 * network fails but a ≤7-day cached rate exists; rejects only when nothing usable exists.
 */
export function getExchangeRate(base, quote, { force = false } = {}) {
  if (!isSupportedCurrency(base) || !isSupportedCurrency(quote)) {
    return Promise.reject(fxError('unsupported', '不支持的币种'));
  }
  if (base === quote) return Promise.resolve(identityView(base));
  const key = pairKey(base, quote);
  const now = Date.now();
  const mem = memory.get(key);
  if (!force && mem && now - mem.receivedAt < FRESH_MS) return Promise.resolve(toView(mem, 'memory'));
  if (inflight.has(key)) return inflight.get(key);
  if (!force) {
    const recent = recentErrors.get(key);
    if (recent && now - recent.at < ERROR_COOLDOWN_MS) return fallbackOrThrow(base, quote, recent.error);
  }
  const p = fetchRate(base, quote).then(
    (entry) => {
      memory.set(key, entry);
      recentErrors.delete(key);
      writeStored(entry);
      const view = toView(entry, 'network');
      emit({ key, view });
      return view;
    },
    (error) => {
      recentErrors.set(key, { at: Date.now(), error });
      return fallbackOrThrow(base, quote, error);
    }
  );
  const tracked = p.finally(() => {
    if (inflight.get(key) === tracked) inflight.delete(key);
  });
  inflight.set(key, tracked);
  return tracked;
}

export function canRequestCurrencyPermission() {
  try {
    return typeof globalThis.window?.LaunchDeckUpdate?.requestCurrencyPermission === 'function';
  } catch {
    return false;
  }
}

/**
 * MUST be called synchronously from a user click handler (permission prompt needs a gesture).
 * Resolves true when granted; on grant, all subscribed cards are told to refetch.
 */
export function requestCurrencyPermission() {
  let api = null;
  try {
    api = globalThis.window?.LaunchDeckUpdate || null;
  } catch {
    api = null;
  }
  if (!api || typeof api.requestCurrencyPermission !== 'function') return Promise.resolve(false);
  let result;
  try {
    result = api.requestCurrencyPermission();
  } catch {
    return Promise.resolve(false);
  }
  return Promise.resolve(result).then(
    (v) => {
      const granted = v === true || (v && typeof v === 'object' && v.granted === true);
      if (granted) {
        recentErrors.clear();
        emit({ all: true, force: true });
      }
      return granted;
    },
    () => false
  );
}

/* ---------------- formatting & parsing ---------------- */

function fmt(value, opts) {
  try {
    return new Intl.NumberFormat('zh-CN', { useGrouping: true, ...opts }).format(value);
  } catch {
    return String(value);
  }
}

/** Rate with significant digits for tiny values (e.g. KRW→USD 0.0006893). */
export function formatRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return fmt(n, { maximumFractionDigits: 2 });
  if (n >= 1) return fmt(n, { maximumFractionDigits: 4 });
  return fmt(n, { maximumSignificantDigits: 4 });
}

/** Converted amount; small results keep significant digits instead of rounding to 0.00. */
export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1) return fmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return fmt(n, { maximumSignificantDigits: 4 });
}

export function parseAmount(raw) {
  const s = String(raw ?? '').trim().replace(/[,，\s_]/g, '').replace(/[。．]/g, '.');
  if (!s) return { ok: false, reason: 'empty' };
  if (!/^(\d{1,15}(\.\d{0,10})?|\.\d{1,10})$/.test(s)) return { ok: false, reason: 'invalid' };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, reason: 'invalid' };
  if (n > MAX_AMOUNT) return { ok: false, reason: 'too-large' };
  return { ok: true, value: n };
}

export function amountMessage(reason) {
  if (reason === 'empty') return '请输入金额';
  if (reason === 'too-large') return '金额过大（上限 1 万亿）';
  return '请输入有效的数字金额';
}

function formatClockTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const sameDay = todayIso() === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameDay ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function errorMessage(err) {
  if (!err) return '';
  switch (err.code) {
    case 'permission':
      return canRequestCurrencyPermission() ? '需要授权访问汇率服务，点按「允许联网」后重试。' : '汇率服务未获授权，请在扩展权限中允许后刷新。';
    case 'network':
      return '网络不可用，暂时无法获取汇率。';
    case 'upstream':
      return '汇率服务暂不可用，请稍后刷新。';
    case 'unsupported':
      return '不支持的币种。';
    case 'invalid':
      return '汇率数据无法识别，请稍后刷新。';
    default:
      return err.message ? String(err.message) : '汇率获取失败。';
  }
}

/**
 * Describe rate status for display.
 * returns { state: loading|error|ready|stale, short, long, date }
 */
export function describeRateStatus(view, err, loading) {
  if (!view) {
    if (loading && !err) return { state: 'loading', short: '获取中…', long: '正在获取参考汇率…', date: '' };
    return {
      state: 'error',
      short: err?.code === 'permission' ? '需授权' : '暂不可用',
      long: errorMessage(err) || '暂无汇率数据。',
      date: '',
    };
  }
  if (view.source === 'identity') return { state: 'ready', short: '同币种', long: '同一币种，汇率为 1。', date: '' };
  const date = view.date || '';
  const shortDate = date ? date.slice(5) : '';
  if (view.offline) {
    const when = formatClockTime(view.receivedAt);
    return {
      state: 'stale',
      short: shortDate ? `缓存 ${shortDate}` : '缓存',
      long: `离线缓存${date ? ` · 参考日 ${date}` : ''}${when ? ` · 获取于 ${when}` : ''}${err ? ` · ${errorMessage(err)}` : ''}`,
      date,
    };
  }
  if (view.stale) {
    return {
      state: 'stale',
      short: shortDate ? `${shortDate} 可能过时` : '可能过时',
      long: `参考日 ${date || '未知'}，数据可能已过时${view.serverStale ? '（服务端缓存）' : ''}。`,
      date,
    };
  }
  return { state: 'ready', short: shortDate ? `参考 ${shortDate}` : '参考汇率', long: `参考汇率 · ${date || '日期未知'}`, date };
}

/* ---------------- edit-mode (jiggle) lock ---------------- */

const EDIT_SELECTORS = [
  '.jiggle-mode', '.is-jiggle', '.is-jiggling', '.jiggling', '.jiggle', '.edit-mode', '.is-editing',
  '.widgets-editing', '[data-jiggle="true"]', '[data-jiggle-mode="true"]', '[data-edit-mode="true"]', '[data-editing="true"]',
].join(', ');
const LOCK_ATTRS = ['class', 'data-jiggle', 'data-jiggle-mode', 'data-edit-mode', 'data-editing'];

export function isEditLocked(root, context) {
  if (!root || typeof root.closest !== 'function') return false;
  if (root.closest('.widget-in-detail-modal')) return false;
  try {
    if (context?.isJiggleMode?.() === true || context?.isEditMode?.() === true) return true;
  } catch {
    // ignore
  }
  try {
    const body = root.ownerDocument?.body;
    return Boolean(root.closest(EDIT_SELECTORS)) || Boolean(body && body.matches(EDIT_SELECTORS));
  } catch {
    return false;
  }
}

/** Watches for edit/jiggle mode (and detail-modal moves); calls onChange(locked) on transitions. */
export function watchEditLock(root, context, onChange) {
  let locked = null;
  let timer = 0;
  let observer = null;
  const check = () => {
    timer = 0;
    const next = isEditLocked(root, context);
    if (next !== locked) {
      locked = next;
      try {
        onChange(next);
      } catch {
        // ignore
      }
    }
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(check, 30);
  };
  try {
    const docEl = root.ownerDocument?.documentElement;
    if (docEl && typeof MutationObserver === 'function') {
      observer = new MutationObserver(schedule);
      observer.observe(docEl, { attributes: true, subtree: true, attributeFilter: LOCK_ATTRS });
    }
  } catch {
    observer = null;
  }
  check();
  return {
    isLocked: () => locked === true,
    refresh: check,
    disconnect() {
      observer?.disconnect();
      observer = null;
      if (timer) clearTimeout(timer);
      timer = 0;
    },
  };
}

/** Stops activation/drag from interactive controls without swallowing Escape. */
export function guardInteractive(node) {
  const handler = (e) => {
    if (e.type === 'keydown' && e.key === 'Escape') return;
    e.stopPropagation();
  };
  const types = ['click', 'dblclick', 'pointerdown', 'mousedown', 'touchstart', 'keydown', 'dragstart'];
  for (const t of types) node.addEventListener(t, handler, t === 'touchstart' ? { passive: true } : false);
  return () => {
    for (const t of types) node.removeEventListener(t, handler, t === 'touchstart' ? { passive: true } : false);
  };
}

/* ---------------- icons ---------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const FX_ICON_PATHS = {
  currency: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'M14.8 9.2c-.4-1-1.5-1.7-2.8-1.7-1.6 0-2.8.9-2.8 2.1 0 2.8 5.8 1.5 5.8 4.4 0 1.2-1.3 2.1-3 2.1-1.4 0-2.6-.7-3-1.8', 'M12 6v1.5M12 16.6V18'],
  swap: ['M5 8.5h13', 'M14.5 5 18 8.5 14.5 12', 'M19 15.5H6', 'M9.5 12 6 15.5 9.5 19'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4h-4'],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M6 11h12v9H6z'],
  search: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z', 'M16 16l4 4'],
  chevron: ['M6.5 9.5 12 15l5.5-5.5'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
};

export function createFxIcon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of FX_ICON_PATHS[kind] || FX_ICON_PATHS.currency) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/* =====================================================================
 * Country & Popular Currency Picker (Portal Popover on document.body)
 * ===================================================================== */

let pickerUid = 1;

function formatMultiCountryHint(entry) {
  if (!entry || !Array.isArray(entry.countries) || entry.countries.length <= 1) return '';
  const extras = entry.countries.filter((c) => c !== entry.country);
  if (extras.length === 0) return '';
  const preview = extras.slice(0, 4).join('、');
  return extras.length > 4 ? `含 ${preview} 等 ${entry.countries.length} 地` : `含 ${preview}`;
}

function positionPickerPortal(triggerEl, portalEl) {
  if (!triggerEl || !portalEl || typeof window === 'undefined') return;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const margin = 8;

  if (vw < 520) {
    const width = Math.min(368, vw - margin * 2);
    portalEl.style.width = `${Math.round(width)}px`;
    const left = Math.max(margin, Math.round((vw - width) / 2));
    portalEl.style.left = `${left}px`;
    const portalRect = typeof portalEl.getBoundingClientRect === 'function'
      ? portalEl.getBoundingClientRect()
      : { height: 460 };
    const maxH = Math.max(240, vh - margin * 2);
    const ph = Math.min(portalRect.height || 460, maxH);
    const rect = typeof triggerEl.getBoundingClientRect === 'function'
      ? triggerEl.getBoundingClientRect()
      : { top: 40, bottom: 80 };
    let top = rect.bottom + 8;
    if (top + ph > vh - margin) {
      top = Math.max(margin, Math.round((vh - ph) / 2));
    }
    portalEl.style.top = `${Math.round(top)}px`;
    return;
  }

  const width = Math.min(374, vw - margin * 2);
  portalEl.style.width = `${Math.round(width)}px`;
  const rect = typeof triggerEl.getBoundingClientRect === 'function'
    ? triggerEl.getBoundingClientRect()
    : { left: 16, top: 16, bottom: 56, width: 160, height: 40 };
  const portalRect = typeof portalEl.getBoundingClientRect === 'function'
    ? portalEl.getBoundingClientRect()
    : { width, height: 420 };
  const pw = portalRect.width || width;
  const ph = portalRect.height || 420;

  let left = rect.left;
  if (left + pw > vw - margin) left = vw - pw - margin;
  if (left < margin) left = margin;

  let top = rect.bottom + 6;
  if (top + ph > vh - margin && rect.top - ph - 6 >= margin) {
    top = rect.top - ph - 6;
  } else if (top + ph > vh - margin) {
    top = Math.max(margin, vh - ph - margin);
  }

  portalEl.style.left = `${Math.round(left)}px`;
  portalEl.style.top = `${Math.round(top)}px`;
}

export function createCurrencyPicker({
  value = DEFAULT_PAIR.base,
  roleLabel = '源货币',
  title = '选择国家 / 货币',
  compact = false,
  getDisabled = null,
  onSelect = null,
} = {}) {
  const listboxId = `fx_picker_list_${pickerUid++}`;
  let currentCode = isSupportedCurrency(value) ? value : DEFAULT_PAIR.base;
  let isOpen = false;
  let activeRegion = 'all';
  let queryText = '';
  let activeIndex = -1;
  let visibleEntries = [];
  let portalEl = null;
  let searchInput = null;
  let clearSearchBtn = null;
  let hotSection = null;
  let regionBar = null;
  let listEl = null;

  const countrySpan = el('span', { className: 'fx-picker-country' });
  const primarySpan = el('span', { className: compact ? 'fx-picker-code' : 'fx-picker-sub' });
  const chevronSpan = el('span', { className: 'fx-picker-chevron', 'aria-hidden': 'true' }, createFxIcon('chevron'));

  const triggerBtn = el(
    'button',
    {
      type: 'button',
      className: `fx-picker-btn fx-control ${compact ? 'is-compact' : 'is-detail'}`,
      role: 'combobox',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': listboxId,
    },
    el('span', { className: 'fx-picker-btn-text' }, countrySpan, primarySpan),
    chevronSpan
  );

  function syncTrigger() {
    const meta = getCurrencyMeta(currentCode);
    const country = meta ? meta.country : currentCode;
    const name = meta ? meta.name : currencyName(currentCode);
    setText(countrySpan, country);
    setText(primarySpan, compact ? currentCode : `${name} · ${currentCode}`);
    triggerBtn.dataset.currencyCode = currentCode;
    triggerBtn.title = `${country} · ${name} (${currentCode})`;
    triggerBtn.setAttribute('aria-label', `${roleLabel}：${country} ${name}（${currentCode}）`);
  }

  function selectCode(nextCode) {
    if (!isSupportedCurrency(nextCode)) return;
    const changed = nextCode !== currentCode;
    currentCode = nextCode;
    syncTrigger();
    close({ restoreFocus: true });
    if (changed) {
      onSelect?.(nextCode);
    }
  }

  function createOptionRow(entry, matchedCountry, flatIdx) {
    const isSelected = entry.code === currentCode;
    const isActive = flatIdx === activeIndex;
    const showMatched = matchedCountry && matchedCountry !== entry.country;

    const primaryChildren = [];
    if (showMatched) {
      primaryChildren.push(el('span', { className: 'fx-picker-item-country', textContent: matchedCountry }));
      primaryChildren.push(el('span', { className: 'fx-picker-item-via', textContent: entry.country }));
    } else {
      primaryChildren.push(el('span', { className: 'fx-picker-item-country', textContent: entry.country }));
    }
    if (entry.popular) {
      primaryChildren.push(el('span', { className: 'fx-picker-item-hot-tag', textContent: '热门' }));
    }

    const extraCountries = showMatched ? '' : formatMultiCountryHint(entry);
    const subNodes = [entry.name];
    if (entry.symbol) {
      subNodes.push(' · ', el('bdi', { className: 'fx-picker-item-symbol', textContent: entry.symbol }));
    }
    if (extraCountries) {
      subNodes.push(` · ${extraCountries}`);
    }

    const optBtn = el(
      'button',
      {
        type: 'button',
        role: 'option',
        className: `fx-picker-item ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`,
        'aria-selected': String(isSelected),
        dataset: { code: entry.code, index: String(flatIdx) },
      },
      el(
        'span',
        { className: 'fx-picker-item-main' },
        el('span', { className: 'fx-picker-item-top' }, ...primaryChildren),
        el('span', { className: 'fx-picker-item-sub' }, ...subNodes)
      ),
      el(
        'span',
        { className: 'fx-picker-item-right' },
        el('span', { className: 'fx-picker-item-code', textContent: entry.code }),
        isSelected ? el('span', { className: 'fx-picker-item-check', 'aria-hidden': 'true', textContent: '✓' }) : null
      )
    );

    optBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCode(entry.code);
    });
    return optBtn;
  }

  function renderHotSection() {
    if (!hotSection) return;
    const searching = queryText.trim().length > 0;
    hotSection.hidden = searching;
    if (searching) return;

    const chipsWrap = hotSection.querySelector('.fx-picker-hot-grid');
    if (!chipsWrap) return;
    clearElement(chipsWrap);
    for (const entry of getPopularCurrencies()) {
      const isSelected = entry.code === currentCode;
      const chip = el(
        'button',
        {
          type: 'button',
          className: `fx-hot-chip ${isSelected ? 'is-selected' : ''}`,
          'aria-pressed': String(isSelected),
          dataset: { code: entry.code },
          title: `${entry.country} · ${entry.name} (${entry.code})`,
        },
        el('span', { className: 'fx-hot-chip-country', textContent: entry.country }),
        el('span', { className: 'fx-hot-chip-code', textContent: entry.code })
      );
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        selectCode(entry.code);
      });
      chipsWrap.appendChild(chip);
    }
  }

  function renderRegionTabs() {
    if (!regionBar) return;
    const searching = queryText.trim().length > 0;
    regionBar.hidden = searching;
    if (searching) return;

    clearElement(regionBar);
    const tabs = [{ id: 'all', label: '全部' }, ...getCurrencyRegions()];
    for (const tab of tabs) {
      const active = activeRegion === tab.id;
      const btn = el('button', {
        type: 'button',
        role: 'tab',
        className: `fx-region-tab ${active ? 'is-active' : ''}`,
        'aria-selected': String(active),
        dataset: { region: tab.id },
        textContent: tab.label,
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeRegion === tab.id) return;
        activeRegion = tab.id;
        activeIndex = 0;
        renderRegionTabs();
        renderList();
      });
      regionBar.appendChild(btn);
    }
  }

  function syncActiveVisual({ scroll = false } = {}) {
    if (!listEl) return;
    const buttons = listEl.querySelectorAll('.fx-picker-item');
    buttons.forEach((btn, idx) => {
      const active = idx === activeIndex;
      btn.classList.toggle('is-active', active);
      if (active && scroll && typeof btn.scrollIntoView === 'function') {
        btn.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function renderList() {
    if (!listEl) return;
    clearElement(listEl);
    const trimmed = queryText.trim();
    const results = searchCurrencyCatalog(trimmed, { region: activeRegion });
    visibleEntries = results.map((r) => r.entry);

    if (results.length === 0) {
      activeIndex = -1;
      listEl.appendChild(
        el('div', {
          className: 'fx-picker-empty',
          textContent: '未找到匹配的国家或货币，试试输入国家中文名、英文名或 3 位代码',
        })
      );
      return;
    }

    if (activeIndex < 0 || activeIndex >= results.length) {
      const selIdx = results.findIndex((r) => r.entry.code === currentCode);
      activeIndex = trimmed ? 0 : (selIdx >= 0 ? selIdx : 0);
    }

    if (!trimmed && activeRegion === 'all') {
      const regions = getCurrencyRegions();
      const grouped = new Map(regions.map((r) => [r.id, []]));
      for (const item of results) {
        const bucket = grouped.get(item.entry.region);
        if (bucket) bucket.push(item);
      }
      let flatIdx = 0;
      const orderedEntries = [];
      for (const region of regions) {
        const items = grouped.get(region.id) || [];
        if (items.length === 0) continue;
        listEl.appendChild(
          el(
            'div',
            { className: 'fx-picker-group-label', role: 'presentation' },
            el('span', { textContent: region.label }),
            el('span', { className: 'fx-picker-group-count', textContent: `${items.length}` })
          )
        );
        for (const item of items) {
          orderedEntries.push(item.entry);
          listEl.appendChild(createOptionRow(item.entry, item.matchedCountry, flatIdx));
          flatIdx += 1;
        }
      }
      visibleEntries = orderedEntries;
      if (activeIndex >= visibleEntries.length) activeIndex = 0;
      syncActiveVisual();
      return;
    }

    results.forEach((item, idx) => {
      listEl.appendChild(createOptionRow(item.entry, item.matchedCountry, idx));
    });
  }

  function onDocPointerDown(e) {
    if (!isOpen) return;
    if (triggerBtn.contains(e.target) || (portalEl && portalEl.contains(e.target))) return;
    close({ restoreFocus: false });
  }

  function onWindowReposition() {
    if (isOpen && portalEl) {
      positionPickerPortal(triggerBtn, portalEl);
    }
  }

  function onKeyDown(e) {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        open();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close({ restoreFocus: true });
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (visibleEntries.length > 0) {
        activeIndex = (activeIndex + 1) % visibleEntries.length;
        syncActiveVisual({ scroll: true });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (visibleEntries.length > 0) {
        activeIndex = (activeIndex - 1 + visibleEntries.length) % visibleEntries.length;
        syncActiveVisual({ scroll: true });
      }
    } else if (e.key === 'Home') {
      if (document.activeElement === searchInput && queryText) return;
      e.preventDefault();
      if (visibleEntries.length > 0) {
        activeIndex = 0;
        syncActiveVisual({ scroll: true });
      }
    } else if (e.key === 'End') {
      if (document.activeElement === searchInput && queryText) return;
      e.preventDefault();
      if (visibleEntries.length > 0) {
        activeIndex = visibleEntries.length - 1;
        syncActiveVisual({ scroll: true });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (visibleEntries.length > 0 && activeIndex >= 0 && activeIndex < visibleEntries.length) {
        selectCode(visibleEntries[activeIndex].code);
      }
    }
  }

  const instance = {
    button: triggerBtn,
    open,
    close,
    isOpen: () => isOpen,
    getValue: () => currentCode,
    setValue(nextCode) {
      if (!isSupportedCurrency(nextCode)) return;
      currentCode = nextCode;
      syncTrigger();
      if (isOpen) {
        renderHotSection();
        renderList();
      }
    },
    destroy() {
      close({ restoreFocus: false });
      triggerBtn.removeEventListener('click', onTriggerClick);
      triggerBtn.removeEventListener('keydown', onKeyDown);
    },
  };

  function open() {
    if (isOpen || triggerBtn.disabled || getDisabled?.()) return;
    closeAllPopovers(instance);
    isOpen = true;
    activeRegion = 'all';
    queryText = '';
    activeIndex = -1;
    registerPopover(instance);
    triggerBtn.setAttribute('aria-expanded', 'true');

    const closeBtn = el(
      'button',
      { type: 'button', className: 'fx-picker-close', 'aria-label': '关闭货币选择器', title: '关闭' },
      createFxIcon('close')
    );
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      close({ restoreFocus: true });
    });

    const headerEl = el(
      'div',
      { className: 'fx-picker-head' },
      el(
        'div',
        { className: 'fx-picker-head-meta' },
        el('span', { className: 'fx-picker-title', textContent: title }),
        el('span', { className: 'fx-picker-count', textContent: `${getCurrencyCatalog().length} 个国家/地区货币` })
      ),
      closeBtn
    );

    searchInput = el('input', {
      type: 'text',
      className: 'fx-picker-search',
      placeholder: '搜索国家、地区或货币（如 法国、泰国、USD）',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': '按国家或货币名称搜索',
    });

    clearSearchBtn = el(
      'button',
      { type: 'button', className: 'fx-picker-search-clear', hidden: true, 'aria-label': '清空搜索' },
      createFxIcon('close')
    );

    const onSearchChange = () => {
      queryText = searchInput.value;
      clearSearchBtn.hidden = !queryText;
      activeIndex = 0;
      renderHotSection();
      renderRegionTabs();
      renderList();
    };
    searchInput.addEventListener('input', onSearchChange);
    searchInput.addEventListener('keydown', onKeyDown);
    clearSearchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      searchInput.value = '';
      onSearchChange();
      searchInput.focus?.();
    });

    const searchWrap = el(
      'div',
      { className: 'fx-picker-search-wrap' },
      el('span', { className: 'fx-picker-search-icon', 'aria-hidden': 'true' }, createFxIcon('search')),
      searchInput,
      clearSearchBtn
    );

    hotSection = el(
      'div',
      { className: 'fx-picker-hot' },
      el(
        'div',
        { className: 'fx-picker-section-head' },
        el('span', { textContent: '热门货币' }),
        el('span', { className: 'fx-picker-section-hint', textContent: '一键快选' })
      ),
      el('div', { className: 'fx-picker-hot-grid' })
    );

    regionBar = el('div', { className: 'fx-picker-regions', role: 'tablist', 'aria-label': '按地区筛选国家货币' });
    listEl = el('div', { className: 'fx-picker-list', id: listboxId, role: 'listbox', 'aria-label': title });

    portalEl = el(
      'div',
      {
        className: 'ui-popover-portal fx-picker-popover',
        role: 'dialog',
        'aria-label': title,
      },
      headerEl,
      searchWrap,
      hotSection,
      regionBar,
      listEl
    );

    portalEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    portalEl.addEventListener('click', (e) => e.stopPropagation());
    portalEl.addEventListener('keydown', onKeyDown);

    document.body?.appendChild(portalEl);
    renderHotSection();
    renderRegionTabs();
    renderList();
    positionPickerPortal(triggerBtn, portalEl);

    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener?.('resize', onWindowReposition);

    if (typeof window === 'undefined' || (window.innerWidth || 1280) >= 640) {
      searchInput.focus?.();
    }
  }

  function close({ restoreFocus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    unregisterPopover(instance);
    triggerBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    window.removeEventListener?.('resize', onWindowReposition);
    if (portalEl) {
      portalEl.remove();
      portalEl = null;
    }
    searchInput = null;
    clearSearchBtn = null;
    hotSection = null;
    regionBar = null;
    listEl = null;
    visibleEntries = [];
    if (restoreFocus) {
      triggerBtn.focus?.();
    }
  }

  function onTriggerClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) close({ restoreFocus: true });
    else open();
  }

  triggerBtn.addEventListener('click', onTriggerClick);
  triggerBtn.addEventListener('keydown', onKeyDown);
  syncTrigger();

  return instance;
}

/* =====================================================================
 * currency-converter widget
 * ===================================================================== */

function readConfig(context) {
  try {
    const c = context.getWidgetConfig?.();
    if (c && typeof c === 'object') return c;
  } catch {
    // ignore
  }
  return context.config && typeof context.config === 'object' ? context.config : {};
}

export function mount(root, context = {}) {
  clearElement(root);
  root.classList.add('ios-widget', 'widget-currency-converter', 'fx-card');

  let pair = normalizePair(readConfig(context));
  let pending = null;
  let amountText = '100';
  let view = peekExchangeRate(pair.base, pair.quote);
  let lastError = null;
  let loading = false;
  let seq = 0;
  let destroyed = false;
  let pairTimer = 0;
  let pairTimerSave = false;
  let saveToken = 0;
  let saveText = '';
  let saveIsError = false;
  let permissionText = '';
  let permissionBusy = false;
  let isSummaryLocked = false;
  const disposers = [];

  /* ----- summary: head + glance (1x1 / 2x1) + live form (2x2) ----- */
  const headPair = el('span', { className: 'fx-head-pair' });
  const head = el('div', { className: 'fx-head' },
    el('span', { className: 'fx-badge', 'aria-hidden': 'true' }, createFxIcon('currency')),
    el('span', { className: 'fx-kicker', textContent: '汇率换算' }),
    headPair);

  const gPair = el('span', { className: 'fx-g-pair', 'aria-hidden': 'true' });
  const gCaption = el('span', { className: 'fx-g-caption', 'aria-hidden': 'true' });
  const gRate = el('span', { className: 'fx-g-rate', 'aria-hidden': 'true' });
  const gUnit = el('span', { className: 'fx-g-unit', 'aria-hidden': 'true' });
  const gConv = el('span', { className: 'fx-g-conv', 'aria-hidden': 'true' });
  const gMetaShort = el('span', { className: 'fx-g-meta-short' });
  const gMetaLong = el('span', { className: 'fx-g-meta-long' });
  const gMeta = el('span', { className: 'fx-g-meta', 'aria-hidden': 'true' }, gMetaShort, gMetaLong);
  const gSr = el('span', { className: 'fx-sr-only' });
  const glance = el('div', { className: 'fx-glance' },
    gPair,
    el('div', { className: 'fx-g-main' }, gCaption, el('div', { className: 'fx-g-rate-row' }, gRate, gUnit)),
    gConv, gMeta, gSr);

  function buildControls(variant) {
    const isDetail = variant === 'detail';
    const amount = el('input', {
      type: 'text', inputmode: 'decimal', className: 'fx-amount fx-control', autocomplete: 'off',
      spellcheck: 'false', maxlength: '28', value: amountText, enterkeyhint: 'done', name: 'amount',
    });
    const basePicker = createCurrencyPicker({
      value: pair.base,
      roleLabel: '源货币',
      title: '选择源国家 / 货币',
      compact: !isDetail,
      getDisabled: () => !isDetail && isSummaryLocked,
      onSelect: (nextBase) => applyPair({ base: nextBase, quote: pair.quote }),
    });
    const quotePicker = createCurrencyPicker({
      value: pair.quote,
      roleLabel: '目标货币',
      title: '选择目标国家 / 货币',
      compact: !isDetail,
      getDisabled: () => !isDetail && isSummaryLocked,
      onSelect: (nextQuote) => applyPair({ base: pair.base, quote: nextQuote }),
    });
    const swap = el('button', { type: 'button', className: 'fx-swap fx-control', 'aria-label': '互换币种', title: '互换币种' }, createFxIcon('swap'));
    const resultValue = el('output', { className: 'fx-result-value', 'aria-live': 'polite' });
    const resultCode = el('span', { className: 'fx-result-code' });
    const rateLine = el('span', { className: 'fx-rate-line' });
    const feedback = el('span', { className: 'fx-feedback', role: 'status' });
    const permBtn = el('button', { type: 'button', className: 'fx-btn fx-perm-btn fx-control', hidden: true, textContent: '允许联网' });
    const form = el('form', { className: `fx-form fx-form-${variant}`, novalidate: 'true', 'aria-label': '汇率换算' },
      el('label', { className: 'fx-field fx-field-amount' },
        el('span', { className: 'fx-field-label', textContent: '金额' }), amount),
      el('div', { className: 'fx-pair-row' },
        el('div', { className: 'fx-field' }, el('span', { className: 'fx-field-label', textContent: '从' }), basePicker.button),
        swap,
        el('div', { className: 'fx-field' }, el('span', { className: 'fx-field-label', textContent: '换成' }), quotePicker.button)),
      el('div', { className: 'fx-result' },
        el('div', { className: 'fx-result-main' }, resultValue, resultCode),
        rateLine, feedback),
      permBtn);
    disposers.push(guardInteractive(form));
    return {
      variant, form, amount, basePicker, quotePicker,
      baseSel: basePicker.button, quoteSel: quotePicker.button,
      swap, resultValue, resultCode, rateLine, feedback, permBtn,
    };
  }

  const live = buildControls('summary');
  live.form.classList.add('fx-live');
  const summary = el('div', { className: 'fx-summary' }, head, glance, live.form);

  /* ----- detail (opened from any size) ----- */
  const full = buildControls('detail');
  const facts = el('dl', { className: 'fx-facts' });
  const note = el('p', { className: 'fx-note', role: 'status' });
  const saveNote = el('p', { className: 'fx-note fx-save-note', role: 'status', hidden: true });
  const refreshBtn = el('button', { type: 'button', className: 'fx-btn is-ghost fx-control' }, createFxIcon('refresh'), el('span', { textContent: '刷新汇率' }));
  const actions = el('div', { className: 'fx-actions' }, refreshBtn);
  disposers.push(guardInteractive(actions));
  const detail = el('div', { className: 'fx-detail', role: 'group', 'aria-label': '汇率换算详情' },
    el('div', { className: 'fx-d-head' },
      el('span', { className: 'fx-badge is-large', 'aria-hidden': 'true' }, createFxIcon('currency')),
      el('div', { className: 'fx-d-titles' },
        el('div', { className: 'fx-d-title', textContent: '汇率换算' }),
        el('div', { className: 'fx-d-sub', textContent: '按国家/地区快选全球货币 · 金额仅在本机计算，不会上传或保存' }))),
    full.form, facts, note, saveNote, actions);

  root.append(summary, detail);
  const controlSets = [live, full];

  /* ----- rendering ----- */
  function renderResults() {
    const parsed = parseAmount(amountText);
    const status = describeRateStatus(view, lastError, loading);
    let value = '—';
    let fb = '';
    let fbErr = false;
    if (!parsed.ok) {
      fb = amountMessage(parsed.reason);
      fbErr = true;
    } else if (!view) {
      value = status.state === 'loading' ? '…' : '—';
      fb = status.long;
      fbErr = status.state === 'error';
    } else {
      value = formatAmount(parsed.value * view.rate);
      if (lastError) {
        fb = view.offline ? status.long : errorMessage(lastError);
        fbErr = false;
      }
    }
    const rateText = view ? `1 ${pair.base} = ${formatRate(view.rate)} ${pair.quote}${status.date ? ` · ${status.date}` : ''}${view.offline ? ' · 缓存' : view.stale ? ' · 可能过时' : ''}` : '';
    const showPerm = lastError?.code === 'permission';
    for (const c of controlSets) {
      setText(c.resultValue, value);
      setText(c.resultCode, pair.quote);
      c.resultValue.setAttribute('aria-label', parsed.ok && view ? `${parsed.value} ${currencyCountry(pair.base)} ${currencyName(pair.base)} 约合 ${value} ${currencyCountry(pair.quote)} ${currencyName(pair.quote)}` : fb || value);
      setText(c.rateLine, rateText);
      c.rateLine.hidden = !rateText || (fbErr && c.variant === 'summary');
      setText(c.feedback, fb);
      c.feedback.hidden = !fb;
      c.feedback.classList.toggle('is-error', fbErr);
      c.amount.setAttribute('aria-invalid', parsed.ok ? 'false' : 'true');
      c.permBtn.hidden = !showPerm;
      c.permBtn.disabled = permissionBusy || (c.variant === 'summary' && lock.isLocked());
      setText(c.permBtn, permissionBusy ? '等待授权…' : canRequestCurrencyPermission() ? '允许联网' : '重试');
    }
    // 2x1 glance conversion line
    if (parsed.ok && view) {
      setText(gConv, `${fmt(parsed.value, { maximumFractionDigits: 8 })} ${pair.base} ≈ ${value} ${pair.quote}`);
    } else {
      setText(gConv, parsed.ok ? `${pair.base} → ${pair.quote}` : amountMessage(parsed.reason));
    }
  }

  function renderFacts(status) {
    clearElement(facts);
    const rows = [];
    rows.push(['国家/地区', `${currencyCountry(pair.base)} → ${currencyCountry(pair.quote)}`]);
    rows.push(['币种', `${currencyName(pair.base)} (${pair.base}) → ${currencyName(pair.quote)} (${pair.quote})`]);
    if (view) {
      rows.push(['汇率', `1 ${pair.base} = ${formatRate(view.rate)} ${pair.quote}`]);
      rows.push(['反向', `1 ${pair.quote} = ${formatRate(1 / view.rate)} ${pair.base}`]);
      if (view.source !== 'identity') {
        rows.push(['参考日期', view.date || '未知']);
        rows.push(['获取于', formatClockTime(view.receivedAt)]);
        rows.push(['数据状态', view.offline ? '离线缓存' : view.stale ? '可能过时' : view.source === 'memory' ? '短时缓存' : '最新获取']);
      }
    } else {
      rows.push(['状态', status.short]);
    }
    for (const [k, v] of rows) {
      if (!v) continue;
      facts.append(el('div', { className: 'fx-fact' }, el('dt', { textContent: k }), el('dd', { textContent: v })));
    }
  }

  function render() {
    const status = describeRateStatus(view, lastError, loading);
    root.dataset.fxState = status.state;
    root.dataset.fxRefreshing = loading ? 'true' : 'false';
    const rateText = view ? formatRate(view.rate) : status.state === 'loading' ? '…' : '—';
    root.dataset.fxRateLen = rateText.length <= 5 ? 's' : rateText.length <= 7 ? 'm' : 'l';
    setText(headPair, `${pair.base}/${pair.quote}`);
    setText(gPair, `${currencyCountry(pair.base)} ${pair.base} → ${currencyCountry(pair.quote)} ${pair.quote}`);
    setText(gCaption, `1 ${pair.base} =`);
    setText(gRate, rateText);
    setText(gUnit, pair.quote);
    setText(gMetaShort, status.short);
    setText(gMetaLong, status.state === 'error' ? status.short : status.long.split(' · ').slice(0, 2).join(' · '));
    const sr = view
      ? `汇率 ${currencyCountry(pair.base)} ${pair.base} 兑 ${currencyCountry(pair.quote)} ${pair.quote}：1 ${pair.base} = ${formatRate(view.rate)} ${pair.quote}，${status.long}`
      : `汇率 ${currencyCountry(pair.base)} ${pair.base} 兑 ${currencyCountry(pair.quote)} ${pair.quote}：${status.long}`;
    setText(gSr, sr);
    summary.title = sr;
    for (const c of controlSets) {
      if (c.basePicker.getValue() !== pair.base) c.basePicker.setValue(pair.base);
      if (c.quotePicker.getValue() !== pair.quote) c.quotePicker.setValue(pair.quote);
    }
    renderResults();
    renderFacts(status);
    const noteText = permissionText || (lastError && view && !view.offline ? errorMessage(lastError) : status.state === 'stale' || status.state === 'error' ? status.long : '');
    setText(note, noteText);
    note.hidden = !noteText;
    note.classList.toggle('is-error', status.state === 'error' || !!permissionText);
    setText(saveNote, saveText);
    saveNote.hidden = !saveText;
    saveNote.classList.toggle('is-error', saveIsError);
    refreshBtn.disabled = loading;
  }

  /* ----- data ----- */
  function load({ force = false } = {}) {
    if (destroyed) return;
    const my = ++seq;
    const { base, quote } = pair;
    loading = true;
    if (!view) render();
    getExchangeRate(base, quote, { force }).then(
      (next) => {
        if (destroyed || my !== seq) return;
        view = next;
        lastError = next.error || null;
        loading = false;
        if (!lastError) permissionText = '';
        render();
      },
      (err) => {
        if (destroyed || my !== seq) return;
        lastError = err;
        loading = false;
        render();
      }
    );
    if (view) render();
  }

  function persist() {
    const next = { base: pair.base, quote: pair.quote };
    pending = next;
    const token = ++saveToken;
    if (typeof context.saveWidgetConfig !== 'function') {
      saveText = '币对已在本页更新（当前未连接保存）';
      saveIsError = false;
      return;
    }
    let result;
    try {
      result = context.saveWidgetConfig({ ...next });
    } catch {
      saveText = '币对保存请求未能提交，本页仍使用新币对';
      saveIsError = true;
      render();
      return;
    }
    saveText = '';
    saveIsError = false;
    if (result && typeof result.then === 'function') {
      result.then(
        () => {
          if (destroyed || token !== saveToken) return;
          saveText = '';
          render();
        },
        () => {
          if (destroyed || token !== saveToken) return;
          pending = null;
          saveText = '币对保存失败，本页仍使用新币对，可稍后重试';
          saveIsError = true;
          render();
        }
      );
    }
  }

  function flushPairTimer() {
    if (!pairTimer) return;
    clearTimeout(pairTimer);
    pairTimer = 0;
    load();
    if (pairTimerSave) persist();
    pairTimerSave = false;
  }

  function applyPair(next, { save = true, delay = 300 } = {}) {
    if (!isSupportedCurrency(next.base) || !isSupportedCurrency(next.quote)) return;
    if (next.base === pair.base && next.quote === pair.quote) return;
    pair = { base: next.base, quote: next.quote };
    seq += 1; // invalidate any response for the previous pair
    view = peekExchangeRate(pair.base, pair.quote);
    lastError = null;
    loading = !view;
    permissionText = '';
    render();
    if (pairTimer) clearTimeout(pairTimer);
    pairTimerSave = pairTimerSave || save;
    pairTimer = setTimeout(flushPairTimer, delay);
  }

  /* ----- events ----- */
  const onAmountInput = (e) => {
    amountText = e.currentTarget.value;
    for (const c of controlSets) if (c.amount !== e.currentTarget) c.amount.value = amountText;
    renderResults();
  };
  const onSwap = () => applyPair({ base: pair.quote, quote: pair.base }, { delay: 0 });
  const onSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onPermission = (e) => {
    e.stopPropagation();
    if (permissionBusy) return;
    if (!canRequestCurrencyPermission()) {
      permissionText = '无法在此处申请授权。请在扩展权限设置中允许访问汇率服务，然后点按刷新。';
      load({ force: true });
      return;
    }
    // Called synchronously inside the click so the browser can show the permission prompt.
    const p = requestCurrencyPermission();
    permissionBusy = true;
    render();
    p.then((granted) => {
      if (destroyed) return;
      permissionBusy = false;
      if (granted) {
        permissionText = '';
        load({ force: true });
      } else {
        permissionText = '未授予联网权限。仍可查看已缓存的汇率，稍后可再次申请。';
        render();
      }
    });
  };
  const onRefresh = () => {
    permissionText = '';
    load({ force: true });
  };

  for (const c of controlSets) {
    c.amount.addEventListener('input', onAmountInput);
    c.swap.addEventListener('click', onSwap);
    c.form.addEventListener('submit', onSubmit);
    c.permBtn.addEventListener('click', onPermission);
  }
  refreshBtn.addEventListener('click', onRefresh);

  /* ----- edit lock: summary controls are inert while jiggling ----- */
  const summaryControls = [live.amount, live.baseSel, live.quoteSel, live.swap, live.permBtn];
  const lock = watchEditLock(root, context, (locked) => {
    isSummaryLocked = locked;
    root.dataset.controlsLocked = locked ? 'true' : 'false';
    if (locked) {
      live.basePicker.close({ restoreFocus: false });
      live.quotePicker.close({ restoreFocus: false });
    }
    for (const c of summaryControls) {
      c.disabled = locked || (c === live.permBtn && permissionBusy);
      if (locked) c.setAttribute('tabindex', '-1');
      else c.removeAttribute('tabindex');
    }
    if (locked && summary.contains(document.activeElement)) document.activeElement.blur?.();
  });

  const unsubRates = subscribeExchangeRates((evt) => {
    if (destroyed) return;
    if (evt.all) {
      load({ force: !!evt.force });
    } else if (evt.key === pairKey(pair.base, pair.quote) && evt.view && !pairTimer) {
      seq += 1;
      view = evt.view;
      lastError = null;
      loading = false;
      render();
    }
  });
  const onVisible = () => {
    if (document.visibilityState === 'visible') load();
  };
  document.addEventListener('visibilitychange', onVisible);
  const tick = setInterval(() => {
    if (document.visibilityState !== 'hidden') load();
  }, 5 * 60 * 1000);

  render();
  load();

  return {
    update(data = {}) {
      if (data.config && typeof data.config === 'object') {
        const incoming = normalizePair(data.config);
        if (pending) {
          if (incoming.base === pending.base && incoming.quote === pending.quote) pending = null;
        } else if (incoming.base !== pair.base || incoming.quote !== pair.quote) {
          applyPair(incoming, { save: false, delay: 0 });
        }
      }
      lock.refresh();
      render();
    },
    destroy() {
      if (pairTimer && pairTimerSave) {
        clearTimeout(pairTimer);
        pairTimer = 0;
        persist(); // do not lose a pair the user just picked
      }
      destroyed = true;
      seq += 1;
      saveToken += 1;
      if (pairTimer) clearTimeout(pairTimer);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      unsubRates();
      lock.disconnect();
      for (const c of controlSets) {
        c.amount.removeEventListener('input', onAmountInput);
        c.basePicker.destroy();
        c.quotePicker.destroy();
        c.swap.removeEventListener('click', onSwap);
        c.form.removeEventListener('submit', onSubmit);
        c.permBtn.removeEventListener('click', onPermission);
      }
      refreshBtn.removeEventListener('click', onRefresh);
      for (const d of disposers) d();
      for (const k of ['fxState', 'fxRefreshing', 'fxRateLen', 'controlsLocked']) delete root.dataset[k];
      clearElement(root);
      root.classList.remove('fx-card');
    },
  };
}
