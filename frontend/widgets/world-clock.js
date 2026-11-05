import { el, clearElement, setText } from '../lib/dom.js';
import { getTimePartsInZone, getZoneOffsetMinutes, isValidTimeZone } from '../lib/time.js';
import {
  createButton,
  createIconButton,
  createSelect,
} from '../lib/ui/index.js';

const DEFAULT_ZONES = [
  { label: '上海', timeZone: 'Asia/Shanghai' },
  { label: '伦敦', timeZone: 'Europe/London' },
  { label: '纽约', timeZone: 'America/New_York' },
];

function sanitizeZones(zones) {
  if (!Array.isArray(zones) || zones.length === 0) return structuredClone(DEFAULT_ZONES);
  const valid = [];
  for (const item of zones) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '').trim().slice(0, 60);
    const tz = String(item.timeZone || '').trim();
    if (label && isValidTimeZone(tz)) {
      valid.push({ label, timeZone: tz });
    }
    if (valid.length >= 8) break;
  }
  return valid.length > 0 ? valid : structuredClone(DEFAULT_ZONES);
}

export function mount(root, context) {
  clearElement(root);
  root.className = 'ios-widget widget-world-clock';

  let zones = sanitizeZones(context.config?.zones);
  let editing = false;

  const titleSpan = el('span', { className: 'world-clock-title', textContent: '世界时钟' });
  const editToggleBtn = createButton({
    label: '管理时区',
    size: 'sm',
  });

  const header = el(
    'div',
    { className: 'world-clock-header' },
    titleSpan,
    editToggleBtn
  );

  const addForm = el('form', { className: 'world-clock-add-form', hidden: true });
  const labelInput = el('input', {
    type: 'text',
    className: 'world-clock-input',
    placeholder: '标签 (如 东京)',
    maxlength: 60,
    'aria-label': '世界时钟地点标签',
  });
  const zoneSelectControl = createSelect({
    options: ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/New_York'],
    value: 'Asia/Tokyo',
    searchable: true,
    compact: true,
    searchPlaceholder: '搜索 IANA 时区 (如 Tokyo)…',
    ariaLabel: '选择 IANA 时区',
  });
  zoneSelectControl.root.classList.add('world-clock-zone-picker');

  const addBtn = createButton({
    label: '添加',
    variant: 'primary',
    size: 'sm',
    type: 'submit',
    ariaLabel: '添加时区',
  });
  addForm.append(labelInput, zoneSelectControl.root, addBtn);

  const errorBanner = el('div', { className: 'widget-error-inline', hidden: true });
  const listContainer = el('div', { className: 'world-clock-list' });

  const inner = el('div', { className: 'widget-inner' }, header, addForm, errorBanner, listContainer);
  const compactPrimary = el('div', { className: 'widget-compact-primary', textContent: '' });
  const compactSecondary = el('div', { className: 'widget-compact-secondary', textContent: '' });
  const compactSummary = el(
    'div',
    { className: 'widget-compact-summary' },
    el(
      'div',
      { className: 'widget-compact-top' },
      el('span', { className: 'widget-compact-kicker', textContent: '世界时钟' }),
      el('span', { className: 'widget-compact-badge', textContent: '详情 ↗' })
    ),
    compactPrimary,
    compactSecondary
  );
  const label = el('span', { className: 'widget-label', textContent: '世界时钟' });
  root.append(inner, compactSummary, label);

  function populateTimeZones() {
    const available = context.getAvailableTimeZones?.() || [
      'UTC',
      'Asia/Shanghai',
      'Asia/Tokyo',
      'Europe/London',
      'Europe/Paris',
      'America/New_York',
      'America/Los_Angeles',
      'Australia/Sydney',
    ];
    const defaultVal = available.includes('Asia/Tokyo') ? 'Asia/Tokyo' : available[0];
    zoneSelectControl.setOptions(available, zoneSelectControl.getValue() || defaultVal);
  }

  function renderZones() {
    clearElement(listContainer);
    const snap = context.clock.getSnapshot();
    const baseEpoch = snap.displayEpochMs;
    const primaryOffsetMins = getZoneOffsetMinutes(baseEpoch, snap.timeZone);
    const primaryParts = snap.parts;

    zones.forEach((zone, index) => {
      const parts = getTimePartsInZone(baseEpoch, zone.timeZone);
      const offsetMins = getZoneOffsetMinutes(baseEpoch, zone.timeZone);
      const diffHours = (offsetMins - primaryOffsetMins) / 60;
      const diffSign = diffHours > 0 ? `+${diffHours}` : `${diffHours}`;
      let dayTag = '同日';
      if (parts.isoDate > primaryParts.isoDate) dayTag = '次日';
      else if (parts.isoDate < primaryParts.isoDate) dayTag = '前日';
      const subText = diffHours === 0 ? `${dayTag} · 同本地时区` : `${dayTag} · ${diffSign}小时`;

      const leftCol = el(
        'div',
        { className: 'world-clock-meta' },
        el('span', { className: 'world-clock-city', textContent: zone.label }),
        el('span', { className: 'world-clock-diff', textContent: `${subText} (${zone.timeZone})` })
      );

      const rightCol = el('div', { className: 'world-clock-right' },
        el('span', { className: 'world-clock-time', textContent: parts.timeHM })
      );

      if (editing && zones.length > 1) {
        const removeBtn = createIconButton({
          iconText: '×',
          variant: 'danger',
          title: '移除此时区',
          ariaLabel: `移除 ${zone.label}`,
          onClick: (e) => {
            e.stopPropagation();
            if (zones.length <= 1) return;
            zones = zones.filter((_, idx) => idx !== index);
            renderZones();
            context.saveWidgetConfig?.({ zones: structuredClone(zones) });
          },
        });
        rightCol.appendChild(removeBtn);
      }

      listContainer.appendChild(
        el('div', { className: 'world-clock-row' }, leftCol, rightCol)
      );
    });

    const compactTokens = zones.slice(0, 3).map((z) => {
      const p = getTimePartsInZone(baseEpoch, z.timeZone);
      return `${z.label} ${p.timeHM}`;
    });
    setText(compactPrimary, compactTokens[0] || '世界时钟');
    setText(
      compactSecondary,
      compactTokens.slice(1).join(' · ') || `共 ${zones.length} 个时区`
    );
  }

  const onToggleEdit = (e) => {
    e.stopPropagation();
    editing = !editing;
    addForm.hidden = !editing;
    setText(editToggleBtn, editing ? '完成' : '管理时区');
    if (editing) {
      populateTimeZones();
    } else {
      zoneSelectControl.close();
    }
    errorBanner.hidden = true;
    renderZones();
  };

  const onAddZone = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (zones.length >= 8) {
      setText(errorBanner, '世界时钟最多支持 8 个时区地点');
      errorBanner.hidden = false;
      return;
    }
    const tz = zoneSelectControl.getValue();
    if (!isValidTimeZone(tz)) {
      setText(errorBanner, '请选择有效的 IANA 时区');
      errorBanner.hidden = false;
      return;
    }
    const rawLabel = labelInput.value.trim();
    const fallbackLabel = tz.split('/').pop()?.replace(/_/g, ' ') || tz;
    const cityLabel = (rawLabel || fallbackLabel).slice(0, 60);

    zones = [...zones, { label: cityLabel, timeZone: tz }];
    labelInput.value = '';
    errorBanner.hidden = true;
    renderZones();
    context.saveWidgetConfig?.({ zones: structuredClone(zones) });
  };

  editToggleBtn.addEventListener('click', onToggleEdit);
  addForm.addEventListener('submit', onAddZone);

  populateTimeZones();
  renderZones();
  const timerId = setInterval(renderZones, 1000);
  const unsubClock = context.clock.subscribe(renderZones);

  return {
    update(data = {}) {
      if (data.config?.zones) {
        zones = sanitizeZones(data.config.zones);
      }
      if (editing && data.timeZones) {
        populateTimeZones();
      }
      renderZones();
    },
    destroy() {
      clearInterval(timerId);
      unsubClock?.();
      zoneSelectControl.destroy();
      editToggleBtn.removeEventListener('click', onToggleEdit);
      addForm.removeEventListener('submit', onAddZone);
      clearElement(root);
    },
  };
}
