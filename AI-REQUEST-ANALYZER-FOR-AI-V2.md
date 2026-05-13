# AI 请求智能分析助手 · Manifest V3 · AI / 协作必读（单一文档）

> **本文为仓库唯一的结构化上手说明书**。请以源码与本文档为准；旧版 [AI-REQUEST-ANALYZER-SPEC.md](AI-REQUEST-ANALYZER-SPEC.md) 与 [AI-REQUEST-ANALYZER-FOR-AI.md](AI-REQUEST-ANALYZER-FOR-AI.md) **已弃用**。

产品形态：**Chromium MV3 扩展**，在 `document_start` 拦截 Fetch/XHR，聚合请求，支持 Kimi（OpenAI 兼容 `/chat/completions`）语义分析、Mock / 高级改写、[MCP](https://modelcontextprotocol.io/) 工具生成与代理调用。

文末 **§9 · 操作手册** 与 **§10 · 验收清单** 供最终用户与 QA 直接取用。

---

## 1. 模块加载顺序（禁止打乱）

`extension/manifest.json` `content_scripts.js` 数组顺序（共享同一隔离世界，全局 `function` / `var` 可见）：

1. `state.js` — 常量、`state`、`storage*`
2. `mock-rules.js` — `getMockKey`、`normalizeRule`、`findDebugRule`、`hasResponseBodyMock` 等
3. `core.js` — `addRequestRecord`、`intercept*`、`syncMockRulesToPage`、`PAGE_RECORD_MSG` 监听
4. `ai-analysis.js` — `callAI`、`analyzeRequest`、`analyzeAllRequests`、`analyzeRequestsSequential`、`chatModify`
5. `mcp-engine.js` — Schema、**`generateMcpToolsFromRecords`（保持原行为）**、`generateMcpToolsFromRecordsEnhanced`、`mergeMcpToolDefinitions`、导出/导入包、`handleMcpProxyRequest`
6. `ui-core.js` — 面板、**筛选/分组/多选**、请求列表、Mock 弹窗
7. `mcp-ui.js` — MCP 列表/日志、**多选/合并/导入导出**
8. `isolated.js` — `init()`、创建 UI、注入 MAIN `page-hook.js`

**MAIN world**：`page-hook.js` 由 background `executeScript` 注入，经 `postMessage` 与隔离脚本通信。

---

## 2. `state` 关键字段（增量）

| 字段 | 说明 |
|------|------|
| `listFilters` | `{ dupOnly, mock: 'all'\|'mocked'\|'plain', analyzed: 'all'\|'done'\|'pending', methods: {GET?:bool,...}, groupMode: 'none'\|'host'\|'endpoint' }` |
| `selectedReqIds` | `{ [reqId]: true }` 请求多选 |
| `selectedMcpToolNames` | `{ [toolName]: true }` MCP 工具多选 |
| `mcpUseEnhancedGeneration` | 是否对 **新入口** 使用 `generateMcpToolsFromRecordsEnhanced`（**不**影响「一键生成 MCP」） |

存储键未变：`MOCK_RULES_KEY_PREFIX + hostname`、`MCP_TOOLS_KEY_PREFIX + hostname`、`CONFIG_KEY`。

---

## 3. 请求列表：筛选与签名

- **关键词**：仍匹配 `url` 与 `aiAnalysis`（与旧版一致）。
- **重复请求**：`METHOD + pathname(getMockKey) + 稳定 query + 稳定 body`；**参数不同不算重复**。
- **Mock / 未 Mock**：`recordShowsMocked` 综合 `req.isMocked` 与 `findDebugRule` + `hasResponseBodyMock`。
- **分组**：平铺 / 按域名 / 按 `METHOD + pathname`。
- **多选**：行首 checkbox；全选仅作用于**当前过滤结果**；黄色批量条：批量 AI（`analyzeRequestsSequential`）、已选→MCP、清空选择。

### 生成 MCP 的入口（兼容性）

| 按钮 | 数据源 | 生成函数 |
|------|--------|----------|
| **一键生成 MCP 工具** | 全量 `state.requestRecords` | **始终** `generateMcpToolsFromRecords`（与历史行为一致） |
| **视图内 MCP** | `filterRequestRecords(..., 当前搜索词)` | `pickGeneratorForRequests()` |
| **已选 MCP** | checkbox 选中集 | 同上 |
| **增强推断** 勾选 | — | `pickGeneratorForRequests` 在勾选时返回 `generateMcpToolsFromRecordsEnhanced` |

---

## 4. MCP 引擎 API（摘要）

- `generateMcpToolsFromRecords` / `generateMcpToolFromRecord`：**勿改既有契约**（纯增量需求走 Enhanced）。
- `generateMcpToolsFromRecordsEnhanced`：合并 path 段推断、`oneOf` 类型归并、数组/字符串 body、`_meta.enhancedSchema`。
- `mergeMcpToolDefinitions([tool,...])`：同一 `method + pathname` 的多工具并集 properties，**required 取交集**。
- `pickGeneratorForRequests()` → legacy 或 enhanced。
- **导出**：`buildMcpToolsExportPayload(map, sanitizeHeadersBool)` → `{ format, version, exportedAt, sourceHostname, tools }`。
- **导入**：`validateImportedMcpPayload` + `applyMcpToolsImport(payload, 'merge'\|'replace', conflictMode)`；`conflictMode`: `skip` | `overwrite` | `rename`。
- `deleteMcpTool`：同时清理 `selectedMcpToolNames` 中的键。

---

## 5. MCP UI

状态栏下 **工具条**：全部导出、已选导出、导入（合并/全量替换 + 同名策略）、全选、清选、合并已选、删除已选。  
工具卡片左侧 **勾选** 与原有「启用」开关独立。

---

## 6. Service Worker 消息（扩展时加 `onMessage` 分支）

| type | 方向 | 说明 |
|------|------|------|
| `INJECT_PAGE_HOOK` | → background | 注入 `page-hook.js` |
| `AI_CHAT_COMPLETIONS` | → background | 代理 Kimi |
| `MCP_START_HELPER` / `MCP_STOP_HELPER` | → background | Native Messaging |
| `MCP_SYNC_TOOLS` | → background | 同步工具到 Helper |
| `MCP_GET_STATUS` / `MCP_GET_CALL_LOGS` | → background | 状态与日志 |
| `MCP_TOOL_TEST` | → background | 测试器走与正式调用相同代理链 |
| `MCP_PROXY_REQUEST` | background → content | `handleMcpProxyRequest` tab 内 fetch |

---

## 7. 修改 Checklist

- 改 Mock / 拦截：同时核对 `core.js` 与 `page-hook.js`。
- 改 MCP 代理：同时看 `background.js` `handleMcpToolCall` 与 `mcp-engine.js` `handleMcpProxyRequest`。
- **保持「一键生成」仍调用 `generateMcpToolsFromRecords`**，避免静默改变老用户 Schema。

---

## 8. 常见故障

| 现象 | 排查 |
|------|------|
| 列表无请求 | `INJECT_PAGE_HOOK`、非 http(s)、SW 报错 |
| MCP 空列表 | 未 `MCP_SYNC_TOOLS`、工具全 `enabled: false` |
| 无 Cookie | 走了 `fallbackFetch`，需目标域标签页仍打开 |
| 导入失败 | `format` 须为 `ai-req-analyzer-mcp-tools`、`inputSchema.type === 'object'` |

（更细的 Native Messaging / `server.mjs` 协议说明见上文消息表与源码注释；需要完整 WebSocket 行为时直接读 `extension/mcp-helper/server.mjs`。）

---

## 9. 使用说明（操作手册）

以下假设扩展已载入目标站点，`page-hook` 注入成功（列表能持续出现新请求）。

### 9.1 请求列表：搜索与筛选（AND）

1. **关键词**：在原有搜索框输入；匹配 **整条 URL** 与 **已有 AI 分析文本**（与改版前一致）。
2. **筛选芯片**（与关键词 **同时生效**，全部满足才显示）：  
   - **重复**：仅显示「签名」出现次数 ≥ 2 的记录（同名接口但 query/body 不同视为不同签名）。  
   - **Mock / 未 Mock**：与行上 Mock 状态一致逻辑。  
   - **已分析 / 未分析**：按是否已有 AI 分析结果过滤。  
3. **HTTP 方法**：用方法 toggle 勾选。若 **未勾选任一方法**，表示 **不按方法过滤**（与「全部 HTTP 方法」等价）；一旦有任一方法被点亮，仅保留该方法匹配的记录（实现：`passesMethodChip`）。
4. **分组**：「平铺 | 域名 | 接口(METHOD+path)」只影响展示与折叠感，不改变底层记录集合；切换分组后会 **尽量保留仍落在当前筛选结果内的勾选**。

### 9.2 多选与批量操作

1. **单行勾选**：点行首 **复选框**；不得因点击复选框而展开详情（若展开则说明需报 bug）。  
2. **全选当前结果**：仅选中 **当前列表里经过滤后的行**，不是全库 `requestRecords`。  
3. **黄色批量条**（有选中时出现）：  
   - **清空**：清空 `selectedReqIds`。  
   - **批量 AI 分析**：只对选中且尚无分析结果的条目 **排队**调用（避免并发打爆 API）；完成后列表应刷新。  
   - **从选中生成 MCP**：对选中记录对应的抓包上下文生成工具并 **写入** `state.mcpTools`、保存并同步 MCP（与新入口语义一致）。
4. **行点击**：除复选框外区域点击行仍应 **展开/切换详情**（与旧行为一致）。

### 9.3 生成 MCP（四个层次，勿混淆）

| 你要的场景 | 使用方式 |
|------------|----------|
| 与老版本完全一致、全站点历史抓包汇总 | **一键生成 MCP 工具** → 数据源 **始终为全量** `requestRecords`，内部 **固定** `generateMcpToolsFromRecords`。 |
| 只看当前筛选+关键词视图 | **视图内 MCP** → 仅对当前视图内记录生成；遵从 **增强 MCP 推断** 复选框。 |
| 明确指定几条请求 | 勾选请求行 → **✅ 已选 MCP**，或批量条 **已选→MCP**（与计划中「从选中生成」一致）；同样遵从增强复选框。 |
| 需要路径参数、`oneOf`、更激进 body 推断 | 勾选 **增强 MCP 推断（非一键默认路径）**，再使用 **视图内 MCP** 或 **已选 MCP**。**不要期望**勾选增强会改变「一键生成」的输出。 |

生成后应出现 Toast 或列表更新；助手侧需同步时依赖 **`MCP_SYNC_TOOLS`**。

### 9.4 MCP 工具面板：多选、合并、删

1. **左侧复选**：与「启用开关」无关；用于批量操作候选集。  
2. **全选 / 清空**：针对当前hostname下工具表里已有工具名。  
3. **合并所选**：至少两项；语义为 **同一 method + pathname** 的 Schema 合并（properties 并集，required 交集）；合并后删除原条目并同步。  
4. **删除所选**：一次确认后删除；选中映射应被清理。

### 9.5 导出 / 导入 JSON

1. **导出全部 / 导出已选**  
   - 弹窗询问是否 **脱敏**（ stripping `Authorization`、`Cookie` 等敏感头，与引擎内策略一致）。  
   - 文件命名建议形如：`mcp-tools_<hostname>_<YYYYMMDD>.json`。  
2. **导入**  
   - 选文件 → 首选 **合并** 或 **全量替换**（取消合并即走替换分支，以实现中的 `confirm`/对话框为准）。  
   - **合并** 时需指定同名冲突策略：`skip` | `overwrite` | `rename`（`rename` 一般带 `_imported` 后缀逻辑）。  
   - 成功路径：**校验通过** → `saveMcpTools` → **`MCP_SYNC_TOOLS`** → 刷新面板。  
3. **安全性**：不要把含密钥的导出文件提交仓库；投产环境优先 **脱敏导出** 再给他人。

### 9.6 MCP 工具列表（面板「工具列表」Tab）

- **`state.mcpListUi`**（仅内存）：`keyword`、`groupMode`（`none` | `method` | `risk` | `pathPrefix`）、`filterEnabled`（`all` | `on` | `off`）、`riskLevels`（low/med/high 多选 chip）、`toolbarCollapsed`。  
- **收起工具栏**：折叠 `.ai-req-mcp-toolbar-expandable`，保留一行「收起/展开」与「显示 n / 共 m」摘要，列表区域占用更多纵向空间。  
- **搜索**：匹配工具 `name`、`description`、`_meta.method + _meta.pathname`。  
- **全选**：仅勾选当前筛选结果内的工具（与请求列表「全选当前结果」语义一致）。

### 9.7 动态路径合并、命名与 Background URL

- **聚类**：pathname **规范化**（去尾部 `/` 等）后，将纯数字段、UUID 形段、长 hex 段映射为同一 pattern，使 `/users/1` 与 `/users/2` 合并为一个工具；query/body 仍并入同一 `inputSchema`。可变字符串路径段默认 **不** 合并（降低 `/a/us` 与 `/a/eu` 误判）。  
- **`_meta`**：`pathname` 为运行时模板（含 `{pathParam}`）；`pathParamKeys`；`pathPatternKey`（合并同源校验）；`pathnameSample`。  
- **[extension/background.js](extension/background.js)**：`partitionMcpToolArguments` 替换模板 segment 后，路径参数不再进入 query/body；旧工具无模板占位时行为不变。  
- **命名**：`state.config.mcpToolNaming`：`full`（默认）或 `compact`（配置面板）。

---

## 10. 验收清单（Smoke / QA）

逐项打勾即可；默认「兼容性」一行表示：**未启用任何新筛选/增强/导入** 时行为须与改版前等价。

### 10.1 兼容性（§0）

- [ ] **零操作等价**：不关面板、不接新筛选、不勾选增强，仅用关键词过滤，列表顺序与可读性与改版前体感一致（或与原构建对比截图）。  
- [ ] **关键词**：仅关键字时仍过滤 URL + `aiAnalysis` 文本。  
- [ ] **行交互**：单击行主体仍可展开详情；**点击行首 checkbox 不触发**展开切换。  
- [ ] **一键生成 MCP**：对固定一批 `requestRecords`，生成工具 **名称集合与主要字段/schema 与改版前一致**（可用同一份HAR/操作录屏两次对比 JSON 导出或剪贴板快照）。  
- [ ] **未执行导入**：冷启动后与旧版一致，不出现多余工具条目；助手同步频率/行为不因新代码异常刷屏。

### 10.2 请求列表新增能力

- [ ] **筛选 AND**：关键字 + 「仅重复」+ 方法一例，交集正确。  
- [ ] **重复语义**：两条「同 path 不同 query」**不**被「重复」误判为同一签名。  
- [ ] **Mock 筛选**：与行上实心 Mock 图标一致（含规则命中且有 response mock 语义）。  
- [ ] **分组**：域名组、接口（METHOD+path）组标题与条数统计正确；sticky 抬头在滚动时 usable。  
- [ ] **全选**：只选中当前筛选结果内的行；翻关键词后全选范围变化合理。  
- [ ] **切换筛选/分组**：选中项处理方式符合「优先保留仍在结果集内的 id」设计（不出现幽灵选中）。  

### 10.3 批量 AI

- [ ] **顺序执行**：勾选多条未分析请求，队列执行，无明显并发风暴（网络监视器侧请求间隔合理）。  
- [ ] 分析完成后列表/详情中 **可出现分析摘要**，且列表刷新后不丢勾选（若仍在筛结果内）。

### 10.4 MCP：增强 / 合并 / 导入导出

- [ ] **增强推断 OFF + 视图内/已选**：输出路径与 **`generateMcpToolsFromRecords` 等价**（同批数据对比）。  
- [ ] **增强推断 ON**：同批数据相较 legacy 有可解释差异（如 path param、冲突 `oneOf` 等至少在样例上出现一项）。  
- [ ] **`一键生成`**：在增强 ON/OFF 下 **输出均不变**（与 legacy 一致）。  
- [ ] **合并工具**：选一组合法同端点工具，`merge` 后条数减少、新工具可启用、 **`MCP_SYNC_TOOLS` 后主流程可调**。  
- [ ] **导出脱敏**：选脱敏导出 → JSON 内无 `Authorization`/`Cookie` 等明文（按 `stripSensitiveHeaders` 约定）。  
- [ ] **导入失败**：改过 `format` 或拆掉 `inputSchema.type` → Toast 报错且 **不写 storage**。  
- [ ] **合并导入**：`skip`/`overwrite`/`rename` 各试一次，结果符合策略。  
- [ ] **替换导入**：二次确认后仅余导入包内工具。  
- [ ] **导入后**：`chrome.storage.local` 中 MCP 前缀 key 更新，助手侧列表与扩展内列表一致。

### 10.5 回归 / 端到端（可选加强）

- [ ] **background**：`handleMcpToolCall` 对合并/导入后的工具仍可代理到页面内 `fetch`（需真实助手或 mock）。  
- [ ] **大批量**：≥200 条记录时滚动、分组、全选仍可接受（无明显卡顿或可记录阈值）。

