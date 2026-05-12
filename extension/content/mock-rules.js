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
