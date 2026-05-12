# AI请求智能分析助手 — MCP 工具使用说明

> 本文档面向最终用户，介绍如何使用浏览器扩展的「MCP 工具」功能，将拦截到的 API 请求自动转化为 MCP 工具，供 AI 大模型直接调用站点接口。

---

## 一、功能简介

**MCP（Model Context Protocol）** 是一种标准化的 AI 工具调用协议。通过本功能，你可以：

1. 在浏览器中正常操作网站，扩展会自动拦截所有 API 请求
2. 一键将拦截到的 API 请求转化为 MCP 工具定义（自动推断参数类型、风险等级等）
3. 启动本地 MCP Server，AI IDE / AI Agent 通过 MCP 协议连接后，即可直接调用这些站点 API
4. 调用通过浏览器 Content Script 代理执行，**天然携带当前登录的 Cookie**，无需手动配置认证

---

## 二、前置要求

| 要求 | 说明 |
|------|------|
| Chrome / Edge 浏览器 | 需支持 Manifest V3 扩展 |
| Node.js 18+ | MCP Helper 进程运行依赖（需在 PATH 中可用） |
| AI IDE 或 MCP 客户端 | 如 Cursor、Claude Desktop、Cline 等，支持 MCP 协议的客户端 |

---

## 三、安装步骤

### 3.1 安装浏览器扩展

1. 打开 Chrome，访问 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目的 `extension` 目录

安装后浏览器右上角会出现扩展图标，任意网页上会出现绿色浮动球。

### 3.2 注册 Native Messaging Host

MCP 功能需要通过 Chrome Native Messaging 启动本地 Node.js 进程（MCP Helper），首次使用前需注册：

**Windows**：
```bash
cd extension/mcp-helper
node install.mjs
```

**macOS / Linux**：
```bash
cd extension/mcp-helper
node install.mjs
```

脚本会自动检测操作系统并完成注册：
- Windows：写入注册表 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.aireq.mcp_helper`
- macOS：写入 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- Linux：写入 `~/.config/google-chrome/NativeMessagingHosts/`

**⚠️ 注册完成后必须重启 Chrome 浏览器才能生效。**

### 3.3 配置 AI 分析（可选但推荐）

MCP 工具的描述会使用 AI 分析结果，建议先配置 AI：

1. 右键页面 → 点击「配置」
2. 填写 API Key（支持 OpenAI 兼容接口，默认 Kimi K2.6）
3. 可自定义 Base URL 和 Model

---

## 四、使用流程

### 4.1 拦截 API 请求

1. 在目标网站正常操作（登录、浏览、提交表单等）
2. 扩展会自动拦截页面所有 API 请求，显示在浮动面板的请求列表中
3. 点击请求行展开详情，可查看请求/响应数据和 AI 分析

### 4.2 生成 MCP 工具

**方式一：单条生成**

1. 在请求列表中展开某个 API 请求
2. 点击「🔧 生成MCP工具」按钮
3. 工具自动生成并保存

**方式二：一键批量生成**

1. 点击主面板顶部的「🔗 一键生成MCP工具」按钮
2. 扩展会自动过滤静态资源请求，将 API 请求按 pathname 分组合并
3. 预览生成结果后确认

生成规则：
- 自动过滤 `.js/.css/.png/.jpg` 等静态资源
- 同 pathname + method 的请求合并为一个工具
- 批量参数推断：所有请求都出现的字段标记为 required，字符串字段的少量唯一值推断为 enum
- 工具命名：`method + _ + pathname_snake_case`（如 `get_api_users_list`）

### 4.3 管理 MCP 工具

1. 点击主面板顶部的「MCP 工具」标签页
2. 可以进行以下操作：

| 操作 | 说明 |
|------|------|
| 启用/禁用 | 切换工具开关，禁用的工具不会暴露给 MCP 客户端 |
| 编辑 | 修改工具名称、描述、参数描述、required 标记 |
| 测试 | 填入参数直接测试工具调用，查看响应结果 |
| 删除 | 永久删除工具定义 |

3. 风险等级标签说明：
   - 🟢 **low**：GET / HEAD 只读请求
   - 🟠 **medium**：普通 POST / PUT / PATCH 请求
   - 🔴 **high**：DELETE 请求或含高危关键词（delete/cancel/pay/transfer 等）的写操作

### 4.4 启动 MCP Server

1. 在「MCP 工具」标签页中，点击状态栏右侧的「启动」按钮
2. 状态从「○ 未启动」变为「● 已启动 ws://localhost:9527」
3. 点击「停止」可关闭 MCP Server

启动成功后，MCP Helper 进程：
- 通过 Native Messaging 与扩展建立连接
- 在 `ws://localhost:{port}/mcp` 启动 WebSocket 服务
- 自动同步当前所有启用的 MCP 工具

### 4.5 配置 MCP 客户端

在 AI IDE 中配置 MCP 连接：

**Cursor**：

编辑 `~/.cursor/mcp.json`：
```json
{
  "mcpServers": {
    "ai-request-analyzer": {
      "url": "ws://localhost:9527/mcp",
      "transport": "websocket"
    }
  }
}
```

**Claude Desktop**：

编辑 Claude Desktop 配置文件（路径因系统而异）：
```json
{
  "mcpServers": {
    "ai-request-analyzer": {
      "url": "ws://localhost:9527/mcp",
      "transport": "websocket"
    }
  }
}
```

**Cline / 其他 MCP 客户端**：

参照各客户端文档，添加 WebSocket 类型的 MCP Server，地址为 `ws://localhost:9527/mcp`。

如配置了 Token 鉴权（见 4.6），需要在客户端配置中添加 Token。

