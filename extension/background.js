'use strict';

var MENU_IDS = {
  OPEN_PANEL: 'ai_req_analyzer_open_panel',
  OPEN_CONFIG: 'ai_req_analyzer_open_config',
  RESET_POS: 'ai_req_analyzer_reset_positions',
  DIAG: 'ai_req_analyzer_diagnostics'
};

function escapeRegExpMcp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyPathParamsToTemplate(pathnameTemplate, pathParamKeys, toolArguments) {
  var path = pathnameTemplate || '';
  var keys = pathParamKeys || [];
  if (!keys.length || path.indexOf('{') === -1) return path;
  var ki;
  for (ki = 0; ki < keys.length; ki++) {
    var k = keys[ki];
    var val = toolArguments[k];
    if (val === undefined || val === null) val = '';
    path = path.replace(new RegExp('\\{' + escapeRegExpMcp(k) + '\\}', 'g'), encodeURIComponent(String(val)));
  }
  return path;
}

function partitionMcpToolArguments(toolMeta, toolArguments) {
  var args = toolArguments || {};
  var pathKeys = toolMeta.pathParamKeys || [];
  var pathnameTemplate = toolMeta.pathname || '';
  var resolvedPath = pathnameTemplate;
  if (pathKeys.length && pathnameTemplate.indexOf('{') !== -1) {
    resolvedPath = applyPathParamsToTemplate(pathnameTemplate, pathKeys, args);
  }
  var rest = {};
  var ak = Object.keys(args);
  var ai;
  for (ai = 0; ai < ak.length; ai++) {
    var key = ak[ai];
    if (key.charAt(0) === '_') continue;
    if (pathKeys.indexOf(key) >= 0) continue;
    rest[key] = args[key];
  }
  return { pathname: resolvedPath, restArgs: rest };
}

function installMenus() {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: MENU_IDS.OPEN_PANEL,
      title: '打开请求分析面板',
      contexts: ['page', 'frame', 'editable', 'link', 'selection', 'audio', 'video', 'image']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.OPEN_CONFIG,
      title: '配置',
      contexts: ['page', 'frame', 'editable', 'link', 'selection', 'audio', 'video', 'image']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.RESET_POS,
      title: '重置悬浮窗位置',
      contexts: ['page', 'frame', 'editable', 'link', 'selection', 'audio', 'video', 'image']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.DIAG,
      title: '诊断运行状态',
      contexts: ['page', 'frame', 'editable', 'link', 'selection', 'audio', 'video', 'image']
    });
  });
}

