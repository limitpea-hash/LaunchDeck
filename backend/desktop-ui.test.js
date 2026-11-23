import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as model from '../frontend/lib/desktop-layout.js';
import { createDefaultWidgetState } from '../frontend/lib/feature-client.js';
import { defaultWidgetState, validateWidgetDocument } from './features/widgets.js';

const sites = [{ id: 'first', category: 'ai' }, { id: 'custom', category: 'page_reading' }];
const pages = [...model.DEFAULT_SYSTEM_PAGES, { id: 'page_reading', title: '阅读', icon: 'book', isSystem: false, order: 5 }];
function migrate(layout = defaultWidgetState().layout) {
  return model.migrateLegacyDesktop({ pages, sites, layout });
}
function verify(value) { validateWidgetDocument({ ...value, todos: [] }); return value; }

test('legacy mixed migration retains pages and hidden configuration and produces a server-valid document', () => {
  const layout = defaultWidgetState().layout;
  layout[0].enabled = false;
  layout[0].config.showSeconds = false;
  const value = verify(migrate(layout));
  assert.equal(value.layout.find(w => w.id === 'clock-weather').enabled, false);
  assert.equal(value.layout.find(w => w.id === 'clock-weather').config.showSeconds, false);
  assert.equal(value.desktop.pages.at(-1).id, 'page_reading');
  assert.deepEqual(model.getPagePlacements(value.desktop, 'all').slice(-2).map(p => p.id), ['first', 'custom']);
  assert.equal(model.getPagePlacements(value.desktop, 'page_reading')[0].id, 'custom');
});

test('empty legacy widget layout remains empty instead of silently restoring all six widgets', () => {
  const value = verify(migrate([]));
  assert.equal(value.layout.filter(w => w.enabled).length, 0);
  assert.equal(value.desktop.placements.filter(p => p.kind === 'widget').length, 0);
});

test('fixed grid coordinates survive reconciliation and reordering and can move or clear atomically', () => {
  const { desktop, layout } = verify(migrate());
  const put = (doc, id, kind, fromPageId, toPageId, cell) =>
    model.setDesktopItemCell(doc, { id, kind, fromPageId, toPageId, cell });
  const cell = { row: 1, column: 2 };
  const site = put(desktop, 'first', 'site', 'all', 'all', cell);
  assert.equal(desktop.placements.find(item => item.id === 'first')?.cell, undefined);
  assert.deepEqual(model.getRenderablePageItems({ desktop: site, pageId: 'all', sites, layout })
    .find(item => item.id === 'first').cell, cell);
  const reconciled = verify(model.reconcileDesktopWithLayout(site, layout)).desktop;
  const moved = model.placeDesktopItemBefore(reconciled, { fromPageId: 'all', toPageId: 'all',
    kind: 'widget', id: 'calendar', beforeKind: 'widget', beforeId: 'clock-weather' });
  assert.deepEqual(model.getPagePlacements(moved, 'all').find(item => item.id === 'first').cell, cell);
  assert.equal(put(moved, 'calendar', 'widget', 'all', 'all', cell), moved);
  const newCell = { row: 2, column: 1 };
  const next = put(moved, 'first', 'site', 'all', 'ai', newCell);
  verify({ desktop: next, layout });
  assert.ok(!model.getPagePlacements(next, 'all').some(item => item.id === 'first'));
  assert.deepEqual(model.getPagePlacements(next, 'ai').filter(item => item.id === 'first').map(item => item.cell), [newCell]);
  assert.equal(put(next, 'first', 'site', 'all', 'ai', cell), next);
  const cleared = put(next, 'first', 'site', 'ai', 'dev', null);
  assert.equal(model.getPagePlacements(cleared, 'ai').find(item => item.id === 'first').cell, undefined);
  assert.ok(!model.getPagePlacements(cleared, 'dev').some(item => item.id === 'first'));
});

