import { el, clearElement, setText, safeHttpUrl, safeHexColor, safeGradient } from './lib/dom.js';
import {
  getBrowserTimeZone,
  isValidTimeZone,
  getTimePartsInZone,
  parseWallTimeInTimeZone,
  createClockController,
} from './lib/time.js';
import {
  createFeatureClient,
  DEFAULT_WIDGET_DEFINITIONS,
  getSupportedSizesForWidgetType,
  normalizeWidgetSize,
  LEGACY_WIDGET_SIZES,
  createDefaultWidgetState,
  normalizeWidgetState,
  createDefaultDeviceSettings,
} from './lib/feature-client.js';
import {
  normalizePages,
  normalizeWidgetLayout,
  reconcileDesktopWithLayout,
  migrateLegacyDesktop,
  doesDesktopMatchLegacyDefaultSnapshot,
  stripDefaultSitePlacementsFromHomePage,
  applyDefaultWidgetSizesToPristineDesktop,
  getPagePlacements,
  getFolderById,
  getRenderablePageItems,
  reorderPlacementInPage,
  stepPlacementInPage,
  movePlacementToPage,
  placeDesktopItemBefore,
  applyDesktopCellDrop,
  enableWidgetOnPage,
  MAX_WIDGET_LAYOUT_ENTRIES,
  disableWidget,
  addSitePlacement,
  removeSitePlacements,
  addDesktopPage,
  renameDesktopPage,
  deleteDesktopPage,
  createSiteFolder,
  addSiteToFolder,
  renameSiteFolder,
  reorderFolderSite,
  moveFolderSiteToPage,
  dissolveSiteFolder,
  sanitizeFolderTitle,
  MAX_FOLDER_TITLE_LENGTH,
} from './lib/desktop-layout.js';
import {
  createButton,
  createIconButton,
  createSwitch,
  createSelect,
  createDatePicker,
  createTimePicker,
  createChoiceGroup,
  closeAllPopovers,
  hasOpenPopovers,
} from './lib/ui/index.js';
import { createWidgetHost, WIDGET_MODULE_MAP } from './widgets/registry.js';
import { createDesktopPointerDragController } from './lib/desktop-pointer-drag.js';
import { createFolderScrollController } from './lib/folder-pointer-scroll.js';
import { createDockOverflowController } from './lib/dock-overflow.js';
import { createDockMagnification } from './lib/dock-magnification.js';
import {
  DISPLAY_MODES,
  MOBILE_DISPLAY_MODE_STORAGE_KEY,
  normalizeMobileDisplayMode,
  loadMobileDisplayMode,
  saveMobileDisplayMode,
  isMobileViewport,
  resolveEffectiveDisplayMode,
  computeSingleScreenMetrics,
  resolveWidgetDisplaySize,
  getWidgetGridSpan,
  getFixedCellsForPage,
  planDesktopCellDrop,
  packCategoryItemsIntoViews,
  buildScreenViewsModel,
  resolveViewDropBeforeAnchor,
} from './lib/display-mode.js';
import { createLocalWallpaperController } from './lib/local-wallpaper.js';
import {
  createNavigationBackupController,
  NAVIGATION_RESTORE_ID_STORAGE_KEY,
  mergeNavigationSites,
} from './lib/navigation-backup.js';
import { createNotificationsUIController } from './lib/notifications-ui.js';
import { createUpdateUIController } from './lib/update-ui.js';

const STORAGE_KEYS = {
  PAGES: 'ios18_nav_pages_v1',
  SITES: 'ios18_nav_sites_v1',
  PREFS: 'ios18_nav_prefs_v1',
  NOTE: 'ios18_nav_quicknote_v1',
  SEARCH_ENGINE: 'ios18_nav_search_engine_v1',
};

const LEGACY_V2_KEYS = {
  PAGES: 'ios18_nav_pages_v2',
  SITES: 'ios18_nav_sites_v2',
  PREFS: 'ios18_nav_prefs_v2',
  NOTE: 'ios18_nav_quicknote_v2',
};

const BACKEND_SUPPORTED_CATEGORIES = new Set(['ai', 'design', 'dev', 'media']);

const DEFAULT_PAGES = [
  { id: 'all', title: '精选主页', icon: 'sparkles', isSystem: true, order: 0 },
  { id: 'ai', title: 'AI 与效率', icon: 'sparkles', isSystem: true, order: 1 },
  { id: 'design', title: '设计灵感', icon: 'folder', isSystem: true, order: 2 },
  { id: 'dev', title: '开发与技术', icon: 'code', isSystem: true, order: 3 },
  { id: 'media', title: '影音与社区', icon: 'globe', isSystem: true, order: 4 },
];

const SEARCH_ENGINES = [
  {
    id: 'google',
    name: 'Google',
    badge: 'G',
    color: 'linear-gradient(135deg, #007aff, #5ac8fa)',
    url: 'https://www.google.com/search?q=',
    domain: 'google.com',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    badge: 'P',
    color: 'linear-gradient(135deg, #20b2aa, #008080)',
    url: 'https://www.perplexity.ai/search?q=',
    domain: 'perplexity.ai',
  },
  {
    id: 'github',
    name: 'GitHub',
    badge: 'GH',
    color: 'linear-gradient(135deg, #3a3a3c, #1c1c1e)',
    url: 'https://github.com/search?q=',
    domain: 'github.com',
  },
  {
    id: 'bilibili',
    name: 'Bilibili',
    badge: 'B',
    color: 'linear-gradient(135deg, #ff6699, #ff2d55)',
    url: 'https://search.bilibili.com/all?keyword=',
    domain: 'bilibili.com',
  },
  {
    id: 'bing',
    name: 'Bing',
    badge: 'Bi',
    color: 'linear-gradient(135deg, #0a84ff, #5e5ce6)',
    url: 'https://www.bing.com/search?q=',
    domain: 'bing.com',
  },
  {
    id: 'baidu',
    name: '百度',
    badge: '百',
    color: 'linear-gradient(135deg, #2932e1, #007aff)',
    url: 'https://www.baidu.com/s?wd=',
    domain: 'baidu.com',
  },
];

