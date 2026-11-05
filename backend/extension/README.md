# LaunchDeck 独立新标签页扩展

适用于桌面版 Google Chrome 与 Microsoft Edge，Manifest V3。替换新标签页，完整打包现有页面、组件、本地数据服务与校验模块。导航、便签、待办、组件布局、时间与地区设置无需 Node.js 或 SQLite 服务；天气和城市搜索按需联网。

0.3.0 增加混排桌面保存：`/api/widgets/state` 的 desktop 字段保存页面和网站/小组件位置，与组件启用状态在同一版本中原子更新。旧数据或旧备份没有 desktop 时由前端首次迁移；备份导入导出保留新字段。权限与 0.2.0 相同。

0.3.1 增加实时拖动占位与邻卡平滑让位：拖起真实卡片，不重建计时器或表单；预览不写入存储，松手一次提交，取消恢复原位。修复编辑切换、排序和竖向手势引起的跳顶；仅活动拖动靠近上下边缘时自动滚动。权限与数据格式不变。

0.4.0 默认使用紧凑单屏：网站图标与组件摘要共同排列，点击组件打开完整详情。移动端顶部提供“紧凑 / 舒展”开关，外观面板内也可切换；偏好保存在当前浏览器的 `ios18_mobile_display_mode_v1`，不写入共享设置。桌面始终使用紧凑模式。

舒展模式使用较大的卡片，在原分类内临时分屏（如“精选主页 1/3”），不改变分类、内容或保存顺序。默认 6 组件 + 24 网站已验证在 375×667、375×812、1280×720、1366×768 的紧凑布局全部可见；超出单屏容量时通过“查看全部”访问完整内容。修复触控捕获转移、同指长按接续拖动和电脑窗口两侧横拖；详情输入期间的高度变化不会重排桌面。未增加权限或修改 API/数据库格式。

点击“编辑”后可按住卡片拖动排序，拖到屏幕左右边缘停留或拖到分类标签可跨页移动。“移至…”按钮已在 0.5.0 移除。编辑模式的统一“添加”入口可选择网站或小组件，小组件左上角“−”只隐藏卡片，重新添加会保留原有内容与配置。设置中已移除独立的小组件管理栏。

0.5.0 增加单层网站文件夹：编辑模式中把网站拖到另一网站图标中心，稳定停留约600ms后出现合并预览，松手建立文件夹；拖到现有文件夹中心可加入。点击展开后可改名、排序、拖出或解散；剩一个网站时自动回到原槽位，小组件继续放在桌面。每夹2–100网站、全桌面最多200文件夹，成员只保存站点ID，禁止嵌套/脚本字段。解散把全部成员放回桌面，不删除网站定义。

文件夹使用 desktop.schemaVersion=2，与旧v1/null布局和备份兼容，沿用原If-Match原子保存；旧标签页试图覆盖新文件夹布局时返回冲突，需刷新并处理版本选择。扩展备份外层格式仍为version1，底层文档带文件夹记录。文件夹缩略图沿用预设→浏览器原生favicon→首字回退，图标查询仍只带站点origin，不新增权限。

手机文件夹使用独立滚动区：普通触控竖滑浏览成员，长按接续拖动，多指保留缩放，输入/键盘变化期间保持弹层。自动化与桌面浏览器窄屏检查不代替手机真机体验。

0.5.1 移除编辑模式下卡片底部的左右移动箭头与空占位，保留拖动排序、边缘跨页和页面两侧翻页。Dock 渲染全部固定网站：空间足够时居中完整展示，实际宽度不足时仅网站区横向滚动，右侧两个操作按钮固定可达。支持鼠标拖动、滚轮/触控板、键盘聚焦；触摸与手写笔保留浏览器原生横滑及缩放。窗口变宽后自动清除滚动偏移。数据格式、保存接口和权限不变。

## 构建与产物

在项目根目录运行：

```sh
npm run build:extension
```

生成：

- `backend/extension/dist/agy-new-tab/`：可直接通过开发者模式加载的目录，内含 manifest.json。
- `backend/extension/dist/agy-new-tab.zip`：同一目录的压缩包，可用于传送；开发者模式加载前先解压。

构建器只复制允许的前端资源和纯 JavaScript 校验模块，不复制 SQLite、Cookie、环境文件、个人备份或 Node.js 服务代码。检查模块路径、符号链接与脚本语法，记录源文件校验值。输出目录只允许替换带 AGY 构建标记的旧产物。

