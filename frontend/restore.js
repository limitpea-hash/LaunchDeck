import {
  validateNavigationBackup,
  navigationSummary,
  decodeNavigationPacket,
  decodeBackupText,
} from './platform/navigation/codec.js';

export const NAVIGATION_RESTORE_CHANNEL = 'launchdeck:navigation-restore:v1';
export const MAX_RESTORE_INPUT_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_AUTOFILL_CHUNKS = 16;

export function parseRestoreSessionTokenFromHash(rawHash) {
  if (typeof rawHash !== 'string') return null;
  const cleaned = rawHash.replace(/^#/, '').trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('token=')) {
    const token = cleaned.slice('token='.length).trim();
    return /^[a-f0-9]{32,128}$/i.test(token) ? token : null;
  }
  return /^[a-f0-9]{32,128}$/i.test(cleaned) ? cleaned : null;
}

export function isExactRestoreOrigin(origin) {
  if (typeof origin !== 'string') return false;
  const trimmed = origin.trim();
  if (!trimmed || trimmed === 'null') return false;
  return /^https?:\/\/[^/]+$/i.test(trimmed) || /^chrome-extension:\/\/[a-z0-9_-]+$/i.test(trimmed);
}

export function extractAutofillPacketFromDocument(doc) {
  const manifestInput = doc?.getElementById?.('launchdeck_nav_manifest');
  const manifest = typeof manifestInput?.value === 'string' ? manifestInput.value.trim() : '';
  if (!manifest) {
    throw new Error('未检测到备份清单字段 (launchdeck_nav_manifest)，请先使用 Bitwarden 自动填充');
  }

  let parsedManifest;
  try {
    parsedManifest = JSON.parse(manifest);
  } catch {
    throw new Error('备份清单字段格式无效（不是合法 JSON）');
  }

  const expectedCount =
    parsedManifest?.chunks ?? parsedManifest?.chunkCount ?? parsedManifest?.parts;
  if (
    !Number.isInteger(expectedCount) ||
    expectedCount < 1 ||
    expectedCount > MAX_AUTOFILL_CHUNKS
  ) {
    throw new Error(`备份清单声明的分段数量无效（需为 1–${MAX_AUTOFILL_CHUNKS}）`);
  }

  const chunks = [];
  for (let i = 0; i < expectedCount; i += 1) {
    const input = doc.getElementById(`launchdeck_nav_chunk_${i}`);
    const value = typeof input?.value === 'string' ? input.value.trim() : '';
    if (!value) {
      throw new Error(`有效备份分段不足：缺少第 ${i + 1} 段 (launchdeck_nav_chunk_${i})`);
    }
    chunks.push(value);
  }

  // Clear any trailing unused chunk inputs so stale segments from older entries are never retained
  for (let i = expectedCount; i < MAX_AUTOFILL_CHUNKS; i += 1) {
    const trailingInput = doc.getElementById(`launchdeck_nav_chunk_${i}`);
    if (trailingInput && trailingInput.value) {
      trailingInput.value = '';
    }
  }

  return { manifest, chunks };
}

function getUtf8ByteLength(text) {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(String(text)).byteLength;
  }
  return String(text).length;
}

