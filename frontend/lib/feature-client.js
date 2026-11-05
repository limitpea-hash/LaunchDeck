import { el, clearElement } from './dom.js';

const WIDGET_CACHE_KEY = 'ios18_widgets_state_v1';
const WIDGET_REV_KEY = 'ios18_widgets_revision_v1';
const WIDGET_OUTBOX_KEY = 'ios18_widgets_outbox_v1';

export const DEFAULT_WIDGET_DEFINITIONS = [
  { type: 'clock-weather', title: '时钟与天气', version: 1, sizes: ['medium'], defaultConfig: { showSeconds: true }, capabilities: ['clock', 'weather', 'device-settings'] },
  { type: 'focus-timer', title: '专注计时', version: 1, sizes: ['medium'], defaultConfig: { workMinutes: 25, breakMinutes: 5 }, capabilities: ['local-timer'] },
  { type: 'quick-note', title: '速记', version: 1, sizes: ['medium'], defaultConfig: {}, capabilities: ['shared-note'] },
  { type: 'todo', title: '待办清单', version: 1, sizes: ['medium'], defaultConfig: { hideCompleted: false }, capabilities: ['shared-todos'] },
  { type: 'calendar', title: '月历', version: 1, sizes: ['medium'], defaultConfig: { weekStartsOn: 1 }, capabilities: ['clock'] },
  { type: 'world-clock', title: '世界时钟', version: 1, sizes: ['medium'], defaultConfig: { zones: [
    { label: '上海', timeZone: 'Asia/Shanghai' },
    { label: '伦敦', timeZone: 'Europe/London' },
    { label: '纽约', timeZone: 'America/New_York' },
  ] }, capabilities: ['clock'] },
];

export function createDefaultWidgetState(definitions = DEFAULT_WIDGET_DEFINITIONS) {
  return {
    layout: definitions.map((def, order) => ({
      id: def.type,
      type: def.type,
      enabled: true,
      order,
      config: structuredClone(def.defaultConfig),
    })),
    todos: [],
    desktop: null,
  };
}

export function normalizeWidgetState(rawState, definitions = DEFAULT_WIDGET_DEFINITIONS) {
  const defs = Array.isArray(definitions) && definitions.length > 0
    ? definitions
    : DEFAULT_WIDGET_DEFINITIONS;
  const fallback = createDefaultWidgetState(defs);
  if (!rawState || typeof rawState !== 'object') {
    return fallback;
  }

  const layout = Array.isArray(rawState.layout)
    ? structuredClone(rawState.layout)
    : fallback.layout;
  const todos = Array.isArray(rawState.todos)
    ? structuredClone(rawState.todos)
    : [];

  let desktop = null;
  if (
    rawState.desktop &&
    typeof rawState.desktop === 'object' &&
    Array.isArray(rawState.desktop.pages) &&
    Array.isArray(rawState.desktop.placements)
  ) {
    const rawVersion = Number(rawState.desktop.schemaVersion);
    const hasFoldersArray = Array.isArray(rawState.desktop.folders);
    const schemaVersion = rawVersion === 2 || hasFoldersArray ? 2 : 1;
    desktop = {
      schemaVersion,
      pages: structuredClone(rawState.desktop.pages),
      placements: structuredClone(rawState.desktop.placements),
      ...(schemaVersion === 2
        ? {
            folders: hasFoldersArray ? structuredClone(rawState.desktop.folders) : [],
          }
        : {}),
    };
  }

  return {
    layout,
    todos,
    desktop,
  };
}

export function createDefaultDeviceSettings() {
  return {
    location: { mode: 'auto', manual: null },
    clock: { mode: 'automatic', timeZoneMode: 'browser', timeZone: 'Asia/Shanghai', offsetSeconds: 0 },
    weather: { temperatureUnit: 'celsius' },
  };
}

