import { check, record, string, integer, identifier, timeZone, dateOnly } from './schema.js';
import { HttpError } from '../validation.js';
import { validateCurrencyPair } from './currencies.js';
import { IMPORTED_CARD_LEGACY_SIZES, IMPORTED_CARD_SIZES, validateImportedCard } from './widget-package.js';

const COMPACT_AND_SQUARE = Object.freeze(['compact', 'square']);
const TALL_SIZES = Object.freeze(['compact', 'square', 'tall']);
const WIDE_TO_TALL = Object.freeze({ wide: 'tall' });
const WIDE_TO_SQUARE = Object.freeze({ wide: 'square' });

// Reviewed, local widget types only. JSON configuration never selects executable files.
export const widgetDefinitions = [
  { type: 'clock-weather', title: '时钟与天气', version: 1, sizes: ['square', 'landscape'], legacySizes: { compact: 'square', tall: 'square', wide: 'square' }, defaultSize: 'square', defaultConfig: { showSeconds: true }, capabilities: ['clock', 'weather', 'device-settings'] },
  { type: 'focus-timer', title: '专注计时', version: 1, sizes: COMPACT_AND_SQUARE, defaultConfig: { workMinutes: 25, breakMinutes: 5 }, capabilities: ['local-timer'] },
  { type: 'quick-note', title: '速记', version: 1, sizes: COMPACT_AND_SQUARE, legacySizes: WIDE_TO_SQUARE, defaultConfig: {}, capabilities: ['shared-note'] },
  { type: 'todo', title: '待办清单', version: 1, sizes: TALL_SIZES, legacySizes: WIDE_TO_TALL, defaultConfig: { hideCompleted: false }, capabilities: ['shared-todos'] },
  { type: 'calendar', title: '月历', version: 1, sizes: ['square', 'full'], legacySizes: { compact: 'square', wide: 'square', large: 'full' }, defaultSize: 'square', defaultConfig: { weekStartsOn: 1, marks: [] }, capabilities: ['clock', 'shared-todos', 'calendar-marks', 'cn-holidays'] },
  { type: 'world-clock', title: '世界时钟', version: 1, sizes: TALL_SIZES, legacySizes: WIDE_TO_TALL, defaultConfig: { zones: [
    { label: '上海', timeZone: 'Asia/Shanghai' },
    { label: '伦敦', timeZone: 'Europe/London' },
    { label: '纽约', timeZone: 'America/New_York' },
  ] }, capabilities: ['clock'] },
  { type: 'weather-badge', title: '迷你天气', version: 1, sizes: ['single', 'compact', 'square'],
    defaultSize: 'single', defaultEnabled: false, defaultConfig: {}, capabilities: ['weather'] },
  { type: 'date-tile', title: '今日日期', version: 1, sizes: ['single', 'square'],
    defaultSize: 'single', defaultEnabled: false, defaultConfig: {}, capabilities: ['clock'] },
  { type: 'focus-launcher', title: '一键专注', version: 1, sizes: ['single', 'compact'],
    defaultSize: 'single', defaultEnabled: false, defaultConfig: {}, capabilities: ['local-timer'] },
  { type: 'countdown', title: '日子倒数', version: 1, sizes: ['single', 'compact', 'square'],
    defaultSize: 'single', defaultEnabled: false, defaultConfig: { title: '倒计时', targetDate: null }, capabilities: ['clock'] },
  { type: 'habits', title: '习惯打卡', version: 1, sizes: ['tall', 'square'],
    defaultSize: 'tall', defaultEnabled: false, defaultConfig: { habits: [] }, capabilities: ['clock'] },
  { type: 'today-dashboard', title: '今日面板', version: 1, sizes: ['large', 'square'],
    defaultSize: 'large', defaultEnabled: false, defaultConfig: {}, capabilities: ['clock', 'weather', 'shared-todos'] },
  { type: 'weather-strip', title: '逐小时天气', version: 1, sizes: ['strip', 'compact'], legacySizes: { wide: 'strip' },
    defaultSize: 'strip', defaultEnabled: false, defaultConfig: {}, capabilities: ['weather'] },
  { type: 'currency-converter', title: '汇率换算', version: 1, sizes: ['square'], legacySizes: { single: 'square', compact: 'square' },
    defaultSize: 'square', defaultEnabled: false, defaultConfig: { base: 'CNY', quote: 'USD' }, capabilities: ['exchange-rate'] },
  { type: 'imported-card', title: '导入组件', version: 1, sizes: IMPORTED_CARD_SIZES, legacySizes: IMPORTED_CARD_LEGACY_SIZES,
    defaultSize: 'square', defaultEnabled: false, importOnly: true, capabilities: ['clock', 'weather', 'exchange-rate'],
    defaultConfig: { type: 'text', title: '导入组件', text: '在设置中重新导入组件包', icon: 'note', palette: 'slate', layout: 'stacked' } },
];