test('the dragged card and displaced fixed cards can exchange cells in one desktop change', () => {
  const { desktop, layout } = verify(migrate());
  const first = { row: 0, column: 0 };
  const second = { row: 0, column: 2 };
  const pin = (doc, id, cell) => model.setDesktopItemCell(doc, {
    kind: 'widget', id, fromPageId: 'all', toPageId: 'all', cell,
  });
  const before = pin(pin(desktop, 'clock-weather', first), 'calendar', second);
  const plan = { kind: 'widget', id: 'clock-weather', fromPageId: 'all', toPageId: 'all', cell: second,
    moves: [{ kind: 'widget', id: 'calendar', cell: first }] };
  const changed = model.applyDesktopCellDrop(before, plan);
  verify({ desktop: changed, layout });
  const coordinates = (doc, id) => model.getPagePlacements(doc, 'all').find(item => item.id === id).cell;
  assert.deepEqual(coordinates(changed, 'clock-weather'), second);
  assert.deepEqual(coordinates(changed, 'calendar'), first);
  assert.deepEqual(coordinates(before, 'clock-weather'), first);
  assert.equal(model.applyDesktopCellDrop(before, { ...plan, moves: [{ kind: 'widget', id: 'missing', cell: first }] }), before);
  assert.equal(model.applyDesktopCellDrop(before, { ...plan, moves: [] }), before);
});

test('new home excludes preset copies while keeping widgets, custom sites and category placements', () => {
  const preset = { id: 'starter', title: 'Starter', category: 'ai', url: 'https://example.com', pinned: true };
  const value = verify(model.migrateLegacyDesktop({
    pages, sites: [preset, sites[1]], layout: defaultWidgetState().layout, omitHomeSiteIds: [preset.id],
  }));
  const home = model.getPagePlacements(value.desktop, 'all');
  assert.equal(home.filter(item => item.kind === 'widget').length, 6);
  assert.deepEqual(home.filter(item => item.kind === 'site').map(item => item.id), ['custom']);
  assert.deepEqual(model.getPagePlacements(value.desktop, 'ai').map(item => item.id), ['starter']);
});

test('old default cleanup recognizes only pristine placement order and preserves local widget settings', () => {
  const defaultSites = [
    { id: 'starter', title: 'Starter', category: 'ai', url: 'https://example.com', pinned: true },
    { id: 'docs', title: 'Docs', category: 'dev', url: 'https://example.org/docs', pinned: false },
  ];
  const storedSites = defaultSites.map(site => ({ ...site, url: new URL(site.url).href }));
  const layout = defaultWidgetState().layout;
  layout.find(widget => widget.type === 'calendar').config.weekStartsOn = 0;
  const baseline = model.migrateLegacyDesktop({ sites: defaultSites, layout });
  const criteria = { sites: storedSites, defaultSites };
  assert.equal(model.doesDesktopMatchLegacyDefaultSnapshot(baseline.desktop, criteria), true);
  const { folders, ...legacy } = baseline.desktop;
  assert.equal(model.doesDesktopMatchLegacyDefaultSnapshot({ ...legacy, schemaVersion: 1 }, criteria), true);

  const reordered = model.reorderPlacementInPage(baseline.desktop, {
    pageId: 'all', draggedKind: 'site', draggedId: 'docs', targetKind: 'site', targetId: 'starter',
  });
  assert.equal(model.doesDesktopMatchLegacyDefaultSnapshot(reordered, criteria), false);
  for (const guard of ['hasUnsyncedLayout', 'hasRestoreMarker']) {
    assert.equal(model.doesDesktopMatchLegacyDefaultSnapshot(baseline.desktop, { ...criteria, [guard]: true }), false);
  }

  const cleaned = verify(model.stripDefaultSitePlacementsFromHomePage(baseline.desktop, baseline.layout, { defaultSites }));
  assert.deepEqual(cleaned.desktop.placements.filter(item => item.pageId !== 'all'), baseline.desktop.placements.filter(item => item.pageId !== 'all'));
  assert.equal(cleaned.desktop.placements.filter(item => item.pageId === 'all' && item.kind === 'site').length, 0);
  assert.equal(cleaned.layout.find(widget => widget.type === 'calendar').config.weekStartsOn, 0);
  assert.equal(model.doesDesktopMatchLegacyDefaultSnapshot(cleaned.desktop, criteria), false);
});

