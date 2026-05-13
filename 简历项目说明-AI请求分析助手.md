# AI 请求智能分析助手（浏览器扩展 + MCP）— 简历项目说明

> 用途：投递简历、面试自我介绍、内部汇报时直接引用或裁剪。请按实际参与模块删改「个人职责」表述。

---

## 一、项目一句话（电梯演讲）

基于 **Chrome Manifest V3** 的浏览器扩展，在真实页面会话中**采集并结构化 HTTP 请求**，结合 **AI 分析请求语义**，支持 **Mock/响应改写调试**；并将抓包记录**自动抽象为 MCP 工具定义**（含路径模板、参数 Schema、去重与合并），通过 **Native Messaging + 本地 Node 助手** 与 **MCP 协议** 对接 Cursor 等客户端，实现「真实流量 → 可调用工具」的闭环。

---

## 二、技术栈

### 2.1 浏览器扩展（核心产品形态）

| 类别 | 技术 |
|------|------|
| 平台 | **Chrome Extension Manifest V3** |
| 后台 | **Service Worker**（`background.js`） |
| 页面注入 | **Content Scripts**（多模块顺序加载：`state` / `mock-rules` / `core` / `ai-analysis` / `mcp-engine` / `ui-core` / `mcp-ui` 等） |
| 能力 | `storage`（按站点持久化 MCP 配置等）、`scripting`、`contextMenus`、`tabs`、**`nativeMessaging`**、`host_permissions` |
| 前端 | 原生 **DOM + CSS** 构建分析面板（非重型框架，便于在任意页面内嵌） |
| 语言 | **JavaScript（ES5/传统脚本风格，兼容 content 环境）** |

### 2.2 本地 MCP 助手（桥接层）

| 类别 | 技术 |
|------|------|
| 运行时 | **Node.js**（**ESM**：`server.mjs`） |
| 通信 | **Chrome Native Messaging**（长度前缀的二进制帧 + JSON） |
| 网络 | **Node `http`** 提供 MCP 相关 HTTP/路径处理；兼容带 query 的 `/mcp` 请求 |
| 安全 | 可选环境变量 **MCP_AUTH_TOKEN** 等鉴权思路 |

### 2.3 MCP 与工具生态

| 类别 | 技术 |
|------|------|
| 协议/生态 | **Model Context Protocol（MCP）** 工具列表同步、调用日志、与 IDE 侧对接 |
| 工具元数据 | **JSON Schema**（`inputSchema`）描述工具入参；扩展内维护 `_meta`（method、pathname、pathPatternKey、风险等级等） |
| 仓库内相关 | 另含基于 **@modelcontextprotocol/sdk**、**Hono** 等依赖的 `mcp-server` 目录（可视投递岗位强调「熟悉 MCP 服务端生态」） |

### 2.4 业务与工程能力关键词

- 请求指纹、重复检测、列表过滤与批量操作  
- MCP 工具 **聚类 / 路径模板 / 参数分区（path vs query/body）**、**定义合并（merge）**、**生成去重**、**删重复工具**  
- 导入导出 MCP 工具包、敏感头脱敏导出  
- AI 分析流水线（与业务配置、进度与错误提示结合）

---

## 三、难点与亮点（建议面试展开）

### 3.1 架构：扩展页 + 后台 + 本地进程的「三地协同」

- **难点**：MV3 Service Worker 易休眠、content script 与页面同源策略、本地助手进程生命周期与重连。  
- **亮点**：用消息总线把 **抓包、配置、MCP 同步、代理调用** 串起来；本地 **Native Messaging** 解决浏览器无法直接开放端口的限制，实现 **IDE ↔ 助手 ↔ 扩展** 的工具调用链路。

### 3.2 从「流量」到「工具」：API 契约的半自动抽取

- **难点**：同一接口在真实流量中路径段、查询串、数字 ID 多变，若逐条生成工具会导致爆炸与重复。  
- **亮点**：  
  - **路径规范化 + pattern / pathPatternKey 聚类**，生成 **pathname 模板** 与 **path 参数键**；  
  - **Background 侧**将工具入参划分为 **路径占位符替换** 与 **其余请求参数**，避免重复传参；  
  - **合并多工具定义（merge）** 时做 **路径/模式兼容性校验**，降低脏合并风险。

### 3.3 产品级体验：复杂列表下的性能与交互

- **难点**：MCP 工具列表搜索若整面板重建会导致 **输入框失焦**（每输入一字就打断）。  
- **亮点**：搜索与筛选时 **仅局部更新工具列表 DOM**，保留工具栏与搜索框节点，兼顾 **计数条、分组折叠、启用筛选** 等能力。

### 3.4 数据一致性与运维友好

