# LaunchDeck · 智能起始页

iOS 风格的导航桌面，支持网页服务和 Chrome / Edge 独立新标签页扩展。

- 网站与小组件混排、拖动排序、跨页移动和单层网站文件夹。
- 时钟天气、月历、世界时钟、专注计时、速记和待办。
- 移动端紧凑 / 舒展模式；自适应 Dock，空间不足时横向滚动。
- 时间与地区支持自动判断和手动设置；扩展支持本地备份导入导出。

## 使用扩展

在本仓库的 **Releases** 下载 `launchdeck-new-tab.zip` 并解压。在 Chrome 的 `chrome://extensions/` 或 Edge 的 `edge://extensions/` 打开开发者模式，选择“加载已解压的扩展程序”，选中包含 `manifest.json` 的目录。

新建标签页即可使用；要在启动浏览器时也显示此页，可将浏览器“启动时”设为“打开新标签页”。扩展独立运行，无需启动后端。已有安装更新时，重新加载扩展并刷新新标签页。

扩展将数据保存在当前浏览器配置文件中；天气和城市搜索按需联网。权限、加载步骤及迁移说明见 [扩展说明](backend/extension/README.md)。

## 运行网页

需要 Node.js 24 或更高版本，无第三方运行时依赖。

```sh
npm start
```

打开 `http://127.0.0.1:3000/`。默认监听 `0.0.0.0:3000`，供局域网设备测试；仅本机访问可运行 `LISTEN_HOST=127.0.0.1 npm start`。网页服务是无账号的个人 / 可信局域网版本，共享导航与便签等数据。

数据库首次启动自动创建于 `backend/data/`。仓库和发布扩展不含现有用户数据、个人备份或开发协作记录。

## 开发与构建

```sh
npm test
npm run build:extension
```

扩展产物在 `backend/extension/dist/`，不提交到源码仓库；发行 ZIP 通过 GitHub Releases 分发。

| 目录 / 文档 | 内容 |
| --- | --- |
| `frontend/` | 页面、样式、小组件及交互 |
| `backend/` | HTTP 服务、SQLite、校验、测试 |
| `backend/extension/` | 扩展运行时及构建工具 |
| [后端说明](backend/README.md) | 启动配置与基础接口 |
| [功能接口](backend/FEATURE_API.md) | 小组件、布局、时间与天气契约 |
| [代码规范](CODING_STANDARDS.md) | DIY 扩展与安全约定 |

当前扩展版本为 **0.6.0**，统一扩展名称和安装包命名，扩展标签标题显示“新标签页”，兼容旧版数据及备份。升级已加载的扩展时，请将新版内容覆盖到原目录，保留加载路径后重新加载，先导出备份。

自定义壁纸上传、网页源标题及时钟天气详情中的设置弹层修复尚待前端版本完成。Bitwarden 通行密钥自动备份未启用，核验依据见 [兼容性报告](backend/extension/BITWARDEN_COMPATIBILITY.md)。手机真机手势及 Chrome / Edge 的实际安装体验仍需设备验证。
