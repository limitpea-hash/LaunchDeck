import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  readWallpaperImageInfo, validateWallpaperDimensions, normalizeWallpaperBlob,
  createLocalWallpaperController, MAX_WALLPAPER_FILE_BYTES,
} from '../frontend/lib/local-wallpaper.js';

// Image decoders validate the compressed stream and CRC. These bounded headers
// exercise the earlier allocation gate independently of a browser decoder.
function png(width = 320, height = 180) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const chunk = (type, payload) => {
    const out = Buffer.alloc(payload.length + 12);
    out.writeUInt32BE(payload.length); out.write(type, 4);
    payload.copy(out, 8); return out;
  };
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0]))),
    chunk('IEND', Buffer.alloc(0))]);
}
function jpeg(width = 320, height = 180) {
  const b = Buffer.from('ffd8ffc0000b080000000001011100ffd9', 'hex');
  b.writeUInt16BE(height, 7); b.writeUInt16BE(width, 9); return b;
}
function webp(kind, width = 320, height = 180) {
  let body;
  if (kind === 'VP8 ') {
    body = Buffer.from('0000009d012a00000000', 'hex');
    body.writeUInt16LE(width, 6); body.writeUInt16LE(height, 8);
  } else {
    body = Buffer.alloc(5); body[0] = 0x2f;
    body.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  }
  const out = Buffer.alloc(20 + body.length + (body.length & 1));
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4);
  out.write('WEBP', 8); out.write(kind, 12); out.writeUInt32LE(body.length, 16);
  body.copy(out, 20); return out;
}

test('wallpaper signatures and header dimensions are checked without trusting file labels', () => {
  for (const bytes of [png(), jpeg(), webp('VP8 '), webp('VP8L')]) {
    const info = readWallpaperImageInfo(bytes);
    assert.equal(info.ok, true, info.message);
    assert.equal(info.width, 320); assert.equal(info.height, 180);
    assert.equal(readWallpaperImageInfo(bytes.subarray(0, Math.min(18, bytes.length - 3))).ok, false);
  }
  for (const input of ['https://example.com/a.png', Buffer.from('<svg onload="alert(1)"></svg>'),
    Buffer.from('GIF89a'), Buffer.from('<html>'), Buffer.alloc(0), png(50000, 50000)]) {
    assert.equal(readWallpaperImageInfo(input).ok, false);
  }
  const badLength = webp('VP8 '); badLength.writeUInt32LE(0xffffffff, 16);
  assert.equal(readWallpaperImageInfo(badLength).ok, false);
  const badSegment = jpeg(); badSegment.writeUInt16BE(0xffff, 4);
  assert.equal(readWallpaperImageInfo(badSegment).ok, false);
});

test('wallpaper dimensions reject unsafe allocation sizes and accept exact limits', () => {
  for (const [w, h] of [[0, 1], [1.2, 1], [NaN, 1], [Infinity, 1], [16385, 1],
    [6001, 4000], ['320', 180], [Number.MAX_SAFE_INTEGER, 1]]) {
    assert.equal(validateWallpaperDimensions(w, h).ok, false);
  }
  assert.equal(validateWallpaperDimensions(6000, 4000).ok, true);
  assert.equal(validateWallpaperDimensions(16384, 1).ok, true);
});

test('animated WebP cannot reach the wallpaper decoder', async () => {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF'); bytes.writeUInt32LE(22, 4); bytes.write('WEBP', 8);
  bytes.write('VP8X', 12); bytes.writeUInt32LE(10, 16); bytes[20] = 2;
  assert.equal(readWallpaperImageInfo(bytes).ok, false);
  await assert.rejects(normalizeWallpaperBlob(new Blob([bytes]), {
    decodeImage() { assert.fail('animation must be rejected before decoding'); },
  }), { code: 'ANIMATED_WEBP_UNSUPPORTED' });
});

test('rejected uploads never reach the decoder; decoded mismatch releases resources', async () => {
  let decoded = 0; let closed = 0;
  const decodeImage = async () => { decoded++; return { width: 1, height: 1, close() { closed++; } }; };
  for (const file of [new Blob(['<svg/>'], { type: 'image/png' }), new Blob([png(50000, 50000)]),
    { size: MAX_WALLPAPER_FILE_BYTES + 1, arrayBuffer() { assert.fail('oversized file must not be read'); } }]) {
    await assert.rejects(normalizeWallpaperBlob(file, { decodeImage }));
  }
  assert.equal(decoded, 0);
  await assert.rejects(normalizeWallpaperBlob(new Blob([png()]), { decodeImage }), { code: 'DIMENSION_MISMATCH' });
  assert.equal(closed, 1);
});

test('normalization bounds output dimensions, reencodes verified bytes, and closes bitmaps', async () => {
  let closed = 0;
  const result = await normalizeWallpaperBlob(new Blob([png(6000, 4000)], { type: 'text/html' }), {
    decodeImage: async blob => {
      assert.equal(blob.type, 'image/png');
      return { width: 6000, height: 4000, source: 'bitmap', close() { closed++; } };
    },
    reencodeImage: async (source, width, height) => {
      assert.equal(source, 'bitmap'); assert.equal(width, 2560); assert.equal(height, 1707);
      return { blob: new Blob(['normalized'], { type: 'image/webp' }), width, height };
    },
  });
  assert.equal(result.blob.type, 'image/webp'); assert.equal(closed, 1);
});

