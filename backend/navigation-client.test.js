import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureClient } from '../frontend/lib/feature-client.js';
import { defaultWidgetState } from './features/widgets.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const reply = (body, status = 200) => ({ ok: status === 200, status, headers: new Headers(), json: async () => structuredClone(body) });

test('widget drain awaits in-flight writes and keeps later todos instead of reverting to the first response', async () => {
  let finish; const patches = [], saved = defaultWidgetState(); const store = storage();
  const client = createFeatureClient({ storage: store, fetchImpl: async (url, options) => {
    if (!options.method) return reply({ revision: 0, state: saved });
    const patch = JSON.parse(options.body); patches.push(patch);
    if (patches.length === 1) return new Promise(resolve => { finish = () => resolve(reply({ revision: 1, state: { ...saved, ...patch } })); });
    return reply({ revision: 2, state: { ...saved, ...patch } });
  } });
  await client.loadWidgetsState();
  client.saveWidgetsState({ todos: [{ id: 'a', text: 'first', completed: false }] });
  const first = client.flushWidgetsOutbox(); await Promise.resolve();
  const later = [{ id: 'a', text: 'later', completed: false }];
  client.saveWidgetsState({ todos: later });
  let done = false; const drain = client.flushWidgetsNow().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false);
  finish(); await Promise.all([first, drain]);
  assert.equal(patches.length, 2); assert.deepEqual(patches[1].todos, later);
  assert.deepEqual(client.getWidgetsStateSnapshot().todos, later);
  assert.equal(store.getItem('ios18_widgets_outbox_v1'), null);
});

test('widget drain preserves cache and pending todos on network, validation or conflict failure', async () => {
  for (const status of [503, 400, 409]) {
    const store = storage();
    const client = createFeatureClient({ storage: store, fetchImpl: async (url, options) => !options.method
      ? reply({ revision: 1, state: defaultWidgetState() }) : reply({ error: 'failure' }, status) });
    await client.loadWidgetsState();
    client.saveWidgetsState({ todos: [{ id: 'a', text: 'keep', completed: false }] });
    await assert.rejects(client.flushWidgetsNow(), error => error.status === status);
    assert.equal(JSON.parse(store.getItem('ios18_widgets_outbox_v1')).patch.todos[0].text, 'keep');
    assert.equal(client.getWidgetsStateSnapshot().todos[0].text, 'keep');
  }
});
