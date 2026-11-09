# Bitwarden 通行密钥备份核验

核验日期：2026-11-09。目标仅是保存网站与排列信息，不包含壁纸或小组件正文。

## 结论

本轮不启用“通过 Bitwarden 通行密钥自动保存与恢复导航备份”。当前检查到的 Bitwarden 浏览器客户端没有将 WebAuthn `largeBlob` 接入保存 / 读取路径。成功保存普通通行密钥不能作为导航备份成功的依据。

## 可复查证据

固定核验版本：Bitwarden clients 提交 `d63a79cf2f1d222d10e8d3f0253ca65b050eb192`。

- [浏览器凭据客户端](https://github.com/bitwarden/clients/blob/d63a79cf2f1d222d10e8d3f0253ca65b050eb192/libs/common/src/platform/services/fido2/fido2-client.service.ts)：注册结果仅返回 `credProps` 扩展；认证参数映射将扩展设为空对象，未处理 `largeBlob` 请求及其结果。
- [认证器接口](https://github.com/bitwarden/clients/blob/d63a79cf2f1d222d10e8d3f0253ca65b050eb192/libs/common/src/platform/abstractions/fido2/fido2-authenticator.service.abstraction.ts)：当前接口没有附加数据保存 / 读取契约。
- [WebAuthn 标准](https://www.w3.org/TR/webauthn-3/#sctn-large-blob-extension)：`largeBlob` 为可选能力；必须分别确认支持、写入成功与读回一致。浏览器整体支持、PRF 支持、凭据创建成功都不能代替这些检查。

以上是固定版本源码核验。已检查内置浏览器及当前可控的 Chrome 配置，后者扩展菜单未安装 Bitwarden；未切换用户的其他浏览器配置或安装并登录新保险库。未创建真实保险库条目，也未进行实际 Bitwarden 双设备保存 / 恢复测试。不将此结果描述为已完成真机测试。

## 后续启用条件

只有在指定 Bitwarden 版本和受支持的网页来源中，确认 `largeBlob.supported`、`written`、完整字节读回，以及第二设备恢复均成功，才可启用该备份途径。必须检查提供凭据的实际密码管理器；系统认证器成功不能归因于 Bitwarden。不得将备份塞进通行密钥名称、用户名或用户标识字段。

验证应使用合成数据，不能上传用户现有导航或索取保险库主密码。任何保存失败、取消、容量不足或校验失败都不能修改现有布局。已有本地 JSON 备份导入导出继续保留；本次没有擅自改成 CLI 常驻服务或第三方云同步。
