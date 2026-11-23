import { HttpError } from '../validation.js';
import { check } from './schema.js';

const ZIP_LIMIT = 32 * 1024 * 1024;
const DIRECTORY_LIMIT = 1024 * 1024;
const METADATA_LIMIT = 128 * 1024;
const EOCD_LENGTH = 22;
const CENTRAL_LENGTH = 46;
const LOCAL_LENGTH = 30;
const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const MARKER = '.launchdeck-generated.json';
const decoder = new TextDecoder('utf-8', { fatal: true });

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(part => part <= 65535) && parts.some(Boolean) ? parts : null;
}

function compareVersions(next, current) {
  const before = versionParts(current);
  if (!before) return 'unknown';
  const after = versionParts(next);
  for (let part = 0; part < 4; part++) {
    const difference = (after[part] ?? 0) - (before[part] ?? 0);
    if (difference) return difference > 0 ? 'newer' : 'older';
  }
  return 'same';
}

function safePath(name) {
  return /^[a-z0-9._/-]{1,240}$/i.test(name)
    && name.replace(/\/$/, '').split('/').every(part => part && part !== '.' && part !== '..');
}

function entryName(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new HttpError(400, '升级 ZIP 中的文件名编码不受支持');
  }
}

// Read only metadata in the conventional single-volume ZIP produced by the release builder.
async function zipDirectory(file) {
  const tailOffset = Math.max(0, file.size - (65535 + EOCD_LENGTH));
  const tail = new DataView(await file.slice(tailOffset).arrayBuffer());
  let end = tail.byteLength - EOCD_LENGTH;
  while (end >= 0) {
    if (tail.getUint32(end, true) === ZIP_END &&
        end + EOCD_LENGTH + tail.getUint16(end + 20, true) === tail.byteLength) break;
    end--;
  }
  check(end >= 0, 'ZIP 文件损坏或格式不受支持');
  const entries = tail.getUint16(end + 10, true);
  const length = tail.getUint32(end + 12, true);
  const start = tail.getUint32(end + 16, true);
  check(tail.getUint16(end + 4, true) === 0 && tail.getUint16(end + 6, true) === 0 &&
    tail.getUint16(end + 8, true) === entries && entries > 0 && entries <= 1024 &&
    length >= CENTRAL_LENGTH * entries && length <= DIRECTORY_LIMIT && start + length === tailOffset + end,
  'ZIP 目录损坏，或使用了不受支持的分卷、加密或 ZIP64 格式');
  const data = await file.slice(start, start + length).arrayBuffer();
  const directory = new DataView(data);
  const files = new Map();
  let cursor = 0;
  for (let index = 0; index < entries; index++) {
    check(cursor + CENTRAL_LENGTH <= length && directory.getUint32(cursor, true) === ZIP_CENTRAL,
      'ZIP 目录记录不完整');
    const header = new DataView(data, cursor, CENTRAL_LENGTH);
    const nameLength = header.getUint16(28, true);
    const next = cursor + CENTRAL_LENGTH + nameLength + header.getUint16(30, true) + header.getUint16(32, true);
    check(next <= length, 'ZIP 目录记录超出文件边界');
    const name = entryName(new Uint8Array(data, cursor + CENTRAL_LENGTH, nameLength));
    const key = name.toLowerCase();
    const flags = header.getUint16(8, true);
    const offset = header.getUint32(42, true);
    const mode = header.getUint32(38, true) >>> 16;
    const compressed = header.getUint32(20, true);
    check(safePath(name) && !files.has(key) && !(flags & 0x2041) && header.getUint16(34, true) === 0 &&
      (mode & 0o170000) !== 0o120000 && offset + LOCAL_LENGTH + nameLength + compressed <= start,
    'ZIP 包含不安全、重复或损坏的文件记录');
    files.set(key, {
      name, offset, flags, compressed, method: header.getUint16(10, true),
      size: header.getUint32(24, true), crc: header.getUint32(16, true),
    });
    cursor = next;
  }
  check(cursor === length, 'ZIP 目录长度不符');
  return { files, start };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readMetadata(file, entry, directoryStart) {
  check(entry && entry.size > 0 && entry.size <= METADATA_LIMIT && entry.compressed <= METADATA_LIMIT * 2 &&
    [0, 8].includes(entry.method), 'ZIP 清单缺失、过大或使用了不受支持的压缩格式');
  const local = new DataView(await file.slice(entry.offset, entry.offset + LOCAL_LENGTH).arrayBuffer());
  check(local.getUint32(0, true) === ZIP_LOCAL && local.getUint16(6, true) === entry.flags &&
    local.getUint16(8, true) === entry.method, 'ZIP 清单头与目录不一致');
  if (!(entry.flags & 8)) {
    check(local.getUint32(14, true) === entry.crc && local.getUint32(18, true) === entry.compressed &&
      local.getUint32(22, true) === entry.size, 'ZIP 清单大小或校验值不一致');
  }
  const nameStart = entry.offset + LOCAL_LENGTH;
  const nameEnd = nameStart + local.getUint16(26, true);
  const payloadStart = nameEnd + local.getUint16(28, true);
  const payloadEnd = payloadStart + entry.compressed;
  check(payloadEnd <= directoryStart, 'ZIP 清单超出文件边界');
  const name = entryName(new Uint8Array(await file.slice(nameStart, nameEnd).arrayBuffer()));
  check(name === entry.name, 'ZIP 清单文件名不一致');
  const payload = file.slice(payloadStart, payloadEnd);
  const bytes = new Uint8Array(entry.size);
  if (entry.method === 0) {
    check(payload.size === entry.size, 'ZIP 清单长度不符');
    bytes.set(new Uint8Array(await payload.arrayBuffer()));
  } else {
    let reader;
    try {
      reader = payload.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        check(length + value.byteLength <= bytes.length, 'ZIP 清单解压后超过限制');
        bytes.set(value, length);
        length += value.byteLength;
      }
      check(length === bytes.length, 'ZIP 清单解压长度不符');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'ZIP 清单无法解压');
    } finally {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }
  check(crc32(bytes) === entry.crc, 'ZIP 清单校验失败');
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new HttpError(400, 'ZIP 清单不是有效的 UTF-8 JSON');
  }
}

