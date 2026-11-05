import { RPC_CHANNEL } from './api.js';

// Compatibility transport in the generated package only; the web source remains untouched.
export function installFetchBridge({ target = globalThis, runtime = globalThis.chrome.runtime,
  pageLocation = globalThis.location, nativeFetch = globalThis.fetch.bind(globalThis) } = {}) {
  target.fetch = async function extensionFetch(input, options = {}) {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), pageLocation.href);
    if (url.protocol !== pageLocation.protocol || url.host !== pageLocation.host || !url.pathname.startsWith('/api/')) return nativeFetch(input, options);
    const signal = options.signal || request?.signal;
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    const method = options.method || request?.method || 'GET';
    const headers = new Headers(options.headers || request?.headers);
    let body;
    if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
      if (headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return Response.json({ error: '请使用 JSON' }, { status: 415 });
      try { body = JSON.parse(options.body !== undefined ? options.body : await request?.clone().text()); }
      catch { return Response.json({ error: 'JSON 格式不正确' }, { status: 400 }); }
    }
    const pending = runtime.sendMessage({ channel: RPC_CHANNEL, path: `${url.pathname}${url.search}`, method: method.toUpperCase(),
      ifMatch: headers.get('if-match') ?? undefined, ...(body !== undefined ? { body } : {}) });
    let onAbort;
    const abort = signal ? new Promise((resolve, reject) => {
      onAbort = () => reject(new DOMException('Request aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }) : null;
    try {
      const result = await (abort ? Promise.race([pending, abort]) : pending);
      if (!result || !Number.isInteger(result.status)) throw new Error('扩展数据服务未响应，请刷新新标签页');
      return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store', ...result.headers } });
    } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
  };
  return () => { target.fetch = nativeFetch; };
}
