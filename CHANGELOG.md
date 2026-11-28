# Changelog

## v0.10.10 (2026-11-28)

发布页：[v0.10.10 Release](https://github.com/limitpea-hash/LaunchDeck/releases/tag/v0.10.10) · 下载扩展包：[LaunchDeck-v0.10.10.zip](https://github.com/limitpea-hash/LaunchDeck/releases/download/v0.10.10/LaunchDeck-v0.10.10.zip)

### 本次更新（v0.10.10）

- **汇率换算支持按国家/地区选币与热门货币分类** 货币目录从 12 种扩展至 Frankfurter v2 实测支持的全部 158 种真实国家/地区法定货币（排除加密货币与贵金属，不新增扩展联网权限）。将卡片与详情页的原生下拉框升级为 iOS 18 悬浮国家/货币选择弹层，内置 18 个热门货币一键快选、6 大洲/地区筛选与分组浏览，并支持按中英文国家名、拼音、俗称、货币名或 3 位代码即时搜索（如搜索「法国」「德国」可直接匹配并标注对应欧元 `EUR`）。服务端汇率缓存上限提升至 128 对，前端本地缓存上限提升至 80 对。
- **新增 Docker & Docker Compose 一键部署** 提供基于 `node:24-alpine` 的 [Dockerfile](Dockerfile)、[docker-compose.yml](docker-compose.yml) 与 [.env.example](.env.example)，内置非 root 运行、健康检查与 SQLite 持久化卷。后端新增可选 `ALLOWED_HOSTS`（逗号分隔局域网 IP / 域名白名单）与 `TRUST_PROXY`（配合反向代理 HTTPS 来源校验）环境变量，默认安全边界不变。

### 安装与覆盖升级

- **浏览器扩展首次安装** 下载并解压 [LaunchDeck-v0.10.10.zip](https://github.com/limitpea-hash/LaunchDeck/releases/download/v0.10.10/LaunchDeck-v0.10.10.zip) 到本地固定目录，在 `chrome://extensions/` 或 `edge://extensions/` 开启开发者模式，点击「加载已解压的扩展程序」选择包含 `manifest.json` 的目录。
- **浏览器扩展覆盖升级** 先在扩展「设置 → 数据同步 → 本地数据备份」导出完整备份，将 `LaunchDeck-v0.10.10.zip` 解压覆盖到原加载目录（切勿卸载旧扩展），在扩展管理页点击「重新加载」并刷新新标签页。
- **Docker Compose 部署** 在项目根目录执行 `docker compose up -d --build` 即可启动网页服务；需局域网 IP 或反代域名访问时在 `.env` 中配置 `ALLOWED_HOSTS` 与 `TRUST_PROXY=true`。

### 验证说明

- 自动化测试套件 **210 项全部通过**（含 158 币种目录冻结/多国映射/缓存淘汰及 `ALLOWED_HOSTS`/`TRUST_PROXY` 专项测试）。
- `LaunchDeck-v0.10.10.zip` 已通过 ZIP 结构完整性、SHA-256 与相对 `0.10.9` 的升级校验。
- Docker Compose 镜像 `launchdeck:0.10.10`（`node:24-alpine`）已实测健康检查、实时汇率拉取、HTTPS 反代同源写入、`Secure` Cookie、非法 Host/Origin 拦截及容器重启后 SQLite 持久化。
- 无头 Chrome 已完成桌面 `1440px`（浅色与夜间模式）及窄屏 `375px` / `320px` 视觉与交互验收（未包含 Windows 实体机与触屏手机真机回归）。

---

## v0.10.9 (2026-11-23)

发布页：[v0.10.9 Release](https://github.com/limitpea-hash/LaunchDeck/releases/tag/v0.10.9) · 下载扩展包：[LaunchDeck-v0.10.9.zip](https://github.com/limitpea-hash/LaunchDeck/releases/download/v0.10.9/LaunchDeck-v0.10.9.zip)

### 本次补丁更新（v0.10.9）

- **Dock 悬停平滑缩放与过渡** 光标在底部 Dock 移动时，目标图标与相邻图标连续平滑缩放。光标移向相邻图标时焦点自然交接，前一枚图标逐步缩回、下一枚图标随光标靠近逐步放大，移出 Dock 区域后平缓恢复原始尺寸。

### 自上次公开发布（v0.9.0）以来的重点更新

- **固定格子直拖排布与坐标持久化** 编辑模式下可将网站与小组件直接拖放到主网格任意空格或已占用位置，拖动中实时预览邻卡让位，松手保存固定格子坐标并支持备份恢复。网页卡片支持切换 `1×1` 与 `2×2` 尺寸。
- **自适应悬停放大 Dock** Dock 支持鼠标悬停放大与邻近联动放大，图标超出可视宽度时支持横向滚动并保持悬停图标完整显示。
- **4×4 完整月历与防裁切优化** 新增 `4×4` 月历（同屏查看整月日历与选中日待办安排、个人日期圆点标记，离线内置 2025–2027 年中国大陆节假日与调休），保留 `2×2` 每周速览月历，修复正常浏览与编辑模式下月历标题、首字圆角及删除按钮的遮挡和裁切问题。
- **天气、效率扩展、汇率与本地组件包** 时钟与天气升级为 `2×2` 实况卡片与 `3×2` 16 小时横向滚动预报。新增迷你天气、今日日期、一键专注、日子倒数、习惯打卡、今日面板与 `2×2` 汇率换算卡（按需授权数据源），支持预览并导入 JSON 组件包及校验本地升级包信息。
- **HTTPS JSON 通知订阅与条件未读胶囊** 支持添加已授权的 HTTPS JSON 通知源与内置收件箱，顶部未读胶囊仅在存在未读消息时显示。
- **触控、短窗口排版与城市 / IP 定位改进** 优化小尺寸卡片在移动端与短窗口下的紧凑排版、编辑尺寸菜单展开与同列纵向拖放落点计算。完善城市搜索示例提示，大陆城市检索与 IP 近似位置接入 `uapis.cn` 可选联网授权，国际城市与天气继续使用 Open-Meteo。

### 安装与覆盖升级

- **首次安装** 下载并解压 [LaunchDeck-v0.10.9.zip](https://github.com/limitpea-hash/LaunchDeck/releases/download/v0.10.9/LaunchDeck-v0.10.9.zip) 到本地固定目录，在 `chrome://extensions/` 或 `edge://extensions/` 开启开发者模式，点击「加载已解压的扩展程序」选择包含 `manifest.json` 的目录。
- **从旧版升级** 先在扩展「设置 → 数据同步 → 本地数据备份」导出完整备份，将新版压缩包解压覆盖到原加载目录（切勿卸载旧扩展），在扩展管理页点击「重新加载」并刷新新标签页。详细说明见 [README.md](README.md) 与 [扩展说明](backend/extension/README.md)。

### 验证说明

本地自动化测试套件 202 项通过，并在桌面浏览器完成 4 至 20 枚图标的 Dock 悬停与滚动样例验证（未包含 Windows 实体机与手机真机回归）。

---

## v0.9.0

上一次 GitHub 公开发布版本，引入夜间模式、多尺寸小组件基础框架及包含组件尺寸的导航备份支持。历史发布文件见 [v0.9.0 Release](https://github.com/limitpea-hash/LaunchDeck/releases/tag/v0.9.0)。
