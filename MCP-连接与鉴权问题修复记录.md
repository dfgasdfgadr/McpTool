# MCP 连接与鉴权问题修复记录

> 记录时间：2026-05-12
> 涉及版本：aiMCPTool 扩展（拆分 isolated.js 后的版本）
> 问题范围：MCP 启动失败、测试工具 401/404 鉴权与路径错误

---

## 一、问题现象

用户在使用 Cursor 连接 MCP 时遇到以下问题：

1. **插件弹窗点击"启动 MCP"无响应**，后台报错：
   ```
   Unchecked runtime.lastError: Error when communicating with the native messaging host.
   ```
2. **点击"测试 MCP 工具"报错**：
   ```
   请求失败: Tool not found: get_adminapi_common_tipsManage_list
   ```
3. **修复启动问题后，测试返回 401**：
   ```json
   {"code":401,"message":"访问此资源需要完整的身份验证"}
   ```
4. **修复鉴权后，测试返回 404**：
   ```json
   {"code":404,"message":"资源未找到","data":null}
   ```

---

## 二、问题根因分析

### 问题 1：MCP 启动失败（Native Messaging Host 无法启动）

**根因**：Windows 下 Native Messaging Host 的 manifest 文件把 `path` 指向了 `node.exe`，但没有带上 `server.mjs` 启动参数。

Chrome 的 Native Messaging 机制要求 `path` 指向一个**可直接执行的二进制文件**。当 `path` 指向 `node.exe` 时，Chrome 只会启动 Node.js 本体，不会运行 `server.mjs`，导致宿主进程立即退出，扩展侧收到 `Error when communicating with the native messaging host.`。

**原始代码**（`install.mjs` 旧版本）：
```javascript
const manifest = {
  name: HOST_NAME,
  path: nodePath,  // ❌ 直接指向 node.exe，没有 server.mjs
  type: 'stdio',
  // ...
};
```

**为什么 `.cmd` 也不行**：
- 第一次修复尝试生成 `.cmd` 批处理文件作为中间层
- 但 Node.js `child_process.spawn()` 在 Windows 下对 `.cmd` 文件会报 `EINVAL` 错误
- Chrome 的 Native Messaging 底层同样无法稳定启动 `.cmd` 文件

**正确方案**：Windows 下必须生成一个真正的 `.exe` 可执行文件作为启动器，由该 exe 内部调用 `node.exe server.mjs`。

---

### 问题 2：测试工具报 "Tool not found"

**根因**：`background.js` 读取 `chrome.storage.local` 时，没有处理存储值为 JSON 字符串的情况。

MCP 工具在 content script 中通过 `storageSet()` 保存，而 `storageSet()` 会把对象序列化为 JSON 字符串存入 `chrome.storage.local`。后台读取时直接当作对象使用，导致 `toolsObj[testToolName]` 为 `undefined`。

**原始代码**（`background.js`）：
```javascript
var toolsObj = items[key];  // ❌ 可能是 JSON 字符串，不是对象
if (toolsObj && toolsObj[testToolName]) {  // ❌ 字符串没有属性访问
```

---

### 问题 3：测试返回 401（身份验证失败）

**根因**：生成 MCP 工具时，为了安全主动剥离了敏感请求头（`Authorization`、`Cookie` 等）。

`generateMcpToolFromRecord()` 函数使用 `stripSensitiveHeaders()` 过滤了敏感头，保存到 `sampleRequestHeaders` 中。测试时后台使用这份脱敏头发请求，导致服务端无法识别用户身份。

**原始代码**（`mcp-engine.js`）：
```javascript
_meta: {
  sampleRequestHeaders: stripSensitiveHeaders(req.requestHeaders || {}),
  // ❌ 只保存了脱敏头，没有保留原始头
}
```

**这是安全设计，不是 bug**：
- `sampleRequestHeaders` 会随工具定义同步到 MCP Helper
- MCP Helper 返回 `tools/list` 给客户端时，`_meta` 被过滤
- 但测试/MCP 调用时也需要鉴权头才能正常工作

---

### 问题 4：测试返回 404（资源未找到）

**根因**：`generateMcpToolFromRecord()` 中 `origin` 字段保存的是完整 URL，而不是 URL 的 `origin` 部分（协议+主机）。

当后台拼接请求 URL 时：
```javascript
var fullUrl = origin + pathname + queryString;
// origin = "https://xxx.com/api/path" (完整URL)
// pathname = "/api/path"
// fullUrl = "https://xxx.com/api/path/api/path" ❌ 重复了
```

**原始代码**（`mcp-engine.js`）：
```javascript
_meta: {
  origin: reqUrl,  // ❌ 保存了完整 URL
  pathname: pathname,
}
```

正确的 `origin` 应该是 `parsed.origin`（如 `https://xxx.com`），`pathname` 是 `/api/path`，拼接后得到 `https://xxx.com/api/path`。

---

## 三、修复过程

### 修复 1：Native Messaging Host 启动器（install.mjs）

**方案**：Windows 下使用 PowerShell `Add-Type` 动态编译 C# 代码生成 `.exe` 启动器。

