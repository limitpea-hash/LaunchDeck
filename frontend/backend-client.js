/* Shared persistence adapter. UI and layout stay in app.js. */
(() => {
  const OUTBOX_KEY = 'ios18_nav_outbox_v1';
  const REVISION_KEY = 'ios18_nav_revision_v1';
  let revision = null;
  let enabled = false;
  let blocked = false;
  let pending = {};
  let timer;
  let saving = false;
  let inflightPromise = null;
  let notified = false;

  function persist() {
    try {
      if (Object.keys(pending).length) localStorage.setItem(OUTBOX_KEY, JSON.stringify({ revision, patch: pending, blocked }));
      else localStorage.removeItem(OUTBOX_KEY);
      if (revision !== null) localStorage.setItem(REVISION_KEY, String(revision));
    } catch { /* Requests can still save directly when local storage is unavailable. */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(OUTBOX_KEY) || 'null');
      if (saved && saved.patch && typeof saved.patch === 'object' && !Array.isArray(saved.patch)) {
        pending = saved.patch;
        revision = Number.isInteger(saved.revision) ? saved.revision : null;
        blocked = saved.blocked === true;
      } else {
        const cached = localStorage.getItem(REVISION_KEY);
        revision = cached !== null && /^\d+$/.test(cached) ? Number(cached) : null;
      }
    } catch { /* A malformed local backup must not prevent the page from opening. */ }
  }

  function showConflict() {
    if (document.getElementById('backendSyncConflict')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'backendSyncConflict';
    dialog.style.cssText = 'max-width:420px;border:1px solid #666;border-radius:20px;padding:24px;background:#23232b;color:white;font:16px/1.6 system-ui';
    const title = document.createElement('h3');
    title.textContent = '选择要保留的数据';
    const description = document.createElement('p');
    description.textContent = '另一个页面已更新数据库。本机尚未同步的修改已保留；保留本机修改会覆盖对应的网站列表、外观或便签。';
    dialog.append(title, description);
    for (const [label, choice] of [['保留本机修改', 'local'], ['载入数据库版本', 'server'], ['稍后处理', null]]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.style.cssText = 'margin:6px;padding:8px 12px;border-radius:10px;cursor:pointer';
      button.addEventListener('click', async () => {
        if (!choice) { dialog.close(); dialog.remove(); return; }
        button.disabled = true;
        try {
          await window.PortalBackend.resolveConflict(choice);
          if (!blocked) { dialog.close(); dialog.remove(); }
        } catch { description.textContent = '连接失败，修改仍保存在本机。请稍后重试。'; }
        finally { button.disabled = false; }
      });
      dialog.append(button);
    }
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  function notify(message, conflict = false) {
    window.dispatchEvent(new CustomEvent('portal:sync-status', { detail: { message } }));
    if (conflict) showConflict();
  }

  async function request(options = {}) {
    const response = await fetch('/api/state', { ...options, signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.error || '后端暂时不可用');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function flush({ throwOnError = false } = {}) {
    if (inflightPromise) {
      if (throwOnError) {
        await inflightPromise;
      } else {
        return inflightPromise;
      }
    }
    if (!enabled || blocked || saving || !Object.keys(pending).length) {
      if (throwOnError && blocked) {
        const err = new Error('桌面或便签数据存在未解决的同步冲突，请先处理冲突');
        err.status = 409;
        throw err;
      }
      return;
    }
    saving = true;
    const patch = structuredClone(pending);
    let capturedError = null;
    inflightPromise = (async () => {
      try {
        const result = await request({ method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': `"${revision}"` }, body: JSON.stringify(patch), keepalive: true });
        revision = result.revision;
        for (const key of Object.keys(patch)) {
          if (JSON.stringify(pending[key]) === JSON.stringify(patch[key])) delete pending[key];
        }
        persist();
        notified = false;
        notify('已保存到数据库');
      } catch (error) {
        capturedError = error;
        if (error.status === 409 || error.status === 400) blocked = true;
        persist();
        if (!notified) notify(error.status === 409 ? '其他页面已更新数据；本机修改已保留，等待选择同步版本' : error.status === 400 ? '数据格式不兼容；本机修改已保留，暂未同步' : '本次修改保存在本机，尚未同步到数据库', error.status === 409);
        notified = true;
      } finally {
        saving = false;
        inflightPromise = null;
        if (!blocked && Object.keys(pending).length && !throwOnError) timer = setTimeout(flush, 3000);
      }
    })();
    await inflightPromise;
    if (throwOnError && capturedError) {
      throw capturedError;
    }
  }

  window.PortalBackend = {
    async load() {
      if (!['http:', 'https:'].includes(location.protocol)) return null;
      restore();
      try {
        const result = await request();
        const hadPending = Object.keys(pending).length > 0;
        if (hadPending && result.revision !== revision) {
          // A request may have succeeded just before a tab was closed.
          for (const key of Object.keys(pending)) {
            if (JSON.stringify(pending[key]) === JSON.stringify(result.state?.[key])) delete pending[key];
          }
          blocked = result.state !== null && Object.keys(pending).length > 0;
        }
        if (!Object.keys(pending).length) blocked = false;
        revision = result.revision;
        enabled = true;
        persist();
        if (blocked) setTimeout(() => notify('检测到未同步修改，已保留本机版本；请选择要保留的数据', true), 0);
        else if (Object.keys(pending).length) timer = setTimeout(flush, 350);
        return (result.state || hadPending) ? { ...result.state, ...pending } : null;
      } catch {
        // Let the UI render before reporting local fallback.
        setTimeout(() => notify('后端未连接，当前数据仅保存在本机'), 0);
        return null;
      }
    },
    save(patch) {
      if (!['http:', 'https:'].includes(location.protocol)) return;
      pending = { ...pending, ...structuredClone(patch) };
      persist();
      clearTimeout(timer);
      if (enabled && !blocked) timer = setTimeout(flush, 350);
    },
    async resolveConflict(choice) {
      if (!['local', 'server'].includes(choice)) throw new Error('请选择 local 或 server');
      const latest = await request();
      revision = latest.revision;
      enabled = true;
      blocked = false;
      if (choice === 'server') pending = {};
      persist();
      if (choice === 'local') await flush();
      else location.reload();
    },
    async flushNow() {
      if (!['http:', 'https:'].includes(location.protocol)) {
        const err = new Error('当前环境未连接后端服务');
        err.status = 0;
        throw err;
      }
      clearTimeout(timer);
      timer = undefined;
      if (inflightPromise) {
        await inflightPromise;
      }
      if (!enabled || revision === null) {
        restore();
        const result = await request();
        const hadPending = Object.keys(pending).length > 0;
        if (hadPending && revision !== null && result.revision !== revision) {
          for (const key of Object.keys(pending)) {
            if (JSON.stringify(pending[key]) === JSON.stringify(result.state?.[key])) delete pending[key];
          }
          blocked = result.state !== null && Object.keys(pending).length > 0;
        }
        if (!Object.keys(pending).length) blocked = false;
        revision = result.revision;
        enabled = true;
        persist();
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        clearTimeout(timer);
        timer = undefined;
        if (inflightPromise) {
          await inflightPromise;
        }
        if (blocked) {
          const err = new Error('桌面或便签数据存在未解决的同步冲突，请先处理冲突后再操作');
          err.status = 409;
          throw err;
        }
        if (!Object.keys(pending).length) {
          break;
        }
        await flush({ throwOnError: true });
      }
      if (inflightPromise) {
        await inflightPromise;
      }
      if (blocked || Object.keys(pending).length > 0) {
        const err = new Error('桌面与便签未同步修改尚未排空，已中止操作以保护本机数据');
        err.status = blocked ? 409 : 503;
        throw err;
      }
      return { revision };
    },
    getRevision() {
      return revision;
    },
    hasPending() {
      return Boolean(saving || blocked || Object.keys(pending).length > 0);
    },
    clearSyncedCache({ nextRevision = null } = {}) {
      clearTimeout(timer);
      timer = undefined;
      pending = {};
      blocked = false;
      revision = Number.isInteger(nextRevision) ? nextRevision : null;
      try {
        localStorage.removeItem(OUTBOX_KEY);
        if (revision !== null) localStorage.setItem(REVISION_KEY, String(revision));
        else localStorage.removeItem(REVISION_KEY);
      } catch { /* ignore storage errors */ }
    },
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); void flush(); } });
})();
