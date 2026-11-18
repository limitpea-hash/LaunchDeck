# 分页通行密钥实验

这是独立实验，不是已经启用的备份功能。仅包含两个固定合成页面，不访问真实导航、SQLite、浏览器存储或生产 API；读回结果仅预览，不写入 LaunchDeck。

从项目根目录运行 `node backend/experiments/passkey-pages/server.js`，使用已安装并解锁 Bitwarden 的浏览器访问 `http://localhost:3007/`。这只是提供实验网页的临时服务器，不是保险库代理。页面在本机运行，不连接 Bitwarden HTTP API。

勾选提供者确认后，逐页执行创建、写入、读回：

1. 创建请求使用 discoverable credential、随机32字节 user.id，以及 `largeBlob.support: required`。实际提供者仍必须由用户在提示中选择 Bitwarden，不能依据浏览器 API 存在推断。
2. 创建结果必须明确报告 `largeBlob.supported === true`，否则停止；某些提供者可能已建立一个测试凭据，但页面数据没有保存。
3. 写入必须明确返回 `written === true`，随后另一次读取必须与原压缩字节完全一致，并通过封装、版本、批次、分页和SHA256检查，才报告本机读回通过。
4. 导入按钮通过 discoverable credentials 选择器读取一页，只显示固定合成数据。刷新后可独立读取，不依赖保存凭据ID的本机索引。
5. 云端结论需要第二设备、相同RP ID以及已同步的Bitwarden凭据再次读回。单机成功、系统钥匙串成功和通行密钥创建成功，都不能作为Bitwarden云端数据备份成功的证据。

分页只解决每份数据大小，不提供缺失的存储能力。只有支持largeBlob的提供者才能使用这条路线。此实验不把数据塞入账号名称或64字节的userHandle，不使用通行密钥PRF代替云端存储，不绕过浏览器来源限制。

实验RP ID固定为`localhost`；端口不属于RP ID。正式产品如果可行还需稳定受信任来源设计，不能假设局域网IP、localhost、不同域名和chrome-extension来源间的凭据可以直接互用。当前原始扩展权限与发布产物均不变。
