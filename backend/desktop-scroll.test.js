import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
function actualFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}
const classes = () => ({ add() {}, remove() {}, toggle() {} });

test('page transform updates never reveal offscreen tabs or change document scroll', () => {
  const failScroll = () => assert.fail('page transform must not scroll the document');
  const pills = Array.from({ length: 3 }, (_, i) => ({
    classList: classes(), offsetLeft: i * 100, offsetWidth: 90, scrollIntoView: failScroll,
  }));
  const tabs = { scrollWidth: 300, clientWidth: 100, scrollLeft: 0, querySelectorAll: () => pills };
  const track = { style: { setProperty() {} }, querySelectorAll: () => pills };
  const nodes = { categoryTabs: tabs, springboardTrack: track };
  const context = { state: { currentPageIndex: 0, currentViewIndex: 0, pages: pills,
    screenViews: pills.map((_, categoryIndex) => ({ categoryIndex })) },
    document: { getElementById: id => nodes[id] }, window: { scrollTo: failScroll } };
  runInNewContext(['scrollActivePageTabHorizontally', 'goToPage', 'updatePageTurnTransform'].map(actualFunction).join('\n'), context);
  context.updatePageTurnTransform(80);
  context.goToPage(0);
  assert.equal(tabs.scrollLeft, 0, 'no horizontal tab adjustment for unchanged page');
  context.goToPage(2);
  assert.equal(tabs.scrollLeft, 195);
  context.updatePageTurnTransform(0);
  assert.equal(tabs.scrollLeft, 195);
});

test('vertical touch, taps and cancelled touches leave page transforms and native scrolling alone', () => {
  const listeners = new Map();
  const viewport = { classList: classes(), clientWidth: 375,
    addEventListener: (name, handler) => listeners.set(name, handler) };
  const track = { classList: classes() };
  let updates = 0;
  let commits = 0;
  const context = { state: { jiggleMode: false, currentPageIndex: 0, currentViewIndex: 0, screenViews: [1, 2], pages: [1, 2] },
    performance: { now: () => 100 }, cancelActivePageDrag: null,
    clearActiveLongPress() {}, updatePageTurnTransform() { updates++; }, goToView() { commits++; },
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById: id => ({ springboardViewport: viewport, springboardTrack: track, springboardStage: viewport })[id] },
  };
  runInNewContext(actualFunction('initSwipePageTurnGestures'), context);
  context.initSwipePageTurnGestures();
  const event = (x, y) => ({ pointerId: 1, pointerType: 'touch', clientX: x, clientY: y,
    target: { closest: () => null }, cancelable: true,
    preventDefault() { assert.fail('native vertical scrolling must remain enabled'); } });
  listeners.get('pointerdown')(event(120, 400));
  listeners.get('pointermove')(event(122, 280));
  listeners.get('pointerup')(event(122, 280));
  listeners.get('pointerdown')(event(120, 400));
  listeners.get('pointerup')(event(120, 400));
  listeners.get('pointerdown')(event(120, 400));
  listeners.get('pointercancel')(event(120, 400));
  assert.equal(updates, 0);
  assert.equal(commits, 0);
});

test('a touch swipe survives the old child implicit-capture loss and commits exactly one view', () => {
  const listeners = new Map();
  let captured = null;
  const surface = { classList: classes(), clientWidth: 375,
    addEventListener: (name, handler) => listeners.set(name, handler),
    setPointerCapture: id => { captured = id; }, hasPointerCapture: id => captured === id,
    releasePointerCapture: () => { captured = null; } };
  const track = { classList: classes() };
  const moves = [];
  const context = { state: { jiggleMode: false, currentPageIndex: 0, currentViewIndex: 0, pages: [1,2], screenViews: [1,2] },
    performance: { now: () => 100 }, cancelActivePageDrag: null, clearActiveLongPress() {},
    updatePageTurnTransform() {}, goToView: index => moves.push(index),
    window: { addEventListener() {} }, document: { addEventListener() {}, getElementById: id => ({ springboardViewport: surface, springboardTrack: track, springboardStage: surface })[id] } };
  runInNewContext(actualFunction('initSwipePageTurnGestures'), context);
  context.initSwipePageTurnGestures();
  const child = { closest: () => null };
  const e = x => ({ pointerId: 4, pointerType: 'touch', clientX: x, clientY: 250, target: child,
    cancelable: true, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  listeners.get('pointerdown')(e(300));
  listeners.get('pointermove')(e(150));
  assert.equal(captured, 4);
  // A browser transfers capture from the touched child to the stable gesture surface.
  // Its old child's lostpointercapture bubbles up; that is not a cancellation of the new capture.
  listeners.get('lostpointercapture')(e(150));
  listeners.get('pointerup')(e(100));
  assert.deepEqual(moves, [1]);
  const click = e(100); let prevented = false;
  click.preventDefault = () => { prevented = true; };
  listeners.get('click')(click);
  assert.equal(prevented, true, 'a completed swipe must not follow the card link');
});

test('render scroll restoration only repairs changed offsets and clamps a shorter document', () => {
  const calls = [];
  const context = { window: { scrollX: 0, scrollY: 700, innerHeight: 720,
    scrollTo: (...args) => calls.push(args) }, document: {
    documentElement: { scrollHeight: 1600 }, body: { scrollHeight: 1600 },
  } };
  runInNewContext(actualFunction('restoreClampedScrollOffsets'), context);
  context.restoreClampedScrollOffsets({ x: 0, y: 700 });
  assert.equal(calls.length, 0, 'do not interrupt native scroll momentum unnecessarily');
  context.window.scrollY = 0;
  context.restoreClampedScrollOffsets({ x: 0, y: 700 });
  assert.deepEqual(calls.pop(), [0, 700]);
  context.document.documentElement.scrollHeight = 1376;
  context.document.body.scrollHeight = 1376;
  context.restoreClampedScrollOffsets({ x: 0, y: 700 });
  assert.deepEqual(calls.pop(), [0, 656]);
});

test('background grid calibration waits until detail and settings close before measuring or rebuilding', () => {
  let frame = null;
  let measures = 0;
  const visible = new Set();
  const context = { state: { activeWidgetDetailId: null }, activeWidgetDetailRestore: {},
    postRenderMeasureRafId: null, desktopPointerDragController: null,
    document: { getElementById: id => ({ hidden: !visible.has(id) }) },
    requestAnimationFrame(fn) { frame = fn; return 1; },
    measureActualAvailableGridHeight() { measures++; return null; },
  };
  runInNewContext(['isAnyModalOrDetailOpen', 'schedulePostRenderGridCalibration'].map(actualFunction).join('\n'), context);
  const calibrate = () => { context.schedulePostRenderGridCalibration(); frame(); };
  calibrate(); assert.equal(measures, 0, 'do not steal a live component from its detail modal');
  context.activeWidgetDetailRestore = null;
  visible.add('widgetDetailModal');
  calibrate(); assert.equal(measures, 0);
  visible.clear(); visible.add('apiConfigModal');
  calibrate(); assert.equal(measures, 0, 'keyboard changes while settings are open must not rebuild the desktop');
  visible.clear();
  calibrate(); assert.equal(measures, 1, 'normal calibration resumes after the modal closes');
});
