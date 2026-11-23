import { el, clearElement, setText } from './dom.js';

// Local-only update & widget import UI for the 「更新与组件」 settings tab.
// - Never uploads files, never fetches anything except GET /api/update/version (web) when the tab opens.
// - Never writes on preview: the app callback is only called from the explicit confirm button.

const WIDGET_PACKAGE_MODULE = '../platform/features/widget-package.js';
const UPGRADE_PACKAGE_MODULE = '../platform/features/upgrade-package.js';

const SIZE_LABELS = Object.freeze({
  single: '1×1 小方块',
  compact: '2×1 紧凑',
  square: '2×2 方卡',
  wide: '4×2 横卡',
});

const CARD_TYPE_LABELS = Object.freeze({
  text: '文字卡片',
  clock: '时钟卡片',
  weather: '天气卡片',
  currency: '汇率卡片',
});

const CARD_DATA_NEEDS = Object.freeze({
  text: '无需联网或额外数据（仅显示包内文字）',
  clock: '使用本机校准时钟，无需联网',
  weather: '使用当前设置的位置与天气数据',
  currency: '需要读取参考汇率（联网，按币对缓存；金额只在本机计算）',
});

const LAYOUT_LABELS = Object.freeze({ stacked: '上下排列', split: '左右分栏' });
const PALETTE_LABELS = Object.freeze({
  indigo: '靛蓝',
  teal: '青绿',
  amber: '琥珀',
  slate: '石板灰',
  rose: '玫瑰',
});
const ICON_LABELS = Object.freeze({
  note: '便签',
  clock: '时钟',
  cloud: '云朵',
  currency: '货币',
  sparkles: '星光',
});

const COMPARISON_TEXT = Object.freeze({
  newer: { tone: 'ok', text: '更新包版本较新，可以按下方步骤更新。' },
  same: { tone: 'neutral', text: '更新包与当前已安装版本相同，无需更新（可用于重新覆盖修复文件）。' },
  older: { tone: 'warn', text: '更新包版本比当前版本旧，覆盖后会降级，请确认这是你需要的版本。' },
  unknown: { tone: 'warn', text: '无法比较版本（当前版本未知或版本号格式不同），请自行核对。' },
});

const SHA256_RE = /^[a-f0-9]{64}$/i;

export const SAMPLE_WIDGET_PACKAGE_FILENAME = 'LaunchDeck-示例组件.json';
export const SAMPLE_WIDGET_PACKAGE = Object.freeze({
  format: 'launchdeck-widget',
  version: 1,
  size: 'square',
  card: Object.freeze({
    type: 'text',
    title: '今日提醒',
    text: '记得休息',
    icon: 'note',
    palette: 'teal',
    layout: 'stacked',
  }),
});

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

export function detectExtensionsManagementUrl(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const ua = String(userAgent || '');
  if (/\bEdg(?:A|iOS)?\//.test(ua)) {
    return { browser: 'Microsoft Edge', url: 'edge://extensions' };
  }
  return { browser: 'Chrome', url: 'chrome://extensions' };
}

function errorMessage(err, fallback) {
  const msg = err && typeof err.message === 'string' ? err.message.trim() : '';
  return msg ? msg.slice(0, 200) : fallback;
}