// Trusted static SVG icon definitions (reviewed constant templates only)
const ICONS = Object.freeze({
  chatgpt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0-5.2 3A6 6 0 0 0 4 11.2a6 6 0 0 0 3 5.2 6 6 0 0 0 5 2.6 6 6 0 0 0 5.2-3A6 6 0 0 0 20 10.8a6 6 0 0 0-3-5.2A6 6 0 0 0 12 3z"/><circle cx="12" cy="11" r="2.5"/></svg>`,
  claude: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M4.93 4.93l14.14 14.14M2 12h20M4.93 19.07L19.07 4.93"/></svg>`,
  gemini: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C12.6 7.2 16.8 11.4 22 12c-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10z"/></svg>`,
  perplexity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4 6l16 12M20 6L4 18M7 3h10v18H7z"/></svg>`,
  notion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h2l4 8V8M8 8v8"/></svg>`,
  linear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M4.6 14.5l4.9 4.9M3.6 10.2l10.2 10.2M6.2 6.2l11.6 11.6"/></svg>`,
  raycast: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
  figma: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a3 3 0 1 1 0-6h3v6H9zM9 6a3 3 0 1 1 0-6h3v6H9zM12 6h3a3 3 0 1 1 0 6h-3V6z"/><circle cx="15" cy="15" r="3"/><path d="M9 18a3 3 0 0 1 0-6h3v6a3 3 0 0 1-3 0z"/></svg>`,
  apple_hig: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>`,
  dribbble: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>`,
  behance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h5a2.5 2.5 0 0 1 0 5H3V7zm0 5h5.5a2.5 2.5 0 0 1 0 5H3v-5zM15 9h5M17.5 17a3 3 0 1 1 2.6-4.5h-5.6"/></svg>`,
  awwwards: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  pinterest: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 20l3-9m0 0a3.5 3.5 0 1 1 3.5 3.5c-1.5 0-2.5-.8-2.5-.8"/></svg>`,
  github: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>`,
  vercel: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l10 18H2L12 3z"/></svg>`,
  mdn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="14" y1="4" x2="10" y2="20"/></svg>`,
  v2ex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l8 12 8-12"/></svg>`,
  huggingface: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.8 8.001a2.75 2.75 0 0 0-1.94-1.94C18.14 5.6 12 5.6 12 5.6s-6.14 0-7.86.46a2.75 2.75 0 0 0-1.94 1.94C1.74 9.72 1.74 12 1.74 12s0 2.28.46 3.999a2.75 2.75 0 0 0 1.94 1.94c1.72.46 7.86.46 7.86.46s6.14 0 7.86-.46a2.75 2.75 0 0 0 1.94-1.94C22.26 14.28 22.26 12 22.26 12s0-2.28-.46-3.999zM9.95 15.02V8.98L15.2 12l-5.25 3.02z"/></svg>`,
  bilibili: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="4"/><path d="M8 2l3 4M16 2l-3 4M9 11v2M15 11v2"/></svg>`,
  spotify: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 11.5c2.8-1 5.8-.8 8.2.6M8.8 14.5c2.2-.7 4.5-.5 6.4.5M7.5 8.6c3.4-1.2 7.2-.9 10.1.8"/></svg>`,
  x_social: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  apple_music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  reddit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="13" r="7"/><path d="M12 6l2-3 3 1M9.5 12.5h.01M14.5 12.5h.01M9.5 16c1.5 1 3.5 1 5 0"/></svg>`,
});

const DEFAULT_SITES = [
  // AI 与效率
  {
    id: "chatgpt",
    title: "ChatGPT",
    url: "https://chatgpt.com",
    category: "ai",
    gradient: "linear-gradient(180deg, #19c37d 0%, #0d8a56 100%)",
    accent: "#30d158",
    iconKey: "chatgpt",
    pinned: true,
    keywords: "openai chatgpt ai 人工智能 对话",
  },
  {
    id: "claude",
    title: "Claude",
    url: "https://claude.ai",
    category: "ai",
    gradient: "linear-gradient(180deg, #e07a5f 0%, #b85338 100%)",
    accent: "#ff9f0a",
    iconKey: "claude",
    pinned: true,
    keywords: "anthropic claude ai 写作 编程",
  },
  {
    id: "gemini",
    title: "Gemini",
    url: "https://gemini.google.com",
    category: "ai",
    gradient: "linear-gradient(145deg, #4facfe 0%, #6f42c1 55%, #f093fb 100%)",
    accent: "#64d2ff",
    iconKey: "gemini",
    pinned: false,
    keywords: "google gemini deepmind ai",
  },
  {
    id: "perplexity",
    title: "Perplexity",
    url: "https://www.perplexity.ai",
    category: "ai",
    gradient: "linear-gradient(180deg, #22b8cf 0%, #0b7285 100%)",
    accent: "#5ac8fa",
    iconKey: "perplexity",
    pinned: false,
    keywords: "perplexity search ai 搜索",
  },
  {
    id: "notion",
    title: "Notion",
    url: "https://www.notion.so",
    category: "ai",
    gradient: "linear-gradient(180deg, #3a3a40 0%, #18181b 100%)",
    accent: "#ffffff",
    iconKey: "notion",
    pinned: false,
    keywords: "notion 笔记 文档 知识库 wiki",
  },
  {
    id: "linear",
    title: "Linear",
    url: "https://linear.app",
    category: "ai",
    gradient: "linear-gradient(180deg, #5e5ce6 0%, #3634a3 100%)",
    accent: "#7d7aff",
    iconKey: "linear",
    pinned: false,
    keywords: "linear 项目管理 协作 issue",
  },
  {
    id: "raycast",
    title: "Raycast",
    url: "https://www.raycast.com",
    category: "ai",
    gradient: "linear-gradient(180deg, #ff453a 0%, #c91f16 100%)",
    accent: "#ff6961",
    iconKey: "raycast",
    pinned: false,
    keywords: "raycast mac 效率 启动器",
  },

  // 设计灵感
  {
    id: "apple_hig",
    title: "Apple Design",
    url: "https://developer.apple.com/design/human-interface-guidelines",
    category: "design",
    gradient: "linear-gradient(180deg, #0a84ff 0%, #0051d5 100%)",
    accent: "#5ac8fa",
    iconKey: "apple_hig",
    pinned: true,
    keywords: "apple hig design 苹果 设计规范 ios18",
  },
  {
    id: "figma",
    title: "Figma",
    url: "https://www.figma.com",
    category: "design",
    gradient: "linear-gradient(145deg, #f24e1e 0%, #a259ff 55%, #1abcfe 100%)",
    accent: "#bf5af2",
    iconKey: "figma",
    pinned: true,
    keywords: "figma ui 设计 原型 协作",
  },
  {
    id: "dribbble",
    title: "Dribbble",
    url: "https://dribbble.com",
    category: "design",
    gradient: "linear-gradient(180deg, #ff375f 0%, #c2184b 100%)",
    accent: "#ff6482",
    iconKey: "dribbble",
    pinned: false,
    keywords: "dribbble 灵感 视觉 动效 ui",
  },
  {
    id: "behance",
    title: "Behance",
    url: "https://www.behance.net",
    category: "design",
    gradient: "linear-gradient(180deg, #0057ff 0%, #0035a8 100%)",
    accent: "#409cff",
    iconKey: "behance",
    pinned: false,
    keywords: "behance adobe 作品集 视觉设计",
  },
  {
    id: "awwwards",
    title: "Awwwards",
    url: "https://www.awwwards.com",
    category: "design",
    gradient: "linear-gradient(180deg, #00c7be 0%, #007d77 100%)",
    accent: "#64d2ff",
    iconKey: "awwwards",
    pinned: false,
    keywords: "awwwards 网页设计 交互 酷站",
  },
  {
    id: "pinterest",
    title: "Pinterest",
    url: "https://www.pinterest.com",
    category: "design",
    gradient: "linear-gradient(180deg, #e60023 0%, #a80019 100%)",
    accent: "#ff453a",
    iconKey: "pinterest",
    pinned: false,
    keywords: "pinterest 花瓣 图片 情绪板",
  },

  // 开发与技术
  {
    id: "github",
    title: "GitHub",
    url: "https://github.com",
    category: "dev",
    gradient: "linear-gradient(180deg, #2c313a 0%, #14171c 100%)",
    accent: "#e5e5ea",
    iconKey: "github",
    pinned: true,
    keywords: "github git 代码 开源 仓库",
  },
  {
    id: "vercel",
    title: "Vercel",
    url: "https://vercel.com",
    category: "dev",
    gradient: "linear-gradient(180deg, #262629 0%, #09090b 100%)",
    accent: "#ffffff",
    iconKey: "vercel",
    pinned: false,
    keywords: "vercel nextjs 部署 前端",
  },
  {
    id: "mdn",
    title: "MDN Docs",
    url: "https://developer.mozilla.org/zh-CN/",
    category: "dev",
    gradient: "linear-gradient(180deg, #32ade6 0%, #00629b 100%)",
    accent: "#64d2ff",
    iconKey: "mdn",
    pinned: false,
    keywords: "mdn web css html js 文档",
  },
  {
    id: "huggingface",
    title: "HuggingFace",
    url: "https://huggingface.co",
    category: "dev",
    gradient: "linear-gradient(180deg, #ffcc00 0%, #e68a00 100%)",
    accent: "#ffd60a",
    iconKey: "huggingface",
    pinned: false,
    keywords: "huggingface 模型 开源 大模型 llm",
  },
  {
    id: "v2ex",
    title: "V2EX",
    url: "https://www.v2ex.com",
    category: "dev",
    gradient: "linear-gradient(180deg, #48484a 0%, #242426 100%)",
    accent: "#ebebf5",
    iconKey: "v2ex",
    pinned: false,
    keywords: "v2ex 程序员 社区 极客",
  },

  // 影音与社区
  {
    id: "bilibili",
    title: "Bilibili",
    url: "https://www.bilibili.com",
    category: "media",
    gradient: "linear-gradient(180deg, #ff6699 0%, #e03e73 100%)",
    accent: "#ff6482",
    iconKey: "bilibili",
    pinned: true,
    keywords: "bilibili b站 哔哩哔哩 视频 弹幕",
  },
  {
    id: "youtube",
    title: "YouTube",
    url: "https://www.youtube.com",
    category: "media",
    gradient: "linear-gradient(180deg, #ff3b30 0%, #c41b12 100%)",
    accent: "#ff453a",
    iconKey: "youtube",
    pinned: false,
    keywords: "youtube 视频 油管 影音",
  },
  {
    id: "apple_music",
    title: "Apple Music",
    url: "https://music.apple.com",
    category: "media",
    gradient: "linear-gradient(180deg, #fa233b 0%, #fb5c74 100%)",
    accent: "#ff375f",
    iconKey: "apple_music",
    pinned: false,
    keywords: "apple music 音乐 歌单 无损",
  },
  {
    id: "spotify",
    title: "Spotify",
    url: "https://open.spotify.com",
    category: "media",
    gradient: "linear-gradient(180deg, #1ed760 0%, #119942 100%)",
    accent: "#30d158",
    iconKey: "spotify",
    pinned: false,
    keywords: "spotify 音乐 播客 电台",
  },
  {
    id: "x_social",
    title: "X / Twitter",
    url: "https://x.com",
    category: "media",
    gradient: "linear-gradient(180deg, #24262b 0%, #0b0c0e 100%)",
    accent: "#ffffff",
    iconKey: "x_social",
    pinned: false,
    keywords: "x twitter 推特 资讯 社交",
  },
  {
    id: "reddit",
    title: "Reddit",
    url: "https://www.reddit.com",
    category: "media",
    gradient: "linear-gradient(180deg, #ff5700 0%, #cc4600 100%)",
    accent: "#ff9f0a",
    iconKey: "reddit",
    pinned: false,
    keywords: "reddit 论坛 社区 讨论",
  },
];

const DEFAULT_NOTE =
  '• 左右滑动屏幕或按方向键 ← → 体验弹簧翻页动画\n• 长按任意图标或小组件进入编辑模式，支持混排拖拽、跨页移动与添加/隐藏组件\n• 点击顶部「位置与时间」可设置城市天气、IANA 时区校准与桌面备份';

// ==========================================================================
// Application State & Controllers
// ==========================================================================
const clockController = createClockController();
const featureClient = createFeatureClient();

const WIDGET_SIZE_OPTIONS = Object.freeze([
  { value: 'single', shortLabel: '1×1', label: '小方', ariaLabel: '小方块尺寸 (1列×1行)' },
  { value: 'compact', shortLabel: '2×1', label: '紧凑', ariaLabel: '紧凑尺寸 (2列×1行)' },
  { value: 'strip', shortLabel: '4×1', label: '横条', ariaLabel: '横条尺寸 (4列×1行)' },
  { value: 'square', shortLabel: '2×2', label: '方卡', ariaLabel: '方卡尺寸 (2列×2行)' },
  { value: 'landscape', shortLabel: '3×2', label: '横卡', ariaLabel: '横卡尺寸 (3列×2行)' },
  { value: 'tall', shortLabel: '2×3', label: '竖卡', ariaLabel: '竖卡尺寸 (2列×3行)' },
  { value: 'large', shortLabel: '3×3', label: '大方', ariaLabel: '大方卡尺寸 (3列×3行)' },
  { value: 'full', shortLabel: '4×4', label: '大月历', ariaLabel: '大尺寸 (4列×4行)' },
]);

const state = {
  pages: [],
  sites: [],
  note: DEFAULT_NOTE,
  currentPageIndex: 0,
  currentViewIndex: 0,
  screenViews: [],
  mobileDisplayMode: loadMobileDisplayMode(),
  effectiveDisplayMode: DISPLAY_MODES.COMPACT,
  singleScreenMetrics: computeSingleScreenMetrics(),
  activeWidgetDetailId: null,
  activeOverflowPageId: null,
  activeFolderDetailId: null,
  activeFolderPageId: null,
  searchQuery: '',
  engineIndex: 0,
  jiggleMode: false,
  contextTargetId: null,
  draggedSiteId: null,
  draggedItem: null,
  editingPageId: null,
  activeAddModalMode: 'site',
  prefs: {
    iconMode: 'light',
    iconSize: 'small',
    wallpaper: 'ios18-bloom',
    wallpaperDimmed: false,
    tintHue: 215,
    tintSat: 82,
    focusActive: false,
  },
  widgetRegistry: structuredClone(DEFAULT_WIDGET_DEFINITIONS),
  widgetState: createDefaultWidgetState(),
  deviceSettings: createDefaultDeviceSettings(),
  availableTimeZones: ['UTC', 'Asia/Shanghai', 'Europe/London', 'America/New_York', 'Asia/Tokyo'],
  browserCoordinates: null, // Ephemeral in-memory browser coordinates, never persisted
  environment: {
    location: null,
    warnings: [],
    weather: null,
    weatherError: null,
    weatherLoading: false,
  },
  portalSyncStatus: {
    label: '已就绪',
    hasError: false,
  },
  widgetSyncStatus: {
    shortLabel: '',
    error: null,
  },
  activeSettingsTab: 'location',
  selectedDstEpochMs: null,
};

const widgetHost = createWidgetHost((widgetItem) => ({
  id: widgetItem?.id || '',
  type: widgetItem?.type || '',
  config: widgetItem?.config ? structuredClone(widgetItem.config) : {},
  clock: clockController,
  getNote: () => state.note,
  saveNote: (noteText) => saveNoteToStorage(noteText, true),
  getPortalSyncStatusText: () => state.portalSyncStatus.label,
  getTodos: () => state.widgetState.todos,
  saveTodos: (todos) => {
    state.widgetState.todos = structuredClone(todos);
    featureClient.saveWidgetsState({ todos: state.widgetState.todos });
    widgetHost.updateAll({ todos: state.widgetState.todos });
  },
  saveWidgetConfig: (nextConfig) => {
    if (!widgetItem) return;
    const safeConfig = nextConfig && typeof nextConfig === 'object' ? structuredClone(nextConfig) : {};
    state.widgetState.layout = state.widgetState.layout.map(item =>
      item.id === widgetItem.id ? { ...item, config: safeConfig } : item
    );
    featureClient.saveWidgetsState({ layout: state.widgetState.layout });
    // Live-propagate so cross-widget readers (today dashboard, focus launcher) see the new config
    widgetHost.updateAll({ layout: state.widgetState.layout });
  },
  getWidgetConfig: () => {
    const latest = state.widgetState.layout.find(item => item && item.id === widgetItem?.id);
    return structuredClone(latest?.config || widgetItem?.config || {});
  },
  // Snapshot of the full widget layout (including disabled items, e.g. a hidden focus timer's
  // durations or countdown targets) for daily widgets that summarize other widgets.
  getLayout: () => structuredClone(Array.isArray(state.widgetState.layout) ? state.widgetState.layout : []),
  getWidgetConfigByType: (type) => {
    const layoutList = Array.isArray(state.widgetState.layout) ? state.widgetState.layout : [];
    const match =
      layoutList.find(item => item && item.type === type && item.enabled) ||
      layoutList.find(item => item && item.type === type);
    if (match?.config && typeof match.config === 'object') return structuredClone(match.config);
    const def =
      state.widgetRegistry.find(d => d && d.type === type) ||
      DEFAULT_WIDGET_DEFINITIONS.find(d => d.type === type);
    return structuredClone(def?.defaultConfig || {});
  },
  getWidgetRegistry: () => structuredClone(state.widgetRegistry),
  getDeviceSettings: () => structuredClone(state.deviceSettings),
  openWidgetDetail: () => {
    const rootEl = document.querySelector(
      `.apps-grid .ios-widget[data-widget-id="${CSS.escape(String(widgetItem?.id || ''))}"]`
    );
    const latest = state.widgetState.layout.find(item => item && item.id === widgetItem?.id);
    if (rootEl && latest) openWidgetDetailModal(rootEl, latest);
  },
  getEnvironmentSnapshot: () => structuredClone(state.environment),
  refreshEnvironmentAndWeather: (force = false) => refreshEnvironmentAndWeather(force),
  getAvailableTimeZones: () => state.availableTimeZones,
  openSettingsModal: (tabName = 'location') => openApiConfigModal(tabName),
}));

// Filter sites & prefs to strictly match `backend/validation.js` schema
function getBackendSyncableSites(sitesList = state.sites) {
  return sitesList
    .filter(site => BACKEND_SUPPORTED_CATEGORIES.has(site.category))
    .map(site => {
      const clean = {
        id: String(site.id),
        title: String(site.title).slice(0, 100),
        url: safeHttpUrl(site.url) || 'https://example.com',
        category: site.category,
        gradient: safeGradient(site.gradient),
        accent: safeHexColor(site.accent, '#007aff'),
        pinned: Boolean(site.pinned),
      };
      if (site.iconKey && Object.hasOwn(ICONS, site.iconKey)) {
        clean.iconKey = String(site.iconKey);
      }
      if (site.keywords !== undefined) {
        clean.keywords = String(site.keywords).slice(0, 300);
      }
      // Optional page tile size: only the non-default 2×2 is persisted (missing = 1×1)
      if (site.size === 'square') {
        clean.size = 'square';
      }
      return clean;
    });
}

function getBackendSyncablePrefs(prefsObj = state.prefs) {
  const clean = {
    iconMode: ['light', 'dark', 'tinted'].includes(prefsObj.iconMode) ? prefsObj.iconMode : 'light',
    iconSize: ['small', 'large'].includes(prefsObj.iconSize) ? prefsObj.iconSize : 'small',
    wallpaper: ['ios18-bloom', 'ios18-pink', 'ios18-teal', 'sequoia-gold', 'titanium-dark'].includes(
      prefsObj.wallpaper
    )
      ? prefsObj.wallpaper
      : 'ios18-bloom',
    wallpaperDimmed: Boolean(prefsObj.wallpaperDimmed),
    tintHue: Math.min(360, Math.max(0, Math.round(Number(prefsObj.tintHue) || 215))),
    tintSat: Math.min(100, Math.max(25, Math.round(Number(prefsObj.tintSat) || 82))),
    focusActive: Boolean(prefsObj.focusActive),
  };
  if (typeof prefsObj.nightMode === 'boolean') {
    clean.nightMode = prefsObj.nightMode;
  }
  return clean;
}

// ==========================================================================
// Initialization & Backend State Synchronization
// ==========================================================================
let weatherRefreshTimer = null;
let activeLongPressTimer = null;
let cancelActivePageDrag = null;
let gestureBlockBlankExit = false;
let hasBootstrapped = false;
let listenersBound = false;
let bootstrapInFlight = null;
let pageTabHoverTimer = null;
let activeMovePagePopover = null;
let desktopPointerDragController = null;
let desktopPointerDragTrackEl = null;
let activeWidgetDetailRestore = null;
let viewportResizeRaf = null;

const uiSelectControls = new Map();
let manualDatePickerControl = null;
let manualTimePickerControl = null;

const BLANK_EXIT_EXCLUDED_SELECTOR = [
  '.app-item',
  '.delete-badge',
  '.ios-widget',
  '.card-edit-actions',
  '.card-edit-btn',
  '.widget-size-controls',
  '.widget-size-btn',
  '.widget-summary-scroll',
  '.move-page-popover',
  '.empty-page-dropzone',
  'input',
  'textarea',
  'select',
  'button',
  'a',
  'label',
  '[role="button"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '.ui-popover-portal',
  '.ui-select-wrap',
  '.ui-datetime-field',
  '.ui-switch-wrap',
  '.ui-checkbox-wrap',
  '.ios-status-bar',
  '.spotlight-section',
  '.page-tabs-bar-wrap',
  '.springboard-pagination-wrap',
  '.ios-dock-container',
  '.customize-sheet',
  '.haptic-context-menu',
  '.modal-backdrop',
  '.portal-conflict-dialog',
  'dialog',
].join(', ');

const DEFAULT_SITE_IDS = Object.freeze(DEFAULT_SITES.map((s) => s.id));

function buildInitialDesktopLayout({
  pages = state.pages,
  sites = state.sites,
  layout = state.widgetState?.layout,
  definitions = state.widgetRegistry,
} = {}) {
  return migrateLegacyDesktop({
    pages,
    sites,
    layout,
    definitions,
    omitHomeSiteIds: DEFAULT_SITE_IDS,
  });
}

function hasUnsyncedWidgetLayoutInStorage() {
  try {
    const rawOutbox = localStorage.getItem('ios18_widgets_outbox_v1');
    if (!rawOutbox) return false;
    const parsed = JSON.parse(rawOutbox);
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.blocked) return true;
    const patch = parsed.patch;
    return Boolean(patch && typeof patch === 'object' && Object.keys(patch).length > 0);
  } catch {
    return false;
  }
}

function hasKnownNavigationRestoreMarker() {
  try {
    const marker = localStorage.getItem(NAVIGATION_RESTORE_ID_STORAGE_KEY);
    return Boolean(typeof marker === 'string' && marker.trim());
  } catch {
    return false;
  }
}

function getEffectiveDesktopForRender() {
  if (state.widgetState?.desktop && Array.isArray(state.widgetState.desktop.pages)) {
    return state.widgetState.desktop;
  }
  return buildInitialDesktopLayout({
    pages: state.pages,
    sites: state.sites,
    layout: state.widgetState?.layout,
    definitions: state.widgetRegistry,
  }).desktop;
}

function finalizeDesktopMigrationOrReconcile(rawWidgetState, registry, { persist = true } = {}) {
  const defs = Array.isArray(registry) && registry.length > 0 ? registry : DEFAULT_WIDGET_DEFINITIONS;
  const normalized = normalizeWidgetStateWithRegistry(rawWidgetState, defs);
  const pristineSnapshotOptions = {
    pages: state.pages,
    sites: state.sites,
    defaultPages: DEFAULT_PAGES,
    defaultSites: DEFAULT_SITES,
    definitions: defs,
    hasUnsyncedLayout: hasUnsyncedWidgetLayoutInStorage(),
    hasRestoreMarker: hasKnownNavigationRestoreMarker(),
  };
  const defaultWidgetOptions = { ...pristineSnapshotOptions, omitHomeSiteIds: DEFAULT_SITE_IDS };

  if (normalized.desktop && typeof normalized.desktop === 'object') {
    let reconciled = reconcileDesktopWithLayout(normalized.desktop, normalized.layout, {
      fallbackPages: state.pages,
      definitions: defs,
    });

    const matchesLegacyDefault = doesDesktopMatchLegacyDefaultSnapshot(reconciled.desktop, pristineSnapshotOptions);

    if (matchesLegacyDefault) {
      reconciled = stripDefaultSitePlacementsFromHomePage(reconciled.desktop, reconciled.layout, {
        defaultSites: DEFAULT_SITES,
        fallbackPages: state.pages,
        definitions: defs,
      });
    }

    if (persist) {
      reconciled = {
        ...reconciled,
        layout: applyDefaultWidgetSizesToPristineDesktop(
          reconciled.desktop,
          reconciled.layout,
          defaultWidgetOptions
        ),
      };
    }

    const changed =
      matchesLegacyDefault ||
      JSON.stringify(reconciled.desktop) !== JSON.stringify(normalized.desktop) ||
      JSON.stringify(reconciled.layout) !== JSON.stringify(normalized.layout);

    state.widgetState = {
      layout: reconciled.layout,
      todos: normalized.todos,
      desktop: reconciled.desktop,
    };
    state.pages = structuredClone(reconciled.desktop.pages);
    savePagesToStorage();

    if (persist && changed) {
      featureClient.saveWidgetsState({
        layout: state.widgetState.layout,
        desktop: state.widgetState.desktop,
      });
    }
    return;
  }

  // Legacy data migration (executed once after both sites & widgets have finished loading)
  let migrated = buildInitialDesktopLayout({
    pages: state.pages,
    sites: state.sites,
    layout: normalized.layout,
    definitions: defs,
  });

  if (persist) {
    migrated = {
      ...migrated,
      layout: applyDefaultWidgetSizesToPristineDesktop(
        migrated.desktop,
        migrated.layout,
        defaultWidgetOptions
      ),
    };
  }

  state.widgetState = {
    layout: migrated.layout,
    todos: normalized.todos,
    desktop: migrated.desktop,
  };
  state.pages = structuredClone(migrated.desktop.pages);
  savePagesToStorage();

  if (persist) {
    featureClient.saveWidgetsState({
      layout: state.widgetState.layout,
      desktop: state.widgetState.desktop,
    });
  }
}

function commitDesktopAndLayout(desktop = getEffectiveDesktopForRender(), layout = state.widgetState.layout) {
  if (state.navigationImportInProgress) return;
  const reconciled = reconcileDesktopWithLayout(desktop, layout, {
    fallbackPages: state.pages,
    definitions: state.widgetRegistry,
  });
  state.widgetState.layout = reconciled.layout;
  state.widgetState.desktop = reconciled.desktop;
  if (reconciled.desktop?.pages) {
    state.pages = structuredClone(reconciled.desktop.pages);
    savePagesToStorage();
  }
  if (state.currentPageIndex >= state.pages.length) {
    state.currentPageIndex = Math.max(0, state.pages.length - 1);
  }
  featureClient.saveWidgetsState({
    layout: state.widgetState.layout,
    desktop: state.widgetState.desktop,
  });
  renderAll();
  renderAddWidgetModalList();
  // Daily widgets (today dashboard, focus launcher) summarize other widgets' layout/config
  widgetHost.updateAll({ layout: state.widgetState.layout, todos: state.widgetState.todos });
}

let pendingNavigationSiteOrder = null;

async function hydrateNavigationBrowserDataOnStartup() {
  try {
    const navDoc = await featureClient.loadNavigationBrowserData();
    const remoteRestoreId =
      typeof navDoc?.restoreId === 'string' && navDoc.restoreId.trim()
        ? navDoc.restoreId.trim()
        : null;
    if (!remoteRestoreId) return;
    const localRestoreId = localStorage.getItem(NAVIGATION_RESTORE_ID_STORAGE_KEY);
    if (localRestoreId === remoteRestoreId) {
      return;
    }
    const browserData = navDoc?.data;
    if (browserData && typeof browserData === 'object') {
      if (
        Array.isArray(browserData.siteOrder) &&
        browserData.siteOrder.every((id) => typeof id === 'string' && id.length > 0)
      ) {
        pendingNavigationSiteOrder = browserData.siteOrder.slice();
      } else {
        pendingNavigationSiteOrder = null;
      }
      if (Array.isArray(browserData.pages) && browserData.pages.length > 0) {
        state.pages = normalizePages(browserData.pages, DEFAULT_PAGES);
        writeLocalStorage(STORAGE_KEYS.PAGES, JSON.stringify(state.pages));
      }
      if (Array.isArray(browserData.customSites)) {
        const systemSites = state.sites.filter((s) =>
          BACKEND_SUPPORTED_CATEGORIES.has(s.category)
        );
        const customSites = browserData.customSites.filter(
          (s) => s && typeof s === 'object' && !BACKEND_SUPPORTED_CATEGORIES.has(s.category)
        );
        state.sites = mergeNavigationSites(
          systemSites,
          customSites,
          pendingNavigationSiteOrder || state.sites.map((s) => s.id)
        );
        writeLocalStorage(STORAGE_KEYS.SITES, JSON.stringify(state.sites));
      }
    }
    writeLocalStorage(NAVIGATION_RESTORE_ID_STORAGE_KEY, remoteRestoreId);
  } catch {
    // Ignore offline or unsupported endpoint errors during startup
  }
}

async function bootstrapApp() {
  migrateLegacyV2StorageIfNeeded();
  loadStateFromStorage();
  applyPreferencesToDOM();

  if (!listenersBound) {
    listenersBound = true;
    initBackendSyncStatusListener();
    initSpotlightAndEngines();
    initPageTurnControls();
    initSwipePageTurnGestures();
    initBlankClickExitJiggleMode();
    initCustomizeSheet();
    initEditAndModals();
    initStatusBarClock();
    initSettingsModalControls();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshTimeCalibrationOnly();
      }
    });
  }

  // Initialize notification subscription pill & settings inbox promptly from cached state before network
  notificationsUIController.init().catch(() => {});

  // Render initial local state without writing empty desktop before migration
  renderAll();

  await hydrateNavigationBrowserDataOnStartup();

  // Connect with `window.PortalBackend` (`/api/state` for sites/prefs/note)
  if (window.PortalBackend) {
    const remoteState = await window.PortalBackend.load();
    if (remoteState !== null) {
      if (Array.isArray(remoteState.sites)) {
        const localCustomPageSites = state.sites.filter(
          s => !BACKEND_SUPPORTED_CATEGORIES.has(s.category)
        );
        const remoteIds = new Set(remoteState.sites.map(s => s.id));
        const dedupedCustomSites = localCustomPageSites.filter(s => !remoteIds.has(s.id));
        const effectiveSiteOrder = pendingNavigationSiteOrder || state.sites.map(s => s.id);
        pendingNavigationSiteOrder = null;
        state.sites = mergeNavigationSites(
          remoteState.sites,
          dedupedCustomSites,
          effectiveSiteOrder
        );
        writeLocalStorage(STORAGE_KEYS.SITES, JSON.stringify(state.sites));
      }
      if (remoteState.prefs && typeof remoteState.prefs === 'object') {
        const nextPrefs = {
          ...state.prefs,
          ...remoteState.prefs,
          focusActive: Boolean(remoteState.prefs.focusActive),
        };
        if (typeof remoteState.prefs.nightMode === 'boolean') {
          nextPrefs.nightMode = remoteState.prefs.nightMode;
        } else {
          delete nextPrefs.nightMode;
        }
        state.prefs = nextPrefs;
        writeLocalStorage(STORAGE_KEYS.PREFS, JSON.stringify(state.prefs));
      }
      if (typeof remoteState.note === 'string') {
        state.note = remoteState.note;
        writeLocalStorage(STORAGE_KEYS.NOTE, state.note);
      }
      state.portalSyncStatus = { label: '已保存', hasError: false };
      applyPreferencesToDOM();
      renderAll();
      updateSyncDiagnosticsUI();
    } else if (['http:', 'https:'].includes(location.protocol)) {
      window.PortalBackend.save({
        sites: getBackendSyncableSites(),
        prefs: getBackendSyncablePrefs(),
        note: state.note,
      });
    }
  }

  // Load new modular widget registry, shared widget state, device settings, and timezones
  const [registry, loadedWidgetState, loadedDeviceSettings, timeZones] = await Promise.all([
    featureClient.loadWidgetsRegistry(),
    featureClient.loadWidgetsState(),
    featureClient.loadDeviceSettings(),
    featureClient.getTimeZones(),
  ]);

  state.widgetRegistry = mergeWidgetRegistryWithBuiltins(registry);
  state.deviceSettings = loadedDeviceSettings;
  state.availableTimeZones = timeZones;

  // Perform one-time migration if desktop is null, or reconcile existing desktop with layout
  finalizeDesktopMigrationOrReconcile(loadedWidgetState, state.widgetRegistry, { persist: true });

  widgetHost.updateAll({
    note: state.note,
    todos: state.widgetState.todos,
    layout: state.widgetState.layout,
  });

  renderAll();
  syncSettingsControlsFromState();
  updateSyncDiagnosticsUI();

  await refreshEnvironmentAndWeather(true);

  if (weatherRefreshTimer) clearInterval(weatherRefreshTimer);
  weatherRefreshTimer = setInterval(() => {
    refreshEnvironmentAndWeather(false);
  }, 600000);
  weatherRefreshTimer?.unref?.();
}

function normalizeWidgetStateWithRegistry(rawState, registry) {
  const defs = Array.isArray(registry) && registry.length > 0 ? registry : DEFAULT_WIDGET_DEFINITIONS;
  return normalizeWidgetState(rawState, defs);
}

// Server/extension registries from older builds may lack newer builtin definitions
// (e.g. imported-card, currency-converter); append missing builtin defs so stored rows survive reconcile.
function mergeWidgetRegistryWithBuiltins(registry) {
  const base = Array.isArray(registry) && registry.length > 0 ? registry : structuredClone(DEFAULT_WIDGET_DEFINITIONS);
  const known = new Set(base.filter(d => d && d.type).map(d => d.type));
  const missing = DEFAULT_WIDGET_DEFINITIONS.filter(d => !known.has(d.type)).map(d => structuredClone(d));
  return missing.length ? [...base, ...missing] : base;
}

/** Display title for a widget row: imported cards use their own config.title. */
function getWidgetDisplayTitle(widgetItem, fallback = '小组件') {
  if (!widgetItem) return fallback;
  if (widgetItem.type === 'imported-card') {
    const raw = typeof widgetItem.config?.title === 'string' ? widgetItem.config.title.trim() : '';
    if (raw) return raw.slice(0, 60);
  }
  const def =
    state.widgetRegistry.find((d) => d && d.type === widgetItem.type) ||
    DEFAULT_WIDGET_DEFINITIONS.find((d) => d.type === widgetItem.type);
  return def?.title || widgetItem.type || fallback;
}

function generateImportedWidgetId(existingIds) {
  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const id = `imported_${hex}`;
    if (!taken.has(id)) return id;
  }
  return null;
}

/**
 * Called only from the explicit confirm button in 「更新与组件」. Appends a new imported-card row
 * and places it on the current category page atomically via enableWidgetOnPage + commitDesktopAndLayout.
 */
function importWidgetCardToCurrentPage({ size: rawSize, config } = {}) {
  if (state.navigationImportInProgress) {
    return { ok: false, message: '正在恢复导航备份，请完成后再导入组件' };
  }
  const supported = getSupportedSizesForWidgetType('imported-card', state.widgetRegistry);
  // Older packages may still declare retired sizes (e.g. wide); map them via legacySizes
  const size =
    typeof rawSize === 'string' && LEGACY_WIDGET_SIZES.includes(rawSize)
      ? normalizeWidgetSize(rawSize, 'imported-card', state.widgetRegistry)
      : rawSize;
  if (typeof size !== 'string' || !supported.includes(size)) {
    return { ok: false, message: '组件包尺寸不受支持' };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.title !== 'string') {
    return { ok: false, message: '组件包配置无效' };
  }
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    return { ok: false, message: '当前浏览器不支持安全随机数，无法生成组件标识' };
  }
  const layout = normalizeWidgetLayout(state.widgetState.layout, state.widgetRegistry);
  if (layout.length >= MAX_WIDGET_LAYOUT_ENTRIES) {
    return {
      ok: false,
      message: `小组件记录已达 ${MAX_WIDGET_LAYOUT_ENTRIES} 个上限（已隐藏的组件也计入在内，隐藏不会释放名额），暂时无法导入新卡片；可在编辑菜单中重新启用已隐藏的组件继续使用`,
    };
  }
  const id = generateImportedWidgetId(new Set(layout.map((w) => w.id)));
  if (!id) {
    return { ok: false, message: '无法生成唯一组件标识，请重试' };
  }
  const nextLayout = [
    ...layout,
    {
      id,
      type: 'imported-card',
      enabled: false,
      order: layout.length,
      size,
      config: structuredClone(config),
    },
  ];
  const currentPage = state.pages[state.currentPageIndex] || state.pages[0] || { id: 'all', title: '全部' };
  const res = enableWidgetOnPage(
    { layout: nextLayout, desktop: getEffectiveDesktopForRender() },
    { widgetId: id, pageId: currentPage.id, definitions: state.widgetRegistry }
  );
  const placed = res?.layout?.find((w) => w.id === id);
  if (res?.added === false || !placed || !placed.enabled) {
    return { ok: false, message: '未能放置导入组件，桌面未做任何修改' };
  }
  commitDesktopAndLayout(res.desktop, res.layout);
  return {
    ok: true,
    message: `已添加「${String(config.title).slice(0, 60)}」到「${currentPage.title || '当前导航页'}」`,
  };
}

let updateUIController = null;
function getUpdateUIController() {
  if (!updateUIController) {
    updateUIController = createUpdateUIController({
      onConfirmImport: (card) => importWidgetCardToCurrentPage(card),
      getCurrentPageTitle: () =>
        (state.pages[state.currentPageIndex] || state.pages[0] || {}).title || '',
    });
  }
  return updateUIController;
}

function initBackendSyncStatusListener() {
  // Keep top bar silent on normal syncs; surface status in Settings modal and Quick Note widget
  window.addEventListener('portal:sync-status', (event) => {
    const message = event.detail?.message || '';
    if (!message) return;

    const isSuccess = message === '已保存到数据库';
    const isOffline = message.includes('未连接') || message.includes('仅保存在本机');
    const isError = !isSuccess && !isOffline;

    state.portalSyncStatus = {
      label: isSuccess ? '已同步' : isOffline ? '本机已保存' : message,
      hasError: isError,
    };

    widgetHost.updateAll({ portalSyncStatus: state.portalSyncStatus });
    updateSyncDiagnosticsUI();
  });

  featureClient.onStatusChange((info) => {
    if (info.channel === 'widgets') {
      state.widgetSyncStatus = {
        shortLabel: info.state === 'synced' ? '已同步' : info.state === 'saving' ? '保存中…' : info.state === 'offline' ? '本机保存' : '需关注',
        error: info.state === 'error' ? info.message : null,
      };
      widgetHost.updateAll({ widgetSyncStatus: state.widgetSyncStatus });
    }
    updateSyncDiagnosticsUI();
  });

  window.addEventListener('feature:conflict-resolved', () => {
    const resolvedWidgetState = featureClient.getWidgetsStateSnapshot();
    state.deviceSettings = featureClient.getDeviceSettingsSnapshot();
    finalizeDesktopMigrationOrReconcile(resolvedWidgetState, state.widgetRegistry, { persist: false });
    renderAll();
    syncSettingsControlsFromState();
    refreshEnvironmentAndWeather(true);
  });
}

function updateSyncDiagnosticsUI() {
  const portalText = document.getElementById('syncModalStatusText');
  const widgetsText = document.getElementById('syncWidgetsStatusText');
  const deviceText = document.getElementById('syncDeviceStatusText');

  const statuses = featureClient.getStatusSnapshot();
  if (portalText) {
    setText(portalText, `桌面与便签：${state.portalSyncStatus.label}`);
  }
  if (widgetsText) {
    setText(widgetsText, `小组件与待办：${statuses.widgets.message}`);
  }
  if (deviceText) {
    setText(deviceText, `当前设备环境设置：${statuses.device.message}`);
  }
}

function migrateLegacyV2StorageIfNeeded() {
  try {
    for (const key of ['PAGES', 'SITES', 'PREFS', 'NOTE']) {
      if (localStorage.getItem(STORAGE_KEYS[key]) === null) {
        const v2Val = localStorage.getItem(LEGACY_V2_KEYS[key]);
        if (v2Val !== null) {
          localStorage.setItem(STORAGE_KEYS[key], v2Val);
        }
      }
    }
  } catch {
    // Ignore storage errors
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore
  }
}

function loadStateFromStorage() {
  try {
    const savedPages = localStorage.getItem(STORAGE_KEYS.PAGES);
    if (savedPages !== null) {
      const parsedPages = JSON.parse(savedPages);
      state.pages =
        Array.isArray(parsedPages) && parsedPages.length
          ? normalizePages(parsedPages, DEFAULT_PAGES)
          : structuredClone(DEFAULT_PAGES);
    } else {
      state.pages = structuredClone(DEFAULT_PAGES);
    }

    const cachedWidgets = featureClient.getWidgetsStateSnapshot();
    if (cachedWidgets && typeof cachedWidgets === 'object') {
      state.widgetState = cachedWidgets;
      if (cachedWidgets.desktop && Array.isArray(cachedWidgets.desktop.pages)) {
        state.pages = normalizePages(cachedWidgets.desktop.pages, state.pages);
      }
    }

    const savedSites = localStorage.getItem(STORAGE_KEYS.SITES);
    if (savedSites !== null) {
      const parsedSites = JSON.parse(savedSites);
      state.sites = Array.isArray(parsedSites) ? parsedSites : structuredClone(DEFAULT_SITES);
    } else {
      state.sites = structuredClone(DEFAULT_SITES);
    }

    const savedPrefs = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (savedPrefs !== null) {
      const parsedPrefs = JSON.parse(savedPrefs);
      if (parsedPrefs && typeof parsedPrefs === 'object') {
        const nextPrefs = {
          ...state.prefs,
          ...parsedPrefs,
          focusActive: Boolean(parsedPrefs.focusActive),
        };
        if (typeof parsedPrefs.nightMode === 'boolean') {
          nextPrefs.nightMode = parsedPrefs.nightMode;
        } else {
          delete nextPrefs.nightMode;
        }
        state.prefs = nextPrefs;
      }
    }

    const savedNote = localStorage.getItem(STORAGE_KEYS.NOTE);
    if (savedNote !== null) {
      state.note = savedNote;
    } else {
      state.note = DEFAULT_NOTE;
    }
    state.mobileDisplayMode = loadMobileDisplayMode();
  } catch {
    state.pages = structuredClone(DEFAULT_PAGES);
    state.sites = structuredClone(DEFAULT_SITES);
    state.note = DEFAULT_NOTE;
    state.mobileDisplayMode = loadMobileDisplayMode();
  }
}

function savePagesToStorage() {
  if (state.navigationImportInProgress) return;
  writeLocalStorage(STORAGE_KEYS.PAGES, JSON.stringify(state.pages));
}

function saveSitesToStorage(syncToBackend = true) {
  if (state.navigationImportInProgress) return;
  writeLocalStorage(STORAGE_KEYS.SITES, JSON.stringify(state.sites));
  state.portalSyncStatus = { label: '本机已保存', hasError: false };
  updateSyncDiagnosticsUI();
  if (syncToBackend && window.PortalBackend) {
    window.PortalBackend.save({ sites: getBackendSyncableSites() });
  }
}

function savePrefsToStorage(syncToBackend = true) {
  if (state.navigationImportInProgress) return;
  writeLocalStorage(STORAGE_KEYS.PREFS, JSON.stringify(state.prefs));
  state.portalSyncStatus = { label: '本机已保存', hasError: false };
  updateSyncDiagnosticsUI();
  if (syncToBackend && window.PortalBackend) {
    window.PortalBackend.save({ prefs: getBackendSyncablePrefs() });
  }
}

function saveNoteToStorage(noteText, syncToBackend = true) {
  if (state.navigationImportInProgress) return;
  state.note = noteText;
  writeLocalStorage(STORAGE_KEYS.NOTE, noteText);
  state.portalSyncStatus = { label: '本机已保存', hasError: false };
  widgetHost.updateAll({ portalSyncStatus: state.portalSyncStatus });
  updateSyncDiagnosticsUI();
  if (syncToBackend && window.PortalBackend) {
    window.PortalBackend.save({ note: noteText });
  }
}

// ==========================================================================
// Apply iOS 18 Appearance Preferences
// ==========================================================================
let systemColorSchemeMediaList = null;

function isSystemDarkSchemePreferred() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
}

function resolveEffectiveNightMode(prefsObj = state.prefs) {
  if (prefsObj && typeof prefsObj.nightMode === 'boolean') {
    return prefsObj.nightMode;
  }
  return isSystemDarkSchemePreferred();
}

function bindSystemColorSchemeListener() {
  if (systemColorSchemeMediaList || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  try {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (!mql) return;
    systemColorSchemeMediaList = mql;
    const onSchemeChange = () => {
      if (typeof state.prefs?.nightMode !== 'boolean') {
        applyPreferencesToDOM();
      }
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onSchemeChange);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(onSchemeChange);
    }
  } catch {
    // Ignore matchMedia errors
  }
}

function applyPreferencesToDOM() {
  bindSystemColorSchemeListener();
  const { iconMode, iconSize, wallpaper, wallpaperDimmed, tintHue, tintSat, nightMode } = state.prefs;
  const hasExplicitNightPref = typeof nightMode === 'boolean';
  const isNight = resolveEffectiveNightMode(state.prefs);
  document.body.setAttribute('data-icon-mode', iconMode);
  document.body.setAttribute('data-icon-size', iconSize);
  document.body.setAttribute('data-wallpaper', wallpaper);
  document.body.setAttribute('data-night-mode', isNight ? 'true' : 'false');
  document.body.setAttribute('data-night-mode-source', hasExplicitNightPref ? 'explicit' : 'system');
  document.body.classList.toggle('night-mode', isNight);
  document.body.classList.toggle('wallpaper-dimmed', Boolean(wallpaperDimmed));

  document.documentElement.style.setProperty('--tint-h', tintHue);
  document.documentElement.style.setProperty('--tint-s', `${tintSat}%`);

  document.querySelectorAll('.mode-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === iconMode);
  });

  document.querySelectorAll('.size-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.size === iconSize);
  });

  const isCustomWallpaper = Boolean(localWallpaperController?.isCustomWallpaperActive?.());
  document.querySelectorAll('.swatch-btn').forEach((btn) => {
    btn.classList.toggle('active', !isCustomWallpaper && btn.dataset.wp === wallpaper);
  });

  const dimBtn = document.getElementById('dimWallpaperBtn');
  if (dimBtn) dimBtn.classList.toggle('active', Boolean(wallpaperDimmed));

  const followSystemBtn = document.getElementById('followSystemNightBtn');
  if (followSystemBtn) {
    const isAuto = !hasExplicitNightPref;
    followSystemBtn.classList.toggle('active', isAuto);
    followSystemBtn.setAttribute('aria-pressed', isAuto ? 'true' : 'false');
    followSystemBtn.setAttribute(
      'title',
      isAuto
        ? `当前跟随系统外观（${isNight ? '深色' : '浅色'}）`
        : '点击恢复跟随系统浅色/深色外观'
    );
  }

  const hueRange = document.getElementById('tintHueRange');
  const satRange = document.getElementById('tintSatRange');
  if (hueRange) hueRange.value = tintHue;
  if (satRange) satRange.value = tintSat;

  const focusBtn = document.getElementById('focusModeToggle');
  const focusLabel = document.getElementById('focusLabel');
  const moonIcon = document.getElementById('nightModeMoonIcon');
  const sunIcon = document.getElementById('nightModeSunIcon');
  if (focusBtn) {
    focusBtn.classList.toggle('focus-active', isNight);
    focusBtn.classList.toggle('night-mode-active', isNight);
    focusBtn.setAttribute('aria-pressed', isNight ? 'true' : 'false');
    focusBtn.setAttribute(
      'title',
      hasExplicitNightPref
        ? isNight
          ? '夜间模式已手动开启（点击切换为浅色）'
          : '夜间模式已手动关闭（点击切换为夜间）'
        : `当前跟随系统（${isNight ? '夜间' : '浅色'}），点击手动切换`
    );
  }
  if (moonIcon && sunIcon) {
    moonIcon.toggleAttribute('hidden', isNight);
    sunIcon.toggleAttribute('hidden', !isNight);
  }
  if (focusLabel) {
    setText(focusLabel, isNight ? '夜间模式 · 已开启' : '夜间模式');
  }
}

// ==========================================================================
// Render All Multi-Page SpringBoard Views (Strictly XSS-Safe DOM Construction)
// ==========================================================================
function getCurrentScrollOffsets() {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: window.scrollX || window.pageXOffset || 0,
    y: window.scrollY || window.pageYOffset || 0,
  };
}

function restoreClampedScrollOffsets({ x = 0, y = 0 } = {}) {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
  const maxScrollY = Math.max(
    0,
    Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0
    ) - (window.innerHeight || 0)
  );
  const clampedY = Math.min(maxScrollY, Math.max(0, Math.round(y)));
  const currentY = window.scrollY || window.pageYOffset || 0;
  const currentX = window.scrollX || window.pageXOffset || 0;
  if (Math.abs(currentY - clampedY) >= 1 || Math.abs(currentX - x) >= 1) {
    window.scrollTo(Math.max(0, Math.round(x)), clampedY);
  }
}

function getViewportDimensions() {
  if (typeof window === 'undefined') {
    return { width: 1280, height: 800 };
  }
  const vv = window.visualViewport;
  const width = Math.round(
    Number(vv?.width) || Number(window.innerWidth) || Number(document.documentElement?.clientWidth) || 1280
  );
  const height = Math.round(
    Number(vv?.height) || Number(window.innerHeight) || Number(document.documentElement?.clientHeight) || 800
  );
  return {
    width: Math.max(320, width),
    height: Math.max(240, height),
  };
}

function measureActualAvailableGridHeight() {
  if (typeof document === 'undefined') return null;
  const viewportEl = document.getElementById('springboardViewport');
  if (!viewportEl || typeof viewportEl.getBoundingClientRect !== 'function') return null;
  const viewportRect = viewportEl.getBoundingClientRect();
  if (!viewportRect || viewportRect.height <= 0) return null;

  let viewportBottom = viewportRect.bottom;
  const paginationEl = document.querySelector('.springboard-pagination-wrap');
  if (paginationEl && typeof paginationEl.getBoundingClientRect === 'function') {
    const pagRect = paginationEl.getBoundingClientRect();
    if (pagRect.height > 0 && pagRect.top > viewportRect.top + 8) {
      viewportBottom = Math.min(viewportBottom, pagRect.top - 2);
    }
  }
  const dockEl = document.getElementById('iosDock');
  if (dockEl && typeof dockEl.getBoundingClientRect === 'function') {
    const dockRect = dockEl.getBoundingClientRect();
    if (dockRect.height > 0 && dockRect.top > viewportRect.top + 8) {
      viewportBottom = Math.min(viewportBottom, dockRect.top - 6);
    }
  }

  const usableViewportHeight = Math.floor(viewportBottom - viewportRect.top);
  if (usableViewportHeight <= 0) return null;

  const activePageEl =
    document.querySelector('.springboard-page.page-active') ||
    document.querySelector('.springboard-page');
  if (activePageEl) {
    const activeGridEl = activePageEl.querySelector('.apps-grid.desktop-mixed-grid');
    if (activeGridEl && typeof activeGridEl.getBoundingClientRect === 'function') {
      const gridRect = activeGridEl.getBoundingClientRect();
      if (gridRect.top >= viewportRect.top - 4 && gridRect.height > 0) {
        let pagePadBottom = 2;
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
          const pageStyle = window.getComputedStyle(activePageEl);
          pagePadBottom = Math.max(2, Math.ceil(parseFloat(pageStyle.paddingBottom) || 0));
        }
        const directGridHeight = Math.floor(
          Math.min(viewportBottom - pagePadBottom, activePageEl.getBoundingClientRect().bottom - pagePadBottom) -
            gridRect.top
        );
        if (directGridHeight > 0) {
          return directGridHeight;
        }
      }
    }
  }

  let pageChromeAllowance = 14;
  if (activePageEl && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const pageStyle = window.getComputedStyle(activePageEl);
    const padTop = parseFloat(pageStyle.paddingTop) || 0;
    const padBottom = parseFloat(pageStyle.paddingBottom) || 0;
    const rowGap = parseFloat(pageStyle.rowGap || pageStyle.gap) || 0;
    const headerEl = activePageEl.querySelector('.page-section-header');
    const headerHeight =
      headerEl && typeof headerEl.getBoundingClientRect === 'function'
        ? Math.ceil(headerEl.getBoundingClientRect().height)
        : 0;
    pageChromeAllowance = Math.ceil(
      padTop + padBottom + (headerHeight > 0 ? headerHeight + rowGap : 0) + 4
    );
  }

  const fallbackAvailable = Math.floor(usableViewportHeight - pageChromeAllowance);
  return fallbackAvailable > 0 ? fallbackAvailable : Math.max(1, usableViewportHeight);
}

function measureActualAvailableGridWidth() {
  if (typeof document === 'undefined') return null;
  const viewportEl = document.getElementById('springboardViewport');
  if (!viewportEl || typeof viewportEl.getBoundingClientRect !== 'function') return null;
  const viewportRect = viewportEl.getBoundingClientRect();
  if (!viewportRect || viewportRect.width <= 0) return null;

  let pageInlinePadding = 16;
  const activePageEl =
    document.querySelector('.springboard-page.page-active') ||
    document.querySelector('.springboard-page');
  if (activePageEl && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const pageStyle = window.getComputedStyle(activePageEl);
    const padLeft = parseFloat(pageStyle.paddingLeft) || 0;
    const padRight = parseFloat(pageStyle.paddingRight) || 0;
    pageInlinePadding = Math.max(0, Math.ceil(padLeft + padRight));
  }

  const usableWidth = Math.floor(viewportRect.width - pageInlinePadding);
  return usableWidth > 0 ? usableWidth : null;
}

function applyDisplayModeClassesAndVars(metrics) {
  if (typeof document !== 'undefined' && document.body) {
    document.body.setAttribute('data-display-mode', metrics.effectiveMode);
    document.body.setAttribute('data-mobile-mode-pref', state.mobileDisplayMode);
    document.body.classList.toggle('is-mobile-viewport', Boolean(metrics.isMobile));
    document.body.classList.toggle('is-comfort-mode', metrics.effectiveMode === DISPLAY_MODES.COMFORT);
    document.body.classList.toggle('is-compact-mode', metrics.effectiveMode === DISPLAY_MODES.COMPACT);

    const rootStyle = document.documentElement?.style;
    if (rootStyle) {
      rootStyle.setProperty('--grid-cols', String(metrics.columns));
      rootStyle.setProperty('--grid-row-height', `${metrics.rowHeight}px`);
      rootStyle.setProperty('--grid-row-gap', `${metrics.rowGap}px`);
      rootStyle.setProperty('--grid-col-gap', `${metrics.colGap}px`);
      rootStyle.setProperty('--compact-icon-size', `${metrics.iconSize}px`);
      rootStyle.setProperty('--widget-min-height', `${metrics.widgetMinHeight}px`);
      if (Number.isFinite(Number(metrics.trackMaxWidth)) && Number(metrics.trackMaxWidth) > 0) {
        rootStyle.setProperty('--grid-max-track-width', `${metrics.trackMaxWidth}px`);
      } else {
        rootStyle.removeProperty('--grid-max-track-width');
      }
    }
  }
}

/**
 * Desktop only: aligns the first content edge of .status-left with the real grid's left edge.
 * Uses the static (never transformed) #springboardViewport and .ios-status-bar rects plus the
 * same track math as CSS (grid width = min(page content width, cols*track + gaps), centered),
 * so drag/swipe transforms on pages cannot make it oscillate. Right controls/search are untouched.
 */
function syncStatusBarGridAlignment(metrics) {
  if (typeof document === 'undefined') return;
  const rootStyle = document.documentElement?.style;
  if (!rootStyle) return;
  const clear = () => {
    rootStyle.removeProperty('--status-left-inset');
    rootStyle.removeProperty('--status-right-inset');
  };
  if (!metrics || metrics.isMobile || typeof window?.getComputedStyle !== 'function') {
    clear();
    return;
  }
  const viewportEl = document.getElementById('springboardViewport');
  const barEl = document.querySelector('.ios-status-bar');
  if (!viewportEl || !barEl) {
    clear();
    return;
  }
  const viewportRect = viewportEl.getBoundingClientRect();
  const barRect = barEl.getBoundingClientRect();
  if (!(viewportRect.width > 0) || !(barRect.width > 0)) {
    clear();
    return;
  }
  let padLeft = 8;
  let padRight = 8;
  const pageEl =
    document.querySelector('.springboard-page.page-active') ||
    document.querySelector('.springboard-page');
  if (pageEl) {
    const pageStyle = window.getComputedStyle(pageEl);
    padLeft = parseFloat(pageStyle.paddingLeft) || 0;
    padRight = parseFloat(pageStyle.paddingRight) || 0;
  }
  const barPadLeft = parseFloat(window.getComputedStyle(barEl).paddingLeft) || 0;
  const barPadRight = parseFloat(window.getComputedStyle(barEl).paddingRight) || 0;
  const contentWidth = Math.max(0, viewportRect.width - padLeft - padRight);
  const cols = Math.max(1, Number(metrics.columns) || 1);
  const gap = Math.max(0, Number(metrics.colGap) || 0);
  const track = Number(metrics.trackMaxWidth);
  const naturalWidth =
    Number.isFinite(track) && track > 0 ? cols * track + (cols - 1) * gap : contentWidth;
  const gridWidth = Math.min(contentWidth, naturalWidth);
  const gridLeft = viewportRect.left + padLeft + (contentWidth - gridWidth) / 2;
  const gridRight = gridLeft + gridWidth;
  const inset = Math.round(gridLeft - (barRect.left + barPadLeft));
  const rightInset = Math.round(barRect.right - barPadRight - gridRight);
  rootStyle.setProperty('--status-left-inset', `${Math.max(0, Math.min(320, inset))}px`);
  rootStyle.setProperty('--status-right-inset', `${Math.max(0, Math.min(320, rightInset))}px`);
}

function syncDisplayModeAndMetricsToDOM() {
  const { width, height } = getViewportDimensions();
  const initialMetrics = computeSingleScreenMetrics({
    viewportWidth: width,
    viewportHeight: height,
    mobileDisplayMode: state.mobileDisplayMode,
  });

  // Apply body mode classes first so flex viewport & chrome settle at their target CSS sizes
  applyDisplayModeClassesAndVars(initialMetrics);

  // Measure actual DOM available height & width for the grid and refine metrics if measured
  const measuredAvailableGridHeight = measureActualAvailableGridHeight();
  const measuredAvailableGridWidth = measureActualAvailableGridWidth();
  const metrics =
    measuredAvailableGridHeight !== null || measuredAvailableGridWidth !== null
      ? computeSingleScreenMetrics({
          viewportWidth: width,
          viewportHeight: height,
          mobileDisplayMode: state.mobileDisplayMode,
          measuredAvailableGridHeight,
          measuredAvailableGridWidth,
        })
      : initialMetrics;

  state.singleScreenMetrics = metrics;
  state.effectiveDisplayMode = metrics.effectiveMode;
  applyDisplayModeClassesAndVars(metrics);
  syncStatusBarGridAlignment(metrics);

  document.querySelectorAll('[data-mobile-mode]').forEach((btn) => {
    const isActive = btn.dataset.mobileMode === state.mobileDisplayMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', String(isActive));
  });

  const statusText = document.getElementById('mobileDisplayModeStatusText');
  if (statusText) {
    setText(
      statusText,
      state.mobileDisplayMode === DISPLAY_MODES.COMFORT
        ? '当前：舒展分屏（大图标滑动）'
        : '当前：紧凑单屏（一屏总览）'
    );
  }
}

function setMobileDisplayMode(nextMode, { persist = true } = {}) {
  const normalized = normalizeMobileDisplayMode(nextMode);
  const currentCategoryPageId = state.pages[state.currentPageIndex]?.id || 'all';
  state.mobileDisplayMode = normalized;
  if (persist) {
    saveMobileDisplayMode(normalized);
  }
  closeWidgetDetailModal();
  closeCategoryOverflowModal();
  closeFolderDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
  syncDisplayModeAndMetricsToDOM();
  renderAll({ preserveCategoryPageId: currentCategoryPageId });
}

function isAnyModalOrDetailOpen() {
  if (
    activeWidgetDetailRestore ||
    state.activeWidgetDetailId ||
    state.activeFolderDetailId
  ) {
    return true;
  }
  if (typeof document === 'undefined') {
    return false;
  }
  const modalIds = [
    'widgetDetailModal',
    'categoryOverflowModal',
    'folderDetailModal',
    'apiConfigModal',
    'addSiteModal',
    'addPageModal',
  ];
  for (const id of modalIds) {
    const elNode = document.getElementById(id);
    if (elNode && !elNode.hidden) {
      return true;
    }
  }
  return false;
}

function closeWidgetDetailModal({ restoreFocus = true, recalibrateAfterClose = true } = {}) {
  closeAllPopovers();
  const modal = document.getElementById('widgetDetailModal');
  if (!activeWidgetDetailRestore && (!modal || modal.hidden)) {
    state.activeWidgetDetailId = null;
    return;
  }

  if (activeWidgetDetailRestore) {
    const {
      widgetEl,
      originalParent,
      originalNextSibling,
      placeholderNode,
      triggerEl,
    } = activeWidgetDetailRestore;
    activeWidgetDetailRestore = null;

    if (widgetEl) {
      widgetEl.classList.remove('widget-in-detail-modal');
      if (placeholderNode && placeholderNode.parentNode) {
        placeholderNode.parentNode.insertBefore(widgetEl, placeholderNode);
        placeholderNode.remove();
      } else if (originalParent) {
        if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
          originalParent.insertBefore(widgetEl, originalNextSibling);
        } else {
          originalParent.appendChild(widgetEl);
        }
      }
    }
    if (placeholderNode && placeholderNode.parentNode) {
      placeholderNode.remove();
    }
    if (restoreFocus && triggerEl && typeof triggerEl.focus === 'function') {
      try {
        triggerEl.focus({ preventScroll: true });
      } catch {
        // Ignore focus errors
      }
    }
  }

  state.activeWidgetDetailId = null;
  if (modal) {
    modal.hidden = true;
  }
  if (recalibrateAfterClose) {
    schedulePostRenderGridCalibration();
  }
}

function openWidgetDetailModal(widgetEl, widgetItem) {
  if (!widgetEl || !widgetItem || state.jiggleMode) return;
  const modal = document.getElementById('widgetDetailModal');
  const stage = document.getElementById('widgetDetailStage');
  const titleEl = document.getElementById('widgetDetailModalTitle');
  const closeBtn = document.getElementById('closeWidgetDetailModalBtn');
  if (!modal || !stage) return;

  closeWidgetDetailModal({ restoreFocus: false });
  closeAllPopovers();
  closeMovePagePopover();

  const def = state.widgetRegistry.find((d) => d.type === widgetItem.type);
  const title = getWidgetDisplayTitle(widgetItem, '小组件详情') || def?.title || '小组件详情';
  if (titleEl) {
    setText(titleEl, title);
  }

  const originalParent = widgetEl.parentNode;
  const originalNextSibling = widgetEl.nextSibling;
  const rect = widgetEl.getBoundingClientRect();
  const placeholderNode = el('div', {
    className: 'ios-widget widget-detail-slot-placeholder',
    'aria-hidden': 'true',
  });
  const currentDisplaySize =
    widgetEl.getAttribute('data-widget-size') ||
    resolveWidgetDisplaySize({ kind: 'widget', widget: widgetItem }, state.singleScreenMetrics);
  placeholderNode.setAttribute('data-widget-size', currentDisplaySize);
  const currentSpan = getWidgetGridSpan({ kind: 'widget', widget: widgetItem }, state.singleScreenMetrics);
  const fixedColStart = widgetEl.style.gridColumnStart;
  const fixedColEnd = widgetEl.style.gridColumnEnd;
  const fixedRowStart = widgetEl.style.gridRowStart;
  const fixedRowEnd = widgetEl.style.gridRowEnd;
  if (widgetEl.dataset.fixedCell === 'true' && fixedColStart && fixedRowStart) {
    placeholderNode.style.gridColumn = `${fixedColStart} / ${fixedColEnd || `span ${currentSpan.colSpan}`}`;
    placeholderNode.style.gridRow = `${fixedRowStart} / ${fixedRowEnd || `span ${currentSpan.rowSpan}`}`;
  } else {
    placeholderNode.style.gridColumn = `span ${currentSpan.colSpan}`;
    placeholderNode.style.gridRow = `span ${currentSpan.rowSpan}`;
  }
  if (rect.height > 0) {
    placeholderNode.style.minHeight = `${Math.round(rect.height)}px`;
  }
  if (originalParent) {
    originalParent.insertBefore(placeholderNode, widgetEl);
  }

  clearElement(stage);
  widgetEl.classList.add('widget-in-detail-modal');
  stage.appendChild(widgetEl);

  activeWidgetDetailRestore = {
    widgetEl,
    widgetId: widgetItem.id,
    originalParent,
    originalNextSibling,
    placeholderNode,
    triggerEl: widgetEl,
  };
  state.activeWidgetDetailId = widgetItem.id;
  modal.hidden = false;

  if (closeBtn && typeof closeBtn.focus === 'function') {
    try {
      closeBtn.focus({ preventScroll: true });
    } catch {
      // Ignore
    }
  }
}

function closeCategoryOverflowModal({ recalibrateAfterClose = true } = {}) {
  const modal = document.getElementById('categoryOverflowModal');
  const grid = document.getElementById('categoryOverflowGrid');
  state.activeOverflowPageId = null;
  if (grid) {
    clearElement(grid);
  }
  if (modal) {
    modal.hidden = true;
  }
  if (recalibrateAfterClose) {
    schedulePostRenderGridCalibration();
  }
}

function openCategoryOverflowModal(page, allItems = []) {
  const modal = document.getElementById('categoryOverflowModal');
  const titleEl = document.getElementById('categoryOverflowModalTitle');
  const hintEl = document.getElementById('categoryOverflowHintText');
  const grid = document.getElementById('categoryOverflowGrid');
  const closeBtn = document.getElementById('closeCategoryOverflowModalBtn');
  if (!modal || !grid || !page) return;

  closeWidgetDetailModal({ restoreFocus: false });
  closeAllPopovers();
  state.activeOverflowPageId = page.id;

  if (titleEl) {
    setText(titleEl, `${page.title} · 全部 ${allItems.length} 项`);
  }
  if (hintEl) {
    setText(
      hintEl,
      `当前「${page.title}」共有 ${allItems.length} 项内容，已超出单屏紧凑显示上限。下方展示全部网站与小组件入口（原分类与顺序保持不变）。`
    );
  }

  clearElement(grid);
  allItems.forEach((entry, idx) => {
    if (entry.kind === 'site' && entry.site) {
      grid.appendChild(
        createAppItemElement(entry.site, idx, {
          pageId: page.id,
          itemIndex: idx,
          totalItems: allItems.length,
        })
      );
    } else if (entry.kind === 'folder' && entry.folder) {
      grid.appendChild(
        createFolderItemElement(entry, idx, {
          pageId: page.id,
          itemIndex: idx,
          totalItems: allItems.length,
        })
      );
    } else if (entry.kind === 'widget' && entry.widget) {
      const def = state.widgetRegistry.find((d) => d.type === entry.widget.type);
      const wTitle = def?.title || entry.widget.type;
      const wBtn = el(
        'button',
        {
          type: 'button',
          className: 'overflow-widget-launch-card',
        },
        el('span', { className: 'overflow-widget-launch-kicker', textContent: '小组件' }),
        el('span', { className: 'overflow-widget-launch-title', textContent: wTitle }),
        el('span', { className: 'overflow-widget-launch-sub', textContent: '点击查看小组件详情' })
      );
      wBtn.addEventListener('click', () => {
        closeCategoryOverflowModal({ recalibrateAfterClose: false });
        const mountedEl = document.querySelector(
          `.ios-widget[data-widget-id="${CSS.escape(entry.widget.id)}"]`
        );
        if (mountedEl) {
          openWidgetDetailModal(mountedEl, entry.widget);
        }
      });
      grid.appendChild(wBtn);
    }
  });

  modal.hidden = false;
  closeBtn?.focus?.({ preventScroll: true });
}

let activeFolderModalTriggerEl = null;
let folderScrollController = null;
let folderScrollSurfaceEl = null;

function ensureFolderScrollController() {
  const modal = document.getElementById('folderDetailModal');
  const gridEl = document.getElementById('folderDetailGrid');
  const scrollEl = document.getElementById('folderDetailScrollBody') || gridEl;
  if (!gridEl || !scrollEl) return;
  if (folderScrollController && folderScrollSurfaceEl === scrollEl) {
    return;
  }
  folderScrollController?.destroy?.();
  folderScrollSurfaceEl = scrollEl;
  folderScrollController = createFolderScrollController({
    gridEl,
    scrollEl,
    isEditing: () => Boolean(state.jiggleMode),
    isDragging: () => Boolean(desktopPointerDragController?.isDragging?.()),
    isOpen: () => Boolean(state.activeFolderDetailId && modal && !modal.hidden),
    clearLongPress: () => clearActiveLongPress(),
  });
}

function closeFolderDetailModal({
  restoreFocus = true,
  recalibrateAfterClose = true,
  preserveGridForActiveDrag = false,
} = {}) {
  const modal = document.getElementById('folderDetailModal');
  const grid = document.getElementById('folderDetailGrid');
  const statusEl = document.getElementById('folderRenameStatusText');
  const triggerEl = activeFolderModalTriggerEl;
  activeFolderModalTriggerEl = null;
  state.activeFolderDetailId = null;
  state.activeFolderPageId = null;
  folderScrollController?.cancelScroll?.();

  if (statusEl) {
    statusEl.hidden = true;
    setText(statusEl, '');
  }
  if (grid && !preserveGridForActiveDrag) {
    clearElement(grid);
  }
  if (modal) {
    modal.hidden = true;
  }
  if (restoreFocus && triggerEl && typeof triggerEl.focus === 'function') {
    try {
      triggerEl.focus({ preventScroll: true });
    } catch {
      // Ignore focus error
    }
  }
  if (recalibrateAfterClose && !preserveGridForActiveDrag) {
    schedulePostRenderGridCalibration();
  }
}

function renderOpenFolderDetailModalContent() {
  const folderId = state.activeFolderDetailId;
  if (!folderId) return;
  const modal = document.getElementById('folderDetailModal');
  const grid = document.getElementById('folderDetailGrid');
  const titleEl = document.getElementById('folderDetailModalTitle');
  const countBadge = document.getElementById('folderDetailCountBadge');
  const titleInput = document.getElementById('folderTitleInput');
  const statusEl = document.getElementById('folderRenameStatusText');
  if (!modal || !grid) return;

  ensureFolderScrollController();

  const desktop = getEffectiveDesktopForRender();
  const folder = getFolderById(desktop, folderId);
  if (!folder || !Array.isArray(folder.siteIds) || folder.siteIds.length < 2) {
    closeFolderDetailModal({ restoreFocus: false });
    return;
  }

  const folderPlacement = (desktop?.placements || []).find(
    (p) => p && p.kind === 'folder' && p.id === folderId
  );
  const pageId = folderPlacement?.pageId || state.activeFolderPageId || 'all';
  state.activeFolderPageId = pageId;

  if (titleEl) {
    setText(titleEl, folder.title);
  }
  if (countBadge) {
    setText(countBadge, `文件夹 · ${folder.siteIds.length} 项`);
  }
  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = folder.title;
  }
  if (statusEl) {
    statusEl.hidden = true;
    setText(statusEl, '');
  }

  grid.dataset.folderId = folder.id;
  grid.dataset.pageId = pageId;
  clearElement(grid);

  const siteMap = new Map(
    (Array.isArray(state.sites) ? state.sites : [])
      .filter((s) => s && s.id)
      .map((s) => [String(s.id), s])
  );

  folder.siteIds.forEach((siteId, idx) => {
    const resolvedSite = siteMap.get(siteId) || {
      id: siteId,
      title: `未识别站点 (${siteId})`,
      url: '',
      category: pageId === 'all' ? 'ai' : pageId,
      gradient: 'linear-gradient(145deg, #3a3f58 0%, #1e2235 100%)',
      accent: '#64d2ff',
      pinned: false,
      isUnresolvedPlaceholder: true,
    };

    const card = createAppItemElement(resolvedSite, idx, {
      pageId,
      folderId: folder.id,
      itemIndex: idx,
      totalItems: folder.siteIds.length,
    });
    grid.appendChild(card);
  });
}

function openFolderDetailModal(folderId, { pageId = null, triggerEl = null } = {}) {
  if (!folderId) return;
  const modal = document.getElementById('folderDetailModal');
  const titleInput = document.getElementById('folderTitleInput');
  const scrollBody = document.getElementById('folderDetailScrollBody');
  if (!modal) return;

  const desktop = getEffectiveDesktopForRender();
  const folder = getFolderById(desktop, folderId);
  if (!folder) return;

  closeWidgetDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
  closeCategoryOverflowModal({ recalibrateAfterClose: false });
  closeAllPopovers();
  closeMovePagePopover();

  state.activeFolderDetailId = folder.id;
  state.activeFolderPageId =
    pageId ||
    desktop?.placements?.find((p) => p && p.kind === 'folder' && p.id === folder.id)?.pageId ||
    state.pages[state.currentPageIndex]?.id ||
    'all';
  activeFolderModalTriggerEl = triggerEl || null;

  if (titleInput) {
    titleInput.value = folder.title;
  }
  renderOpenFolderDetailModalContent();
  if (scrollBody) {
    scrollBody.scrollTop = 0;
  }
  modal.hidden = false;

  const closeBtn = document.getElementById('closeFolderDetailModalBtn');
  closeBtn?.focus?.({ preventScroll: true });
}

let postRenderMeasureRafId = null;

function schedulePostRenderGridCalibration() {
  if (typeof requestAnimationFrame !== 'function') return;
  if (postRenderMeasureRafId !== null) return;
  postRenderMeasureRafId = requestAnimationFrame(() => {
    postRenderMeasureRafId = null;
    if (desktopPointerDragController?.isDragging?.()) return;
    if (isAnyModalOrDetailOpen()) return;
    const measuredHeight = measureActualAvailableGridHeight();
    const measuredWidth = measureActualAvailableGridWidth();
    if (measuredHeight === null && measuredWidth === null) return;
    const prevAvailHeight = state.singleScreenMetrics?.availableGridHeight || 0;
    const prevAvailWidth = state.singleScreenMetrics?.availableGridWidth || 0;
    const prevCols = state.singleScreenMetrics?.columns || 0;
    const prevRows = state.singleScreenMetrics?.maxRows || 0;
    const prevRowHeight = state.singleScreenMetrics?.rowHeight || 0;

    const { width, height } = getViewportDimensions();
    let chosenHeight = measuredHeight;
    let chosenMetrics = null;

    const activeView = state.screenViews[state.currentViewIndex];
    const hasHomeOverflow =
      activeView &&
      activeView.pageId === 'all' &&
      Array.isArray(activeView.overflowItems) &&
      activeView.overflowItems.length > 0 &&
      Array.isArray(activeView.allCategoryItems);

    if (
      measuredHeight !== null &&
      hasHomeOverflow &&
      typeof document !== 'undefined' &&
      resolveEffectiveDisplayMode({
        viewportWidth: width,
        mobileDisplayMode: state.mobileDisplayMode,
      }) === DISPLAY_MODES.COMPACT
    ) {
      const activePageEl =
        document.querySelector('.springboard-page.page-active') ||
        document.querySelector('.springboard-page');
      const headerEl = activePageEl?.querySelector?.('.page-section-header');
      const activeGridEl = activePageEl?.querySelector?.('.apps-grid.desktop-mixed-grid');
      if (
        headerEl &&
        activeGridEl &&
        typeof headerEl.getBoundingClientRect === 'function' &&
        typeof activeGridEl.getBoundingClientRect === 'function'
      ) {
        const headerRect = headerEl.getBoundingClientRect();
        const gridRect = activeGridEl.getBoundingClientRect();
        const headerOffset = Math.floor(gridRect.top - headerRect.top);
        if (headerRect.height > 0 && headerOffset > 0) {
          const candidateHeight = measuredHeight + headerOffset;
          const candidateMetrics = computeSingleScreenMetrics({
            viewportWidth: width,
            viewportHeight: height,
            mobileDisplayMode: state.mobileDisplayMode,
            measuredAvailableGridHeight: candidateHeight,
            measuredAvailableGridWidth: measuredWidth,
          });
          const [candidateView] = packCategoryItemsIntoViews(activeView.allCategoryItems, {
            pageId: activeView.pageId,
            pageTitle: activeView.pageTitle,
            metrics: candidateMetrics,
          });
          if (
            candidateView &&
            Array.isArray(candidateView.overflowItems) &&
            candidateView.overflowItems.length === 0
          ) {
            chosenHeight = candidateHeight;
            chosenMetrics = candidateMetrics;
          }
        }
      }
    }

    const heightDiff = chosenHeight !== null ? Math.abs(chosenHeight - prevAvailHeight) : 0;
    const widthDiff =
      measuredWidth !== null && prevAvailWidth > 0 ? Math.abs(measuredWidth - prevAvailWidth) : 0;
    if (!chosenMetrics && heightDiff < 2 && widthDiff < 2) return;

    const nextMetrics =
      chosenMetrics ||
      computeSingleScreenMetrics({
        viewportWidth: width,
        viewportHeight: height,
        mobileDisplayMode: state.mobileDisplayMode,
        measuredAvailableGridHeight: chosenHeight,
        measuredAvailableGridWidth: measuredWidth,
      });
    state.singleScreenMetrics = nextMetrics;
    state.effectiveDisplayMode = nextMetrics.effectiveMode;
    applyDisplayModeClassesAndVars(nextMetrics);

    const shouldRepackHomeWithoutOverflow =
      Boolean(chosenMetrics) && hasHomeOverflow;

    if (
      shouldRepackHomeWithoutOverflow ||
      nextMetrics.maxRows !== prevRows ||
      nextMetrics.columns !== prevCols
    ) {
      const currentCategoryPageId = state.pages[state.currentPageIndex]?.id || 'all';
      renderSpringBoardTrack({ preserveCategoryPageId: currentCategoryPageId });
      renderPaginationDots();
      updatePageTurnTransform();
    } else if (nextMetrics.rowHeight !== prevRowHeight) {
      updatePageTurnTransform();
    }
  });
}

function renderAll({ preserveCategoryPageId = null } = {}) {
  const savedScroll = getCurrentScrollOffsets();
  closeWidgetDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
  syncDisplayModeAndMetricsToDOM();
  renderSpringBoardTrack({ preserveCategoryPageId });
  renderPageTabs();
  renderDock();
  renderPaginationDots();
  populateCategorySelectInModal();
  if (state.activeFolderDetailId) {
    renderOpenFolderDetailModalContent();
  }
  updatePageTurnTransform();
  restoreClampedScrollOffsets(savedScroll);
  schedulePostRenderGridCalibration();
}

function createGlyphNode(site) {
  const wrapper = el('div', { className: 'app-glyph' });
  // Prefer explicit iconKey or exact-domain preset via window.LaunchDeckIcons; remaining sites keep .app-glyph-letter for extension favicon enhancement
  const presetKey =
    typeof site?.iconKey === 'string' && Object.hasOwn(ICONS, site.iconKey)
      ? site.iconKey
      : typeof window !== 'undefined' && typeof window.LaunchDeckIcons?.presetKey === 'function'
        ? window.LaunchDeckIcons.presetKey(site)
        : null;
  if (typeof presetKey === 'string' && Object.hasOwn(ICONS, presetKey)) {
    wrapper.innerHTML = ICONS[presetKey];
    wrapper.dataset.browserIconState = 'preset';
    return wrapper;
  }
  const firstChar = String(site.title || 'App').trim().charAt(0).toUpperCase() || 'A';
  const charSpan = el('span', { className: 'app-glyph-letter', textContent: firstChar });
  charSpan.style.fontSize = '23px';
  charSpan.style.fontWeight = '700';
  charSpan.style.letterSpacing = '-0.03em';
  wrapper.appendChild(charSpan);
  return wrapper;
}

function clearPageTabHoverTimer() {
  if (pageTabHoverTimer) {
    clearTimeout(pageTabHoverTimer);
    pageTabHoverTimer = null;
  }
}

function closeMovePagePopover() {
  if (activeMovePagePopover) {
    activeMovePagePopover.remove();
    activeMovePagePopover = null;
  }
}

function resolveDesktopDragSourceEntry({
  desktop = getEffectiveDesktopForRender(),
  fromPageId,
  fromFolderId = null,
  kind,
  id,
} = {}) {
  if (kind !== 'site' && kind !== 'widget') return null;
  if (fromPageId && !fromFolderId) {
    const sourceItems = getRenderablePageItems({
      desktop,
      pageId: fromPageId,
      sites: state.sites,
      layout: state.widgetState.layout,
    });
    const found = sourceItems.find((entry) => entry.kind === kind && entry.id === id);
    if (found) return found;
  }
  if (kind === 'site') {
    const site = (Array.isArray(state.sites) ? state.sites : []).find(
      (s) => s && String(s.id) === String(id)
    );
    if (site) {
      return { kind: 'site', id: String(site.id), pageId: fromPageId || 'all', site };
    }
    if (fromFolderId) {
      return {
        kind: 'site',
        id: String(id),
        pageId: fromPageId || 'all',
        site: { id: String(id), title: String(id), url: '' },
      };
    }
    return null;
  }
  if (kind === 'widget') {
    const widget = (Array.isArray(state.widgetState?.layout) ? state.widgetState.layout : []).find(
      (w) => w && String(w.id) === String(id) && w.enabled !== false
    );
    return widget ? { kind: 'widget', id: String(widget.id), pageId: fromPageId || 'all', widget } : null;
  }
  return null;
}

function isPrimaryNavigationView({ viewId = null, pageId = null, gridEl = null } = {}) {
  if (gridEl?.dataset?.folderId || gridEl?.classList?.contains?.('folder-detail-grid')) {
    return false;
  }
  const pageEl = gridEl?.closest?.('.springboard-page');
  if (pageEl && pageEl.dataset?.subViewIndex !== undefined) {
    return Number(pageEl.dataset.subViewIndex) === 0;
  }
  if (viewId && Array.isArray(state.screenViews) && state.screenViews.length > 0) {
    const matched = state.screenViews.find((v) => v.viewId === viewId);
    if (matched) {
      return Number(matched.subViewIndex || 0) === 0;
    }
  }
  if (pageId && Array.isArray(state.screenViews) && state.screenViews.length > 0) {
    const active = state.screenViews[state.currentViewIndex];
    if (active && active.pageId === pageId) {
      return Number(active.subViewIndex || 0) === 0;
    }
  }
  return true;
}

function getDesktopCellDropSpan({
  desktop = getEffectiveDesktopForRender(),
  fromPageId,
  fromFolderId = null,
  kind,
  id,
  metrics = state.singleScreenMetrics,
} = {}) {
  const entry = resolveDesktopDragSourceEntry({ desktop, fromPageId, fromFolderId, kind, id });
  if (!entry) return null;
  const span = getWidgetGridSpan(entry, metrics);
  const displaySize = kind === 'widget' ? resolveWidgetDisplaySize(entry, metrics) : null;
  return {
    entry,
    colSpan: Math.max(1, Number(span?.colSpan) || 1),
    rowSpan: Math.max(1, Number(span?.rowSpan) || 1),
    displaySize,
    metrics,
  };
}

function computeDesktopCellDropPlan({
  desktop = getEffectiveDesktopForRender(),
  fromPageId,
  fromFolderId = null,
  toPageId,
  kind,
  id,
  cell,
  metrics = state.singleScreenMetrics,
} = {}) {
  if (!desktop || !toPageId || (kind !== 'site' && kind !== 'widget')) return null;
  const entry = resolveDesktopDragSourceEntry({ desktop, fromPageId, fromFolderId, kind, id });
  if (!entry) return null;

  let planningDesktop = desktop;
  if (fromFolderId && kind === 'site') {
    planningDesktop = moveFolderSiteToPage(desktop, {
      folderId: fromFolderId,
      siteId: id,
      toPageId,
    });
  } else if (fromPageId && fromPageId !== toPageId) {
    planningDesktop = movePlacementToPage(desktop, {
      fromPageId,
      toPageId,
      kind,
      id,
    });
  }

  const items = getRenderablePageItems({
    desktop: planningDesktop,
    pageId: toPageId,
    sites: state.sites,
    layout: state.widgetState.layout,
  });
  const rawPlacements = getPagePlacements(planningDesktop, toPageId);

  return planDesktopCellDrop({
    entry,
    items,
    rawPlacements,
    metrics,
    cell,
  });
}

function commitDesktopCellDropFromDrag({
  fromPageId,
  fromFolderId = null,
  toPageId,
  kind,
  id,
  cell,
} = {}) {
  if (state.navigationImportInProgress) return false;
  if (kind !== 'site' && kind !== 'widget') return false;
  const authoritativeDesktop = getEffectiveDesktopForRender();
  const targetPageId = toPageId || fromPageId;
  if (!targetPageId) return false;

  const entry = resolveDesktopDragSourceEntry({
    desktop: authoritativeDesktop,
    fromPageId,
    fromFolderId,
    kind,
    id,
  });
  if (!entry) return false;

  let baseDesktop = authoritativeDesktop;
  let dropFromPageId = fromPageId || targetPageId;

  if (fromFolderId && kind === 'site') {
    closeFolderDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
    baseDesktop = moveFolderSiteToPage(authoritativeDesktop, {
      folderId: fromFolderId,
      siteId: id,
      toPageId: targetPageId,
    });
    if (baseDesktop === authoritativeDesktop) {
      return false;
    }
    dropFromPageId = targetPageId;
  } else if (dropFromPageId !== targetPageId) {
    baseDesktop = movePlacementToPage(authoritativeDesktop, {
      fromPageId: dropFromPageId,
      toPageId: targetPageId,
      kind,
      id,
    });
    if (baseDesktop === authoritativeDesktop) {
      return false;
    }
    dropFromPageId = targetPageId;
  }

  const items = getRenderablePageItems({
    desktop: baseDesktop,
    pageId: targetPageId,
    sites: state.sites,
    layout: state.widgetState.layout,
  });
  const rawPlacements = getPagePlacements(baseDesktop, targetPageId);
  const finalPlan = planDesktopCellDrop({
    entry,
    items,
    rawPlacements,
    metrics: state.singleScreenMetrics,
    cell,
  });
  if (!finalPlan || !finalPlan.targetRect) {
    return false;
  }

  const nextDesktop = applyDesktopCellDrop(baseDesktop, {
    fromPageId: dropFromPageId,
    toPageId: targetPageId,
    kind,
    id,
    cell: { row: finalPlan.targetRect.row, column: finalPlan.targetRect.column },
    moves: finalPlan.moves,
  });

  if (baseDesktop === authoritativeDesktop && nextDesktop === baseDesktop) {
    return false;
  }

  // Verify the planned target cell actually took effect (never save a partial move if applyDesktopCellDrop rejected)
  const finalTargetPlacements = getPagePlacements(nextDesktop, targetPageId);
  const committedEntry = finalTargetPlacements.find((p) => p.kind === kind && p.id === id);
  if (
    !committedEntry?.cell ||
    committedEntry.cell.row !== finalPlan.targetRect.row ||
    committedEntry.cell.column !== finalPlan.targetRect.column
  ) {
    return false;
  }

  gestureBlockBlankExit = true;
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
  return true;
}

function applyFixedCellStyleToCard(cardEl, fixedRect, { hasSavedCell = false } = {}) {
  if (!cardEl || !cardEl.style) return;
  if (fixedRect && Number.isInteger(fixedRect.row) && Number.isInteger(fixedRect.column)) {
    const colStart = fixedRect.column + 1;
    const rowStart = fixedRect.row + 1;
    const colSpan = Math.max(1, Number(fixedRect.colSpan) || 1);
    const rowSpan = Math.max(1, Number(fixedRect.rowSpan) || 1);
    cardEl.style.gridColumn = `${colStart} / span ${colSpan}`;
    cardEl.style.gridRow = `${rowStart} / span ${rowSpan}`;
    cardEl.dataset.fixedCell = 'true';
    cardEl.dataset.fixedRow = String(fixedRect.row);
    cardEl.dataset.fixedColumn = String(fixedRect.column);
  } else {
    cardEl.style.removeProperty('grid-column');
    cardEl.style.removeProperty('grid-row');
    cardEl.style.removeProperty('grid-column-start');
    cardEl.style.removeProperty('grid-column-end');
    cardEl.style.removeProperty('grid-row-start');
    cardEl.style.removeProperty('grid-row-end');
    delete cardEl.dataset.fixedCell;
    delete cardEl.dataset.fixedRow;
    delete cardEl.dataset.fixedColumn;
  }
  if (hasSavedCell) {
    cardEl.dataset.savedCell = 'true';
  } else {
    delete cardEl.dataset.savedCell;
  }
  cardEl.draggable = Boolean(state.jiggleMode);
}

function openMoveToPageMenu(anchorEl, { fromPageId, kind, id, title }) {
  closeMovePagePopover();
  closeAllPopovers();
  gestureBlockBlankExit = true;

  const popover = el('div', {
    className: 'move-page-popover ui-popover-portal',
    role: 'dialog',
    'aria-label': `移动 ${title} 到导航页`,
  });

  popover.appendChild(
    el('div', {
      className: 'move-page-popover-header',
      textContent: `将「${title}」移动到：`,
    })
  );

  const list = el('div', { className: 'move-page-popover-list', role: 'menu' });
  state.pages.forEach((page, pageIdx) => {
    const isCurrent = page.id === fromPageId;
    const itemBtn = el(
      'button',
      {
        type: 'button',
        className: `move-page-option ${isCurrent ? 'is-current' : ''}`,
        disabled: isCurrent,
        role: 'menuitem',
        dataset: { targetPageId: page.id },
      },
      el('span', { textContent: page.title }),
      el('span', {
        className: 'move-page-option-tag',
        textContent: isCurrent ? '当前页' : '移入此页',
      })
    );

    itemBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      closeMovePagePopover();
      moveDesktopItemToPage({
        fromPageId,
        toPageId: page.id,
        kind,
        id,
      });
      goToPage(pageIdx);
    });

    list.appendChild(itemBtn);
  });

  const cancelBtn = el('button', {
    type: 'button',
    className: 'move-page-cancel-btn',
    textContent: '取消',
  });
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    gestureBlockBlankExit = true;
    closeMovePagePopover();
    anchorEl?.focus?.({ preventScroll: true });
  });

  popover.append(list, cancelBtn);
  document.body.appendChild(popover);
  activeMovePagePopover = popover;

  if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
    const rect = anchorEl.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const width = popRect.width || 210;
    const height = popRect.height || 220;
    const left = Math.min(Math.max(10, rect.left), Math.max(10, window.innerWidth - width - 10));
    const top =
      rect.bottom + height + 12 <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(10, rect.top - height - 6);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  const firstEnabled = popover.querySelector('.move-page-option:not([disabled])');
  firstEnabled?.focus?.({ preventScroll: true });
}

function renderPageTabs() {
  const nav = document.getElementById('categoryTabs');
  if (!nav) return;
  clearElement(nav);

  state.pages.forEach((page, idx) => {
    const btn = el('button', {
      type: 'button',
      className: `category-pill ${idx === state.currentPageIndex ? 'active' : ''}`,
      dataset: {
        pageIndex: idx,
        pageId: page.id,
        ...(page.isSystem ? {} : { custom: 'true' }),
      },
    });

    btn.appendChild(el('span', { className: 'page-tab-title-text', textContent: page.title }));

    const renameChip = el('span', {
      className: 'page-rename-chip',
      title: `重命名「${page.title}」`,
      'aria-label': `重命名 ${page.title}`,
      textContent: '✎',
    });
    btn.appendChild(renameChip);

    if (!page.isSystem) {
      btn.appendChild(
        el('span', {
          className: 'page-delete-chip',
          title: '删除此导航页（页内内容将迁回主页）',
          'aria-label': `删除 ${page.title}`,
          textContent: '×',
        })
      );
    }

    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('page-delete-chip')) {
        e.stopPropagation();
        gestureBlockBlankExit = true;
        deleteNavigationPage(page.id);
        return;
      }
      if (e.target.classList.contains('page-rename-chip')) {
        e.stopPropagation();
        gestureBlockBlankExit = true;
        openRenamePageModal(page.id);
        return;
      }
      goToPage(idx);
    });

    btn.addEventListener('dragover', (e) => {
      if (!state.jiggleMode || !state.draggedItem) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      btn.classList.add('drag-target-active');
      if (state.currentPageIndex !== idx && !pageTabHoverTimer) {
        pageTabHoverTimer = setTimeout(() => {
          pageTabHoverTimer = null;
          goToPage(idx);
        }, 380);
      }
    });

    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drag-target-active');
      clearPageTabHoverTimer();
    });

    btn.addEventListener('drop', (e) => {
      if (!state.jiggleMode || !state.draggedItem) return;
      e.preventDefault();
      e.stopPropagation();
      btn.classList.remove('drag-target-active');
      clearPageTabHoverTimer();
      gestureBlockBlankExit = true;
      const dragged = state.draggedItem;
      state.draggedItem = null;
      state.draggedSiteId = null;
      moveDesktopItemToPage({
        fromPageId: dragged.fromPageId,
        toPageId: page.id,
        kind: dragged.kind,
        id: dragged.id,
      });
      goToPage(idx);
    });

    nav.appendChild(btn);
  });
}

function renderBentoWidgetsHost() {
  const bento = document.getElementById('widgetsBento');
  if (!bento) return;
  widgetHost.renderLayout(bento, state.widgetState.layout);
}

function clearActiveLongPress() {
  if (activeLongPressTimer) {
    clearTimeout(activeLongPressTimer);
    activeLongPressTimer = null;
  }
}

function ensureDesktopPointerDragController() {
  const trackEl = document.getElementById('springboardTrack');
  if (!trackEl) return;
  if (desktopPointerDragController && desktopPointerDragTrackEl === trackEl) {
    return;
  }
  desktopPointerDragController?.destroy?.();
  desktopPointerDragTrackEl = trackEl;
  desktopPointerDragController = createDesktopPointerDragController({
    trackEl,
    isJiggleMode: () => Boolean(state.jiggleMode),
    getCurrentPageId: () => state.pages[state.currentPageIndex]?.id || 'all',
    getCurrentViewId: () => state.screenViews[state.currentViewIndex]?.viewId || null,
    getPagePlacementsForPage: (pageId) => getPagePlacements(getEffectiveDesktopForRender(), pageId),
    getCellDropSpan: getDesktopCellDropSpan,
    planCellDrop: computeDesktopCellDropPlan,
    onCommitCellDrop: commitDesktopCellDropFromDrag,
    onDragStart: ({ kind, id, fromPageId, fromFolderId = null }) => {
      clearActiveLongPress();
      closeMovePagePopover();
      closeWidgetDetailModal({ restoreFocus: false });
      gestureBlockBlankExit = true;
      state.draggedItem = { kind, id, fromPageId, fromFolderId };
      state.draggedSiteId = kind === 'site' ? id : null;
    },
    onDragEnd: () => {
      state.draggedItem = null;
      state.draggedSiteId = null;
      gestureBlockBlankExit = true;
      setTimeout(() => {
        gestureBlockBlankExit = false;
      }, 140);
    },
    onRequestExitFolderModalForDrag: () => {
      closeFolderDetailModal({
        restoreFocus: false,
        recalibrateAfterClose: false,
        preserveGridForActiveDrag: true,
      });
    },
    onSwitchPageById: (targetPageId, targetViewId = null) => {
      if (targetViewId) {
        const viewIdx = state.screenViews.findIndex((v) => v.viewId === targetViewId);
        if (viewIdx !== -1 && viewIdx !== state.currentViewIndex) {
          goToView(viewIdx);
          return;
        }
      }
      const idx = state.pages.findIndex((p) => p.id === targetPageId);
      if (idx !== -1 && idx !== state.currentPageIndex) {
        goToPage(idx);
      }
    },
    onSwitchAdjacentView: (delta) => {
      const totalViews = state.screenViews.length;
      if (totalViews <= 1) return false;
      const nextViewIdx = state.currentViewIndex + (delta > 0 ? 1 : -1);
      if (nextViewIdx < 0 || nextViewIdx >= totalViews) return false;
      goToView(nextViewIdx);
      return true;
    },
    onCommitFolderMerge: ({
      fromPageId,
      fromFolderId = null,
      toPageId,
      draggedSiteId,
      targetKind,
      targetId,
    }) => {
      gestureBlockBlankExit = true;
      closeFolderDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
      const currentDesktop = getEffectiveDesktopForRender();
      let nextDesktop = currentDesktop;
      if (targetKind === 'folder') {
        nextDesktop = addSiteToFolder(currentDesktop, {
          folderId: targetId,
          siteId: draggedSiteId,
          fromPageId,
          fromFolderId,
        });
      } else if (targetKind === 'site') {
        nextDesktop = createSiteFolder(currentDesktop, {
          pageId: toPageId || fromPageId,
          fromPageId,
          fromFolderId,
          targetSiteId: targetId,
          draggedSiteId,
        });
      }
      commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
    },
    onCommitFolderReorder: ({ folderId, siteId, beforeSiteId }) => {
      gestureBlockBlankExit = true;
      const nextDesktop = reorderFolderSite(getEffectiveDesktopForRender(), {
        folderId,
        siteId,
        beforeSiteId,
      });
      commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
    },
    onCommitFolderExtractToDesktop: ({
      fromFolderId,
      fromPageId,
      toPageId,
      targetViewId = null,
      siteId,
      beforeKind = null,
      beforeId = null,
      switchToPage = false,
    }) => {
      gestureBlockBlankExit = true;
      closeFolderDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
      const resolved = resolveViewDropBeforeAnchor({
        views: state.screenViews,
        targetViewId,
        targetPageId: toPageId || fromPageId,
        explicitBeforeKind: beforeKind,
        explicitBeforeId: beforeId,
        draggedKind: 'site',
        draggedId: siteId,
      });
      const nextDesktop = moveFolderSiteToPage(getEffectiveDesktopForRender(), {
        folderId: fromFolderId,
        siteId,
        toPageId: resolved.toPageId,
        beforeKind: resolved.beforeKind,
        beforeId: resolved.beforeId,
      });
      commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
      if (switchToPage) {
        const idx = state.pages.findIndex((p) => p.id === resolved.toPageId);
        if (idx !== -1 && idx !== state.currentPageIndex) {
          goToPage(idx);
        }
      }
    },
    onCommitPlacement: ({
      fromPageId,
      toPageId,
      targetViewId = null,
      kind,
      id,
      beforeKind = null,
      beforeId = null,
      switchToPage = false,
    }) => {
      gestureBlockBlankExit = true;
      const resolved = resolveViewDropBeforeAnchor({
        views: state.screenViews,
        targetViewId,
        targetPageId: toPageId,
        explicitBeforeKind: beforeKind,
        explicitBeforeId: beforeId,
        draggedKind: kind,
        draggedId: id,
      });
      commitDesktopItemBefore({
        fromPageId,
        toPageId: resolved.toPageId,
        kind,
        id,
        beforeKind: resolved.beforeKind,
        beforeId: resolved.beforeId,
      });
      if (switchToPage) {
        const idx = state.pages.findIndex((p) => p.id === resolved.toPageId);
        if (idx !== -1 && idx !== state.currentPageIndex) {
          goToPage(idx);
        }
      }
    },
    onDropOnCard: (payload) => {
      gestureBlockBlankExit = true;
      handleDropOnDesktopCard(payload);
    },
    onDropToPage: ({ fromPageId, toPageId, targetViewId = null, kind, id, switchToPage }) => {
      gestureBlockBlankExit = true;
      const resolved = resolveViewDropBeforeAnchor({
        views: state.screenViews,
        targetViewId,
        targetPageId: toPageId,
        draggedKind: kind,
        draggedId: id,
      });
      moveDesktopItemToPage({
        fromPageId,
        toPageId: resolved.toPageId,
        kind,
        id,
        beforeTarget:
          resolved.beforeKind && resolved.beforeId
            ? { kind: resolved.beforeKind, id: resolved.beforeId }
            : null,
      });
      if (switchToPage) {
        const idx = state.pages.findIndex((p) => p.id === resolved.toPageId);
        if (idx !== -1 && idx !== state.currentPageIndex) {
          goToPage(idx);
        }
      }
    },
  });
}

function bindDesktopCardDragAndLongPress(
  cardEl,
  { pageId, viewId = null, folderId = null, kind, id }
) {
  ensureDesktopPointerDragController();
  cardEl.dataset.placementKind = kind;
  cardEl.dataset.placementId = id;
  cardEl.dataset.pageId = pageId;
  if (viewId) {
    cardEl.dataset.viewId = viewId;
  }
  if (folderId) {
    cardEl.dataset.folderId = folderId;
  }
  cardEl.draggable = Boolean(state.jiggleMode);

  let downX = 0;
  let downY = 0;
  let latestX = 0;
  let latestY = 0;
  let activePointerId = null;

  let lastPointerType = 'mouse';

  cardEl.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType || 'mouse';
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (state.jiggleMode) return;
    // Allow long-press inside #folderDetailModal so folder member sites can enter edit & drag!
    if (
      cardEl.classList.contains('widget-in-detail-modal') ||
      cardEl.closest('#widgetDetailModal, #categoryOverflowModal, #apiConfigModal, #addSiteModal, #addPageModal')
    ) {
      return;
    }
    if (
      e.target.closest(
        '.delete-badge, .card-edit-actions, .card-edit-btn, .move-page-popover, input, textarea, select, [role="combobox"], .ui-select-wrap, .ui-datetime-field, [data-widget-horizontal-scroll]'
      )
    ) {
      return;
    }
    clearActiveLongPress();
    downX = e.clientX;
    downY = e.clientY;
    latestX = e.clientX;
    latestY = e.clientY;
    activePointerId = e.pointerId;
    activeLongPressTimer = setTimeout(() => {
      activeLongPressTimer = null;
      const pid = activePointerId;
      activePointerId = null;
      gestureBlockBlankExit = true;
      if (typeof cancelActivePageDrag === 'function') {
        cancelActivePageDrag();
      }
      folderScrollController?.cancelScroll?.();
      setJiggleMode(true);
      if (
        pid !== null &&
        desktopPointerDragController?.startFromLongPress
      ) {
        desktopPointerDragController.startFromLongPress({
          cardEl,
          pointerId: pid,
          startX: downX,
          startY: downY,
          clientX: latestX,
          clientY: latestY,
          immediateLift: true,
        });
      }
    }, 550);
  });

  cardEl.addEventListener(
    'pointermove',
    (e) => {
      if (!activeLongPressTimer || e.pointerId !== activePointerId) return;
      latestX = e.clientX;
      latestY = e.clientY;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) >= 8) {
        clearActiveLongPress();
        activePointerId = null;
      }
    },
    { passive: true }
  );

  ['pointerup', 'pointerleave', 'pointercancel', 'dragstart'].forEach((evt) => {
    cardEl.addEventListener(
      evt,
      () => {
        clearActiveLongPress();
        activePointerId = null;
      },
      { passive: true }
    );
  });

  cardEl.addEventListener('dragstart', (e) => {
    clearActiveLongPress();
    closeMovePagePopover();
    if (!state.jiggleMode) {
      e.preventDefault();
      return;
    }
    const currentPageId = cardEl.dataset.pageId || pageId;
    const currentFolderId =
      cardEl.closest('.folder-detail-grid[data-folder-id]')?.dataset?.folderId ||
      folderId ||
      null;
    gestureBlockBlankExit = true;
    state.draggedItem = { kind, id, fromPageId: currentPageId, fromFolderId: currentFolderId };
    state.draggedSiteId = kind === 'site' ? id : null;
    cardEl.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', `${kind}:${id}:${currentPageId}`);
      } catch {
        // Ignore dataTransfer restrictions in synthetic events
      }
    }
  });

  cardEl.addEventListener('dragend', () => {
    if (!state.jiggleMode) return;
    cardEl.classList.remove('dragging');
    clearPageTabHoverTimer();
    document.querySelectorAll('.drag-target-active, .drag-over-card').forEach((node) => {
      node.classList.remove('drag-target-active', 'drag-over-card');
    });
    state.draggedItem = null;
    state.draggedSiteId = null;
    gestureBlockBlankExit = true;
    setTimeout(() => {
      gestureBlockBlankExit = false;
    }, 120);
  });

  cardEl.addEventListener('dragover', (e) => {
    if (!state.jiggleMode) return;
    e.preventDefault();
    e.stopPropagation();
    cardEl.classList.add('drag-over-card');
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  });

  cardEl.addEventListener('dragleave', () => {
    cardEl.classList.remove('drag-over-card');
  });

  cardEl.addEventListener('drop', (e) => {
    if (!state.jiggleMode) return;
    e.preventDefault();
    e.stopPropagation();
    cardEl.classList.remove('drag-over-card');
    gestureBlockBlankExit = true;

    const currentPageId = cardEl.dataset.pageId || pageId;
    const currentFolderId =
      cardEl.closest('.folder-detail-grid[data-folder-id]')?.dataset?.folderId ||
      folderId ||
      null;
    const dragged =
      state.draggedItem ||
      (state.draggedSiteId ? { kind: 'site', id: state.draggedSiteId, fromPageId: currentPageId } : null);
    if (!dragged) return;
    if (
      dragged.kind === kind &&
      dragged.id === id &&
      dragged.fromPageId === currentPageId &&
      dragged.fromFolderId === currentFolderId
    ) {
      return;
    }

    state.draggedItem = null;
    state.draggedSiteId = null;
    if (currentFolderId && dragged.fromFolderId === currentFolderId) {
      const nextDesktop = reorderFolderSite(getEffectiveDesktopForRender(), {
        folderId: currentFolderId,
        siteId: dragged.id,
        targetSiteId: id,
      });
      commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
      return;
    }
    if (cardEl.dataset.fixedCell === 'true') {
      const resolved = resolveViewDropBeforeAnchor({
        views: state.screenViews,
        targetViewId: cardEl.dataset.viewId || null,
        targetPageId: currentPageId,
        draggedKind: dragged.kind,
        draggedId: dragged.id,
      });
      commitDesktopItemBefore({
        fromPageId: dragged.fromPageId || currentPageId,
        toPageId: resolved.toPageId,
        kind: dragged.kind,
        id: dragged.id,
        beforeKind: resolved.beforeKind,
        beforeId: resolved.beforeId,
      });
      return;
    }
    handleDropOnDesktopCard({
      fromPageId: dragged.fromPageId || currentPageId,
      toPageId: currentPageId,
      draggedKind: dragged.kind,
      draggedId: dragged.id,
      targetKind: kind,
      targetId: id,
    });
  });

  cardEl.addEventListener('contextmenu', (e) => {
    if (
      cardEl.classList.contains('widget-in-detail-modal') ||
      cardEl.closest('#widgetDetailModal, #categoryOverflowModal')
    ) {
      return;
    }
    if (lastPointerType === 'touch' || lastPointerType === 'pen' || state.jiggleMode) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  cardEl.addEventListener('keydown', (e) => {
    if (!state.jiggleMode) return;
    const currentPageId = cardEl.dataset.pageId || pageId;
    const currentFolderId =
      cardEl.closest('.folder-detail-grid[data-folder-id]')?.dataset?.folderId ||
      folderId ||
      null;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
      e.preventDefault();
      e.stopPropagation();
      if (currentFolderId) {
        stepSiteInFolder(currentFolderId, id, -1);
      } else {
        stepDesktopItemInPage(currentPageId, kind, id, -1);
      }
    } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      if (currentFolderId) {
        stepSiteInFolder(currentFolderId, id, 1);
      } else {
        stepDesktopItemInPage(currentPageId, kind, id, 1);
      }
    }
  });
}

function setSiteTileSize(siteId, nextSize) {
  if (!siteId || state.navigationImportInProgress) return false;
  const normalized = nextSize === 'square' ? 'square' : 'single';
  const idx = state.sites.findIndex((s) => s && s.id === siteId);
  if (idx === -1) return false;
  const current = state.sites[idx].size === 'square' ? 'square' : 'single';
  if (current === normalized) return true;
  const nextSite = { ...state.sites[idx] };
  if (normalized === 'square') {
    nextSite.size = 'square';
  } else {
    delete nextSite.size;
  }
  state.sites = state.sites.map((s, i) => (i === idx ? nextSite : s));
  saveSitesToStorage();
  renderAll();
  return true;
}

function createAppItemElement(
  site,
  idx,
  {
    pageId = null,
    viewId = null,
    folderId = null,
    itemIndex = idx,
    totalItems = 1,
    allowSizing = false,
    fixedRect = null,
    savedCell = null,
  } = {}
) {
  const effectivePageId = pageId || state.pages[state.currentPageIndex]?.id || 'all';
  const validHref = safeHttpUrl(site.url);
  // Only page-grid tiles (not Dock, folders, search, or overflow list) render the optional 2×2 size
  const pageTileSize = allowSizing && !folderId && site.size === 'square' ? 'square' : 'single';
  const item = el('a', {
    className: `app-item ${site.isUnresolvedPlaceholder ? 'app-item-unresolved' : ''}`,
    href: validHref || '#',
    target: '_blank',
    rel: 'noopener noreferrer',
    dataset: {
      id: site.id,
      placementKind: 'site',
      placementId: site.id,
      pageId: effectivePageId,
      ...(viewId ? { viewId } : {}),
      ...(folderId ? { folderId } : {}),
      ...(allowSizing && !folderId ? { siteSize: pageTileSize } : {}),
    },
  });

  const randomDelay = ((idx % 7) * -0.045).toFixed(3);
  item.style.setProperty('--jiggle-delay', `${randomDelay}s`);

  const delBtn = el('button', {
    className: 'delete-badge',
    type: 'button',
    disabled: !state.jiggleMode,
    title: `移除 ${site.title}`,
    'aria-label': `移除 ${site.title}`,
  });

  const squircle = el('div', { className: 'app-squircle' });
  squircle.style.setProperty('--app-gradient', safeGradient(site.gradient));
  squircle.style.setProperty('--app-accent', safeHexColor(site.accent, '#5ac8fa'));
  squircle.appendChild(createGlyphNode(site));

  const labelSpan = el('span', { className: 'app-label', textContent: site.title });

  item.append(delBtn, squircle, labelSpan);

  if (allowSizing && !folderId && !site.isUnresolvedPlaceholder) {
    const nextSize = pageTileSize === 'square' ? 'single' : 'square';
    const currentLabel = pageTileSize === 'square' ? '2×2' : '1×1';
    const nextLabel = nextSize === 'square' ? '2×2' : '1×1';
    const sizeToggle = el('button', {
      type: 'button',
      className: 'card-edit-btn site-size-toggle',
      disabled: !state.jiggleMode,
      'aria-pressed': pageTileSize === 'square' ? 'true' : 'false',
      'aria-label': `${site.title} 尺寸：当前 ${currentLabel}，切换为 ${nextLabel}`,
      title: `${site.title} · 当前 ${currentLabel}，点击切换为 ${nextLabel}`,
      dataset: { siteSizeCurrent: pageTileSize, siteSizeNext: nextSize },
      textContent: currentLabel,
    });
    sizeToggle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      clearActiveLongPress();
      gestureBlockBlankExit = true;
    });
    const applyToggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.jiggleMode) return;
      gestureBlockBlankExit = true;
      setSiteTileSize(site.id, nextSize);
    };
    sizeToggle.addEventListener('click', applyToggle);
    sizeToggle.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') applyToggle(e);
    });

    item.appendChild(sizeToggle);

    const hasSavedCell = Boolean(
      savedCell && Number.isInteger(savedCell.row) && Number.isInteger(savedCell.column)
    );
    applyFixedCellStyleToCard(item, fixedRect, { hasSavedCell });
  }

  item.addEventListener('click', (e) => {
    if (state.jiggleMode || !validHref) {
      e.preventDefault();
    }
  });

  delBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.jiggleMode) return;
    gestureBlockBlankExit = true;
    removeSiteById(site.id);
  });

  let lastSitePointerType = 'mouse';
  item.addEventListener(
    'pointerdown',
    (e) => {
      lastSitePointerType = e.pointerType || 'mouse';
    },
    { passive: true }
  );

  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (
      lastSitePointerType === 'touch' ||
      lastSitePointerType === 'pen' ||
      activeLongPressTimer !== null ||
      state.jiggleMode ||
      desktopPointerDragController?.isDragging?.() ||
      site.isUnresolvedPlaceholder
    ) {
      e.stopPropagation();
      return;
    }
    clearActiveLongPress();
    openContextMenu(e.clientX, e.clientY, site);
  });

  bindDesktopCardDragAndLongPress(item, {
    pageId: effectivePageId,
    viewId,
    folderId,
    kind: 'site',
    id: site.id,
  });

  return item;
}

function createFolderMiniGlyphNode(memberEntry) {
  const site = memberEntry?.site || null;
  const validSiteUrl = site?.url ? safeHttpUrl(site.url) : null;
  const mini = el('div', {
    className: `folder-mini-icon ${!site ? 'folder-mini-unresolved' : ''}`,
    dataset: {
      ...(site?.id ? { siteId: site.id } : {}),
      ...(validSiteUrl ? { siteUrl: validSiteUrl } : {}),
    },
  });
  if (site) {
    mini.style.setProperty('--app-gradient', safeGradient(site.gradient));
    mini.style.setProperty('--app-accent', safeHexColor(site.accent, '#5ac8fa'));
    const glyph = createGlyphNode(site);
    mini.appendChild(glyph);
  } else {
    const rawId = String(memberEntry?.siteId || '?').trim();
    mini.appendChild(
      el('span', {
        className: 'folder-mini-letter',
        textContent: rawId.charAt(0).toUpperCase() || '?',
      })
    );
  }
  return mini;
}

function createFolderItemElement(
  folderEntry,
  idx,
  { pageId = null, viewId = null, itemIndex = idx, totalItems = 1 } = {}
) {
  const folder = folderEntry?.folder || folderEntry;
  const effectivePageId = pageId || folderEntry?.pageId || state.pages[state.currentPageIndex]?.id || 'all';
  const siteMap = new Map(
    (Array.isArray(state.sites) ? state.sites : [])
      .filter((s) => s && s.id)
      .map((s) => [String(s.id), s])
  );
  const memberEntries =
    Array.isArray(folderEntry?.memberEntries) && folderEntry.memberEntries.length > 0
      ? folderEntry.memberEntries
      : (Array.isArray(folder?.siteIds) ? folder.siteIds : []).map((sId) => ({
          siteId: sId,
          site: siteMap.get(sId) || null,
        }));

  const count = Array.isArray(folder?.siteIds) ? folder.siteIds.length : memberEntries.length;
  const item = el('div', {
    className: 'app-item folder-item',
    tabIndex: 0,
    role: 'button',
    'aria-label': `${folder.title} 文件夹，共 ${count} 个网站，点击展开`,
    dataset: {
      id: folder.id,
      folderId: folder.id,
      placementKind: 'folder',
      placementId: folder.id,
      pageId: effectivePageId,
      ...(viewId ? { viewId } : {}),
    },
  });

  const randomDelay = ((idx % 7) * -0.045).toFixed(3);
  item.style.setProperty('--jiggle-delay', `${randomDelay}s`);

  const delBtn = el('button', {
    className: 'delete-badge folder-dissolve-badge',
    type: 'button',
    disabled: !state.jiggleMode,
    title: `解散文件夹「${folder.title}」（保留内部全部网站）`,
    'aria-label': `解散文件夹 ${folder.title}`,
  });

  delBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.jiggleMode) return;
    gestureBlockBlankExit = true;
    handleDissolveFolder(folder.id);
  });

  const squircle = el('div', { className: 'app-squircle folder-squircle' });
  const miniGrid = el('div', { className: 'folder-mini-grid' });
  memberEntries.slice(0, 4).forEach((member) => {
    miniGrid.appendChild(createFolderMiniGlyphNode(member));
  });
  squircle.appendChild(miniGrid);

  const countPill = el('span', {
    className: 'folder-count-pill',
    textContent: String(count),
  });
  squircle.appendChild(countPill);

  const labelSpan = el('span', {
    className: 'app-label folder-label',
    textContent: folder.title,
  });

  item.append(delBtn, squircle, labelSpan);

  item.addEventListener('click', (e) => {
    if (
      e.target.closest('.delete-badge, .card-edit-actions, .card-edit-btn')
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    openFolderDetailModal(folder.id, { pageId: effectivePageId, triggerEl: item });
  });

  item.addEventListener('keydown', (e) => {
    if (e.target !== item) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      openFolderDetailModal(folder.id, { pageId: effectivePageId, triggerEl: item });
    }
  });

  bindDesktopCardDragAndLongPress(item, {
    pageId: effectivePageId,
    viewId,
    kind: 'folder',
    id: folder.id,
  });

  return item;
}

function setWidgetSize(widgetId, nextSize) {
  if (!widgetId || state.navigationImportInProgress) return false;
  const currentLayout = Array.isArray(state.widgetState?.layout) ? state.widgetState.layout : [];
  const target = currentLayout.find((item) => item && item.id === widgetId);
  if (!target) return false;
  const supported = getSupportedSizesForWidgetType(target.type, state.widgetRegistry);
  const candidate = typeof nextSize === 'string' ? nextSize.trim().toLowerCase() : '';
  if (!supported.includes(candidate)) {
    return false;
  }
  const normalizedSize = normalizeWidgetSize(candidate, target.type, state.widgetRegistry);
  const currentSize = normalizeWidgetSize(target.size, target.type, state.widgetRegistry);
  if (currentSize === normalizedSize && target.size === normalizedSize) {
    return true;
  }
  const nextLayout = currentLayout.map((item) =>
    item && item.id === widgetId ? { ...item, size: normalizedSize } : item
  );
  commitDesktopAndLayout(getEffectiveDesktopForRender(), nextLayout);
  return true;
}

function syncWidgetSummaryScrollRegions(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.widget-summary-scroll').forEach((scrollEl) => {
    if (!scrollEl.hasAttribute('tabindex')) {
      scrollEl.setAttribute('tabindex', '0');
    }
    if (!scrollEl.hasAttribute('role')) {
      scrollEl.setAttribute('role', 'region');
    }
    if (!scrollEl.hasAttribute('aria-label')) {
      scrollEl.setAttribute('aria-label', '小组件内容滚动区域');
    }
    if (!scrollEl.dataset.summaryScrollBound) {
      scrollEl.dataset.summaryScrollBound = 'true';
      scrollEl.addEventListener(
        'wheel',
        (e) => {
          if (state.jiggleMode) return;
          e.stopPropagation();
        },
        { passive: true }
      );
      scrollEl.addEventListener('keydown', (e) => {
        if (state.jiggleMode) return;
        const step = 36;
        const pageStep = Math.max(48, Math.round((scrollEl.clientHeight || 80) * 0.8));
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          scrollEl.scrollTop += step;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          scrollEl.scrollTop -= step;
        } else if (e.key === 'PageDown') {
          e.preventDefault();
          e.stopPropagation();
          scrollEl.scrollTop += pageStep;
        } else if (e.key === 'PageUp') {
          e.preventDefault();
          e.stopPropagation();
          scrollEl.scrollTop -= pageStep;
        } else if (e.key === 'Home') {
          e.preventDefault();
          e.stopPropagation();
          scrollEl.scrollTop = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          e.stopPropagation();
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      });
    }
  });
}

let singleSizeSelectWatcherBound = false;
// Close any open 1×1 size picker portal and disable triggers when edit (jiggle) mode exits.
function ensureSingleSizeSelectEditExitWatcher() {
  if (singleSizeSelectWatcherBound || typeof MutationObserver !== 'function' || !document.body) return;
  singleSizeSelectWatcherBound = true;
  let wasJiggle = document.body.classList.contains('jiggle-mode');
  new MutationObserver(() => {
    const isJiggle = document.body.classList.contains('jiggle-mode');
    if (isJiggle === wasJiggle) return;
    wasJiggle = isJiggle;
    document.querySelectorAll('.widget-size-select-trigger').forEach((btn) => {
      btn.disabled = !isJiggle;
    });
    if (!isJiggle) {
      const hadFocusInPicker = document.activeElement?.closest?.('.widget-size-select, .ui-select-popover');
      closeAllPopovers();
      if (hadFocusInPicker) {
        hadFocusInPicker.closest?.('.ios-widget')?.focus?.({ preventScroll: true });
      }
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

function decorateWidgetCardForDesktop(
  root,
  widgetItem,
  { pageId, viewId = null, entry = null, fixedRect = null, itemIndex = 0, totalItems = 1 }
) {
  const def = state.widgetRegistry.find((d) => d.type === widgetItem.type);
  const title = getWidgetDisplayTitle(widgetItem);
  const supportedSizes = getSupportedSizesForWidgetType(widgetItem.type, state.widgetRegistry);
  const selectedSize = normalizeWidgetSize(widgetItem.size, widgetItem.type, state.widgetRegistry);
  const entryForMeasure =
    entry && entry.kind === 'widget' && entry.widget ? entry : { kind: 'widget', widget: widgetItem };
  const resolvedDisplaySize = resolveWidgetDisplaySize(entryForMeasure, state.singleScreenMetrics);
  const resolvedSpan = getWidgetGridSpan(entryForMeasure, state.singleScreenMetrics);
  const hasSavedCell = Boolean(
    entry?.cell && Number.isInteger(entry.cell.row) && Number.isInteger(entry.cell.column)
  );

  root._latestWidgetItem = widgetItem;
  root._latestWidgetEntry = entryForMeasure;
  root.setAttribute('data-widget-size', resolvedDisplaySize);
  root.setAttribute('data-widget-selected-size', selectedSize);
  root.dataset.widgetSize = resolvedDisplaySize;
  root.dataset.widgetSelectedSize = selectedSize;
  root.dataset.colSpan = String(resolvedSpan.colSpan);
  root.dataset.rowSpan = String(resolvedSpan.rowSpan);
  applyFixedCellStyleToCard(root, fixedRect, { hasSavedCell });

  const randomDelay = ((itemIndex % 5) * -0.05).toFixed(3);
  root.style.setProperty('--jiggle-delay', `${randomDelay}s`);
  root.setAttribute('tabindex', '0');
  root.setAttribute('role', 'button');
  root.setAttribute('aria-label', `${title} 小组件，点击查看完整详情`);

  const existingDel = root.querySelector(':scope > .delete-badge');
  if (existingDel) existingDel.remove();
  if (root._sizeSelect) {
    try {
      root._sizeSelect.destroy();
    } catch {
      // Ignore stale picker teardown errors
    }
    root._sizeSelect = null;
  }
  const existingBar = root.querySelector(':scope > .card-edit-actions');
  if (existingBar) existingBar.remove();

  const delBtn = el('button', {
    className: 'delete-badge widget-delete-badge',
    type: 'button',
    disabled: !state.jiggleMode,
    title: `移除 ${title} 小组件`,
    'aria-label': `移除 ${title} 小组件`,
  });
  delBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.jiggleMode) return;
    gestureBlockBlankExit = true;
    const latest = root._latestWidgetItem || widgetItem;
    removeWidgetFromDesktop(latest.id);
  });

  const sizeControls = el('div', {
    className: 'widget-size-controls',
    role: 'group',
    'aria-label': `${title} 尺寸选择`,
    dataset: {
      widgetId: widgetItem.id,
      selectedSize,
      displaySize: resolvedDisplaySize,
    },
  });

  for (const opt of resolvedDisplaySize === 'single' ? [] : WIDGET_SIZE_OPTIONS) {
    if (!supportedSizes.includes(opt.value)) continue;
    const isSelected = selectedSize === opt.value;
    const sizeBtn = el(
      'button',
      {
        type: 'button',
        className: `card-edit-btn widget-size-btn ${isSelected ? 'active is-selected' : ''}`,
        disabled: !state.jiggleMode,
        'aria-pressed': isSelected ? 'true' : 'false',
        'aria-label': `${title}切换为${opt.ariaLabel}`,
        title: `${title} · ${opt.ariaLabel}`,
        dataset: {
          widgetSizeOption: opt.value,
          size: opt.value,
          widgetId: widgetItem.id,
        },
      },
      el('span', { className: 'widget-size-btn-label', textContent: opt.label }),
      el('span', { className: 'widget-size-btn-spec', textContent: opt.shortLabel })
    );

    sizeBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      clearActiveLongPress();
      gestureBlockBlankExit = true;
    });

    sizeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.jiggleMode) return;
      gestureBlockBlankExit = true;
      const latest = root._latestWidgetItem || widgetItem;
      setWidgetSize(latest.id, opt.value);
    });

    sizeBtn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!state.jiggleMode) return;
        gestureBlockBlankExit = true;
        const latest = root._latestWidgetItem || widgetItem;
        setWidgetSize(latest.id, opt.value);
      }
    });

    sizeControls.appendChild(sizeBtn);
  }

  // 1×1 cards (~43–50px) cannot fit a row of size chips: use a compact anchored-portal select instead.
  if (resolvedDisplaySize === 'single') {
    const sizeOptions = WIDGET_SIZE_OPTIONS.filter((opt) => supportedSizes.includes(opt.value)).map(
      (opt) => ({ value: opt.value, label: `${opt.shortLabel} ${opt.label}` })
    );
    const sizeSelect = createSelect({
      options: sizeOptions,
      value: selectedSize,
      compact: true,
      ariaLabel: `${title} 尺寸选择`,
      onChange: (nextSize) => {
        const latest = root._latestWidgetItem || widgetItem;
        const currentSaved = normalizeWidgetSize(latest.size, latest.type, state.widgetRegistry);
        if (!state.jiggleMode) {
          sizeSelect.setValue(currentSaved);
          return;
        }
        gestureBlockBlankExit = true;
        if (!setWidgetSize(latest.id, nextSize)) {
          sizeSelect.setValue(currentSaved);
        }
      },
    });
    sizeSelect.root.classList.add('widget-size-select');
    sizeSelect.triggerBtn.classList.add('widget-size-select-trigger');
    sizeSelect.triggerBtn.disabled = !state.jiggleMode;
    sizeSelect.triggerBtn.title = `${title} · 尺寸`;
    // Never open outside edit mode (covers stale enabled state between renders)
    sizeSelect.root.addEventListener(
      'click',
      (e) => {
        if (!state.jiggleMode) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
    sizeControls.appendChild(sizeSelect.root);
    root._sizeSelect = sizeSelect;
    ensureSingleSizeSelectEditExitWatcher();
  }

  if (sizeControls.childElementCount > 0) {
    const editActionsBar = el(
      'div',
      {
        className: 'card-edit-actions widget-card-edit-actions',
        role: 'toolbar',
        'aria-label': `${title} 编辑操作`,
      },
      sizeControls
    );

    editActionsBar.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      clearActiveLongPress();
      gestureBlockBlankExit = true;
    });

    editActionsBar.addEventListener('click', (e) => {
      e.stopPropagation();
      gestureBlockBlankExit = true;
    });

    root.prepend(delBtn, editActionsBar);
  } else {
    root.prepend(delBtn);
  }
  syncWidgetSummaryScrollRegions(root);

  // Shield internal widget forms/links/buttons from interfering when in edit mode,
  // and open detail modal when clicking/pressing Enter on summary widget in normal mode
  if (!root.dataset.editShieldBound) {
    root.dataset.editShieldBound = 'true';
    let scrollPointerStart = null;
    let scrollMoved = false;
    let suppressDetailOpenUntil = 0;

    root.addEventListener(
      'pointerdown',
      (e) => {
        if (state.jiggleMode) return;
        const scrollZone = e.target.closest?.('.widget-summary-scroll, [data-widget-horizontal-scroll]');
        if (!scrollZone) {
          scrollPointerStart = null;
          scrollMoved = false;
          return;
        }
        scrollPointerStart = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          scrollTop: scrollZone.scrollTop,
          scrollLeft: scrollZone.scrollLeft,
          scrollZone,
        };
        scrollMoved = false;
      },
      true
    );

    root.addEventListener(
      'pointermove',
      (e) => {
        if (!scrollPointerStart || e.pointerId !== scrollPointerStart.pointerId) return;
        const dist = Math.hypot(
          e.clientX - scrollPointerStart.x,
          e.clientY - scrollPointerStart.y
        );
        const scrollDelta =
          Math.abs((scrollPointerStart.scrollZone?.scrollTop || 0) - scrollPointerStart.scrollTop) +
          Math.abs((scrollPointerStart.scrollZone?.scrollLeft || 0) - scrollPointerStart.scrollLeft);
        if (dist >= 6 || scrollDelta >= 2) {
          scrollMoved = true;
          suppressDetailOpenUntil = performance.now() + 360;
          clearActiveLongPress();
        }
      },
      { capture: true, passive: true }
    );

    root.addEventListener(
      'scroll',
      (e) => {
        if (
          e.target &&
          (e.target.classList?.contains('widget-summary-scroll') ||
            e.target.hasAttribute?.('data-widget-horizontal-scroll'))
        ) {
          scrollMoved = true;
          suppressDetailOpenUntil = performance.now() + 360;
          clearActiveLongPress();
        }
      },
      true
    );

    const shieldEventInEditMode = (e) => {
      if (!state.jiggleMode) return;
      if (
        e.target.closest(
          '.delete-badge, .card-edit-actions, .card-edit-btn, .widget-size-controls, .widget-size-btn'
        )
      ) {
        return;
      }
      if (e.target.closest('.widget-inner, .widget-compact-summary')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    root.addEventListener('click', shieldEventInEditMode, true);
    root.addEventListener('submit', shieldEventInEditMode, true);

    root.addEventListener('click', (e) => {
      if (state.jiggleMode) return;
      if (root.classList.contains('widget-in-detail-modal')) return;
      if (
        e.target.closest(
          '.delete-badge, .card-edit-actions, .card-edit-btn, .widget-size-controls, .widget-size-btn, .move-page-popover'
        )
      ) {
        return;
      }
      if (scrollMoved || (suppressDetailOpenUntil > 0 && performance.now() < suppressDetailOpenUntil)) {
        scrollMoved = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target.closest('.widget-summary-scroll, [data-widget-horizontal-scroll]')) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      openWidgetDetailModal(root, root._latestWidgetItem || widgetItem);
    });

    root.addEventListener('keydown', (e) => {
      if (state.jiggleMode) return;
      if (root.classList.contains('widget-in-detail-modal')) return;
      if (e.target !== root) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        openWidgetDetailModal(root, root._latestWidgetItem || widgetItem);
      }
    });

    bindDesktopCardDragAndLongPress(root, {
      pageId,
      viewId,
      kind: 'widget',
      id: widgetItem.id,
    });
  } else {
    root.dataset.pageId = pageId;
    if (viewId) {
      root.dataset.viewId = viewId;
    } else {
      delete root.dataset.viewId;
    }
    root.draggable = Boolean(state.jiggleMode);
  }
}

function ensureOverflowWidgetParkingHost() {
  if (typeof document === 'undefined' || !document.body) return null;
  let host = document.getElementById('widgetOverflowParkingHost');
  if (!host) {
    host = el('div', {
      id: 'widgetOverflowParkingHost',
      className: 'widget-overflow-parking-host',
      hidden: true,
      'aria-hidden': 'true',
    });
    document.body.appendChild(host);
  }
  return host;
}

function renderSpringBoardTrack({ preserveCategoryPageId = null } = {}) {
  const track = document.getElementById('springboardTrack');
  if (!track) return;
  desktopPointerDragController?.cancelDrag?.();
  closeMovePagePopover();
  if (activeWidgetDetailRestore || state.activeWidgetDetailId) {
    closeWidgetDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
  }

  const savedScroll = getCurrentScrollOffsets();
  const prevHeight = Math.round(track.getBoundingClientRect().height || track.offsetHeight || 0);
  if (prevHeight > 0) {
    track.style.minHeight = `${prevHeight}px`;
  }

  const prevView = state.screenViews[state.currentViewIndex] || null;
  const targetCategoryPageId =
    preserveCategoryPageId ||
    prevView?.pageId ||
    state.pages[state.currentPageIndex]?.id ||
    'all';
  const prevSubViewIndex = preserveCategoryPageId ? 0 : prevView?.subViewIndex || 0;

  clearElement(track);

  const effectiveDesktop = getEffectiveDesktopForRender();
  const activeMountedWidgetIds = new Set();

  const { views } = buildScreenViewsModel({
    pages: state.pages,
    metrics: state.singleScreenMetrics,
    getRenderableItemsForPage: (pageId) =>
      getRenderablePageItems({
        desktop: effectiveDesktop,
        pageId,
        sites: state.sites,
        layout: state.widgetState.layout,
      }),
  });

  state.screenViews = views;

  // Resolve currentViewIndex & currentPageIndex while preserving current category
  let resolvedViewIdx = views.findIndex(
    (v) => v.pageId === targetCategoryPageId && v.subViewIndex === prevSubViewIndex
  );
  if (resolvedViewIdx === -1) {
    resolvedViewIdx = views.findIndex((v) => v.pageId === targetCategoryPageId);
  }
  if (resolvedViewIdx === -1) {
    resolvedViewIdx = Math.min(Math.max(0, state.currentViewIndex), Math.max(0, views.length - 1));
  }
  state.currentViewIndex = Math.max(0, resolvedViewIdx);
  const activeView = views[state.currentViewIndex];
  if (activeView) {
    state.currentPageIndex = activeView.categoryIndex;
  }

  views.forEach((view, viewIdx) => {
    const page = state.pages[view.categoryIndex] || {
      id: view.pageId,
      title: view.pageTitle,
      isSystem: true,
    };
    const pageEl = el('section', {
      className: `springboard-page ${viewIdx === state.currentViewIndex ? 'page-active' : ''}`,
      dataset: {
        pageId: page.id,
        viewId: view.viewId,
        pageIndex: view.categoryIndex,
        viewIndex: viewIdx,
        subViewIndex: view.subViewIndex,
        subViewCount: view.subViewCount,
      },
    });

    const totalCategoryItems = view.allCategoryItems.length;
    const hasSubViews = view.subViewCount > 1;
    const hasOverflow = Array.isArray(view.overflowItems) && view.overflowItems.length > 0;

    if (page.id !== 'all' || hasSubViews || hasOverflow) {
      const syncTag = page.isSystem ? '自动同步' : '桌面混排';
      const subViewLabel = hasSubViews ? ` · 分屏 ${view.subViewIndex + 1}/${view.subViewCount}` : '';
      const headerRight = el('div', { className: 'page-header-actions' });

      if (hasOverflow) {
        const viewAllBtn = el('button', {
          type: 'button',
          className: 'page-overflow-view-all-btn',
          textContent: `查看全部 (${totalCategoryItems} 项，超出 ${view.overflowItems.length} 项)`,
        });
        viewAllBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openCategoryOverflowModal(page, view.allCategoryItems);
        });
        headerRight.appendChild(viewAllBtn);
      }

      const header = el(
        'div',
        { className: 'page-section-header' },
        el(
          'div',
          { className: 'page-section-title' },
          el('span', { textContent: page.title }),
          el('span', {
            className: 'page-count-badge',
            textContent: `${totalCategoryItems} 项内容 · ${syncTag}${subViewLabel}`,
          })
        ),
        headerRight
      );
      pageEl.appendChild(header);
    }

    const grid = el('div', {
      className: 'apps-grid desktop-mixed-grid',
      dataset: {
        pageId: page.id,
        viewId: view.viewId,
      },
    });

    if (view.items.length === 0) {
      const emptyDropzone = el(
        'div',
        {
          className: 'empty-page-dropzone',
          dataset: {
            pageId: page.id,
            viewId: view.viewId,
          },
        },
        el('span', {
          className: 'empty-page-dropzone-title',
          textContent: '此导航页暂无卡片',
        }),
        el('span', {
          className: 'empty-page-dropzone-sub',
          textContent: '编辑模式下可将网站或小组件拖入此页，或点击顶部「添加」',
        })
      );
      grid.appendChild(emptyDropzone);
    } else {
      const viewFixedCells =
        view.fixedCells instanceof Map
          ? view.fixedCells
          : view.subViewIndex === 0 && typeof getFixedCellsForPage === 'function'
            ? getFixedCellsForPage(view.items, state.singleScreenMetrics)
            : new Map();
      view.items.forEach((entry, idx) => {
        const categoryItemIndex = view.allCategoryItems.indexOf(entry);
        const effectiveIdx = categoryItemIndex !== -1 ? categoryItemIndex : idx;
        const fixedKey = `${entry.kind}:${entry.id}`;
        const fixedRect = viewFixedCells instanceof Map ? viewFixedCells.get(fixedKey) || null : null;
        if (entry.kind === 'site') {
          grid.appendChild(
            createAppItemElement(entry.site, effectiveIdx, {
              pageId: page.id,
              viewId: view.viewId,
              itemIndex: effectiveIdx,
              totalItems: totalCategoryItems,
              allowSizing: true,
              fixedRect,
              savedCell: entry.cell || null,
            })
          );
        } else if (entry.kind === 'folder') {
          grid.appendChild(
            createFolderItemElement(entry, effectiveIdx, {
              pageId: page.id,
              viewId: view.viewId,
              itemIndex: effectiveIdx,
              totalItems: totalCategoryItems,
            })
          );
        } else if (entry.kind === 'widget') {
          activeMountedWidgetIds.add(entry.widget.id);
          widgetHost.mountWidget(grid, entry.widget, {
            reuseExisting: true,
            afterMount: (root, widgetItem) => {
              decorateWidgetCardForDesktop(root, widgetItem, {
                pageId: page.id,
                viewId: view.viewId,
                entry,
                fixedRect,
                itemIndex: effectiveIdx,
                totalItems: totalCategoryItems,
              });
            },
          });
        }
      });
    }

    const handlePageGridDragOver = (e) => {
      if (!state.jiggleMode) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      grid.classList.add('drag-target-active');
    };

    const handlePageGridDragLeave = (e) => {
      if (!grid.contains(e.relatedTarget)) {
        grid.classList.remove('drag-target-active');
      }
    };

    const handlePageGridDrop = (e) => {
      if (!state.jiggleMode) return;
      if (e.target.closest('.app-item, .ios-widget')) return;
      e.preventDefault();
      e.stopPropagation();
      grid.classList.remove('drag-target-active');
      gestureBlockBlankExit = true;

      const dragged =
        state.draggedItem ||
        (state.draggedSiteId ? { kind: 'site', id: state.draggedSiteId, fromPageId: page.id } : null);
      if (!dragged) return;
      state.draggedItem = null;
      state.draggedSiteId = null;

      const resolved = resolveViewDropBeforeAnchor({
        views: state.screenViews,
        targetViewId: view.viewId,
        targetPageId: page.id,
        draggedKind: dragged.kind,
        draggedId: dragged.id,
      });

      commitDesktopItemBefore({
        fromPageId: dragged.fromPageId || page.id,
        toPageId: resolved.toPageId,
        kind: dragged.kind,
        id: dragged.id,
        beforeKind: resolved.beforeKind,
        beforeId: resolved.beforeId,
      });
    };

    grid.addEventListener('dragover', handlePageGridDragOver);
    grid.addEventListener('dragleave', handlePageGridDragLeave);
    grid.addEventListener('drop', handlePageGridDrop);

    pageEl.appendChild(grid);
    track.appendChild(pageEl);
  });

  // Also ensure any overflow widgets in compact mode are genuinely mounted in a hidden parking host
  // so their live DOM/timers/notes remain unique, preserved across mode switches, and openable in the detail modal.
  const parkingHost = ensureOverflowWidgetParkingHost();
  if (parkingHost) {
    clearElement(parkingHost);
    views.forEach((view) => {
      if (Array.isArray(view.overflowItems) && view.overflowItems.length > 0) {
        const totalCategoryItems = view.allCategoryItems.length;
        view.overflowItems.forEach((entry) => {
          if (entry.kind === 'widget' && entry.widget?.id) {
            activeMountedWidgetIds.add(entry.widget.id);
            const categoryItemIndex = view.allCategoryItems.indexOf(entry);
            const effectiveIdx = categoryItemIndex !== -1 ? categoryItemIndex : 0;
            widgetHost.mountWidget(parkingHost, entry.widget, {
              reuseExisting: true,
              afterMount: (root, widgetItem) => {
                decorateWidgetCardForDesktop(root, widgetItem, {
                  pageId: view.pageId,
                  viewId: view.viewId,
                  entry,
                  itemIndex: effectiveIdx,
                  totalItems: totalCategoryItems,
                });
              },
            });
          }
        });
      }
    });
  }

  widgetHost.pruneUnmounted?.(activeMountedWidgetIds);
  track.style.minHeight = '';
  restoreClampedScrollOffsets(savedScroll);
}

// ==========================================================================
// Blank Click to Exit Jiggle Mode
// ==========================================================================
function isExcludedFromBlankExit(target) {
  if (!target || typeof target.closest !== 'function') return true;
  return Boolean(target.closest(BLANK_EXIT_EXCLUDED_SELECTOR));
}

function initBlankClickExitJiggleMode() {
  let pointerStart = null;

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    gestureBlockBlankExit = false;
    if (!state.jiggleMode || isExcludedFromBlankExit(e.target)) {
      pointerStart = null;
      return;
    }
    pointerStart = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    };
  });

  document.addEventListener(
    'pointermove',
    (e) => {
      if (!pointerStart || e.pointerId !== pointerStart.pointerId) return;
      if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) >= 8) {
        gestureBlockBlankExit = true;
        pointerStart = null;
      }
    },
    { passive: true }
  );

  document.addEventListener('pointercancel', () => {
    gestureBlockBlankExit = true;
    pointerStart = null;
  });

  document.addEventListener('click', (e) => {
    if (!state.jiggleMode) return;
    if (gestureBlockBlankExit) {
      gestureBlockBlankExit = false;
      pointerStart = null;
      return;
    }
    if (isExcludedFromBlankExit(e.target)) {
      pointerStart = null;
      return;
    }
    pointerStart = null;
    setJiggleMode(false);
  });
}

// ==========================================================================
// Spring Physics Page-Turn Animation & Unified Pointer Gestures
// ==========================================================================
function scrollActivePageTabHorizontally(activeIndex = state.currentPageIndex) {
  const tabsContainer = document.getElementById('categoryTabs');
  if (!tabsContainer || tabsContainer.scrollWidth <= tabsContainer.clientWidth) return;
  const activePill = tabsContainer.querySelectorAll('.category-pill')[activeIndex];
  if (!activePill) return;
  const targetLeft =
    activePill.offsetLeft - (tabsContainer.clientWidth - activePill.offsetWidth) / 2;
  const maxLeft = Math.max(0, tabsContainer.scrollWidth - tabsContainer.clientWidth);
  const clampedLeft = Math.min(maxLeft, Math.max(0, Math.round(targetLeft)));
  if (Math.abs(tabsContainer.scrollLeft - clampedLeft) >= 1) {
    tabsContainer.scrollLeft = clampedLeft;
  }
}

function goToView(targetViewIndex) {
  const totalViews = state.screenViews.length || 1;
  const maxViewIdx = Math.max(0, totalViews - 1);
  const clampedViewIdx = Math.min(maxViewIdx, Math.max(0, targetViewIndex));
  const targetView = state.screenViews[clampedViewIdx];
  const nextCategoryIdx =
    targetView && typeof targetView.categoryIndex === 'number'
      ? targetView.categoryIndex
      : Math.min(Math.max(0, state.currentPageIndex), Math.max(0, state.pages.length - 1));
  const categoryChanged = state.currentPageIndex !== nextCategoryIdx;
  state.currentViewIndex = clampedViewIdx;
  state.currentPageIndex = nextCategoryIdx;
  updatePageTurnTransform();
  if (categoryChanged) {
    scrollActivePageTabHorizontally(nextCategoryIdx);
  }
}

function goToPage(targetIndex) {
  const maxIndex = Math.max(0, state.pages.length - 1);
  const clamped = Math.min(maxIndex, Math.max(0, targetIndex));
  const changed = state.currentPageIndex !== clamped;
  state.currentPageIndex = clamped;
  const firstViewIdx = state.screenViews.findIndex((v) => v.categoryIndex === clamped);
  if (firstViewIdx !== -1) {
    state.currentViewIndex = firstViewIdx;
  } else {
    state.currentViewIndex = Math.min(clamped, Math.max(0, state.screenViews.length - 1));
  }
  updatePageTurnTransform();
  if (changed) {
    scrollActivePageTabHorizontally(clamped);
  }
}

function updatePageTurnTransform(dragOffsetPx = 0) {
  const track = document.getElementById('springboardTrack');
  if (!track) return;

  const activeViewIdx = Math.min(
    Math.max(0, state.currentViewIndex),
    Math.max(0, (state.screenViews.length || state.pages.length) - 1)
  );
  const activeView = state.screenViews[activeViewIdx];
  if (activeView && typeof activeView.categoryIndex === 'number') {
    state.currentPageIndex = activeView.categoryIndex;
  }

  track.style.setProperty('--page-index', activeViewIdx);
  track.style.setProperty('--drag-offset', `${dragOffsetPx}px`);

  track.querySelectorAll('.springboard-page').forEach((pageEl, idx) => {
    pageEl.classList.toggle('page-active', idx === activeViewIdx);
  });

  const tabsContainer = document.getElementById('categoryTabs');
  if (tabsContainer) {
    tabsContainer.querySelectorAll('.category-pill').forEach((pill, idx) => {
      const isActive = idx === state.currentPageIndex;
      pill.classList.toggle('active', isActive);
    });
  }

  const dotsContainer = document.getElementById('paginationDots');
  if (dotsContainer) {
    dotsContainer.querySelectorAll('.page-dot').forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeViewIdx);
    });
  }

  const totalViews = state.screenViews.length || state.pages.length;
  const prevBtn = document.getElementById('prevPageArrow');
  const nextBtn = document.getElementById('nextPageArrow');
  if (prevBtn) prevBtn.disabled = activeViewIdx <= 0;
  if (nextBtn) nextBtn.disabled = activeViewIdx >= totalViews - 1;
}

function initPageTurnControls() {
  const prevBtn = document.getElementById('prevPageArrow');
  const nextBtn = document.getElementById('nextPageArrow');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => goToView(state.currentViewIndex - 1));
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => goToView(state.currentViewIndex + 1));
  }

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (
      !document.getElementById('widgetDetailModal')?.hidden ||
      !document.getElementById('categoryOverflowModal')?.hidden
    ) {
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goToView(state.currentViewIndex - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goToView(state.currentViewIndex + 1);
    }
  });
}

function initSwipePageTurnGestures() {
  const stage = document.getElementById('springboardStage');
  const viewport = document.getElementById('springboardViewport');
  const track = document.getElementById('springboardTrack');
  if (!viewport || !track) return;
  const gestureSurface = stage || viewport;

  const DRAG_RECOGNITION_PX = 8;
  const activePointers = new Set();
  let trackedPointerId = null;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let deltaX = 0;
  let gestureMode = null;
  let hasPointerCapture = false;
  let suppressNextClick = false;
  let suppressClickUntil = 0;

  gestureSurface.addEventListener(
    'click',
    (e) => {
      if (suppressNextClick && performance.now() < suppressClickUntil) {
        suppressNextClick = false;
        suppressClickUntil = 0;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      } else {
        suppressNextClick = false;
      }
    },
    true
  );

  function endGesture(shouldCommit) {
    if (trackedPointerId === null) return;
    const endedPointerId = trackedPointerId;
    const wasHorizontal = gestureMode === 'horizontal';
    const finalDeltaX = deltaX;
    const elapsed = Math.max(1, performance.now() - startTime);

    trackedPointerId = null;
    gestureMode = null;
    deltaX = 0;
    track.classList.remove('is-dragging');
    viewport.classList.remove('is-page-dragging');

    if (hasPointerCapture && endedPointerId !== null) {
      hasPointerCapture = false;
      try {
        if (gestureSurface.hasPointerCapture(endedPointerId)) {
          gestureSurface.releasePointerCapture(endedPointerId);
        }
      } catch {
        // Ignore
      }
    }

    if (!wasHorizontal) {
      return;
    }

    if (!shouldCommit) {
      updatePageTurnTransform(0);
      return;
    }

    suppressNextClick = true;
    suppressClickUntil = performance.now() + 380;

    const totalViews = state.screenViews.length || state.pages.length;
    const velocity = finalDeltaX / elapsed;
    const threshold = Math.max(36, (viewport.clientWidth || 320) * 0.14);

    if (
      (finalDeltaX < -threshold || velocity < -0.38) &&
      state.currentViewIndex < totalViews - 1
    ) {
      goToView(state.currentViewIndex + 1);
    } else if (
      (finalDeltaX > threshold || velocity > 0.38) &&
      state.currentViewIndex > 0
    ) {
      goToView(state.currentViewIndex - 1);
    } else {
      updatePageTurnTransform(0);
    }
  }

  cancelActivePageDrag = () => {
    activePointers.clear();
    endGesture(false);
  };

  gestureSurface.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    activePointers.add(e.pointerId);
    if (activePointers.size > 1) {
      clearActiveLongPress();
      endGesture(false);
      return;
    }

    if (state.jiggleMode) return;

    // Allow dragging from .page-nav-arrow and side stage gutters, as well as cards and grid background!
    // Exclude interactive form inputs, popovers, pagination dots, and card edit buttons.
    if (
      e.target.closest(
        'input, textarea, select, label, .ui-popover-portal, .ui-select-wrap, .ui-datetime-field, .ui-switch-wrap, .ui-checkbox-wrap, .delete-badge, .card-edit-actions, .widget-summary-scroll, [data-widget-horizontal-scroll], .springboard-pagination-wrap, .page-overflow-view-all-btn'
      )
    ) {
      return;
    }

    const bento = e.target.closest('.widgets-bento');
    if (bento && bento.scrollWidth > bento.clientWidth + 4) {
      return;
    }

    trackedPointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startTime = performance.now();
    deltaX = 0;
    gestureMode = null;
    hasPointerCapture = false;
  });

  gestureSurface.addEventListener('pointermove', (e) => {
    if (e.pointerId !== trackedPointerId) return;
    if (state.jiggleMode || activePointers.size > 1) {
      endGesture(false);
      return;
    }

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dist = Math.hypot(dx, dy);

    if (dist >= DRAG_RECOGNITION_PX) {
      clearActiveLongPress();
    }

    if (gestureMode === null) {
      if (Math.abs(dx) >= DRAG_RECOGNITION_PX && Math.abs(dx) > Math.abs(dy) * 1.1) {
        gestureMode = 'horizontal';
        track.classList.add('is-dragging');
        viewport.classList.add('is-page-dragging');
        try {
          gestureSurface.setPointerCapture(e.pointerId);
          hasPointerCapture = true;
        } catch {
          hasPointerCapture = false;
        }
      } else if (Math.abs(dy) >= DRAG_RECOGNITION_PX) {
        gestureMode = 'vertical';
        endGesture(false);
        return;
      } else {
        return;
      }
    }

    if (gestureMode !== 'horizontal') return;

    if (e.cancelable) {
      e.preventDefault();
    }

    const totalViews = state.screenViews.length || state.pages.length;
    const atFirst = state.currentViewIndex === 0 && dx > 0;
    const atLast = state.currentViewIndex >= totalViews - 1 && dx < 0;
    deltaX = atFirst || atLast ? dx * 0.32 : dx;

    updatePageTurnTransform(deltaX);
  });

  gestureSurface.addEventListener('pointerup', (e) => {
    activePointers.delete(e.pointerId);
    if (e.pointerId !== trackedPointerId) return;
    endGesture(true);
  });

  gestureSurface.addEventListener('pointercancel', (e) => {
    activePointers.delete(e.pointerId);
    if (e.pointerId !== trackedPointerId) return;
    clearActiveLongPress();
    endGesture(false);
  });

  gestureSurface.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId !== trackedPointerId) return;
    // Ignore bubbled lostpointercapture from a touched child when capture was transferred to gestureSurface
    if (e.target && e.target !== gestureSurface) return;
    try {
      if (
        typeof gestureSurface.hasPointerCapture === 'function' &&
        gestureSurface.hasPointerCapture(e.pointerId)
      ) {
        return;
      }
    } catch {
      // Ignore
    }
    activePointers.delete(e.pointerId);
    clearActiveLongPress();
    endGesture(false);
  });

  // Also allow desktop horizontal drag starting from the left/right window margins outside .springboard-shell
  // within the vertical range of the stage (without hijacking inputs, modals, customize sheet, or dock).
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (state.jiggleMode || trackedPointerId !== null) return;
      const target = e.target;
      if (target && typeof gestureSurface.contains === 'function' && gestureSurface.contains(target)) {
        return;
      }
      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest(
          '.ios-status-bar, .spotlight-section, .springboard-pagination-wrap, .ios-dock-container, .customize-sheet, .modal-backdrop, .haptic-context-menu, .move-page-popover, .ui-popover-portal, [data-widget-horizontal-scroll], input, textarea, select, button, a, label'
        )
      ) {
        return;
      }
      if (typeof gestureSurface.getBoundingClientRect === 'function') {
        const rect = gestureSurface.getBoundingClientRect();
        if (rect.height > 0 && (e.clientY < rect.top - 8 || e.clientY > rect.bottom + 8)) {
          return;
        }
      }
      activePointers.add(e.pointerId);
      if (activePointers.size > 1) {
        clearActiveLongPress();
        endGesture(false);
        return;
      }
      trackedPointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startTime = performance.now();
      deltaX = 0;
      gestureMode = null;
      hasPointerCapture = false;
    });

    document.addEventListener('pointermove', (e) => {
      if (e.pointerId !== trackedPointerId || hasPointerCapture) return;
      if (state.jiggleMode || activePointers.size > 1) {
        endGesture(false);
        return;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (gestureMode === null) {
        if (Math.abs(dx) >= DRAG_RECOGNITION_PX && Math.abs(dx) > Math.abs(dy) * 1.1) {
          gestureMode = 'horizontal';
          track.classList.add('is-dragging');
          viewport.classList.add('is-page-dragging');
          try {
            gestureSurface.setPointerCapture(e.pointerId);
            hasPointerCapture = true;
          } catch {
            hasPointerCapture = false;
          }
        } else if (Math.abs(dy) >= DRAG_RECOGNITION_PX) {
          gestureMode = 'vertical';
          endGesture(false);
          return;
        } else {
          return;
        }
      }
      if (gestureMode !== 'horizontal') return;
      if (e.cancelable) e.preventDefault();
      const totalViews = state.screenViews.length || state.pages.length;
      const atFirst = state.currentViewIndex === 0 && dx > 0;
      const atLast = state.currentViewIndex >= totalViews - 1 && dx < 0;
      deltaX = atFirst || atLast ? dx * 0.32 : dx;
      updatePageTurnTransform(deltaX);
    });

    document.addEventListener('pointerup', (e) => {
      activePointers.delete(e.pointerId);
      if (e.pointerId !== trackedPointerId) return;
      endGesture(true);
    });

    document.addEventListener('pointercancel', (e) => {
      activePointers.delete(e.pointerId);
      if (e.pointerId !== trackedPointerId) return;
      clearActiveLongPress();
      endGesture(false);
    });
  }

  window.addEventListener('blur', () => {
    clearActiveLongPress();
    activePointers.clear();
    endGesture(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearActiveLongPress();
      activePointers.clear();
      endGesture(false);
    }
  });

  let wheelCooldown = false;
  gestureSurface.addEventListener(
    'wheel',
    (e) => {
      if (wheelCooldown) return;
      if (e.target.closest('.widgets-bento, .widget-summary-scroll, [data-widget-horizontal-scroll]')) return;
      if (Math.abs(e.deltaX) > 32 && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.35) {
        wheelCooldown = true;
        if (e.deltaX > 0) {
          goToView(state.currentViewIndex + 1);
        } else {
          goToView(state.currentViewIndex - 1);
        }
        setTimeout(() => {
          wheelCooldown = false;
        }, 480);
      }
    },
    { passive: true }
  );
}

// ==========================================================================
// Render Dock & Pagination Dots (Strictly XSS-Safe DOM Construction)
// ==========================================================================
let dockOverflowController = null;
let disposeDockMagnification = null;

function renderDock() {
  const dock = document.getElementById('iosDock');
  if (!dock) return;

  const prevSitesTrack = dock.querySelector('.dock-sites-strip');
  const prevScrollLeft = prevSitesTrack
    ? Number(prevSitesTrack.scrollLeft) || 0
    : Number(dock.scrollLeft) || 0;

  dockOverflowController?.destroy?.();
  dockOverflowController = null;
  disposeDockMagnification?.();

  const pinnedSites = (Array.isArray(state.sites) ? state.sites : []).filter(
    (s) => s && s.pinned
  );
  clearElement(dock);
  dock.classList.toggle('has-pinned-sites', pinnedSites.length > 0);

  let sitesStrip = null;
  if (pinnedSites.length > 0) {
    sitesStrip = el('div', {
      className: 'dock-sites-strip',
      id: 'dockSitesStrip',
      role: 'region',
      'aria-label': `固定网站（共 ${pinnedSites.length} 项）`,
    });

    pinnedSites.forEach((site) => {
      const validHref = safeHttpUrl(site.url);
      const link = el('a', {
        className: 'dock-item dock-site-item',
        href: validHref || '#',
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': site.title,
        dataset: {
          siteId: site.id,
        },
      });

      const tooltip = el('span', { className: 'dock-tooltip', textContent: site.title });
      const squircle = el('div', { className: 'app-squircle' });
      squircle.style.setProperty('--app-gradient', safeGradient(site.gradient));
      squircle.style.setProperty('--app-accent', safeHexColor(site.accent, '#5ac8fa'));
      squircle.appendChild(createGlyphNode(site));

      link.append(tooltip, squircle);
      link.addEventListener('click', (e) => {
        if (!validHref) e.preventDefault();
      });
      link.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, site);
      });
      sitesStrip.appendChild(link);
    });

    dock.appendChild(sitesStrip);
    dock.appendChild(el('div', { className: 'dock-divider', 'aria-hidden': 'true' }));
  }

  const fixedActions = el('div', {
    className: 'dock-fixed-actions',
    role: 'group',
    'aria-label': '程序坞快捷操作',
  });

  const addSiteDockBtn = el('button', {
    type: 'button',
    className: 'dock-item dock-action-btn',
    'aria-label': '添加网页',
  });
  addSiteDockBtn.style.background = 'transparent';
  addSiteDockBtn.style.border = 'none';
  const addSiteSq = el('div', { className: 'app-squircle' });
  addSiteSq.style.setProperty('--app-gradient', 'linear-gradient(145deg, #0a84ff 0%, #30d158 100%)');
  addSiteSq.style.setProperty('--app-accent', '#30d158');
  const addSiteGlyph = el('div', { className: 'app-glyph' });
  addSiteGlyph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>`;
  addSiteSq.appendChild(addSiteGlyph);
  addSiteDockBtn.append(el('span', { className: 'dock-tooltip', textContent: '添加网页' }), addSiteSq);
  addSiteDockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    gestureBlockBlankExit = true;
    const currentPage = state.pages[state.currentPageIndex];
    const defaultPageId = currentPage ? currentPage.id : 'all';
    openAddSiteModalForPage(defaultPageId, 'site');
  });
  fixedActions.appendChild(addSiteDockBtn);

  const customLauncher = el('button', {
    type: 'button',
    className: 'dock-item dock-action-btn',
    'aria-label': '外观自定义',
  });
  customLauncher.style.background = 'transparent';
  customLauncher.style.border = 'none';
  const customSq = el('div', { className: 'app-squircle' });
  customSq.style.setProperty('--app-gradient', 'linear-gradient(145deg, #5e5ce6 0%, #bf5af2 52%, #ff375f 100%)');
  customSq.style.setProperty('--app-accent', '#bf5af2');
  const customGlyph = el('div', { className: 'app-glyph' });
  customGlyph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
  customSq.appendChild(customGlyph);
  customLauncher.append(el('span', { className: 'dock-tooltip', textContent: '外观自定义' }), customSq);
  customLauncher.addEventListener('click', () => toggleCustomizeSheet());
  fixedActions.appendChild(customLauncher);

  dock.appendChild(fixedActions);

  if (sitesStrip) {
    dockOverflowController = createDockOverflowController({
      dockEl: dock,
      scrollEl: sitesStrip,
      initialScrollLeft: prevScrollLeft,
    });
  } else {
    dock.classList.remove('is-overflowing', 'can-scroll-left', 'can-scroll-right', 'is-dock-dragging');
    dock.dataset.dockOverflow = 'false';
  }

  disposeDockMagnification = createDockMagnification(dock);
}

