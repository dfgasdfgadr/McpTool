function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function truncateBody(body) {
  if (!body) return '';
  var str = typeof body === 'string' ? body : JSON.stringify(body);
  if (str.length > MAX_AI_BODY_LENGTH) {
    return str.substring(0, MAX_AI_BODY_LENGTH) + '...[truncated]';
  }
  return str;
}

function formatJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

function getContainer() {
  if (document.body && document.body.parentNode) return document.body;
  if (document.documentElement) return document.documentElement;
  return document.getElementsByTagName('html')[0] || document.appendChild(document.createElement('html'));
}

function getScopedStorageKey(name) {
  return name + '_' + location.hostname;
}

function clampPosition(pos, width, height) {
  var viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  var viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  return {
    left: Math.max(0, Math.min(viewportWidth - width, parseInt(pos.left, 10) || 0)),
    top: Math.max(0, Math.min(viewportHeight - height, parseInt(pos.top, 10) || 0))
  };
}

function ensureElementInViewport(el, width, height, fallbackRight, fallbackBottom) {
  if (!el) return;
  var rect = el.getBoundingClientRect();
  var viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  var viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  if (rect.right < 0 || rect.bottom < 0 || rect.left > viewportWidth || rect.top > viewportHeight) {
    el.style.left = 'auto';
    el.style.top = 'auto';
    el.style.right = fallbackRight;
    el.style.bottom = fallbackBottom;
  }
}

function safeAppendChild(child) {
  try {
    getContainer().appendChild(child);
  } catch (e) {
    setTimeout(function () {
      try { getContainer().appendChild(child); } catch (e2) {}
    }, 1000);
  }
}

function tryParseJson(str) {
  if (!str) return null;
  if (typeof str !== 'string') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
}

function stableSortedJsonValue(val) {
  if (val === null || val === undefined) return JSON.stringify(val);
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return '[' + val.map(function (item) {
      return stableSortedJsonValue(item);
    }).join(',') + ']';
  }
  var keys = Object.keys(val).sort();
  var parts = [];
  for (var k = 0; k < keys.length; k++) {
    parts.push(JSON.stringify(keys[k]) + ':' + stableSortedJsonValue(val[keys[k]]));
  }
  return '{' + parts.join(',') + '}';
}

function stableQueryFingerprint(urlStr) {
  try {
    var parsed = new URL(urlStr);
    var keys = [];
    parsed.searchParams.forEach(function (_, kk) {
      if (keys.indexOf(kk) === -1) keys.push(kk);
    });
    keys.sort();
    var pairs = [];
    for (var i = 0; i < keys.length; i++) {
      pairs.push(keys[i] + '=' + parsed.searchParams.get(keys[i]));
    }
    return pairs.join('&');
  } catch (e) {
    return '';
  }
}

function fingerprintBody(body) {
  if (body == null || body === '') return '';
  if (typeof body === 'string') {
    var t = body.trim();
    if (!t) return '';
    var parsed = tryParseJson(t);
    if (parsed !== t && parsed && typeof parsed === 'object') {
      return stableSortedJsonValue(parsed);
    }
    return t;
  }
  if (typeof body === 'object') {
    return stableSortedJsonValue(body);
  }
  return String(body);
}

function computeRequestSignature(rec) {
  var method = (rec.method || 'GET').toUpperCase();
  var urlStr = rec.originalUrl || rec.url || '';
  var pathnameKey = '';
  try {
    pathnameKey = getMockKey(urlStr);
  } catch (ex) {
    pathnameKey = urlStr;
  }
  var qfp = stableQueryFingerprint(urlStr);
  var bfp = fingerprintBody(rec.requestBody);
  return method + '\n' + pathnameKey + '\n' + qfp + '\n' + bfp;
}

function isDuplicateRequestRecord(record) {
  var sig = computeRequestSignature(record);
  var records = state.requestRecords || [];
  for (var i = 0; i < records.length; i++) {
    if (computeRequestSignature(records[i]) === sig) return true;
  }
  return false;
}

function addRequestRecord(record) {
  if (record.debugRule) {
    record.debugRule = normalizeRule(record.debugRule, getMockKey(record.originalUrl || record.url), record.method);
  }
  if (isDuplicateRequestRecord(record)) return;
  state.requestRecords.push(record);
  if (state.requestRecords.length > MAX_RECORDS) {
    state.requestRecords.shift();
  }
  if (state.isPanelOpen) {
    refreshRequestList();
  }
}

function setupRequestInterception() {
  setupPageContextInterception();
  interceptXHR();
  interceptFetch();
}

