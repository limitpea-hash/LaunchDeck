import { HttpError, validatePatch } from '../../validation.js';
import { defaultWidgetState, validateWidgetPatch, validateWidgetDocument } from '../../features/widgets.js';
import { defaultDeviceSettings, validateSettingsPatch } from '../../features/settings.js';
import { record, check } from '../../features/schema.js';
import { validateBrowserData } from './backup.js';

export const STORE_KEY = 'launchdeck_extension_documents_v1';
export const LEGACY_STORE_KEY = 'agy_extension_documents_v1';

function document(state) {
  return { revision: 0, state, updatedAt: null };
}

function defaults() {
  return { schemaVersion: 1, portal: document(null), widgets: document(defaultWidgetState()), device: document(defaultDeviceSettings()), browserData: null };
}

// One service worker owns mutations; all read-modify-write operations share this queue.
export function createLocalDocuments(storage, { now = Date.now } = {}) {
  let queue = Promise.resolve();

  async function readAll() {
    let saved = (await storage.get(STORE_KEY))[STORE_KEY];
    // Read the previous release in place. First successful mutation writes the new key;
    // keeping the old entry intact makes a failed migration recoverable.
    if (saved === undefined) saved = (await storage.get(LEGACY_STORE_KEY))[LEGACY_STORE_KEY];
    if (saved === undefined) return defaults();
    if (!saved || saved.schemaVersion !== 1 || !saved.portal || !saved.widgets || !saved.device) {
      throw new HttpError(503, '本地数据版本无法识别，请先备份数据再检查扩展版本');
    }
    for (const kind of ['portal', 'widgets', 'device']) {
      if (!Number.isSafeInteger(saved[kind].revision) || saved[kind].revision < 0) throw new HttpError(503, '本地数据版本损坏，请保留备份后检查');
    }
    return structuredClone(saved);
  }

  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function saveAll(value) {
    try { await storage.set({ [STORE_KEY]: value }); }
    catch { throw new HttpError(503, '浏览器本地存储写入失败，请检查可用空间或备份后重试'); }
  }

  return {
    async read(kind) {
      check(['portal', 'widgets', 'device'].includes(kind), '文档类型不正确');
      await queue;
      return (await readAll())[kind];
    },
    patch(kind, patch, ifMatch) {
      return serialize(async () => {
        check(['portal', 'widgets', 'device'].includes(kind), '文档类型不正确');
        if (!/^"\d+"$/.test(ifMatch || '')) throw new HttpError(428, '需要提交当前本地数据版本');
        const all = await readAll();
        const previous = all[kind];
        if (ifMatch !== `"${previous.revision}"`) throw new HttpError(409, '另一个标签页已更新数据，请重新读取后选择保留版本');
        if (kind === 'portal') validatePatch(patch, previous.state === null);
        else if (kind === 'widgets') validateWidgetPatch(patch);
        else validateSettingsPatch(patch);
        const state = { ...previous.state, ...patch };
        if (kind === 'widgets') validateWidgetDocument(state, previous.state);
        all[kind] = { revision: previous.revision + 1, state, updatedAt: new Date(now()).toISOString() };
        await saveAll(all);
        return structuredClone(all[kind]);
      });
    },
    async exportData() {
      await queue;
      const all = await readAll();
      return { format: 'launchdeck-new-tab', version: 1, exportedAt: new Date(now()).toISOString(),
        portal: all.portal.state, widgets: all.widgets.state, device: all.device.state, browserData: all.browserData ?? null };
    },
    importData(input) {
      return serialize(async () => {
        record(input, ['format', 'version', 'exportedAt', 'portal', 'widgets', 'device', 'browserData'], '备份文件');
        check(['launchdeck-new-tab', 'agy-new-tab'].includes(input.format) && input.version === 1, '备份格式或版本不正确');
        if (input.portal !== null) validatePatch(input.portal, true);
        validateWidgetDocument(input.widgets);
        record(input.device, ['location', 'clock', 'weather'], '设备备份');
        check(['location', 'clock', 'weather'].every(key => key in input.device), '设备备份不完整');
        validateSettingsPatch(input.device);
        validateBrowserData(input.browserData);
        if (input.browserData && input.portal) {
          const ids = new Set(input.portal.sites.map(site => site.id));
          check(input.browserData.customSites.every(site => !ids.has(site.id)), '预设网站与自定义网站 ID 重复');
        }
        const all = await readAll();
        for (const [kind, state] of Object.entries({ portal: input.portal, widgets: input.widgets, device: input.device })) {
          all[kind] = { revision: all[kind].revision + 1, state: structuredClone(state), updatedAt: new Date(now()).toISOString() };
        }
        if (input.browserData !== undefined) all.browserData = structuredClone(input.browserData);
        await saveAll(all);
        return { success: true };
      });
    },
    async readBrowserData() { await queue; return (await readAll()).browserData ?? null; },
  };
}
