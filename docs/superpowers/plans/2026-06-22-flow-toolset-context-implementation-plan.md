# Flow Toolset Context 实施计划

日期：2026-06-22
来源规格：`docs/superpowers/specs/2026-06-22-flow-toolset-context-design.md`
第一版目标：把已录制 Flow 暴露为 AI 可查询的流程工具集上下文，让 Cursor 在用户说“使用 XXX 流程”时能先查询该流程关联工具，再按用户目标选择具体 MCP 工具。步骤仅作参考，不自动执行。

## 1. 实施原则

- 不生成 `run_flow_*`，不自动执行整条流程。
- 不改普通业务工具调用链路，优先复用现有 `handleMcpToolCall` 与工具存储结构。
- 系统工具固定为 `list_recorded_flows` 和 `get_recorded_flow_context`，不随流程数量增长。
- Flow 与工具查找使用 `hostname + toolName`，避免跨站点同名工具误匹配。
- `_meta` 仍可在同步给 Cursor 的普通工具中剥离，但系统工具必须能从本地 storage 读取 `_meta` 组装上下文。
- 每个阶段完成后，插件应仍能加载，已有 MCP 工具应仍能正常同步和调用。

## 2. 当前代码边界

主要涉及文件：

- `extension/content/state.js`
  - 增加流程上下文系统工具开关配置的默认值。
- `extension/content/mcp-engine.js`
  - 增加 Flow Context 组装逻辑。
  - 增加流程匹配、步骤到工具映射、工具状态计算。
- `extension/background.js`
  - 在 MCP 同步时追加系统工具定义。
  - 在 MCP 工具调用时识别系统工具并返回 Flow Context。
- `extension/mcp-helper/server.mjs`
  - 保持 `tools/list` 与 `tools/call` 协议稳定。
  - 确认系统工具同步与 `tools/list_changed` 通知正常。
- `extension/content/mcp-ui.js`
  - MCP 工具页增加“按流程”分组。
  - 工具详情显示同流程工具与系统工具标识。
- `extension/content/ui-core.js`
  - Flow 页显示“流程工具集”区域。
  - 设置页增加系统工具暴露开关。
- `extension/content/content.css`
  - 为流程工具集、系统工具标识、按流程分组补样式。

## 3. Phase 1：系统工具与 Flow Context 基础闭环

目标：Cursor 能看到并调用 `list_recorded_flows` / `get_recorded_flow_context`，返回正确的本地流程上下文。

### 3.1 定义系统工具常量

位置建议：`extension/background.js` 或新增小模块后由 background 使用。

新增两个工具定义：

```js
list_recorded_flows
get_recorded_flow_context
```

要求：

- `name` 不超过 Cursor 工具名限制。
- `description` 明确指导 AI：
  - 用户说“使用/按照/基于 XXX 流程”时先调用 `get_recorded_flow_context`。
  - 步骤仅作参考，不要求按顺序执行。
- `inputSchema` 简洁稳定。

`list_recorded_flows` schema：

```js
{
  type: "object",
  properties: {}
}
```

`get_recorded_flow_context` schema：

```js
{
  type: "object",
  properties: {
    flowName: { type: "string" },
    flowId: { type: "string" }
  }
}
```

### 3.2 系统工具同步

修改 `syncToolsToHelper` 附近逻辑：

1. 合并普通业务工具。
2. 根据配置决定是否追加系统工具。
3. 计算 enabled 工具数量时包含系统工具。
4. 向 helper 发送完整工具对象。
5. 继续广播 `notifications/tools/list_changed`。

注意：

- 系统工具不写入 `ai_req_mcp_tools_<hostname>`。
- 系统工具不参与导入、导出、合并、删除重复。
- 设置关闭后，重新同步并从 helper `cachedTools` 中移除。

### 3.3 系统工具调用分流

在 `handleMcpToolCall(callId, toolName, toolArguments)` 的开头增加判断：

```text
if toolName is system tool:
  handleFlowContextSystemTool(callId, toolName, args)
  return
```

系统工具只读 storage，不走 `findBestTabForProxy`，不发业务请求。

返回结果仍通过：

```text
mcpState.helperPort.postMessage({ type: "CALL_RESULT", callId, result })
```

### 3.4 读取 Flow 与工具库

实现一个只读组装入口：

```js
buildRecordedFlowDataset(items)
```

