# MCP 流程管理 · 二期设计

日期：2026-06-22  
状态：设计稿（brainstorm 已确认）  
范围：拖拽分配、流程内排序、跨站手动流程、折叠状态持久化  
依赖规格：
- `docs/superpowers/specs/2026-06-22-mcp-flow-management-design.md`（一期）
- `docs/superpowers/specs/2026-06-22-flow-toolset-context-design.md`

## 1. 背景

MCP 流程管理一期已落地：流程树默认视图、CRUD、批量「移动到流程」、统一 Flow 实体、AI 上下文查询。一期刻意延后的四项能力构成本期范围：

1. **拖拽分配** — 替代/补充批量移动，降低操作成本
2. **流程内排序** — 用户自定义工具顺序，并传递给 AI
3. **跨站手动流程** — `hostname: '*'` 纯逻辑分组
4. **折叠状态持久化** — 刷新扩展后保留流程树折叠态

## 2. 已确认的产品决策

| 决策项 | 选择 |
|--------|------|
| 本期范围 | 四项全做（完整二期） |
| 跨站流程语义 | 纯逻辑分组；工具仍存各站 `toolsByHost` |
| 拖拽模型 | 完整拖拽：跨组移入、拖到「其他」移出、组内排序、多选批量跟随 |
| 工具顺序 | `flow.mcpToolNames` 为权威顺序；UI 与 `get_recorded_flow_context` 一致 |
| 创建跨站流程 | 「新建流程」弹窗增加「跨站点流程」复选框 |
| 拖拽实现 | HTML5 原生 DnD，逻辑抽到 `mcp-flow-dnd.js` |

## 3. 目标

1. 流程树工具行支持拖拽到流程组头完成移入，拖到「其他」完成移出。
2. 流程内上下拖拽调整 `mcpToolNames` 顺序。
3. 已勾选多个工具时，拖拽其中一行移动全部勾选。
4. 支持创建 `hostname: '*'` 的手动流程，收纳任意站点工具。
5. 流程树折叠状态写入 `chrome.storage.local`，重载后恢复。
6. 修复 v1 遗留：组内工具按 `mcpToolNames` 排序（非字母序）；跨站流程 AI 上下文正确解析各 host 工具。

## 4. 非目标

- 流程组之间的拖拽排序（流程仍按名称 `localeCompare`）
- 拖拽修改录制步骤内容
- 一个工具属于多个流程
- 自动执行流程
- 跨站点流程合并（多个录制流程合成一个）
- 触摸设备专用手势优化（本期仅保证桌面浏览器可用）

## 5. 数据模型

### 5.1 跨站流程存储

```js
// 存储键（与一期 per-host 键并列）
ai_req_flows_*          // hostname === '*' 的全局 manual 流程

// Flow 实体
{
  id: 'flow_xxx',
  kind: 'manual',
  name: '跨站商品流程',
  hostname: '*',
  mcpToolNames: ['post_a', 'get_b'],  // 权威顺序
  steps: [],
  verifiedRequestIds: [],
  ...
}
```

- 创建：`createManualFlow(name, '*')`；UI 弹窗勾选「跨站点流程」
- 未勾选时行为与一期相同：`hostname = location.hostname`
- 工具定义仍存 `ai_req_mcp_tools_{toolHost}`，不因归属跨站流程而迁移

### 5.2 工具 `_meta.flow` 扩展

移入流程时在现有字段基础上写入：

```js
tool._meta.flow = {
  flowId: 'flow_xxx',
  flowName: '跨站商品流程',
  hostname: '*',           // 流程的 hostname（跨站时为 '*'）
  toolHost: 'www.a.com'    // 工具实际存储 host（新增，便于 lookup）
}
```

同站流程：`hostname` 与 `toolHost` 相同，可省略 `toolHost`（读取时 fallback 到 `resolveToolHostForMembership`）。

### 5.3 工具顺序

- **权威来源**：`flow.mcpToolNames` 数组顺序
- **UI 渲染**：`buildFlowTreeGroups` 组内工具按 `mcpToolNames` 排列；不在列表中但 `_meta.flow.flowId` 匹配的工具 append 到末尾（字母序）
- **AI 上下文**：`assembleFlowContext` 已按 `mcpToolNames` 迭代；本期修复跨 host lookup
- **guidance 追加**：「工具列表按推荐调用顺序排列，请优先按序使用。」

### 5.4 UI 偏好持久化

