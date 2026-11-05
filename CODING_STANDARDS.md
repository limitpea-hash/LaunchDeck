# 项目开发规范与 DIY 小组件约定

适用于 Codex 与 Antigravity，以及后续在本仓库中修改组件的人。已选择“受控本地组件注册”方案；配置是数据，不是可执行代码。

## 分工与目录

- `backend/` 由 Codex 负责：HTTP、SQLite、数据校验、外部服务代理、接口与安全测试。
- `frontend/` 由 Antigravity 负责：页面、交互、渲染、浏览器能力、组件生命周期。
- `TASK.md` 记录最新已确认任务、接口交接和验证结果。`backend/FEATURE_API.md` 记录本轮实际实现的接口；`backend/README.md` 记录运行方式。
- 新前端组件放 `frontend/widgets/<type>.js`，共享安全渲染或请求工具放 `frontend/lib/`。文件名只用小写英文、数字和连字符；不在组件目录放密钥或私有配置。
- 后端功能按 `backend/features/` 的职责拆分：schema、widgets、settings、store、environment、routes。避免把业务逻辑全部堆进 app.js。
- 统一使用 JavaScript ES module、2 空格缩进、分号；新模块使用单引号。修改旧文件时避免无关格式化。函数优先做一件事，副作用通过参数传入便于测试。

## 一个小组件的注册流程

1. 确定固定 `type`、version、显示标题、默认 config、尺寸和实际数据需求。
2. 在 `backend/features/widgets.js` 注册元数据，并加入严格的 config 校验器；缺少校验器时必须拒绝保存。同步更新 FEATURE_API.md 和有意义的测试。
3. Antigravity 在 `frontend/widgets/` 实现组件，将其加入**源代码中写死的模块映射表**。不得根据用户输入拼接 import、文件路径或脚本 URL。
4. 通过 `/api/widgets` 获取已注册类型、默认值，通过 `/api/widgets/state` 保存布局。增加未知字段前先对齐后端契约。
5. 组件的生命周期统一为 `mount(root, context)`、`update(data)`、`destroy()`；后两者由 mount 返回的实例提供。root 是宿主创建的组件容器，不操作其他组件的 DOM。
6. context 由宿主注入受控 API、配置、数据快照、时间基准和状态通知方法。组件不能私自创建另一套全局 store、设备标识或网络代理。
7. destroy 必须取消 fetch、清理计时器、移除监听和订阅。重新渲染不得重复启动多个时钟或多次绑定事件。

注册表 capabilities 仅用于受信任本地模块的开发约定，不是隔离容器。新增代码要人工审查；本版本没有用户上传脚本或远程插件入口。

## 渲染与输入安全

- 用户输入和外部服务字段一律用 `textContent`、DOM 属性或安全组件渲染，包含网站标题、待办、城市、导航页名和时区标签。
- 不把这些值直接拼入 innerHTML、outerHTML、insertAdjacentHTML、内联事件属性或 SVG 字符串。innerHTML 只用于代码中固定且经过审查的模板。
- 现有 createAppItemElement、renderDock 等动态模板需要 Antigravity 在本轮一并修复；至少验证包含 `<img src=x onerror=alert(1)>`、引号、`&` 的标题只显示文本，不产生元素或脚本。
- URL 使用 `new URL()` 验证，只允许 http/https。打开新标签页时使用 `noopener,noreferrer`；不得执行 javascript/data URL。
- 颜色、渐变、class、图标名称采用枚举或严格格式。用户不能传入任意 style、HTML、script、文件路径或权限字段。
- JSON 对象严格校验类型、长度、范围和允许的键；拒绝额外字段、重复 ID、不存在的时区和无效日期。不要把不可信对象合并到全局原型或 DOM 对象。
- 服务端 SQL 必须参数化；配置不进入 shell、eval、Function 构造器或动态源代码。

## 请求与数据管理