function renderPaginationDots() {
  const container = document.getElementById('paginationDots');
  if (!container) return;
  clearElement(container);

  const views =
    Array.isArray(state.screenViews) && state.screenViews.length > 0
      ? state.screenViews
      : state.pages.map((p, idx) => ({
          viewId: `${p.id}__view_0`,
          pageId: p.id,
          pageTitle: p.title,
          categoryIndex: idx,
          subViewIndex: 0,
          subViewCount: 1,
        }));

  views.forEach((view, viewIdx) => {
    const subSuffix = view.subViewCount > 1 ? ` · 分屏 ${view.subViewIndex + 1}/${view.subViewCount}` : '';
    const dot = el('button', {
      type: 'button',
      className: `page-dot ${viewIdx === state.currentViewIndex ? 'active' : ''} ${view.subViewCount > 1 ? 'page-dot-subview' : ''}`,
      dataset: {
        pageId: view.pageId,
        viewId: view.viewId,
        pageIndex: view.categoryIndex,
        viewIndex: viewIdx,
      },
      title: `${view.pageTitle}${subSuffix} (${viewIdx + 1}/${views.length})`,
      'aria-label': `切换到第 ${viewIdx + 1} 屏：${view.pageTitle}${subSuffix}`,
    });
    dot.addEventListener('click', () => goToView(viewIdx));

    dot.addEventListener('dragover', (e) => {
      if (!state.jiggleMode) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      dot.classList.add('drag-target-active');
    });

    dot.addEventListener('dragleave', () => {
      dot.classList.remove('drag-target-active');
    });

    dot.addEventListener('drop', (e) => {
      if (!state.jiggleMode) return;
      e.preventDefault();
      e.stopPropagation();
      dot.classList.remove('drag-target-active');
      gestureBlockBlankExit = true;

      const dragged =
        state.draggedItem ||
        (state.draggedSiteId
          ? {
              kind: 'site',
              id: state.draggedSiteId,
              fromPageId: state.pages[state.currentPageIndex]?.id || 'all',
            }
          : null);
      if (!dragged) return;
      state.draggedItem = null;
      state.draggedSiteId = null;

      const resolved = resolveViewDropBeforeAnchor({
        views: state.screenViews,
        targetViewId: view.viewId,
        targetPageId: view.pageId,
        draggedKind: dragged.kind,
        draggedId: dragged.id,
      });

      moveDesktopItemToPage({
        fromPageId: dragged.fromPageId || state.pages[state.currentPageIndex]?.id || 'all',
        toPageId: resolved.toPageId,
        kind: dragged.kind,
        id: dragged.id,
        beforeTarget:
          resolved.beforeKind && resolved.beforeId
            ? { kind: resolved.beforeKind, id: resolved.beforeId }
            : null,
      });
      goToView(viewIdx);
    });

    container.appendChild(dot);
  });
}

