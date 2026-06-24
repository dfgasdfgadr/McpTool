# 系统级 MCP Brainstorm 工具实施计划

日期：2026-06-22  
来源规格：`docs/superpowers/specs/2026-06-22-system-mcp-brainstorm-tool-design.md`  
目标：新增 `brainstorm_mcp_tool` 系统级 MCP，支持自然语言生成 MCP 草案，并在用户确认后创建 MCP 工具。

## 1. 实施原则

- 两阶段安全创建：未传 `confirmCreate: true` 时绝不写 storage。
- 创建阶段只接受完整 `draftJson` 或 `drafts[]`，不从自然语言里直接落库。
- 批量创建采用部分成功策略：有效项创建，失败项逐条返回错误。
- 创建的是基础 MCP 定义，本期不绑定真实 HTTP 请求执行模板。
- 不覆盖已有工具名；所有校验失败都返回结构化 `errorCode`。
- 复用现有系统 MCP 注入与调用路径，避免新建并行机制。

## 2. 当前代码边界

| 文件 | 当前职责 | 本计划改动 |
|------|----------|------------|
| `extension/background-flow-context.js` | 定义/执行 `list_recorded_flows`、`get_recorded_flow_context` | 增加 `brainstorm_mcp_tool` 定义、参数 schema、草案/创建处理、校验 helper |
| `extension/background.js` | 注入系统工具、拦截系统工具调用、同步 helper | 复用现有 `isFlowContextSystemTool()` 与 `executeFlowContextSystemTool()`；确认创建后触发 sync |
| `extension/content/mcp-ui.js` | 判断系统工具名称，系统工具不可移动/删除 | `isFlowContextSystemToolName()` 纳入 `brainstorm_mcp_tool`；工具详情增加复制提示词按钮 |
| `extension/content/flow-membership.js` | 流程树分组识别系统工具 | 依赖 `isFlowContextSystemToolName()` 自动生效 |
| `extension/content/ui-core.js` | 设置页系统工具开关 | 可选新增 `enableBrainstormMcpTool` 开关；若不做 UI，默认开启 |

## 3. Phase 1：系统工具注册

目标：`brainstorm_mcp_tool` 出现在系统工具列表，且被系统工具调用路径识别。

### 3.1 修改 `background-flow-context.js`

新增常量：

```js
var BRAINSTORM_MCP_TOOL = 'brainstorm_mcp_tool';
```

修改：

```js
function isFlowContextSystemTool(toolName) {
  return toolName === FLOW_CONTEXT_LIST_TOOL ||
    toolName === FLOW_CONTEXT_DETAIL_TOOL ||
    toolName === BRAINSTORM_MCP_TOOL;
}
```

`parseExtensionConfigFromItems()` 增加：

```js
enableBrainstormMcpTool: true
```

`buildFlowContextSystemToolDefinitions(config)` 中追加工具定义：

```js
defs[BRAINSTORM_MCP_TOOL] = {
  name: BRAINSTORM_MCP_TOOL,
  description: '根据自然语言需求生成 MCP 工具草案；用户确认后可用 confirmCreate=true 创建工具。',
  inputSchema: {
    type: 'object',
    properties: {
      intent: { type: 'string' },
      targetHost: { type: 'string' },
      preferredRiskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
      confirmCreate: { type: 'boolean' },
      draftJson: { type: 'object' },
      drafts: { type: 'array', items: { type: 'object' } }
    }
  },
  enabled: true,
  _meta: { flowContextSystem: true, kind: 'brainstorm_mcp_tool' }
};
```

### 3.2 修改 `mcp-ui.js`

更新：

```js
function isFlowContextSystemToolName(name) {
  return name === 'list_recorded_flows' ||
    name === 'get_recorded_flow_context' ||
    name === 'brainstorm_mcp_tool';
}
```

验证：系统工具组出现 3 个工具，且不能被勾选、移动、删除。

## 4. Phase 2：草案生成分支

目标：调用 `brainstorm_mcp_tool({ intent })` 返回机器可复制的草案协议，不写 storage。

### 4.1 新增 `handleBrainstormMcpTool(args, items)`

分支：

