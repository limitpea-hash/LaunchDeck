import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { defaultWidgetState, validateWidgetDocument, validateWidgetPatch } from './features/widgets.js';
import { createFeatureStore } from './features/store.js';
import { createLocalDocuments } from './extension/runtime/documents.js';

function desktopFor(state = defaultWidgetState()) {
  return {
    schemaVersion: 1,
    pages: ['all', 'ai', 'design', 'dev', 'media', 'page_reading'].map((id, order) => ({
      id, title: id, icon: 'folder', isSystem: order < 5, order,
    })),
    placements: [
      { kind: 'site', id: 'example', pageId: 'all', order: 0 },
      ...state.layout.filter(w => w.enabled).map((w, i) => ({ kind: 'widget', id: w.id, pageId: i % 2 ? 'page_reading' : 'all', order: i + 1 })),
      { kind: 'site', id: 'example', pageId: 'dev', order: 0 },
    ],
  };
}

test('desktop accepts old documents and references, without requiring a site database or erasing custom pages', () => {
  const state = defaultWidgetState();
  assert.equal(state.desktop, null);
  validateWidgetDocument(state);
  delete state.desktop;
  validateWidgetDocument(state);
  state.desktop = desktopFor(state);
  validateWidgetDocument(state);
  assert.equal(state.desktop.placements.filter(p => p.id === 'example').length, 2);
});

test('desktop rejects ambiguous order, duplicate widgets, missing references and executable fields', () => {
  const original = defaultWidgetState();
  original.desktop = desktopFor(original);
  const mutations = [
    d => { d.desktop.schemaVersion = 2; },
    d => { d.desktop.pages[0].id = 'https://evil.test/page'; },
    d => { d.desktop.pages[0].isSystem = false; },
    d => { d.desktop.pages[1].order = 0; },
    d => { d.desktop.pages.pop(); },
    d => { d.desktop.pages[0].icon = '<svg onload=evil>'; },
    d => { d.desktop.placements[0].kind = 'script'; },
    d => { d.desktop.placements[0].id = '../calendar.js'; },
    d => { d.desktop.placements[0].pageId = 'unknown'; },
    d => { d.desktop.placements[0].order = -1; },
    d => { d.desktop.placements[0].order = 1; },
    d => { d.desktop.placements[0].html = '<script>evil()</script>'; },
    d => { d.desktop.placements.push({ ...d.desktop.placements[1], pageId: 'media', order: 0 }); },
    d => { d.desktop.placements.push({ ...d.desktop.placements[0], order: 100 }); },
    d => { d.layout[0].enabled = false; },
    d => { d.desktop.placements.splice(1, 1); },
    d => { d.desktop.placements[1].id = 'missing_widget'; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(original);
    mutate(candidate);
    assert.throws(() => validateWidgetDocument(candidate), error => error.status === 400);
  }
});

test('SQLite validates merged layout atomically and retains mixed positions on partial edits and conflicts', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createFeatureStore(db);
    const state = defaultWidgetState();
    const desktop = desktopFor(state);
    const patch = (value, rev) => store.patch('widgets', defaultWidgetState, value, `"${rev}"`, validateWidgetPatch, validateWidgetDocument);
    assert.equal(patch({ desktop }, 0).revision, 1);
    const hidden = state.layout.map((w, i) => ({ ...w, enabled: i !== 0 }));
    assert.throws(() => patch({ layout: hidden }, 1), error => error.status === 400);
    assert.equal(store.read('widgets', defaultWidgetState).revision, 1);
    const removed = { ...desktop, placements: desktop.placements.filter(p => !(p.kind === 'widget' && p.id === hidden[0].id)) };
    assert.equal(patch({ layout: hidden, desktop: removed }, 1).revision, 2);
    assert.deepEqual(patch({ todos: [{ id: 'keep', text: '保留内容', completed: false }] }, 2).state.desktop, removed);
    assert.throws(() => patch({ desktop }, 1), error => error.status === 409);
    assert.equal(store.read('widgets', defaultWidgetState).state.todos[0].text, '保留内容');
  } finally { db.close(); }
});

test('extension mixed desktop round-trips through worker recreation and backup without losing old backup support', async () => {
  const saved = {};
  const storage = {
    async get(key) { return structuredClone({ [key]: saved[key] }); },
    async set(value) { Object.assign(saved, structuredClone(value)); },
  };
  let documents = createLocalDocuments(storage);
  const initial = (await documents.read('widgets')).state;
  const desktop = desktopFor(initial);
  await documents.patch('widgets', { desktop }, '"0"');
  const hidden = initial.layout.map((w, i) => ({ ...w, enabled: i !== 0 }));
  await assert.rejects(documents.patch('widgets', { layout: hidden }, '"1"'), error => error.status === 400);
  assert.equal((await documents.read('widgets')).revision, 1);
  const backup = await documents.exportData();
  documents = createLocalDocuments(storage);
  await documents.importData(backup);
  assert.deepEqual((await documents.read('widgets')).state.desktop, desktop);
  const broken = structuredClone(backup);
  broken.widgets.desktop.placements[1].pageId = 'missing';
  await assert.rejects(documents.importData(broken), error => error.status === 400);
  assert.deepEqual((await documents.read('widgets')).state.desktop, desktop);
  const old = structuredClone(backup);
  delete old.widgets.desktop;
  await documents.importData(old);
  assert.equal((await documents.read('widgets')).state.layout.length, 6);
});
