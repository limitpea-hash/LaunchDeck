import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { encodeFixture, decodeFields, importItem, CHUNK_CHARS } from './experiments/login-fields/codec.js';
import { createLoginProbeServer } from './experiments/login-fields/server.js';

test('synthetic navigation is chunked within a conservative custom field limit and restores exactly', async () => {
  const packet = await encodeFixture();
  assert.ok(packet.parts.length > 1, 'exercise multi-field autofill');
  assert.equal(packet.parts[0].length, CHUNK_CHARS);
  assert.deepEqual(await decodeFields(packet.manifest, packet.parts), packet.data);
  const item = importItem(packet).items[0];
  assert.equal(item.type, 1); assert.equal(item.login.uris[0].match, 3);
  assert.ok(item.fields.every(field => field.type === 1 && field.value.length <= CHUNK_CHARS));
});
test('missing, truncated, reordered, oversized or corrupted fields never yield a partial restore', async () => {
  const packet = await encodeFixture();
  await assert.rejects(decodeFields('', packet.parts));
  await assert.rejects(decodeFields(packet.manifest, packet.parts.slice(1)), /分段缺失/);
  await assert.rejects(decodeFields(packet.manifest, packet.parts.toReversed()));
  await assert.rejects(decodeFields(packet.manifest, packet.parts.map((part, i) => i ? part : part.slice(1))));
  await assert.rejects(decodeFields(packet.manifest, packet.parts.map((part, i) => i ? part : 'A'.repeat(3001))));
});

test('checksum-valid compressed bombs still fail the output bound', async () => {
  const text = gzipSync(Buffer.alloc(256 * 1024)).toString('base64');
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');
  const manifest = JSON.stringify({ format: 'launchdeck-login-field-probe', version: 1,
    parts: 1, characters: text.length, sha256: digest });
  await assert.rejects(decodeFields(manifest, [text]), /实验限制/);
});

test('field experiment serves fixed local assets and exposes no vault proxy or production API', async t => {
  const server = createLoginProbeServer();
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
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.equal((await get('/', 'HEAD')).body, '');
  assert.equal((await get('/', 'POST')).status, 403);
  assert.equal((await get('/', 'GET', `evil.example:${port}`)).status, 403);
  assert.equal((await get('/api/state')).status, 404);
  assert.equal((await get('/api/bitwarden')).status, 404);
  assert.equal((await get('/../../data/portal.sqlite')).status, 404);
});
