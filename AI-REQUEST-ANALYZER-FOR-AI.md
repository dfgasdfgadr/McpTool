# AI请求智能分析助手 — 浏览器扩展（MV3）AI 工作参考

> 本文档**仅面向 Chromium 系 Manifest V3 扩展**，与 [AI-REQUEST-ANALYZER-SPEC.md](AI-REQUEST-ANALYZER-SPEC.md) 互补：SPEC 描述业务语义、数据结构、UI 与 Mock 流程；本文描述 **`extension/` 目录内实现、消息协议、文件职责与排错**。  
> 维护约定：**以后只改扩展源码**；不再要求与油猴脚本双轨对齐。

---

## 1. 源码位置与职责（唯一真相来源）

| 文件 | 职责 |
|------|------|
| [`extension/manifest.json`](extension/manifest.json) | MV3 清单：`content_scripts`（`document_start`、8个JS模块按序加载、`content.css`）、`background` Service Worker、权限（含 `nativeMessaging`）与 `host_permissions` |
| **Content Script 模块（隔离世界，共享执行上下文，按加载顺序）：** | |
| [`extension/content/state.js`](extension/content/state.js) | ① **状态与存储层**：`STORAGE_CACHE` + `storageGet`/`storageSet`/`storageHydrateThen`、常量（`CONFIG_KEY`、`MOCK_RULES_KEY_PREFIX`、`PAGE_RECORD_MSG` 等）、`DEFAULT_CONFIG`、`state` 对象、`loadConfig`/`saveConfig`/`loadMockRules`/`saveMockRules` |
| [`extension/content/mock-rules.js`](extension/content/mock-rules.js) | ② **Mock 规则层**：`getMockKey`、`normalizeRule`/`normalizeAllRules`、`findDebugRule`、`hasRequestBodyMock`/`hasResponseHeaderRewrite`/`hasResponseBodyMock`、`applyHeaderRewrite`、`buildResponseHeaders`、`buildSimpleMockRule`、`consumeOnceRuleByKey` |
| [`extension/content/core.js`](extension/content/core.js) | ③ **请求拦截层**：工具函数（`generateId`、`truncateBody`、`formatJson`、`getContainer`、`tryParseJson` 等）、`addRequestRecord`、`setupRequestInterception`、`interceptXHR`/`interceptFetch`、`syncMockRulesToPage`、`setupMenuCommands`、`setupPageContextInterception` |
| [`extension/content/ai-analysis.js`](extension/content/ai-analysis.js) | ④ **AI 分析层**：`callAI`（→ 后台消息代理）、`analyzeRequest`、`analyzeAllRequests`、`chatModify` |
| [`extension/content/mcp-engine.js`](extension/content/mcp-engine.js) | ⑤ **MCP 引擎层**：`escapeHtml`、Schema 推断（`inferJsonType`、`assessRiskLevel`、`detectAuthType`、`extractQueryParams`、`inferPathParams`）、`generateMcpToolFromRecord`/`generateMcpToolsFromRecords`、工具存储（`saveMcpTools`/`loadMcpTools`/`deleteMcpTool`）、`stripSensitiveHeaders`、`isStaticResource`、`handleMcpProxyRequest` |
| [`extension/content/ui-core.js`](extension/content/ui-core.js) | ⑥ **主 UI 层**：悬浮球、主面板、配置面板、JSON 编辑器、改写编辑器、请求列表/详情渲染、Mock/改写操作、Toast、AI 分析进度、`replayRequest` 等 33 个函数 |
| [`extension/content/mcp-ui.js`](extension/content/mcp-ui.js) | ⑦ **MCP UI 层**：`refreshMainPanelContent`、工具列表/日志渲染（`buildMcpToolListHTML`/`buildMcpLogListHTML`）、`bindMcpContentEvents`、`refreshMcpStatusBar`、`openMcpToolEditor`、`openMcpToolTester` 等 8 个函数 |
| [`extension/content/isolated.js`](extension/content/isolated.js) | ⑧ **入口引导层**（~50行）：IIFE 包裹 → `init()` → `storageHydrateThen` → 加载配置/规则/MCP工具 → 设置菜单与拦截 → `onDOMContentLoaded()` → 创建 UI → `startDomGuard()` |
| **其他文件：** | |
| [`extension/content/page-hook.js`](extension/content/page-hook.js) | **MAIN world**：重写页面 `XHR`/`fetch`，`postMessage` 回写记录、`PAGE_MOCK_RULES_MSG` 更新内存规则；与 `core.js` 中兜底逻辑语义须一致 |
| [`extension/content/content.css`](extension/content/content.css) | 全部 `.ai-req-*` 样式（含 `.ai-req-mcp-*` MCP 样式） |
| [`extension/background.js`](extension/background.js) | Service Worker：右键菜单、`INJECT_PAGE_HOOK` / `READ_PAGE_HOOK_INSTALLED` / `AI_CHAT_COMPLETIONS`、**MCP 路由层**（Native Messaging 连接管理、`handleMcpToolCall`、`fallbackFetch`、`syncToolsToHelper`） |
| [`extension/mcp-helper/server.mjs`](extension/mcp-helper/server.mjs) | **MCP Helper**：零依赖 WebSocket MCP Server，Native Messaging 桥接扩展，工具同步与调用路由 |
| [`extension/mcp-helper/install.mjs`](extension/mcp-helper/install.mjs) | Native Messaging Host 安装脚本：跨平台注册（Windows 注册表 / macOS/Linux 文件系统） |
| [`extension/mcp-helper/nm-host-manifest.json`](extension/mcp-helper/nm-host-manifest.json) | Native Messaging Host 清单模板（`allowed_origins: chrome-extension://njgfblgbmbhkegiaopcpnikggdmieodc/`） |
| [`extension/mcp-helper/package.json`](extension/mcp-helper/package.json) | MCP Helper 包配置（ESM 模块，零外部依赖） |