function resolveLegacySize(size, definition) {
  const legacySizes = definition?.legacySizes;
  return typeof size === 'string' && legacySizes && Object.hasOwn(legacySizes, size) ? legacySizes[size] : size;
}

export function validateWidgetSize(item, definition) {
  if (Object.hasOwn(item, 'size')) {
    check(definition.sizes.includes(resolveLegacySize(item.size, definition)), '小组件尺寸不受该类型支持');
  }
}

// Only explicitly retired sizes are rewritten. Unknown or malformed values still reach validation.
export function migrateWidgetSizes(state) {
  if (!Array.isArray(state?.layout)) return state;
  let changed = false;
  const layout = state.layout.map(item => {
    const definition = widgetDefinitions.find(candidate => candidate.type === item?.type);
    const size = resolveLegacySize(item?.size, definition);
    if (size === item?.size) return item;
    changed = true;
    return { ...item, size };
  });
  return changed ? { ...state, layout } : state;
}

export function defaultWidgetState() {
  return { layout: widgetDefinitions.filter(definition => definition.defaultEnabled !== false).map((definition, order) => ({
    id: definition.type, type: definition.type, enabled: true, order,
    ...(definition.defaultSize ? { size: definition.defaultSize } : {}),
    config: structuredClone(definition.defaultConfig),
  })), todos: [], desktop: null };
}

const SYSTEM_PAGES = ['all', 'ai', 'design', 'dev', 'media'];
const PAGE_ICONS = ['sparkles', 'folder', 'code', 'book', 'globe'];

