# 前端调试流程到 MCP 可用工具闭环设计

日期：2026-06-17  
阶段：Brainstorming 设计稿  
范围：前端调试流程录制、请求筛噪、步骤顺序记录、页面数据溯源、跨环境响应 Mock、MCP 可用性门禁  
非目标：真实写入测试环境后端数据、复杂 DOM 自动化回放、团队云端同步、完整自动化测试脚本生成

## 1. 背景与目标

当前插件已经具备页面内请求捕获、AI 分析、Mock/响应改写、MCP 工具生成、工具测试与本地 MCP Helper 等能力。但现有主路径仍偏向“抓到请求后生成工具”，导致两个问题：

- 前端调试过程中的操作上下文丢失，只看到接口列表，不知道每一步用户操作触发了哪些接口。
- MCP 工具质量不稳定，全量请求中混入静态资源、埋点、国际化、配置、轮询等噪音，AI 调用成功率低。

本设计将产品主线调整为：

```text
用户真实操作一次业务流程
→ 插件按顺序记录操作步骤
→ 将请求归属到具体步骤
→ 自动筛噪并人工确认核心接口
→ 调试 / Mock / 跨环境响应回放
→ 从已验证步骤和接口生成 MCP 工具
→ 工具测试通过后标记 AI 可用
```

产品定位从“抓包 + MCP 生成器”升级为：

> 把前端真实调试流程沉淀为 AI 可稳定调用的业务工具。

## 2. 核心用户旅程

### 2.1 前端开发者

1. 打开业务页面。
2. 点击插件中的“开始录制流程”。
3. 亲自完成一次业务操作，例如查询订单、修改店铺配置、提交表单。
4. 点击“结束录制”。
5. 插件展示按顺序排列的操作步骤，以及每一步触发的请求。
6. 插件自动把请求分为核心业务接口、辅助接口、噪音接口、待确认接口。
7. 开发者手动确认核心接口，必要时进行 Mock/响应改写。
8. 将验证通过的接口生成 MCP 工具。

### 2.2 AI / MCP 使用者

1. 只从“已验证接口”生成 MCP 工具。
2. 工具继承流程上下文：来源流程、步骤序号、触发动作、参数样例、响应样例、风险等级。
3. 工具必须测试通过后，才能标记为 `AI 可用`。
4. MCP 客户端默认只暴露 `AI 可用` 工具，减少 AI 调错工具、乱传参数、误调用噪音接口。

## 3. 信息架构

主导航建议从当前三类扩展为四类：

```text
REQ  请求
FLOW 流程
MCP  工具
SET  设置
```

### 3.1 REQ 请求页

定位：实时抓包与单接口调试。

保留现有能力：

- 实时捕获请求。
- 搜索、筛选、分组。
- 查看请求/响应详情。
- 单条 AI 分析。
- 单条 Mock/响应改写。
- 生成 MCP 工具。

新增能力：

- 添加到当前流程。
- 标记该请求在当前流程中的分类：核心、辅助、噪音、待确认。
- 保存当前响应为响应样本。

请求页是原始流量池，不再承担最终 MCP 可用性管理。

### 3.2 FLOW 流程页

定位：录制、筛噪、验证、沉淀流程资产。

页面结构：

```text
顶部：流程录制控制
- 开始录制
- 结束录制
- 当前流程名称
- 捕获请求数 / 步骤数 / 核心接口数 / 噪音数

中间：有序步骤时间线
- 第 1 步：打开页面
- 第 2 步：点击搜索
- 第 3 步：加载订单列表
- 每步下挂触发请求

右侧：流程检查器
- 流程说明
- 已验证接口
- 关联 Mock 规则
- 响应样本
- 生成已验证接口 MCP 工具
```

核心按钮：

```text
生成已验证接口的 MCP 工具
```

### 3.3 MCP 工具页

定位：工具可用性管理。

新增展示：

- 工具来源流程。
- 工具来源步骤。
- 最近一次测试结果。
- 是否需要登录态。
- 是否有响应样本。
- 是否 AI 可见。
- 质量提示：未测试、参数缺失、命名过长、高风险写操作等。

默认建议：只暴露 `AI 可用` 的工具给 MCP 客户端。其它工具仍在工具库中，但默认不进入 `tools/list`。

### 3.4 页面数据溯源入口

这是全局交互，不固定在某个页面。

用户在业务页面选中文本后，出现轻量悬浮入口：

```text
查找数据来源
```

点击后，插件在最近捕获的响应体中搜索候选接口和字段，并允许用户跳转到请求详情、生成字段级 Mock。

## 4. 自动流程录制设计

自动录制必须记录每一步的顺序，而不是只保存请求集合。

### 4.1 录制事件类型

第一版记录轻量事件，不做完整 DOM 快照或自动化脚本回放。

