# 小组件、设备设置、时钟与天气接口

状态：后端已实现。前端由 Antigravity 根据根目录 `TASK.md` 接入。现有 `/api/state` 的 `{ sites, prefs, note }` 和版本号保持兼容；不要将本文新字段提交到旧接口。

## 通用约定

- 同源 `/api`，JSON 请求与响应。普通 fetch 默认携带同源 Cookie，也可显式设置 `credentials: 'same-origin'`。
- 新的两个持久化文档统一返回 `{ revision, state, updatedAt }` 和 `ETag: "版本号"`；PATCH 请求必须带对应文档的 `If-Match`。版本号属于各自的接口，不互相通用。
- PATCH 按顶层字段替换：提供的对象或数组需完整提交，未提供的顶层字段保留。默认文档版本为 0，首次成功保存变为 1。
- 错误为 `{ error: string }`。400 数据不合法；403 来源不允许；405 方法不允许；409 版本冲突；413 请求过大；415 需要 JSON；428 缺少版本；429 限流（接口限流带 `Retry-After`）；503 外部服务或存储暂时不可用。
- 新接口按 socket 来源 IP 限制每分钟 120 次，其中环境、城市搜索和天气接口合计每分钟 30 次。忽略客户端传入的代理 IP 头。实际外部请求最多并发 4 个、每分钟 60 个，缓存命中不占外部请求额度。
- 外部请求仅允许固定 HTTPS 数据源，拒绝重定向，5 秒超时，响应最多 256 KB。不得传入任意 URL。

## 网站方块尺寸

`/api/state` 的 `sites` 每项可带 `size`。支持 `single`（1×1）和 `square`（2×2），缺省按 1×1 显示。页面编辑模式修改此字段。Dock 和文件夹内沿用紧凑图标。网站尺寸随完整备份和导航备份一并保存。

## GET /api/widgets

返回 `{ schemaVersion: 1, widgets: WidgetDefinition[] }`。每项包含：

```json
{
  "type": "todo",
  "title": "待办清单",
  "version": 1,
  "sizes": ["compact", "square", "tall"],
  "legacySizes": { "wide": "tall" },
  "defaultConfig": { "hideCompleted": false },
  "capabilities": ["shared-todos"]
}
```

默认桌面启用六种类型：`clock-weather`、`focus-timer`、`quick-note`、`todo`、`calendar`、`world-clock`。`capabilities` 描述本地组件的数据需求。

定义可提供 `defaultSize`。时钟与天气和月历均默认 `square`，分别可选 `landscape` 和 `full`。待办和世界时钟支持 `tall`。以下类型的 `defaultEnabled` 为 `false`，从编辑模式按需添加。

| 类型 | 默认尺寸 | 其他可选尺寸 |
| --- | --- | --- |
| `weather-badge` | `single` | `compact`、`square` |
| `date-tile` | `single` | `square` |
| `focus-launcher` | `single` | `compact` |
| `countdown` | `single` | `compact`、`square` |
| `habits` | `tall` | `square` |
| `today-dashboard` | `large` | `square` |
| `weather-strip` | `strip` | `compact` |
| `currency-converter` | `square` | — |

## GET /api/widgets/state / PATCH /api/widgets/state

这是所有设备共享的小组件布局与待办数据，独立于 `/api/state`。

```json
{
  "revision": 0,
  "state": {
    "layout": [
      { "id": "todo", "type": "todo", "enabled": true, "order": 3, "size": "tall", "config": { "hideCompleted": false } }
    ],
    "todos": [
      { "id": "todo_1", "text": "编写一个自己的组件", "completed": false, "dueDate": "2026-11-04" }
    ]
  },
  "updatedAt": null
}
```

上例仅演示字段。默认布局包含六种预置组件，顺序为 0–5。新建文档携带时钟天气和月历的默认 `size`，待办默认为空。

PATCH 示例：`{ "todos": [] }`。支持字段 `layout`、`todos`、`desktop`，至少一项。允许空布局与空待办。

- `layout` 最多 24 项；`id` 必须唯一，1–80 位字母、数字、下划线或连字符；`order` 为 0–23 的唯一整数，前端按 order 排序。
- `sizes` 列出当前可选尺寸，按列 × 行计，`single` 为 1×1、`compact` 为 2×1、`square` 为 2×2、`tall` 为 2×3、`landscape` 为 3×2、`large` 为 3×3、`full` 为 4×4、`strip` 为 4×1。
- `legacySizes` 给出各类型的旧尺寸转换。时钟与天气的 2×1、2×3 和 4×2 转为 2×2。月历的 3×3 转为 4×4，2×1 和 4×2 转为 2×2。待办和世界时钟的 4×2 转为 2×3，速记和导入组件的 4×2 转为 2×2，逐小时天气的 4×2 转为 4×1，汇率卡的 1×1 和 2×1 转为 2×2。读取时返回转换后的尺寸，保持当前修订号，下一次正常写入时保存。
- 容量不足时，3×2 时钟与天气和 4×4 月历临时显示为 2×2，恢复空间后按保存的尺寸显示。2×2 放不下时，可从「查看全部」进入详情。
- 类型必须注册；`enabled` 为布尔值。`config` 严格白名单如下：