chrome.runtime.onInstalled.addListener(function () {
  installMenus();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(function () {
    installMenus();
  });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab || typeof tab.id === 'undefined') return;
  var action = null;
  if (info.menuItemId === MENU_IDS.OPEN_PANEL) action = 'open_panel';
  else if (info.menuItemId === MENU_IDS.OPEN_CONFIG) action = 'open_config';
  else if (info.menuItemId === MENU_IDS.RESET_POS) action = 'reset_positions';
  else if (info.menuItemId === MENU_IDS.DIAG) action = 'diagnostics';
  if (!action) return;
  chrome.tabs.sendMessage(tab.id, {
    type: 'AI_REQ_ANALYZER_MENU',
    action: action
  }).catch(function () {});
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return;

  if (message.type === 'INJECT_PAGE_HOOK') {
    var injTabId = sender.tab && sender.tab.id;
    if (typeof injTabId === 'undefined') {
      return Promise.resolve({ ok: false, error: 'no sender.tab（内容脚本发往后台即可获得 tab）' });
    }
    return chrome.scripting
      .executeScript({
        target: { tabId: injTabId, allFrames: false },
        world: 'MAIN',
        files: ['content/page-hook.js']
      })
      .then(function () {
        return { ok: true };
      })
      .catch(function (err) {
        return {
          ok: false,
          error: err && err.message ? err.message : 'executeScript failed'
        };
      });
  }

  if (message.type === 'READ_PAGE_HOOK_INSTALLED') {
    var hookTid = sender.tab && sender.tab.id;
    if (typeof hookTid === 'undefined') {
      return Promise.resolve({ hooked: false, error: 'no tab id' });
    }
    return chrome.scripting
      .executeScript({
        target: { tabId: hookTid, allFrames: false },
        world: 'MAIN',
        func: function () {
          try {
            return !!window.__AI_REQ_ANALYZER_HOOKED__;
          } catch (e) {
            return false;
          }
        }
      })
      .then(function (results) {
        return {
          hooked: !!(results && results[0] && results[0].result)
        };
      })
      .catch(function (err) {
        return { hooked: false, error: err && err.message ? err.message : String(err) };
      });
  }

  if (message.type === 'MCP_START_HELPER') {
    var cfgPort = (message.payload && message.payload.mcpPort) || 9527;
    mcpState.serverPort = cfgPort;
    connectMcpHelper(function (result) {
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'MCP_STOP_HELPER') {
    disconnectMcpHelper();
    sendResponse({ ok: true, connected: false });
    return true;
  }

  if (message.type === 'MCP_SYNC_TOOLS') {
    syncToolsToHelper();
    sendResponse({ ok: true, synced: mcpState.helperConnected });
    return true;
  }

  if (message.type === 'MCP_GET_STATUS') {
    sendResponse({
      helperConnected: mcpState.helperConnected,
      serverPort: mcpState.serverPort,
      callLogCount: mcpState.callLogs.length,
      helperError: mcpState.helperError
    });
    return true;
  }

  if (message.type === 'MCP_GET_CALL_LOGS') {
    sendResponse({ logs: mcpState.callLogs });
    return true;
  }

  if (message.type === 'MCP_TOOL_TEST') {
    var testToolName = message.toolName;
    var testArgs = message.arguments || {};
    var testStartTime = Date.now();

    chrome.storage.local.get(null, function (items) {
      var toolDef = null;
      var toolMeta = null;
      var storageKeys = Object.keys(items);
      for (var ki = 0; ki < storageKeys.length; ki++) {
        var key = storageKeys[ki];
        if (key.indexOf('ai_req_mcp_tools_') !== 0) continue;
        var toolsObj = parseStoredTools(items[key]);
        if (toolsObj && toolsObj[testToolName]) {
          toolDef = toolsObj[testToolName];
          toolMeta = toolDef._meta || {};
          break;
        }
      }

      if (!toolDef) {
        sendResponse({ ok: false, error: 'Tool not found: ' + testToolName });
        return;
      }

      var origin = toolMeta.origin || '';
      var method = toolMeta.method || 'GET';
      var execHeaders = toolMeta.rawRequestHeaders || toolMeta.sampleRequestHeaders || {};

      var partedTest = partitionMcpToolArguments(toolMeta, testArgs);
      var pathname = partedTest.pathname;

      var queryString = '';
      var bodyData = {};
      var argKeys = Object.keys(partedTest.restArgs);
      for (var ai = 0; ai < argKeys.length; ai++) {
        var argKey = argKeys[ai];
        if (argKey.charAt(0) === '_') continue;
        var isInQuery = toolMeta.queryParams && toolMeta.queryParams.indexOf(argKey) >= 0;
        if (isInQuery || method.toUpperCase() === 'GET') {
          queryString += (queryString ? '&' : '?') + encodeURIComponent(argKey) + '=' + encodeURIComponent(String(partedTest.restArgs[argKey]));
        } else {
          bodyData[argKey] = partedTest.restArgs[argKey];
        }
      }

      var fullUrl = origin + pathname + queryString;

      findTargetTab(origin).then(function (tab) {
        if (tab) {
          var proxyPayload = {
            callId: 'test_' + Date.now(),
            toolName: testToolName,
            url: fullUrl,
            method: method,
            headers: execHeaders,
            body: bodyData,
            timeout: 30000
          };
          chrome.tabs.sendMessage(tab.id, { type: 'MCP_PROXY_REQUEST', payload: proxyPayload }, function (response) {
            addMcpCallLog({
              timestamp: Date.now(),
              toolName: testToolName,
              argsSummary: JSON.stringify(testArgs).substring(0, 200),
              status: (response && response.status) || 0,
              duration: Date.now() - testStartTime,
              proxyMode: 'test-tab',
              error: (response && response.error) || null
            });
            sendResponse(response || { ok: false, error: 'No response from content script' });
          });
        } else {
          fallbackFetch(toolMeta, fullUrl, method, execHeaders, bodyData).then(function (fbResult) {
            addMcpCallLog({
              timestamp: Date.now(),
              toolName: testToolName,
              argsSummary: JSON.stringify(testArgs).substring(0, 200),
              status: fbResult.status || 0,
              duration: Date.now() - testStartTime,
              proxyMode: 'test-fallback',
              error: fbResult.error || null
            });
            sendResponse(fbResult);
          }).catch(function (err) {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
          });
        }
      });
    });

    return true;
  }

  if (message.type !== 'AI_CHAT_COMPLETIONS') return;

  var p = message.payload || {};
  var url = p.url;
  var apiKey = p.apiKey;
  var model = p.model;
  var messages = p.messages;
  var temperature = p.temperature;

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: temperature
    })
  })
    .then(function (res) {
      return res.text().then(function (text) {
        return { ok: res.ok, status: res.status, text: text };
      });
    })
    .then(function (r) {
      try {
        var data = JSON.parse(r.text);
        if (data.choices && data.choices[0] && data.choices[0].message) {
          sendResponse({
            ok: true,
            content: data.choices[0].message.content
          });
        } else {
          sendResponse({
            ok: false,
            error: 'AI返回格式异常: ' + r.text
          });
        }
      } catch (e) {
        sendResponse({
          ok: false,
          error: '解析AI响应失败: ' + e.message + ' · ' + (r.text || '').slice(0, 200)
        });
      }
    })
    .catch(function (err) {
      sendResponse({
        ok: false,
        error: 'AI请求失败: ' + (err && err.message ? err.message : String(err))
      });
    });

  return true;
});