```text
navigation    页面加载 / URL 变化
user_action   点击、输入、选择、提交
network_group 某个时间窗口内的一组请求
```

### 4.2 Step 模型

```js
flow = {
  id: "flow_xxx",
  name: "订单查询流程",
  hostname: "admin.test.com",
  startedAt: 1718600000000,
  endedAt: 1718600030000,
  steps: [
    {
      id: "step_1",
      index: 1,
      type: "navigation",
      title: "打开订单列表页",
      at: 1718600001000,
      url: "https://test.xxx.com/orders",
      requestIds: ["req1", "req2"]
    },
    {
      id: "step_2",
      index: 2,
      type: "user_action",
      title: "点击搜索按钮",
      at: 1718600008000,
      url: "https://test.xxx.com/orders",
      target: {
        tag: "button",
        text: "搜索",
        id: "",
        name: "",
        className: "search-btn"
      },
      requestIds: ["req3"]
    },
    {
      id: "step_3",
      index: 3,
      type: "network_group",
      title: "加载订单列表数据",
      at: 1718600009000,
      requestIds: ["req4", "req5"]
    }
  ],
  verifiedRequestIds: ["req4"],
  notes: "用于验证订单列表查询",
  mcpToolNames: ["get_order_list"]
};
```

### 4.3 请求归属规则

每个请求仍保留在 `state.requestRecords`，流程只保存引用和元信息。

请求归属建议：

- 录制开始后创建当前 flow。
- 发生 `user_action` 后，短时间窗口内的请求归属到该 step，例如 0–1500ms。
- 如果没有用户动作但出现页面加载请求，则归属到 `navigation` step。
- 同一操作触发多个请求时，形成一个 `network_group` 或挂在同一 `user_action` 下。
- 无法归属的请求进入 `unknown` step，供用户手动整理。

请求附加流程元信息：

```js
requestFlowMeta = {
  flowId: "flow_xxx",
  stepId: "step_2",
  stepIndex: 2,
  classification: "core"
};
```

### 4.4 请求分类

每条请求在流程内有分类，而不是全局固定分类：

```text
core       核心业务接口
support    辅助接口
noise      噪音接口
unknown    待确认
```

自动筛噪启发式：

- 静态资源：`.js`、`.css`、图片、字体、map 文件。
- 埋点监控：`track`、`log`、`analytics`、`sentry`、`beacon`。
- 国际化：`i18n`、`locale`、`translation`。
- 配置字典：`config`、`dict`、`setting`，默认归为辅助，不直接噪音。
- 轮询心跳：短时间内重复、无业务响应结构的计数类接口。

用户可以手动修正分类，手动结果优先于自动分类。

## 5. 页面数据溯源

### 5.1 目标

开发者选中页面上的文本后，插件帮助判断这个值可能来自哪个接口、哪个 JSON 字段，并提供字段级 Mock 入口。

### 5.2 候选匹配

第一版只做可解释匹配：

- 精确字符串匹配。
- 数字转字符串匹配。
- 简单去空格匹配。

不承诺复杂场景自动准确定位：

- 枚举映射，例如 `1` 显示为 `已支付`。
- 时间格式化。
- 多字段拼接。
- 多接口重复值。
- 前端本地计算值。

候选模型：

```js
fieldSourceCandidate = {
  selectedText: "已支付",
  candidates: [
    {
      requestId: "req1",
      method: "GET",
      pathname: "/adminapi/order/orderList",
      jsonPath: "data.records[0].payStatusText",
      value: "已支付",
      matchType: "exact",
      confidence: 0.95
    }
  ]
};
```

用户确认后保存：

```js
confirmedFieldSource = {
  id: "src_xxx",
  flowId: "flow_xxx",
  requestId: "req1",
  selectedText: "已支付",
  jsonPath: "data.records[0].payStatusText",
  confirmedAt: 1718600100000
};
```

### 5.3 一键修改的可行性

可行，但第一版只做字段级 Mock，不做真实后端修改。

流程：

1. 用户选中文本。
2. 插件展示候选来源接口/字段。
3. 用户确认字段。
4. 用户输入新值。
5. 插件生成响应改写规则，作用于对应接口与 JSON Path。
6. 用户选择仅下一次生效或持久生效。

## 6. 跨环境响应 Mock

### 6.1 目标

将正式环境捕获到的响应样本，应用为测试环境同接口的浏览器侧 Mock，帮助前端复现线上问题或构造测试数据。

### 6.2 原则

第一版只做浏览器侧 Mock/回放：

- 不调用测试环境写接口。
- 不写测试数据库。
- 不改变后端真实数据。
- 默认要求用户确认源环境和目标环境。
- 高风险接口需二次确认。

### 6.3 响应样本