test('mixed widget defaults match across entry points and only upgrade unset sizes on a pristine home', () => {
  assert.deepEqual(createDefaultWidgetState(), defaultWidgetState());
  const defaultSites = [{ id: 'docs', title: 'Docs', category: 'dev', url: 'https://example.org', pinned: false }];
  const layout = defaultWidgetState().layout.map(({ size, ...item }) => item);
  const clock = layout.find(item => item.type === 'clock-weather');
  clock.size = 'compact';
  const calendar = layout.find(item => item.type === 'calendar');
  calendar.config.weekStartsOn = 0;
  const omitHomeSiteIds = defaultSites.map(site => site.id);
  const home = model.migrateLegacyDesktop({ sites: defaultSites, layout, omitHomeSiteIds });
  const options = { sites: defaultSites, defaultSites, omitHomeSiteIds };
  const resized = model.applyDefaultWidgetSizesToPristineDesktop(home.desktop, home.layout, options);
  assert.deepEqual(resized, home.layout.map(item => item.id === 'calendar' ? { ...item, size: 'square' } : item));
  assert.equal(home.layout.find(item => item.id === 'calendar').size, undefined);
  assert.equal(JSON.stringify(model.normalizeWidgetLayout(resized)), JSON.stringify(resized));
  assert.equal(model.applyDefaultWidgetSizesToPristineDesktop(home.desktop, resized, options), resized);
  for (const guard of ['hasUnsyncedLayout', 'hasRestoreMarker']) {
    assert.equal(model.applyDefaultWidgetSizesToPristineDesktop(home.desktop, home.layout, { ...options, [guard]: true }), home.layout);
  }
  const rearranged = model.movePlacementToPage(home.desktop, { fromPageId: 'all', toPageId: 'dev', kind: 'widget', id: 'calendar' });
  assert.equal(model.applyDefaultWidgetSizesToPristineDesktop(rearranged, home.layout, options), home.layout);
});

test('mixed ordering moves widgets between sites, persists across reconciliation, and merges site mirrors on cross-page moves', () => {
  const value = migrate();
  let desktop = model.reorderPlacementInPage(value.desktop, { pageId: 'all', draggedKind: 'widget', draggedId: 'calendar', targetKind: 'site', targetId: 'first' });
  desktop = model.movePlacementToPage(desktop, { fromPageId: 'all', toPageId: 'page_reading', kind: 'widget', id: 'calendar' });
  desktop = model.movePlacementToPage(desktop, { fromPageId: 'all', toPageId: 'ai', kind: 'site', id: 'first' });
  const reconciled = verify(model.reconcileDesktopWithLayout(desktop, value.layout));
  assert.equal(reconciled.desktop.placements.filter(p => p.kind === 'widget' && p.id === 'calendar').length, 1);
  assert.equal(reconciled.desktop.placements.find(p => p.id === 'calendar').pageId, 'page_reading');
  assert.equal(reconciled.desktop.placements.filter(p => p.kind === 'site' && p.id === 'first').length, 1);
  assert.equal(reconciled.desktop.placements.find(p => p.id === 'first').pageId, 'ai');
});

test('first add creates only the chosen daily widget row and keeps old layout sizes', () => {
  const old = migrate();
  assert.deepEqual(old.layout, defaultWidgetState().layout);
  const added = verify(model.enableWidgetOnPage(old, { widgetId: 'today-dashboard', pageId: 'page_reading' }));
  assert.deepEqual(added.layout.slice(0, old.layout.length), old.layout);
  assert.deepEqual(added.layout.at(-1), {
    id: 'today-dashboard', type: 'today-dashboard', enabled: true, order: 6, size: 'large', config: {},
  });
  assert.equal(added.desktop.placements.find(item => item.id === 'today-dashboard').pageId, 'page_reading');
});

test('widget removal and re-add preserve size and configuration while page deletion moves unique placements home', () => {
  let value = migrate();
  const calendar = value.layout.find(w => w.id === 'calendar');
  calendar.config.weekStartsOn = 0;
  calendar.size = 'full';
  value = verify(model.disableWidget(value, 'calendar'));
  assert.equal(value.desktop.placements.some(p => p.id === 'calendar'), false);
  assert.equal(value.layout.find(w => w.id === 'calendar').size, 'full');
  value = verify(model.enableWidgetOnPage(value, { widgetId: 'calendar', pageId: 'page_reading' }));
  const restored = value.layout.find(w => w.id === 'calendar');
  assert.equal(restored.config.weekStartsOn, 0);
  assert.equal(restored.size, 'full');
  value.desktop = model.deleteDesktopPage(value.desktop, 'page_reading');
  verify(value);
  assert.equal(value.desktop.placements.find(p => p.id === 'calendar').pageId, 'all');
  assert.equal(value.desktop.placements.filter(p => p.kind === 'site' && p.id === 'custom').length, 1);
});