// Placement records contain references only; they never select code, markup or URLs.
export function validateDesktop(desktop, layout) {
  if (desktop === null) return;
  const withFolders = desktop?.schemaVersion === 2;
  record(desktop, withFolders ? ['schemaVersion', 'pages', 'placements', 'folders'] : ['schemaVersion', 'pages', 'placements'], '桌面布局');
  check(desktop.schemaVersion === 1 || withFolders, '桌面布局版本不支持');
  check(Array.isArray(desktop.pages) && desktop.pages.length >= 5 && desktop.pages.length <= 50, '导航页数量必须为 5–50');
  check(Array.isArray(desktop.placements) && desktop.placements.length <= 5000, '桌面最多支持 5000 个放置位置');
  const pages = new Set();
  const pageOrders = new Set();
  for (const page of desktop.pages) {
    record(page, ['id', 'title', 'icon', 'isSystem', 'order'], '桌面导航页');
    check(typeof page.id === 'string' && (SYSTEM_PAGES.includes(page.id) || /^page_[a-z0-9_-]{1,64}$/i.test(page.id)), '导航页 ID 不正确');
    check(!pages.has(page.id), '导航页 ID 重复');
    pages.add(page.id);
    string(page.title, 100, '导航页标题');
    check(PAGE_ICONS.includes(page.icon), '导航页图标不正确');
    check(page.isSystem === SYSTEM_PAGES.includes(page.id), '导航页类型不正确');
    integer(page.order, 0, 49, '导航页顺序');
    check(!pageOrders.has(page.order), '导航页顺序重复');
    pageOrders.add(page.order);
  }
  check(SYSTEM_PAGES.every(id => pages.has(id)), '预设导航页不完整');
  const folders = new Map();
  let itemCount = desktop.placements.length;
  if (withFolders) {
    check(Array.isArray(desktop.folders) && desktop.folders.length <= 200, '最多支持 200 个文件夹');
    for (const folder of desktop.folders) {
      record(folder, ['id', 'title', 'siteIds'], '网站文件夹');
      check(typeof folder.id === 'string' && /^folder_[a-z0-9_-]{1,64}$/i.test(folder.id), '文件夹 ID 不正确');
      check(!folders.has(folder.id), '文件夹 ID 重复');
      string(folder.title, 60, '文件夹名称');
      check(folder.title === folder.title.trim() && !/[\u0000-\u001f\u007f]/.test(folder.title), '文件夹名称不能含首尾空白或控制字符');
      check(Array.isArray(folder.siteIds) && folder.siteIds.length >= 2 && folder.siteIds.length <= 100, '文件夹支持 2–100 个网站');
      const members = new Set();
      for (const siteId of folder.siteIds) {
        check(typeof siteId === 'string' && /^[a-z0-9_-]{1,100}$/i.test(siteId), '文件夹只允许网站 ID');
        check(!members.has(siteId), '文件夹成员重复');
        members.add(siteId);
      }
      itemCount += members.size;
      folders.set(folder.id, folder);
    }
  }
  for (const folder of folders.values()) {
    check(folder.siteIds.every(id => !folders.has(id)), '文件夹不能嵌套或引用自身');
  }
  check(itemCount <= 5000, '桌面位置和文件夹成员合计最多 5000 项');
  const seen = new Set();
  const positions = new Set();
  const fixedStarts = new Set();
  const widgets = new Set();
  const placedFolders = new Set();
  const sitePositions = new Set();
  function placeSite(pageId, siteId) {
    const key = `${pageId}:${siteId}`;
    check(!sitePositions.has(key), '同一分类的网站不能同时出现在桌面或多个文件夹');
    sitePositions.add(key);
  }
  const enabled = layout ? new Set(layout.filter(item => item.enabled).map(item => item.id)) : null;
  for (const placement of desktop.placements) {
    record(placement, ['kind', 'id', 'pageId', 'order', 'cell'], '桌面放置位置');
    check((withFolders ? ['site', 'widget', 'folder'] : ['site', 'widget']).includes(placement.kind), '桌面项目类型不正确');
    check(typeof placement.id === 'string' && /^[a-z0-9_-]{1,100}$/i.test(placement.id), '桌面项目 ID 不正确');
    check(pages.has(placement.pageId), '桌面项目引用的导航页不存在');
    integer(placement.order, 0, 4999, '桌面项目顺序');
    const identity = `${placement.pageId}:${placement.kind}:${placement.id}`;
    const position = `${placement.pageId}:${placement.order}`;
    check(!seen.has(identity), '同一导航页的桌面项目重复');
    check(!positions.has(position), '同一导航页的项目顺序重复');
    if (Object.hasOwn(placement, 'cell')) {
      check(placement.kind === 'site' || placement.kind === 'widget', '只有网站和小组件支持固定格子');
      const cell = record(placement.cell, ['row', 'column'], '固定格子');
      integer(cell.row, 0, 49, '格子行号');
      integer(cell.column, 0, 47, '格子列号');
      const start = `${placement.pageId}:${cell.row}:${cell.column}`;
      check(!fixedStarts.has(start), '同一导航页的固定格子起点重复');
      fixedStarts.add(start);
    }
    seen.add(identity);
    positions.add(position);
    if (placement.kind === 'site') placeSite(placement.pageId, placement.id);
    if (placement.kind === 'folder') {
      check(folders.has(placement.id), '文件夹位置引用的文件夹不存在');
      check(!placedFolders.has(placement.id), '文件夹只能放在一个位置');
      placedFolders.add(placement.id);
      for (const siteId of folders.get(placement.id).siteIds) placeSite(placement.pageId, siteId);
    }
    if (placement.kind === 'widget') {
      check(!widgets.has(placement.id), '同一小组件不能放在多个页面');
      check(!enabled || enabled.has(placement.id), '桌面引用了不存在或已隐藏的小组件');
      widgets.add(placement.id);
    }
  }
  check(placedFolders.size === folders.size, '每个文件夹必须恰好有一个桌面位置');
  if (enabled) check([...enabled].every(id => widgets.has(id)), '启用的小组件必须有一个桌面位置');
}

