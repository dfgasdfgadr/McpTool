import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || null;
const args = process.argv.slice(2);
let port = 9527;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
}

// ==================== 工具定义缓存 & 调用回调 ====================

let cachedTools = [];
const pendingCalls = new Map();

// ==================== Native Messaging（stdin/stdout） ====================

// 读取 Native Messaging 消息（4字节小端序长度头 + JSON）
function readNMMessage() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let headerBuf = Buffer.alloc(0);

    const onReadable = () => {
      while (true) {
        const chunk = stdin.read();
        if (!chunk) break;
        headerBuf = Buffer.concat([headerBuf, chunk]);
        if (headerBuf.length >= 4) {
          const msgLen = headerBuf.readUInt32LE(0);
          if (headerBuf.length >= 4 + msgLen) {
            const body = headerBuf.subarray(4, 4 + msgLen);
            headerBuf = headerBuf.subarray(4 + msgLen);
            try {
              resolve(JSON.parse(body.toString('utf-8')));
            } catch (e) {
              reject(e);
            }
            stdin.removeListener('readable', onReadable);
            return;
          }
        }
      }
    };

    stdin.on('readable', onReadable);
    stdin.on('end', () => {
      stdin.removeListener('readable', onReadable);
      resolve(null);
    });
    stdin.on('error', reject);
  });
}

