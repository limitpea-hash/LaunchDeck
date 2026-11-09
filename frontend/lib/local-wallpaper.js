export const MAX_WALLPAPER_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_WALLPAPER_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_WALLPAPER_DIMENSION = 16384;
export const MAX_WALLPAPER_PIXELS = 24000000;
export const MAX_WALLPAPER_TARGET_EDGE = 2560;

export const ALLOWED_WALLPAPER_MIMES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export const WALLPAPER_IDB_DATABASE = 'launchdeck_local_wallpaper_db';
export const WALLPAPER_IDB_VERSION = 1;
export const WALLPAPER_IDB_STORE = 'custom_wallpapers';
export const WALLPAPER_IDB_KEY = 'active_wallpaper';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Array.isArray(input)) {
    return Uint8Array.from(input);
  }
  return null;
}

function readAscii(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    return '';
  }
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[offset + i]);
  }
  return out;
}

function createValidationFailure(code, message, extra = {}) {
  return {
    ok: false,
    valid: false,
    code,
    message,
    ...extra,
  };
}

export function validateWallpaperDimensions(width, height) {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return createValidationFailure(
      'INVALID_DIMENSIONS',
      '图片尺寸无效，宽高必须为正整数',
      { width, height, pixels: 0 }
    );
  }

  const pixels = width * height;
  if (width > MAX_WALLPAPER_DIMENSION || height > MAX_WALLPAPER_DIMENSION) {
    return createValidationFailure(
      'DIMENSION_LIMIT_EXCEEDED',
      `图片单边尺寸不能超过 ${MAX_WALLPAPER_DIMENSION} 像素`,
      { width, height, pixels }
    );
  }

  if (!Number.isSafeInteger(pixels) || pixels > MAX_WALLPAPER_PIXELS) {
    return createValidationFailure(
      'PIXEL_LIMIT_EXCEEDED',
      '图片总像素不能超过 2400 万像素',
      { width, height, pixels }
    );
  }

  return {
    ok: true,
    valid: true,
    code: 'OK',
    message: '',
    width,
    height,
    pixels,
  };
}

export function computeTargetWallpaperDimensions(
  width,
  height,
  maxEdge = MAX_WALLPAPER_TARGET_EDGE
) {
  const check = validateWallpaperDimensions(width, height);
  if (!check.ok) {
    const err = new Error(check.message || '图片尺寸无效');
    err.code = check.code;
    throw err;
  }

  const safeMaxEdge =
    Number.isInteger(maxEdge) && maxEdge >= 1 ? maxEdge : MAX_WALLPAPER_TARGET_EDGE;

  if (width <= safeMaxEdge && height <= safeMaxEdge) {
    return { width, height, scaled: false };
  }

  const scale = safeMaxEdge / Math.max(width, height);
  if (width >= height) {
    return {
      width: safeMaxEdge,
      height: Math.max(1, Math.round(height * scale)),
      scaled: true,
    };
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    scaled: true,
    height: safeMaxEdge,
  };
}

function isPngSignature(bytes) {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength) return false;
  for (let i = 0; i < PNG_SIGNATURE.byteLength; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function parsePngHeader(bytes, view) {
  // Minimum PNG: 8 (sig) + 25 (IHDR chunk) = 33 bytes
  if (bytes.byteLength < 33) {
    return createValidationFailure('CORRUPT_HEADER', 'PNG 文件头部不完整');
  }

  const ihdrLength = view.getUint32(8, false);
  const ihdrType = readAscii(bytes, 12, 4);
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') {
    return createValidationFailure('CORRUPT_HEADER', 'PNG 缺少合法的 IHDR 头信息');
  }

  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const compression = bytes[26];
  const filter = bytes[27];
  const interlace = bytes[28];

  const validBitDepths = new Set([1, 2, 4, 8, 16]);
  const validColorTypes = new Set([0, 2, 3, 4, 6]);
  if (
    !validBitDepths.has(bitDepth) ||
    !validColorTypes.has(colorType) ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1)
  ) {
    return createValidationFailure('CORRUPT_HEADER', 'PNG IHDR 参数不合法');
  }

  // Walk chunks up to IDAT/IEND to reject APNG animation chunks or truncated chunk bounds
  let offset = 8;
  let seenIdat = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      if (!seenIdat) {
        return createValidationFailure('CORRUPT_HEADER', 'PNG 数据块头部截断');
      }
      break;
    }
    const chunkLen = view.getUint32(offset, false);
    const chunkType = readAscii(bytes, offset + 4, 4);
    const nextOffset = offset + 12 + chunkLen;
    if (chunkLen > 0x7fffffff || nextOffset > bytes.byteLength) {
      return createValidationFailure('CORRUPT_HEADER', 'PNG 数据块长度越界或文件截断');
    }
    if (chunkType === 'acTL' || chunkType === 'fcTL' || chunkType === 'fdAT') {
      return createValidationFailure('ANIMATED_IMAGE_UNSUPPORTED', '不支持动画 PNG 壁纸');
    }
    if (chunkType === 'IDAT') {
      seenIdat = true;
    }
    if (chunkType === 'IEND') {
      break;
    }
    offset = nextOffset;
  }

  const dimResult = validateWallpaperDimensions(width, height);
  if (!dimResult.ok) {
    return {
      ...dimResult,
      format: 'png',
      mime: 'image/png',
      byteLength: bytes.byteLength,
    };
  }

  return {
    ok: true,
    valid: true,
    code: 'OK',
    message: '',
    format: 'png',
    mime: 'image/png',
    width,
    height,
    pixels: dimResult.pixels,
    byteLength: bytes.byteLength,
  };
}