function validateConfig(type, config) {
  if (type === 'imported-card') {
    validateImportedCard(config);
  } else if (type === 'currency-converter') {
    validateCurrencyPair(config);
  } else if (type === 'clock-weather') {
    record(config, ['showSeconds'], '时钟配置');
    check(typeof config.showSeconds === 'boolean', 'showSeconds 必须为布尔值');
  } else if (type === 'focus-timer') {
    record(config, ['workMinutes', 'breakMinutes'], '计时配置');
    integer(config.workMinutes, 1, 180, '专注时长');
    integer(config.breakMinutes, 1, 60, '休息时长');
  } else if (['quick-note', 'weather-badge', 'date-tile', 'focus-launcher', 'today-dashboard', 'weather-strip'].includes(type)) {
    record(config, [], '小组件配置');
  } else if (type === 'todo') {
    record(config, ['hideCompleted'], '待办配置');
    check(typeof config.hideCompleted === 'boolean', 'hideCompleted 必须为布尔值');
  } else if (type === 'calendar') {
    record(config, ['weekStartsOn', 'marks'], '月历配置');
    check([0, 1].includes(config.weekStartsOn), 'weekStartsOn 必须为 0 或 1');
    if (Object.hasOwn(config, 'marks')) {
      check(Array.isArray(config.marks) && config.marks.length <= 128, '月历最多支持 128 个标记');
      const markedDates = new Set();
      for (const mark of config.marks) {
        record(mark, ['date', 'title', 'color'], '月历标记');
        dateOnly(mark.date);
        check(!markedDates.has(mark.date), '同一天只能添加一个月历标记');
        markedDates.add(mark.date);
        string(mark.title, 60, '标记标题');
        check(['red', 'amber', 'green', 'blue', 'violet'].includes(mark.color), '标记颜色不支持');
      }
    }
  } else if (type === 'world-clock') {
    record(config, ['zones'], '世界时钟配置');
    check(Array.isArray(config.zones) && config.zones.length >= 1 && config.zones.length <= 8, '世界时钟支持 1–8 个时区');
    for (const zone of config.zones) {
      record(zone, ['label', 'timeZone'], '世界时钟地点');
      string(zone.label, 60, '地点名称');
      timeZone(zone.timeZone);
    }
  } else if (type === 'countdown') {
    record(config, ['title', 'targetDate'], '倒数配置');
    string(config.title, 60, '倒数标题');
    if (config.targetDate !== null) dateOnly(config.targetDate);
  } else if (type === 'habits') {
    record(config, ['habits'], '打卡配置');
    check(Array.isArray(config.habits) && config.habits.length <= 8, '最多支持 8 项习惯');
    const ids = new Set();
    for (const habit of config.habits) {
      record(habit, ['id', 'title', 'checkedDates'], '打卡习惯');
      identifier(habit.id);
      check(!ids.has(habit.id), '习惯 ID 重复');
      ids.add(habit.id);
      string(habit.title, 60, '习惯标题');
      check(Array.isArray(habit.checkedDates) && habit.checkedDates.length <= 90, '每项习惯最多保存 90 天打卡');
      for (const date of habit.checkedDates) dateOnly(date);
      check(new Set(habit.checkedDates).size === habit.checkedDates.length, '打卡日期重复');
    }
  } else check(false, '小组件缺少配置校验器');
}

export function validateWidgetPatch(patch) {
  record(patch, ['layout', 'todos', 'desktop'], '小组件数据');
  check(Object.keys(patch).length > 0, '至少提交一个小组件字段');
  if ('layout' in patch) {
    check(Array.isArray(patch.layout) && patch.layout.length <= 24, '最多允许 24 个小组件');
    const ids = new Set();
    const orders = new Set();
    for (const widget of patch.layout) {
      record(widget, ['id', 'type', 'enabled', 'order', 'config', 'size'], '小组件');
      identifier(widget.id);
      check(!ids.has(widget.id), '小组件 ID 重复');
      ids.add(widget.id);
      const definition = widgetDefinitions.find(definition => definition.type === widget.type);
      check(definition, '小组件类型未注册');
      validateWidgetSize(widget, definition);
      check(typeof widget.enabled === 'boolean', '小组件启用状态必须为布尔值');
      integer(widget.order, 0, 23, '小组件顺序');
      check(!orders.has(widget.order), '小组件顺序重复');
      orders.add(widget.order);
      validateConfig(widget.type, widget.config);
    }
  }
  if ('todos' in patch) {
    check(Array.isArray(patch.todos) && patch.todos.length <= 200, '最多允许 200 条待办');
    const ids = new Set();
    for (const todo of patch.todos) {
      record(todo, ['id', 'text', 'completed', 'dueDate'], '待办');
      identifier(todo.id);
      check(!ids.has(todo.id), '待办 ID 重复');
      ids.add(todo.id);
      string(todo.text, 500, '待办内容');
      check(typeof todo.completed === 'boolean', '待办完成状态必须为布尔值');
      if (todo.dueDate !== null && todo.dueDate !== undefined) dateOnly(todo.dueDate);
    }
  }
  if ('desktop' in patch) validateDesktop(patch.desktop, patch.layout);
}

export function validateWidgetDocument(state, previousState) {
  validateWidgetPatch(state);
  check('layout' in state && 'todos' in state, '小组件文档不完整');
  if (previousState?.desktop?.schemaVersion === 2 && state.desktop?.schemaVersion !== 2) {
    throw new HttpError(409, '桌面已升级为文件夹布局，请刷新当前页面后再编辑');
  }
}
