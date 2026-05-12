# AI请求智能分析助手 — 脚本参考文档

> 本文档供AI助手阅读，用于理解脚本架构、数据流和修改指南。

姊妹篇（**仅浏览器扩展 Manifest V3** 实现细则、协议与排错）：[AI-REQUEST-ANALYZER-FOR-AI.md](AI-REQUEST-ANALYZER-FOR-AI.md)。

## 概述

本产品以 **`extension/` Manifest V3 扩展**为实现与维护主线：在 `document_start` 拦截 XHR/Fetch，调用 Kimi K2.6 API（OpenAI 兼容 `/chat/completions`）分析请求与响应语义，并支持 Mock / 高级改写调试规则。

仓库中的油猴脚本 `ai-request-analyzer.user.js` 若仍存在，可作历史对照或可选代码生成输入；**与行为相关的权威实现以扩展为准**。

## 核心架构（扩展：`extension/content/` 多模块）

Content Script 按 manifest.json `content_scripts.js` 数组顺序加载，共享同一执行上下文，`var`/`function` 声明跨文件全局可见。

**模块加载顺序与职责**：

| 序号 | 文件 | 职责 |
|------|------|------|
| ① | `state.js` | 全局状态 `state`、`STORAGE_CACHE`、常量、`storageGet/Set/HydrateThen`、`loadConfig`/`saveConfig`/`loadMockRules`/`saveMockRules` |
| ② | `mock-rules.js` | Mock 规则工具：`getMockKey`、`normalizeRule/AllRules`、`findDebugRule`、`applyHeaderRewrite`、`buildResponseHeaders`、`consumeOnceRuleByKey` 等 |
| ③ | `core.js` | 请求拦截核心：`generateId`、`formatJson`、`tryParseJson`、`addRequestRecord`、`interceptXHR/Fetch`、`syncMockRulesToPage`、`setupMenuCommands`、`setupRequestInterception` |
| ④ | `ai-analysis.js` | AI 分析：`callAI`、`analyzeRequest`、`analyzeAllRequests`、`chatModify` |
| ⑤ | `mcp-engine.js` | MCP 引擎：Schema 推断（`inferJsonType` 等）、`generateMcpToolsFromRecords`、`save/load/deleteMcpTool`、`handleMcpProxyRequest`、`stripSensitiveHeaders`、`escapeHtml` |
| ⑥ | `ui-core.js` | 主 UI：悬浮球、面板、配置、JSON 编辑器、改写编辑器、请求列表/详情、Mock 操作（33 个函数） |
| ⑦ | `mcp-ui.js` | MCP UI：`refreshMainPanelContent`、工具列表/日志、编辑器/测试器（8 个函数） |
| ⑧ | `isolated.js` | 入口引导（~50行）：IIFE → `init()` → `storageHydrateThen` → 加载配置 → DOMReady 创建 UI → `startDomGuard` |

```
document-start 阶段 (isolated.js IIFE):
  init() → storage 水合 → loadConfig() → loadMockRules() → loadMcpTools() → setupRequestInterception()
                                                    ├── setupPageContextInterception()      [core.js]
                                                    │   ├── INJECT_PAGE_HOOK → SW 注入 MAIN：page-hook.js
                                                    │   └── window.postMessage 回传 PAGE_RECORD_* / MOCK_RULES
                                                    ├── interceptXHR()     → 隔离世界兜底 XMLHttpRequest.prototype  [core.js]
                                                    └── interceptFetch()   → 隔离世界兜底 window.fetch              [core.js]

DOMContentLoaded 阶段 (isolated.js onDOMContentLoaded):
  onDOMContentLoaded() → （样式见 content.css）→ createFloatingBall()   [ui-core.js]
                        → createMainPanel()       [ui-core.js]
                        → createConfigPanel()      [ui-core.js]
                        → createJsonEditor()       [ui-core.js]
                        → createRewriteEditor()    [ui-core.js]
                        → startDomGuard()

扩展菜单（右键页面）→ background tabs.sendMessage → setupMenuCommands 监听  [core.js]

MCP 链路:
  isolated.js → MCP_START_HELPER → background.js → connectNative('com.aireq.mcp_helper') → MCP Helper
  MCP Helper → WebSocket /mcp → MCP 客户端（AI IDE）
  MCP 客户端 → tools/call → MCP Helper → CALL_REQUEST → background.js → MCP_PROXY_REQUEST → mcp-engine.js handleMcpProxyRequest → fetch
```

## 常量

**扩展**：以下键写入 `chrome.storage.local`；键名字符串沿用下表约定。

| 常量 | 值 | 用途 |
|------|----|------|
| `DEFAULT_CONFIG` | `{apiKey:'', baseURL:'https://api.moonshot.cn/v1', model:'kimi-k2.6', temperature:1}` | AI 配置默认值 |
| `CONFIG_KEY` | `'ai_req_analyzer_config'` | 持久化配置的键名（扩展：`chrome.storage.local`） |
| `MOCK_RULES_KEY_PREFIX` | `'ai_req_mock_rules_'` | Mock 规则存储键前缀（拼接 hostname 做域名隔离） |
| `PAGE_RECORD_MSG` | `'AI_REQ_ANALYZER_PAGE_RECORD'` | 页面 **MAIN world** Hook 向**隔离脚本**回传请求的 `postMessage` 类型 |
| `PAGE_MOCK_RULES_MSG` | `'AI_REQ_ANALYZER_MOCK_RULES'` | 隔离脚本向页面 MAIN Hook 下发 / 刷新 Mock 规则 |
| `MAX_RECORDS` | `100` | 内存中最大请求记录条数 |
| `MAX_AI_BODY_LENGTH` | `2000` | 发送给 AI 的请求/响应体截断长度 |
| `MCP_TOOLS_KEY_PREFIX` | `'ai_req_mcp_tools_'` | MCP 工具定义存储键前缀（拼接 hostname 做域名隔离） |
| `MCP_PROXY_REQUEST` | `'MCP_PROXY_REQUEST'` | background 向 isolated 发起的代理执行请求消息类型 |