function parseJpegHeader(bytes, view) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return createValidationFailure('CORRUPT_HEADER', 'JPEG 文件头部无效');
  }

  let offset = 2;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      return createValidationFailure('CORRUPT_HEADER', 'JPEG 段标记结构损坏');
    }

    while (offset < bytes.byteLength && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.byteLength) {
      return createValidationFailure('CORRUPT_HEADER', 'JPEG 段头部不完整');
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0x00) {
      return createValidationFailure('CORRUPT_HEADER', 'JPEG 段标记无效');
    }
    // Standalone markers without segment length
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    // Reached EOI or SOS before finding SOF
    if (marker === 0xd9 || marker === 0xda) {
      return createValidationFailure('CORRUPT_HEADER', 'JPEG 缺少有效的帧头尺寸信息');
    }

    if (offset + 2 > bytes.byteLength) {
      return createValidationFailure('CORRUPT_HEADER', 'JPEG 段长度字段截断');
    }

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      return createValidationFailure('CORRUPT_HEADER', 'JPEG 段长度超出文件边界');
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) {
        return createValidationFailure('CORRUPT_HEADER', 'JPEG SOF 帧头长度不足');
      }
      const precision = bytes[offset + 2];
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      const components = bytes[offset + 7];
      if (
        precision < 8 ||
        components < 1 ||
        segmentLength < 8 + components * 3
      ) {
        return createValidationFailure('CORRUPT_HEADER', 'JPEG SOF 帧头内容损坏');
      }

      const dimResult = validateWallpaperDimensions(width, height);
      if (!dimResult.ok) {
        return {
          ...dimResult,
          format: 'jpeg',
          mime: 'image/jpeg',
          byteLength: bytes.byteLength,
        };
      }

      return {
        ok: true,
        valid: true,
        code: 'OK',
        message: '',
        format: 'jpeg',
        mime: 'image/jpeg',
        width,
        height,
        pixels: dimResult.pixels,
        byteLength: bytes.byteLength,
      };
    }

    offset += segmentLength;
  }

  return createValidationFailure('CORRUPT_HEADER', 'JPEG 未包含可识别的尺寸帧头');
}

function parseVp8Dimensions(bytes, view, payloadOffset, chunkSize) {
  if (chunkSize < 10 || payloadOffset + 10 > bytes.byteLength) {
    return createValidationFailure('CORRUPT_HEADER', 'WebP VP8 帧头长度不足');
  }
  // Keyframe bit (bit 0 of frame tag) must be 0
  if ((bytes[payloadOffset] & 0x01) !== 0) {
    return createValidationFailure('CORRUPT_HEADER', 'WebP VP8 缺少关键帧头');
  }
  // VP8 start code: 0x9d 0x01 0x2a
  if (
    bytes[payloadOffset + 3] !== 0x9d ||
    bytes[payloadOffset + 4] !== 0x01 ||
    bytes[payloadOffset + 5] !== 0x2a
  ) {
    return createValidationFailure('CORRUPT_HEADER', 'WebP VP8 同步签名无效');
  }
  const width = view.getUint16(payloadOffset + 6, true) & 0x3fff;
  const height = view.getUint16(payloadOffset + 8, true) & 0x3fff;
  return { ok: true, width, height };
}

function parseVp8LDimensions(bytes, view, payloadOffset, chunkSize) {
  if (chunkSize < 5 || payloadOffset + 5 > bytes.byteLength) {
    return createValidationFailure('CORRUPT_HEADER', 'WebP VP8L 帧头长度不足');
  }
  if (bytes[payloadOffset] !== 0x2f) {
    return createValidationFailure('CORRUPT_HEADER', 'WebP VP8L 签名无效');
  }
  const bits = view.getUint32(payloadOffset + 1, true);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  return { ok: true, width, height };
}

