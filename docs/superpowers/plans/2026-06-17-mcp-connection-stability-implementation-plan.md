# MCP 连接稳定性快速修复实现计划

日期：2026-06-17  
来源规格：`docs/superpowers/specs/2026-06-17-mcp-connection-stability-design.md`  
目标：修复端口未透传、假启动状态与 Cursor `ERR_CONNECTION_REFUSED`，使 UI「已启动」与 HTTP `/mcp` 真实可连一致。

## 1. 实施原则

- 只改启动/停止/状态链路，不碰 MCP 工具生成、代理调用、Mock、请求采集。
- Helper 协议增量：新增消息类型，保留 `PING`/`PONG`、`SYNC_TOOLS`、`CALL_*`、`SHUTDOWN` 行为。
- 旧扩展 + 新 Helper：Helper 2 秒无 `START_SERVER` 时仍自动监听默认 `9527`。
- 新扩展 + 新 Helper：以 `START_SERVER` → `/health` 为唯一成功路径。
- 每阶段完成后可手动点「启动/停止」验证，避免一次性大改难排障。

## 2. 涉及文件

| 文件 | 职责 |
|------|------|
| `extension/mcp-helper/server.mjs` | 延迟 listen、`START_SERVER`/`STOP_SERVER`、`/health` |
| `extension/background.js` | 三阶段启动、健康检查、`mcpState`、`MCP_GET_STATUS` |
| `extension/content/mcp-ui.js` | 状态栏分层、`refreshMcpStatusBar`、启动 Toast |
| `extension/content/content.css` | 可选：warning 状态圆点样式 |
| `MCP-USAGE-GUIDE.md` | Cursor 配置 URL 文案同步（阶段 4） |

## 3. 阶段 1：Helper 可控启动与 `/health`

**目标：** Node Helper 不再进程启动即固定 `listen(9527)`，改由 Native Messaging 控制。

### 3.1 `server.mjs` 结构调整

1. 移除文件末尾立即执行的 `server.listen(port, ...)`。
2. 提取 `startHttpServer(targetPort)` / `stopHttpServer()`：
   - `startHttpServer`：`server.listen(targetPort, 'localhost', cb)`，成功 log 并 `writeNMMessage({ type: 'SERVER_STARTED', port })`。
   - 监听 `error`：`EADDRINUSE` → `SERVER_START_FAILED { port, error: '端口已被占用' }`。
   - 若已在监听且端口相同：直接回 `SERVER_STARTED`。
   - 若端口不同：先 `server.close()` 再 listen 新端口。
3. `stopHttpServer`：`server.close()`，完成后 `writeNMMessage({ type: 'SERVER_STOPPED' })`。
4. `handleNMMessage` 新增分支：
   - `START_SERVER`：读 `msg.port`，`parseInt` 校验，非法用 9527，调用 `startHttpServer`。
   - `STOP_SERVER`：调用 `stopHttpServer`（不 `process.exit`，保留 stdin）。
5. 兼容兜底：`listenStdin` 开始后 `setTimeout(2000, () => { if (!listening) startHttpServer(9527) })`。
6. CLI `--port` 仍可用：若 argv 带 `--port`，在兜底 timer 之前用该端口（可选，低优先级）。

### 3.2 `/health` 路由

在 `handleHTTPRequest` 开头增加：

```js
if (new URL(req.url, 'http://127.0.0.1').pathname === '/health') {
  if (req.method !== 'GET') { 405; return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, port: currentPort, tools: cachedTools.length }));
  return;
}
```

### 3.3 验收

- [ ] 手动 `node server.mjs`，stdin 发 `START_SERVER {"port":9528}` → 日志显示 9528，`curl http://127.0.0.1:9528/health` 返回 JSON。
- [ ] 重复 `START_SERVER` 同端口不报错。
- [ ] 占用端口时收到 `SERVER_START_FAILED`。
- [ ] `STOP_SERVER` 后 `/health` 不可访问。

## 4. 阶段 2：background 三阶段启动

**目标：** 扩展侧 orchestration 与 Helper 新协议对齐。

### 4.1 扩展 `mcpState`

```js
httpReady: false,
httpError: null,
lastHealthAt: 0,
toolCount: 0,
serverStarting: false,  // 可选，供 UI「启动中」
pendingStartPort: null    // 等待 SERVER_STARTED 的端口
```

### 4.2 端口归一化

新增纯函数 `normalizeMcpPort(n)`：整数 1–65535，否则 9527。

### 4.3 改造 `connectMcpHelper(onDone, options)`

`options.port` 来自 `MCP_START_HELPER`。

流程：

1. `disconnectMcpHelper()`，重置 `httpReady`/`httpError`。
2. `connectNative` → `PING`。
3. 收到 `PONG`：`helperConnected = true`，**不立即** `finish({ ok: true })`。
4. `postMessage({ type: 'START_SERVER', port: normalizedPort })`。
5. `onMessage` 处理 `SERVER_STARTED` / `SERVER_START_FAILED`：
   - `SERVER_START_FAILED`：`helperError = msg.error`，`finish({ ok: false, error })`。
   - `SERVER_STARTED`：`mcpState.serverPort = msg.port`，进入健康检查（见 4.4）。
