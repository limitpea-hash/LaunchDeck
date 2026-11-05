import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOBILE_DISPLAY_MODE_STORAGE_KEY, loadMobileDisplayMode, saveMobileDisplayMode,
  normalizeMobileDisplayMode, resolveEffectiveDisplayMode, computeSingleScreenMetrics,
  measureGridFlowRows, packCategoryItemsIntoViews, buildScreenViewsModel, resolveViewDropBeforeAnchor,
} from '../frontend/lib/display-mode.js';
import { migrateLegacyDesktop, placeDesktopItemBefore } from '../frontend/lib/desktop-layout.js';
import { defaultWidgetState, validateWidgetDocument } from './features/widgets.js';

const defaults = [
  ...defaultWidgetState().layout.map(w => ({ kind: 'widget', id: w.id })),
  ...Array.from({ length: 24 }, (_, i) => ({ kind: 'site', id: `site_${i}` })),
];
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('mobile display preference remains local, survives reload and never changes desktop mode', () => {
  const phone = storage(); const desktop = storage();
  assert.equal(loadMobileDisplayMode(phone), 'compact');
  saveMobileDisplayMode('comfort', phone);
  assert.equal(loadMobileDisplayMode(phone), 'comfort');
  assert.equal(loadMobileDisplayMode(desktop), 'compact');
  assert.equal(resolveEffectiveDisplayMode({ viewportWidth: 375, mobileDisplayMode: loadMobileDisplayMode(phone) }), 'comfort');
  assert.equal(resolveEffectiveDisplayMode({ viewportWidth: 1280, mobileDisplayMode: loadMobileDisplayMode(phone) }), 'compact');
  assert.equal(loadMobileDisplayMode(phone), 'comfort', 'desktop resize must retain the mobile choice');
  assert.equal(JSON.parse(phone.getItem(MOBILE_DISPLAY_MODE_STORAGE_KEY)).schemaVersion, 1);
});

test('unavailable storage and malformed preferences safely fall back without breaking the page', () => {
  const blocked = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
  assert.equal(loadMobileDisplayMode(blocked), 'compact');
  assert.equal(saveMobileDisplayMode('comfort', blocked), 'comfort');
  assert.equal(loadMobileDisplayMode(null), 'compact');
  assert.equal(normalizeMobileDisplayMode('__proto__'), 'compact');
  for (const raw of ['{', 'null', '[]', '"unknown"', '{"mode":"<script>"}']) {
    assert.equal(loadMobileDisplayMode({ getItem: () => raw }), 'compact');
  }
});

test('a browser that denies access to the localStorage property can still load and switch modes', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('SecurityError'); } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  assert.equal(loadMobileDisplayMode(), 'compact');
  assert.equal(saveMobileDisplayMode('comfort'), 'comfort');
});

test('default compact content fits one screen at supported phone and desktop sizes', () => {
  for (const [width, height] of [[375, 667], [375, 812], [1280, 720], [1366, 768]]) {
    const metrics = computeSingleScreenMetrics({ viewportWidth: width, viewportHeight: height });
    const views = packCategoryItemsIntoViews(defaults, { metrics });
    assert.equal(views.length, 1);
    assert.equal(views[0].overflowItems.length, 0, `${width}x${height} must retain all default items`);
    assert.deepEqual(views[0].items, defaults);
    const rows = measureGridFlowRows(views[0].items, metrics).totalRows;
    const pixels = rows * metrics.rowHeight + Math.max(0, rows - 1) * metrics.rowGap;
    assert.ok(pixels <= metrics.availableGridHeight, `${width}x${height}: ${pixels} exceeds ${metrics.availableGridHeight}`);
    assert.ok(metrics.iconSize >= 28);
  }
});

test('actual measured grid space overrides viewport estimates so the final row is never clipped', () => {
  for (const [width, height, measured] of [[375, 667, 406], [1280, 720, 432]]) {
    const metrics = computeSingleScreenMetrics({ viewportWidth: width, viewportHeight: height,
      measuredAvailableGridHeight: measured });
    const [view] = packCategoryItemsIntoViews(defaults, { metrics });
    assert.equal(view.items.length, defaults.length);
    assert.equal(view.overflowItems.length, 0);
    const rows = measureGridFlowRows(view.items, metrics).totalRows;
    assert.ok(rows * metrics.rowHeight + (rows - 1) * metrics.rowGap <= measured);
    assert.ok(metrics.iconSize >= 28);
  }
});