// 写入 Native Messaging 消息
function writeNMMessage(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

// 持续监听 stdin 消息
async function listenStdin() {
  while (true) {
    const msg = await readNMMessage();
    if (msg === null) {
      log('stdin 已关闭，退出');
      process.exit(0);
    }
    handleNMMessage(msg);
  }
}

function handleNMMessage(msg) {
  switch (msg.type) {
    case 'PING': {
      writeNMMessage({ type: 'PONG' });
      break;
    }
    case 'SYNC_TOOLS': {
      // 同步工具定义，仅保留 enabled 的工具
      const toolsObj = msg.tools || {};
      cachedTools = Object.entries(toolsObj)
        .filter(([, v]) => v.enabled !== false)
        .map(([, v]) => {
          const { _meta, ...rest } = v;
          return rest;
        });
      log(`已同步 ${cachedTools.length} 个工具`);
      break;
    }
    case 'CALL_RESULT': {
      const { callId, result } = msg;
      if (pendingCalls.has(callId)) {
        const { resolve } = pendingCalls.get(callId);
        pendingCalls.delete(callId);
        resolve(result);
      }
      break;
    }
    case 'SHUTDOWN': {
      log('收到 SHUTDOWN 命令，退出');
      process.exit(0);
    }
  }
}

// ==================== 极简 WebSocket 实现（零依赖） ====================

// WebSocket 握手
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsHandshake(key) {
  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n');
}

// 解码 WebSocket 帧
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const first = buf[0];
  const second = buf[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let payloadLen = second & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  const maskKey = masked ? buf.subarray(offset, offset + 4) : null;
  offset += masked ? 4 : 0;

  if (buf.length < offset + payloadLen) return null;

  let payload = buf.subarray(offset, offset + payloadLen);
  if (masked && maskKey) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return { fin, opcode, payload, frameLen: offset + payloadLen };
}

// 编码 WebSocket 文本帧（服务端发送不 mask）
function encodeTextFrame(str) {
  const payload = Buffer.from(str, 'utf-8');
  const maskBit = 0;
  let header;

  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // fin + text opcode
    header[1] = maskBit | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = maskBit | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  return Buffer.concat([header, payload]);
}

// 编码 WebSocket close 帧
function encodeCloseFrame(code = 1000, reason = '') {
  const payload = Buffer.alloc(2 + Buffer.byteLength(reason, 'utf-8'));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2, 'utf-8');
  const header = Buffer.alloc(2);
  header[0] = 0x88; // fin + close opcode
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

// 编码 WebSocket ping 帧
function encodePingFrame(data = '') {
  const payload = Buffer.from(data, 'utf-8');
  const header = Buffer.alloc(2);
  header[0] = 0x89;
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

// 编码 WebSocket pong 帧
function encodePongFrame(data = '') {
  const payload = Buffer.from(data, 'utf-8');
  const header = Buffer.alloc(2);
  header[0] = 0x8a;
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

// ==================== WebSocket 连接管理 ====================

const clients = new Set();

function handleWSConnection(socket) {
  let authed = !AUTH_TOKEN;
  let buffer = Buffer.alloc(0);

  clients.add(socket);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      const frame = decodeFrame(buffer);
      if (!frame) break;

      buffer = buffer.subarray(frame.frameLen);

      switch (frame.opcode) {
        case 0x1: { // 文本帧
          const text = frame.payload.toString('utf-8');
          handleMCPMessage(socket, text, authed);
          if (!authed) authed = true;
          break;
        }
        case 0x9: { // ping
          socket.write(encodePongFrame(frame.payload.toString('utf-8')));
          break;
        }
        case 0x8: { // close
          socket.write(encodeCloseFrame());
          socket.end();
          clients.delete(socket);
          break;
        }
        case 0xa: // pong，忽略
          break;
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
  });

  socket.on('error', (err) => {
    log(`WebSocket 连接错误: ${err.message}`);
    clients.delete(socket);
  });
}

// 发送 JSON-RPC 响应
function wsSend(socket, obj) {
  socket.write(encodeTextFrame(JSON.stringify(obj)));
}

// ==================== MCP 协议处理 ====================

function handleMCPMessage(socket, text, alreadyAuthed) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }

  // 通知消息无需响应
  if (msg.method === 'notifications/initialized') return;

  // initialize
  if (msg.method === 'initialize') {
    if (AUTH_TOKEN) {
      const clientToken = msg.params?.clientInfo?.token
        || msg.params?._meta?.token
        || msg.params?.token;
      if (clientToken !== AUTH_TOKEN) {
        wsSend(socket, {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32001, message: 'Unauthorized' },
        });
        socket.write(encodeCloseFrame(1008, 'Unauthorized'));
        socket.end();
        return;
      }
    }
    wsSend(socket, {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-request-analyzer-mcp', version: '1.0.0' },
      },
    });
    return;
  }

  // tools/list
  if (msg.method === 'tools/list') {
    wsSend(socket, {
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools: cachedTools },
    });
    return;
  }

  // tools/call
  if (msg.method === 'tools/call') {
    const toolName = msg.params?.name;
    const arguments_ = msg.params?.arguments || {};
    const callId = crypto.randomUUID();

    const timeout = setTimeout(() => {
      if (pendingCalls.has(callId)) {
        pendingCalls.delete(callId);
        wsSend(socket, {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: `工具调用超时: ${toolName}` }],
            isError: true,
          },
        });
      }
    }, 30000);

    pendingCalls.set(callId, {
      resolve(result) {
        clearTimeout(timeout);
        wsSend(socket, {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          },
        });
      },
    });

    writeNMMessage({
      type: 'CALL_REQUEST',
      callId,
      toolName,
      arguments: arguments_,
    });
    return;
  }

  // 未知方法
  wsSend(socket, {
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  });
}

// ==================== HTTP Server + WebSocket 升级 ====================

const server = http.createServer((req, res) => {
  res.writeHead(404).end();
});

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/mcp') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  socket.write(wsHandshake(key));
  handleWSConnection(socket);
});

server.listen(port, 'localhost', () => {
  log(`MCP Server 启动，WebSocket 监听 localhost:${port}/mcp`);
  if (AUTH_TOKEN) log('鉴权 Token 已配置');
  else log('未配置鉴权 Token，允许所有连接');
});

// ==================== 启动 stdin 监听 ====================

process.stdin.resume();
listenStdin().catch((err) => {
  log(`stdin 监听错误: ${err.message}`);
  process.exit(1);
});

// ==================== 工具函数 ====================

function log(msg) {
  process.stderr.write(`[MCP-Helper] ${new Date().toISOString()} ${msg}\n`);
}
