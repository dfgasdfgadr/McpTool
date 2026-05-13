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

  var mcpTabBtn = document.createElement('button');
  mcpTabBtn.className = 'ai-req-panel-btn ai-req-mcp-tab-btn';
  mcpTabBtn.textContent = 'MCP \u5DE5\u5177';
  mcpTabBtn.title = 'MCP \u5DE5\u5177\u7BA1\u7406';
  mcpTabBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    state.mcpPanelTab = state.mcpPanelTab === 'list' ? null : 'list';
    if (state.mcpPanelTab === 'list') {
      mcpTabBtn.classList.add('ai-req-mcp-tab-btn-active');
    } else {
      mcpTabBtn.classList.remove('ai-req-mcp-tab-btn-active');
    }
    refreshMainPanelContent();
  });

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
  header.appendChild(mcpTabBtn);
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
    refreshRequestList(searchInput.value.trim(), false);
  });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  });
  searchBox.appendChild(searchInput);

  var filterBar = document.createElement('div');
  filterBar.className = 'ai-req-filter-toolbar';
  filterBar.innerHTML = '' +
    '<div class="ai-req-chip-row">' +
    '  <span class="ai-req-filter-label">\u7B5B\u9009:</span>' +
    '  <button type="button" class="ai-req-chip" data-filter-chip="dup">\u91CD\u590D\u8BF7\u6C42</button>' +
    '  <span class="ai-req-chip-sep">|</span>' +
    '  <span class="ai-req-chip-sub">Mock:</span>' +
    '  <button type="button" class="ai-req-chip" data-mock-filter-chip="all">\u5168\u90E8</button>' +
    '  <button type="button" class="ai-req-chip" data-mock-filter-chip="mocked">\u5DF2Mock</button>' +
    '  <button type="button" class="ai-req-chip" data-mock-filter-chip="plain">\u672AMock</button>' +
    '  <span class="ai-req-chip-sep">|</span>' +
    '  <span class="ai-req-chip-sub">AI:</span>' +
    '  <button type="button" class="ai-req-chip" data-analyzed-filter-chip="all">\u5168\u90E8</button>' +
    '  <button type="button" class="ai-req-chip" data-analyzed-filter-chip="done">\u5DF2\u5206\u6790</button>' +
    '  <button type="button" class="ai-req-chip" data-analyzed-filter-chip="pending">\u672A\u5206\u6790</button>' +
    '</div>' +
    '<div class="ai-req-chip-row">' +
    '  <span class="ai-req-chip-sub">\u65B9\u6CD5:</span>' +
    '  <button type="button" class="ai-req-chip ai-req-method-chip-btn" data-method-chip="GET">GET</button>' +
    '  <button type="button" class="ai-req-chip ai-req-method-chip-btn" data-method-chip="POST">POST</button>' +
    '  <button type="button" class="ai-req-chip ai-req-method-chip-btn" data-method-chip="PUT">PUT</button>' +
    '  <button type="button" class="ai-req-chip ai-req-method-chip-btn" data-method-chip="PATCH">PATCH</button>' +
    '  <button type="button" class="ai-req-chip ai-req-method-chip-btn" data-method-chip="DELETE">DEL</button>' +
    '  <span class="ai-req-chip-spacer"></span>' +
    '  <label class="ai-req-toolbar-group">\u5206\u7EC4: <select class="ai-req-group-select">' +
    '    <option value="none">\u5E73\u94FA</option>' +
    '    <option value="host">\u6309\u57DF\u540D</option>' +
    '    <option value="endpoint">\u6309\u63A5\u53E3(METHOD + path)</option>' +
    '  </select></label>' +
    '  <label class="ai-req-enhanced-gen-label">' +
    '    <input type="checkbox" class="ai-req-enhanced-gen-cb">\u589E\u5F3A MCP \u63A8\u65AD (\u975E\u4E00\u952E\u9ED8\u8BA4\u8DEF\u5F84)' +
    '  </label>' +
    '</div>';

  var actionBar = document.createElement('div');
  actionBar.className = 'ai-req-action-bar';
  var analyzeAllBtn = document.createElement('button');
  analyzeAllBtn.className = 'ai-req-analyze-all-btn';
  analyzeAllBtn.textContent = '\u2728 \u4E00\u952E\u5206\u6790\u6240\u6709';
  analyzeAllBtn.addEventListener('click', function () {
    analyzeAllRequests();
  });
  var mcpGenAllBtn = document.createElement('button');
  mcpGenAllBtn.className = 'ai-req-action-btn ai-req-mcp-gen-all-btn';
  mcpGenAllBtn.textContent = '\uD83D\uDD17 \u4E00\u952E\u751F\u6210MCP\u5DE5\u5177';
  mcpGenAllBtn.title = '\u6839\u636E\u5168\u90E8\u6293\u5305\u8BB0\u5F55\uFF08\u4E0E\u4EE5\u524D\u4E00\u81F4\uFF09\uFF1B\u975E\u201C\u589E\u5F3A\u201D\u914D\u7F6E';
  mcpGenAllBtn.addEventListener('click', function () {
    var toolsNative = generateMcpToolsFromRecords(state.requestRecords);
    var tiNat;
    for (tiNat = 0; tiNat < toolsNative.length; tiNat++) {
      var tnm = toolsNative[tiNat];
      state.mcpTools[tnm.name] = tnm;
    }
    saveMcpTools();
    chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
    showToast('\u5DF2\u751F\u6210 ' + toolsNative.length + ' \u4E2A MCP \u5DE5\u5177');
  });
  var mcpGenViewBtn = document.createElement('button');
  mcpGenViewBtn.type = 'button';
  mcpGenViewBtn.className = 'ai-req-action-btn ai-req-mcp-gen-view-btn';
  mcpGenViewBtn.title = '\u6839\u636E\u5F53\u524D\u5339\u914D/\u641C\u7D22/\u8FC7\u6EE4\u540E\u7684\u5217\u8868\u751F\u6210\uFF0C\u9075\u7167 MCP \u589E\u5F3A\u5F00\u5173\u72B6\u6001';
  mcpGenViewBtn.textContent = '\uD83E\uDD16 \u89C6\u56FE\u5185 MCP';
  mcpGenViewBtn.addEventListener('click', function () {
    var viewRecs = filterRequestRecords(state.requestRecords, getActiveListKeyword());
    var genVX = typeof pickGeneratorForRequests === 'function' ? pickGeneratorForRequests() : generateMcpToolsFromRecords;
    var toolsV = genVX(viewRecs);
    var iv;
    for (iv = 0; iv < toolsV.length; iv++) state.mcpTools[toolsV[iv].name] = toolsV[iv];
    saveMcpTools();
    chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
    showToast('\u89C6\u56FE MCP ' + toolsV.length + '\u4E2A');
  });

  var mcpGenSelBtn = document.createElement('button');
  mcpGenSelBtn.type = 'button';
  mcpGenSelBtn.className = 'ai-req-action-btn ai-req-mcp-gen-sel-btn';
  mcpGenSelBtn.title = '\u7528 checkbox \u52FE\u9009\u591A\u6761\u8BF7\u6C42\u540E\u751F\u6210\uFF0C\u9075\u5FAA MCP \u589E\u5F3A\u5F00\u5173';
  mcpGenSelBtn.textContent = '\u2705 \u5DF2\u9009 MCP';
  mcpGenSelBtn.addEventListener('click', function () {
    var smap = {};
    for (var xk in state.selectedReqIds) if (state.selectedReqIds[xk]) smap[xk] = true;
    var srec = state.requestRecords.filter(function (r) {
      return smap[r.id];
    });
    if (!srec.length) {
      showToast('\u8BF7\u5148\u52FE\u9009\u8BF7\u6C42\u884C');
      return;
    }
    var genSX = typeof pickGeneratorForRequests === 'function' ? pickGeneratorForRequests() : generateMcpToolsFromRecords;
    var toolsS = genSX(srec);
    var is;
    for (is = 0; is < toolsS.length; is++) state.mcpTools[toolsS[is].name] = toolsS[is];
    saveMcpTools();
    chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
    showToast('\u5DF2\u9009 MCP ' + toolsS.length + '\u4E2A');
  });

  var clearMockBtn = document.createElement('button');
  clearMockBtn.className = 'ai-req-clear-mock-btn';
  clearMockBtn.textContent = '\u6E05\u9664\u6240\u6709\u89C4\u5219';
  clearMockBtn.title = '\u6E05\u9664\u5F53\u524D\u57DF\u540D\u4E0B\u4FDD\u5B58\u7684\u6240\u6709\u8C03\u8BD5\u89C4\u5219';
  clearMockBtn.addEventListener('click', function () {
    clearAllMockRules();
  });
  var reqCount = document.createElement('span');
  reqCount.className = 'ai-req-req-count';
  reqCount.textContent = '0 \u8BF7\u6C42';
  actionBar.appendChild(analyzeAllBtn);
  actionBar.appendChild(mcpGenAllBtn);
  actionBar.appendChild(mcpGenViewBtn);
  actionBar.appendChild(mcpGenSelBtn);
  actionBar.appendChild(clearMockBtn);
  actionBar.appendChild(reqCount);

  var progressBar = document.createElement('div');
  progressBar.className = 'ai-req-progress-bar';
  var progressFill = document.createElement('div');
  progressFill.className = 'ai-req-progress-fill';
  progressBar.appendChild(progressFill);

  var requestList = document.createElement('div');
  requestList.className = 'ai-req-request-list';

  var mainBody = document.createElement('div');
  mainBody.className = 'ai-req-main-body';
  var bulkBarReq = document.createElement('div');
  bulkBarReq.className = 'ai-req-req-bulk-bar';
  bulkBarReq.style.display = 'none';
  bulkBarReq.innerHTML = '' +
    '<span class="ai-req-req-bulk-count">\u5DF2\u9009 0</span>' +
    '<button type="button" class="ai-req-btn ai-req-btn-secondary" data-bulk-act="bulk-ai">\u6279\u91CF AI\u5206\u6790</button>' +
    '<button type="button" class="ai-req-btn ai-req-btn-secondary" data-bulk-act="bulk-mcp-selected">\u5DF2\u9009\u2192MCP</button>' +
    '<button type="button" class="ai-req-btn ai-req-btn-secondary" data-bulk-act="clear-selection">\u6E05\u7A7A\u9009\u62E9</button>';
  mainBody.appendChild(bulkBarReq);
  mainBody.appendChild(requestList);

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
  panel.appendChild(filterBar);
  panel.appendChild(actionBar);
  panel.appendChild(progressBar);
  panel.appendChild(mainBody);
  panel.appendChild(bottomInput);

  makeDraggable(panel, header);

  safeAppendChild(panel);
  state.mainPanel = panel;
  wireReqFilterInteractionsOnce(panel);
  refreshFilterChipHighlight();
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

