# 小组件、设备设置、时钟与天气接口

状态：后端已实现。前端由 Antigravity 根据根目录 `TASK.md` 接入。现有 `/api/state` 的 `{ sites, prefs, note }` 和版本号保持兼容；不要将本文新字段提交到旧接口。

## 通用约定

- 同源 `/api`，JSON 请求与响应。普通 fetch 默认携带同源 Cookie，也可显式设置 `credentials: 'same-origin'`。
- 新的两个持久化文档统一返回 `{ revision, state, updatedAt }` 和 `ETag: "版本号"`；PATCH 请求必须带对应文档的 `If-Match`。版本号属于各自的接口，不互相通用。
- PATCH 按顶层字段替换：提供的对象或数组需完整提交，未提供的顶层字段保留。默认文档版本为 0，首次成功保存变为 1。
- 错误为 `{ error: string }`。400 数据不合法；403 来源不允许；405 方法不允许；409 版本冲突；413 请求过大；415 需要 JSON；428 缺少版本；429 限流（接口限流带 `Retry-After`）；503 外部服务或存储暂时不可用。
- 新接口按 socket 来源 IP 限制每分钟 120 次，其中环境、城市搜索和天气接口合计每分钟 30 次。忽略客户端传入的代理 IP 头。实际外部请求最多并发 4 个、每分钟 60 个，缓存命中不占外部请求额度。
- 外部请求仅允许固定 HTTPS 数据源，拒绝重定向，5 秒超时，响应最多 256 KB。不得传入任意 URL。

## GET /api/widgets

返回 `{ schemaVersion: 1, widgets: WidgetDefinition[] }`。每项包含：

```json
{
  "type": "todo",
  "title": "待办清单",
  "version": 1,
  "sizes": ["medium"],
  "defaultConfig": { "hideCompleted": false },
  "capabilities": ["shared-todos"]
}
```

已注册六种类型：`clock-weather`、`focus-timer`、`quick-note`、`todo`、`calendar`、`world-clock`。`capabilities` 是代码约定与数据需求说明，不是任意代码的安全沙箱。

## GET /api/widgets/state / PATCH /api/widgets/state

这是所有设备共享的小组件布局与待办数据，独立于 `/api/state`。

```json
{
  "revision": 0,
  "state": {
    "layout": [
      { "id": "todo", "type": "todo", "enabled": true, "order": 3, "config": { "hideCompleted": false } }
    ],
    "todos": [
      { "id": "todo_1", "text": "编写一个自己的组件", "completed": false, "dueDate": "2026-11-04" }
    ]
  },
  "updatedAt": null
}
```

上例仅演示字段；实际默认布局包含全部六种组件，全部启用，顺序为 0–5；待办默认为空。

PATCH 示例：`{ "todos": [] }`。支持字段 `layout`、`todos`、`desktop`，至少一项。允许空布局与空待办。

- `layout` 最多 24 项；`id` 必须唯一，1–80 位字母、数字、下划线或连字符；`order` 为 0–23 的唯一整数，前端按 order 排序。
- 类型必须注册；`enabled` 为布尔值。`config` 严格白名单如下：

| 类型 | 完整 config | 限制 |
| --- | --- | --- |
| `clock-weather` | `{ showSeconds: true }` | 布尔值；地点与时区使用设备设置 |
| `focus-timer` | `{ workMinutes: 25, breakMinutes: 5 }` | 整数，分别 1–180 / 1–60 分钟 |
| `quick-note` | `{}` | 内容继续存旧 `/api/state.note` |
| `todo` | `{ hideCompleted: false }` | 布尔值；内容存本接口 todos |
| `calendar` | `{ weekStartsOn: 1 }` | 0 表示周日、1 表示周一；没有日程账户接入 |
| `world-clock` | `{ zones: [{ label: "上海", timeZone: "Asia/Shanghai" }] }` | 1–8 个地点，名称最多 60 字符，合法 IANA 时区 |

- `todos` 最多 200 条；`id` 规则同上且不能重复；`text` 为 1–500 字符纯文本；`completed` 为布尔值；可选 `dueDate` 为 null 或真实存在的 `YYYY-MM-DD` 日期。
- 请求体最多 512 KB。未知字段（如 script、HTML、模块 URL）拒绝保存。

