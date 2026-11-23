import { el, clearElement, setText } from '../lib/dom.js';
import { getTimePartsInZone } from '../lib/time.js';
import {
  createCompactTopRow,
  createSummaryExtra,
  createWeatherGlyph,
  resolveWeatherVisualKind,
} from './summary-helpers.js';

const SOURCE_LABELS = new Map([
  ['manual', '手动城市'],
  ['browser', '浏览器定位'],
  ['ip', 'IP 近似位置'],
  ['network-ip', '网络出口 IP 近似位置'],
]);

const SUMMARY_HOURLY_LIMIT = 16;
const DETAIL_HOURLY_LIMIT = 6;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Filters weather.hourly to strictly upcoming slots (real epoch, independent of manual clock offset),
 * formatted in the weather location's time zone. Missing/invalid entries are skipped, never faked.
 */
function collectUpcomingHourly(weather, fallbackTimeZone, nowMs, limit = SUMMARY_HOURLY_LIMIT) {
  const list = Array.isArray(weather?.hourly) ? weather.hourly : [];
  if (list.length === 0) return [];
  const timeZone = weather?.timeZone || fallbackTimeZone;
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const epoch = Date.parse(entry.forecastAt);
    if (!Number.isFinite(epoch) || epoch <= nowMs) continue;
    let parts = null;
    try {
      parts = getTimePartsInZone(epoch, timeZone);
    } catch {
      parts = null;
    }
    if (!parts || !parts.timeHM) continue;
    const isDay =
      typeof entry.isDay === 'boolean' ? entry.isDay : parts.hour >= 6 && parts.hour < 18;
    const pop = isFiniteNumber(entry.precipitationProbability)
      ? Math.round(Math.min(100, Math.max(0, entry.precipitationProbability)))
      : null;
    const shortLabel = String(parts.hour).padStart(2, '0');
    out.push({
      epoch,
      label: parts.timeHM,
      shortLabel,
      kind: resolveWeatherVisualKind(entry.weatherCode, isDay),
      temp: isFiniteNumber(entry.temperature) ? Math.round(entry.temperature) : null,
      condition: typeof entry.condition === 'string' ? entry.condition.trim().slice(0, 40) : '',
      pop,
    });
  }
  out.sort((a, b) => a.epoch - b.epoch);
  return out.slice(0, limit);
}

function createHourCell(item, { showPop = false, allowCompact = false } = {}) {
  const tempText = item.temp === null ? '--°' : `${item.temp}°`;
  const glyphWrap = el(
    'span',
    { className: 'cw-hour-icon', 'aria-hidden': 'true', dataset: { weatherKind: item.kind } },
    createWeatherGlyph(item.kind)
  );
  const labelParts = [item.label, item.condition || '天气未知', tempText];
  if (item.pop !== null) labelParts.push(`降水概率 ${item.pop}%`);
  const timeEl = allowCompact
    ? el(
        'span',
        { className: 'cw-hour-time', 'aria-hidden': 'true', title: item.label },
        el('span', { className: 'cw-hour-time-full', textContent: item.label }),
        el('span', { className: 'cw-hour-time-short', textContent: item.shortLabel || item.label.slice(0, 2) })
      )
    : el('span', { className: 'cw-hour-time', 'aria-hidden': 'true', textContent: item.label });
  const tempEl =
    allowCompact && item.temp !== null
      ? el(
          'span',
          { className: 'cw-hour-temp', 'aria-hidden': 'true', title: tempText },
          String(item.temp),
          el('span', { className: 'cw-hour-deg', textContent: '°' })
        )
      : el('span', { className: 'cw-hour-temp', 'aria-hidden': 'true', textContent: tempText });
  const cell = el(
    'div',
    {
      className: 'cw-hour',
      role: 'listitem',
      'aria-label': labelParts.join(' '),
      title: labelParts.join(' · '),
    },
    timeEl,
    glyphWrap,
    tempEl
  );
  if (showPop && item.pop !== null && item.pop >= 10) {
    cell.appendChild(
      el('span', { className: 'cw-hour-pop', 'aria-hidden': 'true', textContent: `${item.pop}%` })
    );
  }
  return cell;
}

function formatGreeting(hour) {
  if (hour < 6) return '深夜静谧，注意休息';
  if (hour < 11) return '早安，开启高效一天';
  if (hour < 14) return '午间时光，保持松弛';
  if (hour < 18) return '下午好，保持灵感';
  return '夜晚好，享受专注时刻';
}

