import { HttpError } from '../../validation.js';
import { check, record } from '../../features/schema.js';
import { createNotificationService, notificationSource } from '../../features/notifications.js';

const STORAGE_KEY = 'launchdeck-notifications-v1';

function hostPermission(url) {
  return { origins: [`${url.protocol}//${url.hostname}/*`] };
}

export function createExtensionNotificationHandler({ storage, permissions, fetchImpl, now }) {
  let pending = Promise.resolve();
  const read = async () => (await storage.get(STORAGE_KEY))[STORAGE_KEY];
  const store = {
    read: () => pending.then(read),
    update(change) {
      const result = pending.then(async () => {
        const previous = await read();
        const value = change(previous);
        if (value !== previous) await storage.set({ [STORAGE_KEY]: value });
        return value;
      });
      pending = result.catch(() => {});
      return result;
    },
  };
  const canFetch = url => permissions?.contains(hostPermission(url));
  const service = createNotificationService({ store, canFetch, fetchImpl, now });
  return async (method, body) => {
    if (method === 'GET') return service.getSnapshot();
    if (method !== 'POST') throw new HttpError(405, '通知接口方法不支持');
    switch (body?.action) {
      case 'addSource': {
        record(body, ['action', 'source'], '添加订阅请求');
        const source = notificationSource(body.source);
        if (!await canFetch(new URL(source.url))) throw new HttpError(403, '请允许访问订阅来源域名');
        return service.addSource(source);
      }
      case 'removeSource':
        record(body, ['action', 'id'], '删除订阅请求');
        return service.removeSource(body.id);
      case 'refresh':
        record(body, ['action', 'force'], '刷新请求');
        check(typeof body.force === 'boolean', '刷新参数不正确');
        return service.refresh({ force: body.force });
      case 'markRead':
        record(body, ['action', 'sourceId', 'messageId'], '标记已读请求');
        return service.markRead(body.sourceId, body.messageId);
      case 'markAllRead':
        record(body, ['action'], '全部标记已读请求');
        return service.markAllRead();
      default:
        throw new HttpError(400, '未知的通知操作');
    }
  };
}

export function createExtensionNotificationClient({ permissions, request }) {
  return Object.freeze({
    getSnapshot: () => request(),
    async addSource(input) {
      const source = notificationSource(input);
      // Request from the original submit gesture before the first await.
      if (!await permissions.request(hostPermission(new URL(source.url)))) {
        throw new HttpError(403, '未授权访问此订阅来源');
      }
      return request({ action: 'addSource', source });
    },
    removeSource: id => request({ action: 'removeSource', id }),
    refresh: ({ force = false } = {}) => request({ action: 'refresh', force }),
    markRead: (sourceId, messageId) => request({ action: 'markRead', sourceId, messageId }),
    markAllRead: () => request({ action: 'markAllRead' }),
  });
}
