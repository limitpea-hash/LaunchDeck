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

function formatGreeting(hour) {
  if (hour < 6) return '深夜静谧，注意休息';
  if (hour < 11) return '早安，开启高效一天';
  if (hour < 14) return '午间时光，保持松弛';
  if (hour < 18) return '下午好，保持灵感';
  return '夜晚好，享受专注时刻';
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
  const conditionEl = el('div', { className: 'weather-desc', textContent: '正在读取位置与天气…' });
  const detailEl = el('div', { className: 'weather-sub-meta', textContent: '' });

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
    tempEl,
    conditionEl,
    detailEl,
    footerRow,
    greetingEl
  );

  const inner = el('div', { className: 'widget-inner' }, clockColumn, weatherMeta);
  const compactTimeEl = el('span', { className: 'compact-cw-time', textContent: '--:--' });
  const compactTempEl = el('span', { className: 'compact-cw-temp', textContent: '--°' });
  const compactPrimary = el(
    'div',
    { className: 'widget-compact-primary compact-cw-row' },
    compactTimeEl,
    compactTempEl
  );
  const compactCityEl = el('span', { className: 'compact-cw-city', textContent: '未定城市' });
  const compactCondEl = el('span', { className: 'compact-cw-cond', textContent: '时钟与天气' });
  const compactSecondary = el(
    'div',
    { className: 'widget-compact-secondary compact-cw-meta' },
    compactCityEl,
    el('span', { className: 'compact-cw-dot', 'aria-hidden': 'true', textContent: '·' }),
    compactCondEl
  );
  let lastWeatherVisualKind = '';
  const { topRow: compactTopRow, iconWrap: compactWeatherIconWrap } = createCompactTopRow({
    kickerText: '时钟与天气',
    iconNode: createWeatherGlyph('clear-day'),
    accentClass: 'is-weather',
  });
  const extraRangeEl = el('div', { className: 'summary-cw-range', textContent: '最高 --° · 最低 --°' });
  const extraFeelChip = el('span', { className: 'summary-cw-chip is-feel', textContent: '体感 --°' });
  const extraHumidChip = el('span', { className: 'summary-cw-chip is-humidity', textContent: '湿度 --%' });
  const extraWindChip = el('span', { className: 'summary-cw-chip is-wind', textContent: '风速 -- km/h' });
  const extraMetricsRow = el(
    'div',
    { className: 'summary-cw-metrics' },
    extraFeelChip,
    extraHumidChip,
    extraWindChip
  );
  const extraZoneEl = el('span', { className: 'summary-cw-zone', textContent: 'UTC' });
  const extraStatusEl = el('span', { className: 'summary-cw-status', textContent: '等待实况更新' });
  const extraGreetingEl = el('div', { className: 'summary-cw-greeting', textContent: '' });
  const extraFooterRow = el(
    'div',
    { className: 'summary-cw-footer' },
    extraZoneEl,
    extraStatusEl
  );
  const summaryExtra = createSummaryExtra(
    'summary-extra-clock-weather',
    extraRangeEl,
    extraMetricsRow,
    extraFooterRow,
    extraGreetingEl
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
    const locName = latestEnv?.location?.name || '未定城市';
    const weather = latestEnv?.weather;
    const currentWeather = weather?.current;
    const unitSymbol = weather?.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
    const tempStr =
      currentWeather && typeof currentWeather.temperature === 'number'
        ? `${Math.round(currentWeather.temperature)}${unitSymbol}`
        : '--°';
    const condStr =
      currentWeather?.condition ||
      currentWeather?.conditionLabel ||
      (latestEnv?.weatherLoading ? '查询中' : '实况待定');
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
      compactSummary.dataset.dayPhase = isDay ? 'day' : 'night';
    }
    setText(compactTimeEl, timeStr);
    setText(compactTempEl, tempStr);
    setText(compactCityEl, locName);
    setText(compactCondEl, condStr);

    const daily = weather?.daily;
    if (
      daily &&
      typeof daily.maxTemperature === 'number' &&
      typeof daily.minTemperature === 'number'
    ) {
      setText(
        extraRangeEl,
        `${condStr} · 最高 ${Math.round(daily.maxTemperature)}° / 最低 ${Math.round(daily.minTemperature)}°`
      );
    } else {
      setText(extraRangeEl, `${condStr} · 最高 --° / 最低 --°`);
    }

    if (currentWeather && typeof currentWeather.apparentTemperature === 'number') {
      setText(extraFeelChip, `体感 ${Math.round(currentWeather.apparentTemperature)}${unitSymbol}`);
    } else {
      setText(extraFeelChip, '体感 --°');
    }

    if (currentWeather && typeof currentWeather.humidity === 'number') {
      setText(extraHumidChip, `湿度 ${Math.round(currentWeather.humidity)}%`);
    } else {
      setText(extraHumidChip, '湿度 --%');
    }

    if (currentWeather && typeof currentWeather.windSpeedKmh === 'number') {
      setText(extraWindChip, `风速 ${Math.round(currentWeather.windSpeedKmh)} km/h`);
    } else {
      setText(extraWindChip, '风速 -- km/h');
    }

    const modeTag = snap.mode === 'manual' ? '手动校时' : snap.timeZone || 'UTC';
    const dateTag =
      snap.parts.month && snap.parts.day
        ? `${snap.parts.month}月${snap.parts.day}日 ${snap.parts.weekdayZh || ''}`.trim()
        : modeTag;
    setText(extraZoneEl, `${dateTag} · ${modeTag}`);

    const sourceLabel = latestEnv?.location?.source
      ? SOURCE_LABELS.get(latestEnv.location.source) || '已定位'
      : '待定位';
    if (weather?.cache?.stale) {
      setText(extraStatusEl, `${sourceLabel} · 缓存实况`);
    } else if (currentWeather) {
      setText(extraStatusEl, `${sourceLabel} · 实时天气`);
    } else if (latestEnv?.weatherLoading) {
      setText(extraStatusEl, `${sourceLabel} · 正在同步`);
    } else {
      setText(extraStatusEl, `${sourceLabel} · 暂无实况`);
    }
    setText(extraGreetingEl, formatGreeting(snap.parts.hour));
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

    if (weather && weather.current && weather.daily) {
      const unitSymbol = weather.temperatureUnit === 'fahrenheit' ? '°F' : '°C';
      setText(tempEl, `${Math.round(weather.current.temperature)}${unitSymbol}`);
      setText(
        conditionEl,
        `${weather.current.condition} · 最高 ${Math.round(weather.daily.maxTemperature)}° 最低 ${Math.round(weather.daily.minTemperature)}°`
      );
      setText(
        detailEl,
        `体感 ${Math.round(weather.current.apparentTemperature)}${unitSymbol} · 湿度 ${Math.round(weather.current.humidity)}% · 风速 ${Math.round(weather.current.windSpeedKmh)} km/h`
      );

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
      locSettingBtn.removeEventListener('click', onOpenLocationSettings);
      zoneBadge.removeEventListener('click', onOpenClockSettings);
      secondsToggleBtn.removeEventListener('click', onToggleSeconds);
      retryBtn.removeEventListener('click', onRetryWeather);
      clearElement(root);
    },
  };
}
