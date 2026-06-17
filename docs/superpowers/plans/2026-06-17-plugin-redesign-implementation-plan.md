# AI 请求分析助手插件页面重设计实现计划

日期：2026-06-17  
来源规格：`docs/superpowers/specs/2026-06-17-plugin-redesign-design.md`  
目标：在不改变协议、存储格式和核心业务能力的前提下，将插件浮层升级为暗色专业控制台工作台。

## 1. 实施原则

- 保留原生 DOM + CSS 架构，不引入 React、Tailwind、GSAP 或构建链。
- 主区只保留请求、MCP、设置三类；Mock/调试规则留在请求详情，调用日志留在 MCP 子视图。
- 每个阶段都应保持插件可打开、请求可捕获、MCP 可访问。
- 优先复用现有业务函数：请求筛选、MCP 生成、Mock 规则、导入导出、设置保存都不重写。
- 每阶段完成后做最小手动回归，避免最后集中排雷。

## 2. 当前可改造边界

主要文件：

- `extension/content/ui-core.js`
  - 当前负责主面板、顶部 Tab、请求筛选、请求列表、详情、设置页、JSON/改写弹窗和 toast。
  - 第一阶段应优先改这里的壳层和 UI 状态，不碰请求拦截、AI 分析和 Mock 规则底层逻辑。
- `extension/content/mcp-ui.js`
  - 当前负责 MCP 工具列表、调用日志、本地导入导出、MCP 状态条和工具编辑/测试弹窗。
  - MCP 工作台重构应集中在这里，不改变 MCP 工具生成和后台消息协议。
- `extension/content/content.css`
  - 当前已存在基础浮层样式和一段 `refreshed workbench shell`。
  - 新视觉应从该段开始替换，并逐步新增暗色主题 token、宽屏布局、表格和 inspector 样式。

辅助参考：

- `.superpowers/brainstorm/plugin-redesign-directions.html`
  - A 方向作为视觉参考，不直接复制为生产代码。

## 3. 阶段 0：准备与保护

目的：降低后续 UI 重构风险。

改动内容：

- 在实现前确认当前 git 工作树，记录已有未提交文件，避免覆盖用户改动。
- 只在 `extension/content/ui-core.js`、`extension/content/mcp-ui.js`、`extension/content/content.css` 及必要文档内工作。
- 保留旧函数名入口，例如 `refreshMainWorkbench`、`refreshRequestList`、`refreshMainPanelContent`，减少跨文件连锁修改。

验收：

- 不产生功能改动。
- 明确当前未提交文件中哪些是设计/计划文档，哪些是用户已有改动。

## 4. 阶段 1：全局壳层与暗色主题

目标：先搭建新的控制台壳层，不改请求/MCP 的核心内容结构。

改动文件：

- `extension/content/ui-core.js`
- `extension/content/content.css`

计划步骤：

1. 扩展 `ensureMainUiState()`，加入：
   - `state.ui.layoutMode`: `compact` 或 `wide`
   - `state.ui.activeMainTab`: 继续使用 `requests` / `mcp` / `settings`
2. 将 `createMainPanel()` 中的顶部结构调整为：
   - 顶部状态栏：标题、当前站点、请求计数、MCP 状态占位、宽屏切换、设置入口、关闭。
   - 左侧模式栏：请求、MCP、设置。
   - 主内容容器：沿用现有三个 workbench。
3. 增加宽屏切换按钮：
   - 切换 `state.ui.layoutMode`
   - 设置 `data-ai-req-layout="compact|wide"`
   - 宽屏模式不覆盖保存的拖拽位置；退出宽屏回到原浮层位置。
4. 在 `content.css` 中建立暗色主题 token：
   - 背景、边框、文本、弱文本、主强调色、成功/警告/危险色。
   - 替换主面板、按钮、输入框、chip、toast 的基础视觉。

验收：

- 点击悬浮球仍能打开/关闭面板。
- 请求/MCP/设置三个主区仍可切换。
- 宽屏和紧凑模式可切换，小屏宽度下不横向溢出。
- 设置按钮、关闭按钮仍可用。

风险与控制：