6. `START_SERVER` 超时 3s：视为失败，`disconnectMcpHelper()`，`finish({ ok: false, error: '启动 HTTP 服务超时' })`。

### 4.4 健康检查 `probeMcpHealth(port)`

```js
var delays = [200, 500, 1000];
// 依次 fetch http://127.0.0.1:{port}/health
// 成功：httpReady=true, toolCount=data.tools, lastHealthAt=Date.now()
// 失败：httpError=..., finish({ ok: false }) 但 helperConnected 可能仍为 true
// 全部成功后才 finish({ ok: true, connected: true, serverPort, httpReady: true })
// 然后 syncToolsToHelper()
```

### 4.5 `MCP_START_HELPER` 入口

```js
var cfgPort = normalizeMcpPort(message.payload && message.payload.mcpPort);
connectMcpHelper(function (result) { sendResponse(result); }, { port: cfgPort });
```

`sendResponse` 的 `ok: true` **仅当** `httpReady === true`。

### 4.6 `disconnectMcpHelper` / `MCP_STOP_HELPER`

- 若 `helperPort` 存在：先发 `STOP_SERVER`，短等 `SERVER_STOPPED`（或超时继续）。
- 再发 `SHUTDOWN` 或 `disconnect`。
- 清空 `httpReady`、`httpError`、`serverPort`（或保留 last error 供 UI 一次展示，实现时二选一，建议清空）。

### 4.7 `MCP_GET_STATUS`

返回 spec 中全部字段 + `mcpUrl: 'http://127.0.0.1:' + serverPort + '/mcp'`。

### 4.8 验收

- [ ] 插件点启动，仅 PONG 无 `SERVER_STARTED` 时 UI 不显示已启动。
- [ ] 配置 9528，Helper 监听 9528，`MCP_GET_STATUS.serverPort === 9528`。
- [ ] `/health` 失败时 `ok: false`，`httpError` 有值。

## 5. 阶段 3：UI 状态分层

**目标：** 用户可见状态与 `MCP_GET_STATUS` 一致。

### 5.1 `refreshMcpStatusBar(mcpContent)`

按优先级渲染：

| 条件 | class | 文案 |
|------|-------|------|
| `serverStarting` 或启动按钮刚点击 | `dot-warn` | `MCP ◐ 启动中…` |
| `!helperConnected` | `dot-off` | `MCP ○ 未启动` + helperError |
| `helperConnected && !httpReady` | `dot-warn` | `MCP ◐ Helper 已连接，HTTP 未就绪` + httpError |
| `helperConnected && httpReady` | `dot-on` | `MCP ● 已启动 http://127.0.0.1:{port}/mcp` |

### 5.2 启动按钮

- 点击启动：立即显示「启动中」，禁用连点。
- `resp.ok === false`：Toast `MCP 启动失败: {error || httpError || helperError}`。
- 成功：恢复「停止」按钮。

### 5.3 文案替换

全局搜索 `ws://localhost`，改为 `http://127.0.0.1:{port}/mcp`（`mcp-ui.js` 内 status bar 至少 3 处）。

### 5.4 CSS（可选）

```css
.ai-req-mcp-status-dot-warn { background: #f59e0b; }
```

### 5.5 验收

- [ ] 三种状态视觉可区分。
- [ ] 失败 Toast 含可读原因。
- [ ] 不再出现 `ws://` 误导文案。

## 6. 阶段 4：文档与端到端回归

### 6.1 更新 `MCP-USAGE-GUIDE.md`

- Cursor 配置示例改为 Streamable HTTP：`http://127.0.0.1:9527/mcp`。
- 说明：改端口后需同步改 Cursor 配置与插件设置。
- 故障排查增加：UI 显示「HTTP 未就绪」时的检查项。

### 6.2 端到端清单（与 spec §10 一致）

- [ ] 默认 9527 + Cursor 连接成功
- [ ] 自定义端口 9528
- [ ] 端口占用提示
- [ ] 停止后 Cursor 失败
- [ ] `tools/list` 与扩展 enabled 工具数一致

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| SW 休眠导致启动中断 | 启动流程集中在一次 `MCP_START_HELPER` 调用链内，避免长 await 无响应 |
| 旧 Helper 无 `START_SERVER` | 2 秒兜底 listen 9527；扩展仍发 `START_SERVER`，旧 Helper 忽略则靠兜底 |
| `server.close` 竞态 | `START_SERVER` 串行处理，close 完成后再 listen |
| 用户未重装 Native Host | 错误文案指向 `node install.mjs` + 重启 Chrome |

回滚：Revert 三文件改动；Helper 恢复立即 `listen(9527)` 的旧行为。

## 8. 建议提交顺序

1. `server.mjs`（Helper 可独立手动测）
2. `background.js`
3. `mcp-ui.js` + CSS
4. `MCP-USAGE-GUIDE.md`

每步一次 commit，便于 bisect。

## 9. 不在本次实现

- 工具命名/Schema 质量
- 端口占用 OS 级预检
- 自动重连守护
- Cursor mcp.json 一键写入