常量名与消息类型与 SPEC「常量」表一致：`PAGE_RECORD_MSG`、`PAGE_MOCK_RULES_MSG`、`PAGE_RULE_CONSUMED_MSG`。**`syncMockRulesToPage()` 在 `core.js` 中定义**；缺失会导致保存 Mock 等路径报 `syncMockRulesToPage is not defined`。

**模块加载顺序**（manifest.json `content_scripts.js` 数组）：`state.js` → `mock-rules.js` → `core.js` → `ai-analysis.js` → `mcp-engine.js` → `ui-core.js` → `mcp-ui.js` → `isolated.js`。同一 `content_scripts` 组内的文件共享执行上下文，`var`/`function` 声明跨文件全局可见。循环依赖（如 `core.js` ↔ `ui-core.js`）通过运行时延迟调用安全规避。

---

## 2. 扩展运行时要点（无油猴）

- **注入时机**：`content_scripts`.`run_at` = `document_start`；初始化走 `storageHydrateThen` → `init()` → `loadConfig()` → `loadMockRules()` → `loadMcpTools()` → `setupRequestInterception()`。
- **MAIN Hook**：绝不用内容脚本里的 `chrome.tabs.getCurrent()` 作为主注入依据（常为 `undefined`）。应 **`chrome.runtime.sendMessage({ type: 'INJECT_PAGE_HOOK' })`**，后台用 **`sender.tab.id`** 执行 `chrome.scripting.executeScript({ world: 'MAIN', files: ['content/page-hook.js'] })`，成功后再 `syncMockRulesToPage()`。
- **持久化**：`chrome.storage.local`；键名见 SPEC（`CONFIG_KEY`、`MOCK_RULES_KEY_PREFIX` + `hostname`、`MCP_TOOLS_KEY_PREFIX` + `hostname` 等）。
- **Kimi**：`isolated.js` → `chrome.runtime.sendMessage` → **`background.js` `fetch`**，勿在 MAIN world 暴露密钥。
- **入口菜单**：`chrome.contextMenus` → `tabs.sendMessage` → `AI_REQ_ANALYZER_MENU`。
- **MCP**：`isolated.js` → `MCP_START_HELPER` → `background.js` → `chrome.runtime.connectNative('com.aireq.mcp_helper')` → MCP Helper (Node.js) → WebSocket → MCP 客户端。

---

## 3. Service Worker ↔ 隔离脚本消息

### 原有消息

| `type` / 链路 | 方向 | 说明 |
|----------------|------|------|
| `INJECT_PAGE_HOOK` | isolated → background | SW 对本 tab `executeScript` 注入 `page-hook.js`；回调成功后 isolated `syncMockRulesToPage()` |
| `READ_PAGE_HOOK_INSTALLED` | isolated → background | MAIN world 读取 `window.__AI_REQ_ANALYZER_HOOKED__`（诊断） |
| `AI_CHAT_COMPLETIONS` | isolated → background | 代理 `/chat/completions`，返回 `choices[0].message.content` |
| `AI_REQ_ANALYZER_MENU` | background → isolated | `action`: `open_panel` \| `open_config` \| `reset_positions` \| `diagnostics` |