// ==========================================================================
// Calibrated Top Status Bar Clock & Environment / Weather Orchestration
// ==========================================================================
function initStatusBarClock() {
  function renderStatusBarTime() {
    const snap = clockController.getSnapshot();
    const timeEl = document.getElementById('statusBarTime');
    const dateEl = document.getElementById('statusBarDate');
    if (timeEl) setText(timeEl, snap.parts.timeHM);
    if (dateEl) setText(dateEl, snap.parts.dateLabelZh);
  }

  renderStatusBarTime();
  const statusClockTimer = setInterval(renderStatusBarTime, 1000);
  statusClockTimer?.unref?.();
  clockController.subscribe(renderStatusBarTime);

  const focusToggle = document.getElementById('focusModeToggle');
  if (focusToggle) {
    focusToggle.addEventListener('click', () => {
      const effectiveNight = resolveEffectiveNightMode(state.prefs);
      state.prefs.nightMode = !effectiveNight;
      savePrefsToStorage();
      applyPreferencesToDOM();
    });
  }
}

const BROWSER_GEO_OPTIONS = Object.freeze({
  enableHighAccuracy: false,
  timeout: 6000,
  maximumAge: 300000,
});

function isBrowserGeolocationSupportedInContext() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const host = typeof location !== 'undefined' ? location.hostname : '';
  const isSecure = Boolean(window.isSecureContext || host === 'localhost' || host === '127.0.0.1');
  return Boolean(isSecure && navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function');
}

