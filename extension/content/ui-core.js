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
  var mcpGenAllBtn = document.createElement('button');
  mcpGenAllBtn.className = 'ai-req-action-btn ai-req-mcp-gen-all-btn';
  mcpGenAllBtn.textContent = '\uD83D\uDD17 一键生成MCP工具';
  mcpGenAllBtn.addEventListener('click', function () {
    var tools = generateMcpToolsFromRecords(state.requestRecords);
    for (var key in tools) {
      if (tools.hasOwnProperty(key)) {
        var t = tools[key];
        state.mcpTools[t.name] = t;
      }
    }
    saveMcpTools();
    chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
    showToast('\u5DF2\u751F\u6210 ' + tools.length + ' \u4E2A MCP \u5DE5\u5177');
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
  actionBar.appendChild(mcpGenAllBtn);
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
  panel.appendChild(actionBar);
  panel.appendChild(progressBar);
  panel.appendChild(mainBody);
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
  panel.querySelector('.ai-req-config-mcp-port').value = state.config.mcpPort || 9527;
  panel.querySelector('.ai-req-config-mcp-token').value = state.config.mcpToken || '';
  panel.querySelector('.ai-req-config-mcp-auto-sync').checked = !!state.config.mcpAutoSync;

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