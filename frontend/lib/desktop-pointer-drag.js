import { el } from './dom.js';

const DRAG_THRESHOLD_PX = 7;
const TAB_HOVER_SWITCH_MS = 380;
const EDGE_VIEW_SWITCH_MS = 460;
const EDGE_VIEW_ZONE_PX = 38;
const EDGE_SCROLL_ZONE_PX = 54;
const EDGE_SCROLL_MAX_SPEED_PX = 12;
const SWAP_COOLDOWN_MS = 65;
const HYSTERESIS_RATIO = 0.14;
const FLIP_DURATION_MS = 210;
export const FOLDER_MERGE_HOVER_MS = 600;
const FOLDER_CENTER_RATIO = 0.25; // Middle 50% of card width & height (25%..75%)

function parsePixelList(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const matches = raw.match(/-?\d+(?:\.\d+)?px/gi);
  if (!matches) return [];
  return matches.map((token) => parseFloat(token)).filter((n) => Number.isFinite(n) && n > 0);
}

function parseFirstPositiveFloat(raw, fallback = 0) {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getElementStyleSnapshot(node) {
  if (!node) return null;
  return {
    hadStyleAttr: node.hasAttribute?.('style') ?? Boolean(node.getAttribute?.('style')),
    styleAttr: node.getAttribute?.('style') ?? null,
    gridColumn: node.style?.gridColumn || '',
    gridRow: node.style?.gridRow || '',
    gridColumnStart: node.style?.gridColumnStart || '',
    gridColumnEnd: node.style?.gridColumnEnd || '',
    gridRowStart: node.style?.gridRowStart || '',
    gridRowEnd: node.style?.gridRowEnd || '',
  };
}

function applyElementStyleSnapshot(node, snap) {
  if (!node || !snap) return;
  if (typeof node.setAttribute === 'function' && typeof node.removeAttribute === 'function') {
    if (!snap.hadStyleAttr || snap.styleAttr === null || snap.styleAttr === '') {
      node.removeAttribute('style');
    } else {
      node.setAttribute('style', snap.styleAttr);
    }
    return;
  }
  if (node.style) {
    node.style.gridColumn = snap.gridColumn;
    node.style.gridRow = snap.gridRow;
    node.style.gridColumnStart = snap.gridColumnStart;
    node.style.gridColumnEnd = snap.gridColumnEnd;
    node.style.gridRowStart = snap.gridRowStart;
    node.style.gridRowEnd = snap.gridRowEnd;
  }
}

function readCardDefaultSpan(cardEl, kind, fallbackMetrics = null) {
  const dsCol = Number(cardEl?.dataset?.colSpan);
  const dsRow = Number(cardEl?.dataset?.rowSpan);
  if (Number.isInteger(dsCol) && dsCol > 0 && Number.isInteger(dsRow) && dsRow > 0) {
    return { colSpan: dsCol, rowSpan: dsRow };
  }
  if (kind === 'site' || cardEl?.classList?.contains?.('app-item')) {
    const isSq = String(cardEl?.dataset?.siteSize || '') === 'square';
    return isSq ? { colSpan: 2, rowSpan: 2 } : { colSpan: 1, rowSpan: 1 };
  }
  const size = String(
    cardEl?.dataset?.widgetSize || cardEl?.getAttribute?.('data-widget-size') || 'compact'
  ).trim();
  const table = {
    single: { colSpan: 1, rowSpan: 1 },
    compact: { colSpan: Math.max(1, Number(fallbackMetrics?.widgetColSpan) || 2), rowSpan: 1 },
    square: { colSpan: 2, rowSpan: 2 },
    landscape: { colSpan: 3, rowSpan: 2 },
    tall: { colSpan: 2, rowSpan: 3 },
    large: { colSpan: 3, rowSpan: 3 },
    full: { colSpan: 4, rowSpan: 4 },
    strip: { colSpan: 4, rowSpan: 1 },
  };
  return table[size] || table.compact;
}

/**
 * Derives column/row track coordinates from computed grid styles (including column/row gap,
 * padding, and `justify-content: center` track offset) with metric fallbacks for synthetic DOMs.
 */
export function measureDesktopGridGeometry(gridEl, metrics = null) {
  if (!gridEl || typeof gridEl.getBoundingClientRect !== 'function') return null;
  const rect = gridEl.getBoundingClientRect();
  const computed =
    typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(gridEl)
      : null;

  const padLeft = parseFirstPositiveFloat(computed?.paddingLeft, 0);
  const padRight = parseFirstPositiveFloat(computed?.paddingRight, 0);
  const padTop = parseFirstPositiveFloat(computed?.paddingTop, 0);
  const padBottom = parseFirstPositiveFloat(computed?.paddingBottom, 0);

  const rawColGap = parseFloat(computed?.columnGap || computed?.gap);
  const colGap =
    Number.isFinite(rawColGap) && rawColGap >= 0
      ? rawColGap
      : Math.max(0, Number(metrics?.colGap) || 12);

  const rawRowGap = parseFloat(computed?.rowGap || computed?.gap);
  const rowGap =
    Number.isFinite(rawRowGap) && rawRowGap >= 0
      ? rawRowGap
      : Math.max(0, Number(metrics?.rowGap) || 10);

  const parsedCols = parsePixelList(computed?.gridTemplateColumns);
  let columns = parsedCols.length > 0 ? parsedCols.length : Math.max(1, Math.floor(Number(metrics?.columns) || 6));
  columns = Math.max(1, Math.min(48, columns));

  const contentWidth = Math.max(0, rect.width - padLeft - padRight);
  let colWidths = parsedCols.length === columns ? parsedCols.slice() : null;
  if (!colWidths) {
    const maxTrack = Number(metrics?.trackMaxWidth);
    const fitTrack =
      contentWidth > 0
        ? Math.max(16, (contentWidth - colGap * Math.max(0, columns - 1)) / columns)
        : Number.isFinite(maxTrack) && maxTrack > 0
          ? maxTrack
          : 90;
    const trackW =
      Number.isFinite(maxTrack) && maxTrack > 0 ? Math.min(maxTrack, fitTrack) : fitTrack;
    colWidths = Array.from({ length: columns }, () => trackW);
  }

  const parsedAutoRows = parsePixelList(computed?.gridAutoRows);
  const parsedTemplateRows = parsePixelList(computed?.gridTemplateRows);
  let rowHeight =
    parsedAutoRows[0] ||
    parsedTemplateRows[0] ||
    Math.max(24, Number(metrics?.rowHeight) || 84);
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    rowHeight = 84;
  }

  const rawMaxRows = Number(metrics?.maxRows);
  const contentHeight = Math.max(0, rect.height - padTop - padBottom);
  const derivedMaxRows =
    Number.isFinite(rawMaxRows) && rawMaxRows > 0
      ? Math.floor(rawMaxRows)
      : contentHeight > 0
        ? Math.max(1, Math.floor((contentHeight + rowGap) / (rowHeight + rowGap)))
        : 6;
  const maxRows = Math.max(1, Math.min(50, derivedMaxRows));

  const totalColsWidth =
    colWidths.reduce((acc, w) => acc + w, 0) + colGap * Math.max(0, columns - 1);
  const justifyContent = String(computed?.justifyContent || 'center').toLowerCase();
  let tracksOffsetX = 0;
  if (contentWidth > totalColsWidth) {
    if (justifyContent.includes('center')) {
      tracksOffsetX = (contentWidth - totalColsWidth) / 2;
    } else if (justifyContent.includes('end') || justifyContent.includes('right')) {
      tracksOffsetX = contentWidth - totalColsWidth;
    }
  }

  const originLeft = rect.left + padLeft + tracksOffsetX;
  const originTop = rect.top + padTop;

  const colStarts = [];
  let accX = 0;
  for (let c = 0; c < columns; c += 1) {
    colStarts.push(originLeft + accX);
    accX += colWidths[c] + colGap;
  }

  const avgColWidth =
    colWidths.length > 0 ? colWidths.reduce((a, b) => a + b, 0) / colWidths.length : 90;

  return {
    rect,
    originLeft,
    originTop,
    columns,
    maxRows,
    colGap,
    rowGap,
    rowHeight,
    avgColWidth,
    colWidths,
    colStarts,
    totalColsWidth,
  };
}

/**
 * Resolves the top-left anchor cell `{ row, column, inBoundsCell }` from pointer coordinates,
 * preserving the card's grab offset for multi-cell cards.
 */
