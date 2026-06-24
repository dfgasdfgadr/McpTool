# 系统级 MCP Brainstorm 工具设计

日期：2026-06-22  
状态：设计稿（brainstorm 已确认）  
范围：新增系统级 MCP，用自然语言生成 MCP 草案，并在用户确认后创建 MCP 工具  
依赖规格：
- `docs/superpowers/specs/2026-06-22-flow-toolset-context-design.md`
- `docs/superpowers/specs/2026-06-22-mcp-flow-management-design.md`

## 1. 背景

当前扩展已支持两类 MCP 工具：

1. **普通 MCP 工具**：由录制请求或用户配置生成，写入 `ai_req_mcp_tools_{hostname}`。
2. **系统级 MCP 工具**：由扩展固定提供，例如 `list_recorded_flows`、`get_recorded_flow_context`，用于向 AI 暴露流程上下文。

用户希望再增加一个系统级 MCP，使 AI 可以通过 `/brainstorming` 类对话先设计新的 MCP 工具草案，并在用户明确确认后直接创建 MCP 工具。

## 2. 已确认的产品决策

| 决策项 | 选择 |
|--------|------|
| 工具性质 | 系统级 MCP |
| 输入方式 | 自然语言需求为主 |
| 草案输出 | 机器可复制 JSON |
| 创建行为 | 两阶段：先草案，用户确认后再创建；支持单个或批量创建 |
| 用户确认表达 | 用户在对话中确认，AI 再次调用同一系统 MCP 并传 `confirmCreate: true` |
| 本期范围 | 创建基础 MCP 定义；不绑定真实 HTTP 请求执行模板 |

## 3. 目标

1. 新增系统 MCP：`brainstorm_mcp_tool`。
2. 当未传 `confirmCreate: true` 时，只生成 MCP 工具草案，不写入 storage。
3. 用户确认后，AI 再次调用该 MCP，并传入完整 `draftJson` 或 `drafts[]` 与 `targetHost`。
4. 系统校验通过后写入 `ai_req_mcp_tools_{targetHost}` 并触发 `MCP_SYNC_TOOLS`；批量创建采用部分成功策略。
5. 创建结果可在 MCP 工具列表中立即看到，并同步给 Cursor MCP helper。
6. 每个 MCP 工具详情提供快捷复制提示词按钮，便于用户把工具调用建议复制给 AI。

## 4. 非目标

- 不在本期实现自动绑定真实 HTTP 请求。
- 不根据自然语言自动推断接口 method/path/body 模板并保证可执行。
- 不提供扩展 UI 中的 pending draft 确认按钮。
- 不允许未经用户确认直接落库。
- 不覆盖已有同名 MCP 工具。

## 5. 系统 MCP 行为

### 5.1 工具名

```text
brainstorm_mcp_tool
```

### 5.2 阶段 1：生成草案

调用参数：

```json
{
  "intent": "新增一个查询商品列表的 MCP",
  "targetHost": "localhost",
  "preferredRiskLevel": "low"
}
```

参数说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `intent` | 是 | 用户自然语言需求 |
| `targetHost` | 否 | 目标站点。草案阶段可缺省；创建阶段必填 |
| `preferredRiskLevel` | 否 | `low`、`medium`、`high` |
| `confirmCreate` | 否 | 未传或非 `true` 时只生成草案 |
| `draftJson` | 否 | 创建单个工具时传入完整草案 |
| `drafts` | 否 | 创建多个工具时传入完整草案数组 |

返回：

```json
{
  "ok": true,
  "mode": "draft",
  "draftJson": {
    "name": "",
    "description": "",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": []
    },
    "riskLevel": "low",
    "implementationNotes": "",
    "questions": []
  },
  "namingRules": [
    "name 只能包含 a-z、A-Z、0-9 和下划线",
    "建议用动词开头，例如 get_product_list"
  ],
  "schemaRules": [
    "inputSchema.type 必须是 object",
    "properties 只描述用户需要填写的参数",
    "required 只包含真正必填字段"
  ],
  "riskRules": [
    "只读查询默认 low",
    "修改、提交、删除类操作至少 medium",
    "支付、审批、批量删除等高影响操作为 high"
  ],
  "validationRules": [
    "创建前必须获得用户明确确认",
    "创建前必须提供 targetHost",
    "创建前必须检查同名冲突",
    "批量创建可传 drafts[]；有效项会创建，失败项会逐条返回错误"
  ],
  "nextStep": "请根据 intent 填充 draftJson 或 drafts[]，展示给用户确认；用户确认后再以 confirmCreate=true 调用本工具。"
}
```

### 5.3 阶段 2：确认创建

调用参数：

```json
{
  "targetHost": "localhost",
  "confirmCreate": true,
  "draftJson": {
    "name": "get_product_list",
    "description": "查询商品列表。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "keyword": {
          "type": "string",
          "description": "商品关键词"
        }
      },
      "required": []
    },
    "riskLevel": "low",
    "implementationNotes": "后续可绑定商品列表接口。"
  }
}
```

校验通过后返回：

```json
{
  "ok": true,
  "mode": "created",
  "createdToolName": "get_product_list",
  "targetHost": "localhost",
  "message": "已创建 MCP 工具并同步。"
}
```

批量创建参数：

```json
{
  "targetHost": "localhost",
  "confirmCreate": true,
  "drafts": [
    {
      "name": "get_product_list",
      "description": "查询商品列表。",
      "inputSchema": { "type": "object", "properties": {}, "required": [] },
      "riskLevel": "low"
    },
    {
      "name": "get_product_detail",
      "description": "查询商品详情。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "description": "商品 ID" }
        },
        "required": ["id"]
      },
      "riskLevel": "low"
    }
  ]
}
```

