import { el, clearElement, setText, safeHttpUrl } from './dom.js';
import { createWebNotifications, notificationSource } from '../platform/features/notifications.js';

export const NOTIFICATION_POLL_INTERVAL_MS = 60000;
export const MAX_NOTIFICATION_SOURCES = 8;

const EMPTY_SNAPSHOT = Object.freeze({
  sources: [],
  messages: [],
  unreadCount: 0,
});

function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      sources: [],
      messages: [],
      unreadCount: 0,
    };
  }
  const sources = Array.isArray(raw.sources)
    ? raw.sources
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          id: String(s.id ?? ''),
          name: String(s.name ?? '').trim() || '未命名来源',
          url: String(s.url ?? ''),
          lastSuccessAt: typeof s.lastSuccessAt === 'string' && s.lastSuccessAt ? s.lastSuccessAt : null,
          error: typeof s.error === 'string' && s.error.trim() ? s.error.trim() : null,
        }))
    : [];

  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({
          id: String(m.id ?? ''),
          sourceId: String(m.sourceId ?? ''),
          sourceName: String(m.sourceName ?? '').trim() || '通知来源',
          title: String(m.title ?? '').trim() || '（无标题通知）',
          body: typeof m.body === 'string' ? m.body.trim() : '',
          url: typeof m.url === 'string' && m.url.trim() ? safeHttpsUrl(m.url) : null,
          publishedAt: typeof m.publishedAt === 'string' && m.publishedAt ? m.publishedAt : null,
          read: Boolean(m.read),
        }))
    : [];

  const computedUnread = messages.reduce((acc, item) => acc + (item.read ? 0 : 1), 0);
  const unreadCount =
    typeof raw.unreadCount === 'number' && Number.isFinite(raw.unreadCount) && raw.unreadCount >= 0
      ? Math.round(raw.unreadCount)
      : computedUnread;

  return {
    sources,
    messages,
    unreadCount,
  };
}

export function safeHttpsUrl(rawUrl) {
  const cleaned = safeHttpUrl(rawUrl);
  if (!cleaned || cleaned.length > 1500) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.href.length <= 1500 ? parsed.href : null;
  } catch {
    return null;
  }
}

export function formatIsoTimestampShort(isoStr) {
  if (!isoStr || typeof isoStr !== 'string') return '';
  const epoch = Date.parse(isoStr);
  if (!Number.isFinite(epoch)) return isoStr;
  try {
    const d = new Date(epoch);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return isoStr;
  }
}

export function extractSourceInitial(name) {
  const clean = String(name || '').trim();
  if (!clean) return 'N';
  const ch = Array.from(clean)[0] || 'N';
  return ch.toUpperCase();
}

export function resolveNotificationsService(windowRef = typeof window !== 'undefined' ? window : null) {
  const injected = windowRef?.LaunchDeckNotifications;
  if (
    injected &&
    typeof injected === 'object' &&
    typeof injected.getSnapshot === 'function' &&
    typeof injected.addSource === 'function' &&
    typeof injected.removeSource === 'function' &&
    typeof injected.refresh === 'function' &&
    typeof injected.markRead === 'function' &&
    typeof injected.markAllRead === 'function'
  ) {
    return injected;
  }
  return createWebNotifications();
}

