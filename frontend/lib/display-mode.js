import { normalizeWidgetSize } from './feature-client.js';
import {
  MAX_CELL_ROW,
  MAX_CELL_COLUMN,
  isFixedCellCapableKind,
  normalizePlacementCell,
  formatCellKey,
} from './desktop-cells.js';

export const MOBILE_DISPLAY_MODE_STORAGE_KEY = 'ios18_mobile_display_mode_v1';
export const MOBILE_BREAKPOINT_PX = 768;

export const DISPLAY_MODES = Object.freeze({
  COMPACT: 'compact',
  COMFORT: 'comfort',
});

export function normalizeMobileDisplayMode(rawValue) {
  if (rawValue === DISPLAY_MODES.COMFORT) {
    return DISPLAY_MODES.COMFORT;
  }
  return DISPLAY_MODES.COMPACT;
}

export function loadMobileDisplayMode(storage = undefined) {
  try {
    const targetStorage =
      storage === undefined
        ? typeof localStorage !== 'undefined'
          ? localStorage
          : null
        : storage;
    if (!targetStorage || typeof targetStorage.getItem !== 'function') {
      return DISPLAY_MODES.COMPACT;
    }
    const raw = targetStorage.getItem(MOBILE_DISPLAY_MODE_STORAGE_KEY);
    if (!raw) return DISPLAY_MODES.COMPACT;
    if (raw === DISPLAY_MODES.COMPACT || raw === DISPLAY_MODES.COMFORT) {
      return raw;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return normalizeMobileDisplayMode(parsed);
    }
    if (parsed && typeof parsed === 'object') {
      return normalizeMobileDisplayMode(parsed.mode);
    }
  } catch {
    // Ignore storage read/parse/security errors and fall back to compact
  }
  return DISPLAY_MODES.COMPACT;
}

export function saveMobileDisplayMode(mode, storage = undefined) {
  const normalized = normalizeMobileDisplayMode(mode);
  try {
    const targetStorage =
      storage === undefined
        ? typeof localStorage !== 'undefined'
          ? localStorage
          : null
        : storage;
    if (!targetStorage || typeof targetStorage.setItem !== 'function') {
      return normalized;
    }
    targetStorage.setItem(
      MOBILE_DISPLAY_MODE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        mode: normalized,
      })
    );
  } catch {
    // Ignore quota/security storage errors
  }
  return normalized;
}

export function isMobileViewport(viewportWidth = 1280) {
  const w = Number(viewportWidth);
  if (!Number.isFinite(w) || w <= 0) return false;
  return w <= MOBILE_BREAKPOINT_PX;
}

export function resolveEffectiveDisplayMode({
  viewportWidth = 1280,
  mobileDisplayMode = DISPLAY_MODES.COMPACT,
} = {}) {
  if (!isMobileViewport(viewportWidth)) {
    return DISPLAY_MODES.COMPACT;
  }
  return normalizeMobileDisplayMode(mobileDisplayMode);
}

/** Column × row spans for every widget size enum (width × height). Legacy 4×2 `wide` is migrated away. */
export const WIDGET_SIZE_SPANS = Object.freeze({
  single: Object.freeze({ colSpan: 1, rowSpan: 1 }),
  compact: Object.freeze({ colSpan: 2, rowSpan: 1 }),
  square: Object.freeze({ colSpan: 2, rowSpan: 2 }),
  landscape: Object.freeze({ colSpan: 3, rowSpan: 2 }),
  tall: Object.freeze({ colSpan: 2, rowSpan: 3 }),
  large: Object.freeze({ colSpan: 3, rowSpan: 3 }),
  full: Object.freeze({ colSpan: 4, rowSpan: 4 }),
  strip: Object.freeze({ colSpan: 4, rowSpan: 1 }),
});

export const WIDGET_DISPLAY_SIZES = Object.freeze(Object.keys(WIDGET_SIZE_SPANS));

/** Sizes whose painted card is a true square (equal column and row spans). */
export const SQUARE_WIDGET_SIZES = Object.freeze(['single', 'square', 'large', 'full']);

/** Widget types whose saved size is fixed and must never be temporarily downgraded. */
export const FIXED_SIZE_WIDGET_TYPES = Object.freeze(['currency-converter']);

/**
 * Widget types whose minimum supported display size is `square` (2×2) and no longer support `compact` (2×1).
 * When their selected size (`landscape` 3×2 or `full` 4×4) cannot fit the available columns/rows, they
 * temporarily fall back to `square` (2×2); when even 2×2 cannot fit (<2 rows or <2 cols), they keep `square`
 * so packing routes them to `查看全部` overflow without mutating the user's saved preference.
 */
export const SQUARE_MINIMUM_WIDGET_TYPES = Object.freeze(['clock-weather', 'calendar']);

// Temporary (display-only) downgrade chain when a saved size does not fit the current grid.
const WIDGET_SIZE_FALLBACKS = Object.freeze({
  full: 'square',
  large: 'square',
  tall: 'square',
  landscape: 'square',
  strip: 'compact',
  square: 'compact',
  compact: 'compact',
  single: 'single',
});