const ADMIN_PREFIX_RE =
  /^(?:内蒙古自治区|广西壮族自治区|宁夏回族自治区|新疆维吾尔自治区|西藏自治区|香港特别行政区|澳门特别行政区|(?:北京|天津|上海|重庆)市|(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾)省)/u;

function resolveLocationDisplayNames(location) {
  const raw = typeof location?.name === 'string' ? location.name.trim() : '';
  if (!raw) return { full: '', short: '' };

  const parts = raw
    .split(/\s*[·•,，/|-]\s*|\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const second = parts[1];
    const last = parts[parts.length - 1];
    const isDirectMunicipality = /^(?:北京|天津|上海|重庆)市?$/u.test(first);
    const shortCandidate = isDirectMunicipality && parts.length === 2 ? first : parts.length > 2 ? second : last;
    return { full: raw, short: shortCandidate || last };
  }

  const region = typeof location?.region === 'string' ? location.region.trim() : '';
  if (region && raw.startsWith(region) && raw.length > region.length + 1) {
    const stripped = raw.slice(region.length).trim();
    if (stripped) return { full: raw, short: stripped };
  }

  const m = ADMIN_PREFIX_RE.exec(raw);
  if (m && raw.length > m[0].length + 1) {
    const rest = raw.slice(m[0].length).trim();
    if (rest && !/^(?:市辖区|城区|郊区)$/u.test(rest)) {
      return { full: raw, short: rest };
    }
  }

  return { full: raw, short: raw };
}

