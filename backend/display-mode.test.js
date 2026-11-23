import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOBILE_DISPLAY_MODE_STORAGE_KEY, loadMobileDisplayMode, saveMobileDisplayMode,
  normalizeMobileDisplayMode, resolveEffectiveDisplayMode, computeSingleScreenMetrics,
  measureGridFlowRows, packCategoryItemsIntoViews, buildScreenViewsModel, resolveViewDropBeforeAnchor,
  resolveWidgetDisplaySize, getWidgetGridSpan,
  getFixedCellsForPage,
  planDesktopCellDrop,
} from '../frontend/lib/display-mode.js';
import { migrateLegacyDesktop, placeDesktopItemBefore } from '../frontend/lib/desktop-layout.js';
import { resolveGridAnchorCellFromPointer } from '../frontend/lib/desktop-pointer-drag.js';
import { defaultWidgetState, validateWidgetDocument } from './features/widgets.js';

const defaults = [
  ...defaultWidgetState().layout.map(w => ({ kind: 'widget', id: w.id })),
  ...Array.from({ length: 24 }, (_, i) => ({ kind: 'site', id: `site_${i}` })),
];

test('large and square widgets reserve their rows when ordering sites and compact overflow', () => {
  const large = { kind: 'widget', id: 'today-dashboard', widget: { type: 'today-dashboard', size: 'large' } };
  const square = { kind: 'widget', id: 'todo', widget: { type: 'todo', size: 'square' } };
  const sites = Array.from({ length: 7 }, (_, index) => ({ kind: 'site', id: `site_${index}` }));
  const items = [large, square, ...sites];
  const metrics = { ...computeSingleScreenMetrics({ viewportWidth: 900, measuredAvailableGridWidth: 610 }), maxRows: 3 };
  assert.deepEqual(getWidgetGridSpan(large, metrics), { colSpan: 3, rowSpan: 3 });
  assert.deepEqual(getWidgetGridSpan(square, metrics), { colSpan: 2, rowSpan: 2 });
  const { positions, totalRows } = measureGridFlowRows(items, metrics);
  assert.deepEqual(positions.slice(0, 3).map(({ row, col }) => [row, col]), [[0, 0], [0, 3], [0, 5]]);
  assert.equal(totalRows, 4);
  const [view] = packCategoryItemsIntoViews(items, { metrics });
  assert.deepEqual(view.items, [large, square, ...sites.slice(0, 5)]);
  assert.deepEqual(view.overflowItems, sites.slice(5));
});

test('calendar and weather reserve their new spans and fall back to a square without changing the saved option', () => {
  const items = [
    { kind: 'widget', id: 'calendar', widget: Object.freeze({ type: 'calendar', size: 'full' }) },
    { kind: 'widget', id: 'clock-weather', widget: Object.freeze({ type: 'clock-weather', size: 'landscape' }) },
  ];
  const roomy = { columns: 8, maxRows: 4 };
  assert.deepEqual(items.map(item => getWidgetGridSpan(item, roomy)), [
    { colSpan: 4, rowSpan: 4 }, { colSpan: 3, rowSpan: 2 },
  ]);
  assert.deepEqual(measureGridFlowRows(items, roomy).positions.map(({ row, col }) => [row, col]), [[0, 0], [0, 4]]);
  const short = { ...roomy, maxRows: 2 };
  assert.equal(resolveWidgetDisplaySize(items[0], short), 'square');
  assert.equal(resolveWidgetDisplaySize(items[1], short), 'landscape');
  for (const item of items) {
    assert.equal(resolveWidgetDisplaySize(item, { ...roomy, columns: 2 }), 'square');
    assert.equal(resolveWidgetDisplaySize(item, { ...roomy, maxRows: 1 }), 'square');
    for (const effectiveMode of ['compact', 'comfort']) {
      for (const constraint of [{ maxRows: 1 }, { columns: 1 }]) {
        const [view] = packCategoryItemsIntoViews([item], { metrics: { ...roomy, ...constraint, effectiveMode } });
        assert.deepEqual(view.items, []);
        assert.deepEqual(view.overflowItems, [item]);
      }
    }
  }
  assert.deepEqual(items.map(({ widget }) => widget.size), ['full', 'landscape']);
});

