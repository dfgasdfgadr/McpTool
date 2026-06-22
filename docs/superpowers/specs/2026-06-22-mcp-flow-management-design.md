# MCP 流程管理设计

日期：2026-06-22  
状态：设计稿（已评审通过 brainstorm）  
范围：MCP 工具列表流程树视图、Flow CRUD、工具归属管理  
依赖规格：`docs/superpowers/specs/2026-06-22-flow-toolset-context-design.md`  
非目标：拖拽分配（二期）、流程内工具排序（二期）、跨站点流程合并（二期）、自动执行流程

## 1. 背景

Flow Toolset Context 已落地：录制 Flow 可关联 MCP 工具，AI 可通过 `get_recorded_flow_context` 查询流程工具集。MCP 工具页目前支持「按流程」静态分组，但存在以下缺口：

1. 默认视图为平铺列表，流程分组需手动切换下拉。
2. 分组标题不可折叠，流程一多列表冗长。
3. 无法在 MCP 页创建/重命名/删除流程，也无法批量调整工具归属。
4. 未归属工具显示为「未归属流程」，命名不直观。
5. 手动逻辑分组与录制流程是两套心智，数据未统一暴露给 AI。

本设计在 **统一 Flow 实体** 前提下，将 MCP 工具页默认改为 **可折叠流程树**，并提供完整 **增删改查**，使「流程 = 工具集上下文」在 UI 与数据层一致。

## 2. 已确认的产品决策

| 决策项 | 选择 |
|--------|------|
| 流程来源 | 混合：录制流程自动出现 + 可手动建空分组 |
| 数据模型 | 统一 `state.flows`，不另建 `mcpToolGroups` |
| 工具归属 | 一个工具只属于一个流程 |
| 删除/移出 | 只解绑，不删除 MCP 工具 |
| 工具分配 v1 | 勾选 +「移动到流程」批量操作 |
| 工具分配二期 | 拖拽到流程分组 |
| 默认视图 | 可折叠流程树；平铺列表作为备选视图 |

## 3. 目标

1. MCP 工具列表 **默认** 以流程名称分组展示，点击流程名可展开/折叠组内工具。
2. 未归属任何流程的工具归入 **「其他」** 分组。
3. 支持流程 **增删改查**：新建手动流程、重命名、删除流程、查看组内工具。
4. 支持工具 **移入/移出** 流程，并同步 `_meta.flow` 与 `flow.mcpToolNames`。
5. 手动流程与录制流程对 AI 查询均可见（`list_recorded_flows` / `get_recorded_flow_context`）。
6. 系统工具（`list_recorded_flows`、`get_recorded_flow_context`）单独置顶，不参与流程 CRUD。

## 4. 非目标

- 拖拽分配工具（二期）
- 流程内工具自定义排序（二期）
- 在 MCP 页编辑录制步骤内容（仍在 FLOW 页）
- 删除流程时批量删除组内 MCP 工具
- 一个工具同时属于多个流程

## 5. 用户体验

### 5.1 默认流程树视图

```
▼ 系统工具 (2)
    list_recorded_flows
    get_recorded_flow_context
▼ 流程 2026/6/22 10:04:34 (3)  [录制]  ✎ 🗑
    post_Training_exam_select
    post_Training_paper_select_paper_Answer_Answer_id
    ...
▶ 商品查询 (5)                 [手动]  ✎ 🗑
▼ 其他 (8)
    get_adminapi_product_list
    ...
```

- 流程按 **名称** 排序（`localeCompare`）。
- 「系统工具」始终置顶、默认展开，不参与 CRUD。
- 「其他」始终置底（系统工具之后、具名流程之前或之后——实现时固定为：**系统工具 → 具名流程（名称序）→ 其他**）。
- 分组标题显示：折叠箭头、流程名、工具数量、kind 标签（录制/手动）、操作按钮。
- 折叠状态持久化到 `state.mcpListUi.collapsedFlowIds`（flowId 或特殊 key 如 `__system__`、`__other__`）。

### 5.2 视图切换

工具栏增加视图切换：

- **流程树**（默认，`viewMode: 'flowTree'`）
- **平铺列表**（现有表格，`viewMode: 'flat'`）

原「分组」下拉在流程树模式下隐藏或降级为次级选项；平铺模式下保留现有 `groupMode`（none / method / risk / pathPrefix / flow）。

### 5.3 CRUD 操作

