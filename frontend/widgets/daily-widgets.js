import { el, clearElement, setText, isSafeIdentifier } from '../lib/dom.js';
import { getTimePartsInZone } from '../lib/time.js';
import { createWeatherGlyph, resolveWeatherVisualKind } from './summary-helpers.js';

// ---------- shared helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const MAX_HABITS = 8;
const MAX_DATES = 90;
const HOURLY_LIMIT = 6;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function isRealDate(s) {
  const m = typeof s === 'string' && DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const keyToUtc = (k) => { const m = DATE_RE.exec(k); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
const utcToKey = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const shiftKey = (k, days) => utcToKey(keyToUtc(k) + days * 86400000);
const dayDiff = (from, to) => Math.round((keyToUtc(to) - keyToUtc(from)) / 86400000);
const weekdayOf = (k) => WEEK_ZH[new Date(keyToUtc(k)).getUTCDay()];

function todayKey(context) {
  const p = context.clock.getSnapshot().parts;
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function isInDetail(root) {
  return root.classList.contains('widget-in-detail-modal') || Boolean(root.closest?.('.widget-in-detail-modal'));
}

function stop(e) { e.stopPropagation(); }

// Keyboard activation (Enter/Space) on our controls must not reach the card/host handlers.
function stopActivationKeys(e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('[data-action], form, input, button')) {
    e.stopPropagation();
  }
}

const EDIT_MODE_SEL = '.is-editing, .is-edit-mode, .edit-mode, .jiggle-mode, .is-jiggling, [data-edit-mode="true"], [data-editing="true"]';
function inEditMode(root) {
  return Boolean(root.closest?.(EDIT_MODE_SEL));
}

// Rebuilds DOM while preserving keyboard focus on the equivalent [data-action] control.
function withFocus(root, fn) {
  const active = document.activeElement;
  const key = active && root.contains(active) && active.dataset?.action
    ? [active.dataset.action, active.dataset.id || ''] : null;
  fn();
  if (key && !root.contains(active)) {
    const next = Array.from(root.querySelectorAll('[data-action]'))
      .find((n) => n.dataset.action === key[0] && (n.dataset.id || '') === key[1]);
    next?.focus({ preventScroll: true });
  }
}

function makeSigCache() {
  const sigs = new Map();
  return (name, value) => {
    const sig = JSON.stringify(value);
    if (sigs.get(name) === sig) return false;
    sigs.set(name, sig);
    return true;
  };
}

function readConfig(context) {
  return context.config || context.getWidgetConfig?.() || {};
}

function header(kicker, accent, iconNode) {
  const meta = el('span', { className: 'dw-head-meta', textContent: '' });
  const head = el(
    'div',
    { className: 'dw-head' },
    el('span', { className: `dw-head-icon ${accent}`, 'aria-hidden': 'true' }, iconNode),
    el('span', { className: 'dw-head-title', textContent: kicker }),
    meta
  );
  return { head, meta };
}

function svgIcon(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 20 20', width: '14', height: '14', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

function stateBox(kind, title, desc, actionLabel, action) {
  const box = el(
    'div',
    { className: `dw-state is-${kind}`, role: 'status' },
    el('span', { className: 'dw-state-title', textContent: title }),
    desc ? el('span', { className: 'dw-state-desc dw-opt', textContent: desc }) : null
  );
  if (actionLabel) {
    box.appendChild(el('button', { type: 'button', className: 'widget-inline-btn dw-state-btn', dataset: { action }, textContent: actionLabel }));
  }
  return box;
}

// ---------- weather helpers (mirrors clock-weather.js hourly semantics) ----------
export function collectUpcomingHourly(weather, fallbackTimeZone, nowMs = Date.now(), limit = HOURLY_LIMIT) {
  const list = Array.isArray(weather?.hourly) ? weather.hourly : [];
  const timeZone = weather?.timeZone || fallbackTimeZone;
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const epoch = Date.parse(entry.forecastAt);
    if (!Number.isFinite(epoch) || epoch <= nowMs) continue;
    let parts = null;
    try { parts = getTimePartsInZone(epoch, timeZone); } catch { parts = null; }
    if (!parts?.timeHM) continue;
    const isDay = typeof entry.isDay === 'boolean' ? entry.isDay : parts.hour >= 6 && parts.hour < 18;
    out.push({
      epoch,
      label: parts.timeHM,
      kind: resolveWeatherVisualKind(entry.weatherCode, isDay),
      temp: isNum(entry.temperature) ? Math.round(entry.temperature) : null,
      condition: typeof entry.condition === 'string' ? entry.condition.trim().slice(0, 40) : '',
      pop: isNum(entry.precipitationProbability) ? Math.round(Math.min(100, Math.max(0, entry.precipitationProbability))) : null,
    });
  }
  return out.sort((a, b) => a.epoch - b.epoch).slice(0, limit);
}

function weatherView(env, snap) {
  const weather = env?.weather || null;
  const cur = weather?.current || null;
  const unit = weather?.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
  const isDay = typeof cur?.isDay === 'boolean' ? cur.isDay : snap.parts.hour >= 6 && snap.parts.hour < 18;
  const temp = isNum(cur?.temperature) ? `${Math.round(cur.temperature)}${unit}` : null;
  const cond = cur?.condition || cur?.conditionLabel || '';
  let state = 'live';
  if (!cur || (!temp && !cond)) {
    state = env?.weatherLoading ? 'loading' : !env?.location ? 'no-location' : 'unavailable';
  } else if (weather?.cache?.stale) state = 'stale';
  const daily = weather?.daily;
  return {
    state,
    temp,
    cond,
    kind: resolveWeatherVisualKind(cur?.weatherCode ?? cur?.code, isDay),
    place: env?.location?.name || '',
    range: daily && isNum(daily.maxTemperature) && isNum(daily.minTemperature)
      ? `${Math.round(daily.minTemperature)}° / ${Math.round(daily.maxTemperature)}°` : '',
    error: env?.weatherError || '',
    hourly: weather ? collectUpcomingHourly(weather, snap.timeZone) : [],
  };
}

function weatherStateBox(view) {
  if (view.state === 'loading') return stateBox('loading', '天气同步中…', '正在读取位置与实况');
  if (view.state === 'no-location') return stateBox('empty', '未设置天气地点', '在设置中选择城市或开启定位', '设置', 'open-location');
  return stateBox('error', '天气暂不可用', view.error || '稍后重试或更换城市', '重试', 'retry-weather');
}

function glyph(kind, cls = 'dw-glyph') {
  return el('span', { className: cls, 'aria-hidden': 'true', dataset: { weatherKind: kind } }, createWeatherGlyph(kind));
}

function hourCell(item, withPop) {
  const tempText = item.temp === null ? '--°' : `${item.temp}°`;
  const aria = [item.label, item.condition || '天气未知', tempText];
  if (item.pop !== null) aria.push(`降水概率 ${item.pop}%`);
  const cell = el(
    'div',
    { className: 'dw-hour', role: 'listitem', 'aria-label': aria.join(' ') },
    el('span', { className: 'dw-hour-time', 'aria-hidden': 'true', textContent: item.label }),
    glyph(item.kind, 'dw-hour-icon'),
    el('span', { className: 'dw-hour-temp', 'aria-hidden': 'true', textContent: tempText })
  );
  if (withPop) {
    cell.append(
      el('span', { className: 'dw-hour-pop', 'aria-hidden': 'true', textContent: item.pop === null ? '—' : `降水 ${item.pop}%` }),
      el('span', { className: 'dw-hour-cond', 'aria-hidden': 'true', textContent: item.condition || '—' })
    );
  }
  return cell;
}

function weatherActions(context) {
  return (action) => {
    if (action === 'open-location') { context.openSettingsModal?.('location'); return true; }
    if (action === 'retry-weather') { context.refreshEnvironmentAndWeather?.(true); return true; }
    return false;
  };
}

// ---------- habits ----------
const HABIT_HUES = [152, 205, 265, 330, 28, 48, 180, 230];

function newHabitId(taken) {
  let id;
  do {
    id = `habit-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(id));
  return id;
}

export function normalizeHabits(input) {
  const list = Array.isArray(input) ? input : [];
  const ids = new Set();
  const out = [];
  for (const raw of list) {
    if (out.length >= MAX_HABITS) break;
    if (!raw || typeof raw !== 'object') continue;
    const title = String(raw.title ?? '').trim().slice(0, 60);
    if (!title) continue;
    let id = isSafeIdentifier(raw.id) ? raw.id : '';
    if (!id || ids.has(id)) id = newHabitId(ids);
    ids.add(id);
    const dates = Array.from(new Set((Array.isArray(raw.checkedDates) ? raw.checkedDates : []).filter(isRealDate)))
      .sort()
      .reverse()
      .slice(0, MAX_DATES);
    out.push({ id, title, checkedDates: dates });
  }
  return out;
}

function streakOf(dates, today) {
  const set = new Set(dates);
  let k = set.has(today) ? today : shiftKey(today, -1);
  let n = 0;
  while (set.has(k)) { n += 1; k = shiftKey(k, -1); }
  return n;
}

export function mountHabits(root, context) {
  clearElement(root);
  root.classList.add('ios-widget', 'widget-habits', 'dw-card');
  let habits = normalizeHabits(readConfig(context).habits);
  let lastDay = '';
  let lastSig = '';

  const { head, meta } = header('习惯打卡', 'is-habits', svgIcon('M4 10.5l3.5 3.5L16 5.5'));
  const weekRow = el('div', { className: 'dw-habit-weekrow', 'aria-hidden': 'true' });
  const list = el('div', { className: 'dw-habit-list', role: 'list', 'aria-label': '习惯列表' });
  const input = el('input', { type: 'text', className: 'dw-input', maxLength: 60, placeholder: '新习惯，如：喝水 8 杯', 'aria-label': '新习惯名称' });
  const addBtn = el('button', { type: 'submit', className: 'widget-inline-btn dw-add-btn', textContent: '添加' });
  const hint = el('span', { className: 'dw-form-hint', textContent: '' });
  const form = el('form', { className: 'dw-habit-form dw-detail-only' }, input, addBtn, hint);
  root.append(head, weekRow, list, form, el('span', { className: 'widget-label', textContent: '习惯打卡' }));

  function save(next) {
    habits = normalizeHabits(next);
    render();
    context.saveWidgetConfig?.({ habits: habits.map((h) => ({ ...h, checkedDates: [...h.checkedDates] })) });
  }

  function render() {
    const today = todayKey(context);
    const sig = `${today}|${JSON.stringify(habits)}`;
    if (sig === lastSig) return;
    lastSig = sig;
    lastDay = today;
    withFocus(root, () => draw(today));
  }

  function draw(today) {
    const days = Array.from({ length: 7 }, (_, i) => shiftKey(today, i - 6));
    const doneToday = habits.filter((h) => h.checkedDates.includes(today)).length;
    setText(meta, habits.length ? `今日 ${doneToday}/${habits.length}` : '');
    root.dataset.state = habits.length ? 'ready' : 'empty';
    const full = habits.length >= MAX_HABITS;
    input.disabled = full;
    addBtn.disabled = full;
    setText(hint, full ? `最多 ${MAX_HABITS} 项` : `${habits.length}/${MAX_HABITS}`);

    clearElement(weekRow);
    const dows = el('span', { className: 'dw-habit-dots' });
    for (const d of days) dows.append(el('span', { className: `dw-habit-dow${d === today ? ' is-today' : ''}`, textContent: weekdayOf(d) }));
    weekRow.append(el('span', { className: 'dw-habit-weekrow-pad' }), dows, el('span', { className: 'dw-habit-weekrow-end' }));
    weekRow.hidden = habits.length === 0;

    clearElement(list);
    if (!habits.length) {
      list.append(stateBox('empty', '还没有习惯', '打开详情添加最多 8 个每日习惯'));
      return;
    }
    habits.forEach((h, idx) => {
      const set = new Set(h.checkedDates);
      const checked = set.has(today);
      const weekCount = days.filter((d) => set.has(d)).length;
      const row = el('div', { className: `dw-habit${checked ? ' is-done' : ''}`, role: 'listitem' });
      row.style.setProperty('--habit-hue', String(HABIT_HUES[idx % HABIT_HUES.length]));
      const dotWrap = el('span', { className: 'dw-habit-dots', role: 'img', 'aria-label': `近 7 天完成 ${weekCount} 天` });
      for (const d of days) dotWrap.append(el('span', { className: `dw-habit-dot${set.has(d) ? ' is-on' : ''}${d === today ? ' is-today' : ''}`, title: `${d}${set.has(d) ? ' 已完成' : ''}` }));
      const streak = streakOf(h.checkedDates, today);
      row.append(
        el('span', { className: 'dw-habit-name' },
          el('span', { className: 'dw-habit-title', textContent: h.title }),
          el('span', { className: 'dw-habit-sub dw-opt', textContent: streak ? `连续 ${streak} 天 · 本周 ${weekCount}/7` : `本周 ${weekCount}/7` })),
        dotWrap,
        el('button', {
          type: 'button',
          className: 'dw-habit-check',
          dataset: { action: 'toggle', id: h.id },
          'aria-pressed': checked ? 'true' : 'false',
          'aria-label': `${checked ? '取消' : '完成'}今日：${h.title}`,
          textContent: checked ? '✓' : '',
        }),
        el('button', { type: 'button', className: 'dw-habit-remove dw-detail-only', dataset: { action: 'remove', id: h.id }, 'aria-label': `删除习惯：${h.title}`, textContent: '删除' })
      );
      list.append(row);
    });
  }

  const onClick = (e) => {
    const btn = e.target.closest?.('[data-action]');
    if (!btn || !root.contains(btn) || inEditMode(root)) return;
    e.stopPropagation();
    const id = btn.dataset.id;
    const today = todayKey(context);
    if (btn.dataset.action === 'toggle') {
      save(habits.map((h) => h.id !== id ? h : {
        ...h,
        checkedDates: h.checkedDates.includes(today) ? h.checkedDates.filter((d) => d !== today) : [today, ...h.checkedDates],
      }));
    } else if (btn.dataset.action === 'remove') {
      save(habits.filter((h) => h.id !== id));
    }
  };
  const onSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const title = input.value.trim().slice(0, 60);
    if (!title || habits.length >= MAX_HABITS) { setText(hint, title ? `最多 ${MAX_HABITS} 项` : '请输入名称'); return; }
    input.value = '';
    save([...habits, { id: newHabitId(new Set(habits.map((h) => h.id))), title, checkedDates: [] }]);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', stopActivationKeys);
  root.addEventListener('keyup', stopActivationKeys);
  form.addEventListener('submit', onSubmit);
  form.addEventListener('click', stop);
  input.addEventListener('keydown', stop);

  render();
  const unsubClock = context.clock.subscribe(() => { if (todayKey(context) !== lastDay) render(); });

  return {
    update(data = {}) {
      if (data.config && Array.isArray(data.config.habits)) habits = normalizeHabits(data.config.habits);
      render();
    },
    destroy() {
      unsubClock?.();
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', stopActivationKeys);
      root.removeEventListener('keyup', stopActivationKeys);
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('click', stop);
      input.removeEventListener('keydown', stop);
      clearElement(root);
    },
  };
}

// ---------- today dashboard ----------
function todoStats(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.todos) ? raw.todos : null;
  if (!list) return null;
  const isDone = (t) => Boolean(t?.done ?? t?.completed ?? (t?.status === 'done' || t?.status === 'completed'));
  const open = list.filter((t) => t && !isDone(t));
  return {
    total: list.length,
    done: list.length - open.length,
    next: open.slice(0, 3).map((t) => String(t.text ?? t.title ?? '').trim()).filter(Boolean),
  };
}

export function nearestCountdown(layout, today) {
  let best = null;
  for (const item of Array.isArray(layout) ? layout : []) {
    if (item?.type !== 'countdown' || item.enabled === false) continue;
    const target = item.config?.targetDate;
    if (!isRealDate(target)) continue;
    const days = dayDiff(today, target);
    if (days < 0) continue;
    if (!best || days < best.days) best = { days, target, title: String(item.config?.title || '倒计时').slice(0, 60) };
  }
  return best;
}

export function mountTodayDashboard(root, context) {
  clearElement(root);
  root.classList.add('ios-widget', 'widget-today-dashboard', 'dw-card');
  let env = context.getEnvironmentSnapshot?.() || null;
  let todos = context.getTodos?.();
  let layout = context.getLayout?.();
  const handleWeather = weatherActions(context);

  const { head, meta } = header('今日面板', 'is-today', svgIcon('M3 5h14v12H3zM3 9h14M7 3v3M13 3v3'));
  const dateBig = el('div', { className: 'dw-today-date' });
  const dateSub = el('div', { className: 'dw-today-sub' });
  const weatherBox = el('div', { className: 'dw-today-weather' });
  const hourly = el('div', { className: 'dw-hours dw-today-hours', role: 'list', 'aria-label': '未来几小时天气' });
  const todoBox = el('div', { className: 'dw-today-todo' });
  const cdBox = el('div', { className: 'dw-today-countdown' });
  root.append(
    head,
    el('div', { className: 'dw-today-top' }, el('div', { className: 'dw-today-datecol' }, dateBig, dateSub), weatherBox),
    hourly,
    el('div', { className: 'dw-today-bottom' }, todoBox, cdBox),
    el('span', { className: 'widget-label', textContent: '今日面板' })
  );

  const changed = makeSigCache();

  function renderWeather(snap, detail) {
    const v = weatherView(env, snap);
    if (!changed('weather', [v, detail])) return;
    root.dataset.weatherState = v.state;
    clearElement(weatherBox);
    clearElement(hourly);
    if (v.state === 'live' || v.state === 'stale') {
      weatherBox.append(
        glyph(v.kind, 'dw-today-glyph'),
        el('div', { className: 'dw-today-wtext' },
          el('span', { className: 'dw-today-temp', textContent: v.temp || '--°' }),
          el('span', { className: 'dw-today-cond', textContent: [v.cond, v.state === 'stale' ? '缓存' : ''].filter(Boolean).join(' · ') || '状况未知' }),
          el('span', { className: 'dw-today-place dw-opt', textContent: [v.place, v.range].filter(Boolean).join(' · ') }))
      );
    } else {
      weatherBox.append(weatherStateBox(v));
    }
    // Always render every upcoming slot (max 6); size/container CSS decides how many fit
    // (3×3: six across, 2×2: three, small 3×3: four). Details show all six with precipitation.
    hourly.hidden = v.hourly.length === 0;
    hourly.dataset.count = String(v.hourly.length);
    for (const item of v.hourly) hourly.append(hourCell(item, detail));
  }

  function renderTodos(detail) {
    const s = todoStats(todos);
    if (!changed('todos', [s, detail])) return;
    clearElement(todoBox);
    const title = el('span', { className: 'dw-sec-title', textContent: '待办' });
    root.dataset.todoState = !s ? 'error' : !s.total ? 'empty' : 'ready';
    if (!s) { todoBox.append(title, stateBox('error', '待办暂不可用', '稍后在待办组件中重试')); return; }
    if (!s.total) { todoBox.append(title, stateBox('empty', '今天没有待办', '在待办组件中添加')); return; }
    const pending = s.total - s.done;
    const pct = Math.round((s.done / s.total) * 100);
    const fill = el('span', { className: 'dw-bar-fill' });
    fill.style.width = `${pct}%`;
    todoBox.append(
      el('div', { className: 'dw-today-todo-head' },
        title,
        el('span', { className: 'dw-today-todo-count', 'aria-label': `已完成 ${s.done} 项，共 ${s.total} 项` },
          el('b', { textContent: `${s.done}/${s.total}` }),
          el('small', { className: 'dw-today-todo-left', textContent: pending ? ` 剩 ${pending}` : ' 全部完成' }))),
      el('span', { className: 'dw-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': `待办完成 ${pct}%` }, fill)
    );
    // Up to three pending entries are always rendered; CSS trims rows on 2×2 / small 3×3.
    if (s.next.length) {
      const ul = el('ul', { className: 'dw-today-todo-next', 'aria-label': `未完成待办，共 ${pending} 项` });
      for (const t of s.next) ul.append(el('li', { textContent: t, title: t }));
      todoBox.append(ul);
    }
  }

  function renderCountdown(today) {
    const cd = nearestCountdown(layout, today);
    if (!changed('countdown', cd)) return;
    clearElement(cdBox);
    cdBox.append(el('span', { className: 'dw-sec-title', textContent: '倒数' }));
    if (!cd) { cdBox.append(stateBox('empty', '暂无倒数日', '添加“日子倒数”并设定日期')); return; }
    cdBox.append(
      el('span', { className: 'dw-today-cd-days' },
        el('b', { textContent: cd.days === 0 ? '今天' : cd.days === 1 ? '明天' : String(cd.days) }),
        cd.days > 1 ? el('small', { textContent: ' 天' }) : null),
      el('span', { className: 'dw-today-cd-title', textContent: cd.title }),
      el('span', { className: 'dw-today-cd-date dw-opt', textContent: `${cd.target.slice(5)} 周${weekdayOf(cd.target)}` })
    );
  }

  function render() {
    const snap = context.clock.getSnapshot();
    const p = snap.parts;
    const today = todayKey(context);
    const detail = isInDetail(root);
    setText(dateBig, `${p.month}月${p.day}日`);
    setText(dateSub, `${p.weekdayZh || `周${weekdayOf(today)}`} · ${p.timeHM || '--:--'}${snap.mode === 'manual' ? ' · 手动' : ''}`);
    setText(meta, String(p.year));
    withFocus(root, () => {
      renderWeather(snap, detail);
      renderTodos(detail);
      renderCountdown(today);
    });
  }

  const onClick = (e) => {
    const btn = e.target.closest?.('[data-action]');
    if (!btn || !root.contains(btn) || inEditMode(root)) return;
    if (handleWeather(btn.dataset.action)) e.stopPropagation();
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', stopActivationKeys);
  root.addEventListener('keyup', stopActivationKeys);

  render();
  const unsubClock = context.clock.subscribe(render);
  const timerId = setInterval(render, 30000);

  return {
    update(data = {}) {
      env = data.environment || context.getEnvironmentSnapshot?.() || env;
      todos = data.todos ?? context.getTodos?.() ?? todos;
      layout = data.layout ?? context.getLayout?.() ?? layout;
      render();
    },
    destroy() {
      clearInterval(timerId);
      unsubClock?.();
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', stopActivationKeys);
      root.removeEventListener('keyup', stopActivationKeys);
      clearElement(root);
    },
  };
}

// ---------- weather strip ----------
export function mountWeatherStrip(root, context) {
  clearElement(root);
  root.classList.add('ios-widget', 'widget-weather-strip', 'dw-card');
  let env = context.getEnvironmentSnapshot?.() || null;
  let lastSig = null;
  const handleWeather = weatherActions(context);

  const nowBox = el('div', { className: 'dw-strip-now' });
  const hours = el('div', { className: 'dw-hours dw-strip-hours', role: 'list', 'aria-label': '未来六小时天气' });
  root.append(
    el('div', { className: 'dw-strip-body' }, nowBox, hours),
    el('span', { className: 'widget-label', textContent: '逐小时天气' })
  );

  function render() {
    const snap = context.clock.getSnapshot();
    const v = weatherView(env, snap);
    const detail = isInDetail(root);
    const sig = JSON.stringify([v.state, v.temp, v.cond, v.kind, v.place, v.range, v.error, detail, v.hourly.map((h) => [h.epoch, h.temp, h.kind, h.pop, h.condition])]);
    if (sig === lastSig) return;
    lastSig = sig;
    withFocus(root, () => draw(v, detail));
  }

  function draw(v, detail) {
    root.dataset.weatherState = v.state;
    clearElement(nowBox);
    clearElement(hours);
    if (v.state !== 'live' && v.state !== 'stale') {
      nowBox.append(weatherStateBox(v));
      hours.hidden = true;
      return;
    }
    nowBox.append(
      glyph(v.kind, 'dw-strip-glyph'),
      el('div', { className: 'dw-strip-nowtext' },
        el('span', { className: 'dw-strip-temp', textContent: v.temp || '--°' }),
        el('span', { className: 'dw-strip-place', textContent: v.place || v.cond || '当前位置' }),
        el('span', { className: 'dw-strip-cond dw-opt', textContent: [v.place ? v.cond : '', v.range, v.state === 'stale' ? '缓存' : ''].filter(Boolean).join(' · ') }))
    );
    hours.hidden = false;
    if (!v.hourly.length) {
      hours.append(stateBox('empty', '暂无逐小时预报', '等待下一次天气刷新'));
      return;
    }
    v.hourly.forEach((item, i) => {
      const cell = hourCell(item, detail);
      if (i >= 2) cell.classList.add('dw-hour-extra');
      if (i >= 3) cell.classList.add('dw-hour-extra2');
      hours.append(cell);
    });
  }

  const onClick = (e) => {
    const btn = e.target.closest?.('[data-action]');
    if (!btn || !root.contains(btn) || inEditMode(root)) return;
    if (handleWeather(btn.dataset.action)) e.stopPropagation();
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', stopActivationKeys);
  root.addEventListener('keyup', stopActivationKeys);

  render();
  const unsubClock = context.clock.subscribe(render);
  const timerId = setInterval(render, 60000);

  return {
    update(data = {}) {
      env = data.environment || context.getEnvironmentSnapshot?.() || env;
      render();
    },
    destroy() {
      clearInterval(timerId);
      unsubClock?.();
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', stopActivationKeys);
      root.removeEventListener('keyup', stopActivationKeys);
      clearElement(root);
    },
  };
}