test('unresolved site references survive normalization and remain absent from rendered page items', () => {
  const value = migrate();
  value.desktop = model.addSitePlacement(value.desktop, { siteId: 'other_device_only', pageId: 'all' });
  const reconciled = verify(model.reconcileDesktopWithLayout(value.desktop, value.layout));
  assert.equal(reconciled.desktop.placements.some(p => p.id === 'other_device_only'), true);
  assert.equal(model.getRenderablePageItems({ ...reconciled, sites, pageId: 'all' }).some(p => p.id === 'other_device_only'), false);
});

test('preview before-anchor insertion commits the same order in both directions and at the page end', () => {
  const value = migrate();
  const original = structuredClone(value.desktop);
  const ids = desktop => model.getPagePlacements(desktop, 'all').map(p => p.id);
  let desktop = model.placeDesktopItemBefore(value.desktop, { fromPageId: 'all', toPageId: 'all', kind: 'widget', id: 'clock-weather', beforeKind: 'site', beforeId: 'custom' });
  assert.deepEqual(ids(desktop), ['focus-timer', 'quick-note', 'todo', 'calendar', 'world-clock', 'first', 'clock-weather', 'custom']);
  desktop = model.placeDesktopItemBefore(desktop, { fromPageId: 'all', toPageId: 'all', kind: 'widget', id: 'clock-weather', beforeKind: 'widget', beforeId: 'focus-timer' });
  assert.deepEqual(ids(desktop), ids(original));
  desktop = model.placeDesktopItemBefore(desktop, { fromPageId: 'all', toPageId: 'all', kind: 'widget', id: 'clock-weather' });
  assert.equal(ids(desktop).at(-1), 'clock-weather');
  assert.deepEqual(value.desktop, original, 'preview/model calculations must not mutate their input');
  verify({ ...value, desktop });
});

test('preview insertion merges target site mirrors while retaining unrelated unresolved references', () => {
  const value = migrate();
  value.desktop = model.addSitePlacement(value.desktop, { siteId: 'unresolved', pageId: 'ai' });
  const desktop = model.placeDesktopItemBefore(value.desktop, { fromPageId: 'all', toPageId: 'ai', kind: 'site', id: 'first', beforeKind: 'site', beforeId: 'unresolved' });
  assert.deepEqual(model.getPagePlacements(desktop, 'ai').map(p => p.id), ['first', 'unresolved']);
  assert.equal(model.getPagePlacements(desktop, 'all').some(p => p.id === 'first'), false);
  verify({ ...value, desktop });
});

function desktopDragSource() {
  const source = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function bindDesktopCardDragAndLongPress(');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('reused widget drag handlers use the current page after a previous cross-page move', () => {
  const events = new Map();
  const card = { dataset: {}, closest: () => null, classList: { add() {}, remove() {} }, addEventListener(name, fn) {
    if (!events.has(name)) events.set(name, []);
    events.get(name).push(fn);
  } };
  const state = { jiggleMode: true };
  const steps = [];
  const context = {
    card, state, gestureBlockBlankExit: false,
    clearActiveLongPress() {}, closeMovePagePopover() {}, ensureDesktopPointerDragController() {},
    stepDesktopItemInPage(...args) { steps.push(args); },
  };
  runInNewContext(`${desktopDragSource()};bindDesktopCardDragAndLongPress(card,{pageId:'all',kind:'widget',id:'calendar'});`, context);
  card.dataset.pageId = 'design';
  const transfer = { setData() {} };
  for (const handler of events.get('dragstart')) handler({ dataTransfer: transfer });
  assert.equal(state.draggedItem.fromPageId, 'design');
  for (const handler of events.get('keydown')) handler({ altKey: true, key: 'ArrowLeft', preventDefault() {}, stopPropagation() {} });
  assert.equal(steps[0][0], 'design');
});

