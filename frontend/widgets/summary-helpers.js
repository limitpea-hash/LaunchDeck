import { el, setText } from '../lib/dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child) node.appendChild(child);
  }
  return node;
}

export function resolveWeatherVisualKind(weatherCode, isDay = true) {
  if (weatherCode === null || weatherCode === undefined || weatherCode === '') {
    return 'unknown';
  }
  const code = Number(weatherCode);
  if (!Number.isFinite(code)) {
    return 'unknown';
  }
  if (code === 0 || code === 1) {
    return isDay ? 'clear-day' : 'clear-night';
  }
  if (code === 2) {
    return isDay ? 'partly-cloudy-day' : 'cloudy';
  }
  if (code === 3) {
    return 'cloudy';
  }
  if (code === 45 || code === 48) {
    return 'fog';
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return 'rain';
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return 'snow';
  }
  if (code >= 95) {
    return 'storm';
  }
  return 'unknown';
}

export function createWeatherGlyph(kind = 'unknown') {
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.9',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });

  if (kind === 'unknown') {
    svg.append(
      svgNode('circle', { cx: '12', cy: '12', r: '7.5' }),
      svgNode('path', { d: 'M12 8v4.2l2.7 1.6' })
    );
    return svg;
  }

  if (kind === 'clear-night') {
    svg.appendChild(
      svgNode('path', {
        d: 'M20.4 14.5A8.4 8.4 0 0 1 9.5 3.6a8.4 8.4 0 1 0 10.9 10.9Z',
      })
    );
    return svg;
  }

  if (kind === 'partly-cloudy-day') {
    svg.append(
      svgNode('path', { d: 'M12 3v1.6M5.6 5.6l1.1 1.1M3 12h1.6M18.4 5.6l-1.1 1.1' }),
      svgNode('path', { d: 'M8.5 12.2a3.8 3.8 0 0 1 6.7-2.4' }),
      svgNode('path', { d: 'M8.2 18.5h8.6a3.2 3.2 0 0 0 .4-6.37 4.5 4.5 0 0 0-8.68 1.17A2.6 2.6 0 0 0 8.2 18.5Z' })
    );
    return svg;
  }

  if (kind === 'cloudy') {
    svg.appendChild(
      svgNode('path', {
        d: 'M7.5 18.5h9.5a3.8 3.8 0 0 0 .5-7.57A5.3 5.3 0 0 0 7.2 9.8a3.4 3.4 0 0 0 .3 8.7Z',
      })
    );
    return svg;
  }

  if (kind === 'fog') {
    svg.append(
      svgNode('path', { d: 'M5 10h14M3.5 14h17M6.5 18h11' })
    );
    return svg;
  }

  if (kind === 'rain') {
    svg.append(
      svgNode('path', { d: 'M7.4 15.2h9.4a3.4 3.4 0 0 0 .4-6.77 4.8 4.8 0 0 0-9.3-1.03 3 3 0 0 0-.5 7.8Z' }),
      svgNode('path', { d: 'M8.5 18.2l-1 2.3M12.5 18.2l-1 2.3M16.5 18.2l-1 2.3' })
    );
    return svg;
  }

  if (kind === 'snow') {
    svg.append(
      svgNode('path', { d: 'M7.4 15.2h9.4a3.4 3.4 0 0 0 .4-6.77 4.8 4.8 0 0 0-9.3-1.03 3 3 0 0 0-.5 7.8Z' }),
      svgNode('circle', { cx: '8.5', cy: '19', r: '0.9', fill: 'currentColor' }),
      svgNode('circle', { cx: '12', cy: '19.5', r: '0.9', fill: 'currentColor' }),
      svgNode('circle', { cx: '15.5', cy: '19', r: '0.9', fill: 'currentColor' })
    );
    return svg;
  }

  if (kind === 'storm') {
    svg.append(
      svgNode('path', { d: 'M7.4 14.8h9.4a3.4 3.4 0 0 0 .4-6.77 4.8 4.8 0 0 0-9.3-1.03 3 3 0 0 0-.5 7.8Z' }),
      svgNode('path', { d: 'M12.6 15.2l-2.1 3.2h2.5l-1.2 3.1' })
    );
    return svg;
  }

  // Default: clear-day sun
  svg.append(
    svgNode('circle', { cx: '12', cy: '12', r: '4.1' }),
    svgNode('path', {
      d: 'M12 2.5v2.1M12 19.4v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2.5 12h2.1M19.4 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5',
    })
  );
  return svg;
}