function readJsonStorage(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(storage, key, value) {
  if (!storage) return;
  try {
    if (value === null || value === undefined) storage.removeItem(key);
    else storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

export function createFeatureClient({
  fetchImpl = (...args) => globalThis.fetch(...args),
  storage = globalThis.localStorage,
  protocol = globalThis.location?.protocol || 'http:',
} = {}) {
  const isHttp = ['http:', 'https:'].includes(protocol);
  const statusSubscribers = new Set();
  const conflictSubscribers = new Set();

  let widgetRevision = Number(readJsonStorage(storage, WIDGET_REV_KEY) ?? 0);
  let widgetState = normalizeWidgetState(readJsonStorage(storage, WIDGET_CACHE_KEY));
  let widgetTimer = null;
  let widgetSaving = false;
  let widgetConflictServerDoc = null;

  let deviceRevision = 0;
  let deviceSettings = createDefaultDeviceSettings();
  let deviceSaving = false;
  let PendingDevicePatch = null;
  let deviceConflictServerDoc = null;

  const statusState = {
    widgets: { state: 'idle', message: '未同步', error: null },
    device: { state: 'idle', message: '未同步', error: null },
  };

  function emitStatus(channel, state, message, error = null) {
    statusState[channel] = { state, message, error };
    for (const fn of statusSubscribers) {
      try {
        fn({ channel, ...statusState[channel], all: structuredClone(statusState) });
      } catch {
        // Ignore subscriber error
      }
    }
  }

  function emitConflict(conflictInfo) {
    for (const fn of conflictSubscribers) {
      try {
        fn(conflictInfo);
      } catch {
        // Ignore subscriber error
      }
    }
    renderConflictDialog(conflictInfo);
  }

  async function requestJson(path, { method = 'GET', body, ifMatch, signal, timeoutMs = 8000 } = {}) {
    if (!isHttp) {
      const err = new Error('当前为本地文件预览，未连接服务器');
      err.status = 0;
      throw err;
    }
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ifMatch !== undefined) headers['If-Match'] = `"${ifMatch}"`;

    const timeoutSignal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    const combinedSignal = signal && timeoutSignal && AbortSignal.any
      ? AbortSignal.any([signal, timeoutSignal])
      : (signal || timeoutSignal);

    const res = await fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(combinedSignal ? { signal: combinedSignal } : {}),
    });

    const retryAfterHeader = res.headers?.get?.('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Math.max(1, Number(retryAfterHeader) || 5) : null;

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const err = new Error(payload?.error || `请求失败 (${res.status})`);
      err.status = res.status;
      err.retryAfterSeconds = retryAfterSeconds;
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  async function loadWidgetsRegistry() {
    try {
      const data = await requestJson('/api/widgets');
      if (data && Array.isArray(data.widgets)) {
        return data.widgets;
      }
    } catch {
      // Fallback to built-in definitions if offline
    }
    return structuredClone(DEFAULT_WIDGET_DEFINITIONS);
  }

  async function loadWidgetsState() {
    const outbox = readJsonStorage(storage, WIDGET_OUTBOX_KEY);
    if (!isHttp) {
      emitStatus('widgets', 'offline', '本机已保存（离线模式）');
      return structuredClone(widgetState);
    }

    try {
      const doc = await requestJson('/api/widgets/state');
      widgetRevision = doc.revision;
      writeJsonStorage(storage, WIDGET_REV_KEY, widgetRevision);

      if (doc.state && typeof doc.state === 'object') {
        const cachedDesktop = widgetState?.desktop || null;
        widgetState = normalizeWidgetState({
          ...doc.state,
          desktop: doc.state.desktop ?? cachedDesktop,
        });
      }

      if (outbox?.patch) {
        const reconciled = Object.entries(outbox.patch).every(
          ([k, v]) => JSON.stringify(widgetState[k]) === JSON.stringify(v)
        );
        if (reconciled) {
          writeJsonStorage(storage, WIDGET_OUTBOX_KEY, null);
        } else if (outbox.blocked || (outbox.revision !== null && outbox.revision !== undefined && outbox.revision !== doc.revision)) {
          widgetConflictServerDoc = structuredClone(doc);
          writeJsonStorage(storage, WIDGET_OUTBOX_KEY, { ...outbox, blocked: true });
          widgetState = normalizeWidgetState({ ...widgetState, ...outbox.patch });
          emitStatus('widgets', 'conflict', '小组件或待办数据存在版本冲突，请选择保留版本');
          emitConflict({
            channel: 'widgets',
            title: '小组件与待办数据版本冲突',
            message: '其他页面或设备已更新小组件布局或待办清单，请选择保留本机未同步修改或载入数据库版本。',
          });
        } else {
          widgetState = normalizeWidgetState({ ...widgetState, ...outbox.patch });
          scheduleWidgetsFlush(0);
        }
      } else {
        emitStatus('widgets', 'synced', '小组件与待办已同步');
      }

      writeJsonStorage(storage, WIDGET_CACHE_KEY, widgetState);
      return structuredClone(widgetState);
    } catch (error) {
      if (outbox?.patch) {
        widgetState = normalizeWidgetState({ ...widgetState, ...outbox.patch });
      }
      emitStatus('widgets', 'error', error.message || '小组件状态读取失败，当前使用本机缓存', error);
      return structuredClone(widgetState);
    }
  }

  function saveWidgetsState(patch, delay = 300) {
    widgetState = normalizeWidgetState({ ...widgetState, ...patch });
    writeJsonStorage(storage, WIDGET_CACHE_KEY, widgetState);

    if (!isHttp) {
      emitStatus('widgets', 'offline', '已保存在本机');
      return;
    }

    const currentOutbox = readJsonStorage(storage, WIDGET_OUTBOX_KEY);
    writeJsonStorage(storage, WIDGET_OUTBOX_KEY, {
      revision: currentOutbox?.revision ?? widgetRevision,
      blocked: Boolean(currentOutbox?.blocked),
      patch: { ...(currentOutbox?.patch || {}), ...patch },
    });

    if (currentOutbox?.blocked) {
      emitStatus('widgets', 'conflict', '请先解决版本冲突后再同步');
      return;
    }

    emitStatus('widgets', 'saving', '正在保存小组件数据…');
    scheduleWidgetsFlush(delay);
  }

  function scheduleWidgetsFlush(delay = 300) {
    if (widgetTimer) clearTimeout(widgetTimer);
    widgetTimer = setTimeout(() => {
      widgetTimer = null;
      flushWidgetsOutbox();
    }, delay);
  }

  async function flushWidgetsOutbox() {
    const currentOutbox = readJsonStorage(storage, WIDGET_OUTBOX_KEY);
    if (!isHttp || widgetSaving || !currentOutbox?.patch || currentOutbox.blocked) return;

    widgetSaving = true;
    const sentPatch = currentOutbox.patch;
    try {
      const targetRev = currentOutbox.revision ?? widgetRevision;
      const saved = await requestJson('/api/widgets/state', {
        method: 'PATCH',
        body: sentPatch,
        ifMatch: targetRev,
      });
      widgetRevision = saved.revision;
      writeJsonStorage(storage, WIDGET_REV_KEY, widgetRevision);

      if (saved.state) {
        const prevDesktop = widgetState?.desktop || null;
        widgetState = normalizeWidgetState({
          ...saved.state,
          desktop: saved.state.desktop ?? prevDesktop,
        });
      }

      const latestOutbox = readJsonStorage(storage, WIDGET_OUTBOX_KEY);
      const remaining = {};
      for (const [k, v] of Object.entries(latestOutbox?.patch || {})) {
        if (JSON.stringify(v) !== JSON.stringify(sentPatch[k])) {
          remaining[k] = v;
        }
      }

      if (Object.keys(remaining).length > 0) {
        writeJsonStorage(storage, WIDGET_OUTBOX_KEY, { revision: widgetRevision, patch: remaining });
        widgetState = normalizeWidgetState({ ...widgetState, ...remaining });
        scheduleWidgetsFlush(300);
      } else {
        writeJsonStorage(storage, WIDGET_OUTBOX_KEY, null);
        emitStatus('widgets', 'synced', '小组件与待办已同步');
      }
      writeJsonStorage(storage, WIDGET_CACHE_KEY, widgetState);
    } catch (error) {
      if (error.status === 409) {
        try {
          widgetConflictServerDoc = await requestJson('/api/widgets/state');
          widgetRevision = widgetConflictServerDoc.revision;
          writeJsonStorage(storage, WIDGET_REV_KEY, widgetRevision);
        } catch {
          // Keep existing revision if re-read fails
        }
        const latest = readJsonStorage(storage, WIDGET_OUTBOX_KEY) || currentOutbox;
        writeJsonStorage(storage, WIDGET_OUTBOX_KEY, { ...latest, blocked: true });
        emitStatus('widgets', 'conflict', '小组件或待办在其他页面已更新，请选择保留版本', error);
        emitConflict({
          channel: 'widgets',
          title: '小组件与待办数据版本冲突',
          message: '其他页面已修改小组件配置或待办列表，请选择保留本机修改或载入服务器最新数据。',
        });
      } else if (error.status === 429) {
        const waitMs = (error.retryAfterSeconds || 5) * 1000;
        emitStatus('widgets', 'error', `请求较频繁，将在 ${Math.ceil(waitMs / 1000)} 秒后重试`, error);
        scheduleWidgetsFlush(waitMs);
      } else if (error.status >= 400 && error.status < 500) {
        writeJsonStorage(storage, WIDGET_OUTBOX_KEY, null);
        emitStatus('widgets', 'error', error.message || '小组件数据格式未通过校验', error);
      } else {
        emitStatus('widgets', 'error', '网络或服务暂不可用，修改已保存在本机，可稍后重试', error);
        scheduleWidgetsFlush(5000);
      }
    } finally {
      widgetSaving = false;
    }
  }

  async function resolveWidgetsConflict(choice, onServerStateApplied) {
    const currentOutbox = readJsonStorage(storage, WIDGET_OUTBOX_KEY);
    if (!currentOutbox) return structuredClone(widgetState);

    if (choice === 'server') {
      writeJsonStorage(storage, WIDGET_OUTBOX_KEY, null);
      if (widgetConflictServerDoc?.state) {
        widgetRevision = widgetConflictServerDoc.revision;
        widgetState = normalizeWidgetState(widgetConflictServerDoc.state);
      } else {
        await loadWidgetsState();
      }
      widgetConflictServerDoc = null;
      writeJsonStorage(storage, WIDGET_REV_KEY, widgetRevision);
      writeJsonStorage(storage, WIDGET_CACHE_KEY, widgetState);
      emitStatus('widgets', 'synced', '已载入数据库中的小组件与待办版本');
      if (typeof onServerStateApplied === 'function') onServerStateApplied(structuredClone(widgetState));
      return structuredClone(widgetState);
    }

    if (!widgetConflictServerDoc) {
      try {
        widgetConflictServerDoc = await requestJson('/api/widgets/state');
        widgetRevision = widgetConflictServerDoc.revision;
      } catch {
        // Ignore
      }
    }
    writeJsonStorage(storage, WIDGET_OUTBOX_KEY, {
      revision: widgetRevision,
      blocked: false,
      patch: currentOutbox.patch,
    });
    widgetConflictServerDoc = null;
    await flushWidgetsOutbox();
    return structuredClone(widgetState);
  }

  async function loadDeviceSettings() {
    if (!isHttp) {
      emitStatus('device', 'offline', '本地预览模式（使用默认设备设置）');
      return structuredClone(deviceSettings);
    }
    try {
      const doc = await requestJson('/api/device/settings');
      deviceRevision = doc.revision;
      if (doc.state && typeof doc.state === 'object') {
        deviceSettings = structuredClone(doc.state);
      }
      emitStatus('device', 'synced', '当前设备设置已就绪');
      return structuredClone(deviceSettings);
    } catch (error) {
      emitStatus('device', 'error', error.message || '读取设备设置失败', error);
      return structuredClone(deviceSettings);
    }
  }

  async function saveDeviceSettings(patch) {
    const cleanPatch = {};
    if ('location' in patch && patch.location) {
      const mode = ['auto', 'browser', 'ip', 'manual'].includes(patch.location.mode)
        ? patch.location.mode
        : 'auto';
      let manual = null;
      if (patch.location.manual && typeof patch.location.manual === 'object') {
        manual = {
          name: String(patch.location.manual.name || '').trim().slice(0, 120),
          latitude: Number(patch.location.manual.latitude),
          longitude: Number(patch.location.manual.longitude),
          timeZone: String(patch.location.manual.timeZone || 'UTC').trim(),
        };
      }
      cleanPatch.location = { mode, manual };
    }
    if ('clock' in patch && patch.clock) {
      cleanPatch.clock = {
        mode: patch.clock.mode === 'manual' ? 'manual' : 'automatic',
        timeZoneMode: ['browser', 'location', 'manual'].includes(patch.clock.timeZoneMode)
          ? patch.clock.timeZoneMode
          : 'browser',
        timeZone: String(patch.clock.timeZone || 'Asia/Shanghai').trim(),
        offsetSeconds: Math.max(-315576000, Math.min(315576000, Math.round(Number(patch.clock.offsetSeconds) || 0))),
      };
    }
    if ('weather' in patch && patch.weather) {
      cleanPatch.weather = {
        temperatureUnit: patch.weather.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
      };
    }

    deviceSettings = { ...deviceSettings, ...cleanPatch };
    if (!isHttp) {
      emitStatus('device', 'offline', '设备设置已在当前会话生效');
      return structuredClone(deviceSettings);
    }

    PendingDevicePatch = { ...(PendingDevicePatch || {}), ...cleanPatch };
    if (deviceSaving) return structuredClone(deviceSettings);

    deviceSaving = true;
    emitStatus('device', 'saving', '正在保存设备设置…');
    try {
      while (PendingDevicePatch) {
        const currentPatch = PendingDevicePatch;
        PendingDevicePatch = null;
        const saved = await requestJson('/api/device/settings', {
          method: 'PATCH',
          body: currentPatch,
          ifMatch: deviceRevision,
        });
        deviceRevision = saved.revision;
        if (saved.state) {
          deviceSettings = structuredClone(saved.state);
        }
      }
      emitStatus('device', 'synced', '当前设备设置已保存');
      return structuredClone(deviceSettings);
    } catch (error) {
      if (error.status === 409) {
        try {
          deviceConflictServerDoc = await requestJson('/api/device/settings');
          deviceRevision = deviceConflictServerDoc.revision;
        } catch {
          // Ignore
        }
        PendingDevicePatch = cleanPatch;
        emitStatus('device', 'conflict', '当前设备设置在另一标签页已更新，请确认保留版本', error);
        emitConflict({
          channel: 'device',
          title: '设备设置版本冲突',
          message: '当前浏览器的另一标签页更新了位置或时钟设置，请选择保留当前修改或载入最新设置。',
        });
      } else {
        emitStatus('device', 'error', error.message || '设备设置保存失败', error);
      }
      throw error;
    } finally {
      deviceSaving = false;
    }
  }

  async function resolveDeviceConflict(choice, onApplied) {
    if (choice === 'server') {
      PendingDevicePatch = null;
      if (deviceConflictServerDoc?.state) {
        deviceRevision = deviceConflictServerDoc.revision;
        deviceSettings = structuredClone(deviceConflictServerDoc.state);
      } else {
        await loadDeviceSettings();
      }
      deviceConflictServerDoc = null;
      emitStatus('device', 'synced', '已载入最新设备设置');
      if (typeof onApplied === 'function') onApplied(structuredClone(deviceSettings));
      return structuredClone(deviceSettings);
    }

    const patchToRetry = PendingDevicePatch || deviceSettings;
    PendingDevicePatch = null;
    deviceConflictServerDoc = null;
    const updated = await saveDeviceSettings(patchToRetry);
    if (typeof onApplied === 'function') onApplied(structuredClone(updated));
    return updated;
  }

  async function getTimeZones() {
    try {
      const res = await requestJson('/api/timezones');
      if (res && Array.isArray(res.timeZones) && res.timeZones.length > 0) {
        return res.timeZones;
      }
    } catch {
      // Fallback below
    }
    try {
      return ['UTC', ...Intl.supportedValuesOf('timeZone')];
    } catch {
      return ['UTC', 'Asia/Shanghai', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];
    }
  }

  async function getTime(browserTimeZone) {
    const query = browserTimeZone
      ? `?browserTimeZone=${encodeURIComponent(browserTimeZone)}`
      : '';
    return requestJson(`/api/time${query}`);
  }

  async function searchLocations(query, { signal } = {}) {
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) {
      const err = new Error('城市关键词至少需要两个字符');
      err.status = 400;
      throw err;
    }
    return requestJson(`/api/location/search?q=${encodeURIComponent(trimmed)}`, { signal });
  }

  async function resolveEnvironment({ browserTimeZone, coordinates } = {}, { signal } = {}) {
    const body = {};
    if (browserTimeZone) body.browserTimeZone = browserTimeZone;
    if (
      coordinates &&
      typeof coordinates.latitude === 'number' &&
      Number.isFinite(coordinates.latitude) &&
      typeof coordinates.longitude === 'number' &&
      Number.isFinite(coordinates.longitude)
    ) {
      body.coordinates = {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      };
    }
    return requestJson('/api/environment/resolve', { method: 'POST', body, signal });
  }

  async function getWeather({ latitude, longitude, timeZone = 'UTC', temperatureUnit = 'celsius' }, { signal } = {}) {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      timeZone,
      temperatureUnit,
    });
    return requestJson(`/api/weather?${params.toString()}`, { signal });
  }

  function renderConflictDialog(info) {
    if (typeof document === 'undefined' || !document.body) return;
    const dialogId = 'featureSyncConflictDialog';
    let existing = document.getElementById(dialogId);
    if (existing) existing.remove();

    const backdrop = el('div', { className: 'modal-backdrop portal-conflict-dialog', id: dialogId });
    const card = el('div', { className: 'ios-modal-card', role: 'alertdialog', 'aria-modal': 'true' });
    const header = el('div', { className: 'modal-top-bar' },
      el('h3', { textContent: info.title || '数据版本冲突' })
    );
    const body = el('div', { className: 'modal-form' },
      el('p', { className: 'conflict-desc-text', textContent: info.message }),
      el('div', { className: 'conflict-actions-row' },
        el('button', { type: 'button', className: 'modal-save-btn', id: 'conflictKeepLocalBtn', textContent: '保留本机修改' }),
        el('button', { type: 'button', className: 'modal-cancel-btn', id: 'conflictLoadServerBtn', textContent: '载入数据库版本' })
      )
    );
    card.append(header, body);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const keepBtn = backdrop.querySelector('#conflictKeepLocalBtn');
    const serverBtn = backdrop.querySelector('#conflictLoadServerBtn');

    keepBtn?.addEventListener('click', async () => {
      backdrop.remove();
      if (info.channel === 'widgets') {
        await resolveWidgetsConflict('local');
      } else {
        await resolveDeviceConflict('local');
      }
      window.dispatchEvent(new CustomEvent('feature:conflict-resolved', { detail: { channel: info.channel, choice: 'local' } }));
    });

    serverBtn?.addEventListener('click', async () => {
      backdrop.remove();
      if (info.channel === 'widgets') {
        await resolveWidgetsConflict('server');
      } else {
        await resolveDeviceConflict('server');
      }
      window.dispatchEvent(new CustomEvent('feature:conflict-resolved', { detail: { channel: info.channel, choice: 'server' } }));
    });
  }

  return {
    loadWidgetsRegistry,
    loadWidgetsState,
    saveWidgetsState,
    flushWidgetsOutbox,
    resolveWidgetsConflict,
    getWidgetsStateSnapshot: () => structuredClone(widgetState),
    loadDeviceSettings,
    saveDeviceSettings,
    resolveDeviceConflict,
    getDeviceSettingsSnapshot: () => structuredClone(deviceSettings),
    getTimeZones,
    getTime,
    searchLocations,
    resolveEnvironment,
    getWeather,
    getStatusSnapshot: () => structuredClone(statusState),
    onStatusChange(fn) {
      statusSubscribers.add(fn);
      return () => statusSubscribers.delete(fn);
    },
    onConflict(fn) {
      conflictSubscribers.add(fn);
      return () => conflictSubscribers.delete(fn);
    },
  };
}