var mcpState = {
  helperConnected: false,
  helperPort: null,
  helperError: null,
  helperStopping: false,
  tools: {},
  callLogs: [],
  pendingCalls: {},
  serverPort: 9527
};

function parseStoredTools(toolsVal) {
  if (!toolsVal) return null;
  if (typeof toolsVal === 'string') {
    try {
      return JSON.parse(toolsVal);
    } catch (e) {
      return null;
    }
  }
  if (typeof toolsVal === 'object') return toolsVal;
  return null;
}

function connectMcpHelper() {
  var onDone = arguments[0];
  var settled = false;
  var connectTimeout = null;

  function finish(result) {
    if (settled) return;
    settled = true;
    if (connectTimeout) clearTimeout(connectTimeout);
    if (typeof onDone === 'function') onDone(result);
  }

  disconnectMcpHelper();
  mcpState.helperConnected = false;
  mcpState.helperError = null;
  mcpState.helperStopping = false;

  try {
    mcpState.helperPort = chrome.runtime.connectNative('com.aireq.mcp_helper');
  } catch (e) {
    mcpState.helperConnected = false;
    mcpState.helperError = e && e.message ? e.message : 'Native Messaging Host 启动失败';
    finish({ ok: false, connected: false, error: mcpState.helperError });
    return;
  }

  connectTimeout = setTimeout(function () {
    if (settled) return;
    mcpState.helperConnected = false;
    mcpState.helperError = 'Native Messaging Host 未响应，请确认已执行 install.mjs 并重启浏览器';
    disconnectMcpHelper();
    finish({ ok: false, connected: false, error: mcpState.helperError });
  }, 2000);

  mcpState.helperPort.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'PONG') {
      mcpState.helperConnected = true;
      mcpState.helperError = null;
      syncToolsToHelper();
      finish({ ok: true, connected: true, serverPort: mcpState.serverPort });
      return;
    }
    handleHelperMessage(msg);
  });

  mcpState.helperPort.onDisconnect.addListener(function () {
    var lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
    mcpState.helperConnected = false;
    mcpState.helperPort = null;
    if (mcpState.helperStopping) {
      mcpState.helperStopping = false;
      mcpState.helperError = null;
      finish({ ok: false, connected: false, error: null });
      return;
    }
    mcpState.helperError = lastError || 'Native Messaging Host 已断开';
    finish({ ok: false, connected: false, error: mcpState.helperError });
  });

  try {
    mcpState.helperPort.postMessage({ type: 'PING' });
  } catch (e2) {
    mcpState.helperConnected = false;
    mcpState.helperError = e2 && e2.message ? e2.message : 'Native Messaging Host 通信失败';
    disconnectMcpHelper();
    finish({ ok: false, connected: false, error: mcpState.helperError });
  }
}

