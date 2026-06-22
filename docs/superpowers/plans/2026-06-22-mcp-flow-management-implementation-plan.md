# MCP 流程管理实施计划

日期：2026-06-22  
来源规格：`docs/superpowers/specs/2026-06-22-mcp-flow-management-design.md`  
第一版目标：MCP 工具页默认以可折叠流程树展示；支持 Flow CRUD 与工具移入/移出；未归属工具归入「其他」；手动流程与录制流程统一存储并对 AI 可见。

## 1. 实施原则

- 不新增 `mcpToolGroups` 表，统一复用 `state.flows` + `_meta.flow`。
- 工具归属以 `_meta.flow.flowId` 为展示权威，`flow.mcpToolNames` 为持久化索引，CRUD 必须双向同步。
- 删除/移出流程 **不删除** MCP 工具，仅清关联。
- v1 用批量「移动到流程」；拖拽留 Phase 2。
- 系统工具不参与流程 CRUD，单独置顶分组。
- 每个 Phase 完成后扩展可加载，已有 MCP 同步/调用不受影响。

## 2. 当前代码边界

| 文件 | 现状 | 本计划改动 |
|------|------|------------|
| `extension/content/state.js` | `mcpListUi.groupMode` 默认 `none`；`createFlow()` 仅录制 | 增加 `viewMode`、`collapsedFlowIds`；`createManualFlow()`；`createFlow()` 写 `kind:'recorded'` |
| `extension/content/mcp-ui.js` | 平铺表格 + 静态分组头 | 流程树主视图、CRUD UI、视图切换、批量移动 |
| `extension/content/mcp-engine.js` | 生成工具时写 `_meta.flow`；description 前缀 | 抽出 `applyFlowTagToToolDescription()` 供 membership 复用 |
| `extension/content/ui-core.js` | FLOW 页流程工具集只读 | manual 流程展示；跳转 MCP/FLOW 联动 |
| `extension/background-flow-context.js` | list/get 不含 `kind` | 返回 `kind`、manual summary |
| `extension/content/content.css` | 有 group-header、sys-badge | 流程树行、kind badge、折叠箭头 |
| `extension/manifest.json` | 无 `flow-membership.js` | 追加脚本（在 `mcp-engine.js` 之后、`mcp-ui.js` 之前） |

## 3. Phase 1：数据层与归属同步

目标：`flow-membership.js` 提供可测试的 Flow/工具归属 API，UI 尚未改。

### 3.1 新增 `extension/content/flow-membership.js`

导出（挂到全局或 IIFE 内同级函数）：

```js
inferFlowKind(flow)
createManualFlow(name, hostname)
buildFlowTreeGroups(toolsMap, flowsMap, options)
assignToolsToFlow(toolNames, targetFlowId)
unassignToolsFromFlow(toolNames)
renameFlow(flowId, newName)
deleteFlowById(flowId)
pruneMissingToolRefs(flowId)
syncFlowMembershipAndMcp(options)
```

**`buildFlowTreeGroups` 返回结构：**

```js
[
  { key: '__system__', title: '系统工具', flowId: null, kind: 'system', tools: [...] },
  { key: 'flow_abc', title: '考试流程', flowId, kind: 'recorded'|'manual', tools: [...], missingRefs: [...] },
  { key: '__other__', title: '其他', flowId: null, kind: 'other', tools: [...] }
]
```

排序：系统 → 具名流程（`localeCompare(name)`）→ 其他。

**`assignToolsToFlow`：**

1. 校验 `targetFlowId` 存在。
2. 对每个 `toolName`：跳过 system tool；读 oldFlowId；更新 flows + `_meta.flow` + description。
3. `saveFlows()` + `saveMcpTools()` + `MCP_SYNC_TOOLS`（可通过 callback 延迟 sync）。

**`deleteFlowById`：**

1. 若 `flowId === state.activeFlowId && state.flowRecording` → 返回 `{ ok: false, error: 'RECORDING_ACTIVE' }`。
2. 对 `mcpToolNames` 逐个 `unassign`。
3. `delete state.flows[flowId]`；`saveFlows()`。

**`renameFlow`：**

1. 更新 `flow.name`。
2. 遍历 `_meta.flow.flowId === flowId` 的工具，更新 `flowName` 与 description 前缀。

### 3.2 修改 `state.js`

```js
// mcpListUi 默认值
viewMode: 'flowTree',
collapsedFlowIds: {},

// createFlow 增加
kind: 'recorded',

// 新增
function createManualFlow(name, hostname) { ... }  // 不设置 flowRecording
```

### 3.3 修改 `mcp-engine.js`

抽出：