function setupPageContextInterception() {
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (!data) return;
    if (data.type === PAGE_RECORD_MSG && data.record) {
      addRequestRecord(data.record);
    } else if (data.type === PAGE_RULE_CONSUMED_MSG && data.key) {
      consumeOnceRuleByKey(data.key);
    }
  });

  chrome.runtime.sendMessage({ type: 'INJECT_PAGE_HOOK' }, function (res) {
    if (chrome.runtime.lastError) {
      console.warn('[AI_REQ_ANALYZER] inject MAIN:', chrome.runtime.lastError.message);
      return;
    }
    if (!res || !res.ok) {
      console.warn('[AI_REQ_ANALYZER] inject MAIN:', res && res.error ? res.error : 'unknown');
      return;
    }
    syncMockRulesToPage();
  });
}

function syncMockRulesToPage() {
  try {
    window.postMessage({ type: PAGE_MOCK_RULES_MSG, rules: state.mockRules || {} }, '*');
  } catch (e) {}
}

function defineMockXhrResponse(xhr, mockJson, mockData, url, responseMeta) {
  responseMeta = responseMeta || {};
  var headers = responseMeta.headers || { 'Content-Type': 'application/json' };
  var headersText = Object.keys(headers).map(function (key) { return key + ': ' + headers[key]; }).join('\r\n') + '\r\n';
  var responseValue = xhr.responseType === 'json' ? mockData : mockJson;
  try { Object.defineProperty(xhr, 'responseText', { value: mockJson, configurable: true }); } catch (e) {}
  try { Object.defineProperty(xhr, 'response', { value: responseValue, configurable: true }); } catch (e2) {}
  try { Object.defineProperty(xhr, 'status', { value: responseMeta.status || 200, configurable: true }); } catch (e3) {}
  try { Object.defineProperty(xhr, 'statusText', { value: responseMeta.statusText || 'OK', configurable: true }); } catch (e4) {}
  try { Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true }); } catch (e5) {}
  try { Object.defineProperty(xhr, 'responseURL', { value: url, configurable: true }); } catch (e6) {}
  try { Object.defineProperty(xhr, 'getAllResponseHeaders', { value: function () { return headersText; }, configurable: true }); } catch (e7) {}
  try { Object.defineProperty(xhr, 'getResponseHeader', { value: function (name) {
    var lower = String(name).toLowerCase();
    var value = null;
    Object.keys(headers).forEach(function (key) {
      if (String(key).toLowerCase() === lower) value = headers[key];
    });
    return value;
  }, configurable: true }); } catch (e8) {}
}

function dispatchMockXhrSuccess(xhr) {
  setTimeout(function () {
    try { xhr.dispatchEvent(new Event('readystatechange')); } catch (e) {}
    try { xhr.dispatchEvent(new ProgressEvent('load')); } catch (e2) {}
    try { xhr.dispatchEvent(new ProgressEvent('loadend')); } catch (e3) {}
  }, 0);
}

