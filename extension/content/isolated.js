(function () {

  var STORAGE_CACHE = {};

  function storageGet(key, defVal) {
    if (Object.prototype.hasOwnProperty.call(STORAGE_CACHE, key)) return STORAGE_CACHE[key];
    return defVal;
  }

  function storageSet(key, val) {
    if (val === null || typeof val === 'undefined') {
      delete STORAGE_CACHE[key];
      chrome.storage.local.remove(key);
      return;
    }
    STORAGE_CACHE[key] = val;
    var o = {};
    o[key] = val;
    chrome.storage.local.set(o);
  }

  function storageHydrateThen(cb) {
    chrome.storage.local.get(null, function (items) {
      if (chrome.runtime.lastError) {
        cb();
        return;
      }
      if (items) Object.assign(STORAGE_CACHE, items);
      cb();
    });
  }

  var DEFAULT_CONFIG = {
    apiKey: '',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    temperature: 1
  };
  var CONFIG_KEY = 'ai_req_analyzer_config';
  var MOCK_RULES_KEY_PREFIX = 'ai_req_mock_rules_';
  var PAGE_RECORD_MSG = 'AI_REQ_ANALYZER_PAGE_RECORD';
  var PAGE_MOCK_RULES_MSG = 'AI_REQ_ANALYZER_MOCK_RULES';
  var PAGE_RULE_CONSUMED_MSG = 'AI_REQ_ANALYZER_RULE_CONSUMED';
  var MAX_RECORDS = 100;
  var MAX_AI_BODY_LENGTH = 2000;

  var state = {
    config: Object.assign({}, DEFAULT_CONFIG),
    requestRecords: [],
    mockRules: {},
    floatingBall: null,
    mainPanel: null,
    configPanel: null,
    jsonEditor: null,
    rewriteEditor: null,
    isPanelOpen: false,
    expandedReqId: null,
    isAnalyzing: false,
    analyzeProgress: { total: 0, done: 0 },
    selectedReqId: null,
    selectedRewriteReqId: null,
    uiReady: false,
    menuReady: false
  };

  function loadConfig() {
    try {
      var saved = storageGet(CONFIG_KEY, null);
      if (saved) {
        state.config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(saved));
      }
    } catch (e) {}
  }

  function saveConfig() {
    storageSet(CONFIG_KEY, JSON.stringify(state.config));
  }

  function loadMockRules() {
    try {
      var key = MOCK_RULES_KEY_PREFIX + location.hostname;
      var saved = storageGet(key, null);
      if (saved) {
        state.mockRules = JSON.parse(saved);
        normalizeAllRules();
      }
    } catch (e) {}
  }

  function saveMockRules() {
    var key = MOCK_RULES_KEY_PREFIX + location.hostname;
    normalizeAllRules();
    storageSet(key, JSON.stringify(state.mockRules));
    syncMockRulesToPage();
  }

  function getMockKey(url) {
    if (url == null || url === '') return '';
    var input = typeof url === 'string' ? url : String(url);
    var bases = [];
    try {
      if (typeof location !== 'undefined' && location.href) bases.push(String(location.href));
    } catch (eLoc) {}
    try {
      if (typeof document !== 'undefined' && document.baseURI) bases.push(String(document.baseURI));
    } catch (eDoc) {}
    bases.push('https://local.invalid/');

    for (var i = 0; i < bases.length; i++) {
      try {
        return new URL(input, bases[i]).pathname;
      } catch (e) {}
    }
    return input.length > 240 ? input.slice(0, 240) + '…' : input;
  }

  function isDebugRule(rule) {
    return !!(rule && typeof rule === 'object' && (rule.__aiReqRule === true || rule.match || rule.request || rule.response));
  }

  function normalizeHeaders(headers) {
    var result = {};
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return result;
    Object.keys(headers).forEach(function (key) {
      if (headers[key] !== undefined && headers[key] !== null && key !== '') {
        result[key] = String(headers[key]);
      }
    });
    return result;
  }

  function normalizeRemoveList(list) {
    if (!list) return [];
    if (typeof list === 'string') {
      return list.split(/[\n,]+/).map(function (item) { return item.trim(); }).filter(Boolean);
    }
    if (!Array.isArray(list)) return [];
    return list.map(function (item) { return String(item).trim(); }).filter(Boolean);
  }

  function normalizeRule(raw, key, method) {
    if (!isDebugRule(raw)) {
      return {
        __aiReqRule: true,
        enabled: true,
        once: false,
        match: { pathname: key || '', method: method || '' },
        request: { url: '', headersSet: {}, headersRemove: [] },
        response: {
          status: 200,
          statusText: 'OK',
          headersSet: { 'Content-Type': 'application/json' },
          headersRemove: [],
          bodyEnabled: true,
          body: raw
        }
      };
    }

    var response = raw.response || {};
    var request = raw.request || {};
    var match = raw.match || {};
    return {
      __aiReqRule: true,
      enabled: raw.enabled !== false,
      once: raw.once === true,
      match: {
        pathname: match.pathname || key || '',
        method: (match.method || method || '').toUpperCase()
      },
      request: {
        url: request.url || '',
        headersSet: normalizeHeaders(request.headersSet),
        headersRemove: normalizeRemoveList(request.headersRemove)
      },
      response: {
        status: parseInt(response.status, 10) || 200,
        statusText: response.statusText || 'OK',
        headersSet: normalizeHeaders(response.headersSet || { 'Content-Type': 'application/json' }),
        headersRemove: normalizeRemoveList(response.headersRemove),
        bodyEnabled: response.bodyEnabled === true,
        body: response.body
      }
    };
  }

  function normalizeAllRules() {
    var changed = false;
    Object.keys(state.mockRules || {}).forEach(function (key) {
      var normalized = normalizeRule(state.mockRules[key], key);
      if (normalized !== state.mockRules[key] || !state.mockRules[key].__aiReqRule) {
        state.mockRules[key] = normalized;
        changed = true;
      }
    });
    return changed;
  }

  function findDebugRule(url, method) {
    var key = getMockKey(url);
    var raw = state.mockRules[key];
    if (!raw) return null;
    var rule = normalizeRule(raw, key, method);
    if (!rule.enabled) return null;
    if (rule.match.method && method && rule.match.method !== String(method).toUpperCase()) return null;
    rule._key = key;
    return rule;
  }

  function hasRequestRewrite(rule) {
    return !!(rule && rule.request && (rule.request.url || Object.keys(rule.request.headersSet || {}).length || (rule.request.headersRemove || []).length));
  }

  function hasResponseHeaderRewrite(rule) {
    return !!(rule && rule.response && (Object.keys(rule.response.headersSet || {}).length || (rule.response.headersRemove || []).length));
  }

  function hasResponseBodyMock(rule) {
    return !!(rule && rule.response && rule.response.bodyEnabled === true);
  }

  function removeHeaderCaseInsensitive(headers, name) {
    var lower = String(name).toLowerCase();
    Object.keys(headers || {}).forEach(function (key) {
      if (String(key).toLowerCase() === lower) delete headers[key];
    });
  }

  function applyHeaderRewrite(headers, headersSet, headersRemove) {
    var result = Object.assign({}, headers || {});
    (headersRemove || []).forEach(function (name) { removeHeaderCaseInsensitive(result, name); });
    Object.keys(headersSet || {}).forEach(function (name) { result[name] = String(headersSet[name]); });
    return result;
  }

  function collectHeaders(headers) {
    var result = {};
    try {
      if (!headers) return result;
      if (headers instanceof Headers) {
        headers.forEach(function (v, k) { result[k] = v; });
      } else if (Array.isArray(headers)) {
        headers.forEach(function (item) {
          if (item && item.length >= 2) result[item[0]] = item[1];
        });
      } else if (typeof headers === 'object') {
        Object.keys(headers).forEach(function (key) { result[key] = headers[key]; });
      }
    } catch (e) {}
    return result;
  }

  function buildResponseHeaders(rule, baseHeaders) {
    var headers = applyHeaderRewrite(baseHeaders || {}, rule && rule.response ? rule.response.headersSet : {}, rule && rule.response ? rule.response.headersRemove : []);
    if (!Object.keys(headers).length) headers['Content-Type'] = 'application/json';
    return headers;
  }

  function findMockRule(url, method) {
    var rule = findDebugRule(url, method);
    return hasResponseBodyMock(rule) ? rule.response.body : null;
  }

  function buildSimpleMockRule(req, body) {
    var key = getMockKey(req.originalUrl || req.url);
    var existing = normalizeRule(state.mockRules[key], key, req.method);
    existing.enabled = true;
    existing.match.pathname = key;
    existing.match.method = (req.method || '').toUpperCase();
    existing.response.status = 200;
    existing.response.statusText = 'OK';
    existing.response.headersSet = Object.assign({ 'Content-Type': 'application/json' }, existing.response.headersSet || {});
    existing.response.bodyEnabled = true;
    existing.response.body = body;
    return existing;
  }

  function consumeOnceRuleByKey(key) {
    if (!key || !state.mockRules[key]) return;
    var rule = normalizeRule(state.mockRules[key], key);
    if (!rule.once) return;
    delete state.mockRules[key];
    saveMockRules();
    state.requestRecords.forEach(function (req) {
      if (getMockKey(req.url) === key) {
        req.isMocked = false;
        req.mockData = null;
        req.debugRule = null;
      }
    });
    if (state.isPanelOpen) refreshRequestList();
  }

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

  function tryParseJson(str) {
    if (!str) return null;
    if (typeof str !== 'string') return str;
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }

  function addRequestRecord(record) {
    if (record.debugRule) {
      record.debugRule = normalizeRule(record.debugRule, getMockKey(record.originalUrl || record.url), record.method);
    }
    state.requestRecords.push(record);
    if (state.requestRecords.length > MAX_RECORDS) {
      state.requestRecords.shift();
    }
    if (state.isPanelOpen) {
      refreshRequestList();
    }
  }

  function callAI(messages) {
    return new Promise(function (resolve, reject) {
      if (!state.config.apiKey) {
        reject(new Error('未配置API Key'));
        return;
      }
      var url = state.config.baseURL.replace(/\/$/, '') + '/chat/completions';
      chrome.runtime.sendMessage(
        {
          type: 'AI_CHAT_COMPLETIONS',
          payload: {
            url: url,
            apiKey: state.config.apiKey,
            model: state.config.model,
            messages: messages,
            temperature: 1
          }
        },
        function (res) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (res && res.ok && typeof res.content === 'string') {
            resolve(res.content);
          } else {
            reject(new Error((res && res.error) || 'AI请求失败'));
          }
        }
      );
    });
  }

  function analyzeRequest(reqId) {
    if (!state.config.apiKey) {
      alert('请先配置API Key');
      return Promise.reject(new Error('未配置API Key'));
    }
    var req = null;
    for (var i = 0; i < state.requestRecords.length; i++) {
      if (state.requestRecords[i].id === reqId) {
        req = state.requestRecords[i];
        break;
      }
    }
    if (!req) return Promise.reject(new Error('请求不存在'));

    var messages = [
      {
        role: 'system',
        content: '你是一个HTTP请求分析专家。用户会给你一个HTTP请求的详细信息（URL、方法、请求体、响应体），请分析：1）这个请求的作用是什么 2）响应体中每个字段的含义。请用简洁清晰的中文回复。'
      },
      {
        role: 'user',
        content: '请分析以下请求：\n方法: ' + req.method + '\nURL: ' + req.url + '\n请求体: ' + truncateBody(formatJson(req.requestBody)) + '\n响应体: ' + truncateBody(formatJson(req.responseBody))
      }
    ];

    return callAI(messages).then(function (result) {
      req.aiAnalysis = result;
      if (state.expandedReqId === reqId) {
        renderRequestDetail(reqId);
      }
      refreshRequestList();
      return result;
    }).catch(function (err) {
      alert('AI分析失败: ' + err.message);
      throw err;
    });
  }

  function analyzeAllRequests() {
    if (state.isAnalyzing) return;
    var unanalyzed = state.requestRecords.filter(function (r) { return r.aiAnalysis === null; });
    if (unanalyzed.length === 0) {
      alert('没有需要分析的请求');
      return;
    }
    state.isAnalyzing = true;
    state.analyzeProgress = { total: unanalyzed.length, done: 0 };
    updateAnalyzeProgress();

    var chain = Promise.resolve();
    unanalyzed.forEach(function (req) {
      chain = chain.then(function () {
        return analyzeRequest(req.id).then(function () {
          state.analyzeProgress.done++;
          updateAnalyzeProgress();
        }).catch(function () {
          state.analyzeProgress.done++;
          updateAnalyzeProgress();
        });
      });
    });

    chain.then(function () {
      state.isAnalyzing = false;
      updateAnalyzeProgress();
    }).catch(function () {
      state.isAnalyzing = false;
      updateAnalyzeProgress();
    });
  }

  function chatModify(userMessage) {
    if (!state.config.apiKey) {
      alert('请先配置API Key');
      return Promise.reject(new Error('未配置API Key'));
    }

    var summary = state.requestRecords.map(function (r, i) {
      try {
        return (i + 1) + '. ' + (r && r.method ? r.method : '-') + ' ' + getMockKey(r && r.url != null ? r.url : '');
      } catch (e) {
        return (i + 1) + '. (本条 URL 摘要失败)';
      }
    }).join('\n');

    var messages = [
      {
        role: 'system',
        content: '你是一个HTTP响应数据修改助手。用户会告诉你想修改哪个请求的响应数据以及如何修改。请生成修改后的完整JSON响应数据，用```json代码块包裹。只输出JSON，不要其他解释。'
      },
      {
        role: 'user',
        content: userMessage + '\n\n当前请求列表摘要：\n' + summary
      }
    ];

    return callAI(messages).then(function (result) {
      var jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1].trim());
        } catch (e) {
          alert('AI返回的JSON解析失败: ' + e.message);
          return null;
        }
      } else {
        alert('AI未返回有效的JSON代码块');
        return null;
      }
    }).catch(function (err) {
      alert('AI对话失败: ' + err.message);
      return null;
    });
  }

  function injectStyles() {
    /* Styles loaded via manifest content_scripts css: content/content.css */
  }

  function createFloatingBall() {
    var ball = document.createElement('div');
    ball.className = 'ai-req-floating-ball';

    ball.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';

    var savedPos = storageGet(getScopedStorageKey('ai_req_ball_position'), null);
    if (savedPos) {
      try {
        var pos = clampPosition(JSON.parse(savedPos), 56, 56);
        ball.style.left = pos.left + 'px';
        ball.style.top = pos.top + 'px';
      } catch (e) {
        ball.style.right = '20px';
        ball.style.bottom = '20px';
      }
    } else {
      ball.style.right = '20px';
      ball.style.bottom = '20px';
    }

    var isDragging = false;
    var startX, startY, startLeft, startTop;
    var hasMoved = false;

    ball.addEventListener('mousedown', function (e) {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      var rect = ball.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      ball.style.right = 'auto';
      ball.style.bottom = 'auto';
      ball.style.left = startLeft + 'px';
      ball.style.top = startTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
      }
      var newLeft = Math.max(0, Math.min(window.innerWidth - 56, startLeft + dx));
      var newTop = Math.max(0, Math.min(window.innerHeight - 56, startTop + dy));
      ball.style.left = newLeft + 'px';
      ball.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (!isDragging) return;
      isDragging = false;
      if (hasMoved) {
        storageSet(getScopedStorageKey('ai_req_ball_position'), JSON.stringify({
          left: parseInt(ball.style.left),
          top: parseInt(ball.style.top)
        }));
      } else {
        toggleMainPanel();
      }
    });

    safeAppendChild(ball);
    state.floatingBall = ball;
  }

  function toggleMainPanel() {
    state.isPanelOpen = !state.isPanelOpen;
    if (state.isPanelOpen) {
      state.mainPanel.style.display = 'flex';
      refreshRequestList();
    } else {
      state.mainPanel.style.display = 'none';
    }
  }

  function createMainPanel() {
    var panel = document.createElement('div');
    panel.className = 'ai-req-main-panel';

    var savedPos = storageGet(getScopedStorageKey('ai_req_panel_position'), null);
    if (savedPos) {
      try {
        var pos = clampPosition(JSON.parse(savedPos), 420, 620);
        panel.style.left = pos.left + 'px';
        panel.style.top = pos.top + 'px';
      } catch (e) {
        panel.style.right = '90px';
        panel.style.bottom = '20px';
      }
    } else {
      panel.style.right = '90px';
      panel.style.bottom = '20px';
    }

    var header = document.createElement('div');
    header.className = 'ai-req-panel-header';

    var title = document.createElement('div');
    title.className = 'ai-req-panel-title';
    title.textContent = 'AI请求分析助手';

    var configBtn = document.createElement('button');
    configBtn.className = 'ai-req-panel-btn';
    configBtn.textContent = '\u2699';
    configBtn.title = '配置';
    configBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openConfigPanel();
    });

    var closeBtn = document.createElement('button');
    closeBtn.className = 'ai-req-panel-btn';
    closeBtn.textContent = '\u2715';
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.isPanelOpen = false;
      panel.style.display = 'none';
    });

    header.appendChild(title);
    header.appendChild(configBtn);
    header.appendChild(closeBtn);

    var searchBox = document.createElement('div');
    searchBox.className = 'ai-req-search-box';
    var searchInput = document.createElement('textarea');
    searchInput.className = 'ai-req-search-input';
    searchInput.name = 'ai_req_search_' + Date.now();
    searchInput.id = 'ai_req_search_' + Math.random().toString(36).substr(2, 9);
    searchInput.autocomplete = 'off';
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('autocorrect', 'off');
    searchInput.setAttribute('autocapitalize', 'off');
    searchInput.setAttribute('spellcheck', 'false');
    searchInput.setAttribute('data-lpignore', 'true');
    searchInput.setAttribute('data-form-type', 'other');
    searchInput.setAttribute('aria-label', '搜索请求URL或分析结果');
    searchInput.rows = 1;
    searchInput.placeholder = '搜索请求URL或分析结果...';
    searchInput.addEventListener('input', function () {
      searchInput.value = searchInput.value.replace(/[\r\n]+/g, '');
      refreshRequestList(searchInput.value.trim());
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
      }
    });
    searchBox.appendChild(searchInput);

    var actionBar = document.createElement('div');
    actionBar.className = 'ai-req-action-bar';
    var analyzeAllBtn = document.createElement('button');
    analyzeAllBtn.className = 'ai-req-analyze-all-btn';
    analyzeAllBtn.textContent = '\u2728 一键分析所有';
    analyzeAllBtn.addEventListener('click', function () {
      analyzeAllRequests();
    });
    var clearMockBtn = document.createElement('button');
    clearMockBtn.className = 'ai-req-clear-mock-btn';
    clearMockBtn.textContent = '清除所有规则';
    clearMockBtn.title = '清除当前域名下保存的所有调试规则';
    clearMockBtn.addEventListener('click', function () {
      clearAllMockRules();
    });
    var reqCount = document.createElement('span');
    reqCount.className = 'ai-req-req-count';
    reqCount.textContent = '0 请求';
    actionBar.appendChild(analyzeAllBtn);
    actionBar.appendChild(clearMockBtn);
    actionBar.appendChild(reqCount);

    var progressBar = document.createElement('div');
    progressBar.className = 'ai-req-progress-bar';
    var progressFill = document.createElement('div');
    progressFill.className = 'ai-req-progress-fill';
    progressBar.appendChild(progressFill);

    var requestList = document.createElement('div');
    requestList.className = 'ai-req-request-list';

    var bottomInput = document.createElement('div');
    bottomInput.className = 'ai-req-bottom-input';
    var chatInput = document.createElement('textarea');
    chatInput.className = 'ai-req-bottom-textarea';
    chatInput.placeholder = '输入修改指令，如"将第1个请求的返回数据中status改为true"...';
    var sendBtn = document.createElement('button');
    sendBtn.className = 'ai-req-send-btn';
    sendBtn.textContent = '\u27A4 发送';
    sendBtn.addEventListener('click', function () {
      var msg = chatInput.value.trim();
      if (!msg) return;
      chatInput.value = '';
      sendBtn.disabled = true;
      sendBtn.textContent = '处理中...';
      chatModify(msg).then(function (data) {
        sendBtn.disabled = false;
        sendBtn.textContent = '\u27A4 发送';
        if (data) {
          openJsonEditor(data);
        }
      }).catch(function () {
        sendBtn.disabled = false;
        sendBtn.textContent = '\u27A4 发送';
      });
    });
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
    chatInput.addEventListener('input', function () {
      this.style.height = '36px';
      this.style.height = Math.min(80, this.scrollHeight) + 'px';
    });
    bottomInput.appendChild(chatInput);
    bottomInput.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(searchBox);
    panel.appendChild(actionBar);
    panel.appendChild(progressBar);
    panel.appendChild(requestList);
    panel.appendChild(bottomInput);

    makeDraggable(panel, header);

    safeAppendChild(panel);
    state.mainPanel = panel;
  }

  function makeDraggable(element, handle) {
    var isDragging = false;
    var startX, startY, startLeft, startTop;
    var hasDragged = false;

    handle.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      hasDragged = false;
      startX = e.clientX;
      startY = e.clientY;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
      var rect = element.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      element.style.left = startLeft + 'px';
      element.style.top = startTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDragged = true;
      }
      var newLeft = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, startLeft + dx));
      var newTop = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, startTop + dy));
      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (!isDragging) return;
      isDragging = false;
      if (hasDragged) {
        storageSet(getScopedStorageKey('ai_req_panel_position'), JSON.stringify({
          left: parseInt(element.style.left),
          top: parseInt(element.style.top)
        }));
      }
    });
  }

  function refreshRequestList(keyword) {
    var listEl = state.mainPanel.querySelector('.ai-req-request-list');
    var countEl = state.mainPanel.querySelector('.ai-req-req-count');
    listEl.innerHTML = '';

    var filtered = state.requestRecords;
    if (keyword) {
      var kw = keyword.toLowerCase();
      filtered = state.requestRecords.filter(function (r) {
        return r.url.toLowerCase().indexOf(kw) !== -1 || (r.aiAnalysis && r.aiAnalysis.toLowerCase().indexOf(kw) !== -1);
      });
    }

    countEl.textContent = filtered.length + ' 请求';

    if (filtered.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'ai-req-empty-state';
      empty.textContent = keyword ? '没有匹配的请求' : '暂无请求记录';
      listEl.appendChild(empty);
      return;
    }

    var reversed = filtered.slice().reverse();
    reversed.forEach(function (req) {
      var item = document.createElement('div');
      item.className = 'ai-req-request-item';
      item.setAttribute('data-id', req.id);

      var row = document.createElement('div');
      row.className = 'ai-req-request-row';

      var methodTag = document.createElement('span');
      methodTag.className = 'ai-req-method-tag ai-req-method-' + getMethodClass(req.method);
      methodTag.textContent = req.method;

      var urlText = document.createElement('span');
      urlText.className = 'ai-req-url-text';
      urlText.textContent = truncateURL(req.url, 60);
      urlText.title = req.url;

      var statusCode = document.createElement('span');
      statusCode.className = 'ai-req-status-code ' + getStatusClass(req.responseStatus);
      statusCode.textContent = req.responseStatus;

      var duration = document.createElement('span');
      duration.className = 'ai-req-duration';
      duration.textContent = req.duration + 'ms';

      var aiIcon = document.createElement('span');
      aiIcon.className = 'ai-req-icon-indicator ' + (req.aiAnalysis ? 'ai-req-ai-analyzed' : 'ai-req-ai-not-analyzed');
      aiIcon.textContent = req.aiAnalysis ? '\u2713' : '\u25CB';
      aiIcon.title = req.aiAnalysis ? '已AI分析' : '未AI分析';

      var mockIcon = document.createElement('span');
      mockIcon.className = 'ai-req-icon-indicator ' + (req.isMocked ? 'ai-req-mock-active' : 'ai-req-mock-inactive');
      mockIcon.textContent = req.isMocked ? '\u25CF' : '\u25CB';
      mockIcon.title = req.isMocked ? '已Mock' : '未Mock';

      var activeRule = req.debugRule || findDebugRule(req.originalUrl || req.url, req.method);
      var tags = buildDebugTagElement(activeRule);

      row.appendChild(methodTag);
      row.appendChild(urlText);
      row.appendChild(statusCode);
      row.appendChild(duration);
      row.appendChild(aiIcon);
      row.appendChild(mockIcon);
      if (tags) row.appendChild(tags);

      row.addEventListener('click', function () {
        if (state.expandedReqId === req.id) {
          state.expandedReqId = null;
        } else {
          state.expandedReqId = req.id;
        }
        refreshRequestList(keyword);
      });

      item.appendChild(row);

      if (state.expandedReqId === req.id) {
        var detail = document.createElement('div');
        detail.className = 'ai-req-request-detail';
        detail.innerHTML = buildDetailHTML(req);
        item.appendChild(detail);
        bindDetailEvents(detail, req, keyword);
      }

      listEl.appendChild(item);
    });
  }

  function getMethodClass(method) {
    var m = (method || '').toUpperCase();
    if (m === 'GET') return 'GET';
    if (m === 'POST') return 'POST';
    if (m === 'PUT') return 'PUT';
    if (m === 'DELETE') return 'DELETE';
    if (m === 'PATCH') return 'PATCH';
    return 'OTHER';
  }

  function getStatusClass(code) {
    if (code >= 200 && code < 300) return 'ai-req-status-2xx';
    if (code >= 300 && code < 400) return 'ai-req-status-3xx';
    if (code >= 400 && code < 500) return 'ai-req-status-4xx';
    if (code >= 500) return 'ai-req-status-5xx';
    return 'ai-req-status-0';
  }

  function truncateURL(url, max) {
    if (url.length <= max) return url;
    return url.substring(0, max) + '...';
  }

  function buildDebugTagElement(rule) {
    if (!rule) return null;
    rule = normalizeRule(rule);
    var tagNames = [];
    if (hasResponseBodyMock(rule)) tagNames.push('Mock');
    if (hasRequestRewrite(rule)) tagNames.push('Req');
    if (hasResponseHeaderRewrite(rule)) tagNames.push('ResH');
    if (rule.once) tagNames.push('Once');
    if (!tagNames.length) return null;
    var wrap = document.createElement('span');
    wrap.className = 'ai-req-debug-tags';
    tagNames.forEach(function (name) {
      var tag = document.createElement('span');
      tag.className = 'ai-req-debug-tag';
      tag.textContent = name;
      wrap.appendChild(tag);
    });
    return wrap;
  }

  function buildDetailHTML(req) {
    var html = '';
    var activeRule = req.debugRule || findDebugRule(req.originalUrl || req.url, req.method);

    html += '<div class="ai-req-detail-section">';
    html += '<div class="ai-req-detail-label">请求信息</div>';
    html += '<div class="ai-req-detail-value"><strong>方法:</strong> ' + escapeHtml(req.method) + '</div>';
    if (req.originalUrl && req.originalUrl !== req.url) {
      html += '<div class="ai-req-detail-value"><strong>原始URL:</strong> ' + escapeHtml(req.originalUrl) + '</div>';
    }
    html += '<div class="ai-req-detail-value"><strong>URL:</strong> ' + escapeHtml(req.url) + '</div>';
    html += buildCollapsible('请求头', formatJson(req.requestHeaders));
    html += buildCollapsible('请求体', formatJson(req.requestBody));
    html += '</div>';

    html += '<div class="ai-req-detail-section">';
    html += '<div class="ai-req-detail-label">响应信息</div>';
    html += '<div class="ai-req-detail-value"><strong>状态码:</strong> ' + req.responseStatus + '</div>';
    html += buildCollapsible('响应头', formatJson(req.responseHeaders));
    html += buildCollapsible('响应体', formatJson(req.responseBody));
    html += '</div>';

    html += '<div class="ai-req-detail-section">';
    html += '<div class="ai-req-detail-label">AI分析</div>';
    if (req.aiAnalysis) {
      html += '<div class="ai-req-ai-result">' + escapeHtml(req.aiAnalysis) + '</div>';
    } else {
      html += '<button class="ai-req-btn ai-req-btn-primary ai-req-analyze-single-btn" data-id="' + req.id + '">\u2728 AI分析</button>';
    }
    html += '</div>';

    html += '<div class="ai-req-detail-section">';
    html += '<div class="ai-req-detail-label">调试规则</div>';
    if (activeRule) {
      html += '<div class="ai-req-mock-info">\u5F53\u524D\u8BF7\u6C42\u547D\u4E2D\u8C03\u8BD5\u89C4\u5219</div>';
      html += '<div class="ai-req-mock-btn-group">';
      html += '<button class="ai-req-btn ai-req-btn-primary ai-req-edit-rewrite-btn" data-id="' + req.id + '">高级改写</button>';
      html += '<button class="ai-req-btn ai-req-btn-success ai-req-replay-btn" data-id="' + req.id + '">\uD83D\uDD04 \u5237\u65B0\u9875\u9762\u751F\u6548</button>';
      html += '<button class="ai-req-btn ai-req-btn-danger ai-req-cancel-mock-btn" data-id="' + req.id + '">\u53D6\u6D88\u89C4\u5219</button>';
      html += '</div>';
      html += buildCollapsible('调试规则', formatJson(activeRule));
      if (req.mockData !== null && req.mockData !== undefined) {
        html += buildCollapsible('Mock\u6570\u636E', formatJson(req.mockData));
      }
    } else {
      html += '<div class="ai-req-mock-btn-group">';
      html += '<button class="ai-req-btn ai-req-btn-primary ai-req-edit-mock-btn" data-id="' + req.id + '">\u270F \u4FEE\u6539\u54CD\u5E94</button>';
      html += '<button class="ai-req-btn ai-req-btn-secondary ai-req-edit-rewrite-btn" data-id="' + req.id + '">高级改写</button>';
      html += '</div>';
    }
    html += '</div>';

    return html;
  }

  function buildCollapsible(label, content) {
    var id = 'col_' + label + '_' + Math.random().toString(36).substr(2, 6);
    var html = '<div class="ai-req-collapsible-wrap">';
    html += '<div class="ai-req-collapsible-header" data-target="' + id + '">';
    html += '<span class="ai-req-collapsible-arrow ai-req-collapsed">\u25BC</span> ' + escapeHtml(label);
    html += '</div>';
    html += '<div class="ai-req-collapsible-content" id="' + id + '" style="display:none">';
    html += '<div class="ai-req-code-block">' + escapeHtml(content || '(空)') + '</div>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function bindDetailEvents(detailEl, req, keyword) {
    var collapsibles = detailEl.querySelectorAll('.ai-req-collapsible-header');
    collapsibles.forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var targetId = el.getAttribute('data-target');
        var content = document.getElementById(targetId);
        var arrow = el.querySelector('.ai-req-collapsible-arrow');
        if (content.style.display === 'none') {
          content.style.display = 'block';
          arrow.classList.remove('ai-req-collapsed');
        } else {
          content.style.display = 'none';
          arrow.classList.add('ai-req-collapsed');
        }
      });
    });

    var analyzeBtn = detailEl.querySelector('.ai-req-analyze-single-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var btn = e.target;
        btn.disabled = true;
        btn.textContent = '分析中...';
        analyzeRequest(req.id).catch(function () {}).then(function () {
          btn.disabled = false;
        });
      });
    }

    var editMockBtn = detailEl.querySelector('.ai-req-edit-mock-btn');
    if (editMockBtn) {
      editMockBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        state.selectedReqId = req.id;
        openJsonEditor(req.responseBody);
      });
    }

    var editRewriteBtn = detailEl.querySelector('.ai-req-edit-rewrite-btn');
    if (editRewriteBtn) {
      editRewriteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openRewriteEditor(req);
      });
    }

    var cancelMockBtn = detailEl.querySelector('.ai-req-cancel-mock-btn');
    if (cancelMockBtn) {
      cancelMockBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeMockRule(req);
      });
    }

    var replayBtn = detailEl.querySelector('.ai-req-replay-btn');
    if (replayBtn) {
      replayBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        replayRequest(req.id);
      });
    }
  }

  function renderRequestDetail(reqId) {
    var itemEl = state.mainPanel.querySelector('.ai-req-request-item[data-id="' + reqId + '"]');
    if (!itemEl) return;
    var req = null;
    for (var i = 0; i < state.requestRecords.length; i++) {
      if (state.requestRecords[i].id === reqId) {
        req = state.requestRecords[i];
        break;
      }
    }
    if (!req) return;
    var detailEl = itemEl.querySelector('.ai-req-request-detail');
    if (!detailEl) return;
    detailEl.innerHTML = buildDetailHTML(req);
    bindDetailEvents(detailEl, req);
  }

  function openJsonEditor(data) {
    var editor = state.jsonEditor;
    var overlay = editor.querySelector('.ai-req-json-editor-overlay');
    var textarea = editor.querySelector('.ai-req-json-editor-textarea');
    textarea.value = formatJson(data);
    overlay.style.display = 'flex';
  }

  function closeJsonEditor() {
    var editor = state.jsonEditor;
    var overlay = editor.querySelector('.ai-req-json-editor-overlay');
    overlay.style.display = 'none';
  }

  function parseJsonObjectInput(value, label) {
    var text = (value || '').trim();
    if (!text) return {};
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(label + '必须是JSON对象');
    }
    return parsed;
  }

  function parseJsonAnyInput(value, label) {
    var text = (value || '').trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(label + '不是有效JSON: ' + e.message);
    }
  }

  function stringifyRemoveList(list) {
    return (list || []).join('\n');
  }

  function createJsonEditor() {
    var editor = document.createElement('div');
    var overlay = document.createElement('div');
    overlay.className = 'ai-req-json-editor-overlay';

    var modal = document.createElement('div');
    modal.className = 'ai-req-json-editor-modal';

    var title = document.createElement('div');
    title.className = 'ai-req-json-editor-title';
    title.textContent = '编辑响应数据 (Mock)';

    var textarea = document.createElement('textarea');
    textarea.className = 'ai-req-json-editor-textarea';

    var actions = document.createElement('div');
    actions.className = 'ai-req-json-editor-actions';

    var formatBtn = document.createElement('button');
    formatBtn.className = 'ai-req-btn ai-req-btn-secondary';
    formatBtn.textContent = '格式化';
    formatBtn.addEventListener('click', function () {
      try {
        var obj = JSON.parse(textarea.value);
        textarea.value = JSON.stringify(obj, null, 2);
      } catch (e) {
        alert('JSON格式错误: ' + e.message);
      }
    });

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'ai-req-btn ai-req-btn-primary';
    confirmBtn.textContent = '确认';
    confirmBtn.addEventListener('click', function () {
      try {
        var data = JSON.parse(textarea.value);
        applyMockData(data);
        closeJsonEditor();
      } catch (e) {
        alert('JSON格式错误: ' + e.message);
      }
    });

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'ai-req-btn ai-req-btn-secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', function () {
      closeJsonEditor();
    });

    actions.appendChild(formatBtn);
    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);

    modal.appendChild(title);
    modal.appendChild(textarea);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    editor.appendChild(overlay);

    safeAppendChild(editor);
    state.jsonEditor = editor;
  }

  function openRewriteEditor(req) {
    state.selectedRewriteReqId = req.id;
    var editor = state.rewriteEditor;
    var overlay = editor.querySelector('.ai-req-rewrite-editor-overlay');
    var key = getMockKey(req.originalUrl || req.url);
    var rule = state.mockRules[key] ? normalizeRule(state.mockRules[key], key, req.method) : normalizeRule({
      __aiReqRule: true,
      enabled: true,
      once: false,
      match: { pathname: key, method: (req.method || '').toUpperCase() },
      request: { url: '', headersSet: {}, headersRemove: [] },
      response: {
        status: req.responseStatus || 200,
        statusText: 'OK',
        headersSet: {},
        headersRemove: [],
        bodyEnabled: false,
        body: req.responseBody
      }
    }, key, req.method);

    editor.querySelector('.ai-req-rewrite-enabled').value = rule.enabled ? 'true' : 'false';
    editor.querySelector('.ai-req-rewrite-once').value = rule.once ? 'true' : 'false';
    editor.querySelector('.ai-req-rewrite-method').value = rule.match.method || (req.method || '').toUpperCase();
    editor.querySelector('.ai-req-rewrite-url').value = rule.request.url || '';
    editor.querySelector('.ai-req-rewrite-req-headers-set').value = formatJson(rule.request.headersSet || {});
    editor.querySelector('.ai-req-rewrite-req-headers-remove').value = stringifyRemoveList(rule.request.headersRemove);
    editor.querySelector('.ai-req-rewrite-status').value = rule.response.status || 200;
    editor.querySelector('.ai-req-rewrite-status-text').value = rule.response.statusText || 'OK';
    editor.querySelector('.ai-req-rewrite-res-headers-set').value = formatJson(rule.response.headersSet || { 'Content-Type': 'application/json' });
    editor.querySelector('.ai-req-rewrite-res-headers-remove').value = stringifyRemoveList(rule.response.headersRemove);
    editor.querySelector('.ai-req-rewrite-body-enabled').value = rule.response.bodyEnabled ? 'true' : 'false';
    editor.querySelector('.ai-req-rewrite-body').value = formatJson(rule.response.body !== undefined ? rule.response.body : req.responseBody);
    overlay.style.display = 'flex';
  }

  function closeRewriteEditor() {
    var editor = state.rewriteEditor;
    var overlay = editor.querySelector('.ai-req-rewrite-editor-overlay');
    overlay.style.display = 'none';
  }

  function applyRewriteRuleFromEditor() {
    if (!state.selectedRewriteReqId) return;
    var req = null;
    for (var i = 0; i < state.requestRecords.length; i++) {
      if (state.requestRecords[i].id === state.selectedRewriteReqId) {
        req = state.requestRecords[i];
        break;
      }
    }
    if (!req) return;

    var editor = state.rewriteEditor;
    var key = getMockKey(req.originalUrl || req.url);
    var bodyEnabled = editor.querySelector('.ai-req-rewrite-body-enabled').value === 'true';
    var rule = {
      __aiReqRule: true,
      enabled: editor.querySelector('.ai-req-rewrite-enabled').value === 'true',
      once: editor.querySelector('.ai-req-rewrite-once').value === 'true',
      match: {
        pathname: key,
        method: editor.querySelector('.ai-req-rewrite-method').value.trim().toUpperCase()
      },
      request: {
        url: editor.querySelector('.ai-req-rewrite-url').value.trim(),
        headersSet: normalizeHeaders(parseJsonObjectInput(editor.querySelector('.ai-req-rewrite-req-headers-set').value, '请求头')),
        headersRemove: normalizeRemoveList(editor.querySelector('.ai-req-rewrite-req-headers-remove').value)
      },
      response: {
        status: parseInt(editor.querySelector('.ai-req-rewrite-status').value, 10) || 200,
        statusText: editor.querySelector('.ai-req-rewrite-status-text').value.trim() || 'OK',
        headersSet: normalizeHeaders(parseJsonObjectInput(editor.querySelector('.ai-req-rewrite-res-headers-set').value, '响应头')),
        headersRemove: normalizeRemoveList(editor.querySelector('.ai-req-rewrite-res-headers-remove').value),
        bodyEnabled: bodyEnabled,
        body: bodyEnabled ? parseJsonAnyInput(editor.querySelector('.ai-req-rewrite-body').value, '响应体') : null
      }
    };

    state.mockRules[key] = normalizeRule(rule, key, req.method);
    saveMockRules();
    req.debugRule = state.mockRules[key];
    req.isMocked = hasResponseBodyMock(req.debugRule);
    req.mockData = req.isMocked ? req.debugRule.response.body : null;
    refreshRequestList();
    closeRewriteEditor();
    showToast(rule.once ? '高级改写已保存，仅下一次生效' : '高级改写已保存，刷新或下次请求生效');
  }

  function createRewriteEditor() {
    var editor = document.createElement('div');
    var overlay = document.createElement('div');
    overlay.className = 'ai-req-rewrite-editor-overlay';

    var modal = document.createElement('div');
    modal.className = 'ai-req-rewrite-editor-modal';
    modal.innerHTML = [
      '<div class="ai-req-rewrite-editor-title">高级改写规则</div>',
      '<div class="ai-req-rewrite-editor-body">',
      '  <div class="ai-req-rewrite-grid">',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">启用状态</label><select class="ai-req-rewrite-select ai-req-rewrite-enabled"><option value="true">启用</option><option value="false">暂停</option></select></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">生效模式</label><select class="ai-req-rewrite-select ai-req-rewrite-once"><option value="false">持久生效</option><option value="true">仅下一次</option></select></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">匹配方法</label><input class="ai-req-rewrite-input ai-req-rewrite-method" placeholder="GET / POST，空表示不限"></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">响应状态文本</label><input class="ai-req-rewrite-input ai-req-rewrite-status-text" placeholder="OK"></div>',
      '    <div class="ai-req-rewrite-field ai-req-rewrite-full"><label class="ai-req-rewrite-label">请求地址改写</label><input class="ai-req-rewrite-input ai-req-rewrite-url" placeholder="留空表示不改写请求地址"><div class="ai-req-rewrite-help">跨域地址可能触发浏览器 CORS 限制。</div></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">新增/覆盖请求头 JSON</label><textarea class="ai-req-rewrite-textarea ai-req-rewrite-req-headers-set"></textarea></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">删除请求头</label><textarea class="ai-req-rewrite-textarea ai-req-rewrite-req-headers-remove" placeholder="每行一个 header 名"></textarea></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">响应状态码</label><input class="ai-req-rewrite-input ai-req-rewrite-status" type="number" min="100" max="599"></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">是否 Mock 响应体</label><select class="ai-req-rewrite-select ai-req-rewrite-body-enabled"><option value="true">Mock 响应体</option><option value="false">不改响应体</option></select></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">新增/覆盖响应头 JSON</label><textarea class="ai-req-rewrite-textarea ai-req-rewrite-res-headers-set"></textarea></div>',
      '    <div class="ai-req-rewrite-field"><label class="ai-req-rewrite-label">删除响应头</label><textarea class="ai-req-rewrite-textarea ai-req-rewrite-res-headers-remove" placeholder="每行一个 header 名"></textarea></div>',
      '    <div class="ai-req-rewrite-field ai-req-rewrite-full"><label class="ai-req-rewrite-label">响应体 JSON</label><textarea class="ai-req-rewrite-textarea ai-req-rewrite-body" style="min-height:180px"></textarea></div>',
      '  </div>',
      '</div>',
      '<div class="ai-req-rewrite-actions">',
      '  <button class="ai-req-btn ai-req-btn-secondary ai-req-rewrite-cancel">取消</button>',
      '  <button class="ai-req-btn ai-req-btn-primary ai-req-rewrite-save">保存规则</button>',
      '</div>'
    ].join('');

    overlay.appendChild(modal);
    editor.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeRewriteEditor();
    });
    modal.querySelector('.ai-req-rewrite-cancel').addEventListener('click', closeRewriteEditor);
    modal.querySelector('.ai-req-rewrite-save').addEventListener('click', function () {
      try {
        applyRewriteRuleFromEditor();
      } catch (e) {
        alert(e.message);
      }
    });

    safeAppendChild(editor);
    state.rewriteEditor = editor;
  }

  function showToast(msg, duration) {
    duration = duration || 2500;
    var existing = document.querySelector('.ai-req-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'ai-req-toast';
    toast.textContent = msg;
    safeAppendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('ai-req-toast-show');
    });
    setTimeout(function () {
      toast.classList.remove('ai-req-toast-show');
      setTimeout(function () { toast.remove(); }, 300);
    }, duration);
  }

  function replayRequest(reqId) {
    var req = null;
    for (var i = 0; i < state.requestRecords.length; i++) {
      if (state.requestRecords[i].id === reqId) {
        req = state.requestRecords[i];
        break;
      }
    }
    if (!req) return;
    if (confirm('Mock规则已保存，需要刷新页面才能让页面代码使用Mock数据。\n\n是否立即刷新页面？')) {
      location.reload();
    }
  }

  function applyMockData(mockData) {
    if (!state.selectedReqId) return;
    var req = null;
    for (var i = 0; i < state.requestRecords.length; i++) {
      if (state.requestRecords[i].id === state.selectedReqId) {
        req = state.requestRecords[i];
        break;
      }
    }
    if (!req) return;

    var key = getMockKey(req.originalUrl || req.url);
    state.mockRules[key] = buildSimpleMockRule(req, mockData);
    saveMockRules();

    req.isMocked = true;
    req.mockData = mockData;
    req.debugRule = state.mockRules[key];

    refreshRequestList();
    showToast('Mock已保存，刷新页面后生效');

    setTimeout(function () {
      if (confirm('Mock规则已保存！\n页面刷新后，该接口将返回Mock数据。\n\n是否立即刷新页面？')) {
        location.reload();
      }
    }, 500);
  }

  function removeMockRule(req) {
    var key = getMockKey(req.originalUrl || req.url);
    delete state.mockRules[key];
    saveMockRules();

    req.isMocked = false;
    req.mockData = null;
    req.debugRule = null;

    refreshRequestList();
  }

  function clearAllMockRules() {
    var mockCount = Object.keys(state.mockRules || {}).length;
    if (mockCount === 0) {
      showToast('当前没有调试规则');
      return;
    }

    if (!confirm('确定清除当前站点下的全部 ' + mockCount + ' 条调试规则吗？')) {
      return;
    }

    state.mockRules = {};
    saveMockRules();
    state.requestRecords.forEach(function (req) {
      req.isMocked = false;
      req.mockData = null;
      req.debugRule = null;
    });
    refreshRequestList();
    showToast('已清除全部调试规则');
  }

  function openConfigPanel() {
    var panel = state.configPanel;
    var overlay = panel.querySelector('.ai-req-config-overlay');

    panel.querySelector('.ai-req-config-apikey').value = state.config.apiKey;
    panel.querySelector('.ai-req-config-baseurl').value = state.config.baseURL;
    panel.querySelector('.ai-req-config-model').value = state.config.model;

    overlay.style.display = 'flex';
  }

  function closeConfigPanel() {
    var panel = state.configPanel;
    var overlay = panel.querySelector('.ai-req-config-overlay');
    overlay.style.display = 'none';
  }

  function createConfigPanel() {
    var panel = document.createElement('div');

    var overlay = document.createElement('div');
    overlay.className = 'ai-req-config-overlay';

    var modal = document.createElement('div');
    modal.className = 'ai-req-config-modal';

    var dragHandle = document.createElement('div');
    dragHandle.className = 'ai-req-config-drag-handle';
    dragHandle.textContent = '\u2500\u2500\u2500';

    var title = document.createElement('div');
    title.className = 'ai-req-config-title';
    title.textContent = '\u914D\u7F6E';

    var apiKeyField = document.createElement('div');
    apiKeyField.className = 'ai-req-config-field';
    apiKeyField.innerHTML = '<label class="ai-req-config-label">API Key</label><input type="password" class="ai-req-config-input ai-req-config-apikey" placeholder="\u8F93\u5165API Key">';

    var baseURLField = document.createElement('div');
    baseURLField.className = 'ai-req-config-field';
    baseURLField.innerHTML = '<label class="ai-req-config-label">Base URL</label><input type="text" class="ai-req-config-input ai-req-config-baseurl" value="https://api.moonshot.cn/v1">';

    var modelField = document.createElement('div');
    modelField.className = 'ai-req-config-field';
    modelField.innerHTML = '<label class="ai-req-config-label">\u6A21\u578B\u540D\u79F0</label><input type="text" class="ai-req-config-input ai-req-config-model" value="kimi-k2.6">';

    var actions = document.createElement('div');
    actions.className = 'ai-req-config-actions';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'ai-req-btn ai-req-btn-primary';
    saveBtn.textContent = '\u4FDD\u5B58';
    saveBtn.addEventListener('click', function () {
      state.config.apiKey = modal.querySelector('.ai-req-config-apikey').value.trim();
      state.config.baseURL = modal.querySelector('.ai-req-config-baseurl').value.trim();
      state.config.model = modal.querySelector('.ai-req-config-model').value.trim();
      saveConfig();
      closeConfigPanel();
    });

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'ai-req-btn ai-req-btn-secondary';
    cancelBtn.textContent = '\u53D6\u6D88';
    cancelBtn.addEventListener('click', function () {
      closeConfigPanel();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    modal.appendChild(dragHandle);
    modal.appendChild(title);
    modal.appendChild(apiKeyField);
    modal.appendChild(baseURLField);
    modal.appendChild(modelField);
    modal.appendChild(actions);
    overlay.appendChild(modal);

    makeDraggable(modal, dragHandle);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        closeConfigPanel();
      }
    });

    panel.appendChild(overlay);
    safeAppendChild(panel);
    state.configPanel = panel;
  }

  function updateAnalyzeProgress() {
    var fill = state.mainPanel.querySelector('.ai-req-progress-fill');
    var countEl = state.mainPanel.querySelector('.ai-req-req-count');
    if (state.isAnalyzing) {
      var pct = state.analyzeProgress.total > 0 ? (state.analyzeProgress.done / state.analyzeProgress.total * 100) : 0;
      fill.style.width = pct + '%';
      countEl.textContent = '\u5206\u6790\u4E2D ' + state.analyzeProgress.done + '/' + state.analyzeProgress.total;
    } else {
      fill.style.width = '0%';
      var total = state.requestRecords.length;
      var analyzed = state.requestRecords.filter(function (r) { return r.aiAnalysis !== null; }).length;
      countEl.textContent = total + ' \u8BF7\u6C42 (\u5DF2\u5206\u6790' + analyzed + ')';
    }
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

  function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function init() {
    storageHydrateThen(function () {
      loadConfig();
      loadMockRules();
      setupMenuCommands();
      setupRequestInterception();
    });
  }


  function onDOMContentLoaded() {
    if (state.uiReady) return;
    state.uiReady = true;
    injectStyles();
    createFloatingBall();
    createMainPanel();
    createConfigPanel();
    createJsonEditor();
    createRewriteEditor();
    startDomGuard();

    if (!state.config.apiKey) {
      setTimeout(function () {
        openConfigPanel();
      }, 500);
    }
  }

  function startDomGuard() {
    setInterval(function () {
      if (state.floatingBall && !document.contains(state.floatingBall)) {
        try { getContainer().appendChild(state.floatingBall); } catch (e) {}
      }
      if (state.mainPanel && !document.contains(state.mainPanel)) {
        try { getContainer().appendChild(state.mainPanel); } catch (e) {}
      }
      ensureElementInViewport(state.floatingBall, 56, 56, '20px', '20px');
      ensureElementInViewport(state.mainPanel, 420, 620, '90px', '20px');
    }, 2000);
  }

  init();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDOMContentLoaded);
  } else {
    onDOMContentLoaded();
  }
  window.addEventListener('load', onDOMContentLoaded);
  setTimeout(onDOMContentLoaded, 1500);
})();
