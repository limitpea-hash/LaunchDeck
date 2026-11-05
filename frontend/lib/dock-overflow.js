// ==========================================================================
// Adaptive Dock Overflow Measurement & Horizontal Scroll/Drag Controller
// ==========================================================================
// Measures actual DOM scrollWidth vs clientWidth on the Dock sites strip.
// When all pinned sites fit, the strip stays naturally centered with no
// overflow state or scrollLeft offset. When scrollWidth > clientWidth,
// enables horizontal scrolling via touch/trackpad, mouse primary-button drag,
// and vertical/horizontal wheel translation, while keeping the right-hand
// fixed utility buttons always reachable.

const DOCK_DRAG_THRESHOLD_PX = 6;
const DOCK_SUPPRESS_CLICK_MS = 380;
const OVERFLOW_EPSILON_PX = 1;

export function clampDockScrollLeft(scrollLeft, maxScrollLeft) {
  const num = Number.isFinite(scrollLeft) ? scrollLeft : 0;
  const max = Number.isFinite(maxScrollLeft) && maxScrollLeft > 0 ? maxScrollLeft : 0;
  return Math.min(max, Math.max(0, Math.round(num)));
}

export function getDockOverflowState({
  scrollWidth = 0,
  clientWidth = 0,
  scrollLeft = 0,
} = {}) {
  const safeScrollWidth = Math.max(0, Math.round(Number(scrollWidth) || 0));
  const safeClientWidth = Math.max(0, Math.round(Number(clientWidth) || 0));
  const maxScrollLeft = Math.max(0, safeScrollWidth - safeClientWidth);
  const isOverflowing = maxScrollLeft > OVERFLOW_EPSILON_PX;
  const clampedScrollLeft = isOverflowing
    ? clampDockScrollLeft(scrollLeft, maxScrollLeft)
    : 0;
  const canScrollLeft = isOverflowing && clampedScrollLeft > OVERFLOW_EPSILON_PX;
  const canScrollRight =
    isOverflowing && clampedScrollLeft < maxScrollLeft - OVERFLOW_EPSILON_PX;

  return {
    scrollWidth: safeScrollWidth,
    clientWidth: safeClientWidth,
    maxScrollLeft,
    scrollLeft: clampedScrollLeft,
    isOverflowing,
    canScrollLeft,
    canScrollRight,
  };
}

