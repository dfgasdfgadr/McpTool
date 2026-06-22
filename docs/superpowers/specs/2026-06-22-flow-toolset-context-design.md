# Flow Toolset Context Design

日期：2026-06-22
状态：设计稿
范围：Flow 录制资产、MCP 工具上下文查询、Cursor AI 工具选择辅助
非目标：自动执行整条流程、强制按步骤串行调用、AI 生成流程工具、复杂跨步骤参数映射

## 1. 背景

当前插件已经能录制 Flow，并从已验证请求生成普通 MCP 工具。每个工具内部已有 `_meta.flow`，Flow 也会记录 `mcpToolNames`。这些数据足以表达“某个业务流程包含哪些相关 MCP 工具”。

但同步给 Cursor 时，helper 会剥离 `_meta`，Cursor 只能看到普通工具列表。用户说“使用 XXX 流程”时，AI 缺少显式入口去理解这个流程对应哪组工具，只能从工具名和描述中猜测。

本设计将 Flow 从“执行脚本”定位为“业务工具集上下文”。录制步骤只帮助 AI 理解业务场景，不要求按步骤执行，也不强制串行调用。

## 2. 目标

1. 让 AI 能按录制流程名查询相关 MCP 工具。
2. 让 Flow 录制产物成为可复用的业务上下文资产。
3. 保持普通 MCP 工具调用方式不变，降低实现风险。
4. 避免每个流程生成一个新工具造成工具数量膨胀。
5. 明确告诉 AI：步骤仅供参考，应根据用户目标选择相关工具。

## 3. 用户体验

用户录制并生成「文章管理」流程后，可以在 Cursor 中说：

```text
使用“文章管理”流程查询文章列表
```

AI 应先调用：

```text
get_recorded_flow_context({ flowName: "文章管理" })
```

插件返回该流程关联的工具、参考步骤和使用建议。AI 再根据用户目标选择具体工具，例如：

```text
get_adminapi_content_article_list({ page: "1", size: "10" })
```

流程步骤不会被自动执行，只作为业务语境和工具选择参考。

## 4. 核心产品形态

新增两个固定系统级 MCP 工具：

```text
list_recorded_flows
get_recorded_flow_context
```

它们不属于某个业务接口，也不随录制流程数量增长。它们用于把本地 Flow 资产暴露为 AI 可查询的上下文。

普通业务工具继续保持现有形态，例如：

```text
get_adminapi_content_articleCategory_tree
get_adminapi_content_article_list
```

## 5. 数据模型

### 5.1 现有 Flow 继续作为事实来源

```js
{
  schemaVersion: 1,
  id: "flow_xxx",
  name: "文章管理",
  hostname: "admin.xxx.com",
  startedAt: 1782090000000,
  endedAt: 1782090030000,
  steps: [],
  verifiedRequestIds: [],
  classifications: {},
  requestMeta: {},
  manualVerificationOverrides: {},
  notes: "",
  mcpToolNames: [
    "get_adminapi_content_articleCategory_tree",
    "get_adminapi_content_article_list"
  ]
}
```

第一版不新增新的持久化 Flow 表。运行时从 `flow + mcpTools` 组装上下文视图。

### 5.2 Flow Context 运行时视图

```js
{
  id: "flow_xxx",
  name: "文章管理",
  hostname: "admin.xxx.com",
  summary: "文章管理相关流程",
  tools: [
    {
      name: "get_adminapi_content_article_list",
      description: "GET /adminapi/content/article/list",
      method: "GET",
      path: "/adminapi/content/article/list",
      riskLevel: "low",
      enabled: true,
      required: ["page", "size"],
      stepRefs: [2],
      status: "available"
    }
  ],
  referenceSteps: [
    {
      index: 1,
      title: "打开文章管理页",
      toolNames: []
    },
    {
      index: 2,
      title: "查询文章列表",
      toolNames: ["get_adminapi_content_article_list"]
    }
  ],
  guidance: "步骤仅用于理解业务语境，不要求按顺序执行。请根据用户目标选择最相关的工具。不要仅因为参考步骤出现写操作就自动调用写工具，必须以用户当前明确目标为准。"
}
```

### 5.3 工具关联维度

Flow 与工具的关联不能只依赖裸 `toolName`。第一版实现时，查找普通业务工具应使用：

```text
hostname + toolName
```

其中 `hostname` 优先取 `flow.hostname`。这样可以避免不同站点下出现同名工具时返回错误上下文。

如果后续引入稳定工具 ID，可以升级为：

```text
hostname + toolId
```

但 MVP 不要求迁移现有工具存储结构。

当 Flow 中记录的 `toolName` 在对应 `hostname` 工具库中找不到时，该工具在 Flow Context 中应以 `missing` 状态返回，而不是跨站点猜测同名工具。

### 5.4 步骤到工具的映射来源

Flow Context 中的 `referenceSteps.toolNames` 和工具的 `stepRefs` 按以下顺序组装：