test('comfort packing retains mixed ordering and fits rows without persisting view identities', () => {
  const mixed = Array.from({ length: 90 }, (_, i) => ({ kind: i % 3 === 1 ? 'widget' : 'site', id: `item_${i}` }));
  const original = structuredClone(mixed);
  for (const height of [667, 812]) {
    const metrics = computeSingleScreenMetrics({ viewportWidth: 375, viewportHeight: height, mobileDisplayMode: 'comfort' });
    const views = packCategoryItemsIntoViews(mixed, { pageId: 'all', metrics });
    assert.ok(views.length > 1);
    assert.deepEqual(views.flatMap(v => v.items), mixed);
    for (const v of views) {
      assert.equal(v.pageId, 'all');
      const rows = measureGridFlowRows(v.items, metrics).totalRows;
      assert.ok(rows * metrics.rowHeight + (rows - 1) * metrics.rowGap <= metrics.availableGridHeight);
    }
  }
  assert.deepEqual(mixed, original);
});

test('compact overflow remains explicitly recoverable in the original category', () => {
  const items = Array.from({ length: 300 }, (_, i) => ({ kind: 'site', id: `item_${i}` }));
  const [view] = packCategoryItemsIntoViews(items, { pageId: 'design', metrics: computeSingleScreenMetrics({ viewportWidth: 375, viewportHeight: 667 }) });
  assert.ok(view.overflowItems.length > 0);
  assert.deepEqual([...view.items, ...view.overflowItems], items);
  assert.equal(view.pageId, 'design');
});

test('compact overflow capacity respects actual row height on every supported viewport', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ kind: i % 3 === 1 ? 'widget' : 'site', id: `mixed_${i}` }));
  for (const [width, height] of [[375, 667], [375, 812], [1280, 720], [1366, 768]]) {
    const metrics = computeSingleScreenMetrics({ viewportWidth: width, viewportHeight: height });
    const [view] = packCategoryItemsIntoViews(items, { metrics });
    const rows = measureGridFlowRows(view.items, metrics).totalRows;
    assert.ok(rows * metrics.rowHeight + (rows - 1) * metrics.rowGap <= metrics.availableGridHeight,
      `${width}x${height}: visible overflow items must not extend behind the dock`);
    assert.deepEqual([...view.items, ...view.overflowItems], items);
  }
});

test('switching presentation models never mutates the authoritative desktop or component configuration', () => {
  const state = defaultWidgetState();
  const sites = defaults.filter(e => e.kind === 'site').map(e => ({ id: e.id, category: 'ai' }));
  const migrated = migrateLegacyDesktop({ sites, layout: state.layout });
  const original = structuredClone(migrated);
  const getItems = pageId => defaults.filter(e => migrated.desktop.placements.some(p => p.pageId === pageId && p.id === e.id));
  for (const mode of ['compact', 'comfort']) {
    const model = buildScreenViewsModel({ pages: migrated.desktop.pages, getRenderableItemsForPage: getItems,
      metrics: computeSingleScreenMetrics({ viewportWidth: 375, viewportHeight: 667, mobileDisplayMode: mode }) });
    assert.equal(model.views[0].pageId, 'all');
    assert.ok(model.firstViewIndexByPageId.has('all'));
  }
  assert.deepEqual(migrated, original);
});

test('dropping at a subview tail inserts before the next visible screen in the true category', () => {
  const metrics = computeSingleScreenMetrics({ viewportWidth: 375, viewportHeight: 667, mobileDisplayMode: 'comfort' });
  const views = packCategoryItemsIntoViews(defaults, { pageId: 'all', metrics });
  assert.ok(views.length > 1);
  const anchor = resolveViewDropBeforeAnchor({ views, targetViewId: views[0].viewId, targetPageId: 'all', draggedKind: 'site', draggedId: 'site_23' });
  assert.equal(anchor.toPageId, 'all');
  assert.equal(anchor.beforeId, views[1].items[0].id);
  const original = migrateLegacyDesktop({ sites: defaults.filter(e => e.kind === 'site').map(e => ({ id: e.id, category: 'ai' })), layout: defaultWidgetState().layout });
  const desktop = placeDesktopItemBefore(original.desktop, { fromPageId: 'all', kind: 'site', id: 'site_23', ...anchor });
  validateWidgetDocument({ ...original, desktop, todos: [] });
  const ordered = desktop.placements.filter(p => p.pageId === 'all').sort((a,b) => a.order-b.order);
  assert.equal(ordered[ordered.findIndex(p => p.id === anchor.beforeId) - 1].id, 'site_23');
  assert.ok(desktop.placements.every(p => !p.pageId.includes('__view_')));
});
