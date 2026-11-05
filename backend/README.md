# 后端与前端协作说明

## 启动

使用 Node.js 24 或更高版本，在项目根目录或 `backend/` 目录运行 `npm start`，打开 http://127.0.0.1:3000 。无需安装依赖。两个目录均可运行 `npm test` 检查后端。

这是个人测试版。服务默认监听 `0.0.0.0:3000`，同一局域网的设备可通过这台 Mac 的局域网 IPv4 地址访问。导航、便签、小组件布局与待办为共享数据；地点、时区和校时设置按设备 Cookie 隔离。尚未加入账号或登录。

- 数据库：`backend/data/portal.sqlite`，原 `data/` 中的数据库已整体迁入，重启服务后保留。
- 更换端口：`PORT=3001 npm start`。
- 启动日志会列出本机和局域网访问地址。其他设备应使用 `http://<Mac 的局域网 IP>:3000/`，而不是 `0.0.0.0` 或 `localhost`。
- 需要恢复仅本机监听时，使用 `LISTEN_HOST=127.0.0.1 npm start`。默认监听地址为 `0.0.0.0`。
- 自定义数据库：`DATABASE_PATH=/绝对路径/portal.sqlite npm start`。相对路径统一相对项目根目录解析，从根目录或 `backend/` 启动行为一致。
- 前端目录：优先读取 `frontend/index.html` 及同目录资源；Antigravity 完成迁移前，临时读取根目录的前端文件。每次静态请求重新选择目录，迁移完成后无需重启后端。
- 指定其他前端目录：`FRONTEND_DIR=frontend npm start`，相对路径相对项目根目录解析。
- 备份时先停止服务，再复制整个 `backend/data` 文件夹。
- Node.js 24 的内置 SQLite 可能输出实验性功能提示，不影响启动。

## 小组件、时钟天气与 DIY

- 新接口已实现：小组件注册表与布局、待办、设备独立设置、城市搜索、自动位置解析、时区列表、时间校准和天气查询。完整字段、示例和限制见 [FEATURE_API.md](FEATURE_API.md)。
- 前端提供空白退出编辑、静默同步、小组件及设置界面；开发规范见根目录 `CODING_STANDARDS.md`。
- 天气与城市搜索使用固定 Open-Meteo 服务，IP 近似位置使用 ipapi.co。自动坐标不落库；只有用户保存的手动地点持久化。外部服务失败时接口明确降级，不返回示例天气。
- 浏览器精确定位需要用户授权及安全上下文；当前局域网 HTTP 可使用 IP 近似位置或手动城市。
- 后端增加 CSP、同源检查、限流、字段白名单及静态文件真实路径检查。客户端仍须按规范使用安全文本渲染。

## Chrome / Edge 独立扩展

根目录 `npm run build:extension` 生成不依赖本机服务的新标签页扩展目录与 ZIP；`npm run export:extension` 可只读导出已同步的网页数据用于迁移。完整架构、加载方法、权限和迁移限制见 [extension/README.md](extension/README.md)。构建不修改 frontend 源文件，也不把数据库或个人数据放进扩展包。

## 文件分工

- `backend/`：后端服务、数据校验、数据库、测试与本说明，由 Codex 维护。
- `frontend/`：页面、样式、浏览器脚本和 API 客户端，由 Antigravity 维护。
- 根目录 `package.json`：便捷启动与测试入口，转发到 `backend/package.json`。
- 根目录 `TASK.md`：本地协作记录，不随源码发布；公开接口契约见 `FEATURE_API.md`。

`frontend/backend-client.js` 是 `/api/state` 接口的保存适配器，合并 350ms 内的变更并保存到数据库。前端已完成迁移及接口接入；实际接口以本说明与 `FEATURE_API.md` 为准。

浏览器按端口和地址隔离本地数据，原来在其他端口或 file:// 下的数据不会自动迁移。数据库路径调整不改变页面地址，因此原地址下的浏览器缓存仍保留。

## 接口

所有接口使用同源请求，不开放跨域。允许通过 localhost、回环地址和本机实际 IPv4 地址访问，局域网地址随系统网络配置动态更新；来源检查继续生效。静态服务只提供已列入白名单的页面资源，数据库和服务端代码不对外提供。

### GET /api/health

返回 `{"status":"ok","storage":"sqlite"}`。

### GET /api/state

返回：

```json
{
  "revision": 1,
  "state": {
    "sites": [],
    "prefs": {
      "iconMode": "light",
      "iconSize": "small",
      "wallpaper": "ios18-bloom",
      "wallpaperDimmed": false,
      "tintHue": 215,
      "tintSat": 82,
      "focusActive": false
    },
    "note": ""
  },
  "updatedAt": "2026-11-04T09:00:00.000Z"
}
```

空数据库返回 `revision: 0`、`state: null`、`updatedAt: null`。响应头 `ETag` 为带双引号的版本号，如 `"1"`。

### PATCH /api/state

请求头：`Content-Type: application/json` 和 `If-Match: "1"`。版本必须来自最近一次读取或保存的响应。

请求体可包含 `sites`、`prefs`、`note` 中的一项或多项；每一项整体替换，未提供的项保持原值。第一次保存必须提供全部三项。网站数组的顺序就是桌面顺序，`pinned` 决定是否固定到程序坞。支持空网站列表和空便签。

网站字段与当前 `DEFAULT_SITES` 一致：必填 `id`、`title`、`url`、`category`、`gradient`、`accent`、`pinned`；可选 `iconKey`、`keywords`。分类为 `ai/design/dev/media`，网址仅支持 HTTP(S)。图标渐变支持当前前端使用的十六进制颜色 linear-gradient 格式。

限制：最多 1000 个网站；名称 100 字符；网址 4096 字符；便签 100000 字符；请求体最大 1 MB。新增分类、外观字段或颜色格式时，同步修改 `backend/validation.js` 与测试。

成功返回最新完整状态与新版本。错误返回 `{"error":"具体原因"}`，包括 400 数据格式错误、403 来源不允许、409 版本冲突、413 请求过大、415 内容类型错误、428 缺少版本头。

## 参考适配器调用约定

以下调用需要前端先加载 `backend-client.js`。实际页面迁移、接线由 Antigravity 完成。

- 初始化：`await window.PortalBackend.load()`，返回保存的 `{ sites, prefs, note }` 或 `null`。
- 网站变更：`window.PortalBackend.save({ sites: state.sites })`。
- 外观变更：`window.PortalBackend.save({ prefs: state.prefs })`。
- 便签变更：`window.PortalBackend.save({ note: area.value })`。
- 保存状态：监听 `portal:sync-status` 事件，通过 `event.detail.message` 展示。

未同步修改额外保留在 `ios18_nav_outbox_v1`，重试或重新打开页面后继续处理，网络故障不会将本机修改当作已同步。若另一个页面更新了数据库，保存暂停并显示选择窗口：保留本机未同步的字段，或载入数据库版本。选择本机版本会覆盖这些字段在数据库中的最新值；网站列表按整体处理。适配器提供 `resolveConflict('local' | 'server')`，Antigravity 后续可以将默认选择窗口替换成符合页面风格的组件。

计时器、当前搜索词和分类切换属于临时界面状态，不入库。自定义导航页尚无后端存储接口。新增图片、字体等静态资源时，由 Codex 在 `backend/app.js` 的资源白名单中添加对应路径。