- 仅调用同源 `/api`。后端负责固定来源的外部请求。不要为方便 DIY 新增“传 URL 就抓取”的通用代理。
- 设备 settings、共享 widget state 和旧 portal state 的版本分别管理。写入需 If-Match，409 需重新读取并由用户选择保留版本，不能静默覆盖。
- 组件输入即时显示，防抖保存。离线时保留出站修改并如实显示状态；不能把 fetch 已发出当作已保存。
- 布局与待办由共享接口保存；便签仍使用旧 note 字段；地点、时区和校时由设备设置保存；翻页、编辑态和未完成的指针手势只存在内存。
- 保留空列表、空便签的含义。默认值通过缺失/null 判定，不要用数组长度或 `value || default` 覆盖用户有意保存的空值或 0。
- 网络超时、503、429、缓存陈旧等状态必须有明确降级；外部结果不完整时显示不可用，不编造天气或地点。尊重 Retry-After，避免无限快速重试。
- 新增 widgets/lib 下的 js/css 可由静态服务提供；后端会检查真实路径防止符号链接越界。其他目录或资源类型需先由 Codex 增加受控白名单。

## 时间、位置与隐私

- 存储时间基准用 UTC 毫秒或 ISO 8601 UTC；展示使用 Intl 与 IANA 时区，不能手写固定 UTC+8 代替时区规则。
- 自动时间以服务端时间为校准基准，组件用 performance.now 增量刷新。手动校时只调整显示偏移，绝不改系统时间。
- 位置优先级与模式按 FEATURE_API.md 执行。浏览器时区只能说明时区，不能充当精确城市定位；私有 IP 不能直接定位城市。
- 用户主动选择浏览器定位时说明其用于查询天气；仅在用户授权后读取坐标。HTTP 局域网不支持精确定位时，提供 IP 或手动城市，不指导关闭浏览器安全保护。
- 浏览器自动坐标不持久化、不写访问日志；只在用户保存手动地点时存储。外部天气请求将坐标降到两位小数。设备 Cookie 不提供给脚本、查询参数、错误日志或第三方。
- 天气实际更新时间与网页手动校时分开，旧缓存须标记“缓存数据/更新时间”。

## 交互与反馈

- 长按进入编辑；真实空白点击退出。区分 click 与拖动释放，排除图标、组件内部控件、工具栏、菜单、弹窗和分页控件，避免误退出。
- 顶部保持稳定，不接收常规动作或保存同步广播。正常同步状态放设置页或组件内部；失败就近展示，冲突用明确选择框。
- UI 文案描述用户操作与结果，不暴露 SQL、Cookie、socket、内部路径等实现细节。
- 所有按钮具有可访问名称；保留键盘操作。动画尊重 prefers-reduced-motion；滑动不抢占文本输入、纵向滚动或缩放。

## 统一控件与响应式布局（已确认的 UI 方案 1）

### 共享入口与视觉变量

- 通用控件放 `frontend/lib/ui/`，组件通过固定模块路径导入。共享 CSS 使用受控本地样式文件引入；普通浏览器 ES module 不直接 import 未经构建的 CSS。
- 按钮、开关、勾选、下拉、日期/时间、滚动区域与来源链接使用统一的圆角、材质、边框、文字、间距、焦点和禁用状态变量。主题切换不得回退成未处理的默认蓝色链接或系统表单外观。
- 控件保留稳定的数据接口和销毁方法，业务状态与持久化继续由已有宿主/客户端管理。控件本身不新增保存接口，也不持有独立的全局版本。
- 实现后由 Antigravity 在本规范或相邻说明文件列出控件的导出函数、参数、事件、键盘操作及使用示例，便于 DIY 复用。

### 尺寸与文字

- 文字按钮使用内容决定宽度、合理内边距和独立最小高度，避免 flex 压缩；图标按钮使用独立类名与固定尺寸。禁止把“添加”“应用手动校时”等文字放进仅适合图标的 24px 容器。
- 动作组空间不足时换行或改为纵向，不能靠截字、横向越界或压缩字体维持一行。输入区域允许 `min-width: 0`，按钮与输入宽度共同设计。
- 组件网格根据可用宽度调整列数或卡片宽度；月历标题、星期和七列六行日期必须完整容纳。组件高度依内容与明确最小高度布局，不统一锁死在 166px 后裁切。
- overflow:hidden 用于需要的装饰边界，不能用来掩盖布局故障；可交互弹层与必要内容必须有完整可见路径。

