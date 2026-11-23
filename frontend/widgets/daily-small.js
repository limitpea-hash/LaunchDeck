import { el, clearElement, setText } from '../lib/dom.js';
import { createWeatherGlyph, resolveWeatherVisualKind } from './summary-helpers.js';
import { getFocusSession } from './focus-session.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86400000;
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SOURCE_LABELS = {
  manual: '手动城市',
  browser: '浏览器定位',
  ip: 'IP 近似位置',
  'network-ip': '网络出口 IP 近似位置',
};
const PHASE_LABELS = { work: '专注', break: '休息' };

const pad = (n) => String(n).padStart(2, '0');
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const stop = (e) => e.stopPropagation();

export function parseIsoDate(value) {
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1000) return null;
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d, t };
}

function todayParts(context) {
  const snap = context.clock?.getSnapshot?.();
  const p = snap?.parts;
  if (p && num(p.year) && num(p.month) && num(p.day)) {
    return { ...p, timeZone: snap.timeZone || '', mode: snap.mode || '' };
  }
  const d = new Date();
  return {
    year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(),
    timeHM: `${pad(d.getHours())}:${pad(d.getMinutes())}`, timeZone: '', mode: '',
  };
}

const dayUtc = (p) => Date.UTC(p.year, p.month - 1, p.day);
const isoKey = (p) => `${p.year}-${pad(p.month)}-${pad(p.day)}`;
const weekdayOf = (t) => WEEK[new Date(t).getUTCDay()];

function isoWeek(t) {
  const d = new Date(t);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS / 7) + 1;
}

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function svgIcon(d) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}
const PLAY_D = 'M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6Z';
const PAUSE_D = 'M7 5h3.4v14H7zM13.6 5H17v14h-3.4z';

function shell(root, type, label) {
  clearElement(root);
  root.classList.add('ios-widget', `widget-${type}`, 'daily-card', `daily-${type}`);
  const summary = el('div', { className: `daily-summary daily-summary-${type}` });
  const detail = el('div', { className: `daily-detail daily-detail-${type}`, role: 'group', 'aria-label': label });
  root.append(summary, detail);
  const cleanup = () => {
    clearElement(root);
    root.classList.remove('daily-card', `daily-${type}`);
  };
  return { summary, detail, cleanup };
}

function fillFacts(dl, rows) {
  clearElement(dl);
  for (const [k, v] of rows) {
    if (v === null || v === undefined || v === '') continue;
    dl.append(el('div', { className: 'daily-fact' }, el('dt', { textContent: k }), el('dd', { textContent: v })));
  }
  dl.hidden = !dl.firstChild;
}

function guardControl(node) {
  node.addEventListener('click', stop);
  node.addEventListener('keydown', stop);
  return node;
}

/* ---------------- Weather badge ---------------- */