## State 对象

```javascript
state = {
  config: { apiKey, baseURL, model, temperature },  // AI 配置
  requestRecords: [],       // 请求记录数组，最多100条
  mockRules: {},            // { pathname: debugRule } 按域名隔离，兼容旧 mockDataObject
  mcpTools: {},             // { toolName: MCPToolDefinition } 按域名隔离
  mcpPanelTab: 'requests',  // 当前 MCP 面板子标签：'requests' | 'list' | 'logs'
  floatingBall: HTMLElement,
  mainPanel: HTMLElement,
  configPanel: HTMLElement,
  jsonEditor: HTMLElement,
  isPanelOpen: false,
  expandedReqId: null,      // 当前展开详情的请求ID
  isAnalyzing: false,       // 批量分析进行中
  analyzeProgress: { total: 0, done: 0 },
  selectedReqId: null,      // 当前选中用于 Mock 编辑的请求ID
  uiReady: false,           // UI 是否已初始化，防止重复创建
  menuReady: false          // runtime.onMessage（扩展菜单）是否已注册，防止重复注册
}
```

### 请求记录数据结构

```javascript
{
  id: string,               // 唯一标识 (Date.now().toString(36) + random)
  timestamp: number,        // 请求发起时间
  method: string,           // HTTP 方法
  url: string,              // 完整 URL
  requestHeaders: object,   // 请求头键值对
  requestBody: any,         // 请求体（已 tryParseJson）
  responseStatus: number,   // HTTP 状态码
  responseHeaders: object,  // 响应头键值对
  responseBody: any,        // 响应体（已 tryParseJson）
  duration: number,         // 请求耗时(ms)
  aiAnalysis: string|null,  // AI 分析结果文本
  isMocked: boolean,        // 是否已被 Mock
  mockData: any|null,       // Mock 数据
  originalUrl: string,      // 请求地址被改写时保留原始 URL
  debugRule: object|null    // 命中的高级调试规则
}
```

### 调试规则数据结构

### MCP 工具定义数据结构（`MCPToolDefinition`）

