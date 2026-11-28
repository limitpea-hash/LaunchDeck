import { el, clearElement, setText } from '../lib/dom.js';
import { createWeatherGlyph, resolveWeatherVisualKind } from './summary-helpers.js';
import {
  isSupportedCurrency,
  currencyName,
  currencyCountry,
  peekExchangeRate,
  getExchangeRate,
  subscribeExchangeRates,
  describeRateStatus,
  formatRate,
  errorMessage,
  canRequestCurrencyPermission,
  requestCurrencyPermission,
  guardInteractive,
  createFxIcon,
} from './currency-converter.js';

/* Fixed whitelists — never reflect raw config strings into attributes or classes. */
const TYPES = ['text', 'clock', 'weather', 'currency'];
const ICONS = ['note', 'clock', 'cloud', 'currency', 'sparkles'];
const PALETTES = ['indigo', 'teal', 'amber', 'slate', 'rose'];
const LAYOUTS = ['stacked', 'split'];
const TYPE_LABELS = { text: '文本', clock: '时钟', weather: '天气', currency: '汇率' };
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const pad = (n) => String(n).padStart(2, '0');
const num = (v) => typeof v === 'number' && Number.isFinite(v);

function cleanLine(v) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}
function cleanText(v) {
  return typeof v === 'string'
    ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : '';
}
const charLen = (s) => Array.from(s).length;

export function normalizeImportedConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const type = TYPES.includes(src.type) ? src.type : null;
  const title = cleanLine(src.title);
  const text = cleanText(src.text);
  const cfg = {
    valid: true,
    reason: '',
    type: type || 'text',
    title: title && charLen(title) <= 60 ? title : Array.from(title).slice(0, 60).join('') || '导入卡片',
    icon: ICONS.includes(src.icon) ? src.icon : 'sparkles',
    palette: PALETTES.includes(src.palette) ? src.palette : 'slate',
    layout: LAYOUTS.includes(src.layout) ? src.layout : 'stacked',
    text: '',
    base: null,
    quote: null,
  };
  const fail = (reason) => Object.assign(cfg, { valid: false, reason });
  if (!type) return fail('卡片类型无法识别');
  if (!title || charLen(title) > 60) return fail('卡片标题缺失或过长');
  if (type === 'text') {
    if (!text || charLen(text) > 240) return fail('文本内容缺失或超过 240 字');
    cfg.text = text;
  }
  if (type === 'currency') {
    if (!isSupportedCurrency(src.base) || !isSupportedCurrency(src.quote)) return fail('币种不在支持列表中');
    cfg.base = src.base;
    cfg.quote = src.quote;
  }
  return cfg;
}

function readConfig(context) {
  try {
    const c = context.getWidgetConfig?.();
    if (c && typeof c === 'object') return c;
  } catch {
    // ignore
  }
  return context.config && typeof context.config === 'object' ? context.config : null;
}

const ICON_PATHS = {
  note: ['M6 3.5h8.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5Z', 'M14 3.6V8h4.6', 'M8.5 12.5h7M8.5 16h4.5'],
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'M12 7.5V12l3 1.8'],
  sparkles: ['M11 3.5l1.6 4.4 4.4 1.6-4.4 1.6L11 15.5l-1.6-4.4L5 9.5l4.4-1.6Z', 'M17.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z'],
};