test('daily widgets use their registered spans and recover saved dimensions after resizing', () => {
  const metrics = { columns: 8, maxRows: 6 };
  for (const [type, size, colSpan, rowSpan] of [
    ['weather-badge', 'single', 1, 1],
    ['habits', 'tall', 2, 3],
    ['today-dashboard', 'large', 3, 3],
    ['weather-strip', 'strip', 4, 1],
  ]) {
    const widget = Object.freeze({ type, size });
    const item = { kind: 'widget', id: type, widget };
    assert.deepEqual(getWidgetGridSpan(item, metrics), { colSpan, rowSpan });
    const constrained = getWidgetGridSpan(item, { columns: 2, maxRows: 1 });
    assert.ok(constrained.colSpan <= 2);
    assert.equal(constrained.rowSpan, 1);
    assert.deepEqual(getWidgetGridSpan(item, metrics), { colSpan, rowSpan });
  }
});

test('currency cards retain a square span and are reachable when the grid has only one row', () => {
  const currency = { kind: 'widget', id: 'fx', widget: { type: 'currency-converter', size: 'single' } };
  for (const effectiveMode of ['compact', 'comfort']) {
    const metrics = { columns: 4, maxRows: 1, effectiveMode };
    assert.equal(resolveWidgetDisplaySize(currency, metrics), 'square');
    assert.deepEqual(getWidgetGridSpan(currency, metrics), { colSpan: 2, rowSpan: 2 });
    const [shortView] = packCategoryItemsIntoViews([currency], { metrics });
    assert.deepEqual(shortView.items, []);
    assert.deepEqual(shortView.overflowItems, [currency]);
    const [roomyView] = packCategoryItemsIntoViews([currency], { metrics: { ...metrics, maxRows: 2 } });
    assert.deepEqual(roomyView.items, [currency]);
    assert.deepEqual(roomyView.overflowItems, []);
  }
});

test('2×2 site tiles reserve space and leave smaller sites visible in one-row layouts', () => {
  const large = { kind: 'site', id: 'large_site', site: { id: 'large_site', size: 'square' } };
  const small = { kind: 'site', id: 'small_site', site: { id: 'small_site' } };
  const metrics = { columns: 3, maxRows: 2 };
  const items = [large, small];
  assert.deepEqual(getWidgetGridSpan(large, metrics), { colSpan: 2, rowSpan: 2 });
  assert.deepEqual(getWidgetGridSpan(small, metrics), { colSpan: 1, rowSpan: 1 });
  assert.deepEqual(measureGridFlowRows(items, metrics).positions.map(({ row, col }) => [row, col]), [[0, 0], [0, 2]]);
  for (const effectiveMode of ['compact', 'comfort']) {
    const views = packCategoryItemsIntoViews(items, { metrics: { ...metrics, maxRows: 1, effectiveMode } });
    assert.deepEqual(views[0].items, [small]);
    assert.deepEqual(views[0].overflowItems, [large]);
    assert.equal(resolveViewDropBeforeAnchor({
      views, targetViewId: views[0].viewId, targetPageId: views[0].pageId,
    }).beforeId, null);
  }
});

test('fixed card footprints reserve space before automatic placement in both display modes', () => {
  const sites = Array.from({ length: 6 }, (_, index) => ({ kind: 'site', id: `site_${index}` }));
  const cell = Object.freeze({ row: 0, column: 2 });
  const fixed = { kind: 'widget', id: 'calendar', widget: { type: 'calendar', size: 'square' }, cell };
  const items = [...sites, fixed];
  const grid = { columns: 4, maxRows: 2 };
  const rect = { row: 0, column: 2, colSpan: 2, rowSpan: 2 };
  assert.deepEqual(getFixedCellsForPage(items, grid).get('widget:calendar'), rect);
  const [compact] = packCategoryItemsIntoViews(items, { metrics: { ...grid, effectiveMode: 'compact' } });
  assert.deepEqual(compact.fixedCells.get('widget:calendar'), rect);
  assert.deepEqual(compact.items.filter(item => item.kind === 'site'), sites.slice(0, 4));
  assert.ok(compact.items.includes(fixed));
  assert.deepEqual(compact.overflowItems, sites.slice(4));
  const [first, second] = packCategoryItemsIntoViews(items, { metrics: { ...grid, effectiveMode: 'comfort' } });
  assert.deepEqual(first.fixedCells.get('widget:calendar'), rect);
  assert.deepEqual(second.items, sites.slice(4));
  assert.ok(!second.fixedCells?.size);
  const overlap = { ...sites[0], cell: { row: 1, column: 3 } };
  assert.deepEqual([...getFixedCellsForPage([fixed, overlap], grid).keys()], ['widget:calendar']);
  assert.equal(getFixedCellsForPage(items, { ...grid, columns: 2 }).size, 0);
  assert.equal(fixed.cell, cell);
});