export function initRestorePage({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  urlRef = typeof URL !== 'undefined' ? URL : null,
} = {}) {
  if (!documentRef || !windowRef) return null;

  const protocol = String(windowRef.location?.protocol || '');
  const origin = String(windowRef.location?.origin || '');
  const isExtensionProtocol = protocol === 'chrome-extension:' || protocol.endsWith('-extension:');
  const isHttpProtocol = protocol === 'http:' || protocol === 'https:';
  const sessionToken = parseRestoreSessionTokenFromHash(windowRef.location?.hash || '');

  // Remove token from address bar history while keeping it in memory for this session
  if (sessionToken && windowRef.history?.replaceState) {
    try {
      windowRef.history.replaceState(
        null,
        '',
        `${windowRef.location.pathname}${windowRef.location.search}`
      );
    } catch {
      // ignore replaceState error
    }
  }

  let validatedBackup = null;
  let applyInFlight = false;
  let sessionEnded = false;

  const sessionBanner = documentRef.getElementById('restoreSessionBanner');
  const extensionNotice = documentRef.getElementById('extensionModeNotice');
  const autofillSection = documentRef.getElementById('bitwardenAutofillSection');
  const autofillForm = documentRef.getElementById('bitwardenAutofillForm');
  const focusUsernameBtn = documentRef.getElementById('focusAutofillUsernameBtn');
  const clearAutofillBtn = documentRef.getElementById('clearAutofillFormBtn');
  const fileInput = documentRef.getElementById('restoreBackupFileInput');
  const selectFileBtn = documentRef.getElementById('selectRestoreFileBtn');
  const clearManualBtn = documentRef.getElementById('clearManualInputBtn');
  const manualTextarea = documentRef.getElementById('restoreBackupTextInput');
  const verifyManualBtn = documentRef.getElementById('verifyManualBackupBtn');
  const statusText = documentRef.getElementById('restoreStatusText');
  const previewSection = documentRef.getElementById('restorePreviewSection');
  const previewMeta = documentRef.getElementById('previewBackupMeta');
  const previewSites = documentRef.getElementById('previewSitesCount');
  const previewPages = documentRef.getElementById('previewPagesCount');
  const previewFolders = documentRef.getElementById('previewFoldersCount');
  const previewWidgets = documentRef.getElementById('previewWidgetsCount');
  const previewPinned = documentRef.getElementById('previewPinnedCount');
  const previewPagesList = documentRef.getElementById('previewPagesList');
  const confirmApplyBtn = documentRef.getElementById('confirmApplyRestoreBtn');
  const downloadJsonBtn = documentRef.getElementById('downloadValidatedJsonBtn');
  const cancelBtn = documentRef.getElementById('cancelRestoreBtn');

  function canPostToOpener() {
    return Boolean(
      !sessionEnded &&
        sessionToken &&
        windowRef.opener &&
        !windowRef.opener.closed &&
        isExactRestoreOrigin(origin)
    );
  }

  function setStatus(message, tone = 'info') {
    if (!statusText) return;
    const text = message ? String(message) : '';
    statusText.textContent = text;
    statusText.hidden = !text;
    statusText.dataset.statusTone = tone;
  }

  function clearPreview() {
    validatedBackup = null;
    if (previewSection) previewSection.hidden = true;
    if (confirmApplyBtn) confirmApplyBtn.disabled = true;
    if (downloadJsonBtn) downloadJsonBtn.disabled = true;
    if (previewPagesList) {
      while (previewPagesList.firstChild) {
        previewPagesList.removeChild(previewPagesList.firstChild);
      }
    }
  }

  function renderPreview(backup) {
    const checked = validateNavigationBackup(backup);
    const summary = navigationSummary(checked);
    validatedBackup = checked;

    if (previewSites) previewSites.textContent = String(summary.sites);
    if (previewPages) previewPages.textContent = String(summary.pages);
    if (previewFolders) previewFolders.textContent = String(summary.folders);
    if (previewWidgets) previewWidgets.textContent = String(summary.widgets);
    if (previewPinned) previewPinned.textContent = String(summary.pinned);
    if (previewMeta) {
      previewMeta.textContent = `备份标识：${checked.backupId} · 导出时间：${checked.exportedAt}`;
    }

    if (previewPagesList) {
      while (previewPagesList.firstChild) {
        previewPagesList.removeChild(previewPagesList.firstChild);
      }
      const pages = Array.isArray(checked.pages) ? checked.pages : [];
      const sites = Array.isArray(checked.sites) ? checked.sites : [];
      for (const page of pages) {
        const row = documentRef.createElement('div');
        row.className = 'preview-page-row';
        const titleSpan = documentRef.createElement('span');
        titleSpan.textContent = `${page.title} (${page.id})`;
        const countSpan = documentRef.createElement('span');
        const pageSiteCount =
          page.id === 'all'
            ? sites.length
            : sites.filter((s) => s.category === page.id).length;
        countSpan.textContent = `${pageSiteCount} 个网站`;
        row.append(titleSpan, countSpan);
        previewPagesList.appendChild(row);
      }
    }

    if (previewSection) previewSection.hidden = false;
    if (confirmApplyBtn) confirmApplyBtn.disabled = !canPostToOpener() || applyInFlight;
    if (downloadJsonBtn) downloadJsonBtn.disabled = false;
  }

  // Configure mode visibility
  if (isExtensionProtocol || !isHttpProtocol) {
    if (extensionNotice) extensionNotice.hidden = false;
    if (autofillSection) autofillSection.hidden = true;
  } else {
    if (extensionNotice) extensionNotice.hidden = true;
    if (autofillSection) autofillSection.hidden = false;
  }

  if (sessionBanner) {
    if (canPostToOpener()) {
      sessionBanner.textContent = '已连接主页面恢复会话：校验通过后点击「确认应用到当前桌面」即可完成原子恢复。';
    } else {
      sessionBanner.textContent =
        '当前为独立打开模式（未关联主窗口恢复令牌）：您可以校验备份完整性并下载标准导航 JSON 文件，随后从主页面打开恢复页导入。';
    }
  }

  focusUsernameBtn?.addEventListener('click', () => {
    const usernameInput = documentRef.getElementById('username');
    usernameInput?.focus?.({ preventScroll: true });
    setStatus('已聚焦账号输入框，请在 Bitwarden 中选择专用备份条目完成自动填充。', 'info');
  });

  clearAutofillBtn?.addEventListener('click', () => {
    autofillForm?.reset?.();
    clearPreview();
    setStatus('已清空自动填充表单字段。', 'info');
  });

  autofillForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (applyInFlight) return;
    clearPreview();
    try {
      const packet = extractAutofillPacketFromDocument(documentRef);
      const decoded = await decodeNavigationPacket(packet);
      renderPreview(decoded);
      setStatus('自动填充备份校验通过，请核对下方统计信息后确认应用。', 'success');
    } catch (error) {
      setStatus(error?.message || '自动填充备份校验未通过，未修改当前桌面', 'error');
    }
  });

  selectFileBtn?.addEventListener('click', () => {
    if (applyInFlight || !fileInput) return;
    fileInput.value = '';
    fileInput.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0] || null;
    fileInput.value = '';
    if (!file || applyInFlight) return;
    clearPreview();
    if (file.size <= 0) {
      setStatus('所选文件为空', 'error');
      return;
    }
    if (file.size > MAX_RESTORE_INPUT_BYTES) {
      setStatus('备份文件大小不能超过 2 MiB', 'error');
      return;
    }
    try {
      const text = await file.text();
      if (getUtf8ByteLength(text) > MAX_RESTORE_INPUT_BYTES) {
        throw new Error('备份文件内容不能超过 2 MiB');
      }
      if (manualTextarea) {
        manualTextarea.value = text;
      }
      const decoded = await decodeBackupText(text);
      renderPreview(decoded);
      setStatus('备份文件校验通过，请核对下方统计信息后确认应用。', 'success');
    } catch (error) {
      setStatus(error?.message || '备份文件校验未通过，未修改当前桌面', 'error');
    }
  });

  clearManualBtn?.addEventListener('click', () => {
    if (manualTextarea) manualTextarea.value = '';
    clearPreview();
    setStatus('已清空粘贴内容。', 'info');
  });

  verifyManualBtn?.addEventListener('click', async () => {
    if (applyInFlight) return;
    clearPreview();
    const rawText = typeof manualTextarea?.value === 'string' ? manualTextarea.value.trim() : '';
    if (!rawText) {
      setStatus('请先粘贴备份文本或选择本地备份文件', 'error');
      return;
    }
    if (getUtf8ByteLength(rawText) > MAX_RESTORE_INPUT_BYTES) {
      setStatus('输入的备份内容超过 2 MiB 限制', 'error');
      return;
    }
    try {
      const decoded = await decodeBackupText(rawText);
      renderPreview(decoded);
      setStatus('备份内容校验通过，请核对下方统计信息后确认应用。', 'success');
    } catch (error) {
      setStatus(error?.message || '备份内容校验未通过，未修改当前桌面', 'error');
    }
  });

  downloadJsonBtn?.addEventListener('click', () => {
    if (!validatedBackup || !urlRef || typeof urlRef.createObjectURL !== 'function') return;
    const jsonText = JSON.stringify(validatedBackup, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const objectUrl = urlRef.createObjectURL(blob);
    const dateTag = String(validatedBackup.exportedAt || new Date().toISOString()).slice(0, 10);
    const link = documentRef.createElement('a');
    link.href = objectUrl;
    link.download = `launchdeck-navigation-verified-${dateTag}.json`;
    documentRef.body?.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => {
      try {
        urlRef.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    }, 1000);
    setStatus('已下载校验通过的导航 JSON 文件。', 'success');
  });

  confirmApplyBtn?.addEventListener('click', () => {
    if (!validatedBackup || applyInFlight) return;
    if (!canPostToOpener()) {
      setStatus('主页面恢复会话已断开，请下载导航 JSON 或从主页面设置重新打开恢复页', 'error');
      confirmApplyBtn.disabled = true;
      return;
    }
    applyInFlight = true;
    confirmApplyBtn.disabled = true;
    setStatus('正在向主页面发送恢复请求，请等待主页面排空未同步数据并完成原子恢复…', 'info');
    windowRef.opener.postMessage(
      {
        channel: NAVIGATION_RESTORE_CHANNEL,
        token: sessionToken,
        type: 'apply',
        backup: validatedBackup,
      },
      origin
    );
  });

  cancelBtn?.addEventListener('click', () => {
    clearPreview();
    if (canPostToOpener()) {
      try {
        windowRef.opener.postMessage(
          {
            channel: NAVIGATION_RESTORE_CHANNEL,
            token: sessionToken,
            type: 'cancel',
          },
          origin
        );
      } catch {
        // ignore
      }
    }
    sessionEnded = true;
    if (confirmApplyBtn) confirmApplyBtn.disabled = true;
    setStatus('已取消恢复操作。', 'info');
    try {
      windowRef.close();
    } catch {
      // ignore
    }
  });

  windowRef.addEventListener('pagehide', () => {
    if (!applyInFlight && canPostToOpener()) {
      try {
        windowRef.opener.postMessage(
          {
            channel: NAVIGATION_RESTORE_CHANNEL,
            token: sessionToken,
            type: 'cancel',
          },
          origin
        );
      } catch {
        // ignore
      }
    }
    sessionEnded = true;
  });

  windowRef.addEventListener('message', (event) => {
    if (!windowRef.opener || event.source !== windowRef.opener) return;
    if (!isExactRestoreOrigin(event.origin) || event.origin !== origin) return;
    const data = event.data;
    if (
      !data ||
      typeof data !== 'object' ||
      data.channel !== NAVIGATION_RESTORE_CHANNEL ||
      data.token !== sessionToken ||
      data.type !== 'apply-result'
    ) {
      return;
    }
    applyInFlight = false;
    sessionEnded = true;
    if (confirmApplyBtn) {
      confirmApplyBtn.disabled = true;
    }
    if (data.ok) {
      setStatus(data.message || '导航备份已在主页面恢复成功，本窗口即将关闭。', 'success');
      setTimeout(() => {
        try {
          windowRef.close();
        } catch {
          // ignore
        }
      }, 600);
    } else {
      const baseMsg = data.message || '主页面恢复导航备份失败，未修改当前桌面';
      const suffix = '本次恢复会话已结束，请从主页面重新打开恢复页';
      setStatus(baseMsg.includes(suffix) ? baseMsg : `${baseMsg}（${suffix}）`, 'error');
    }
  });

  return {
    getValidatedBackup: () => validatedBackup,
    canPostToOpener,
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initRestorePage(), { once: true });
  } else {
    initRestorePage();
  }
}