MCP 工具定义遵循 [MCP 规范](https://modelcontextprotocol.io/) 工具格式，扩展了 `_meta` 内部元数据（不暴露给 MCP 客户端）：

```javascript
{
  name: 'get_api_users_list',         // 工具名：method + pathname snake_case
  description: '获取用户列表',           // 工具描述：取 AI 分析首行或 method + pathname
  inputSchema: {
    type: 'object',
    properties: {
      page: { type: 'number', description: '页码' },
      status: { type: 'string', enum: ['active', 'inactive'] }
    },
    required: ['page']
  },
  _meta: {
    origin: 'https://api.example.com',     // 请求源（含协议+域名+端口）
    pathname: '/api/users/list',            // URL 路径
    method: 'GET',                          // HTTP 方法
    sampleRequestHeaders: {},               // 已过滤敏感头的请求头样本
    sampleResponseBody: null,               // 响应体样本（仅供参考）
    detectedAuthType: 'cookie',             // 认证类型：cookie | bearer | custom | none
    contentType: 'application/json',        // Content-Type
    observedCount: 3,                       // 观察到该接口的请求次数
    lastObserved: 1715500000000,            // 最后观察时间戳
    isReadOnly: true,                       // 是否只读请求（GET/HEAD）
    riskLevel: 'low',                       // 风险等级：low | medium | high
    queryParams: ['page']                   // 查询参数名列表
  },
  enabled: true                             // 工具是否启用
}
```

**`_meta` 字段说明**：

| 字段 | 说明 |
|------|------|
| `origin` | 请求完整源（协议+域名+端口），用于寻找目标标签页 |
| `pathname` | URL 路径部分，用于拼接请求 URL |
| `method` | HTTP 方法 |
| `sampleRequestHeaders` | 请求头样本，**已通过 `stripSensitiveHeaders` 过滤 Cookie/Authorization 等敏感头** |
| `sampleResponseBody` | 响应体样本，仅供用户参考 |
| `detectedAuthType` | 检测到的认证方式 |
| `queryParams` | 查询参数名列表，用于区分查询参数与请求体参数 |
| `isReadOnly` | 只读标记（GET/HEAD 为 true），供 MCP 客户端参考 |
| `riskLevel` | 风险等级：GET/HEAD 为 low，DELETE 为 high，POST/PUT/PATCH 含高危关键词为 high，其余为 medium |

### MCP 代理请求数据结构（`MCP_PROXY_REQUEST`）

background.js 通过 `chrome.tabs.sendMessage` 发送给 content script（`mcp-engine.js`: `handleMcpProxyRequest`）的代理执行请求：

```javascript
{
  type: 'MCP_PROXY_REQUEST',
  payload: {
    callId: 'uuid-string',           // 调用唯一标识
    toolName: 'get_api_users_list',  // 工具名
    url: 'https://api.example.com/api/users/list?page=1',
    method: 'GET',
    headers: {},                      // 请求头（已过滤敏感信息）
    body: {},                         // 请求体
    timeout: 30000                    // 超时毫秒数
  }
}
```

### MCP 调用日志数据结构

```javascript
{
  timestamp: 1715500000000,
  toolName: 'get_api_users_list',
  argsSummary: '{"page":1}',          // 参数摘要（截断至200字符）
  status: 200,                        // HTTP 状态码
  duration: 156,                      // 耗时毫秒
  proxyMode: 'tab',                   // 代理模式：tab | fallback | none
  error: null                         // 错误信息
}
```

当前 Mock 规则已升级为完整接口调试规则，旧数据仍兼容：如果 `state.mockRules[pathname]` 不是规则对象，会被 `normalizeRule()` 自动视为 `response.body`。

```javascript
{
  __aiReqRule: true,
  enabled: true,
  once: false,
  match: {
    pathname: '/api/xxx',
    method: 'GET'
  },
  request: {
    url: '',
    headersSet: {},
    headersRemove: []
  },
  response: {
    status: 200,
    statusText: 'OK',
    headersSet: { 'Content-Type': 'application/json' },
    headersRemove: [],
    bodyEnabled: true,
    body: {}
  }
}
```

- `enabled`：规则是否启用。
- `once`：是否仅下一次请求生效，命中后删除并同步页面 Hook。
- `request.url`：请求地址改写，空字符串表示不改写。
- `request.headersSet`：新增或覆盖请求头。
- `request.headersRemove`：请求头删除列表。
- `response.status` / `response.statusText`：Mock 响应状态。
- `response.headersSet` / `response.headersRemove`：响应头改写。
- `response.bodyEnabled`：是否 Mock 响应体。为 `false` 时可以只改请求地址/请求头/响应头。
- `response.body`：Mock 响应体。

## 请求拦截机制

### 页面主上下文桥接（扩展：`setupPageContextInterception` + `page-hook.js`）

拦截须发生在 **页面 MAIN world**（与 Vue/React 等共用同一 `window.fetch` / `XMLHttpRequest`）。扩展在隔离脚本中注册 `postMessage` 监听器，再通过 Service Worker 对该标签页 **`executeScript`** 注入 [`extension/content/page-hook.js`](extension/content/page-hook.js)。

1. MAIN world Hook 拦截页面业务代码发起的 XHR/Fetch。
2. 非 Mock 请求完成后通过 `window.postMessage({ type: PAGE_RECORD_MSG, record })` 回传**隔离脚本**。
3. 隔离脚本监听 `PAGE_RECORD_MSG`，调用 `addRequestRecord(record)` 写入面板。
4. Mock 规则变更后，`saveMockRules()` 调用 `syncMockRulesToPage()`，经 `PAGE_MOCK_RULES_MSG` 同步 MAIN Hook 内存规则。
5. 一次性规则命中后，MAIN 侧 `PAGE_RULE_CONSUMED_MSG` 通知隔离脚本 `consumeOnceRuleByKey`。
6. `interceptXHR()` / `interceptFetch()` 在**隔离世界**保留为兜底（无法替代 MAIN 对真实页面请求的覆盖）。

### 请求与响应改写

高级调试规则支持四类改写：

| 类型 | Fetch | XHR | 说明 |
|------|-------|-----|------|
| 请求 URL | 支持 | 支持 | 在真实请求发出前改写。跨域 URL 仍受浏览器 CORS 限制 |
| 请求头新增/覆盖 | 支持 | 支持 | XHR 在 `send()` 前调用原始 `setRequestHeader` 补充 |
| 请求头删除 | 支持较好 | 有限制 | XHR 中页面已设置过的 header 无法保证完全删除，只能在脚本可控阶段跳过或覆盖 |
| 响应头改写 | 支持 | 仅 Mock 响应完整支持 | Fetch 可包装 `Response`；真实 XHR 响应头无法可靠改写 |
| 响应体 Mock | 支持 | 支持 | `response.bodyEnabled === true` 时直接返回 Mock 响应体 |

请求记录会在 URL 被改写时保留：

- `originalUrl`：页面原始发起的 URL。
- `url`：实际发出的 URL。
- `debugRule`：本次命中的调试规则快照。

### XHR Mock 完成事件

XHR Mock 命中后不再只设置 `responseText` / `response` / `status` / `readyState`，还会补齐：

- `statusText = 'OK'`
- `responseURL`
- `getAllResponseHeaders()`
- `getResponseHeader('content-type')`
- `responseType === 'json'` 时 `response` 返回对象，否则返回 JSON 字符串

事件触发顺序模拟真实 XHR 完成流程：

```
readystatechange → load → loadend
```

这对 axios 兼容很重要。axios 1.x 的 XHR adapter 通常依赖 `loadend` 收尾；如果 Mock 只触发 `load` 或 `readystatechange`，可能被业务代码识别为 `ERR_NETWORK`。

### XHR 拦截 (`interceptXHR`)

重写 `XMLHttpRequest.prototype` 的三个方法：

1. **`open(method, url)`**：在 XHR 实例上创建 `_aiReqInfo` 对象
2. **`setRequestHeader(name, value)`**：将请求头存入 `_aiReqInfo.requestHeaders`
3. **`send(body)`**：
   - **Mock 命中**：用 `defineMockXhrResponse()` 覆盖响应字段和响应头读取方法，`dispatchMockXhrSuccess()` 触发 `readystatechange/load/loadend`，**不调用原始 send**（请求被拦截）
   - **Mock 未命中**：通过 `addEventListener('readystatechange', ...)` 监听 `readyState === 4`，用 `_aiRecorded` 标记防重复记录，**排除 `api.moonshot.cn` 域名**

### Fetch 拦截 (`interceptFetch`)

重写 `window.fetch(input, init)`：

1. **URL 解析**：支持 `string`、`Request` 对象、`init` 参数，用 `try-catch` 保护
2. **Mock 命中**：创建 `new Response(JSON.stringify(mockMatch), {status:200, headers:{'Content-Type':'application/json'}})`，返回 `Promise.resolve(mockResponse)`（请求被拦截）
3. **Mock 未命中**：调用原始 fetch，用 `response.clone()` 读取响应体（不影响原始响应），**排除 `api.moonshot.cn` 域名**，`cloned.text()` 读取失败时仍记录请求（responseBody 为 null）

## Mock 规则系统

### 规则存储

- 键：`'ai_req_mock_rules_' + location.hostname`（按域名隔离）
- 值：`{ pathname: debugRule, ... }`；旧版 `{ pathname: mockDataObject }` 会自动兼容为 `response.body`
- 持久化：`chrome.storage.local`（见 `state.js` 中 `storageGet` / `storageSet`）
- 保存、取消、批量清除后会调用 `syncMockRulesToPage()`，同步页面主上下文 Hook 中的内存规则，避免本次页面会话继续使用旧 Mock。

### 规则匹配

`getMockKey(url)` → 用 `new URL(url, location.href)` 提取 `pathname` 作为匹配键。**注意：仅匹配 pathname，不包含 query 参数。**

### 规则生效时机

- 拦截器在 `document-start` 时设置，页面刷新后自动加载持久化的 Mock 规则
- **Mock 规则仅在页面代码下次自行发起请求时生效**（拦截器返回 Mock 数据）
- 修改 Mock 数据后需要**刷新页面**才能让页面组件使用 Mock 数据，原因：脚本新发起的 XHR 与页面组件的回调无关，无法驱动页面 UI 更新

### 操作流程

| 操作 | 函数 | 行为 |
|------|------|------|
| 设置Mock | `applyMockData(mockData)` | 用 `buildSimpleMockRule()` 生成响应体 Mock 规则 → saveMockRules → 更新 requestRecord → refreshRequestList → showToast → 弹窗询问刷新页面 |
| 高级改写 | `applyRewriteRuleFromEditor()` | 保存 URL/请求头/响应头/响应体/状态码/一次性模式 → saveMockRules → 更新 requestRecord → refreshRequestList |
| 取消Mock | `removeMockRule(req)` | delete mockRules[key] → saveMockRules → 更新 requestRecord → refreshRequestList |
| 清除所有规则 | `clearAllMockRules()` | confirm → 清空当前 hostname 下所有 mockRules → saveMockRules → 清除请求列表调试标记 → refreshRequestList → showToast |
| 刷新生效 | `replayRequest(reqId)` | `confirm()` 确认后 `location.reload()` |

### Mock 响应结构注意事项

脚本只负责把 Mock 数据作为接口响应返回，不会自动修复业务协议。调试后台或移动端接口时，应保留原接口的统一响应外壳，例如：

```json
{
  "code": 0,
  "message": "...",
  "data": {}
}
```

如果只保留 `data` 或改错字段类型，业务封装可能把响应判定为失败，页面组件也可能报错。

## MCP 工具系统

### 架构概览

MCP 工具系统将浏览器拦截到的 API 请求自动转化为 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 工具定义，使 AI 大模型能通过 MCP 协议直接调用站点 API。

**核心通信链路**：

```
MCP 客户端（AI IDE/Agent）
    ↕ WebSocket (JSON-RPC 2.0)
MCP Helper（Node.js 本地进程）
    ↕ Native Messaging（stdin/stdout，4字节小端序长度头 + JSON）
扩展 background.js（Service Worker）
    ↕ chrome.tabs.sendMessage
扩展 `mcp-engine.js`（Content Script → fetch，天然带 Cookie）
    ↕ 站点 API
```

**降级策略**：当目标标签页关闭时，background.js 直接 `fetch`（`proxyMode: 'fallback'`），无需 Cookie 但仍可请求公开接口。

### Schema 推断引擎

#### `isStaticResource(url)`

过滤静态资源请求，不生成 MCP 工具。匹配扩展：`.js/.css/.png/.jpg/.jpeg/.gif/.svg/.woff/.woff2/.ttf/.eot/.ico/.mp4/.mp3/.wav/.avi/.map/.webp`，以及 `data:` 和 `blob:` 协议。

#### `inferJsonType(value)`

从观察到的请求/响应值推断 JSON Schema 类型：

| 值特征 | 推断类型 |
|--------|----------|
| `null` / `undefined` | `string` |
| 数字 | `number` |
| 布尔 | `boolean` |
| 字符串 `"true"` / `"false"` | `boolean` |
| URL 字符串 | `string` + `format: "uri"` |
| 邮箱格式 | `string` + `format: "email"` |
| 13位数字时间戳 | `integer` + `format: "unix-timestamp"` |
| 数组 | `array` + 递归推断 `items` |
| 对象 | `object` + 递归推断 `properties` |

#### `assessRiskLevel(method, pathname)`

| 等级 | 规则 |
|------|------|
| `low` | GET / HEAD |
| `high` | DELETE；POST/PUT/PATCH 且 pathname 含 `delete/remove/cancel/pay/transfer/withdraw` |
| `medium` | 其他 POST/PUT/PATCH |

#### `detectAuthType(headers)`

检测优先级：`bearer` → `cookie` → `custom`（含 x- 前缀头）→ `none`。

#### `extractQueryParams(url)`

从 URL 提取查询参数为键值对。支持 `new URL()` 解析，失败时手动拆分 `?` 后的查询字符串。

#### `inferPathParams(pathname, sampleRecords)`

对比同 pathname 多次请求的路径段，识别变量段（纯数字 → `id`，8+位十六进制 → `id`，跨请求变化 → 提取前缀命名）。

### 工具生成流程

#### 单条生成：`generateMcpToolFromRecord(req)`

1. 从请求记录提取 URL、method、pathname
2. 生成工具名：`method.toLowerCase() + '_' + pathname.toSnakeCase()`
3. 工具描述：取 AI 分析首行，否则 `method + pathname`
4. 从 `requestBody` 推断 `inputSchema.properties`，所有字段标记 `required`
5. 从 URL 提取查询参数，统一标记为 `string` 类型
6. 评估风险等级、检测认证类型
7. `_meta.sampleRequestHeaders` 经过 `stripSensitiveHeaders` 过滤
8. 返回完整 `MCPToolDefinition`

#### 批量生成：`generateMcpToolsFromRecords(records)`

1. 过滤：移除静态资源、`api.moonshot.cn` 域名
2. 分组：按 `method + pathname` 分组
3. 合并：同组内多请求合并参数——统计字段出现次数（全出现 → required），收集唯一值生成 `enum`（2-10个唯一字符串值时）
4. 生成：每组生成一个 `MCPToolDefinition`
5. 交互：弹窗展示预览，用户可取消

### 代理执行器：`handleMcpProxyRequest`

content script（`core.js` 监听 `MCP_PROXY_REQUEST`）收到请求后：

1. 创建 `AbortController`（30秒超时）
2. 构造 `fetch` 选项：method、headers、body（非 GET/HEAD 时序列化）
3. 执行 `fetch`（**位于隔离世界，天然携带浏览器 Cookie**）
4. 解析响应：JSON 优先，否则 `tryParseJson`
5. 返回 `{ ok, callId, status, headers, body, error, proxyMode: 'tab' }`
6. 超时/失败时返回 `{ ok: false, error: '请求超时'/'请求失败', proxyMode: 'tab' }`

### 安全机制

#### `stripSensitiveHeaders(headers)`

从存储的工具定义中移除以下敏感请求头，确保 MCP 客户端无法获取：

- `cookie`、`authorization`、`set-cookie`
- `proxy-authorization`、`www-authenticate`、`proxy-authenticate`

此函数在 `generateMcpToolFromRecord` 中对 `sampleRequestHeaders` 调用，保证持久化的工具定义不含敏感信息。

#### MCP Helper Token 鉴权

MCP Server 支持可选的 Bearer Token 鉴权（通过环境变量 `MCP_AUTH_TOKEN` 配置）：
- `initialize` 请求需携带 `params.clientInfo.token` / `params._meta.token` / `params.token`
- 验证失败返回 `-32001 Unauthorized` 错误并关闭连接
- 未配置 Token 时允许所有连接

### MCP Server（MCP Helper）

位于 `extension/mcp-helper/server.mjs`，零依赖 Node.js 进程：

- **WebSocket 服务**：监听 `localhost:{port}/mcp`，支持多客户端
- **MCP 协议**：`initialize`（含可选鉴权）→ `tools/list`（仅 enabled 工具，过滤 `_meta`）→ `tools/call`
- **Native Messaging**：4字节小端序长度头 + JSON Body，与扩展通信
- **工具调用超时**：30秒，超时返回 `isError: true`
- **框架自实现**：完整 WebSocket 握手、帧编解码（文本/ping/pong/close），不依赖 `ws` 库

### MCP 配置

在 `DEFAULT_CONFIG` 中新增：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `mcpPort` | `9527` | MCP Server WebSocket 监听端口 |
| `mcpToken` | `''` | MCP Server 鉴权 Token（空字符串表示不鉴权） |
| `mcpAutoSync` | `false` | 工具变更后是否自动同步到 MCP Helper |

## AI 分析模块

### API 调用 (`callAI`)

- 隔离脚本 **`chrome.runtime.sendMessage({ type: 'AI_CHAT_COMPLETIONS', payload })`** → [`extension/background.js`](extension/background.js) 内 **`fetch`**（代理 OpenAI 兼容接口，API Key 不落 MAIN world）。
- URL：`config.baseURL.replace(/\/$/, '') + '/chat/completions'`
- Headers：`{ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey }`
- Body：`{ model: config.model, messages: messages, temperature: 1 }`
- **kimi-k2.6 仅支持 temperature=1**

### 单条分析 (`analyzeRequest`)

**System Prompt**：
```
你是一个HTTP请求分析专家。用户会给你一个HTTP请求的详细信息（URL、方法、请求体、响应体），请分析：1）这个请求的作用是什么 2）响应体中每个字段的含义。请用简洁清晰的中文回复。
```

**User Prompt**：
```
请分析以下请求：
方法: {method}
URL: {url}
请求体: {truncateBody(formatJson(requestBody))}
响应体: {truncateBody(formatJson(responseBody))}
```

### 批量分析 (`analyzeAllRequests`)

过滤 `aiAnalysis === null` 的记录，逐条调用 `analyzeRequest`，通过 `updateAnalyzeProgress` 更新进度条。

### 对话修改 (`chatModify`)

**System Prompt**：
```
你是一个HTTP响应数据修改助手。用户会告诉你想修改哪个请求的响应数据以及如何修改。请生成修改后的完整JSON响应数据，用```json代码块包裹。只输出JSON，不要其他解释。
```

**User Prompt**：
```
{用户输入的指令}

当前请求列表摘要：
1. GET /api/user/info
2. POST /api/login
...
```

AI 返回后用正则 `/```json\s*([\s\S]*?)```/` 提取 JSON 代码块 → `JSON.parse` → 传给 `openJsonEditor` 供用户确认。

## UI 模块

### DOM 安全机制

- `getContainer()`：优先 `document.body`，回退到 `document.documentElement`，确保 DOM 容器可用
- `safeAppendChild(child)`：挂载失败时 setTimeout 1s 重试
- `startDomGuard()`：setInterval 2s 检查浮动球和面板是否仍在 DOM 中，不在则重新挂载；同时调用 `ensureElementInViewport()`，防止悬浮球或面板因历史位置跑到当前视口外
- `onDOMContentLoaded()` 使用 `state.uiReady` 防止重复初始化；除 `DOMContentLoaded` 外，还通过 `window.load` 和 `setTimeout(onDOMContentLoaded, 1500)` 做兜底初始化
- 悬浮球和主面板位置通过 `getScopedStorageKey(name)` 拼接 `location.hostname` 按域名隔离，避免 PC、后台、移动 H5 复用同一个位置导致不可见

### CSS 命名空间

所有 CSS 类名均以 `ai-req-` 开头，集中在 [`extension/content/content.css`](extension/content/content.css)，由 `manifest` `content_scripts.css` 注入，避免与页面冲突。

### 响应式适配

主面板使用：

- `width: min(420px, calc(100vw - 24px))`
- `height: min(620px, calc(100vh - 24px))`

在 `max-width: 520px` 的移动端 H5 环境下，面板自动靠近屏幕顶部，宽度为 `calc(100vw - 16px)`，高度限制为 `min(72vh, 620px)`，并隐藏请求耗时和部分图标列，减少遮挡页面内容。

### 搜索框防自动填充

请求搜索框使用单行 `textarea`，而不是普通 `input`。原因是 Chrome/密码管理器可能无视 `autocomplete="off"`，把动态插入的文本输入框识别为账号框并显示历史账号密码。

当前搜索框设置：

- 随机 `name` / `id`
- `autocomplete="off"`
- `autocorrect="off"`
- `autocapitalize="off"`
- `spellcheck="false"`
- `data-lpignore="true"`
- `data-form-type="other"`
- 阻止回车换行，并在 input 时移除换行符

### 主要 UI 组件

| 组件 | 类名 | 功能 |
|------|------|------|
| 浮动球 | `.ai-req-floating-ball` | 可拖拽入口，点击切换面板 |
| 主面板 | `.ai-req-main-panel` | 请求列表 + 搜索 + AI分析 + 底部对话输入 |
| 搜索框 | `.ai-req-search-input` | 单行 textarea，过滤 URL 和 AI 分析结果，并规避浏览器密码自动填充 |
| 清除规则按钮 | `.ai-req-clear-mock-btn` | 清除当前域名下所有调试规则 |
| 请求行 | `.ai-req-request-row` | 方法标签 + URL + 状态码 + 耗时 + 图标 |
| 调试标记 | `.ai-req-debug-tag` | 显示 `Mock` / `Req` / `ResH` / `Once` 等命中状态 |
| 请求详情 | `.ai-req-request-detail` | 折叠区显示请求/响应数据 + AI分析 + Mock操作 |
| JSON编辑器 | `.ai-req-json-editor-overlay` | 模态弹窗，编辑Mock数据 |
| 高级改写编辑器 | `.ai-req-rewrite-editor-overlay` | 编辑 URL、请求头、响应头、状态码、响应体、启用状态、生效模式 |
| 配置面板 | `.ai-req-config-overlay` | 模态弹窗，配置API Key/URL/Model |
| MCP 工具管理面板 | `.ai-req-mcp-content` | MCP 工具列表/调用日志，嵌入主面板 |
| MCP 状态栏 | `.ai-req-mcp-status-bar` | 显示 MCP Server 连接状态（●已启动/○未启动）+ 启动/停止按钮 |
| MCP 工具卡片 | `.ai-req-mcp-tool-item` | 工具名 + 风险标签 + 启用开关 + 描述 + 操作按钮（编辑/测试/删除） |
| MCP 工具编辑器 | `.ai-req-mcp-editor-overlay` | 模态弹窗，编辑工具名称/描述/启用状态/参数描述和 required |
| MCP 工具测试器 | `.ai-req-mcp-tester-modal` | 模态弹窗，填写参数执行工具调用，显示响应结果 |
| MCP 调用日志 | `.ai-req-mcp-log-item` | 工具调用记录（时间、工具名、状态码、耗时、错误） |
| MCP 风险标签 | `.ai-req-mcp-risk` | `low`(绿)/`medium`(橙)/`high`(红) 风险等级标记 |
| Toast | `.ai-req-toast` | 顶部居中通知条（绿色渐入渐出） |

### 事件绑定摘要

| 触发 | 行为 |
|------|------|
| 点击浮动球 | `toggleMainPanel()` |
| 拖拽浮动球 | 保存位置到 `chrome.storage.local` |
| 搜索框 input | `refreshRequestList(keyword)` 过滤 URL 和 aiAnalysis |
| 点击请求行 | 切换展开/折叠详情 |
| 点击"✨ AI分析" | `analyzeRequest(req.id)` |
| 点击"一键分析所有" | `analyzeAllRequests()` |
| 点击"清除所有规则" | `clearAllMockRules()` → 清空当前域名全部调试规则并同步页面 Hook |
| 点击"✏ 修改响应" | `state.selectedReqId = req.id` → `openJsonEditor(req.responseBody)` |
| 点击"高级改写" | `openRewriteEditor(req)` → 编辑完整调试规则 |
| 点击"🔧 生成MCP工具" | `generateMcpToolFromRecord(req)` → 保存到 `state.mcpTools` → `saveMcpTools()` → `MCP_SYNC_TOOLS` → `showToast` |
| 点击"🔗 一键生成MCP工具" | `generateMcpToolsFromRecords(state.requestRecords)` → 弹窗预览 → 批量保存 → `MCP_SYNC_TOOLS` |
| 点击"MCP 工具"标签 | `state.mcpPanelTab = 'list'` → `refreshMainPanelContent()` 显示 MCP 工具列表 |
| MCP 面板"启动"按钮 | `MCP_START_HELPER` → `connectMcpHelper()` → 刷新状态栏 |
| MCP 面板"停止"按钮 | `MCP_STOP_HELPER` → `disconnectMcpHelper()` → 刷新状态栏 |
| MCP 工具启用/禁用 | `state.mcpTools[name].enabled = checked` → `saveMcpTools()` → `MCP_SYNC_TOOLS` |
| MCP 工具"编辑" | `openMcpToolEditor(name)` → 编辑名称/描述/启用/参数描述/required → 保存同步 |
| MCP 工具"测试" | `openMcpToolTester(name)` → 填参执行 → `MCP_TOOL_TEST` → 显示响应 |
| MCP 工具"删除" | `confirm()` → `deleteMcpTool(name)` → `MCP_SYNC_TOOLS` → `refreshMainPanelContent()` |
| MCP "调用日志"标签 | `state.mcpPanelTab = 'logs'` → `MCP_GET_CALL_LOGS` → 渲染日志列表 |
| 点击日志条目 | 展开/折叠显示请求参数摘要和代理模式 |
| 取消Mock | `removeMockRule(req)` |
| 点击"🔄 刷新页面生效" | `replayRequest(req.id)` → `confirm()` → `location.reload()` |
| JSON编辑器确认 | `JSON.parse(textarea.value)` → `applyMockData(data)` |
| 底部输入 Enter | `chatModify(msg)` → AI返回JSON → `openJsonEditor(data)` → 用户确认 → `applyMockData(data)` |
| 页面右键「打开请求分析面板」 | `toggleMainPanel()` |
| 页面右键「配置」 | `openConfigPanel()` |
| 页面右键「重置悬浮窗位置」 | 清空当前域名下悬浮球/面板位置并恢复默认右下角 |
| 页面右键「诊断运行状态」 | alert 展示 URL、UI、悬浮球挂载、请求数、`READ_PAGE_HOOK_INSTALLED` / MAIN `__AI_REQ_ANALYZER_HOOKED__` |

## 扩展目录清单与行为要点（`extension/`）

实现位于 [`extension/`](extension/)，在 **Chrome / Edge** 等浏览器中通过「加载已解压的扩展程序」安装。

| 文件 | 作用 |
|------|------|
| [`extension/manifest.json`](extension/manifest.json) | MV3 清单：`document_start` 注入隔离脚本、`content.css`、权限与 `host_permissions` |
| [`extension/content/isolated.js`](extension/content/isolated.js) | 入口引导层（~50行）：IIFE 引导初始化与 DOMReady |
| [`extension/content/state.js`](extension/content/state.js) | 状态与存储层：`STORAGE_CACHE`、常量、`state`、`loadConfig`/`saveConfig`/`loadMockRules`/`saveMockRules` |
| [`extension/content/mock-rules.js`](extension/content/mock-rules.js) | Mock 规则工具：`normalizeRule`、`findDebugRule`、`buildResponseHeaders`、`consumeOnceRuleByKey` 等 |
| [`extension/content/core.js`](extension/content/core.js) | 请求拦截核心：`interceptXHR/Fetch`、`addRequestRecord`、`syncMockRulesToPage`、`setupMenuCommands` |
| [`extension/content/ai-analysis.js`](extension/content/ai-analysis.js) | AI 分析：`callAI`、`analyzeRequest`、`analyzeAllRequests`、`chatModify` |
| [`extension/content/mcp-engine.js`](extension/content/mcp-engine.js) | MCP 引擎：Schema 推断、工具生成/存储/代理执行、`stripSensitiveHeaders` |
| [`extension/content/page-hook.js`](extension/content/page-hook.js) | MAIN world：页面真实 XHR/Fetch Hook；由 SW `executeScript` 注入 |
| [`extension/content/content.css`](extension/content/content.css) | 全部 `ai-req-*` 样式 |
| [`extension/background.js`](extension/background.js) | Service Worker：`INJECT_PAGE_HOOK`、`READ_PAGE_HOOK_INSTALLED`、`AI_CHAT_COMPLETIONS`、MCP 路由层（Native Messaging、`handleMcpToolCall`、`fallbackFetch`、`syncToolsToHelper`）、右键菜单 |
| [`extension/mcp-helper/server.mjs`](extension/mcp-helper/server.mjs) | MCP Helper：零依赖 WebSocket MCP Server，Native Messaging 桥接，工具同步与调用路由 |
| [`extension/mcp-helper/install.mjs`](extension/mcp-helper/install.mjs) | Native Messaging Host 安装脚本：跨平台注册（Windows 注册表 / macOS/Linux 文件系统） |
| [`extension/mcp-helper/nm-host-manifest.json`](extension/mcp-helper/nm-host-manifest.json) | Native Messaging Host 清单模板（`allowed_origins: chrome-extension://njgfblgbmbhkegiaopcpnikggdmieodc/`） |
| [`extension/mcp-helper/package.json`](extension/mcp-helper/package.json) | MCP Helper 包配置（ESM 模块，零外部依赖） |
| [`extension/scripts/generate-from-userscript.mjs`](extension/scripts/generate-from-userscript.mjs) | **可选**：从遗留 `ai-request-analyzer.user.js` 生成前端三文件。结束锚须落在 **`syncMockRulesToPage` 之前**，勿用外层 `defineMockXhrResponse` 作截断，否则会删掉 `syncMockRulesToPage`。 |

**要点**：存储为 `chrome.storage.local`；MAIN 注入须经 `sender.tab.id`，勿依赖内容脚本 `chrome.tabs.getCurrent()`；AI 走后台 `fetch`。`host_permissions` 使用 `<all_urls>` 以覆盖任意站点上的 `http(s)` 页内容脚本。

### 安装（开发）

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 「加载已解压的扩展程序」→ 选中本仓库 `extension` 目录。
3. 在 `chrome.storage` 中写入配置（首次使用通过扩展 UI 配置面板填写 API Key 等）。

---

## 修改指南

### 添加新的 Mock 匹配策略

当前以 URL pathname 精确匹配。如需模糊匹配，修改 `getMockKey(url)` 和 `findMockRule(url)` 函数。

### 更换 AI 模型

修改 `DEFAULT_CONFIG.baseURL` 和 `DEFAULT_CONFIG.model`。`callAI` 函数调用标准 OpenAI 兼容接口 `/chat/completions`，兼容任何相同格式的 API。

### 添加新的请求过滤规则

在 MAIN Hook（`page-hook.js`）的 `shouldIgnore(url)`、隔离脚本 `interceptXHR` / `interceptFetch` 中，`url.indexOf('api.moonshot.cn')` 等处统一增删排除规则。

### 调整 AI 分析 Prompt

修改 `analyzeRequest` 和 `chatModify` 中的 `messages` 数组内容。

### 添加新的 UI 功能

1. 在 [`extension/content/content.css`](extension/content/content.css) 添加样式（`ai-req-` 前缀）
2. 在对应的 `create*` 函数中创建 DOM 元素（[`extension/content/ui-core.js`](extension/content/ui-core.js)）
3. 在 `bindDetailEvents` 中绑定事件
4. 在 `buildDetailHTML` 中添加按钮 HTML

### 修改拦截逻辑

- MAIN world Hook 位于 [`extension/content/page-hook.js`](extension/content/page-hook.js)，由 Service Worker `executeScript` 注入；与隔离脚本中 `setupPageContextInterception`、`syncMockRulesToPage` 配套。
- 如果修改调试规则同步逻辑，需要同时关注 `saveMockRules()`、`syncMockRulesToPage()`、页面 Hook 中监听 `PAGE_MOCK_RULES_MSG` 的代码，以及一次性规则消费的 `PAGE_RULE_CONSUMED_MSG`。
- 如果修改 XHR Mock 流程，需要保持 `defineMockXhrResponse()` 和 `dispatchMockXhrSuccess()` 在 MAIN（[`page-hook.js`](extension/content/page-hook.js)）与隔离脚本兜底（`core.js`）中行为一致。
- axios 兼容依赖 `loadend`，不要移除 Mock 命中后的 `loadend` 事件。
- 如果修改规则结构，需要保持 `normalizeRule()` 对旧响应体 Mock 的兼容。
- 请求 URL 和请求头改写需要同时改 MAIN Hook 与隔离脚本兜底拦截，避免不同站点表现不一致。

### 修改 MCP 工具系统

- **Schema 推断**：修改 `inferJsonType` / `assessRiskLevel` / `detectAuthType` / `extractQueryParams` / `inferPathParams` 函数（[`extension/content/mcp-engine.js`](extension/content/mcp-engine.js)）
- **工具生成**：修改 `generateMcpToolFromRecord` / `generateMcpToolsFromRecords`（[`extension/content/mcp-engine.js`](extension/content/mcp-engine.js)）
- **MCP 协议**：修改 MCP 协议处理位于 [`extension/mcp-helper/server.mjs`](extension/mcp-helper/server.mjs)，注意 `_meta` 字段在 `tools/list` 响应中被过滤
- **Native Messaging**：修改消息格式需同时改 `server.mjs` 的 `readNMMessage` / `writeNMMessage` / `handleNMMessage` 和 `background.js` 的 `handleHelperMessage`
- **代理执行**：修改 `handleMcpProxyRequest`（`mcp-engine.js`）和 `handleMcpToolCall` / `fallbackFetch`（background.js）
- **安全过滤**：修改 `stripSensitiveHeaders` 的过滤列表时，确保 MCP 客户端不会通过 `_meta` 泄露敏感信息（`_meta` 已在 `tools/list` 中过滤）
- **Native Host 安装**：修改 `install.mjs` 时，注意 Windows 注册表路径 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.aireq.mcp_helper`

### 注意事项

- 业务逻辑置于 [`extension/content/`](extension/content/) 各模块文件中，**ES5** 风格为主，无框架依赖
- 跨域 Kimi 请求在 **Service Worker** 中 `fetch`，不受页面 CSP 约束；页面侧 XHR/Fetch 拦截仍受站点 CSP / 同源策略影响
- 诊断页面 Hook：`READ_PAGE_HOOK_INSTALLED` 或 MAIN 全局 `__AI_REQ_ANALYZER_HOOKED__`；请求记录依赖 `postMessage` 桥接
- Mock 在页面刷新后自动恢复（`init()` 中 `loadMockRules()`）
- Mock 规则按 `location.hostname` 隔离；悬浮球和主面板位置也按 hostname 隔离
- 请求 URL 改写可能触发 CORS，这是浏览器安全策略限制，不是脚本异常
- 真实 XHR 响应头无法可靠改写；响应头改写主要适用于 Fetch 和 Mock 响应
- XHR 请求头删除受浏览器限制，页面代码已经设置过的 header 不保证完全移除
- 最多保存 100 条请求记录（`MAX_RECORDS`），超出后 FIFO
- AI 分析时请求/响应体截断到 2000 字符（`MAX_AI_BODY_LENGTH`）
- MCP 工具按 `location.hostname` 隔离存储（键名 `MCP_TOOLS_KEY_PREFIX + hostname`）
- MCP 工具的 `_meta` 字段不暴露给 MCP 客户端，`tools/list` 时自动过滤
- `sampleRequestHeaders` 在保存时已通过 `stripSensitiveHeaders` 过滤敏感头，但代理执行时使用的是过滤后的样本头，**不含 Cookie**——代理执行通过浏览器 Content Script 的 `fetch` 天然携带 Cookie
- Native Messaging Host 名称：`com.aireq.mcp_helper`，扩展 ID 须与 `allowed_origins` 匹配
- MCP Helper 端口默认 `9527`，可通过 `--port` 参数或配置面板修改
- MCP Helper 调用日志最多 200 条（FIFO），仅存于 background.js 内存，不持久化
- 代理执行超时 30 秒（`mcp-engine.js` 和 MCP Helper 双重超时保障）
- MV3 Service Worker 无法启动 WebSocket 服务器，因此需要通过 Native Messaging 启动本地 Node.js Helper 进程