export function createStaticWidgetIcon(type) {
  const svg = svgNode('svg', {
    viewBox: '0 0 20 20',
    width: '14',
    height: '14',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });

  switch (type) {
    case 'focus-timer':
      svg.append(
        svgNode('circle', { cx: '10', cy: '10.8', r: '6.4' }),
        svgNode('path', { d: 'M10 7.4v3.6l2.3 1.4M8 2.6h4' })
      );
      break;
    case 'calendar':
      svg.append(
        svgNode('rect', { x: '3', y: '4.2', width: '14', height: '12.8', rx: '2.5' }),
        svgNode('path', { d: 'M6.5 2.6v3M13.5 2.6v3M3 8.2h14' })
      );
      break;
    case 'world-clock':
      svg.append(
        svgNode('circle', { cx: '10', cy: '10', r: '7' }),
        svgNode('path', { d: 'M3.2 10h13.6M10 3a10.6 10.6 0 0 1 0 14M10 3a10.6 10.6 0 0 0 0 14' })
      );
      break;
    case 'todo':
      svg.append(
        svgNode('rect', { x: '3.2', y: '3.2', width: '13.6', height: '13.6', rx: '3.2' }),
        svgNode('path', { d: 'M6.8 10.2l2.1 2.2 4.4-4.5' })
      );
      break;
    case 'quick-note':
      svg.append(
        svgNode('path', { d: 'M5 3.2h7.4L16 6.8v9.4a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6V4.8A1.6 1.6 0 0 1 5 3.2Z' }),
        svgNode('path', { d: 'M12 3.3v3.6h3.6M6.5 10.2h7M6.5 13.4h4.8' })
      );
      break;
    default:
      svg.append(
        svgNode('circle', { cx: '10', cy: '10', r: '6.8' }),
        svgNode('path', { d: 'M10 6.5v3.8l2.4 1.4' })
      );
      break;
  }

  return svg;
}

export function createCompactTopRow({ kickerText, iconNode, accentClass = '' }) {
  const iconWrap = el(
    'span',
    {
      className: `widget-compact-icon ${accentClass}`.trim(),
      'aria-hidden': 'true',
    },
    iconNode || null
  );
  const kicker = el('span', { className: 'widget-compact-kicker', textContent: kickerText });
  const left = el('span', { className: 'widget-compact-kicker-wrap' }, iconWrap, kicker);
  const badge = el('span', {
    className: 'widget-compact-badge',
    'aria-hidden': 'true',
    textContent: '↗',
  });
  return {
    topRow: el('div', { className: 'widget-compact-top' }, left, badge),
    iconWrap,
    kicker,
    badge,
  };
}

export function createFocusProgressRing() {
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const trackCircle = svgNode('circle', {
    class: 'compact-ring-track',
    cx: '18',
    cy: '18',
    r: String(radius),
    'stroke-width': '3.2',
    fill: 'none',
  });
  const progressCircle = svgNode('circle', {
    class: 'compact-ring-value',
    cx: '18',
    cy: '18',
    r: String(radius),
    'stroke-width': '3.2',
    fill: 'none',
    'stroke-linecap': 'round',
    'stroke-dasharray': circumference.toFixed(2),
    'stroke-dashoffset': circumference.toFixed(2),
  });
  const svg = svgNode(
    'svg',
    {
      class: 'compact-focus-ring-svg',
      viewBox: '0 0 36 36',
      width: '36',
      height: '36',
      'aria-hidden': 'true',
    },
    trackCircle,
    progressCircle
  );
  const pctLabel = el('span', { className: 'compact-focus-ring-pct', textContent: '0%' });
  const root = el('div', { className: 'compact-focus-ring', 'aria-hidden': 'true' }, svg, pctLabel);

  return {
    root,
    setProgress(pct, phase = 'work', running = false) {
      const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
      const offset = circumference * (1 - clamped / 100);
      progressCircle.setAttribute('stroke-dashoffset', offset.toFixed(2));
      root.dataset.phase = phase;
      root.dataset.running = running ? 'true' : 'false';
      setText(pctLabel, `${Math.round(clamped)}%`);
    },
  };
}

export function createSummaryExtra(extraClass = '', ...children) {
  return el(
    'div',
    {
      className: `widget-summary-extra ${extraClass}`.trim(),
    },
    ...children
  );
}

export function createSummaryScrollRegion({ ariaLabel, extraClass = '' }, ...children) {
  return el(
    'div',
    {
      className: `widget-summary-scroll ${extraClass}`.trim(),
      tabIndex: 0,
      role: 'region',
      'aria-label': ariaLabel || '组件内容预览',
    },
    ...children
  );
}