输入：`chrome.storage.local.get(null)` 返回的所有 items。

职责：

- 找出所有 `ai_req_flows_<hostname>`。
- 找出所有 `ai_req_mcp_tools_<hostname>`。
- 解析失败时返回 `FLOW_CONTEXT_SYSTEM_ERROR`。
- 保留 hostname 维度。

### 3.5 `list_recorded_flows` 返回

规则：

- 遍历所有 hostname 下的 flows。
- 按 `endedAt || startedAt` 倒序。
- 每个流程返回：
  - `id`
  - `name`
  - `hostname`
  - `toolCount`
  - `stepCount`
  - `updatedAt`

无流程时返回空数组和提示文案。

### 3.6 `get_recorded_flow_context` 匹配规则

实现顺序：

1. `flowId` 精确匹配。
2. `flowName` 精确匹配，忽略前后空格与英文大小写。
3. `flowName` 包含匹配。
4. 多个命中返回 `AMBIGUOUS_FLOW_NAME`。
5. 未命中返回 `FLOW_NOT_FOUND`。

### 3.7 Flow Context 组装

对命中的 flow：

- 使用 `flow.hostname` 找对应工具库。
- 对 `flow.mcpToolNames` 逐个查找 `toolsObj[toolName]`。
- 找不到时返回 `status: "missing"`。
- 找到但 `enabled === false` 时返回 `status: "disabled"`。
- 找到且启用时返回 `status: "available"`。

工具字段：

- `name`
- `description`
- `method`
- `path`
- `riskLevel`
- `enabled`
- `required`
- `stepRefs`
- `status`
- `warning`

`referenceSteps.toolNames` 与 `stepRefs` 组装顺序：

1. 优先使用工具 `_meta.flow.steps`。
2. 不完整时用 `flow.steps[].requestIds` 与 `flow.verifiedRequestIds` 推断。
3. 仍无法映射时不阻断，工具保留在 tools 列表。

返回中必须带：

```text
schemaVersion: 1
guidance: 步骤仅供参考，不要求按顺序执行...
```

### 3.8 Phase 1 验证

手动验证：

1. 录制一个流程并生成普通 MCP 工具。
2. 打开 MCP 设置刷新工具列表，确认多出两个系统工具。
3. 调用 `list_recorded_flows`，确认能看到流程。
4. 调用 `get_recorded_flow_context({ flowName })`，确认返回相关工具。
5. 禁用某个普通工具后重新查询，确认返回 `disabled`。
6. 删除某个普通工具后重新查询，确认返回 `missing`。
7. 创建同名流程，确认返回 `AMBIGUOUS_FLOW_NAME`。

代码验证：

- 对 `background.js` 做语法检查。
- 对 `mcp-engine.js` 做语法检查。
- 对 `server.mjs` 做语法检查。

## 4. Phase 2：UI 可视化

目标：用户能在扩展 UI 中理解 Flow 与 MCP 工具的关系，并控制系统工具是否暴露。

### 4.1 MCP 页按流程分组

修改 `extension/content/mcp-ui.js`：

- `getMcpToolGroupKey` 增加 `flow` 模式。
- 分组名优先取 `tool._meta.flow.flowName`。
- 无流程归属显示“未归属流程”。
- 系统工具显示“系统工具”。
- 分组下拉增加“按流程”。

### 4.2 MCP 工具详情增强

工具详情增加：

- 所属流程
- 来源步骤
- 同流程其它工具
- 系统工具标识

系统工具详情展示：

- 固定系统能力说明
- 是否受设置页开关控制
- 不显示删除、合并等普通工具操作。

### 4.3 Flow 页流程工具集区域

修改 `extension/content/ui-core.js`：

在 Flow 详情中增加：

```text
流程工具集
- 已关联工具数
- 可用工具数
- 缺失工具数
- 禁用工具数
- 查看流程上下文
- 同步到 MCP
- 复制 AI 使用提示
```

“查看流程上下文”可复用 Phase 1 组装逻辑，直接展示 JSON 或简化卡片。

“复制 AI 使用提示”内容：

```text
请使用“<flowName>”流程。先调用 get_recorded_flow_context 获取该流程相关工具，再根据我的目标选择具体工具。步骤仅供参考，不需要按顺序执行。
```

### 4.4 设置页开关

在设置页增加：