function hasValidBrowserCoordinates(coords = state.browserCoordinates) {
  return Boolean(
    coords &&
      typeof coords === 'object' &&
      typeof coords.latitude === 'number' &&
      Number.isFinite(coords.latitude) &&
      typeof coords.longitude === 'number' &&
      Number.isFinite(coords.longitude)
  );
}

function readBrowserCoordinates(options = BROWSER_GEO_OPTIONS) {
  return new Promise((resolve, reject) => {
    if (!isBrowserGeolocationSupportedInContext()) {
      reject(new Error('当前上下文不支持浏览器精确定位'));
      return;
    }
    const timeoutMs = Math.max(1000, Number(options?.timeout) || 6000);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('读取浏览器位置超时'));
    }, timeoutMs + 250);
    timer?.unref?.();

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const lat = Number(pos?.coords?.latitude);
          const lon = Number(pos?.coords?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            reject(new Error('浏览器返回的位置坐标无效'));
            return;
          }
          resolve({
            latitude: Number(lat.toFixed(4)),
            longitude: Number(lon.toFixed(4)),
          });
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err || new Error('未获得浏览器定位授权或定位失败'));
        },
        options
      );
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err || new Error('调用浏览器定位接口失败'));
    }
  });
}

async function maybeHydrateGrantedBrowserCoordinatesForMode(activeMode) {
  if (activeMode !== 'auto' && activeMode !== 'browser') {
    return null;
  }
  if (hasValidBrowserCoordinates(state.browserCoordinates)) {
    return state.browserCoordinates;
  }
  if (!isBrowserGeolocationSupportedInContext()) {
    return null;
  }
  if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
    return null;
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (!status || status.state !== 'granted') {
      return null;
    }
  } catch {
    return null;
  }
  const currentModeBeforeRead = state.deviceSettings?.location?.mode || 'auto';
  if (currentModeBeforeRead !== 'auto' && currentModeBeforeRead !== 'browser') {
    return null;
  }
  try {
    const coords = await readBrowserCoordinates(BROWSER_GEO_OPTIONS);
    const currentModeAfterRead = state.deviceSettings?.location?.mode || 'auto';
    if (currentModeAfterRead === 'auto' || currentModeAfterRead === 'browser') {
      state.browserCoordinates = coords;
      return coords;
    }
    return null;
  } catch {
    return null;
  }
}

