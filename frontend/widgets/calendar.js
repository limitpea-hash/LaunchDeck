import { el, clearElement, setText } from '../lib/dom.js';
import { getChinaHoliday, hasChinaHolidaySchedule } from '../platform/features/china-holidays.js';
import {
  createCompactTopRow,
  createStaticWidgetIcon,
  createSummaryExtra,
  createSummaryScrollRegion,
} from './summary-helpers.js';

/* =====================================================================
 * LaunchDeck calendar
 * - config: { weekStartsOn: 0|1, marks: [{ date, title, color }] }
 * - One shared full calendar DOM (.widget-inner.cal-full) is used by the 3×3 card
 *   and by the detail modal (the same live widget root is hosted there).
 * - 2×1 / 2×2 keep the compact summary (.widget-compact-summary) with week strip.
 * - All dates are civil YYYY-MM-DD in the user's clock time zone; date math uses
 *   UTC on civil components only (no UTC-offset day shifts).
 * ===================================================================== */

export const MARK_COLORS = Object.freeze(['red', 'amber', 'green', 'blue', 'violet']);
export const MAX_MARKS = 128;
export const MAX_MARK_TITLE = 60;
const COLOR_LABELS = Object.freeze({ red: '红色', amber: '琥珀色', green: '绿色', blue: '蓝色', violet: '紫色' });
const DEFAULT_MARK_COLOR = 'blue';
const PENDING_GRACE_MS = 8000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const pad2 = (n) => String(n).padStart(2, '0');

/* ---------------- pure helpers (exported for tests) ---------------- */

export function isRealDate(value) {
  const m = typeof value === 'string' && DATE_RE.exec(value);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function toIsoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function parseIso(iso) {
  const m = DATE_RE.exec(iso);
  return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
}

export function shiftIsoDate(iso, days) {
  const p = parseIso(iso);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function weekdayOf(iso) {
  const p = parseIso(iso);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Plain-text title: control chars removed, whitespace collapsed, ≤ 60 UTF-16 units (no split surrogates). */
export function sanitizeMarkTitle(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > MAX_MARK_TITLE) {
    const cps = Array.from(text);
    while (cps.join('').length > MAX_MARK_TITLE) cps.pop();
    text = cps.join('').trim();
  }
  return text;
}

export function normalizeMarks(input) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    if (out.length >= MAX_MARKS) break;
    if (!raw || typeof raw !== 'object') continue;
    const date = typeof raw.date === 'string' ? raw.date : '';
    if (!isRealDate(date) || seen.has(date)) continue;
    const title = sanitizeMarkTitle(raw.title);
    if (!title) continue;
    const color = MARK_COLORS.includes(raw.color) ? raw.color : DEFAULT_MARK_COLOR;
    seen.add(date);
    out.push({ date, title, color });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function normalizeCalendarConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return { weekStartsOn: src.weekStartsOn === 0 ? 0 : 1, marks: normalizeMarks(src.marks) };
}

function configSig(cfg) {
  return JSON.stringify([cfg.weekStartsOn, cfg.marks.map((m) => [m.date, m.title, m.color])]);
}

/** 42 cells (six weeks) for a month, honouring weekStartsOn (0 = Sunday, 1 = Monday). */
export function buildMonthCells(year, month, weekStartsOn = 1) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = weekStartsOn === 1 ? (firstDow + 6) % 7 : firstDow;
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    cells.push({ iso: toIsoDate(y, m, day), year: y, month: m, day, dow: d.getUTCDay(), inMonth: y === year && m === month });
  }
  return cells;
}

/** Map<YYYY-MM-DD, [{id,text,done}]> from the shared todo list (strict civil dueDate only). */
export function groupTodosByDueDate(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.todos) ? raw.todos : [];
  const map = new Map();
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const due = typeof t.dueDate === 'string' ? t.dueDate : '';
    if (!isRealDate(due)) continue;
    const text = String(t.text ?? t.title ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!map.has(due)) map.set(due, []);
    map.get(due).push({ id: String(t.id ?? ''), text: text.slice(0, 200), done: Boolean(t.completed ?? t.done) });
  }
  for (const arr of map.values()) arr.sort((a, b) => Number(a.done) - Number(b.done));
  return map;
}

