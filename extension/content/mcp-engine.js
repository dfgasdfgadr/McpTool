function escapeHtml(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isStaticResource(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return true;
  var staticExt = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|mp4|mp3|wav|avi|map|webp)(\?|#|$)/i;
  return staticExt.test(url);
}

function stripSensitiveHeaders(headers) {
  var sensitive = ['cookie', 'authorization', 'set-cookie', 'proxy-authorization', 'www-authenticate', 'proxy-authenticate'];
  var result = {};
  for (var key in headers) {
    if (sensitive.indexOf(key.toLowerCase()) === -1) {
      result[key] = headers[key];
    }
  }
  return result;
}

function inferJsonType(value) {
  if (value === null || typeof value === 'undefined') {
    return { type: 'string' };
  }
  if (typeof value === 'number') {
    return { type: 'number' };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }
  if (typeof value === 'string') {
    if (value === 'true' || value === 'false') {
      return { type: 'boolean' };
    }
    if (/^https?:\/\/.+/i.test(value)) {
      return { type: 'string', format: 'uri' };
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { type: 'string', format: 'email' };
    }
    if (/^\d{13}$/.test(value) && Number(value) > 1e12) {
      return { type: 'integer', format: 'unix-timestamp' };
    }
    return { type: 'string' };
  }
  if (Array.isArray(value)) {
    if (value.length > 0) {
      return { type: 'array', items: inferJsonType(value[0]) };
    }
    return { type: 'array', items: {} };
  }
  if (typeof value === 'object') {
    var props = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      props[keys[i]] = inferJsonType(value[keys[i]]);
    }
    return { type: 'object', properties: props };
  }
  return { type: 'string' };
}

function assessRiskLevel(method, pathname) {
  var m = (method || '').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return 'low';
  if (m === 'DELETE') return 'high';
  var lower = (pathname || '').toLowerCase();
  var highKeywords = ['delete', 'remove', 'cancel', 'pay', 'transfer', 'withdraw'];
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
    for (var i = 0; i < highKeywords.length; i++) {
      if (lower.indexOf(highKeywords[i]) !== -1) return 'high';
    }
    return 'medium';
  }
  return 'medium';
}

function detectAuthType(headers) {
  if (!headers || typeof headers !== 'object') return 'none';
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = headers[k];
    if (/^authorization$/i.test(k) && typeof v === 'string' && v.indexOf('Bearer') === 0) {
      return 'bearer';
    }
  }
  for (var j = 0; j < keys.length; j++) {
    var kj = keys[j];
    if (/^cookie$/i.test(kj) || /^set-cookie$/i.test(kj)) {
      return 'cookie';
    }
  }
  for (var x = 0; x < keys.length; x++) {
    var kx = keys[x];
    if (/^x-/i.test(kx)) {
      return 'custom';
    }
  }
  return 'none';
}

function extractQueryParams(url) {
  var result = {};
  if (!url || typeof url !== 'string') return result;
  try {
    var parsed = new URL(url);
    parsed.searchParams.forEach(function (val, key) {
      result[key] = val;
    });
  } catch (e) {
    var qIdx = url.indexOf('?');
    if (qIdx !== -1) {
      var qs = url.substring(qIdx + 1);
      var hashIdx = qs.indexOf('#');
      if (hashIdx !== -1) qs = qs.substring(0, hashIdx);
      var pairs = qs.split('&');
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split('=');
        if (pair.length >= 1) {
          result[decodeURIComponent(pair[0])] = pair.length >= 2 ? decodeURIComponent(pair[1]) : '';
        }
      }
    }
  }
  return result;
}

function inferPathParams(pathname, sampleRecords) {
  if (!pathname || !sampleRecords || !sampleRecords.length) return [];
  var segments = pathname.split('/').filter(Boolean);
  var paramList = [];
  for (var s = 0; s < segments.length; s++) {
    var seg = segments[s];
    if (/^\d+$/.test(seg)) {
      paramList.push({ name: 'id', position: s });
      continue;
    }
    var isHexId = /^[0-9a-fA-F]{8,}$/.test(seg);
    if (isHexId) {
      paramList.push({ name: 'id', position: s });
      continue;
    }
    var isVarSegment = false;
    for (var r = 1; r < sampleRecords.length; r++) {
      try {
        var otherPath = new URL(sampleRecords[r].url || sampleRecords[r].originalUrl || '').pathname;
        var otherSegs = otherPath.split('/').filter(Boolean);
        if (otherSegs[s] && otherSegs[s] !== seg) {
          isVarSegment = true;
          break;
        }
      } catch (e) {}
    }
    if (isVarSegment) {
      var pName = seg.replace(/[0-9]+/g, '').replace(/-+$/g, '') || 'param';
      paramList.push({ name: pName, position: s });
    }
  }
  return paramList;
}

