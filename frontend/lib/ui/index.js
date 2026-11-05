import { el, clearElement, setText } from '../dom.js';

const activePopovers = new Set();
let uidCounter = 1;

function nextUid(prefix = 'ui') {
  uidCounter += 1;
  return `${prefix}_${uidCounter}`;
}

export function closeAllPopovers(exceptInstance = null) {
  for (const inst of [...activePopovers]) {
    if (inst !== exceptInstance) {
      inst.close({ restoreFocus: false });
    }
  }
}

function positionPortalPopover(triggerEl, portalEl, preferredWidth = null) {
  if (!triggerEl || !portalEl || typeof window === 'undefined') return;
  const rect = typeof triggerEl.getBoundingClientRect === 'function'
    ? triggerEl.getBoundingClientRect()
    : { left: 16, top: 16, bottom: 48, width: 220, height: 32 };
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;

  const minW = Math.max(preferredWidth || 200, Math.min(rect.width || 200, vw - 16));
  portalEl.style.minWidth = `${Math.round(minW)}px`;

  const portalRect = typeof portalEl.getBoundingClientRect === 'function'
    ? portalEl.getBoundingClientRect()
    : { width: minW, height: 240 };
  const pw = portalRect.width || minW;
  const ph = portalRect.height || 240;

  let left = rect.left;
  if (left + pw > vw - 8) {
    left = Math.max(8, vw - pw - 8);
  }
  if (left < 8) left = 8;

  let top = rect.bottom + 6;
  if (top + ph > vh - 8 && rect.top - ph - 6 >= 8) {
    top = rect.top - ph - 6;
  } else if (top + ph > vh - 8) {
    top = Math.max(8, vh - ph - 8);
  }

  portalEl.style.left = `${Math.round(left)}px`;
  portalEl.style.top = `${Math.round(top)}px`;
}

// ==========================================================================
// 1. Content-Driven Text Button & Fixed-Size Icon Button
// ==========================================================================
export function createButton({
  label = '',
  variant = 'secondary', // 'primary' | 'secondary' | 'accent' | 'danger'
  size = 'md', // 'sm' | 'md'
  pill = false,
  type = 'button',
  id = null,
  title = null,
  ariaLabel = null,
  disabled = false,
  onClick = null,
} = {}) {
  const classes = ['ui-btn'];
  if (variant === 'primary') classes.push('ui-btn-primary');
  else if (variant === 'accent') classes.push('ui-btn-accent');
  else if (variant === 'danger') classes.push('ui-btn-danger');
  if (size === 'sm') classes.push('ui-btn-sm');
  if (pill) classes.push('ui-btn-pill');

  const btn = el('button', {
    type,
    id,
    title,
    disabled,
    className: classes.join(' '),
    textContent: label,
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
  });

  if (typeof onClick === 'function') {
    btn.addEventListener('click', onClick);
  }

  return btn;
}

export function createIconButton({
  iconText = '',
  variant = 'ghost', // 'ghost' | 'danger'
  id = null,
  title = null,
  ariaLabel = null,
  disabled = false,
  onClick = null,
} = {}) {
  const classes = ['ui-icon-btn'];
  if (variant === 'danger') classes.push('ui-icon-btn-danger');

  const btn = el('button', {
    type: 'button',
    id,
    title,
    disabled,
    className: classes.join(' '),
    textContent: iconText,
    ...(ariaLabel ? { 'aria-label': ariaLabel } : title ? { 'aria-label': title } : {}),
  });

  if (typeof onClick === 'function') {
    btn.addEventListener('click', onClick);
  }

  return btn;
}

