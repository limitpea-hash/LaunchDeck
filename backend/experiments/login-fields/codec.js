export const CHUNK_CHARS = 3000;
export const MAX_PARTS = 16;
export const PREFIX = 'launchdeck_probe_';
export const ITEM_NAME = 'LaunchDeck 合成备份 · 字段验证';
const encoder = new TextEncoder();
const check = (ok, message) => { if (!ok) throw Error(message); };
async function collect(stream, limit) {
  const reader = stream.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; check(size <= limit, '数据超过实验限制'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const out = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
const sha256 = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
  b => b.toString(16).padStart(2, '0')).join('');
export async function fixture() {
  const sites = [];
  for (let i = 0; i < 50; i++) {
    const token = await sha256(encoder.encode(`synthetic-site-${i}`));
    sites.push({ id: `site_${token.slice(0, 16)}`, title: `合成网站 ${i + 1}`,
      url: `https://site-${i + 1}.example/path/${token}`, order: i, pinned: i < 8 });
  }
  return { format: 'launchdeck-login-field-probe', version: 1,
    page: { id: 'page_synthetic', title: '合成导航页', sites } };
}
export async function encodeFixture() {
  const data = await fixture();
  const raw = encoder.encode(JSON.stringify(data));
  const compressed = await collect(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')), 35000);
  const text = btoa(String.fromCharCode(...compressed));
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) parts.push(text.slice(i, i + CHUNK_CHARS));
  check(parts.length <= MAX_PARTS, '分段过多');
  const manifest = JSON.stringify({ format: 'launchdeck-login-field-probe', version: 1,
    parts: parts.length, characters: text.length, sha256: await sha256(encoder.encode(text)) });
  return { data, parts, manifest };
}
export async function decodeFields(manifestText, parts) {
  check(typeof manifestText === 'string' && manifestText.length <= 500, '缺少或超出长度的备份清单');
  const m = JSON.parse(manifestText);
  check(m?.format === 'launchdeck-login-field-probe' && m.version === 1 &&
    Number.isInteger(m.parts) && m.parts >= 1 && m.parts <= MAX_PARTS &&
    Number.isInteger(m.characters) && m.characters > 0 && m.characters <= MAX_PARTS * CHUNK_CHARS &&
    /^[a-f0-9]{64}$/.test(m.sha256), '清单格式不正确');
  check(Array.isArray(parts) && parts.length === m.parts && parts.every(p => typeof p === 'string' &&
    p.length > 0 && p.length <= CHUNK_CHARS), '分段缺失或长度不正确');
  const text = parts.join('');
  check(text.length === m.characters && /^[A-Za-z0-9+/]+={0,2}$/.test(text), '数据缺失、截断或编码不正确');
  check(await sha256(encoder.encode(text)) === m.sha256, '完整性校验失败');
  const compressed = Uint8Array.from(atob(text), char => char.charCodeAt(0));
  const raw = await collect(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')), 128 * 1024);
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  check(JSON.stringify(data) === JSON.stringify(await fixture()), '不是本实验的固定合成数据');
  return data;
}
export function importItem(encoded) {
  return { encrypted: false, items: [{ type: 1, name: ITEM_NAME,
    notes: '仅合成数据，无真实密码或导航。用于验证自定义隐藏字段自动填充。',
    favorite: false, login: { username: 'launchdeck-synthetic-backup', password: 'synthetic-only-no-account',
      uris: [{ uri: 'http://localhost:3008/', match: 3 }] },
    fields: [{ name: `${PREFIX}manifest`, value: encoded.manifest, type: 1 },
      ...encoded.parts.map((value, i) => ({ name: `${PREFIX}chunk_${i}`, value, type: 1 }))] }] };
}