function parseWebpHeader(bytes, view) {
  if (bytes.byteLength < 20) {
    return createValidationFailure('CORRUPT_HEADER', 'WebP 文件头部不完整');
  }

  const riffSize = view.getUint32(4, true);
  const riffEnd = riffSize + 8;
  if (riffSize < 12 || riffEnd > bytes.byteLength) {
    return createValidationFailure('CORRUPT_HEADER', 'WebP RIFF 容器长度越界或不完整');
  }

  const firstFourCC = readAscii(bytes, 12, 4);
  const firstChunkSize = view.getUint32(16, true);
  const firstPayloadOffset = 20;
  if (firstPayloadOffset + firstChunkSize > riffEnd) {
    return createValidationFailure('CORRUPT_HEADER', 'WebP 首数据块长度超出 RIFF 边界');
  }

  let width = 0;
  let height = 0;

  if (firstFourCC === 'VP8 ') {
    const parsed = parseVp8Dimensions(bytes, view, firstPayloadOffset, firstChunkSize);
    if (!parsed.ok) return parsed;
    width = parsed.width;
    height = parsed.height;
  } else if (firstFourCC === 'VP8L') {
    const parsed = parseVp8LDimensions(bytes, view, firstPayloadOffset, firstChunkSize);
    if (!parsed.ok) return parsed;
    width = parsed.width;
    height = parsed.height;
  } else if (firstFourCC === 'VP8X') {
    if (firstChunkSize !== 10) {
      return createValidationFailure('CORRUPT_HEADER', 'WebP VP8X 扩展头长度必须为 10 字节');
    }
    const flags = bytes[firstPayloadOffset];
    // Bit 1 (0x02) indicates Animation
    if ((flags & 0x02) !== 0) {
      return createValidationFailure('ANIMATED_WEBP_UNSUPPORTED', '不支持动画 WebP 壁纸');
    }
    // Reserved bits in VP8X flags (0xC1) and bytes 21..23 must be 0
    if (
      (flags & 0xc1) !== 0 ||
      bytes[firstPayloadOffset + 1] !== 0 ||
      bytes[firstPayloadOffset + 2] !== 0 ||
      bytes[firstPayloadOffset + 3] !== 0
    ) {
      return createValidationFailure('CORRUPT_HEADER', 'WebP VP8X 标志位不合法');
    }
    width =
      (bytes[firstPayloadOffset + 4] |
        (bytes[firstPayloadOffset + 5] << 8) |
        (bytes[firstPayloadOffset + 6] << 16)) +
      1;
    height =
      (bytes[firstPayloadOffset + 7] |
        (bytes[firstPayloadOffset + 8] << 8) |
        (bytes[firstPayloadOffset + 9] << 16)) +
      1;

    // Walk remaining chunks inside RIFF to verify bounds, reject ANIM/ANMF, and confirm bitstream chunk
    let offset = firstPayloadOffset + firstChunkSize + (firstChunkSize & 1);
    let hasImageChunk = false;
    while (offset < riffEnd) {
      if (offset + 8 > riffEnd) {
        return createValidationFailure('CORRUPT_HEADER', 'WebP 子数据块头部截断');
      }
      const chunkId = readAscii(bytes, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const payloadStart = offset + 8;
      const payloadEnd = payloadStart + chunkSize;
      if (payloadEnd > riffEnd) {
        return createValidationFailure('CORRUPT_HEADER', 'WebP 子数据块长度超出 RIFF 边界');
      }
      if (chunkId === 'ANIM' || chunkId === 'ANMF') {
        return createValidationFailure('ANIMATED_WEBP_UNSUPPORTED', '不支持动画 WebP 壁纸');
      }
      if (chunkId === 'VP8 ') {
        const sub = parseVp8Dimensions(bytes, view, payloadStart, chunkSize);
        if (!sub.ok) return sub;
        if (sub.width !== width || sub.height !== height) {
          return createValidationFailure('CORRUPT_HEADER', 'WebP VP8X 与帧尺寸不一致');
        }
        hasImageChunk = true;
      } else if (chunkId === 'VP8L') {
        const sub = parseVp8LDimensions(bytes, view, payloadStart, chunkSize);
        if (!sub.ok) return sub;
        if (sub.width !== width || sub.height !== height) {
          return createValidationFailure('CORRUPT_HEADER', 'WebP VP8X 与无损帧尺寸不一致');
        }
        hasImageChunk = true;
      }
      const paddedSize = chunkSize + (chunkSize & 1);
      if (payloadStart + paddedSize > riffEnd && payloadEnd < riffEnd) {
        return createValidationFailure('CORRUPT_HEADER', 'WebP 子数据块对齐字节越界');
      }
      offset = payloadStart + paddedSize;
    }

    if (!hasImageChunk) {
      return createValidationFailure('CORRUPT_HEADER', 'WebP VP8X 缺少图像帧数据块');
    }
  } else {
    return createValidationFailure('CORRUPT_HEADER', 'WebP 未包含有效的图像头');
  }

  const dimResult = validateWallpaperDimensions(width, height);
  if (!dimResult.ok) {
    return {
      ...dimResult,
      format: 'webp',
      mime: 'image/webp',
      byteLength: bytes.byteLength,
    };
  }

  return {
    ok: true,
    valid: true,
    code: 'OK',
    message: '',
    format: 'webp',
    mime: 'image/webp',
    width,
    height,
    pixels: dimResult.pixels,
    byteLength: bytes.byteLength,
  };
}

export function readWallpaperImageInfo(inputBytes) {
  if (typeof inputBytes === 'string') {
    return createValidationFailure(
      'UNSUPPORTED_FORMAT',
      '不支持远程 URL 或文本格式，请选择本地 PNG/JPEG/WebP 图片'
    );
  }

  const bytes = toUint8Array(inputBytes);
  if (!bytes) {
    return createValidationFailure('INVALID_INPUT', '未读取到有效的图片字节数据');
  }

  if (bytes.byteLength === 0) {
    return createValidationFailure('EMPTY_FILE', '图片文件为空');
  }

  if (bytes.byteLength > MAX_WALLPAPER_FILE_BYTES) {
    return createValidationFailure('FILE_TOO_LARGE', '壁纸文件不能超过 10 MiB');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (isPngSignature(bytes)) {
    return parsePngHeader(bytes, view);
  }

  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return parseJpegHeader(bytes, view);
  }

  if (
    bytes.byteLength >= 12 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WEBP'
  ) {
    return parseWebpHeader(bytes, view);
  }

  // Explicit rejection messages for common disallowed types (GIF, SVG/HTML/XML)
  const headAscii = readAscii(bytes, 0, Math.min(bytes.byteLength, 64)).trimStart().toLowerCase();
  if (headAscii.startsWith('gif87a') || headAscii.startsWith('gif89a')) {
    return createValidationFailure('UNSUPPORTED_FORMAT', '不支持 GIF 动图，请选择 PNG、JPEG 或静态 WebP');
  }
  if (
    headAscii.startsWith('<svg') ||
    headAscii.startsWith('<?xml') ||
    headAscii.startsWith('<!doctype') ||
    headAscii.startsWith('<html') ||
    headAscii.includes('<svg')
  ) {
    return createValidationFailure('UNSUPPORTED_FORMAT', '不支持 SVG 或 HTML 文件，请选择 PNG、JPEG 或静态 WebP');
  }

  return createValidationFailure(
    'UNSUPPORTED_FORMAT',
    '仅支持真实的 PNG、JPEG 或静态 WebP 图片格式'
  );
}

export function formatWallpaperByteSize(byteLength) {
  const bytes = Number(byteLength) || 0;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

async function defaultDecodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close() {
        try {
          bitmap.close?.();
        } catch {
          // ignore close errors
        }
      },
    };
  }

  if (typeof Image === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const tempUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const element = new Image();
        element.decoding = 'async';
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('图片解码失败'));
        element.src = tempUrl;
      });
      return {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        source: img,
        close() {
          URL.revokeObjectURL(tempUrl);
        },
      };
    } catch (error) {
      URL.revokeObjectURL(tempUrl);
      throw error;
    }
  }

  throw new Error('当前环境不支持图片解码');
}