async function refreshTimeCalibrationOnly() {
  try {
    const snap = await featureClient.getTime(getBrowserTimeZone());
    clockController.applySnapshot(snap);
  } catch {
    // Keep existing incremental clock on transient network failure
  }
}

async function refreshEnvironmentAndWeather(forceWeather = false) {
  const browserTimeZone = getBrowserTimeZone();
  state.environment.weatherLoading = true;
  widgetHost.updateAll({ environment: structuredClone(state.environment) });

  try {
    const initialMode = state.deviceSettings?.location?.mode || 'auto';
    if (
      (initialMode === 'auto' || initialMode === 'browser') &&
      !hasValidBrowserCoordinates(state.browserCoordinates)
    ) {
      await maybeHydrateGrantedBrowserCoordinatesForMode(initialMode);
    }

    const effectiveMode = state.deviceSettings?.location?.mode || 'auto';
    const coordsForResolve =
      (effectiveMode === 'auto' || effectiveMode === 'browser') &&
      hasValidBrowserCoordinates(state.browserCoordinates)
        ? state.browserCoordinates
        : undefined;

    const resolved = await featureClient.resolveEnvironment({
      browserTimeZone,
      coordinates: coordsForResolve,
    });

    if (resolved?.clock) {
      clockController.applySnapshot(resolved.clock);
    }

    state.environment.location = resolved?.location || null;
    state.environment.warnings = Array.isArray(resolved?.warnings) ? resolved.warnings : [];

    if (state.environment.location && typeof state.environment.location.latitude === 'number') {
      try {
        const weather = await featureClient.getWeather({
          latitude: state.environment.location.latitude,
          longitude: state.environment.location.longitude,
          timeZone: state.environment.location.timeZone || resolved?.clock?.timeZone || 'UTC',
          temperatureUnit: state.deviceSettings.weather?.temperatureUnit || 'celsius',
        });
        state.environment.weather = weather;
        state.environment.weatherError = null;
      } catch (wErr) {
        if (forceWeather || !state.environment.weather) {
          state.environment.weather = null;
        }
        state.environment.weatherError = wErr.message || '外部天气服务暂时不可用';
      }
    } else {
      state.environment.weather = null;
      state.environment.weatherError = null;
    }
  } catch (err) {
    await refreshTimeCalibrationOnly();
    state.environment.weatherError = err.message || '环境位置解析暂不可用';
  } finally {
    state.environment.weatherLoading = false;
    widgetHost.updateAll({ environment: structuredClone(state.environment) });
    updateSettingsStatusSummary();
  }
}

// ==========================================================================
// Spotlight Search & Multi-Engine Switcher (Strictly XSS-Safe)
// ==========================================================================
function initSpotlightAndEngines() {
  const input = document.getElementById('spotlightInput');
  const clearBtn = document.getElementById('spotlightClearBtn');
  const submitBtn = document.getElementById('spotlightSubmitBtn');
  const engineBtn = document.getElementById('engineSelectorBtn');
  const popover = document.getElementById('enginePopover');

  const googleIdx = Math.max(
    0,
    SEARCH_ENGINES.findIndex((item) => item.id === 'google')
  );
  try {
    const savedEngineId = localStorage.getItem(STORAGE_KEYS.SEARCH_ENGINE);
    const savedIdx = SEARCH_ENGINES.findIndex((item) => item.id === savedEngineId);
    state.engineIndex = savedIdx !== -1 ? savedIdx : googleIdx;
  } catch {
    state.engineIndex = googleIdx;
  }

  function syncEngineUI() {
    const eng = SEARCH_ENGINES[state.engineIndex] || SEARCH_ENGINES[googleIdx];
    const badge = document.getElementById('currentEngineBadge');
    const name = document.getElementById('currentEngineName');
    if (badge) {
      setText(badge, eng.badge);
      badge.style.background = eng.color;
    }
    if (name) setText(name, eng.name);
    const emptyEngName = document.getElementById('emptyEngineName');
    if (emptyEngName) setText(emptyEngName, eng.name);

    if (popover) {
      clearElement(popover);
      SEARCH_ENGINES.forEach((item, idx) => {
        const badgeNode = el('span', { className: 'engine-badge', textContent: item.badge });
        badgeNode.style.background = item.color;
        const opt = el(
          'button',
          {
            type: 'button',
            className: `engine-option ${idx === state.engineIndex ? 'active' : ''}`,
          },
          el('div', { className: 'engine-option-left' }, badgeNode, el('span', { textContent: item.name })),
          el('span', { className: 'engine-option-url', textContent: item.domain })
        );
        opt.addEventListener('click', () => {
          selectEngine(idx);
          popover.hidden = true;
          input?.focus();
        });
        popover.appendChild(opt);
      });
    }
  }

  function selectEngine(nextIndex) {
    const validIdx =
      Number.isInteger(nextIndex) && nextIndex >= 0 && nextIndex < SEARCH_ENGINES.length
        ? nextIndex
        : googleIdx;
    state.engineIndex = validIdx;
    const selected = SEARCH_ENGINES[state.engineIndex] || SEARCH_ENGINES[googleIdx];
    writeLocalStorage(STORAGE_KEYS.SEARCH_ENGINE, selected.id);
    syncEngineUI();
  }

  syncEngineUI();

  if (engineBtn && popover) {
    engineBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.hidden = !popover.hidden;
    });
  }

  if (input) {
    input.addEventListener('input', () => {
      state.searchQuery = input.value;
      if (clearBtn) clearBtn.hidden = !input.value;
      renderSearchResultsStage();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        selectEngine((state.engineIndex + 1) % SEARCH_ENGINES.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        triggerExternalSearch();
      } else if (e.key === 'Escape') {
        input.value = '';
        state.searchQuery = '';
        if (clearBtn) clearBtn.hidden = true;
        input.blur();
        renderSearchResultsStage();
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (input) input.value = '';
      state.searchQuery = '';
      clearBtn.hidden = true;
      renderSearchResultsStage();
      input?.focus();
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', () => triggerExternalSearch());
  }

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input?.focus();
      input?.select();
    } else if (e.key === '/' && !isTyping) {
      e.preventDefault();
      input?.focus();
    } else if (e.key === 'Escape') {
      closeContextMenu();
      if (desktopPointerDragController?.isDragging?.()) {
        desktopPointerDragController.cancelDrag();
        gestureBlockBlankExit = true;
        return;
      }
      if (activeMovePagePopover) {
        closeMovePagePopover();
        return;
      }
      if (hasOpenPopovers()) {
        closeAllPopovers(null, { restoreFocus: true });
        return;
      }
      const widgetDetailModal = document.getElementById('widgetDetailModal');
      const categoryOverflowModal = document.getElementById('categoryOverflowModal');
      const folderDetailModal = document.getElementById('folderDetailModal');
      const addSiteModal = document.getElementById('addSiteModal');
      const addPageModal = document.getElementById('addPageModal');
      const apiModal = document.getElementById('apiConfigModal');
      const customizeSheet = document.getElementById('customizeSheet');

      if (folderDetailModal && !folderDetailModal.hidden) {
        closeAllPopovers();
        closeFolderDetailModal();
        return;
      }
      if (widgetDetailModal && !widgetDetailModal.hidden) {
        closeAllPopovers();
        closeWidgetDetailModal();
        return;
      }
      if (categoryOverflowModal && !categoryOverflowModal.hidden) {
        closeAllPopovers();
        closeCategoryOverflowModal();
        return;
      }
      if (addSiteModal && !addSiteModal.hidden) {
        closeAllPopovers();
        addSiteModal.hidden = true;
        schedulePostRenderGridCalibration();
        return;
      }
      if (addPageModal && !addPageModal.hidden) {
        closeAllPopovers();
        state.editingPageId = null;
        addPageModal.hidden = true;
        schedulePostRenderGridCalibration();
        return;
      }
      if (apiModal && !apiModal.hidden) {
        closeAllPopovers();
        apiModal.hidden = true;
        schedulePostRenderGridCalibration();
        return;
      }
      if (customizeSheet && customizeSheet.classList.contains('open')) {
        toggleCustomizeSheet(false);
        return;
      }
      if (state.jiggleMode) setJiggleMode(false);
    }
  });
}

function renderSearchResultsStage() {
  const q = state.searchQuery.trim().toLowerCase();
  const searchStage = document.getElementById('searchResultsStage');
  const searchGrid = document.getElementById('searchResultsGrid');
  const emptyState = document.getElementById('emptySearchState');
  const viewport = document.getElementById('springboardViewport');
  if (!searchStage || !searchGrid || !viewport) return;

  if (!q) {
    searchStage.hidden = true;
    viewport.hidden = false;
    return;
  }

  viewport.hidden = true;
  searchStage.hidden = false;
  clearElement(searchGrid);

  const matches = state.sites.filter((site) => {
    const hay = `${site.title} ${site.url} ${site.keywords || ''}`.toLowerCase();
    return hay.includes(q);
  });

  if (matches.length === 0) {
    if (emptyState) emptyState.hidden = false;
    const engName = document.getElementById('emptyEngineName');
    if (engName) setText(engName, SEARCH_ENGINES[state.engineIndex].name);
  } else {
    if (emptyState) emptyState.hidden = true;
    matches.forEach((site, idx) => {
      searchGrid.appendChild(createAppItemElement(site, idx));
    });
  }
}

function triggerExternalSearch() {
  const q = state.searchQuery.trim();
  const eng = SEARCH_ENGINES[state.engineIndex];
  if (!q) {
    document.getElementById('spotlightInput')?.focus();
    return;
  }
  window.open(`${eng.url}${encodeURIComponent(q)}`, '_blank', 'noopener,noreferrer');
}

// ==========================================================================
// iOS 18 Home Screen Customization Sheet
// ==========================================================================
const localWallpaperController = createLocalWallpaperController({
  onWallPaperStateChange: () => {
    applyPreferencesToDOM();
  },
});

const NAVIGATION_IMPORT_BLOCKED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'change',
  'submit',
  'click',
  'dblclick',
  'contextmenu',
  'pointerdown',
  'pointermove',
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchmove',
  'touchend',
  'dragstart',
  'dragover',
  'drop',
];
let navigationImportLockListenersBound = false;
let previousBodyInertState = false;
let hasCapturedBodyInertState = false;

function blockMainWindowInteractionDuringImport(event) {
  if (!state.navigationImportInProgress) return;
  if (event?.cancelable) {
    event.preventDefault();
  }
  event?.stopImmediatePropagation?.();
  event?.stopPropagation?.();
}

function setNavigationImportEditLock(locked) {
  const active = Boolean(locked);
  if (active) {
    desktopPointerDragController?.cancelDrag?.();
    if (typeof cancelActivePageDrag === 'function') {
      cancelActivePageDrag();
    }
  }
  state.navigationImportInProgress = active;
  if (typeof document !== 'undefined' && document.body) {
    if (active) {
      if (!hasCapturedBodyInertState) {
        previousBodyInertState = Boolean(document.body.inert);
        hasCapturedBodyInertState = true;
      }
      document.body.inert = true;
      document.body.setAttribute('data-navigation-importing', 'true');
    } else {
      const restoreInert = hasCapturedBodyInertState ? previousBodyInertState : false;
      hasCapturedBodyInertState = false;
      previousBodyInertState = false;
      document.body.inert = restoreInert;
      if (!restoreInert) {
        document.body.removeAttribute?.('inert');
      }
      document.body.removeAttribute('data-navigation-importing');
    }
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    if (active && !navigationImportLockListenersBound) {
      navigationImportLockListenersBound = true;
      for (const evtName of NAVIGATION_IMPORT_BLOCKED_EVENTS) {
        window.addEventListener(evtName, blockMainWindowInteractionDuringImport, true);
      }
    } else if (!active && navigationImportLockListenersBound) {
      navigationImportLockListenersBound = false;
      for (const evtName of NAVIGATION_IMPORT_BLOCKED_EVENTS) {
        window.removeEventListener(evtName, blockMainWindowInteractionDuringImport, true);
      }
    }
  }
}

const navigationBackupController = createNavigationBackupController({
  getLiveNavigationSnapshot() {
    const sitesSnapshot = structuredClone(state.sites);
    const pagesSnapshot = structuredClone(state.pages);
    const layoutSnapshot = structuredClone(
      state.widgetState?.layout || createDefaultWidgetState(state.widgetRegistry).layout
    );
    const desktopSnapshot =
      state.widgetState?.desktop && Array.isArray(state.widgetState.desktop.pages)
        ? structuredClone(state.widgetState.desktop)
        : buildInitialDesktopLayout({
            pages: structuredClone(state.pages),
            sites: structuredClone(state.sites),
            layout: structuredClone(layoutSnapshot),
            definitions: state.widgetRegistry,
          }).desktop;
    return {
      sites: sitesSnapshot,
      pages: pagesSnapshot,
      desktop: desktopSnapshot,
      layout: layoutSnapshot,
    };
  },
  async drainPendingBeforeImport() {
    if (bootstrapInFlight) {
      await bootstrapInFlight;
    }
    if (!hasBootstrapped) {
      throw new Error('页面尚未完成初始化，请等待启动完成后再执行导航恢复');
    }
    if (window.PortalBackend) {
      window.PortalBackend.save({
        sites: getBackendSyncableSites(),
        prefs: getBackendSyncablePrefs(),
        note: state.note,
      });
      await window.PortalBackend.flushNow();
    }
    const effectiveDesktop = getEffectiveDesktopForRender();
    featureClient.saveWidgetsState({
      layout: state.widgetState.layout,
      todos: state.widgetState.todos,
      desktop: effectiveDesktop,
    });
    await featureClient.flushWidgetsNow();
  },
  async fetchRevisionsBeforeImport() {
    const [portalDoc, widgetsDoc] = await Promise.all([
      featureClient.fetchPortalState(),
      featureClient.fetchWidgetsStateDoc(),
    ]);
    return {
      portalRevision: portalDoc?.revision,
      widgetRevision: widgetsDoc?.revision,
    };
  },
  async postAtomicNavigationImport({ backup, portalRevision, widgetRevision }) {
    return featureClient.importNavigationBackup({
      backup,
      portalRevision,
      widgetRevision,
    });
  },
  async applyImportedBrowserDataAndReload(importResult, validatedBackup) {
    const restoredPages = Array.isArray(importResult?.browserData?.pages)
      ? normalizePages(importResult.browserData.pages, DEFAULT_PAGES)
      : normalizePages(validatedBackup.pages, DEFAULT_PAGES);
    writeLocalStorage(STORAGE_KEYS.PAGES, JSON.stringify(restoredPages));

    writeLocalStorage(
      STORAGE_KEYS.SITES,
      JSON.stringify(structuredClone(validatedBackup.sites))
    );

    if (typeof importResult?.restoreId === 'string' && importResult.restoreId) {
      writeLocalStorage(NAVIGATION_RESTORE_ID_STORAGE_KEY, importResult.restoreId);
    }

    window.PortalBackend?.clearSyncedCache?.({
      nextRevision: importResult?.revisions?.portal ?? null,
    });
    featureClient.clearDrainedWidgetsCache?.({
      nextRevision: importResult?.revisions?.widgets ?? null,
    });

    window.location?.reload?.();
  },
  setEditLock: setNavigationImportEditLock,
});

const notificationsUIController = createNotificationsUIController({
  openSettingsModalForNotifications: () => {
    openApiConfigModal('notifications');
  },
  getFallbackFocusElement: () =>
    document.getElementById('openSettingsModalBtn') ||
    document.getElementById('spotlightInput'),
});