```js
// chrome.storage.local
ai_req_mcp_list_ui_prefs = {
  schemaVersion: 1,
  collapsedFlowIds: { '__other__': true, 'flow_abc': true },
  viewMode: 'flowTree'   // 'flowTree' | 'flat'
}
```

- 折叠/展开、`viewMode` 变更时 debounce 300ms 写入
- `ensureMcpListUi()` 初始化时 hydrate
- **不持久化**：`selectedToolName`、`selectedFlowId`、`keyword`、筛选条件

## 6. 架构与模块

| 文件 | 职责 |
|------|------|
| `extension/content/mcp-flow-dnd.js`（新建） | HTML5 DnD 状态机、drop 判定、批量工具名收集、视觉态 class 切换 |
| `extension/content/flow-membership.js` | `reorderToolsInFlow`；`createManualFlow` 支持 `'*'`；`setToolFlowMeta` 写 `toolHost`；`sortToolsByFlowOrder` helper |
| `extension/content/mcp-ui.js` | 拖柄渲染、注册 DnD、新建流程弹窗（跨站复选框）、prefs 读写 |
| `extension/content/flow-membership.js` | `buildFlowTreeGroups` 改用顺序排列 |
| `extension/background-flow-context.js` | 跨 host 工具 lookup；`list_recorded_flows` 对 `*` 流程的 `linkedToolCount` |
| `extension/content/content.css` | 拖柄、dragging、drop-target、drop-forbidden 样式 |
| `extension/manifest.json` | 注册 `mcp-flow-dnd.js`（在 `mcp-ui.js` 之前） |

### 6.1 新增 API（flow-membership.js）

```js
function reorderToolsInFlow(flowId, orderedNames, options)
// orderedNames: 完整新顺序（含该 flow 下所有应显示工具）
// 更新 flow.mcpToolNames，persist + sync

function sortToolsByFlowOrder(flow, toolNames)
// 按 flow.mcpToolNames 排序；未知名 append 字母序

function resolveToolDefAcrossHosts(toolName, toolsByHost, meta)
// background 与 content 共用逻辑（或各实现一份小 helper）
```

## 7. 拖拽交互

### 7.1 拖拽源

- 流程树 **工具行** 左侧 `⋮⋮` 拖柄（`ai-req-mcp-drag-handle`）
- `draggable=true` 绑在拖柄；hover 行时显示拖柄
- **系统工具**、**缺失引用行**（无 tool 对象）：不可拖

### 7.2 Drop 目标

| 目标 | 行为 |
|------|------|
| 流程组头（`.ai-req-mcp-flow-group-head`） | `assignToolsToFlow(names, flowId)` |
| 「其他」组头 | `unassignToolsFromFlow(names)` |
| 流程内工具行（`.ai-req-mcp-tool-row`） | 同 flowId → `reorderToolsInFlow`；异 flowId → 视为移入该 flow |
| 系统工具组 | 禁止 drop |

### 7.3 多选批量

- 拖起时若存在已勾选工具 → 移动所有勾选（含被拖行）
- 无勾选 → 仅移动当前行

### 7.4 跨站校验

| 场景 | 行为 |
|------|------|
| 拖入 `hostname: '*'` 流程 | 不校验 tool host |
| 拖入普通（单站）流程 | 仅允许 `toolHost === flow.hostname` 的工具；否则 toast 拒绝 |
| 从 `*` 流程拖到单站流程 | 允许（若通过单站校验） |
| 从 `*` 流程拖到「其他」 | 允许 |

### 7.5 视觉反馈

- **dragging**：源行 `opacity: 0.5`
- **drop-target-ok**：组头 accent 边框 + 浅底
- **drop-target-forbidden**：红色边框 / 禁止光标
- **完成 toast**：`已移入「{flowName}」` / `已移出流程` / `已更新顺序（N 个工具）`

### 7.6 与 v1 批量移动共存

- 保留「勾选 + 移动到流程」下拉与「移出流程」按钮
- 拖拽为首选交互；批量按钮不删除

## 8. 跨站流程 · AI 兼容

### 8.1 `buildRecordedFlowDataset`

- 已扫描 `ai_req_flows_*`；`entry.hostname === '*'` 时 `flow.hostname` 为 `*`
- 无需改扫描逻辑

### 8.2 `countFlowTools` / `assembleFlowContext`

当 `entry.hostname === '*'`（或 `flow.hostname === '*'`）：