```js
function applyFlowTagToToolDescription(tool, flowName) { ... }
function stripFlowTagFromDescription(tool) { ... }
```

`generateToolsFromFlow` 等现有调用改为使用 helper。

### 3.4 修改 `manifest.json`

在 `mcp-engine.js` 与 `mcp-ui.js` 之间插入：

```json
"content/flow-membership.js"
```

### 3.5 Phase 1 验证

1. 控制台手动调用 `createManualFlow('测试')` → storage 有 `kind:'manual'` 且无 recording。
2. `assignToolsToFlow(['tool_a'], flowId)` → 工具 `_meta.flow` 正确，`mcpToolNames` 一致。
3. `unassignToolsFromFlow(['tool_a'])` → 归入无 flow，`mcpToolNames` 移除。
4. `deleteFlowById` 录制中 active flow → 拒绝。
5. `node --check` 新文件语法。

---

## 4. Phase 2：流程树 UI（只读 + 折叠）

目标：MCP 列表默认流程树，先只读展示，CRUD 按钮 disabled 或 Phase 3 再接。

### 4.1 `mcp-ui.js` 视图分支

`buildMcpToolListInnerHTML()`：

```js
if ((state.mcpListUi.viewMode || 'flowTree') === 'flowTree') {
  return buildMcpFlowTreeHTML();
}
// 现有平铺逻辑
```

**`buildMcpFlowTreeHTML()`：**

- 调用 `buildFlowTreeGroups(getMcpListToolsMap(), state.flows)`。
- 应用 keyword / enabled / risk / siteFilter（在 group 内过滤 tool，空 group 可隐藏或显示 `(0)`）。
- 每组渲染：
  - `.ai-req-mcp-flow-group-header`：箭头、标题、计数、kind badge
  - 折叠：`collapsedFlowIds[group.key]` 时隐藏子行
- 子行复用现有 `.ai-req-mcp-table-row` 网格，缩进 `padding-left`。

### 4.2 工具栏视图切换

在 filter-row 增加：

```html
<select class="ai-req-mcp-view-mode">
  <option value="flowTree">流程树</option>
  <option value="flat">平铺</option>
</select>
```

- `flowTree` 模式：隐藏「分组」下拉（`.ai-req-mcp-group-select`）。
- `flat` 模式：行为与现网一致。

### 4.3 折叠交互

- 点击 group header 切换 `collapsedFlowIds[key]`。
- 可选：`localStorage` 或 `storageSet` 持久化（v1 用 `state.mcpListUi`，刷新面板时从 memory 保留；若面板重开丢失可接受，或写入 extension config key）。

### 4.4 文案替换

`getMcpToolGroupKey` 中 `'未归属流程'` → `'其他'`（平铺模式按流程分组时同步）。

### 4.5 Phase 2 验证

1. 打开 MCP 工具列表 → 默认流程树，三组结构正确。
2. 点击折叠 → 子工具隐藏/显示。
3. 切换平铺 → 原表格正常。
4. 搜索过滤 → 各组工具数变化正确。

---

## 5. Phase 3：流程 CRUD + 批量移动

目标：完整增删改查与工具移入/移出。

### 5.1 工具栏「新建流程」

- 按钮 `.ai-req-mcp-flow-create-btn`。
- 复用现有 confirm/modal 样式，输入名称 → `createManualFlow` → 刷新列表 → toast 成功。

### 5.2 流程组头操作

- ✎ `.ai-req-mcp-flow-rename-btn`：`prompt` 或 modal → `renameFlow` → refresh + sync。
- 🗑 `.ai-req-mcp-flow-delete-btn`：confirm；录制流程额外文案 → `deleteFlowById`。
- 系统工具组不渲染 ✎/🗑。

### 5.3 批量「移动到流程」

bulk-actions 增加：

```html
<select class="ai-req-mcp-move-to-flow-select"><option value="">移动到流程...</option>...</select>
<button class="ai-req-mcp-move-to-flow-btn">移动</button>
<button class="ai-req-mcp-unassign-flow-btn">移出流程</button>
```

- 下拉选项：所有具名 flow（按名称），不含 system/other。
- 无选中工具 → toast 提示。
- 移动后清 checkbox，`refreshMcpToolListViewLocal`。

### 5.4 流程详情（Inspector 扩展）

选中流程组头（非工具行）时，Inspector 显示：

- 名称、kind、hostname、工具数、缺失数
- 按钮：「在 FLOW 页打开」「清理缺失引用」
- manual 流程显示「无录制步骤」

实现：点击 group header 设置 `state.mcpListUi.selectedFlowId`，Inspector 分支渲染。

### 5.5 Phase 3 验证