function initCustomizeSheet() {
  const openBtn = document.getElementById('openCustomizeBtn');
  const closeBtn = document.getElementById('closeCustomizeBtn');
  const resetBtn = document.getElementById('resetDefaultBtn');
  const openApiBtn = document.getElementById('openApiConfigBtn');
  const hueRange = document.getElementById('tintHueRange');
  const satRange = document.getElementById('tintSatRange');
  const dimBtn = document.getElementById('dimWallpaperBtn');
  const followSystemBtn = document.getElementById('followSystemNightBtn');

  localWallpaperController.bindDOMEvents();
  localWallpaperController.restoreFromStorage();

  if (openBtn) openBtn.addEventListener('click', () => toggleCustomizeSheet());
  if (closeBtn) closeBtn.addEventListener('click', () => toggleCustomizeSheet(false));
  if (openApiBtn) {
    openApiBtn.addEventListener('click', () => {
      toggleCustomizeSheet(false);
      openApiConfigModal('location');
    });
  }

  document.querySelectorAll('.mode-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.prefs.iconMode = btn.dataset.mode;
      savePrefsToStorage();
      applyPreferencesToDOM();
    });
  });

  document.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.prefs.iconSize = btn.dataset.size;
      savePrefsToStorage();
      applyPreferencesToDOM();
    });
  });

  if (hueRange) {
    hueRange.addEventListener('input', () => {
      state.prefs.tintHue = parseInt(hueRange.value, 10);
      if (state.prefs.iconMode !== 'tinted') state.prefs.iconMode = 'tinted';
      applyPreferencesToDOM();
      savePrefsToStorage();
    });
  }

  if (satRange) {
    satRange.addEventListener('input', () => {
      state.prefs.tintSat = parseInt(satRange.value, 10);
      if (state.prefs.iconMode !== 'tinted') state.prefs.iconMode = 'tinted';
      applyPreferencesToDOM();
      savePrefsToStorage();
    });
  }

  if (dimBtn) {
    dimBtn.addEventListener('click', () => {
      state.prefs.wallpaperDimmed = !state.prefs.wallpaperDimmed;
      savePrefsToStorage();
      applyPreferencesToDOM();
    });
  }

  if (followSystemBtn) {
    followSystemBtn.addEventListener('click', () => {
      delete state.prefs.nightMode;
      savePrefsToStorage();
      applyPreferencesToDOM();
    });
  }

  document.querySelectorAll('.swatch-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextWp = btn.dataset.wp;
      const cleared = await localWallpaperController.clearCustomWallpaper({ silent: true });
      if (!cleared) {
        applyPreferencesToDOM();
        return;
      }
      state.prefs.wallpaper = nextWp;
      savePrefsToStorage();
      applyPreferencesToDOM();
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const cleared = await localWallpaperController.clearCustomWallpaper({ silent: true });
      if (!cleared) {
        applyPreferencesToDOM();
        return;
      }
      state.pages = structuredClone(DEFAULT_PAGES);
      state.sites = structuredClone(DEFAULT_SITES);
      state.currentPageIndex = 0;
      state.prefs = {
        iconMode: 'light',
        iconSize: 'small',
        wallpaper: 'ios18-bloom',
        wallpaperDimmed: false,
        tintHue: 215,
        tintSat: 82,
        focusActive: false,
      };
      const defaultWidgetState = createDefaultWidgetState();
      const migrated = buildInitialDesktopLayout({
        pages: state.pages,
        sites: state.sites,
        layout: defaultWidgetState.layout,
        definitions: state.widgetRegistry,
      });
      savePagesToStorage();
      saveSitesToStorage();
      savePrefsToStorage();
      applyPreferencesToDOM();
      commitDesktopAndLayout(migrated.desktop, migrated.layout);
      renderDock();
    });
  }
}

function toggleCustomizeSheet(forceState) {
  const sheet = document.getElementById('customizeSheet');
  const openBtn = document.getElementById('openCustomizeBtn');
  if (!sheet) return;
  const next = typeof forceState === 'boolean' ? forceState : !sheet.classList.contains('open');
  if (!next && localWallpaperController.hasPendingPreview()) {
    localWallpaperController.cancelPreview({ silent: true });
  }
  sheet.classList.toggle('open', next);
  sheet.setAttribute('aria-hidden', String(!next));
  if (openBtn) openBtn.classList.toggle('active-pill', next);
}

// ==========================================================================
// Unified Settings Modal: Location/Weather, Clock/TimeZone & Sync
// ==========================================================================
const SETTINGS_TABS = new Set(['location', 'clock', 'notifications', 'api', 'update', 'sync']);

function switchSettingsTab(tabName) {
  closeAllPopovers();
  const aliasTab = tabName === 'widgets' ? 'location' : tabName === 'sources' ? 'api' : tabName;
  const normalizedTab = SETTINGS_TABS.has(aliasTab) ? aliasTab : 'location';
  const previousTab = state.activeSettingsTab;
  state.activeSettingsTab = normalizedTab;
  if (previousTab === 'update' && normalizedTab !== 'update') {
    updateUIController?.onHidden?.();
  }
  document.querySelectorAll('#apiConfigModal .settings-tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === normalizedTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.setAttribute('tabindex', active ? '0' : '-1');
    if (active && typeof btn.scrollIntoView === 'function') {
      try {
        btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch {
        // Ignore scroll errors in old engines
      }
    }
  });
  document.querySelectorAll('#apiConfigModal .settings-tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== normalizedTab;
  });
  if (normalizedTab === 'update') {
    getUpdateUIController().onShown();
  }
}

function syncSettingsControlsFromState() {
  const locModeSelect = document.getElementById('locationModeSelect');
  const tempUnitSelect = document.getElementById('temperatureUnitSelect');
  const tzModeSelect = document.getElementById('timeZoneModeSelect');
  const manualTzSelect = document.getElementById('manualTimeZoneSelect');
  const clockModeSelect = document.getElementById('clockModeSelect');
  const manualDateInput = document.getElementById('manualDateInput');
  const manualTimeInput = document.getElementById('manualTimeInput');

  if (locModeSelect) locModeSelect.value = state.deviceSettings.location?.mode || 'auto';
  if (tempUnitSelect) tempUnitSelect.value = state.deviceSettings.weather?.temperatureUnit || 'celsius';

  if (manualTzSelect) {
    clearElement(manualTzSelect);
    for (const tz of state.availableTimeZones) {
      manualTzSelect.appendChild(el('option', { value: tz, textContent: tz }));
    }
    const desiredTz = state.deviceSettings.clock?.timeZone || 'Asia/Shanghai';
    if (state.availableTimeZones.includes(desiredTz)) {
      manualTzSelect.value = desiredTz;
    }
  }

  if (tzModeSelect) tzModeSelect.value = state.deviceSettings.clock?.timeZoneMode || 'browser';
  if (clockModeSelect) clockModeSelect.value = state.deviceSettings.clock?.mode || 'automatic';

  for (const ctrl of uiSelectControls.values()) {
    ctrl.refresh();
  }

  const snap = clockController.getSnapshot();
  if (manualDateInput && !manualDateInput.value) {
    manualDateInput.value = snap.parts.isoDate;
  }
  if (manualTimeInput && !manualTimeInput.value) {
    manualTimeInput.value = snap.parts.timeHMS;
  }

  updateSettingsStatusSummary();
}

function getEffectiveSelectedTimeZone() {
  const tzMode = document.getElementById('timeZoneModeSelect')?.value || state.deviceSettings.clock?.timeZoneMode || 'browser';
  const manualTz = document.getElementById('manualTimeZoneSelect')?.value || state.deviceSettings.clock?.timeZone || 'Asia/Shanghai';
  if (tzMode === 'manual' && isValidTimeZone(manualTz)) return manualTz;
  if (tzMode === 'location' && state.environment.location?.timeZone) return state.environment.location.timeZone;
  return getBrowserTimeZone();
}

function updateSettingsStatusSummary() {
  const locText = document.getElementById('locationStatusText');
  const clockText = document.getElementById('clockStatusText');
  const offsetSummary = document.getElementById('clockOffsetSummaryText');

  if (locText) {
    const loc = state.environment.location;
    const warn = state.environment.warnings?.[0]?.message;
    if (loc) {
      const sourceDesc =
        loc.source === 'manual'
          ? '手动保存城市'
          : loc.source === 'browser'
            ? '浏览器精确定位（不落库）'
            : loc.source === 'network-ip'
              ? '网络出口 IP 近似位置'
              : 'IP 近似位置';
      setText(locText, `当前地点：${loc.name} (${sourceDesc} · 时区 ${loc.timeZone})`);
    } else {
      setText(locText, warn || '当前尚未解析到有效地点，请选择手动城市或切换定位模式');
    }
  }

  const snap = clockController.getSnapshot();
  if (offsetSummary) {
    setText(
      offsetSummary,
      `当前时区：${snap.timeZone} · 时间偏移：${snap.offsetSeconds} 秒 (${snap.mode === 'manual' ? '手动校时' : '自动标准时间'})`
    );
  }
  if (clockText) {
    setText(
      clockText,
      `当前网页显示时间：${snap.parts.isoDate} ${snap.parts.timeHMS} (${snap.timeZone})`
    );
  }
}

function initSettingsModalControls() {
  document.querySelectorAll('#apiConfigModal .settings-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
  });

  const locModeSelect = document.getElementById('locationModeSelect');
  const tempUnitSelect = document.getElementById('temperatureUnitSelect');
  const tzModeSelect = document.getElementById('timeZoneModeSelect');
  const manualTzSelect = document.getElementById('manualTimeZoneSelect');
  const clockModeSelect = document.getElementById('clockModeSelect');
  const siteCategorySelect = document.getElementById('siteCategorySelect');
  const pageIconSelect = document.getElementById('pageIconSelect');

  const selectConfigs = [
    { elNode: locModeSelect, id: 'locationModeSelect', ariaLabel: '位置解析方式', searchable: false },
    { elNode: tempUnitSelect, id: 'temperatureUnitSelect', ariaLabel: '温度单位', searchable: false },
    { elNode: tzModeSelect, id: 'timeZoneModeSelect', ariaLabel: '时区来源', searchable: false },
    {
      elNode: manualTzSelect,
      id: 'manualTimeZoneSelect',
      ariaLabel: '手动 IANA 时区',
      searchable: true,
      searchPlaceholder: '搜索 IANA 时区…',
    },
    { elNode: clockModeSelect, id: 'clockModeSelect', ariaLabel: '时间校准模式', searchable: false },
    { elNode: siteCategorySelect, id: 'siteCategorySelect', ariaLabel: '所属导航分页', searchable: false },
    { elNode: pageIconSelect, id: 'pageIconSelect', ariaLabel: '页面图标样式', searchable: false },
  ];

  for (const cfg of selectConfigs) {
    if (cfg.elNode && !uiSelectControls.has(cfg.id)) {
      uiSelectControls.set(
        cfg.id,
        createSelect({
          selectElement: cfg.elNode,
          ariaLabel: cfg.ariaLabel,
          searchable: cfg.searchable,
          searchPlaceholder: cfg.searchPlaceholder || '搜索选项…',
        })
      );
    }
  }

  locModeSelect?.addEventListener('change', async () => {
    const nextMode = locModeSelect.value;
    if (nextMode === 'manual' && !state.deviceSettings.location?.manual) {
      setText(document.getElementById('locationStatusText'), '请先在下方搜索并点击选择一个城市，即可切换为手动城市模式');
      return;
    }
    try {
      state.deviceSettings = await featureClient.saveDeviceSettings({
        location: {
          mode: nextMode,
          manual: state.deviceSettings.location?.manual || null,
        },
      });
      await refreshEnvironmentAndWeather(true);
    } catch (err) {
      setText(document.getElementById('locationStatusText'), err.message || '保存定位模式失败');
    }
  });

  const requestGeoBtn = document.getElementById('requestBrowserGeoBtn');
  requestGeoBtn?.addEventListener('click', async () => {
    if (requestGeoBtn.disabled) return;
    const locStatus = document.getElementById('locationStatusText');
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      setText(locStatus, '当前通过局域网 HTTP 访问，浏览器安全策略限制精确定位；请使用 IP 近似位置或在上方搜索手动城市。');
      return;
    }
    if (!navigator.geolocation) {
      setText(locStatus, '当前浏览器不支持定位接口，请使用 IP 近似位置或手动选择城市。');
      return;
    }

    requestGeoBtn.disabled = true;
    try {
      setText(locStatus, '正在请求浏览器定位授权…');

      let weatherPermGranted = true;
      const requestWeatherFn = window.LaunchDeckLocation?.requestWeather;
      if (typeof requestWeatherFn === 'function') {
        try {
          const weatherPermPromise = requestWeatherFn.call(window.LaunchDeckLocation);
          weatherPermGranted = Boolean(await weatherPermPromise);
        } catch {
          weatherPermGranted = false;
        }
      }

      let coords = null;
      try {
        coords = await readBrowserCoordinates(BROWSER_GEO_OPTIONS);
      } catch {
        state.browserCoordinates = null;
        const currentMode = locModeSelect?.value || state.deviceSettings?.location?.mode || 'auto';
        if (currentMode === 'auto') {
          await refreshEnvironmentAndWeather(true);
          if (!state.environment.location) {
            setText(
              locStatus,
              weatherPermGranted
                ? '未获得浏览器定位授权；已保留现有设置，您可改用 IP 近似定位或手动选择城市。'
                : '未获得浏览器定位与实况天气访问授权；已保留现有设置，您可改用 IP 近似定位或手动选择城市。'
            );
          }
        } else {
          setText(
            locStatus,
            weatherPermGranted
              ? '未获得浏览器定位授权；已保留现有设置，您可改用 IP 近似定位或手动选择城市。'
              : '未获得浏览器定位与实况天气访问授权；已保留现有设置，您可改用 IP 近似定位或手动选择城市。'
          );
        }
        return;
      }

      state.browserCoordinates = coords;
      const currentSelectedMode = locModeSelect?.value || state.deviceSettings?.location?.mode || 'auto';
      const targetMode =
        currentSelectedMode === 'browser' || currentSelectedMode === 'auto'
          ? currentSelectedMode
          : 'auto';
      if (locModeSelect && locModeSelect.value !== targetMode) {
        locModeSelect.value = targetMode;
        uiSelectControls.get('locationModeSelect')?.refresh();
      }
      try {
        state.deviceSettings = await featureClient.saveDeviceSettings({
          location: {
            mode: targetMode,
            manual: state.deviceSettings.location?.manual || null,
          },
        });
      } catch {
        // Continue resolving with in-memory coordinates
      }
      await refreshEnvironmentAndWeather(true);
      if (!weatherPermGranted && locStatus) {
        const locName = state.environment.location?.name;
        setText(
          locStatus,
          locName
            ? `已读取浏览器位置（${locName}），但未授予实况天气网络权限；允许权限后即可更新实时天气。`
            : '已读取浏览器精确定位坐标，但实时天气需要授予网络访问权限后方可获取。'
        );
      }
    } finally {
      requestGeoBtn.disabled = false;
    }
  });

  const citySearchInput = document.getElementById('citySearchInput');
  const citySearchBtn = document.getElementById('citySearchBtn');
  const cityResultsBox = document.getElementById('citySearchResults');
  let searchAbortController = null;

  async function performCitySearch() {
    if (!citySearchInput || !cityResultsBox) return;
    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }
    const term = citySearchInput.value.trim();
    clearElement(cityResultsBox);
    if (term.length < 2) {
      cityResultsBox.appendChild(
        el('div', { className: 'widget-empty-hint', textContent: '请输入至少 2 个字符的城市关键词后再搜索' })
      );
      return;
    }

    const localController = new AbortController();
    searchAbortController = localController;

    cityResultsBox.appendChild(
      el('div', { className: 'widget-empty-hint', textContent: '正在搜索匹配城市…' })
    );

    const requestCitySearchFn = window.LaunchDeckLocation?.requestCitySearch;
    if (typeof requestCitySearchFn === 'function') {
      let granted = false;
      try {
        const cityPermPromise = requestCitySearchFn.call(window.LaunchDeckLocation);
        granted = Boolean(await cityPermPromise);
      } catch {
        granted = false;
      }
      if (localController.signal.aborted || searchAbortController !== localController) {
        return;
      }
      if (!granted) {
        clearElement(cityResultsBox);
        cityResultsBox.appendChild(
          el('div', {
            className: 'widget-error-inline',
            textContent: '城市搜索需要授予地理编码服务网络权限，请在权限弹窗中允许后重试。',
          })
        );
        return;
      }
    }

    try {
      const result = await featureClient.searchLocations(term, { signal: localController.signal });
      if (localController.signal.aborted || searchAbortController !== localController) {
        return;
      }
      clearElement(cityResultsBox);
      const list = Array.isArray(result?.locations) ? result.locations : [];
      if (list.length === 0) {
        cityResultsBox.appendChild(
          el('div', { className: 'widget-empty-hint', textContent: '未找到匹配城市，请尝试其他关键词' })
        );
        return;
      }

      const stripAdminSuffix = (val) =>
        String(val || '')
          .trim()
          .replace(/(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|地区|省|市|区|县|盟|旗)$/u, '')
          .trim();
      const cleanTerm = String(term || '').trim();
      const termCore = stripAdminSuffix(cleanTerm);

      for (const item of list) {
        const rawName = String(item?.name || '').trim();
        const rawRegion = String(item?.region || '').trim();
        const rawCountry = String(item?.country || '').trim();
        const rawTimeZone = String(item?.timeZone || '').trim();
        const isDomestic =
          rawCountry === '中国' ||
          rawCountry.toLowerCase() === 'china' ||
          result?.provider === 'UAPI';

        let displayTitle = rawName;
        let subMeta = '';

        if (isDomestic) {
          if (!rawRegion || rawName === rawRegion) {
            displayTitle = rawName || rawRegion;
          } else if (rawName.startsWith(rawRegion)) {
            const rest = rawName
              .slice(rawRegion.length)
              .replace(/^[\s·•\-/]+/u, '')
              .trim();
            displayTitle = rest && rest !== rawRegion ? `${rawRegion} · ${rest}` : rawName;
          } else if (rawRegion.startsWith(rawName)) {
            displayTitle = rawName;
          } else {
            displayTitle = `${rawRegion} · ${rawName}`;
          }

          const nameCore = stripAdminSuffix(rawName);
          const regionCore = stripAdminSuffix(rawRegion);
          const isMunicipality = Boolean(rawRegion && rawName === rawRegion);
          const isProvinceQuery =
            !isMunicipality &&
            Boolean(
              rawRegion &&
                cleanTerm &&
                (cleanTerm === rawRegion || (termCore.length >= 2 && termCore === regionCore)) &&
                cleanTerm !== rawName &&
                termCore !== nameCore
            );
          const isExactMatch = Boolean(
            cleanTerm &&
              (cleanTerm === rawName || (termCore.length >= 2 && termCore === nameCore))
          );
          const isDistrict = /[区县旗]$/u.test(rawName) && !/市$/u.test(rawName);

          let roleLabel = '城市';
          if (isMunicipality) {
            roleLabel = '直辖市';
          } else if (isProvinceQuery) {
            roleLabel = '省辖城市';
          } else if (isExactMatch) {
            roleLabel = isDistrict ? '匹配区县' : '匹配城市';
          } else if (isDistrict) {
            roleLabel = '区县';
          }

          subMeta = [roleLabel, rawCountry || '中国', rawTimeZone].filter(Boolean).join(' · ');
        } else {
          const dedupRegion =
            rawRegion && rawRegion.toLowerCase() !== rawName.toLowerCase() ? rawRegion : '';
          subMeta = [dedupRegion, rawCountry, rawTimeZone].filter(Boolean).join(' · ');
        }

        const btn = el(
          'button',
          {
            type: 'button',
            className: 'city-result-item',
          },
          el('span', { className: 'city-result-name', textContent: displayTitle }),
          el('span', { className: 'city-result-meta', textContent: subMeta })
        );
        btn.addEventListener('click', async () => {
          // Extract strictly the 4 permitted manual location fields
          const manualCity = {
            name: String(rawName).slice(0, 120),
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
            timeZone: String(item.timeZone),
          };
          try {
            state.deviceSettings = await featureClient.saveDeviceSettings({
              location: {
                mode: 'manual',
                manual: manualCity,
              },
            });
            if (locModeSelect) {
              locModeSelect.value = 'manual';
              uiSelectControls.get('locationModeSelect')?.refresh();
            }
            clearElement(cityResultsBox);
            await refreshEnvironmentAndWeather(true);
          } catch (err) {
            setText(document.getElementById('locationStatusText'), err.message || '保存手动城市失败');
          }
        });
        cityResultsBox.appendChild(btn);
      }
    } catch (err) {
      if (err.name === 'AbortError' || localController.signal.aborted || searchAbortController !== localController) {
        return;
      }
      clearElement(cityResultsBox);
      cityResultsBox.appendChild(
        el('div', { className: 'widget-error-inline', textContent: err.message || '城市搜索服务暂不可用' })
      );
    }
  }

  citySearchBtn?.addEventListener('click', performCitySearch);
  citySearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performCitySearch();
    }
  });

  tempUnitSelect?.addEventListener('change', async () => {
    const unit = tempUnitSelect.value === 'fahrenheit' ? 'fahrenheit' : 'celsius';
    try {
      state.deviceSettings = await featureClient.saveDeviceSettings({
        weather: { temperatureUnit: unit },
      });
      await refreshEnvironmentAndWeather(true);
    } catch (err) {
      setText(document.getElementById('locationStatusText'), err.message || '保存温度单位失败');
    }
  });

  // Clock & TimeZone settings
  const manualDateInput = document.getElementById('manualDateInput');
  const manualTimeInput = document.getElementById('manualTimeInput');
  const dstBox = document.getElementById('dstDisambiguationBox');
  const dstWarnText = document.getElementById('dstWarningText');
  const dstOptionsList = document.getElementById('dstOptionsList');
  const applyManualClockBtn = document.getElementById('applyManualClockBtn');
  const resetAutoClockBtn = document.getElementById('resetAutoClockBtn');

  if (manualDateInput && !manualDatePickerControl) {
    manualDatePickerControl = createDatePicker({
      inputElement: manualDateInput,
      ariaLabel: '手动目标日期',
      getTodayParts: () => clockController.getSnapshot().parts,
    });
  }

  if (manualTimeInput && !manualTimePickerControl) {
    manualTimePickerControl = createTimePicker({
      inputElement: manualTimeInput,
      includeSeconds: true,
      ariaLabel: '手动目标时间',
      getNowParts: () => clockController.getSnapshot().parts,
    });
  }

  async function saveClockConfiguration({ mode, timeZoneMode, timeZone, offsetSeconds }) {
    try {
      state.deviceSettings = await featureClient.saveDeviceSettings({
        clock: {
          mode,
          timeZoneMode,
          timeZone,
          offsetSeconds,
        },
      });
      await refreshEnvironmentAndWeather(false);
    } catch (err) {
      setText(document.getElementById('clockStatusText'), err.message || '保存时钟设置失败');
    }
  }

  tzModeSelect?.addEventListener('change', () => {
    const currentClock = state.deviceSettings.clock || createDefaultDeviceSettings().clock;
    saveClockConfiguration({
      mode: clockModeSelect?.value || currentClock.mode,
      timeZoneMode: tzModeSelect.value,
      timeZone: manualTzSelect?.value || currentClock.timeZone,
      offsetSeconds: currentClock.offsetSeconds || 0,
    });
  });

  manualTzSelect?.addEventListener('change', () => {
    const currentClock = state.deviceSettings.clock || createDefaultDeviceSettings().clock;
    if (tzModeSelect) {
      tzModeSelect.value = 'manual';
      uiSelectControls.get('timeZoneModeSelect')?.refresh();
    }
    saveClockConfiguration({
      mode: clockModeSelect?.value || currentClock.mode,
      timeZoneMode: 'manual',
      timeZone: manualTzSelect.value,
      offsetSeconds: currentClock.offsetSeconds || 0,
    });
  });

  clockModeSelect?.addEventListener('change', () => {
    const currentClock = state.deviceSettings.clock || createDefaultDeviceSettings().clock;
    if (clockModeSelect.value === 'automatic') {
      if (dstBox) dstBox.hidden = true;
      saveClockConfiguration({
        mode: 'automatic',
        timeZoneMode: tzModeSelect?.value || currentClock.timeZoneMode,
        timeZone: manualTzSelect?.value || currentClock.timeZone,
        offsetSeconds: 0,
      });
    }
  });

  resetAutoClockBtn?.addEventListener('click', () => {
    if (clockModeSelect) {
      clockModeSelect.value = 'automatic';
      uiSelectControls.get('clockModeSelect')?.refresh();
    }
    if (dstBox) dstBox.hidden = true;
    const currentClock = state.deviceSettings.clock || createDefaultDeviceSettings().clock;
    saveClockConfiguration({
      mode: 'automatic',
      timeZoneMode: tzModeSelect?.value || currentClock.timeZoneMode,
      timeZone: manualTzSelect?.value || currentClock.timeZone,
      offsetSeconds: 0,
    });
  });

  applyManualClockBtn?.addEventListener('click', async () => {
    const clockStatus = document.getElementById('clockStatusText');
    const rawDate = manualDateInput?.value || '';
    const rawTime = manualTimeInput?.value || '00:00:00';
    const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = rawTime.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (!dateMatch || !timeMatch) {
      if (clockStatus) setText(clockStatus, '请输入有效的目标日期 (YYYY-MM-DD) 与时间 (HH:MM:SS)');
      return;
    }

    const effectiveZone = getEffectiveSelectedTimeZone();
    const parsed = parseWallTimeInTimeZone(
      {
        year: Number(dateMatch[1]),
        month: Number(dateMatch[2]),
        day: Number(dateMatch[3]),
        hour: Number(timeMatch[1]),
        minute: Number(timeMatch[2]),
        second: Number(timeMatch[3] || 0),
      },
      effectiveZone
    );

    if (parsed.status === 'invalid') {
      if (clockStatus) setText(clockStatus, parsed.message || '输入的日期时间不合法');
      return;
    }

    let targetEpochMs = parsed.epochMs;

    if ((parsed.status === 'ambiguous' || parsed.status === 'nonexistent') && dstBox && dstOptionsList && dstWarnText) {
      setText(dstWarnText, parsed.message);
      clearElement(dstOptionsList);
      const initialVal =
        state.selectedDstEpochMs && parsed.candidates.some(c => c.epochMs === state.selectedDstEpochMs)
          ? String(state.selectedDstEpochMs)
          : String(parsed.candidates[0]?.epochMs ?? '');
      const choiceGroup = createChoiceGroup({
        name: 'dstCandidate',
        ariaLabel: '夏令时时刻消歧选项',
        value: initialVal,
        options: parsed.candidates.map(cand => ({
          value: String(cand.epochMs),
          label: cand.label || cand.offsetLabel,
        })),
        onChange: (nextVal) => {
          state.selectedDstEpochMs = Number(nextVal);
        },
      });
      dstOptionsList.appendChild(choiceGroup.element);
      dstBox.hidden = false;
      if (state.selectedDstEpochMs && parsed.candidates.some(c => c.epochMs === state.selectedDstEpochMs)) {
        targetEpochMs = state.selectedDstEpochMs;
      }
    } else if (dstBox) {
      dstBox.hidden = true;
      state.selectedDstEpochMs = null;
    }

    let serverEpochMs = clockController.getServerEpochMs();
    try {
      const freshTime = await featureClient.getTime(getBrowserTimeZone());
      if (typeof freshTime?.serverEpochMs === 'number') {
        serverEpochMs = freshTime.serverEpochMs;
      }
    } catch {
      // Use local calibrated serverEpochMs fallback if offline
    }

    const offsetSeconds = Math.round((targetEpochMs - serverEpochMs) / 1000);
    if (Math.abs(offsetSeconds) > 315576000) {
      if (clockStatus) setText(clockStatus, '手动校时范围不能超过 ±10 年（±315576000 秒）');
      return;
    }

    if (clockModeSelect) {
      clockModeSelect.value = 'manual';
      uiSelectControls.get('clockModeSelect')?.refresh();
    }
    const currentClock = state.deviceSettings.clock || createDefaultDeviceSettings().clock;
    await saveClockConfiguration({
      mode: 'manual',
      timeZoneMode: tzModeSelect?.value || currentClock.timeZoneMode,
      timeZone: manualTzSelect?.value || currentClock.timeZone,
      offsetSeconds,
    });
  });

  const retryAllBtn = document.getElementById('retryAllSyncBtn');
  retryAllBtn?.addEventListener('click', async () => {
    await featureClient.flushWidgetsOutbox();
    await refreshEnvironmentAndWeather(true);
    updateSyncDiagnosticsUI();
  });

  navigationBackupController.bindDOMEvents();
}