test('dropping on fixed cells plans a deterministic nearby relocation without mutating the page', () => {
  const entry = { kind: 'widget', id: 'todo', widget: { type: 'todo', size: 'square' } };
  const blocked = { kind: 'site', id: 'large', site: { size: 'square' }, cell: { row: 0, column: 3 } };
  const unaffected = { kind: 'site', id: 'small', cell: { row: 0, column: 7 } };
  const automatic = { kind: 'site', id: 'auto' };
  const items = [blocked, unaffected, automatic];
  const before = structuredClone(items);
  const plan = planDesktopCellDrop({ entry, items, rawPlacements: items,
    metrics: { columns: 8, maxRows: 4 }, cell: { row: 0, column: 3 } });
  assert.deepEqual(plan, {
    targetRect: { row: 0, column: 3, colSpan: 2, rowSpan: 2 },
    moves: [{ kind: 'site', id: 'large', cell: { row: 0, column: 1 } }],
  });
  assert.deepEqual(items, before);
  const withoutSpace = planDesktopCellDrop({ entry: automatic,
    items: [{ ...blocked, cell: { row: 0, column: 0 } }], metrics: { columns: 2, maxRows: 2 },
    cell: { row: 0, column: 0 } });
  assert.equal(withoutSpace, null);
  assert.equal(planDesktopCellDrop({ entry, items, metrics: { columns: 8, maxRows: 4 }, cell: { row: 0, column: 7 } }), null);
});

test('pointer snapping accounts for the grab offset and rejects the trailing edge of the grid', () => {
  const geometry = {
    originLeft: 20, originTop: 100, columns: 4, maxRows: 3, colGap: 10, rowGap: 8, rowHeight: 50,
    avgColWidth: 80, colWidths: [80, 80, 80, 80], colStarts: [20, 110, 200, 290],
  };
  const snap = (clientX, clientY, colSpan = 1, rowSpan = 1) =>
    resolveGridAnchorCellFromPointer({ geometry, clientX, clientY, grabOffsetX: 30, grabOffsetY: 20, colSpan, rowSpan });
  const valid = snap(230, 178, 2, 2);
  assert.deepEqual([valid.row, valid.column, valid.fitsGrid], [1, 2, true]);
  assert.equal(snap(320, 178, 2, 2).fitsGrid, false);
  assert.equal(snap(410, 178).fitsGrid, false);
  assert.equal(snap(230, 294).fitsGrid, false);
});

test('a vertical drop detects the next row even when the pointer grabbed the bottom of a card', () => {
  const geometry = {
    originLeft: 20, originTop: 100, columns: 4, maxRows: 4, colGap: 10, rowGap: 8, rowHeight: 50,
    avgColWidth: 80, colWidths: [80, 80, 80, 80], colStarts: [20, 110, 200, 290],
  };
  const snapRow = (clientY, grabOffsetY, rowSpan) =>
    resolveGridAnchorCellFromPointer({ geometry, clientX: 50, clientY, grabOffsetX: 30, grabOffsetY, rowSpan });
  for (const grabOffsetY of [8, 25, 44]) {
    const result = snapRow(161, grabOffsetY, 1);
    assert.deepEqual([result.row, result.column, result.fitsGrid], [1, 0, true]);
  }
  assert.equal(snapRow(161, 20, 2).row, 1);
  const lowerHalf = snapRow(235, 71, 2);
  assert.deepEqual([lowerHalf.row, lowerHalf.column, lowerHalf.fitsGrid], [1, 0, true]);
});