1. 新建 manual 流程 → 树中出现，空组 `(0)`。
2. 勾选 2 工具移动到该流程 → 组内可见，其他组减少。
3. 重命名 → description 前缀更新。
4. 移出 → 回到「其他」。
5. 删录制流程 → 确认文案；工具保留；steps 随 flow 删除。
6. MCP 同步后 Cursor 工具 description 反映新流程名。

---

## 6. Phase 4：AI 查询与 FLOW 页联动

### 6.1 `background-flow-context.js`

`handleListRecordedFlows` 每条增加：

```js
kind: inferFlowKind(flow),
summary: inferFlowKind(flow) === 'manual' ? '手动工具分组' : (flow.name + ' 相关流程')
```

`buildFlowContextPayload`：

- manual：`referenceSteps: []`
- `guidance` 追加 manual 说明一句。

`inferFlowKind` 在 background 侧复制一份（或 Phase 1 若可共享则 document 约定：content/background 各一份小函数，避免 cross-context import）。

### 6.2 `ui-core.js` FLOW 页

- 流程列表：manual 显示 badge「手动」；无 steps 时详情区文案「手动分组，无录制步骤」。
- 增加按钮「在 MCP 页管理工具」→ 切 MCP tab + 选中该 flowId（message 或 `state` 预设 `mcpListUi.scrollToFlowId`）。
- `buildFlowToolsetHTML`：manual 流程仍显示 mcpToolNames 列表。

### 6.3 Phase 4 验证

1. `list_recorded_flows` 含 manual 流程且 `kind` 正确。
2. `get_recorded_flow_context({ flowName: manual名 })` 返回工具、空 steps、manual guidance。
3. FLOW 页点「在 MCP 页管理」→ 跳转并展开对应流程组。

---

## 7. Phase 5：样式与 polish

### 7.1 `content.css`

新增：

- `.ai-req-mcp-flow-group-header` — grid 与 table-head 对齐，可点击，`cursor: pointer`
- `.ai-req-mcp-flow-group-header .ai-req-mcp-flow-chevron` — 旋转动画
- `.ai-req-mcp-flow-kind-badge` — recorded/manual 颜色区分
- `.ai-req-mcp-flow-group-actions` — ✎/🗑 按钮
- `.ai-req-mcp-table-row.ai-req-mcp-flow-child` — 左缩进
- `.ai-req-mcp-view-mode` — 与现有 filter 对齐

### 7.2 边界情况

- 重名流程：header 副标题显示 `(hostname)` 当检测到同名 >= 2。
- 空 manual 流程：仍显示，便于拖入工具。
- 导入 MCP 工具 JSON 后：无 `_meta.flow` 的工具进「其他」；不自动建 flow。

---

## 8. 回归测试清单

| # | 场景 | 预期 |
|---|------|------|
| 1 | 默认打开 MCP 列表 | 流程树视图 |
| 2 | 系统工具组 | 置顶，不可勾选，无 CRUD |
| 3 | 未归属工具 | 在「其他」 |
| 4 | 新建/重命名/删除 manual | 数据与 UI 一致 |
| 5 | 批量移动 | 双向索引一致 |
| 6 | 删除录制 flow | 工具保留，步骤删除 |
| 7 | 录制中删除 |  blocked |
| 8 | 平铺视图 | 与改前一致 |
| 9 | AI list/get | manual kind 正确 |
| 10 | 折叠状态 | 切换组正常 |

---

## 9. 文件变更摘要

```
extension/manifest.json                          # +flow-membership.js
extension/content/state.js                       # viewMode, createManualFlow, kind
extension/content/flow-membership.js             # 新建
extension/content/mcp-engine.js                  # description helpers
extension/content/mcp-ui.js                      # 流程树 + CRUD + 批量移动
extension/content/ui-core.js                     # FLOW manual 展示 + 跳转
extension/background-flow-context.js             # kind in list/get
extension/content/content.css                    # 流程树样式
docs/superpowers/specs/2026-06-22-mcp-flow-management-design.md  # 已有
docs/superpowers/plans/2026-06-22-mcp-flow-management-implementation-plan.md  # 本文件
```

## 10. 二期 backlog（不在本计划实现）

- 拖拽工具到流程组头
- 流程内工具排序
- `hostname: '*'` 跨站 manual flow
- 折叠状态持久化到 `chrome.storage.local`

## 11. 建议实施顺序

```
Phase 1 (数据层) → Phase 2 (只读树) → Phase 3 (CRUD) → Phase 4 (AI/FLOW) → Phase 5 (CSS)
```

每 Phase 结束 reload 扩展，跑该 Phase 验证项后再进入下一 Phase。

---

**状态**：待实施  
**Spec 审批**：2026-06-22 用户确认「可以」
