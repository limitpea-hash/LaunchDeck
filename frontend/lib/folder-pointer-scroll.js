// ==========================================================================
// Folder Detail Touch/Pen Scroll Controller
// ==========================================================================
// Because folder member cards (.folder-detail-grid .app-item) use
// `touch-action: pinch-zoom` before pointerdown so that 550ms long-press
// same-finger drag is never aborted by a browser pan-y lock, normal-mode
// single-finger vertical touch/pen drags starting on folder icons need
// bounded manual scrollTop updates on the scroll container.
// Mouse wheel / trackpad scrolling continues to use native overflow-y: auto.

const SCROLL_RECOGNITION_PX = 8;
const SUPPRESS_CLICK_MS = 380;

export function clampScrollTop(value, maxScrollTop) {
  const num = Number.isFinite(value) ? value : 0;
  const max = Number.isFinite(maxScrollTop) && maxScrollTop > 0 ? maxScrollTop : 0;
  return Math.min(max, Math.max(0, num));
}

export function getMaxScrollTop(scrollEl) {
  if (!scrollEl) return 0;
  const scrollHeight = Number(scrollEl.scrollHeight) || 0;
  const clientHeight = Number(scrollEl.clientHeight) || 0;
  return Math.max(0, scrollHeight - clientHeight);
}

export function createFolderScrollController({
  gridEl,
  scrollEl,
  isEditing = () => false,
  isDragging = () => false,
  isOpen = () => true,
  clearLongPress = () => {},
} = {}) {
  const surfaceEl = scrollEl || gridEl;
  if (!surfaceEl || typeof surfaceEl.addEventListener !== 'function') {
    return {
      cancelScroll() {},
      isScrolling: () => false,
      destroy() {},
    };
  }

  const activePointers = new Set();
  let trackedPointerId = null;
  let startX = 0;
  let startY = 0;
  let startScrollTop = 0;
  let isScrolling = false;
  let hasCapture = false;
  let suppressClickUntil = 0;

  function canHandlePointerType(pointerType) {
    return pointerType === 'touch' || pointerType === 'pen';
  }

  function releaseCaptureIfHeld(pointerId) {
    if (!hasCapture || pointerId === null) return;
    hasCapture = false;
    try {
      if (
        typeof surfaceEl.hasPointerCapture === 'function' &&
        surfaceEl.hasPointerCapture(pointerId)
      ) {
        surfaceEl.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore capture release errors
    }
  }

  function cancelScroll() {
    const prevPointerId = trackedPointerId;
    trackedPointerId = null;
    isScrolling = false;
    releaseCaptureIfHeld(prevPointerId);
  }

  function resetAll() {
    activePointers.clear();
    cancelScroll();
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

  function handlePointerDown(e) {
    if (!canHandlePointerType(e.pointerType)) return;
    if (!isOpen()) return;

    activePointers.add(e.pointerId);
    if (activePointers.size > 1) {
      // Multi-touch: cancel manual scroll and let browser handle pinch-zoom
      clearLongPress?.();
      cancelScroll();
      return;
    }

    if (isEditing() || isDragging()) {
      cancelScroll();
      return;
    }

    const target = e.target;
    if (
      target &&
      typeof target.closest === 'function' &&
      target.closest(
        'input, textarea, select, button, .delete-badge, .card-edit-actions, .card-edit-btn'
      )
    ) {
      return;
    }

    const targetScrollEl = scrollEl || gridEl;
    trackedPointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startScrollTop = Number(targetScrollEl?.scrollTop) || 0;
    isScrolling = false;
    hasCapture = false;
  }

  function handlePointerMove(e) {
    if (e.pointerId !== trackedPointerId) return;
    if (!isOpen() || isEditing() || isDragging() || activePointers.size > 1) {
      cancelScroll();
      return;
    }

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dist = Math.hypot(dx, dy);

    if (!isScrolling) {
      if (dist < SCROLL_RECOGNITION_PX) return;
      clearLongPress?.();
      if (Math.abs(dy) < Math.abs(dx)) {
        // Horizontal movement inside folder modal is not a vertical scroll
        cancelScroll();
        return;
      }
      isScrolling = true;
      try {
        surfaceEl.setPointerCapture?.(e.pointerId);
        hasCapture = true;
      } catch {
        hasCapture = false;
      }
    }

    if (e.cancelable) {
      e.preventDefault();
    }

    const targetScrollEl = scrollEl || gridEl;
    if (targetScrollEl) {
      const maxScroll = getMaxScrollTop(targetScrollEl);
      const nextScrollTop = clampScrollTop(startScrollTop - dy, maxScroll);
      targetScrollEl.scrollTop = nextScrollTop;
    }
  }

  function handlePointerUp(e) {
    activePointers.delete(e.pointerId);
    if (e.pointerId !== trackedPointerId) return;
    const wasScrolling = isScrolling;
    cancelScroll();
    if (wasScrolling) {
      if (e.cancelable) {
        e.preventDefault();
      }
      suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS;
    }
  }

  function handlePointerCancel(e) {
    activePointers.delete(e.pointerId);
    if (e.pointerId !== trackedPointerId) return;
    clearLongPress?.();
    cancelScroll();
  }

  function handleLostPointerCapture(e) {
    if (e.pointerId !== trackedPointerId) return;
    if (e.target && e.target !== surfaceEl) return;
    try {
      if (
        typeof surfaceEl.hasPointerCapture === 'function' &&
        surfaceEl.hasPointerCapture(e.pointerId)
      ) {
        return;
      }
    } catch {
      // Ignore
    }
    activePointers.delete(e.pointerId);
    cancelScroll();
  }

  surfaceEl.addEventListener('click', handleClickCapture, true);
  surfaceEl.addEventListener('pointerdown', handlePointerDown);
  surfaceEl.addEventListener('pointermove', handlePointerMove, { passive: false });
  surfaceEl.addEventListener('pointerup', handlePointerUp, { passive: false });
  surfaceEl.addEventListener('pointercancel', handlePointerCancel);
  surfaceEl.addEventListener('lostpointercapture', handleLostPointerCapture);

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('blur', resetAll);
    window.addEventListener('pagehide', resetAll);
  }

  return {
    cancelScroll: resetAll,
    isScrolling: () => isScrolling,
    destroy() {
      resetAll();
      surfaceEl.removeEventListener('click', handleClickCapture, true);
      surfaceEl.removeEventListener('pointerdown', handlePointerDown);
      surfaceEl.removeEventListener('pointermove', handlePointerMove);
      surfaceEl.removeEventListener('pointerup', handlePointerUp);
      surfaceEl.removeEventListener('pointercancel', handlePointerCancel);
      surfaceEl.removeEventListener('lostpointercapture', handleLostPointerCapture);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('blur', resetAll);
        window.removeEventListener('pagehide', resetAll);
      }
    },
  };
}
