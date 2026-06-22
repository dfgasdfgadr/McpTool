# MCP 流程管理 · 二期实施计划

日期：2026-06-22  
来源规格：`docs/superpowers/specs/2026-06-22-mcp-flow-management-phase2-design.md`

## Phase 1：数据层

- `flow-membership.js`：`reorderToolsInFlow`、`insertToolsInFlowOrder`、`sortToolsByFlowOrder`、`canAssignToolToFlow`、`toolHost` 元数据
- `buildFlowTreeGroups` 按 `mcpToolNames` 排序
- `background-flow-context.js`：跨 host lookup、`toolHost` 字段、顺序 guidance

## Phase 2：拖拽与 UI

- 新建 `mcp-flow-dnd.js`：HTML5 DnD
- `mcp-ui.js`：拖柄、新建流程 modal、prefs 持久化
- `content.css`：拖拽视觉态

## Phase 3：验证

1. 组内拖拽排序 → 刷新后顺序保持
2. 拖到流程组头 /「其他」
3. 多选批量拖拽
4. 跨站流程创建 + 拖入多站工具
5. 单站流程拒绝跨 host 工具
6. 折叠 / viewMode 持久化

## 文件变更

```
新增: extension/content/mcp-flow-dnd.js
修改: flow-membership.js, mcp-ui.js, background-flow-context.js, content.css, manifest.json
```

**状态**：已实施
