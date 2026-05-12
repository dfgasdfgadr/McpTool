import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST_NAME = 'com.aireq.mcp_helper';
const EXTENSION_ID = 'njgfblgbmbhkegiaopcpnikggdmieodc';
const serverPath = path.resolve(__dirname, 'server.mjs');

const nodePath = process.execPath;

// 构建启动命令
const launchCmd = `"${nodePath}" "${serverPath}"`;

// 生成 manifest 内容
const manifest = {
  name: HOST_NAME,
  description: 'AI Request Analyzer MCP Helper',
  path: nodePath,
  type: 'stdio',
  allowed_origins: [
    `chrome-extension://${EXTENSION_ID}/`,
  ],
};

const manifestJson = JSON.stringify(manifest, null, 2);

const platform = os.platform();

function installWindows() {
  const manifestDir = path.join(__dirname);
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);

  fs.writeFileSync(manifestPath, manifestJson, 'utf-8');
  console.log(`[安装] 已写入 manifest: ${manifestPath}`);

  const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, {
      encoding: 'utf-8',
    });
    console.log(`[安装] 已注册注册表项: ${regKey}`);
  } catch (e) {
    console.error(`[错误] 注册表写入失败: ${e.message}`);
    process.exit(1);
  }
}

function installMac() {
  const targetDir = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts',
  );
  const targetPath = path.join(targetDir, `${HOST_NAME}.json`);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetPath, manifestJson, 'utf-8');
  console.log(`[安装] 已写入 manifest: ${targetPath}`);
}

function installLinux() {
  const targetDir = path.join(
    os.homedir(),
    '.config',
    'google-chrome',
    'NativeMessagingHosts',
  );
  const targetPath = path.join(targetDir, `${HOST_NAME}.json`);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetPath, manifestJson, 'utf-8');
  console.log(`[安装] 已写入 manifest: ${targetPath}`);
}

console.log(`[安装] 操作系统: ${platform}`);
console.log(`[安装] Node.js 路径: ${nodePath}`);
console.log(`[安装] Server 路径: ${serverPath}`);

switch (platform) {
  case 'win32':
    installWindows();
    break;
  case 'darwin':
    installMac();
    break;
  case 'linux':
    installLinux();
    break;
  default:
    console.error(`[错误] 不支持的操作系统: ${platform}`);
    process.exit(1);
}

console.log('[安装] ✅ Native Messaging Host 安装完成');
console.log('[安装] 请重启 Chrome 浏览器使配置生效');