### MCP 新增消息

| `type` / 链路 | 方向 | 说明 |
|----------------|------|------|
| `MCP_START_HELPER` | isolated → background | 启动 MCP Helper，payload 含 `mcpPort`；调用 `connectMcpHelper()` |
| `MCP_STOP_HELPER` | isolated → background | 停止 MCP Helper；调用 `disconnectMcpHelper()`，发送 `SHUTDOWN` 后断开 |
| `MCP_SYNC_TOOLS` | isolated → background | 通知 background 重新同步工具到 Helper；调用 `syncToolsToHelper()` |
| `MCP_GET_STATUS` | isolated → background | 查询 Helper 连接状态；返回 `{ helperConnected, serverPort, callLogCount }` |
| `MCP_GET_CALL_LOGS` | isolated → background | 获取调用日志；返回 `{ logs: mcpState.callLogs }` |
| `MCP_TOOL_TEST` | isolated → background | 从 MCP 工具测试器发起的调用（走与 `handleMcpToolCall` 相同的代理逻辑） |
| `MCP_PROXY_REQUEST` | background → isolated | 代理执行请求；payload 含 `callId/toolName/url/method/headers/body/timeout`，isolated `fetch` 后 `sendResponse` |

扩展新能力时：**单入口 `onMessage` 内加分支**，勿与现有 `type` 冲突。

---

## 4. Native Messaging 协议

MCP Helper 通过 Chrome Native Messaging 与扩展通信。消息格式：**4字节小端序长度头 + JSON Body**。

### 扩展 → Helper（`background.js` → `server.mjs`）

| 消息类型 | 字段 | 说明 |
|----------|------|------|
| `SYNC_TOOLS` | `tools: { [name]: MCPToolDefinition }` | 同步全部工具定义，Helper 侧仅保留 `enabled !== false` |
| `CALL_RESULT` | `callId, result: { ok, status, headers, body, error, proxyMode }` | 工具调用执行结果回传 |
| `SHUTDOWN` | — | 通知 Helper 进程退出 |

### Helper → 扩展（`server.mjs` → `background.js`）

| 消息类型 | 字段 | 说明 |
|----------|------|------|
| `CALL_REQUEST` | `callId, toolName, arguments` | MCP 客户端发起的工具调用请求 |

### MCP Helper mcpState

```javascript
{
  helperConnected: false,    // Native Messaging 是否已连接
  helperPort: null,          // chrome.runtime.Port 对象
  tools: {},                 // 工具定义缓存（未使用，由 storage 管理）
  callLogs: [],              // 调用日志数组，最多 200 条 FIFO
  pendingCalls: {},          // { callId: { resolve } } 未完成的工具调用回调
  serverPort: 9527           // MCP Server 监听端口
}
```

---

## 5. MCP 工具调用链路

### 完整调用链

```
1. MCP 客户端 → WebSocket → server.mjs: tools/call
2. server.mjs → writeNMMessage({ type: 'CALL_REQUEST', callId, toolName, arguments }) → background.js
3. background.js: handleMcpToolCall()
   a. chrome.storage.local.get(null) → 遍历 ai_req_mcp_tools_* 查找工具定义
   b. 从 _meta 提取 origin/pathname/method/sampleRequestHeaders/queryParams
   c. 拼接 URL：origin + pathname + queryString（GET 参数和 queryParams 参数走 query）
   d. findTargetTab(origin) → chrome.tabs.query({ url: origin + '/*' }) → 按 lastAccessed 排序
4a. 找到标签页 → chrome.tabs.sendMessage(tabId, { type: 'MCP_PROXY_REQUEST', payload }) → isolated.js handleMcpProxyRequest
    → fetch（天然带 Cookie）→ sendResponse({ ok, callId, status, headers, body, proxyMode: 'tab' })
4b. 未找到标签页 → fallbackFetch() → background.js 直接 fetch
    → 返回 { ok, status, headers, body, proxyMode: 'fallback' }
5. background.js → addMcpCallLog() → helperPort.postMessage({ type: 'CALL_RESULT', callId, result })
6. server.mjs → pendingCalls.get(callId).resolve(result) → wsSend({ jsonrpc, id, result }) → MCP 客户端
```

