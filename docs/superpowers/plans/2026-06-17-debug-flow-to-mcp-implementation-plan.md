# 前端调试流程到 MCP 可用工具闭环实现计划

日期：2026-06-17  
来源规格：`docs/superpowers/specs/2026-06-17-debug-flow-to-mcp-design.md`  
第一版目标：实现流程录制、有序步骤、请求归属、自动筛噪、人工验证核心接口、从已验证接口生成 MCP 工具，并将工具测试状态作为 AI 可用门禁。

## 1. 实施原则

- 第一版只实现 spec 中阶段 1 的核心闭环，不做页面数据溯源和跨环境 Mock。
- 保留现有请求捕获、Mock、MCP 生成与工具测试入口，采用增量状态和增量 UI。
- 不重写架构，不引入 React/Tailwind/构建链。
- 每个阶段都保持插件可加载、请求可捕获、MCP 现有功能可用。
- 任何自动分类都必须允许人工修正，人工修正优先。
- 流程记录只保存请求 ID 和轻量步骤信息，不复制完整请求体。

## 2. 当前代码边界

主要文件：

- `extension/content/state.js`
  - 增加流程相关状态、存储 key、默认 UI 状态。
- `extension/content/core.js`
  - 在请求进入 `addRequestRecord` 时归属到当前录制流程。
  - 监听轻量用户操作事件并生成 step。
- `extension/content/ui-core.js`
  - 增加 FLOW 主导航入口。
  - 请求页增加“添加到当前流程 / 分类 / 验证”操作。
- `extension/content/mcp-ui.js`
  - 工具列表展示来源流程、步骤、测试状态、AI 可用状态。
  - 工具测试通过后更新 `_meta.usability`。
- `extension/content/mcp-engine.js`
  - 从已验证流程请求生成 MCP 工具。
  - 工具 `_meta` 写入 flow/step/sourceRequestIds/usability。
- `extension/content/content.css`
  - 新增 FLOW 页面、步骤时间线、分类标签、可用状态样式。
- `AI-REQUEST-ANALYZER-FOR-AI-V2.md`
  - 最后同步新增状态与验收说明。

## 3. 新增数据模型

### 3.1 state 增量

```js
state.flows = {};
state.activeFlowId = null;
state.flowRecording = false;
state.flowUi = {
  selectedFlowId: null,
  selectedStepId: null,
  filterClassification: "all"
};
```

### 3.2 存储 key

```text
ai_req_flows_<hostname>
```

第一版暂不落地：

```text
ai_req_response_samples_<hostname>
ai_req_field_sources_<hostname>
ai_req_env_replay_rules_<hostname>
```

### 3.3 Flow 对象

```js
{
  id: "flow_xxx",
  name: "未命名流程",
  hostname: location.hostname,
  startedAt: Date.now(),
  endedAt: null,
  steps: [],
  verifiedRequestIds: [],
  classifications: {},
  notes: "",
  mcpToolNames: []
}
```

### 3.4 Step 对象

```js
{
  id: "step_xxx",
  index: 1,
  type: "user_action",
  title: "点击 搜索",
  at: Date.now(),
  url: location.href,
  target: {
    tag: "button",
    text: "搜索",
    id: "",
    name: "",
    className: "search-btn"
  },
  requestIds: []
}
```

### 3.5 请求流程元信息

避免直接大改 request schema，第一版可以使用 flow 内部映射：

```js
flow.requestMeta = {
  reqId: {
    stepId: "step_xxx",
    stepIndex: 1,
    classification: "core"
  }
};
```

## 4. 阶段 0：保护与基线检查

目标：先确认当前修复后的基础功能可用，避免在已有不稳定状态上继续叠功能。

步骤：

1. 对以下文件做语法检查：
   - `extension/background.js`
   - `extension/content/core.js`
   - `extension/content/mcp-engine.js`
   - `extension/content/mcp-ui.js`
   - `extension/mcp-helper/server.mjs`
2. 手动确认：
   - 扩展可加载。
   - 页面请求可捕获。
   - MCP 可启动。
   - 工具测试不再出现 Service Worker 语法崩溃。

验收：

- [ ] 请求列表能出现新请求。
- [ ] MCP 状态能显示已启动或明确错误。
- [ ] Service Worker 控制台无语法错误。

## 5. 阶段 1：流程状态与存储

目标：建立 Flow 数据结构，但不改 UI 主路径。

步骤：

1. 在 `state.js` 中新增：
   - `state.flows`
   - `state.activeFlowId`
   - `state.flowRecording`
   - `state.flowUi`
