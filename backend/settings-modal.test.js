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

test('opening settings restores the live widget before closing its parent and focuses without scrolling', () => {
  let restored = false;
  let focusCount = 0;
  let selectedTab;
  const widget = { classList: { remove() {} } };
  const parent = { insertBefore(node, placeholder) {
    assert.equal(node, widget, 'restore the existing widget, preserving its timers and form');
    assert.equal(placeholder, marker);
    restored = true;
  } };
  const marker = { parentNode: parent, remove() { this.parentNode = null; } };
  const settings = { hidden: true };
  const detail = { hidden: false };
  const failFocus = () => assert.fail('the old widget trigger must not steal focus');
  const closeButton = { focus(options) {
    assert.equal(options.preventScroll, true);
    assert.equal(settings.hidden, false);
    focusCount++;
  } };
  settings.querySelector = () => closeButton;
  const nodes = { apiConfigModal: settings, widgetDetailModal: detail, closeApiModalBtn: closeButton };
  const context = {
    state: { activeWidgetDetailId: 'clock-weather' },
    activeWidgetDetailRestore: {
      widgetEl: widget, originalParent: parent, placeholderNode: marker,
      triggerEl: { focus: failFocus },
    },
    document: { getElementById: id => nodes[id] },
    closeAllPopovers() {},
    toggleCustomizeSheet(open) { assert.equal(open, false); },
    closeCategoryOverflowModal(options) {
      assert.equal(restored, true, 'restore before clearing the parent overflow grid');
      assert.equal(options.recalibrateAfterClose, false);
    },
    closeFolderDetailModal(options) {
      assert.equal(restored, true);
      assert.equal(options.restoreFocus, false);
      assert.equal(options.recalibrateAfterClose, false);
    },
    schedulePostRenderGridCalibration() { assert.fail('opening settings must not rebuild the desktop'); },
    syncSettingsControlsFromState() {},
    switchSettingsTab(tab) { selectedTab = tab; },
  };
  runInNewContext(['closeWidgetDetailModal', 'openApiConfigModal'].map(actualFunction).join('\n'), context);
  context.openApiConfigModal('clock');
  assert.equal(detail.hidden, true);
  assert.equal(settings.hidden, false);
  assert.equal(context.activeWidgetDetailRestore, null);
  assert.equal(context.state.activeWidgetDetailId, null);
  assert.equal(selectedTab, 'clock');
  assert.equal(focusCount, 1);
});