function disconnectMcpHelper() {
  if (mcpState.helperPort) {
    mcpState.helperStopping = true;
    try {
      mcpState.helperPort.postMessage({ type: 'SHUTDOWN' });
    } catch (e) {}
    mcpState.helperPort.disconnect();
    mcpState.helperPort = null;
  }
  mcpState.helperConnected = false;
  mcpState.helperError = null;
}

function handleHelperMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'CALL_REQUEST') {
    handleMcpToolCall(msg.callId, msg.toolName, msg.arguments || {});
  }
}

function findTargetTab(origin) {
  return new Promise(function (resolve) {
    chrome.tabs.query({ url: origin + '/*' }, function (tabs) {
      if (!tabs || tabs.length === 0) {
        resolve(null);
        return;
      }
      tabs.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); });
      resolve(tabs[0]);
    });
  });
}

function fallbackFetch(toolMeta, url, method, headers, body) {
  var fetchHeaders = {};
  if (headers && typeof headers === 'object') {
    var hKeys = Object.keys(headers);
    for (var hi = 0; hi < hKeys.length; hi++) {
      fetchHeaders[hKeys[hi]] = headers[hKeys[hi]];
    }
  }
  var fetchOpts = {
    method: method || 'GET',
    headers: fetchHeaders
  };
  if (method && method.toUpperCase() !== 'GET' && body && Object.keys(body).length > 0) {
    fetchOpts.body = JSON.stringify(body);
    if (!fetchHeaders['Content-Type']) {
      fetchHeaders['Content-Type'] = 'application/json';
    }
  }
  return fetch(url, fetchOpts).then(function (res) {
    return res.text().then(function (text) {
      var resHeaders = {};
      res.headers.forEach(function (val, key) {
        resHeaders[key] = val;
      });
      return {
        ok: res.ok,
        status: res.status,
        headers: resHeaders,
        body: text,
        proxyMode: 'fallback'
      };
    });
  }).catch(function (err) {
    return {
      ok: false,
      status: 0,
      error: err && err.message ? err.message : String(err),
      proxyMode: 'fallback'
    };
  });
}

