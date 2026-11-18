# Bitwarden 专用登录条目与自定义字段实验

## 已观察结果（2026-11-11）

用户手动导入单条合成登录，并在刷新后的普通HTTP表单中通过Bitwarden选择条目自动填充。Codex点击校验后，页面确认50个合成网站、顺序及8个Dock固定标记完整。实际填充值由工具脱敏，未尝试提取其内容；通过应用自身的完整校验与合成预览核对结果。137项项目检查通过。

已验证“选择条目并自动填充后恢复”的数据通路；未证明页面按钮可强制打开Bitwarden选择框。独立扩展chrome-extension页面、自动保存/更新、自托管版本和跨设备恢复仍未实测。没有改动真实导航或将此实验接入发布版本。

## 运行与限制

运行 `node backend/experiments/login-fields/server.js`，访问 `http://localhost:3008/`。仅使用50个固定合成网站；不访问用户导航、SQLite、Cookie、主密码、登录令牌或其他保险库内容。此临时静态服务器只承载实验，不是备份服务或保险库代理。

实验将 gzip/Base64 备份分为最多16段、每段最多3000个ASCII字符，另存清单。每个值均作为Bitwarden登录条目的隐藏自定义字段（type=1），字段名与表单input的id/name精确对应。Bitwarden负责保险库加密；实验本身未实现额外密码加密层。

官方自定义字段值上限5000字符按保险库加密后的长度计算，3000字符只是保守实验分段值，仍需在具体服务器与客户端版本实测。Node与浏览器压缩实现可能输出不同字节和长度，恢复依照保存的清单校验，不要求跨实现重新压缩结果相等。

1. 下载实验页生成的单条登录JSON，手动通过Bitwarden的JSON导入入口导入。文件仅一个“LaunchDeck 合成备份 · 字段验证”条目，精确URI匹配localhost:3008根路径。重复导入会创建重复条目。
2. 清空/刷新实验页，点击“恢复备份”聚焦账号字段，观察Bitwarden能否自动显示内联建议。页面没有直接打开第三方扩展弹窗的权限。
3. 用户选择测试条目并自动填充，点击校验。分段数、长度、SHA256、受限解压和固定合成内容全部通过后才显示预览；丢段或截断不得部分恢复。
4. 普通HTTP/HTTPS网页与chrome-extension新标签页必须区分。Bitwarden公开源码对扩展协议返回空page details，不能据网页版成功宣称独立扩展支持。未经用户同意不增加额外托管桥接页或配套服务。

本轮自动化无法控制Bitwarden内部页面：浏览器URL安全策略拒绝chrome-extension协议的页面访问。不得通过native UI、DevTools、脚本、CLI保险库API等方式绕过该拒绝；此实验的条目导入交给用户操作，后续验收限于获准的普通HTTP实验页。

参考：[自定义字段](https://bitwarden.com/help/custom-fields/)、[字段自动填充](https://bitwarden.com/help/auto-fill-custom-fields/)、[固定版本自动填充源码](https://github.com/bitwarden/clients/blob/15b835e1efc9e0903cd52f901f57cbae197a403f/apps/browser/src/autofill/services/autofill.service.ts#L183)。