| 类型 | 完整 config | 限制 |
| --- | --- | --- |
| `clock-weather` | `{ showSeconds: true }` | 布尔值；地点与时区使用设备设置 |
| `focus-timer` | `{ workMinutes: 25, breakMinutes: 5 }` | 整数，分别 1–180 / 1–60 分钟 |
| `quick-note` | `{}` | 内容继续存旧 `/api/state.note` |
| `todo` | `{ hideCompleted: false }` | 布尔值；内容存本接口 todos |
| `calendar` | `{ weekStartsOn: 1, marks: [] }` | 0 表示周日、1 表示周一。可选 `marks` 保存最多 128 条 `{ date, title, color }`。日期为真实的 `YYYY-MM-DD`，同一日期唯一，标题为去除首尾空白后 1–60 字符的纯文本，颜色为 `red`、`amber`、`green`、`blue` 或 `violet` |
| `world-clock` | `{ zones: [{ label: "上海", timeZone: "Asia/Shanghai" }] }` | 1–8 个地点，名称最多 60 字符，合法 IANA 时区 |
| `weather-badge`、`date-tile`、`focus-launcher`、`today-dashboard`、`weather-strip` | `{}` | 读取现有环境、时钟、专注或待办数据 |
| `countdown` | `{ title: "倒计时", targetDate: null }` | 标题 1–60 字符，日期为 `null` 或真实 `YYYY-MM-DD` |
| `habits` | `{ habits: [] }` | 最多 8 项 `{ id, title, checkedDates }`。ID 唯一，标题 1–60 字符，每项保存最多 90 个互不重复的真实 `YYYY-MM-DD` |
| `currency-converter` | `{ base: "CNY", quote: "USD" }` | 支持的币种代码；金额保留在当前页面 |
| `imported-card` | 组件包的 `card` 对象 | 按下方的模板字段校验；添加时生成独立组件 ID |

- `todos` 最多 200 条；`id` 规则同上且不能重复；`text` 为 1–500 字符纯文本；`completed` 为布尔值；可选 `dueDate` 为 null 或真实存在的 `YYYY-MM-DD` 日期。
- 请求体最多 512 KB。未知字段（如 script、HTML、模块 URL）拒绝保存。

月历按日期显示此文档中的到期待办和个人标记。完整数据备份包含标记，导航备份仅包含卡片排列。中国大陆放假及调休数据在网页及扩展内置，覆盖 2025–2027 年。直接使用 `/platform/features/china-holidays.js` 的 `getChinaHoliday(date)` 查询，结果为 `{ kind, name }` 或 `null`。`kind` 为 `holiday` 或 `workday`。`hasChinaHolidaySchedule(year)` 判断年份是否有节假日安排。