- 风险：拖拽逻辑与宽屏布局冲突。
- 控制：宽屏模式下可以禁用拖拽或忽略拖拽保存；紧凑模式保留原拖拽。

## 5. 阶段 2：请求工作台重构

目标：把请求区从“列表展开行”升级为“表格列表 + 右侧详情检查器”。

改动文件：

- `extension/content/ui-core.js`
- `extension/content/content.css`

计划步骤：

1. 扩展请求 UI 状态：
   - `state.ui.requestTable.keyword`
   - `state.ui.requestTable.selectedId`
   - `state.ui.requestTable.detailOpen`
   - 兼容现有 `state.ui.requestKeyword`、`state.expandedReqId`，实现过程中可逐步替换。
2. 在 `createMainPanel()` 的请求 workbench 中新增结构：
   - 请求摘要区：请求总数、已分析、Mock 数、重复数、选中数。
   - 请求工具条：搜索、筛选、分组、批量操作入口。
   - 请求表格容器。
   - 请求详情检查器容器。
3. 将 `refreshRequestList()` 拆成更小的渲染函数：
   - `renderRequestSummary(filteredRecords)`
   - `renderRequestTable(filteredRecords)`
   - `renderRequestInspector(req)`
4. 修改请求行渲染：
   - 不再通过行内展开详情作为宽屏默认交互。
   - 点击行设置选中请求，并刷新右侧 inspector。
   - 紧凑模式下 inspector 可作为覆盖式详情面板。
5. 保留现有详情操作：
   - AI 分析。
   - 修改响应。
   - 高级改写。
   - 生成 MCP 工具。
   - 取消规则和刷新生效。

验收：

- 新请求进入列表后可见。
- 搜索、Mock 筛选、AI 筛选、方法筛选、重复请求筛选、分组仍可用。
- 单选/全选和批量 AI、已选生成 MCP 仍可用。
- 选中请求后详情中可查看请求/响应 JSON，并可执行原有操作。

风险与控制：

- 风险：原 `expandedReqId` 与新 `selectedId` 冲突。
- 控制：先桥接两者，最终由 `selectedId` 驱动详情；保留 `expandedReqId` 兼容旧逻辑直到阶段结束。

## 6. 阶段 3：MCP 工具库重构

目标：把 MCP 工具列表从卡片堆升级为工具表格 + 右侧详情编辑器。

改动文件：

- `extension/content/mcp-ui.js`
- `extension/content/content.css`

计划步骤：

1. 扩展 MCP UI 状态：
   - `state.mcpListUi.selectedToolName`
   - `state.mcpListUi.inspectorOpen`
   - 保留现有 keyword、groupMode、filterEnabled、riskLevels、siteFilter。
2. 重构 `buildMcpToolListHTML()`：
   - 顶部状态条继续保留。
   - 工具栏压缩为搜索、站点、启用、风险、分组。
   - 批量操作条只在已选择时强调显示。
   - 主体改为工具表格 + inspector。
3. 重构 `buildMcpToolListInnerHTML()`：
   - 生成表格式行，包含工具名、来源、方法、路径、风险、启用状态。
   - 点击行设置 `selectedToolName` 并刷新 inspector。
4. 新增或拆分 inspector 渲染函数：
   - 工具描述。
   - 参数 Schema 摘要。
   - 编辑、测试、删除入口。
   - 启用状态。
5. 保留现有编辑/测试弹窗作为第一版 inspector 操作入口，不在本阶段重写复杂表单。

验收：

- 工具列表加载、搜索、站点筛选、启用筛选、风险筛选、分组仍可用。
- 启用/禁用工具仍会同步 MCP。
- 编辑、测试、删除仍可触发。
- 全部导出、已选导出、导入、全选、清选、合并、删除重复、删除已选仍可用。

风险与控制：

- 风险：`patchMcpToolListSection()` 局部更新可能重置 inspector 选择。
- 控制：刷新后如果选中工具仍存在，则恢复选中；不存在则清空 inspector。

## 7. 阶段 4：MCP 调用日志与本地导入导出视觉统一

目标：统一 MCP 子视图的信息结构，避免工具库之外的页面仍保持旧视觉。

改动文件：