export function resolveWidgetDisplaySize(item, metrics = {}) {
  if (!item || item.kind !== 'widget') {
    return 'compact';
  }
  const widget = item.widget || item;
  const widgetType = widget?.type || item?.type || '';
  const rawSize = widget?.size ?? item?.size;
  // Unsaved/unsupported/legacy sizes resolve through the builtin registry (incl. legacySizes such as
  // wide → square/strip, large → full): legacy types keep the historical fallback, daily types use their default.
  let size = normalizeWidgetSize(rawSize, widgetType || null);
  if (!Object.hasOwn(WIDGET_SIZE_SPANS, size)) {
    size = 'compact';
  }

  // Built-in currency converter is always 2×2; when it cannot fit it goes to 查看全部 / detail instead.
  if (FIXED_SIZE_WIDGET_TYPES.includes(widgetType)) {
    return size;
  }

  const maxRows =
    metrics?.maxRows !== undefined && metrics?.maxRows !== null ? Number(metrics.maxRows) : 6;
  const rowsAvailable = Number.isFinite(maxRows) ? maxRows : 6;
  const columns = Math.max(1, Number(metrics?.columns) || 6);

  // Clock-weather (square 2×2 / landscape 3×2) and calendar (square 2×2 / full 4×4) never degrade to 2×1:
  // show the selected size whenever its columns × rows fit (including landscape 3×2 on 2-row viewports),
  // otherwise fall back to 2×2 square (which overflows to 查看全部 if <2 rows or <2 columns are available).
  if (SQUARE_MINIMUM_WIDGET_TYPES.includes(widgetType)) {
    const span = WIDGET_SIZE_SPANS[size] || WIDGET_SIZE_SPANS.square;
    if (span.colSpan <= columns && span.rowSpan <= rowsAvailable) {
      return size;
    }
    return 'square';
  }

  // Height-constrained windows (fewer than 3 visible rows, e.g. 800x420 desktop or very short phones)
  // temporarily render other multi-cell widgets as a readable 2x1 summary so more cards/sites fit
  // (1x1 stays 1x1). Stored size is untouched; enlarging the window restores the saved layout.
  // Normal phones (375x667 compact = 8 rows, comfort ≈ 4 rows) and desktops (>= 3 rows) keep sizes.
  if (Number.isFinite(maxRows) && maxRows < 3) {
    return size === 'single' ? 'single' : 'compact';
  }

  if (columns < 2) {
    return size === 'single' ? 'single' : 'compact';
  }
  let guard = 0;
  while (guard < 6) {
    const span = WIDGET_SIZE_SPANS[size];
    if (span.colSpan <= columns && span.rowSpan <= rowsAvailable) break;
    const next = WIDGET_SIZE_FALLBACKS[size] || 'compact';
    if (next === size) break;
    size = next;
    guard += 1;
  }

  return size;
}

/** Page site tiles: 1×1 by default, optional 2×2 (`site.size === 'square'`). Dock/folders stay 1×1. */
export const SITE_SIZE_SPANS = Object.freeze({
  single: Object.freeze({ colSpan: 1, rowSpan: 1 }),
  square: Object.freeze({ colSpan: 2, rowSpan: 2 }),
});

export function resolveSiteDisplaySize(entryOrSite) {
  const site = entryOrSite?.kind === 'site' ? entryOrSite.site : entryOrSite;
  return site && site.size === 'square' ? 'square' : 'single';
}

export function getWidgetGridSpan(item, metrics = {}) {
  const columns = Math.max(1, Number(metrics?.columns) || 6);
  if (item && item.kind === 'site') {
    // 2×2 sites are never downgraded; if they cannot fit they go to 查看全部 (like currency)
    const span = SITE_SIZE_SPANS[resolveSiteDisplaySize(item)];
    return { colSpan: Math.min(columns, span.colSpan), rowSpan: span.rowSpan };
  }
  if (!item || item.kind !== 'widget') {
    return { colSpan: 1, rowSpan: 1 };
  }
  const size = resolveWidgetDisplaySize(item, metrics);
  if (size === 'compact') {
    const defaultColSpan = Math.min(columns, Math.max(1, Number(metrics?.widgetColSpan) || 2));
    const defaultRowSpan = Math.max(1, Number(metrics?.widgetRowSpan) || 1);
    return { colSpan: defaultColSpan, rowSpan: defaultRowSpan };
  }
  const span = WIDGET_SIZE_SPANS[size] || WIDGET_SIZE_SPANS.compact;
  return { colSpan: Math.min(columns, span.colSpan), rowSpan: span.rowSpan };
}

export const DESKTOP_MIN_COLUMNS = 6;
export const DESKTOP_MAX_COLUMNS = 48;
export const DESKTOP_TARGET_TRACK_WIDTH_PX = 90;
export const DESKTOP_MAX_TRACK_WIDTH_PX = 106;
export const DESKTOP_SHELL_GUTTER_MIN_PX = 28;
export const DESKTOP_SHELL_GUTTER_MAX_PX = 180;
export const DESKTOP_PAGE_INLINE_PADDING_PX = 16;

/**
 * Desktop shell inline padding per side. Must match CSS
 * `clamp(28px, calc(6.7vw - 25.6px), 180px)` on .springboard-shell (desktop only):
 * ~28px at <=800px, ~60px at 1280px, ~103px at 1920px (≈116px visible gutter with page padding),
 * capped at 180px on very wide screens so additional columns are still added.
 */
export function computeDesktopShellGutterPx(viewportWidth = 1280) {
  const w = Math.max(320, Number(viewportWidth) || 1280);
  const raw = w * 0.067 - 25.6;
  return Math.min(
    DESKTOP_SHELL_GUTTER_MAX_PX,
    Math.max(DESKTOP_SHELL_GUTTER_MIN_PX, Math.round(raw))
  );
}

export function computeDesktopGridColumns({
  availableGridWidth = 1228,
  colGap = 12,
  targetTrackWidth = DESKTOP_TARGET_TRACK_WIDTH_PX,
  minColumns = DESKTOP_MIN_COLUMNS,
  maxColumns = DESKTOP_MAX_COLUMNS,
} = {}) {
  const usableW = Math.max(320, Math.floor(Number(availableGridWidth) || 1228));
  const gap = Math.max(0, Math.round(Number(colGap) || 12));
  const track = Math.max(64, Math.round(Number(targetTrackWidth) || DESKTOP_TARGET_TRACK_WIDTH_PX));
  const pitch = track + gap;
  const rawCols = Math.floor((usableW + gap) / pitch);
  return Math.min(maxColumns, Math.max(minColumns, rawCols));
}

/**
 * Computes responsive single-screen metrics for:
 * - Desktop Compact (e.g. 1280x720, 1366x768, 1440x900, 1920x1080, 2560x1440)
 * - Mobile Compact (e.g. 375x812, 375x667)
 * - Mobile Comfort (relaxed multi-screen view paging)
 *
 * Ensures that 6 widgets + 24 sites fit on a single screen in both desktop compact
 * and mobile compact (including 375x667) without page vertical scrolling or illegible scaling.
 */