function generateMcpToolFromRecord(req) {
  var reqUrl = req.originalUrl || req.url || '';
  var method = (req.method || 'GET').toUpperCase();
  var parsed;
  try {
    parsed = new URL(reqUrl);
  } catch (e) {
    parsed = { pathname: reqUrl, search: '' };
  }
  var pathname = parsed.pathname || reqUrl;

  var snakePath = pathname.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  var toolName = method.toLowerCase() + '_' + snakePath;

  var description;
  if (req.aiAnalysis && typeof req.aiAnalysis === 'string') {
    var firstLine = req.aiAnalysis.split('\n')[0].trim();
    description = firstLine || (method + ' ' + pathname);
  } else {
    description = method + ' ' + pathname;
  }

  var properties = {};
  var required = [];

  if (req.requestBody && typeof req.requestBody === 'object' && !Array.isArray(req.requestBody)) {
    var bodyKeys = Object.keys(req.requestBody);
    for (var b = 0; b < bodyKeys.length; b++) {
      properties[bodyKeys[b]] = inferJsonType(req.requestBody[bodyKeys[b]]);
      required.push(bodyKeys[b]);
    }
  }

  var queryParams = extractQueryParams(reqUrl);
  var qKeys = Object.keys(queryParams);
  for (var q = 0; q < qKeys.length; q++) {
    properties[qKeys[q]] = { type: 'string' };
    required.push(qKeys[q]);
  }

  var isReadOnly = (method === 'GET' || method === 'HEAD');
  var riskLevel = assessRiskLevel(method, pathname);
  var authType = detectAuthType(req.requestHeaders || {});
  var contentType = '';
  if (req.requestHeaders) {
    var ctKeys = Object.keys(req.requestHeaders);
    for (var c = 0; c < ctKeys.length; c++) {
      if (/^content-type$/i.test(ctKeys[c])) {
        contentType = req.requestHeaders[ctKeys[c]];
        break;
      }
    }
  }

  return {
    name: toolName,
    description: description,
    inputSchema: {
      type: 'object',
      properties: properties,
      required: required
    },
    _meta: {
      origin: reqUrl,
      pathname: pathname,
      method: method,
      sampleRequestHeaders: stripSensitiveHeaders(req.requestHeaders || {}),
      sampleResponseBody: req.responseBody || null,
      detectedAuthType: authType,
      contentType: contentType,
      observedCount: 1,
      lastObserved: req.timestamp || Date.now(),
      isReadOnly: isReadOnly,
      riskLevel: riskLevel
    },
    enabled: true
  };
}

function generateMcpToolsFromRecords(records) {
  if (!records || !Array.isArray(records)) return [];
  var filtered = records.filter(function (rec) {
    var u = rec.originalUrl || rec.url || '';
    if (isStaticResource(u)) return false;
    if (u.indexOf('api.moonshot.cn') !== -1) return false;
    return true;
  });

  var groups = {};
  for (var i = 0; i < filtered.length; i++) {
    var rec = filtered[i];
    var recUrl = rec.originalUrl || rec.url || '';
    var method = (rec.method || 'GET').toUpperCase();
    var pa;
    try {
      pa = new URL(recUrl).pathname;
    } catch (e) {
      pa = recUrl;
    }
    var groupKey = method + ' ' + pa;
    if (!groups[groupKey]) {
      groups[groupKey] = { method: method, pathname: pa, records: [] };
    }
    groups[groupKey].records.push(rec);
  }

  var tools = [];
  var gKeys = Object.keys(groups);
  for (var g = 0; g < gKeys.length; g++) {
    var group = groups[gKeys[g]];
    if (!group.records.length) continue;
    var templateTool = generateMcpToolFromRecord(group.records[0]);

    var allProps = templateTool.inputSchema.properties;
    var fieldPresence = {};
    var fieldValues = {};
    var propKeys = Object.keys(allProps);
    for (var p = 0; p < propKeys.length; p++) {
      fieldPresence[propKeys[p]] = 0;
      fieldValues[propKeys[p]] = [];
    }

    for (var r = 0; r < group.records.length; r++) {
      var body = group.records[r].requestBody;
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        var bKeys = Object.keys(body);
        for (var bk = 0; bk < bKeys.length; bk++) {
          if (!fieldPresence.hasOwnProperty(bKeys[bk])) {
            fieldPresence[bKeys[bk]] = 0;
            fieldValues[bKeys[bk]] = [];
          }
          fieldPresence[bKeys[bk]]++;
          fieldValues[bKeys[bk]].push(body[bKeys[bk]]);
        }
      }
      var qParams = extractQueryParams(group.records[r].originalUrl || group.records[r].url || '');
      var qpKeys = Object.keys(qParams);
      for (var qp = 0; qp < qpKeys.length; qp++) {
        if (!fieldPresence.hasOwnProperty(qpKeys[qp])) {
          fieldPresence[qpKeys[qp]] = 0;
          fieldValues[qpKeys[qp]] = [];
        }
        fieldPresence[qpKeys[qp]]++;
        fieldValues[qpKeys[qp]].push(qParams[qpKeys[qp]]);
      }
    }

    var requiredFields = [];
    var pk = Object.keys(fieldPresence);
    for (var pi = 0; pi < pk.length; pi++) {
      if (fieldPresence[pk[pi]] === group.records.length) {
        requiredFields.push(pk[pi]);
      }
    }

    var mergedProps = {};
    var mpk = Object.keys(fieldPresence);
    for (var mi = 0; mi < mpk.length; mi++) {
      var fName = mpk[mi];
      var vals = fieldValues[fName];
      if (vals.length > 0) {
        mergedProps[fName] = inferJsonType(vals[0]);
        var uniqueVals = [];
        var seen = {};
        for (var vi = 0; vi < vals.length; vi++) {
          var vs = typeof vals[vi] === 'object' ? JSON.stringify(vals[vi]) : String(vals[vi]);
          if (!seen[vs]) {
            seen[vs] = true;
            uniqueVals.push(vals[vi]);
          }
        }
        if (uniqueVals.length > 1 && uniqueVals.length <= 10 && mergedProps[fName].type === 'string') {
          mergedProps[fName].enum = uniqueVals.map(function (v) { return typeof v === 'string' ? v : String(v); });
        }
      } else {
        mergedProps[fName] = { type: 'string' };
      }
    }

    templateTool.inputSchema.properties = mergedProps;
    templateTool.inputSchema.required = requiredFields;

    var latestTs = 0;
    for (var lt = 0; lt < group.records.length; lt++) {
      var ts = group.records[lt].timestamp || 0;
      if (ts > latestTs) latestTs = ts;
    }

    templateTool._meta.observedCount = group.records.length;
    templateTool._meta.lastObserved = latestTs;

    tools.push(templateTool);
  }

  return tools;
}