function interceptXHR() {
  var OrigXHR = window.XMLHttpRequest;
  if (!OrigXHR) return;
  var origOpen = OrigXHR.prototype.open;
  var origSend = OrigXHR.prototype.send;
  var origSetRequestHeader = OrigXHR.prototype.setRequestHeader;

  OrigXHR.prototype.open = function (method, url) {
    var rule = findDebugRule(url, method);
    var finalUrl = rule && rule.request && rule.request.url ? rule.request.url : url;
    this._aiReqInfo = {
      id: generateId(),
      method: method,
      url: finalUrl,
      originalUrl: url,
      requestHeaders: {},
      requestBody: null,
      startTime: Date.now(),
      debugRule: rule || null
    };
    if (rule && rule.request && rule.request.url) {
      arguments[1] = rule.request.url;
    }
    return origOpen.apply(this, arguments);
  };

  OrigXHR.prototype.setRequestHeader = function (name, value) {
    if (this._aiReqInfo) {
      var rule = this._aiReqInfo.debugRule;
      var removeList = rule && rule.request ? rule.request.headersRemove || [] : [];
      for (var i = 0; i < removeList.length; i++) {
        if (String(removeList[i]).toLowerCase() === String(name).toLowerCase()) return;
      }
      this._aiReqInfo.requestHeaders[name] = value;
    }
    return origSetRequestHeader.apply(this, arguments);
  };

  OrigXHR.prototype.send = function (body) {
    var self = this;
    if (this._aiReqInfo) {
      this._aiReqInfo.requestBody = body;
      var reqInfo = this._aiReqInfo;

      var rule = reqInfo.debugRule || findDebugRule(reqInfo.originalUrl || reqInfo.url, reqInfo.method);
      if (rule && rule.request && rule.request.headersSet) {
        Object.keys(rule.request.headersSet).forEach(function (name) {
          try {
            origSetRequestHeader.call(self, name, rule.request.headersSet[name]);
            reqInfo.requestHeaders[name] = rule.request.headersSet[name];
          } catch (e) {}
        });
      }
      var mockMatch = hasResponseBodyMock(rule) ? rule.response.body : null;
      if (hasResponseBodyMock(rule)) {
        reqInfo.isMocked = true;
        reqInfo.mockData = mockMatch;
        var mockJson = JSON.stringify(mockMatch);
        var responseHeaders = buildResponseHeaders(rule, { 'Content-Type': 'application/json' });
        defineMockXhrResponse(self, mockJson, mockMatch, reqInfo.url, {
          status: rule.response.status,
          statusText: rule.response.statusText,
          headers: responseHeaders
        });
        addRequestRecord({
          id: reqInfo.id,
          timestamp: reqInfo.startTime,
          method: reqInfo.method,
          url: reqInfo.url,
          originalUrl: reqInfo.originalUrl,
          requestHeaders: reqInfo.requestHeaders,
          requestBody: tryParseJson(reqInfo.requestBody),
          responseStatus: rule.response.status,
          responseHeaders: responseHeaders,
          responseBody: mockMatch,
          duration: 0,
          aiAnalysis: null,
          isMocked: true,
          mockData: mockMatch,
          debugRule: rule
        });
        consumeOnceRuleByKey(rule._key);
        dispatchMockXhrSuccess(self);
        return;
      }

      self._aiRecorded = false;
      self.addEventListener('readystatechange', function () {
        if (self.readyState !== 4 || self._aiRecorded) return;
        self._aiRecorded = true;
        if (reqInfo.url && reqInfo.url.indexOf('api.moonshot.cn') !== -1) return;
        var duration = Date.now() - reqInfo.startTime;
        var respHeaders = {};
        try {
          var headerStr = self.getAllResponseHeaders();
          var headerLines = headerStr.trim().split(/[\r\n]+/);
          headerLines.forEach(function (line) {
            var parts = line.split(': ');
            var name = parts.shift();
            if (name) respHeaders[name] = parts.join(': ');
          });
        } catch (e) {}

        var respBody = null;
        try {
          respBody = self.responseText;
        } catch (e) {}

        addRequestRecord({
          id: reqInfo.id,
          timestamp: reqInfo.startTime,
          method: reqInfo.method,
          url: reqInfo.url,
          originalUrl: reqInfo.originalUrl,
          requestHeaders: reqInfo.requestHeaders,
          requestBody: tryParseJson(reqInfo.requestBody),
          responseStatus: self.status,
          responseHeaders: respHeaders,
          responseBody: tryParseJson(respBody),
          duration: duration,
          aiAnalysis: null,
          isMocked: false,
          mockData: null,
          debugRule: rule
        });
        consumeOnceRuleByKey(rule && rule._key);
      });
    }
    return origSend.apply(this, arguments);
  };
}

