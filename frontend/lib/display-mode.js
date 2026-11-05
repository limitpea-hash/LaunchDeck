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

/**
 * Computes responsive single-screen metrics for:
 * - Desktop Compact (e.g. 1280x720, 1366x768, 1440x900)
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
  measuredAvailableGridHeight = null,
} = {}) {
  const width = Math.max(320, Math.round(Number(viewportWidth) || 1280));
  const height = Math.max(480, Math.round(Number(viewportHeight) || 800));
  const isMobile = isMobileViewport(width);
  const effectiveMode = resolveEffectiveDisplayMode({ viewportWidth: width, mobileDisplayMode });
  const hasMeasuredGridHeight =
    Number.isFinite(Number(measuredAvailableGridHeight)) && Number(measuredAvailableGridHeight) >= 180;

  if (!isMobile) {
    // Desktop Compact: 8 columns, each summary widget spans 2x1 (equal to 2 site cells).
    // 6 widgets = 12 cells + 24 sites = 36 cells -> 5 rows (ceil(36 / 8) = 5).
    const columns = width >= 1180 ? 8 : 6;
    const widgetColSpan = 2;
    const widgetRowSpan = 1;
    const maxDefaultCells = 6 * widgetColSpan + 24; // 36
    const targetRows = Math.ceil(maxDefaultCells / columns); // 5 on 8-col, 6 on 6-col
    const reservedChromePx = height <= 740 ? 276 : 284;
    const availableGridHeight = hasMeasuredGridHeight
      ? Math.floor(Number(measuredAvailableGridHeight))
      : Math.max(
          260,
          height - reservedChromePx - Math.max(0, safeAreaTop) - Math.max(0, safeAreaBottom)
        );
    const rowGap = height <= 740 ? 8 : 10;
    const colGap = width <= 1280 ? 12 : 14;
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
    const availableGridHeight = hasMeasuredGridHeight
      ? Math.floor(Number(measuredAvailableGridHeight))
      : Math.max(
          220,
          height - reservedChromePx - Math.max(0, safeAreaTop) - Math.max(0, safeAreaBottom)
        );
    const rowGap = 10;
    const colGap = 10;
    const rowHeight = height <= 680 ? 78 : 84;
    const iconSize = height <= 680 ? 50 : 54;
    const maxRows = Math.max(
      2,
      Math.floor((availableGridHeight + rowGap) / (rowHeight + rowGap))
    );
    const maxUnitsPerView = Math.max(8, maxRows * columns);

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

  // Mobile Compact Mode: 6 columns, summary widget spans 2x1 (3 widgets per row = 2 rows for 6 widgets + 4 rows for 24 sites = 6 rows total).
  // Fits 6 widgets + 24 sites on 375x667 and 375x812 in a single screen with zero vertical scroll and icons >= 32px.
  const columns = 6;
  const widgetColSpan = 2;
  const widgetRowSpan = 1;
  const targetRows = 6; // 6 * 6 = 36 units (6 widgets * 2 + 24 sites)
  const reservedChromePx = height <= 680 ? 256 : 268;
  const availableGridHeight = hasMeasuredGridHeight
    ? Math.floor(Number(measuredAvailableGridHeight))
    : Math.max(
        220,
        height - reservedChromePx - Math.max(0, safeAreaTop) - Math.max(0, safeAreaBottom)
      );
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

/**
 * Simulates CSS Grid row-flow placement (grid-auto-flow: row, NOT dense)
 * to calculate exact unit consumption including end-of-row wrapping when a 2-column
 * widget cannot fit in the remaining columns of the current row.
 */
