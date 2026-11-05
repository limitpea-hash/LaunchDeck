import { el, clearElement, setText } from '../lib/dom.js';
import { createButton, createIconButton } from '../lib/ui/index.js';

const WEEKDAYS_SUN_FIRST = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_MON_FIRST = ['一', '二', '三', '四', '五', '六', '日'];

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstDayWeekday(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export function mount(root, context) {
  clearElement(root);
  root.className = 'ios-widget widget-calendar';

  let config = {
    weekStartsOn: context.config?.weekStartsOn === 0 ? 0 : 1,
  };

  const initialParts = context.clock.getSnapshot().parts;
  let viewYear = initialParts.year;
  let viewMonth = initialParts.month;
  let userMovedMonth = false;

  const monthTitle = el('span', { className: 'calendar-month-title', textContent: '' });
  const prevBtn = createIconButton({
    iconText: '‹',
    title: '上个月',
    ariaLabel: '上个月',
  });
  const todayBtn = createButton({
    label: '今天',
    size: 'sm',
    ariaLabel: '回到今天',
  });
  const nextBtn = createIconButton({
    iconText: '›',
    title: '下个月',
    ariaLabel: '下个月',
  });
  const weekStartBtn = createButton({
    label: config.weekStartsOn === 1 ? '周一起' : '周日起',
    size: 'sm',
    title: '切换每周起始日',
  });

  const header = el(
    'div',
    { className: 'calendar-header' },
    monthTitle,
    el('div', { className: 'calendar-nav-group' }, weekStartBtn, prevBtn, todayBtn, nextBtn)
  );

  const weekdayHead = el('div', { className: 'calendar-weekdays-row' });
  const daysGrid = el('div', { className: 'calendar-days-grid', role: 'grid' });

  const inner = el('div', { className: 'widget-inner' }, header, weekdayHead, daysGrid);
  const compactPrimary = el('div', { className: 'widget-compact-primary', textContent: '' });
  const compactSecondary = el('div', { className: 'widget-compact-secondary', textContent: '' });
  const compactSummary = el(
    'div',
    { className: 'widget-compact-summary' },
    el(
      'div',
      { className: 'widget-compact-top' },
      el('span', { className: 'widget-compact-kicker', textContent: '月历视图' }),
      el('span', { className: 'widget-compact-badge', textContent: '详情 ↗' })
    ),
    compactPrimary,
    compactSecondary
  );
  const label = el('span', { className: 'widget-label', textContent: '月历' });
  root.append(inner, compactSummary, label);

  function renderCalendar() {
    const snap = context.clock.getSnapshot();
    const today = snap.parts;
    if (!userMovedMonth) {
      viewYear = today.year;
      viewMonth = today.month;
    }

    setText(monthTitle, `${viewYear}年 ${viewMonth}月`);
    setText(weekStartBtn, config.weekStartsOn === 1 ? '周一起' : '周日起');
    setText(compactPrimary, `${today.month}月${today.day}日 · ${today.weekdayZh || ''}`);
    setText(
      compactSecondary,
      `${viewYear}年${viewMonth}月 · ${config.weekStartsOn === 1 ? '周一起始' : '周日起始'}`
    );

    clearElement(weekdayHead);
    const headers = config.weekStartsOn === 1 ? WEEKDAYS_MON_FIRST : WEEKDAYS_SUN_FIRST;
    for (const dayLabel of headers) {
      weekdayHead.appendChild(el('span', { className: 'calendar-weekday-cell', textContent: dayLabel }));
    }

    clearElement(daysGrid);
    const firstDow = firstDayWeekday(viewYear, viewMonth); // 0 (Sun) .. 6 (Sat)
    const leadingBlanks = config.weekStartsOn === 1
      ? (firstDow + 6) % 7
      : firstDow;
    const totalDays = daysInMonth(viewYear, viewMonth);

    for (let i = 0; i < leadingBlanks; i++) {
      daysGrid.appendChild(el('span', { className: 'calendar-day-cell is-empty' }));
    }

    for (let d = 1; d <= totalDays; d++) {
      const isToday = viewYear === today.year && viewMonth === today.month && d === today.day;
      daysGrid.appendChild(
        el('span', {
          className: `calendar-day-cell ${isToday ? 'is-today' : ''}`,
          textContent: String(d),
        })
      );
    }
  }

  const onPrev = (e) => {
    e.stopPropagation();
    userMovedMonth = true;
    viewMonth -= 1;
    if (viewMonth < 1) {
      viewMonth = 12;
      viewYear -= 1;
    }
    renderCalendar();
  };

  const onNext = (e) => {
    e.stopPropagation();
    userMovedMonth = true;
    viewMonth += 1;
    if (viewMonth > 12) {
      viewMonth = 1;
      viewYear += 1;
    }
    renderCalendar();
  };

  const onToday = (e) => {
    e.stopPropagation();
    userMovedMonth = false;
    const today = context.clock.getSnapshot().parts;
    viewYear = today.year;
    viewMonth = today.month;
    renderCalendar();
  };

  const onToggleWeekStart = (e) => {
    e.stopPropagation();
    config = { weekStartsOn: config.weekStartsOn === 1 ? 0 : 1 };
    renderCalendar();
    context.saveWidgetConfig?.(config);
  };

  prevBtn.addEventListener('click', onPrev);
  nextBtn.addEventListener('click', onNext);
  todayBtn.addEventListener('click', onToday);
  weekStartBtn.addEventListener('click', onToggleWeekStart);

  renderCalendar();
  const unsubClock = context.clock.subscribe(renderCalendar);

  return {
    update(data = {}) {
      if (data.config && [0, 1].includes(data.config.weekStartsOn)) {
        config = { weekStartsOn: data.config.weekStartsOn };
      }
      renderCalendar();
    },
    destroy() {
      unsubClock?.();
      prevBtn.removeEventListener('click', onPrev);
      nextBtn.removeEventListener('click', onNext);
      todayBtn.removeEventListener('click', onToday);
      weekStartBtn.removeEventListener('click', onToggleWeekStart);
      clearElement(root);
    },
  };
}
