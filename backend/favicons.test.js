import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { faviconPageUrl, browserFaviconUrl, presetIconKey, installFaviconEnhancement } from './extension/runtime/favicons.js';
import { extractIconPresets, projectRoot } from './extension/build.js';
import { createExtensionApi, RPC_CHANNEL } from './extension/runtime/api.js';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const PRESETS = { icons: { github: '<svg><path d="M0 0"/></svg>' }, domains: { 'github.com': 'github' } };

test('native favicon URLs stay inside this extension and remove credentials, paths, query tokens and fragments', () => {
  assert.equal(faviconPageUrl('https://example.com/private?token=secret#document'), 'https://example.com/');
  const url = new URL(browserFaviconUrl('https://example.com/private?token=secret', { extensionId: ID }));
  assert.equal(url.protocol, 'chrome-extension:');
  assert.equal(url.host, ID);
  assert.equal(url.pathname, '/_favicon/');
  assert.equal(url.searchParams.get('pageUrl'), 'https://example.com/');
  assert.equal(url.searchParams.get('size'), '64');
  assert.doesNotMatch(url.href, /private|secret/);
  for (const input of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///private/test', 'chrome://settings/', 'https://user:password@example.com', '/relative']) {
    assert.throws(() => browserFaviconUrl(input, { extensionId: ID }), error => error.status === 400);
  }
  for (const size of [-1, 0, 17, 9999, '64']) assert.throws(() => browserFaviconUrl('https://example.com', { extensionId: ID, size }));
  assert.throws(() => browserFaviconUrl('https://example.com', { extensionId: '../../evil' }));
});

test('preset lookup uses exact domains and explicit owned keys, never lookalikes or inherited properties', () => {
  assert.equal(presetIconKey({ url: 'https://www.github.com/path' }, PRESETS), 'github');
  assert.equal(presetIconKey({ url: 'https://unknown.example', iconKey: 'github' }, PRESETS), 'github');
  for (const url of ['https://github.com.evil.example', 'https://evil.github.com', 'https://github.com@evil.example', 'javascript:alert(1)']) assert.equal(presetIconKey({ url }, PRESETS), null);
  assert.equal(presetIconKey({ url: 'https://unknown.example', iconKey: 'constructor' }, PRESETS), null);
});

test('build extracts only reviewed local SVG constants and rejects executable or externally linked icon data', async () => {
  const source = await readFile(join(projectRoot, 'frontend/app.js'), 'utf8');
  const presets = extractIconPresets(source);
  assert.equal(presets.domains['github.com'], 'github');
  assert.ok(presets.icons.chatgpt.startsWith('<svg'));
  assert.ok(Object.keys(presets.icons).length >= 20);
  for (const payload of ['<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"></svg>', '<svg><image href="https://evil.test/a"/></svg>', '<svg>${danger()}</svg>']) {
    const altered = source.replace(/chatgpt:\s*`[^`]+`/, `chatgpt: \`${payload}\``);
    assert.throws(() => extractIconPresets(altered), /预设图标/);
  }
});