export function computeSingleScreenMetrics({
  viewportWidth = 1280,
  viewportHeight = 800,
  mobileDisplayMode = DISPLAY_MODES.COMPACT,
  safeAreaTop = 0,
  safeAreaBottom = 0,
  safeAreaLeft = 0,
  safeAreaRight = 0,
  measuredAvailableGridHeight = null,
  measuredAvailableGridWidth = null,
} = {}) {
  const width = Math.max(320, Math.round(Number(viewportWidth) || 1280));
  const rawHeight = Math.round(Number(viewportHeight) || 800);
  const height = Math.max(240, rawHeight);
  const isMobile = isMobileViewport(width);
  const effectiveMode = resolveEffectiveDisplayMode({ viewportWidth: width, mobileDisplayMode });
  const hasMeasuredGridHeight =
    measuredAvailableGridHeight !== null &&
    measuredAvailableGridHeight !== undefined &&
    Number.isFinite(Number(measuredAvailableGridHeight)) &&
    Number(measuredAvailableGridHeight) > 0;
  const hasMeasuredGridWidth =
    measuredAvailableGridWidth !== null &&
    measuredAvailableGridWidth !== undefined &&
    Number.isFinite(Number(measuredAvailableGridWidth)) &&
    Number(measuredAvailableGridWidth) > 0;

  if (!isMobile) {
    // Desktop Compact: dynamically choose columns (min 6) from usable grid width
    // using modest responsive side gutters (~28-72px shell inline padding + 16px page padding)
    // and a tight column pitch (~102-104px: ~90px target track + 12-14px colGap).
    const shellGutterPx = computeDesktopShellGutterPx(width);
    const reservedSideGuttersPx = shellGutterPx * 2 + DESKTOP_PAGE_INLINE_PADDING_PX;
    const unmeasuredWidth =
      width - reservedSideGuttersPx - Math.max(0, safeAreaLeft) - Math.max(0, safeAreaRight);
    const availableGridWidth = hasMeasuredGridWidth
      ? Math.max(320, Math.floor(Number(measuredAvailableGridWidth)))
      : Math.max(320, unmeasuredWidth);
    const colGap = width <= 1280 ? 12 : 14;
    const columns = computeDesktopGridColumns({
      availableGridWidth,
      colGap,
      targetTrackWidth: DESKTOP_TARGET_TRACK_WIDTH_PX,
      minColumns: DESKTOP_MIN_COLUMNS,
      maxColumns: DESKTOP_MAX_COLUMNS,
    });
    const rawTrackWidth = Math.floor(
      (availableGridWidth - colGap * Math.max(0, columns - 1)) / columns
    );
    const trackMaxWidth = Math.min(
      DESKTOP_MAX_TRACK_WIDTH_PX,
      Math.max(82, rawTrackWidth)
    );
    const widgetColSpan = 2;
    const widgetRowSpan = 1;
    const maxDefaultCells = 6 * widgetColSpan + 24; // 36
    const targetRows = Math.max(4, Math.ceil(maxDefaultCells / columns));
    const reservedChromePx = height <= 740 ? 276 : 284;
    const unmeasuredHeight = height - reservedChromePx - Math.max(0, safeAreaTop) - Math.max(0, safeAreaBottom);
    const availableGridHeight = hasMeasuredGridHeight
      ? Math.max(1, Math.floor(Number(measuredAvailableGridHeight)))
      : height < 480
        ? Math.max(60, unmeasuredHeight)
        : Math.max(260, unmeasuredHeight);
    const rowGap = height <= 740 ? 8 : 10;
    const rawRowHeight = Math.floor(
      (availableGridHeight - rowGap * Math.max(0, targetRows - 1)) / targetRows
    );
    const rowHeight = Math.min(88, Math.max(54, rawRowHeight));
    const iconSize = Math.min(50, Math.max(32, rowHeight - 22));
    const maxRows = Math.max(
      1,
      Math.floor((availableGridHeight + rowGap) / (rowHeight + rowGap))
    );
    const maxVisibleUnits = columns * maxRows;

    return {
      isMobile: false,
      effectiveMode: DISPLAY_MODES.COMPACT,
      columns,
      trackMaxWidth,
      shellGutterPx,
      availableGridWidth,
      widgetColSpan,
      widgetRowSpan,
      widgetUnitCost: widgetColSpan * widgetRowSpan,
      siteUnitCost: 1,
      rowGap,
      colGap,
      rowHeight,
      iconSize,
      widgetMinHeight: rowHeight,
      availableGridHeight,
      maxRows,
      maxUnitsPerView: maxVisibleUnits,
      maxVisibleCompactUnits: maxVisibleUnits,
    };
  }

  if (effectiveMode === DISPLAY_MODES.COMFORT) {
    // Mobile Comfort Mode: 4 columns, relaxed icon & summary widget sizing, capacity-packed into temporary sub-views
    const columns = 4;
    const widgetColSpan = 2;
    const widgetRowSpan = 1;
    const reservedChromePx = height <= 680 ? 266 : 278;
    const unmeasuredHeight = height - reservedChromePx - Math.max(0, safeAreaTop) - Math.max(0, safeAreaBottom);
    const availableGridHeight = hasMeasuredGridHeight
      ? Math.max(1, Math.floor(Number(measuredAvailableGridHeight)))
      : height < 480
        ? Math.max(60, unmeasuredHeight)
        : Math.max(220, unmeasuredHeight);
    const rowGap = 10;
    const colGap = 10;
    const rowHeight = height <= 680 ? 78 : 84;
    const iconSize = height <= 680 ? 50 : 54;
    const maxRows = Math.max(
      1,
      Math.floor((availableGridHeight + rowGap) / (rowHeight + rowGap))
    );
    const maxUnitsPerView = Math.max(columns, maxRows * columns);

    return {
      isMobile: true,
      effectiveMode: DISPLAY_MODES.COMFORT,
      columns,
      widgetColSpan,
      widgetRowSpan,
      widgetUnitCost: widgetColSpan * widgetRowSpan,
      siteUnitCost: 1,
      rowGap,
      colGap,
      rowHeight,
      iconSize,
      widgetMinHeight: rowHeight,
      availableGridHeight,
      maxRows,
      maxUnitsPerView,
      maxVisibleCompactUnits: maxUnitsPerView,
    };
  }

  // Mobile Compact Mode: 6 columns, preserving saved wide (4x2), square (2x2), and compact (2x1) widgets.
  // Target 8 rows so default mixed-size widgets (4 rows) plus 24 sites (4 rows) fit on 375x667/375x812 with rowHeight >= 48px and icons >= 30px; excess still uses overflow fallback.
  const columns = 6;
  const widgetColSpan = 2;
  const widgetRowSpan = 1;
  const targetRows = 8;
  const reservedChromePx = height <= 680 ? 256 : 268;
  const unmeasuredHeight = height - reservedChromePx - Math.max(0, safeAreaTop) - Math.max(0, safeAreaBottom);
  const availableGridHeight = hasMeasuredGridHeight
    ? Math.max(1, Math.floor(Number(measuredAvailableGridHeight)))
    : height < 480
      ? Math.max(60, unmeasuredHeight)
      : Math.max(220, unmeasuredHeight);
  const rowGap = height <= 680 ? 5 : 7;
  const colGap = width <= 360 ? 4 : 6;
  const rawRowHeight = Math.floor(
    (availableGridHeight - rowGap * (targetRows - 1)) / targetRows
  );
  const rowHeight = Math.min(72, Math.max(48, rawRowHeight));
  const iconSize = Math.min(40, Math.max(30, rowHeight - 23));
  const maxRows = Math.max(
    1,
    Math.floor((availableGridHeight + rowGap) / (rowHeight + rowGap))
  );
  const effectiveMaxUnits = columns * maxRows;

  return {
    isMobile: true,
    effectiveMode: DISPLAY_MODES.COMPACT,
    columns,
    widgetColSpan,
    widgetRowSpan,
    widgetUnitCost: widgetColSpan * widgetRowSpan,
    siteUnitCost: 1,
    rowGap,
    colGap,
    rowHeight,
    iconSize,
    widgetMinHeight: rowHeight,
    availableGridHeight,
    maxRows,
    maxUnitsPerView: effectiveMaxUnits,
    maxVisibleCompactUnits: effectiveMaxUnits,
  };
}