export function createDockOverflowController({
  dockEl,
  scrollEl,
  initialScrollLeft = 0,
  onStateChange = null,
} = {}) {
  const targetScrollEl = scrollEl || dockEl;
  const hostDockEl = dockEl || targetScrollEl;

  if (!targetScrollEl || typeof targetScrollEl.addEventListener !== 'function') {
    return {
      refresh: () => getDockOverflowState(),
      getState: () => getDockOverflowState(),
      cancelDrag() {},
      destroy() {},
    };
  }

  let currentState = getDockOverflowState();
  const activePointers = new Set();
  let trackedPointerId = null;
  let startX = 0;
  let startScrollLeft = 0;
  let isDragging = false;
  let hasCapture = false;
  let suppressClickUntil = 0;
  let resizeObserver = null;
  let cancelFocusFrame = null;

  function applyStateToDOM(stateSnapshot) {
    currentState = stateSnapshot;
    if (hostDockEl && hostDockEl.classList) {
      hostDockEl.classList.toggle('is-overflowing', stateSnapshot.isOverflowing);
      hostDockEl.classList.toggle('can-scroll-left', stateSnapshot.canScrollLeft);
      hostDockEl.classList.toggle('can-scroll-right', stateSnapshot.canScrollRight);
      hostDockEl.dataset.dockOverflow = stateSnapshot.isOverflowing ? 'true' : 'false';
    }
    if (targetScrollEl && targetScrollEl !== hostDockEl && targetScrollEl.classList) {
      targetScrollEl.classList.toggle('is-overflowing', stateSnapshot.isOverflowing);
      targetScrollEl.classList.toggle('can-scroll-left', stateSnapshot.canScrollLeft);
      targetScrollEl.classList.toggle('can-scroll-right', stateSnapshot.canScrollRight);
      targetScrollEl.dataset.dockOverflow = stateSnapshot.isOverflowing ? 'true' : 'false';
    }
    onStateChange?.(stateSnapshot);
  }

  function refresh({ desiredScrollLeft = undefined } = {}) {
    const rawScrollLeft =
      desiredScrollLeft !== undefined
        ? Number(desiredScrollLeft) || 0
        : Number(targetScrollEl.scrollLeft) || 0;
    const nextState = getDockOverflowState({
      scrollWidth: targetScrollEl.scrollWidth,
      clientWidth: targetScrollEl.clientWidth,
      scrollLeft: rawScrollLeft,
    });

    if (Math.abs((Number(targetScrollEl.scrollLeft) || 0) - nextState.scrollLeft) >= 1) {
      targetScrollEl.scrollLeft = nextState.scrollLeft;
    }

    applyStateToDOM(nextState);
    return nextState;
  }

  function releaseCaptureIfHeld(pointerId) {
    if (!hasCapture || pointerId === null) return;
    hasCapture = false;
    try {
      if (
        typeof targetScrollEl.hasPointerCapture === 'function' &&
        targetScrollEl.hasPointerCapture(pointerId)
      ) {
        targetScrollEl.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore capture errors
    }
  }

  function cancelDrag() {
    const prevPointerId = trackedPointerId;
    trackedPointerId = null;
    isDragging = false;
    if (hostDockEl?.classList) {
      hostDockEl.classList.remove('is-dock-dragging');
    }
    if (targetScrollEl?.classList) {
      targetScrollEl.classList.remove('is-dock-dragging');
    }
    releaseCaptureIfHeld(prevPointerId);
  }

  function resetPointers() {
    activePointers.clear();
    cancelDrag();
  }

  function handleScroll() {
    const nextState = getDockOverflowState({
      scrollWidth: targetScrollEl.scrollWidth,
      clientWidth: targetScrollEl.clientWidth,
      scrollLeft: targetScrollEl.scrollLeft,
    });
    applyStateToDOM(nextState);
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

  function handleNativeDragStartCapture(e) {
    // Prevent native HTML5 link/image dragging inside the Dock from hijacking horizontal scroll/drag
    e.preventDefault();
    e.stopPropagation();
  }

  function handlePointerDown(e) {
    // Stop propagation only on the Dock strip so desktop stage/margin swipe handlers never hijack Dock interactions
    e.stopPropagation();

    activePointers.add(e.pointerId);
    if (activePointers.size > 1) {
      cancelDrag();
      return;
    }

    // Only mouse primary button uses custom pointer drag. Touch/pen are left entirely to the browser's
    // native overflow-x panning and pinch-zoom (touch-action: pan-x pinch-zoom): no tracking, no
    // preventDefault, no pointer capture, so native scrolling and taps/clicks are never contested.
    if (e.pointerType !== 'mouse' || e.button !== 0) {
      return;
    }

    const latest = refresh();
    if (!latest.isOverflowing) {
      cancelDrag();
      return;
    }

    trackedPointerId = e.pointerId;
    startX = e.clientX;
    startScrollLeft = Number(targetScrollEl.scrollLeft) || 0;
    isDragging = false;
    hasCapture = false;
  }

  function handlePointerMove(e) {
    if (e.pointerId !== trackedPointerId) return;
    if (activePointers.size > 1 || !currentState.isOverflowing) {
      cancelDrag();
      return;
    }

    const dx = e.clientX - startX;
    if (!isDragging) {
      if (Math.abs(dx) < DOCK_DRAG_THRESHOLD_PX) return;
      isDragging = true;
      hostDockEl?.classList?.add('is-dock-dragging');
      targetScrollEl?.classList?.add('is-dock-dragging');
      try {
        targetScrollEl.setPointerCapture?.(e.pointerId);
        hasCapture = true;
      } catch {
        hasCapture = false;
      }
    }

    if (e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();

    const nextScrollLeft = clampDockScrollLeft(
      startScrollLeft - dx,
      currentState.maxScrollLeft
    );
    targetScrollEl.scrollLeft = nextScrollLeft;
    handleScroll();
  }

  function handlePointerUp(e) {
    activePointers.delete(e.pointerId);
    if (e.pointerId !== trackedPointerId) return;
    const wasDragging = isDragging;
    cancelDrag();
    if (wasDragging) {
      if (e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();
      suppressClickUntil = performance.now() + DOCK_SUPPRESS_CLICK_MS;
    }
    refresh();
  }

  function handlePointerCancel(e) {
    activePointers.delete(e.pointerId);
    if (e.pointerId !== trackedPointerId) return;
    cancelDrag();
    refresh();
  }

  function handleLostPointerCapture(e) {
    if (e.pointerId !== trackedPointerId) return;
    if (e.target && e.target !== targetScrollEl) return;
    try {
      if (
        typeof targetScrollEl.hasPointerCapture === 'function' &&
        targetScrollEl.hasPointerCapture(e.pointerId)
      ) {
        return;
      }
    } catch {
      // Ignore
    }
    activePointers.delete(e.pointerId);
    cancelDrag();
  }

  function handleWheel(e) {
    e.stopPropagation();
    const latest = refresh();
    if (!latest.isOverflowing) return;

    const delta =
      Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;

    const nextScrollLeft = clampDockScrollLeft(
      (Number(targetScrollEl.scrollLeft) || 0) + delta,
      latest.maxScrollLeft
    );
    if (nextScrollLeft !== (Number(targetScrollEl.scrollLeft) || 0)) {
      if (e.cancelable) {
        e.preventDefault();
      }
      targetScrollEl.scrollLeft = nextScrollLeft;
      handleScroll();
    }
  }

  // Writes scrollLeft on the strip only (never the document). Prefers an explicit instant scrollTo so a
  // CSS `scroll-behavior: smooth` animation cannot be interrupted/left short by the browser's own
  // focus-scroll; falls back to a direct scrollLeft assignment where scrollTo is unavailable or a no-op.
  function setStripScrollLeft(nextScrollLeft) {
    if (typeof targetScrollEl.scrollTo === 'function') {
      try {
        targetScrollEl.scrollTo({ left: nextScrollLeft, behavior: 'instant' });
      } catch {
        // Ignore and fall back below
      }
    }
    if (Math.abs((Number(targetScrollEl.scrollLeft) || 0) - nextScrollLeft) >= 1) {
      targetScrollEl.scrollLeft = nextScrollLeft;
    }
  }

  function scheduleFrame(cb) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const id = window.requestAnimationFrame(cb);
      return () => window.cancelAnimationFrame?.(id);
    }
    const id = setTimeout(cb, 16);
    return () => clearTimeout(id);
  }

  function cancelPendingFocusFrame() {
    if (cancelFocusFrame) {
      cancelFocusFrame();
      cancelFocusFrame = null;
    }
  }

  function handleFocusIn(e) {
    const itemEl = e.target?.closest?.('.dock-item');
    if (!itemEl || !targetScrollEl.contains(itemEl)) return;

    // Immediate pass, then one deferred correction frame: the browser's default focus scroll and any
    // viewport/layout reflow can run after focusin and overwrite the immediate scrollLeft (observed:
    // last item left 8px clipped). A newer focus cancels the older pending frame; destroy cancels it too.
    ensureItemVisible(itemEl);
    cancelPendingFocusFrame();
    cancelFocusFrame = scheduleFrame(() => {
      cancelFocusFrame = null;
      if (isDragging) return;
      if (itemEl.isConnected === false || !targetScrollEl.contains(itemEl)) return;
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      if (activeEl && !itemEl.contains(activeEl)) return;
      ensureItemVisible(itemEl);
    });
  }

  function ensureItemVisible(itemEl) {
    const latest = refresh();
    if (!latest.isOverflowing) return;

    if (
      typeof itemEl.getBoundingClientRect === 'function' &&
      typeof targetScrollEl.getBoundingClientRect === 'function'
    ) {
      const itemRect = itemEl.getBoundingClientRect();
      const stripRect = targetScrollEl.getBoundingClientRect();
      if (stripRect.width > 0 && itemRect.width > 0) {
        const margin = 8;
        let nextScrollLeft = Number(targetScrollEl.scrollLeft) || 0;
        if (itemRect.left < stripRect.left + margin) {
          nextScrollLeft -= stripRect.left + margin - itemRect.left;
        } else if (itemRect.right > stripRect.right - margin) {
          nextScrollLeft += itemRect.right - (stripRect.right - margin);
        } else {
          return;
        }
        setStripScrollLeft(clampDockScrollLeft(nextScrollLeft, latest.maxScrollLeft));
        handleScroll();
        return;
      }
    }

    if (Number.isFinite(itemEl.offsetLeft) && Number.isFinite(itemEl.offsetWidth)) {
      const itemStart = itemEl.offsetLeft;
      const itemEnd = itemStart + itemEl.offsetWidth;
      const viewStart = Number(targetScrollEl.scrollLeft) || 0;
      const viewEnd = viewStart + latest.clientWidth;
      let nextScrollLeft = viewStart;
      if (itemStart < viewStart) {
        nextScrollLeft = itemStart;
      } else if (itemEnd > viewEnd) {
        nextScrollLeft = itemEnd - latest.clientWidth;
      }
      setStripScrollLeft(clampDockScrollLeft(nextScrollLeft, latest.maxScrollLeft));
      handleScroll();
    }
  }

  function handleWindowResize() {
    refresh();
  }

  targetScrollEl.addEventListener('scroll', handleScroll, { passive: true });
  targetScrollEl.addEventListener('click', handleClickCapture, true);
  targetScrollEl.addEventListener('dragstart', handleNativeDragStartCapture, true);
  targetScrollEl.addEventListener('pointerdown', handlePointerDown);
  targetScrollEl.addEventListener('pointermove', handlePointerMove, { passive: false });
  targetScrollEl.addEventListener('pointerup', handlePointerUp, { passive: false });
  targetScrollEl.addEventListener('pointercancel', handlePointerCancel);
  targetScrollEl.addEventListener('lostpointercapture', handleLostPointerCapture);
  targetScrollEl.addEventListener('wheel', handleWheel, { passive: false });
  targetScrollEl.addEventListener('focusin', handleFocusIn);

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', handleWindowResize, { passive: true });
    window.addEventListener('orientationchange', handleWindowResize, { passive: true });
    window.addEventListener('blur', resetPointers);
    window.addEventListener('pagehide', resetPointers);
    if (typeof window.ResizeObserver === 'function') {
      resizeObserver = new window.ResizeObserver(() => {
        refresh();
      });
      resizeObserver.observe(targetScrollEl);
      if (hostDockEl && hostDockEl !== targetScrollEl) {
        resizeObserver.observe(hostDockEl);
      }
    }
  }

  // Initial measurement with preserved/clamped scrollLeft
  refresh({ desiredScrollLeft: initialScrollLeft });

  return {
    refresh,
    getState: () => currentState,
    cancelDrag: resetPointers,
    destroy() {
      cancelPendingFocusFrame();
      resetPointers();
      resizeObserver?.disconnect?.();
      resizeObserver = null;
      targetScrollEl.removeEventListener('scroll', handleScroll);
      targetScrollEl.removeEventListener('click', handleClickCapture, true);
      targetScrollEl.removeEventListener('dragstart', handleNativeDragStartCapture, true);
      targetScrollEl.removeEventListener('pointerdown', handlePointerDown);
      targetScrollEl.removeEventListener('pointermove', handlePointerMove);
      targetScrollEl.removeEventListener('pointerup', handlePointerUp);
      targetScrollEl.removeEventListener('pointercancel', handlePointerCancel);
      targetScrollEl.removeEventListener('lostpointercapture', handleLostPointerCapture);
      targetScrollEl.removeEventListener('wheel', handleWheel);
      targetScrollEl.removeEventListener('focusin', handleFocusIn);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', handleWindowResize);
        window.removeEventListener('orientationchange', handleWindowResize);
        window.removeEventListener('blur', resetPointers);
        window.removeEventListener('pagehide', resetPointers);
      }
    },
  };
}