### 混排桌面（扩展 0.3.0 / Web）

`desktop` 默认 null，旧文档可缺省；由前端在读取已有站点、页面与组件后一次迁移。已有桌面不能每次按站点 category 重新生成。

```json
{
  "schemaVersion": 1,
  "pages": [{ "id": "all", "title": "精选主页", "icon": "sparkles", "isSystem": true, "order": 0 }],
  "placements": [
    { "kind": "site", "id": "example", "pageId": "all", "order": 0 },
    { "kind": "widget", "id": "calendar", "pageId": "all", "order": 1 }
  ]
}
```

上例省略其余四个必需系统页面与其他启用组件，完整请求必须满足：

- 5–50 个页面，包含 all/ai/design/dev/media；自定义 ID 为 page_ 加 1–64 个字母数字下划线连字符。标题 1–100 字符，图标仅 sparkles/folder/code/book/globe，isSystem 与 ID 一致，order 为 0–49 且唯一。
- 最多 5000 条 placement，kind 仅 site/widget，id 为 1–100 位字母数字下划线连字符，pageId 必须存在。同页 order 为 0–4999 且唯一，同页同 kind/id 唯一；站点可以跨页有镜像。
- 每个启用组件恰好一个 placement，隐藏或不存在的组件不能放置。变更启用状态时与 desktop 一起提交，数据库在事务内校验合并后的完整文档；失败不会增加 revision。仅更新 todos 或 config 会保留 desktop。
- 移除组件只设 enabled=false 并移除 placement，保留配置、待办、便签。位置记录只存引用，不接受 URL、HTML 或模块名；站点定义由原站点接口管理。其他设备暂缺定义的站点引用应保留，不能静默删除。
- Web 与扩展使用相同校验，备份可以往返保存 desktop，旧备份仍可导入。详细迁移与交互契约见根目录 TASK.md 当前任务。

### 网站文件夹（0.5.0）

`desktop.schemaVersion = 2` 时新增必填 `folders` 数组，最多200项。每项为 `{id,title,siteIds}`：id 为 `folder_` 后接1–64位安全ID字符；title为去首尾空白、无控制字符的1–60字符文本；siteIds为2–100个唯一站点ID。网站ID仍为1–100位字母数字下划线连字符，允许暂未解析到的引用。

顶层 `placements.kind` 新增 `folder`，其id引用folders记录。每个folder恰好一个顶层位置，位置的pageId决定所属分类。成员均为站点，无嵌套/组件/HTML/URL字段。同分类内站点不能同时位于顶层和文件夹，也不能位于多个文件夹；跨分类旧镜像可保留。顶层位置加全部文件夹成员合计最多5000项，HTTP请求体上限仍为512KB。

文件夹记录、成员变化和顶层位置通过一次 `PATCH {desktop:完整桌面}` 原子保存，沿用If-Match/revision。拖出后不足两个成员时，前端应同时解散并把剩余站点放回原槽位；后端拒绝空/单成员文件夹及孤儿引用。重命名只修改title；删除网站需同时清理所有成员并处理解散。文件夹名称只按文本渲染。

GET和PATCH继续兼容v1/null；已有v2文档的普通PATCH不能降回v1/null（409，提示刷新），防止旧标签页抹掉文件夹。只更新todos/layout/config会保留desktop。扩展与SQLite使用相同校验和保护；用户明确执行备份导入时可恢复旧v1/null备份。备份外层格式仍为version1，不需要更换数据库表。

### 移动端显示方式（0.4.0）

“紧凑 / 舒展”是浏览器本地的展示偏好，不增加 API 字段。舒展模式的分类内分屏也只存在于视图中；保存仍使用原始分类 `pageId` 和卡片顺序，不得提交临时分屏 ID 或因切换模式改写 `desktop.pages`。

模式切换、窗口变化、摘要展开和预览不得增加文档 revision。只有用户确认内容、配置或最终拖动位置时沿用现有 PATCH / If-Match；同分类跨分屏移动必须换算为真实分类中的 before-anchor。各设备共享内容与排序，显示模式及容量分屏独立。

## GET /api/device/settings / PATCH /api/device/settings