### 选择、勾选与日期时间

- 使用主题内的下拉弹层，收起状态与展开选项均验收；时区选择支持搜索。不能仅设置原生 select 外框就宣称系统弹层风格已统一。
- 自定义 combobox/listbox 提供关联标签、展开/选中状态及键盘方向键、确认、Escape、Tab 和焦点返回。选项和搜索文本用安全 DOM 渲染。
- 组件启用采用开关语义，待办采用勾选语义；可保留真实 input 作为交互基础，但视觉层需统一，并保持键盘可达、标签点击和可见焦点。
- 日期选择提供主题内月历与年月切换；时间选择提供主题内小时/分钟/秒和键盘输入，不依赖系统原生弹层。业务值仍是既定 YYYY-MM-DD、HH:mm:ss 和合法 IANA 时区，保留夏令时歧义及不存在时间的处理。
- 保留用户尚未确认的输入；Escape 关闭时取消未提交值，确认后才触发业务变更。选项弹层打开、切换月份不触发保存。

### 滚动、弹层与安全

- 统一滚动条轨道与圆角滑块；保留原生鼠标、触控板、触摸和键盘滚动，不通过伪造不可操作的滑块或隐藏所有溢出替代滚动。
- 控件弹层根据屏幕边缘定位，设置合适最大尺寸及内部滚动。使用受控弹层容器避免祖先 overflow 裁剪，并与设置对话框的焦点管理协作。
- 弹层操作不应误触页面翻页或空白退出编辑。明确隔离触发器、选项、日历格子、时间选择与外部关闭事件，不用全局禁止所有指针事件解决冲突。
- mount/destroy 或等效生命周期负责清理外部点击、键盘监听、滚动/尺寸监听与弹层 DOM；重建小组件不能留下旧弹层或重复监听。
- 保持安全文本渲染、固定模块映射及现有 CSP；不得因样式重构添加不可信 HTML/脚本、任意动态 import 或降低安全策略。
- 来源链接使用统一颜色和 normal/visited/hover/focus 状态，保留署名、链接目的地与 noopener/noreferrer。

### 视觉完成条件

- 至少检查 320/375/390/768/1024/1440px 宽度及 125% 浏览器缩放。月历验证六行月份与两种每周起始日；长中文按钮不溢出，设置表单不撑破弹窗。
- 截图需包含月历、长文字按钮、展开的时区下拉、日期/时间弹层及开关状态。脚本事件仿真、节点存在或 HTTP 200 不能代替实际视觉检查。
- 记录实际测试的浏览器与设备，未测项明确说明；修复旧类名与真实 DOM 不匹配的样式，避免以追加高优先级规则掩盖冲突。

### 共享控件层 API 与复用参考（`frontend/lib/ui/`）

