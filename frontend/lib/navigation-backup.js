import {
  createNavigationBackup,
  validateNavigationBackup,
  navigationSummary,
  createBitwardenImport,
  mergeNavigationSites,
} from '../platform/navigation/codec.js';

export { mergeNavigationSites };

export const NAVIGATION_RESTORE_CHANNEL = 'launchdeck:navigation-restore:v1';
export const NAVIGATION_RESTORE_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_NAVIGATION_BACKUP_BYTES = 2 * 1024 * 1024; // 2 MiB
export const NAVIGATION_RESTORE_ID_STORAGE_KEY = 'ios18_nav_restore_id_v1';

export function generateRestoreSessionToken(
  cryptoRef = typeof globalThis !== 'undefined' ? globalThis.crypto : null
) {
  if (!cryptoRef || typeof cryptoRef.getRandomValues !== 'function') {
    throw new Error('当前环境不支持安全随机数生成');
  }
  const bytes = new Uint8Array(24); // 192 bits (> 128 bits)
  cryptoRef.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isSupportedRestoreOrigin(origin, expectedOrigin) {
  if (typeof origin !== 'string' || typeof expectedOrigin !== 'string') {
    return false;
  }
  const trimmed = origin.trim();
  if (!trimmed || trimmed === 'null' || trimmed !== expectedOrigin.trim()) {
    return false;
  }
  return /^https?:\/\/[^/]+$/i.test(trimmed) || /^chrome-extension:\/\/[a-z0-9_-]+$/i.test(trimmed);
}

export function buildCanonicalRestoreUri(baseHref) {
  const url = new URL('restore.html', String(baseHref || 'http://localhost/'));
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function buildRestorePageUrl(baseHref, sessionToken) {
  if (typeof sessionToken !== 'string' || !/^[a-f0-9]{32,128}$/i.test(sessionToken)) {
    throw new Error('无效的恢复会话令牌');
  }
  const url = new URL('restore.html', String(baseHref || 'http://localhost/'));
  url.search = '';
  url.hash = `token=${sessionToken}`;
  return url.toString();
}

function getUtf8ByteLength(text) {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(String(text)).byteLength;
  }
  return String(text).length;
}

function triggerJsonDownload(documentRef, urlRef, filename, dataObj) {
  if (!documentRef || !urlRef || typeof urlRef.createObjectURL !== 'function') {
    throw new Error('当前环境不支持文件下载');
  }
  const jsonText = JSON.stringify(dataObj, null, 2);
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
  const objectUrl = urlRef.createObjectURL(blob);
  try {
    const link = documentRef.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    documentRef.body?.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => {
      try {
        urlRef.revokeObjectURL(objectUrl);
      } catch {
        // ignore revoke error
      }
    }, 1000);
  }
}