export function measureGridFlowRows(items = [], { columns = 6, widgetColSpan = 2 } = {}) {
  const safeCols = Math.max(1, Number(columns) || 6);
  const safeWidgetSpan = Math.min(safeCols, Math.max(1, Number(widgetColSpan) || 2));
  let currentRow = 0;
  let currentCol = 0;
  const positions = [];

  for (const item of items) {
    const span = item?.kind === 'widget' ? safeWidgetSpan : 1;
    if (currentCol + span > safeCols) {
      currentRow += 1;
      currentCol = 0;
    }
    positions.push({
      item,
      row: currentRow,
      col: currentCol,
      span,
    });
    currentCol += span;
    if (currentCol >= safeCols) {
      currentRow += 1;
      currentCol = 0;
    }
  }

  const totalRows = positions.length === 0 ? 0 : currentCol > 0 ? currentRow + 1 : currentRow;
  return {
    totalRows,
    positions,
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
  const columns = Math.max(1, metrics?.columns || 6);
  const widgetSpan = Math.min(columns, Math.max(1, metrics?.widgetColSpan || 2));

  if (metrics?.effectiveMode !== DISPLAY_MODES.COMFORT) {
    const computedMaxRows =
      Number(metrics?.maxRows) > 0
        ? Math.floor(Number(metrics.maxRows))
        : metrics?.availableGridHeight && metrics?.rowHeight
          ? Math.floor(
              (Number(metrics.availableGridHeight) + Number(metrics.rowGap || 0)) /
                (Number(metrics.rowHeight) + Number(metrics.rowGap || 0))
            )
          : Math.floor((Number(metrics?.maxVisibleCompactUnits) || 36) / columns);
    const maxRows = Math.max(1, computedMaxRows);
    const visibleItems = [];
    const overflowItems = [];
    let row = 0;
    let col = 0;

    for (const entry of list) {
      const span = entry?.kind === 'widget' ? widgetSpan : 1;
      let nextRow = row;
      let nextCol = col;
      if (nextCol + span > columns) {
        nextRow += 1;
        nextCol = 0;
      }
      if (nextRow < maxRows && overflowItems.length === 0) {
        visibleItems.push(entry);
        nextCol += span;
        if (nextCol >= columns) {
          nextRow += 1;
          nextCol = 0;
        }
        row = nextRow;
        col = nextCol;
      } else {
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
        allCategoryItems: list,
        overflowItems,
        isTemporarySubView: false,
      },
    ];
  }

  // Comfort mode: pack into temporary sub-views by row capacity
  const maxUnitsPerView = Math.max(columns * 2, Number(metrics?.maxUnitsPerView) || 16);
  const maxRowsPerView = Math.max(2, Math.floor(maxUnitsPerView / columns));

  if (list.length === 0) {
    return [
      {
        viewId: `${pageId}__view_0`,
        pageId,
        pageTitle,
        subViewIndex: 0,
        subViewCount: 1,
        items: [],
        allCategoryItems: [],
        overflowItems: [],
        isTemporarySubView: false,
      },
    ];
  }

  const chunks = [];
  let currentChunk = [];
  let row = 0;
  let col = 0;

  for (const entry of list) {
    const span = entry?.kind === 'widget' ? widgetSpan : 1;
    let nextRow = row;
    let nextCol = col;
    if (nextCol + span > columns) {
      nextRow += 1;
      nextCol = 0;
    }

    if (nextRow >= maxRowsPerView && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [entry];
      row = 0;
      col = span;
      if (col >= columns) {
        row = 1;
        col = 0;
      }
    } else {
      currentChunk.push(entry);
      nextCol += span;
      if (nextCol >= columns) {
        nextRow += 1;
        nextCol = 0;
      }
      row = nextRow;
      col = nextCol;
    }
  }

  if (currentChunk.length > 0) {
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
    allCategoryItems: list,
    overflowItems: [],
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

  // If compact mode has hidden overflow items and user drops at visible tail, insert before first overflow item
  if (Array.isArray(view.overflowItems) && view.overflowItems.length > 0) {
    const firstOverflow = view.overflowItems.find(
      (entry) => !(entry.kind === draggedKind && getEntryId(entry) === draggedId)
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