var MCP_TOOLS_KEY_PREFIX = 'ai_req_mcp_tools_';

function saveMcpTools() {
  var key = MCP_TOOLS_KEY_PREFIX + location.hostname;
  storageSet(key, JSON.stringify(state.mcpTools));
}

function loadMcpTools() {
  try {
    var key = MCP_TOOLS_KEY_PREFIX + location.hostname;
    var saved = storageGet(key, null);
    if (saved) {
      state.mcpTools = JSON.parse(saved);
    }
  } catch (e) {}
}

function deleteMcpTool(toolName) {
  if (state.mcpTools && state.mcpTools.hasOwnProperty(toolName)) {
    delete state.mcpTools[toolName];
    saveMcpTools();
  }
}

function handleMcpProxyRequest(payload, sendResponse) {
  var url = payload.url;
  var method = (payload.method || 'GET').toUpperCase();
  var headers = payload.headers || {};
  var body = payload.body;
  var timeout = payload.timeout || 30000;
  var callId = payload.callId;

  var controller;
  try {
    controller = new AbortController();
  } catch (e) {
    sendResponse({
      ok: false,
      callId: callId,
      status: 0,
      headers: {},
      body: null,
      error: '请求初始化失败',
      proxyMode: 'tab'
    });
    return;
  }

  var timeoutId = setTimeout(function () {
    try { controller.abort(); } catch (e) {}
  }, timeout);

  var fetchOpts = {
    method: method,
    headers: headers,
    signal: controller.signal
  };

  if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null) {
    fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  fetch(url, fetchOpts).then(function (response) {
    clearTimeout(timeoutId);
    var respHeaders = {};
    try {
      response.headers.forEach(function (v, k) { respHeaders[k] = v; });
    } catch (e) {}

    var contentType = '';
    try {
      contentType = (response.headers.get('content-type') || '').toLowerCase();
    } catch (e) {}

    if (contentType.indexOf('application/json') !== -1) {
      return response.json().then(function (parsedBody) {
        sendResponse({
          ok: true,
          callId: callId,
          status: response.status,
          headers: respHeaders,
          body: parsedBody,
          error: null,
          proxyMode: 'tab'
        });
      });
    } else {
      return response.text().then(function (textBody) {
        var parsedBody = tryParseJson(textBody);
        sendResponse({
          ok: true,
          callId: callId,
          status: response.status,
          headers: respHeaders,
          body: parsedBody,
          error: null,
          proxyMode: 'tab'
        });
      });
    }
  }).catch(function (err) {
    clearTimeout(timeoutId);
    var errMsg = '请求失败';
    if (err && err.name === 'AbortError') {
      errMsg = '请求超时';
    }
    sendResponse({
      ok: false,
      callId: callId,
      status: 0,
      headers: {},
      body: null,
      error: errMsg,
      proxyMode: 'tab'
    });
  });
}