test('JPEG decoder rotation retains bounded portrait photos while PNG mismatches remain rejected', async () => {
  const result = await normalizeWallpaperBlob(new Blob([jpeg()]), {
    decodeImage: async () => ({ width: 180, height: 320, close() {} }),
    reencodeImage: async (_source, width, height) => {
      assert.equal(width, 180); assert.equal(height, 320);
      return { blob: new Blob(['normalized'], { type: 'image/jpeg' }), width, height };
    },
  });
  assert.equal(result.width, 180); assert.equal(result.height, 320);
});

function controllerFixture(store, windowRef = null) {
  const nodes = new Map(); const revoked = []; let serial = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: true, disabled: false, dataset: {}, textContent: '', attrs: new Map(),
      addEventListener() {},
      setAttribute(k, v) { this.attrs.set(k, v); },
      getAttribute(k) { return this.attrs.get(k); }, removeAttribute(k) { this.attrs.delete(k); },
    });
    return nodes.get(id);
  };
  const normalized = { blob: new Blob([webp('VP8 ')], { type: 'image/webp' }),
    width: 320, height: 180, byteLength: 30 };
  const controller = createLocalWallpaperController({
    documentRef: { body: node('body'), getElementById: node }, windowRef, store,
    urlRef: { createObjectURL: () => `blob:test-${++serial}`, revokeObjectURL: url => revoked.push(url) },
    normalizeImage: async () => normalized,
  });
  return { controller, node, revoked };
}

test('preview and failed save preserve the applied wallpaper; cancel releases only preview URLs', async () => {
  let rejectSave = false;
  const { controller: c, node, revoked } = controllerFixture({ load: async () => null,
    save: async () => { if (rejectSave) throw Error('quota'); }, clear: async () => {} });
  await c.selectFile({}); await c.applyPreview();
  const original = node('customWallpaperImage').getAttribute('src');
  rejectSave = true;
  await c.selectFile({}); assert.equal(await c.applyPreview(), false);
  assert.equal(node('customWallpaperImage').getAttribute('src'), original);
  c.cancelPreview(); assert.equal(c.hasPendingPreview(), false);
  assert.equal(revoked.includes(original), false);
  c.destroy(); assert.equal(revoked.includes(original), true);
});

test('failed preset reset preserves both the current image and its persisted record', async () => {
  const { controller: c, node } = controllerFixture({ load: async () => null,
    save: async () => {}, clear: async () => { throw Error('transaction aborted'); } });
  await c.selectFile({}); await c.applyPreview();
  const original = node('customWallpaperImage').getAttribute('src');
  assert.equal(await c.clearCustomWallpaper(), false);
  assert.equal(c.isCustomWallpaperActive(), true);
  assert.equal(node('customWallpaperImage').getAttribute('src'), original);
});

test('switching to a preset waits for an earlier image write so reload cannot revive it', async () => {
  let disk = null; let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const { controller: c } = controllerFixture({ load: async () => disk,
    save: async record => { await saveGate; disk = record; },
    clear: async () => { disk = null; } });
  await c.selectFile({});
  const applying = c.applyPreview();
  const clearing = c.clearCustomWallpaper();
  releaseSave(); await Promise.all([applying, clearing]);
  assert.equal(disk, null, 'the most recent preset intent must persist after all writes finish');
  assert.equal(c.isCustomWallpaperActive(), false);
});

test('a stale initial load cannot replace a newly applied wallpaper', async () => {
  let releaseLoad;
  const loadGate = new Promise(resolve => { releaseLoad = resolve; });
  const { controller: c, node } = controllerFixture({ load: () => loadGate,
    save: async () => {}, clear: async () => {} });
  const loading = c.restoreFromStorage();
  await c.selectFile({}); await c.applyPreview();
  const original = node('customWallpaperImage').getAttribute('src');
  releaseLoad(null); await loading;
  assert.equal(c.isCustomWallpaperActive(), true);
  assert.equal(node('customWallpaperImage').getAttribute('src'), original);
});

test('page cache retains its active image, while a real page exit releases and clears it', async () => {
  const listeners = new Map();
  const { controller: c, node, revoked } = controllerFixture({ load: async () => null,
    save: async () => {}, clear: async () => {} }, {
    addEventListener: (event, listener) => listeners.set(event, listener),
  });
  c.bindDOMEvents();
  await c.selectFile({}); await c.applyPreview();
  const original = node('customWallpaperImage').getAttribute('src');
  listeners.get('pagehide')({ persisted: true });
  assert.equal(c.isCustomWallpaperActive(), true);
  assert.equal(revoked.includes(original), false);
  listeners.get('pagehide')({ persisted: false });
  assert.equal(c.isCustomWallpaperActive(), false);
  assert.equal(revoked.includes(original), true);
  assert.equal(node('customWallpaperImage').getAttribute('src'), undefined);
});
