# LaunchDeck · 智能起始页

> 当前版本 **v0.9.0** · [下载 v0.9.0 扩展](https://github.com/limitpea-hash/LaunchDeck/releases/download/v0.9.0/launchdeck-new-tab.zip) · [查看发布记录](https://github.com/limitpea-hash/LaunchDeck/releases)

受 iOS 桌面启发设计的独立导航与起始页，将常用网站、分类文件夹、Dock 与实用小组件整理在同一张桌面上。提供开箱即用的 Chrome / Edge 独立新标签页扩展，以及无第三方运行时依赖的本地与可信局域网网页服务。

### 核心特性

- **桌面与导航** 网站与小组件支持混排、拖拽排序、跨桌面或分类页移动，并提供单层网站文件夹。底部配备自适应 Dock，空间不足时可横向滚动。搜索引擎下拉菜单会自动记住最后一次选择。
- **六类小组件与多尺寸** 内置时钟天气、月历、世界时钟、专注计时、速记便签和待办清单。编辑模式下支持 `2列×1行`（紧凑）、`2×2`（方卡）、`4×2`（横卡）尺寸切换（专注计时仅提供紧凑与方卡），拖拽排序与跨页移动均保留所选尺寸。
- **v0.9.0 桌面与组件改进** 左上角支持一键切换夜间模式并自动持久化。`4×2` 横卡下的便签、待办和世界时钟列表支持卡片内独立滚动，`2×2` 月历方卡聚焦展示当前一周。精选主页默认仅放置小组件，不再重复铺设预设站点，并修复了 `g` 等下行字母的下沿裁剪。
- **自适应与多端布局** 小窗口下卡片自动收缩适配并提供「查看全部」入口，恢复更大窗口后自动还原所选卡片尺寸。移动端支持紧凑总览与舒展分页两种模式。
- **个性化与本地存储** 时间与地区支持自动判断和手动设置。可选本地 PNG / JPEG / WebP 图片壁纸保存在当前浏览器的本机 IndexedDB 中，支持预览、应用与恢复动态预设。

## 使用扩展（Chrome / Edge 新标签页）

新标签页扩展完全独立运行，数据保存在当前浏览器配置文件的 `chrome.storage.local` 与本机 IndexedDB 中，不依赖后端服务（仅天气与城市搜索按需请求公开接口）。要求 Chromium 内核最低 **Chrome 120**。

### 首次安装

1. 下载 [launchdeck-new-tab.zip](https://github.com/limitpea-hash/LaunchDeck/releases/download/v0.9.0/launchdeck-new-tab.zip)（也可从 [Releases 页面](https://github.com/limitpea-hash/LaunchDeck/releases/latest)获取）并解压到本地固定目录。
2. 在 Chrome 打开 `chrome://extensions/`（或 Edge 打开 `edge://extensions/`），开启右上角**开发者模式**。
3. 点击**加载已解压的扩展程序**，选中解压后包含 `manifest.json` 的目录。
4. 打开新标签页即可使用。若希望启动浏览器时直接进入，可在浏览器设置中将“启动时”设为“打开新标签页”。

### 更新已有扩展

1. **优先导出扩展版完整备份** 升级前请先在扩展「设置 → 数据同步 → 本地数据备份」中导出完整备份（导航备份不含便签与待办等内容，升级防丢请优先选完整备份）。
2. **覆盖原加载路径** 将新版 `launchdeck-new-tab.zip` 解压并覆盖到原先加载的同一个文件夹路径。切勿先卸载旧扩展，卸载会清空该扩展 ID 下的 `chrome.storage.local` 数据。
3. **重载并刷新** 回到扩展管理页点击 LaunchDeck 卡片上的**重新加载**，随后刷新新标签页。

权限说明、加载细节与迁移指南详见 [扩展说明](backend/extension/README.md)。

## 运行网页服务

网页版适合个人本机或可信局域网内多设备共享导航、便签与待办数据。需要 **Node.js >= 24**，无第三方运行时依赖。

```sh
# 默认监听 0.0.0.0:3000（支持可信局域网内其他设备访问）
npm start

# 仅限本机访问
LISTEN_HOST=127.0.0.1 npm start
```

启动后访问 `http://127.0.0.1:3000/`。SQLite 数据库在首次启动时自动创建于 `backend/data/`，个人图片壁纸仍仅保存在各自浏览器的本机 IndexedDB 中。仓库与发布包均不包含任何现有用户数据或个人备份。

## 备份、恢复与 Bitwarden 兼容

LaunchDeck 提供完整备份和导航专用备份，两类都使用本地文件。导航备份可先预览，再确认恢复。

### 1. 扩展版完整备份（JSON）

该功能位于扩展版的「设置 → 数据同步 → 本地数据备份」菜单中。完整备份包含网站、桌面与分类、文件夹、Dock 固定状态、小组件位置与尺寸、便签、待办、组件配置及时间地区设置（不含本机 IndexedDB 图片壁纸）。导入完整备份会直接替换当前扩展内的对应数据；同时向后兼容旧版完整备份，旧备份缺少小组件尺寸字段时会自动回退为紧凑默认尺寸。

### 2. 导航专用备份与 Bitwarden 单条登录 JSON

- **真实数据边界** 仅包含网站、导航页与分类、文件夹、排列顺序、Dock 固定状态以及小组件的位置标识与尺寸；不写入便签、待办、组件配置、图片壁纸或时间地区位置。恢复导航备份时，本机原有的便签、待办和偏好设置会原样保留。
- **Bitwarden 手动导入与加密边界** 导出的 Bitwarden 文件是一条含自定义字段的单条登录 JSON。导出的 JSON 文件本身为明文，需由用户手动导入 Bitwarden 保险库，导入后由保险库负责加密存储。本项目不读取保险库密码，也不使用通行密钥保存导航。
- **恢复路径差异** 网页版可在独立恢复页配合 Bitwarden 自定义字段自动填充后确认恢复；浏览器扩展则在内置恢复页通过粘贴备份内容或选择导入文件完成校验预览与恢复。

容量边界、字段结构与兼容性细节见 [Bitwarden 兼容性报告](backend/extension/BITWARDEN_COMPATIBILITY.md)。

## 开发与构建

项目主分支为 `main`。常用测试与打包命令如下。

```sh
# 运行后端与核心契约测试
npm test

# 构建扩展解包目录与发布 ZIP
npm run build:extension
```

运行 `npm run build:extension` 后，产物默认生成在 `releases/launchdeck-new-tab/`（解包目录）和 `releases/launchdeck-new-tab.zip`（发布压缩包）。`releases/` 与 `backend/data/` 目录已由 Git 忽略，正式发行包通过 [GitHub Releases](https://github.com/limitpea-hash/LaunchDeck/releases/latest) 分发。

### 目录与文档索引

| 目录 / 文档 | 说明 |
| --- | --- |
| `frontend/` | 页面视图、样式主题、六类小组件及拖拽交互 |
| `backend/` | Node.js HTTP 服务、SQLite 存储、数据校验与测试 |
| `backend/extension/` | 独立新标签页扩展运行时与打包脚本 |
| [扩展说明](backend/extension/README.md) | 扩展权限边界、加载步骤、更新与数据迁移 |
| [Bitwarden 兼容性报告](backend/extension/BITWARDEN_COMPATIBILITY.md) | 导航备份格式、单条登录 JSON 边界与恢复说明 |
| [后端说明](backend/README.md) | 服务端启动参数、环境变量与基础接口 |
| [功能接口](backend/FEATURE_API.md) | 布局、小组件尺寸、时间地区与天气数据契约 |
| [代码规范](CODING_STANDARDS.md) | 模块结构、DIY 扩展约定与安全边界 |
