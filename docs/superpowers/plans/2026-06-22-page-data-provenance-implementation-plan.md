# 页面数据溯源实施计划

日期：2026-06-22  
来源规格：`docs/superpowers/specs/2026-06-22-page-data-provenance-design.md`  
第一版目标：用户在页面上选中文本后，能从当前/最近 Flow 与最近请求中找到候选 JSON 字段，确认后生成字段级 Mock patch，只修改该 JSON Path 验证 UI。

## 1. 实施原则

- 主入口只有一个：页面选中文本 →「查来源」→ 候选弹窗 → 字段 Mock。
- 候选匹配只做响应 JSON primitive 的精确/包含/规范化匹配，不做 AI 语义、不做 DOM 语义。
- 字段 Mock 复用现有 `mockRules`，扩展 `response.patches`，不新建独立 Mock 系统。
- patch 生效规则：`base body（整响应 body 或真实响应）→ enabled patches`。
- 所有 mock rule 读写路径必须保留 `response.patches`。
- 每个 Phase 完成后扩展可加载，请求捕获、Flow 录制、整响应 Mock、MCP 工具不回退。

## 2. 当前代码边界

| 文件 | 现状 | 本计划改动 |
|------|------|------------|
| `extension/content/state.js` | 有 Flow/MCP 状态，无 field source | 增加 `fieldSources`、storage key、读写函数 |
| `extension/content/mock-rules.js` | `normalizeRule` 不含 `patches`；`hasResponseBodyMock` 只看 `bodyEnabled` | 扩展 rule 归一化；新增 patch 应用 helper |
| `extension/content/core.js` | XHR/Fetch 拦截；整响应 Mock 短路 | 真实响应返回前应用 patches；记录 patch warning |
| `extension/content/page-hook.js` | MAIN world 拦截，独立 `normalizeRule` | 同步 patches 逻辑到 page-hook |
| `extension/content/ui-core.js` | 请求/Flow/MCP 工作台 | 新增选区入口、候选弹窗、字段 Mock 编辑 |
| `extension/content/content.css` | 已有深色工作台样式 | 查来源浮层、候选弹窗、patch 编辑样式 |
| `extension/manifest.json` | 无 provenance 模块 | 追加 `field-provenance.js`（在 `mock-rules.js` 之后） |

建议新增文件：

```text
extension/content/field-provenance.js   # 候选搜索、JSON 遍历、评分、patch 读写
extension/content/json-path.js          # JSON Path 解析/设置（可选，也可内联在 field-provenance.js）
```

若保持文件数最小，可将 JSON Path 与 provenance 合并到 `field-provenance.js`。

## 3. Phase 0：保护与基线

目标：确认现有链路可加载，明确 patch 插入点。

步骤：

1. 对 `mock-rules.js`、`core.js`、`page-hook.js`、`ui-core.js` 做 `node --check`。
2. 确认 `normalizeRule` 在 content 与 page-hook 两处都存在，后续需双端同步。
3. 确认 `hasResponseBodyMock` 当前只在 `bodyEnabled === true` 时短路；字段 patch 不能走这条短路，必须走“真实响应 + patch”路径。
4. 记录 patch 应用插入点：
   - `core.js`：`interceptXHR` / `interceptFetch` 的 `readystatechange` / `then` 回调中，写入 `responseBody` 前。
   - `page-hook.js`：对应 MAIN world 拦截回调中。

验证：

- 扩展可 reload。
- 现有整响应 Mock 仍生效。

---

## 4. Phase 1：数据层与 JSON Path 工具

目标：可独立测试字段来源存储、JSON 遍历、候选评分，UI 尚未接入。

### 4.1 `state.js` 增量

```js
var FIELD_SOURCES_KEY_PREFIX = 'ai_req_field_sources_';

state.fieldSources = {}; // id -> record

function loadFieldSources() { ... }
function saveFieldSources() { ... }
function upsertFieldSource(record) { ... }
function listFieldSources() { ... }
```

在 `isolated.js` 的 `storageHydrateThen` 中调用 `loadFieldSources()`。

### 4.2 JSON Path 工具

实现最小能力（建议 `field-provenance.js` 或 `json-path.js`）：

```js
function isSupportedJsonPath(path) { ... }      // 拒绝特殊 key、通配符
function getValueAtJsonPath(obj, path) { ... }
function setValueAtJsonPath(obj, path, value) { ... }  // 仅替换已存在路径
function formatJsonPathFromSegments(segments) { ... }  // $.a.b[2].c
```

规则：

- 只支持 `$` 根、`.` 属性、`[n]` 数组索引。
- key 含 `.`, `[`, `]`, 引号时 `isSupportedJsonPath === false`。
- `setValueAtJsonPath` 路径不存在时返回 `{ ok: false, reason: 'PATH_NOT_FOUND' }`。

### 4.3 候选搜索引擎

新增：

```js
function normalizeMatchText(text) { ... }
function matchPrimitiveValue(selectedText, value) { ... }  // exact | contains | normalized | null
function walkJsonPrimitives(value, pathSegments, visitor, limits) { ... }
function collectCandidateRequests(selectedText, options) { ... }
function scoreFieldCandidate(ctx) { ... }
function findFieldSourceCandidates(selectedText, options) { ... }
```

