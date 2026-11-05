import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopPointerDragController } from '../frontend/lib/desktop-pointer-drag.js';

// Minimal DOM with real node identity, insertion and geometry changes for preview lifecycle checks.
class Element {
  constructor(kind = '') {
    this.kind = kind; this.dataset = {}; this.style = {}; this.children = [];
    this.listeners = new Map(); this.attrs = new Map(); this.classes = new Set();
    this.classList = {
      add: (...xs) => xs.forEach(x => this.classes.add(x)),
      remove: (...xs) => xs.forEach(x => this.classes.delete(x)),
      contains: x => this.classes.has(x),
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get parentNode() { return this.parent || null; }
  get parentElement() { return this.parent || null; }
  get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
  get nextElementSibling() { return this.nextSibling; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, event) { for (const fn of this.listeners.get(name) || []) fn(event); }
  insertBefore(node, before) {
    node.remove(); const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, node); node.parent = this;
  }
  appendChild(node) { this.insertBefore(node, null); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); if (key === 'style') this.style = {}; }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  removeAttribute(key) { this.attrs.delete(key); if (key === 'style') this.style = {}; }
  contains(node) { return this === node || this.children.some(child => child.contains?.(node)); }
  matches(selector) {
    return selector.split(',').some(part => {
      const classes = [...part.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
      const attrs = [...part.matchAll(/\[data-([a-z-]+)(?:="([^"]*)")?\]/g)];
      return classes.every(c => this.classes.has(c)) && attrs.every(([, raw, value]) => {
        const key = raw.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return key in this.dataset && (value === undefined || this.dataset[key] === value);
      }) && (classes.length > 0 || attrs.length > 0);
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches?.(selector) ? [child] : []), ...(child.querySelectorAll?.(selector) || [])]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() {
    const i = Math.max(0, this.parent?.children.indexOf(this) || 0);
    return { x: i * 100, y: 200, left: i * 100, top: 200, right: (i + 1) * 100, bottom: 300, width: 100, height: 100 };
  }
  animate() { this.animations = (this.animations || 0) + 1; return { cancel() { this.oncancel?.(); } }; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
}

function setup(t) {
  const keys = ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSS', 'performance', 'setTimeout', 'clearTimeout'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = new Element(); document.body = new Element(); document.documentElement = new Element();
  document.documentElement.scrollHeight = document.body.scrollHeight = 3000;
  const track = new Element(); const grid = new Element(); grid.className = 'apps-grid'; grid.dataset.pageId = 'all';
  const source = new Element('card'); source.dataset = { placementKind: 'widget', placementId: 'calendar', pageId: 'all' };
  source.className = 'ios-widget'; source.setAttribute('style', '--original: true');
  const target = new Element('card'); target.dataset = { placementKind: 'site', placementId: 'figma', pageId: 'all' };
  const tab = new Element('tab'); tab.className = 'category-pill'; tab.dataset.pageId = 'dev';
  document.body.appendChild(track); track.appendChild(grid); grid.appendChild(source); grid.appendChild(target); document.body.appendChild(tab);
  document.appendChild(document.body); document.hit = target;
  document.createElement = () => new Element(); document.createTextNode = text => ({ textContent: text });
  document.elementFromPoint = () => document.hit;
  const window = new Element(); window.innerHeight = 720; window.scrollY = 0; window.scrollX = 0;
  window.scrollTo = (x, y) => { window.scrollX = x; window.scrollY = y; };
  let time = 200, frameId = 0, timerId = 0;
  const timers = new Map();
  const frames = new Map();
  const overrides = { document, window, CSS: { escape: x => String(x) }, performance: { now: () => time },
    requestAnimationFrame: fn => { const id = ++frameId; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, {fn, delay}); return id; }, clearTimeout: id => timers.delete(id) };
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const drops = [], merges = []; let enabled = true;
  const controller = createDesktopPointerDragController({
    trackEl: track, isJiggleMode: () => enabled, getCurrentPageId: () => 'all', getPagePlacementsForPage: () => [],
    onCommitPlacement: value => {
      assert.equal(track.capture, null);
      assert.equal(document.querySelectorAll('.desktop-floating-card, .desktop-drag-placeholder').length, 0);
      drops.push(value);
    },
    onCommitFolderMerge: value => {
      assert.equal(document.querySelectorAll('.desktop-floating-card, .desktop-drag-placeholder').length, 0);
      merges.push(value);
    },
  });
  t.after(() => {
    controller.destroy();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const event = (targetNode = source, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, target: targetNode, clientX: 40, clientY: 240, cancelable: true,
    preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra });
  return { track, grid, source, target, tab, document, window, drops, merges, controller, event, frames, timers,
    disable: () => { enabled = false; }, enable: () => { enabled = true; }, advance: () => { time += 100; },
    frame: () => { const [id, fn] = frames.entries().next().value; frames.delete(id); time += 16; fn(time); },
    timer: delay => { const [id, timer] = [...timers].find(([, value]) => value.delay === delay); timers.delete(id); time += delay; timer.fn(); } };
}

function begin(s, extra = {}) {
  s.track.emit('pointerdown', s.event());
  s.document.emit('pointermove', s.event(s.source, { clientX: 190, clientY: 280, ...extra }));
}

test('pointer sorting ignores small movements and cancellation restores original identity, slot and styles without writes', t => {
  const s = setup(t);
  s.track.emit('pointerdown', s.event());
  s.document.emit('pointermove', s.event(s.source, { clientX: 43, clientY: 244 }));
  assert.equal(s.controller.isDragging(), false);
  s.document.emit('pointerup', s.event()); assert.equal(s.drops.length, 0);
  begin(s);
  assert.equal(s.controller.isDragging(), true);
  assert.equal(s.source.parentElement, s.document.body, 'the real card floats; it is not cloned');
  assert.equal(s.document.querySelectorAll('.desktop-drag-placeholder').length, 1);
  assert.equal(s.drops.length, 0, 'hover preview does not persist');
  s.document.emit('pointercancel', s.event());
  assert.deepEqual(s.grid.children, [s.source, s.target]);
  assert.equal(s.source.getAttribute('style'), '--original: true');
  assert.equal(s.document.querySelectorAll('.desktop-floating-card, .desktop-drag-placeholder').length, 0);
  assert.equal(s.drops.length, 0);
  s.disable(); begin(s); assert.equal(s.controller.isDragging(), false);
});

test('live placeholder makes neighboring cards move and final commit matches preview exactly once', t => {
  const s = setup(t); begin(s);
  assert.equal(s.grid.children[0], s.target);
  const placeholder = s.grid.children[1];
  assert.equal(placeholder.classList.contains('desktop-drag-placeholder'), true);
  assert.equal(placeholder.style.height, '100px');
  assert.ok(s.target.animations > 0, 'neighbor receives a movement animation');
  assert.equal(s.drops.length, 0);
  s.document.hit = placeholder;
  s.document.emit('pointerup', s.event(s.source, { clientX: 190, clientY: 280 }));
  assert.deepEqual(s.grid.children, [s.target, s.source]);
  assert.deepEqual(s.drops, [{ fromPageId: 'all', toPageId: 'all', targetViewId: null, kind: 'widget', id: 'calendar', beforeKind: null, beforeId: null, switchToPage: false }]);
  const click = s.event(); s.document.emit('click', click); assert.equal(click.prevented, true);
  s.controller.destroy();
  assert.equal([...s.document.listeners.values()].reduce((sum, x) => sum + x.size, 0), 0);
});

test('secondary pointers and invalid release cannot commit an old preview; tab drop remains atomic', t => {
  const s = setup(t); begin(s);
  s.track.emit('pointerdown', s.event(s.target, { pointerId: 2 }));
  s.document.hit = null; s.document.emit('pointerup', s.event());
  assert.equal(s.drops.length, 0); assert.equal(s.controller.isDragging(), false);
  assert.deepEqual(s.grid.children, [s.source, s.target]);
  s.document.hit = s.tab; begin(s);
  s.document.emit('pointerup', s.event(s.source, { clientX: 190, clientY: 280 }));
  assert.deepEqual(s.drops, [{ fromPageId: 'all', toPageId: 'dev', targetViewId: null, kind: 'widget', id: 'calendar', beforeKind: null, beforeId: null, switchToPage: true }]);
});

test('only active edge dragging scrolls, and Escape stops the frame loop without persisting', t => {
  const s = setup(t); begin(s, { clientY: 715 });
  assert.equal(s.window.scrollY, 0); assert.equal(s.frames.size, 1);
  s.frame(); assert.ok(s.window.scrollY > 0 && s.window.scrollY <= 14);
  s.document.emit('keydown', { key: 'Escape' });
  assert.equal(s.frames.size, 0); assert.equal(s.drops.length, 0);
  assert.deepEqual(s.grid.children, [s.source, s.target]);
});

test('long press transfers the same touch pointer into a real-card drag without a second pointerdown', t => {
  const s = setup(t);
  s.disable();
  s.track.emit('pointerdown', s.event(s.source, { pointerId: 17, pointerType: 'touch' }));
  s.source.setPointerCapture(17); // Browser's implicit capture on the touched card.
  s.enable();
  assert.equal(s.controller.startFromLongPress({ cardEl: s.source, pointerId: 17,
    startX: 40, startY: 240, clientX: 40, clientY: 240 }), true);
  assert.equal(s.source.capture, null);
  assert.equal(s.track.capture, 17);
  assert.equal(s.controller.isDragging(), true);
  assert.equal(s.source.parentElement, s.document.body);
  s.document.emit('pointermove', s.event(s.source, { pointerId: 17, pointerType: 'touch', clientX: 190, clientY: 280 }));
  assert.equal(s.drops.length, 0);
  s.document.hit = s.document.querySelector('.desktop-drag-placeholder');
  s.document.emit('pointerup', s.event(s.source, { pointerId: 17, pointerType: 'touch', clientX: 190, clientY: 280 }));
  assert.equal(s.drops.length, 1);
  assert.equal(s.drops[0].id, 'calendar');
  assert.deepEqual(s.grid.children, [s.target, s.source]);
});

test('lifting by long press and releasing in place preserves the original slot with zero writes', t => {
  const s = setup(t);
  s.controller.startFromLongPress({ cardEl: s.source, pointerId: 9, startX: 40, startY: 240 });
  s.document.emit('pointerup', s.event(s.source, { pointerId: 9, pointerType: 'touch' }));
  assert.equal(s.drops.length, 0);
  assert.deepEqual(s.grid.children, [s.source, s.target]);
  assert.equal(s.document.querySelectorAll('.desktop-floating-card, .desktop-drag-placeholder').length, 0);
});

test('touch cancellation after long press restores the instance and ignores a stale later release', t => {
  const s = setup(t);
  s.controller.startFromLongPress({ cardEl: s.source, pointerId: 9, startX: 40, startY: 240 });
  s.document.emit('pointermove', s.event(s.source, { pointerId: 9, pointerType: 'touch', clientX: 190, clientY: 280 }));
  s.document.emit('pointercancel', s.event(s.source, { pointerId: 9, pointerType: 'touch' }));
  s.document.emit('pointerup', s.event(s.source, { pointerId: 9, pointerType: 'touch', clientX: 190, clientY: 280 }));
  assert.deepEqual(s.grid.children, [s.source, s.target]);
  assert.equal(s.drops.length, 0);
  assert.equal(s.track.capture, null);
});

function beginSiteCenterHover(s) {
  s.source.dataset.placementKind = 'site'; s.source.dataset.placementId = 'chatgpt';
  s.source.className = 'app-item';
  s.track.emit('pointerdown', s.event());
  s.document.emit('pointermove', s.event(s.source, { clientX: 150, clientY: 250 }));
}

test('site center hover creates only a preview until 600ms has elapsed and release commits one merge', t => {
  const s = setup(t); beginSiteCenterHover(s);
  assert.equal(s.target.classList.contains('folder-merge-candidate'), true);
  assert.equal(s.merges.length, 0); assert.equal(s.drops.length, 0);
  s.timer(600);
  assert.equal(s.target.classList.contains('folder-merge-ready'), true);
  assert.equal(s.merges.length, 0);
  s.document.emit('pointerup', s.event(s.source, { clientX: 150, clientY: 250 }));
  assert.equal(s.merges.length, 1); assert.equal(s.drops.length, 0);
  assert.equal(s.merges[0].draggedSiteId, 'chatgpt'); assert.equal(s.merges[0].targetId, 'figma');
  assert.equal(s.target.classList.contains('folder-merge-ready'), false);
});

test('leaving the center or cancelling clears merge timers and never creates a folder', t => {
  const s = setup(t); beginSiteCenterHover(s);
  s.document.emit('pointermove', s.event(s.source, { clientX: 190, clientY: 280 }));
  assert.equal([...s.timers.values()].some(value => value.delay === 600), false);
  assert.equal(s.target.classList.contains('folder-merge-candidate'), false);
  s.document.emit('pointercancel', s.event());
  assert.equal(s.merges.length, 0); assert.equal(s.drops.length, 0);
  assert.equal(s.timers.size, 0);
});

test('widgets and folders cannot create nested folders by hovering a site center', t => {
  const s = setup(t);
  for (const kind of ['widget', 'folder']) {
    s.source.dataset.placementKind = kind;
    s.track.emit('pointerdown', s.event());
    s.document.emit('pointermove', s.event(s.source, { clientX: 150, clientY: 250 }));
    assert.equal([...s.timers.values()].some(value => value.delay === 600), false);
    s.document.emit('pointercancel', s.event());
  }
  assert.equal(s.merges.length, 0);
});

test('hovering an existing folder center adds a site through the merge callback', t => {
  const s = setup(t);
  s.target.dataset.placementKind = 'folder'; s.target.dataset.placementId = 'folder_tools';
  beginSiteCenterHover(s); s.timer(600);
  s.document.emit('pointerup', s.event(s.source, { clientX: 150, clientY: 250 }));
  assert.equal(s.merges.length, 1);
  assert.equal(s.merges[0].targetKind, 'folder'); assert.equal(s.merges[0].targetId, 'folder_tools');
});

test('desktop folder tile metadata does not make it a member of its own folder', t => {
  const s = setup(t);
  s.source.dataset.placementKind = 'folder'; s.source.dataset.placementId = 'folder_tools';
  s.source.dataset.folderId = 'folder_tools'; s.source.className = 'app-item folder-item';
  begin(s); s.document.hit = s.document.querySelector('.desktop-drag-placeholder');
  s.document.emit('pointerup', s.event(s.source, { clientX: 190, clientY: 280 }));
  assert.equal(s.drops.length, 1, 'moving a folder tile must use desktop placement, not extract a folder member');
  assert.equal(s.drops[0].kind, 'folder');
});

test('a desktop folder target carrying folderId metadata remains eligible to accept sites', t => {
  const s = setup(t);
  s.target.dataset.placementKind = 'folder'; s.target.dataset.placementId = 'folder_tools';
  s.target.dataset.folderId = 'folder_tools'; s.target.className = 'app-item folder-item';
  beginSiteCenterHover(s);
  assert.equal([...s.timers.values()].some(value => value.delay === 600), true);
});