设备设置按浏览器 Cookie 隔离，不受共享文档版本影响。先 GET 获取默认设置、Cookie 和版本，再 PATCH；不要在页面 URL、localStorage 或日志中传递设备标识。

服务端设置随机 `agy_device` Cookie（HttpOnly、SameSite=Strict、Path=/api）；数据库只保存其 SHA-256 摘要。HTTP 下 Cookie 无 Secure 属性；直接 TLS 连接下会启用 Secure。此 Cookie 用于设备隔离，不是用户账号认证。不同访问主机（127.0.0.1 与局域网 IP）会有不同的浏览器 Cookie。

默认响应 state：

```json
{
  "location": { "mode": "auto", "manual": null },
  "clock": {
    "mode": "automatic",
    "timeZoneMode": "browser",
    "timeZone": "Asia/Shanghai",
    "offsetSeconds": 0
  },
  "weather": { "temperatureUnit": "celsius" }
}
```

PATCH 支持 `location`、`clock`、`weather`，至少一项，每项为完整对象，请求体最多 16 KB。

### 位置设置

`location.mode` 支持 `auto`、`browser`、`ip`、`manual`。

- auto：已授权传入的浏览器坐标优先；否则使用 IP 近似位置。
- browser：仅使用传入浏览器坐标；没有坐标时返回待授权提示，不自动发起 IP 查询。
- ip：通过真实 socket 公网 IP 定位；若是回环或私有地址，定位服务器网络出口 IP，标记 `network-ip`，不会假装是设备精确位置。
- manual：使用已保存的地点，优先于本次传入的浏览器坐标。

`manual` 必须是 null 或以下完整地点对象；mode=manual 时不能为 null：

```json
{
  "name": "上海",
  "latitude": 31.23,
  "longitude": 121.47,
  "timeZone": "Asia/Shanghai"
}
```

名称最多 120 字符；经纬度须为数字，分别为 -90–90、-180–180。城市搜索结果包含额外字段，保存前只提取以上四项。

自动获取的浏览器坐标和 IP 检测结果不入库。只有用户明确保存的手动地点会持久化。服务端最多保存 500 份设备设置；读取默认设置不创建数据库记录。

### 时钟设置

- `mode`：automatic 或 manual。manual 使用 `offsetSeconds` 校准**网页显示时间**，不会调整操作系统时间。
- `offsetSeconds`：整数，范围 ±315576000 秒（约十年）；automatic 模式显示时忽略该偏移。
- `timeZoneMode`：browser / location / manual。
- `timeZone`：合法 IANA 名称，manual 时区模式时使用；例如 Asia/Shanghai、Europe/London 或 UTC。不接受不存在的时区或裸 UTC 偏移字符串。

手动设时可先获取 `/api/time` 的 serverEpochMs，将用户希望显示的目标 UTC 毫秒值换算为 `Math.round((targetEpochMs - serverEpochMs) / 1000)` 后保存 offsetSeconds。前端必须按选定时区处理用户的日期时间输入，不能将其无条件按浏览器当前时区解释；夏令时导致不存在或有歧义的当地时间需要明确提示或让用户选择偏移。

### 天气设置

`temperatureUnit` 为 celsius 或 fahrenheit。前端调用天气接口时显式传入当前设备的单位和解析后的地点、时区。

## GET /api/timezones

返回 `{ timeZones: string[] }`，包含 UTC 和运行时支持的 IANA 时区。供手动设置和世界时钟选择器使用。

## GET /api/time?browserTimeZone=Asia%2FShanghai

读取当前设备的时钟设置，返回：

```json
{
  "serverEpochMs": 1793782800000,
  "serverTime": "2026-11-04T09:00:00.000Z",
  "displayEpochMs": 1793782800000,
  "timeZone": "Asia/Shanghai",
  "timeZoneSource": "browser",
  "mode": "automatic",
  "offsetSeconds": 0
}
```

这是时钟时间基准接口，不发起外部位置查询。若时区模式为 location，只有已保存手动地点的时区可直接使用；自动位置需要下面的 resolve 接口。

时间来源：手动时区优先；location 模式优先已解析地点时区；其次浏览器时区、地点时区、UTC。`timeZoneSource` 为 manual / location / browser / utc-fallback。