function createIcon(kind) {
  if (kind === 'cloud') return createWeatherGlyph('cloudy');
  if (kind === 'currency') return createFxIcon('currency');
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(k, v);
  for (const d of ICON_PATHS[kind] || ICON_PATHS.sparkles) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function todayParts(context) {
  const snap = context.clock?.getSnapshot?.();
  const p = snap?.parts;
  if (p && num(p.year) && num(p.month) && num(p.day)) {
    const timeHM = p.timeHM || (num(p.hour) && num(p.minute) ? `${pad(p.hour)}:${pad(p.minute)}` : '');
    return { ...p, timeHM, timeZone: snap.timeZone || '', mode: snap.mode || '' };
  }
  const d = new Date();
  return {
    year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(),
    timeHM: `${pad(d.getHours())}:${pad(d.getMinutes())}`, timeZone: '', mode: '',
  };
}

function fillFacts(dl, rows) {
  clearElement(dl);
  for (const [k, v] of rows) {
    if (v === null || v === undefined || v === '') continue;
    dl.append(el('div', { className: 'ic-fact' }, el('dt', { textContent: k }), el('dd', { textContent: String(v) })));
  }
  dl.hidden = !dl.firstChild;
}

function setNote(node, text, isError = false) {
  setText(node, text);
  node.hidden = !text;
  node.classList.toggle('is-error', !!(text && isError));
}

/* ---------------- kind renderers ---------------- */

function renderText(cfg, ui) {
  ui.body.append(el('p', { className: 'ic-text', textContent: cfg.text }));
  ui.detailBody.append(el('p', { className: 'ic-text-full', textContent: cfg.text }));
  setText(ui.sr, `${cfg.title}：${cfg.text}`);
  fillFacts(ui.facts, [['字数', `${charLen(cfg.text)} 字`]]);
  return { update() {}, destroy() {} };
}

function renderClock(cfg, ui, context) {
  const time = el('span', { className: 'ic-time', 'aria-hidden': 'true' });
  const date = el('span', { className: 'ic-date', 'aria-hidden': 'true' });
  const zone = el('span', { className: 'ic-zone ic-roomy', 'aria-hidden': 'true' });
  ui.body.append(time, el('div', { className: 'ic-sub' }, date, zone));
  const dTime = el('div', { className: 'ic-d-hero' });
  const dDate = el('div', { className: 'ic-d-caption' });
  ui.detailBody.append(dTime, dDate);
  let last = '';
  function render(force = false) {
    const p = todayParts(context);
    const key = `${p.timeHM}|${p.day}|${p.timeZone}|${p.mode}`;
    if (!force && key === last) return;
    last = key;
    const wd = p.weekdayZh || WEEK[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
    const zoneText = p.mode === 'manual' ? `${p.timeZone || '本地'} · 手动校时` : p.timeZone || '本地时间';
    setText(time, p.timeHM || '--:--');
    setText(date, `${p.month}月${p.day}日 ${wd}`);
    setText(zone, zoneText);
    setText(dTime, p.timeHM || '--:--');
    setText(dDate, `${p.year}年${p.month}月${p.day}日 ${wd}`);
    setText(ui.sr, `${cfg.title}：${p.timeHM || '时间未知'}，${p.month}月${p.day}日 ${wd}`);
    fillFacts(ui.facts, [['时区', zoneText]]);
  }
  render(true);
  const unsub = context.clock?.subscribe?.(() => render());
  return {
    update() {
      render(true);
    },
    destroy() {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    },
  };
}

function hourLabel(iso, timeZone) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  try {
    return `${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) }).format(t).replace(/\D/g, '')}时`;
  } catch {
    return `${pad(new Date(t).getHours())}时`;
  }
}

export function normalizeWeather(envArg, context) {
  const env = (envArg && typeof envArg === 'object' ? envArg : context.getEnvironmentSnapshot?.()) || {};
  const w = env.weather && typeof env.weather === 'object' ? env.weather : null;
  const c = w?.current && typeof w.current === 'object' ? w.current : null;
  const unit = w?.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
  const p = todayParts(context);
  const isDay = typeof c?.isDay === 'boolean' ? c.isDay : p.hour >= 6 && p.hour < 18;
  const temp = num(c?.temperature) ? Math.round(c.temperature) : null;
  const condition = cleanLine(String(c?.condition || c?.conditionLabel || '')).slice(0, 40);
  const now = Date.now();
  const tz = typeof w?.timeZone === 'string' ? w.timeZone : '';
  const hourly = (Array.isArray(w?.hourly) ? w.hourly : [])
    .filter((h) => h && num(h.temperature) && Date.parse(h.forecastAt) > now - 30 * 60 * 1000)
    .slice(0, 6)
    .map((h) => ({
      label: hourLabel(h.forecastAt, tz),
      temp: Math.round(h.temperature),
      kind: resolveWeatherVisualKind(h.weatherCode, typeof h.isDay === 'boolean' ? h.isDay : true),
      pop: num(h.precipitationProbability) ? Math.round(h.precipitationProbability) : null,
    }))
    .filter((h) => h.label);
  const d = w?.daily;
  const state = temp !== null || condition
    ? (w?.cache?.stale ? 'stale' : 'live')
    : env.weatherLoading ? 'loading' : 'unavailable';
  return {
    state,
    temp,
    unit,
    condition,
    kind: resolveWeatherVisualKind(c?.weatherCode ?? c?.code, isDay),
    location: cleanLine(String(env.location?.name || '')).slice(0, 60),
    max: num(d?.maxTemperature) ? Math.round(d.maxTemperature) : null,
    min: num(d?.minTemperature) ? Math.round(d.minTemperature) : null,
    apparent: num(c?.apparentTemperature) ? Math.round(c.apparentTemperature) : null,
    humidity: num(c?.humidity) ? Math.round(c.humidity) : null,
    hourly,
    error: Boolean(env.weatherError),
  };
}

function renderWeather(cfg, ui, context, root) {
  const glyph = el('span', { className: 'ic-wx-glyph', 'aria-hidden': 'true' });
  const temp = el('span', { className: 'ic-wx-temp', 'aria-hidden': 'true' });
  const cond = el('span', { className: 'ic-wx-cond', 'aria-hidden': 'true' });
  const loc = el('span', { className: 'ic-wx-loc ic-optional', 'aria-hidden': 'true' });
  const range = el('span', { className: 'ic-wx-range ic-roomy', 'aria-hidden': 'true' });
  const hours = el('div', { className: 'ic-hours ic-wide-only', 'aria-hidden': 'true' });
  ui.body.append(
    el('div', { className: 'ic-wx-main' }, glyph, temp),
    el('div', { className: 'ic-sub' }, cond, loc, range),
    hours);
  const dGlyph = el('span', { className: 'ic-wx-glyph is-hero', 'aria-hidden': 'true' });
  const dTemp = el('div', { className: 'ic-d-hero' });
  const dCond = el('div', { className: 'ic-d-caption' });
  const dHours = el('div', { className: 'ic-hours is-detail' });
  ui.detailBody.append(el('div', { className: 'ic-d-row' }, dGlyph, el('div', {}, dTemp, dCond)), dHours);
  const retry = el('button', { type: 'button', className: 'ic-btn', textContent: '刷新天气' });
  retry.hidden = typeof context.refreshEnvironmentAndWeather !== 'function';
  ui.actions.append(retry);
  const onRetry = () => context.refreshEnvironmentAndWeather?.(true);
  retry.addEventListener('click', onRetry);
  let kind = '';

  function fillHours(container, list) {
    clearElement(container);
    for (const h of list) {
      const g = el('span', { className: 'ic-hour-icon', dataset: { weatherKind: h.kind } });
      g.appendChild(createWeatherGlyph(h.kind));
      container.append(el('div', { className: 'ic-hour' },
        el('span', { className: 'ic-hour-time', textContent: h.label }), g,
        el('span', { className: 'ic-hour-temp', textContent: `${h.temp}°` }),
        h.pop !== null && h.pop >= 20 ? el('span', { className: 'ic-hour-pop', textContent: `${h.pop}%` }) : null));
    }
    container.hidden = !list.length;
  }

  function render(env) {
    const w = normalizeWeather(env, context);
    root.dataset.weatherState = w.state;
    if (w.kind !== kind) {
      kind = w.kind;
      for (const n of [glyph, dGlyph]) {
        clearElement(n);
        n.appendChild(createWeatherGlyph(kind));
        n.dataset.weatherKind = kind;
      }
    }
    const fallback = w.state === 'loading' ? '同步中' : w.error ? '暂不可用' : w.location ? '暂无数据' : '待定位';
    setText(temp, w.temp !== null ? `${w.temp}°` : '--°');
    setText(cond, w.condition || fallback);
    setText(loc, w.location || (w.state === 'loading' ? '定位中' : '未设置地点'));
    setText(range, w.max !== null && w.min !== null ? `最高 ${w.max}° 最低 ${w.min}°` : '');
    fillHours(hours, w.hourly.slice(0, 4));
    setText(dTemp, w.temp !== null ? `${w.temp}${w.unit}` : '--');
    setText(dCond, [w.condition || (w.state === 'loading' ? '正在同步天气…' : '天气暂不可用'), w.location].filter(Boolean).join(' · '));
    fillHours(dHours, w.hourly);
    fillFacts(ui.facts, [
      ['体感', w.apparent !== null ? `${w.apparent}${w.unit}` : ''],
      ['湿度', w.humidity !== null ? `${w.humidity}%` : ''],
      ['最高 / 最低', w.max !== null && w.min !== null ? `${w.max}° / ${w.min}°` : ''],
      ['地点', w.location],
    ]);
    setNote(ui.note, w.state === 'loading'
      ? '正在同步位置与天气…'
      : w.state === 'unavailable'
        ? (w.error ? '天气服务暂不可用，可稍后刷新。' : '尚未获得位置，请在设置中选择城市或允许定位。')
        : w.state === 'stale' ? '当前显示缓存的天气数据。' : '', w.state === 'unavailable');
    setText(ui.sr, w.temp !== null || w.condition
      ? `${cfg.title}：${w.location || '当前位置'} ${w.condition || ''} ${w.temp !== null ? `${w.temp}${w.unit}` : ''}${w.state === 'stale' ? '（缓存）' : ''}`
      : `${cfg.title}：天气${fallback}`);
  }
  render();
  return {
    update(data = {}) {
      render(data.environment || data.env);
    },
    destroy() {
      retry.removeEventListener('click', onRetry);
      delete root.dataset.weatherState;
    },
  };
}

function renderCurrency(cfg, ui, context, root) {
  const { base, quote } = cfg;
  const pairEl = el('span', { className: 'ic-fx-pair', 'aria-hidden': 'true', textContent: `${base} → ${quote}` });
  const rate = el('span', { className: 'ic-fx-rate', 'aria-hidden': 'true' });
  const caption = el('span', { className: 'ic-fx-caption', 'aria-hidden': 'true' });
  const inverse = el('span', { className: 'ic-fx-inverse ic-roomy', 'aria-hidden': 'true' });
  const meta = el('span', { className: 'ic-fx-meta', 'aria-hidden': 'true' });
  const unit = el('span', { className: 'ic-fx-unit', 'aria-hidden': 'true', textContent: quote });
  ui.body.append(pairEl, el('div', { className: 'ic-fx-main' }, caption, el('div', { className: 'ic-fx-rate-row' }, rate, unit)), inverse, meta);
  const dRate = el('div', { className: 'ic-d-hero' });
  const dCap = el('div', { className: 'ic-d-caption' });
  ui.detailBody.append(dRate, dCap);
  const refreshBtn = el('button', { type: 'button', className: 'ic-btn is-ghost', textContent: '刷新汇率' });
  const permBtn = el('button', { type: 'button', className: 'ic-btn', hidden: true, textContent: '允许联网' });
  ui.actions.append(permBtn, refreshBtn);

  let view = peekExchangeRate(base, quote);
  let lastError = null;
  let loading = false;
  let seq = 0;
  let destroyed = false;
  let permText = '';
  let permBusy = false;

  function render() {
    const status = describeRateStatus(view, lastError, loading);
    root.dataset.fxState = status.state;
    const rateText = view ? formatRate(view.rate) : status.state === 'loading' ? '…' : '—';
    root.dataset.fxRateLen = rateText.length <= 5 ? 's' : rateText.length <= 7 ? 'm' : 'l';
    setText(caption, `1 ${base} =`);
    setText(rate, rateText);
    unit.hidden = !view;
    setText(inverse, view ? `1 ${quote} = ${formatRate(1 / view.rate)} ${base}` : '');
    setText(meta, status.short);
    setText(dRate, view ? `${rateText} ${quote}` : rateText);
    setText(dCap, `1 ${currencyCountry(base)} · ${currencyName(base)}（${base}）兑 ${currencyCountry(quote)} · ${currencyName(quote)}（${quote}） · ${status.long}`);
    fillFacts(ui.facts, view ? [
      ['国家/地区', `${currencyCountry(base)} → ${currencyCountry(quote)}`],
      ['汇率', `1 ${base} = ${formatRate(view.rate)} ${quote}`],
      ['反向', `1 ${quote} = ${formatRate(1 / view.rate)} ${base}`],
      ['参考日期', view.source === 'identity' ? '' : view.date || '未知'],
      ['数据状态', view.source === 'identity' ? '同币种' : view.offline ? '离线缓存' : view.stale ? '可能过时' : '参考汇率'],
    ] : [['状态', status.short]]);
    const noteText = permText || (status.state === 'error' || status.state === 'stale' ? status.long : lastError ? errorMessage(lastError) : '');
    setNote(ui.note, noteText, status.state === 'error' || !!permText);
    permBtn.hidden = lastError?.code !== 'permission';
    permBtn.disabled = permBusy;
    setText(permBtn, permBusy ? '等待授权…' : canRequestCurrencyPermission() ? '允许联网' : '重试');
    refreshBtn.disabled = loading;
    setText(ui.sr, view
      ? `${cfg.title}：1 ${base} = ${formatRate(view.rate)} ${quote}，${status.long}`
      : `${cfg.title}：${base} 兑 ${quote} ${status.long}`);
  }

  function load({ force = false } = {}) {
    if (destroyed) return;
    const my = ++seq;
    loading = true;
    render();
    getExchangeRate(base, quote, { force }).then(
      (next) => {
        if (destroyed || my !== seq) return;
        view = next;
        lastError = next.error || null;
        loading = false;
        if (!lastError) permText = '';
        render();
      },
      (err) => {
        if (destroyed || my !== seq) return;
        lastError = err;
        loading = false;
        render();
      }
    );
  }

  const onRefresh = () => {
    permText = '';
    load({ force: true });
  };
  const onPerm = () => {
    if (permBusy) return;
    if (!canRequestCurrencyPermission()) {
      permText = '无法在此处申请授权。请在扩展权限设置中允许访问汇率服务，然后点按刷新。';
      load({ force: true });
      return;
    }
    const p = requestCurrencyPermission(); // synchronous within the click gesture
    permBusy = true;
    render();
    p.then((granted) => {
      if (destroyed) return;
      permBusy = false;
      if (granted) {
        permText = '';
        load({ force: true });
      } else {
        permText = '未授予联网权限。仍可查看已缓存的汇率。';
        render();
      }
    });
  };
  refreshBtn.addEventListener('click', onRefresh);
  permBtn.addEventListener('click', onPerm);
  const unsub = subscribeExchangeRates((evt) => {
    if (destroyed) return;
    if (evt.all) load({ force: !!evt.force });
    else if (evt.key === `${base}:${quote}` && evt.view) {
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
  load();

  return {
    update() {
      render();
    },
    destroy() {
      destroyed = true;
      seq += 1;
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      unsub();
      refreshBtn.removeEventListener('click', onRefresh);
      permBtn.removeEventListener('click', onPerm);
      delete root.dataset.fxState;
      delete root.dataset.fxRateLen;
    },
  };
}

function renderInvalid(cfg, ui) {
  ui.body.append(el('div', { className: 'ic-disabled' },
    el('span', { className: 'ic-disabled-title', textContent: '卡片不可用' }),
    el('span', { className: 'ic-disabled-desc', textContent: cfg.reason || '配置无效' })));
  ui.detailBody.append(el('p', { className: 'ic-text-full', textContent: `此导入卡片的配置无效（${cfg.reason || '未知原因'}），未显示任何内容。可在编辑模式中移除后重新导入。` }));
  setText(ui.sr, `导入卡片不可用：${cfg.reason || '配置无效'}`);
  fillFacts(ui.facts, []);
  return { update() {}, destroy() {} };
}

/* ---------------- mount ---------------- */

export function mount(root, context = {}) {
  let cfg = null;
  let sig = '';
  let kindInstance = null;
  let disposeGuard = null;

  function build(rawConfig) {
    teardown();
    cfg = normalizeImportedConfig(rawConfig);
    sig = JSON.stringify(cfg);
    clearElement(root);
    root.classList.add('ios-widget', 'widget-imported-card', 'ic-card');
    root.dataset.icType = cfg.valid ? cfg.type : 'invalid';
    root.dataset.icPalette = cfg.palette;
    root.dataset.icLayout = cfg.layout;
    root.dataset.icIcon = cfg.icon;

    const badge = el('span', { className: 'ic-badge', 'aria-hidden': 'true' }, createIcon(cfg.icon));
    const body = el('div', { className: `ic-body ic-body-${cfg.valid ? cfg.type : 'invalid'}` });
    const sr = el('span', { className: 'ic-sr-only' });
    const summary = el('div', { className: 'ic-summary' },
      el('div', { className: 'ic-head' }, badge, el('span', { className: 'ic-title', textContent: cfg.title })),
      body, sr);
    const detailBody = el('div', { className: 'ic-d-body' });
    const facts = el('dl', { className: 'ic-facts' });
    const note = el('p', { className: 'ic-note', role: 'status', hidden: true });
    const actions = el('div', { className: 'ic-actions' });
    const detail = el('div', { className: 'ic-detail', role: 'group', 'aria-label': `${cfg.title} 详情` },
      el('div', { className: 'ic-d-head' },
        el('span', { className: 'ic-badge is-large', 'aria-hidden': 'true' }, createIcon(cfg.icon)),
        el('div', { className: 'ic-d-titles' },
          el('div', { className: 'ic-d-title', textContent: cfg.title }),
          el('div', { className: 'ic-d-kind', textContent: `导入卡片 · ${cfg.valid ? TYPE_LABELS[cfg.type] : '不可用'}` }))),
      detailBody, facts, note, actions);
    root.append(summary, detail);
    disposeGuard = guardInteractive(actions);

    const ui = { body, detailBody, facts, note, actions, sr };
    try {
      if (!cfg.valid) kindInstance = renderInvalid(cfg, ui);
      else if (cfg.type === 'text') kindInstance = renderText(cfg, ui);
      else if (cfg.type === 'clock') kindInstance = renderClock(cfg, ui, context);
      else if (cfg.type === 'weather') kindInstance = renderWeather(cfg, ui, context, root);
      else kindInstance = renderCurrency(cfg, ui, context, root);
    } catch {
      clearElement(body);
      clearElement(detailBody);
      kindInstance = renderInvalid({ ...cfg, reason: '渲染失败' }, ui);
    }
    actions.hidden = !actions.childElementCount;
    summary.title = sr.textContent;
  }

  function teardown() {
    try {
      kindInstance?.destroy?.();
    } catch {
      // ignore
    }
    kindInstance = null;
    disposeGuard?.();
    disposeGuard = null;
  }

  build(readConfig(context));

  return {
    update(data = {}) {
      if (data.config && typeof data.config === 'object') {
        const next = normalizeImportedConfig(data.config);
        if (JSON.stringify(next) !== sig) {
          build(data.config);
          return;
        }
      }
      try {
        kindInstance?.update?.(data);
      } catch {
        // ignore
      }
      const sr = root.querySelector('.ic-sr-only');
      const summary = root.querySelector('.ic-summary');
      if (sr && summary) summary.title = sr.textContent;
    },
    destroy() {
      teardown();
      for (const k of ['icType', 'icPalette', 'icLayout', 'icIcon']) delete root.dataset[k];
      clearElement(root);
      root.classList.remove('ic-card');
    },
  };
}