// ==========================================================================
// 2. iOS 18 Toggle Switch (Widget Enable/Disable)
// ==========================================================================
export function createSwitch({
  checked = false,
  label = '',
  ariaLabel = '',
  disabled = false,
  onChange = null,
} = {}) {
  const input = el('input', {
    type: 'checkbox',
    role: 'switch',
    className: 'ui-switch-input',
    checked: Boolean(checked),
    disabled: Boolean(disabled),
    'aria-checked': String(Boolean(checked)),
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
  });

  const thumb = el('span', { className: 'ui-switch-thumb' });
  const track = el('span', { className: 'ui-switch-track', 'aria-hidden': 'true' }, thumb);
  const labelNode = label ? el('span', { className: 'ui-switch-label', textContent: label }) : null;

  const root = el('label', { className: 'ui-switch-wrap' }, input, track, labelNode);

  const handleChange = (e) => {
    e.stopPropagation();
    input.setAttribute('aria-checked', String(Boolean(input.checked)));
    onChange?.(Boolean(input.checked), e);
  };

  input.addEventListener('change', handleChange);

  return {
    root,
    element: root,
    input,
    getChecked: () => Boolean(input.checked),
    setChecked(next) {
      input.checked = Boolean(next);
      input.setAttribute('aria-checked', String(Boolean(next)));
    },
    destroy() {
      input.removeEventListener('change', handleChange);
    },
  };
}

// ==========================================================================
// 3. iOS 18 Rounded Checkmark Control (Todo Item Completion)
// ==========================================================================
export function createCheckbox({
  checked = false,
  label = '',
  ariaLabel = '',
  disabled = false,
  onChange = null,
} = {}) {
  const input = el('input', {
    type: 'checkbox',
    className: 'ui-checkbox-input',
    checked: Boolean(checked),
    disabled: Boolean(disabled),
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
  });

  const box = el('span', { className: 'ui-checkbox-box', 'aria-hidden': 'true', textContent: '✓' });
  const labelNode = label ? el('span', { className: 'ui-checkbox-label', textContent: label }) : null;

  const root = el('label', { className: 'ui-checkbox-wrap' }, input, box, labelNode);

  const handleChange = (e) => {
    e.stopPropagation();
    onChange?.(Boolean(input.checked), e);
  };

  input.addEventListener('change', handleChange);

  return {
    root,
    element: root,
    input,
    getChecked: () => Boolean(input.checked),
    setChecked(next) {
      input.checked = Boolean(next);
    },
    destroy() {
      input.removeEventListener('change', handleChange);
    },
  };
}

