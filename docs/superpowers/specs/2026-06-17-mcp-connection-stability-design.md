# MCP 连接稳定性快速修复设计

日期：2026-06-17  
阶段：Brainstorming 设计稿  
范围：MCP Helper 启动链路、端口配置透传、HTTP 健康检查、状态展示与失败处理  
非目标：工具命名/Schema 质量治理、诊断工作台、自动守护进程

## 1. 背景与问题

用户在使用 Cursor 连接 `ai-request-analyzer` MCP 时出现：

- 日志反复出现 `net::ERR_CONNECTION_REFUSED`、`Maximum reconnection attempts exceeded`
- Cursor MCP 面板显示 `Error`，`connected=false`
- 插件 UI 可能显示「已启动」，但 Cursor 侧仍无法连接

### 1.1 根因分析（与源码一致）

| 问题 | 现状 | 影响 |
|------|------|------|
| 端口未透传 | `MCP_START_HELPER` 只设置 `mcpState.serverPort`，`connectNative` 不传 `--port`；Helper 进程启动时固定监听默认 `9527` | 用户改端口后 UI/Cursor/Helper 三方不一致 |
| 成功判定过弱 | 收到 Native Messaging `PONG` 即视为 `helperConnected=true`，未验证 HTTP `/mcp` 可访问 | UI 显示已启动，Cursor 连接仍 refused |
| 状态信息不足 | `MCP_GET_STATUS` 仅返回 `helperConnected`、`serverPort`、`helperError` | 用户无法区分 NM 失败 vs 端口占用 vs HTTP 未就绪 |
| 传输协议表述 | UI 文案写 `ws://localhost:9527`，Helper 实际以 Streamable HTTP + WebSocket 提供 `/mcp` | 配置误导 |

## 2. 目标与成功标准

### 2.1 目标

- 插件配置端口、Helper 实际监听端口、Cursor 应连接地址三者一致
- UI 显示「已启动」时，本地 HTTP MCP 服务经 `/health` 验证真实可连
- 失败时区分：Native Messaging、端口监听、HTTP 健康检查

### 2.2 成功标准

- 默认 `9527`：点击启动后，Cursor 配置 `http://127.0.0.1:9527/mcp` 可连接
- 自定义端口：Helper 实际监听该端口，UI 显示同一端口
- Native Host 不可用时：UI 明确报错（非静默「未启动」）
- 端口被占用：UI 不显示「已启动」，显示监听失败原因
- `/health` 失败：UI 不显示「已启动」
- 停止后：Cursor 再连接应失败，UI 显示未启动

### 2.3 范围边界（YAGNI）

**包含：**

- `START_SERVER` / `SERVER_STARTED` / `SERVER_START_FAILED` 控制消息
- `GET /health` 健康检查
- `background.js` 三阶段启动 + 短重试健康检查
- `mcp-ui.js` 状态栏分层展示
- `MCP_GET_STATUS` 扩展字段

**不包含（后续迭代）：**

- 工具命名/Schema 质量门禁
- 端口占用主动检测（OS 级）
- 自动重启守护、Cursor 配置一键写入
- 完整诊断工作台（方案 C）

## 3. 架构与数据流

### 3.1 启动三阶段

```text
[用户点击启动]
    │
    ▼
阶段 1: Native Messaging
    connectNative('com.aireq.mcp_helper') → PING → PONG
    helperConnected = true
    │
    ▼
阶段 2: 端口监听
    postMessage START_SERVER { port }
    ← SERVER_STARTED { port } 或 SERVER_START_FAILED { port, error }
    │
    ▼
阶段 3: HTTP 健康检查
    fetch http://127.0.0.1:{port}/health (最多 3 次短重试)
    httpReady = true
    │
    ▼
UI: MCP ● 已启动 http://127.0.0.1:{port}/mcp
syncToolsToHelper()
```

### 3.2 停止流程

```text
[用户点击停止]
    postMessage STOP_SERVER 或 SHUTDOWN
    ← SERVER_STOPPED
    清理: helperConnected, httpReady, httpError, helperPort
    UI: MCP ○ 未启动
```

### 3.3 兼容兜底

Helper 若启动后 **2 秒内** 未收到 `START_SERVER`，可按默认 `9527` 自动监听（兼容旧扩展版本）。新扩展流程以显式 `START_SERVER` 为准，不以进程启动即 listen 作为唯一路径。

## 4. Native Messaging 协议扩展

在 `extension/mcp-helper/server.mjs` `handleNMMessage` 中新增：

| 消息类型 | 方向 | 载荷 | 说明 |
|----------|------|------|------|
| `START_SERVER` | 扩展 → Helper | `{ port: number }` | 在指定端口启动 HTTP server（若已监听则先关闭再重启） |
| `SERVER_STARTED` | Helper → 扩展 | `{ port: number }` | 监听成功 |
| `SERVER_START_FAILED` | Helper → 扩展 | `{ port, error }` | 监听失败（如 EADDRINUSE） |
| `STOP_SERVER` | 扩展 → Helper | `{}` | 关闭 HTTP server，保留 stdin 循环 |
| `SERVER_STOPPED` | Helper → 扩展 | `{}` | 已关闭 |

现有消息保持不变：`PING`/`PONG`、`SYNC_TOOLS`、`CALL_REQUEST`/`CALL_RESULT`、`SHUTDOWN`。

### 4.1 Helper 内部改动要点

- 将 `server.listen(port)` 从进程顶层立即执行改为由 `START_SERVER` 触发
- 维护 `currentPort`、`httpServer` 引用；重复 `START_SERVER` 时 graceful close 后重绑
- `SERVER_START_FAILED` 需捕获 `EADDRINUSE` 等错误并返回可读 message