| 操作 | 入口 | 行为 |
|------|------|------|
| **查** | 点击流程名展开 | 显示组内工具；点击 ✎ 打开流程详情（名称、kind、hostname、工具数、跳转 FLOW 页） |
| **增** | 「新建流程」按钮 | 弹窗输入名称 → 创建 `kind: 'manual'` 空 Flow |
| **改** | 流程行 ✎ | 重命名；同步更新组内工具 `_meta.flow.flowName` 与 description 前缀 |
| **删** | 流程行 🗑 | 确认弹窗 → 删除 Flow 记录；组内工具清 `_meta.flow` → 归入「其他」 |
| **移入** | 勾选工具 →「移动到流程」 | 选择目标流程；从旧流程 `mcpToolNames` 移除并更新 `_meta.flow` |
| **移出** | 工具行「移出流程」/ 批量 | 清 `_meta.flow`；从 `flow.mcpToolNames` 移除 |

**删除录制流程** 时额外提示：「录制步骤将一并删除，MCP 工具将保留并移入「其他」。」

### 5.4 与 FLOW 页关系

- 录制流程：FLOW 页继续负责录制、验证、生成工具；MCP 页可管理其名称与工具归属。
- 手动流程：MCP 页创建；FLOW 页列表中可见（无步骤区域或显示「手动分组，无录制步骤」）。
- 点击流程详情中的「在 FLOW 页打开」跳转并选中对应 flowId。

## 6. 数据模型

### 6.1 Flow 实体扩展

在现有 Flow 上新增 `kind` 字段：

```js
{
  schemaVersion: 1,
  id: "flow_xxx",
  kind: "recorded", // "recorded" | "manual"
  name: "考试流程",
  hostname: "www.dh-platform.com",
  startedAt: 1782090000000,
  endedAt: 1782090030000,
  steps: [],
  verifiedRequestIds: [],
  classifications: {},
  requestMeta: {},
  manualVerificationOverrides: {},
  notes: "",
  mcpToolNames: ["post_Training_exam_select"]
}
```

**兼容推断**（读时 migration，不写回除非发生 CRUD）：

```js
function inferFlowKind(flow) {
  if (flow.kind === 'manual' || flow.kind === 'recorded') return flow.kind;
  if ((flow.steps && flow.steps.length) || (flow.verifiedRequestIds && flow.verifiedRequestIds.length)) {
    return 'recorded';
  }
  return 'manual';
}
```

**新建手动流程**：

```js
function createManualFlow(name, hostname) {
  return {
    id: 'flow_' + ...,
    kind: 'manual',
    name: name || '未命名流程',
    hostname: hostname || location.hostname,
    startedAt: Date.now(),
    endedAt: Date.now(),
    steps: [],
    verifiedRequestIds: [],
    classifications: {},
    requestMeta: {},
    manualVerificationOverrides: {},
    notes: '',
    mcpToolNames: []
  };
}
```

与 `createFlow()`（录制用）分离，避免误开 recording 状态。

### 6.2 工具归属双向同步

**权威规则**：

- 运行时展示以 `_meta.flow.flowId` 为准（工具侧）。
- `flow.mcpToolNames` 为持久化索引，CRUD 时必须与 `_meta.flow` 保持一致。

**移入工具 `toolName` 到 `targetFlowId`**：

1. 读取工具当前 `oldFlowId = tool._meta.flow.flowId`（若有）。
2. 若 `oldFlowId === targetFlowId`，无操作。
3. 从 `state.flows[oldFlowId].mcpToolNames` 移除 `toolName`（若存在）。
4. 向 `state.flows[targetFlowId].mcpToolNames` 追加 `toolName`（去重）。
5. 设置 `tool._meta.flow = { flowId, flowName }`。
6. 更新 `tool.description` 流程前缀（复用 mcp-engine 现有逻辑）。
7. `saveFlows()` + 持久化 MCP tools + `MCP_SYNC_TOOLS`。

**移出工具**：

1. 从所属 `flow.mcpToolNames` 移除。
2. 删除 `tool._meta.flow`（或置空）。
3. 去掉 description 中的 `[流程: xxx]` 前缀。
4. 保存并同步。

**删除流程 `flowId`**：

1. 遍历 `flow.mcpToolNames`，对每个工具执行移出逻辑。
2. `delete state.flows[flowId]`。
3. `saveFlows()` + 同步 MCP。

### 6.3 分组键与「其他」

流程树构建算法：

```js
function buildFlowTreeGroups(toolsMap, flowsMap) {
  // 1. systemTools: isFlowContextSystemToolName
  // 2. flowGroups: 每个 flow by name sort, tools from _meta.flow.flowId
  // 3. otherTools: 无 _meta.flow 且非 system
  // 工具以 _meta.flow.flowId 分组；mcpToolNames 仅作校验/缺失检测
}
```

