import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { request } from 'node:http';
import { createProbeServer } from './experiments/passkey-pages/server.js';
import { encodePage, decodePage, createOptions, getOptions, verifyRegistration,
  verifyWrite, verifyRead, MAX_BLOB_BYTES } from './experiments/passkey-pages/protocol.js';

const batch = 'a'.repeat(32);
const id = new Uint8Array([1, 2, 3]);
const credential = extensions => ({ type: 'public-key', rawId: id.buffer,
  getClientExtensionResults: () => extensions });

test('each synthetic page can be independently compressed and restored with batch and page metadata', async () => {
  for (let index = 0; index < 2; index++) {
    const data = await encodePage(index, batch);
    assert.ok(data.length > 64, 'even a tiny page exceeds userHandle capacity');
    const page = await decodePage(data);
    assert.equal(page.index, index); assert.equal(page.pageCount, 2); assert.equal(page.batchId, batch);
    assert.equal(page.page.sites[0].order, 0);
  }
});
test('creating a passkey without explicit largeBlob support is not a saved page', () => {
  const options = createOptions(0, batch).publicKey;
  assert.equal(options.user.id.length, 32);
  assert.equal(options.authenticatorSelection.residentKey, 'required');
  assert.equal(options.extensions.largeBlob.support, 'required');
  assert.throws(() => verifyRegistration(credential({ credProps: { rk: true } })), /未确认支持/);
  assert.throws(() => verifyRegistration(credential({ largeBlob: { supported: false } })), /未确认支持/);
  assert.deepEqual(verifyRegistration(credential({ largeBlob: { supported: true } })), id);
});
test('write requires a single known credential and an explicit success response', async () => {
  const data = await encodePage(0, batch);
  assert.throws(() => getOptions({ write: data }), /单个明确凭据/);
  const options = getOptions({ credentialId: id, write: data }).publicKey;
  assert.equal(options.allowCredentials.length, 1);
  assert.throws(() => verifyWrite(credential({}), id), /没有确认/);
  assert.throws(() => verifyWrite(credential({ largeBlob: { written: false } }), id), /没有确认/);
  verifyWrite(credential({ largeBlob: { written: true } }), id);
  assert.throws(() => verifyWrite(credential({ largeBlob: { written: true } }), new Uint8Array([9])), /不同凭据/);
});
test('import can invoke discoverable selection but cannot accept missing or mismatched payloads', async () => {
  assert.equal(getOptions({ read: true }).publicKey.allowCredentials, undefined);
  await assert.rejects(verifyRead(credential({})), /没有返回可读/);
  const data = await encodePage(0, batch);
  const page = await verifyRead(credential({ largeBlob: { blob: data.buffer } }), data);
  assert.equal(page.index, 0);
  await assert.rejects(verifyRead(credential({ largeBlob: { blob: data.buffer } }), await encodePage(1, batch)), /不同/);
});
test('corrupt, oversized, and compressed bomb payloads are rejected before preview', async () => {
  const data = await encodePage(0, batch);
  const changed = Uint8Array.from(data); changed[changed.length - 1] ^= 1;
  await assert.rejects(decodePage(changed));
  await assert.rejects(decodePage(new Uint8Array(MAX_BLOB_BYTES + 1)), /大小/);
  await assert.rejects(decodePage(gzipSync(Buffer.alloc(128 * 1024))), /大小限制/);
  const forged = gzipSync(JSON.stringify({ content: '{}', sha256: '0'.repeat(64) }));
  await assert.rejects(decodePage(forged), /校验失败/);
});

test('experiment server only serves fixed local files, rejects foreign hosts and exposes no data API', async t => {
  const server = createProbeServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const get = (path, method = 'GET', host = `localhost:${port}`) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method,
      headers: { Host: host, Connection: 'close' } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', data => { body += data; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject); req.end();
  });
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /仅使用两个合成测试页面/);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.equal((await get('/', 'HEAD')).body, '');
  assert.equal((await get('/', 'POST')).status, 403);
  assert.equal((await get('/', 'GET', `evil.example:${port}`)).status, 403);
  assert.equal((await get('/api/state')).status, 404);
  assert.equal((await get('/../../data/portal.sqlite')).status, 404);
});