function getIntrinsicRequiredColSpan(entry, metrics) {
  if (!entry) return 1;
  if (entry.kind === 'site') {
    return SITE_SIZE_SPANS[resolveSiteDisplaySize(entry)].colSpan;
  }
  if (entry.kind === 'widget') {
    const size = resolveWidgetDisplaySize(entry, metrics);
    return (WIDGET_SIZE_SPANS[size] || WIDGET_SIZE_SPANS.compact).colSpan;
  }
  return 1;
}

function findNextGridSlot(occupied, startRow, startCol, colSpan, rowSpan, safeCols) {
  let r = startRow;
  let c = startCol;
  while (true) {
    if (c + colSpan > safeCols) {
      r += 1;
      c = 0;
    }
    let fits = true;
    for (let dr = 0; dr < rowSpan && fits; dr += 1) {
      for (let dc = 0; dc < colSpan; dc += 1) {
        if (occupied.has((r + dr) * safeCols + (c + dc))) {
          fits = false;
          break;
        }
      }
    }
    if (fits) {
      return { row: r, col: c };
    }
    c += 1;
    if (c >= safeCols) {
      r += 1;
      c = 0;
    }
  }
}

function markGridSlotOccupied(occupied, row, col, colSpan, rowSpan, safeCols) {
  for (let dr = 0; dr < rowSpan; dr += 1) {
    for (let dc = 0; dc < colSpan; dc += 1) {
      occupied.add((row + dr) * safeCols + (col + dc));
    }
  }
}

function resolveMetricsMaxRows(metrics = {}, columns = 6) {
  const computedMaxRows =
    Number(metrics?.maxRows) > 0
      ? Math.floor(Number(metrics.maxRows))
      : metrics?.availableGridHeight && metrics?.rowHeight
        ? Math.floor(
            (Number(metrics.availableGridHeight) + Number(metrics.rowGap || 0)) /
              (Number(metrics.rowHeight) + Number(metrics.rowGap || 0))
          )
        : Math.floor(
            (Number(metrics?.maxUnitsPerView || metrics?.maxVisibleCompactUnits) || 36) / columns
          );
  return Math.max(1, computedMaxRows);
}

function getEntryKey(entry) {
  if (!entry || !entry.kind) return '';
  const id = getEntryId(entry);
  return id ? `${entry.kind}:${id}` : '';
}