- `extension/content/mcp-ui.js`
- `extension/content/content.css`

计划步骤：

1. 调用日志：
   - 将日志列表改为表格样式。
   - 点击日志行在右侧详情显示参数、代理模式、错误详情。
   - 保留当前 `MCP_GET_CALL_LOGS` 消息。
2. 本地导入导出：
   - 顶部显示导出目录状态。
   - 文件列表改为表格。
   - 三种导入策略按钮用明确风险颜色区分。
3. MCP 子视图切换：
   - 仍保留 `list` / `logs` / `localExports` 三个内部 tab。
   - 内部 tab 视觉统一为暗色控制台二级导航。

验收：

- 调用日志正常加载和展开详情。
- 本地目录未配置、目录为空、读取失败、读取成功四种状态可辨识。
- 本地导入三种模式仍可执行。

## 8. 阶段 5：设置页与统一反馈

目标：完善设置页分组与反馈层级，但不改变配置字段。

改动文件：

- `extension/content/ui-core.js`
- `extension/content/content.css`

计划步骤：

1. 设置页分组：
   - AI 配置。
   - MCP Server 配置。
   - 工具生成配置。
   - 导入导出配置。
   - 危险区。
2. 设置草稿：
   - 可先保留当前保存逻辑，不强制引入复杂 draft。
   - 如果输入状态和保存状态冲突明显，再添加 `state.ui.settingsDraft`。
3. 统一反馈：
   - 优化 toast 暗色视觉。
   - 顶部任务条先复用现有 progress bar，再逐步扩展为任务状态。
4. 危险操作确认：
   - 第一版可优先替换高风险路径：清空规则、删除已选工具、清空并导入。
   - 低风险操作暂时保留轻提示。

验收：

- API Key、Base URL、模型、MCP 端口、Token、命名策略、自动同步、导出目录均可保存和回填。
- 原“打开浮层配置”如仍保留，应标为兼容入口或在实现后评估是否移除。
- 高风险操作确认文案包含影响范围。

## 9. 阶段 6：收尾、回归与文档更新

目标：完成全链路验收，修复视觉与交互细节。

计划步骤：

1. 手动回归：
   - 请求捕获、筛选、分组、选择。
   - AI 单条/批量分析。
   - Mock 响应和高级改写。
   - 单条/视图/已选/全部 MCP 生成。
   - MCP 工具库管理。
   - MCP 调用日志。
   - 本地导入导出。
   - 设置保存和回填。
   - 紧凑/宽屏切换。
2. 静态检查：
   - 使用 `ReadLints` 检查改动文件。
   - 如果项目没有测试脚本，不强行添加测试框架。
3. 文档更新：
   - 如果交互和设计规格有偏差，回写 spec 或补充实现说明。
   - 可更新 `MCP-USAGE-GUIDE.md` 或项目说明中的截图/说明，但不作为本次必要项。

## 10. 建议提交拆分

如果后续需要提交，建议拆成小提交或小 PR：

1. `redesign panel shell`
   - 全局壳层、暗色主题、宽屏切换。
2. `redesign request workbench`
   - 请求表格、详情检查器、摘要区。
3. `redesign mcp workbench`
   - MCP 工具表格、inspector、日志和导入导出视觉。
4. `redesign settings and feedback`
   - 设置分组、toast、任务条、危险确认。
5. `docs and regression fixes`
   - 文档、回归修复、细节 polish。

## 11. 不做事项

- 不重写请求拦截、AI 分析、MCP 生成、Native Messaging、后台 Service Worker 协议。
- 不新增独立“规则”或“日志”主页面。
- 不引入图标库、字体包、动画库或打包工具。
- 不把当前所有 `confirm` 一次性替换完；优先替换高风险路径。
- 不在没有测试框架的情况下为了 UI 改造强行引入测试体系。

## 12. 第一轮实施建议

第一轮最适合先做阶段 1。它只改壳层和暗色主题，风险最低，同时能立刻验证宽屏模式、左侧模式栏和整体视觉方向是否成立。

阶段 1 完成后再进入请求工作台，因为请求区牵涉 `refreshRequestList()`、筛选、选择、详情和批量操作，是整个重设计中风险最高的一段。