// ==========================================================================
// Modals: Unified Add Website/Widget, Add/Rename Navigation Page, Settings Modal
// ==========================================================================
function populateCategorySelectInModal(selectedPageId) {
  const select = document.getElementById('siteCategorySelect');
  if (!select) return;
  clearElement(select);
  const selectablePages = state.pages.slice();
  selectablePages.forEach((page) => {
    const labelText =
      page.id === 'all'
        ? `${page.title} (全部主页)`
        : page.isSystem
          ? page.title
          : `${page.title} (自定义导航页)`;
    const opt = el('option', {
      value: page.id,
      textContent: labelText,
    });
    if (selectedPageId && page.id === selectedPageId) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  if (selectedPageId && selectablePages.some(p => p.id === selectedPageId)) {
    select.value = selectedPageId;
  } else if (selectablePages.length > 0) {
    select.value = selectablePages[0].id;
  }
  uiSelectControls.get('siteCategorySelect')?.refresh();
}

function switchAddModalMode(mode = 'site') {
  const normalizedMode = mode === 'widget' ? 'widget' : 'site';
  state.activeAddModalMode = normalizedMode;

  const siteForm = document.getElementById('addSiteForm');
  const widgetPanel = document.getElementById('addWidgetPanel');
  const saveSiteBtn = document.getElementById('saveSiteBtn');
  const modalTitle = document.getElementById('addModalTitle');

  document.querySelectorAll('#addModalModeSwitch [data-add-mode]').forEach((btn) => {
    const active = btn.dataset.addMode === normalizedMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  if (siteForm) siteForm.hidden = normalizedMode !== 'site';
  if (widgetPanel) widgetPanel.hidden = normalizedMode !== 'widget';
  if (saveSiteBtn) saveSiteBtn.hidden = normalizedMode !== 'site';
  if (modalTitle) {
    setText(modalTitle, normalizedMode === 'widget' ? '添加小组件到桌面' : '添加快捷网站');
  }

  if (normalizedMode === 'widget') {
    renderAddWidgetModalList();
  }
}

const ADD_WIDGET_DESCRIPTIONS = Object.freeze({
  'clock-weather': '时间、实况天气与逐小时预报',
  'focus-timer': '番茄专注与休息计时',
  'quick-note': '随手记录，自动同步',
  todo: '共享待办清单',
  calendar: '月历速览、日期标记、节假日与到期待办',
  'world-clock': '多城市时间对照',
  'weather-badge': '实况温度与天气图标',
  'date-tile': '突出今天的日期与星期',
  'focus-launcher': '一键开始或停止专注',
  countdown: '距离重要日子的天数',
  habits: '每日习惯打卡与七天进度',
  'today-dashboard': '天气、待办与最近倒数一览',
  'weather-strip': '未来六小时天气横条',
  'currency-converter': '按国家/地区检索全球汇率，支持热门货币快选',
});

function renderAddWidgetModalList() {
  const listEl = document.getElementById('availableWidgetsToAddList');
  const hintEl =
    document.getElementById('addWidgetPanelHint') || document.getElementById('addWidgetPanelDesc');
  if (!listEl) return;
  clearElement(listEl);

  const currentPage = state.pages[state.currentPageIndex] || state.pages[0] || { id: 'all', title: '全部' };
  if (hintEl) {
    setText(hintEl, `选择一个未在桌面显示的小组件，添加后将追加到「${currentPage.title}」页末尾。`);
  }

  const defs = state.widgetRegistry.length ? state.widgetRegistry : DEFAULT_WIDGET_DEFINITIONS;
  const defMap = new Map(defs.map(d => [d.type, d]));
  const hasLocalRenderer = (type) => !(WIDGET_MODULE_MAP instanceof Map) || WIDGET_MODULE_MAP.size === 0 || WIDGET_MODULE_MAP.has(type);
  const layout = normalizeWidgetLayout(state.widgetState.layout, state.widgetRegistry);
  const layoutTypes = new Set(layout.map(item => item.type));
  const layoutFull = layout.length >= MAX_WIDGET_LAYOUT_ENTRIES;

  // Existing disabled rows (re-enable keeps config/data) + never-added opt-in definitions
  const candidates = [
    ...layout
      .filter(item => !item.enabled && hasLocalRenderer(item.type))
      .map(item => ({ key: item.id, type: item.type, isNew: false, row: item })),
    ...defs
      .filter(
        d =>
          d &&
          d.defaultEnabled === false &&
          !d.importOnly &&
          !layoutTypes.has(d.type) &&
          hasLocalRenderer(d.type)
      )
      .map(d => ({ key: d.type, type: d.type, isNew: true, row: null })),
  ];

  if (candidates.length === 0) {
    const placedCount = layout.filter(item => item.enabled).length;
    listEl.appendChild(
      el(
        'div',
        { className: 'widget-empty-hint add-widget-empty-state' },
        `全部 ${placedCount} 个可用小组件均已放置在桌面上。如需移到当前页，可在编辑模式将小组件拖动到屏幕边缘或分类标签切换页面。`
      )
    );
    return;
  }

  if (layoutFull && candidates.some(c => c.isNew)) {
    listEl.appendChild(
      el('div', {
        className: 'widget-empty-hint add-widget-limit-hint',
        role: 'note',
        textContent: `小组件记录已达 ${MAX_WIDGET_LAYOUT_ENTRIES} 个上限：可重新启用已有组件；新增类型前请先在设置或备份中清理不再使用的组件。`,
      })
    );
  }

  candidates.forEach(({ key, type, isNew, row }) => {
    const def = defMap.get(type) || { title: type, capabilities: [] };
    const displayTitle = row ? getWidgetDisplayTitle(row) : def.title || type;
    const blocked = isNew && layoutFull;
    const supported = getSupportedSizesForWidgetType(type, state.widgetRegistry);
    const sizePreview = WIDGET_SIZE_OPTIONS.filter(opt => supported.includes(opt.value))
      .map(opt => opt.shortLabel)
      .join(' / ');
    const description =
      type === 'imported-card'
        ? '本地导入的组件卡片'
        : ADD_WIDGET_DESCRIPTIONS[type] || '';
    const subText = [
      description,
      sizePreview ? `尺寸 ${sizePreview}` : '',
      isNew ? '新组件' : '保留原有配置与数据',
    ]
      .filter(Boolean)
      .join(' · ');
    const addBtn = el('button', {
      type: 'button',
      className: 'ios-btn primary add-widget-action-btn',
      dataset: { addWidgetId: key },
      disabled: blocked,
      'aria-label': `添加 ${displayTitle} 至「${currentPage.title}」`,
      textContent: blocked ? '已达上限' : '添加至当前页',
    });
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      gestureBlockBlankExit = true;
      if (blocked) return;
      addWidgetToCurrentPage(key);
    });

    const card = el(
      'div',
      {
        className: `add-widget-card${blocked ? ' is-blocked' : ''}`,
        dataset: { widgetId: key, widgetType: type, widgetNew: isNew ? 'true' : 'false' },
      },
      el(
        'div',
        { className: 'add-widget-card-info' },
        el('div', { className: 'add-widget-card-title', textContent: displayTitle }),
        el('div', { className: 'add-widget-card-sub', textContent: subText })
      ),
      addBtn
    );
    listEl.appendChild(card);
  });
}

function addWidgetToCurrentPage(widgetId) {
  const currentPage = state.pages[state.currentPageIndex] || state.pages[0] || { id: 'all' };
  const res = enableWidgetOnPage(
    {
      layout: state.widgetState.layout,
      desktop: getEffectiveDesktopForRender(),
    },
    {
      widgetId,
      pageId: currentPage.id,
      definitions: state.widgetRegistry,
    }
  );
  if (res?.added === false) {
    // Impossible add (unknown type or 24-entry cap): no persist, just refresh the picker explanation
    renderAddWidgetModalList();
    return;
  }
  commitDesktopAndLayout(res.desktop, res.layout);
  renderAddWidgetModalList();
}

function openAddSiteModalForPage(pageId, initialMode = 'site') {
  const addModal = document.getElementById('addSiteModal');
  if (!addModal) return;
  closeAllPopovers();
  const targetPageId = pageId || state.pages[state.currentPageIndex]?.id || 'all';
  populateCategorySelectInModal(targetPageId);
  switchAddModalMode(initialMode);
  addModal.hidden = false;
  if (initialMode === 'site') {
    document.getElementById('siteTitleInput')?.focus();
  }
}

function openAddPageModal() {
  const modal = document.getElementById('addPageModal');
  if (!modal) return;
  closeAllPopovers();
  state.editingPageId = null;
  const headerTitle = modal.querySelector('.modal-header h3');
  const saveBtn = document.getElementById('savePageBtn');
  const titleInput = document.getElementById('pageTitleInput');
  if (headerTitle) setText(headerTitle, '新建导航页');
  if (saveBtn) setText(saveBtn, '创建页面');
  if (titleInput) titleInput.value = '';
  uiSelectControls.get('pageIconSelect')?.refresh();
  modal.hidden = false;
  titleInput?.focus();
}

function openRenamePageModal(pageId) {
  const modal = document.getElementById('addPageModal');
  const page = state.pages.find(p => p.id === pageId);
  if (!modal || !page) return;
  closeAllPopovers();
  state.editingPageId = page.id;
  const headerTitle = modal.querySelector('.modal-header h3');
  const saveBtn = document.getElementById('savePageBtn');
  const titleInput = document.getElementById('pageTitleInput');
  const iconSelect = document.getElementById('pageIconSelect');
  if (headerTitle) setText(headerTitle, `重命名「${page.title}」`);
  if (saveBtn) setText(saveBtn, '保存修改');
  if (titleInput) titleInput.value = page.title;
  if (iconSelect && page.icon) iconSelect.value = page.icon;
  uiSelectControls.get('pageIconSelect')?.refresh();
  modal.hidden = false;
  titleInput?.focus();
  titleInput?.select?.();
}

function openApiConfigModal(tabName = 'location') {
  const modal = document.getElementById('apiConfigModal');
  if (!modal) return;
  closeAllPopovers();
  toggleCustomizeSheet(false);
  closeWidgetDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
  closeCategoryOverflowModal({ recalibrateAfterClose: false });
  closeFolderDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
  syncSettingsControlsFromState();
  switchSettingsTab(tabName);
  modal.hidden = false;
  document.getElementById('closeApiModalBtn')?.focus?.({ preventScroll: true });
}

function initEditAndModals() {
  const editBtn = document.getElementById('toggleEditModeBtn');
  const openSettingsTopBtn = document.getElementById('openSettingsModalBtn');
  const openAddSiteBtn = document.getElementById('openAddModalBtn');
  const closeAddSiteBtn = document.getElementById('closeAddModalBtn');
  const saveSiteBtn = document.getElementById('saveSiteBtn');
  const addSiteModal = document.getElementById('addSiteModal');
  const addSiteForm = document.getElementById('addSiteForm');

  const openAddPageBtnTop = document.getElementById('openAddPageModalBtn');
  const openAddPageBtnBottom = document.getElementById('bottomAddPageBtn');
  const closeAddPageBtn = document.getElementById('closeAddPageModalBtn');
  const savePageBtn = document.getElementById('savePageBtn');
  const addPageModal = document.getElementById('addPageModal');
  const addPageForm = document.getElementById('addPageForm');

  const closeApiBtn = document.getElementById('closeApiModalBtn');
  const checkApiBtn = document.getElementById('saveApiConfigBtn');
  const apiModal = document.getElementById('apiConfigModal');

  const widgetDetailModal = document.getElementById('widgetDetailModal');
  const closeWidgetDetailBtn = document.getElementById('closeWidgetDetailModalBtn');
  const categoryOverflowModal = document.getElementById('categoryOverflowModal');
  const closeCategoryOverflowBtn = document.getElementById('closeCategoryOverflowModalBtn');
  const folderDetailModal = document.getElementById('folderDetailModal');
  const closeFolderDetailBtn = document.getElementById('closeFolderDetailModalBtn');
  const folderRenameForm = document.getElementById('folderRenameForm');
  const saveFolderTitleBtn = document.getElementById('saveFolderTitleBtn');
  const cancelFolderTitleBtn = document.getElementById('cancelFolderTitleBtn');
  const dissolveFolderBtn = document.getElementById('dissolveFolderBtn');

  document.querySelectorAll('[data-mobile-mode]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      setMobileDisplayMode(btn.dataset.mobileMode);
    });
  });

  if (closeFolderDetailBtn) {
    closeFolderDetailBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      closeFolderDetailModal();
    });
  }
  if (folderDetailModal) {
    folderDetailModal.addEventListener('click', (e) => {
      if (e.target === folderDetailModal) {
        e.stopPropagation();
        gestureBlockBlankExit = true;
        closeFolderDetailModal();
      }
    });
  }
  if (folderRenameForm) {
    folderRenameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      handleFolderRenameSubmit();
    });
  }
  if (saveFolderTitleBtn) {
    saveFolderTitleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      handleFolderRenameSubmit();
    });
  }
  if (cancelFolderTitleBtn) {
    cancelFolderTitleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      handleFolderRenameCancel();
    });
  }
  if (dissolveFolderBtn) {
    dissolveFolderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      if (state.activeFolderDetailId) {
        handleDissolveFolder(state.activeFolderDetailId);
      }
    });
  }

  if (closeWidgetDetailBtn) {
    closeWidgetDetailBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      closeWidgetDetailModal();
    });
  }
  if (widgetDetailModal) {
    widgetDetailModal.addEventListener('click', (e) => {
      if (e.target === widgetDetailModal) {
        e.stopPropagation();
        gestureBlockBlankExit = true;
        closeWidgetDetailModal();
      }
    });
  }

  if (closeCategoryOverflowBtn) {
    closeCategoryOverflowBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      closeCategoryOverflowModal();
    });
  }
  if (categoryOverflowModal) {
    categoryOverflowModal.addEventListener('click', (e) => {
      if (e.target === categoryOverflowModal) {
        e.stopPropagation();
        gestureBlockBlankExit = true;
        closeCategoryOverflowModal();
      }
    });
  }

  let lastMeasuredViewportWidth = getViewportDimensions().width;
  let resizeRafId = null;
  const handleViewportResize = () => {
    if (resizeRafId !== null) return;
    const schedule =
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    resizeRafId = schedule(() => {
      resizeRafId = null;
      const { width } = getViewportDimensions();
      const widthChanged = Math.abs(width - lastMeasuredViewportWidth) >= 2;
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      const activeTag = activeEl?.tagName?.toLowerCase?.() || '';
      const isWidgetDetailOpen = Boolean(
        activeWidgetDetailRestore ||
          state.activeWidgetDetailId ||
          (widgetDetailModal && !widgetDetailModal.hidden)
      );
      const isEditingModalInput =
        (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') &&
        Boolean(
          activeEl?.closest?.(
            '#widgetDetailModal, #folderDetailModal, #apiConfigModal, #addSiteModal, #addPageModal, #categoryOverflowModal, .customize-sheet'
          )
        );
      if (!widthChanged && (isWidgetDetailOpen || isEditingModalInput || isAnyModalOrDetailOpen())) {
        return;
      }
      lastMeasuredViewportWidth = width;

      if (desktopPointerDragController?.isDragging?.()) {
        desktopPointerDragController.cancelDrag();
      }
      const prevCols = state.singleScreenMetrics?.columns;
      const prevRows = state.singleScreenMetrics?.maxRows;
      const prevMode = state.effectiveDisplayMode;
      const prevRowHeight = state.singleScreenMetrics?.rowHeight;
      syncDisplayModeAndMetricsToDOM();
      const nextCols = state.singleScreenMetrics?.columns;
      const nextRows = state.singleScreenMetrics?.maxRows;
      const nextMode = state.effectiveDisplayMode;
      const nextRowHeight = state.singleScreenMetrics?.rowHeight;
      if (
        prevCols !== nextCols ||
        prevRows !== nextRows ||
        prevMode !== nextMode ||
        prevRowHeight !== nextRowHeight
      ) {
        if (activeWidgetDetailRestore || state.activeWidgetDetailId) {
          closeWidgetDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
        }
        const currentCategoryPageId = state.pages[state.currentPageIndex]?.id || 'all';
        renderSpringBoardTrack({ preserveCategoryPageId: currentCategoryPageId });
        renderPaginationDots();
      }
      updatePageTurnTransform();
    });
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleViewportResize, { passive: true });
    window.addEventListener('orientationchange', handleViewportResize, { passive: true });
    window.visualViewport?.addEventListener?.('resize', handleViewportResize, { passive: true });
    if (typeof window.ResizeObserver === 'function') {
      const vpEl = document.getElementById('springboardViewport');
      if (vpEl) {
        const ro = new window.ResizeObserver(() => {
          if (isAnyModalOrDetailOpen()) return;
          schedulePostRenderGridCalibration();
        });
        ro.observe(vpEl);
      }
    }
  }

  if (editBtn) {
    editBtn.addEventListener('click', () => setJiggleMode(!state.jiggleMode));
  }
  if (openSettingsTopBtn) {
    openSettingsTopBtn.addEventListener('click', () => openApiConfigModal('location'));
  }

  document.querySelectorAll('#addModalModeSwitch [data-add-mode]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      gestureBlockBlankExit = true;
      switchAddModalMode(btn.dataset.addMode);
    });
  });

  if (openAddSiteBtn) {
    openAddSiteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      gestureBlockBlankExit = true;
      const currentPage = state.pages[state.currentPageIndex];
      const defaultPageId = currentPage ? currentPage.id : 'all';
      openAddSiteModalForPage(defaultPageId, 'site');
    });
  }
  if (closeAddSiteBtn && addSiteModal) {
    closeAddSiteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      gestureBlockBlankExit = true;
      closeAllPopovers();
      addSiteModal.hidden = true;
      schedulePostRenderGridCalibration();
    });
  }
  if (addSiteModal) {
    addSiteModal.addEventListener('click', (e) => {
      if (e.target === addSiteModal) {
        e.stopPropagation();
        gestureBlockBlankExit = true;
        closeAllPopovers();
        addSiteModal.hidden = true;
        schedulePostRenderGridCalibration();
      }
    });
  }
  if (addPageModal) {
    addPageModal.addEventListener('click', (e) => {
      if (e.target === addPageModal) {
        e.stopPropagation();
        gestureBlockBlankExit = true;
        closeAllPopovers();
        state.editingPageId = null;
        addPageModal.hidden = true;
        schedulePostRenderGridCalibration();
      }
    });
  }
  if (apiModal) {
    apiModal.addEventListener('click', (e) => {
      if (e.target === apiModal) {
        e.stopPropagation();
        gestureBlockBlankExit = true;
        closeAllPopovers();
        apiModal.hidden = true;
        schedulePostRenderGridCalibration();
      }
    });
  }
  if (saveSiteBtn && addSiteForm) {
    saveSiteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      handleAddSiteSubmit();
    });
    addSiteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      gestureBlockBlankExit = true;
      handleAddSiteSubmit();
    });
  }

  if (openAddPageBtnTop) openAddPageBtnTop.addEventListener('click', () => openAddPageModal());
  if (openAddPageBtnBottom) openAddPageBtnBottom.addEventListener('click', () => openAddPageModal());
  if (closeAddPageBtn && addPageModal) {
    closeAddPageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      gestureBlockBlankExit = true;
      closeAllPopovers();
      state.editingPageId = null;
      addPageModal.hidden = true;
      schedulePostRenderGridCalibration();
    });
  }
  if (savePageBtn && addPageForm) {
    savePageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      gestureBlockBlankExit = true;
      handleAddPageSubmit();
    });
    addPageForm.addEventListener('submit', (e) => {
      e.preventDefault();
      gestureBlockBlankExit = true;
      handleAddPageSubmit();
    });
  }

  if (closeApiBtn && apiModal) {
    closeApiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      gestureBlockBlankExit = true;
      closeAllPopovers();
      apiModal.hidden = true;
      schedulePostRenderGridCalibration();
    });
  }
  if (checkApiBtn) {
    checkApiBtn.addEventListener('click', async () => {
      await refreshEnvironmentAndWeather(true);
      updateSyncDiagnosticsUI();
    });
  }

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('hapticContextMenu');
    if (menu && !menu.hidden && !menu.contains(e.target)) closeContextMenu();
    const popover = document.getElementById('enginePopover');
    const engBtn = document.getElementById('engineSelectorBtn');
    if (popover && !popover.hidden && !popover.contains(e.target) && !engBtn?.contains(e.target)) {
      popover.hidden = true;
    }
  });

  document.querySelectorAll('#hapticContextMenu .context-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const site = state.sites.find(s => s.id === state.contextTargetId);
      if (!site) return;

      const validUrl = safeHttpUrl(site.url);
      if (action === 'open' && validUrl) {
        window.open(validUrl, '_blank', 'noopener,noreferrer');
      } else if (action === 'dock') {
        site.pinned = !site.pinned;
        saveSitesToStorage(BACKEND_SUPPORTED_CATEGORIES.has(site.category));
        renderDock();
      } else if (action === 'copy' && validUrl) {
        navigator.clipboard?.writeText(validUrl);
      } else if (action === 'delete') {
        removeSiteById(site.id);
      }
      closeContextMenu();
    });
  });
}

function handleAddPageSubmit() {
  const titleInput = document.getElementById('pageTitleInput');
  const iconSelect = document.getElementById('pageIconSelect');
  const modal = document.getElementById('addPageModal');

  const title = titleInput?.value.trim();
  if (!title) return;

  if (state.editingPageId) {
    const targetPageId = state.editingPageId;
    state.editingPageId = null;
    const nextDesktop = renameDesktopPage(getEffectiveDesktopForRender(), {
      pageId: targetPageId,
      title: title.slice(0, 14),
      icon: iconSelect?.value || 'sparkles',
    });
    if (titleInput) titleInput.value = '';
    if (modal) modal.hidden = true;
    commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
    return;
  }

  const newPage = {
    id: `page_${Date.now()}`,
    title: title.slice(0, 14),
    icon: iconSelect?.value || 'sparkles',
    isSystem: false,
    order: state.pages.length,
  };
  const nextDesktop = addDesktopPage(getEffectiveDesktopForRender(), newPage);

  if (titleInput) titleInput.value = '';
  if (modal) modal.hidden = true;

  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
  const targetIdx = state.pages.findIndex(p => p.id === newPage.id);
  if (targetIdx !== -1) {
    requestAnimationFrame(() => {
      goToPage(targetIdx);
    });
  }
}

function deleteNavigationPage(pageId) {
  const idx = state.pages.findIndex(p => p.id === pageId);
  if (idx === -1 || state.pages[idx].isSystem) return;

  let movedSiteCategoryCount = 0;
  state.sites.forEach((s) => {
    if (s.category === pageId) {
      s.category = 'ai';
      movedSiteCategoryCount += 1;
    }
  });

  const nextDesktop = deleteDesktopPage(getEffectiveDesktopForRender(), pageId);

  if (movedSiteCategoryCount > 0) {
    saveSitesToStorage(true);
  }
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
}

function handleAddSiteSubmit() {
  const titleInput = document.getElementById('siteTitleInput');
  const urlInput = document.getElementById('siteUrlInput');
  const catSelect = document.getElementById('siteCategorySelect');
  const colorInput = document.getElementById('siteColorInput');
  const modal = document.getElementById('addSiteModal');

  const title = titleInput?.value.trim();
  let rawUrl = urlInput?.value.trim();
  if (!title || !rawUrl) return;
  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = `https://${rawUrl}`;
  }
  const validatedUrl = safeHttpUrl(rawUrl);
  if (!validatedUrl) return;

  const hex = safeHexColor(colorInput?.value, '#007aff');
  const targetPageId = catSelect?.value || state.pages[state.currentPageIndex]?.id || 'all';
  const siteCategory = targetPageId === 'all' ? 'ai' : targetPageId;

  const newSite = {
    id: `custom_${Date.now()}`,
    title: title.slice(0, 100),
    url: validatedUrl,
    category: siteCategory,
    gradient: `linear-gradient(180deg, ${hex} 0%, #1c1c1e 140%)`,
    accent: hex,
    pinned: false,
    keywords: `${title} ${validatedUrl}`.slice(0, 300),
  };

  state.sites.unshift(newSite);
  const isBackendSupportedCat = BACKEND_SUPPORTED_CATEGORIES.has(siteCategory);
  saveSitesToStorage(isBackendSupportedCat);

  const nextDesktop = addSitePlacement(getEffectiveDesktopForRender(), {
    siteId: newSite.id,
    pageId: targetPageId,
  });

  if (titleInput) titleInput.value = '';
  if (urlInput) urlInput.value = '';
  if (modal) modal.hidden = true;

  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
  const targetPageIdx = state.pages.findIndex(p => p.id === targetPageId);
  if (targetPageIdx !== -1 && state.currentPageIndex !== targetPageIdx) {
    goToPage(targetPageIdx);
  }
}

function commitDesktopItemBefore({
  fromPageId,
  toPageId,
  kind,
  id,
  beforeKind = null,
  beforeId = null,
}) {
  const nextDesktop = placeDesktopItemBefore(getEffectiveDesktopForRender(), {
    fromPageId,
    toPageId,
    kind,
    id,
    beforeKind,
    beforeId,
  });
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
}

function handleDropOnDesktopCard({
  fromPageId,
  toPageId,
  draggedKind,
  draggedId,
  targetKind,
  targetId,
  beforeKind = undefined,
  beforeId = undefined,
}) {
  const currentDesktop = getEffectiveDesktopForRender();
  if (beforeKind !== undefined || beforeId !== undefined) {
    const nextDesktop = placeDesktopItemBefore(currentDesktop, {
      fromPageId,
      toPageId,
      kind: draggedKind,
      id: draggedId,
      beforeKind,
      beforeId,
    });
    commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
    return;
  }
  if (fromPageId === toPageId) {
    const nextDesktop = reorderPlacementInPage(currentDesktop, {
      pageId: toPageId,
      draggedKind,
      draggedId,
      targetKind,
      targetId,
    });
    commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
  } else {
    const nextDesktop = movePlacementToPage(currentDesktop, {
      fromPageId,
      toPageId,
      kind: draggedKind,
      id: draggedId,
      targetKind,
      targetId,
    });
    commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
  }
}

function stepDesktopItemInPage(pageId, kind, id, delta) {
  const nextDesktop = stepPlacementInPage(
    getEffectiveDesktopForRender(),
    {
      pageId,
      kind,
      id,
      delta,
    },
    {
      sites: state.sites,
      layout: state.widgetState.layout,
    }
  );
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
}

function moveDesktopItemToPage({
  fromPageId,
  toPageId,
  kind,
  id,
  targetKind = null,
  targetId = null,
  beforeTarget = null,
}) {
  const nextDesktop = movePlacementToPage(getEffectiveDesktopForRender(), {
    fromPageId,
    toPageId,
    kind,
    id,
    targetKind: targetKind || beforeTarget?.kind || null,
    targetId: targetId || beforeTarget?.id || null,
  });
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
}

function removeWidgetFromDesktop(widgetId) {
  const res = disableWidget(
    {
      layout: state.widgetState.layout,
      desktop: getEffectiveDesktopForRender(),
    },
    widgetId,
    {
      definitions: state.widgetRegistry,
    }
  );
  widgetHost.destroyWidget?.(widgetId);
  commitDesktopAndLayout(res.desktop, res.layout);
  if (state.activeAddModalMode === 'widget') {
    renderAddWidgetModalList();
  }
}

function setJiggleMode(enabled) {
  state.jiggleMode = Boolean(enabled);
  clearActiveLongPress();
  if (!state.jiggleMode) {
    desktopPointerDragController?.cancelDrag?.();
    closeMovePagePopover();
  }
  if (enabled && typeof cancelActivePageDrag === 'function') {
    cancelActivePageDrag();
  }
  document.body.classList.toggle('jiggle-mode', state.jiggleMode);
  document.querySelectorAll('.app-item, .ios-widget').forEach((elNode) => {
    elNode.draggable = Boolean(state.jiggleMode);
  });
  document
    .querySelectorAll('.delete-badge, .widget-size-btn, .site-size-toggle')
    .forEach((btn) => {
      btn.disabled = !state.jiggleMode;
    });
  const openAddBtn = document.getElementById('openAddModalBtn');
  if (openAddBtn) {
    openAddBtn.hidden = !state.jiggleMode;
  }
  const editBtn = document.getElementById('toggleEditModeBtn');
  const editText = document.getElementById('editModeBtnText');
  if (editBtn) editBtn.classList.toggle('active-pill', state.jiggleMode);
  if (editText) setText(editText, state.jiggleMode ? '完成' : '编辑');
}

function openContextMenu(x, y, site) {
  state.contextTargetId = site.id;
  const menu = document.getElementById('hapticContextMenu');
  const titleEl = document.getElementById('contextSiteTitle');
  const urlEl = document.getElementById('contextSiteUrl');
  const dockLabel = document.getElementById('contextDockLabel');
  if (!menu) return;

  if (titleEl) setText(titleEl, site.title);
  if (urlEl) setText(urlEl, String(site.url || '').replace(/^https?:\/\//, ''));
  if (dockLabel) setText(dockLabel, site.pinned ? '从程序坞移除' : '固定到程序坞');

  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const safeX = Math.min(x, window.innerWidth - rect.width - 14);
  const safeY = Math.min(y, window.innerHeight - rect.height - 14);
  menu.style.left = `${Math.max(12, safeX)}px`;
  menu.style.top = `${Math.max(12, safeY)}px`;
}

function closeContextMenu() {
  const menu = document.getElementById('hapticContextMenu');
  if (menu) menu.hidden = true;
  state.contextTargetId = null;
}

function removeSiteById(id) {
  const target = state.sites.find(s => s.id === id);
  state.sites = state.sites.filter(s => s.id !== id);
  const shouldSync = !target || BACKEND_SUPPORTED_CATEGORIES.has(target.category);
  saveSitesToStorage(shouldSync);
  const nextDesktop = removeSitePlacements(getEffectiveDesktopForRender(), id);
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
  renderDock();
}

function reorderSites(draggedId, targetId, pageId = state.pages[state.currentPageIndex]?.id || 'all') {
  const nextDesktop = reorderPlacementInPage(getEffectiveDesktopForRender(), {
    pageId,
    draggedKind: 'site',
    draggedId,
    targetKind: 'site',
    targetId,
  });
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
}

function stepSiteInFolder(folderId, siteId, delta) {
  if (!folderId || !siteId) return;
  const nextDesktop = reorderFolderSite(getEffectiveDesktopForRender(), {
    folderId,
    siteId,
    delta,
  });
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
}

function handleDissolveFolder(folderId) {
  if (!folderId) return;
  if (state.activeFolderDetailId === folderId) {
    closeFolderDetailModal({ restoreFocus: false, recalibrateAfterClose: false });
  }
  const nextDesktop = dissolveSiteFolder(getEffectiveDesktopForRender(), { folderId });
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
}

function handleFolderRenameSubmit() {
  const folderId = state.activeFolderDetailId;
  if (!folderId) return;
  const titleInput = document.getElementById('folderTitleInput');
  const statusEl = document.getElementById('folderRenameStatusText');
  const rawValue = typeof titleInput?.value === 'string' ? titleInput.value : '';
  const cleaned = rawValue
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .trim();

  if (!cleaned) {
    if (statusEl) {
      statusEl.hidden = false;
      setText(statusEl, '文件夹名称不能为空（需 1–60 个字符）');
    }
    titleInput?.focus?.();
    return;
  }
  const finalTitle = cleaned.slice(0, 60);
  if (statusEl) {
    statusEl.hidden = true;
    setText(statusEl, '');
  }
  const nextDesktop = renameSiteFolder(getEffectiveDesktopForRender(), {
    folderId,
    title: finalTitle,
  });
  commitDesktopAndLayout(nextDesktop, state.widgetState.layout);
}

function handleFolderRenameCancel() {
  const folderId = state.activeFolderDetailId;
  if (!folderId) return;
  const desktop = getEffectiveDesktopForRender();
  const folder = getFolderById(desktop, folderId);
  const titleInput = document.getElementById('folderTitleInput');
  const statusEl = document.getElementById('folderRenameStatusText');
  if (titleInput && folder) {
    titleInput.value = folder.title;
  }
  if (statusEl) {
    statusEl.hidden = true;
    setText(statusEl, '');
  }
}

// ==========================================================================
// Module Startup Entry (Placed at End of Module to Avoid Any TDZ Issues)
// ==========================================================================
function renderBootstrapErrorBanner(error) {
  const existing = document.getElementById('appBootstrapErrorBanner');
  if (existing) existing.remove();

  const retryBtn = el('button', {
    type: 'button',
    className: 'widget-inline-btn',
    id: 'retryBootstrapBtn',
    textContent: '重试启动',
  });
  retryBtn.addEventListener('click', () => {
    startApplication({ forceRetry: true });
  });

  const reloadBtn = el('button', {
    type: 'button',
    className: 'widget-inline-btn',
    id: 'reloadPageBootstrapBtn',
    textContent: '刷新页面',
  });
  reloadBtn.addEventListener('click', () => {
    window.location?.reload?.();
  });

  const banner = el(
    'div',
    {
      id: 'appBootstrapErrorBanner',
      className: 'bootstrap-error-banner',
      role: 'alert',
    },
    el('span', {
      className: 'bootstrap-error-text',
      textContent: `页面初始化遇到问题：${error?.message ? String(error.message) : '请点击重试或刷新页面'}`,
    }),
    el('div', { className: 'bootstrap-error-actions' }, retryBtn, reloadBtn)
  );

  const host = document.querySelector('.springboard-shell') || document.body;
  host?.prepend?.(banner);
}

function startApplication({ forceRetry = false } = {}) {
  if (hasBootstrapped && !forceRetry) {
    return bootstrapInFlight;
  }
  hasBootstrapped = true;
  const existingBanner = document.getElementById('appBootstrapErrorBanner');
  if (existingBanner) existingBanner.remove();

  bootstrapInFlight = Promise.resolve()
    .then(() => bootstrapApp())
    .catch((error) => {
      hasBootstrapped = false;
      console.error('[Bootstrap Error]', error);
      renderBootstrapErrorBanner(error);
    });

  return bootstrapInFlight;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        startApplication();
      },
      { once: true }
    );
  } else {
    startApplication();
  }
}

export {
  state,
  setJiggleMode,
  setMobileDisplayMode,
  openWidgetDetailModal,
  closeWidgetDetailModal,
  openCategoryOverflowModal,
  closeCategoryOverflowModal,
  openFolderDetailModal,
  closeFolderDetailModal,
  goToPage,
  goToView,
  createAppItemElement,
  createFolderItemElement,
  renderAll,
  bootstrapApp,
  startApplication,
  clockController,
  featureClient,
  widgetHost,
  localWallpaperController,
  navigationBackupController,
  notificationsUIController,
  WIDGET_MODULE_MAP,
};