`collectCandidateRequests` 搜索范围：

1. 当前/最近 Flow 的 `step.requestIds` 对应记录。
2. 当前页面 URL 最近请求（同 pathname 或同页捕获）。
3. 当前 hostname 其它最近请求。

跳过：静态资源、埋点、AI API、非 JSON 响应。

限制：

- 最大节点数，例如 `8000`。
- 最大响应文本，例如 `512KB`。
- 超限设置 `partialSearch: true`。

返回最多 10 个 `FieldSourceCandidate`。

### 4.4 Phase 1 验证

控制台手动调用：

```js
findFieldSourceCandidates('张三')
```

预期：

- 返回带 `jsonPath`、`mockKey`、`matchReasons`、`confidenceLevel` 的候选数组。
- 精确匹配排在前面。
- 大响应体出现 `partialSearch: true`。

---

## 5. Phase 2：Mock patch 扩展

目标：字段 patch 能在 XHR/Fetch 拦截链路中生效，且与整响应 Mock 叠加。

### 5.1 扩展 `normalizeRule`

在 `mock-rules.js` 的 `response` 归一化中增加：

```js
patches: Array.isArray(response.patches)
  ? response.patches.map(normalizePatch).filter(Boolean)
  : []
```

`normalizePatch` 保留：

```js
{ id, enabled, jsonPath, value, valueType, sourceId, createdAt }
```

`page-hook.js` 内联 `normalizeRule` 同步相同逻辑。

### 5.2 patch 应用 helper

新增：

```js
function getEnabledResponsePatches(rule) { ... }
function hasResponsePatches(rule) { ... }
function applyResponsePatches(baseBody, patches) {
  // 返回 { body, warnings: [] }
}
function buildMockedResponseBody(rule, realBody) {
  var base = rule.response.bodyEnabled === true ? rule.response.body : realBody;
  return applyResponsePatches(base, getEnabledResponsePatches(rule));
}
```

规则：

- `bodyEnabled === true` 时 base 为整响应 body。
- 否则 base 为真实响应体。
- patch 失败只追加 warning，不抛错。
- 非 JSON base 跳过 patch，返回原 base。

### 5.3 拦截链路接入

**content `core.js`：**

- XHR `readystatechange`：拿到 `respBody` 后，若 rule 有 patches，调用 `buildMockedResponseBody`。
- Fetch `then`：clone 响应 text 解析后同样处理。
- 若仅有 patches、无整响应 Mock，也要对真实响应应用 patch 并写入 `requestRecord.responseBody`。
- patch warnings 可写入 `record.patchWarnings`（轻量字符串数组）。

**page-hook `page-hook.js`：**

- 同步上述逻辑，确保 MAIN world 请求也生效。
- 注意：当前 page-hook 在 `hasResponseBodyMock` 时直接短路；有 patches 但无整响应 Mock 时不能短路，应走真实请求再 patch。

### 5.4 patch 持久化 API

新增：

```js
function upsertFieldMockPatch(mockKey, method, patch, options) { ... }
function removeFieldMockPatch(mockKey, method, patchId) { ... }
```

- 基于 `mockKey + method` 找到/创建 rule。
- 同 `jsonPath` 已有 patch 时覆盖。
- 保存后 `saveMockRules()` + `syncMockRulesToPage()`。
- 简单 Mock、高级改写保存时保留已有 `patches`。

### 5.5 Phase 2 验证

1. 手动给某接口写入 patch，刷新页面，确认仅该字段变化。
2. 同时存在整响应 Mock + patch，确认 patch 在整响应 body 上生效。
3. 路径不存在时请求仍成功，console/toast 有 warning。
4. 高级改写保存后 patches 未丢失。

---

## 6. Phase 3：页面选区入口

目标：选中文本后出现「查来源」浮层按钮。

### 6.1 选区监听

在 `field-provenance.js` 或 `ui-core.js` 增加：

```js
function setupPageSelectionProvenance() { ... }
```

行为：

- 监听 `mouseup` / `selectionchange`（debounce）。
- 读取 `window.getSelection()` 文本，去空白。
- 空选区、插件 UI 内选区（复用 `isInsideAiReqUi`）忽略。
- 文本过长（例如 > 120 字符）截断并标记。
- 在选区 rect 附近渲染 `.ai-req-provenance-trigger` 按钮「查来源」。

### 6.2 样式

`content.css` 新增：

- `.ai-req-provenance-trigger` 小浮层按钮。
- 不遮挡页面主要交互，z-index 与现有浮层一致。

### 6.3 Phase 3 验证

1. 页面选中普通文本，出现「查来源」。
2. 插件面板内选中不出现。
3. 点击空白处按钮消失。

---

## 7. Phase 4：候选弹窗与字段 Mock 编辑

目标：完整用户闭环。

### 7.1 候选弹窗

新增 UI 函数（建议放 `ui-core.js`，逻辑调用 `field-provenance.js`）：