前端使用基准时间与 `performance.now()` 增量推进时钟，定期或页面恢复可见时校准即可，不能每秒请求后端。世界时钟对同一个时间基准使用不同 IANA 时区格式化。

## GET /api/location/search?q=上海

城市搜索，关键词 2–100 字符，最多返回 8 项：

```json
{
  "locations": [{ "id": "1796236", "name": "上海", "latitude": 31.23, "longitude": 121.47, "timeZone": "Asia/Shanghai", "country": "中国", "region": "上海" }],
  "provider": "Open-Meteo / GeoNames",
  "cache": { "hit": false, "stale": false }
}
```

用户必须从匹配城市中选择，不能把未解析的名称当作有效坐标。城市文本按纯文本渲染。缓存一小时。

## POST /api/environment/resolve

请求体最多 4 KB，所有字段可省略：

```json
{
  "browserTimeZone": "Asia/Shanghai",
  "coordinates": { "latitude": 31.23, "longitude": 121.47 }
}
```

返回 `{ location, clock, warnings }`。clock 与 `/api/time` 的结构一致；location 可能为 null，或包含 name、latitude、longitude、timeZone、source、approximate。

- source：manual / browser / ip / network-ip。
- 浏览器坐标的时区使用本次 browserTimeZone；缺失时使用 UTC 并通过 timeZoneSource 标注，不声称坐标已确定时区。手动城市及 IP 服务可返回地点时区。
- warnings 是 `{ code, message }[]`。没有授权的 browser 模式返回 LOCATION_REQUIRED；IP 失败返回 LOCATION_UNAVAILABLE。地点失败时仍返回可用的时钟，不编造城市或天气。
- 本接口不访问天气服务，也不保存自动检测的坐标。IP 结果缓存一小时。
- 浏览器时区通过 `Intl.DateTimeFormat().resolvedOptions().timeZone` 获得；精确坐标须用户授权且处于安全上下文。当前局域网 HTTP 不满足常规浏览器定位要求时，提供 IP 近似位置和手动城市。

## GET /api/weather

必填 `latitude`、`longitude`；可选 `timeZone`（默认 UTC）、`temperatureUnit`（默认 celsius）。所有查询参数严格校验，拒绝重复字段和任意 URL。

示例：`/api/weather?latitude=31.23&longitude=121.47&timeZone=Asia%2FShanghai&temperatureUnit=celsius`

```json
{
  "provider": "Open-Meteo",
  "attributionUrl": "https://open-meteo.com/",
  "latitude": 31.23,
  "longitude": 121.47,
  "timeZone": "Asia/Shanghai",
  "temperatureUnit": "celsius",
  "current": {
    "observedAt": "2026-11-04T09:00:00.000Z",
    "temperature": 20,
    "apparentTemperature": 19,
    "humidity": 55,
    "weatherCode": 2,
    "condition": "多云",
    "isDay": true,
    "windSpeedKmh": 10
  },
  "daily": { "maxTemperature": 23, "minTemperature": 15 },
  "fetchedAt": "2026-11-04T09:00:00.000Z",
  "cache": { "hit": false, "stale": false }
}
```

天气坐标四舍五入到小数点后两位后提交上游，缓存十分钟；请求失败时最多回退到一小时内的旧值，并明确 `cache.stale: true`。完全不可用返回 503，界面显示“暂不可用”，不保留示例中的 22° 晴天冒充实况。

天气 observedAt 与 fetchedAt 均为真实时间，不随手动时钟偏移而变化。显示 Open-Meteo 来源链接与实际更新时间。浏览器收到温度等数据后使用文本节点显示。

## 数据源与部署边界

- 天气：[Open-Meteo 官方接口文档](https://open-meteo.com/en/docs)。城市搜索：[Geocoding API](https://open-meteo.com/en/docs/geocoding-api)。IP：[ipapi.co API](https://ipapi.co/api/)。浏览器定位：[MDN Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)。
- 外部服务需要这台 Mac 能连接上述 HTTPS 域名；免费服务的额度、网络可达性与定位精度不由本项目保证，失败须走上述显式降级。
- 此版本供受信任局域网个人测试，现有导航及共享组件数据不按账号鉴权。设备 Cookie 隔离不等于账号权限系统。公开部署前必须另行设计认证、TLS 与可信代理配置。