export function createNotificationsUIController({
  service = null,
  openSettingsModalForNotifications = null,
  getFallbackFocusElement = null,
  pollIntervalMs = NOTIFICATION_POLL_INTERVAL_MS,
  setIntervalFn = typeof setInterval === 'function' ? setInterval : null,
  clearIntervalFn = typeof clearInterval === 'function' ? clearInterval : null,
} = {}) {
  let notificationsService = service;
  let snapshot = normalizeSnapshot(EMPTY_SNAPSHOT);
  let bound = false;
  let pollTimerId = null;
  let mutationGeneration = 0;
  let refreshInFlight = null;
  let isRefreshing = false;
  let lastRenderedSourcesKey = null;
  let lastRenderedMessagesKey = null;
  let statusBannerText = '通知订阅已就绪';
  let statusTone = 'neutral';

  function getService() {
    if (!notificationsService) {
      notificationsService = resolveNotificationsService();
    }
    return notificationsService;
  }

  function resolveFallbackFocus() {
    if (typeof getFallbackFocusElement === 'function') {
      const candidate = getFallbackFocusElement();
      if (candidate && typeof candidate.focus === 'function' && !candidate.hidden && !candidate.disabled) {
        return candidate;
      }
    }
    if (typeof document === 'undefined') return null;
    const settingsModal = document.getElementById('apiConfigModal');
    if (settingsModal && !settingsModal.hidden) {
      const candidates = [
        document.getElementById('notificationMarkAllReadBtn'),
        document.getElementById('notificationRefreshNowBtn'),
        document.getElementById('notificationSourceNameInput'),
        document.getElementById('closeApiModalBtn'),
      ];
      for (const elNode of candidates) {
        if (elNode && !elNode.hidden && !elNode.disabled && typeof elNode.focus === 'function') {
          return elNode;
        }
      }
    }
    return (
      document.getElementById('openSettingsModalBtn') ||
      document.getElementById('spotlightInput') ||
      document.getElementById('focusModeToggle') ||
      null
    );
  }

  function focusSafely(targetEl) {
    if (!targetEl || typeof targetEl.focus !== 'function') return;
    try {
      targetEl.focus({ preventScroll: true });
    } catch {
      // Ignore focus errors
    }
  }

  function safelyRelocateFocusIfInside(containerEl) {
    if (typeof document === 'undefined' || !containerEl) return;
    const active = document.activeElement;
    if (!active) return;
    if (active === containerEl || (typeof containerEl.contains === 'function' && containerEl.contains(active))) {
      focusSafely(resolveFallbackFocus());
    }
  }

  function captureContainerFocusDescriptor(containerEl) {
    if (typeof document === 'undefined' || !containerEl) return null;
    const active = document.activeElement;
    if (!active || (active !== containerEl && !containerEl.contains(active))) return null;

    const msgCard = active.closest?.('.notification-msg-card');
    if (msgCard) {
      return {
        kind: 'message',
        sourceId: msgCard.dataset.sourceId || '',
        messageId: msgCard.dataset.messageId || '',
        action: active.classList.contains('notification-msg-open-link') ? 'open' : 'read',
      };
    }

    const srcRow = active.closest?.('.notification-source-row');
    if (srcRow) {
      return {
        kind: 'source',
        sourceId: srcRow.dataset.sourceId || '',
      };
    }

    return { kind: 'container' };
  }

  function restoreContainerFocusDescriptor(containerEl, descriptor) {
    if (!descriptor || typeof document === 'undefined' || !containerEl) return;
    let target = null;

    if (descriptor.kind === 'message') {
      const cards = Array.from(containerEl.querySelectorAll('.notification-msg-card'));
      const matched = cards.find(
        (c) => c.dataset.sourceId === descriptor.sourceId && c.dataset.messageId === descriptor.messageId
      );
      if (matched) {
        target =
          descriptor.action === 'open'
            ? matched.querySelector('.notification-msg-open-link') ||
              matched.querySelector('button:not([disabled]), a[href]')
            : matched.querySelector('.notification-msg-read-btn:not([disabled])') ||
              matched.querySelector('.notification-msg-open-link');
      }
      if (!target) {
        target = containerEl.querySelector('.notification-msg-read-btn:not([disabled]), .notification-msg-open-link');
      }
    } else if (descriptor.kind === 'source') {
      const rows = Array.from(containerEl.querySelectorAll('.notification-source-row'));
      const matched = rows.find((r) => r.dataset.sourceId === descriptor.sourceId);
      if (matched) {
        target = matched.querySelector('.notification-source-remove-btn:not([disabled])');
      }
      if (!target) {
        target = containerEl.querySelector('.notification-source-remove-btn:not([disabled])');
      }
    }

    focusSafely(target || resolveFallbackFocus());
  }

  function setStatus(text, tone = 'neutral') {
    statusBannerText = String(text || '');
    statusTone = tone;
    renderStatusText();
  }

  function renderStatusText() {
    if (typeof document === 'undefined') return;
    const statusEl = document.getElementById('notificationSettingsStatusText');
    const statusBox = document.getElementById('notificationSettingsStatusBox');
    if (statusEl) {
      setText(statusEl, statusBannerText || '通知订阅已就绪');
    }
    if (statusBox) {
      statusBox.dataset.statusTone = statusTone;
    }
  }

  function updateToolbarControlsState() {
    if (typeof document === 'undefined') return;
    const countBadge = document.getElementById('notificationSourcesCountBadge');
    const refreshBtn = document.getElementById('notificationRefreshNowBtn');
    const addSubmitBtn = document.getElementById('notificationAddSourceBtn');
    const unreadBadgeEl = document.getElementById('notificationInboxSummaryBadge');
    const markAllBtn = document.getElementById('notificationMarkAllReadBtn');

    if (countBadge) {
      setText(countBadge, `${snapshot.sources.length}/${MAX_NOTIFICATION_SOURCES} 个来源`);
    }
    if (refreshBtn) {
      const nextDisabled = isRefreshing || snapshot.sources.length === 0;
      if (nextDisabled) safelyRelocateFocusIfInside(refreshBtn);
      refreshBtn.disabled = nextDisabled;
    }
    if (addSubmitBtn) {
      addSubmitBtn.disabled = snapshot.sources.length >= MAX_NOTIFICATION_SOURCES;
    }

    const totalMessages = snapshot.messages.length;
    const unreadCount = snapshot.unreadCount;
    if (unreadBadgeEl) {
      setText(
        unreadBadgeEl,
        totalMessages === 0
          ? '暂无消息'
          : unreadCount > 0
            ? `${unreadCount} 条未读 · 共 ${totalMessages} 条`
            : `全部已读 · 共 ${totalMessages} 条`
      );
    }
    if (markAllBtn) {
      const nextDisabled = unreadCount <= 0;
      if (nextDisabled) safelyRelocateFocusIfInside(markAllBtn);
      markAllBtn.disabled = nextDisabled;
    }
  }

  function renderDynamicIslandPill() {
    if (typeof document === 'undefined') return;
    const islandBtn = document.getElementById('dynamicIsland');
    if (!islandBtn) return;

    const unreadCount = snapshot.unreadCount;
    const unreadMessages = snapshot.messages.filter((m) => !m.read);

    if (unreadCount <= 0) {
      safelyRelocateFocusIfInside(islandBtn);
      islandBtn.hidden = true;
      islandBtn.setAttribute('aria-hidden', 'true');
      return;
    }

    const distinctUnreadSources = [];
    const seenSources = new Set();
    for (const msg of unreadMessages) {
      const key = msg.sourceId || msg.sourceName;
      if (!seenSources.has(key)) {
        seenSources.add(key);
        distinctUnreadSources.push(msg.sourceName || '通知');
      }
    }
    if (distinctUnreadSources.length === 0 && snapshot.sources.length > 0) {
      distinctUnreadSources.push(snapshot.sources[0].name);
    }

    const primarySourceName = distinctUnreadSources[0] || '通知';
    const sourceSummaryText =
      distinctUnreadSources.length > 1
        ? `${primarySourceName} 等 ${distinctUnreadSources.length} 个来源`
        : primarySourceName;
    const initialChar = extractSourceInitial(primarySourceName);

    const iconEl = document.getElementById('islandSourceInitial');
    const sourceEl = document.getElementById('islandSourceName');
    const countEl = document.getElementById('islandUnreadCount');

    if (iconEl) setText(iconEl, initialChar);
    if (sourceEl) setText(sourceEl, sourceSummaryText);
    if (countEl) setText(countEl, `${unreadCount} 条未读`);

    const ariaLabel = `${sourceSummaryText}，共 ${unreadCount} 条未读通知，点击打开通知收件箱`;
    islandBtn.setAttribute('aria-label', ariaLabel);
    islandBtn.setAttribute('title', ariaLabel);
    islandBtn.hidden = false;
    islandBtn.removeAttribute('aria-hidden');
  }

  function renderSourcesList({ forceDomRebuild = false } = {}) {
    updateToolbarControlsState();
    if (typeof document === 'undefined') return;
    const listEl = document.getElementById('notificationSourcesList');
    if (!listEl) return;

    const nextSourcesKey = JSON.stringify(snapshot.sources);
    if (!forceDomRebuild && nextSourcesKey === lastRenderedSourcesKey && listEl.childNodes.length > 0) {
      return;
    }
    lastRenderedSourcesKey = nextSourcesKey;

    const focusDesc = captureContainerFocusDescriptor(listEl);
    clearElement(listEl);

    if (snapshot.sources.length === 0) {
      listEl.appendChild(
        el('div', {
          className: 'widget-empty-hint notification-empty-hint',
          textContent: '暂未添加通知订阅源。在上方输入名称与 HTTPS JSON 地址即可订阅。',
        })
      );
      restoreContainerFocusDescriptor(listEl, focusDesc);
      return;
    }

    for (const src of snapshot.sources) {
      const lastSuccessLabel = src.lastSuccessAt
        ? `上次成功：${formatIsoTimestampShort(src.lastSuccessAt)}`
        : '上次成功：尚未拉取成功';

      const infoCol = el(
        'div',
        { className: 'notification-source-info' },
        el(
          'div',
          { className: 'notification-source-title-row' },
          el('span', {
            className: 'notification-source-avatar',
            'aria-hidden': 'true',
            textContent: extractSourceInitial(src.name),
          }),
          el('span', { className: 'notification-source-name', textContent: src.name })
        ),
        el('div', { className: 'notification-source-url', textContent: src.url }),
        el('div', { className: 'notification-source-meta', textContent: lastSuccessLabel })
      );

      if (src.error) {
        infoCol.appendChild(
          el('div', {
            className: 'notification-source-error',
            role: 'status',
            textContent: `错误：${src.error}`,
          })
        );
      }

      const removeBtn = el('button', {
        type: 'button',
        className: 'ui-btn ui-btn-sm notification-source-remove-btn',
        'aria-label': `删除订阅源 ${src.name}`,
        textContent: '删除',
      });
      removeBtn.addEventListener('click', () => {
        handleRemoveSource(src.id, src.name, removeBtn);
      });

      const row = el(
        'div',
        {
          className: `notification-source-row ${src.error ? 'has-error' : ''}`.trim(),
          dataset: { sourceId: src.id },
        },
        infoCol,
        el('div', { className: 'notification-source-actions' }, removeBtn)
      );
      listEl.appendChild(row);
    }

    restoreContainerFocusDescriptor(listEl, focusDesc);
  }

  function renderInboxList({ forceDomRebuild = false } = {}) {
    updateToolbarControlsState();
    if (typeof document === 'undefined') return;
    const inboxListEl = document.getElementById('notificationInboxList');
    if (!inboxListEl) return;

    const nextMessagesKey = JSON.stringify({
      sourcesCount: snapshot.sources.length,
      messages: snapshot.messages,
    });
    if (!forceDomRebuild && nextMessagesKey === lastRenderedMessagesKey && inboxListEl.childNodes.length > 0) {
      return;
    }
    lastRenderedMessagesKey = nextMessagesKey;

    const focusDesc = captureContainerFocusDescriptor(inboxListEl);
    clearElement(inboxListEl);

    if (snapshot.messages.length === 0) {
      inboxListEl.appendChild(
        el('div', {
          className: 'widget-empty-hint notification-empty-hint',
          textContent:
            snapshot.sources.length === 0
              ? '暂无通知历史。添加 HTTPS JSON 订阅源后，收到的通知与已读记录会在此显示。'
              : '当前订阅源暂无通知消息。点击「立即刷新」可拉取最新动态。',
        })
      );
      restoreContainerFocusDescriptor(inboxListEl, focusDesc);
      return;
    }

    for (const msg of snapshot.messages) {
      const isUnread = !msg.read;
      const timeLabel = formatIsoTimestampShort(msg.publishedAt) || '刚刚';

      const statePill = el('span', {
        className: `notification-msg-state-pill ${isUnread ? 'is-unread' : 'is-read'}`,
        textContent: isUnread ? '未读' : '已读',
      });

      const topMetaRow = el(
        'div',
        { className: 'notification-msg-header' },
        el(
          'div',
          { className: 'notification-msg-source-wrap' },
          el('span', {
            className: 'notification-source-avatar is-sm',
            'aria-hidden': 'true',
            textContent: extractSourceInitial(msg.sourceName),
          }),
          el('span', { className: 'notification-msg-source', textContent: msg.sourceName }),
          statePill
        ),
        el('span', { className: 'notification-msg-time', textContent: timeLabel })
      );

      const titleEl = el('div', {
        className: 'notification-msg-title',
        textContent: msg.title,
      });

      const cardBodyNodes = [topMetaRow, titleEl];

      if (msg.body) {
        cardBodyNodes.push(
          el('p', {
            className: 'notification-msg-body',
            textContent: msg.body,
          })
        );
      }

      const actionsRow = el('div', { className: 'notification-msg-actions' });

      const validUrl = msg.url ? safeHttpsUrl(msg.url) : null;
      if (validUrl) {
        const openLink = el('a', {
          className: 'ui-btn ui-btn-sm notification-msg-open-link',
          href: validUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': `打开详情链接：${msg.title}`,
          textContent: '打开链接 ↗',
        });
        openLink.addEventListener('click', () => {
          if (isUnread) {
            handleMarkOneRead(msg.sourceId, msg.id, null);
          }
        });
        actionsRow.appendChild(openLink);
      }

      if (isUnread) {
        const markReadBtn = el('button', {
          type: 'button',
          className: 'ui-btn ui-btn-sm notification-msg-read-btn',
          'aria-label': `将「${msg.title}」标为已读`,
          textContent: '标为已读',
        });
        markReadBtn.addEventListener('click', () => {
          handleMarkOneRead(msg.sourceId, msg.id, markReadBtn);
        });
        actionsRow.appendChild(markReadBtn);
      }

      if (actionsRow.childNodes.length > 0) {
        cardBodyNodes.push(actionsRow);
      }

      const msgCard = el(
        'article',
        {
          className: `notification-msg-card ${isUnread ? 'is-unread' : 'is-read'}`,
          dataset: {
            sourceId: msg.sourceId,
            messageId: msg.id,
            read: isUnread ? 'false' : 'true',
          },
        },
        ...cardBodyNodes
      );

      inboxListEl.appendChild(msgCard);
    }

    restoreContainerFocusDescriptor(inboxListEl, focusDesc);
  }

  function applySnapshot(nextRawSnapshot, { forceDomRebuild = false } = {}) {
    snapshot = normalizeSnapshot(nextRawSnapshot);
    renderDynamicIslandPill();
    renderSourcesList({ forceDomRebuild });
    renderInboxList({ forceDomRebuild });
    renderStatusText();
    return snapshot;
  }

  async function syncLatestSnapshotFromService() {
    try {
      const fresh = await getService().getSnapshot();
      return applySnapshot(fresh);
    } catch {
      return snapshot;
    }
  }

  async function refreshNotifications({ force = false, silent = false } = {}) {
    if (refreshInFlight) {
      if (!force) {
        return refreshInFlight;
      }
      try {
        await refreshInFlight;
      } catch {
        // Proceed with forced refresh after previous in-flight refresh settles
      }
    }

    const startGen = mutationGeneration;
    isRefreshing = true;
    updateToolbarControlsState();
    if (!silent) {
      setStatus('正在同步订阅通知…', 'loading');
    }

    let currentRun = null;
    currentRun = (async () => {
      try {
        const nextSnap = await getService().refresh({ force: Boolean(force) });
        if (mutationGeneration !== startGen) {
          const merged = await getService().getSnapshot();
          applySnapshot(merged);
        } else {
          applySnapshot(nextSnap);
        }
        const errSource = snapshot.sources.find((s) => s.error);
        if (errSource) {
          setStatus(`已刷新，部分来源返回错误：${errSource.name} (${errSource.error})`, 'error');
        } else if (!silent) {
          setStatus(
            snapshot.sources.length > 0
              ? `通知已更新（${snapshot.unreadCount} 条未读）`
              : '通知订阅已就绪',
            'success'
          );
        }
      } catch (err) {
        await syncLatestSnapshotFromService();
        if (!silent) {
          setStatus(err?.message || '刷新通知订阅失败，已保留本地缓存消息', 'error');
        }
      } finally {
        if (refreshInFlight === currentRun) {
          isRefreshing = false;
          refreshInFlight = null;
          updateToolbarControlsState();
        }
      }
      return snapshot;
    })();

    refreshInFlight = currentRun;
    return currentRun;
  }

  async function handleAddSourceSubmit(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (typeof document === 'undefined') return;
    const nameInput = document.getElementById('notificationSourceNameInput');
    const urlInput = document.getElementById('notificationSourceUrlInput');
    const submitBtn = document.getElementById('notificationAddSourceBtn');

    if (snapshot.sources.length >= MAX_NOTIFICATION_SOURCES) {
      setStatus(`最多可以订阅 ${MAX_NOTIFICATION_SOURCES} 个通知来源`, 'error');
      return;
    }

    let validated = null;
    try {
      validated = notificationSource({
        name: nameInput?.value || '',
        url: urlInput?.value || '',
      });
    } catch (validationErr) {
      setStatus(validationErr?.message || '请输入有效的来源名称与 HTTPS 订阅地址', 'error');
      return;
    }

    mutationGeneration += 1;
    let addPromise = null;
    try {
      // IMPORTANT: Call addSource synchronously inside the form submit gesture before any await
      addPromise = getService().addSource({
        name: validated.name,
        url: validated.url,
      });
    } catch (syncErr) {
      setStatus(syncErr?.message || '添加通知订阅源失败', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    setStatus(`正在添加「${validated.name}」并校验权限…`, 'loading');

    try {
      const addedSnapshot = await addPromise;
      applySnapshot(addedSnapshot);
      if (nameInput) nameInput.value = '';
      if (urlInput) urlInput.value = '';
      setStatus(`已添加订阅源「${validated.name}」，正在拉取通知…`, 'loading');
      await refreshNotifications({ force: true, silent: false });
    } catch (err) {
      await syncLatestSnapshotFromService();
      setStatus(err?.message || '未能添加订阅源，请确认已授予域名访问权限且地址为有效 HTTPS JSON', 'error');
    } finally {
      updateToolbarControlsState();
    }
  }

  async function handleRemoveSource(sourceId, sourceName, triggerBtn) {
    if (!sourceId) return;
    mutationGeneration += 1;
    if (triggerBtn) {
      triggerBtn.disabled = true;
    }
    try {
      const nextSnap = await getService().removeSource(sourceId);
      applySnapshot(nextSnap);
      setStatus(`已移除订阅源「${sourceName || sourceId}」及其历史通知`, 'neutral');
    } catch (err) {
      await syncLatestSnapshotFromService();
      setStatus(err?.message || '删除订阅源失败', 'error');
    }
  }

  async function handleMarkOneRead(sourceId, messageId, triggerBtn) {
    if (!sourceId || !messageId) return;
    mutationGeneration += 1;
    if (triggerBtn) {
      triggerBtn.disabled = true;
    }
    try {
      const nextSnap = await getService().markRead(sourceId, messageId);
      applySnapshot(nextSnap);
    } catch (err) {
      await syncLatestSnapshotFromService();
      setStatus(err?.message || '标记已读失败', 'error');
    }
  }

  async function handleMarkAllRead(triggerBtn) {
    if (snapshot.unreadCount <= 0) return;
    mutationGeneration += 1;
    if (triggerBtn) {
      safelyRelocateFocusIfInside(triggerBtn);
      triggerBtn.disabled = true;
    }
    try {
      const nextSnap = await getService().markAllRead();
      applySnapshot(nextSnap);
      setStatus('已将全部通知标为已读', 'success');
    } catch (err) {
      await syncLatestSnapshotFromService();
      setStatus(err?.message || '全部标为已读失败', 'error');
    }
  }

  function openNotificationsInboxFromPill() {
    if (typeof openSettingsModalForNotifications === 'function') {
      openSettingsModalForNotifications();
    }
    if (typeof document !== 'undefined') {
      const inboxSection = document.getElementById('notificationInboxSection');
      const markAllBtn = document.getElementById('notificationMarkAllReadBtn');
      const firstAction =
        (markAllBtn && !markAllBtn.disabled ? markAllBtn : null) ||
        inboxSection?.querySelector('button:not([disabled]), a[href]') ||
        document.getElementById('notificationRefreshNowBtn') ||
        document.getElementById('closeApiModalBtn');
      focusSafely(firstAction);
    }
  }

  function bindDOMEvents() {
    if (bound || typeof document === 'undefined') return;
    bound = true;

    const islandBtn = document.getElementById('dynamicIsland');
    const addForm = document.getElementById('notificationAddSourceForm');
    const refreshBtn = document.getElementById('notificationRefreshNowBtn');
    const markAllBtn = document.getElementById('notificationMarkAllReadBtn');

    if (islandBtn) {
      islandBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNotificationsInboxFromPill();
      });
    }

    if (addForm) {
      addForm.addEventListener('submit', handleAddSourceSubmit);
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        refreshNotifications({ force: true, silent: false });
      });
    }

    if (markAllBtn) {
      markAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleMarkAllRead(markAllBtn);
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshNotifications({ force: false, silent: true }).catch(() => {});
      }
    });

    if (setIntervalFn) {
      if (pollTimerId && clearIntervalFn) {
        clearIntervalFn(pollTimerId);
      }
      pollTimerId = setIntervalFn(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        refreshNotifications({ force: false, silent: true }).catch(() => {});
      }, pollIntervalMs);
      pollTimerId?.unref?.();
    }
  }

  async function init() {
    bindDOMEvents();
    renderDynamicIslandPill();
    renderSourcesList({ forceDomRebuild: true });
    renderInboxList({ forceDomRebuild: true });
    renderStatusText();

    try {
      const initialSnap = await getService().getSnapshot();
      applySnapshot(initialSnap);
    } catch {
      // Keep empty fallback snapshot if local storage read fails
    }

    if (typeof document === 'undefined' || !document.hidden) {
      refreshNotifications({ force: false, silent: true }).catch(() => {});
    }
    return snapshot;
  }

  return {
    init,
    getSnapshot: () => structuredClone(snapshot),
    refreshNotifications,
    openNotificationsInboxFromPill,
  };
}
