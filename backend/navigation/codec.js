import { check, record } from '../features/schema.js';
import { MAX_NAVIGATION_BYTES, validateNavigationBackup } from './schema.js';
export { MAX_NAVIGATION_BYTES, validateNavigationBackup, createNavigationBackup, navigationSummary, mergeNavigationSites } from './schema.js';

export const CHUNK_CHARS = 3000;
export const MAX_CHUNKS = 16;
export const MANIFEST_FIELD = 'launchdeck_nav_manifest';
export const CHUNK_PREFIX = 'launchdeck_nav_chunk_';
const PACKET_FORMAT = 'launchdeck-bitwarden-navigation';
const textEncoder = new TextEncoder();
async function sha(bytes) {
  check(globalThis.crypto?.subtle, '备份功能需要HTTPS或localhost安全环境');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
async function collect(stream, limit) {
  const reader = stream.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; check(size <= limit, '备份解压或编码超过大小限制'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const out = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { out.set(part, offset); offset += part.length; } return out;
}
export async function encodeNavigationBackup(backup) {
  validateNavigationBackup(backup);
  const raw = textEncoder.encode(JSON.stringify(backup));
  const zipped = await collect(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')), MAX_NAVIGATION_BYTES);
  // Avoid argument-count limits for large, incompressible input.
  let binary = ''; for (let i = 0; i < zipped.length; i += 8192) binary += String.fromCharCode(...zipped.subarray(i, i + 8192));
  const text = btoa(binary);
  check(text.length <= MAX_CHUNKS * CHUNK_CHARS, '备份超过Bitwarden分段上限，请改用导航JSON文件');
  const chunks = []; for (let i = 0; i < text.length; i += CHUNK_CHARS) chunks.push(text.slice(i, i + CHUNK_CHARS));
  const manifest = JSON.stringify({ format: PACKET_FORMAT, version: 1, codec: 'gzip-base64',
    backupId: backup.backupId, chunks: chunks.length, characters: text.length, sha256: await sha(textEncoder.encode(text)) });
  return { manifest, chunks };
}
export async function decodeNavigationPacket(packet) {
  record(packet, ['manifest', 'chunks'], '分段备份');
  check(typeof packet.manifest === 'string' && packet.manifest.length <= 1000, '备份清单缺失或过大');
  const manifest = JSON.parse(packet.manifest);
  record(manifest, ['format', 'version', 'codec', 'backupId', 'chunks', 'characters', 'sha256'], '备份清单');
  check(manifest.format === PACKET_FORMAT && manifest.version === 1 && manifest.codec === 'gzip-base64', '备份清单版本不支持');
  check(/^[a-f0-9]{32}$/.test(manifest.backupId) && /^[a-f0-9]{64}$/.test(manifest.sha256), '备份标识或校验值不正确');
  check(Number.isInteger(manifest.chunks) && manifest.chunks >= 1 && manifest.chunks <= MAX_CHUNKS &&
    Number.isInteger(manifest.characters) && manifest.characters > 0 && manifest.characters <= MAX_CHUNKS * CHUNK_CHARS, '分段数量或总长度不正确');
  check(Array.isArray(packet.chunks) && packet.chunks.length === manifest.chunks && packet.chunks.every((part, i) =>
    typeof part === 'string' && part.length > 0 && part.length <= CHUNK_CHARS &&
    (i === packet.chunks.length - 1 || part.length === CHUNK_CHARS)), '分段缺失、顺序或长度不正确');
  const text = packet.chunks.join('');
  check(text.length === manifest.characters && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text), '备份编码不正确或被截断');
  check(await sha(textEncoder.encode(text)) === manifest.sha256, '备份完整性校验失败');
  const raw = await collect(new Blob([Uint8Array.from(atob(text), c => c.charCodeAt(0))]).stream()
    .pipeThrough(new DecompressionStream('gzip')), MAX_NAVIGATION_BYTES);
  const backup = validateNavigationBackup(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  check(backup.backupId === manifest.backupId, '清单与备份批次不一致'); return backup;
}
export function encodeBackupText(packet) { return `LDNAV1:${JSON.stringify(packet)}`; }
export async function decodeBackupText(text) {
  check(typeof text === 'string' && textEncoder.encode(text).length <= 2 * MAX_NAVIGATION_BYTES, '备份文本不能超过2MiB');
  const value = JSON.parse(text.trim().replace(/^LDNAV1:/, ''));
  if (value?.format === 'launchdeck-navigation') return validateNavigationBackup(value);
  if (value && Object.hasOwn(value, 'items')) {
    check(value.encrypted === false && Array.isArray(value.items) && value.items.length === 1, '只支持LaunchDeck单条备份，请勿导入整个密码库');
    const item = value.items[0];
    check(item?.type === 1 && typeof item.name === 'string' && item.name.startsWith('LaunchDeck 导航备份') &&
      Array.isArray(item.fields) && item.fields.length >= 2 && item.fields.length <= MAX_CHUNKS + 1, '不是LaunchDeck专用备份条目');
    const fields = new Map();
    for (const field of item.fields) {
      check(field && field.type === 1 && typeof field.name === 'string' && !fields.has(field.name) &&
        (field.name === MANIFEST_FIELD || /^launchdeck_nav_chunk_(?:[0-9]|1[0-5])$/.test(field.name)), '自定义字段重复或包含未知内容');
      check(typeof field.value === 'string' && field.value.length <= (field.name === MANIFEST_FIELD ? 1000 : CHUNK_CHARS), '备份字段过大或格式不正确');
      fields.set(field.name, field.value);
    }
    check(fields.has(MANIFEST_FIELD), '备份清单缺失');
    const count = JSON.parse(fields.get(MANIFEST_FIELD))?.chunks;
    check(Number.isInteger(count) && count >= 1 && count <= MAX_CHUNKS, '备份分段数量不正确');
    check(fields.size === count + 1, '备份包含额外或缺失分段');
    return decodeNavigationPacket({ manifest: fields.get(MANIFEST_FIELD), chunks: Array.from({ length: count }, (_, i) => fields.get(`${CHUNK_PREFIX}${i}`)) });
  }
  return decodeNavigationPacket(value);
}
export async function createBitwardenImport(backup, restoreUrl) {
  const url = new URL(restoreUrl);
  check(['https:', 'http:', 'chrome-extension:', 'moz-extension:'].includes(url.protocol) && !url.username && !url.password &&
    url.pathname.endsWith('/restore.html') && !url.search && !url.hash, '恢复页地址必须为不含令牌的独立restore.html');
  const packet = await encodeNavigationBackup(backup); const text = encodeBackupText(packet);
  return { encrypted: false, items: [{ type: 1,
    name: `LaunchDeck 导航备份 · ${backup.exportedAt.slice(0, 19).replace('T', ' ')} UTC`,
    notes: text.length <= 6000 ? text : '此备份有多段隐藏字段，请在网页版自动填充，或复制清单及分段到扩展恢复页。',
    favorite: false, login: { username: `launchdeck-${backup.backupId.slice(0, 12)}`, password: 'LaunchDeck-navigation-backup',
      uris: [{ uri: url.href, match: 3 }] },
    fields: [{ name: MANIFEST_FIELD, value: packet.manifest, type: 1 },
      ...packet.chunks.map((value, i) => ({ name: `${CHUNK_PREFIX}${i}`, value, type: 1 }))] }] };
}
