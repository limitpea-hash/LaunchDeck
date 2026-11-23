import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDockMagnification } from '../frontend/lib/dock-magnification.js';

class Element {
  constructor(left = 0, width = 0, name = '') {
    this.rect = { left, right: left + width, top: 0, width, height: width };
    this.name = name;
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.selectors = new Map();
    this.classList = new Set();
    this.classList.remove = value => this.classList.delete(value);
    this.classList.contains = value => this.classList.has(value);
  }

  getBoundingClientRect() { return this.rect; }
  setAttribute() {}
  querySelector(selector) { return this.selectors.get(selector) ?? null; }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  cloneNode() { return new Element(this.rect.left, this.rect.width, this.name); }
  appendChild(child) { this.children.push(child); child.parent = this; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  emit(type, event) { this.listeners.get(type)?.(event); }
}

function setupDock() {
  const strip = new Element(20, 204);
  const dock = new Element(8, 248);
  const view = new Element();
  const reducedMotion = new Element();
  const queue = new Map();
  let frameId = 0;
  let time = 0;

  view.matchMedia = () => reducedMotion;
  view.getComputedStyle = () => ({ columnGap: '8px', borderRadius: '10px' });
  view.requestAnimationFrame = callback => {
    queue.set(++frameId, callback);
    return frameId;
  };
  view.cancelAnimationFrame = id => queue.delete(id);
  dock.ownerDocument = { defaultView: view, createElement: () => new Element() };
  dock.selectors.set('.dock-sites-strip', strip);
  dock.appendChild(strip);
  for (const [index, name] of ['one', 'two', 'three', 'four'].entries()) {
    const item = new Element(20 + index * 52, 44, name);
    item.selectors.set('.app-squircle', new Element(item.rect.left, 44, name));
    strip.appendChild(item);
  }

  const destroy = createDockMagnification(dock);
  const layer = dock.children.at(-1);
  const frame = (count = 1) => {
    for (let index = 0; index < count; index++) {
      time += 16;
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(time);
    }
  };

  return {
    destroy, frame, dock, strip, layer, queue, reducedMotion,
    mirror: name => layer.children.find(image => image.name === name),
    hover: clientX => dock.emit('pointermove', { pointerType: 'mouse', buttons: 0, target: strip, clientX }),
  };
}

const scale = image => Number(image.style.transform.split('scale(')[1].slice(0, -1));

test('Dock keeps the current visual through a hover transfer and eases back before restoring the source', t => {
  const dock = setupDock();
  t.after(dock.destroy);

  dock.hover(42);
  dock.frame(24);
  const first = dock.mirror('one');
  const second = dock.mirror('two');
  assert.ok(scale(first) > 1.4);
  const previousSecondScale = scale(second);

  dock.hover(68); // The gap still responds to the mouse position.
  dock.frame();
  assert.equal(dock.mirror('one'), first);
  assert.equal(dock.mirror('two'), second);
  assert.ok(scale(first) > 1.33 && scale(first) < 1.42);
  assert.ok(scale(second) > previousSecondScale && scale(second) < 1.38);

  dock.hover(94);
  dock.frame(24);
  assert.equal(dock.mirror('two'), second);
  assert.ok(scale(second) > 1.4);

  dock.dock.emit('pointerleave');
  dock.frame();
  assert.equal(dock.mirror('two'), second);
  assert.ok(scale(second) > 1 && scale(second) < 1.42);
  dock.frame(24);
  assert.equal(dock.layer.children.length, 0);
  assert.equal(dock.queue.size, 0);
  assert.ok(dock.strip.children.every(item => !item.classList.contains('is-dock-mirrored')));

  dock.hover(94);
  dock.frame();
  dock.strip.emit('scroll');
  assert.equal(dock.layer.children.length, 0);
  assert.equal(dock.queue.size, 0);

  dock.reducedMotion.matches = true;
  dock.reducedMotion.emit('change');
  dock.hover(94);
  dock.frame();
  assert.equal(dock.layer.children.length, 0);
});