async function canvasToBlob(canvas, mimeType, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('画布编码输出失败'));
        },
        mimeType,
        quality
      );
    });
  }
  throw new Error('当前环境不支持画布重编码');
}

function createEncodingCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  throw new Error('当前环境不支持 Canvas 图像处理');
}

async function defaultReencodeImage(decodedSource, targetWidth, targetHeight, preferredFormat) {
  const mimeCandidates =
    preferredFormat === 'jpeg'
      ? ['image/jpeg', 'image/webp']
      : ['image/webp', 'image/jpeg'];
  const qualitySteps = [0.9, 0.82, 0.74, 0.64, 0.52, 0.42];
  const scaleSteps = [1, 0.85, 0.72];

  for (const scale of scaleSteps) {
    const drawWidth = Math.max(1, Math.round(targetWidth * scale));
    const drawHeight = Math.max(1, Math.round(targetHeight * scale));
    const canvas = createEncodingCanvas(drawWidth, drawHeight);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('无法创建 2D 绘图上下文');
    }
    ctx.fillStyle = '#070913';
    ctx.fillRect(0, 0, drawWidth, drawHeight);
    ctx.drawImage(decodedSource, 0, 0, drawWidth, drawHeight);

    for (const mimeType of mimeCandidates) {
      for (const quality of qualitySteps) {
        let blob = null;
        try {
          blob = await canvasToBlob(canvas, mimeType, quality);
        } catch {
          continue;
        }
        if (
          blob &&
          (blob.type === 'image/webp' || blob.type === 'image/jpeg') &&
          blob.size > 0 &&
          blob.size <= MAX_WALLPAPER_OUTPUT_BYTES
        ) {
          return {
            blob,
            mime: blob.type,
            width: drawWidth,
            height: drawHeight,
            byteLength: blob.size,
          };
        }
      }
    }
  }

  const err = new Error('图片重编码后仍超过 2 MiB 限制，请换用更简洁的图片');
  err.code = 'OUTPUT_TOO_LARGE';
  throw err;
}

