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

var FLOW_VOLATILE_QUERY_RE = /^(t|timestamp|ts|time|_t|nonce|random|r|cachebust|cb|_|token|requestid|reqid|sig|signature|uuid)$/i;

function stableQueryFingerprintForFlow(urlStr) {
  try {
    var parsed = new URL(urlStr);
    var keys = [];
    parsed.searchParams.forEach(function (_, kk) {
      if (keys.indexOf(kk) === -1) keys.push(kk);
    });
    keys.sort();
    var pairs = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (FLOW_VOLATILE_QUERY_RE.test(k)) continue;
      pairs.push(k + '=' + parsed.searchParams.get(k));
    }
    return pairs.join('&');
  } catch (e) {
    return '';
  }
}

function computeFlowRecordingSignature(rec) {
  var method = (rec.method || 'GET').toUpperCase();
  var urlStr = rec.originalUrl || rec.url || '';
  var pathnameKey = '';
  try {
    pathnameKey = getMockKey(urlStr);
  } catch (ex) {
    pathnameKey = urlStr;
  }
  var qfp = stableQueryFingerprintForFlow(urlStr);
  var bfp = fingerprintBody(rec.requestBody);
  return method + '\n' + pathnameKey + '\n' + qfp + '\n' + bfp;
}

function isDuplicateInActiveFlowRecording(record) {
  if (!state.flowRecording || !record) return false;
  var sigs = state.activeFlowRecordingSignatures;
  if (!sigs || typeof sigs !== 'object') return false;
  var sig = computeFlowRecordingSignature(record);
  return !!sigs[sig];
}

function rememberActiveFlowRecordingSignature(record) {
  if (!state.flowRecording || !record || !record.id) return;
  if (!state.activeFlowRecordingSignatures) state.activeFlowRecordingSignatures = {};
  state.activeFlowRecordingSignatures[computeFlowRecordingSignature(record)] = record.id;
}

function isDuplicateRequestRecord(record) {
  if (state.flowRecording) {
    return isDuplicateInActiveFlowRecording(record);
  }
  var sig = computeRequestSignature(record);
  var records = state.requestRecords || [];
  for (var i = 0; i < records.length; i++) {
    if (computeRequestSignature(records[i]) === sig) return true;
  }
  return false;
}

function isInsideAiReqUi(el) {
  try {
    var node = el;
    while (node && node !== document.documentElement) {
      if (node.className && typeof node.className === 'string' && node.className.indexOf('ai-req-') !== -1) return true;
      node = node.parentNode;
    }
  } catch (e) {}
  return false;
}

function getFlowTargetHint(target) {
  var hint = {
    tag: '',
    text: '',
    id: '',
    name: '',
    className: '',
    type: ''
  };
  if (!target) return hint;
  try {
    hint.tag = (target.tagName || '').toLowerCase();
    hint.text = (target.innerText || target.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80);
    hint.id = target.id || '';
    hint.name = target.getAttribute ? (target.getAttribute('name') || '') : '';
    hint.className = typeof target.className === 'string' ? target.className.substring(0, 120) : '';
    hint.type = target.getAttribute ? (target.getAttribute('type') || '') : '';
  } catch (e) {}
  return hint;
}

function buildFlowStepTitle(type, targetHint) {
  if (type === 'navigation') return '打开/切换页面';
  if (!targetHint) return '用户操作';
  var label = targetHint.text || targetHint.name || targetHint.id || targetHint.tag || '元素';
  if (type === 'input' || type === 'change') return '修改 ' + label;
  if (type === 'submit') return '提交表单';
  return '点击 ' + label;
}

function addFlowStep(type, target) {
  var flow = getActiveFlow();
  if (!flow || !state.flowRecording) return null;
  if (!flow.steps) flow.steps = [];
  var hint = target ? getFlowTargetHint(target) : null;
  var id = 'step_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  var step = {
    id: id,
    index: flow.steps.length + 1,
    type: type || 'user_action',
    title: buildFlowStepTitle(type, hint),
    at: Date.now(),
    url: location.href,
    target: hint,
    requestIds: []
  };
  flow.steps.push(step);
  state.activeFlowLastStepId = id;
  state.activeFlowLastActionAt = step.at;
  if (state.flowUi) state.flowUi.selectedStepId = id;
  saveFlows();
  if (state.isPanelOpen && state.ui && state.ui.activeMainTab === 'flow') {
    refreshMainWorkbench();
  }
  return step;
}

function getOrCreateFlowNetworkStep(flow, title) {
  if (!flow) return null;
  if (!flow.steps) flow.steps = [];
  var id = 'step_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  var step = {
    id: id,
    index: flow.steps.length + 1,
    type: 'network_group',
    title: title || '未归属请求',
    at: Date.now(),
    url: location.href,
    target: null,
    requestIds: []
  };
  flow.steps.push(step);
  state.activeFlowLastStepId = id;
  return step;
}

