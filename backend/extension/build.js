import { readFile, writeFile, readdir, mkdir, mkdtemp, lstat, rename, rm, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '.launchdeck-generated.json';
const SOURCE_FILES = ['validation.js', 'features/schema.js', 'features/widgets.js', 'features/settings.js', 'features/provider-data.js'];

async function filesBelow(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`构建输入不能包含符号链接：${name}`);
    if (entry.isDirectory()) result.push(...await filesBelow(path, name));
    else if (entry.isFile()) result.push({ path, name });
  }
  return result;
}

function enableExtensionProtocol(source, name) {
  let replacements = 0;
  const result = source.replace(/\[\s*(['"])http:\1\s*,\s*(['"])https:\2\s*\]/g, () => {
    replacements += 1;
    return "['http:', 'https:', 'chrome-extension:']";
  });
  if (!replacements && !source.includes('chrome-extension:')) throw new Error(`${name} 的平台检测入口已变化，请更新扩展构建适配，不能直接发布未适配版本。`);
  return { result, replacements };
}

export function extractIconPresets(source) {
  const iconBlock = source.match(/const ICONS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  const siteBlock = source.match(/const DEFAULT_SITES\s*=\s*\[([\s\S]*?)\n\];/);
  if (!iconBlock || !siteBlock) throw new Error('未找到预设图标或网站常量，请更新扩展构建适配。');
  const icons = {};
  const pattern = /^\s*([a-z0-9_]+):\s*`([^`]*)`,?\s*$/gim;
  for (const [, key, svg] of iconBlock[1].matchAll(pattern)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(icons, key)) throw new Error('预设图标名称不安全或重复。');
    if (!/^<svg\b[\s\S]*<\/svg>$/.test(svg) || svg.length > 20000 || /\$\{|\\|\bon[a-z]+\s*=|\b(?:href|src)\s*=|url\s*\(|<!|<\?/i.test(svg)) throw new Error(`预设图标不是允许的静态 SVG：${key}`);
    const tags = [...svg.matchAll(/<\/?([a-z][a-z0-9-]*)\b/gi)].map(item => item[1].toLowerCase());
    if (!tags.every(tag => ['svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath'].includes(tag))) throw new Error(`预设图标包含不允许的元素：${key}`);
    icons[key] = svg;
  }
  if (!Object.keys(icons).length || iconBlock[1].replace(pattern, '').replace(/^\s*\/\/.*$/gm, '').trim()) throw new Error('预设图标常量格式已变化，拒绝执行源代码来提取图标。');
  const domains = {};
  for (const match of siteBlock[1].matchAll(/\{([^{}]*)\}/g)) {
    const urlValue = match[1].match(/\burl:\s*["']([^"']+)["']/)?.[1];
    const iconKey = match[1].match(/\biconKey:\s*["']([a-z0-9_]+)["']/i)?.[1];
    if (!iconKey) continue;
    if (!urlValue || !Object.hasOwn(icons, iconKey)) throw new Error('预设网站的图标引用不正确。');
    const url = new URL(urlValue);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('预设网站地址不正确。');
    const host = url.hostname.replace(/^www\./, '');
    if (Object.hasOwn(domains, host) && domains[host] !== iconKey) throw new Error('同一预设域名的图标定义冲突。');
    domains[host] = iconKey;
  }
  if (!Object.keys(domains).length) throw new Error('没有可用的预设图标域名映射。');
  return { icons, domains };
}

export async function buildExtension({ sourceRoot = projectRoot, outputRoot = join(sourceRoot, 'backend/extension/dist'), zip = true } = {}) {
  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(join(outputRoot, '.launchdeck-build-'));
  const target = join(outputRoot, 'launchdeck-new-tab');
  const previous = join(outputRoot, 'launchdeck-new-tab.previous');
  const sourceManifest = JSON.parse(await readFile(join(sourceRoot, 'backend/extension/manifest.json'), 'utf8'));
  const checksums = {};
  const adaptations = {};
  const displayAdaptations = {};
  let replaced = false;
  try {
    for (const { path, name } of await filesBelow(join(sourceRoot, 'frontend'))) {
      if (!/^[a-z0-9/_-]+\.(?:html|js|css|svg|png|jpg|jpeg|webp|woff2)$/i.test(name)) continue;
      const original = await readFile(path);
      checksums[name] = createHash('sha256').update(original).digest('hex');
      let content = original;
      if (['app.js', 'backend-client.js', 'lib/feature-client.js'].includes(name)) {
        const adapted = enableExtensionProtocol(original.toString(), name);
        content = adapted.result;
        adaptations[name] = adapted.replacements;
      }
      if (name === 'app.js') {
        // Package metadata can advance independently while the web frontend is
        // maintained separately. Keep its source untouched and use the runtime's
        // current namespace in the generated extension only.
        const app = content.toString();
        displayAdaptations.iconNamespace = (app.match(/\bwindow\.AGYIcons\b/g) || []).length;
        content = app.replace(/\bwindow\.AGYIcons\b/g, 'window.LaunchDeckIcons');
        if (!content.includes('window.LaunchDeckIcons')) throw new Error('前端图标入口发生变化，请检查扩展适配。');
      }
      if (name === 'index.html') {
        let html = original.toString();
        if ([...html.matchAll(/<title\b[^>]*>[\s\S]*?<\/title>/gi)].length !== 1) throw new Error('页面必须包含一个标签页标题。');
        html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '<title>新标签页</title>');
        displayAdaptations.tabTitle = '新标签页';
        const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
        if (scripts.length !== 2 || !scripts.some(item => /src=["']backend-client\.js["']/.test(item[1])) || !scripts.some(item => /src=["']app\.js["']/.test(item[1]))) throw new Error('页面脚本入口发生变化，请更新扩展打包入口。');
        if (scripts.some(item => item[2].trim())) throw new Error('扩展页面不允许内联脚本。');
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        html = html.replace('</head>', '  <link rel="stylesheet" href="platform/extension/runtime/extension.css" />\n</head>');
        html = html.replace('</body>', '  <script type="module" src="platform/extension/runtime/entry.js"></script>\n</body>');
        content = html;
      }
      if (name.endsWith('.js') && /(?:\bimport\s*(?:\(|[^;]*?from\s*)|\bexport\s+[^;]*?from\s*)["']https?:\/\//.test(String(content))) throw new Error(`扩展不能加载远程脚本：${name}`);
      const destination = join(staging, name);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await writeFile(destination, content);
    }
    if (!['app.js', 'backend-client.js', 'lib/feature-client.js'].every(name => Object.hasOwn(adaptations, name))) throw new Error('缺少必要的前端扩展适配入口。');
    for (const name of SOURCE_FILES) {
      const destination = join(staging, 'platform', name);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await copyFile(join(sourceRoot, 'backend', name), destination);
    }
    for (const { path, name } of await filesBelow(join(sourceRoot, 'backend/extension/runtime'))) {
      if (!/^[a-z0-9/_-]+\.(?:js|css)$/i.test(name)) throw new Error(`扩展运行时包含未允许的文件：${name}`);
      const destination = join(staging, 'platform/extension/runtime', name);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await copyFile(path, destination);
    }
    const iconPresets = extractIconPresets(await readFile(join(sourceRoot, 'frontend/app.js'), 'utf8'));
    await writeFile(join(staging, 'platform/extension/icon-presets.js'), `// Generated from reviewed local SVG constants. No external icon source is implied.\nexport const iconPresets = ${JSON.stringify(iconPresets)};\n`);
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(sourceManifest, null, 2) + '\n');
    await writeFile(join(staging, MARKER), JSON.stringify({ generatedBy: 'LaunchDeck', schemaVersion: 1, sourceChecksums: checksums, protocolAdaptations: adaptations, displayAdaptations }, null, 2));
    const builtFiles = await filesBelow(staging);
    for (const { path, name } of builtFiles.filter(item => item.name.endsWith('.js'))) {
      const source = await readFile(path, 'utf8');
      if (/\bfrom\s*["']node:|\bimport\s*["']node:/.test(source)) throw new Error(`扩展包误包含 Node.js 专用模块：${name}`);
      const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
      if (syntax.status !== 0) throw new Error(`脚本语法检查失败：${name}\n${syntax.stderr}`);
      // Check fixed relative imports so a missing nested module cannot silently ship.
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
        const imported = resolve(path, '..', match[1]);
        if (!imported.startsWith(staging + '/') || !(await lstat(imported)).isFile()) throw new Error(`模块路径无效：${name} -> ${match[1]}`);
      }
    }
    try {
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('输出目录中已有非构建文件，拒绝覆盖。');
      let marker;
      try { marker = JSON.parse(await readFile(join(target, MARKER), 'utf8')); }
      catch { throw new Error('输出目录缺少构建标记，拒绝覆盖现有文件。'); }
      if (marker.generatedBy !== 'LaunchDeck') throw new Error('输出目录中已有非构建文件，拒绝覆盖。');
      try { await lstat(previous); throw new Error('存在上一次未完成的构建备份，请先检查 launchdeck-new-tab.previous。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rename(target, previous);
      replaced = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, target);
    if (replaced) await rm(previous, { recursive: true });
    const archive = join(outputRoot, 'launchdeck-new-tab.zip');
    if (zip) {
      await rm(archive, { force: true });
      const result = spawnSync('/usr/bin/zip', ['-X', '-q', '-r', archive, '.'], { cwd: target, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`生成 ZIP 失败：${result.stderr || result.error?.message}`);
    }
    return { directory: target, archive: zip ? archive : null, files: builtFiles.length, adaptations, displayAdaptations };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (replaced) {
      try { await lstat(target); }
      catch (missing) { if (missing.code === 'ENOENT') await rename(previous, target); }
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await buildExtension(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
