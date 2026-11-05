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
  createDefaultWidgetState,
  normalizeWidgetState,
  createDefaultDeviceSettings,
} from './lib/feature-client.js';
import {
  normalizePages,
  normalizeWidgetLayout,
  reconcileDesktopWithLayout,
  migrateLegacyDesktop,
  getPagePlacements,
  getFolderById,
  getRenderablePageItems,
  reorderPlacementInPage,
  stepPlacementInPage,
  movePlacementToPage,
  placeDesktopItemBefore,
  enableWidgetOnPage,
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
} from './lib/ui/index.js';
import { createWidgetHost, WIDGET_MODULE_MAP } from './widgets/registry.js';
import { createDesktopPointerDragController } from './lib/desktop-pointer-drag.js';
import { createFolderScrollController } from './lib/folder-pointer-scroll.js';
import { createDockOverflowController } from './lib/dock-overflow.js';
import {
  DISPLAY_MODES,
  MOBILE_DISPLAY_MODE_STORAGE_KEY,
  normalizeMobileDisplayMode,
  loadMobileDisplayMode,
  saveMobileDisplayMode,
  isMobileViewport,
  resolveEffectiveDisplayMode,
  computeSingleScreenMetrics,
  packCategoryItemsIntoViews,
  buildScreenViewsModel,
  resolveViewDropBeforeAnchor,
} from './lib/display-mode.js';

const STORAGE_KEYS = {
  PAGES: 'ios18_nav_pages_v1',
  SITES: 'ios18_nav_sites_v1',
  PREFS: 'ios18_nav_prefs_v1',
  NOTE: 'ios18_nav_quicknote_v1',
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
    state.widgetState.layout = state.widgetState.layout.map(item =>
      item.id === widgetItem.id ? { ...item, config: structuredClone(nextConfig) } : item
    );
    featureClient.saveWidgetsState({ layout: state.widgetState.layout });
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
      return clean;
    });
}

