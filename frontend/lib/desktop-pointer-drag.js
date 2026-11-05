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

export function createDesktopPointerDragController({
  trackEl,
  isJiggleMode,
  getCurrentPageId,
  getCurrentViewId,
  getPagePlacementsForPage,
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
        .querySelectorAll('.drag-over-card, .drag-target-active, .pointer-dragging')
        .forEach((node) => {
          node.classList.remove('drag-over-card', 'drag-target-active', 'pointer-dragging');
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
      originalStyleAttr,
      fromPageId,
      fromViewId,
      previewGridEl,
    } = tracked;

    cardEl.classList.remove('dragging', 'pointer-dragging', 'desktop-floating-card');
    if (originalStyleAttr === null || originalStyleAttr === undefined || originalStyleAttr === '') {
      cardEl.removeAttribute('style');
    } else {
      cardEl.setAttribute('style', originalStyleAttr);
    }
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

  function dockFloatingCardIntoPlaceholder() {
    if (!tracked || !tracked.cardEl) return;
    const {
      cardEl,
      originalStyleAttr,
      previewPageId,
      previewViewId,
      fromPageId,
      originalParent,
    } = tracked;

    cardEl.classList.remove('dragging', 'pointer-dragging', 'desktop-floating-card');
    if (originalStyleAttr === null || originalStyleAttr === undefined || originalStyleAttr === '') {
      cardEl.removeAttribute('style');
    } else {
      cardEl.setAttribute('style', originalStyleAttr);
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

  function cleanup({ wasDragging = false, restoreOrigin = true } = {}) {
    clearTabHoverTimer();
    clearEdgeViewTimer();
    clearFolderMergePreview();
    stopAutoScroll();
    clearAllFlipAnimations();
    releaseCapture();
    if (tracked?.isDragging) {
      if (restoreOrigin) {
        removePlaceholder();
        restoreFloatingCardToOrigin();
      } else {
        dockFloatingCardIntoPlaceholder();
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
    const ph = el('div', {
      className: `desktop-drag-placeholder ${
        isWidget ? 'ios-widget-placeholder' : 'app-item-placeholder'
      }`,
      'aria-hidden': 'true',
      dataset: {
        placeholderKind: kind,
      },
    });
    if (rect && rect.height > 0) {
      ph.style.minHeight = `${Math.round(rect.height)}px`;
      ph.style.height = `${Math.round(rect.height)}px`;
    }
    if (!isWidget && rect && rect.width > 0) {
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
    tracked.grabOffsetX = Math.min(Math.max(anchorX - rect.left, 10), Math.max(10, width - 10));
    tracked.grabOffsetY = Math.min(Math.max(anchorY - rect.top, 10), Math.max(10, height - 10));

    placeholderEl = createPlaceholderForCard(cardEl, kind, { width, height });
    if (cardEl.parentNode) {
      cardEl.parentNode.insertBefore(placeholderEl, cardEl);
    }

    cardEl.classList.add('dragging', 'pointer-dragging', 'desktop-floating-card');
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

  function getGridCardsExcludingDragged(gridEl) {
    if (!gridEl) return [];
    return Array.from(
      gridEl.querySelectorAll('[data-placement-kind][data-placement-id]')
    ).filter((node) => node !== tracked?.cardEl);
  }

  function captureGridCardRects(gridEl) {
    const map = new Map();
    if (!gridEl) return map;
    const cards = getGridCardsExcludingDragged(gridEl);
    for (const card of cards) {
      map.set(card, card.getBoundingClientRect());
    }
    return map;
  }

  function playFlipForGrid(gridEl, beforeRects) {
    if (!gridEl || !beforeRects || beforeRects.size === 0) return;
    const cards = getGridCardsExcludingDragged(gridEl);
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

  function movePlaceholderInGrid(targetGrid, beforeNode) {
    if (!placeholderEl || !targetGrid) return false;
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
      const switched = onSwitchAdjacentView(dir);
      if (switched) {
        const nextGrid = findGridElementForViewOrPage({
          viewId: getCurrentViewId?.(),
          pageId: getCurrentPageId(),
        });
        if (nextGrid) {
          movePlaceholderInGrid(nextGrid, null);
        }
        edgeViewDirection = dir;
        edgeViewTimer = setTimeout(triggerEdgeStep, EDGE_VIEW_SWITCH_MS + 180);
      }
    };

    edgeViewTimer = setTimeout(triggerEdgeStep, EDGE_VIEW_SWITCH_MS);
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
      const beforeNode = resolveInsertionNodeInGrid(desktopGrid, clientX, clientY);
      movePlaceholderInGrid(desktopGrid, beforeNode);
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
              onSwitchPageById?.(targetPageId, targetViewId);
              const nextGrid = findGridElementForViewOrPage({
                viewId: targetViewId || getCurrentViewId?.(),
                pageId: targetPageId,
              });
              if (nextGrid) {
                movePlaceholderInGrid(nextGrid, null);
              }
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
      if (hitInfo.gridEl) {
        hitInfo.gridEl.classList.add('drag-target-active');
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
        // Center zone hover: hold placeholder steady and start/maintain 600ms folder merge timer
        cardEl.classList.add('drag-over-card');
        armOrMaintainFolderMergeHover(hitInfo);
        return;
      }

      // Edge zone or non-mergeable card: immediately cancel folder merge preview and reorder normally
      clearFolderMergePreview();
      cardEl.classList.add('drag-over-card');

      if (gridEl && placeholderEl) {
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
        const beforeNode = resolveInsertionNodeInGrid(gridEl, clientX, clientY);
        movePlaceholderInGrid(gridEl, beforeNode);
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
    const originalStyleAttr = cardEl.getAttribute('style');

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
      originalStyleAttr,
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

    // Check if a 600ms folder merge preview was ready and pointer is still on that target card's center zone
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

    if (!finalTarget) {
      cleanup({ wasDragging: true, restoreOrigin: true });
      return;
    }

    if (finalTarget.type === 'card' || finalTarget.type === 'grid') {
      updateHoverTarget(finalTarget, clientX, clientY);
    }

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