export async function normalizeWallpaperBlob(
  fileOrBlob,
  {
    decodeImage = defaultDecodeImage,
    reencodeImage = defaultReencodeImage,
    maxTargetEdge = MAX_WALLPAPER_TARGET_EDGE,
  } = {}
) {
  if (!fileOrBlob || typeof fileOrBlob.size !== 'number') {
    const err = new Error('请选择有效的本地图片文件');
    err.code = 'INVALID_INPUT';
    throw err;
  }

  if (fileOrBlob.size <= 0) {
    const err = new Error('图片文件为空');
    err.code = 'EMPTY_FILE';
    throw err;
  }

  if (fileOrBlob.size > MAX_WALLPAPER_FILE_BYTES) {
    const err = new Error('壁纸文件不能超过 10 MiB');
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  const buffer = await fileOrBlob.arrayBuffer();
  const headerInfo = readWallpaperImageInfo(buffer);
  if (!headerInfo.ok) {
    const err = new Error(headerInfo.message || '图片格式或尺寸不符合要求');
    err.code = headerInfo.code;
    throw err;
  }

  const verifiedSourceBlob = new Blob([buffer], { type: headerInfo.mime });
  let decoded = null;
  try {
    decoded = await decodeImage(verifiedSourceBlob, headerInfo);
    const decodedWidth = Number(decoded?.width);
    const decodedHeight = Number(decoded?.height);
    const decodedCheck = validateWallpaperDimensions(decodedWidth, decodedHeight);
    if (!decodedCheck.ok) {
      const err = new Error(decodedCheck.message || '解码后图片尺寸超出安全范围');
      err.code = decodedCheck.code;
      throw err;
    }

    const exactMatch =
      decodedWidth === headerInfo.width && decodedHeight === headerInfo.height;
    const exifRotatedJpegMatch =
      headerInfo.format === 'jpeg' &&
      decodedWidth === headerInfo.height &&
      decodedHeight === headerInfo.width;
    if (!exactMatch && !exifRotatedJpegMatch) {
      const err = new Error('图片文件头尺寸与实际解码尺寸不一致，已拒绝加载');
      err.code = 'DIMENSION_MISMATCH';
      throw err;
    }

    const targetDims = computeTargetWallpaperDimensions(
      decodedWidth,
      decodedHeight,
      maxTargetEdge
    );
    const encoded = await reencodeImage(
      decoded.source ?? decoded,
      targetDims.width,
      targetDims.height,
      headerInfo.format
    );

    if (
      !encoded?.blob ||
      encoded.blob.size <= 0 ||
      encoded.blob.size > MAX_WALLPAPER_OUTPUT_BYTES ||
      (encoded.blob.type !== 'image/webp' && encoded.blob.type !== 'image/jpeg')
    ) {
      const err = new Error('生成的壁纸超出 2 MiB 限制或格式异常');
      err.code = 'OUTPUT_INVALID';
      throw err;
    }

    return {
      blob: encoded.blob,
      mime: encoded.blob.type,
      width: encoded.width,
      height: encoded.height,
      originalWidth: decodedWidth,
      originalHeight: decodedHeight,
      byteLength: encoded.blob.size,
    };
  } finally {
    try {
      decoded?.close?.();
    } catch {
      // ignore cleanup error
    }
  }
}

export function createIndexedDbWallpaperStore({
  indexedDBRef = typeof indexedDB !== 'undefined' ? indexedDB : null,
  dbName = WALLPAPER_IDB_DATABASE,
  storeName = WALLPAPER_IDB_STORE,
  recordKey = WALLPAPER_IDB_KEY,
} = {}) {
  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!indexedDBRef || typeof indexedDBRef.open !== 'function') {
        reject(new Error('当前浏览器环境不支持 IndexedDB 本地存储'));
        return;
      }
      const request = indexedDBRef.open(dbName, WALLPAPER_IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('打开本地壁纸数据库失败'));
      request.onblocked = () => reject(new Error('本地壁纸数据库被占用'));
    });
  }

  return {
    dbName,
    storeName,
    recordKey,
    async load() {
      const db = await openDatabase();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.get(recordKey);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error || new Error('读取自定义壁纸失败'));
        });
      } finally {
        try {
          db.close();
        } catch {
          // ignore close errors
        }
      }
    },
    async save(record) {
      const db = await openDatabase();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          store.put(
            {
              key: recordKey,
              blob: record.blob,
              mime: record.mime || record.blob?.type || 'image/webp',
              width: record.width,
              height: record.height,
              byteLength: record.byteLength ?? record.blob?.size ?? 0,
              updatedAt: Date.now(),
            },
            recordKey
          );
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error || new Error('写入自定义壁纸失败'));
          tx.onabort = () => reject(tx.error || new Error('写入自定义壁纸事务中止'));
        });
      } finally {
        try {
          db.close();
        } catch {
          // ignore close errors
        }
      }
    },
    async clear() {
      const db = await openDatabase();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          store.delete(recordKey);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error || new Error('清理自定义壁纸失败'));
          tx.onabort = () => reject(tx.error || new Error('清理自定义壁纸事务中止'));
        });
      } finally {
        try {
          db.close();
        } catch {
          // ignore close errors
        }
      }
    },
  };
}