1. 优先读取普通工具 `_meta.flow.steps`，其中包含 `stepIndex`、`requestId` 和 `classification`。
2. 如果 `_meta.flow.steps` 不完整，则用 `flow.steps[].requestIds` 与 `flow.verifiedRequestIds` 交集推断步骤归属。
3. 如果仍无法映射，则工具保留在 `tools` 列表中，但不挂到具体 `referenceSteps`。

步骤映射失败不应影响 Flow Context 返回。AI 仍可使用工具列表，步骤只降级为参考文本。

## 6. MCP 系统工具

### 6.1 `list_recorded_flows`

用途：列出当前已录制流程及其关联工具数量。适合用户未明确流程名，或 AI 需要了解有哪些流程可用时调用。

入参：

```json
{}
```

返回：

```json
{
  "ok": true,
  "flows": [
    {
      "id": "flow_xxx",
      "name": "文章管理",
      "hostname": "admin.xxx.com",
      "toolCount": 2,
      "stepCount": 3,
      "updatedAt": 1782090030000
    }
  ]
}
```

工具描述建议：

```text
列出当前已录制的业务流程及其关联 MCP 工具数量。当用户未明确流程名，或需要查看有哪些流程可用时调用。
```

### 6.2 `get_recorded_flow_context`

用途：根据流程名称或 ID 返回该流程的相关工具集、参考步骤和使用建议。

入参：

```json
{
  "flowName": "文章管理",
  "flowId": ""
}
```

匹配规则：

1. `flowId` 存在时优先精确匹配。
2. 无 `flowId` 时按 `flowName` 精确匹配，忽略前后空格和英文大小写。
3. 精确匹配失败时做名称包含匹配。
4. 包含匹配命中多个时返回候选，不自动选择。

成功返回：

```json
{
  "ok": true,
  "flow": {
    "schemaVersion": 1,
    "id": "flow_xxx",
    "name": "文章管理",
    "hostname": "admin.xxx.com",
    "summary": "文章管理相关流程",
    "tools": [],
    "referenceSteps": [],
    "guidance": "步骤仅用于理解业务语境，不要求按顺序执行。请根据用户目标选择最相关的工具。不要仅因为参考步骤出现写操作就自动调用写工具，必须以用户当前明确目标为准。"
  }
}
```

多个匹配返回：

```json
{
  "ok": false,
  "errorCode": "AMBIGUOUS_FLOW_NAME",
  "message": "找到多个名称相近的流程，请指定 flowId。",
  "candidates": [
    { "id": "flow_1", "name": "文章管理" },
    { "id": "flow_2", "name": "文章管理-编辑" }
  ]
}
```

工具描述建议：

```text
根据录制流程名称或 ID 查询该流程相关的 MCP 工具集、参考步骤和使用建议。当用户说“使用/按照/基于 XXX 流程”或提到某个已录制业务流程时，应先调用本工具获取上下文。返回的步骤仅用于理解业务语境，不要求按顺序执行。
```

## 7. MCP 同步方式

普通业务工具继续按现有方式从 `chrome.storage.local` 合并并同步给 helper。

系统级流程工具由同步链路按配置追加：

```text
普通工具列表
+ list_recorded_flows
+ get_recorded_flow_context
→ helper cachedTools
→ Cursor tools/list
```

系统工具不保存到每个站点的工具库中，避免导入、删除、去重、合并等普通工具操作影响系统能力。

设置页关闭任一系统工具后，background 必须立即触发 `MCP_SYNC_TOOLS`。helper 重新生成 `cachedTools` 时应按配置过滤系统工具，并广播 `notifications/tools/list_changed`。如果 Cursor 仍显示旧列表，应提示用户刷新 MCP 服务器；这是 Cursor 客户端缓存行为，不由系统工具本身解决。

调用链路：

```text
Cursor tools/call
→ helper 收到 system tool 调用
→ native messaging 转发给 background
→ background 从 storage 读取 flows 和 mcp tools
→ 组装 Flow Context
→ 返回 Cursor
```

系统工具不发业务请求，只读取插件本地录制数据。

## 8. UI 交互

### 8.1 Flow 页

Flow 详情增加“流程工具集”区域：

```text
流程工具集
- 已关联工具数：2
- 最近同步状态：已同步到 MCP
- 操作：
  - 查看流程上下文
  - 同步到 MCP
  - 复制 AI 使用提示
```

“查看流程上下文”展示 AI 将看到的内容，包括工具清单、参考步骤和 guidance。

### 8.2 MCP 工具页

新增分组方式：

```text
按流程
```

规则：

- 有 `_meta.flow.flowName` 的普通工具按流程名分组。
- 没有流程归属的工具进入“未归属流程”。
- `list_recorded_flows` 和 `get_recorded_flow_context` 标记为“系统工具”。

工具详情继续展示：

- 所属流程
- 来源步骤
- 同流程其它工具
- 工具启用状态