function classifyFlowRequest(record) {
  var url = record.originalUrl || record.url || '';
  var method = (record.method || 'GET').toUpperCase();
  var lower = String(url || '').toLowerCase();
  if (/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|mp4|mp3|wav|avi|map|webp)(\?|#|$)/i.test(url)) return 'noise';
  if (/track|analytics|sentry|beacon|collect|log|monitor/.test(lower)) return 'noise';
  if (/i18n|locale|translation|translations/.test(lower)) return 'noise';
  if (/config|dict|setting/.test(lower)) return 'support';
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') return 'core';
  if (record.responseBody && typeof record.responseBody === 'object') return 'core';
  return 'unknown';
}

function ensureFlowVerificationFields(flow) {
  if (!flow) return;
  if (!flow.verifiedRequestIds) flow.verifiedRequestIds = [];
  if (!flow.manualVerificationOverrides) flow.manualVerificationOverrides = {};
}

function setFlowRequestVerified(flow, reqId, verified, source) {
  ensureFlowVerificationFields(flow);
  var idx = flow.verifiedRequestIds.indexOf(reqId);
  if (verified && idx === -1) flow.verifiedRequestIds.push(reqId);
  if (!verified && idx !== -1) flow.verifiedRequestIds.splice(idx, 1);
  if (source === 'manual') {
    flow.manualVerificationOverrides[reqId] = verified ? 'checked' : 'unchecked';
  }
}

function autoVerifyFlowRequestIfCore(flow, reqId, cls) {
  ensureFlowVerificationFields(flow);
  if (cls !== 'core') return;
  if (flow.manualVerificationOverrides[reqId] === 'unchecked') return;
  setFlowRequestVerified(flow, reqId, true, 'auto');
}

function applyFlowClassificationToRequest(flow, reqId, cls, source) {
  ensureFlowVerificationFields(flow);
  if (!flow.classifications) flow.classifications = {};
  flow.classifications[reqId] = cls;
  if (!flow.requestMeta) flow.requestMeta = {};
  if (!flow.requestMeta[reqId]) flow.requestMeta[reqId] = {};
  flow.requestMeta[reqId].classification = cls;
  if (cls === 'core') {
    autoVerifyFlowRequestIfCore(flow, reqId, cls);
  } else if (cls === 'noise') {
    setFlowRequestVerified(flow, reqId, false, source === 'manual' ? 'manual' : 'auto');
  }
}

function pruneEmptyFlowSteps(flow) {
  if (!flow || !flow.steps) return 0;
  var kept = [];
  var removed = 0;
  var index = 1;
  for (var i = 0; i < flow.steps.length; i++) {
    var step = flow.steps[i];
    if (!step.requestIds || step.requestIds.length === 0) {
      removed++;
      continue;
    }
    step.index = index++;
    kept.push(step);
  }
  flow.steps = kept;
  if (state.activeFlowLastStepId) {
    var stillActive = false;
    for (var j = 0; j < kept.length; j++) {
      if (kept[j].id === state.activeFlowLastStepId) {
        stillActive = true;
        break;
      }
    }
    if (!stillActive) state.activeFlowLastStepId = kept.length ? kept[kept.length - 1].id : null;
  }
  return removed;
}

function countFlowStepsWithRequests(flow) {
  if (!flow || !flow.steps) return 0;
  var n = 0;
  for (var i = 0; i < flow.steps.length; i++) {
    if ((flow.steps[i].requestIds || []).length > 0) n++;
  }
  return n;
}

function attachRequestToActiveFlow(record) {
  var flow = getActiveFlow();
  if (!flow || !state.flowRecording || !record || !record.id) return;
  if (!flow.steps) flow.steps = [];
  if (!flow.classifications) flow.classifications = {};
  if (!flow.requestMeta) flow.requestMeta = {};
  var now = Date.now();
  var step = null;
  if (state.activeFlowLastStepId && now - (state.activeFlowLastActionAt || 0) <= 1500) {
    for (var i = 0; i < flow.steps.length; i++) {
      if (flow.steps[i].id === state.activeFlowLastStepId) {
        step = flow.steps[i];
        break;
      }
    }
  }
  if (!step && flow.steps.length > 0) {
    step = flow.steps[flow.steps.length - 1];
  }
  if (!step) step = getOrCreateFlowNetworkStep(flow, '录制期间请求');
  if (step.requestIds.indexOf(record.id) === -1) step.requestIds.push(record.id);
  var cls = flow.classifications[record.id] || classifyFlowRequest(record);
  applyFlowClassificationToRequest(flow, record.id, cls, 'auto');
  flow.requestMeta[record.id].stepId = step.id;
  flow.requestMeta[record.id].stepIndex = step.index;
  rememberActiveFlowRecordingSignature(record);
  saveFlows();
}

function addRequestRecord(record) {
  if (record.debugRule) {
    record.debugRule = normalizeRule(record.debugRule, getMockKey(record.originalUrl || record.url), record.method);
  }
  if (isDuplicateRequestRecord(record)) return;
  state.requestRecords.push(record);
  attachRequestToActiveFlow(record);
  if (state.requestRecords.length > MAX_RECORDS) {
    state.requestRecords.shift();
  }
  if (state.isPanelOpen) {
    refreshRequestList();
  }
}

function setupRequestInterception() {
  setupPageContextInterception();
  setupFlowStepRecording();
  interceptXHR();
  interceptFetch();
}

function setupFlowStepRecording() {
  if (state.flowStepRecordingReady) return;
  state.flowStepRecordingReady = true;
  var lastInputAt = 0;
  function handleAction(type, event) {
    if (!state.flowRecording) return;
    var target = event && event.target;
    if (isInsideAiReqUi(target)) return;
    if (type === 'input' || type === 'change') {
      var now = Date.now();
      if (now - lastInputAt < 800) return;
      lastInputAt = now;
      if (target && target.getAttribute && String(target.getAttribute('type') || '').toLowerCase() === 'password') return;
    }
    addFlowStep(type === 'click' ? 'user_action' : type, target);
  }
  document.addEventListener('click', function (event) { handleAction('click', event); }, true);
  document.addEventListener('input', function (event) { handleAction('input', event); }, true);
  document.addEventListener('change', function (event) { handleAction('change', event); }, true);
  document.addEventListener('submit', function (event) { handleAction('submit', event); }, true);
  var lastHref = location.href;
  setInterval(function () {
    if (!state.flowRecording) {
      lastHref = location.href;
      return;
    }
    if (location.href !== lastHref) {
      lastHref = location.href;
      addFlowStep('navigation', null);
    }
  }, 800);
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
      var mockMatch = hasResponseBodyMock(rule) ? buildMockedResponseBody(rule, rule.response.body).body : null;
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

        var parsedBody = tryParseJson(respBody);
        var patchWarnings = [];
        if (rule && hasResponsePatches(rule) && parsedBody && typeof parsedBody === 'object') {
          var builtBody = buildMockedResponseBody(rule, parsedBody);
          parsedBody = builtBody.body;
          patchWarnings = builtBody.warnings || [];
          try {
            var patchedJson = JSON.stringify(parsedBody);
            defineMockXhrResponse(self, patchedJson, parsedBody, reqInfo.url, {
              status: self.status,
              statusText: self.statusText || 'OK',
              headers: respHeaders
            });
          } catch (ePatch) {}
        }

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
          responseBody: parsedBody,
          duration: duration,
          aiAnalysis: null,
          isMocked: !!(rule && hasResponsePatches(rule)),
          mockData: (rule && hasResponsePatches(rule)) ? parsedBody : null,
          debugRule: rule,
          patchWarnings: patchWarnings
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

    var mockMatch = hasResponseBodyMock(rule) ? buildMockedResponseBody(rule, rule.response.body).body : null;
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
      return returnedResponse.clone().text().then(function (text) {
        var duration = Date.now() - startTime;
        var respHeaders = {};
        try {
          returnedResponse.headers.forEach(function (v, k) { respHeaders[k] = v; });
        } catch (e) {}

        var parsedBody = tryParseJson(text);
        var patchWarnings = [];
        var finalResponse = returnedResponse;
        if (rule && hasResponsePatches(rule) && parsedBody && typeof parsedBody === 'object') {
          var builtFetch = buildMockedResponseBody(rule, parsedBody);
          parsedBody = builtFetch.body;
          patchWarnings = builtFetch.warnings || [];
          try {
            finalResponse = new Response(JSON.stringify(parsedBody), {
              status: returnedResponse.status,
              statusText: returnedResponse.statusText,
              headers: buildResponseHeaders(rule, respHeaders)
            });
          } catch (eResp) {}
        }

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
          responseBody: parsedBody,
          duration: duration,
          aiAnalysis: null,
          isMocked: !!(rule && hasResponsePatches(rule)),
          mockData: (rule && hasResponsePatches(rule)) ? parsedBody : null,
          debugRule: rule,
          patchWarnings: patchWarnings
        });
        consumeOnceRuleByKey(rule && rule._key);
        return finalResponse;
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
        consumeOnceRuleByKey(rule && rule._key);
        return returnedResponse;
      });
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