export function createNavigationBackupController({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  urlRef = typeof URL !== 'undefined' ? URL : null,
  cryptoRef = typeof globalThis !== 'undefined' ? globalThis.crypto : null,
  now = () => Date.now(),
  setTimeoutFn = (...args) => globalThis.setTimeout(...args),
  clearTimeoutFn = (...args) => globalThis.clearTimeout(...args),
  setIntervalFn = (...args) => globalThis.setInterval(...args),
  clearIntervalFn = (...args) => globalThis.clearInterval(...args),
  getLiveNavigationSnapshot,
  drainPendingBeforeImport,
  fetchRevisionsBeforeImport,
  postAtomicNavigationImport,
  applyImportedBrowserDataAndReload,
  setEditLock = () => {},
  downloadFile = null,
} = {}) {
  let activeSession = null;
  let sessionExpiryTimer = null;
  let sessionClosePollTimer = null;
  let importing = false;
  let messageListenerBound = false;

  function getElements() {
    if (!documentRef) return {};
    return {
      exportNavBtn: documentRef.getElementById('exportNavJsonBtn'),
      exportBwBtn: documentRef.getElementById('exportBitwardenJsonBtn'),
      openRestoreBtn: documentRef.getElementById('openNavigationRestoreBtn'),
      statusText: documentRef.getElementById('navigationBackupStatusText'),
    };
  }

  function setStatus(message, tone = 'info') {
    const { statusText } = getElements();
    if (!statusText) return;
    const text = message ? String(message) : '';
    statusText.textContent = text;
    statusText.hidden = !text;
    statusText.dataset.statusTone = tone;
  }

  function syncButtonsDisabled() {
    const { exportNavBtn, exportBwBtn, openRestoreBtn } = getElements();
    if (exportNavBtn) exportNavBtn.disabled = importing;
    if (exportBwBtn) exportBwBtn.disabled = importing;
    if (openRestoreBtn) openRestoreBtn.disabled = importing;
  }

  function removeMessageListener() {
    if (messageListenerBound && windowRef && typeof windowRef.removeEventListener === 'function') {
      windowRef.removeEventListener('message', handleWindowMessage);
      messageListenerBound = false;
    }
  }

  function clearSessionTimers() {
    if (sessionExpiryTimer !== null) {
      try {
        clearTimeoutFn(sessionExpiryTimer);
      } catch {
        // ignore timer cleanup error
      }
      sessionExpiryTimer = null;
    }
    if (sessionClosePollTimer !== null) {
      try {
        clearIntervalFn(sessionClosePollTimer);
      } catch {
        // ignore interval cleanup error
      }
      sessionClosePollTimer = null;
    }
  }

  function clearActiveSession() {
    clearSessionTimers();
    removeMessageListener();
    activeSession = null;
  }

  function expireActiveSession() {
    if (!activeSession || activeSession.consumed) {
      clearActiveSession();
      return;
    }
    const expiredSession = activeSession;
    clearActiveSession();
    const expiredMsg = '恢复会话已超过 10 分钟有效期，请从设置重新打开恢复页';
    setStatus(expiredMsg, 'error');
    sendReplyToChild(expiredSession.childWindow, expiredSession.expectedOrigin, {
      channel: NAVIGATION_RESTORE_CHANNEL,
      token: expiredSession.token,
      type: 'apply-result',
      ok: false,
      message: expiredMsg,
    });
  }

  function sendReplyToChild(targetWindow, targetOrigin, payload) {
    if (!targetWindow || !isSupportedRestoreOrigin(targetOrigin, targetOrigin)) {
      return;
    }
    try {
      if (!targetWindow.closed && typeof targetWindow.postMessage === 'function') {
        targetWindow.postMessage(payload, targetOrigin);
      }
    } catch {
      // ignore postMessage error if child closed
    }
  }

  function buildBackupFromLiveState() {
    if (typeof getLiveNavigationSnapshot !== 'function') {
      throw new Error('缺少实时导航状态快照接口');
    }
    const snapshot = getLiveNavigationSnapshot();
    const backup = createNavigationBackup({
      sites: snapshot.sites,
      pages: snapshot.pages,
      desktop: snapshot.desktop,
      layout: snapshot.layout,
    });
    return validateNavigationBackup(backup);
  }

  function exportNavigationJson() {
    if (importing) return null;
    try {
      const backup = buildBackupFromLiveState();
      const summary = navigationSummary(backup);
      const dateTag = String(backup.exportedAt || new Date().toISOString()).slice(0, 10);
      const filename = `launchdeck-navigation-${dateTag}.json`;
      if (typeof downloadFile === 'function') {
        downloadFile(filename, backup);
      } else {
        triggerJsonDownload(documentRef, urlRef, filename, backup);
      }
      setStatus(
        `已导出导航 JSON（${summary.sites} 个网站、${summary.pages} 个页面、${summary.folders} 个文件夹）`,
        'success'
      );
      return backup;
    } catch (error) {
      setStatus(error?.message || '导出导航 JSON 失败', 'error');
      return null;
    }
  }

  async function exportBitwardenLoginJson() {
    if (importing) return null;
    try {
      const backup = buildBackupFromLiveState();
      const restoreUri = buildCanonicalRestoreUri(windowRef?.location?.href || 'http://localhost/');
      const bwPayload = await createBitwardenImport(backup, restoreUri);
      const dateTag = String(backup.exportedAt || new Date().toISOString()).slice(0, 10);
      const filename = `launchdeck-bitwarden-login-${dateTag}.json`;
      if (typeof downloadFile === 'function') {
        downloadFile(filename, bwPayload);
      } else {
        triggerJsonDownload(documentRef, urlRef, filename, bwPayload);
      }
      setStatus(
        '已导出 Bitwarden 专用登录 JSON（含 1 条登录项，请在 Bitwarden 手动导入；重复导入会新增条目）',
        'success'
      );
      return bwPayload;
    } catch (error) {
      setStatus(
        error?.message || '导出 Bitwarden 登录 JSON 失败，请改用「导出导航 JSON」文件备份',
        'error'
      );
      return null;
    }
  }

  async function applyNavigationBackup(
    rawBackup,
    { replyWindow = null, replyOrigin = '', sessionToken = '' } = {}
  ) {
    if (importing) {
      const err = new Error('当前已有正在执行的导航恢复任务，请稍候');
      return { ok: false, error: err };
    }

    let validatedBackup;
    try {
      const serialized = JSON.stringify(rawBackup);
      if (!serialized || getUtf8ByteLength(serialized) > MAX_NAVIGATION_BACKUP_BYTES) {
        throw new Error('导航备份数据超出 2 MiB 上限');
      }
      validatedBackup = validateNavigationBackup(rawBackup);
    } catch (error) {
      const msg = error?.message || '导航备份校验未通过，未修改当前桌面';
      setStatus(msg, 'error');
      if (replyWindow && replyOrigin && sessionToken) {
        sendReplyToChild(replyWindow, replyOrigin, {
          channel: NAVIGATION_RESTORE_CHANNEL,
          token: sessionToken,
          type: 'apply-result',
          ok: false,
          message: msg,
        });
      }
      return { ok: false, error };
    }

    importing = true;
    setEditLock(true);
    syncButtonsDisabled();
    setStatus('正在保存本机未同步修改并恢复导航备份…', 'info');

    try {
      if (typeof drainPendingBeforeImport === 'function') {
        await drainPendingBeforeImport();
      }

      if (typeof fetchRevisionsBeforeImport !== 'function') {
        throw new Error('缺少状态版本号读取接口');
      }
      const { portalRevision, widgetRevision } = await fetchRevisionsBeforeImport();
      if (!Number.isInteger(portalRevision) || !Number.isInteger(widgetRevision)) {
        throw new Error('读取服务器数据版本号失败，已中止导入');
      }

      if (typeof postAtomicNavigationImport !== 'function') {
        throw new Error('缺少原子导航导入接口');
      }
      const importResult = await postAtomicNavigationImport({
        backup: validatedBackup,
        portalRevision,
        widgetRevision,
      });

      if (!importResult || importResult.success !== true) {
        throw new Error(importResult?.error || '导航备份原子导入未成功');
      }

      if (replyWindow && replyOrigin && sessionToken) {
        sendReplyToChild(replyWindow, replyOrigin, {
          channel: NAVIGATION_RESTORE_CHANNEL,
          token: sessionToken,
          type: 'apply-result',
          ok: true,
          restoreId: importResult.restoreId || null,
          message: '导航备份已成功应用，主页面正在刷新',
        });
      }

      setStatus('导航备份恢复成功，正在重新加载桌面…', 'success');
      if (typeof applyImportedBrowserDataAndReload === 'function') {
        await applyImportedBrowserDataAndReload(importResult, validatedBackup);
      }
      return { ok: true, result: importResult };
    } catch (error) {
      importing = false;
      setEditLock(false);
      syncButtonsDisabled();

      let friendlyMessage = error?.message || '恢复导航备份失败，已保留当前本机数据';
      if (error?.status === 409) {
        friendlyMessage =
          error.message || '检测到数据版本冲突，请先同步或解决冲突后再执行恢复（本机数据已保留）';
      } else if (error?.status === 428) {
        friendlyMessage = '桌面基础状态尚未完成初始化，请先同步后再恢复导航备份';
      }

      setStatus(friendlyMessage, 'error');
      if (replyWindow && replyOrigin && sessionToken) {
        sendReplyToChild(replyWindow, replyOrigin, {
          channel: NAVIGATION_RESTORE_CHANNEL,
          token: sessionToken,
          type: 'apply-result',
          ok: false,
          message: friendlyMessage,
        });
      }
      return { ok: false, error };
    }
  }

  function handleWindowMessage(event) {
    if (!activeSession || activeSession.consumed) {
      return;
    }
    if (!event || event.source !== activeSession.childWindow) {
      return;
    }
    if (!isSupportedRestoreOrigin(event.origin, activeSession.expectedOrigin)) {
      return;
    }
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }
    if (
      data.channel !== NAVIGATION_RESTORE_CHANNEL ||
      typeof data.token !== 'string' ||
      data.token !== activeSession.token
    ) {
      return;
    }

    if (now() > activeSession.expiresAt) {
      expireActiveSession();
      return;
    }

    if (data.type === 'cancel') {
      clearActiveSession();
      setStatus('已取消从恢复页导入导航备份', 'info');
      return;
    }

    if (data.type === 'apply') {
      const currentSession = activeSession;
      currentSession.consumed = true;
      clearActiveSession();
      void applyNavigationBackup(data.backup, {
        replyWindow: currentSession.childWindow,
        replyOrigin: currentSession.expectedOrigin,
        sessionToken: currentSession.token,
      });
    }
  }

  function openRestoreWindow() {
    if (importing || !windowRef) return null;
    const currentOrigin = String(windowRef.location?.origin || '');
    if (!isSupportedRestoreOrigin(currentOrigin, currentOrigin)) {
      setStatus('当前页面来源不支持受控窗口恢复，请通过 HTTP(S) 或扩展页面访问', 'error');
      return null;
    }

    clearActiveSession();

    let token;
    try {
      token = generateRestoreSessionToken(cryptoRef);
    } catch (error) {
      setStatus(error?.message || '生成恢复会话令牌失败', 'error');
      return null;
    }

    const restoreUrl = buildRestorePageUrl(windowRef.location.href, token);
    const childWindow = windowRef.open(restoreUrl, '_blank');
    if (!childWindow) {
      setStatus('无法打开独立恢复页，请检查浏览器弹出窗口拦截设置', 'error');
      return null;
    }

    activeSession = {
      token,
      childWindow,
      expectedOrigin: currentOrigin,
      expiresAt: now() + NAVIGATION_RESTORE_SESSION_TTL_MS,
      consumed: false,
    };

    if (typeof windowRef.addEventListener === 'function' && !messageListenerBound) {
      windowRef.addEventListener('message', handleWindowMessage);
      messageListenerBound = true;
    }

    if (typeof setTimeoutFn === 'function') {
      const targetToken = token;
      sessionExpiryTimer = setTimeoutFn(() => {
        if (activeSession && activeSession.token === targetToken) {
          expireActiveSession();
        }
      }, NAVIGATION_RESTORE_SESSION_TTL_MS);
      sessionExpiryTimer?.unref?.();
    }

    if (typeof setIntervalFn === 'function') {
      const targetToken = token;
      sessionClosePollTimer = setIntervalFn(() => {
        if (!activeSession || activeSession.token !== targetToken) {
          clearSessionTimers();
          return;
        }
        if (now() > activeSession.expiresAt) {
          expireActiveSession();
          return;
        }
        try {
          if (activeSession.childWindow?.closed) {
            clearActiveSession();
          }
        } catch {
          clearActiveSession();
        }
      }, 500);
      sessionClosePollTimer?.unref?.();
    }

    setStatus('已打开独立恢复页，请在 10 分钟内完成校验并确认应用', 'info');
    return activeSession;
  }

  function cancelRestoreSession({ silent = false } = {}) {
    clearActiveSession();
    if (!silent) {
      setStatus('已关闭恢复会话监听', 'info');
    }
  }

  function destroy() {
    clearActiveSession();
  }

  function bindDOMEvents() {
    const { exportNavBtn, exportBwBtn, openRestoreBtn } = getElements();

    if (exportNavBtn && !exportNavBtn.dataset.navBackupBound) {
      exportNavBtn.dataset.navBackupBound = 'true';
      exportNavBtn.addEventListener('click', () => {
        exportNavigationJson();
      });
    }

    if (exportBwBtn && !exportBwBtn.dataset.navBackupBound) {
      exportBwBtn.dataset.navBackupBound = 'true';
      exportBwBtn.addEventListener('click', () => {
        void exportBitwardenLoginJson();
      });
    }

    if (openRestoreBtn && !openRestoreBtn.dataset.navBackupBound) {
      openRestoreBtn.dataset.navBackupBound = 'true';
      openRestoreBtn.addEventListener('click', () => {
        openRestoreWindow();
      });
    }

    if (
      windowRef &&
      typeof windowRef.addEventListener === 'function' &&
      !windowRef.__launchDeckNavRestorePagehideBound
    ) {
      windowRef.__launchDeckNavRestorePagehideBound = true;
      windowRef.addEventListener('pagehide', () => {
        clearActiveSession();
      });
    }

    syncButtonsDisabled();
  }

  return {
    bindDOMEvents,
    exportNavigationJson,
    exportBitwardenLoginJson,
    openRestoreWindow,
    cancelRestoreSession,
    applyNavigationBackup,
    getActiveSession: () => (activeSession ? { ...activeSession } : null),
    isImporting: () => importing,
    destroy,
  };
}