test('favicon local API checks native permission without fetching websites or widening host access', async () => {
  const values = {};
  const storage = { get: async key => ({ [key]: values[key] }), set: async data => Object.assign(values, data) };
  let granted = false;
  const permissions = { contains: async request => { assert.deepEqual(request, { permissions: ['favicon'] }); return granted; } };
  const api = createExtensionApi({ storage, permissions, extensionId: ID, environment: {} });
  const sender = { id: ID, url: `chrome-extension://${ID}/index.html` };
  const message = { channel: RPC_CHANNEL, path: '/api/icons/favicon?pageUrl=https%3A%2F%2Fexample.com%2Fprivate%3Ftoken%3Dsecret&size=64', method: 'GET' };
  assert.equal((await api(message, sender)).status, 403);
  granted = true;
  const response = await api(message, sender);
  assert.equal(response.status, 200);
  assert.equal(response.body.source, 'browser-favicon');
  assert.equal(response.body.pageUrl, 'https://example.com/');
  assert.match(response.body.imageUrl, /^chrome-extension:\/\//);
  assert.doesNotMatch(response.body.imageUrl, /secret|private/);
  assert.deepEqual(values, {});
  assert.equal((await api({ ...message, path: '/api/icons/favicon?pageUrl=https://example.com&url=https://evil.test' }, sender)).status, 400);
});

function fakeDocument(urls) {
  const wrappers = urls.map(url => {
    const wrapper = {
      isConnected: true, dataset: {}, children: [], svg: false, letter: { hidden: false },
      closest: () => ({ href: url }),
      querySelector(selector) {
        if (selector === '.app-glyph-letter') return this.letter;
        return this.svg || this.children.find(child => child.className === 'app-browser-favicon') || null;
      },
      appendChild(child) { this.children.push(child); child.parent = this; },
      set innerHTML(value) { this.svg = value; this.children = []; },
    };
    return wrapper;
  });
  const document = { body: {}, querySelectorAll: () => wrappers,
    createElement: () => ({ hidden: false, naturalWidth: 32, naturalHeight: 32, setAttribute() {},
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); } }),
  };
  let disconnected = false;
  class Observer { observe() {} disconnect() { disconnected = true; } }
  return { document, wrappers, Observer, isDisconnected: () => disconnected };
}

test('icon rendering upgrades known domains, loads native favicon, and retains text on failure with explicit retry', async t => {
  const fake = fakeDocument(['https://github.com/extra', 'https://unknown.example/private?token=secret', 'https://failure.example/']);
  const enhancer = installFaviconEnhancement({ document: fake.document, MutationObserver: fake.Observer, extensionId: ID, presets: PRESETS });
  t.after(() => enhancer.destroy());
  await Promise.resolve();
  const [preset, native, failed] = fake.wrappers;
  assert.equal(preset.dataset.browserIconState, 'preset');
  assert.equal(preset.svg, PRESETS.icons.github);
  assert.equal(preset.children.length, 0);
  const image = native.children[0];
  assert.equal(image.loading, 'eager');
  assert.equal(native.letter.hidden, false);
  assert.doesNotMatch(image.src, /private|secret/);
  image.onload();
  assert.equal(native.letter.hidden, true);
  assert.equal(image.hidden, false);
  assert.equal(native.dataset.browserIconState, 'ready');
  failed.children[0].onerror();
  assert.equal(failed.letter.hidden, false);
  assert.equal(failed.children.length, 0);
  assert.equal(failed.dataset.browserIconState, 'failed');
  enhancer.refresh(); await Promise.resolve();
  assert.equal(failed.children.length, 1);
  enhancer.destroy();
  assert.equal(fake.isDisconnected(), true);
  assert.equal(failed.children.length, 0);
});

test('folder thumbnails use the same native favicon validation without sending private paths or executing URLs', async t => {
  const urls=['https://custom.example/private?token=secret','javascript:alert(1)'];
  const fake=fakeDocument(urls);
  fake.wrappers.forEach((wrapper,index)=>{
    wrapper.closest=selector=>selector.startsWith('.folder-mini-icon')?{dataset:{siteUrl:urls[index]}}:null;
  });
  const enhancer=installFaviconEnhancement({document:fake.document,MutationObserver:fake.Observer,extensionId:ID,presets:PRESETS});
  t.after(()=>enhancer.destroy());await Promise.resolve();
  const [valid,invalid]=fake.wrappers;
  assert.equal(valid.children.length,1);
  assert.equal(new URL(valid.children[0].src).searchParams.get('pageUrl'),'https://custom.example/');
  assert.doesNotMatch(valid.children[0].src,/private|secret/);
  assert.equal(invalid.children.length,0);assert.equal(invalid.letter.hidden,false);
});