2. 新增存储 key 常量：
   - `FLOWS_KEY_PREFIX = 'ai_req_flows_'`
3. 实现工具函数：
   - `getFlowsKey()`
   - `loadFlows()`
   - `saveFlows()`
   - `createFlow(name)`
   - `finishFlow(flowId)`
   - `getActiveFlow()`
4. 在 `isolated.js` 启动流程中加载 flows。

验收：

- [ ] 插件启动后能从 storage 恢复 flows。
- [ ] 创建流程后刷新页面仍可读回。
- [ ] 不影响现有请求捕获和 MCP 工具加载。

## 6. 阶段 2：有序步骤录制

目标：开始/结束录制后能生成可读的有序步骤。

步骤：

1. 在 `core.js` 中增加录制事件监听：
   - `click`
   - `input` / `change`
   - `submit`
   - `popstate` / URL 变化轮询或轻量检测
2. 事件记录规则：
   - 只在 `state.flowRecording === true` 时记录。
   - 对高频 `input` 做 debounce，只保留字段变更摘要，不保存敏感输入值。
   - 忽略插件自身 DOM 内的点击。
3. 生成 step：
   - `type`
   - `title`
   - `at`
   - `url`
   - `target` 轻量信息
   - `index`
4. 维护最近 step：
   - `state.activeFlowLastStepId`
   - `state.activeFlowLastActionAt`

隐私约束：

- 不保存 password 输入值。
- 不保存完整 DOM。
- `input` 只记录字段名/placeholder/type，不记录实际文本，除非后续用户明确开启。

验收：

- [ ] 点击按钮能生成 step。
- [ ] 输入表单能生成 step，但不保存敏感输入值。
- [ ] 页面跳转能生成 navigation step。
- [ ] step index 按时间递增。

## 7. 阶段 3：请求归属到步骤

目标：录制期间每条请求能挂到最近的操作步骤。

步骤：

1. 在 `addRequestRecord(record)` 中判断当前是否正在录制。
2. 为新请求选择 step：
   - 若最近 `user_action` 在 1500ms 内，归属到该 step。
   - 否则若当前有 navigation step，归属到 navigation。
   - 否则创建 `network_group` 或 `unknown` step。
3. 将 `record.id` 加入 `step.requestIds`。
4. 写入 `flow.requestMeta[record.id]`。
5. 对请求自动分类，默认写入 `flow.classifications[record.id]`。

验收：

- [ ] 点击后触发的一组请求能挂在同一个 step 下。
- [ ] 页面加载阶段请求能挂到 navigation。
- [ ] 无法归属的请求不会丢失，会进入 unknown/network_group。
- [ ] 录制结束后步骤和请求归属可持久化。

## 8. 阶段 4：自动筛噪与人工分类

目标：流程内请求能分为核心、辅助、噪音、待确认。

步骤：

1. 在 `mcp-engine.js` 或新建轻量分类工具函数中实现：
   - `classifyFlowRequest(record)`
2. 分类规则：
   - 静态资源：`noise`
   - 埋点/日志/监控：`noise`
   - 国际化：`noise` 或 `support`，默认 `noise`
   - config/dict/setting：`support`
   - GET 且业务路径明显、响应为对象/数组：`core` 候选
   - POST/PUT/PATCH/DELETE：默认 `core` 候选，但高风险加 warning
   - 无法判断：`unknown`
3. FLOW 页面允许人工切换分类：
   - core
   - support
   - noise
   - unknown
4. 人工修改后写入 `flow.classifications`，覆盖自动结果。

验收：

- [ ] 静态资源不会出现在核心接口列表。
- [ ] i18n/locale/translation 默认不进核心。
- [ ] 用户能手动把任意请求改成 core/support/noise/unknown。
- [ ] 刷新后分类保持。

## 9. 阶段 5：FLOW 页面 UI

目标：新增 FLOW 主入口，并展示录制控制、步骤时间线、流程检查器。

步骤：

1. 在主导航中新增 `FLOW 流程`。
2. 新增 `renderFlowWorkbench()`。
3. 顶部控制区：
   - 开始录制
   - 结束录制
   - 流程名称输入
   - 步骤数 / 请求数 / 核心接口数 / 噪音数
4. 中间步骤时间线：
   - step index
   - step title
   - step type
   - step 下请求列表
   - 请求分类标签
5. 右侧检查器：
   - 当前 step 详情
   - 已验证接口
   - 生成 MCP 工具按钮
6. 请求页增加入口：
   - 添加到当前流程
   - 修改当前流程分类

