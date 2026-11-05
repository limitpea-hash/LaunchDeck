export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function check(condition, message) {
  if (!condition) throw new HttpError(400, message);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max, name, required = true) {
  check(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0), `${name}格式不正确`);
}

function validateSites(sites) {
  check(Array.isArray(sites) && sites.length <= 1000, '网站列表最多包含 1000 项');
  const ids = new Set();
  for (const site of sites) {
    check(object(site), '网站格式不正确');
    check(typeof site.id === 'string' && /^[a-z0-9_-]{1,100}$/i.test(site.id) && !ids.has(site.id), '网站 ID 不正确或重复');
    ids.add(site.id);
    text(site.title, 100, '网站名称');
    text(site.url, 4096, '网址');
    let url;
    try { url = new URL(site.url); } catch { throw new HttpError(400, '网址格式不正确'); }
    check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, '网址必须使用 HTTP 或 HTTPS，且不能包含密码');
    check(['ai', 'design', 'dev', 'media'].includes(site.category), '网站分类不正确');
    check(typeof site.pinned === 'boolean', '固定状态必须为布尔值');
    check(typeof site.gradient === 'string' && site.gradient.length <= 300 && /^linear-gradient\([\da-z\s.,%#-]+\)$/i.test(site.gradient), '图标渐变格式不正确');
    check(typeof site.accent === 'string' && /^#[\da-f]{6}$/i.test(site.accent), '图标主题色格式不正确');
    if (site.iconKey !== undefined) check(typeof site.iconKey === 'string' && /^[a-z0-9_]{1,64}$/i.test(site.iconKey), '图标名称不正确');
    if (site.keywords !== undefined) text(site.keywords, 2000, '关键词', false);
    check(Object.keys(site).every(key => ['id', 'title', 'url', 'category', 'pinned', 'gradient', 'accent', 'iconKey', 'keywords'].includes(key)), '网站包含未知字段');
  }
}

function validatePrefs(prefs) {
  check(object(prefs), '外观设置格式不正确');
  check(['light', 'dark', 'tinted'].includes(prefs.iconMode), '图标模式不正确');
  check(['small', 'large'].includes(prefs.iconSize), '图标尺寸不正确');
  check(['ios18-bloom', 'ios18-pink', 'ios18-teal', 'sequoia-gold', 'titanium-dark'].includes(prefs.wallpaper), '壁纸不正确');
  check(typeof prefs.wallpaperDimmed === 'boolean' && typeof prefs.focusActive === 'boolean', '外观开关格式不正确');
  check(Number.isInteger(prefs.tintHue) && prefs.tintHue >= 0 && prefs.tintHue <= 360, '色相必须为 0–360');
  check(Number.isInteger(prefs.tintSat) && prefs.tintSat >= 25 && prefs.tintSat <= 100, '浓度必须为 25–100');
  check(Object.keys(prefs).every(key => ['iconMode', 'iconSize', 'wallpaper', 'wallpaperDimmed', 'tintHue', 'tintSat', 'focusActive'].includes(key)), '外观设置包含未知字段');
}

export function validatePatch(patch, initial = false) {
  check(object(patch), '请求必须是 JSON 对象');
  const keys = Object.keys(patch);
  check(keys.length > 0 && keys.every(key => ['sites', 'prefs', 'note'].includes(key)), '仅支持 sites、prefs、note 字段');
  if (initial) check(['sites', 'prefs', 'note'].every(key => keys.includes(key)), '首次保存需要完整的网站、外观和便签数据');
  if ('sites' in patch) validateSites(patch.sites);
  if ('prefs' in patch) validatePrefs(patch.prefs);
  if ('note' in patch) text(patch.note, 100000, '便签', false);
  return patch;
}