function handleMcpToolCall(callId, toolName, toolArguments) {
  var startTime = Date.now();
  chrome.storage.local.get(null, function (items) {
    var toolDef = null;
    var toolMeta = null;
    var storageKeys = Object.keys(items);
    for (var ki = 0; ki < storageKeys.length; ki++) {
      var key = storageKeys[ki];
      if (key.indexOf('ai_req_mcp_tools_') !== 0) continue;
      var hostname = key.substring('ai_req_mcp_tools_'.length);
      var toolsObj = parseStoredTools(items[key]);
      if (toolsObj && toolsObj[toolName]) {
        toolDef = toolsObj[toolName];
        toolMeta = toolDef._meta || {};
        break;
      }
    }

    if (!toolDef) {
      var notFoundResult = { ok: false, error: 'Tool not found: ' + toolName, callId: callId };
      addMcpCallLog({
        timestamp: Date.now(),
        toolName: toolName,
        argsSummary: JSON.stringify(toolArguments).substring(0, 200),
        status: 0,
        duration: Date.now() - startTime,
        proxyMode: 'none',
        error: 'Tool not found'
      });
      if (mcpState.helperPort && mcpState.helperConnected) {
        mcpState.helperPort.postMessage({ type: 'CALL_RESULT', callId: callId, result: notFoundResult });
      }
      return;
    }

    var origin = toolMeta.origin || '';
    var method = toolMeta.method || 'GET';
    var execHeaders = toolMeta.rawRequestHeaders || toolMeta.sampleRequestHeaders || {};

    var partedCall = partitionMcpToolArguments(toolMeta, toolArguments);
    var pathname = partedCall.pathname;

    var queryString = '';
    var bodyData = {};
    var argKeys = Object.keys(partedCall.restArgs);
    for (var ai = 0; ai < argKeys.length; ai++) {
      var argKey = argKeys[ai];
      if (argKey.charAt(0) === '_') continue;
      var isInQuery = toolMeta.queryParams && toolMeta.queryParams.indexOf(argKey) >= 0;
      if (isInQuery || method.toUpperCase() === 'GET') {
        queryString += (queryString ? '&' : '?') + encodeURIComponent(argKey) + '=' + encodeURIComponent(String(partedCall.restArgs[argKey]));
      } else {
        bodyData[argKey] = partedCall.restArgs[argKey];
      }
    }

    var fullUrl = origin + pathname + queryString;

    findTargetTab(origin).then(function (tab) {
      if (tab) {
        var proxyPayload = {
          callId: callId,
          toolName: toolName,
          url: fullUrl,
          method: method,
          headers: execHeaders,
          body: bodyData,
          timeout: 30000
        };
        chrome.tabs.sendMessage(tab.id, { type: 'MCP_PROXY_REQUEST', payload: proxyPayload }, function (response) {
          var result = response || { ok: false, error: 'No response from content script', proxyMode: 'tab' };
          result.callId = callId;

          addMcpCallLog({
            timestamp: Date.now(),
            toolName: toolName,
            argsSummary: JSON.stringify(toolArguments).substring(0, 200),
            status: result.status || 0,
            duration: Date.now() - startTime,
            proxyMode: result.proxyMode || 'tab',
            error: result.error || null
          });

          if (mcpState.helperPort && mcpState.helperConnected) {
            mcpState.helperPort.postMessage({ type: 'CALL_RESULT', callId: callId, result: result });
          }
        });
      } else {
        fallbackFetch(toolMeta, fullUrl, method, execHeaders, bodyData).then(function (fbResult) {
          fbResult.callId = callId;

          addMcpCallLog({
            timestamp: Date.now(),
            toolName: toolName,
            argsSummary: JSON.stringify(toolArguments).substring(0, 200),
            status: fbResult.status || 0,
            duration: Date.now() - startTime,
            proxyMode: 'fallback',
            error: fbResult.error || null
          });

          if (mcpState.helperPort && mcpState.helperConnected) {
            mcpState.helperPort.postMessage({ type: 'CALL_RESULT', callId: callId, result: fbResult });
          }
        });
      }
    });
  });
}

function syncToolsToHelper() {
  if (!mcpState.helperPort) return;
  chrome.storage.local.get(null, function (items) {
    var allTools = {};
    var storageKeys = Object.keys(items);
    for (var ki = 0; ki < storageKeys.length; ki++) {
      var key = storageKeys[ki];
      if (key.indexOf('ai_req_mcp_tools_') !== 0) continue;
      var toolsObj = parseStoredTools(items[key]);
      if (!toolsObj || typeof toolsObj !== 'object') continue;
      var tKeys = Object.keys(toolsObj);
      for (var ti = 0; ti < tKeys.length; ti++) {
        allTools[tKeys[ti]] = toolsObj[tKeys[ti]];
      }
    }
    try {
      mcpState.helperPort.postMessage({ type: 'SYNC_TOOLS', tools: allTools });
      console.log('[AI_REQ_ANALYZER] synced tools to helper:', Object.keys(allTools).length);
    } catch (e) {}
  });
}

function addMcpCallLog(logEntry) {
  mcpState.callLogs.push(logEntry);
  if (mcpState.callLogs.length > 200) {
    mcpState.callLogs.shift();
  }
}