export function mountWeatherBadge(root, context) {
  const { summary, detail, cleanup } = shell(root, 'weather-badge', '迷你天气详情');
  let kind = '';
  let lastMinute = '';

  const glyph = el('span', { className: 'daily-wx-glyph', 'aria-hidden': 'true' });
  const temp = el('span', { className: 'daily-wx-temp', 'aria-hidden': 'true', textContent: '--°' });
  const cond = el('span', { className: 'daily-wx-cond daily-optional' });
  const city = el('span', { className: 'daily-wx-city daily-optional' });
  const sr = el('span', { className: 'daily-sr-only' });
  summary.append(
    el('div', { className: 'daily-wx-main' }, glyph, temp),
    el('div', { className: 'daily-wx-meta' }, cond, city),
    sr
  );

  const heroGlyph = el('span', { className: 'daily-wx-glyph is-hero', 'aria-hidden': 'true' });
  const heroTemp = el('div', { className: 'daily-hero-value' });
  const heroCond = el('div', { className: 'daily-hero-caption' });
  const loc = el('div', { className: 'daily-detail-sub' });
  const facts = el('dl', { className: 'daily-facts' });
  const note = el('p', { className: 'daily-note', role: 'status' });
  const retryBtn = guardControl(el('button', { type: 'button', className: 'daily-btn', textContent: '刷新天气' }));
  const setBtn = guardControl(el('button', { type: 'button', className: 'daily-btn is-ghost', textContent: '位置设置' }));
  retryBtn.hidden = typeof context.refreshEnvironmentAndWeather !== 'function';
  setBtn.hidden = typeof context.openSettingsModal !== 'function';
  detail.append(
    el('div', { className: 'daily-hero' }, heroGlyph, el('div', { className: 'daily-hero-text' }, heroTemp, heroCond)),
    loc, facts, note,
    el('div', { className: 'daily-actions' }, retryBtn, setBtn)
  );
  const onRetry = () => context.refreshEnvironmentAndWeather?.(true);
  const onSet = () => context.openSettingsModal?.('location');
  retryBtn.addEventListener('click', onRetry);
  setBtn.addEventListener('click', onSet);

  function render(envArg) {
    const env = (envArg && typeof envArg === 'object' ? envArg : context.getEnvironmentSnapshot?.()) || {};
    const w = env.weather || null;
    const c = w?.current || null;
    const unit = w?.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
    const p = todayParts(context);
    lastMinute = p.timeHM || '';
    const isDay = typeof c?.isDay === 'boolean' ? c.isDay : p.hour >= 6 && p.hour < 18;
    const k = resolveWeatherVisualKind(c?.weatherCode ?? c?.code, isDay);
    if (k !== kind) {
      kind = k;
      for (const n of [glyph, heroGlyph]) {
        clearElement(n);
        n.appendChild(createWeatherGlyph(k));
      }
      root.dataset.weatherKind = k;
    }
    const hasT = num(c?.temperature);
    const condText = String(c?.condition || c?.conditionLabel || '').slice(0, 40);
    const state = hasT || condText
      ? (w?.cache?.stale ? 'stale' : 'live')
      : env.weatherLoading ? 'loading' : 'unavailable';
    root.dataset.weatherState = state;
    root.dataset.dayPhase = isDay ? 'day' : 'night';

    const locName = env.location?.name || '';
    const fallback = state === 'loading' ? '同步中' : env.weatherError ? '暂不可用' : locName ? '暂无数据' : '待定位';
    setText(temp, hasT ? `${Math.round(c.temperature)}°` : '--°');
    setText(cond, condText || fallback);
    setText(city, locName || (state === 'loading' ? '定位中' : '未设置地点'));
    const srText = state === 'loading' || state === 'unavailable'
      ? `天气${fallback}`
      : `${locName || '当前位置'} ${condText || '状况未知'} ${hasT ? `${Math.round(c.temperature)}${unit}` : '温度暂缺'}${state === 'stale' ? '（缓存）' : ''}`;
    setText(sr, srText);
    summary.title = srText;

    setText(heroTemp, hasT ? `${Math.round(c.temperature)}${unit}` : '--');
    setText(heroCond, condText || (state === 'loading' ? '正在同步天气…' : '天气暂不可用'));
    const src = SOURCE_LABELS[env.location?.source] || '';
    setText(loc, [locName || '未设置地点', src].filter(Boolean).join(' · '));

    const d = w?.daily;
    let updated = '';
    const obs = Date.parse(c?.observedAt || w?.observedAt || w?.fetchedAt || '');
    if (Number.isFinite(obs)) {
      try {
        updated = new Intl.DateTimeFormat('zh-CN', {
          hour: '2-digit', minute: '2-digit', hour12: false, ...(p.timeZone ? { timeZone: p.timeZone } : {}),
        }).format(obs);
      } catch {
        updated = '';
      }
    }
    fillFacts(facts, [
      ['体感', num(c?.apparentTemperature) ? `${Math.round(c.apparentTemperature)}${unit}` : ''],
      ['湿度', num(c?.humidity) ? `${Math.round(c.humidity)}%` : ''],
      ['风速', num(c?.windSpeedKmh) ? `${Math.round(c.windSpeedKmh)} km/h` : ''],
      ['最高 / 最低', num(d?.maxTemperature) && num(d?.minTemperature)
        ? `${Math.round(d.maxTemperature)}° / ${Math.round(d.minTemperature)}°` : ''],
      ['更新于', updated],
    ]);
    const noteText = state === 'loading'
      ? '正在同步位置与天气…'
      : state === 'unavailable'
        ? (env.weatherError ? '天气服务暂不可用，可稍后刷新或检查位置设置。' : '尚未获得位置，请在设置中选择城市或允许定位。')
        : state === 'stale' ? '当前显示缓存数据，联网后将自动更新。' : '';
    setText(note, noteText);
    note.hidden = !noteText;
  }

  render();
  const unsubClock = context.clock?.subscribe?.(() => {
    if ((todayParts(context).timeHM || '') !== lastMinute) render();
  });

  return {
    update(data = {}) {
      render(data.environment || data.env);
    },
    destroy() {
      unsubClock?.();
      retryBtn.removeEventListener('click', onRetry);
      setBtn.removeEventListener('click', onSet);
      delete root.dataset.weatherKind;
      delete root.dataset.weatherState;
      delete root.dataset.dayPhase;
      cleanup();
    },
  };
}