test('application long press passes the original touch into the controller and leaves detail inputs alone', () => {
  const handlers = new Map();
  let inDetail = false;
  let pending = null;
  const calls = [];
  const card = { dataset: {}, classList: { contains: c => inDetail && c === 'widget-in-detail-modal', add() {}, remove() {} },
    closest: () => inDetail ? card : null,
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); } };
  const state = { jiggleMode: false };
  const context = { state, activeLongPressTimer: null, gestureBlockBlankExit: false, folderScrollController: null,
    clearActiveLongPress() { pending = null; context.activeLongPressTimer = null; },
    ensureDesktopPointerDragController() {}, cancelActivePageDrag() {}, closeMovePagePopover() {},
    setJiggleMode(value) { state.jiggleMode = value; },
    desktopPointerDragController: { startFromLongPress: args => calls.push(args) },
    setTimeout(fn) { pending = fn; return 1; }, clearTimeout() {},
  };
  runInNewContext(`${desktopDragSource()};bindDesktopCardDragAndLongPress(card,{pageId:'all',kind:'widget',id:'calendar'});`, { ...context, card });
  const event = { pointerId: 19, pointerType: 'touch', button: 0, clientX: 100, clientY: 150,
    target: { closest: () => null } };
  for (const fn of handlers.get('pointerdown')) fn(event);
  assert.equal(typeof pending, 'function');
  pending();
  assert.equal(state.jiggleMode, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pointerId, 19);
  assert.equal(calls[0].cardEl, card);
  assert.equal(calls[0].startX, 100);
  assert.equal(calls[0].startY, 150);
  assert.equal(calls[0].immediateLift, true);
  state.jiggleMode = false;
  card.dataset.savedCell = 'true';
  for (const fn of handlers.get('pointerdown')) fn(event);
  pending();
  assert.equal(state.jiggleMode, true);
  assert.equal(calls.length, 2, 'saved positions can also be moved by long press');
  state.jiggleMode = false; inDetail = true; pending = null;
  for (const fn of handlers.get('pointerdown')) fn(event);
  assert.equal(pending, null, 'holding a detail input must not enter desktop editing');
});

test('application actions save mixed moves and removal through the real layout helper signatures', () => {
  const source = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
  const names = ['commitDesktopAndLayout', 'handleDropOnDesktopCard', 'stepDesktopItemInPage', 'moveDesktopItemToPage', 'removeWidgetFromDesktop', 'addWidgetToCurrentPage'];
  const functions = names.map(name => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing action ${name}`);
    const end = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, end === -1 ? source.length : end);
  }).join('\n');
  const initial = migrate();
  const state = {
    pages: structuredClone(initial.desktop.pages), sites,
    widgetState: { ...initial, todos: [] },
    widgetRegistry: undefined, currentPageIndex: 0, activeAddModalMode: 'site',
  };
  const saves = [];
  const context = {
    ...model, state, structuredClone,
    getEffectiveDesktopForRender: () => state.widgetState.desktop,
    featureClient: { saveWidgetsState: patch => saves.push(structuredClone(patch)) },
    widgetHost: { destroyWidget() {}, updateAll() {} },
    renderAll() {}, renderAddWidgetModalList() {}, savePagesToStorage() {},
  };
  runInNewContext(functions, context);
  context.moveDesktopItemToPage({ fromPageId: 'all', toPageId: 'design', kind: 'widget', id: 'calendar' });
  assert.equal(state.widgetState.desktop.placements.find(p => p.id === 'calendar').pageId, 'design');
  context.handleDropOnDesktopCard({ fromPageId: 'all', toPageId: 'design', draggedKind: 'site', draggedId: 'first', targetKind: 'widget', targetId: 'calendar' });
  assert.deepEqual(model.getPagePlacements(state.widgetState.desktop, 'design').map(p => p.id), ['first', 'calendar']);
  context.removeWidgetFromDesktop('calendar');
  assert.equal(state.widgetState.layout.find(w => w.id === 'calendar').enabled, false);
  state.currentPageIndex = state.pages.findIndex(p => p.id === 'dev');
  context.addWidgetToCurrentPage('calendar');
  assert.equal(state.widgetState.desktop.placements.find(p => p.id === 'calendar').pageId, 'dev');
  assert.equal(saves.length, 4);
  validateWidgetDocument(state.widgetState);
  for (const patch of saves) validateWidgetDocument({ ...patch, todos: [] });
});