### 超时机制

- **isolated.js**：`AbortController` + `setTimeout(30s)` → abort → 返回 `{ error: '请求超时' }`
- **server.mjs**：`setTimeout(30s)` → 清除 pendingCall → 返回 `{ isError: true, content: '工具调用超时' }`

---

## 6. MCP Server 实现细节（`server.mjs`）

### WebSocket 协议

- 监听路径：`ws://localhost:{port}/mcp`（非 `/mcp` 路径返回 404）
- 零依赖：手写 WebSocket 握手（SHA-1 + Base64）、帧编解码（文本/ping/pong/close）
- 支持多客户端连接（`clients` Set）

### MCP JSON-RPC 2.0 方法

| 方法 | 行为 |
|------|------|
| `initialize` | 验证 Token（如配置），返回 `{ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name, version } }` |
| `tools/list` | 返回 `{ tools: cachedTools }`——仅 enabled 工具，**已剔除 `_meta` 字段** |
| `tools/call` | 生成 callId → 写入 pendingCalls → 通过 Native Messaging 发送 `CALL_REQUEST` → 等待 `CALL_RESULT` |
| `notifications/initialized` | 通知消息，不响应 |
| 其他 | 返回 `-32601 Method not found` |

### Token 鉴权

- 环境变量 `MCP_AUTH_TOKEN` 设置 Token
- `initialize` 时从 `params.clientInfo.token` / `params._meta.token` / `params.token` 提取
- 验证失败：返回 `-32001 Unauthorized` + 关闭 WebSocket

---

## 7. Native Messaging Host 安装（`install.mjs`）

| 平台 | 安装方式 |
|------|----------|
| Windows | 写入 `{__dirname}/com.aireq.mcp_helper.json`，注册表 `reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.aireq.mcp_helper"` |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.aireq_mcp_helper.json` |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/com.aireq_mcp_helper.json` |

执行：`node install.mjs`，完成后**重启 Chrome**。

---

## 8. 改拦截 / Mock 时必须同时看的函数

| 关注点 | Content Script 模块 | page-hook.js |
|--------|---------------------|---------------|
| 规则推到页面 Hook | `core.js`: `syncMockRulesToPage`、`state.js`: `saveMockRules` | `message` 监听 `PAGE_MOCK_RULES_MSG` |
| 记录进列表 | `core.js`: `addRequestRecord`（收 `PAGE_RECORD_MSG`） | `postMessage` 发 `PAGE_RECORD_MSG` |
| 一次性规则 | `mock-rules.js`: `consumeOnceRuleByKey` 等 | `PAGE_RULE_CONSUMED_MSG` |
| 兜底拦截 | `core.js`: `interceptXHR`、`interceptFetch` | —（MAIN 已覆盖绝大部分站点） |

**XHR Mock**：须保留 `readystatechange` → `load` → `loadend`（axios）；两处 Mock 收尾逻辑对齐。

## 9. 改 MCP 时必须同时看的函数

| 关注点 | Content Script 模块 | background.js | server.mjs |
|--------|---------------------|---------------|------------|
| 工具生成 | `mcp-engine.js`: `generateMcpToolFromRecord`、`generateMcpToolsFromRecords`、`isStaticResource` | — | — |
| Schema 推断 | `mcp-engine.js`: `inferJsonType`、`assessRiskLevel`、`detectAuthType`、`extractQueryParams`、`inferPathParams` | — | — |
| 工具存储 | `mcp-engine.js`: `saveMcpTools`、`loadMcpTools`、`deleteMcpTool` | `syncToolsToHelper`（读 storage 写 NM） | `handleNMMessage SYNC_TOOLS` |
| 代理执行 | `mcp-engine.js`: `handleMcpProxyRequest`（fetch + sendResponse） | `handleMcpToolCall` + `fallbackFetch` + `findTargetTab` | `CALL_REQUEST` → `CALL_RESULT` |
| 安全过滤 | `mcp-engine.js`: `stripSensitiveHeaders` | — | `tools/list` 过滤 `_meta` |
| Native Messaging | — | `connectMcpHelper`、`disconnectMcpHelper`、`handleHelperMessage` | `readNMMessage`、`writeNMMessage` |
| MCP 协议 | — | — | `handleMCPMessage`（initialize/tools/list/tools/call） |
| MCP UI | `mcp-ui.js`: `refreshMainPanelContent`、`buildMcpToolListHTML`、`buildMcpLogListHTML`、`bindMcpContentEvents`、`openMcpToolEditor`、`openMcpToolTester`、`refreshMcpStatusBar` | — | — |