- 分组显示名：「其他」（不再使用「未归属流程」）。
- `flow.mcpToolNames` 中有但 toolsMap 无此工具 → 流程详情显示「缺失 N 个」+「清理缺失引用」按钮。

## 7. 架构与模块

### 7.1 推荐实现方案

**方案：在现有 MCP 列表上升级为流程树（方案 1）**

主要改动文件：

| 文件 | 职责 |
|------|------|
| `extension/content/state.js` | `mcpListUi.viewMode` 默认 `'flowTree'`；`collapsedFlowIds`；`createManualFlow()` |
| `extension/content/flow-membership.js`（新建） | 移入/移出/删流程/重命名；`_meta.flow` 与 `mcpToolNames` 同步 |
| `extension/content/mcp-ui.js` | 流程树渲染、CRUD 事件、视图切换、批量「移动到流程」 |
| `extension/content/ui-core.js` | FLOW 页展示 manual 流程；跳转联动 |
| `extension/content/mcp-engine.js` | description 前缀更新 helper |
| `extension/background-flow-context.js` | `list_recorded_flows` 返回 `kind`；manual 流程 summary 标注 |
| `extension/content/content.css` | 流程树行、kind 标签、折叠动画 |

`flow-membership.js` 从 `mcp-ui.js` 抽离，避免单文件继续膨胀。

### 7.2 UI 状态

```js
state.mcpListUi = {
  viewMode: 'flowTree',      // 'flowTree' | 'flat'
  groupMode: 'none',         // flat 模式下使用
  collapsedFlowIds: {},      // { [flowIdOrKey]: true }
  keyword: '',
  filterEnabled: 'all',
  riskLevels: { low: true, medium: true, high: true },
  siteFilter: 'all',
  selectedToolName: null,
  inspectorOpen: false
};
```

折叠逻辑：`collapsedFlowIds[id] === true` 表示折叠；默认 `{}` 表示全部展开（或配置默认折叠「其他」——v1 全部展开）。

## 8. AI 查询兼容

`list_recorded_flows` 每条增加：

```js
{
  id, name, hostname, toolCount,
  kind: "recorded" | "manual",
  summary: kind === "manual" ? "手动工具分组" : "..."
}
```

`get_recorded_flow_context`：

- manual 流程：`referenceSteps` 为空数组；`guidance` 补充「此流程为手动分组，无录制步骤」。
- 工具列表组装逻辑不变。

## 9. 错误处理

| 场景 | 处理 |
|------|------|
| 重名流程 | 允许；列表可选显示 `(hostname)` 消歧 |
| 移动到不存在的 flowId | 拒绝，toast 错误 |
| 删除正在录制的 activeFlow | 禁止删除，提示「请先结束录制」 |
| mcpToolNames 引用缺失工具 | 灰标「缺失」；提供「清理缺失引用」 |
| 重命名流程 | 同步所有组内工具 `_meta.flow.flowName` 与 description |
| 同步失败 | toast + 保留本地变更，允许重试 MCP_SYNC |

## 10. 测试要点

1. 新建手动流程 → 出现在流程树，kind=手动，AI list 可见。
2. 勾选工具移动到手动流程 → 「其他」减少，目标流程增加，`_meta.flow` 正确。
3. 移出工具 → 回到「其他」，旧 flow.mcpToolNames 更新。
4. 重命名流程 → 工具 description 前缀更新，sync 后 Cursor 可见新名称。
5. 删除录制流程 → steps 删除，工具保留在「其他」。
6. 删除 manual 流程 → 同上。
7. 流程树折叠状态刷新后保持。
8. 切换到平铺视图 → 行为与现网一致。
9. 系统工具始终在「系统工具」组，不可勾选移动。
10. `get_recorded_flow_context({ flowName })` 对 manual 流程返回正确工具列表。

## 11. 分期

### Phase 1（本规格）

- Flow `kind` 字段与 `createManualFlow`
- 流程树默认视图 + 折叠
- 流程 CRUD（增删改查）
- 批量移入/移出
- 「其他」分组
- background-flow-context kind 暴露

### Phase 2（后续）

- 拖拽工具到流程分组
- 流程内工具排序
- 跨 hostname 手动流程（`hostname: '*'`）

## 12. 开放问题（实现时确认）

1. 默认是否折叠「其他」组（建议 v1 不折叠，减少点击）。
2. 平铺视图下是否仍保留「按流程」分组下拉（建议保留，与流程树不冲突）。
3. FLOW 页 manual 流程是否显示「在 MCP 页管理工具」快捷入口（建议显示）。

---

**Brainstorm 决策记录**

- 2026-06-22：混合流程来源、统一 Flow 实体、删流程不删工具、v1 批量 + 二期拖拽、默认流程树视图 — 用户确认「可以」。