function doesGridSlotCollide(occupied, row, col, colSpan, rowSpan, safeCols) {
  for (let dr = 0; dr < rowSpan; dr += 1) {
    for (let dc = 0; dc < colSpan; dc += 1) {
      if (occupied.has((row + dr) * safeCols + (col + dc))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Reserves non-colliding, fully fitting fixed cells in placement order for a page's items.
 * Returns a Map keyed by `kind:id` with values `{ row, column, colSpan, rowSpan }`.
 */
export function getFixedCellsForPage(items = [], metrics = {}) {
  const list = Array.isArray(items) ? items : [];
  const columns = Math.max(1, Number(metrics?.columns) || 6);
  const maxRows = resolveMetricsMaxRows(metrics, columns);
  const effectiveMetrics = { ...metrics, columns, maxRows };
  const fixedCells = new Map();
  const occupied = new Set();

  for (const entry of list) {
    if (!entry || (entry.kind !== 'site' && entry.kind !== 'widget')) continue;
    const cell = normalizePlacementCell(entry.cell, entry.kind);
    if (!cell) continue;
    const key = getEntryKey(entry);
    if (!key || fixedCells.has(key)) continue;

    const { colSpan, rowSpan } = getWidgetGridSpan(entry, effectiveMetrics);
    const requiredCols = getIntrinsicRequiredColSpan(entry, effectiveMetrics);
    const span = Math.min(columns, Math.max(1, colSpan));
    const rSpan = Math.max(1, rowSpan);

    if (rSpan > maxRows || requiredCols > columns) {
      continue;
    }
    if (cell.row < 0 || cell.column < 0) {
      continue;
    }
    if (cell.column + span > columns || cell.row + rSpan > maxRows) {
      continue;
    }
    if (doesGridSlotCollide(occupied, cell.row, cell.column, span, rSpan, columns)) {
      continue;
    }

    markGridSlotOccupied(occupied, cell.row, cell.column, span, rSpan, columns);
    fixedCells.set(key, {
      row: cell.row,
      column: cell.column,
      colSpan: span,
      rowSpan: rSpan,
    });
  }

  return fixedCells;
}

function doGridRectsIntersect(a, b) {
  return (
    a.column < b.column + b.colSpan &&
    a.column + a.colSpan > b.column &&
    a.row < b.row + b.rowSpan &&
    a.row + a.rowSpan > b.row
  );
}

/**
 * Pure drag-to-cell planner for a target page's main grid.
 * Returns `{ targetRect: { row, column, colSpan, rowSpan }, moves: [{ kind, id, cell: { row, column } }] }`
 * when `entry` and every directly intersecting pinned card can fit without colliding or reusing an
 * unchanged placement's saved anchor; otherwise returns `null` with zero mutation.
 */
export function planDesktopCellDrop({
  entry,
  items = [],
  rawPlacements = [],
  metrics = {},
  cell,
} = {}) {
  if (!entry || !isFixedCellCapableKind(entry.kind)) {
    return null;
  }
  const draggedId = getEntryId(entry).trim();
  if (!draggedId) {
    return null;
  }
  const normalizedTargetCell = normalizePlacementCell(cell, entry.kind);
  if (!normalizedTargetCell) {
    return null;
  }

  const rawCols = Math.max(1, Math.floor(Number(metrics?.columns) || 6));
  const columns = Math.min(MAX_CELL_COLUMN + 1, rawCols);
  const rawMaxRows = resolveMetricsMaxRows(metrics, columns);
  const maxRows = Math.min(MAX_CELL_ROW + 1, rawMaxRows);
  const effectiveMetrics = { ...metrics, columns, maxRows };

  const { colSpan, rowSpan } = getWidgetGridSpan(entry, effectiveMetrics);
  const requiredCols = getIntrinsicRequiredColSpan(entry, effectiveMetrics);
  const span = Math.min(columns, Math.max(1, colSpan));
  const rSpan = Math.max(1, rowSpan);

  if (rSpan > maxRows || requiredCols > columns) {
    return null;
  }
  if (
    normalizedTargetCell.column + span > columns ||
    normalizedTargetCell.row + rSpan > maxRows
  ) {
    return null;
  }

  const targetRect = {
    row: normalizedTargetCell.row,
    column: normalizedTargetCell.column,
    colSpan: span,
    rowSpan: rSpan,
  };

  const draggedKey = `${entry.kind}:${draggedId}`;
  const pageItems = Array.isArray(items) ? items : [];
  const otherItems = [];
  const otherSeenKeys = new Set();

  for (const item of pageItems) {
    if (!item) continue;
    const itemKey = getEntryKey(item);
    if (!itemKey || itemKey === draggedKey || otherSeenKeys.has(itemKey)) continue;
    otherSeenKeys.add(itemKey);
    otherItems.push(item);
  }

  const otherFixedCells = getFixedCellsForPage(otherItems, effectiveMetrics);
  const affectedPins = [];
  const affectedKeySet = new Set();
  const occupied = new Set();

  markGridSlotOccupied(
    occupied,
    targetRect.row,
    targetRect.column,
    targetRect.colSpan,
    targetRect.rowSpan,
    columns
  );

  otherItems.forEach((item, listIndex) => {
    const itemKey = getEntryKey(item);
    const rect = itemKey ? otherFixedCells.get(itemKey) : null;
    if (!rect) return;
    if (doGridRectsIntersect(rect, targetRect)) {
      affectedKeySet.add(itemKey);
      affectedPins.push({
        key: itemKey,
        kind: item.kind,
        id: getEntryId(item).trim(),
        originRow: rect.row,
        originCol: rect.column,
        colSpan: rect.colSpan,
        rowSpan: rect.rowSpan,
        area: rect.colSpan * rect.rowSpan,
        listIndex,
      });
    } else {
      markGridSlotOccupied(
        occupied,
        rect.row,
        rect.column,
        rect.colSpan,
        rect.rowSpan,
        columns
      );
    }
  });

  // Preserve raw saved anchors of all unchanged placements (including hidden/unresolved/temporarily auto-placed)
  const forbiddenStarts = new Set([formatCellKey(normalizedTargetCell)]);
  const placementsSource =
    Array.isArray(rawPlacements) && rawPlacements.length > 0 ? rawPlacements : pageItems;

  for (const raw of placementsSource) {
    if (!raw || !isFixedCellCapableKind(raw.kind)) continue;
    const rawId = getEntryId(raw).trim();
    if (!rawId) continue;
    const rawKey = `${raw.kind}:${rawId}`;
    if (rawKey === draggedKey || affectedKeySet.has(rawKey)) continue;
    const savedCell = normalizePlacementCell(raw.cell, raw.kind);
    if (savedCell) {
      forbiddenStarts.add(formatCellKey(savedCell));
    }
  }

  // Also cover any renderable item with a saved cell not present in rawPlacements
  if (Array.isArray(rawPlacements) && rawPlacements.length > 0) {
    for (const item of otherItems) {
      if (!isFixedCellCapableKind(item.kind)) continue;
      const itemKey = getEntryKey(item);
      if (!itemKey || affectedKeySet.has(itemKey)) continue;
      const savedCell = normalizePlacementCell(item.cell, item.kind);
      if (savedCell) {
        forbiddenStarts.add(formatCellKey(savedCell));
      }
    }
  }

  // Target cell itself cannot collide with an unchanged placement's preserved saved anchor
  const targetCellKey = formatCellKey(normalizedTargetCell);
  let targetConflictsSavedAnchor = false;
  for (const raw of placementsSource) {
    if (!raw || !isFixedCellCapableKind(raw.kind)) continue;
    const rawId = getEntryId(raw).trim();
    if (!rawId) continue;
    const rawKey = `${raw.kind}:${rawId}`;
    if (rawKey === draggedKey || affectedKeySet.has(rawKey)) continue;
    const savedCell = normalizePlacementCell(raw.cell, raw.kind);
    if (savedCell && formatCellKey(savedCell) === targetCellKey) {
      targetConflictsSavedAnchor = true;
      break;
    }
  }
  if (!targetConflictsSavedAnchor && Array.isArray(rawPlacements) && rawPlacements.length > 0) {
    for (const item of otherItems) {
      if (!isFixedCellCapableKind(item.kind)) continue;
      const itemKey = getEntryKey(item);
      if (!itemKey || affectedKeySet.has(itemKey)) continue;
      const savedCell = normalizePlacementCell(item.cell, item.kind);
      if (savedCell && formatCellKey(savedCell) === targetCellKey) {
        targetConflictsSavedAnchor = true;
        break;
      }
    }
  }
  if (targetConflictsSavedAnchor) {
    return null;
  }

  if (affectedPins.length === 0) {
    return { targetRect, moves: [] };
  }

  // Relocate larger cards first for packing stability, breaking ties by original page order
  const pinsToRelocate = affectedPins.slice().sort((a, b) => {
    if (b.area !== a.area) return b.area - a.area;
    if (b.colSpan !== a.colSpan) return b.colSpan - a.colSpan;
    if (b.rowSpan !== a.rowSpan) return b.rowSpan - a.rowSpan;
    return a.listIndex - b.listIndex;
  });

  const relocatedByKey = new Map();

  for (const pin of pinsToRelocate) {
    const maxStartRow = Math.min(MAX_CELL_ROW, maxRows - pin.rowSpan);
    const maxStartCol = Math.min(MAX_CELL_COLUMN, columns - pin.colSpan);
    if (maxStartRow < 0 || maxStartCol < 0) {
      return null;
    }

    let bestCell = null;
    let bestDist = Infinity;

    for (let r = 0; r <= maxStartRow; r += 1) {
      for (let c = 0; c <= maxStartCol; c += 1) {
        const candidateKey = `${r},${c}`;
        if (forbiddenStarts.has(candidateKey)) continue;
        if (doesGridSlotCollide(occupied, r, c, pin.colSpan, pin.rowSpan, columns)) continue;

        const dist = Math.abs(r - pin.originRow) + Math.abs(c - pin.originCol);
        if (
          dist < bestDist ||
          (dist === bestDist &&
            bestCell &&
            (r < bestCell.row || (r === bestCell.row && c < bestCell.column)))
        ) {
          bestDist = dist;
          bestCell = { row: r, column: c };
        }
      }
    }

    if (!bestCell) {
      return null;
    }

    markGridSlotOccupied(occupied, bestCell.row, bestCell.column, pin.colSpan, pin.rowSpan, columns);
    forbiddenStarts.add(formatCellKey(bestCell));
    relocatedByKey.set(pin.key, bestCell);
  }

  // Emit moves in deterministic original page order for displaced other cards
  const moves = affectedPins.map((pin) => ({
    kind: pin.kind,
    id: pin.id,
    cell: relocatedByKey.get(pin.key),
  }));

  return {
    targetRect,
    moves,
  };
}

/**
 * Simulates CSS Grid row-flow placement (grid-auto-flow: row, NOT dense)
 * to calculate exact unit consumption including end-of-row wrapping, multi-row span occupancy,
 * and active fixed cells when `metrics.maxRows` (or viewport height) is present.
 */
export function measureGridFlowRows(items = [], metrics = {}) {
  const list = Array.isArray(items) ? items : [];
  const safeCols = Math.max(1, Number(metrics?.columns) || 6);
  const hasBoundedRows =
    Number(metrics?.maxRows) > 0 ||
    (metrics?.availableGridHeight && metrics?.rowHeight) ||
    Number(metrics?.maxUnitsPerView || metrics?.maxVisibleCompactUnits) > 0;
  const fixedCells = hasBoundedRows
    ? getFixedCellsForPage(list, { ...metrics, columns: safeCols })
    : new Map();
  const occupied = new Set();

  for (const rect of fixedCells.values()) {
    markGridSlotOccupied(occupied, rect.row, rect.column, rect.colSpan, rect.rowSpan, safeCols);
  }

  let cursorRow = 0;
  let cursorCol = 0;
  let totalRows = 0;
  const positions = [];

  for (const item of list) {
    const key = getEntryKey(item);
    const fixedRect = key ? fixedCells.get(key) : null;
    if (fixedRect) {
      positions.push({
        item,
        row: fixedRect.row,
        col: fixedRect.column,
        span: fixedRect.colSpan,
        colSpan: fixedRect.colSpan,
        rowSpan: fixedRect.rowSpan,
        fixed: true,
      });
      totalRows = Math.max(totalRows, fixedRect.row + fixedRect.rowSpan);
      continue;
    }

    const { colSpan, rowSpan } = getWidgetGridSpan(item, { ...metrics, columns: safeCols });
    const span = Math.min(safeCols, Math.max(1, colSpan));
    const rSpan = Math.max(1, rowSpan);

    const slot = findNextGridSlot(occupied, cursorRow, cursorCol, span, rSpan, safeCols);
    markGridSlotOccupied(occupied, slot.row, slot.col, span, rSpan, safeCols);

    positions.push({
      item,
      row: slot.row,
      col: slot.col,
      span,
      colSpan: span,
      rowSpan: rSpan,
      fixed: false,
    });

    totalRows = Math.max(totalRows, slot.row + rSpan);
    cursorRow = slot.row;
    cursorCol = slot.col + span;
    if (cursorCol >= safeCols) {
      cursorRow += 1;
      cursorCol = 0;
    }
  }

  return {
    totalRows,
    positions,
    fixedCells,
  };
}

/**
 * Splits a category page's renderable items into temporary view screens for Mobile Comfort Mode,
 * or keeps a single view screen for Compact Mode (with an explicit overflow list only if user data
 * exceeds the single-screen capacity).
 *
 * Strictly pure: never mutates `desktop.pages` or `desktop.placements`.
 */
export function packCategoryItemsIntoViews(
  items = [],
  {
    pageId = 'all',
    pageTitle = '全部',
    metrics = computeSingleScreenMetrics(),
  } = {}
) {
  const list = Array.isArray(items) ? items : [];
  const columns = Math.max(1, Number(metrics?.columns) || 6);
  const maxRows = resolveMetricsMaxRows(metrics, columns);
  const effectiveMetrics = { ...metrics, columns, maxRows };
  const activeFixedCells = getFixedCellsForPage(list, effectiveMetrics);

  if (metrics?.effectiveMode !== DISPLAY_MODES.COMFORT) {
    const visibleItems = [];
    const overflowItems = [];
    const occupied = new Set();

    for (const rect of activeFixedCells.values()) {
      markGridSlotOccupied(occupied, rect.row, rect.column, rect.colSpan, rect.rowSpan, columns);
    }

    let cursorRow = 0;
    let cursorCol = 0;
    let capacityExhausted = false;

    for (const entry of list) {
      const key = getEntryKey(entry);
      if (key && activeFixedCells.has(key)) {
        visibleItems.push(entry);
        continue;
      }

      const { colSpan, rowSpan } = getWidgetGridSpan(entry, effectiveMetrics);
      const requiredCols = getIntrinsicRequiredColSpan(entry, effectiveMetrics);
      const span = Math.min(columns, Math.max(1, colSpan));
      const rSpan = Math.max(1, rowSpan);

      // Intrinsically unfit items (e.g. a 2×2 site, currency card, or square-minimum weather/calendar
      // in a <2-row or <2-col viewport) go to 查看全部 without hiding remaining items that fit.
      if (rSpan > maxRows || requiredCols > columns) {
        overflowItems.push(entry);
        continue;
      }
      // Normal overflow suffix: once a fitting auto item runs out of capacity, later auto items overflow
      if (capacityExhausted) {
        overflowItems.push(entry);
        continue;
      }

      const slot = findNextGridSlot(occupied, cursorRow, cursorCol, span, rSpan, columns);
      if (slot.row + rSpan <= maxRows) {
        visibleItems.push(entry);
        markGridSlotOccupied(occupied, slot.row, slot.col, span, rSpan, columns);
        cursorRow = slot.row;
        cursorCol = slot.col + span;
        if (cursorCol >= columns) {
          cursorRow += 1;
          cursorCol = 0;
        }
      } else {
        capacityExhausted = true;
        overflowItems.push(entry);
      }
    }

    return [
      {
        viewId: `${pageId}__view_0`,
        pageId,
        pageTitle,
        subViewIndex: 0,
        subViewCount: 1,
        items: visibleItems,
        fixedCells: activeFixedCells,
        allCategoryItems: list,
        overflowItems,
        isTemporarySubView: false,
      },
    ];
  }

  // Comfort mode: pack into temporary sub-views by row capacity; only sub-view 0 reserves fixed cells
  const maxRowsPerView = maxRows;

  if (list.length === 0) {
    return [
      {
        viewId: `${pageId}__view_0`,
        pageId,
        pageTitle,
        subViewIndex: 0,
        subViewCount: 1,
        items: [],
        fixedCells: new Map(),
        allCategoryItems: [],
        overflowItems: [],
        isTemporarySubView: false,
      },
    ];
  }

  const firstScreenFixedEntries = [];
  const autoEntries = [];
  for (const entry of list) {
    const key = getEntryKey(entry);
    if (key && activeFixedCells.has(key)) {
      firstScreenFixedEntries.push(entry);
    } else {
      autoEntries.push(entry);
    }
  }

  if (activeFixedCells.size === 0) {
    const chunks = [];
    const neverFitItems = [];
    let currentChunk = [];
    let occupied = new Set();
    let cursorRow = 0;
    let cursorCol = 0;

    for (const entry of list) {
      const { colSpan, rowSpan } = getWidgetGridSpan(entry, effectiveMetrics);
      const requiredCols = getIntrinsicRequiredColSpan(entry, effectiveMetrics);
      const span = Math.min(columns, Math.max(1, colSpan));
      const rSpan = Math.max(1, rowSpan);

      // Fixed-size / square-minimum cards that can never fit a sub-view go to 查看全部
      // instead of creating an oversized, clipped sub-view.
      if (rSpan > maxRowsPerView || requiredCols > columns) {
        neverFitItems.push(entry);
        continue;
      }

      const slot = findNextGridSlot(occupied, cursorRow, cursorCol, span, rSpan, columns);

      if (slot.row + rSpan > maxRowsPerView && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [entry];
        occupied = new Set();
        markGridSlotOccupied(occupied, 0, 0, span, rSpan, columns);
        cursorRow = 0;
        cursorCol = span;
        if (cursorCol >= columns) {
          cursorRow = 1;
          cursorCol = 0;
        }
      } else {
        currentChunk.push(entry);
        markGridSlotOccupied(occupied, slot.row, slot.col, span, rSpan, columns);
        cursorRow = slot.row;
        cursorCol = slot.col + span;
        if (cursorCol >= columns) {
          cursorRow += 1;
          cursorCol = 0;
        }
      }
    }

    if (currentChunk.length > 0 || chunks.length === 0) {
      chunks.push(currentChunk);
    }

    const subViewCount = chunks.length;
    return chunks.map((chunkItems, idx) => ({
      viewId: `${pageId}__view_${idx}`,
      pageId,
      pageTitle,
      subViewIndex: idx,
      subViewCount,
      items: chunkItems,
      fixedCells: new Map(),
      allCategoryItems: list,
      overflowItems: neverFitItems.slice(),
      isTemporarySubView: subViewCount > 1,
    }));
  }

  // Sub-view 0 has active fixed entries reserved; pack auto entries around them first, then subsequent sub-views normally
  const neverFitItems = [];
  const firstScreenAcceptedKeys = new Set(firstScreenFixedEntries.map((entry) => getEntryKey(entry)));
  const firstScreenOccupied = new Set();
  for (const rect of activeFixedCells.values()) {
    markGridSlotOccupied(
      firstScreenOccupied,
      rect.row,
      rect.column,
      rect.colSpan,
      rect.rowSpan,
      columns
    );
  }

  const remainingForLaterViews = [];
  let firstCursorRow = 0;
  let firstCursorCol = 0;
  let spilledFromFirstScreen = false;

  for (const entry of autoEntries) {
    const { colSpan, rowSpan } = getWidgetGridSpan(entry, effectiveMetrics);
    const requiredCols = getIntrinsicRequiredColSpan(entry, effectiveMetrics);
    const span = Math.min(columns, Math.max(1, colSpan));
    const rSpan = Math.max(1, rowSpan);

    if (rSpan > maxRowsPerView || requiredCols > columns) {
      neverFitItems.push(entry);
      continue;
    }

    if (spilledFromFirstScreen) {
      remainingForLaterViews.push(entry);
      continue;
    }

    const slot = findNextGridSlot(
      firstScreenOccupied,
      firstCursorRow,
      firstCursorCol,
      span,
      rSpan,
      columns
    );
    if (slot.row + rSpan <= maxRowsPerView) {
      firstScreenAcceptedKeys.add(getEntryKey(entry));
      markGridSlotOccupied(firstScreenOccupied, slot.row, slot.col, span, rSpan, columns);
      firstCursorRow = slot.row;
      firstCursorCol = slot.col + span;
      if (firstCursorCol >= columns) {
        firstCursorRow += 1;
        firstCursorCol = 0;
      }
    } else {
      spilledFromFirstScreen = true;
      remainingForLaterViews.push(entry);
    }
  }

  // Keep original placement order within sub-view 0 for all items belonging to sub-view 0
  const firstChunk = list.filter((entry) => firstScreenAcceptedKeys.has(getEntryKey(entry)));
  const chunks = [firstChunk];

  if (remainingForLaterViews.length > 0) {
    let currentChunk = [];
    let occupied = new Set();
    let cursorRow = 0;
    let cursorCol = 0;

    for (const entry of remainingForLaterViews) {
      const { colSpan, rowSpan } = getWidgetGridSpan(entry, effectiveMetrics);
      const span = Math.min(columns, Math.max(1, colSpan));
      const rSpan = Math.max(1, rowSpan);
      const slot = findNextGridSlot(occupied, cursorRow, cursorCol, span, rSpan, columns);

      if (slot.row + rSpan > maxRowsPerView && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [entry];
        occupied = new Set();
        markGridSlotOccupied(occupied, 0, 0, span, rSpan, columns);
        cursorRow = 0;
        cursorCol = span;
        if (cursorCol >= columns) {
          cursorRow = 1;
          cursorCol = 0;
        }
      } else {
        currentChunk.push(entry);
        markGridSlotOccupied(occupied, slot.row, slot.col, span, rSpan, columns);
        cursorRow = slot.row;
        cursorCol = slot.col + span;
        if (cursorCol >= columns) {
          cursorRow += 1;
          cursorCol = 0;
        }
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
  }

  const subViewCount = chunks.length;
  return chunks.map((chunkItems, idx) => ({
    viewId: `${pageId}__view_${idx}`,
    pageId,
    pageTitle,
    subViewIndex: idx,
    subViewCount,
    items: chunkItems,
    fixedCells: idx === 0 ? activeFixedCells : new Map(),
    allCategoryItems: list,
    overflowItems: neverFitItems.slice(),
    isTemporarySubView: subViewCount > 1,
  }));
}

/**
 * Builds the flat list of temporary screen views across all navigation categories,
 * plus lookup helpers for mapping between category index/pageId and active viewIndex.
 */
export function buildScreenViewsModel({
  pages = [],
  getRenderableItemsForPage,
  metrics = computeSingleScreenMetrics(),
} = {}) {
  const safePages = Array.isArray(pages) ? pages : [];
  const views = [];
  const firstViewIndexByPageId = new Map();

  safePages.forEach((page, categoryIndex) => {
    const items =
      typeof getRenderableItemsForPage === 'function'
        ? getRenderableItemsForPage(page.id)
        : [];
    const pageViews = packCategoryItemsIntoViews(items, {
      pageId: page.id,
      pageTitle: page.title,
      metrics,
    });
    firstViewIndexByPageId.set(page.id, views.length);
    pageViews.forEach((v) => {
      views.push({
        ...v,
        categoryIndex,
        viewIndex: views.length,
      });
    });
  });

  return {
    views,
    firstViewIndexByPageId,
  };
}

/**
 * Resolves the authoritative before-anchor `(beforeKind, beforeId)` in the category's full placement list
 * when dropping at the end of (or inside) a temporary sub-view in Comfort Mode, or in Compact Mode
 * when overflow items exist.
 *
 * Ensures temporary `viewId` is NEVER persisted and dropping at the tail of sub-view `k` inserts
 * immediately before the first item of sub-view `k + 1` (or at the category tail if on the last sub-view).
 */
export function resolveViewDropBeforeAnchor({
  views = [],
  targetViewId = null,
  targetPageId = 'all',
  explicitBeforeKind = null,
  explicitBeforeId = null,
  draggedKind = null,
  draggedId = null,
} = {}) {
  const view =
    (targetViewId && views.find((v) => v.viewId === targetViewId)) ||
    views.find((v) => v.pageId === targetPageId) ||
    null;

  const resolvedPageId = view ? view.pageId : targetPageId;

  if (explicitBeforeKind && explicitBeforeId) {
    return {
      toPageId: resolvedPageId,
      beforeKind: explicitBeforeKind,
      beforeId: explicitBeforeId,
    };
  }

  if (!view) {
    return {
      toPageId: resolvedPageId,
      beforeKind: null,
      beforeId: null,
    };
  }

  // If hidden overflow items exist and user drops at the visible tail, insert before the first overflow
  // item that truly trails the last visible item (never-fit items may sit ahead of visible ones).
  if (Array.isArray(view.overflowItems) && view.overflowItems.length > 0) {
    const ordered = Array.isArray(view.allCategoryItems) ? view.allCategoryItems : [];
    const indexOfEntry = (entry) => {
      const direct = ordered.indexOf(entry);
      if (direct !== -1) return direct;
      const entryId = getEntryId(entry);
      return ordered.findIndex((e) => e && e.kind === entry.kind && getEntryId(e) === entryId);
    };
    const visibleList = Array.isArray(view.items) ? view.items : [];
    let lastVisibleIdx = -1;
    for (const entry of visibleList) {
      if (entry.kind === draggedKind && getEntryId(entry) === draggedId) continue;
      lastVisibleIdx = Math.max(lastVisibleIdx, indexOfEntry(entry));
    }
    const firstOverflow = view.overflowItems.find(
      (entry) =>
        !(entry.kind === draggedKind && getEntryId(entry) === draggedId) &&
        (ordered.length === 0 || indexOfEntry(entry) > lastVisibleIdx)
    );
    if (firstOverflow) {
      return {
        toPageId: resolvedPageId,
        beforeKind: firstOverflow.kind,
        beforeId: getEntryId(firstOverflow),
      };
    }
  }

  // If comfort mode has a subsequent sub-view for the same category, tail of sub-view k is before first item of sub-view k+1
  if (view.subViewCount > 1 && view.subViewIndex < view.subViewCount - 1) {
    const nextSubView = views.find(
      (v) => v.pageId === resolvedPageId && v.subViewIndex === view.subViewIndex + 1
    );
    if (nextSubView && Array.isArray(nextSubView.items)) {
      const firstNext = nextSubView.items.find(
        (entry) => !(entry.kind === draggedKind && getEntryId(entry) === draggedId)
      );
      if (firstNext) {
        return {
          toPageId: resolvedPageId,
          beforeKind: firstNext.kind,
          beforeId: getEntryId(firstNext),
        };
      }
    }
  }

  return {
    toPageId: resolvedPageId,
    beforeKind: null,
    beforeId: null,
  };
}

function getEntryId(entry) {
  if (!entry) return '';
  if (typeof entry.id === 'string') return entry.id;
  if (entry.kind === 'site' && entry.site?.id) return entry.site.id;
  if (entry.kind === 'folder' && entry.folder?.id) return entry.folder.id;
  if (entry.kind === 'widget' && entry.widget?.id) return entry.widget.id;
  return '';
}