function interceptFetch() {
  var origFetch = window.fetch;
  if (!origFetch) return;

  window.fetch = function (input, init) {
    var url, method, originalUrl;
    try {
      url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      method = (init && init.method) || (input instanceof Request ? input.method : 'GET');
    } catch (e) {
      url = String(input);
      method = (init && init.method) || 'GET';
    }
    originalUrl = url;
    var reqHeaders = {};
    if (init && init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach(function (v, k) { reqHeaders[k] = v; });
      } else if (typeof init.headers === 'object') {
        reqHeaders = Object.assign({}, init.headers);
      }
    }
    var reqBody = init && init.body ? init.body : null;

    var rule = findDebugRule(url, method);
    var finalInput = input;
    var finalInit = init ? Object.assign({}, init) : {};
    if (rule && rule.request) {
      reqHeaders = applyHeaderRewrite(reqHeaders, rule.request.headersSet, rule.request.headersRemove);
      finalInit.headers = reqHeaders;
      if (rule.request.url) {
        url = rule.request.url;
        finalInput = url;
      }
    }

    var mockMatch = hasResponseBodyMock(rule) ? rule.response.body : null;
    if (hasResponseBodyMock(rule)) {
      var reqId = generateId();
      var startTime = Date.now();
      var responseHeaders = buildResponseHeaders(rule, { 'Content-Type': 'application/json' });
      var mockResponse = new Response(JSON.stringify(mockMatch), {
        status: rule.response.status,
        statusText: rule.response.statusText,
        headers: responseHeaders
      });

      addRequestRecord({
        id: reqId,
        timestamp: startTime,
        method: method,
        url: url,
        originalUrl: originalUrl,
        requestHeaders: reqHeaders,
        requestBody: tryParseJson(reqBody),
        responseStatus: rule.response.status,
        responseHeaders: responseHeaders,
        responseBody: mockMatch,
        duration: 0,
        aiAnalysis: null,
        isMocked: true,
        mockData: mockMatch,
        debugRule: rule
      });
      consumeOnceRuleByKey(rule._key);

      return Promise.resolve(mockResponse);
    }

    try {
      if (url.indexOf('api.moonshot.cn') !== -1) {
        return origFetch.apply(this, arguments);
      }
    } catch (e) {}

    var reqId = generateId();
    var startTime = Date.now();

    return origFetch.call(this, finalInput, finalInit).then(function (response) {
      var returnedResponse = response;
      if (hasResponseHeaderRewrite(rule)) {
        returnedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: buildResponseHeaders(rule, collectHeaders(response.headers))
        });
      }
      var cloned = returnedResponse.clone();
      cloned.text().then(function (text) {
        var duration = Date.now() - startTime;
        var respHeaders = {};
        try {
          returnedResponse.headers.forEach(function (v, k) { respHeaders[k] = v; });
        } catch (e) {}

        addRequestRecord({
          id: reqId,
          timestamp: startTime,
          method: method.toUpperCase(),
          url: url,
          originalUrl: originalUrl,
          requestHeaders: reqHeaders,
          requestBody: tryParseJson(reqBody),
          responseStatus: returnedResponse.status,
          responseHeaders: respHeaders,
          responseBody: tryParseJson(text),
          duration: duration,
          aiAnalysis: null,
          isMocked: false,
          mockData: null,
          debugRule: rule
        });
      }).catch(function () {
        var duration = Date.now() - startTime;
        addRequestRecord({
          id: reqId,
          timestamp: startTime,
          method: method.toUpperCase(),
          url: url,
          originalUrl: originalUrl,
          requestHeaders: reqHeaders,
          requestBody: tryParseJson(reqBody),
          responseStatus: returnedResponse.status,
          responseHeaders: {},
          responseBody: null,
          duration: duration,
          aiAnalysis: null,
          isMocked: false,
          mockData: null,
          debugRule: rule
        });
      });
      consumeOnceRuleByKey(rule && rule._key);
      return returnedResponse;
    }).catch(function (err) {
      addRequestRecord({
        id: reqId,
        timestamp: startTime,
        method: method.toUpperCase(),
        url: url,
        originalUrl: originalUrl,
        requestHeaders: reqHeaders,
        requestBody: tryParseJson(reqBody),
        responseStatus: 0,
        responseHeaders: {},
        responseBody: err.message || String(err),
        duration: Date.now() - startTime,
        aiAnalysis: null,
        isMocked: false,
        mockData: null,
        debugRule: rule
      });
      consumeOnceRuleByKey(rule && rule._key);
      throw err;
    });
  };
}

function setupMenuCommands() {
  if (state.menuReady) return;
  state.menuReady = true;

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg || msg.type !== 'AI_REQ_ANALYZER_MENU') return;

    if (msg.action === 'diagnostics') {
      chrome.runtime.sendMessage({ type: 'READ_PAGE_HOOK_INSTALLED' }, function (r) {
        var pageHooked = false;
        if (!chrome.runtime.lastError && r && r.hooked === true) {
          pageHooked = true;
        }
        alert(
          'AI请求分析助手状态：\n' +
            'URL: ' + location.href + '\n' +
            'UI: ' + (state.uiReady ? '已初始化' : '未初始化') + '\n' +
            '悬浮球: ' +
            (state.floatingBall && document.contains(state.floatingBall) ? '已挂载' : '未挂载') +
            '\n' +
            '请求数: ' + state.requestRecords.length + '\n' +
            '页面Hook: ' +
            (pageHooked ? '已注入' : '未知/注入失败或被阻止')
        );
        sendResponse({ ok: true });
      });
      return true;
    }

    switch (msg.action) {
      case 'open_panel':
        if (!state.uiReady) onDOMContentLoaded();
        if (!state.isPanelOpen) toggleMainPanel();
        break;
      case 'open_config':
        if (!state.uiReady) onDOMContentLoaded();
        openConfigPanel();
        break;
      case 'reset_positions':
        storageSet(getScopedStorageKey('ai_req_ball_position'), null);
        storageSet(getScopedStorageKey('ai_req_panel_position'), null);
        if (state.floatingBall) {
          state.floatingBall.style.left = 'auto';
          state.floatingBall.style.top = 'auto';
          state.floatingBall.style.right = '20px';
          state.floatingBall.style.bottom = '20px';
        }
        if (state.mainPanel) {
          state.mainPanel.style.left = 'auto';
          state.mainPanel.style.top = 'auto';
          state.mainPanel.style.right = '90px';
          state.mainPanel.style.bottom = '20px';
        }
        showToast('悬浮窗位置已重置');
        break;
      default:
        break;
    }
    sendResponse({ ok: true });
    return false;
  });
}

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg && msg.type === 'MCP_PROXY_REQUEST') {
    handleMcpProxyRequest(msg.payload, sendResponse);
    return true;
  }
});