export async function inspectUpgradePackage(file, { currentVersion = null, expectedSha256 = '' } = {}) {
  check(file instanceof Blob && file.size >= EOCD_LENGTH && file.size <= ZIP_LIMIT, '请选择不超过 32 MiB 的升级 ZIP');
  check(typeof expectedSha256 === 'string', 'SHA-256 格式不正确');
  const expected = expectedSha256.trim().toLowerCase();
  check(!expected || /^[a-f0-9]{64}$/.test(expected), 'SHA-256 应为 64 位十六进制字符');
  const { files, start } = await zipDirectory(file);
  const manifest = await readMetadata(file, files.get('manifest.json'), start);
  const marker = await readMetadata(file, files.get(MARKER), start);
  check(marker?.generatedBy === 'LaunchDeck' && marker.schemaVersion === 1 &&
    manifest?.name === 'LaunchDeck' && manifest.manifest_version === 3 && versionParts(manifest.version) &&
    manifest.chrome_url_overrides?.newtab === 'index.html' && files.get('index.html')?.name === 'index.html' &&
    files.get('manifest.json')?.name === 'manifest.json' && files.get(MARKER)?.name === MARKER,
  '这个 ZIP 不是可识别的 LaunchDeck 安装包');
  if (expected) {
    check(globalThis.crypto?.subtle, '当前页面无法校验 SHA-256，请在扩展内或通过本机地址重试');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    check(hex === expected, 'SHA-256 不匹配，请重新获取安装包');
  }
  return {
    version: manifest.version,
    currentVersion: versionParts(currentVersion) ? currentVersion : null,
    comparison: compareVersions(manifest.version, currentVersion),
    integrity: expected ? 'matched' : 'unchecked',
  };
}
