import { check } from '../../features/schema.js';

const SIZES = new Set([16, 32, 48, 64, 128]);

export function faviconPageUrl(input) {
  check(typeof input === 'string' && input.length > 0 && input.length <= 4096, '网站地址格式不正确');
  let url;
  try { url = new URL(input); } catch { check(false, '网站地址格式不正确'); }
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, '图标仅支持不带账号密码的 HTTP/HTTPS 网站');
  // Only the site origin enters the browser icon query, never private paths or tokens.
  return `${url.origin}/`;
}

export function browserFaviconUrl(input, { extensionId, size = 64 } = {}) {
  const pageUrl = faviconPageUrl(input);
  check(typeof extensionId === 'string' && /^[a-p]{32}$/.test(extensionId), '扩展 ID 不正确');
  check(SIZES.has(size), '图标尺寸仅支持 16、32、48、64、128');
  const url = new URL(`chrome-extension://${extensionId}/_favicon/`);
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.href;
}

export function presetIconKey(site, { icons, domains }) {
  if (typeof site?.iconKey === 'string' && Object.hasOwn(icons, site.iconKey)) return site.iconKey;
  try {
    const host = new URL(faviconPageUrl(site?.url)).hostname.replace(/^www\./, '');
    const key = Object.hasOwn(domains, host) ? domains[host] : null;
    return key && Object.hasOwn(icons, key) ? key : null;
  } catch { return null; }
}

// Extension-only compatibility layer. Antigravity can call the same helper at render time.
export function installFaviconEnhancement({ document, MutationObserver, extensionId, presets }) {
  const negative = new Map();
  const pending = new Set();
  let stopped = false;
  let scheduled = false;

  function enhance(wrapper) {
    if (stopped || !wrapper.isConnected || wrapper.querySelector('svg, .app-browser-favicon') || wrapper.dataset.browserIconState) return;
    const letter = wrapper.querySelector('.app-glyph-letter');
    const link = wrapper.closest('a.app-item, a.dock-item');
    const mini = wrapper.closest('.folder-mini-icon[data-site-url]');
    const sourceUrl = link?.href || mini?.dataset?.siteUrl;
    if (!letter || !sourceUrl) return;
    const site = { url: sourceUrl };
    const key = presetIconKey(site, presets);
    if (key) {
      // These SVG strings are generated from the reviewed local ICONS constant, never a response or setting.
      wrapper.innerHTML = presets.icons[key];
      wrapper.dataset.browserIconState = 'preset';
      return;
    }
    let url;
    try { url = browserFaviconUrl(site.url, { extensionId, size: 64 }); }
    catch { return; }
    if ((negative.get(url) || 0) > Date.now()) { wrapper.dataset.browserIconState = 'failed'; return; }
    wrapper.dataset.browserIconState = 'loading';
    const image = document.createElement('img');
    image.className = 'app-browser-favicon';
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    // Eager is deliberate: a hidden lazy image may never load, so the text fallback would never switch.
    image.loading = 'eager';
    image.draggable = false;
    image.hidden = true;
    let timer;
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; pending.delete(cancel); };
    const fail = () => {
      cleanup();
      if (stopped) return;
      negative.set(url, Date.now() + 300000);
      while (negative.size > 128) negative.delete(negative.keys().next().value);
      wrapper.dataset.browserIconState = 'failed';
      image.remove();
      letter.hidden = false;
    };
    const cancel = () => { cleanup(); image.remove(); letter.hidden = false; delete wrapper.dataset.browserIconState; };
    image.onload = () => {
      cleanup();
      if (stopped || !wrapper.isConnected) return;
      if (!image.naturalWidth || !image.naturalHeight) { fail(); return; }
      image.hidden = false;
      letter.hidden = true;
      wrapper.dataset.browserIconState = 'ready';
    };
    image.onerror = fail;
    pending.add(cancel);
    timer = setTimeout(fail, 8000);
    wrapper.appendChild(image);
    image.src = url;
  }

  function scan() {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!stopped) document.querySelectorAll('.app-glyph').forEach(enhance);
    });
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.body, { subtree: true, childList: true });
  scan();
  return {
    refresh() {
      negative.clear();
      document.querySelectorAll('.app-glyph').forEach(wrapper => {
        if (wrapper.dataset.browserIconState === 'failed') delete wrapper.dataset.browserIconState;
      });
      scan();
    },
    destroy() { stopped = true; observer.disconnect(); for (const cancel of [...pending]) cancel(); negative.clear(); },
  };
}