export function createUpdateUIController({
  onConfirmImport = null,
  getCurrentPageTitle = null,
  fetchImpl = typeof fetch === 'function' ? (...args) => fetch(...args) : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  documentRef = typeof document !== 'undefined' ? document : null,
} = {}) {
  let bound = false;
  let widgetGeneration = 0;
  let upgradeGeneration = 0;
  let versionGeneration = 0;
  let pendingCard = null; // { size, config }
  let lastUpgradeFile = null;
  let installedVersion = null;
  let installedVersionState = 'idle'; // idle | loading | ready | error
  let confirmInFlight = false;

  const $ = (id) => documentRef?.getElementById?.(id) || null;

  function setStatus(node, text, tone = 'neutral') {
    if (!node) return;
    setText(node, text);
    node.dataset.statusTone = tone;
    node.hidden = !text;
  }

  // ---------------------------------------------------------------------------
  // Widget package (JSON) import
  // ---------------------------------------------------------------------------
  function resetWidgetSelection({ keepStatus = false } = {}) {
    widgetGeneration += 1;
    pendingCard = null;
    const input = $('widgetPackageInput');
    if (input) input.value = '';
    const preview = $('widgetPackagePreview');
    if (preview) {
      clearElement(preview);
      preview.hidden = true;
    }
    const confirmBtn = $('widgetPackageConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    const resetBtn = $('widgetPackageResetBtn');
    if (resetBtn) resetBtn.disabled = true;
    if (!keepStatus) setStatus($('widgetPackageStatus'), '');
  }

  function renderWidgetPreview(file, pkg) {
    const preview = $('widgetPackagePreview');
    if (!preview) return;
    clearElement(preview);
    const card = pkg.config || {};
    const type = String(card.type || '');
    const palette = String(card.palette || 'slate');
    const rows = [
      ['标题', String(card.title || '（未命名）')],
      ['模板', CARD_TYPE_LABELS[type] || type || '未知'],
      ['尺寸', SIZE_LABELS[pkg.size] || String(pkg.size || '')],
      ['布局', LAYOUT_LABELS[card.layout] || String(card.layout || '')],
      ['图标', ICON_LABELS[card.icon] || String(card.icon || '')],
      ['数据需求', CARD_DATA_NEEDS[type] || '未知'],
    ];
    if (type === 'text' && typeof card.text === 'string') {
      rows.push(['内容', card.text]);
    }
    if (type === 'currency' && card.base && card.quote) {
      rows.push(['币对', `${card.base} → ${card.quote}`]);
    }
    rows.push(['文件', `${String(file?.name || '').slice(0, 80)} · ${formatBytes(file?.size)}`]);

    const swatch = el(
      'div',
      {
        className: 'update-card-swatch',
        dataset: { palette },
        'aria-hidden': 'true',
      },
      el('span', { className: 'update-card-swatch-title', textContent: String(card.title || '') }),
      el('span', { className: 'update-card-swatch-meta', textContent: SIZE_LABELS[pkg.size] || '' })
    );
    const dl = el('dl', { className: 'update-preview-list' });
    for (const [k, v] of rows) {
      dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
    }
    const paletteRow = el(
      'p',
      { className: 'settings-help-text' },
      `配色：${PALETTE_LABELS[palette] || palette}`
    );
    preview.append(swatch, dl, paletteRow);
    preview.hidden = false;
  }

  async function handleWidgetFileChange(event) {
    const input = event?.target || $('widgetPackageInput');
    const file = input?.files?.[0] || null;
    widgetGeneration += 1;
    const gen = widgetGeneration;
    pendingCard = null;
    const confirmBtn = $('widgetPackageConfirmBtn');
    const resetBtn = $('widgetPackageResetBtn');
    const preview = $('widgetPackagePreview');
    if (confirmBtn) confirmBtn.disabled = true;
    if (preview) {
      clearElement(preview);
      preview.hidden = true;
    }
    if (!file) {
      if (resetBtn) resetBtn.disabled = true;
      setStatus($('widgetPackageStatus'), '');
      return;
    }
    if (resetBtn) resetBtn.disabled = false;
    setStatus($('widgetPackageStatus'), '正在本机检查组件包…', 'neutral');
    try {
      const mod = await import(WIDGET_PACKAGE_MODULE);
      if (typeof mod?.readWidgetPackage !== 'function') {
        throw new Error('组件包读取模块不可用，请更新到包含该功能的版本');
      }
      const pkg = await mod.readWidgetPackage(file);
      if (gen !== widgetGeneration) return;
      if (!pkg || typeof pkg !== 'object' || !pkg.config || typeof pkg.config !== 'object' || !pkg.size) {
        throw new Error('组件包内容无效');
      }
      pendingCard = { size: pkg.size, config: structuredClone(pkg.config) };
      renderWidgetPreview(file, pendingCard);
      const pageTitle = typeof getCurrentPageTitle === 'function' ? getCurrentPageTitle() : '';
      setStatus(
        $('widgetPackageStatus'),
        `预览就绪，尚未写入。确认后将添加到「${pageTitle || '当前导航页'}」。`,
        'neutral'
      );
      if (confirmBtn) confirmBtn.disabled = false;
    } catch (err) {
      if (gen !== widgetGeneration) return;
      pendingCard = null;
      setStatus($('widgetPackageStatus'), `无法导入：${errorMessage(err, '文件不是有效的 LaunchDeck 组件包')}`, 'error');
    }
  }

  async function handleWidgetConfirm() {
    if (!pendingCard || confirmInFlight || typeof onConfirmImport !== 'function') return;
    const gen = widgetGeneration;
    const card = pendingCard;
    const confirmBtn = $('widgetPackageConfirmBtn');
    confirmInFlight = true;
    if (confirmBtn) confirmBtn.disabled = true;
    try {
      const result = await onConfirmImport(structuredClone(card));
      if (gen !== widgetGeneration) return;
      if (result && result.ok) {
        resetWidgetSelection({ keepStatus: true });
        setStatus($('widgetPackageStatus'), result.message || '已添加导入组件', 'ok');
      } else {
        setStatus($('widgetPackageStatus'), result?.message || '未能添加导入组件', 'error');
        if (confirmBtn) confirmBtn.disabled = !pendingCard;
      }
    } catch (err) {
      if (gen !== widgetGeneration) return;
      setStatus($('widgetPackageStatus'), errorMessage(err, '未能添加导入组件'), 'error');
      if (confirmBtn) confirmBtn.disabled = !pendingCard;
    } finally {
      confirmInFlight = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Installed version & upgrade package (ZIP) inspection
  // ---------------------------------------------------------------------------
  function renderInstalledVersion() {
    const node = $('updateInstalledVersion');
    if (!node) return;
    if (installedVersionState === 'loading') setText(node, '正在读取…');
    else if (installedVersion) setText(node, `v${installedVersion}`);
    else if (installedVersionState === 'error') setText(node, '未知（读取失败）');
    else setText(node, '—');
  }

  async function loadInstalledVersion() {
    versionGeneration += 1;
    const gen = versionGeneration;
    const injected = windowRef?.LaunchDeckUpdate?.version;
    if (typeof injected === 'string' && injected.trim()) {
      installedVersion = injected.trim().slice(0, 40);
      installedVersionState = 'ready';
      renderInstalledVersion();
      return installedVersion;
    }
    const protocol = windowRef?.location?.protocol || '';
    if (!['http:', 'https:'].includes(protocol) || typeof fetchImpl !== 'function') {
      installedVersionState = 'error';
      renderInstalledVersion();
      return null;
    }
    installedVersionState = 'loading';
    renderInstalledVersion();
    try {
      const res = await fetchImpl('/api/update/version', { credentials: 'same-origin' });
      const data = res && res.ok ? await res.json() : null;
      if (gen !== versionGeneration) return installedVersion;
      const v = typeof data?.version === 'string' ? data.version.trim().slice(0, 40) : '';
      installedVersion = v || null;
      installedVersionState = v ? 'ready' : 'error';
    } catch {
      if (gen !== versionGeneration) return installedVersion;
      installedVersionState = 'error';
    }
    renderInstalledVersion();
    return installedVersion;
  }

  function resetUpgradeSelection() {
    upgradeGeneration += 1;
    lastUpgradeFile = null;
    const input = $('upgradePackageInput');
    if (input) input.value = '';
    const box = $('upgradeResultBox');
    if (box) {
      clearElement(box);
      box.hidden = true;
    }
    const resetBtn = $('upgradeResetBtn');
    if (resetBtn) resetBtn.disabled = true;
    const verifyBtn = $('upgradeVerifyBtn');
    if (verifyBtn) verifyBtn.disabled = true;
    setStatus($('upgradeStatus'), '');
  }

  function renderUpgradeResult(file, info) {
    const box = $('upgradeResultBox');
    if (!box) return;
    clearElement(box);
    const comparison = COMPARISON_TEXT[info.comparison] || COMPARISON_TEXT.unknown;
    const integrityText =
      info.integrity === 'matched'
        ? '完整性：与你粘贴的 SHA-256 一致'
        : '完整性：未校验（可粘贴发布方提供的 SHA-256 后重新检查）';
    const dl = el('dl', { className: 'update-preview-list' });
    const rows = [
      ['更新包版本', info.version ? `v${info.version}` : '未知'],
      ['当前版本', info.currentVersion ? `v${info.currentVersion}` : installedVersion ? `v${installedVersion}` : '未知'],
      ['文件', `${String(file?.name || '').slice(0, 80)} · ${formatBytes(file?.size)}`],
    ];
    for (const [k, v] of rows) dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
    box.append(
      dl,
      el('p', { className: 'update-result-line', dataset: { statusTone: comparison.tone }, textContent: comparison.text }),
      el('p', {
        className: 'update-result-line',
        dataset: { statusTone: info.integrity === 'matched' ? 'ok' : 'neutral' },
        textContent: integrityText,
      })
    );
    box.hidden = false;
  }

  async function inspectUpgrade() {
    const file = lastUpgradeFile;
    if (!file) return;
    upgradeGeneration += 1;
    const gen = upgradeGeneration;
    const shaInput = $('upgradeShaInput');
    const rawSha = String(shaInput?.value || '').trim().replace(/\s+/g, '');
    if (rawSha && !SHA256_RE.test(rawSha)) {
      setStatus($('upgradeStatus'), 'SHA-256 应为 64 位十六进制字符，可留空跳过校验。', 'error');
      return;
    }
    const box = $('upgradeResultBox');
    if (box) {
      clearElement(box);
      box.hidden = true;
    }
    setStatus($('upgradeStatus'), '正在本机检查更新包结构与版本（不会执行包内任何内容）…', 'neutral');
    try {
      if (installedVersionState !== 'ready') {
        await loadInstalledVersion();
        if (gen !== upgradeGeneration) return;
      }
      const mod = await import(UPGRADE_PACKAGE_MODULE);
      if (typeof mod?.inspectUpgradePackage !== 'function') {
        throw new Error('更新包检查模块不可用');
      }
      const info = await mod.inspectUpgradePackage(file, {
        currentVersion: installedVersion || undefined,
        ...(rawSha ? { expectedSha256: rawSha.toLowerCase() } : {}),
      });
      if (gen !== upgradeGeneration) return;
      renderUpgradeResult(file, info || {});
      setStatus(
        $('upgradeStatus'),
        '检查完成。此页面无法直接安装更新包，请按下方步骤手动覆盖并重新加载扩展。',
        info?.comparison === 'older' || info?.comparison === 'unknown' ? 'warn' : 'ok'
      );
    } catch (err) {
      if (gen !== upgradeGeneration) return;
      setStatus($('upgradeStatus'), `检查失败：${errorMessage(err, '文件不是有效的 LaunchDeck 更新包')}`, 'error');
    }
  }

  function handleUpgradeFileChange(event) {
    const input = event?.target || $('upgradePackageInput');
    const file = input?.files?.[0] || null;
    upgradeGeneration += 1;
    lastUpgradeFile = file;
    const resetBtn = $('upgradeResetBtn');
    const verifyBtn = $('upgradeVerifyBtn');
    if (resetBtn) resetBtn.disabled = !file;
    if (verifyBtn) verifyBtn.disabled = !file;
    if (!file) {
      resetUpgradeSelection();
      return;
    }
    inspectUpgrade();
  }

  // ---------------------------------------------------------------------------
  // Extensions management URL (copy with non-secure fallback)
  // ---------------------------------------------------------------------------
  function renderManagementInstructions() {
    const { browser, url } = detectExtensionsManagementUrl();
    const urlInput = $('updateManageUrlInput');
    if (urlInput) urlInput.value = url;
    setText($('updateManageBrowserName'), browser);
  }

  async function copyManagementUrl() {
    const urlInput = $('updateManageUrlInput');
    const url = String(urlInput?.value || detectExtensionsManagementUrl().url);
    const statusNode = $('updateCopyStatus');
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
      if (windowRef?.isSecureContext && clipboard?.writeText) {
        await clipboard.writeText(url);
        setStatus(statusNode, '已复制，请粘贴到新标签页地址栏打开。', 'ok');
        return;
      }
    } catch {
      // Fall through to manual selection
    }
    if (urlInput) {
      urlInput.focus();
      urlInput.select();
      let copied = false;
      try {
        copied = Boolean(documentRef?.execCommand?.('copy'));
      } catch {
        copied = false;
      }
      setStatus(
        statusNode,
        copied ? '已复制，请粘贴到新标签页地址栏打开。' : '已选中地址，请按 Ctrl/⌘ + C 手动复制后粘贴到地址栏。',
        copied ? 'ok' : 'neutral'
      );
    }
  }

  function downloadSamplePackage() {
    const statusNode = $('widgetPackageStatus');
    try {
      const URLRef = windowRef?.URL || (typeof URL !== 'undefined' ? URL : null);
      if (!documentRef || typeof Blob === 'undefined' || !URLRef?.createObjectURL) {
        throw new Error('当前浏览器不支持本地下载');
      }
      const json = `${JSON.stringify(SAMPLE_WIDGET_PACKAGE, null, 2)}\n`;
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const objectUrl = URLRef.createObjectURL(blob);
      const link = documentRef.createElement('a');
      link.href = objectUrl;
      link.download = SAMPLE_WIDGET_PACKAGE_FILENAME;
      link.rel = 'noopener';
      link.hidden = true;
      documentRef.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        // Revoke after the click has been dispatched so the download can start
        setTimeout(() => URLRef.revokeObjectURL(objectUrl), 0);
      }
      setStatus(statusNode, `已生成示例文件「${SAMPLE_WIDGET_PACKAGE_FILENAME}」，可用「选择组件文件」导入预览。`, 'ok');
    } catch (err) {
      setStatus(statusNode, `无法下载示例：${errorMessage(err, '浏览器阻止了下载')}`, 'error');
    }
  }

  function init() {
    if (bound || !documentRef) return;
    bound = true;
    $('widgetPackageSampleBtn')?.addEventListener('click', downloadSamplePackage);
    // Closing the settings modal (any path: button, backdrop, Escape) invalidates pending previews
    const modalEl = $('apiConfigModal');
    if (modalEl && typeof MutationObserver === 'function') {
      new MutationObserver(() => {
        if (modalEl.hidden) onHidden();
      }).observe(modalEl, { attributes: true, attributeFilter: ['hidden'] });
    }
    $('widgetPackageInput')?.addEventListener('change', handleWidgetFileChange);
    $('widgetPackageConfirmBtn')?.addEventListener('click', handleWidgetConfirm);
    $('widgetPackageResetBtn')?.addEventListener('click', () => resetWidgetSelection());
    $('upgradePackageInput')?.addEventListener('change', handleUpgradeFileChange);
    $('upgradeVerifyBtn')?.addEventListener('click', () => inspectUpgrade());
    $('upgradeResetBtn')?.addEventListener('click', () => resetUpgradeSelection());
    $('upgradeShaInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inspectUpgrade();
      }
    });
    $('updateCopyManageUrlBtn')?.addEventListener('click', copyManagementUrl);
    resetWidgetSelection();
    resetUpgradeSelection();
    renderManagementInstructions();
    renderInstalledVersion();
  }

  function onShown() {
    init();
    renderManagementInstructions();
    if (installedVersionState !== 'ready' && installedVersionState !== 'loading') {
      loadInstalledVersion();
    }
  }

  function onHidden() {
    // Drop pending previews/async results when leaving the tab; nothing was written.
    resetWidgetSelection();
    resetUpgradeSelection();
    setStatus($('updateCopyStatus'), '');
  }

  return {
    init,
    onShown,
    onHidden,
    loadInstalledVersion,
    resetWidgetSelection,
    resetUpgradeSelection,
    getPendingCard: () => (pendingCard ? structuredClone(pendingCard) : null),
  };
}