```js
function lookupTool(toolName, toolsByHost, meta) {
  var th = (meta && meta.flow && meta.flow.toolHost) || null;
  if (th && toolsByHost[th] && toolsByHost[th][toolName]) return toolsByHost[th][toolName];
  for (var host in toolsByHost) {
    if (toolsByHost[host][toolName]) return toolsByHost[host][toolName];
  }
  return null;
}
```

`linkedToolCount` 对 `*` 流程：遍历 `mcpToolNames`，用上述 lookup 计数。

### 8.3 `list_recorded_flows`

- `hostname: '*'` 的流程 `summary` 为「跨站点手动工具分组」
- `kind: 'manual'` 不变

### 8.4 `get_recorded_flow_context`

- 返回的 `tools[]` 顺序与 `mcpToolNames` 一致
- 每条 tool entry 可增加 `toolHost` 字段（便于 AI 知悉来源站点）
- `guidance` 含顺序提示

## 9. 新建流程 UI

将 `prompt()` 替换为轻量 modal（与扩展现有 modal 风格一致）：

```
┌ 新建流程 ─────────────────┐
│ 名称: [_______________]   │
│ ☐ 跨站点流程              │
│   可收纳任意站点的工具     │
│         [取消]  [创建]    │
└───────────────────────────┘
```

- 勾选 → `createManualFlow(name, '*')`
- 未勾选 → `createManualFlow(name, location.hostname)`
- 跨站流程在流程树 kind 标签显示 `[跨站]`（与 `[手动]` 并列或合并为 `[手动·跨站]`）

## 10. 错误处理

| 场景 | 处理 |
|------|------|
| 拖到单站流程但 host 不匹配 | toast「该流程仅支持同站点工具」，不修改数据 |
| 拖到系统工具组 | 忽略 drop，无 toast |
| 拖拽过程中工具被删 | drop 时 `loadToolForMembership` 失败则跳过该名 |
| `reorderToolsInFlow` 含非本 flow 工具 | 过滤掉非成员；仅 persist 合法顺序 |
| prefs 读写失败 | 静默降级为内存态（与 v1 相同） |
| 跨站流程在单站 filter 下 | `siteFilter !== 'all'` 时仍显示 `*` 流程（因其为全局分组）；组内仅显示当前 filter 可见工具 |

## 11. 测试清单

1. **组内排序**：拖拽调整顺序 → UI 立即更新 → 刷新后顺序保持 → `get_recorded_flow_context` 返回同序。
2. **跨组移入**：从「其他」拖到流程组头 → `_meta.flow` 更新 → `mcpToolNames` 更新 → MCP sync。
3. **移出**：拖到「其他」→ `_meta.flow` 清除 → 从 `mcpToolNames` 移除。
4. **多选批量**：勾选 3 个工具拖一行 → 3 个均移动。
5. **跨站流程**：勾选「跨站点流程」创建 → 从 A 站、B 站各拖入工具 → AI context 两条均 available 且含 `toolHost`。
6. **单站拒绝**：B 站工具拖到 A 站单站流程 → toast 拒绝。
7. **折叠持久化**：折叠若干组 → 重载扩展 → 折叠态恢复。
8. **viewMode 持久化**：切到平铺 → 重载 → 仍为平铺。
9. **系统工具**：不可拖、不可 drop。
10. **v1 回归**：批量「移动到流程」、CRUD、删除流程移入「其他」仍正常。

## 12. 分期与文件变更摘要

本期为 **MCP 流程管理 Phase 2**，一期 spec 中「Phase 2（后续）」四项全部纳入。

```
新增: extension/content/mcp-flow-dnd.js
修改: flow-membership.js, mcp-ui.js, background-flow-context.js,
      content.css, manifest.json
文档: 本 spec → 配套 implementation plan
```

## 13. Brainstorm 决策记录

- 2026-06-22：完整二期（四项全做）— 用户确认 **A**
- 2026-06-22：跨站流程纯逻辑分组 — 用户确认 **A**
- 2026-06-22：完整拖拽模型 — 用户确认 **A**
- 2026-06-22：工具顺序写入 AI 上下文 — 用户确认 **A**
- 2026-06-22：新建流程弹窗跨站复选框 — 用户确认 **A**
- 2026-06-22：设计 §1–§3 — 用户确认「符合」

---

**状态**：待用户 review spec  
**下一步**：用户确认 spec → 编写 implementation plan → 实施