## 5. HTTP 健康检查

### 5.1 端点

```text
GET http://127.0.0.1:{port}/health
```

响应（200）：

```json
{
  "ok": true,
  "port": 9527,
  "tools": 12
}
```

- `tools`：`cachedTools.length`（已同步且 enabled 的工具数）
- 非 `/mcp`、非 `/health` 路径仍返回 404

### 5.2 扩展侧检查（background.js）

收到 `SERVER_STARTED` 后：

1. 间隔 `200ms` 首次请求 `/health`
2. 失败则 `500ms`、`1000ms` 再试（最多 3 次）
3. 全部失败：`httpReady=false`，`httpError='HTTP 健康检查失败: connection refused'`（或具体错误）
4. 成功：`httpReady=true`，`lastHealthAt=Date.now()`，`toolCount=resp.tools`

健康检查由 **Service Worker** 发起 `fetch('http://127.0.0.1:...')`，localhost 无 CORS 问题。

## 6. background.js 状态模型

### 6.1 mcpState 扩展

```js
var mcpState = {
  helperConnected: false,  // NM PONG 成功
  httpReady: false,        // /health 成功
  helperPort: null,
  helperError: null,       // NM 层错误
  httpError: null,         // HTTP 层错误
  lastHealthAt: 0,
  toolCount: 0,
  serverPort: 9527,        // 用户配置/实际监听端口
  // ... 现有 callLogs, tools, pendingCalls
};
```

### 6.2 MCP_GET_STATUS 响应

```js
{
  helperConnected: boolean,
  httpReady: boolean,
  serverPort: number,
  helperError: string | null,
  httpError: string | null,
  lastHealthAt: number,
  toolCount: number,
  callLogCount: number,
  mcpUrl: string  // 如 'http://127.0.0.1:9527/mcp'
}
```

### 6.3 MCP_START_HELPER 行为变更

1. 读取 `message.payload.mcpPort`，归一化（1–65535，非法则 9527）
2. `connectMcpHelper(onDone)` 收到 PONG 后发送 `START_SERVER { port }`
3. 等待 `SERVER_STARTED` / `SERVER_START_FAILED`（超时如 3s）
4. 成功则执行健康检查；**仅当 `httpReady` 为 true 时** `onDone({ ok: true })`
5. 成功后 `syncToolsToHelper()`

## 7. UI 状态展示（mcp-ui.js）

### 7.1 状态映射

| 条件 | 圆点 | 文案 |
|------|------|------|
| `!helperConnected` | 灰/红 off | `MCP ○ 未启动` + `helperError` |
| `helperConnected && !httpReady` | 黄 warning | `MCP ◐ Helper 已连接，HTTP 未就绪` + `httpError` |
| `helperConnected && httpReady` | 绿 on | `MCP ● 已启动 http://127.0.0.1:{port}/mcp` |
| 启动过程 | 黄 | `MCP ◐ 启动中…` |

停止按钮仅在 `helperConnected` 时可用；`httpReady=false` 时仍允许停止并重试。

### 7.2 文案修正

- 将现有 `ws://localhost:9527` 统一改为 `http://127.0.0.1:{port}/mcp`（与 Cursor Streamable HTTP 配置一致）
- Toast 启动失败时拼接 `helperError` 或 `httpError`

## 8. 错误处理

| 场景 | helperConnected | httpReady | 用户可见提示 |
|------|-----------------|-----------|--------------|
| 未 install Native Host | false | false | 请执行 install.mjs 并重启 Chrome |
| NM 超时（2s 无 PONG） | false | false | Native Messaging Host 未响应 |
| 端口占用 | true | false | 端口 {port} 已被占用 |
| SERVER_STARTED 但 /health 失败 | true | false | HTTP 健康检查失败 |
| 正常 | true | true | 已启动 + URL |

**原则：** 不在未通过 `/health` 时向 UI 报告「已启动」。

## 9. 涉及文件

| 文件 | 改动 |
|------|------|
| `extension/mcp-helper/server.mjs` | START/STOP_SERVER、延迟 listen、/health |
| `extension/background.js` | 三阶段启动、健康检查、mcpState、MCP_GET_STATUS |
| `extension/content/mcp-ui.js` | refreshMcpStatusBar 分层文案 |
| `MCP-USAGE-GUIDE.md` | Cursor 配置示例改为 `http://127.0.0.1:9527/mcp`（可选，文档同步） |

## 10. 测试与验收

### 10.1 手动验收

- [ ] 默认 9527：启动 → UI 绿点 → Cursor 连接成功
- [ ] 改配置端口为 9528：启动 → Helper 监听 9528 → `/health` 返回 9528
- [ ] 占用 9527 后启动：UI 显示端口占用，非「已启动」
- [ ] 未注册 Native Host：明确错误提示
- [ ] 停止后：/health 不可访问，Cursor 连接失败
- [ ] 工具同步：启动成功后 `tools/list` 数量与扩展内 enabled 工具一致

### 10.2 建议自动化（实现阶段可选）

- `server.mjs`：`START_SERVER` + `/health` 单元测试（mock stdin）
- `background.js`：端口归一化、状态机纯函数

## 11. 后续迭代（不在本次）

- 工具命名长度门禁（Cursor 60 字符限制）
- Schema/required 清洗
- 诊断面板、端口占用预检、一键复制 Cursor mcp.json

---

*设计经 Brainstorming 流程确认：范围=方案 B（配置透传 + 健康检查），成功标准=默认 9527 + 自定义端口均可诊断连通。*