export function resolveGridAnchorCellFromPointer({
  geometry,
  clientX,
  clientY,
  grabOffsetX = 0,
  grabOffsetY = 0,
  colSpan = 1,
  rowSpan = 1,
} = {}) {
  if (!geometry) return null;
  const {
    originLeft,
    originTop,
    columns,
    maxRows,
    colGap,
    rowGap,
    rowHeight,
    avgColWidth,
    colWidths,
    colStarts,
  } = geometry;

  const effColSpan = Math.max(1, Math.floor(Number(colSpan) || 1));
  const effRowSpan = Math.max(1, Math.floor(Number(rowSpan) || 1));

  // Top-left corner of the floating card + half a single track so horizontal snapping switches cleanly at cell midpoints
  const cardLeft = clientX - grabOffsetX;
  const firstTrackW = colWidths[0] || avgColWidth || 84;
  const sampleX = cardLeft + firstTrackW * 0.5;

  let rawColumn = 0;
  const colPitch = Math.max(1, avgColWidth + colGap);
  if (sampleX < originLeft) {
    rawColumn = Math.floor((sampleX - originLeft) / colPitch);
  } else {
    let matched = false;
    for (let c = 0; c < columns; c += 1) {
      const start = colStarts[c];
      const end = c < columns - 1 ? colStarts[c + 1] : start + colWidths[c] + colGap;
      if (sampleX < end) {
        rawColumn = c;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const lastStart = colStarts[columns - 1] ?? originLeft;
      rawColumn = columns - 1 + Math.floor((sampleX - lastStart) / colPitch);
    }
  }

  // Resolve vertical row from the actual pointer track (including half-gap for a continuous boundary)
  // minus the relative track of the card that was initially grabbed (0..rowSpan-1).
  const rowPitch = Math.max(1, rowHeight + rowGap);
  const halfRowGap = rowGap * 0.5;
  const pointerRow = Math.floor((clientY - originTop + halfRowGap) / rowPitch);
  const grabbedRowOffset =
    effRowSpan > 1
      ? Math.min(effRowSpan - 1, Math.max(0, Math.floor((grabOffsetY + halfRowGap) / rowPitch)))
      : 0;
  const rawRow = pointerRow - grabbedRowOffset;

  const clampedPreviewCol = Math.min(Math.max(0, rawColumn), Math.max(0, columns - 1));
  const clampedPreviewRow = Math.min(Math.max(0, rawRow), Math.max(0, maxRows - 1));

  // If the card's top-left is within the grid's right/bottom edge but its span would spill by 1..N-1 tracks,
  // check whether the user is hovering inside the grid vs dragging past the far edge:
  // keep raw start cell when pointer/card actually pushes into the trailing tracks so out-of-bounds invalid preview
  // is shown clearly when dragging a multi-cell card onto a trailing column/row that cannot fit its span!
  const desiredRow = rawRow < 0 ? 0 : rawRow >= maxRows ? maxRows - 1 : rawRow;
  const desiredColumn = rawColumn < 0 ? 0 : rawColumn >= columns ? columns - 1 : rawColumn;

  const fitsGrid =
    rawRow >= 0 &&
    rawRow < maxRows &&
    rawColumn >= 0 &&
    rawColumn < columns &&
    rawRow + effRowSpan <= maxRows &&
    rawColumn + effColSpan <= columns;

  return {
    row: desiredRow,
    column: desiredColumn,
    rawRow,
    rawColumn,
    previewRow: clampedPreviewRow,
    previewColumn: clampedPreviewCol,
    colSpan: effColSpan,
    rowSpan: effRowSpan,
    fitsGrid,
  };
}

export function createDesktopPointerDragController({
  trackEl,
  isJiggleMode,
  getCurrentPageId,
  getCurrentViewId,
  getPagePlacementsForPage,
  canUseCellDropForGrid,
  getCellDropSpan,
  planCellDrop,
  onCommitCellDrop,
  onDragStart,
  onDragEnd,
  onSwitchPageById,
  onSwitchAdjacentView,
  onCommitPlacement,
  onCommitFolderMerge,
  onCommitFolderReorder,
  onCommitFolderExtractToDesktop,
  onRequestExitFolderModalForDrag,
  onDropOnCard,
  onDropToPage,
}) {
  let tracked = null;
  let placeholderEl = null;
  let tabHoverTimer = null;
  let tabHoverTargetPageId = null;
  let edgeViewTimer = null;
  let edgeViewDirection = 0;
  let folderMergeTimer = null;
  let folderMergeCandidateKey = null;
  let folderMergeReadyTarget = null;
  let autoScrollRaf = null;
  let suppressClickUntil = 0;
  const activeFlipAnimations = new Map();

  function clearTabHoverTimer() {
    if (tabHoverTimer) {
      clearTimeout(tabHoverTimer);
      tabHoverTimer = null;
    }
    tabHoverTargetPageId = null;
  }

  function clearEdgeViewTimer() {
    if (edgeViewTimer) {
      clearTimeout(edgeViewTimer);
      edgeViewTimer = null;
    }
    edgeViewDirection = 0;
  }

  function clearFolderMergePreview() {
    if (folderMergeTimer) {
      clearTimeout(folderMergeTimer);
      folderMergeTimer = null;
    }
    folderMergeCandidateKey = null;
    folderMergeReadyTarget = null;
    if (typeof document !== 'undefined') {
      document
        .querySelectorAll('.folder-merge-candidate, .folder-merge-ready')
        .forEach((node) => {
          node.classList.remove('folder-merge-candidate', 'folder-merge-ready');
          delete node.dataset.folderMergePreviewLabel;
        });
    }
  }

  function stopAutoScroll() {
    if (autoScrollRaf !== null) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }
  }

  function clearAllFlipAnimations() {
    for (const [node, anim] of activeFlipAnimations.entries()) {
      try {
        anim.cancel();
      } catch {
        // Ignore cancel errors
      }
      if (node && node.style) {
        node.style.transform = '';
      }
    }
    activeFlipAnimations.clear();
  }

  function clearTargetHighlights() {
    clearFolderMergePreview();
    if (typeof document !== 'undefined') {
      document
        .querySelectorAll('.drag-over-card, .drag-target-active, .pointer-dragging, .is-cell-drop-invalid')
        .forEach((node) => {
          node.classList.remove(
            'drag-over-card',
            'drag-target-active',
            'pointer-dragging',
            'is-cell-drop-invalid'
          );
        });
    }
  }

  function syncEmptyDropzoneVisibility(gridEl) {
    if (!gridEl) return;
    const dropzone = gridEl.querySelector('.empty-page-dropzone');
    if (!dropzone) return;
    const hasCardsOrPlaceholder = Boolean(
      gridEl.querySelector('[data-placement-kind][data-placement-id], .desktop-drag-placeholder')
    );
    dropzone.hidden = hasCardsOrPlaceholder;
  }

  function restorePlaceholderBaseGeometry() {
    if (!placeholderEl || !tracked?.placeholderBaseSnapshot) return;
    placeholderEl.classList.remove('is-cell-drop-preview', 'is-cell-drop-invalid');
    delete placeholderEl.dataset.previewRow;
    delete placeholderEl.dataset.previewColumn;
    delete placeholderEl.dataset.previewValid;
    applyElementStyleSnapshot(placeholderEl, tracked.placeholderBaseSnapshot);
  }

  function restoreCellPreviewGridMutations(targetGrid = null, { animateFlip = false } = {}) {
    if (!tracked?.cellPreviewSnapshots || tracked.cellPreviewSnapshots.size === 0) {
      if (tracked) {
        tracked.cellPreviewState = null;
      }
      restorePlaceholderBaseGeometry();
      return;
    }

    const entries = Array.from(tracked.cellPreviewSnapshots.entries());
    const toRestore = targetGrid
      ? entries.filter(([, rec]) => rec.gridEl === targetGrid)
      : entries;

    if (toRestore.length === 0) {
      if (!targetGrid && tracked) {
        tracked.cellPreviewState = null;
        restorePlaceholderBaseGeometry();
      }
      return;
    }

    const grids = new Set();
    for (const [, rec] of toRestore) {
      if (rec.gridEl) grids.add(rec.gridEl);
    }

    const beforeRectsByGrid = new Map();
    if (animateFlip) {
      for (const g of grids) {
        beforeRectsByGrid.set(g, captureAllGridCardRects(g));
      }
    }

    for (const [cardNode, rec] of toRestore) {
      applyElementStyleSnapshot(cardNode, rec.snapshot);
      if (cardNode?.dataset) {
        delete cardNode.dataset.cellPreviewDisplaced;
      }
      tracked.cellPreviewSnapshots.delete(cardNode);
    }

    for (const g of grids) {
      g.classList.remove('is-cell-drop-invalid');
      if (animateFlip) {
        playFlipForGrid(g, beforeRectsByGrid.get(g), { includePinned: true });
      }
    }

    if (!targetGrid || tracked.cellPreviewState?.gridEl === targetGrid) {
      tracked.cellPreviewState = null;
      restorePlaceholderBaseGeometry();
    }
  }

  function removePlaceholder() {
    if (placeholderEl) {
      const parentGrid = placeholderEl.parentElement;
      placeholderEl.remove();
      placeholderEl = null;
      if (parentGrid) {
        syncEmptyDropzoneVisibility(parentGrid);
      }
    }
  }

  function restoreFloatingCardToOrigin() {
    if (!tracked || !tracked.cardEl) return;
    const {
      cardEl,
      originalParent,
      originalNextSibling,
      originalStyleSnapshot,
      fromPageId,
      fromViewId,
      previewGridEl,
    } = tracked;

    cardEl.classList.remove('dragging', 'pointer-dragging', 'desktop-floating-card');
    applyElementStyleSnapshot(cardEl, originalStyleSnapshot);
    cardEl.dataset.pageId = fromPageId;
    if (fromViewId) {
      cardEl.dataset.viewId = fromViewId;
    }

    if (originalParent) {
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(cardEl, originalNextSibling);
      } else {
        originalParent.appendChild(cardEl);
      }
      syncEmptyDropzoneVisibility(originalParent);
    }
    if (previewGridEl && previewGridEl !== originalParent) {
      syncEmptyDropzoneVisibility(previewGridEl);
    }
  }

  function dockFloatingCardIntoPlaceholder({ exactRect = null } = {}) {
    if (!tracked || !tracked.cardEl) return;
    const {
      cardEl,
      originalStyleSnapshot,
      previewPageId,
      previewViewId,
      fromPageId,
      originalParent,
    } = tracked;

    cardEl.classList.remove('dragging', 'pointer-dragging', 'desktop-floating-card');
    applyElementStyleSnapshot(cardEl, originalStyleSnapshot);
    if (exactRect && Number.isInteger(exactRect.row) && Number.isInteger(exactRect.column)) {
      const cSpan = Math.max(1, Number(exactRect.colSpan) || 1);
      const rSpan = Math.max(1, Number(exactRect.rowSpan) || 1);
      cardEl.style.gridColumn = `${exactRect.column + 1} / span ${cSpan}`;
      cardEl.style.gridRow = `${exactRect.row + 1} / span ${rSpan}`;
      cardEl.dataset.fixedCell = 'true';
      cardEl.dataset.savedCell = 'true';
      cardEl.dataset.fixedRow = String(exactRect.row);
      cardEl.dataset.fixedColumn = String(exactRect.column);
    }
    cardEl.dataset.pageId = previewPageId || fromPageId;
    if (previewViewId) {
      cardEl.dataset.viewId = previewViewId;
    }

    if (placeholderEl && placeholderEl.parentNode) {
      const targetGrid = placeholderEl.parentNode;
      targetGrid.insertBefore(cardEl, placeholderEl);
      placeholderEl.remove();
      placeholderEl = null;
      syncEmptyDropzoneVisibility(targetGrid);
      if (originalParent && originalParent !== targetGrid) {
        syncEmptyDropzoneVisibility(originalParent);
      }
    } else {
      restoreFloatingCardToOrigin();
    }
  }

  function releaseCapture() {
    if (!tracked || tracked.pointerId === null) return;
    const captureHost = tracked.captureEl;
    const pid = tracked.pointerId;
    tracked.captureEl = null;
    if (captureHost && typeof captureHost.releasePointerCapture === 'function') {
      try {
        if (
          typeof captureHost.hasPointerCapture !== 'function' ||
          captureHost.hasPointerCapture(pid)
        ) {
          captureHost.releasePointerCapture(pid);
        }
      } catch {
        // Ignore pointer capture release errors
      }
    }
  }

  function cleanup({
    wasDragging = false,
    restoreOrigin = true,
    keepDisplacedStyles = false,
    exactDockRect = null,
  } = {}) {
    clearTabHoverTimer();
    clearEdgeViewTimer();
    clearFolderMergePreview();
    stopAutoScroll();
    clearAllFlipAnimations();
    releaseCapture();
    if (!keepDisplacedStyles) {
      restoreCellPreviewGridMutations(null, { animateFlip: false });
    } else if (tracked?.cellPreviewSnapshots) {
      for (const [cardNode] of tracked.cellPreviewSnapshots.entries()) {
        if (cardNode?.dataset) {
          delete cardNode.dataset.cellPreviewDisplaced;
        }
      }
      tracked.cellPreviewSnapshots.clear();
      tracked.cellPreviewState = null;
    }
    if (tracked?.isDragging) {
      if (restoreOrigin) {
        removePlaceholder();
        restoreFloatingCardToOrigin();
      } else {
        dockFloatingCardIntoPlaceholder({ exactRect: exactDockRect });
      }
    } else {
      removePlaceholder();
    }
    clearTargetHighlights();
    tracked = null;
    if (wasDragging) {
      suppressClickUntil = performance.now() + 380;
      onDragEnd?.();
    }
  }

  function cancelDrag() {
    if (!tracked) return;
    const wasDragging = Boolean(tracked.isDragging);
    cleanup({ wasDragging, restoreOrigin: true });
  }

  function createPlaceholderForCard(cardEl, kind, rect) {
    const isWidget = kind === 'widget' || cardEl.classList.contains('ios-widget');
    const dataset = {
      placeholderKind: kind,
    };
    if (!isWidget && kind === 'site' && String(cardEl.dataset?.siteSize || '') === 'square') {
      dataset.siteSize = 'square';
    }
    const squareWidgetSizes = new Set(['single', 'square', 'large', 'full']);
    if (isWidget) {
      const rawSize = String(
        cardEl.dataset?.widgetSize || cardEl.getAttribute?.('data-widget-size') || ''
      ).trim();
      dataset.widgetSize = [
        'single',
        'compact',
        'square',
        'landscape',
        'tall',
        'large',
        'full',
        'strip',
      ].includes(rawSize)
        ? rawSize
        : 'compact';
    }
    const ph = el('div', {
      className: `desktop-drag-placeholder ${
        isWidget ? 'ios-widget-placeholder' : 'app-item-placeholder'
      }`,
      'aria-hidden': 'true',
      dataset,
    });
    if (isWidget && dataset.widgetSize) {
      ph.setAttribute('data-widget-size', dataset.widgetSize);
    }
    if (rect && rect.height > 0 && !(isWidget && squareWidgetSizes.has(dataset.widgetSize))) {
      ph.style.minHeight = `${Math.round(rect.height)}px`;
      ph.style.height = `${Math.round(rect.height)}px`;
    }
    if (!isWidget && rect && rect.width > 0 && dataset.siteSize !== 'square') {
      ph.style.width = `${Math.round(rect.width)}px`;
    }
    return ph;
  }

  function liftCardIntoFloatingLayer(clientX, clientY) {
    const { cardEl, kind, startX, startY } = tracked;
    const rect = cardEl.getBoundingClientRect();
    const width = Math.max(40, Math.round(rect.width || cardEl.offsetWidth || 72));
    const height = Math.max(44, Math.round(rect.height || cardEl.offsetHeight || 78));
    const anchorX = Number.isFinite(startX) ? startX : clientX;
    const anchorY = Number.isFinite(startY) ? startY : clientY;

    tracked.cardWidth = width;
    tracked.cardHeight = height;
    if (rect.width > 0 && rect.height > 0) {
      tracked.grabOffsetX = Math.min(Math.max(anchorX - rect.left, 8), Math.max(8, width - 8));
      tracked.grabOffsetY = Math.min(Math.max(anchorY - rect.top, 8), Math.max(8, height - 8));
    } else {
      tracked.grabOffsetX = Math.min(24, Math.round(width / 2));
      tracked.grabOffsetY = Math.min(24, Math.round(height / 2));
    }

    placeholderEl = createPlaceholderForCard(cardEl, kind, { width, height });
    tracked.placeholderBaseSnapshot = getElementStyleSnapshot(placeholderEl);

    // If card was pinned on its origin grid, start placeholder at its exact pinned coordinates
    const origFixedRow = Number(cardEl.dataset?.fixedRow);
    const origFixedCol = Number(cardEl.dataset?.fixedColumn);
    if (
      cardEl.dataset?.fixedCell === 'true' &&
      Number.isInteger(origFixedRow) &&
      Number.isInteger(origFixedCol)
    ) {
      const defaultSpan = readCardDefaultSpan(cardEl, kind);
      placeholderEl.style.gridColumn = `${origFixedCol + 1} / span ${defaultSpan.colSpan}`;
      placeholderEl.style.gridRow = `${origFixedRow + 1} / span ${defaultSpan.rowSpan}`;
      placeholderEl.classList.add('is-cell-drop-preview');
      placeholderEl.dataset.previewRow = String(origFixedRow);
      placeholderEl.dataset.previewColumn = String(origFixedCol);
      placeholderEl.dataset.previewValid = 'true';
    }

    if (cardEl.parentNode) {
      cardEl.parentNode.insertBefore(placeholderEl, cardEl);
    }

    cardEl.classList.add('dragging', 'pointer-dragging', 'desktop-floating-card');
    cardEl.style.removeProperty?.('grid-column');
    cardEl.style.removeProperty?.('grid-row');
    cardEl.style.position = 'fixed';
    cardEl.style.top = '0px';
    cardEl.style.left = '0px';
    cardEl.style.width = `${width}px`;
    cardEl.style.height = `${height}px`;
    cardEl.style.margin = '0';
    cardEl.style.zIndex = '240';
    cardEl.style.pointerEvents = 'none';
    cardEl.style.transition = 'none';

    document.body.appendChild(cardEl);
    moveFloatingCard(clientX, clientY);
  }

  function moveFloatingCard(clientX, clientY) {
    if (!tracked || !tracked.isDragging || !tracked.cardEl) return;
    const x = Math.round(clientX - tracked.grabOffsetX);
    const y = Math.round(clientY - tracked.grabOffsetY);
    tracked.cardEl.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.03)`;
  }

  function isPinnedDesktopCard(cardEl) {
    if (!cardEl) return false;
    return cardEl.dataset?.fixedCell === 'true';
  }

  function getGridCardsExcludingDragged(gridEl, { includePinned = false } = {}) {
    if (!gridEl) return [];
    return Array.from(
      gridEl.querySelectorAll('[data-placement-kind][data-placement-id]')
    ).filter((node) => node !== tracked?.cardEl && (includePinned || !isPinnedDesktopCard(node)));
  }

  function captureGridCardRects(gridEl) {
    const map = new Map();
    if (!gridEl) return map;
    const cards = getGridCardsExcludingDragged(gridEl, { includePinned: false });
    for (const card of cards) {
      map.set(card, card.getBoundingClientRect());
    }
    return map;
  }

  function captureAllGridCardRects(gridEl) {
    const map = new Map();
    if (!gridEl) return map;
    const cards = getGridCardsExcludingDragged(gridEl, { includePinned: true });
    for (const card of cards) {
      map.set(card, card.getBoundingClientRect());
    }
    return map;
  }

  function playFlipForGrid(gridEl, beforeRects, { includePinned = false } = {}) {
    if (!gridEl || !beforeRects || beforeRects.size === 0) return;
    const cards = getGridCardsExcludingDragged(gridEl, { includePinned });
    for (const card of cards) {
      const prev = beforeRects.get(card);
      if (!prev) continue;
      const next = card.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      const existing = activeFlipAnimations.get(card);
      if (existing) {
        try {
          existing.cancel();
        } catch {
          // Ignore cancel error
        }
        activeFlipAnimations.delete(card);
      }

      if (typeof card.animate === 'function') {
        try {
          const anim = card.animate(
            [
              { transform: `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            {
              duration: FLIP_DURATION_MS,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            }
          );
          activeFlipAnimations.set(card, anim);
          const clearEntry = () => {
            if (activeFlipAnimations.get(card) === anim) {
              activeFlipAnimations.delete(card);
            }
          };
          anim.onfinish = clearEntry;
          anim.oncancel = clearEntry;
        } catch {
          // Fallback if Web Animations API fails in synthetic env
        }
      }
    }
  }

  function findGridElementForViewOrPage({ viewId = null, pageId = null } = {}) {
    if (!trackEl) return null;
    if (viewId) {
      const byView =
        trackEl.querySelector(`.apps-grid[data-view-id="${CSS.escape(viewId)}"]`) ||
        trackEl.querySelector(`.springboard-page[data-view-id="${CSS.escape(viewId)}"] .apps-grid`);
      if (byView) return byView;
    }
    const activePageGrid = trackEl.querySelector(
      `.springboard-page.page-active .apps-grid${pageId ? `[data-page-id="${CSS.escape(pageId)}"]` : ''}`
    );
    if (activePageGrid) return activePageGrid;
    if (pageId) {
      return (
        trackEl.querySelector(`.apps-grid[data-page-id="${CSS.escape(pageId)}"]`) ||
        trackEl.querySelector(`.springboard-page[data-page-id="${CSS.escape(pageId)}"] .apps-grid`)
      );
    }
    return null;
  }

  function isCellDropEnabledForGrid(gridEl, pageId, viewId) {
    if (!tracked || !gridEl) return false;
    if (tracked.kind !== 'site' && tracked.kind !== 'widget') return false;
    if (typeof planCellDrop !== 'function' || typeof onCommitCellDrop !== 'function') {
      return false;
    }
    if (gridEl.dataset?.folderId || gridEl.classList?.contains?.('folder-detail-grid')) {
      return false;
    }
    if (!gridEl.classList?.contains?.('desktop-mixed-grid')) {
      return false;
    }
    const pageEl = gridEl.closest?.('.springboard-page');
    if (pageEl && pageEl.dataset?.subViewIndex !== undefined) {
      if (Number(pageEl.dataset.subViewIndex) !== 0) {
        return false;
      }
    }
    if (typeof canUseCellDropForGrid === 'function') {
      return Boolean(
        canUseCellDropForGrid({
          gridEl,
          pageId: pageId || gridEl.dataset?.pageId || getCurrentPageId(),
          viewId: viewId || gridEl.dataset?.viewId || pageEl?.dataset?.viewId || getCurrentViewId?.() || null,
          kind: tracked.kind,
          id: tracked.id,
          fromPageId: tracked.fromPageId,
          fromFolderId: tracked.fromFolderId || null,
        })
      );
    }
    return true;
  }

  function syncPlaceholderSizeAttributesForTarget(spanInfo) {
    if (!placeholderEl || !spanInfo) return;
    if (tracked?.kind === 'widget') {
      const nextDisplaySize = spanInfo.displaySize;
      if (
        typeof nextDisplaySize === 'string' &&
        nextDisplaySize &&
        placeholderEl.getAttribute('data-widget-size') !== nextDisplaySize
      ) {
        placeholderEl.dataset.widgetSize = nextDisplaySize;
        placeholderEl.setAttribute('data-widget-size', nextDisplaySize);
      }
    }
  }

  function applyCellDropPreviewOnGrid(targetGrid, clientX, clientY) {
    if (!tracked || !placeholderEl || !targetGrid) return false;
    const toPageId = targetGrid.dataset?.pageId || getCurrentPageId();
    const targetViewId =
      targetGrid.dataset?.viewId ||
      targetGrid.closest?.('.springboard-page')?.dataset?.viewId ||
      getCurrentViewId?.() ||
      null;

    // Restore any prior preview mutations on other grids if the user switched pages
    if (tracked.cellPreviewState?.gridEl && tracked.cellPreviewState.gridEl !== targetGrid) {
      restoreCellPreviewGridMutations(tracked.cellPreviewState.gridEl, { animateFlip: false });
    }

    const spanInfo =
      typeof getCellDropSpan === 'function'
        ? getCellDropSpan({
            kind: tracked.kind,
            id: tracked.id,
            fromPageId: tracked.fromPageId,
            fromFolderId: tracked.fromFolderId || null,
            toPageId,
            targetViewId,
          })
        : null;

    const fallbackSpan = readCardDefaultSpan(tracked.cardEl, tracked.kind, spanInfo?.metrics);
    const colSpan = Math.max(1, Number(spanInfo?.colSpan) || fallbackSpan.colSpan);
    const rowSpan = Math.max(1, Number(spanInfo?.rowSpan) || fallbackSpan.rowSpan);
    const metrics = spanInfo?.metrics || null;

    const geometry = measureDesktopGridGeometry(targetGrid, metrics);
    if (!geometry) return false;

    // Sensibly adapt grab offset if card footprint on target grid differs from lifted card rect
    const expectedWidth =
      colSpan * geometry.avgColWidth + Math.max(0, colSpan - 1) * geometry.colGap;
    const expectedHeight =
      rowSpan * geometry.rowHeight + Math.max(0, rowSpan - 1) * geometry.rowGap;
    const ratioX =
      tracked.cardWidth > 0 ? Math.min(1, Math.max(0, tracked.grabOffsetX / tracked.cardWidth)) : 0.5;
    const ratioY =
      tracked.cardHeight > 0 ? Math.min(1, Math.max(0, tracked.grabOffsetY / tracked.cardHeight)) : 0.5;
    const effectiveGrabX =
      expectedWidth > 0 && Math.abs(expectedWidth - tracked.cardWidth) > geometry.avgColWidth * 0.45
        ? ratioX * expectedWidth
        : tracked.grabOffsetX;
    const effectiveGrabY =
      expectedHeight > 0 && Math.abs(expectedHeight - tracked.cardHeight) > geometry.rowHeight * 0.45
        ? ratioY * expectedHeight
        : tracked.grabOffsetY;

    const resolvedCell = resolveGridAnchorCellFromPointer({
      geometry,
      clientX,
      clientY,
      grabOffsetX: effectiveGrabX,
      grabOffsetY: effectiveGrabY,
      colSpan,
      rowSpan,
    });
    if (!resolvedCell) return false;

    const candidateCell = { row: resolvedCell.row, column: resolvedCell.column };

    const prevState = tracked.cellPreviewState;
    if (
      prevState &&
      prevState.gridEl === targetGrid &&
      prevState.pageId === toPageId &&
      prevState.cell.row === candidateCell.row &&
      prevState.cell.column === candidateCell.column &&
      Boolean(prevState.fitsGrid) === Boolean(resolvedCell.fitsGrid) &&
      placeholderEl.parentNode === targetGrid
    ) {
      targetGrid.classList.toggle('is-cell-drop-invalid', !prevState.valid);
      return true;
    }

    const plan = resolvedCell.fitsGrid
      ? planCellDrop({
          kind: tracked.kind,
          id: tracked.id,
          fromPageId: tracked.fromPageId,
          fromFolderId: tracked.fromFolderId || null,
          toPageId,
          targetViewId,
          cell: candidateCell,
        })
      : null;

    const isValid = Boolean(plan && plan.targetRect);
    const beforeRects = captureAllGridCardRects(targetGrid);
    const prevParent = placeholderEl.parentElement;

    // Ensure placeholder is mounted in targetGrid without rebuilding existing cards
    if (placeholderEl.parentNode !== targetGrid) {
      const addTile = targetGrid.querySelector('.add-tile-card');
      if (addTile && addTile.parentNode === targetGrid) {
        targetGrid.insertBefore(placeholderEl, addTile);
      } else {
        targetGrid.appendChild(placeholderEl);
      }
    }

    syncPlaceholderSizeAttributesForTarget(spanInfo);

    // Build lookup of live cards on targetGrid by `kind:id` (excluding dragged card & any cross-page mirror of same site)
    const gridCardsByKey = new Map();
    const selfKey = `${tracked.kind}:${tracked.id}`;
    Array.from(targetGrid.querySelectorAll('[data-placement-kind][data-placement-id]')).forEach(
      (node) => {
        if (node === tracked.cardEl) return;
        const k = `${node.dataset.placementKind}:${node.dataset.placementId}`;
        gridCardsByKey.set(k, node);
      }
    );

    const nextDisplacedNodes = new Set();

    // If cross-page dragging a site onto a page that already has a mirror of the same site, hide its mirror preview cleanly
    if (tracked.fromPageId !== toPageId && gridCardsByKey.has(selfKey)) {
      const mirrorNode = gridCardsByKey.get(selfKey);
      if (mirrorNode) {
        if (!tracked.cellPreviewSnapshots.has(mirrorNode)) {
          tracked.cellPreviewSnapshots.set(mirrorNode, {
            gridEl: targetGrid,
            snapshot: getElementStyleSnapshot(mirrorNode),
          });
        }
        mirrorNode.style.display = 'none';
        mirrorNode.dataset.cellPreviewDisplaced = 'true';
        nextDisplacedNodes.add(mirrorNode);
      }
    }

    if (isValid) {
      const { targetRect, moves = [] } = plan;
      placeholderEl.classList.add('is-cell-drop-preview');
      placeholderEl.classList.remove('is-cell-drop-invalid');
      placeholderEl.style.gridColumn = `${targetRect.column + 1} / span ${targetRect.colSpan}`;
      placeholderEl.style.gridRow = `${targetRect.row + 1} / span ${targetRect.rowSpan}`;
      // Clear fixed pixel width/height overrides if multi-track widget or square card uses CSS grid track sizing
      if (tracked.kind === 'widget' || String(placeholderEl.dataset?.siteSize || '') === 'square') {
        placeholderEl.style.removeProperty?.('width');
      }
      placeholderEl.dataset.previewRow = String(targetRect.row);
      placeholderEl.dataset.previewColumn = String(targetRect.column);
      placeholderEl.dataset.previewValid = 'true';
      targetGrid.classList.remove('is-cell-drop-invalid');

      for (const mv of moves) {
        const mvKey = `${mv.kind}:${mv.id}`;
        const cardNode = gridCardsByKey.get(mvKey);
        if (!cardNode || !mv.cell) continue;
        if (!tracked.cellPreviewSnapshots.has(cardNode)) {
          tracked.cellPreviewSnapshots.set(cardNode, {
            gridEl: targetGrid,
            snapshot: getElementStyleSnapshot(cardNode),
          });
        }
        const mvSpan = readCardDefaultSpan(cardNode, mv.kind, metrics);
        cardNode.style.gridColumn = `${mv.cell.column + 1} / span ${mvSpan.colSpan}`;
        cardNode.style.gridRow = `${mv.cell.row + 1} / span ${mvSpan.rowSpan}`;
        cardNode.dataset.cellPreviewDisplaced = 'true';
        nextDisplacedNodes.add(cardNode);
      }
    } else {
      // Invalid drop preview: restore any previously displaced pinned cards on this grid to their original spots,
      // and show distinct invalid placeholder clamped inside visible grid tracks without displacing immovable cards.
      const clampedCol = Math.max(
        0,
        Math.min(geometry.columns - Math.min(colSpan, geometry.columns), resolvedCell.previewColumn)
      );
      const clampedRow = Math.max(
        0,
        Math.min(geometry.maxRows - Math.min(rowSpan, geometry.maxRows), resolvedCell.previewRow)
      );
      const visColSpan = Math.min(colSpan, geometry.columns - clampedCol);
      const visRowSpan = Math.min(rowSpan, geometry.maxRows - clampedRow);

      placeholderEl.classList.add('is-cell-drop-preview', 'is-cell-drop-invalid');
      placeholderEl.style.gridColumn = `${clampedCol + 1} / span ${Math.max(1, visColSpan)}`;
      placeholderEl.style.gridRow = `${clampedRow + 1} / span ${Math.max(1, visRowSpan)}`;
      if (tracked.kind === 'widget' || String(placeholderEl.dataset?.siteSize || '') === 'square') {
        placeholderEl.style.removeProperty?.('width');
      }
      placeholderEl.dataset.previewRow = String(candidateCell.row);
      placeholderEl.dataset.previewColumn = String(candidateCell.column);
      placeholderEl.dataset.previewValid = 'false';
      targetGrid.classList.add('is-cell-drop-invalid');
    }

    // Restore any cards on targetGrid that were displaced in a previous hover cell but are no longer displaced now
    for (const [cardNode, rec] of Array.from(tracked.cellPreviewSnapshots.entries())) {
      if (rec.gridEl === targetGrid && !nextDisplacedNodes.has(cardNode)) {
        applyElementStyleSnapshot(cardNode, rec.snapshot);
        if (cardNode?.dataset) {
          delete cardNode.dataset.cellPreviewDisplaced;
        }
        tracked.cellPreviewSnapshots.delete(cardNode);
      }
    }

    tracked.previewPageId = toPageId;
    tracked.previewViewId = targetViewId;
    tracked.previewFolderId = null;
    tracked.previewGridEl = targetGrid;
    tracked.cellPreviewState = {
      mode: 'cell',
      gridEl: targetGrid,
      pageId: toPageId,
      viewId: targetViewId,
      cell: candidateCell,
      fitsGrid: Boolean(resolvedCell.fitsGrid),
      valid: isValid,
      plan: isValid ? plan : null,
    };

    syncEmptyDropzoneVisibility(targetGrid);
    if (prevParent && prevParent !== targetGrid) {
      syncEmptyDropzoneVisibility(prevParent);
    }

    playFlipForGrid(targetGrid, beforeRects, { includePinned: true });
    return true;
  }

  function movePlaceholderInGrid(targetGrid, beforeNode) {
    if (!placeholderEl || !targetGrid) return false;
    if (tracked?.cellPreviewState) {
      restoreCellPreviewGridMutations(null, { animateFlip: false });
    }
    const addTile = targetGrid.querySelector('.add-tile-card');
    const effectiveBeforeNode = beforeNode || addTile || null;

    if (
      placeholderEl.parentNode === targetGrid &&
      (placeholderEl.nextSibling === effectiveBeforeNode ||
        (effectiveBeforeNode === null && placeholderEl.nextSibling === null))
    ) {
      return false;
    }

    const now = performance.now();
    if (
      now - (tracked.lastSwapAt || 0) < SWAP_COOLDOWN_MS &&
      placeholderEl.parentNode === targetGrid
    ) {
      return false;
    }

    const prevGrid = placeholderEl.parentElement;
    const beforeRects = captureGridCardRects(targetGrid);

    if (effectiveBeforeNode && effectiveBeforeNode.parentNode === targetGrid) {
      targetGrid.insertBefore(placeholderEl, effectiveBeforeNode);
    } else {
      targetGrid.appendChild(placeholderEl);
    }

    tracked.lastSwapAt = now;
    tracked.previewPageId = targetGrid.dataset.pageId || getCurrentPageId();
    tracked.previewViewId =
      targetGrid.dataset.viewId ||
      targetGrid.closest('.springboard-page')?.dataset?.viewId ||
      getCurrentViewId?.() ||
      null;
    tracked.previewFolderId = targetGrid.dataset.folderId || null;
    tracked.previewGridEl = targetGrid;

    syncEmptyDropzoneVisibility(targetGrid);
    if (prevGrid && prevGrid !== targetGrid) {
      syncEmptyDropzoneVisibility(prevGrid);
    }

    playFlipForGrid(targetGrid, beforeRects);
    return true;
  }

  function isPointInFolderMergeCenterZone(cardEl, clientX, clientY) {
    if (!cardEl || typeof cardEl.getBoundingClientRect !== 'function') return false;
    const rect = cardEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    return (
      relX >= FOLDER_CENTER_RATIO &&
      relX <= 1 - FOLDER_CENTER_RATIO &&
      relY >= FOLDER_CENTER_RATIO &&
      relY <= 1 - FOLDER_CENTER_RATIO
    );
  }

  function canDragItemMergeIntoTarget(draggedKind, draggedId, targetKind, targetId, inFolderGrid) {
    if (inFolderGrid) return false; // Never create nested folders inside a folder modal
    if (draggedKind !== 'site') return false; // Only sites can enter folders
    if (targetKind !== 'site' && targetKind !== 'folder') return false;
    if (targetKind === 'site' && targetId === draggedId) return false;
    return true;
  }

  function shouldInsertBeforeCard(cardEl, clientX, clientY, isCurrentlyBeforeTarget) {
    const rect = cardEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return true;

    const deadzoneX = rect.width * HYSTERESIS_RATIO;
    const deadzoneY = rect.height * HYSTERESIS_RATIO;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (clientY < centerY - deadzoneY) return true;
    if (clientY > centerY + deadzoneY) return false;
    if (clientX < centerX - deadzoneX) return true;
    if (clientX > centerX + deadzoneX) return false;

    return isCurrentlyBeforeTarget;
  }

  function resolveInsertionNodeInGrid(gridEl, clientX, clientY) {
    const cards = getGridCardsExcludingDragged(gridEl);
    if (cards.length === 0) return null;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (clientY < rect.top) {
        return card;
      }
      if (clientY >= rect.top && clientY <= rect.bottom) {
        if (clientX < rect.left + rect.width / 2) {
          return card;
        }
      }
    }
    return null;
  }

  function inspectPointTarget(clientX, clientY) {
    if (typeof document.elementFromPoint !== 'function') {
      return null;
    }
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit || typeof hit.closest !== 'function') return null;

    // If dragging from an open folder modal and pointer moves onto the modal backdrop outside the card,
    // treat it as an explicit "extract to desktop" trigger
    const folderBackdrop = hit.closest('#folderDetailModal');
    const folderModalCard = hit.closest('.folder-detail-modal-card');
    if (folderBackdrop && !folderModalCard && tracked?.fromFolderId) {
      return {
        type: 'folder-outside-backdrop',
        pageId: getCurrentPageId(),
        viewId: getCurrentViewId?.() || null,
        element: folderBackdrop,
      };
    }

    const tabEl = hit.closest('.category-pill[data-page-id], .page-dot[data-page-id]');
    if (tabEl) {
      return {
        type: 'tab',
        pageId: tabEl.dataset.pageId,
        viewId: tabEl.dataset.viewId || null,
        element: tabEl,
      };
    }

    const arrowEl = hit.closest('.page-nav-arrow');
    if (arrowEl) {
      const activeGrid = findGridElementForViewOrPage({
        viewId: getCurrentViewId?.(),
        pageId: getCurrentPageId(),
      });
      return {
        type: 'grid',
        pageId: activeGrid?.dataset?.pageId || getCurrentPageId(),
        viewId: activeGrid?.dataset?.viewId || getCurrentViewId?.() || null,
        element: activeGrid || arrowEl,
        gridEl: activeGrid,
      };
    }

    const phHit = hit.closest('.desktop-drag-placeholder');
    if (phHit) {
      const gridEl = phHit.closest('.apps-grid[data-page-id], .folder-detail-grid[data-folder-id]');
      const folderGrid = phHit.closest('.folder-detail-grid[data-folder-id]');
      return {
        type: 'placeholder',
        pageId: gridEl?.dataset?.pageId || tracked?.previewPageId || getCurrentPageId(),
        viewId: gridEl?.dataset?.viewId || tracked?.previewViewId || getCurrentViewId?.() || null,
        folderId: folderGrid?.dataset?.folderId || null,
        element: phHit,
        gridEl,
      };
    }

    const cardEl = hit.closest('[data-placement-kind][data-placement-id]');
    if (cardEl && cardEl !== tracked?.cardEl) {
      const targetKind = cardEl.dataset.placementKind;
      const targetId = cardEl.dataset.placementId;
      const gridEl = cardEl.closest('.apps-grid[data-page-id], .folder-detail-grid[data-folder-id]');
      const folderGrid = cardEl.closest('.folder-detail-grid[data-folder-id]');
      const targetPageId = cardEl.dataset.pageId || gridEl?.dataset?.pageId || getCurrentPageId();
      const targetFolderId = folderGrid?.dataset?.folderId || null;
      const targetViewId =
        cardEl.dataset.viewId ||
        gridEl?.dataset?.viewId ||
        cardEl.closest('.springboard-page')?.dataset?.viewId ||
        getCurrentViewId?.() ||
        null;
      return {
        type: 'card',
        kind: targetKind,
        id: targetId,
        pageId: targetPageId,
        viewId: targetViewId,
        folderId: targetFolderId,
        element: cardEl,
        gridEl,
      };
    }

    const folderGridEl = hit.closest('.folder-detail-grid[data-folder-id]');
    if (folderGridEl) {
      return {
        type: 'grid',
        pageId: folderGridEl.dataset.pageId || getCurrentPageId(),
        viewId: getCurrentViewId?.() || null,
        folderId: folderGridEl.dataset.folderId,
        element: folderGridEl,
        gridEl: folderGridEl,
      };
    }

    const dropzoneEl = hit.closest('.empty-page-dropzone[data-page-id]');
    if (dropzoneEl) {
      const gridEl = dropzoneEl.closest('.apps-grid[data-page-id]');
      return {
        type: 'grid',
        pageId: dropzoneEl.dataset.pageId || gridEl?.dataset?.pageId || getCurrentPageId(),
        viewId:
          dropzoneEl.dataset.viewId ||
          gridEl?.dataset?.viewId ||
          getCurrentViewId?.() ||
          null,
        element: gridEl || dropzoneEl,
        gridEl,
      };
    }

    const gridEl = hit.closest('.apps-grid[data-page-id]');
    if (gridEl) {
      return {
        type: 'grid',
        pageId: gridEl.dataset.pageId || getCurrentPageId(),
        viewId: gridEl.dataset.viewId || getCurrentViewId?.() || null,
        element: gridEl,
        gridEl,
      };
    }

    const pageEl = hit.closest('.springboard-page[data-page-id]');
    if (pageEl) {
      const innerGrid = pageEl.querySelector('.apps-grid[data-page-id]');
      return {
        type: 'grid',
        pageId: pageEl.dataset.pageId || getCurrentPageId(),
        viewId: pageEl.dataset.viewId || innerGrid?.dataset?.viewId || getCurrentViewId?.() || null,
        element: innerGrid || pageEl,
        gridEl: innerGrid,
      };
    }

    const stageEl = hit.closest('.springboard-viewport, .springboard-stage');
    if (stageEl) {
      const activeGrid = findGridElementForViewOrPage({
        viewId: getCurrentViewId?.(),
        pageId: getCurrentPageId(),
      });
      if (activeGrid) {
        return {
          type: 'grid',
          pageId: activeGrid.dataset.pageId || getCurrentPageId(),
          viewId: activeGrid.dataset.viewId || getCurrentViewId?.() || null,
          element: activeGrid,
          gridEl: activeGrid,
        };
      }
    }

    return null;
  }

  function getNextCardAfterNode(startNode) {
    let curr = startNode ? startNode.nextElementSibling : null;
    while (curr) {
      if (
        curr !== tracked?.cardEl &&
        curr !== placeholderEl &&
        !isPinnedDesktopCard(curr) &&
        curr.dataset?.placementKind &&
        curr.dataset?.placementId
      ) {
        return curr;
      }
      curr = curr.nextElementSibling;
    }
    return null;
  }

  function readPlaceholderCommitTarget() {
    if (!placeholderEl || !placeholderEl.parentElement) return null;
    const gridEl = placeholderEl.closest('.apps-grid[data-page-id], .folder-detail-grid[data-folder-id]');
    const folderGrid = placeholderEl.closest('.folder-detail-grid[data-folder-id]');
    const toPageId = gridEl?.dataset?.pageId || tracked?.previewPageId || getCurrentPageId();
    const targetFolderId = folderGrid?.dataset?.folderId || null;
    const targetViewId =
      gridEl?.dataset?.viewId ||
      gridEl?.closest('.springboard-page')?.dataset?.viewId ||
      tracked?.previewViewId ||
      getCurrentViewId?.() ||
      null;
    const nextCard = getNextCardAfterNode(placeholderEl);
    return {
      toPageId,
      targetViewId,
      targetFolderId,
      beforeKind: nextCard ? nextCard.dataset.placementKind : null,
      beforeId: nextCard ? nextCard.dataset.placementId : null,
    };
  }

  function refreshActiveDesktopHoverAfterSwitch() {
    if (!tracked || !tracked.isDragging) return;
    const nextGrid = findGridElementForViewOrPage({
      viewId: getCurrentViewId?.(),
      pageId: getCurrentPageId(),
    });
    if (!nextGrid) return;
    const hitNow = inspectPointTarget(tracked.lastX, tracked.lastY);
    if (hitNow && (hitNow.type === 'grid' || hitNow.type === 'card' || hitNow.type === 'placeholder')) {
      updateHoverTarget(hitNow, tracked.lastX, tracked.lastY);
      return;
    }
    // If pointer is still over a tab or screen edge right after switching, only prepare non-cell sub-views;
    // primary cell-drop grids wait until the pointer enters the grid or use pointer coordinates directly.
    if (!isCellDropEnabledForGrid(nextGrid, nextGrid.dataset?.pageId, nextGrid.dataset?.viewId)) {
      movePlaceholderInGrid(nextGrid, null);
    }
  }

  function updateEdgeViewHover(clientX) {
    if (!tracked || !tracked.isDragging || typeof onSwitchAdjacentView !== 'function') {
      clearEdgeViewTimer();
      return;
    }
    // If still inside open folder modal, only allow edge switching after exiting the modal
    if (tracked.previewFolderId) {
      clearEdgeViewTimer();
      return;
    }
    const vw = window.innerWidth || document.documentElement?.clientWidth || 0;
    if (vw <= 0) {
      clearEdgeViewTimer();
      return;
    }

    let desiredDir = 0;
    if (clientX <= EDGE_VIEW_ZONE_PX) {
      desiredDir = -1;
    } else if (clientX >= vw - EDGE_VIEW_ZONE_PX) {
      desiredDir = 1;
    }

    if (desiredDir === 0) {
      clearEdgeViewTimer();
      return;
    }

    if (edgeViewDirection === desiredDir && edgeViewTimer !== null) {
      return;
    }

    clearEdgeViewTimer();
    edgeViewDirection = desiredDir;

    const triggerEdgeStep = () => {
      edgeViewTimer = null;
      const dir = edgeViewDirection;
      edgeViewDirection = 0;
      if (!tracked || !tracked.isDragging || !isJiggleMode() || !dir) return;
      clearFolderMergePreview();
      restoreCellPreviewGridMutations(null, { animateFlip: false });
      removePlaceholderForTransientPageSwitch();
      const switched = onSwitchAdjacentView(dir);
      if (switched) {
        refreshActiveDesktopHoverAfterSwitch();
        edgeViewDirection = dir;
        edgeViewTimer = setTimeout(triggerEdgeStep, EDGE_VIEW_SWITCH_MS + 180);
      }
    };

    edgeViewTimer = setTimeout(triggerEdgeStep, EDGE_VIEW_SWITCH_MS);
  }

  function removePlaceholderForTransientPageSwitch() {
    if (!placeholderEl) return;
    const prevParent = placeholderEl.parentElement;
    restorePlaceholderBaseGeometry();
    if (prevParent) {
      placeholderEl.remove();
      syncEmptyDropzoneVisibility(prevParent);
    }
  }

  function armOrMaintainFolderMergeHover(hitInfo) {
    const cardEl = hitInfo?.element;
    if (!cardEl || !tracked) {
      clearFolderMergePreview();
      return;
    }
    const candidateKey = `${hitInfo.pageId}:${hitInfo.kind}:${hitInfo.id}`;
    if (folderMergeReadyTarget && folderMergeCandidateKey === candidateKey) {
      cardEl.classList.add('folder-merge-ready');
      return;
    }
    if (folderMergeCandidateKey === candidateKey && folderMergeTimer !== null) {
      cardEl.classList.add('folder-merge-candidate');
      return;
    }

    clearFolderMergePreview();
    folderMergeCandidateKey = candidateKey;
    cardEl.classList.add('folder-merge-candidate');

    folderMergeTimer = setTimeout(() => {
      folderMergeTimer = null;
      if (!tracked || !tracked.isDragging || folderMergeCandidateKey !== candidateKey) {
        return;
      }
      cardEl.classList.remove('folder-merge-candidate');
      cardEl.classList.add('folder-merge-ready');
      cardEl.dataset.folderMergePreviewLabel =
        hitInfo.kind === 'folder' ? '移入文件夹' : '新建文件夹';
      folderMergeReadyTarget = {
        targetKind: hitInfo.kind,
        targetId: hitInfo.id,
        pageId: hitInfo.pageId,
        viewId: hitInfo.viewId || null,
        element: cardEl,
      };
    }, FOLDER_MERGE_HOVER_MS);
  }

  function transitionFromFolderModalToDesktopGrid(clientX, clientY) {
    if (!tracked || !tracked.previewFolderId) return;
    tracked.previewFolderId = null;
    onRequestExitFolderModalForDrag?.({
      folderId: tracked.fromFolderId,
      siteId: tracked.id,
    });
    const desktopGrid = findGridElementForViewOrPage({
      viewId: getCurrentViewId?.(),
      pageId: getCurrentPageId(),
    });
    if (desktopGrid) {
      if (isCellDropEnabledForGrid(desktopGrid, desktopGrid.dataset?.pageId, desktopGrid.dataset?.viewId)) {
        applyCellDropPreviewOnGrid(desktopGrid, clientX, clientY);
      } else {
        const beforeNode = resolveInsertionNodeInGrid(desktopGrid, clientX, clientY);
        movePlaceholderInGrid(desktopGrid, beforeNode);
      }
    }
  }

  function restorePreviewWhenLeavingDesktopGrid() {
    if (!tracked?.cellPreviewState) return;
    restoreCellPreviewGridMutations(null, { animateFlip: true });
    // If placeholder was temporarily moved into another page's grid, detach it so origin/previous page looks untouched
    if (placeholderEl && placeholderEl.parentElement && placeholderEl.parentElement !== tracked.originalParent) {
      const prevGrid = placeholderEl.parentElement;
      placeholderEl.remove();
      syncEmptyDropzoneVisibility(prevGrid);
    } else if (placeholderEl && tracked.originalParent && tracked.originalCardFixedOrigin) {
      const { row, column, colSpan, rowSpan } = tracked.originalCardFixedOrigin;
      placeholderEl.style.gridColumn = `${column + 1} / span ${colSpan}`;
      placeholderEl.style.gridRow = `${row + 1} / span ${rowSpan}`;
      placeholderEl.classList.add('is-cell-drop-preview');
    }
  }

  function updateHoverTarget(hitInfo, clientX, clientY) {
    if (typeof document !== 'undefined') {
      document
        .querySelectorAll('.drag-over-card, .drag-target-active')
        .forEach((node) => node.classList.remove('drag-over-card', 'drag-target-active'));
    }

    tracked.lastTarget = hitInfo;

    if (!hitInfo) {
      clearTabHoverTimer();
      clearFolderMergePreview();
      restorePreviewWhenLeavingDesktopGrid();
      return;
    }

    if (hitInfo.type === 'folder-outside-backdrop') {
      clearTabHoverTimer();
      clearFolderMergePreview();
      transitionFromFolderModalToDesktopGrid(clientX, clientY);
      return;
    }

    if (hitInfo.type === 'tab') {
      clearFolderMergePreview();
      restorePreviewWhenLeavingDesktopGrid();
      if (tracked.previewFolderId) {
        transitionFromFolderModalToDesktopGrid(clientX, clientY);
      }
      hitInfo.element.classList.add('drag-target-active');
      const targetPageId = hitInfo.pageId;
      const targetViewId = hitInfo.viewId || null;
      if (
        targetPageId &&
        (targetPageId !== getCurrentPageId() ||
          (targetViewId && targetViewId !== getCurrentViewId?.()))
      ) {
        const hoverKey = targetViewId || targetPageId;
        if (tabHoverTargetPageId !== hoverKey) {
          clearTabHoverTimer();
          tabHoverTargetPageId = hoverKey;
          tabHoverTimer = setTimeout(() => {
            tabHoverTimer = null;
            tabHoverTargetPageId = null;
            if (tracked?.isDragging) {
              restoreCellPreviewGridMutations(null, { animateFlip: false });
              removePlaceholderForTransientPageSwitch();
              onSwitchPageById?.(targetPageId, targetViewId);
              refreshActiveDesktopHoverAfterSwitch();
            }
          }, TAB_HOVER_SWITCH_MS);
        }
      } else {
        clearTabHoverTimer();
      }
      return;
    }

    clearTabHoverTimer();

    if (hitInfo.type === 'placeholder') {
      clearFolderMergePreview();
      const gridEl =
        hitInfo.gridEl ||
        findGridElementForViewOrPage({
          viewId: hitInfo.viewId,
          pageId: hitInfo.pageId,
        });
      if (gridEl) {
        gridEl.classList.add('drag-target-active');
        if (isCellDropEnabledForGrid(gridEl, hitInfo.pageId, hitInfo.viewId)) {
          applyCellDropPreviewOnGrid(gridEl, clientX, clientY);
        }
      }
      return;
    }

    if (hitInfo.type === 'card' && hitInfo.element) {
      const cardEl = hitInfo.element;
      const gridEl =
        hitInfo.gridEl ||
        cardEl.closest('.apps-grid[data-page-id], .folder-detail-grid[data-folder-id]');
      const folderGrid = cardEl.closest('.folder-detail-grid[data-folder-id]');
      const inFolderGrid = Boolean(folderGrid?.dataset?.folderId);

      // If dragging from folder modal and hitting a desktop card outside the modal, transition out first
      if (tracked.previewFolderId && !inFolderGrid) {
        transitionFromFolderModalToDesktopGrid(clientX, clientY);
      }

      const eligibleForFolderMerge = canDragItemMergeIntoTarget(
        tracked.kind,
        tracked.id,
        hitInfo.kind,
        hitInfo.id,
        inFolderGrid
      );

      if (eligibleForFolderMerge && isPointInFolderMergeCenterZone(cardEl, clientX, clientY)) {
        // Center zone hover: hold steady, restore any displaced cell preview so target card stays still, and arm 600ms folder merge timer
        if (tracked.cellPreviewState) {
          restoreCellPreviewGridMutations(null, { animateFlip: true });
        }
        cardEl.classList.add('drag-over-card');
        armOrMaintainFolderMergeHover(hitInfo);
        return;
      }

      // Edge zone or non-mergeable card: immediately cancel folder merge preview
      clearFolderMergePreview();

      if (gridEl && isCellDropEnabledForGrid(gridEl, hitInfo.pageId, hitInfo.viewId)) {
        gridEl.classList.add('drag-target-active');
        applyCellDropPreviewOnGrid(gridEl, clientX, clientY);
        return;
      }

      cardEl.classList.add('drag-over-card');

      if (gridEl && placeholderEl) {
        if (isPinnedDesktopCard(cardEl)) {
          const beforeNode = resolveInsertionNodeInGrid(gridEl, clientX, clientY);
          movePlaceholderInGrid(gridEl, beforeNode);
          return;
        }
        const cards = Array.from(gridEl.children);
        const phIdx = cards.indexOf(placeholderEl);
        const targetIdx = cards.indexOf(cardEl);
        const isCurrentlyBeforeTarget =
          phIdx !== -1 && targetIdx !== -1 ? phIdx < targetIdx : true;
        const insertBefore = shouldInsertBeforeCard(
          cardEl,
          clientX,
          clientY,
          isCurrentlyBeforeTarget
        );
        const beforeNode = insertBefore ? cardEl : getNextCardAfterNode(cardEl);
        movePlaceholderInGrid(gridEl, beforeNode);
      }
      return;
    }

    clearFolderMergePreview();

    if (hitInfo.type === 'grid') {
      const inFolderGrid = Boolean(hitInfo.folderId || hitInfo.gridEl?.dataset?.folderId);
      if (tracked.previewFolderId && !inFolderGrid) {
        transitionFromFolderModalToDesktopGrid(clientX, clientY);
      }
      const gridEl =
        hitInfo.gridEl ||
        findGridElementForViewOrPage({
          viewId: hitInfo.viewId,
          pageId: hitInfo.pageId,
        });
      if (gridEl) {
        gridEl.classList.add('drag-target-active');
        if (isCellDropEnabledForGrid(gridEl, hitInfo.pageId, hitInfo.viewId)) {
          applyCellDropPreviewOnGrid(gridEl, clientX, clientY);
        } else {
          const beforeNode = resolveInsertionNodeInGrid(gridEl, clientX, clientY);
          movePlaceholderInGrid(gridEl, beforeNode);
        }
      }
    }
  }

  function computeEdgeScrollDelta(clientY) {
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (vh <= 0) return 0;

    if (clientY < EDGE_SCROLL_ZONE_PX) {
      const ratio = Math.min(1, Math.max(0, (EDGE_SCROLL_ZONE_PX - clientY) / EDGE_SCROLL_ZONE_PX));
      return -Math.max(2, Math.round(ratio * EDGE_SCROLL_MAX_SPEED_PX));
    }
    if (clientY > vh - EDGE_SCROLL_ZONE_PX) {
      const ratio = Math.min(
        1,
        Math.max(0, (clientY - (vh - EDGE_SCROLL_ZONE_PX)) / EDGE_SCROLL_ZONE_PX)
      );
      return Math.max(2, Math.round(ratio * EDGE_SCROLL_MAX_SPEED_PX));
    }
    return 0;
  }

  function stepEdgeAutoScroll() {
    autoScrollRaf = null;
    if (!tracked || !tracked.isDragging || !isJiggleMode()) return;

    const deltaY = computeEdgeScrollDelta(tracked.lastY);
    if (deltaY === 0) return;

    const maxScrollY = Math.max(
      0,
      Math.max(
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0
      ) - (window.innerHeight || 0)
    );
    const currentScrollY = window.scrollY || window.pageYOffset || 0;
    const nextScrollY = Math.min(maxScrollY, Math.max(0, currentScrollY + deltaY));

    if (nextScrollY !== currentScrollY) {
      window.scrollTo(window.scrollX || 0, nextScrollY);
      const hitInfo = inspectPointTarget(tracked.lastX, tracked.lastY);
      updateHoverTarget(hitInfo, tracked.lastX, tracked.lastY);
    }

    if (computeEdgeScrollDelta(tracked.lastY) !== 0) {
      autoScrollRaf = requestAnimationFrame(stepEdgeAutoScroll);
    }
  }

  function updateEdgeAutoScroll(clientY) {
    const deltaY = computeEdgeScrollDelta(clientY);
    if (deltaY !== 0 && autoScrollRaf === null) {
      autoScrollRaf = requestAnimationFrame(stepEdgeAutoScroll);
    } else if (deltaY === 0 && autoScrollRaf !== null) {
      stopAutoScroll();
    }
  }

  function isValidCardElement(cardEl) {
    if (!cardEl) return false;
    if (trackEl && trackEl.contains(cardEl)) return true;
    const folderModal =
      typeof document !== 'undefined' ? document.getElementById('folderDetailModal') : null;
    if (folderModal && !folderModal.hidden && folderModal.contains(cardEl)) return true;
    return false;
  }

  function beginTrackingCard(cardEl, pointerId, clientX, clientY) {
    if (!isValidCardElement(cardEl)) return false;
    const kind = cardEl.dataset.placementKind;
    const id = cardEl.dataset.placementId;
    const originalParent = cardEl.parentElement;
    const folderGrid = cardEl.closest('.folder-detail-grid[data-folder-id]');
    const fromFolderId =
      folderGrid?.dataset?.folderId || originalParent?.dataset?.folderId || null;
    const fromPageId =
      cardEl.dataset.pageId || originalParent?.dataset?.pageId || getCurrentPageId();
    const fromViewId =
      cardEl.dataset.viewId ||
      originalParent?.dataset?.viewId ||
      cardEl.closest('.springboard-page')?.dataset?.viewId ||
      getCurrentViewId?.() ||
      null;
    if (!kind || !id || !fromPageId) return false;

    const originalNextSibling = cardEl.nextSibling;
    const originalStyleSnapshot = getElementStyleSnapshot(cardEl);
    const origFixedRow = Number(cardEl.dataset?.fixedRow);
    const origFixedCol = Number(cardEl.dataset?.fixedColumn);
    const origSpan = readCardDefaultSpan(cardEl, kind);
    const originalCardFixedOrigin =
      cardEl.dataset?.fixedCell === 'true' &&
      Number.isInteger(origFixedRow) &&
      Number.isInteger(origFixedCol)
        ? {
            row: origFixedRow,
            column: origFixedCol,
            colSpan: origSpan.colSpan,
            rowSpan: origSpan.rowSpan,
          }
        : null;

    tracked = {
      pointerId,
      cardEl,
      kind,
      id,
      fromPageId,
      fromViewId,
      fromFolderId,
      previewPageId: fromPageId,
      previewViewId: fromViewId,
      previewFolderId: fromFolderId,
      previewGridEl: originalParent,
      originalParent,
      originalNextSibling,
      originalStyleSnapshot,
      originalCardFixedOrigin,
      placeholderBaseSnapshot: null,
      cellPreviewSnapshots: new Map(),
      cellPreviewState: null,
      startX: clientX,
      startY: clientY,
      lastX: clientX,
      lastY: clientY,
      grabOffsetX: 24,
      grabOffsetY: 24,
      cardWidth: 72,
      cardHeight: 84,
      lastSwapAt: 0,
      isDragging: false,
      captureEl: null,
      lastTarget: null,
    };
    return true;
  }

  function activateActiveDragSession(pointerId, clientX, clientY) {
    if (!tracked || tracked.isDragging) return;
    tracked.isDragging = true;

    onDragStart?.({
      kind: tracked.kind,
      id: tracked.id,
      fromPageId: tracked.fromPageId,
      fromViewId: tracked.fromViewId,
      fromFolderId: tracked.fromFolderId,
      cardEl: tracked.cardEl,
    });

    try {
      if (
        tracked.cardEl &&
        typeof tracked.cardEl.hasPointerCapture === 'function' &&
        tracked.cardEl.hasPointerCapture(pointerId)
      ) {
        tracked.cardEl.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore
    }

    try {
      trackEl.setPointerCapture?.(pointerId);
      tracked.captureEl = trackEl;
    } catch {
      tracked.captureEl = null;
    }

    liftCardIntoFloatingLayer(clientX, clientY);
  }

  function startFromLongPress({
    cardEl,
    pointerId,
    startX,
    startY,
    clientX = startX,
    clientY = startY,
    immediateLift = true,
  } = {}) {
    if (!isJiggleMode()) return false;
    if (tracked) {
      cancelDrag();
    }
    const ok = beginTrackingCard(
      cardEl,
      pointerId,
      Number.isFinite(startX) ? startX : clientX,
      Number.isFinite(startY) ? startY : clientY
    );
    if (!ok) return false;

    tracked.lastX = Number.isFinite(clientX) ? clientX : tracked.startX;
    tracked.lastY = Number.isFinite(clientY) ? clientY : tracked.startY;

    if (immediateLift) {
      activateActiveDragSession(pointerId, tracked.lastX, tracked.lastY);
    }
    return true;
  }

  function handlePointerDown(e) {
    if (!isJiggleMode()) return;
    if (tracked) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!e.target || typeof e.target.closest !== 'function') return;

    if (
      e.target.closest(
        '.delete-badge, .card-edit-actions, .card-edit-btn, .move-page-popover, input, textarea, select, button.folder-title-save-btn, button.folder-title-cancel-btn, button.folder-dissolve-btn'
      )
    ) {
      return;
    }

    const cardEl = e.target.closest('[data-placement-kind][data-placement-id]');
    if (!isValidCardElement(cardEl)) return;

    beginTrackingCard(cardEl, e.pointerId, e.clientX, e.clientY);
  }

  function handlePointerMove(e) {
    if (!tracked || e.pointerId !== tracked.pointerId) return;
    if (!isJiggleMode()) {
      cancelDrag();
      return;
    }

    const dx = e.clientX - tracked.startX;
    const dy = e.clientY - tracked.startY;
    const dist = Math.hypot(dx, dy);

    if (!tracked.isDragging) {
      if (dist < DRAG_THRESHOLD_PX) return;
      if (e.cancelable) {
        e.preventDefault();
      }
      activateActiveDragSession(e.pointerId, e.clientX, e.clientY);
    }

    if (e.cancelable) {
      e.preventDefault();
    }

    tracked.lastX = e.clientX;
    tracked.lastY = e.clientY;
    moveFloatingCard(e.clientX, e.clientY);

    // If dragging an item inside the open folder modal and the pointer moves outside the modal card's bounding box,
    // immediately transition the drag out of the folder modal onto the desktop grid!
    if (tracked.previewFolderId && typeof document !== 'undefined') {
      const folderCard = document.querySelector('#folderDetailModal:not([hidden]) .folder-detail-modal-card');
      if (folderCard && typeof folderCard.getBoundingClientRect === 'function') {
        const rect = folderCard.getBoundingClientRect();
        const margin = 18;
        const isOutsideModalCard =
          e.clientX < rect.left - margin ||
          e.clientX > rect.right + margin ||
          e.clientY < rect.top - margin ||
          e.clientY > rect.bottom + margin;
        if (isOutsideModalCard) {
          transitionFromFolderModalToDesktopGrid(e.clientX, e.clientY);
        }
      }
    }

    const hitInfo = inspectPointTarget(e.clientX, e.clientY);
    updateHoverTarget(hitInfo, e.clientX, e.clientY);
    updateEdgeViewHover(e.clientX);
    updateEdgeAutoScroll(e.clientY);
  }

  function commitPlaceholderPosition(dragSnapshot, commitTarget, switchToPage = false) {
    const toPageId = commitTarget.toPageId || dragSnapshot.fromPageId;
    const targetViewId = commitTarget.targetViewId || null;
    const targetFolderId = commitTarget.targetFolderId || null;
    const beforeKind = commitTarget.beforeKind || null;
    const beforeId = commitTarget.beforeId || null;

    if (dragSnapshot.fromFolderId) {
      if (targetFolderId && targetFolderId === dragSnapshot.fromFolderId) {
        onCommitFolderReorder?.({
          folderId: dragSnapshot.fromFolderId,
          siteId: dragSnapshot.id,
          beforeSiteId: beforeId,
        });
        return;
      }
      onCommitFolderExtractToDesktop?.({
        fromFolderId: dragSnapshot.fromFolderId,
        fromPageId: dragSnapshot.fromPageId,
        toPageId,
        targetViewId,
        siteId: dragSnapshot.id,
        beforeKind,
        beforeId,
        switchToPage,
      });
      return;
    }

    if (typeof onCommitPlacement === 'function') {
      onCommitPlacement({
        fromPageId: dragSnapshot.fromPageId,
        toPageId,
        targetViewId,
        kind: dragSnapshot.kind,
        id: dragSnapshot.id,
        beforeKind,
        beforeId,
        switchToPage,
      });
      return;
    }

    if (dragSnapshot.fromPageId !== toPageId) {
      onDropToPage?.({
        fromPageId: dragSnapshot.fromPageId,
        toPageId,
        targetViewId,
        kind: dragSnapshot.kind,
        id: dragSnapshot.id,
        beforeTarget: beforeKind && beforeId ? { kind: beforeKind, id: beforeId } : null,
        switchToPage,
      });
      return;
    }

    if (beforeKind && beforeId) {
      onDropOnCard?.({
        fromPageId: dragSnapshot.fromPageId,
        toPageId,
        targetViewId,
        draggedKind: dragSnapshot.kind,
        draggedId: dragSnapshot.id,
        targetKind: beforeKind,
        targetId: beforeId,
        beforeKind,
        beforeId,
      });
      return;
    }

    const placements = getPagePlacementsForPage?.(toPageId) || [];
    const lastPlacement = placements[placements.length - 1];
    if (
      lastPlacement &&
      !(lastPlacement.kind === dragSnapshot.kind && lastPlacement.id === dragSnapshot.id)
    ) {
      onDropOnCard?.({
        fromPageId: toPageId,
        toPageId,
        targetViewId,
        draggedKind: dragSnapshot.kind,
        draggedId: dragSnapshot.id,
        targetKind: lastPlacement.kind,
        targetId: lastPlacement.id,
        beforeKind: null,
        beforeId: null,
      });
    }
  }

  function handlePointerUp(e) {
    if (!tracked || e.pointerId !== tracked.pointerId) return;

    if (!tracked.isDragging) {
      cleanup({ wasDragging: false, restoreOrigin: true });
      return;
    }

    if (e.cancelable) {
      e.preventDefault();
    }

    const clientX = Number.isFinite(e.clientX) ? e.clientX : tracked.lastX;
    const clientY = Number.isFinite(e.clientY) ? e.clientY : tracked.lastY;
    const movedSinceStart =
      Math.hypot(clientX - tracked.startX, clientY - tracked.startY) >= DRAG_THRESHOLD_PX;

    if (
      !movedSinceStart &&
      tracked.previewViewId === tracked.fromViewId &&
      tracked.previewFolderId === tracked.fromFolderId &&
      !folderMergeReadyTarget
    ) {
      cleanup({ wasDragging: true, restoreOrigin: true });
      return;
    }

    const dragSnapshot = {
      kind: tracked.kind,
      id: tracked.id,
      fromPageId: tracked.fromPageId,
      fromViewId: tracked.fromViewId,
      fromFolderId: tracked.fromFolderId,
    };

    const finalTarget = inspectPointTarget(clientX, clientY);

    // 1. Precedence: >600ms folder center dwell merge if ready and pointer is still in that target card's center zone
    if (
      folderMergeReadyTarget &&
      finalTarget?.type === 'card' &&
      finalTarget.kind === folderMergeReadyTarget.targetKind &&
      finalTarget.id === folderMergeReadyTarget.targetId &&
      isPointInFolderMergeCenterZone(finalTarget.element, clientX, clientY) &&
      typeof onCommitFolderMerge === 'function'
    ) {
      const mergePayload = {
        fromPageId: dragSnapshot.fromPageId,
        fromFolderId: dragSnapshot.fromFolderId || null,
        toPageId: folderMergeReadyTarget.pageId || dragSnapshot.fromPageId,
        targetViewId: folderMergeReadyTarget.viewId || null,
        draggedSiteId: dragSnapshot.id,
        targetKind: folderMergeReadyTarget.targetKind,
        targetId: folderMergeReadyTarget.targetId,
      };
      cleanup({ wasDragging: true, restoreOrigin: true });
      onCommitFolderMerge(mergePayload);
      return;
    }

    // 2. Dropped outside desktop / tabs: cancel cleanly and restore preview
    if (!finalTarget) {
      cleanup({ wasDragging: true, restoreOrigin: true });
      return;
    }

    // 3. Dropped directly onto a navigation page tab / pagination dot: preserve existing drop-to-page behavior
    if (finalTarget.type === 'tab' && finalTarget.pageId) {
      cleanup({ wasDragging: true, restoreOrigin: true });
      if (dragSnapshot.fromFolderId && typeof onCommitFolderExtractToDesktop === 'function') {
        onCommitFolderExtractToDesktop({
          fromFolderId: dragSnapshot.fromFolderId,
          fromPageId: dragSnapshot.fromPageId,
          toPageId: finalTarget.pageId,
          targetViewId: finalTarget.viewId || null,
          siteId: dragSnapshot.id,
          beforeKind: null,
          beforeId: null,
          switchToPage: true,
        });
      } else if (typeof onCommitPlacement === 'function') {
        onCommitPlacement({
          fromPageId: dragSnapshot.fromPageId,
          toPageId: finalTarget.pageId,
          targetViewId: finalTarget.viewId || null,
          kind: dragSnapshot.kind,
          id: dragSnapshot.id,
          beforeKind: null,
          beforeId: null,
          switchToPage: true,
        });
      } else {
        onDropToPage?.({
          fromPageId: dragSnapshot.fromPageId,
          toPageId: finalTarget.pageId,
          targetViewId: finalTarget.viewId || null,
          kind: dragSnapshot.kind,
          id: dragSnapshot.id,
          switchToPage: true,
        });
      }
      return;
    }

    if (
      finalTarget.type === 'card' ||
      finalTarget.type === 'grid' ||
      finalTarget.type === 'placeholder'
    ) {
      updateHoverTarget(finalTarget, clientX, clientY);
    }

    // 4. Precise desktop grid cell drop (site/widget on navigation page primary view subViewIndex === 0)
    const targetGridEl =
      finalTarget.gridEl ||
      (finalTarget.element?.classList?.contains?.('apps-grid') ? finalTarget.element : null) ||
      tracked.previewGridEl;

    if (
      targetGridEl &&
      isCellDropEnabledForGrid(targetGridEl, finalTarget.pageId, finalTarget.viewId)
    ) {
      applyCellDropPreviewOnGrid(targetGridEl, clientX, clientY);
      const preview = tracked.cellPreviewState;

      // Never fall back to ordinary sort on a failed precise cell drop!
      if (!preview || !preview.valid || !preview.plan || !preview.cell) {
        cleanup({ wasDragging: true, restoreOrigin: true });
        return;
      }

      const commitCellPayload = {
        fromPageId: dragSnapshot.fromPageId,
        fromFolderId: dragSnapshot.fromFolderId || null,
        toPageId: preview.pageId || dragSnapshot.fromPageId,
        targetViewId: preview.viewId || null,
        kind: dragSnapshot.kind,
        id: dragSnapshot.id,
        cell: { row: preview.cell.row, column: preview.cell.column },
      };

      // Re-plan & apply in app callback before final cleanup if needed; restore cleanly first if commit returns false
      cleanup({
        wasDragging: true,
        restoreOrigin: true,
        keepDisplacedStyles: false,
      });
      onCommitCellDrop(commitCellPayload);
      return;
    }

    // 5. Ordinary reorder / move (folders, folder modal grid, or comfort mode sub-views > 0)
    const commitTarget = readPlaceholderCommitTarget();
    cleanup({ wasDragging: true, restoreOrigin: false });

    if (commitTarget) {
      commitPlaceholderPosition(dragSnapshot, commitTarget, false);
    }
  }

  function handlePointerCancel(e) {
    if (!tracked || e.pointerId !== tracked.pointerId) return;
    cancelDrag();
  }

  function handleNativeDragStartCapture(e) {
    if (tracked && tracked.pointerId !== null) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function handleClickCapture(e) {
    if (suppressClickUntil > 0 && performance.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    } else if (suppressClickUntil > 0) {
      suppressClickUntil = 0;
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape' && tracked) {
      cancelDrag();
    }
  }

  trackEl.addEventListener('pointerdown', handlePointerDown);
  document.addEventListener('dragstart', handleNativeDragStartCapture, true);
  document.addEventListener('click', handleClickCapture, true);
  document.addEventListener('pointerdown', handlePointerDown);
  document.addEventListener('pointermove', handlePointerMove, { passive: false });
  document.addEventListener('pointerup', handlePointerUp, { passive: false });
  document.addEventListener('pointercancel', handlePointerCancel);
  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('blur', cancelDrag);
  window.addEventListener('pagehide', cancelDrag);
  window.addEventListener('resize', cancelDrag);

  return {
    cancelDrag,
    startFromLongPress,
    armFromLongPress: startFromLongPress,
    isDragging: () => Boolean(tracked?.isDragging),
    destroy() {
      cancelDrag();
      trackEl.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('dragstart', handleNativeDragStartCapture, true);
      document.removeEventListener('click', handleClickCapture, true);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('pagehide', cancelDrag);
      window.removeEventListener('resize', cancelDrag);
    },
  };
}