/* ---------------- Date tile ---------------- */

export function mountDateTile(root, context) {
  const { summary, detail, cleanup } = shell(root, 'date-tile', '今日日期详情');
  let lastKey = '';

  const month = el('span', { className: 'daily-date-month', 'aria-hidden': 'true' });
  const day = el('span', { className: 'daily-date-day', 'aria-hidden': 'true' });
  const week = el('span', { className: 'daily-date-week daily-tiny-hide', 'aria-hidden': 'true' });
  const extra = el('span', { className: 'daily-date-extra daily-roomy', 'aria-hidden': 'true' });
  const sr = el('span', { className: 'daily-sr-only' });
  summary.append(
    el('div', { className: 'daily-date-page' }, month, el('div', { className: 'daily-date-body' }, day, week)),
    extra, sr
  );

  const heroDay = el('div', { className: 'daily-hero-value' });
  const heroCap = el('div', { className: 'daily-hero-caption' });
  const progress = el('div', { className: 'daily-progress', role: 'progressbar', 'aria-label': '本年进度', 'aria-valuemin': '0', 'aria-valuemax': '100' },
    el('span', { className: 'daily-progress-fill' }));
  const facts = el('dl', { className: 'daily-facts' });
  detail.append(
    el('div', { className: 'daily-hero' }, el('div', { className: 'daily-hero-text' }, heroDay, heroCap)),
    progress, facts
  );

  function render(force = false) {
    const p = todayParts(context);
    const key = `${isoKey(p)}|${p.timeZone}|${p.mode}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const t = dayUtc(p);
    const wd = p.weekdayZh || weekdayOf(t);
    const dow = new Date(t).getUTCDay();
    const yearStart = Date.UTC(p.year, 0, 1);
    const yearDays = Math.round((Date.UTC(p.year + 1, 0, 1) - yearStart) / DAY_MS);
    const doy = Math.round((t - yearStart) / DAY_MS) + 1;
    const pct = Math.round((doy / yearDays) * 100);
    root.dataset.weekend = dow === 0 || dow === 6 ? 'true' : 'false';

    setText(month, `${p.month}月`);
    setText(day, String(p.day));
    setText(week, wd);
    setText(extra, `第 ${doy} 天 · 第 ${isoWeek(t)} 周`);
    const full = `${p.year}年${p.month}月${p.day}日 ${wd}`;
    setText(sr, full);
    summary.title = full;

    setText(heroDay, `${p.month}月${p.day}日`);
    setText(heroCap, `${p.year}年 · ${wd}`);
    progress.setAttribute('aria-valuenow', String(pct));
    progress.style.setProperty('--daily-progress', `${pct}%`);
    fillFacts(facts, [
      ['年内第', `${doy} / ${yearDays} 天`],
      ['ISO 周', `第 ${isoWeek(t)} 周`],
      ['今年剩余', `${yearDays - doy} 天`],
      ['时区', p.mode === 'manual' ? `${p.timeZone || '本地'}（手动校时）` : p.timeZone || '本地时间'],
    ]);
  }

  render(true);
  const unsubClock = context.clock?.subscribe?.(() => render());

  return {
    update() {
      render(true);
    },
    destroy() {
      unsubClock?.();
      delete root.dataset.weekend;
      cleanup();
    },
  };
}

/* ---------------- Countdown ---------------- */

export function normalizeCountdownConfig(raw) {
  const title = typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 60) : '倒计时';
  return { title, targetDate: parseIsoDate(raw?.targetDate) ? raw.targetDate : null };
}

export function mountCountdown(root, context) {
  const { summary, detail, cleanup } = shell(root, 'countdown', '日子倒数设置');
  let config = normalizeCountdownConfig(context.getWidgetConfig?.() ?? context.config);
  let lastKey = '';
  let dirty = false; // user has unsaved edits in the inputs
  let pending = null; // locally applied config awaiting echo from host
  let saveToken = 0;

  const title = el('span', { className: 'daily-cd-title daily-optional' });
  const caption = el('span', { className: 'daily-cd-caption', 'aria-hidden': 'true' });
  const value = el('span', { className: 'daily-cd-value', 'aria-hidden': 'true' });
  const unit = el('span', { className: 'daily-cd-unit', 'aria-hidden': 'true' });
  const dateChip = el('span', { className: 'daily-cd-date daily-roomy', 'aria-hidden': 'true' });
  const sr = el('span', { className: 'daily-sr-only' });
  summary.append(
    title,
    el('div', { className: 'daily-cd-main' }, caption, el('span', { className: 'daily-cd-figure' }, value, unit)),
    dateChip, sr
  );

  const heroValue = el('div', { className: 'daily-hero-value' });
  const heroCap = el('div', { className: 'daily-hero-caption' });
  const titleInput = el('input', { type: 'text', className: 'daily-input', maxlength: '60', required: 'true', autocomplete: 'off', name: 'title' });
  const dateInput = el('input', { type: 'date', className: 'daily-input', name: 'targetDate', min: '1000-01-01', max: '9999-12-31' });
  const saveBtn = el('button', { type: 'submit', className: 'daily-btn', textContent: '保存' });
  const clearBtn = el('button', { type: 'button', className: 'daily-btn is-ghost', textContent: '清除日期' });
  const status = el('p', { className: 'daily-note', role: 'status', hidden: true });
  const form = el('form', { className: 'daily-form', novalidate: 'true' },
    el('label', { className: 'daily-field' }, el('span', { textContent: '标题' }), titleInput),
    el('label', { className: 'daily-field' }, el('span', { textContent: '目标日期' }), dateInput),
    el('div', { className: 'daily-actions' }, saveBtn, clearBtn),
    status);
  detail.append(el('div', { className: 'daily-hero' }, el('div', { className: 'daily-hero-text' }, heroValue, heroCap)), form);
  for (const evt of ['click', 'keydown', 'pointerdown', 'input']) form.addEventListener(evt, stop);

  function setStatus(text, isError = false) {
    setText(status, text);
    status.hidden = !text;
    status.classList.toggle('is-error', isError);
  }

  function fillInputs() {
    if (dirty || form.contains(document.activeElement)) return;
    titleInput.value = config.title;
    dateInput.value = config.targetDate || '';
  }

  function render(force = false) {
    const p = todayParts(context);
    const key = `${isoKey(p)}|${config.title}|${config.targetDate}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const target = parseIsoDate(config.targetDate);
    let state = 'unset';
    let diff = 0;
    if (target) {
      diff = Math.round((target.t - dayUtc(p)) / DAY_MS);
      state = diff > 0 ? 'future' : diff === 0 ? 'today' : 'past';
    }
    root.dataset.countdownState = state;
    const abs = Math.abs(diff);
    root.dataset.cdDigits = String(state === 'future' || state === 'past' ? String(abs).length : 1);
    setText(title, config.title);
    setText(caption, { unset: '未设日期', today: '就是', future: '还有', past: '已过' }[state]);
    setText(value, state === 'unset' ? '+' : state === 'today' ? '今天' : String(abs));
    setText(unit, state === 'future' || state === 'past' ? '天' : '');
    const dateText = target ? `${target.y}.${pad(target.mo)}.${pad(target.d)} ${weekdayOf(target.t)}` : '';
    setText(dateChip, dateText || '点按设置');
    const srText = state === 'unset'
      ? `${config.title}：尚未设置日期，打开详情设置`
      : state === 'today' ? `${config.title}：就是今天` : `${config.title}：${state === 'future' ? '还有' : '已过'} ${abs} 天（${dateText}）`;
    setText(sr, srText);
    summary.title = srText;

    setText(heroValue, state === 'unset' ? '未设置' : state === 'today' ? '今天' : `${abs} 天`);
    setText(heroCap, state === 'unset'
      ? `${config.title} · 选择一个日期开始倒数`
      : `${config.title} · ${state === 'past' ? '已过' : state === 'future' ? '距离' : ''} ${dateText}`.replace(/\s+/g, ' '));
    fillInputs();
  }

  function persist(next) {
    const token = ++saveToken;
    config = next;
    pending = next;
    dirty = false;
    lastKey = '';
    render(true);
    if (typeof context.saveWidgetConfig !== 'function') {
      setStatus('已在本页更新，当前未连接保存');
      return;
    }
    let result;
    try {
      result = context.saveWidgetConfig({ ...next });
    } catch {
      setStatus('已在本页更新，但保存请求未能提交', true);
      return;
    }
    if (result && typeof result.then === 'function') {
      setStatus('已在本页更新，正在提交保存…');
      result.then(
        () => {
          if (token === saveToken) setStatus('已在本页更新，保存请求已完成');
        },
        () => {
          if (token === saveToken) setStatus('保存失败，本页仍保留你的修改，可稍后重试', true);
        }
      );
    } else {
      setStatus('已在本页更新，保存已排队提交');
    }
  }

  const onSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = titleInput.value.trim();
    if (t.length < 1 || t.length > 60) {
      setStatus('标题需为 1–60 个字符', true);
      return;
    }
    const d = dateInput.value.trim();
    if (d && !parseIsoDate(d)) {
      setStatus('请选择有效日期', true);
      return;
    }
    persist({ title: t, targetDate: d || null });
  };
  const onClear = () => {
    dateInput.value = '';
    const t = titleInput.value.trim();
    persist({ title: t && t.length <= 60 ? t : config.title, targetDate: null });
  };
  const onEdit = () => {
    dirty = true;
    if (!status.classList.contains('is-error')) setStatus('');
  };
  form.addEventListener('submit', onSubmit);
  form.addEventListener('input', onEdit);
  clearBtn.addEventListener('click', onClear);

  render(true);
  const unsubClock = context.clock?.subscribe?.(() => render());

  return {
    update(data = {}) {
      if (data.config && typeof data.config === 'object') {
        const incoming = normalizeCountdownConfig(data.config);
        const same = (a, b) => a.title === b.title && a.targetDate === b.targetDate;
        if (pending) {
          // Ignore stale echoes until the host reflects the locally applied config.
          if (same(incoming, pending)) pending = null;
        } else {
          config = incoming;
        }
      }
      render(true);
    },
    destroy() {
      unsubClock?.();
      saveToken += 1;
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('input', onEdit);
      delete root.dataset.cdDigits;
      clearBtn.removeEventListener('click', onClear);
      for (const evt of ['click', 'keydown', 'pointerdown', 'input']) form.removeEventListener(evt, stop);
      delete root.dataset.countdownState;
      cleanup();
    },
  };
}