function todoMapSig(map) {
  return JSON.stringify(Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/* ---------------- holidays (shared offline module) ---------------- */

const holidayCache = new Map();
function holidayOf(iso) {
  if (holidayCache.has(iso)) return holidayCache.get(iso);
  let result = null;
  try {
    const h = getChinaHoliday(iso);
    if (h && (h.kind === 'holiday' || h.kind === 'workday')) {
      result = { kind: h.kind, name: typeof h.name === 'string' ? h.name.trim().slice(0, 40) : '' };
    }
  } catch {
    result = null;
  }
  if (holidayCache.size > 4000) holidayCache.clear();
  holidayCache.set(iso, result);
  return result;
}

function hasSchedule(year) {
  try {
    return Boolean(hasChinaHolidaySchedule(year));
  } catch {
    return false;
  }
}

const holidayBadge = (h) => (h.kind === 'holiday' ? '休' : '班');
const holidayName = (h) => h.name || (h.kind === 'holiday' ? '法定节假日' : '调休上班');

/* ---------------- widget ---------------- */

function readConfig(context) {
  if (context.config && typeof context.config === 'object') return context.config;
  try {
    const c = context.getWidgetConfig?.();
    if (c && typeof c === 'object') return c;
  } catch {
    // ignore
  }
  return {};
}

function readTodos(context) {
  try {
    return context.getTodos?.() ?? [];
  } catch {
    return [];
  }
}

export function mount(root, context) {
  clearElement(root);
  root.className = 'ios-widget widget-calendar cal-card';
  const uid = `cal${Math.random().toString(36).slice(2, 9)}`;

  let config = normalizeCalendarConfig(readConfig(context));
  let markMap = new Map(config.marks.map((m) => [m.date, m]));
  let todoMap = groupTodosByDueDate(readTodos(context));
  let todoSig = todoMapSig(todoMap);

  const currentToday = () => {
    const p = context.clock.getSnapshot().parts;
    return toIsoDate(p.year, p.month, p.day);
  };
  let todayIso = currentToday();
  let viewYear = parseIso(todayIso).year;
  let viewMonth = parseIso(todayIso).month;
  let followToday = true;
  let selected = todayIso;

  let pendingSig = null;
  let pendingAt = 0;
  let saveToken = 0;
  let formDate = null;
  let formDirty = false;
  let statusMsg = '';
  let statusErr = false;
  let pendingFormFocus = false;
  let focusTimer = 0;
  let fallbackTimer = 0;
  let summarySig = '';
  let destroyed = false;

  const isDetail = () => root.classList.contains('widget-in-detail-modal') || Boolean(root.closest?.('.widget-in-detail-modal'));
  const inJiggle = () => Boolean(root.ownerDocument?.body?.classList.contains('jiggle-mode'));

  /* ----- full calendar (3×3 + detail) ----- */
  const navBtn = (action, label, ...children) =>
    el('button', { type: 'button', className: 'cal-btn', dataset: { calAction: action }, 'aria-label': label, title: label }, ...children);

  const titleMonth = el('span', { className: 'cal-title-month' });
  const titleYear = el('span', { className: 'cal-title-year' });
  const titleBox = el('div', { className: 'cal-title', role: 'heading', 'aria-level': '3', 'aria-live': 'polite' }, titleMonth, titleYear);
  const prevBtn = navBtn('prev', '上个月', el('span', { 'aria-hidden': 'true', textContent: '‹' }));
  const nextBtn = navBtn('next', '下个月', el('span', { 'aria-hidden': 'true', textContent: '›' }));
  const todayBtn = navBtn(
    'today',
    '回到今天',
    el('span', { className: 'cal-lbl-short', 'aria-hidden': 'true', textContent: '今' }),
    el('span', { className: 'cal-lbl-long', 'aria-hidden': 'true', textContent: '今天' })
  );
  const weekShort = el('span', { className: 'cal-lbl-short', 'aria-hidden': 'true' });
  const weekLong = el('span', { className: 'cal-lbl-long', 'aria-hidden': 'true' });
  const weekBtn = navBtn('week', '切换每周起始日', weekShort, weekLong);
  weekBtn.classList.add('cal-week-btn');
  const head = el('div', { className: 'cal-head' }, titleBox, el('div', { className: 'cal-nav' }, prevBtn, todayBtn, nextBtn, weekBtn));

  const weekdayRow = el('div', { className: 'cal-weekdays', 'aria-hidden': 'true' });
  const weekdayCells = Array.from({ length: 7 }, () => el('span', { className: 'cal-weekday' }));
  weekdayRow.append(...weekdayCells);
  const grid = el('div', { className: 'cal-grid', role: 'group' });
  const cells = Array.from({ length: 42 }, () => {
    const num = el('span', { className: 'cal-day-num', 'aria-hidden': 'true' });
    const dots = el('span', { className: 'cal-day-dots', 'aria-hidden': 'true' });
    const b = el('button', { type: 'button', className: 'cal-day', tabindex: '-1', dataset: { calAction: 'day' } }, num, dots);
    grid.appendChild(b);
    return { b, num, dots };
  });
  const monthBox = el('div', { className: 'cal-month' }, weekdayRow, grid);

  const agDay = el('span', { className: 'cal-ag-daynum' });
  const agMeta = el('span', { className: 'cal-ag-meta' });
  const agToday = el('span', { className: 'cal-ag-today', textContent: '今天', hidden: true });
  const agHead = el('div', { className: 'cal-ag-head' }, agDay, el('span', { className: 'cal-ag-headtext' }, agMeta, agToday));
  const agBrief = el('div', { className: 'cal-ag-brief' });
  const agHolBadge = el('span', { className: 'cal-ag-badge' });
  const agHolName = el('span', { className: 'cal-ag-holname' });
  const agHoliday = el('div', { className: 'cal-ag-holiday', hidden: true }, agHolBadge, agHolName);
  const agMarkDot = el('span', { className: 'cal-ag-markdot', 'aria-hidden': 'true' });
  const agMarkText = el('span', { className: 'cal-ag-marktext' });
  const agMarkChip = el('div', { className: 'cal-ag-markchip', hidden: true }, agMarkDot, agMarkText);
  const agMarkBtn = el('button', { type: 'button', className: 'cal-btn cal-ag-markbtn', dataset: { calAction: 'mark' } });
  const agMark = el('div', { className: 'cal-ag-mark' }, agMarkChip, agMarkBtn);
  const agTodos = createSummaryScrollRegion({ ariaLabel: '所选日期的到期待办', extraClass: 'cal-ag-todos' });
  const agNote = el('div', { className: 'cal-ag-note', hidden: true });

  /* marker form (visible in detail) */
  const formTitle = el('div', { className: 'cal-form-title' });
  const titleInput = el('input', {
    type: 'text',
    id: `${uid}-title`,
    className: 'cal-input',
    maxlength: String(MAX_MARK_TITLE),
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '如：项目评审、纪念日',
    'aria-describedby': `${uid}-status`,
  });
  const colorSet = el('fieldset', { className: 'cal-swatches' }, el('legend', { className: 'cal-field-label', textContent: '颜色' }));
  const colorInputs = MARK_COLORS.map((color) => {
    const id = `${uid}-c-${color}`;
    const input = el('input', { type: 'radio', id, name: `${uid}-color`, value: color, className: 'cal-swatch-input' });
    colorSet.appendChild(
      el(
        'label',
        { className: 'cal-swatch', for: id, title: COLOR_LABELS[color], dataset: { color } },
        input,
        el('span', { className: 'cal-swatch-dot', 'aria-hidden': 'true' }),
        el('span', { className: 'cal-sr', textContent: COLOR_LABELS[color] })
      )
    );
    return input;
  });
  const saveBtn = el('button', { type: 'submit', className: 'cal-btn is-primary', textContent: '保存标记' });
  const deleteBtn = el('button', { type: 'button', className: 'cal-btn is-danger', dataset: { calAction: 'delete' }, textContent: '删除标记' });
  const countHint = el('span', { className: 'cal-form-count' });
  const formStatus = el('p', { className: 'cal-form-status', id: `${uid}-status`, role: 'status' });
  const form = el(
    'form',
    { className: 'cal-form', novalidate: 'true', 'aria-label': '个人标记' },
    formTitle,
    el('label', { className: 'cal-field-label', for: `${uid}-title`, textContent: '标题（1–60 字）' }),
    titleInput,
    colorSet,
    el('div', { className: 'cal-form-actions' }, saveBtn, deleteBtn, countHint),
    formStatus
  );

  const agenda = el(
    'section',
    { className: 'cal-agenda', 'aria-label': '所选日期安排' },
    agHead,
    agBrief,
    agHoliday,
    agMark,
    agTodos,
    agNote,
    form
  );
  const full = el('div', { className: 'widget-inner cal-full' }, head, el('div', { className: 'cal-body' }, monthBox, agenda));

  /* ----- compact / week summary (2×1, 2×2) ----- */
  const compactDayTileMonth = el('span', { className: 'compact-cal-tile-month' });
  const compactDayTileNum = el('span', { className: 'compact-cal-tile-day' });
  const compactDayTile = el('div', { className: 'compact-cal-tile', role: 'group', 'aria-label': '' }, compactDayTileMonth, compactDayTileNum);
  const compactPrimary = el('div', { className: 'widget-compact-primary compact-cal-weekday' });
  const compactNote = el('div', { className: 'compact-cal-note', hidden: true });
  const { topRow: compactTopRow } = createCompactTopRow({
    kickerText: '月历视图',
    iconNode: createStaticWidgetIcon('calendar'),
    accentClass: 'is-calendar',
  });
  const compactBody = el(
    'div',
    { className: 'compact-cal-body' },
    compactDayTile,
    el('div', { className: 'compact-cal-meta' }, compactPrimary, compactNote)
  );
  const summaryWeekStrip = el('div', { className: 'summary-cal-week-strip', 'aria-label': '本周日期预览' });
  const summaryExtra = createSummaryExtra('summary-extra-calendar', summaryWeekStrip);
  const compactSummary = el('div', { className: 'widget-compact-summary compact-layout-calendar' }, compactTopRow, compactBody, summaryExtra);
  const label = el('span', { className: 'widget-label', textContent: '月历' });
  root.append(full, compactSummary, label);

  /* ---------------- rendering ---------------- */

  function renderHeader() {
    setText(titleMonth, `${viewMonth}月`);
    setText(titleYear, String(viewYear));
    titleBox.setAttribute('aria-label', `${viewYear}年${viewMonth}月`);
    grid.setAttribute('aria-label', `${viewYear}年${viewMonth}月 日期`);
    const mon = config.weekStartsOn === 1;
    setText(weekShort, mon ? '一' : '日');
    setText(weekLong, mon ? '周一起' : '周日起');
    const wl = `每周从周${mon ? '一' : '日'}开始，点按改为周${mon ? '日' : '一'}`;
    weekBtn.setAttribute('aria-label', wl);
    weekBtn.title = wl;
  }

  function dayAria(d, hol, mark, todos) {
    const parts = [`${d.year}年${d.month}月${d.day}日 星期${WEEK_ZH[d.dow]}`];
    if (d.iso === todayIso) parts.push('今天');
    if (hol) parts.push(`${holidayBadge(hol)}：${holidayName(hol)}`);
    if (mark) parts.push(`标记：${mark.title}`);
    if (todos.length) parts.push(`${todos.length} 项到期待办`);
    return parts.join('，');
  }

  function renderGrid() {
    const data = buildMonthCells(viewYear, viewMonth, config.weekStartsOn);
    const labels = config.weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
    labels.forEach((dow, i) => {
      setText(weekdayCells[i], WEEK_ZH[dow]);
      weekdayCells[i].classList.toggle('is-weekend', dow === 0 || dow === 6);
    });
    const tabIso = data.some((d) => d.iso === selected) ? selected : toIsoDate(viewYear, viewMonth, 1);
    data.forEach((d, i) => {
      const c = cells[i];
      const hol = holidayOf(d.iso);
      const mark = markMap.get(d.iso) || null;
      const todos = todoMap.get(d.iso) || [];
      const cls = ['cal-day'];
      if (!d.inMonth) cls.push('is-outside');
      if (d.iso === todayIso) cls.push('is-today');
      if (d.iso === selected) cls.push('is-selected');
      if (d.dow === 0 || d.dow === 6) cls.push('is-weekend');
      if (hol) cls.push(hol.kind === 'holiday' ? 'is-holiday' : 'is-workday');
      if (mark) cls.push('has-mark');
      c.b.className = cls.join(' ');
      c.b.dataset.date = d.iso;
      c.b.setAttribute('tabindex', d.iso === tabIso ? '0' : '-1');
      c.b.setAttribute('aria-pressed', d.iso === selected ? 'true' : 'false');
      if (d.iso === todayIso) c.b.setAttribute('aria-current', 'date');
      else c.b.removeAttribute('aria-current');
      c.b.setAttribute('aria-label', dayAria(d, hol, mark, todos));
      const tip = [hol ? holidayName(hol) : '', mark ? mark.title : '', todos.length ? `${todos.length} 项待办` : ''].filter(Boolean).join(' · ');
      if (tip) c.b.title = tip;
      else c.b.removeAttribute('title');
      setText(c.num, String(d.day));
      clearElement(c.dots);
      if (mark || hol?.kind === 'holiday') {
        const dotColor = mark ? mark.color : 'red';
        c.dots.appendChild(el('span', { className: 'cal-dot', dataset: { color: dotColor } }));
      }
    });
  }

  function syncForm(mark) {
    const resetDraft = formDate !== selected || !formDirty;
    if (formDate !== selected) {
      statusMsg = '';
      statusErr = false;
    }
    if (resetDraft) {
      if (titleInput.value !== (mark?.title || '')) titleInput.value = mark?.title || '';
      const color = mark?.color || DEFAULT_MARK_COLOR;
      for (const input of colorInputs) input.checked = input.value === color;
      formDirty = false;
      formDate = selected;
    }
    const p = parseIso(selected);
    setText(formTitle, mark ? `编辑 ${p.month}月${p.day}日 的标记` : `为 ${p.month}月${p.day}日 添加标记`);
    deleteBtn.hidden = !mark;
    saveBtn.textContent = mark ? '保存修改' : '添加标记';
    setText(countHint, `${config.marks.length}/${MAX_MARKS}`);
    setText(formStatus, statusMsg);
    formStatus.hidden = !statusMsg;
    formStatus.classList.toggle('is-error', statusErr);
  }

  function renderAgenda() {
    const p = parseIso(selected);
    const dow = weekdayOf(selected);
    const hol = holidayOf(selected);
    const mark = markMap.get(selected) || null;
    const todos = todoMap.get(selected) || [];
    const open = todos.filter((t) => !t.done).length;

    setText(agDay, String(p.day));
    setText(agMeta, `${p.year === parseIso(todayIso).year ? '' : `${p.year}年`}${p.month}月 · 周${WEEK_ZH[dow]}`);
    agToday.hidden = selected !== todayIso;

    agHoliday.hidden = !hol;
    agHoliday.className = `cal-ag-holiday ${hol ? (hol.kind === 'holiday' ? 'is-holiday' : 'is-workday') : ''}`.trim();
    setText(agHolBadge, hol ? holidayBadge(hol) : '');
    setText(agHolName, hol ? holidayName(hol) : '');

    agMarkChip.hidden = !mark;
    agMarkChip.dataset.color = mark ? mark.color : '';
    setText(agMarkText, mark ? mark.title : '');
    agMarkChip.title = mark ? mark.title : '';
    setText(agMarkBtn, mark ? '编辑标记' : '+ 标记');
    agMarkBtn.setAttribute('aria-label', mark ? `编辑 ${p.month}月${p.day}日 的标记：${mark.title}` : `为 ${p.month}月${p.day}日 添加标记`);

    clearElement(agTodos);
    agTodos.appendChild(el('div', { className: 'cal-ag-sec', textContent: todos.length ? `到期待办 ${open}/${todos.length}` : '到期待办' }));
    if (!todos.length) {
      agTodos.appendChild(el('div', { className: 'cal-ag-empty', textContent: '当天没有到期待办' }));
    } else {
      const ul = el('ul', { className: 'cal-ag-todolist' });
      for (const t of todos) {
        ul.appendChild(
          el(
            'li',
            { className: `cal-ag-todo${t.done ? ' is-done' : ''}` },
            el('span', { className: 'cal-ag-bullet', 'aria-hidden': 'true', textContent: t.done ? '✓' : '○' }),
            el('span', { className: 'cal-ag-todotext', textContent: t.text }),
            t.done ? el('span', { className: 'cal-sr', textContent: '（已完成）' }) : null
          )
        );
      }
      agTodos.appendChild(ul);
    }

    const noSchedule = !hasSchedule(p.year);
    agNote.hidden = !noSchedule;
    setText(agNote, noSchedule ? `暂无 ${p.year} 年官方放假安排` : '');

    const brief = [
      hol ? `${holidayBadge(hol)} ${holidayName(hol)}` : '',
      mark ? mark.title : '',
      todos.length ? `${open || todos.length} 项待办` : '',
    ].filter(Boolean);
    setText(agBrief, brief.length ? brief.join(' · ') : '无安排');

    syncForm(mark);
  }

  function renderSummary() {
    const snap = context.clock.getSnapshot();
    const today = snap.parts;
    const offset = config.weekStartsOn === 1 ? (weekdayOf(todayIso) + 6) % 7 : weekdayOf(todayIso);
    const weekIsos = Array.from({ length: 7 }, (_, i) => shiftIsoDate(todayIso, i - offset));
    const hol = holidayOf(todayIso);
    const mark = markMap.get(todayIso) || null;
    const todos = todoMap.get(todayIso) || [];
    const sig = JSON.stringify([
      todayIso,
      today.weekdayZh || '',
      config.weekStartsOn,
      weekIsos.map((iso) => [markMap.get(iso)?.color || '', holidayOf(iso)?.kind || '', todoMap.get(iso)?.length || 0]),
      hol,
      mark,
      todos.length,
    ]);
    if (sig === summarySig) return;
    summarySig = sig;

    setText(compactDayTileMonth, `${today.month}月`);
    setText(compactDayTileNum, String(today.day));
    compactDayTile.setAttribute('aria-label', `${today.year}年${today.month}月${today.day}日${today.weekdayZh ? ` ${today.weekdayZh}` : ''}`);
    setText(compactPrimary, today.weekdayZh || `${today.month}月${today.day}日`);
    const note = hol ? `${holidayBadge(hol)} · ${holidayName(hol)}` : mark ? mark.title : todos.length ? `${todos.length} 项今日到期` : '';
    setText(compactNote, note);
    compactNote.hidden = !note;
    compactNote.dataset.kind = hol ? hol.kind : mark ? 'mark' : todos.length ? 'todo' : '';
    if (mark && !hol) compactNote.dataset.color = mark.color;
    else delete compactNote.dataset.color;

    const weekLabels = config.weekStartsOn === 1 ? ['一', '二', '三', '四', '五', '六', '日'] : WEEK_ZH;
    clearElement(summaryWeekStrip);
    weekIsos.forEach((iso, i) => {
      const p = parseIso(iso);
      const h = holidayOf(iso);
      const m = markMap.get(iso);
      const isToday = iso === todayIso;
      const inMonth = p.month === today.month && p.year === today.year;
      const t = todoMap.get(iso) || [];
      const ariaBits = [`${p.month}月${p.day}日 周${weekLabels[i]}`];
      if (h) ariaBits.push(`${holidayBadge(h)} ${holidayName(h)}`);
      if (m) ariaBits.push(`标记 ${m.title}`);
      if (t.length) ariaBits.push(`${t.length} 项到期待办`);
      const hasIndicator = Boolean(m || h?.kind === 'holiday');
      const pillDotAttrs = hasIndicator
        ? {
            className: 'cal-pill-dot',
            'aria-hidden': 'true',
            dataset: { color: m ? m.color : 'red' },
          }
        : null;
      const pillTitle = ariaBits.join('，');
      summaryWeekStrip.appendChild(
        el(
          'div',
          {
            className: `summary-cal-day-pill cal-pill${isToday ? ' is-today' : ''}${inMonth ? '' : ' is-outside'}${h ? ` is-${h.kind}` : ''}${hasIndicator ? ' has-dot' : ''}`,
            title: pillTitle,
            'aria-label': pillTitle,
          },
          el('span', { className: 'summary-cal-day-dow', textContent: weekLabels[i] }),
          el('span', { className: 'summary-cal-day-num', textContent: String(p.day) }),
          el('span', { className: 'summary-cal-day-dots', 'aria-hidden': 'true' }, pillDotAttrs ? el('span', pillDotAttrs) : null)
        )
      );
    });
  }

  function renderAll() {
    todayIso = currentToday();
    if (followToday) {
      const t = parseIso(todayIso);
      viewYear = t.year;
      viewMonth = t.month;
      selected = todayIso;
    }
    renderHeader();
    renderGrid();
    renderAgenda();
    renderSummary();
  }

  /* ---------------- state changes ---------------- */

  function focusSelectedCell() {
    const c = cells.find((x) => x.b.dataset.date === selected);
    c?.b.focus({ preventScroll: true });
  }

  function updateFollow() {
    const t = parseIso(todayIso);
    followToday = selected === todayIso && viewYear === t.year && viewMonth === t.month;
  }

  function selectDate(iso, { focus = false } = {}) {
    if (!isRealDate(iso)) return;
    selected = iso;
    const p = parseIso(iso);
    if (p.year !== viewYear || p.month !== viewMonth) {
      viewYear = p.year;
      viewMonth = p.month;
    }
    updateFollow();
    renderHeader();
    renderGrid();
    renderAgenda();
    if (focus) focusSelectedCell();
  }

  function shiftMonth(delta) {
    let y = viewYear;
    let m = viewMonth + delta;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    if (y < 1000 || y > 9999) return;
    viewYear = y;
    viewMonth = m;
    const t = parseIso(todayIso);
    if (t.year === y && t.month === m) {
      selected = todayIso;
    } else {
      const sp = parseIso(selected);
      selected = toIsoDate(y, m, Math.min(sp.day, daysInMonth(y, m)));
    }
    updateFollow();
    renderHeader();
    renderGrid();
    renderAgenda();
  }

  function goToday() {
    followToday = true;
    renderAll();
  }

  function setStatus(msg, isError = false) {
    statusMsg = msg;
    statusErr = isError;
  }

  function applyConfig(next) {
    config = next;
    markMap = new Map(config.marks.map((m) => [m.date, m]));
  }

  /** Always saves the full config so weekStartsOn and marks never overwrite each other. */
  function commit() {
    const payload = { weekStartsOn: config.weekStartsOn, marks: config.marks.map((m) => ({ ...m })) };
    pendingSig = configSig(payload);
    pendingAt = Date.now();
    const token = ++saveToken;
    if (typeof context.saveWidgetConfig !== 'function') return;
    let result;
    try {
      result = context.saveWidgetConfig(payload);
    } catch {
      pendingSig = null;
      setStatus('保存请求未能提交，修改仅在本页生效', true);
      renderAgenda();
      return;
    }
    if (result && typeof result.then === 'function') {
      result.then(
        () => {
          if (!destroyed && token === saveToken) pendingSig = null;
        },
        () => {
          if (destroyed || token !== saveToken) return;
          pendingSig = null;
          setStatus('保存失败，修改仅在本页生效，可稍后重试', true);
          renderAgenda();
        }
      );
    }
  }

  function toggleWeekStart() {
    applyConfig({ weekStartsOn: config.weekStartsOn === 1 ? 0 : 1, marks: config.marks });
    commit();
    renderHeader();
    renderGrid();
    renderSummary();
  }

  function selectedColor() {
    return colorInputs.find((i) => i.checked)?.value || DEFAULT_MARK_COLOR;
  }

  function saveMark() {
    const title = sanitizeMarkTitle(titleInput.value);
    if (!title) {
      setStatus('请输入 1–60 字的标题', true);
      renderAgenda();
      titleInput.focus();
      return;
    }
    const exists = markMap.has(selected);
    if (!exists && config.marks.length >= MAX_MARKS) {
      setStatus(`最多保存 ${MAX_MARKS} 条标记，请先删除不需要的标记`, true);
      renderAgenda();
      return;
    }
    const marks = config.marks.filter((m) => m.date !== selected);
    marks.push({ date: selected, title, color: selectedColor() });
    applyConfig({ weekStartsOn: config.weekStartsOn, marks: normalizeMarks(marks) });
    formDirty = false;
    setStatus(exists ? '标记已更新' : '标记已添加');
    commit();
    renderGrid();
    renderAgenda();
    renderSummary();
  }

  function deleteMark() {
    if (!markMap.has(selected)) return;
    applyConfig({ weekStartsOn: config.weekStartsOn, marks: config.marks.filter((m) => m.date !== selected) });
    formDirty = false;
    setStatus('标记已删除');
    commit();
    renderGrid();
    renderAgenda();
    renderSummary();
    titleInput.focus({ preventScroll: true });
  }

  function focusTitle() {
    if (destroyed || !isDetail()) return;
    titleInput.focus({ preventScroll: false });
    try {
      titleInput.select();
    } catch {
      // ignore
    }
  }

  function requestDetailFocus() {
    pendingFormFocus = true;
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      if (pendingFormFocus && isDetail()) focusTitle();
      pendingFormFocus = false;
    }, 450);
  }

  /* ---------------- events ---------------- */

  const onFullClick = (e) => {
    if (inJiggle()) return;
    const target = e.target.closest?.('[data-cal-action]');
    if (!target || !full.contains(target)) {
      // Taps between day cells / in the header never open the detail by accident.
      if (e.target.closest?.('.cal-month, .cal-head, .cal-form')) e.stopPropagation();
      return;
    }
    const action = target.dataset.calAction;
    if (action === 'mark') {
      if (isDetail()) {
        e.stopPropagation();
        focusTitle();
      } else {
        // Let the click reach the card host so it opens the detail; focus the form there.
        requestDetailFocus();
      }
      return;
    }
    e.stopPropagation();
    if (action === 'day') selectDate(target.dataset.date, { focus: document.activeElement === target });
    else if (action === 'prev') shiftMonth(-1);
    else if (action === 'next') shiftMonth(1);
    else if (action === 'today') goToday();
    else if (action === 'week') toggleWeekStart();
    else if (action === 'delete') deleteMark();
  };

  const onGridKey = (e) => {
    const b = e.target.closest?.('.cal-day');
    if (!b || !grid.contains(b) || inJiggle() || e.altKey || e.ctrlKey || e.metaKey) return;
    const cur = b.dataset.date;
    if (!isRealDate(cur)) return;
    const fromStart = (weekdayOf(cur) - config.weekStartsOn + 7) % 7;
    let next = null;
    switch (e.key) {
      case 'ArrowLeft': next = shiftIsoDate(cur, -1); break;
      case 'ArrowRight': next = shiftIsoDate(cur, 1); break;
      case 'ArrowUp': next = shiftIsoDate(cur, -7); break;
      case 'ArrowDown': next = shiftIsoDate(cur, 7); break;
      case 'Home': next = shiftIsoDate(cur, -fromStart); break;
      case 'End': next = shiftIsoDate(cur, 6 - fromStart); break;
      case 'PageUp':
      case 'PageDown': {
        const p = parseIso(cur);
        const step = (e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1);
        const total = p.year * 12 + (p.month - 1) + step;
        const y = Math.floor(total / 12);
        const m = (total % 12) + 1;
        next = toIsoDate(y, m, Math.min(p.day, daysInMonth(y, m)));
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    selectDate(next, { focus: true });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (inJiggle()) return;
    saveMark();
  };
  const onFormInput = () => {
    formDirty = true;
    if (statusMsg && !statusErr) {
      statusMsg = '';
      formStatus.hidden = true;
    }
  };
  const onFormKey = (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  };

  full.addEventListener('click', onFullClick);
  grid.addEventListener('keydown', onGridKey);
  form.addEventListener('submit', onSubmit);
  form.addEventListener('input', onFormInput);
  form.addEventListener('change', onFormInput);
  form.addEventListener('keydown', onFormKey);

  let lastDetail = isDetail();
  root.dataset.calDetail = lastDetail ? 'true' : 'false';
  let observer = null;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => {
      const d = isDetail();
      if (d === lastDetail) return;
      lastDetail = d;
      root.dataset.calDetail = d ? 'true' : 'false';
      if (d && pendingFormFocus) {
        pendingFormFocus = false;
        clearTimeout(focusTimer);
        focusTimer = setTimeout(focusTitle, 120);
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  const onTick = () => {
    const t = currentToday();
    if (t === todayIso) return; // nothing date-related changed: never touch the form or focus
    if (selected === todayIso && followToday) selected = t;
    renderAll();
  };

  renderAll();
  const unsubClock = context.clock.subscribe?.(onTick);

  return {
    update(data = {}) {
      let dirty = false;
      if (data.config && typeof data.config === 'object') {
        const incoming = normalizeCalendarConfig(data.config);
        const s = configSig(incoming);
        if (pendingSig) {
          if (s === pendingSig) {
            pendingSig = null;
          } else if (Date.now() - pendingAt >= PENDING_GRACE_MS) {
            pendingSig = null;
            if (s !== configSig(config)) {
              applyConfig(incoming);
              dirty = true;
            }
          }
        } else if (s !== configSig(config)) {
          applyConfig(incoming);
          dirty = true;
        }
      }
      if (Array.isArray(data.todos) || (data.todos && typeof data.todos === 'object')) {
        const nextMap = groupTodosByDueDate(data.todos);
        const nextSig = todoMapSig(nextMap);
        if (nextSig !== todoSig) {
          todoMap = nextMap;
          todoSig = nextSig;
          dirty = true;
        }
      }
      if (currentToday() !== todayIso) {
        if (selected === todayIso && followToday) selected = currentToday();
        dirty = true;
      }
      if (dirty) renderAll();
    },
    destroy() {
      destroyed = true;
      saveToken += 1;
      clearTimeout(focusTimer);
      clearTimeout(fallbackTimer);
      unsubClock?.();
      observer?.disconnect();
      full.removeEventListener('click', onFullClick);
      grid.removeEventListener('keydown', onGridKey);
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('input', onFormInput);
      form.removeEventListener('change', onFormInput);
      form.removeEventListener('keydown', onFormKey);
      delete root.dataset.calDetail;
      clearElement(root);
    },
  };
}