### 8.3 设置页

新增开关：

```text
MCP 流程上下文工具
[x] 暴露 list_recorded_flows
[x] 暴露 get_recorded_flow_context
```

默认开启。关闭后，系统工具不出现在 Cursor 的 `tools/list` 中。

## 9. 错误处理

### 9.1 无流程

```json
{
  "ok": true,
  "flows": [],
  "message": "暂无已录制流程。请先在扩展 Flow 页录制并生成 MCP 工具。"
}
```

### 9.2 流程未生成 MCP 工具

```json
{
  "ok": true,
  "flow": {
    "name": "文章管理",
    "tools": [],
    "warnings": [
      "该流程尚未生成 MCP 工具，AI 只能参考步骤，不能直接调用相关接口。"
    ]
  }
}
```

### 9.3 流程名不明确

返回 `AMBIGUOUS_FLOW_NAME` 和候选列表，AI 应让用户确认更准确的流程名或 `flowId`。

### 9.4 工具缺失

Flow 中存在工具名，但工具库里找不到时：

```json
{
  "name": "get_xxx",
  "status": "missing",
  "warning": "该工具已被删除或未同步。"
}
```

### 9.5 工具禁用

```json
{
  "name": "get_xxx",
  "enabled": false,
  "status": "disabled",
  "warning": "该工具当前未暴露给 MCP 客户端。"
}
```

### 9.6 系统链路失败

系统工具调用不发业务请求，但仍可能遇到本地链路错误：

- background 读取 storage 失败
- helper 与扩展未连接
- helper 版本不支持系统工具
- 工具 schema 或参数无效

统一返回：

```json
{
  "ok": false,
  "errorCode": "FLOW_CONTEXT_SYSTEM_ERROR",
  "message": "无法读取录制流程上下文，请确认扩展和 MCP helper 已连接并重新同步。",
  "detail": "可选调试信息"
}
```

这类错误不应被包装成业务接口失败，便于 AI 和用户区分“流程上下文不可用”和“业务接口调用失败”。

## 10. 安全与边界

1. 系统工具只读本地插件数据，不发起业务请求。
2. Flow 步骤不作为自动执行计划，避免误触写操作。
3. 不生成 `run_flow_*`，避免 AI 将流程理解为可直接执行的操作。
4. 高风险普通业务工具仍按已有工具风险标记展示。
5. 系统工具返回禁用工具信息时，应明确提醒 AI 该工具不可直接调用。

## 11. 验收标准

1. 录制流程并生成 MCP 工具后，Flow 中能记录关联工具名。
2. `list_recorded_flows` 能返回已录制流程列表。
3. `get_recorded_flow_context({ flowName })` 能返回该流程相关工具与参考步骤。
4. 用户说“使用 XXX 流程”时，AI 能先调用 `get_recorded_flow_context`，再选择具体业务工具。
5. 返回内容明确说明步骤仅供参考，不要求按顺序执行，并提醒不要在用户未明确要求时自动调用写工具。
6. 流程名重名、无流程、无工具、工具缺失、工具禁用均有可解释返回。
7. 同名工具跨站点存在时，Flow Context 只返回 `flow.hostname` 下的匹配工具。
8. MCP 工具页支持按流程分组。
9. 系统工具可通过设置页开关控制是否暴露，关闭后重新同步并从 helper 工具列表中移除。
10. `get_recorded_flow_context` 的 description 明确指导：当用户说“使用/按照/基于 XXX 流程”时应先查询流程上下文。该项通过人工场景或集成测试验证，不作为模型行为的绝对保证。

## 12. 实施阶段

### Phase 1：流程上下文基础闭环

- 组装 Flow Context。
- 增加 `list_recorded_flows`。
- 增加 `get_recorded_flow_context`。
- background 支持系统工具调用。
- helper 同步时追加系统工具。
- 系统工具 description 写清 AI 使用规则。

### Phase 2：扩展 UI 可视化

- MCP 页增加按流程分组。
- Flow 页显示流程工具集。
- 工具详情显示来源流程和同流程工具。
- 设置页增加系统工具开关。

### Phase 3：质量增强

- 优化流程名模糊匹配。
- 增加缺失工具修复提示。
- 增加一键重新生成该流程 MCP 工具。
- 可选增加 AI 生成流程 summary 和适用场景。

## 13. 设计结论

本方案不把 Flow 变成自动执行脚本，而是把 Flow 录制结果沉淀为 AI 可查询的业务工具集上下文。

最终闭环是：

```text
录制流程
→ 生成普通 MCP 工具
→ Flow 记录相关工具名
→ Cursor 调用 get_recorded_flow_context
→ AI 获取流程工具集和参考步骤
→ AI 根据用户目标选择具体工具
```

这样可以满足“按录制名称分组，并在用户说使用某流程时让 AI 知道该用哪些相关工具”的目标，同时保持执行安全和工具数量稳定。