/* ---------------- Focus launcher ---------------- */

function resolveFocusTarget(context) {
  let list = [];
  try {
    const l = context.getLayout?.();
    list = Array.isArray(l) ? l : Array.isArray(l?.widgets) ? l.widgets : Array.isArray(l?.layout) ? l.layout : [];
  } catch {
    list = [];
  }
  const timers = list.filter((w) => w && w.type === 'focus-timer');
  const pick = timers.find((w) => w.enabled) || timers[0] || null;
  let config = pick?.config;
  if (!config || typeof config !== 'object') {
    try {
      config = context.getWidgetConfigByType?.('focus-timer');
    } catch {
      config = undefined;
    }
  }
  return {
    id: typeof pick?.id === 'string' && pick.id ? pick.id : 'focus-timer',
    config: config && typeof config === 'object' ? config : undefined,
    linked: Boolean(pick),
  };
}

export function mountFocusLauncher(root, context) {
  const { summary, detail, cleanup } = shell(root, 'focus-launcher', '一键专注详情');
  let target = resolveFocusTarget(context);
  let configSig = JSON.stringify(target.config ?? null);
  let session = null;
  try {
    session = getFocusSession(target.id, target.config);
  } catch {
    session = null;
  }
  let lastRunning = null;

  const playIcon = el('span', { className: 'daily-focus-icon' });
  const playBtn = guardControl(el('button', { type: 'button', className: 'daily-focus-play', 'aria-pressed': 'false' },
    el('span', { className: 'daily-focus-ring', 'aria-hidden': 'true' }), playIcon));
  const time = el('span', { className: 'daily-focus-time' });
  const phase = el('span', { className: 'daily-focus-phase daily-optional' });
  summary.append(playBtn, el('div', { className: 'daily-focus-meta' }, time, phase));

  const heroTime = el('div', { className: 'daily-hero-value daily-focus-hero-time', role: 'timer', 'aria-live': 'off' });
  const heroCap = el('div', { className: 'daily-hero-caption' });
  const workBtn = guardControl(el('button', { type: 'button', className: 'daily-seg', dataset: { phase: 'work' }, textContent: '专注' }));
  const breakBtn = guardControl(el('button', { type: 'button', className: 'daily-seg', dataset: { phase: 'break' }, textContent: '休息' }));
  const toggleBtn = guardControl(el('button', { type: 'button', className: 'daily-btn' }));
  const resetBtn = guardControl(el('button', { type: 'button', className: 'daily-btn is-ghost', textContent: '重置' }));
  const linkNote = el('p', { className: 'daily-note' });
  detail.append(
    el('div', { className: 'daily-segs', role: 'group', 'aria-label': '阶段' }, workBtn, breakBtn),
    el('div', { className: 'daily-hero' }, el('div', { className: 'daily-hero-text' }, heroTime, heroCap)),
    el('div', { className: 'daily-actions' }, toggleBtn, resetBtn),
    linkNote
  );

  function readState() {
    const s = session?.getState?.() || {};
    const total = Math.max(0, Number(s.totalSeconds) || 0);
    const rem = Math.max(0, Number(s.remainingSeconds) || 0);
    return { phase: s.phase === 'break' ? 'break' : 'work', running: Boolean(s.running), total, rem: total ? Math.min(rem, total) : rem };
  }

  function render() {
    const s = readState();
    const pct = s.total ? (1 - s.rem / s.total) * 100 : 0;
    const label = PHASE_LABELS[s.phase];
    const paused = !s.running && s.total > 0 && s.rem > 0 && s.rem < s.total;
    const action = s.running ? '暂停' : paused ? '继续' : '开始';
    root.dataset.focusPhase = s.phase;
    root.dataset.focusRunning = s.running ? 'true' : 'false';
    root.style.setProperty('--daily-progress', `${pct.toFixed(1)}%`);
    if (s.running !== lastRunning) {
      lastRunning = s.running;
      clearElement(playIcon);
      playIcon.appendChild(svgIcon(s.running ? PAUSE_D : PLAY_D));
    }
    const clock = fmtClock(s.rem);
    setText(time, clock);
    setText(phase, s.running ? `${label}中` : paused ? '已暂停' : label);
    playBtn.setAttribute('aria-pressed', s.running ? 'true' : 'false');
    playBtn.setAttribute('aria-label', `${action}${label}，剩余 ${clock}`);
    playBtn.title = `${action}${label}`;
    playBtn.disabled = !session;
    setText(heroTime, clock);
    setText(heroCap, session ? `${label}${s.running ? '进行中' : paused ? ' · 已暂停' : ''}` : '专注模块暂不可用');
    setText(toggleBtn, action);
    toggleBtn.disabled = !session;
    resetBtn.disabled = !session;
    for (const b of [workBtn, breakBtn]) {
      const on = b.dataset.phase === s.phase;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.disabled = !session;
    }
    setText(linkNote, target.linked ? '与专注计时器共享时长和当前会话' : '独立会话，使用默认时长');
  }

  const onToggle = () => session?.toggle?.();
  const onReset = () => session?.reset?.();
  const onPhase = (e) => session?.setPhase?.(e.currentTarget.dataset.phase === 'break' ? 'break' : 'work');
  playBtn.addEventListener('click', onToggle);
  toggleBtn.addEventListener('click', onToggle);
  resetBtn.addEventListener('click', onReset);
  workBtn.addEventListener('click', onPhase);
  breakBtn.addEventListener('click', onPhase);

  let unsub = null;
  try {
    unsub = session?.subscribe?.(render) || null;
  } catch {
    unsub = null;
  }
  render();

  return {
    update() {
      const next = resolveFocusTarget(context);
      const sig = JSON.stringify(next.config ?? null);
      if (next.id === target.id && sig !== configSig && next.config) {
        try {
          session?.setConfig?.(next.config);
        } catch {
          // keep current session untouched
        }
      }
      if (next.id === target.id) {
        target = next;
        configSig = sig;
      }
      render();
    },
    destroy() {
      try {
        unsub?.();
      } catch {
        // ignore
      }
      playBtn.removeEventListener('click', onToggle);
      toggleBtn.removeEventListener('click', onToggle);
      resetBtn.removeEventListener('click', onReset);
      workBtn.removeEventListener('click', onPhase);
      breakBtn.removeEventListener('click', onPhase);
      root.style.removeProperty('--daily-progress');
      delete root.dataset.focusPhase;
      delete root.dataset.focusRunning;
      cleanup();
    },
  };
}