```js
responseSample = {
  id: "sample_xxx",
  sourceEnv: "prod",
  sourceOrigin: "https://prod.example.com",
  method: "GET",
  pathname: "/adminapi/order/orderList",
  responseStatus: 200,
  responseHeaders: {},
  responseBody: {},
  capturedAt: 1718600200000,
  sourceRequestId: "req1"
};
```

### 6.4 环境回放规则

```js
envReplayRule = {
  id: "replay_xxx",
  sampleId: "sample_xxx",
  targetEnv: "test",
  targetOrigin: "https://test.example.com",
  method: "GET",
  pathname: "/adminapi/order/orderList",
  mode: "next", // next | persistent
  enabled: true
};
```

命中规则：

```text
targetOrigin + method + normalized pathname
```

命中后复用现有 Mock/响应改写链路返回样本响应。

## 7. MCP 可用性门禁

MCP 工具不再默认从所有请求生成，而是优先从已验证流程步骤生成。

### 7.1 工具元信息

```js
_meta: {
  flowId: "flow_xxx",
  flowStepId: "step_2",
  flowStepIndex: 2,
  flowStepTitle: "点击搜索按钮",
  sourceRequestIds: ["req4"],
  verified: true,
  lastTestStatus: "passed",
  lastTestAt: 1718600300000,
  aiVisible: true,
  qualityWarnings: []
}
```

### 7.2 状态流转

```text
captured → verified → generated → tested → aiVisible
```

含义：

- `captured`：请求已被流程录制。
- `verified`：开发者确认是核心接口。
- `generated`：已生成 MCP 工具。
- `tested`：工具测试通过。
- `aiVisible`：暴露给 AI。

默认建议：只有 `aiVisible=true` 且 `lastTestStatus=passed` 的工具进入 MCP `tools/list`。

## 8. 存储设计

新增 Chrome storage key：

```text
ai_req_flows_<hostname>
ai_req_response_samples_<hostname>
ai_req_field_sources_<hostname>
ai_req_env_replay_rules_<hostname>
```

保留现有：

```text
ai_req_mcp_tools_<hostname>
ai_req_mock_rules_<hostname>
```

流程只保存请求 ID 引用和必要元信息，不复制完整请求体，避免存储膨胀。

## 9. 阶段拆分

### 9.1 第一版范围

优先实现：

```text
流程录制
→ 按顺序记录用户步骤
→ 将请求归属到步骤
→ 自动筛噪
→ 人工确认核心接口
→ 从已验证步骤/接口生成 MCP
→ 工具测试通过后标记 AI 可用
```

包含：

- FLOW 主入口。
- 开始/结束录制。
- 有序步骤时间线。
- 请求自动分类与人工修正。
- 核心接口标记为已验证。
- 从已验证接口生成 MCP。
- MCP 工具增加来源流程、步骤和可用状态。

### 9.2 第二版范围

- 页面选中文本数据溯源。
- 候选接口/字段弹窗。
- 字段级 Mock 规则生成。

### 9.3 第三版范围

- 正式环境响应样本保存。
- 测试环境浏览器侧响应回放。
- 环境映射管理。

## 10. 风险与约束

### 10.1 技术风险

- 用户操作和请求归属可能不准确，需要人工修正。
- 页面选中文本可能有多个候选来源，只能提供候选，不应宣称绝对准确。
- 响应样本可能很大，需要限制保存体积并提示脱敏。
- 跨环境 Mock 只适合浏览器侧验证，不等同于真实测试数据迁移。

### 10.2 产品风险

- 如果流程页过重，会让简单抓包变复杂。请求页仍需保留快速单接口调试。
- 如果默认不暴露未测试工具，用户可能觉得工具变少，需要清楚展示“待测试工具”。
- 生产响应样本可能含敏感信息，保存和导出必须提示脱敏。

## 11. 验收标准

第一版验收：

- [ ] 用户可以开始/结束流程录制。
- [ ] 录制结果按步骤顺序展示。
- [ ] 点击、输入、页面跳转等事件至少能形成可读步骤。
- [ ] 录制期间触发的请求能归属到步骤。
- [ ] 请求可被分类为核心、辅助、噪音、待确认。
- [ ] 用户可以手动修改分类。
- [ ] 已验证核心接口可以生成 MCP 工具。
- [ ] MCP 工具能显示来源流程与步骤。
- [ ] 工具测试通过后可标记 AI 可用。
- [ ] MCP 默认优先暴露 AI 可用工具。

后续验收：

- [ ] 选中文本后能展示候选接口和 JSON 字段。
- [ ] 确认字段后能生成字段级 Mock。
- [ ] 正式环境响应样本能应用到测试环境同接口 Mock。

## 12. 非目标

- 不做真实测试环境数据写入。
- 不做完整自动化测试脚本生成。
- 不做复杂 DOM 快照与像素级页面回放。
- 不做生产数据云同步。
- 不默认让 AI 调用高风险写操作。

