# LaunchDeck · 智能起始页

<p align="center">
  <strong>iOS 18 风格的独立导航与智能起始页 —— 支持 Chrome / Edge 独立新标签页扩展、Docker Compose 自托管与本机零依赖运行</strong>
</p>

<p align="center">
  <a href="https://github.com/limitpea-hash/LaunchDeck/releases/tag/v0.10.10"><img src="https://img.shields.io/badge/release-v0.10.10-0a8f5a?style=flat-square" alt="Release v0.10.10" /></a>
  <img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-Manifest%20V3%20(%E2%89%A5120)-1a73e8?style=flat-square" alt="Chrome / Edge MV3" />
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A524%20(%E9%9B%B6%E7%AC%AC%E4%B8%89%E6%96%B9%E4%BE%9D%E8%B5%96)-339933?style=flat-square" alt="Node.js >= 24" />
  <img src="https://img.shields.io/badge/Docker%20Compose-Ready-2496ed?style=flat-square" alt="Docker Compose Ready" />
</p>

> **最新版本 v0.10.10** · [下载浏览器扩展 LaunchDeck-v0.10.10.zip](https://github.com/limitpea-hash/LaunchDeck/releases/download/v0.10.10/LaunchDeck-v0.10.10.zip) · [查看发布页与校验值](https://github.com/limitpea-hash/LaunchDeck/releases/tag/v0.10.10) · [完整更新日志](CHANGELOG.md)

LaunchDeck 将常用网站、单层文件夹、平滑悬停 Dock 与多规格效率小组件整合在同一张桌面上。无第三方运行时依赖、无强制云端账号，数据默认保存在本地浏览器或你自己的 SQLite 服务中，既可作为 Chrome / Edge 独立新标签页扩展离线运行，也可通过 Docker Compose 快速部署在 NAS、VPS 或局域网主机上。

---

## 运行形态对比

| 使用方式 | 运行依赖 | 数据存储位置 | 适用场景 |
| --- | --- | --- | --- |
| **浏览器扩展（推荐个人单机）** | Chrome / Edge ≥ 120 | 浏览器 `chrome.storage.local` + 本地 IndexedDB | 打开新标签页即用，无需启动任何后台服务 |
| **Docker Compose（推荐自托管 / NAS）** | Docker + Docker Compose | Docker 命名卷 `/data/portal.sqlite` + 浏览器壁纸缓存 | 局域网多设备共享导航/便签/待办，支持 Lucky / Nginx / Caddy 反代 |
| **本机 Node.js 直跑** | Node.js ≥ 24（零 `npm install`） | `backend/data/portal.sqlite` + 浏览器壁纸缓存 | 轻量本地开发、二次定制与源码打包扩展 |

---

## 核心特性

### 1. 自由网格桌面与平滑悬停 Dock
- **固定格子直拖与实时让位**：编辑模式下可将网站卡片与小组件直接拖入主网格的空格或已占用区，拖动过程实时预览邻卡让位，松手持久化保存固定格子坐标并支持跨页移动。
- **多尺寸卡片与单层文件夹**：网页卡片默认 `1×1`，可切换为 `2×2`；拖至另一网站图标中心可合并为单层文件夹并支持改名、排序与解散。
- **平滑悬停自适应 Dock**：光标在底部 Dock 移动时，目标图标与邻近图标连续平滑缩放并自然交接焦点；图标过多时可横向滚动且悬停项不被裁切，尊重系统「减少动态效果」偏好。
- **响应式双视图**：窄屏与短窗口自动呈现紧凑摘要并提供「查看全部」，移动端支持「紧凑总览 / 舒展分屏」自由切换。

### 2. 全球汇率换算与多规格小组件
- **全球国家/地区汇率换算（v0.10.10 新特性）**：
  - 覆盖 Frankfurter v2 实测支持的全部 **158 种真实国家/地区法定货币**（自动排除加密货币与贵金属，不新增扩展联网权限）。
  - 升级为 iOS 18 悬浮国家/货币选择弹层，内置 **18 个热门货币一键快选**与 **6 大洲/地区分类**（亚洲、欧洲、美洲、大洋洲、中东、非洲）。
  - 支持按中文/英文国家名、拼音、常见俗称、货币名或 3 位 ISO 代码即时检索；支持多国共用货币反查（例如搜索「法国」「德国」可直接匹配并标注对应欧元区 `EUR`）。
  - 金额仅在本机实时计算，服务端缓存上限 128 对、前端离线缓存 80 对并支持陈旧汇率回退。
- **完整月历与逐小时天气**：
  - `4×4` 月历同屏展示整月日期、选中日待办与个人日期圆点标记，离线内置 **2025–2027 年中国大陆法定节假日与调休安排**；另提供 `2×2` 周历速览。
  - 时钟与天气提供 `2×2` 实况卡与 `3×2` **16 小时横向滚动预报**，大陆城市与 IP 近似定位可选接入 `uapis.cn`，国际城市与天气采用 Open-Meteo。
- **效率组件、自定义组件包与通知订阅**：
  - 内置便签、待办、世界时钟、专注计时、日子倒数、习惯打卡、今日面板、迷你天气与今日日期等组件。
  - 支持预览并导入本地 JSON 自定义组件包，以及添加已授权的 HTTPS JSON 通知源（顶部未读胶囊仅在有未读消息时出现）。

### 3. 外观定制与隐私边界
- 支持跟随系统深浅色或手动切换夜间模式，支持调整图标风格、尺寸与主题色调。
- 支持上传本地 PNG / JPEG / 静态 WebP 壁纸，仅保存在当前浏览器 IndexedDB 中，不上传任何服务器。
- 所有外部网络能力（天气、定位、汇率、HTTPS 通知源）均遵循按需授权与严格 CSP 策略，无遥测、无云端账号同步。

---

## 方式一：安装浏览器扩展（Chrome / Edge）

扩展内置本地数据服务与校验模块，安装后**无需运行 Node.js 或 Docker**。要求 Chromium 内核最低 **Chrome 120**。

### 首次安装
1. 前往 [v0.10.10 发布页](https://github.com/limitpea-hash/LaunchDeck/releases/tag/v0.10.10) 下载 [LaunchDeck-v0.10.10.zip](https://github.com/limitpea-hash/LaunchDeck/releases/download/v0.10.10/LaunchDeck-v0.10.10.zip)，解压到本地固定目录。
2. 在 Chrome 打开 `chrome://extensions/`（或 Edge 打开 `edge://extensions/`），开启右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择解压后直接包含 `manifest.json` 的文件夹。
4. 新建标签页即可使用；如需启动浏览器直接打开，可在浏览器「启动时」设置中选择「打开新标签页」。

### 从旧版本覆盖升级
1. **导出备份**：升级前在扩展「设置 → 数据同步 → 本地数据备份」导出完整 JSON 备份。
2. **覆盖原目录**：将新版 ZIP 解压并**直接覆盖**原先加载的目录（切勿先卸载旧扩展，卸载会清空原扩展 ID 下的本地数据）。
3. **重新加载**：在扩展管理页点击 LaunchDeck 的 **重新加载** 并刷新新标签页。也可提前在「设置 → 更新与组件」中核对升级包版本与 `SHA256SUMS.txt` 校验值。

更多权限边界与存储细节见 [扩展说明](backend/extension/README.md)。

---

## 方式二：Docker Compose 部署（自托管 / NAS / 局域网）

镜像基于 `node:24-alpine` 构建，零第三方 npm 依赖，默认以非 root 用户运行并自带 `/api/health` 健康检查与 SQLite 持久化数据卷。

### 快速启动
```sh
git clone https://github.com/limitpea-hash/LaunchDeck.git
cd LaunchDeck

# 可选：复制环境变量模板，按需修改端口、局域网允许 Host 或反向代理配置
cp .env.example .env

# 构建镜像并后台启动（默认访问 http://127.0.0.1:3000）
docker compose up -d --build

# 查看容器状态与健康检查
docker compose ps
```

### 环境变量说明（`.env`）

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `LAUNCHDECK_PORT` | `3000` | 映射到宿主机的监听端口 |
| `LAUNCHDECK_CONTAINER_NAME` | `launchdeck` | 容器名称 |
| `TZ` | `Asia/Shanghai` | 容器时区 |
| `ALLOWED_HOSTS` | *(空)* | 额外允许访问的局域网 IP 或域名（逗号分隔，不含协议与端口），如 `192.168.1.50,nav.example.com` |
| `TRUST_PROXY` | `false` | 前方使用 Lucky / Nginx / Caddy 等反向代理提供 HTTPS 时设为 `true`，并配合 `ALLOWED_HOSTS` 透传 `Host` 与 `X-Forwarded-Proto: https` |

### 局域网与反向代理注意事项
- LaunchDeck 后端默认强制校验请求 `Host` 与同源 `Origin`，防止 DNS Rebinding 与跨站写入。
- 在 Docker 桥接模式下，通过宿主机局域网 IP（如 `http://192.168.1.50:3000`）或自定义域名访问前，务必在 `.env` 中配置 `ALLOWED_HOSTS`；通过 HTTPS 反向代理访问时需同时开启 `TRUST_PROXY=true`。
- SQLite 数据库持久化于 Docker 命名卷 `launchdeck_data` 的 `/data/portal.sqlite`，升级镜像或重建容器不会丢失数据。

---

## 方式三：本机 Node.js 运行与源码构建

需要 **Node.js ≥ 24**（内置 `node:sqlite` 与测试框架，无需执行 `npm install`）：

```sh
# 启动本地网页服务（默认监听 0.0.0.0:3000，数据库位于 backend/data/portal.sqlite）
npm start

# 仅本机回环访问
LISTEN_HOST=127.0.0.1 npm start

# 指定端口与额外允许的 Host
PORT=3001 ALLOWED_HOSTS=nav.local npm start

# 运行全量自动化测试（210 项）
npm test

# 从源码构建独立浏览器扩展（输出至 releases/launchdeck-new-tab/ 与 .zip）
npm run build:extension

# 只读导出网页服务数据，用于迁移至浏览器扩展
npm run export:extension
```

---

## 数据备份、恢复与 Bitwarden 兼容

LaunchDeck 提供两类边界清晰的本地备份：

- **扩展版完整备份（JSON）**：位于「设置 → 数据同步 → 本地数据备份」，涵盖网站、分类与自定义页面、文件夹、Dock 固定项、小组件坐标与尺寸、便签、待办、组件配置、导入组件包与时区设置（不含本机 IndexedDB 图片壁纸）。
- **导航专用备份 & Bitwarden 单条登录 JSON**：仅包含网站、页面、文件夹、Dock 与小组件排布占位，**不包含**便签、待办、私密组件配置或壁纸；恢复前支持预览校验，恢复后保留目标设备原有的便签、待办与偏好设置。
- 导出的 Bitwarden 文件为标准明文单条登录 JSON，由用户手动导入至 Bitwarden 保险库加密管理，本项目不读取任何保险库密码或凭据。详见 [Bitwarden 兼容性报告](backend/extension/BITWARDEN_COMPATIBILITY.md)。

---

## 项目目录与文档导航

```text
LaunchDeck/
├── frontend/               # 前端应用、iOS 18 样式、小组件与交互模块（纯 ESM）
├── backend/                # 零依赖 Node.js 后端、SQLite 持久化、共享校验模块与测试
│   └── extension/          # Chrome / Edge MV3 扩展清单、构建器与本地运行时
├── Dockerfile              # node:24-alpine 生产镜像定义
├── docker-compose.yml      # Docker Compose 一键部署编排
└── .env.example            # 容器部署环境变量模板
```

| 文档 | 内容说明 |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) | 完整版本发布历史、升级指引与验证记录 |
| [backend/extension/README.md](backend/extension/README.md) | 浏览器扩展权限边界、加载覆盖升级与离线存储说明 |
| [backend/README.md](backend/README.md) | 网页服务启动参数、环境变量与 SQLite 目录说明 |
| [backend/FEATURE_API.md](backend/FEATURE_API.md) | 布局协议、小组件规格、全球汇率目录、通知订阅与组件包契约 |
| [backend/extension/BITWARDEN_COMPATIBILITY.md](backend/extension/BITWARDEN_COMPATIBILITY.md) | 导航备份结构、容量限制与独立恢复机制 |
| [CODING_STANDARDS.md](CODING_STANDARDS.md) | 模块职责划分、前后端契约与安全开发规范 |

---

## 常见问题

- **安装浏览器扩展后还需要运行 Docker 或 `npm start` 吗？**
  不需要。浏览器扩展自带完整本地运行时，完全脱离后端服务独立工作。
- **更换电脑或重装浏览器如何迁移扩展数据？**
  在旧设备导出完整备份 JSON，在新设备加载扩展后导入即可；本地图片壁纸需重新选择图片文件。
- **升级后天气或汇率没有自动更新？**
  请打开「设置」检查对应联网权限开关（汇率数据源 `api.frankfurter.dev`、大陆定位 `uapis.cn`、国际天气 `open-meteo.com`），按浏览器弹窗确认授权后点击刷新。
- **Docker 部署后用局域网 IP 访问提示 `403 访问地址不在允许列表中`？**
  在 `.env` 中添加 `ALLOWED_HOSTS=<你的局域网IP或域名>` 并重启容器（`docker compose up -d`）即可；若经由 HTTPS 反代访问，请同时设置 `TRUST_PROXY=true`。