来源 [2025 年国务院公报](https://www.gov.cn/gongbao/2024/issue_11726/material/gwygb202433.pdf) · [2026 年国务院办公厅通知](https://zwfw.gansu.gov.cn/huixian/zczx/tzgg/art/2025/art_715c16a75e4d4c289c295e77772c7274.html) · [2027 年国务院办公厅通知](https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml)

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
- 网站和小组件可保存 `cell: { row, column }`。行号为 0–49、列号为 0–47，同一页面的固定起点唯一。缺省按原顺序自动摆放。保存页面与格子走同一次桌面 PATCH。前端按当前网格和卡片尺寸计算占位与临时回退。固定格子随导航及完整备份保存。
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

城市搜索，关键词 2–100 字符。普通搜索最多返回 8 项，搜索大陆省名时最多返回 40 个下辖城市：

```json
{
  "locations": [{ "id": "310000", "name": "上海市", "latitude": 31.23, "longitude": 121.47, "timeZone": "Asia/Shanghai", "country": "中国", "region": "上海市" }],
  "provider": "UAPI",
  "cache": { "hit": false, "stale": false }
}
```

大陆查询以六位行政区划代码校验省份和去重，支持「揭阳」「成都市」等写法。输入「广东」会列出下辖城市，可直接选择。国际城市继续使用 Open-Meteo / GeoNames。城市结果按纯文本渲染，缓存一小时。

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
  "hourly": [
    {
      "forecastAt": "2026-11-04T10:00:00.000Z",
      "temperature": 19,
      "weatherCode": 61,
      "condition": "小雨",
      "isDay": false,
      "precipitationProbability": 70
    }
  ],
  "fetchedAt": "2026-11-04T09:00:00.000Z",
  "cache": { "hit": false, "stale": false }
}
```

天气坐标四舍五入到小数点后两位后提交上游，缓存十分钟；请求失败时最多回退到一小时内的旧值，并明确 `cache.stale: true`。完全不可用返回 503，界面显示“暂不可用”，不保留示例中的 22° 晴天冒充实况。

天气的 `observedAt`、`fetchedAt` 和 `forecastAt` 都是 UTC 时间，不随手动时钟偏移而变化。逐小时数据来自同一次天气请求，包含接下来 16 小时内最多 16 条有效预报，支持跨午夜并按时间升序排列。温度使用 `temperatureUnit`。无可用预报时 `hourly` 为空数组，实况仍保留。浏览器按地点 `timeZone` 显示时间，隐藏已经过期的预报。

## 数据源与部署边界

- 天气与国际城市：[Open-Meteo 天气](https://open-meteo.com/en/docs)、[Geocoding API](https://open-meteo.com/en/docs/geocoding-api)。大陆城市与 IP 定位：[UAPI 行政区划](https://uapis.cn/docs/api-reference/get-misc-district)、[UAPI IP 定位](https://uapis.cn/docs/api-reference/get-network-myip)。浏览器定位：[MDN Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)。
- IP 接口估算请求出口的位置。请求经代理转发时，定位结果对应代理出口。若 IP 服务未提供时区，中国大陆使用 Asia/Shanghai，其他出口使用浏览器时区或 UTC。
- 外部服务需要这台 Mac 能连接上述 HTTPS 域名；免费服务的额度、网络可达性与定位精度不由本项目保证，失败须走上述显式降级。
- 此版本供受信任局域网个人测试，现有导航及共享组件数据不按账号鉴权。设备 Cookie 隔离不等于账号权限系统。公开部署前必须另行设计认证、TLS 与可信代理配置。


## 组件包与本地扩展更新（0.9.7）

在「设置 → 更新与组件」选择组件 JSON，确认预览后加入当前导航页。每个文件包含一张卡，最大 16 KiB。下面是一份完整的模板：

```json
{
  "format": "launchdeck-widget",
  "version": 1,
  "size": "square",
  "card": {
    "type": "text",
    "title": "今日提醒",
    "text": "记得休息",
    "icon": "note",
    "palette": "teal",
    "layout": "stacked"
  }
}
```

支持 `single`、`compact`、`square` 三档尺寸。旧包中的 `wide` 导入为 `square`。模板 `text` 接受最多 240 字符的 `text`，`clock` 与 `weather` 使用当前设备的时间或天气，`currency` 需要 `base` 与 `quote`。所有模板均填写标题（最多 60 字符）、内置图标（`note`、`clock`、`cloud`、`currency`、`sparkles`）、配色（`indigo`、`teal`、`amber`、`slate`、`rose`）和布局（`stacked` 或 `split`）。未知字段拒绝导入。文字按纯文本渲染。

组件包通过浏览器本机解析。确认后仅按现有布局接口保存校验后的组件配置与位置。完整备份包含导入配置，导航专用备份只保留位置和尺寸，另一设备恢复时可重新导入原组件包。

升级入口接受 LaunchDeck 构建器生成的 ZIP（最多 32 MiB），读取构建标记和清单并比较版本。可粘贴从发布方取得的 SHA-256 检查整个文件。验证后将可信 ZIP 解压覆盖原扩展目录，再通过浏览器扩展管理页重新加载。`GET /api/update/version` 返回网页版配套扩展版本。

## GET /api/exchange-rate

查询参数 `base` 和 `quote` 接受项目核对的 Frankfurter v2 清单中的全部 158 种国家和地区货币代码，涵盖现行法定货币及清单保留的 `ANG` 等旧代码。接口拒绝加密货币、贵金属及 `XDR`、`CMD`、`CNH`。返回 `{base, quote, rate, date, fetchedAt, cache: {hit, stale}}`，其中 `date` 是参考汇率日期，`fetchedAt` 是取得汇率的 UTC ISO 时间。相同币种即时返回汇率 1 和空日期。服务最多缓存 128 对汇率，缓存一小时内有效，短暂故障时最多回退七天内的缓存。扩展授权范围为 `https://api.frankfurter.dev/*`。换算金额在浏览器内计算。 [Frankfurter 数据说明](https://frankfurter.dev/)

