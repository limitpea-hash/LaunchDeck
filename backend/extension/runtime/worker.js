import { createExtensionApi, RPC_CHANNEL } from './api.js';
import { createBrowserEnvironment } from './environment.js';

const api = createExtensionApi({ storage: chrome.storage.local, extensionId: chrome.runtime.id,
  permissions: chrome.permissions, environment: createBrowserEnvironment({ permissions: chrome.permissions }) });

// Register synchronously so a suspended service worker can wake for the first request.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== RPC_CHANNEL) return false;
  api(message, sender).then(respond, () => respond({ status: 503, headers: {}, body: { error: '本地数据服务暂时不可用，请重试' } }));
  return true;
});

// No content scripts or externally_connectable entries are granted storage access.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