export function mount(root, context) {
  clearElement(root);
  root.className = 'ios-widget widget-clock-weather';

  let currentConfig = {
    showSeconds: context.config?.showSeconds !== false,
  };
  let latestEnv = context.getEnvironmentSnapshot?.() || { location: null, warnings: [], weather: null, weatherError: null, weatherLoading: false };

  const dialMarks = el('div', { className: 'clock-dial-marks' });
  for (let i = 0; i < 12; i++) {
    const tick = el('div', { className: `clock-tick ${i % 3 === 0 ? 'major' : ''}` });
    tick.style.transform = `rotate(${i * 30}deg)`;
    dialMarks.appendChild(tick);
  }

  const hourHand = el('div', { className: 'hand hour-hand' });
  const minuteHand = el('div', { className: 'hand minute-hand' });
  const secondHand = el('div', { className: 'hand second-hand' });
  const analogClock = el(
    'div',
    { className: 'analog-clock' },
    dialMarks,
    hourHand,
    minuteHand,
    secondHand,
    el('div', { className: 'clock-center-dot' })
  );

  const digitalReadout = el('div', { className: 'clock-digital-readout', textContent: '--:--' });
  const zoneBadge = el('button', {
    type: 'button',
    className: 'widget-mini-chip',
    title: '点击打开时间与位置设置',
    textContent: 'UTC',
  });

  const secondsToggleBtn = el('button', {
    type: 'button',
    className: 'widget-mini-chip',
    title: '切换秒针与秒数显示',
    textContent: currentConfig.showSeconds ? '显示秒' : '隐藏秒',
  });

  const clockColumn = el(
    'div',
    { className: 'clock-face-wrap' },
    analogClock,
    digitalReadout,
    el('div', { className: 'clock-chip-row' }, zoneBadge, secondsToggleBtn)
  );

  const locNameEl = el('span', { className: 'weather-loc-name', textContent: '未设置地点' });
  const locSourceBadge = el('span', { className: 'weather-source-badge', textContent: '待定位' });
  const locSettingBtn = el('button', {
    type: 'button',
    className: 'widget-inline-btn',
    title: '设置城市、定位方式与校时',
    textContent: '设置',
  });

  const locRow = el(
    'div',
    { className: 'weather-loc' },
    locNameEl,
    locSourceBadge,
    locSettingBtn
  );

  const tempEl = el('div', { className: 'weather-temp', textContent: '--°' });
  const heroIconWrap = el(
    'span',
    { className: 'weather-hero-icon', 'aria-hidden': 'true', dataset: { weatherKind: 'unknown' } },
    createWeatherGlyph('unknown')
  );
  const nowRow = el('div', { className: 'weather-now-row' }, heroIconWrap, tempEl);
  const conditionEl = el('div', { className: 'weather-desc', textContent: '正在读取位置与天气…' });
  const detailEl = el('div', { className: 'weather-sub-meta', textContent: '' });
  const hourlyDetailEl = el('div', {
    className: 'weather-hourly-detail',
    role: 'list',
    'aria-label': '未来几小时天气',
    hidden: true,
  });

  const footerRow = el('div', { className: 'weather-attribution-row' });
  const observedEl = el('span', { className: 'weather-updated-at', textContent: '' });
  const staleBadge = el('span', { className: 'weather-stale-pill', hidden: true, textContent: '缓存数据' });
  const providerLink = el('a', {
    className: 'weather-provider-link',
    href: 'https://open-meteo.com/',
    target: '_blank',
    rel: 'noopener noreferrer',
    textContent: '来源 Open-Meteo ↗',
    hidden: true,
  });
  const retryBtn = el('button', {
    type: 'button',
    className: 'widget-inline-btn',
    hidden: true,
    textContent: '重试',
  });
  footerRow.append(observedEl, staleBadge, providerLink, retryBtn);

  const greetingEl = el('div', { className: 'weather-greeting', textContent: '' });

  const weatherMeta = el(
    'div',
    { className: 'weather-meta' },
    locRow,
    nowRow,
    conditionEl,
    detailEl,
    hourlyDetailEl,
    footerRow,
    greetingEl
  );

  const inner = el('div', { className: 'widget-inner' }, clockColumn, weatherMeta);
  let lastWeatherVisualKind = '';
  let lastHourlySignature = null;
  const { topRow: compactTopRow, iconWrap: compactWeatherIconWrap } = createCompactTopRow({
    kickerText: '时钟与天气',
    iconNode: createWeatherGlyph('unknown'),
    accentClass: 'is-weather',
  });
  const compactTimeEl = el('span', { className: 'compact-cw-time', textContent: '--:--' });
  const compactTempEl = el('span', { className: 'compact-cw-temp', 'aria-hidden': 'true', textContent: '--°' });
  const compactStatusSrEl = el('span', { className: 'cw-sr-only', textContent: '天气同步中' });
  const compactReadoutEl = el(
    'span',
    { className: 'compact-cw-readout' },
    compactWeatherIconWrap,
    compactTempEl,
    compactStatusSrEl
  );
  const compactPrimary = el(
    'div',
    { className: 'widget-compact-primary compact-cw-row' },
    compactTimeEl,
    compactReadoutEl
  );
  const compactCityFullEl = el('span', { className: 'compact-cw-city-full', textContent: '待定位' });
  const compactCityShortEl = el('span', {
    className: 'compact-cw-city-short',
    'aria-hidden': 'true',
    hidden: true,
    textContent: '',
  });
  const compactCityEl = el(
    'span',
    { className: 'compact-cw-city' },
    compactCityFullEl,
    compactCityShortEl
  );
  const compactDotEl = el('span', {
    className: 'compact-cw-dot',
    'aria-hidden': 'true',
    hidden: true,
    textContent: '·',
  });
  const compactCondEl = el('span', { className: 'compact-cw-cond', hidden: true, textContent: '' });
  const compactSecondary = el(
    'div',
    { className: 'widget-compact-secondary compact-cw-meta' },
    compactCityEl,
    compactDotEl,
    compactCondEl
  );
  const extraRangeEl = el('div', { className: 'summary-cw-range', hidden: true, textContent: '' });
  const extraFeelChip = el('span', { className: 'summary-cw-chip is-feel', hidden: true, textContent: '' });
  const extraHumidChip = el('span', { className: 'summary-cw-chip is-humidity', hidden: true, textContent: '' });
  const extraWindChip = el('span', { className: 'summary-cw-chip is-wind', hidden: true, textContent: '' });
  const extraMetricsRow = el(
    'div',
    { className: 'summary-cw-metrics', hidden: true },
    extraFeelChip,
    extraHumidChip,
    extraWindChip
  );
  const extraZoneEl = el('span', { className: 'summary-cw-zone', textContent: 'UTC' });
  const extraStatusEl = el('span', { className: 'summary-cw-status', hidden: true, textContent: '' });
  const extraFooterRow = el(
    'div',
    { className: 'summary-cw-footer' },
    extraRangeEl,
    extraZoneEl,
    extraStatusEl
  );
  const summaryHourlyEl = el('div', {
    className: 'summary-cw-hourly',
    role: 'list',
    'aria-label': '逐小时天气预报',
    tabIndex: 0,
    dataset: {
      widgetHorizontalScroll: 'true',
    },
    hidden: true,
  });

  // Support horizontal forecast scrolling via keyboard arrows, trackpad/wheel, touch, and mouse pointer drag
  // without opening the detail modal on forecast click/drag or interfering with edit-mode card dragging.
  let hScrollPointerId = null;
  let hScrollStartX = 0;
  let hScrollStartY = 0;
  let hScrollStartLeft = 0;
  let hScrollDragged = false;
  let hScrollSuppressClickUntil = 0;

  function isCardInEditMode() {
    return (
      document.body?.classList?.contains('jiggle-mode') ||
      Boolean(
        root.closest?.(
          '.is-editing, .is-edit-mode, .edit-mode, .jiggle-mode, .is-jiggling, [data-edit-mode="true"], [data-editing="true"]'
        )
      )
    );
  }

  function releaseHourlyPointerDrag(pointerId) {
    if (hScrollPointerId === null || (pointerId !== undefined && pointerId !== hScrollPointerId)) {
      return;
    }
    const pid = hScrollPointerId;
    hScrollPointerId = null;
    summaryHourlyEl.classList.remove('is-dragging');
    try {
      if (
        typeof summaryHourlyEl.hasPointerCapture === 'function' &&
        summaryHourlyEl.hasPointerCapture(pid)
      ) {
        summaryHourlyEl.releasePointerCapture(pid);
      }
    } catch {
      // Ignore pointer capture release errors
    }
  }

  const onHourlyPointerDown = (e) => {
    if (isCardInEditMode()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    hScrollDragged = false;
    // Let touch/pen use native browser pan-x scrolling; bind mouse pointer drag for desktop
    if (e.pointerType && e.pointerType !== 'mouse') {
      hScrollPointerId = null;
      return;
    }
    if (summaryHourlyEl.scrollWidth <= summaryHourlyEl.clientWidth + 1) {
      hScrollPointerId = null;
      return;
    }
    hScrollPointerId = e.pointerId;
    hScrollStartX = e.clientX;
    hScrollStartY = e.clientY;
    hScrollStartLeft = summaryHourlyEl.scrollLeft;
  };

  const onHourlyPointerMove = (e) => {
    if (hScrollPointerId === null || e.pointerId !== hScrollPointerId) return;
    if (isCardInEditMode()) {
      releaseHourlyPointerDrag(e.pointerId);
      return;
    }
    const dx = e.clientX - hScrollStartX;
    const dy = e.clientY - hScrollStartY;
    if (!hScrollDragged) {
      if (Math.hypot(dx, dy) < 4) return;
      hScrollDragged = true;
      summaryHourlyEl.classList.add('is-dragging');
      try {
        summaryHourlyEl.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore capture errors in synthetic test environments
      }
    }
    if (e.cancelable) e.preventDefault();
    summaryHourlyEl.scrollLeft = hScrollStartLeft - dx;
    hScrollSuppressClickUntil = performance.now() + 360;
  };

  const onHourlyPointerUp = (e) => {
    if (hScrollPointerId === null || e.pointerId !== hScrollPointerId) return;
    if (hScrollDragged) {
      hScrollSuppressClickUntil = performance.now() + 360;
    }
    releaseHourlyPointerDrag(e.pointerId);
  };

  const onHourlyPointerCancel = (e) => {
    releaseHourlyPointerDrag(e.pointerId);
  };

  function syncHourlyScrollState() {
    const maxScroll = Math.max(0, summaryHourlyEl.scrollWidth - summaryHourlyEl.clientWidth);
    const left = summaryHourlyEl.scrollLeft;
    const canScroll = maxScroll > 1;
    summaryHourlyEl.dataset.scrollable = canScroll ? 'true' : 'false';
    summaryHourlyEl.classList.toggle('can-scroll-left', canScroll && left > 1);
    summaryHourlyEl.classList.toggle('can-scroll-right', canScroll && left < maxScroll - 1);
  }

  const onHourlyScroll = () => {
    syncHourlyScrollState();
    if (isCardInEditMode()) return;
    hScrollSuppressClickUntil = performance.now() + 260;
  };

  const onHourlyWheel = (e) => {
    if (isCardInEditMode()) return;
    if (summaryHourlyEl.scrollWidth <= summaryHourlyEl.clientWidth + 1) return;
    const rawDelta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (rawDelta !== 0) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        summaryHourlyEl.scrollLeft += e.deltaY;
        if (e.cancelable) e.preventDefault();
      }
      e.stopPropagation();
    }
  };

  const onHourlyClick = (e) => {
    if (isCardInEditMode()) return;
    // Clicking or finishing a drag inside the forecast strip never opens the widget detail modal
    if (hScrollDragged || (hScrollSuppressClickUntil > 0 && performance.now() < hScrollSuppressClickUntil)) {
      hScrollDragged = false;
      e.preventDefault();
    }
    e.stopPropagation();
  };

  const onHourlyKeyDown = (e) => {
    if (isCardInEditMode()) return;
    const pageWidth = summaryHourlyEl.clientWidth || 160;
    const step = Math.max(36, Math.round(pageWidth * 0.5));
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      summaryHourlyEl.scrollLeft += step;
      syncHourlyScrollState();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      summaryHourlyEl.scrollLeft -= step;
      syncHourlyScrollState();
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      e.stopPropagation();
      summaryHourlyEl.scrollLeft += pageWidth;
      syncHourlyScrollState();
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      e.stopPropagation();
      summaryHourlyEl.scrollLeft -= pageWidth;
      syncHourlyScrollState();
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      summaryHourlyEl.scrollLeft = 0;
      syncHourlyScrollState();
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      summaryHourlyEl.scrollLeft = summaryHourlyEl.scrollWidth;
      syncHourlyScrollState();
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Prevent Enter/Space when focused on the forecast strip from triggering card detail open
      e.stopPropagation();
    }
  };

  summaryHourlyEl.addEventListener('pointerdown', onHourlyPointerDown);
  summaryHourlyEl.addEventListener('pointermove', onHourlyPointerMove);
  summaryHourlyEl.addEventListener('pointerup', onHourlyPointerUp);
  summaryHourlyEl.addEventListener('pointercancel', onHourlyPointerCancel);
  summaryHourlyEl.addEventListener('scroll', onHourlyScroll, { passive: true });
  summaryHourlyEl.addEventListener('wheel', onHourlyWheel, { passive: false });
  summaryHourlyEl.addEventListener('click', onHourlyClick);
  summaryHourlyEl.addEventListener('keydown', onHourlyKeyDown);
  const summaryExtra = createSummaryExtra(
    'summary-extra-clock-weather',
    summaryHourlyEl,
    extraMetricsRow,
    extraFooterRow
  );
  const compactSummary = el(
    'div',
    { className: 'widget-compact-summary compact-layout-clock-weather' },
    compactTopRow,
    compactPrimary,
    compactSecondary,
    summaryExtra
  );
  const label = el('span', { className: 'widget-label', textContent: '时钟与天气' });
  root.append(inner, compactSummary, label);

  const onOpenLocationSettings = (e) => {
    e.stopPropagation();
    context.openSettingsModal?.('location');
  };
  const onOpenClockSettings = (e) => {
    e.stopPropagation();
    context.openSettingsModal?.('clock');
  };
  const onToggleSeconds = (e) => {
    e.stopPropagation();
    currentConfig = { showSeconds: !currentConfig.showSeconds };
    setText(secondsToggleBtn, currentConfig.showSeconds ? '显示秒' : '隐藏秒');
    renderClockHands();
    context.saveWidgetConfig?.(currentConfig);
  };
  const onRetryWeather = (e) => {
    e.stopPropagation();
    context.refreshEnvironmentAndWeather?.(true);
  };

  locSettingBtn.addEventListener('click', onOpenLocationSettings);
  zoneBadge.addEventListener('click', onOpenClockSettings);
  secondsToggleBtn.addEventListener('click', onToggleSeconds);
  retryBtn.addEventListener('click', onRetryWeather);

  function renderClockHands() {
    const snap = context.clock.getSnapshot();
    const { hour, minute, second } = snap.parts;
    const ms = ((snap.displayEpochMs % 1000) + 1000) % 1000;

    const secAngle = (second + ms / 1000) * 6;
    const minAngle = (minute + second / 60) * 6;
    const hourAngle = ((hour % 12) + minute / 60) * 30;

    hourHand.style.transform = `rotate(${hourAngle}deg)`;
    minuteHand.style.transform = `rotate(${minAngle}deg)`;
    secondHand.hidden = !currentConfig.showSeconds;
    if (currentConfig.showSeconds) {
      secondHand.style.transform = `rotate(${secAngle}deg)`;
    }

    setText(digitalReadout, currentConfig.showSeconds ? snap.parts.timeHMS : snap.parts.timeHM);
    const modeTag = snap.mode === 'manual' ? '手动校时' : snap.timeZone;
    setText(zoneBadge, modeTag);
    setText(greetingEl, formatGreeting(hour));
    syncCompactSummary();
  }

  function syncCompactSummary() {
    const snap = context.clock.getSnapshot();
    const timeStr = snap.parts.timeHM || '--:--';
    const weather = latestEnv?.weather;
    const currentWeather = weather?.current;
    const unitSymbol = weather?.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
    const hasCurrentTemp = Boolean(
      currentWeather && typeof currentWeather.temperature === 'number'
    );
    const tempStr = hasCurrentTemp
      ? `${Math.round(currentWeather.temperature)}${unitSymbol}`
      : '';
    const liveCond =
      currentWeather?.condition || currentWeather?.conditionLabel || '';
    const isDay =
      typeof currentWeather?.isDay === 'boolean'
        ? currentWeather.isDay
        : snap.parts.hour >= 6 && snap.parts.hour < 18;
    const visualKind = resolveWeatherVisualKind(
      currentWeather?.weatherCode ?? currentWeather?.code,
      isDay
    );
    if (visualKind !== lastWeatherVisualKind) {
      lastWeatherVisualKind = visualKind;
      clearElement(compactWeatherIconWrap);
      compactWeatherIconWrap.appendChild(createWeatherGlyph(visualKind));
      compactWeatherIconWrap.dataset.weatherKind = visualKind;
      clearElement(heroIconWrap);
      heroIconWrap.appendChild(createWeatherGlyph(visualKind));
      heroIconWrap.dataset.weatherKind = visualKind;
    }
    compactSummary.dataset.dayPhase = isDay ? 'day' : 'night';
    const isStaleWeather = Boolean(weather?.cache?.stale);
    const weatherState = hasCurrentTemp || liveCond
      ? isStaleWeather
        ? 'stale'
        : 'live'
      : latestEnv?.weatherLoading
        ? 'loading'
        : 'unavailable';
    compactSummary.dataset.weatherState = weatherState;

    setText(compactTimeEl, timeStr);
    setText(compactTempEl, hasCurrentTemp ? tempStr : '--°');
    const srStatus =
      weatherState === 'loading'
        ? '天气同步中'
        : weatherState === 'unavailable'
          ? '天气暂不可用'
          : `当前天气：${liveCond || '状况未知'}${hasCurrentTemp ? `，${tempStr}` : '，温度暂缺'}${
              isStaleWeather ? '（缓存）' : ''
            }`;
    setText(compactStatusSrEl, srStatus);
    compactReadoutEl.title = srStatus;

    syncHourlyForecast(weather, snap.timeZone);

    const { full: locName, short: shortLocName } = resolveLocationDisplayNames(latestEnv?.location);
    const hasLocation = Boolean(locName);
    const hasDistinctShortCity = Boolean(hasLocation && shortLocName && shortLocName !== locName);
    compactCityEl.dataset.hasShort = hasDistinctShortCity ? 'true' : 'false';
    if (hasLocation) {
      const condStr =
        liveCond || (latestEnv?.weatherLoading ? '天气同步中' : '天气暂不可用');
      setText(compactCityFullEl, locName);
      setText(compactCityShortEl, hasDistinctShortCity ? shortLocName : '');
      compactCityShortEl.hidden = !hasDistinctShortCity;
      compactCityEl.title = `${locName} · ${condStr}`;
      compactDotEl.hidden = false;
      compactCondEl.hidden = false;
      setText(compactCondEl, condStr);
    } else if (hasCurrentTemp || liveCond) {
      setText(compactCityFullEl, '当前位置');
      setText(compactCityShortEl, '');
      compactCityShortEl.hidden = true;
      compactCityEl.removeAttribute('title');
      compactDotEl.hidden = !liveCond;
      compactCondEl.hidden = !liveCond;
      setText(compactCondEl, liveCond);
    } else {
      setText(
        compactCityFullEl,
        latestEnv?.weatherLoading ? '正在定位' : latestEnv?.weatherError ? '天气暂不可用' : '待定位'
      );
      setText(compactCityShortEl, '');
      compactCityShortEl.hidden = true;
      compactCityEl.removeAttribute('title');
      compactDotEl.hidden = true;
      compactCondEl.hidden = true;
      setText(compactCondEl, '');
    }

    const daily = weather?.daily;
    const hasDailyRange = Boolean(
      daily &&
        typeof daily.maxTemperature === 'number' &&
        typeof daily.minTemperature === 'number'
    );
    extraRangeEl.hidden = !hasDailyRange;
    setText(
      extraRangeEl,
      hasDailyRange
        ? `最高 ${Math.round(daily.maxTemperature)}° · 最低 ${Math.round(daily.minTemperature)}°`
        : ''
    );

    const hasFeel = Boolean(
      currentWeather && typeof currentWeather.apparentTemperature === 'number'
    );
    extraFeelChip.hidden = !hasFeel;
    setText(
      extraFeelChip,
      hasFeel ? `体感 ${Math.round(currentWeather.apparentTemperature)}${unitSymbol}` : ''
    );

    const hasHumid = Boolean(
      currentWeather && typeof currentWeather.humidity === 'number'
    );
    extraHumidChip.hidden = !hasHumid;
    setText(
      extraHumidChip,
      hasHumid ? `湿度 ${Math.round(currentWeather.humidity)}%` : ''
    );

    const hasWind = Boolean(
      currentWeather && typeof currentWeather.windSpeedKmh === 'number'
    );
    extraWindChip.hidden = !hasWind;
    setText(
      extraWindChip,
      hasWind ? `风速 ${Math.round(currentWeather.windSpeedKmh)} km/h` : ''
    );

    extraMetricsRow.hidden = !(hasFeel || hasHumid || hasWind);

    const { month, day, weekdayZh } = snap.parts;
    const dateLabel = `${month}月${day}日${weekdayZh ? ` ${weekdayZh}` : ''}`;
    const modeTag = snap.mode === 'manual' ? `${dateLabel} · 手动校时` : dateLabel;
    setText(extraZoneEl, modeTag);

    const statusText = weather?.cache?.stale ? '缓存实况' : '';
    extraStatusEl.hidden = !statusText;
    setText(extraStatusEl, statusText);
  }

  // Rebuilds hourly DOM only when the visible upcoming slot set actually changes (not every clock tick).
  function syncHourlyForecast(weather, fallbackTimeZone) {
    const items = weather
      ? collectUpcomingHourly(weather, fallbackTimeZone, Date.now(), SUMMARY_HOURLY_LIMIT)
      : [];
    const signature = items.length
      ? `${weather?.temperatureUnit || ''}|${items
          .map((it) => `${it.epoch}:${it.kind}:${it.temp}:${it.pop}:${it.label}:${it.condition}`)
          .join(';')}`
      : '';
    if (signature === lastHourlySignature) return;
    lastHourlySignature = signature;

    const prevScrollLeft = summaryHourlyEl.scrollLeft;
    clearElement(summaryHourlyEl);
    clearElement(hourlyDetailEl);
    const hasHourly = items.length > 0;
    const detailItems = items.slice(0, DETAIL_HOURLY_LIMIT);
    summaryHourlyEl.hidden = !hasHourly;
    hourlyDetailEl.hidden = detailItems.length === 0;
    summaryHourlyEl.dataset.hourlyCount = String(items.length);
    summaryHourlyEl.dataset.hasOverflow = items.length > 7 ? 'true' : 'false';
    summaryHourlyEl.setAttribute(
      'aria-label',
      hasHourly
        ? items.length > 7
          ? `逐小时天气预报（共 ${items.length} 小时，可左右滑动查看更多时段）`
          : `逐小时天气预报（共 ${items.length} 小时）`
        : '逐小时天气预报'
    );
    compactSummary.dataset.hasHourly = hasHourly ? 'true' : 'false';
    if (!hasHourly) {
      summaryHourlyEl.dataset.scrollable = 'false';
      summaryHourlyEl.classList.remove('can-scroll-left', 'can-scroll-right');
      return;
    }
    for (const item of items) {
      summaryHourlyEl.appendChild(createHourCell(item, { allowCompact: true }));
    }
    for (const item of detailItems) {
      hourlyDetailEl.appendChild(createHourCell(item, { showPop: true }));
    }
    if (prevScrollLeft > 0) {
      summaryHourlyEl.scrollLeft = prevScrollLeft;
    }
    syncHourlyScrollState();
  }

  function renderWeatherAndLocation() {
    const { location, warnings, weather, weatherError, weatherLoading } = latestEnv;
    const snap = context.clock.getSnapshot();

    if (location && location.name) {
      setText(locNameEl, location.name);
      const sourceText = SOURCE_LABELS.get(location.source) || '已定位';
      setText(locSourceBadge, sourceText);
      locSourceBadge.dataset.source = location.source || 'auto';
    } else {
      setText(locNameEl, '未设置地点');
      setText(locSourceBadge, '需选择城市');
      locSourceBadge.dataset.source = 'none';
    }

    if (weatherLoading && !weather) {
      setText(tempEl, '--°');
      setText(conditionEl, '正在查询实况天气…');
      setText(detailEl, '');
      providerLink.hidden = true;
      staleBadge.hidden = true;
      retryBtn.hidden = true;
      setText(observedEl, '');
      syncCompactSummary();
      return;
    }

    if (weather && weather.current) {
      const unitSymbol = weather.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
      const cur = weather.current;
      const daily = weather.daily;
      setText(tempEl, isFiniteNumber(cur.temperature) ? `${Math.round(cur.temperature)}${unitSymbol}` : '--°');
      const condText = cur.condition || cur.conditionLabel || '天气状况未知';
      const rangeText =
        daily && isFiniteNumber(daily.maxTemperature) && isFiniteNumber(daily.minTemperature)
          ? ` · 最高 ${Math.round(daily.maxTemperature)}° 最低 ${Math.round(daily.minTemperature)}°`
          : '';
      setText(conditionEl, `${condText}${rangeText}`);
      const detailParts = [];
      if (isFiniteNumber(cur.apparentTemperature)) detailParts.push(`体感 ${Math.round(cur.apparentTemperature)}${unitSymbol}`);
      if (isFiniteNumber(cur.humidity)) detailParts.push(`湿度 ${Math.round(cur.humidity)}%`);
      if (isFiniteNumber(cur.windSpeedKmh)) detailParts.push(`风速 ${Math.round(cur.windSpeedKmh)} km/h`);
      setText(detailEl, detailParts.join(' · '));

      // Observed / fetched timestamps are real UTC instants, NOT shifted by manual clock offset
      const realStampIso = weather.current.observedAt || weather.fetchedAt;
      const realEpoch = Date.parse(realStampIso);
      if (Number.isFinite(realEpoch)) {
        const obsParts = getTimePartsInZone(realEpoch, weather.timeZone || snap.timeZone);
        setText(observedEl, `观测 ${obsParts.timeHM}`);
      } else {
        setText(observedEl, '实况已更新');
      }

      const isStale = Boolean(weather.cache?.stale);
      staleBadge.hidden = !isStale;
      if (isStale && weather.fetchedAt) {
        const fetchedEpoch = Date.parse(weather.fetchedAt);
        const fetchedParts = Number.isFinite(fetchedEpoch)
          ? getTimePartsInZone(fetchedEpoch, weather.timeZone || snap.timeZone)
          : null;
        setText(staleBadge, fetchedParts ? `缓存数据 (${fetchedParts.timeHM})` : '缓存数据');
      }

      providerLink.hidden = false;
      retryBtn.hidden = !weatherError;
      syncCompactSummary();
      return;
    }

    // No weather available (either location missing or upstream error)
    setText(tempEl, '--°');
    providerLink.hidden = true;
    staleBadge.hidden = true;

    if (!location) {
      const warnMsg = warnings?.[0]?.message || '请点击「设置」选择城市或开启定位';
      setText(conditionEl, '暂未配置天气地点');
      setText(detailEl, warnMsg);
      setText(observedEl, '');
      retryBtn.hidden = false;
    } else {
      setText(conditionEl, '天气暂不可用');
      setText(detailEl, weatherError || '外部天气服务暂时无法连接，请稍后重试或手动更换城市');
      setText(observedEl, '');
      retryBtn.hidden = false;
    }
    syncCompactSummary();
  }

  renderClockHands();
  renderWeatherAndLocation();

  const timerId = setInterval(renderClockHands, 250);
  const unsubClock = context.clock.subscribe(renderClockHands);

  return {
    update(data = {}) {
      if (data.config && typeof data.config.showSeconds === 'boolean') {
        currentConfig = { showSeconds: data.config.showSeconds };
        setText(secondsToggleBtn, currentConfig.showSeconds ? '显示秒' : '隐藏秒');
      }
      if (data.environment) {
        latestEnv = data.environment;
      }
      renderClockHands();
      renderWeatherAndLocation();
    },
    destroy() {
      clearInterval(timerId);
      unsubClock?.();
      releaseHourlyPointerDrag();
      summaryHourlyEl.removeEventListener('pointerdown', onHourlyPointerDown);
      summaryHourlyEl.removeEventListener('pointermove', onHourlyPointerMove);
      summaryHourlyEl.removeEventListener('pointerup', onHourlyPointerUp);
      summaryHourlyEl.removeEventListener('pointercancel', onHourlyPointerCancel);
      summaryHourlyEl.removeEventListener('scroll', onHourlyScroll);
      summaryHourlyEl.removeEventListener('wheel', onHourlyWheel);
      summaryHourlyEl.removeEventListener('click', onHourlyClick);
      summaryHourlyEl.removeEventListener('keydown', onHourlyKeyDown);
      locSettingBtn.removeEventListener('click', onOpenLocationSettings);
      zoneBadge.removeEventListener('click', onOpenClockSettings);
      secondsToggleBtn.removeEventListener('click', onToggleSeconds);
      retryBtn.removeEventListener('click', onRetryWeather);
      clearElement(root);
    },
  };
}