```js
function openFieldProvenanceDialog(selectedText, candidates, meta) { ... }
function renderFieldProvenanceCandidates(listEl, candidates) { ... }
function renderFieldMockEditor(panelEl, candidate) { ... }
```

弹窗结构：

1. 顶部摘要：选中文本、搜索范围、候选数、免责声明。
2. 候选列表：method + path、jsonPath、当前值、Flow/Step、匹配原因、置信度。
3. 编辑区：原值、新值、类型、生效模式（持久/仅下一次）、保存、跳转请求详情。

交互：

- 点击「查来源」→ `findFieldSourceCandidates` → 打开弹窗。
- 无候选：展示空态 +「打开最近请求列表」。
- `partialSearch`：顶部 warning。
- 多个候选接近：不自动选中。

### 7.2 保存字段 Mock

保存时：

1. 解析新值与类型。
2. `upsertFieldSource(...)` 写入 `ai_req_field_sources_<hostname>`。
3. `upsertFieldMockPatch(mockKey, method, patch, { once })`。
4. Toast：`字段 Mock 已保存，刷新或重放请求验证`。
5. 若该接口已有整响应 Mock，编辑区显示提示。

类型解析：

- string / number / boolean / null / object / array。
- object/array 用 JSON textarea，失败不保存。

### 7.3 跳转请求详情

- 关闭弹窗，打开主面板 REQ tab。
- 定位 `requestId` 对应记录并展开 inspector。

### 7.4 Phase 4 验证

1. 选中文本 → 查来源 → 看到候选列表。
2. 选择候选 → 输入新值 → 保存成功。
3. 刷新页面后 UI 显示新值，其它字段不变。
4. 跳转请求详情可用。

---

## 8. Phase 5：manifest、文档与回归

### 8.1 `manifest.json`

在 `mock-rules.js` 之后插入：

```json
"content/field-provenance.js"
```

若拆出 `json-path.js`，放在 `field-provenance.js` 之前。

### 8.2 文档

更新：

- `MCP-USAGE-GUIDE.md`：增加「页面数据溯源 / 字段 Mock」使用说明。
- 可选：`AI-REQUEST-ANALYZER-FOR-AI-V2.md` 增加 storage key 说明。

### 8.3 回归清单

| # | 场景 | 预期 |
|---|------|------|
| 1 | 选中文本 | 出现「查来源」 |
| 2 | 精确匹配 | 高置信候选靠前 |
| 3 | 保存字段 Mock | 仅 patch 目标字段 |
| 4 | 整响应 Mock + patch | 叠加生效 |
| 5 | 路径不存在 | 原响应 + warning |
| 6 | 非 JSON 响应 | 跳过 patch |
| 7 | 高级改写保存 | patches 保留 |
| 8 | Flow 录制 | 不回退 |
| 9 | MCP 工具 | 不回退 |
| 10 | 超限响应 | 提示候选不完整 |

### 8.4 语法检查

```bash
node --check extension/content/field-provenance.js
node --check extension/content/mock-rules.js
node --check extension/content/core.js
node --check extension/content/ui-core.js
```

---

## 9. 文件变更摘要

```
extension/manifest.json                         # +field-provenance.js
extension/content/state.js                      # fieldSources 存储
extension/content/field-provenance.js           # 新建：候选搜索 + patch API
extension/content/mock-rules.js                 # patches 归一化 + apply helper
extension/content/core.js                       # 拦截链路应用 patches
extension/content/page-hook.js                  # MAIN world 同步 patches
extension/content/ui-core.js                    # 选区入口 + 候选弹窗 + 保存
extension/content/isolated.js                   # loadFieldSources()
extension/content/content.css                   # 新 UI 样式
docs/superpowers/specs/2026-06-22-page-data-provenance-design.md
docs/superpowers/plans/2026-06-22-page-data-provenance-implementation-plan.md
MCP-USAGE-GUIDE.md                              # 用法补充
```

## 10. 建议实施顺序

```text
Phase 0 (基线)
→ Phase 1 (候选引擎 + 存储)
→ Phase 2 (patch 生效)
→ Phase 3 (选区入口)
→ Phase 4 (弹窗 + 保存)
→ Phase 5 (文档 + 回归)
```

每 Phase 结束 reload 扩展，跑该 Phase 验证项后再进入下一 Phase。

## 11. 风险与回滚

| 风险 | 缓解 |
|------|------|
| page-hook 与 content 双份逻辑漂移 | patch helper 尽量只在 content 定义，page-hook 复制最小调用面 |
| 大 JSON 遍历卡顿 | 节点/体积限制 + 异步分片 |
| normalizeRule 丢 patches | Phase 2 专门回归高级改写/简单 Mock |
| 候选误匹配 | 文案强调“候选来源”，展示 matchReasons |

回滚：

- 移除 manifest 中 `field-provenance.js` 与选区监听。
- 保留 storage 数据但不读取。
- `response.patches` 保留在 rule 中无害，可后续手动清理。

---

**状态**：待实施  
**Spec 审批**：2026-06-22 用户确认「继续」