- **样式入口**：`frontend/lib/ui/controls.css`（在 `frontend/index.html` 中通过 `<link rel="stylesheet" href="lib/ui/controls.css" />` 引入，提供 `--ui-*` 主题令牌、按钮分型、开关/勾选、浮层 Portal、日期/时间面板、来源链接及统一细滚动条样式）。
- **模块入口**：`frontend/lib/ui/index.js`，导出以下纯 DOM 安全工厂函数：
  1. `createButton({ label, variant = 'secondary' | 'primary' | 'accent' | 'danger', size = 'md' | 'sm', pill = false, type = 'button', id, title, ariaLabel, disabled, onClick })`
     - 返回内容自适应宽度的 `<button class="ui-btn ...">`，`flex-shrink: 0`，禁止被压缩。
  2. `createIconButton({ iconText, variant = 'ghost' | 'danger', id, title, ariaLabel, disabled, onClick })`
     - 返回固定尺寸图标按钮 `<button class="ui-icon-btn ...">`，自动关联 `aria-label`。
  3. `createSwitch({ checked = false, label = '', ariaLabel = '', disabled = false, onChange })`
     - 用于小组件启用/隐藏开关；内部保留 `<input type="checkbox" role="switch">`，支持空格/回车切换与标签点击。返回 `{ root, element, input, getChecked(), setChecked(next), destroy() }`。
  4. `createCheckbox({ checked = false, label = '', ariaLabel = '', disabled = false, onChange })`
     - 用于待办清单完成勾选；返回 `{ root, element, input, getChecked(), setChecked(next), destroy() }`。
  5. `createSelect({ options = [], value = '', searchable = false, searchPlaceholder = '搜索选项…', compact = false, ariaLabel = '', placeholder = '请选择', selectElement = null, onChange })`
     - 主题内 `role="combobox"` 触发器 + 挂载于 `document.body` 的 `.ui-popover-portal` `role="listbox"` 浮层；支持传入现有原生 `<select>`（`selectElement`）进行渐进包裹并同步 `.value` 与 `change` 事件。
     - **键盘操作**：`ArrowDown` / `ArrowUp` / `Home` / `End` 移动高亮项，`Enter` 确认选择，`Escape` 取消并关闭且焦点返回触发器，`Tab` 关闭浮层。
     - 返回 `{ root, element, triggerBtn, open(), close(), getValue(), setValue(v), setOptions(opts, val), refresh(), destroy() }`。
  6. `createDatePicker({ value = '', placeholder = 'YYYY-MM-DD', allowEmpty = false, compact = false, ariaLabel = '选择日期', weekStartsOn = 1, getTodayParts = null, inputElement = null, onChange })`
     - 主题内 `YYYY-MM-DD` 文本输入 + 月历浮层（支持上/下月切换、“今天”、“清空”、“关闭”）；按 `Escape` 恢复打开前未提交的原值。返回 `{ root, element, input, open(), close(), getValue(), setValue(v), destroy() }`。
  7. `createTimePicker({ value = '00:00:00', includeSeconds = true, compact = false, ariaLabel = '选择时间', getNowParts = null, inputElement = null, onChange })`
     - 主题内 `HH:mm:ss` 输入 + 时/分/秒三列滚动浮层（含“当前时刻”、“取消”、“确定”）；按 `Escape` 恢复未提交原值。返回 `{ root, element, input, open(), close(), getValue(), setValue(v), destroy() }`。
  8. `createChoiceGroup({ name, options, value, onChange })`
     - 主题内单选卡片组（用于夏令时重叠/跳变时刻消歧选择），返回 `{ root, element, getValue() }`。
  9. `closeAllPopovers(exceptInstance = null)`
     - 统一关闭所有打开中的下拉/日期/时间浮层（在切换设置页签、关闭弹窗或销毁组件时调用）。
- **最小复用示例**：
  ```js
  import { createButton, createSelect, createDatePicker } from '../lib/ui/index.js';

  const tzSelect = createSelect({
    options: ['UTC', 'Asia/Shanghai', 'America/New_York'],
    value: 'Asia/Shanghai',
    searchable: true,
    compact: true,
    ariaLabel: '选择 IANA 时区',
    onChange: (nextZone) => console.log('Selected:', nextZone),
  });
  const addBtn = createButton({ label: '添加', variant: 'primary', size: 'sm', type: 'submit' });
  // 组件卸载时调用 tzSelect.destroy() 清理浮层与全局监听
  ```

## 独立扩展平台约定（已确认的扩展方案 1）