function getActiveListKeyword() {
  var kw = '';
  if (state.mainPanel) {
    var si = state.mainPanel.querySelector('.ai-req-search-input');
    if (si) kw = (si.value || '').trim();
  }
  return kw;
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

function duplicateSignatureCounts(records) {
  var mp = {};
  for (var i = 0; i < records.length; i++) {
    var s = computeRequestSignature(records[i]);
    mp[s] = (mp[s] || 0) + 1;
  }
  return mp;
}

function passesMethodChip(rec, methodsObj) {
  var chosen = false;
  for (var mk in methodsObj) {
    if (methodsObj.hasOwnProperty(mk) && methodsObj[mk]) chosen = true;
  }
  if (!chosen) return true;
  var up = (rec.method || 'GET').toUpperCase();
  return !!methodsObj[up];
}

function recordShowsMocked(rec) {
  var raw = findDebugRule(rec.originalUrl || rec.url, rec.method);
  var ar = raw ? normalizeRule(raw) : null;
  return !!(rec.isMocked === true || (ar && hasResponseBodyMock(ar)));
}

function passesListFiltersExtras(rec, dupCounts, dupOnly) {
  var lf = state.listFilters || {};
  if (dupOnly && dupCounts) {
    var sig = computeRequestSignature(rec);
    if ((dupCounts[sig] || 0) < 2) return false;
  }
  if (lf.mock === 'mocked' && !recordShowsMocked(rec)) return false;
  if (lf.mock === 'plain' && recordShowsMocked(rec)) return false;
  if (lf.analyzed === 'done' && !(rec.aiAnalysis != null && rec.aiAnalysis !== '')) return false;
  if (lf.analyzed === 'pending' && (rec.aiAnalysis != null && rec.aiAnalysis !== '')) return false;
  if (!passesMethodChip(rec, lf.methods || {})) return false;
  return true;
}

function filterRequestRecords(records, keyword) {
  var filt = records;
  if (keyword) {
    var kw = keyword.toLowerCase();
    filt = records.filter(function (r) {
      return String(r.url || '').toLowerCase().indexOf(kw) !== -1 ||
        (r.aiAnalysis && r.aiAnalysis.toLowerCase().indexOf(kw) !== -1);
    });
  }
  var lf = state.listFilters || {};
  var dc = lf.dupOnly ? duplicateSignatureCounts(filt) : null;
  return filt.filter(function (r2) {
    return passesListFiltersExtras(r2, dc, !!lf.dupOnly);
  });
}

function selectionCountRequests() {
  var n = 0;
  for (var rq in state.selectedReqIds) {
    if (state.selectedReqIds[rq]) n++;
  }
  return n;
}

function pruneSelectedReqIdsToMatchRecords(visibleRecords) {
  var allow = {};
  for (var i = 0; i < visibleRecords.length; i++) {
    allow[visibleRecords[i].id] = true;
  }
  var nx = {};
  for (var id in state.selectedReqIds) {
    if (state.selectedReqIds[id] && allow[id]) nx[id] = true;
  }
  state.selectedReqIds = nx;
}

function setAllRecordsSelection(recordsList, chk) {
  if (!state.selectedReqIds || typeof state.selectedReqIds !== 'object') state.selectedReqIds = {};
  for (var ij = 0; ij < recordsList.length; ij++) {
    var rid = recordsList[ij].id;
    if (chk) state.selectedReqIds[rid] = true;
    else delete state.selectedReqIds[rid];
  }
}

function recordGroupMeta(rec, groupMode) {
  try {
    if (groupMode === 'host') {
      return new URL(rec.url || '').hostname || location.hostname || 'host';
    }
    if (groupMode === 'endpoint') {
      var mh = (rec.method || 'GET').toUpperCase();
      try {
        return mh + ' ' + new URL(rec.originalUrl || rec.url || '').pathname;
      } catch (e1) {
        return mh + ' ';
      }
    }
  } catch (e2) {}
  return '其他';
}

function groupRecordsSorted(records, groupMode) {
  if (!groupMode || groupMode === 'none') return { keys: [], map: {}, useFlat: true, flat: records };
  var order = [];
  var mp = {};
  for (var g = 0; g < records.length; g++) {
    var rec = records[g];
    var gn = recordGroupMeta(rec, groupMode);
    if (!mp[gn]) {
      mp[gn] = [];
      order.push(gn);
    }
    mp[gn].push(rec);
  }
  return { keys: order, map: mp, useFlat: false };
}

function refreshFilterChipHighlight() {
  if (!state.mainPanel) return;
  var lf = state.listFilters || {};

  function chip(name1, active) {
    var ch = state.mainPanel.querySelector('[data-filter-chip="' + name1 + '"]');
    if (ch) ch.classList.toggle('ai-req-chip-active', active);
  }

  chip('dup', !!lf.dupOnly);

  var mockKeys = [['all'], ['mocked'], ['plain']];
  mockKeys.forEach(function (tuple) {
    var q = '[data-mock-filter-chip="' + tuple[0] + '"]';
    var cel = state.mainPanel.querySelector(q);
    if (cel) cel.classList.toggle('ai-req-chip-active', lf.mock === tuple[0]);
  });

  var anKeys = ['all', 'done', 'pending'];
  for (var ai = 0; ai < anKeys.length; ai++) {
    var ax = state.mainPanel.querySelector('[data-analyzed-filter-chip="' + anKeys[ai] + '"]');
    if (ax) ax.classList.toggle('ai-req-chip-active', lf.analyzed === anKeys[ai]);
  }

  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach(function (mh) {
    var btn = state.mainPanel.querySelector('[data-method-chip="' + mh + '"]');
    if (btn) btn.classList.toggle('ai-req-chip-active', !!(lf.methods && lf.methods[mh]));
  });

  var gsel = state.mainPanel.querySelector('.ai-req-group-select');
  if (gsel) gsel.value = lf.groupMode || 'none';

  var ech = state.mainPanel.querySelector('.ai-req-enhanced-gen-cb');
  if (ech) ech.checked = !!state.mcpUseEnhancedGeneration;
}

function wireReqFilterInteractionsOnce(panel) {
  if (panel._wireReqFiltersOnce) return;
  panel._wireReqFiltersOnce = true;

  panel.addEventListener('click', function (ev) {
    var tg = ev.target;
    var chipDupEl = tg.closest && tg.closest('[data-filter-chip="dup"]');
    if (chipDupEl) {
      state.listFilters.dupOnly = !state.listFilters.dupOnly;
      refreshFilterChipHighlight();
      refreshRequestList(undefined, false);
      return;
    }
    var mfc = tg.closest && tg.closest('[data-mock-filter-chip]');
    if (mfc && mfc.dataset.mockFilterChip) {
      state.listFilters.mock = mfc.dataset.mockFilterChip;
      refreshFilterChipHighlight();
      refreshRequestList(undefined, false);
      return;
    }
    var afc = tg.closest && tg.closest('[data-analyzed-filter-chip]');
    if (afc && afc.dataset.analyzedFilterChip) {
      state.listFilters.analyzed = afc.dataset.analyzedFilterChip;
      refreshFilterChipHighlight();
      refreshRequestList(undefined, false);
      return;
    }
    var mthc = tg.closest && tg.closest('[data-method-chip]');
    if (mthc && mthc.dataset.methodChip) {
      var lm = mthc.dataset.methodChip;
      if (!state.listFilters.methods) state.listFilters.methods = {};
      state.listFilters.methods[lm] = !state.listFilters.methods[lm];
      refreshFilterChipHighlight();
      refreshRequestList(undefined, false);
    }
  });

  panel.addEventListener('change', function (evc) {
    if (evc.target && evc.target.classList && evc.target.classList.contains('ai-req-group-select')) {
      state.listFilters.groupMode = evc.target.value || 'none';
      refreshRequestList(undefined, false);
    }
    if (evc.target && evc.target.classList && evc.target.classList.contains('ai-req-enhanced-gen-cb')) {
      state.mcpUseEnhancedGeneration = !!evc.target.checked;
    }
  });

  var bulkInner = panel.querySelector('.ai-req-req-bulk-bar');
  if (bulkInner && !bulkInner._bulkOnce) {
    bulkInner._bulkOnce = true;
    bulkInner.addEventListener('click', function (be) {
      var bbtn = be.target.closest && be.target.closest('[data-bulk-act]');
      if (!bbtn) return;
      var act = bbtn.getAttribute('data-bulk-act');
      function selectedRecsInner() {
        var sm = {};
        for (var k in state.selectedReqIds) if (state.selectedReqIds[k]) sm[k] = true;
        return state.requestRecords.filter(function (rr) {
          return sm[rr.id];
        });
      }
      if (act === 'clear-selection') {
        state.selectedReqIds = {};
      } else if (act === 'bulk-ai') {
        var lids = [];
        for (var k2 in state.selectedReqIds) if (state.selectedReqIds[k2]) lids.push(k2);
        analyzeRequestsSequential(lids).catch(function () {});
      } else if (act === 'bulk-mcp-selected') {
        var genFnSel = typeof pickGeneratorForRequests === 'function' ? pickGeneratorForRequests() : generateMcpToolsFromRecords;
        var tlsSel = genFnSel(selectedRecsInner());
        for (var z = 0; z < tlsSel.length; z++) {
          state.mcpTools[tlsSel[z].name] = tlsSel[z];
        }
        saveMcpTools();
        chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
        showToast('\u751F\u6210 ' + tlsSel.length + ' \u4E2A MCP \u5DE5\u5177');
      }
      refreshRequestList(undefined, false);
    });
  }
}

function appendRequestRowToList(listElInner, req, kwEffective) {
  var itemInner = document.createElement('div');
  itemInner.className = 'ai-req-request-item';
  itemInner.setAttribute('data-id', req.id);

  var rowWrap = document.createElement('div');
  rowWrap.className = 'ai-req-request-row-wrap';

  var cbCell = document.createElement('label');
  cbCell.className = 'ai-req-req-checkbox-cell';
  var cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'ai-req-req-select-cb';
  cb.checked = !!state.selectedReqIds[req.id];
  cb.addEventListener('click', function (e2) {
    e2.stopPropagation();
  });
  cb.addEventListener('change', function () {
    if (cb.checked) state.selectedReqIds[req.id] = true;
    else delete state.selectedReqIds[req.id];
    refreshRequestList(kwEffective, true);
  });
  cbCell.appendChild(cb);

  var rowInner = document.createElement('div');
  rowInner.className = 'ai-req-request-row';

  var methodTag2 = document.createElement('span');
  methodTag2.className = 'ai-req-method-tag ai-req-method-' + getMethodClass(req.method);
  methodTag2.textContent = req.method;

  var urlText2 = document.createElement('span');
  urlText2.className = 'ai-req-url-text';
  urlText2.textContent = truncateURL(req.url, 60);
  urlText2.title = req.url;

  var statusCode2 = document.createElement('span');
  statusCode2.className = 'ai-req-status-code ' + getStatusClass(req.responseStatus);
  statusCode2.textContent = req.responseStatus;

  var duration2 = document.createElement('span');
  duration2.className = 'ai-req-duration';
  duration2.textContent = req.duration + 'ms';

  var aiIcon2 = document.createElement('span');
  aiIcon2.className = 'ai-req-icon-indicator ' + (req.aiAnalysis ? 'ai-req-ai-analyzed' : 'ai-req-ai-not-analyzed');
  aiIcon2.textContent = req.aiAnalysis ? '\u2713' : '\u25CB';
  aiIcon2.title = req.aiAnalysis ? '\u5DF2AI\u5206\u6790' : '\u672AAI\u5206\u6790';

  var mockShown = recordShowsMocked(req);
  var mockIcon2 = document.createElement('span');
  mockIcon2.className = 'ai-req-icon-indicator ' + (mockShown ? 'ai-req-mock-active' : 'ai-req-mock-inactive');
  mockIcon2.textContent = mockShown ? '\u25CF' : '\u25CB';
  mockIcon2.title = mockShown ? '\u5DF2Mock' : '\u672AMock';

  var activeRule2 = req.debugRule || findDebugRule(req.originalUrl || req.url, req.method);
  var tags2 = buildDebugTagElement(activeRule2);

  rowInner.appendChild(methodTag2);
  rowInner.appendChild(urlText2);
  rowInner.appendChild(statusCode2);
  rowInner.appendChild(duration2);
  rowInner.appendChild(aiIcon2);
  rowInner.appendChild(mockIcon2);
  if (tags2) rowInner.appendChild(tags2);

  rowInner.addEventListener('click', function () {
    if (state.expandedReqId === req.id) {
      state.expandedReqId = null;
    } else {
      state.expandedReqId = req.id;
    }
    refreshRequestList(kwEffective, true);
  });

  rowWrap.appendChild(cbCell);
  rowWrap.appendChild(rowInner);
  itemInner.appendChild(rowWrap);

  if (state.expandedReqId === req.id) {
    var detail2 = document.createElement('div');
    detail2.className = 'ai-req-request-detail';
    detail2.innerHTML = buildDetailHTML(req);
    itemInner.appendChild(detail2);
    bindDetailEvents(detail2, req, kwEffective);
  }

  listElInner.appendChild(itemInner);
}

function refreshRequestList(keyword, skipPruneSel) {
  if (!state.mainPanel) return;
  var kwEffective = typeof keyword === 'undefined' ? getActiveListKeyword() : keyword;

  var listEl = state.mainPanel.querySelector('.ai-req-request-list');
  var countEl = state.mainPanel.querySelector('.ai-req-req-count');
  listEl.innerHTML = '';

  var filtered = filterRequestRecords(state.requestRecords, kwEffective);
  if (!skipPruneSel) {
    pruneSelectedReqIdsToMatchRecords(filtered);
  }

  var bulkBarOuter = state.mainPanel.querySelector('.ai-req-req-bulk-bar');
  if (bulkBarOuter) {
    var bn = selectionCountRequests();
    bulkBarOuter.style.display = bn > 0 ? 'flex' : 'none';
    var spn = bulkBarOuter.querySelector('.ai-req-req-bulk-count');
    if (spn) spn.textContent = '\u5DF2\u9009 ' + bn;
  }

  countEl.textContent = filtered.length + ' \u8BF7\u6C42';

  if (filtered.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'ai-req-empty-state';
    var lf0 = state.listFilters || {};
    var hasExtras = !!(kwEffective || lf0.dupOnly || lf0.mock !== 'all' || lf0.analyzed !== 'all');
    empty.textContent = hasExtras ?
      '\u6CA1\u6709\u5339\u914D\u7684\u8BF7\u6C42' :
      '\u6682\u65E0\u8BF7\u6C42\u8BB0\u5F55';
    listEl.appendChild(empty);
    return;
  }

  var selectStrip = document.createElement('div');
  selectStrip.className = 'ai-req-select-all-strip';
  var cbAllLbl = document.createElement('label');
  cbAllLbl.className = 'ai-req-select-all-label';
  var cbAll = document.createElement('input');
  cbAll.type = 'checkbox';
  cbAll.className = 'ai-req-req-select-all-cb';
  cbAll.checked = (function selAllCHK(arr) {
    for (var h = 0; h < arr.length; h++) {
      if (!state.selectedReqIds[arr[h].id]) return false;
    }
    return true;
  })(filtered);
  cbAll.addEventListener('change', function () {
    setAllRecordsSelection(filtered, cbAll.checked);
    refreshRequestList(kwEffective, true);
  });
  cbAllLbl.appendChild(cbAll);
  cbAllLbl.appendChild(document.createTextNode(' \u5168\u9009\u5F53\u524D'));
  selectStrip.appendChild(cbAllLbl);
  listEl.appendChild(selectStrip);

  var grp = groupRecordsSorted(filtered, state.listFilters.groupMode || 'none');

  function renderSubset(arrSubs) {
    var revSubs = arrSubs.slice().reverse();
    for (var rs = 0; rs < revSubs.length; rs++) {
      appendRequestRowToList(listEl, revSubs[rs], kwEffective);
    }
  }

  if (grp.useFlat) {
    renderSubset(filtered);
  } else {
    for (var gi = 0; gi < grp.keys.length; gi++) {
      var gnk = grp.keys[gi];
      var headEl = document.createElement('div');
      headEl.className = 'ai-req-group-header';
      headEl.textContent = gnk + ' \uFF08' + grp.map[gnk].length + '\u6761\uFF09';
      listEl.appendChild(headEl);
      renderSubset(grp.map[gnk]);
    }
  }
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
    html += '<button class="ai-req-btn ai-req-detail-btn ai-req-mcp-gen-btn" data-req-id="' + req.id + '">\uD83D\uDD27 \u751F\u6210MCP\u5DE5\u5177</button>';
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

  var mcpGenBtn = detailEl.querySelector('.ai-req-mcp-gen-btn');
  if (mcpGenBtn) {
    mcpGenBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var mReqId = this.getAttribute('data-req-id');
      var mReq = null;
      for (var mi = 0; mi < state.requestRecords.length; mi++) {
        if (state.requestRecords[mi].id === mReqId) {
          mReq = state.requestRecords[mi];
          break;
        }
      }
      if (!mReq) return;
      var mTool = generateMcpToolFromRecord(mReq);
      state.mcpTools[mTool.name] = mTool;
      saveMcpTools();
      chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
      showToast('MCP \u5DE5\u5177\u5DF2\u751F\u6210: ' + mTool.name);
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
  bindDetailEvents(detailEl, req, getActiveListKeyword());
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
  panel.querySelector('.ai-req-config-mcp-port').value = state.config.mcpPort || 9527;
  panel.querySelector('.ai-req-config-mcp-token').value = state.config.mcpToken || '';
  panel.querySelector('.ai-req-config-mcp-auto-sync').checked = !!state.config.mcpAutoSync;
  var namingEl = panel.querySelector('.ai-req-config-mcp-tool-naming');
  if (namingEl) namingEl.value = state.config.mcpToolNaming === 'compact' ? 'compact' : 'full';

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

  var mcpDivider = document.createElement('div');
  mcpDivider.className = 'ai-req-config-divider';
  mcpDivider.textContent = 'MCP Server \u914D\u7F6E';

  var mcpPortField = document.createElement('div');
  mcpPortField.className = 'ai-req-config-field';
  mcpPortField.innerHTML = '<label class="ai-req-config-label">MCP \u7AEF\u53E3</label><input type="number" class="ai-req-config-input ai-req-config-mcp-port" placeholder="9527" min="1" max="65535">';

  var mcpTokenField = document.createElement('div');
  mcpTokenField.className = 'ai-req-config-field';
  mcpTokenField.innerHTML = '<label class="ai-req-config-label">\u9274\u6743 Token</label><input type="password" class="ai-req-config-input ai-req-config-mcp-token" placeholder="\u53EF\u9009\uFF0C\u7528\u4E8E MCP \u8FDE\u63A5\u9274\u6743">';

  var mcpNamingField = document.createElement('div');
  mcpNamingField.className = 'ai-req-config-field';
  mcpNamingField.innerHTML = '<label class="ai-req-config-label">MCP \u5DE5\u5177\u547D\u540D</label><select class="ai-req-config-input ai-req-config-mcp-tool-naming"><option value="full">\u5B8C\u6574\u8DEF\u5F84\uFF08\u9ED8\u8BA4\uFF09</option><option value="compact">\u7D27\u51D8\uFF08\u672B\u6BB5+\u54C8\u5E0C\uFF09</option></select>';

  var mcpAutoSyncField = document.createElement('div');
  mcpAutoSyncField.className = 'ai-req-config-field';
  mcpAutoSyncField.innerHTML = '<label class="ai-req-config-label">\u81EA\u52A8\u540C\u6B65</label><label class="ai-req-config-checkbox-label"><input type="checkbox" class="ai-req-config-mcp-auto-sync"> \u542F\u52A8\u65F6\u81EA\u52A8\u540C\u6B65\u5DE5\u5177\u5217\u8868</label>';

  var actions = document.createElement('div');
  actions.className = 'ai-req-config-actions';

  var saveBtn = document.createElement('button');
  saveBtn.className = 'ai-req-btn ai-req-btn-primary';
  saveBtn.textContent = '\u4FDD\u5B58';
  saveBtn.addEventListener('click', function () {
    state.config.apiKey = modal.querySelector('.ai-req-config-apikey').value.trim();
    state.config.baseURL = modal.querySelector('.ai-req-config-baseurl').value.trim();
    state.config.model = modal.querySelector('.ai-req-config-model').value.trim();
    var mcpPortVal = parseInt(modal.querySelector('.ai-req-config-mcp-port').value, 10);
    state.config.mcpPort = (mcpPortVal > 0 && mcpPortVal <= 65535) ? mcpPortVal : 9527;
    state.config.mcpToken = modal.querySelector('.ai-req-config-mcp-token').value.trim();
    state.config.mcpAutoSync = modal.querySelector('.ai-req-config-mcp-auto-sync').checked;
    var namingSel = modal.querySelector('.ai-req-config-mcp-tool-naming');
    state.config.mcpToolNaming = (namingSel && namingSel.value === 'compact') ? 'compact' : 'full';
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
  modal.appendChild(mcpDivider);
  modal.appendChild(mcpPortField);
  modal.appendChild(mcpTokenField);
  modal.appendChild(mcpNamingField);
  modal.appendChild(mcpAutoSyncField);
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