批量创建采用部分成功策略；有效项写入 storage，失败项返回明细：

```json
{
  "ok": true,
  "mode": "batch_created",
  "createdToolNames": ["get_product_list"],
  "createdCount": 1,
  "failed": [
    {
      "index": 1,
      "name": "get_product_detail",
      "errorCode": "TOOL_NAME_CONFLICT",
      "message": "目标站点已存在同名工具: get_product_detail"
    }
  ],
  "failedCount": 1,
  "partial": true,
  "targetHost": "localhost"
}
```

## 6. 落库结构

写入 `ai_req_mcp_tools_{targetHost}`：

```js
{
  name: "get_product_list",
  description: "查询商品列表。",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  },
  enabled: true,
  _meta: {
    source: "system_brainstorm",
    riskLevel: "low",
    createdAt: 1782100000000,
    hostname: "localhost",
    systemCreated: true,
    implementationNotes: "后续可绑定商品列表接口。"
  }
}
```

该工具本期是“设计型 MCP 定义”。如果缺少 `method`、`pathname`、请求模板等执行信息，后续调用时应由现有 MCP 执行层返回清晰错误或引导用户继续绑定接口。

## 7. 安全边界

1. `confirmCreate !== true` 时，绝不写 storage。
2. `confirmCreate: true` 时必须提供完整 `draftJson`。
3. 创建阶段 `targetHost` 必填，不从当前页面或 intent 中猜测。
4. 不允许覆盖已有工具名。
5. `name` 只允许 `[a-zA-Z0-9_]`。
6. `inputSchema.type` 必须是 `object`。
7. `riskLevel` 只能是 `low`、`medium`、`high`。
8. 创建完成后必须触发 `MCP_SYNC_TOOLS`。

## 8. 架构改动

### 8.1 `extension/background-flow-context.js`

新增常量：

```js
var BRAINSTORM_MCP_TOOL = 'brainstorm_mcp_tool';
```

改动：

- `isFlowContextSystemTool()` 纳入 `brainstorm_mcp_tool`。
- `buildFlowContextSystemToolDefinitions()` 增加系统工具定义。
- `parseExtensionConfigFromItems()` 支持 `enableBrainstormMcpTool`，默认开启。
- `executeFlowContextSystemTool()` 分发到 `handleBrainstormMcpTool()`。
- 新增 `handleBrainstormMcpTool(args, items)`。

### 8.2 `extension/background.js`

现有系统工具执行入口已经通过 `isFlowContextSystemTool(toolName)` 分流；新增工具纳入后复用现有路径。

创建阶段需要在 background 内完成：

1. 读取 `ai_req_mcp_tools_{targetHost}`。
2. 校验冲突。
3. 写入新工具。
4. 调用现有 MCP 同步逻辑或发送 `MCP_SYNC_TOOLS` 等价路径。

### 8.3 `extension/content/mcp-ui.js`

系统工具组自动展示该工具。`isFlowContextSystemToolName()` 需要纳入 `brainstorm_mcp_tool`，确保它不可移动、不可删除。

### 8.4 设置页

本期默认开启，可选增加设置项：

```js
enableBrainstormMcpTool: true
```

若本期不改设置 UI，也应保证配置缺省为开启。

## 9. 错误处理

| 场景 | `errorCode` |
|------|-------------|
| 草案阶段缺少 `intent` | `INTENT_REQUIRED` |
| 创建阶段缺少 `draftJson` | `DRAFT_REQUIRED` |
| 创建阶段缺少 `targetHost` | `TARGET_HOST_REQUIRED` |
| 工具名为空或非法 | `INVALID_TOOL_NAME` |
| `inputSchema` 非 object schema | `INVALID_INPUT_SCHEMA` |
| `riskLevel` 非法 | `INVALID_RISK_LEVEL` |
| 工具名已存在 | `TOOL_NAME_CONFLICT` |
| storage 写入异常 | `CREATE_TOOL_FAILED` |

错误返回统一结构：

```json
{
  "ok": false,
  "errorCode": "INVALID_TOOL_NAME",
  "message": "工具名只能包含字母、数字和下划线。"
}
```

## 10. 测试清单

1. `brainstorm_mcp_tool({ intent })` 返回草案，不写入 storage。
2. 草案阶段缺少 `intent` 返回 `INTENT_REQUIRED`。
3. 用户确认后调用 `confirmCreate: true`，工具写入 `ai_req_mcp_tools_{targetHost}`。
4. 创建后触发 MCP 同步，Cursor 工具列表可见。
5. 重名创建返回 `TOOL_NAME_CONFLICT`。
6. 非法 `name`、`inputSchema`、`riskLevel` 分别被拒绝。
7. 缺少 `targetHost` 被拒绝。
8. `brainstorm_mcp_tool` 显示在系统工具组，不可移动、不可删除。
9. 已有 `list_recorded_flows` 与 `get_recorded_flow_context` 不受影响。

## 11. 后续扩展

- 增加 `validate_mcp_tool_draft` 独立校验工具。
- 增加扩展 UI 的 pending draft 列表和确认按钮。
- 支持从 Flow / request / existing tool 派生草案。
- 支持将草案绑定到真实 HTTP 请求模板。

## 12. Brainstorm 决策记录

- 2026-06-22：选择“先草案，用户确认后创建”。
- 2026-06-22：输入以自然语言需求为主。
- 2026-06-22：草案输出采用机器可复制 JSON。
- 2026-06-22：用户确认通过对话表达，AI 二次调用并传 `confirmCreate: true`。

---

**状态**：待用户 review spec  
**下一步**：用户确认 spec 后编写 implementation plan