// ==========================================================================
// 4. Custom Searchable Select / Combobox Popover
// ==========================================================================
export function createSelect({
  options = [],
  value = '',
  searchable = false,
  searchPlaceholder = '搜索选项…',
  compact = false,
  ariaLabel = '',
  placeholder = '请选择',
  selectElement = null,
  onChange = null,
} = {}) {
  const listboxId = nextUid('ui_listbox');
  let itemList = [];
  let selectedValue = value;
  let activeIndex = -1;
  let isOpen = false;
  let portalEl = null;
  let searchInput = null;
  let listEl = null;

  function normalizeOptions(raw) {
    return (Array.isArray(raw) ? raw : []).map((opt) => {
      if (typeof opt === 'string') {
        return { value: opt, label: opt };
      }
      return {
        value: String(opt.value ?? ''),
        label: String(opt.label ?? opt.value ?? ''),
      };
    });
  }

  function syncFromNativeSelect() {
    if (!selectElement) return;
    const opts = [];
    const childList = selectElement.children || [];
    for (const child of childList) {
      if (child.tagName?.toUpperCase() === 'OPTION') {
        opts.push({
          value: String(child.value ?? child.textContent ?? ''),
          label: String(child.textContent ?? child.value ?? ''),
        });
      }
    }
    if (opts.length > 0) {
      itemList = opts;
    }
    if (selectElement.value) {
      selectedValue = selectElement.value;
    } else if (itemList.length > 0 && !selectedValue) {
      selectedValue = itemList[0].value;
    }
  }

  itemList = normalizeOptions(options);
  if (selectElement) {
    syncFromNativeSelect();
  }
  if (!selectedValue && itemList.length > 0) {
    selectedValue = itemList[0].value;
  }

  const triggerText = el('span', { className: 'ui-select-trigger-text', textContent: placeholder });
  const chevron = el('span', { className: 'ui-select-chevron', 'aria-hidden': 'true', textContent: '▾' });
  const triggerBtn = el(
    'button',
    {
      type: 'button',
      className: 'ui-select-trigger',
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-controls': listboxId,
      ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
    },
    triggerText,
    chevron
  );

  const root = el(
    'div',
    { className: `ui-select-wrap ${compact ? 'ui-select-compact' : ''}` },
    triggerBtn
  );

  if (selectElement) {
    selectElement.classList.add('ui-select-native-hidden');
    selectElement.tabIndex = -1;
    selectElement.setAttribute('aria-hidden', 'true');
    if (selectElement.parentNode) {
      selectElement.parentNode.appendChild(root);
    }
  }

  function updateTriggerDisplay() {
    if (selectElement && selectElement.children?.length > 0) {
      syncFromNativeSelect();
    }
    const found = itemList.find(o => o.value === selectedValue);
    setText(triggerText, found ? found.label : selectedValue || placeholder);
  }

  function getFilteredOptions() {
    const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (!q) return itemList;
    return itemList.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }

  function renderOptionsList() {
    if (!listEl) return;
    clearElement(listEl);
    const filtered = getFilteredOptions();
    if (filtered.length === 0) {
      listEl.appendChild(el('div', { className: 'ui-popover-empty', textContent: '无匹配选项' }));
      activeIndex = -1;
      return;
    }

    if (activeIndex < 0 || activeIndex >= filtered.length) {
      const currentIdx = filtered.findIndex(o => o.value === selectedValue);
      activeIndex = currentIdx >= 0 ? currentIdx : 0;
    }

    filtered.forEach((opt, idx) => {
      const isSelected = opt.value === selectedValue;
      const isActive = idx === activeIndex;
      const optBtn = el(
        'button',
        {
          type: 'button',
          role: 'option',
          className: `ui-popover-option ${isActive ? 'is-active' : ''}`,
          'aria-selected': String(isSelected),
          dataset: { value: opt.value },
        },
        el('span', { textContent: opt.label }),
        isSelected ? el('span', { 'aria-hidden': 'true', textContent: '✓' }) : null
      );
      optBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        commitSelection(opt.value);
      });
      listEl.appendChild(optBtn);
    });
  }

  function commitSelection(nextVal) {
    const changed = nextVal !== selectedValue;
    selectedValue = nextVal;
    if (selectElement) {
      selectElement.value = nextVal;
      if (changed) {
        selectElement.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    updateTriggerDisplay();
    close({ restoreFocus: true });
    if (changed) {
      onChange?.(nextVal);
    }
  }

  function onDocPointerDown(e) {
    if (!isOpen) return;
    if (root.contains(e.target) || (portalEl && portalEl.contains(e.target))) return;
    close({ restoreFocus: false });
  }

  function onWindowReposition() {
    if (isOpen && portalEl) {
      positionPortalPopover(triggerBtn, portalEl);
    }
  }

  function onKeyDown(e) {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
      return;
    }

    const filtered = getFilteredOptions();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close({ restoreFocus: true });
    } else if (e.key === 'Tab') {
      close({ restoreFocus: false });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        activeIndex = (activeIndex + 1) % filtered.length;
        renderOptionsList();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) {
        activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
        renderOptionsList();
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (filtered.length > 0) {
        activeIndex = 0;
        renderOptionsList();
      }
    } else if (e.key === 'End') {
      e.preventDefault();
      if (filtered.length > 0) {
        activeIndex = filtered.length - 1;
        renderOptionsList();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0 && activeIndex >= 0 && activeIndex < filtered.length) {
        commitSelection(filtered[activeIndex].value);
      }
    }
  }

  const instance = {
    root,
    element: root,
    triggerBtn,
    open,
    close,
    getValue() {
      if (selectElement) syncFromNativeSelect();
      return selectedValue;
    },
    setValue(nextVal) {
      selectedValue = String(nextVal ?? '');
      if (selectElement) {
        selectElement.value = selectedValue;
      }
      updateTriggerDisplay();
    },
    setOptions(nextOpts, nextVal) {
      itemList = normalizeOptions(nextOpts);
      if (nextVal !== undefined) {
        selectedValue = String(nextVal);
      } else if (!itemList.some(o => o.value === selectedValue) && itemList.length > 0) {
        selectedValue = itemList[0].value;
      }
      if (selectElement) {
        clearElement(selectElement);
        for (const o of itemList) {
          selectElement.appendChild(el('option', { value: o.value, textContent: o.label }));
        }
        selectElement.value = selectedValue;
      }
      updateTriggerDisplay();
      if (isOpen) renderOptionsList();
    },
    refresh() {
      syncFromNativeSelect();
      updateTriggerDisplay();
      if (isOpen) renderOptionsList();
    },
    destroy() {
      close({ restoreFocus: false });
      triggerBtn.removeEventListener('click', onTriggerClick);
      triggerBtn.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };

  function open() {
    if (isOpen) return;
    closeAllPopovers(instance);
    if (selectElement) syncFromNativeSelect();
    isOpen = true;
    activePopovers.add(instance);
    triggerBtn.setAttribute('aria-expanded', 'true');

    portalEl = el('div', {
      className: 'ui-popover-portal ui-select-popover',
      id: listboxId,
      role: 'listbox',
      ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
    });

    if (searchable) {
      searchInput = el('input', {
        type: 'text',
        className: 'ui-popover-search',
        placeholder: searchPlaceholder,
        autocomplete: 'off',
        'aria-label': searchPlaceholder,
      });
      searchInput.addEventListener('input', () => {
        activeIndex = 0;
        renderOptionsList();
      });
      searchInput.addEventListener('keydown', onKeyDown);
      portalEl.appendChild(searchInput);
    } else {
      searchInput = null;
    }

    listEl = el('div', { className: 'ui-popover-list' });
    portalEl.appendChild(listEl);
    document.body?.appendChild(portalEl);

    activeIndex = itemList.findIndex(o => o.value === selectedValue);
    renderOptionsList();
    positionPortalPopover(triggerBtn, portalEl);

    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener?.('resize', onWindowReposition);
    window.addEventListener?.('scroll', onWindowReposition, true);

    if (searchInput) {
      searchInput.focus?.();
    }
  }

  function close({ restoreFocus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    activePopovers.delete(instance);
    triggerBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    window.removeEventListener?.('resize', onWindowReposition);
    window.removeEventListener?.('scroll', onWindowReposition, true);
    if (portalEl) {
      portalEl.remove();
      portalEl = null;
    }
    searchInput = null;
    listEl = null;
    if (restoreFocus) {
      triggerBtn.focus?.();
    }
  }

  function onTriggerClick(e) {
    e.stopPropagation();
    if (isOpen) close({ restoreFocus: true });
    else open();
  }

  triggerBtn.addEventListener('click', onTriggerClick);
  triggerBtn.addEventListener('keydown', onKeyDown);
  updateTriggerDisplay();

  return instance;
}

// ==========================================================================
// 5. Shared In-Theme DatePicker Control (YYYY-MM-DD + Calendar Popover)
// ==========================================================================
const DP_WEEKDAYS_MON = ['一', '二', '三', '四', '五', '六', '日'];
const DP_WEEKDAYS_SUN = ['日', '一', '二', '三', '四', '五', '六'];

function daysInMonthUtc(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstWeekdayUtc(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export function createDatePicker({
  value = '',
  placeholder = 'YYYY-MM-DD',
  allowEmpty = false,
  compact = false,
  ariaLabel = '选择日期',
  weekStartsOn = 1,
  getTodayParts = null,
  inputElement = null,
  onChange = null,
} = {}) {
  const textInput = inputElement || el('input', {
    type: 'text',
    className: 'ui-datetime-input',
    placeholder,
    maxlength: 10,
    autocomplete: 'off',
    'aria-label': ariaLabel,
  });

  if (inputElement) {
    inputElement.type = 'text';
    inputElement.classList.add('ui-datetime-input');
    inputElement.setAttribute('placeholder', placeholder);
    inputElement.setAttribute('autocomplete', 'off');
  }
  if (value) {
    textInput.value = value;
  }

  const triggerBtn = el('button', {
    type: 'button',
    className: 'ui-datetime-trigger-btn',
    'aria-label': `${ariaLabel} 日历面板`,
    'aria-expanded': 'false',
    textContent: '日历',
  });

  const originalParent = inputElement ? inputElement.parentNode : null;

  const root = el(
    'div',
    { className: `ui-datetime-field ${compact ? 'ui-datetime-compact' : ''}` },
    textInput,
    triggerBtn
  );

  if (originalParent) {
    originalParent.appendChild(root);
  }

  let isOpen = false;
  let portalEl = null;
  let viewYear = 2026;
  let viewMonth = 5;
  let valueBeforeOpen = textInput.value;

  function resolveToday() {
    if (typeof getTodayParts === 'function') {
      const p = getTodayParts();
      if (p && p.year && p.month && p.day) return p;
    }
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      isoDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    };
  }

  function parseIso(str) {
    const m = String(str || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonthUtc(y, mo)) return null;
    return { year: y, month: mo, day: d };
  }

  function commitDate(nextIso) {
    textInput.value = nextIso;
    close({ restoreFocus: true });
    onChange?.(nextIso);
  }

  function renderPopoverContent() {
    if (!portalEl) return;
    clearElement(portalEl);

    const today = resolveToday();
    const parsedCurrent = parseIso(textInput.value);

    const prevMonthBtn = createIconButton({
      iconText: '‹',
      title: '上个月',
      onClick: (e) => {
        e.stopPropagation();
        viewMonth -= 1;
        if (viewMonth < 1) {
          viewMonth = 12;
          viewYear -= 1;
        }
        renderPopoverContent();
      },
    });
    const nextMonthBtn = createIconButton({
      iconText: '›',
      title: '下个月',
      onClick: (e) => {
        e.stopPropagation();
        viewMonth += 1;
        if (viewMonth > 12) {
          viewMonth = 1;
          viewYear += 1;
        }
        renderPopoverContent();
      },
    });

    const header = el(
      'div',
      { className: 'ui-dp-header' },
      el('span', { className: 'ui-dp-title', textContent: `${viewYear}年 ${viewMonth}月` }),
      el('div', { className: 'ui-dp-nav' }, prevMonthBtn, nextMonthBtn)
    );

    const weekdaysRow = el('div', { className: 'ui-dp-weekdays' });
    const labels = weekStartsOn === 0 ? DP_WEEKDAYS_SUN : DP_WEEKDAYS_MON;
    for (const w of labels) {
      weekdaysRow.appendChild(el('span', { className: 'ui-dp-weekday', textContent: w }));
    }

    const grid = el('div', { className: 'ui-dp-grid', role: 'grid' });
    const firstDow = firstWeekdayUtc(viewYear, viewMonth);
    const blanks = weekStartsOn === 0 ? firstDow : (firstDow + 6) % 7;
    const total = daysInMonthUtc(viewYear, viewMonth);

    for (let i = 0; i < blanks; i++) {
      grid.appendChild(el('span', { className: 'ui-dp-day', disabled: true }));
    }

    for (let d = 1; d <= total; d++) {
      const iso = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = today.year === viewYear && today.month === viewMonth && today.day === d;
      const isSelected = Boolean(parsedCurrent && parsedCurrent.year === viewYear && parsedCurrent.month === viewMonth && parsedCurrent.day === d);

      const dayBtn = el('button', {
        type: 'button',
        className: `ui-dp-day ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`,
        textContent: String(d),
      });
      dayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        commitDate(iso);
      });
      grid.appendChild(dayBtn);
    }

    const todayBtn = createButton({
      label: '今天',
      size: 'sm',
      onClick: (e) => {
        e.stopPropagation();
        const t = resolveToday();
        const iso = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
        commitDate(iso);
      },
    });

    const rightFooter = el('div', { className: 'ui-dp-nav' });
    if (allowEmpty) {
      rightFooter.appendChild(
        createButton({
          label: '清除',
          size: 'sm',
          onClick: (e) => {
            e.stopPropagation();
            commitDate('');
          },
        })
      );
    }
    rightFooter.appendChild(
      createButton({
        label: '关闭',
        size: 'sm',
        onClick: (e) => {
          e.stopPropagation();
          close({ restoreFocus: true });
        },
      })
    );

    const footer = el('div', { className: 'ui-dp-footer' }, todayBtn, rightFooter);
    portalEl.append(header, weekdaysRow, grid, footer);
  }

  function onDocPointerDown(e) {
    if (!isOpen) return;
    if (root.contains(e.target) || (portalEl && portalEl.contains(e.target))) return;
    close({ restoreFocus: false });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      textInput.value = valueBeforeOpen;
      close({ restoreFocus: true });
    }
  }

  function onWindowReposition() {
    if (isOpen && portalEl) {
      positionPortalPopover(root, portalEl, 268);
    }
  }

  const instance = {
    root,
    element: root,
    input: textInput,
    open,
    close,
    getValue: () => textInput.value.trim(),
    setValue(val) {
      textInput.value = val ? String(val) : '';
    },
    destroy() {
      close({ restoreFocus: false });
      triggerBtn.removeEventListener('click', onTriggerClick);
      root.removeEventListener('keydown', onKeyDown);
    },
  };

  function open() {
    if (isOpen) return;
    closeAllPopovers(instance);
    isOpen = true;
    activePopovers.add(instance);
    valueBeforeOpen = textInput.value;
    triggerBtn.setAttribute('aria-expanded', 'true');

    const parsed = parseIso(textInput.value) || resolveToday();
    viewYear = parsed.year;
    viewMonth = parsed.month;

    portalEl = el('div', {
      className: 'ui-popover-portal ui-datepicker-popover',
      role: 'dialog',
      'aria-label': ariaLabel,
    });
    portalEl.addEventListener('keydown', onKeyDown);
    document.body?.appendChild(portalEl);

    renderPopoverContent();
    positionPortalPopover(root, portalEl, 268);

    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener?.('resize', onWindowReposition);
    window.addEventListener?.('scroll', onWindowReposition, true);
  }

  function close({ restoreFocus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    activePopovers.delete(instance);
    triggerBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    window.removeEventListener?.('resize', onWindowReposition);
    window.removeEventListener?.('scroll', onWindowReposition, true);
    if (portalEl) {
      portalEl.remove();
      portalEl = null;
    }
    if (restoreFocus) {
      triggerBtn.focus?.();
    }
  }

  function onTriggerClick(e) {
    e.stopPropagation();
    if (isOpen) close({ restoreFocus: true });
    else open();
  }

  triggerBtn.addEventListener('click', onTriggerClick);
  root.addEventListener('keydown', onKeyDown);

  return instance;
}