```js
if (args.confirmCreate === true) return createBrainstormMcpTool(args, items);
return buildBrainstormMcpDraftProtocol(args);
```

### 4.2 `buildBrainstormMcpDraftProtocol(args)`

校验：

- `intent` 必填，非空字符串。
- `preferredRiskLevel` 若存在必须是 `low | medium | high`。

返回：

```js
{
  ok: true,
  mode: 'draft',
  draftJson: {
    name: '',
    description: '',
    inputSchema: { type: 'object', properties: {}, required: [] },
    riskLevel: args.preferredRiskLevel || 'low',
    implementationNotes: '',
    questions: []
  },
  drafts: [],
  namingRules: [...],
  schemaRules: [...],
  riskRules: [...],
  validationRules: [...],
  nextStep: '...'
}
```

### 4.3 错误

缺少 `intent`：

```js
{ ok: false, errorCode: 'INTENT_REQUIRED', message: '请提供 intent。' }
```

## 5. Phase 3：确认创建分支

目标：用户确认后，AI 二次调用并传 `confirmCreate: true`，系统校验并创建工具。

### 5.1 新增校验 helper

```js
normalizeBrainstormDraft(draftJson)
validateBrainstormDraft(draftJson)
normalizeTargetHost(targetHost)
buildBrainstormCreatedTool(draft, targetHost)
```

校验规则：

- `targetHost` 必填。
- `draftJson` 或 `drafts[]` 必填。
- `draftJson.name` 匹配 `/^[a-zA-Z0-9_]+$/`。
- `draftJson.description` 非空。
- `draftJson.inputSchema.type === 'object'`。
- `draftJson.inputSchema.properties` 是 object。
- `draftJson.inputSchema.required` 若存在必须是 array。
- `riskLevel` 只能是 `low | medium | high`。

### 5.2 写入 storage

读取：

```js
var key = 'ai_req_mcp_tools_' + targetHost;
var toolsObj = parseStoredJsonObject(items[key]) || {};
```

冲突：

```js
if (toolsObj[draft.name]) return TOOL_NAME_CONFLICT;
```

批量创建时对 `drafts[]` 逐项执行同样校验；有效项写入 `toolsObj`，失败项进入 `failed[]`。如果至少一个成功，返回 `ok: true`、`mode: "batch_created"`、`createdToolNames`、`failed`、`partial`；如果全部失败，返回 `ok: false`、`errorCode: "BATCH_CREATE_FAILED"`。

写入：

```js
toolsObj[draft.name] = {
  name: draft.name,
  description: draft.description,
  inputSchema: draft.inputSchema,
  enabled: true,
  _meta: {
    source: 'system_brainstorm',
    riskLevel: draft.riskLevel,
    createdAt: Date.now(),
    hostname: targetHost,
    systemCreated: true,
    implementationNotes: draft.implementationNotes || ''
  }
};
```

保存后触发同步：

```js
chrome.storage.local.set({ [key]: JSON.stringify(toolsObj) }, function () {
  syncToolsToHelper(...);
});
```

如果 `syncToolsToHelper` 不适合从 `background-flow-context.js` 直接调用，则让 `executeFlowContextSystemTool()` 支持异步回调，或将创建分支放在 `background.js` 的系统工具执行路径中。优先保持同步工具执行接口不大改；若必须异步，单独包一层 `executeFlowContextSystemToolAsync()`。

### 5.3 返回

```js
{
  ok: true,
  mode: 'created',
  createdToolName: draft.name,
  createdToolNames: [draft.name],
  failed: [],
  targetHost: targetHost,
  message: '已创建 MCP 工具并同步。'
}
```

批量部分成功返回：

```js
{
  ok: true,
  mode: 'batch_created',
  createdToolNames: ['get_product_list'],
  failed: [{ index: 1, name: 'get_product_detail', errorCode: 'TOOL_NAME_CONFLICT', message: '...' }],
  partial: true
}
```

## 6. Phase 4：系统工具执行路径适配

当前 `handleMcpToolCall()` 中系统工具执行是同步：

```js
var sysResult = executeFlowContextSystemTool(toolName, toolArguments, items);
```