验收：

- [ ] 可以从侧边栏进入 FLOW 页面。
- [ ] 开始/结束录制按钮状态正确。
- [ ] 有序步骤可读。
- [ ] 每个 step 下能看到触发请求。
- [ ] 可以将核心请求标记为已验证。

## 10. 阶段 6：从已验证接口生成 MCP

目标：MCP 工具优先从已验证流程请求生成，并携带流程上下文。

步骤：

1. 新增生成入口：
   - `generateMcpToolsFromFlowVerifiedRequests(flowId)`
2. 数据源：
   - `flow.verifiedRequestIds`
   - 或 classification 为 `core` 且用户已确认 verified 的请求
3. 调用现有生成器：
   - 优先复用 `pickGeneratorForRequests()`
   - 不改变“一键生成全部 MCP”的历史行为
4. 生成后为工具 `_meta` 增加：
   - `flowId`
   - `flowStepId`
   - `flowStepIndex`
   - `flowStepTitle`
   - `sourceRequestIds`
   - `verified: true`
   - `lastTestStatus: 'untested'`
   - `aiVisible: false`
   - `qualityWarnings`
5. 将生成工具名写入 `flow.mcpToolNames`。

验收：

- [ ] 未验证请求不会被 FLOW 生成入口生成。
- [ ] 生成工具能显示来源流程和步骤。
- [ ] 旧的一键生成 MCP 行为不变。
- [ ] 生成后工具默认未测试、不可 AI 可见。

## 11. 阶段 7：MCP 可用性门禁

目标：工具测试通过后才能标记 AI 可用。

步骤：

1. 在 MCP 工具列表展示：
   - 来源流程
   - 来源步骤
   - 测试状态
   - AI 可用开关
2. 工具测试成功后：
   - `_meta.lastTestStatus = 'passed'`
   - `_meta.lastTestAt = Date.now()`
3. 工具测试失败后：
   - `_meta.lastTestStatus = 'failed'`
   - `_meta.lastTestError = error`
4. AI 可用开关规则：
   - 通过测试后可开启。
   - 高风险工具开启时二次确认。
5. 同步到 Helper 时过滤：
   - 第一版建议保守：默认仍同步 enabled 工具，但 UI 明确推荐只开启 AI 可用。
   - 如果要严格门禁，则 `syncToolsToHelper()` 只同步 `enabled !== false && _meta.aiVisible === true` 的工具。该行为会改变旧体验，建议放到设置项控制。

推荐第一版策略：

```text
新增配置：只向 MCP 暴露 AI 可用工具
默认关闭，避免破坏老用户；新流程引导用户开启。
```

验收：

- [ ] 工具测试结果能持久化。
- [ ] 工具列表能筛选未测试/已测试/AI 可用。
- [ ] 开启门禁配置后，未 AI 可用工具不进入 `tools/list`。
- [ ] 关闭门禁配置后，旧行为保持。

## 12. 阶段 8：文档与回归

更新文档：

- `AI-REQUEST-ANALYZER-FOR-AI-V2.md`
  - 新增 Flow 状态、存储 key、操作说明、验收清单。
- 可选新增用户文档：
  - `docs/debug-flow-to-mcp-usage.md`

回归清单：

- [ ] 请求捕获仍正常。
- [ ] Mock/响应改写仍正常。
- [ ] 一键生成 MCP 旧入口仍正常。
- [ ] MCP 启动和工具测试仍正常。
- [ ] FLOW 录制不影响普通请求页性能。

## 13. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 操作步骤过多 | 对 input/change debounce，连续同类事件合并 |
| 请求归属不准确 | 提供人工移动请求到其它 step |
| 分类误判 | 人工分类优先 |
| 存储膨胀 | 只存 requestId 和轻量 step，不复制响应体 |
| 破坏旧 MCP 行为 | FLOW 生成入口新增，不改变一键生成全部 |
| AI 可用门禁影响老用户 | 使用配置项控制，默认不强制 |

回滚方式：

- 移除 FLOW 主入口。
- 保留 storage 数据但不读取。
- MCP 生成回到旧入口。

## 14. 建议提交顺序

1. `state.js` + 存储函数。
2. `core.js` 流程录制与请求归属。
3. `ui-core.js` + `content.css` FLOW 页面。
4. `mcp-engine.js` 已验证接口生成 MCP。
5. `mcp-ui.js` 工具可用状态。
6. 文档与回归清单。

每个提交后至少做一次扩展加载与请求捕获 smoke test。