- 源码平台边界：Antigravity 维护 frontend，Codex 维护 backend/extension 的本地数据运行时、构建和迁移。输出目录 dist 是可重建产物，不手改；原 Web 入口继续可用。
- 使用 Manifest V3，以 chrome_url_overrides 注册本地新标签页；所有 JS/CSS 随包发布，不下载或执行远程脚本，不依赖 localhost。浏览器启动页选择与新标签页覆盖分别说明，不强改用户启动设置。
- 基础权限为 storage，以及用户在 0.2.0 明确选择的 favicon；联网天气/城市/IP 及 geolocation 继续按明确用户动作申请可选权限。不为便利增加 <all_urls>、history、tabs、cookies 或第三方消息入口。
- 跨标签页的共享修改经单个 service worker 串行处理，持久化完成后才能返回成功；保留独立文档版本及冲突处理。后台休眠、重新唤醒时从存储恢复，不依赖内存常驻状态。
- sender.id、sender.url/origin 使用浏览器提供的身份校验，不能相信请求 body 中自称的来源。本地消息路由同样执行字段、大小、来源和频率检查，不能成为任意网络代理。
- 独立版自动时间是设备时间，不是 NTP/服务器标准时间。纯离线功能不得因天气权限未授予、断网或 IP 查询失败而停止启动。
- 不在扩展包内带个人数据或其他设备设置；备份单独导出，导入必须全量验证后原子替换，保留明确的用户确认，防止旧标签页覆盖已恢复版本。
- 本地 API 仿真、构建成功和模块语法检查不能代替 Chrome/Edge 实际加载。首次接管新标签页、可选权限与定位必须记录实际浏览器结果，未安装或未审核的产物要明确标注。

### 预设图标与浏览器 favicon

- 预设图标是随包审查的静态 SVG，优先于 favicon；记录新增素材的来源与许可，不能把没有出处的简化图形标作官方素材。
- 预设匹配使用显式 iconKey 或精确域名映射，防止相似域名、未知子域名和继承属性误匹配。favicon 仅接受 HTTP/HTTPS 且不含账号密码的地址。
- 通过扩展自身 /_favicon 入口显示浏览器图标，不新增通用抓取代理，不开放给外部网页；查询只带 origin，剔除书签私有路径、参数与片段。
- 下载的图标按 img 资源处理，绝不能将返回的 SVG/HTML 拼入 DOM。首字占位在成功解码后才隐藏；失败或超时保留，销毁时清理加载回调、计时器和观察器。
- 不使用 hidden + lazy 导致图标永不触发加载；保持固定图标区域和 object-fit: contain，避免布局跳动。图像本身不可拖放、不拦截指针，不破坏图标排序和翻页手势。
- 浏览器可能返回通用占位图，不能保证新网址都有品牌 favicon。普通网页与扩展能力有区别，禁止用放宽 CSP 或公开 web_accessible_resources 的方式绕过。

## 混排桌面与编辑模式

- 页面和放置顺序使用 widgets 文档的 desktop 字段，不能每次按站点分类重建而覆盖用户拖动结果。旧数据只在 desktop 缺省/null 时迁移，明确隐藏的组件（含空旧布局）不得自行恢复显示。
- placement 只包含 kind、id、pageId、order；使用 Map/Set 解析引用，未知站点定义暂不显示但保留引用。不能从 placement 加载模块、拼接 HTML 或任意请求地址。
- 每个启用组件全桌面恰好一个位置；删除/重新添加/跨页移动必须与 layout 启用状态原子保存并通过合并后完整文档校验。沿用 revision/If-Match 与冲突选择，不静默重试覆盖其他页面。
- 拖动排序只在编辑模式启用，提供触屏/键盘可用的移动操作。组件内部控件与拖动手柄隔离，pointercancel、Escape、拖后抑制点击和页面退出均清理临时状态。
- 多页组件实例按 ID 唯一管理，重排、移除、重试时清理计时器、全局监听和弹层。移除卡片保留配置、待办和便签；删除自定义页面将内容迁回首页。
- 一个编辑态添加入口同时提供网站和组件，编辑操作不触发空白退出；设置仅保留实际设置，不能重新引入独立组件显示/排序管理页面。

## 验证与完成条件

- 后端运行根目录 `npm test`。新功能至少验证正常行为、字段边界、设备隔离、版本冲突、持久化和有实际风险的攻击输入。
- 外部服务测试使用注入 fetch 的确定性响应，覆盖超时、非 JSON、超大响应、重定向拒绝、缓存过期、陈旧回退和请求限流；另记录实际网络连通检查结果。
- 前端既验证事件状态机，也在真实浏览器验证 DOM 和交互；仿真通过不等于手机真机实测通过。没有测试过的设备要明确标注。
- 完成后更新 TASK.md：改动文件、实际完成能力、测试结果和剩余依赖。不要将文档中的示例响应称为真实天气结果。