### 4.6 可选：Token 鉴权

如需限制 MCP Server 的访问权限，可设置环境变量：

**修改 MCP Helper 启动方式**（设置环境变量）：

Windows（PowerShell）：
```powershell
$env:MCP_AUTH_TOKEN = "your-secret-token"
```

macOS / Linux：
```bash
export MCP_AUTH_TOKEN="your-secret-token"
```

然后在 MCP 客户端配置中添加 Token 字段。MCP Server 会在 `initialize` 请求时验证 Token。

### 4.7 可选：修改 MCP Server 端口

默认端口 `9527`，如需修改：

1. 右键页面 → 点击「配置」
2. 在「MCP Server 配置」区域修改端口号
3. 重新启动 MCP Server

或通过命令行参数：
```bash
node server.mjs --port 8080
```

---

## 五、AI 如何使用 MCP 工具

连接成功后，AI 可以通过以下 MCP 方法操作：

| MCP 方法 | 说明 |
|----------|------|
| `initialize` | 初始化连接，返回服务端能力 |
| `tools/list` | 列出所有可用工具（名称、描述、参数 Schema） |
| `tools/call` | 调用指定工具，传入参数 |

**AI 使用示例**：

用户：「帮我查看当前用户信息」

AI 调用流程：
1. `tools/list` → 发现 `get_api_user_info` 工具
2. `tools/call` → `{ name: "get_api_user_info", arguments: {} }`
3. 扩展代理请求 → `https://api.example.com/api/user/info`（携带浏览器 Cookie）
4. 返回响应 → AI 解析并展示给用户

---

## 六、工作原理

```
┌──────────────┐     WebSocket      ┌──────────────┐    Native Messaging    ┌──────────────┐
│  MCP 客户端   │ ◄──────────────► │  MCP Helper   │ ◄──────────────────► │  浏览器扩展   │
│ (AI IDE等)   │    JSON-RPC 2.0   │  (Node.js)    │   stdin/stdout        │ background.js│
└──────────────┘                    └──────────────┘                       └──────┬───────┘
                                                                                   │
                                                                          chrome.tabs.sendMessage
                                                                                   │
                                                                           ┌──────▼───────┐
                                                                           │ isolated.js   │
                                                                           │ (Content      │
                                                                           │  Script)      │
                                                                           └──────┬───────┘
                                                                                  │ fetch（带Cookie）
                                                                                  ▼
                                                                           ┌──────────────┐
                                                                           │   站点 API    │
                                                                           └──────────────┘
```

**关键设计**：
- **Cookie 自动携带**：代理执行通过浏览器 Content Script 的 `fetch` 发出，天然携带当前标签页的 Cookie，无需手动配置登录态
- **降级策略**：如果目标标签页已关闭，background.js 会直接 `fetch`（`proxyMode: fallback`），可能不携带 Cookie，适用于公开接口
- **安全过滤**：工具定义中不存储 Cookie、Authorization 等敏感头，`_meta` 元数据不暴露给 MCP 客户端

---

## 七、常见问题

### Q：MCP 启动失败怎么办？

1. 确认已执行 `node install.mjs` 并重启 Chrome
2. 检查 Node.js 是否在系统 PATH 中可用（终端执行 `node -v` 确认）
3. Windows 下检查注册表项 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.aireq.mcp_helper` 是否存在
4. 查看 Chrome 扩展页面的 Service Worker 控制台是否有错误日志

### Q：MCP 客户端连接不上？

1. 确认面板状态栏显示「● 已启动」
2. 确认端口未被其他程序占用（默认 9527）
3. 确认客户端配置的地址为 `ws://localhost:9527/mcp`（注意包含 `/mcp` 路径）
4. 如配置了 Token 鉴权，确认客户端配置了正确的 Token

### Q：AI 调用工具返回 "Tool not found"？

1. 确认已在面板中生成 MCP 工具
2. 确认工具未处于禁用状态
3. 点击工具启用/禁用开关后，工具会自动同步；也可手动重启 MCP Server

### Q：AI 调用工具无 Cookie / 登录态失效？

1. 确认目标网站对应的浏览器标签页**仍然打开**
2. 标签页关闭后，调用会降级为 background.js 直接 fetch（不携带 Cookie）
3. 如果必须携带 Cookie，请保持标签页打开

### Q：工具调用超时？

1. 检查目标网站是否可正常访问
2. 默认超时 30 秒，部分慢接口可能需要更长等待
3. 检查网络代理设置是否影响 localhost 访问

### Q：如何让工具描述更准确？

1. 先对请求执行 AI 分析（点击「✨ AI分析」），分析结果会作为工具描述
2. 在 MCP 工具编辑器中手动修改描述和参数说明
3. 更准确的描述能帮助 AI 更好地理解和使用工具

### Q：更换电脑/重装系统后怎么办？

1. 重新加载浏览器扩展
2. 重新执行 `node install.mjs` 注册 Native Messaging Host
3. 重启 Chrome
4. MCP 工具定义存储在 `chrome.storage.local` 中，扩展重新加载后仍然有效

---

## 八、配置项汇总

| 配置项 | 位置 | 默认值 | 说明 |
|--------|------|--------|------|
| API Key | 配置面板 | 空 | AI 分析的 API 密钥 |
| Base URL | 配置面板 | `https://api.moonshot.cn/v1` | AI API 地址 |
| Model | 配置面板 | `kimi-k2.6` | AI 模型名称 |
| MCP Server 端口 | 配置面板 | `9527` | WebSocket 监听端口 |
| MCP 鉴权 Token | 配置面板 | 空 | 留空表示不鉴权 |
| 自动同步 | 配置面板 | `false` | 工具变更后是否自动同步 |