**修改后代码**：
```javascript
function installWindows() {
  const manifestDir = path.join(__dirname);
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
  const launcherExePath = path.join(manifestDir, `${HOST_NAME}.exe`);

  // 生成 C# 启动器源码
  const launcherSource = buildWindowsLauncherSource();
  const launcherSourcePath = path.join(manifestDir, `${HOST_NAME}.launcher.cs`);
  fs.writeFileSync(launcherSourcePath, launcherSource, 'utf-8');

  // 用 PowerShell Add-Type 编译为 exe
  execSync(`powershell -NoProfile -Command "Add-Type -Path '${launcherSourcePath}' -OutputAssembly '${launcherExePath}' -OutputType ConsoleApplication"`);

  // manifest 指向 exe
  const manifest = {
    name: HOST_NAME,
    path: launcherExePath,  // ✅ 指向真正的可执行文件
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
  };
  // ...
}
```

**C# 启动器核心逻辑**：
```csharp
public static int Main(string[] args) {
  var psi = new ProcessStartInfo();
  psi.FileName = @"C:\Users\DH\AppData\Local\nodejs\node.exe";
  psi.WorkingDirectory = @"...\mcp-helper";
  psi.UseShellExecute = false;
  psi.Arguments = JoinArgs(BuildArgs(args));
  using (var process = Process.Start(psi)) {
    process.WaitForExit();
    return process.ExitCode;
  }
}
```

**验证方式**：
```bash
# 直接按 Native Messaging 协议测试
node -e "const {spawn}=require('child_process'); const cp=spawn('com.aireq.mcp_helper.exe', [], {stdio:['pipe','pipe','pipe']}); ..."
# 输出: {"type":"PONG"}  ✅
```

---

### 修复 2：后台读取存储时解析 JSON（background.js）

**方案**：新增 `parseStoredTools()` 辅助函数，统一处理字符串/对象两种情况。

```javascript
function parseStoredTools(toolsVal) {
  if (!toolsVal) return null;
  if (typeof toolsVal === 'string') {
    try {
      return JSON.parse(toolsVal);
    } catch (e) {
      return null;
    }
  }
  if (typeof toolsVal === 'object') {
    return toolsVal;
  }
  return null;
}
```

**使用位置**：
- `MCP_TOOL_TEST` 处理逻辑
- `handleMcpToolCall()` 处理逻辑
- `syncToolsToHelper()` 工具同步逻辑

---

### 修复 3：敏感头复用（mcp-engine.js + background.js）

**方案**：工具元数据中同时保存两份头信息。

**mcp-engine.js** — 生成工具时新增 `rawRequestHeaders`：
```javascript
_meta: {
  origin: (parsed && parsed.origin) || '',
  pathname: pathname,
  method: method,
  sampleRequestHeaders: stripSensitiveHeaders(req.requestHeaders || {}),  // 脱敏头（对外）
  rawRequestHeaders: req.requestHeaders || {},  // ✅ 原始头（仅本地执行）
  // ...
}
```

**background.js** — 测试和调用链路优先使用 `rawRequestHeaders`：
```javascript
// 测试链路
var execHeaders = toolMeta.rawRequestHeaders || toolMeta.sampleRequestHeaders || {};

// MCP 调用链路
var execHeaders = toolMeta.rawRequestHeaders || toolMeta.sampleRequestHeaders || {};
```

**安全保证**：
- `rawRequestHeaders` 只保存在浏览器本地 `chrome.storage.local`
- `server.mjs` 返回 `tools/list` 时仍然过滤 `_meta`
- MCP 客户端（Cursor）看不到任何敏感头信息

---

### 修复 4：URL 拼接修正（mcp-engine.js）

**方案**：`origin` 字段改为保存 `parsed.origin`（协议+主机），而非完整 URL。

```javascript
// 修改前
_meta: {
  origin: reqUrl,  // ❌ "https://xxx.com/api/path"
  pathname: pathname,
}

// 修改后
_meta: {
  origin: (parsed && parsed.origin) || '',  // ✅ "https://xxx.com"
  pathname: pathname,  // "/api/path"
}
```

**后台拼接**：
```javascript
var fullUrl = origin + pathname + queryString;
// "https://xxx.com" + "/api/path" + "?foo=bar"
// = "https://xxx.com/api/path?foo=bar" ✅
```

---

## 四、修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `extension/mcp-helper/install.mjs` | Windows 安装改为生成 `.exe` 启动器（C# 编译） |
| `extension/mcp-helper/server.mjs` | 新增 `PING/PONG` 健康检查 |
| `extension/background.js` | 新增 `parseStoredTools()`、启动等待握手、敏感头复用 |
| `extension/content/mcp-ui.js` | 启动失败显示具体错误信息 |
| `extension/content/mcp-engine.js` | 新增 `rawRequestHeaders`、修正 `origin` 为 `parsed.origin` |

---

## 五、关键教训

1. **Windows Native Messaging 必须使用 `.exe`**：`.cmd`、`.bat` 在 Chrome 的 Native Messaging 中不可靠，Node.js `spawn` 也会报 `EINVAL`。
2. **chrome.storage.local 的值可能是字符串**：content script 和 background 对同一存储键的读写方式必须一致，读取时要处理字符串反序列化。
3. **安全与功能的平衡**：脱敏头是正确的设计，但需要在本地保留一份原始头用于实际执行，且必须确保不泄露给外部客户端。
4. **URL 字段语义要清晰**：`origin` 应该严格对应 `URL.origin`（协议+主机），不要和完整 URL 混用，否则拼接时会出现路径重复。
