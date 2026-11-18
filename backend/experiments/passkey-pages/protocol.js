// Experimental transport probe. No application data, storage, or login authority.
export const RP_ID = 'localhost';
export const MAX_BLOB_BYTES = 16 * 1024;
export const MAX_JSON_BYTES = 64 * 1024;
const FORMAT = 'launchdeck-passkey-page-probe';
export const FIXTURE_PAGES = Object.freeze([
  { id: 'page_probe_1', title: '测试分页一', sites: [
    { id: 'probe_site_1', title: '示例网站一', url: 'https://one.example/', order: 0, pinned: true },
    { id: 'probe_site_2', title: '示例网站二', url: 'https://two.example/', order: 1, pinned: false },
  ] },
  { id: 'page_probe_2', title: '测试分页二', sites: [
    { id: 'probe_site_3', title: '示例网站三', url: 'https://three.example/', order: 0, pinned: false },
  ] },
]);

function check(condition, message) { if (!condition) throw Error(message); }
function bytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw Error('提供者没有返回可读的数据字节');
}
async function collect(stream, limit) {
  const reader = stream.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(size <= limit, '数据超过实验的大小限制');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const out = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function encodePage(index, batchId) {
  check(Number.isInteger(index) && index >= 0 && index < FIXTURE_PAGES.length, '分页编号不正确');
  check(/^[a-f0-9]{32}$/.test(batchId), '批次标识不正确');
  const body = { format: FORMAT, version: 1, batchId, index,
    pageCount: FIXTURE_PAGES.length, page: FIXTURE_PAGES[index] };
  const content = JSON.stringify(body);
  const envelope = JSON.stringify({ content, sha256: await digest(new TextEncoder().encode(content)) });
  return collect(new Blob([envelope]).stream().pipeThrough(new CompressionStream('gzip')), MAX_BLOB_BYTES);
}
export async function decodePage(input) {
  const data = bytes(input);
  check(data.length > 0 && data.length <= MAX_BLOB_BYTES, '读取数据大小不正确');
  const plain = await collect(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_JSON_BYTES);
  const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  check(envelope && typeof envelope.content === 'string' && /^[a-f0-9]{64}$/.test(envelope.sha256), '不是分页测试备份');
  check(envelope.sha256 === await digest(new TextEncoder().encode(envelope.content)), '内容校验失败，不能导入');
  const body = JSON.parse(envelope.content);
  check(body && body.format === FORMAT && body.version === 1 && /^[a-f0-9]{32}$/.test(body.batchId), '备份版本或批次不正确');
  check(Number.isInteger(body.index) && body.index >= 0 && body.index < FIXTURE_PAGES.length &&
    body.pageCount === FIXTURE_PAGES.length, '分页编号不正确');
  // Only this fixed synthetic dataset can be previewed; never import into LaunchDeck.
  check(JSON.stringify(body.page) === JSON.stringify(FIXTURE_PAGES[body.index]), '内容不是本实验的合成分页');
  return body;
}
const challenge = () => crypto.getRandomValues(new Uint8Array(32));
export function createOptions(index, batchId) {
  check(Number.isInteger(index) && index >= 0 && index < FIXTURE_PAGES.length, '分页编号不正确');
  return { publicKey: {
    challenge: challenge(), rp: { id: RP_ID, name: 'LaunchDeck 分页备份实验' },
    user: { id: challenge(), name: `LaunchDeck-test-${batchId.slice(0, 8)}-${index + 1}`,
      displayName: `LaunchDeck 测试分页 ${index + 1}/${FIXTURE_PAGES.length}` },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    attestation: 'none', timeout: 60000, extensions: { largeBlob: { support: 'required' } },
  } };
}
export function verifyRegistration(credential) {
  check(credential?.type === 'public-key', '没有返回通行密钥');
  const id = bytes(credential.rawId);
  check(id.length > 0 && id.length <= 1024, '凭据标识不正确');
  check(credential.getClientExtensionResults?.().largeBlob?.supported === true,
    '所选提供者未确认支持 largeBlob。创建凭据不代表页面已保存，停止写入。');
  return new Uint8Array(id);
}
export function getOptions({ credentialId, write, read = false } = {}) {
  check(!(write && read), '不能同时请求写入和读取');
  check(write || read, '缺少读写操作');
  const publicKey = { rpId: RP_ID, challenge: challenge(), timeout: 60000,
    userVerification: 'preferred', extensions: {} };
  if (credentialId) publicKey.allowCredentials = [{ type: 'public-key', id: bytes(credentialId) }];
  if (write) {
    const data = bytes(write);
    check(credentialId && data.length > 0 && data.length <= MAX_BLOB_BYTES, '写入需要单个明确凭据及有效数据');
    publicKey.extensions.largeBlob = { write: data };
  } else publicKey.extensions.largeBlob = { read: true };
  return { publicKey };
}
export function verifyWrite(credential, expectedId) {
  check(credential?.type === 'public-key', '没有返回通行密钥');
  const actual = bytes(credential.rawId); const expected = bytes(expectedId);
  check(actual.length === expected.length && actual.every((b, i) => b === expected[i]), '提供者返回了不同凭据');
  check(credential.getClientExtensionResults?.().largeBlob?.written === true,
    '提供者没有确认页面写入成功，不能标记为已备份');
}
export async function verifyRead(credential, expectedData) {
  check(credential?.type === 'public-key', '没有返回通行密钥');
  const blob = credential.getClientExtensionResults?.().largeBlob?.blob;
  const actual = bytes(blob);
  if (expectedData) {
    const expected = bytes(expectedData);
    check(actual.length === expected.length && actual.every((b, i) => b === expected[i]), '读回字节与原分页不同，不能导入');
  }
  return decodePage(actual);
}