- **生成去重**：写入前按 **pathPatternKey 或 METHOD+pathname** 冲突键校验，批量生成给出 **新增/跳过** 统计。  
- **删重复**：请求侧按 **签名** 保留首条；工具侧按冲突键保留字典序首条，并清理勾选状态与同步 MCP。  
- **导入导出**：支持合并策略与同名冲突策略，便于在个人/团队间迁移工具集。

### 3.5 调试与测试向能力

- **Mock / 改写规则** 与请求记录联动，前端可在**不依赖后端发版**的情况下验证展示与分支逻辑。  
- 工具侧提供 **调用日志** 等可观测性，缩短「Agent 调了但不知道错在哪」的排障路径。

---

## 四、对开发 / 测试人员的效率提升（可写进简历「成果」）

以下宜结合你司真实数据改成「约 X% / 从 A 小时到 B 分钟」；若无数据，用定性表述即可。

### 4.1 研发（前端 / 全栈 / 工具链）

| 痛点 | 项目带来的变化 |
|------|----------------|
| 文档滞后，只能靠 DevTools 人肉找接口 | 在业务页面**真实操作一遍**即可沉淀带语义的请求记录，减少反复翻 Network 的时间。 |
| 对接 AI 助手缺少稳定「工具契约」 | 从成功流量一键生成 **MCP 工具 + JSON Schema**，缩短手工写 openapi/封装脚本的时间。 |
| 多环境、多变体路径导致脚本脆弱 | **路径模板 + 参数拆分**让工具更接近「接口维度」而非「某次请求的硬编码 URL」。 |
| 合并/去重成本高 | **批量合并、生成去重、删重复工具**降低配置膨胀与命名冲突的沟通成本。 |

**可量化方向（任选填实际）**：接口梳理/对接文档工时、为 AI 脚手架手写封装的人数·小时、重复工具导致的维护工单量。

### 4.2 测试（功能 / 接口 / 支持联调）

| 痛点 | 项目带来的变化 |
|------|----------------|
| 构造数据依赖后端或 DB | **Mock/响应改写** 可在浏览器侧快速覆盖边界与异常场景，**缩短等待链**。 |
| 回归时难以确认「点了哪几个关键请求」 | 请求列表 + 过滤 + 重复检测 + 删重，帮助**收敛用例集**、聚焦真实业务路径。 |
| 缺陷复现依赖操作录屏 | 结构化请求记录（方法、路径、指纹）更容易**写进缺陷单**与**自动化前置条件**。 |

**可量化方向**：联调等待时间、缺陷复现轮次、mock 数据准备时间。

---

## 五、简历 Bullet 话术（中文，可直接粘贴后改数字）

- 独立负责 / 核心参与基于 **Chrome MV3** 的 **HTTP 请求采集与分析扩展**，串联 **Content Script + Service Worker + Native Messaging + Node 本地 MCP 助手**，实现浏览器流量与 **MCP 工具生态**互通。  
- 设计并实现从抓包记录到 MCP 工具的 **路径聚类、模板化、JSON Schema 生成、工具定义合并与冲突校验**，并在 Background 完成 **路径参数与 Query/Body 参数分区**，提升工具可用性与复用率。  
- 解决复杂面板下 **搜索失焦与整页重绘**问题，采用 **列表局部增量更新**；补充 **请求/工具双向去重**与批量清理，降低配置规模与维护成本。  
- 提供 **Mock/响应改写、调用日志、导入导出（脱敏）** 等能力，显著缩短 **前后端联调与测试构造数据**路径（可补：具体百分比或场景）。

### 英文版（国际化简历可选用）

- Built a **Chrome MV3** extension to capture and analyze real-page HTTP traffic, bridging **content scripts, service worker, Native Messaging, and a Node MCP helper** for tool sync and invocation.  
- Implemented **path clustering, pathname templates, JSON Schema codegen, MCP tool merging with compatibility checks**, and **argument partitioning** between path placeholders and remaining parameters.  
- Improved UX with **incremental DOM updates** for tool list filtering; added **deduplication** for both requests and tools to control configuration sprawl.

---

## 六、投递时的合规与表述建议（避免过度承诺）

- 建议强调使用场景为 **自有/授权业务系统** 的效能工具，合规遵循公司与目标站点协议。  
- 若面试官问「与 Postman/Swagger 区别」：本作优势在 **真实会话上下文 + AI 语义 + MCP 直连 Agent**，短板可能是企业级 RBAC/审计若不单独做需诚实说明。

---

## 七、可自行替换的占位

- **项目名称**：________________________________  
- **你的角色**：独立开发 / 核心开发 / 全栈 / 项目负责人  
- **周期**：______ ～ ______  
- **线上/内部用户规模**：______  
- **量化指标**：________________________________  

---

*文档生成自仓库现状梳理；投递前请与个人实际贡献对齐。*