`brainstorm_mcp_tool` 创建阶段需要写 storage，并同步 helper，属于异步操作。实施方式：

### 推荐：新增异步执行入口

```js
function executeFlowContextSystemToolAsync(toolName, toolArguments, items, callback) {
  if (toolName === BRAINSTORM_MCP_TOOL) {
    return handleBrainstormMcpToolAsync(toolArguments, items, callback);
  }
  callback(executeFlowContextSystemTool(toolName, toolArguments, items));
}
```

`background.js` 系统工具调用处改为：

```js
executeFlowContextSystemToolAsync(toolName, toolArguments, items, function (sysResult) {
  // 原 addMcpCallLog + CALL_RESULT 逻辑
});
```

这样不影响已有两个系统工具，它们仍可同步返回。

## 7. Phase 5：设置与 UI（可选）

### 7.1 配置

`parseExtensionConfigFromItems()` 默认：

```js
enableBrainstormMcpTool: true
```

本期可以不增加设置页开关；若加开关，则在 `ui-core.js` 设置页新增：

```text
暴露 brainstorm_mcp_tool
```

### 7.2 MCP 列表

`mcp-ui.js` 更新系统工具识别后，工具会自动进入「系统工具」组。

### 7.3 快捷复制提示词

工具详情面板为每个工具提供「复制提示词」按钮。复制内容包含工具名、描述、来源站点、调用入口、风险等级和参数 Schema，方便用户把单个工具的调用建议直接粘贴给 AI。

## 8. 错误处理

| 场景 | errorCode |
|------|-----------|
| 草案阶段缺少 intent | `INTENT_REQUIRED` |
| 创建阶段缺少 draftJson | `DRAFT_REQUIRED` |
| 创建阶段缺少 targetHost | `TARGET_HOST_REQUIRED` |
| 工具名非法 | `INVALID_TOOL_NAME` |
| description 为空 | `INVALID_DESCRIPTION` |
| inputSchema 非 object | `INVALID_INPUT_SCHEMA` |
| riskLevel 非法 | `INVALID_RISK_LEVEL` |
| 工具名已存在 | `TOOL_NAME_CONFLICT` |
| storage 写入失败 | `CREATE_TOOL_FAILED` |
| helper 同步失败 | 创建仍成功，返回 `synced:false` 和 `syncError` |

## 9. 验证清单

1. `MCP_GET_TOOLS_VIEW` 返回系统工具数从 2 变为 3。
2. MCP 页「系统工具」组显示 `brainstorm_mcp_tool`。
3. `brainstorm_mcp_tool({ intent })` 返回 `mode:'draft'`，storage 不新增工具。
4. 缺少 `intent` 返回 `INTENT_REQUIRED`。
5. `confirmCreate:true` 但缺少 `draftJson` 返回 `DRAFT_REQUIRED`。
6. 缺少 `targetHost` 返回 `TARGET_HOST_REQUIRED`。
7. 合法草案创建后写入 `ai_req_mcp_tools_{targetHost}`。
8. 创建后 helper 同步触发，工具列表可见新增工具。
9. `drafts[]` 批量创建时，成功项写入，失败项返回 `failed[]`。
10. 批量全部失败时返回 `BATCH_CREATE_FAILED`，不写 storage。
11. 重名创建返回 `TOOL_NAME_CONFLICT`。
12. 非法 name/schema/riskLevel 分别被拒绝。
13. 每个工具详情可复制工具调用提示词。
14. 新系统工具不可移动、不可删除。
15. `list_recorded_flows`、`get_recorded_flow_context` 仍可正常调用。

## 10. 提交建议

当前工作区已有其他未提交改动。实施时应只暂存与本功能相关文件：

```text
docs/superpowers/specs/2026-06-22-system-mcp-brainstorm-tool-design.md
docs/superpowers/plans/2026-06-22-system-mcp-brainstorm-tool-implementation-plan.md
extension/background-flow-context.js
extension/background.js
extension/content/mcp-ui.js
```

若设置页也实现开关，再加入：

```text
extension/content/ui-core.js
extension/content/state.js
```

---

**状态**：待实施