Web 与扩展可共同导入 `backend/features/currencies.js` 中的冻结数据，在离线状态下按国家、地区、币种名称或别名选币。

- `CURRENCY_CATALOG` 提供每个币种的 `{ code, name, symbol, country, countries, aliases, region, popular }`。目录先列 18 个热门币种，其余按代码升序排列。`country` 是主展示名称，`countries` 包含关联国家或地区，例如法国和德国均对应 `EUR`。
- `POPULAR_CURRENCIES` 提供热门币种代码及其显示顺序。
- `CURRENCY_REGIONS` 提供亚洲、欧洲、美洲、大洋洲、中东和非洲的 `{ id, label }`。
- `getCurrencyMeta(code)` 按精确的大写代码返回冻结目录项，未知代码或非字符串参数返回 `null`。
- `CURRENCIES` 继续提供代码到简体中文货币名的映射，原有前 12 项的顺序和名称保持兼容。

## HTTPS JSON 通知订阅（0.9.3）

在「设置 → API 接入」填写名称和 API 地址。来源返回 HTTP 2xx 和 JSON，内容不超过 128 KiB，`messages` 数组最多 100 项，例如：

```json
{
  "messages": [
    {
      "id": "build-42",
      "title": "构建完成",
      "body": "版本 0.9.3 已通过检查",
      "url": "https://example.com/builds/42",
      "publishedAt": "2026-11-22T12:00:00Z"
    }
  ]
}
```

`id`、`title`、`publishedAt` 必填。每个来源的 ID 应长期保持稳定，时间使用带时区的 ISO 8601。正文和 HTTPS 链接可省略。每个浏览器最多订阅 8 个来源，每个来源保留最新 40 条，并记录已读状态。

打开或返回新标签页时尝试刷新，页面可见期间按一分钟更新。来源失败会保留上一次成功取得的消息。网页直接发起跨域请求，来源须通过 CORS 允许 LaunchDeck 的页面来源读取。扩展在添加时申请该来源域名的权限，在本地服务工作线程拉取。请求使用 HTTPS GET，省略 Cookie 和 Referrer，拒绝重定向。订阅和已读记录只在当前浏览器存储。

## 导航专用备份（0.8.0）

HTTP与扩展消息桥提供相同接口，不需要额外备份服务：

- `GET /api/navigation/browser-data` → `{restoreId:null|string,data:null|{pages,customSites,siteOrder}}`。仅在恢复标识变化时更新本机缓存，普通刷新不能重复覆盖后续本机编辑。
- `POST /api/navigation/import`，JSON `{backup,portalRevision,widgetRevision}`，最大2MiB。成功返回 `{success:true,restoreId,browserData:{pages,customSites,siteOrder},revisions:{portal,widgets}}`。每次成功恢复生成新restoreId，即使同一备份重复恢复。

导航格式为 `launchdeck-navigation/version=1`，含 `backupId`（32小写hex）、`exportedAt`（规范ISO）、`sites`、`pages`、`desktop`（v2）及 `widgetSlots:[{id,type,size?}]`。`size` 省略时按 `compact` 恢复。严格字段白名单，不含正文、配置或设备信息。只接受已注册组件及HTTP/HTTPS无凭据网址，拒绝缺失网站引用、嵌套文件夹、重复位置、未知字段、超过1MiB解压内容。共享纯模块在 `backend/navigation/`，HTTP只允许静态访问指定校验文件，不暴露数据库或服务代码。

恢复前应排空本窗口两类保存队列，并阻止本窗口继续编辑。必须提交两份当前版本：409任一版本冲突、428网站文档尚未初始化、400数据错误、413请求超限、503存储失败；任何一项失败都不写入部分数据。HTTP采用同一SQLite事务，扩展采用队列内单次storage.set。只替换网站和桌面位置，保留当前prefs/note/todos/组件config/device；缺少的本机组件保留配置并隐藏。自定义页面及其网站在browserData中返回并持久化为恢复快照。

独立恢复页与首页使用同源窗口消息，不接受其他来源窗口、过期/重放令牌；恢复页不加载主应用或自动写入数据。扩展内只支持手动粘贴/文件，网页版支持Bitwarden自定义字段填充。完整JSON备份API保留。

`siteOrder`保存完整网站ID顺序，用于恢复预设/自定义分类混合的Dock排列；旧完整备份可省略。客户端合并时以自定义站点的下一已知系统站点为锚点，保留后端系统站点后续重排，也保留本机自定义站点的位置。