test('narrow compact mode keeps a square widget when there is space for two rows', () => {
  const item = { kind: 'widget', id: 'calendar', widget: Object.freeze({ type: 'calendar', size: 'square' }) };
  const compact = computeSingleScreenMetrics({ viewportWidth: 375, viewportHeight: 667, mobileDisplayMode: 'compact' });
  assert.deepEqual(getWidgetGridSpan(item, compact), { colSpan: 2, rowSpan: 2 });
  assert.deepEqual(getWidgetGridSpan(item, { ...compact, maxRows: 1 }), { colSpan: 2, rowSpan: 2 });
  assert.equal(item.widget.size, 'square');
});

test('the measured compact grid fits the six sized default widgets and 24 sites at 375x667', () => {
  const items = [
    ...defaultWidgetState().layout.map(widget => ({ kind: 'widget', id: widget.id, widget })),
    ...defaults.filter(item => item.kind === 'site'),
  ];
  const metrics = computeSingleScreenMetrics({
    viewportWidth: 375, viewportHeight: 667, measuredAvailableGridHeight: 428,
  });
  const [view] = packCategoryItemsIntoViews(items, { metrics });
  assert.deepEqual(view.items, items);
  assert.deepEqual(view.overflowItems, []);
});

test('a measured short window keeps its visible grid and offers overflow for the remaining cards', () => {
  const metrics = computeSingleScreenMetrics({ viewportWidth: 800, viewportHeight: 420, measuredAvailableGridHeight: 114 });
  const items = defaultWidgetState().layout.map(widget => ({ kind: 'widget', id: widget.id, widget }));
  items[0].widget.size = 'wide';
  const [view] = packCategoryItemsIntoViews(items, { metrics });
  assert.equal(metrics.availableGridHeight, 114);
  assert.equal(metrics.maxRows, 1);
  assert.equal(resolveWidgetDisplaySize(items[0], metrics), 'square');
  assert.ok(view.overflowItems.includes(items[0]));
  assert.ok(view.overflowItems.some(item => item.id === 'calendar'));
  assert.ok(view.items.length > 0);
  assert.deepEqual(new Set([...view.items, ...view.overflowItems]), new Set(items));
});

test('a two-row desktop window keeps the selected forecast span and adapts the full calendar', () => {
  const items = defaultWidgetState().layout.map(widget => ({ kind: 'widget', id: widget.id, widget }));
  items[0].widget.size = 'landscape';
  const calendar = items.find(item => item.id === 'calendar');
  calendar.widget.size = 'full';
  const short = computeSingleScreenMetrics({
    viewportWidth: 800, viewportHeight: 420, measuredAvailableGridHeight: 116,
  });
  const roomy = computeSingleScreenMetrics({
    viewportWidth: 1280, viewportHeight: 720, measuredAvailableGridHeight: 420,
  });
  assert.equal(short.maxRows, 2);
  const [view] = packCategoryItemsIntoViews(items, { metrics: short });
  assert.equal(view.items[0], items[0]);
  assert.deepEqual([...view.items, ...view.overflowItems], items);
  assert.equal(resolveWidgetDisplaySize(items[0], short), 'landscape');
  assert.equal(resolveWidgetDisplaySize(calendar, short), 'square');
  assert.equal(resolveWidgetDisplaySize(calendar, roomy), 'full');
});

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

test('wider desktop windows fit more columns without widening the individual icon tracks', () => {
  const regular = computeSingleScreenMetrics({ viewportWidth: 1280, measuredAvailableGridWidth: 1220 });
  const wide = computeSingleScreenMetrics({ viewportWidth: 1920, measuredAvailableGridWidth: 1860 });
  const ultraWide = computeSingleScreenMetrics({ viewportWidth: 3840, measuredAvailableGridWidth: 3780 });
  assert.ok(regular.columns > 8);
  assert.ok(wide.columns > regular.columns);
  assert.ok(ultraWide.columns >= 34);
  for (const layout of [regular, wide, ultraWide]) {
    const used = layout.columns * layout.trackMaxWidth + (layout.columns - 1) * layout.colGap;
    assert.ok(layout.availableGridWidth - used < layout.trackMaxWidth);
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