function getBackendSyncablePrefs(prefsObj = state.prefs) {
  return {
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

function getEffectiveDesktopForRender() {
  if (state.widgetState?.desktop && Array.isArray(state.widgetState.desktop.pages)) {
    return state.widgetState.desktop;
  }
  return migrateLegacyDesktop({
    pages: state.pages,
    sites: state.sites,
    layout: state.widgetState?.layout,
    definitions: state.widgetRegistry,
  }).desktop;
}

function finalizeDesktopMigrationOrReconcile(rawWidgetState, registry, { persist = true } = {}) {
  const defs = Array.isArray(registry) && registry.length > 0 ? registry : DEFAULT_WIDGET_DEFINITIONS;
  const normalized = normalizeWidgetStateWithRegistry(rawWidgetState, defs);

  if (normalized.desktop && typeof normalized.desktop === 'object') {
    const reconciled = reconcileDesktopWithLayout(normalized.desktop, normalized.layout, {
      fallbackPages: state.pages,
      definitions: defs,
    });
    const changed =
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
  const migrated = migrateLegacyDesktop({
    pages: state.pages,
    sites: state.sites,
    layout: normalized.layout,
    definitions: defs,
  });

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

  // Render initial local state without writing empty desktop before migration
  renderAll();

  // Connect with `window.PortalBackend` (`/api/state` for sites/prefs/note)
  if (window.PortalBackend) {
    const remoteState = await window.PortalBackend.load();
    if (remoteState !== null) {
      if (Array.isArray(remoteState.sites)) {
        const localCustomPageSites = state.sites.filter(
          s => !BACKEND_SUPPORTED_CATEGORIES.has(s.category)
        );
        const remoteIds = new Set(remoteState.sites.map(s => s.id));
        state.sites = [
          ...remoteState.sites,
          ...localCustomPageSites.filter(s => !remoteIds.has(s.id)),
        ];
        writeLocalStorage(STORAGE_KEYS.SITES, JSON.stringify(state.sites));
      }
      if (remoteState.prefs && typeof remoteState.prefs === 'object') {
        state.prefs = { ...state.prefs, ...remoteState.prefs };
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

  state.widgetRegistry = registry;
  state.deviceSettings = loadedDeviceSettings;
  state.availableTimeZones = timeZones;

  // Perform one-time migration if desktop is null, or reconcile existing desktop with layout
  finalizeDesktopMigrationOrReconcile(loadedWidgetState, registry, { persist: true });

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
        state.prefs = { ...state.prefs, ...parsedPrefs };
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
  writeLocalStorage(STORAGE_KEYS.PAGES, JSON.stringify(state.pages));
}

function saveSitesToStorage(syncToBackend = true) {
  writeLocalStorage(STORAGE_KEYS.SITES, JSON.stringify(state.sites));
  state.portalSyncStatus = { label: '本机已保存', hasError: false };
  updateSyncDiagnosticsUI();
  if (syncToBackend && window.PortalBackend) {
    window.PortalBackend.save({ sites: getBackendSyncableSites() });
  }
}

function savePrefsToStorage(syncToBackend = true) {
  writeLocalStorage(STORAGE_KEYS.PREFS, JSON.stringify(state.prefs));
  state.portalSyncStatus = { label: '本机已保存', hasError: false };
  updateSyncDiagnosticsUI();
  if (syncToBackend && window.PortalBackend) {
    window.PortalBackend.save({ prefs: getBackendSyncablePrefs() });
  }
}

function saveNoteToStorage(noteText, syncToBackend = true) {
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
function applyPreferencesToDOM() {
  const { iconMode, iconSize, wallpaper, wallpaperDimmed, tintHue, tintSat, focusActive } = state.prefs;
  document.body.setAttribute('data-icon-mode', iconMode);
  document.body.setAttribute('data-icon-size', iconSize);
  document.body.setAttribute('data-wallpaper', wallpaper);
  document.body.classList.toggle('wallpaper-dimmed', Boolean(wallpaperDimmed));

  document.documentElement.style.setProperty('--tint-h', tintHue);
  document.documentElement.style.setProperty('--tint-s', `${tintSat}%`);

  document.querySelectorAll('.mode-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === iconMode);
  });

  document.querySelectorAll('.size-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.size === iconSize);
  });

  document.querySelectorAll('.swatch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.wp === wallpaper);
  });

  const dimBtn = document.getElementById('dimWallpaperBtn');
  if (dimBtn) dimBtn.classList.toggle('active', Boolean(wallpaperDimmed));

  const hueRange = document.getElementById('tintHueRange');
  const satRange = document.getElementById('tintSatRange');
  if (hueRange) hueRange.value = tintHue;
  if (satRange) satRange.value = tintSat;

  const focusBtn = document.getElementById('focusModeToggle');
  const focusLabel = document.getElementById('focusLabel');
  if (focusBtn && focusLabel) {
    focusBtn.classList.toggle('focus-active', Boolean(focusActive));
    setText(focusLabel, focusActive ? '专注中 · 勿扰' : '个人专注');
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
    height: Math.max(480, height),
  };
}

function measureActualAvailableGridHeight() {
  if (typeof document === 'undefined') return null;
  const viewportEl = document.getElementById('springboardViewport');
  if (!viewportEl || typeof viewportEl.getBoundingClientRect !== 'function') return null;
  const viewportRect = viewportEl.getBoundingClientRect();
  if (!viewportRect || viewportRect.height < 180) return null;

  let viewportBottom = viewportRect.bottom;
  const paginationEl = document.querySelector('.springboard-pagination-wrap');
  if (paginationEl && typeof paginationEl.getBoundingClientRect === 'function') {
    const pagRect = paginationEl.getBoundingClientRect();
    if (pagRect.top > viewportRect.top + 120) {
      viewportBottom = Math.min(viewportBottom, pagRect.top - 2);
    }
  }
  const dockEl = document.getElementById('iosDock');
  if (dockEl && typeof dockEl.getBoundingClientRect === 'function') {
    const dockRect = dockEl.getBoundingClientRect();
    if (dockRect.top > viewportRect.top + 120) {
      viewportBottom = Math.min(viewportBottom, dockRect.top - 6);
    }
  }

  const usableViewportHeight = Math.max(0, Math.floor(viewportBottom - viewportRect.top));
  if (usableViewportHeight < 180) return null;

  const activePageEl =
    document.querySelector('.springboard-page.page-active') ||
    document.querySelector('.springboard-page');
  if (activePageEl) {
    const activeGridEl = activePageEl.querySelector('.apps-grid.desktop-mixed-grid');
    if (activeGridEl && typeof activeGridEl.getBoundingClientRect === 'function') {
      const gridRect = activeGridEl.getBoundingClientRect();
      if (gridRect.top >= viewportRect.top - 4 && gridRect.height >= 160) {
        const directGridHeight = Math.floor(
          Math.min(viewportBottom - 2, gridRect.bottom) - gridRect.top
        );
        if (directGridHeight >= 180) {
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

  return Math.max(180, usableViewportHeight - pageChromeAllowance);
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
    }
  }
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

  // Measure actual DOM available height for the grid and refine metrics if measured
  const measuredAvailableGridHeight = measureActualAvailableGridHeight();
  const metrics =
    measuredAvailableGridHeight !== null
      ? computeSingleScreenMetrics({
          viewportWidth: width,
          viewportHeight: height,
          mobileDisplayMode: state.mobileDisplayMode,
          measuredAvailableGridHeight,
        })
      : initialMetrics;

  state.singleScreenMetrics = metrics;
  state.effectiveDisplayMode = metrics.effectiveMode;
  applyDisplayModeClassesAndVars(metrics);

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
  const title = def?.title || widgetItem.type || '小组件详情';
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
    const measured = measureActualAvailableGridHeight();
    if (measured === null) return;
    const prevAvail = state.singleScreenMetrics?.availableGridHeight || 0;
    const prevRows = state.singleScreenMetrics?.maxRows || 0;
    const prevRowHeight = state.singleScreenMetrics?.rowHeight || 0;
    if (Math.abs(measured - prevAvail) < 2) return;

    const { width, height } = getViewportDimensions();
    const nextMetrics = computeSingleScreenMetrics({
      viewportWidth: width,
      viewportHeight: height,
      mobileDisplayMode: state.mobileDisplayMode,
      measuredAvailableGridHeight: measured,
    });
    state.singleScreenMetrics = nextMetrics;
    state.effectiveDisplayMode = nextMetrics.effectiveMode;
    applyDisplayModeClassesAndVars(nextMetrics);

    if (nextMetrics.maxRows !== prevRows) {
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
  // Prefer explicit iconKey or exact-domain preset via window.AGYIcons; remaining sites keep .app-glyph-letter for extension favicon enhancement
  const presetKey =
    typeof site?.iconKey === 'string' && Object.hasOwn(ICONS, site.iconKey)
      ? site.iconKey
      : typeof window !== 'undefined' && typeof window.AGYIcons?.presetKey === 'function'
        ? window.AGYIcons.presetKey(site)
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
        '.delete-badge, .card-edit-actions, .card-edit-btn, .move-page-popover, input, textarea, select, [role="combobox"], .ui-select-wrap, .ui-datetime-field'
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
      if (pid !== null && desktopPointerDragController?.startFromLongPress) {
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

function createAppItemElement(
  site,
  idx,
  { pageId = null, viewId = null, folderId = null, itemIndex = idx, totalItems = 1 } = {}
) {
  const effectivePageId = pageId || state.pages[state.currentPageIndex]?.id || 'all';
  const validHref = safeHttpUrl(site.url);
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

function decorateWidgetCardForDesktop(
  root,
  widgetItem,
  { pageId, viewId = null, itemIndex = 0, totalItems = 1 }
) {
  const def = state.widgetRegistry.find((d) => d.type === widgetItem.type);
  const title = def?.title || widgetItem.type;

  const randomDelay = ((itemIndex % 5) * -0.05).toFixed(3);
  root.style.setProperty('--jiggle-delay', `${randomDelay}s`);
  root.setAttribute('tabindex', '0');
  root.setAttribute('role', 'button');
  root.setAttribute('aria-label', `${title} 小组件，点击查看完整详情`);

  const existingDel = root.querySelector(':scope > .delete-badge');
  if (existingDel) existingDel.remove();
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
    removeWidgetFromDesktop(widgetItem.id);
  });

  root.prepend(delBtn);
  root._latestWidgetItem = widgetItem;

  // Shield internal widget forms/links/buttons from interfering when in edit mode,
  // and open detail modal when clicking/pressing Enter on summary widget in normal mode
  if (!root.dataset.editShieldBound) {
    root.dataset.editShieldBound = 'true';
    const shieldEventInEditMode = (e) => {
      if (!state.jiggleMode) return;
      if (e.target.closest('.delete-badge, .card-edit-actions')) return;
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
          '.delete-badge, .card-edit-actions, .card-edit-btn, .move-page-popover'
        )
      ) {
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
      view.items.forEach((entry, idx) => {
        const categoryItemIndex = view.allCategoryItems.indexOf(entry);
        const effectiveIdx = categoryItemIndex !== -1 ? categoryItemIndex : idx;
        if (entry.kind === 'site') {
          grid.appendChild(
            createAppItemElement(entry.site, effectiveIdx, {
              pageId: page.id,
              viewId: view.viewId,
              itemIndex: effectiveIdx,
              totalItems: totalCategoryItems,
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
        'input, textarea, select, label, .ui-popover-portal, .ui-select-wrap, .ui-datetime-field, .ui-switch-wrap, .ui-checkbox-wrap, .delete-badge, .card-edit-actions, .springboard-pagination-wrap, .page-overflow-view-all-btn'
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
          '.ios-status-bar, .spotlight-section, .springboard-pagination-wrap, .ios-dock-container, .customize-sheet, .modal-backdrop, .haptic-context-menu, .move-page-popover, .ui-popover-portal, input, textarea, select, button, a, label'
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
      if (e.target.closest('.widgets-bento')) return;
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

function renderDock() {
  const dock = document.getElementById('iosDock');
  if (!dock) return;

  const prevSitesTrack = dock.querySelector('.dock-sites-strip');
  const prevScrollLeft = prevSitesTrack
    ? Number(prevSitesTrack.scrollLeft) || 0
    : Number(dock.scrollLeft) || 0;

  dockOverflowController?.destroy?.();
  dockOverflowController = null;

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

  const addPageDockBtn = el('button', {
    type: 'button',
    className: 'dock-item dock-action-btn',
    'aria-label': '新建导航页',
  });
  addPageDockBtn.style.background = 'transparent';
  addPageDockBtn.style.border = 'none';
  const addPageSq = el('div', { className: 'app-squircle' });
  addPageSq.style.setProperty('--app-gradient', 'linear-gradient(145deg, #0a84ff 0%, #30d158 100%)');
  addPageSq.style.setProperty('--app-accent', '#30d158');
  const addPageGlyph = el('div', { className: 'app-glyph' });
  addPageGlyph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>`;
  addPageSq.appendChild(addPageGlyph);
  addPageDockBtn.append(el('span', { className: 'dock-tooltip', textContent: '新建导航页' }), addPageSq);
  addPageDockBtn.addEventListener('click', () => openAddPageModal());
  fixedActions.appendChild(addPageDockBtn);

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
      state.prefs.focusActive = !state.prefs.focusActive;
      savePrefsToStorage();
      applyPreferencesToDOM();
    });
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
    const resolved = await featureClient.resolveEnvironment({
      browserTimeZone,
      coordinates: state.browserCoordinates || undefined,
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
  const island = document.getElementById('dynamicIsland');
  const islandSettingsBtn = document.getElementById('openSettingsFromIslandBtn');

  function syncEngineUI() {
    const eng = SEARCH_ENGINES[state.engineIndex];
    const badge = document.getElementById('currentEngineBadge');
    const name = document.getElementById('currentEngineName');
    if (badge) {
      setText(badge, eng.badge);
      badge.style.background = eng.color;
    }
    if (name) setText(name, eng.name);

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
          state.engineIndex = idx;
          syncEngineUI();
          popover.hidden = true;
          input?.focus();
        });
        popover.appendChild(opt);
      });
    }
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
        state.engineIndex = (state.engineIndex + 1) % SEARCH_ENGINES.length;
        syncEngineUI();
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

  if (islandSettingsBtn) {
    islandSettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openApiConfigModal('location');
    });
  }

  if (island) {
    island.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      input?.focus();
    });
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
function initCustomizeSheet() {
  const openBtn = document.getElementById('openCustomizeBtn');
  const closeBtn = document.getElementById('closeCustomizeBtn');
  const resetBtn = document.getElementById('resetDefaultBtn');
  const openApiBtn = document.getElementById('openApiConfigBtn');
  const hueRange = document.getElementById('tintHueRange');
  const satRange = document.getElementById('tintSatRange');
  const dimBtn = document.getElementById('dimWallpaperBtn');

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

  document.querySelectorAll('.swatch-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.prefs.wallpaper = btn.dataset.wp;
      savePrefsToStorage();
      applyPreferencesToDOM();
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
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
      const migrated = migrateLegacyDesktop({
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
  sheet.classList.toggle('open', next);
  sheet.setAttribute('aria-hidden', String(!next));
  if (openBtn) openBtn.classList.toggle('active-pill', next);
}

// ==========================================================================
// Unified Settings Modal: Location/Weather, Clock/TimeZone & Sync
// ==========================================================================
function switchSettingsTab(tabName) {
  closeAllPopovers();
  const normalizedTab = !tabName || tabName === 'widgets' ? 'location' : tabName;
  state.activeSettingsTab = normalizedTab;
  document.querySelectorAll('#apiConfigModal .settings-tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === normalizedTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('#apiConfigModal .settings-tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== normalizedTab;
  });
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
  requestGeoBtn?.addEventListener('click', () => {
    const locStatus = document.getElementById('locationStatusText');
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      setText(locStatus, '当前通过局域网 HTTP 访问，浏览器安全策略限制精确定位；请使用 IP 近似位置或在上方搜索手动城市。');
      return;
    }
    if (!navigator.geolocation) {
      setText(locStatus, '当前浏览器不支持定位接口，请使用 IP 近似位置或手动选择城市。');
      return;
    }
    setText(locStatus, '正在请求浏览器定位授权…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        state.browserCoordinates = {
          latitude: Number(pos.coords.latitude.toFixed(4)),
          longitude: Number(pos.coords.longitude.toFixed(4)),
        };
        const targetMode = locModeSelect?.value === 'browser' ? 'browser' : 'auto';
        if (locModeSelect) {
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
      },
      () => {
        state.browserCoordinates = null;
        setText(locStatus, '未获得浏览器定位授权；已保留现有设置，您可改用 IP 近似定位或手动选择城市。');
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
    );
  });

  const citySearchInput = document.getElementById('citySearchInput');
  const citySearchBtn = document.getElementById('citySearchBtn');
  const cityResultsBox = document.getElementById('citySearchResults');
  let searchAbortController = null;

  async function performCitySearch() {
    if (!citySearchInput || !cityResultsBox) return;
    const term = citySearchInput.value.trim();
    clearElement(cityResultsBox);
    if (term.length < 2) {
      cityResultsBox.appendChild(
        el('div', { className: 'widget-empty-hint', textContent: '请输入至少 2 个字符的城市关键词后再搜索' })
      );
      return;
    }

    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();

    cityResultsBox.appendChild(
      el('div', { className: 'widget-empty-hint', textContent: '正在搜索匹配城市…' })
    );

    try {
      const result = await featureClient.searchLocations(term, { signal: searchAbortController.signal });
      clearElement(cityResultsBox);
      const list = Array.isArray(result?.locations) ? result.locations : [];
      if (list.length === 0) {
        cityResultsBox.appendChild(
          el('div', { className: 'widget-empty-hint', textContent: '未找到匹配城市，请尝试其他关键词' })
        );
        return;
      }

      for (const item of list) {
        const subMeta = [item.region, item.country, item.timeZone].filter(Boolean).join(' · ');
        const btn = el(
          'button',
          {
            type: 'button',
            className: 'city-result-item',
          },
          el('span', { className: 'city-result-name', textContent: item.name }),
          el('span', { className: 'city-result-meta', textContent: subMeta })
        );
        btn.addEventListener('click', async () => {
          // Extract strictly the 4 permitted manual location fields
          const manualCity = {
            name: String(item.name).slice(0, 120),
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
      if (err.name === 'AbortError') return;
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

function renderAddWidgetModalList() {
  const listEl = document.getElementById('availableWidgetsToAddList');
  const hintEl = document.getElementById('addWidgetPanelHint');
  if (!listEl) return;
  clearElement(listEl);

  const currentPage = state.pages[state.currentPageIndex] || state.pages[0] || { id: 'all', title: '全部' };
  if (hintEl) {
    setText(hintEl, `选择一个未在桌面显示的小组件，添加后将追加到「${currentPage.title}」页末尾。`);
  }

  const defMap = new Map(
    (state.widgetRegistry.length ? state.widgetRegistry : DEFAULT_WIDGET_DEFINITIONS).map(d => [d.type, d])
  );
  const layout = normalizeWidgetLayout(state.widgetState.layout, state.widgetRegistry);
  const disabledWidgets = layout.filter(item => !item.enabled);

  if (disabledWidgets.length === 0) {
    listEl.appendChild(
      el(
        'div',
        { className: 'widget-empty-hint add-widget-empty-state' },
        '全部 6 个小组件均已放置在桌面上。如需移到当前页，可在编辑模式将小组件拖动到屏幕边缘或分类标签切换页面。'
      )
    );
    return;
  }

  disabledWidgets.forEach((item) => {
    const def = defMap.get(item.type) || { title: item.type, capabilities: [] };
    const addBtn = el('button', {
      type: 'button',
      className: 'ios-btn primary add-widget-action-btn',
      dataset: { addWidgetId: item.id },
      textContent: '添加至当前页',
    });
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      gestureBlockBlankExit = true;
      addWidgetToCurrentPage(item.id);
    });

    const card = el(
      'div',
      {
        className: 'add-widget-card',
        dataset: { widgetId: item.id, widgetType: item.type },
      },
      el(
        'div',
        { className: 'add-widget-card-info' },
        el('div', { className: 'add-widget-card-title', textContent: def.title || item.type }),
        el('div', {
          className: 'add-widget-card-sub',
          textContent: `已保留原有配置与数据 · 点击添加至「${currentPage.title}」`,
        })
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
  syncSettingsControlsFromState();
  switchSettingsTab(tabName);
  modal.hidden = false;
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
    elNode.draggable = state.jiggleMode;
  });
  document.querySelectorAll('.delete-badge').forEach((btn) => {
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
  WIDGET_MODULE_MAP,
};