export function createLocalWallpaperController({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  urlRef = typeof URL !== 'undefined' ? URL : null,
  store = null,
  normalizeImage = normalizeWallpaperBlob,
  onWallPaperStateChange = null,
} = {}) {
  const wallpaperStore = store || createIndexedDbWallpaperStore();
  let operationToken = 0;
  let mutationToken = 0;
  let mutationQueue = Promise.resolve();
  let activeObjectUrl = null;
  let previewObjectUrl = null;
  let pendingPreview = null;
  let hasActiveCustomWallpaper = false;
  let isBusy = false;
  let isDestroyed = false;

  function enqueueMutation(task) {
    const run = mutationQueue.then(task, task);
    mutationQueue = run.catch(() => {});
    return run;
  }

  function getElements() {
    if (!documentRef) return {};
    return {
      body: documentRef.body,
      stageImg: documentRef.getElementById('customWallpaperImage'),
      fileInput: documentRef.getElementById('customWallpaperInput'),
      selectBtn: documentRef.getElementById('selectCustomWallpaperBtn'),
      restorePresetBtn: documentRef.getElementById('restorePresetWallpaperBtn'),
      previewPanel: documentRef.getElementById('customWallpaperPreviewPanel'),
      previewImg: documentRef.getElementById('customWallpaperPreviewImg'),
      previewMeta: documentRef.getElementById('customWallpaperPreviewMeta'),
      applyBtn: documentRef.getElementById('applyCustomWallpaperBtn'),
      cancelBtn: documentRef.getElementById('cancelCustomWallpaperBtn'),
      statusText: documentRef.getElementById('customWallpaperStatusText'),
    };
  }

  function createObjectUrl(blob) {
    if (!urlRef || typeof urlRef.createObjectURL !== 'function') {
      throw new Error('当前环境不支持生成本地预览地址');
    }
    const url = urlRef.createObjectURL(blob);
    if (typeof url !== 'string' || !url.startsWith('blob:')) {
      throw new Error('生成了非法的壁纸预览地址');
    }
    return url;
  }

  function revokeObjectUrl(url) {
    if (!url || !urlRef || typeof urlRef.revokeObjectURL !== 'function') return;
    try {
      urlRef.revokeObjectURL(url);
    } catch {
      // ignore revoke errors
    }
  }

  function setStatus(message, tone = 'info') {
    const { statusText } = getElements();
    if (!statusText) return;
    const text = message ? String(message) : '';
    statusText.textContent = text;
    statusText.hidden = !text;
    statusText.dataset.statusTone = tone;
  }

  function releasePreview() {
    if (previewObjectUrl) {
      revokeObjectUrl(previewObjectUrl);
      previewObjectUrl = null;
    }
    pendingPreview = null;
    const { previewPanel, previewImg, previewMeta } = getElements();
    if (previewImg) {
      previewImg.removeAttribute('src');
    }
    if (previewMeta) {
      previewMeta.textContent = '';
    }
    if (previewPanel) {
      previewPanel.hidden = true;
    }
  }

  function syncControlsUI() {
    const {
      body,
      stageImg,
      selectBtn,
      restorePresetBtn,
      previewPanel,
      applyBtn,
      cancelBtn,
    } = getElements();

    if (body) {
      if (hasActiveCustomWallpaper && activeObjectUrl) {
        body.setAttribute('data-custom-wallpaper', 'active');
      } else {
        body.removeAttribute('data-custom-wallpaper');
      }
    }

    if (stageImg) {
      if (hasActiveCustomWallpaper && activeObjectUrl) {
        if (stageImg.getAttribute('src') !== activeObjectUrl) {
          stageImg.setAttribute('src', activeObjectUrl);
        }
        stageImg.hidden = false;
      } else {
        stageImg.hidden = true;
        stageImg.removeAttribute('src');
      }
    }

    if (selectBtn) selectBtn.disabled = isBusy;
    if (applyBtn) applyBtn.disabled = isBusy || !pendingPreview;
    if (cancelBtn) cancelBtn.disabled = isBusy || !pendingPreview;
    if (restorePresetBtn) {
      restorePresetBtn.hidden = !hasActiveCustomWallpaper;
      restorePresetBtn.disabled = isBusy;
    }
    if (previewPanel) {
      previewPanel.hidden = !pendingPreview;
    }

    if (typeof onWallPaperStateChange === 'function') {
      onWallPaperStateChange({
        isCustomActive: hasActiveCustomWallpaper,
        hasPreview: Boolean(pendingPreview),
        isBusy,
      });
    }
  }

  function activateWallpaperBlob(blob) {
    if (isDestroyed) return;
    const nextUrl = createObjectUrl(blob);
    const prevUrl = activeObjectUrl;
    activeObjectUrl = nextUrl;
    hasActiveCustomWallpaper = true;
    syncControlsUI();
    if (prevUrl && prevUrl !== nextUrl) {
      revokeObjectUrl(prevUrl);
    }
  }

  function deactivateCustomWallpaperDOM() {
    const prevUrl = activeObjectUrl;
    activeObjectUrl = null;
    hasActiveCustomWallpaper = false;
    syncControlsUI();
    if (prevUrl) {
      revokeObjectUrl(prevUrl);
    }
  }

  async function selectFile(file) {
    if (!file) return false;
    isDestroyed = false;
    const token = ++operationToken;
    isBusy = true;
    setStatus('正在校验并生成壁纸预览…', 'info');
    syncControlsUI();

    try {
      const normalized = await normalizeImage(file);
      if (isDestroyed || token !== operationToken) {
        return false;
      }

      const nextPreviewUrl = createObjectUrl(normalized.blob);
      const prevPreviewUrl = previewObjectUrl;
      previewObjectUrl = nextPreviewUrl;
      pendingPreview = normalized;

      const { previewImg, previewMeta, previewPanel } = getElements();
      if (previewImg) {
        previewImg.setAttribute('src', nextPreviewUrl);
      }
      if (previewMeta) {
        previewMeta.textContent = `${normalized.width} × ${normalized.height} · ${formatWallpaperByteSize(normalized.byteLength)}`;
      }
      if (previewPanel) {
        previewPanel.hidden = false;
      }
      if (prevPreviewUrl && prevPreviewUrl !== nextPreviewUrl) {
        revokeObjectUrl(prevPreviewUrl);
      }

      isBusy = false;
      setStatus('预览已就绪，点击「应用壁纸」生效', 'info');
      syncControlsUI();
      return true;
    } catch (error) {
      if (isDestroyed || token !== operationToken) {
        return false;
      }
      releasePreview();
      isBusy = false;
      setStatus(error?.message || '所选图片无法作为壁纸，已保留当前壁纸', 'error');
      syncControlsUI();
      return false;
    }
  }

  async function applyPreview() {
    if (!pendingPreview) return false;
    isDestroyed = false;
    const targetPreview = pendingPreview;
    const token = ++operationToken;
    const myMutationToken = ++mutationToken;
    isBusy = true;
    setStatus('正在保存并应用壁纸…', 'info');
    syncControlsUI();

    try {
      const saved = await enqueueMutation(async () => {
        if (isDestroyed || myMutationToken !== mutationToken) {
          return false;
        }
        await wallpaperStore.save(targetPreview);
        return true;
      });

      if (!saved || isDestroyed || myMutationToken !== mutationToken) {
        return false;
      }

      activateWallpaperBlob(targetPreview.blob);
      if (token === operationToken) {
        releasePreview();
        isBusy = false;
        setStatus('已应用自定义壁纸（仅保存在本机）', 'success');
      }
      syncControlsUI();
      return true;
    } catch (error) {
      if (isDestroyed || myMutationToken !== mutationToken) {
        return false;
      }
      isBusy = false;
      setStatus(
        error?.message ? `${error.message}，已保留当前壁纸` : '保存自定义壁纸失败，已保留当前壁纸',
        'error'
      );
      syncControlsUI();
      return false;
    }
  }

  function cancelPreview({ silent = false } = {}) {
    operationToken += 1;
    isBusy = false;
    releasePreview();
    if (!silent) {
      setStatus('已取消图片预览', 'info');
    }
    syncControlsUI();
  }

  async function restoreFromStorage() {
    isDestroyed = false;
    const token = ++operationToken;
    const startMutationToken = mutationToken;
    try {
      const record = await wallpaperStore.load();
      if (isDestroyed || token !== operationToken || startMutationToken !== mutationToken) {
        return false;
      }
      if (!record || !record.blob) {
        deactivateCustomWallpaperDOM();
        return false;
      }

      if (
        typeof record.blob.size !== 'number' ||
        record.blob.size <= 0 ||
        record.blob.size > MAX_WALLPAPER_OUTPUT_BYTES
      ) {
        throw new Error('本地存储的壁纸大小异常');
      }

      const bytes = await record.blob.arrayBuffer();
      if (isDestroyed || token !== operationToken || startMutationToken !== mutationToken) {
        return false;
      }
      const info = readWallpaperImageInfo(bytes);
      if (!info.ok || (info.format !== 'webp' && info.format !== 'jpeg' && info.format !== 'png')) {
        throw new Error(info.message || '本地存储的壁纸数据校验未通过');
      }

      const safeBlob = new Blob([bytes], { type: info.mime });
      activateWallpaperBlob(safeBlob);
      return true;
    } catch {
      if (isDestroyed || token !== operationToken || startMutationToken !== mutationToken) {
        return false;
      }
      deactivateCustomWallpaperDOM();
      setStatus('读取本机自定义壁纸失败，已恢复预设壁纸', 'error');
      return false;
    }
  }

  async function clearCustomWallpaper({ silent = false, statusMessage = '' } = {}) {
    isDestroyed = false;
    const token = ++operationToken;
    const myMutationToken = ++mutationToken;
    releasePreview();
    isBusy = true;
    syncControlsUI();

    try {
      await enqueueMutation(async () => {
        await wallpaperStore.clear();
      });

      if (isDestroyed || myMutationToken !== mutationToken) {
        return false;
      }

      isBusy = false;
      deactivateCustomWallpaperDOM();
      if (token === operationToken) {
        if (silent) {
          setStatus('', 'info');
        } else if (statusMessage) {
          setStatus(statusMessage, 'info');
        }
      }
      syncControlsUI();
      return true;
    } catch (error) {
      if (isDestroyed || myMutationToken !== mutationToken) {
        return false;
      }
      isBusy = false;
      setStatus(
        error?.message
          ? `${error.message}，已保留当前壁纸`
          : '清理本机自定义壁纸失败，已保留当前壁纸',
        'error'
      );
      syncControlsUI();
      return false;
    }
  }

  function destroy() {
    isDestroyed = true;
    operationToken += 1;
    mutationToken += 1;
    isBusy = false;
    releasePreview();
    deactivateCustomWallpaperDOM();
  }

  function bindDOMEvents() {
    isDestroyed = false;
    const {
      fileInput,
      selectBtn,
      restorePresetBtn,
      applyBtn,
      cancelBtn,
    } = getElements();

    if (selectBtn && fileInput && !selectBtn.dataset.wpBound) {
      selectBtn.dataset.wpBound = 'true';
      selectBtn.addEventListener('click', () => {
        if (isBusy) return;
        fileInput.value = '';
        fileInput.click();
      });
    }

    if (fileInput && !fileInput.dataset.wpBound) {
      fileInput.dataset.wpBound = 'true';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0] || null;
        fileInput.value = '';
        if (file) {
          selectFile(file);
        }
      });
    }

    if (applyBtn && !applyBtn.dataset.wpBound) {
      applyBtn.dataset.wpBound = 'true';
      applyBtn.addEventListener('click', () => {
        applyPreview();
      });
    }

    if (cancelBtn && !cancelBtn.dataset.wpBound) {
      cancelBtn.dataset.wpBound = 'true';
      cancelBtn.addEventListener('click', () => {
        cancelPreview();
      });
    }

    if (restorePresetBtn && !restorePresetBtn.dataset.wpBound) {
      restorePresetBtn.dataset.wpBound = 'true';
      restorePresetBtn.addEventListener('click', () => {
        clearCustomWallpaper({
          silent: false,
          statusMessage: '已恢复动态预设壁纸',
        });
      });
    }

    if (windowRef && typeof windowRef.addEventListener === 'function' && !windowRef.__launchDeckWpPagehideBound) {
      windowRef.__launchDeckWpPagehideBound = true;
      windowRef.addEventListener('pagehide', (event) => {
        if (event?.persisted) {
          if (pendingPreview) {
            cancelPreview({ silent: true });
          }
          return;
        }
        destroy();
      });
      windowRef.addEventListener('pageshow', (event) => {
        if (event?.persisted) {
          isDestroyed = false;
          if (!hasActiveCustomWallpaper || !activeObjectUrl) {
            restoreFromStorage();
          } else {
            syncControlsUI();
          }
        }
      });
    }

    syncControlsUI();
  }

  return {
    bindDOMEvents,
    selectFile,
    applyPreview,
    cancelPreview,
    restoreFromStorage,
    clearCustomWallpaper,
    destroy,
    isCustomWallpaperActive: () => hasActiveCustomWallpaper,
    hasPendingPreview: () => Boolean(pendingPreview),
    getStore: () => wallpaperStore,
  };
}

export const createCustomWallpaperController = createLocalWallpaperController;