// ==========================================================================
// 6. Shared In-Theme TimePicker Control (HH:mm:ss + 3-Column Time Popover)
// ==========================================================================
export function createTimePicker({
  value = '00:00:00',
  includeSeconds = true,
  compact = false,
  ariaLabel = '选择时间',
  getNowParts = null,
  inputElement = null,
  onChange = null,
} = {}) {
  const placeholder = includeSeconds ? 'HH:mm:ss' : 'HH:mm';
  const textInput = inputElement || el('input', {
    type: 'text',
    className: 'ui-datetime-input',
    placeholder,
    maxlength: includeSeconds ? 8 : 5,
    autocomplete: 'off',
    'aria-label': ariaLabel,
  });

  if (inputElement) {
    inputElement.type = 'text';
    inputElement.classList.add('ui-datetime-input');
    inputElement.setAttribute('placeholder', placeholder);
    inputElement.setAttribute('autocomplete', 'off');
  }
  if (value) {
    textInput.value = value;
  }

  const triggerBtn = el('button', {
    type: 'button',
    className: 'ui-datetime-trigger-btn',
    'aria-label': `${ariaLabel} 时间面板`,
    'aria-expanded': 'false',
    textContent: '时间',
  });

  const originalParent = inputElement ? inputElement.parentNode : null;

  const root = el(
    'div',
    { className: `ui-datetime-field ${compact ? 'ui-datetime-compact' : ''}` },
    textInput,
    triggerBtn
  );

  if (originalParent) {
    originalParent.appendChild(root);
  }

  let isOpen = false;
  let portalEl = null;
  let draftHour = 0;
  let draftMinute = 0;
  let draftSecond = 0;
  let valueBeforeOpen = textInput.value;

  function parseHms(raw) {
    const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return { hour: 12, minute: 0, second: 0 };
    return {
      hour: Math.min(23, Math.max(0, Number(m[1]))),
      minute: Math.min(59, Math.max(0, Number(m[2]))),
      second: Math.min(59, Math.max(0, Number(m[3] || 0))),
    };
  }

  function formatHms(h, m, s) {
    const pad = n => String(n).padStart(2, '0');
    return includeSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
  }

  function renderTimeColumns() {
    if (!portalEl) return;
    clearElement(portalEl);

    const makeCol = (labelText, maxVal, currentVal, onSelectVal) => {
      const colList = el('div', { className: 'ui-tp-col' });
      for (let i = 0; i <= maxVal; i++) {
        const cell = el('button', {
          type: 'button',
          className: `ui-tp-cell ${i === currentVal ? 'is-selected' : ''}`,
          textContent: String(i).padStart(2, '0'),
        });
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectVal(i);
          renderTimeColumns();
        });
        colList.appendChild(cell);
      }
      return el(
        'div',
        { className: 'ui-tp-col-wrap' },
        el('span', { className: 'ui-tp-col-label', textContent: labelText }),
        colList
      );
    };

    const cols = el(
      'div',
      { className: 'ui-tp-columns' },
      makeCol('时', 23, draftHour, v => { draftHour = v; }),
      makeCol('分', 59, draftMinute, v => { draftMinute = v; }),
      includeSeconds ? makeCol('秒', 59, draftSecond, v => { draftSecond = v; }) : null
    );

    const nowBtn = createButton({
      label: '当前时刻',
      size: 'sm',
      onClick: (e) => {
        e.stopPropagation();
        const now = typeof getNowParts === 'function' ? getNowParts() : null;
        if (now && typeof now.hour === 'number') {
          draftHour = now.hour;
          draftMinute = now.minute;
          draftSecond = now.second || 0;
        } else {
          const d = new Date();
          draftHour = d.getHours();
          draftMinute = d.getMinutes();
          draftSecond = d.getSeconds();
        }
        const formatted = formatHms(draftHour, draftMinute, draftSecond);
        textInput.value = formatted;
        close({ restoreFocus: true });
        onChange?.(formatted);
      },
    });

    const cancelBtn = createButton({
      label: '取消',
      size: 'sm',
      onClick: (e) => {
        e.stopPropagation();
        textInput.value = valueBeforeOpen;
        close({ restoreFocus: true });
      },
    });

    const confirmBtn = createButton({
      label: '确定',
      variant: 'primary',
      size: 'sm',
      onClick: (e) => {
        e.stopPropagation();
        const formatted = formatHms(draftHour, draftMinute, draftSecond);
        textInput.value = formatted;
        close({ restoreFocus: true });
        onChange?.(formatted);
      },
    });

    const footer = el(
      'div',
      { className: 'ui-dp-footer' },
      nowBtn,
      el('div', { className: 'ui-dp-nav' }, cancelBtn, confirmBtn)
    );

    portalEl.append(cols, footer);
  }

  function onDocPointerDown(e) {
    if (!isOpen) return;
    if (root.contains(e.target) || (portalEl && portalEl.contains(e.target))) return;
    close({ restoreFocus: false });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      textInput.value = valueBeforeOpen;
      close({ restoreFocus: true });
    }
  }

  function onWindowReposition() {
    if (isOpen && portalEl) {
      positionPortalPopover(root, portalEl, 248);
    }
  }

  const instance = {
    root,
    element: root,
    input: textInput,
    open,
    close,
    getValue: () => textInput.value.trim(),
    setValue(val) {
      textInput.value = val ? String(val) : '';
    },
    destroy() {
      close({ restoreFocus: false });
      triggerBtn.removeEventListener('click', onTriggerClick);
      root.removeEventListener('keydown', onKeyDown);
    },
  };

  function open() {
    if (isOpen) return;
    closeAllPopovers(instance);
    isOpen = true;
    activePopovers.add(instance);
    valueBeforeOpen = textInput.value;
    triggerBtn.setAttribute('aria-expanded', 'true');

    const parsed = parseHms(textInput.value);
    draftHour = parsed.hour;
    draftMinute = parsed.minute;
    draftSecond = parsed.second;

    portalEl = el('div', {
      className: 'ui-popover-portal ui-timepicker-popover',
      role: 'dialog',
      'aria-label': ariaLabel,
    });
    portalEl.addEventListener('keydown', onKeyDown);
    document.body?.appendChild(portalEl);

    renderTimeColumns();
    positionPortalPopover(root, portalEl, 248);

    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener?.('resize', onWindowReposition);
    window.addEventListener?.('scroll', onWindowReposition, true);
  }

  function close({ restoreFocus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    activePopovers.delete(instance);
    triggerBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    window.removeEventListener?.('resize', onWindowReposition);
    window.removeEventListener?.('scroll', onWindowReposition, true);
    if (portalEl) {
      portalEl.remove();
      portalEl = null;
    }
    if (restoreFocus) {
      triggerBtn.focus?.();
    }
  }

  function onTriggerClick(e) {
    e.stopPropagation();
    if (isOpen) close({ restoreFocus: true });
    else open();
  }

  triggerBtn.addEventListener('click', onTriggerClick);
  root.addEventListener('keydown', onKeyDown);

  return instance;
}

// ==========================================================================
// 7. Unified Choice Group (Used for DST Ambiguity / Gap Selection)
// ==========================================================================
export function createChoiceGroup({
  name = 'uiChoice',
  options = [],
  value = '',
  onChange = null,
} = {}) {
  const root = el('div', { className: 'ui-choice-group', role: 'radiogroup' });
  let currentValue = String(value ?? '');

  function render() {
    clearElement(root);
    options.forEach((opt, idx) => {
      const optVal = String(opt.value);
      const isSelected = currentValue ? currentValue === optVal : idx === 0;
      const radio = el('input', {
        type: 'radio',
        name,
        value: optVal,
        checked: isSelected,
      });
      const row = el(
        'label',
        { className: `ui-choice-option ${isSelected ? 'is-selected' : ''}` },
        radio,
        el('span', { textContent: String(opt.label) })
      );
      radio.addEventListener('change', () => {
        currentValue = optVal;
        render();
        onChange?.(optVal, opt);
      });
      root.appendChild(row);
    });
  }

  render();
  return {
    root,
    element: root,
    getValue: () => currentValue,
  };
}