```text
MCP 流程上下文工具
[x] 暴露 list_recorded_flows
[x] 暴露 get_recorded_flow_context
```

配置建议：

```js
enableFlowContextListTool: true
enableFlowContextDetailTool: true
```

保存后：

- `saveConfig()`
- `chrome.runtime.sendMessage({ type: "MCP_SYNC_TOOLS" })`
- 显示提示：如果 Cursor 仍显示旧列表，请刷新 MCP 服务器。

### 4.5 Phase 2 验证

1. MCP 页选择“按流程”，工具正确分组。
2. 无流程工具进入“未归属流程”。
3. 系统工具显示为“系统工具”。
4. Flow 页能看到流程工具集统计。
5. 关闭系统工具开关后，重新同步，Cursor 工具列表不再展示对应系统工具。
6. 再次开启后，系统工具恢复。

## 5. Phase 3：质量增强

目标：提升流程上下文可用性，但不影响基础闭环。

### 5.1 缺失工具修复入口

Flow 页增加提示：

```text
部分关联工具已缺失，可重新从已验证请求生成 MCP 工具。
```

操作：

```text
重新生成该流程 MCP 工具
```

复用现有 `generateMcpToolsFromFlow(flow)`。

### 5.2 流程 summary 增强

MVP summary 使用规则生成：

```text
<flow.name> 相关流程
```

后续可增加 AI 优化按钮，但默认不依赖 AI。

### 5.3 匹配质量优化

可选增强：

- 流程别名
- 关键词字段
- 最近使用流程优先
- 同 hostname 优先

这些不进入第一版必做。

## 6. 错误码清单

系统工具返回统一 JSON，不抛未结构化异常。

```text
FLOW_NOT_FOUND
AMBIGUOUS_FLOW_NAME
FLOW_CONTEXT_SYSTEM_ERROR
INVALID_FLOW_CONTEXT_ARGS
```

工具状态：

```text
available
disabled
missing
```

## 7. 风险与缓解

### 7.1 Cursor 工具列表缓存

风险：关闭系统工具后，Cursor 仍显示旧工具。

缓解：

- 同步后广播 `tools/list_changed`。
- UI 提示刷新 MCP 服务器。
- 验证阶段实际测试 Cursor 刷新行为。

### 7.2 跨站点同名工具

风险：不同 hostname 下工具名相同。

缓解：

- Flow Context 只查 `flow.hostname` 下的工具。
- 找不到时返回 `missing`，不跨站点猜测。

### 7.3 AI 不一定先查流程上下文

风险：模型行为无法绝对保证。

缓解：

- 系统工具 description 明确提示。
- Flow 页提供可复制提示词。
- 验收采用人工场景验证，不把模型行为当作确定性单测。

### 7.4 步骤映射不完整

风险：旧流程或旧工具缺少 `_meta.flow.steps`。

缓解：

- 降级使用 `flow.steps[].requestIds` 推断。
- 仍失败时只返回工具列表，不阻断上下文查询。

## 8. 推荐实施顺序

1. 在 background 中追加系统工具定义和调用分流。
2. 实现 storage 数据集读取与 Flow 匹配。
3. 实现 Flow Context 组装。
4. 完成 Phase 1 手动调用验证。
5. 增加 MCP 页“按流程”分组。
6. 增加 Flow 页流程工具集区域。
7. 增加设置页系统工具开关。
8. 完成 Cursor 端刷新与调用验证。

## 9. 回归测试清单

每次改动后至少验证：

- 原有普通 MCP 工具仍能同步到 helper。
- 原有普通 MCP 工具仍能调用成功。
- 工具数量统计与 helper 实际 enabled 数一致。
- Flow 录制、结束录制、生成 MCP 工具不回退。
- MCP 页筛选、搜索、启用/禁用仍可用。
- 系统工具关闭后不影响普通工具。

## 10. 完成定义

第一版完成时，应满足：

1. Cursor 可调用 `list_recorded_flows`。
2. Cursor 可调用 `get_recorded_flow_context` 并按流程名获得工具集。
3. 返回内容明确说明步骤仅作参考，不自动执行。
4. Flow 与工具使用 `hostname + toolName` 关联。
5. MCP 页支持按流程分组。
6. Flow 页显示流程工具集统计。
7. 系统工具可通过设置开关控制暴露。
8. 已通过至少一个真实录制流程的端到端验证。
