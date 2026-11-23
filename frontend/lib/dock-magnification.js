const MAX_GROWTH = 0.42;
const MAX_LIFT = 7;
const STRIP_OVERHANG = 12;
const RESPONSE_MS = 45;
const REST = { x: 0, y: 0, scale: 1 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createDockMagnification(dock) {
  const events = new AbortController();
  const { signal } = events;
  const view = dock.ownerDocument.defaultView;
  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)');
  const strip = dock.querySelector('.dock-sites-strip');
  const actions = dock.querySelector('.dock-fixed-actions');
  const layer = dock.ownerDocument.createElement('div');
  layer.className = 'dock-magnification';
  layer.setAttribute('aria-hidden', 'true');
  dock.appendChild(layer);

  const mirrors = new Map();
  let pendingPointer = null;
  let pointerChanged = false;
  let geometry = null;
  let frame = null;
  let previousTime = null;

  function removeMirror(item, mirror) {
    mirror.image.remove();
    item.classList.remove('is-dock-mirrored');
    mirrors.delete(item);
  }

  function reset() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
    pendingPointer = null;
    pointerChanged = false;
    geometry = null;
    for (const [item, mirror] of mirrors) removeMirror(item, mirror);
  }

  function measure(group) {
    const clip = group.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    const origin = layer.getBoundingClientRect();
    const left = group === strip ? Math.max(dockRect.left, clip.left - STRIP_OVERHANG) : dockRect.left;
    const right = group === strip ? Math.min(dockRect.right, clip.right + STRIP_OVERHANG) : dockRect.right;
    const gap = Number.parseFloat(view.getComputedStyle(group).columnGap) || 0;
    const items = [];

    for (const item of group.children) {
      const surface = item.querySelector('.app-squircle');
      if (!surface) continue;
      const rect = surface.getBoundingClientRect();
      if (rect.left >= clip.right) break;
      if (!rect.width || rect.right <= clip.left || rect.left < left - 0.5 || rect.right > right + 0.5) continue;
      items.push({ item, surface, rect, center: rect.left + rect.width / 2 });
    }

    return { group, left, right, origin, gap, items };
  }

  function mirrorFor(entry, origin) {
    const { item, surface, rect } = entry;
    let mirror = mirrors.get(item);
    if (mirror) return mirror;
    const image = surface.cloneNode(true);
    image.classList.add('dock-magnified-icon');
    image.style.left = rect.left - origin.left + 'px';
    image.style.top = rect.top - origin.top + 'px';
    image.style.width = rect.width + 'px';
    image.style.height = rect.height + 'px';
    image.style.borderRadius = view.getComputedStyle(surface).borderRadius;
    layer.appendChild(image);
    item.classList.add('is-dock-mirrored');
    mirror = { image, current: { ...REST }, target: REST };
    mirrors.set(item, mirror);
    return mirror;
  }

  function moveTargets(pointer) {
    for (const mirror of mirrors.values()) mirror.target = REST;
    if (!pointer) return;

    if (geometry?.group !== pointer.group) geometry = measure(pointer.group);
    const { items, left, right, origin, gap } = geometry;
    const targets = [];
    let expansionBeforePointer = 0;
    let expansion = 0;

    for (const entry of items) {
      const { rect, center } = entry;
      const distance = Math.abs(center - pointer.x) / ((rect.width + gap) * 1.6);
      const weight = Math.max(0, 1 - distance * distance) ** 2;
      if (weight < 0.004) continue;
      const growth = Math.min(MAX_GROWTH * weight, (right - left) / rect.width - 1);
      if (growth <= 0) continue;
      const extra = rect.width * growth;
      expansionBeforePointer += extra * clamp((pointer.x - rect.left) / rect.width, 0, 1);
      targets.push({ entry, scale: 1 + growth, y: -MAX_LIFT * weight, offset: expansion + extra / 2 });
      expansion += extra;
    }

    if (!targets.length) return;
    // Spread the icons around the cursor, then keep the enlarged group in the Dock.
    const first = targets[0];
    const last = targets[targets.length - 1];
    const minOffset = left - first.entry.center - first.offset + first.entry.rect.width * first.scale / 2;
    const maxOffset = right - last.entry.center - last.offset - last.entry.rect.width * last.scale / 2;
    const offset = minOffset <= maxOffset
      ? clamp(-expansionBeforePointer, minOffset, maxOffset)
      : -expansionBeforePointer;

    for (const { entry, scale, y, offset: spread } of targets) {
      const half = entry.rect.width * scale / 2;
      const center = clamp(entry.center + spread + offset, left + half, right - half);
      mirrorFor(entry, origin).target = { x: center - entry.center, y, scale };
    }
  }

  function schedule() {
    if (frame === null) frame = view.requestAnimationFrame(animate);
  }

  function animate(time) {
    frame = null;
    if (pointerChanged) {
      pointerChanged = false;
      moveTargets(pendingPointer);
    }

    const elapsed = previousTime === null ? 16 : Math.min(48, time - previousTime);
    const blend = 1 - Math.exp(-elapsed / RESPONSE_MS);
    let moving = false;
    for (const [item, mirror] of mirrors) {
      const { current, target, image } = mirror;
      const done = Math.abs(target.x - current.x) < 0.04 &&
        Math.abs(target.y - current.y) < 0.04 &&
        Math.abs(target.scale - current.scale) < 0.001;
      if (done && target === REST) {
        removeMirror(item, mirror);
        continue;
      }
      current.x = done ? target.x : current.x + (target.x - current.x) * blend;
      current.y = done ? target.y : current.y + (target.y - current.y) * blend;
      current.scale = done ? target.scale : current.scale + (target.scale - current.scale) * blend;
      image.style.transform = `translate(${current.x}px, ${current.y}px) scale(${current.scale})`;
      moving ||= !done;
    }

    previousTime = moving ? time : null;
    if (moving) schedule();
  }

  function relax() {
    pendingPointer = null;
    pointerChanged = true;
    schedule();
  }

  function update(event) {
    if (event.pointerType !== 'mouse' || event.buttons || reducedMotion.matches ||
        dock.classList.contains('is-dock-dragging')) {
      relax();
      return;
    }
    const group = strip?.contains(event.target) ? strip : actions?.contains(event.target) ? actions : null;
    pendingPointer = group ? { group, x: event.clientX } : null;
    pointerChanged = true;
    schedule();
  }

  dock.addEventListener('pointermove', update, { signal });
  dock.addEventListener('pointerup', update, { signal });
  dock.addEventListener('pointerleave', relax, { signal });
  dock.addEventListener('pointerdown', relax, { capture: true, signal });
  dock.addEventListener('pointercancel', reset, { signal });
  strip?.addEventListener('scroll', reset, { passive: true, signal });
  view.addEventListener('resize', reset, { passive: true, signal });
  view.addEventListener('blur', reset, { signal });
  reducedMotion.addEventListener('change', reset, { signal });

  return () => {
    events.abort();
    reset();
    layer.remove();
  };
}