前端源文件保持原样。当前构建在**生成的文件**中启用 chrome-extension: 平台识别，并用统一 entry.js 启动本地消息桥；协议与 UI 适配记录见产物中的 `.agy-generated.json`。不要直接修改 dist，应修改来源后重新构建。

## 在 Chrome / Edge 加载

1. Chrome 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`。
2. 打开“开发者模式”，选择“加载已解压的扩展程序”。
3. 选择 `backend/extension/dist/agy-new-tab/`，不要选其父目录或 ZIP 文件。
4. 新建一个标签页，按浏览器提示确认使用此扩展提供的新标签页。

扩展尚未自动安装，也未提交应用商店。加载操作会让此扩展接管新标签页，请在查看文件后自行确认。普通加载版更新时保持目录路径不变，在扩展管理页点“重新加载”，再刷新已打开的起始页。

想让**启动浏览器时第一屏**也使用它，在浏览器设置的“启动时”选择“打开新标签页”。如果选择“继续上次会话”，浏览器仍会恢复旧标签；扩展不强行修改该选择。停用或移除扩展后，新标签页交还浏览器。Chrome 普通扩展不覆盖无痕新标签页。

## 首次使用、权限与离线

- 0.2.0 起基础权限为 `storage` 与用户选定的 `favicon`。新增 favicon 权限可能触发浏览器的权限确认；本扩展不调用 history/tabs API，也不申请所有网站访问权、内容脚本或本机文件访问权。
- 导航、便签、待办与组件的保存通过扩展 service worker 和 chrome.storage.local 完成。一个后台队列串行处理修改，保留各文档的 revision / If-Match，处理多个新标签页同时编辑。
- 新标签页的临时缓存与自定义导航页沿用当前前端的 extension-origin localStorage；完整备份同时包含这些自定义页。Antigravity 可在后续源码适配中将其统一到宿主存储接口。
- 扩展后台休眠后会从持久存储读取数据，不依赖常驻进程；天气缓存保存在内存，不把自动定位的精确坐标持久化。
- 在设置 → 位置与天气，点击“启用联网并刷新”才向浏览器申请三个固定 HTTPS 域名：api.open-meteo.com、geocoding-api.open-meteo.com、ipapi.co。拒绝时本地功能仍可用。
- 点击“授权并读取浏览器位置”时才申请可选 geolocation 权限。浏览器或系统拒绝后，可使用 IP 近似定位或手动城市。
- 独立版自动时间跟随**当前设备时间**，手动校时仍是显示偏移。没有服务器参与，不能声称已完成网络标准时间校准。
- Chrome、Edge 及不同浏览器配置文件的数据相互独立；当前不启用云同步。卸载扩展前先导出备份。

## 网站图标（0.2.0）

优先顺序：**预设 SVG → 浏览器提供的 favicon → 加载失败时保留名称首字**。

- 原有预设图标来自 frontend/app.js 中直接定义的 ICONS 常量，仓库没有记录外部素材库或官网来源；这些是现有简化图形，本轮不会将其称为官方图标。
- 构建器从本地常量提取图标与网站域名映射，生成 `platform/extension/icon-presets.js`。仅解析固定 SVG 字符串，不执行前端源代码；拒绝脚本、事件属性、外部图片/链接等内容。
- 有效 iconKey 优先；没有 iconKey 的新网站可按精确域名匹配预设（忽略 www.），不把子域名或相似域名自动当作同一品牌。
- 其余网站通过本扩展自己的 `/_favicon/?pageUrl=...&size=64` 入口显示图标。查询只使用 origin，删除书签路径、查询参数和片段，不传账号密码。
- 不增加站点抓取、第三方图标服务、远程 SVG 注入、<all_urls> 或 web_accessible_resources。原有 img-src self 已支持此扩展内部资源，无需放宽 CSP。
- 仅将图标作为 img 加载；加载过程中保留首字，失败/超时回退，短期内避免反复失败重试。浏览器也可能成功返回通用占位图；本扩展不声称每个网址都一定能取得品牌图标。
- 该能力只在安装后的扩展页生效，普通 localhost 网页没有扩展的 favicon 权限，仍按其现有渲染方式显示。
- 当前包版本为 0.5.1，favicon 功能自 0.2.0 提供。在扩展管理页重新加载同一目录后，再打开/刷新新标签页；若从更早版本升级时浏览器要求确认 favicon 权限，需由用户完成。

原生接口参考：[Chrome favicon 官方说明](https://developer.chrome.com/docs/extensions/how-to/ui/favicons)。Edge 的具体显示与权限提示仍需在真实浏览器验证。

## 备份与迁移

扩展设置 → 数据同步中新增“导出备份”和“导入并替换”。导出 JSON 包含当前导航、便签、待办、组件、设置以及自定义导航页；导入需确认替换，整份数据先验证再写入，失败不覆盖原数据。

原网页版与扩展的浏览器来源不同，不能悄悄读取原网页的 localStorage。导入现有 SQLite 中已同步的数据可运行：

```sh
npm run export:extension
```

命令以只读方式打开数据库，生成 `backend/extension/dist/agy-web-backup-时间戳.json`，不修改原数据。随后在扩展设置内导入。不会导出其他设备的设置或 Cookie；设备设置以默认值开始。原网页版仅存在浏览器中的自定义导航页及未同步修改，需要由网页版导出入口另行迁移，当前 CLI 无法读取这些浏览器数据。

备份是个人内容，单独保管，不要放进 `agy-new-tab/` 再打包发布。默认构建 ZIP 不包含旁边的 JSON 备份。

## 本地 API 与源码分工

- `runtime/worker.js`：同步注册消息入口、限制存储访问上下文。
- `runtime/api.js`：固定接口分发、发送者校验、频率/消息大小限制。
- `runtime/documents.js`：存储、版本控制、备份原子导入；未知存储版本拒绝重置。
- `runtime/environment.js`：可选联网权限检查、固定服务域名、5 秒超时、256 KB 响应上限、缓存与限流。
- `runtime/bridge.js`：仅在生成的扩展页面中，将本地 `/api/*` 请求转为扩展消息；外部地址不会进入任意代理。
- `runtime/entry.js`：有序启动、权限入口和备份入口；不会先打开 localhost，也不会启动 Node 服务。
- `runtime/favicons.js`：预设匹配、扩展 favicon URL 校验、临时渲染适配和失败回退；不抓取网站 HTML。
- `build.js`：构建与 ZIP；`export-data.js`：原网页版数据库的只读迁移。

扩展内部保持原有 `/api/state`、`/api/widgets/state`、`/api/device/settings`、`/api/widgets`、`/api/timezones`、`/api/time`、`/api/location/search`、`/api/environment/resolve`、`/api/weather` 的逻辑响应结构，但这些请求通过消息实现，没有监听端口。新增逻辑接口 `/api/extension/backup` GET、`/api/extension/import` POST 与 `/api/extension/browser-data` GET 仅在扩展内部提供。备份导入最大 2 MB，其余消息体最大 1 MB。

0.2.0 另提供 `GET /api/icons/favicon?pageUrl=https%3A%2F%2Fexample.com%2F&size=64`，返回 `{ source: 'browser-favicon', pageUrl, imageUrl, size }`。size 允许 16/32/48/64/128，默认 64；未知/重复参数返回 400、未授权返回 403。imageUrl 是本扩展内部 URL，不是网站代理接口。页面也可直接使用 `window.AGYIcons.presetKey(site)`、`faviconUrl(url, size)`、`refresh()`；这三个入口在 app.js 启动前就绪。

发送者必须是当前扩展的本地页面；网页内容脚本、其他扩展及外部网站均不受信任。持久文档按浏览器配置文件共享，不沿用网页服务端 Cookie。校验逻辑与天气字段解析复用 backend/features 中的平台无关模块，禁止把 node:* 模块放进包中。

Codex 维护 `backend/extension/` 的数据运行时、构建与规范；Antigravity 维护 `frontend/` 的界面与未来显式的平台入口适配，具体任务见根目录 TASK.md。

## 验证范围

自动化覆盖离线读写、后台重建、并发冲突、权限拒绝、恶意消息、备份校验、构建输入与路径边界。真实浏览器加载、新标签页覆盖提示、可选权限弹窗和设备定位应在用户选定的 Chrome/Edge 配置文件中另行验证；自动化结果不代表已安装或通过应用商店审核。

参考官方文档：[新标签页覆盖](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)、[本地存储](https://developer.chrome.com/docs/extensions/reference/api/storage)、[可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[消息通信](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)、[扩展 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)。