---

## 10. 可选：`generate-from-userscript.mjs`（非日常路径）

仓库若仍保留 [`extension/scripts/generate-from-userscript.mjs`](extension/scripts/generate-from-userscript.mjs)，可从 **`ai-request-analyzer.user.js`** 生成 content script 文件。**例行开发应直接编辑 `extension/content/` 下各模块文件**（`state.js`、`mock-rules.js`、`core.js`、`ai-analysis.js`、`mcp-engine.js`、`ui-core.js`、`mcp-ui.js`、`isolated.js`）。

---

## 11. 故障分流

| 现象 | 优先查 |
|------|--------|
| 有悬浮窗、列表无请求 | `INJECT_PAGE_HOOK` / SW 控制台错误；页面非 `http(s)`；`page-hook.js` 未注入 |
| `syncMockRulesToPage is not defined` | `isolated.js` 缺函数或曾被错误批量替换 |
| 弹窗「JSON格式错误」+ 实为 ReferenceError | 根因在 `applyMockData`/`confirm` 链路上，修实现后再收紧 catch 文案（可选） |
| AI 分析失败 | `background.js` `fetch`、网络权限、`apiKey`、`model`/`temperature` 约束 |
| MCP 启动失败 | 1. `install.mjs` 是否已执行；2. `com.aireq.mcp_helper` 注册表/文件是否存在；3. Node.js 是否在 PATH 中；4. Chrome 是否已重启 |
| MCP 已启动但客户端连不上 | 1. 端口是否被占用（默认 9527）；2. `--port` 参数是否与客户端配置匹配；3. 防火墙是否拦截 localhost |
| MCP 客户端 `Unauthorized` | `MCP_AUTH_TOKEN` 环境变量与客户端 Token 不匹配 |
| 工具调用返回 `Tool not found` | 工具未保存到 storage 或 `MCP_SYNC_TOOLS` 未触发；检查 `ai_req_mcp_tools_*` 键 |
| 工具调用超时 | 1. 目标站点不可达；2. 标签页已关闭且 fallback 也失败；3. 网络代理问题 |
| 工具调用无 Cookie | 标签页已关闭，走了 `fallbackFetch`（不携带浏览器 Cookie）；保持标签页打开 |
| `tools/list` 空列表 | 1. 未生成 MCP 工具；2. 工具 `enabled = false`；3. `syncToolsToHelper` 未执行 |

---

## 12. 修改自检清单（AI 自用）

1. Hook 语义变更 → **`page-hook.js` + `core.js` 兜底** 一起看。  
2. 规则结构 / 存储键 → `mock-rules.js`: `normalizeRule`、`state.js`: `storageSet`、`PAGE_MOCK_RULES_MSG`。  
3. 新能力与网络/标签页有关 → **`manifest.json` permissions + background.js + 对应 content 模块**。  
4. 样式 → **`content.css`**（或顺带维护生成脚本里的 CSS 提取源——仅当仍在用生成器）。  
5. MCP 变更 → **至少看 `mcp-engine.js` + `mcp-ui.js` + background.js + server.mjs**（见第 9 节交叉表）。  
6. Native Messaging 消息格式变更 → **同时改 `handleNMMessage`（server.mjs）和 `handleHelperMessage`/`syncToolsToHelper`（background.js）**。  
7. 安全：`_meta` 不应暴露给 MCP 客户端，`tools/list` 会自动过滤，但不要在 `inputSchema` 中引入敏感字段。  
8. 手测：`http/https` SPA 一页、严格 CSP 一页、右键四项菜单、MCP 启停、工具生成/编辑/测试/删除。

---

## 13. 与 SPEC 的关系

- **数据结构、操作流程、Prompt、字段含义、Schema 推断规则、安全机制** → [AI-REQUEST-ANALYZER-SPEC.md](AI-REQUEST-ANALYZER-SPEC.md)。SPEC 正文里若仍出现「GM_」「油猴」等措辞，视作**与同功能在扩展中的等价抽象**；**实现细节以本文与 `extension/` 源码为准。**
