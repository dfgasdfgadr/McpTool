function refreshMainPanelContent() {
  var bodyEl = state.mainPanel.querySelector('.ai-req-main-body');
  if (!bodyEl) return;

  if (state.mcpPanelTab === 'list' || state.mcpPanelTab === 'logs') {
    var reqList = bodyEl.querySelector('.ai-req-request-list');
    if (reqList) reqList.style.display = 'none';
    var oldMcp = bodyEl.querySelector('.ai-req-mcp-content');
    if (oldMcp) oldMcp.remove();
    var mcpContent = document.createElement('div');
    mcpContent.className = 'ai-req-mcp-content';
    if (state.mcpPanelTab === 'list') {
      mcpContent.innerHTML = buildMcpToolListHTML();
    } else {
      mcpContent.innerHTML = buildMcpLogListHTML();
    }
    bodyEl.appendChild(mcpContent);
    bindMcpContentEvents(mcpContent);
  } else {
    var reqList2 = bodyEl.querySelector('.ai-req-request-list');
    if (reqList2) reqList2.style.display = '';
    var mcpContent2 = bodyEl.querySelector('.ai-req-mcp-content');
    if (mcpContent2) mcpContent2.remove();
  }
}

function buildMcpToolListHTML() {
  var html = '';
  html += '<div class="ai-req-mcp-status-bar">';
  html += '<span class="ai-req-mcp-status-dot ai-req-mcp-status-dot-off"></span>';
  html += '<span class="ai-req-mcp-status-text">MCP \u25CB \u672A\u542F\u52A8</span>';
  html += '<button class="ai-req-mcp-start-btn">\u542F\u52A8</button>';
  html += '</div>';
  html += '<div class="ai-req-mcp-tool-list">';
  var toolNames = Object.keys(state.mcpTools || {});
  if (toolNames.length === 0) {
    html += '<div class="ai-req-mcp-empty">\u6682\u65E0 MCP \u5DE5\u5177\uFF0C\u8BF7\u4ECE\u8BF7\u6C42\u5217\u8868\u751F\u6210</div>';
  }
  for (var i = 0; i < toolNames.length; i++) {
    var name = toolNames[i];
    var tool = state.mcpTools[name];
    var riskLevel = (tool._meta && tool._meta.riskLevel) || 'low';
    var enabled = tool.enabled !== false;
    var desc = tool.description || '';
    html += '<div class="ai-req-mcp-tool-item" data-tool-name="' + escapeHtml(name) + '">';
    html += '<div class="ai-req-mcp-tool-header">';
    html += '<span class="ai-req-mcp-tool-name">' + escapeHtml(name) + '</span>';
    html += '<span class="ai-req-mcp-risk ai-req-mcp-risk-' + escapeHtml(riskLevel) + '">' + escapeHtml(riskLevel) + '</span>';
    html += '<label class="ai-req-mcp-toggle"><input type="checkbox" class="ai-req-mcp-tool-enabled" data-tool-name="' + escapeHtml(name) + '"' + (enabled ? ' checked' : '') + '></label>';
    html += '</div>';
    html += '<div class="ai-req-mcp-tool-desc">' + escapeHtml(desc) + '</div>';
    html += '<div class="ai-req-mcp-tool-actions">';
    html += '<button class="ai-req-mcp-tool-edit-btn" data-tool-name="' + escapeHtml(name) + '">\u7F16\u8F91</button>';
    html += '<button class="ai-req-mcp-tool-test-btn" data-tool-name="' + escapeHtml(name) + '">\u6D4B\u8BD5</button>';
    html += '<button class="ai-req-mcp-tool-delete-btn" data-tool-name="' + escapeHtml(name) + '">\u5220\u9664</button>';
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="ai-req-mcp-tab-bar">';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'list' ? ' active' : '') + '" data-mcp-tab="list">\u5DE5\u5177\u5217\u8868</button>';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'logs' ? ' active' : '') + '" data-mcp-tab="logs">\u8C03\u7528\u65E5\u5FD7</button>';
  html += '</div>';
  return html;
}

function buildMcpLogListHTML() {
  var html = '';
  html += '<div class="ai-req-mcp-status-bar">';
  html += '<span class="ai-req-mcp-status-dot ai-req-mcp-status-dot-off"></span>';
  html += '<span class="ai-req-mcp-status-text">MCP \u25CB \u672A\u542F\u52A8</span>';
  html += '<button class="ai-req-mcp-start-btn">\u542F\u52A8</button>';
  html += '</div>';
  html += '<div class="ai-req-mcp-log-list">';
  html += '<div class="ai-req-mcp-log-loading">\u52A0\u8F7D\u4E2D...</div>';
  html += '</div>';
  html += '<div class="ai-req-mcp-tab-bar">';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'list' ? ' active' : '') + '" data-mcp-tab="list">\u5DE5\u5177\u5217\u8868</button>';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'logs' ? ' active' : '') + '" data-mcp-tab="logs">\u8C03\u7528\u65E5\u5FD7</button>';
  html += '</div>';
  return html;
}

function bindMcpContentEvents(mcpContent) {
  refreshMcpStatusBar(mcpContent);

  var startBtn = mcpContent.querySelector('.ai-req-mcp-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', function () {
      var btn = startBtn;
      if (btn.textContent === '\u542F\u52A8') {
        chrome.runtime.sendMessage({ type: 'MCP_START_HELPER', payload: { mcpPort: state.config.mcpPort || 9527 } }, function (resp) {
          if (resp && resp.ok) {
            setTimeout(function () { refreshMcpStatusBar(mcpContent); }, 500);
          } else {
            showToast('MCP \u542F\u52A8\u5931\u8D25');
          }
        });
      } else {
        chrome.runtime.sendMessage({ type: 'MCP_STOP_HELPER' }, function () {
          setTimeout(function () { refreshMcpStatusBar(mcpContent); }, 300);
        });
      }
    });
  }

  var tabs = mcpContent.querySelectorAll('.ai-req-mcp-tab');
  for (var ti = 0; ti < tabs.length; ti++) {
    tabs[ti].addEventListener('click', function () {
      var tab = this;
      var tabName = tab.getAttribute('data-mcp-tab');
      state.mcpPanelTab = tabName;
      refreshMainPanelContent();
    });
  }

  var enabledChecks = mcpContent.querySelectorAll('.ai-req-mcp-tool-enabled');
  for (var ei = 0; ei < enabledChecks.length; ei++) {
    enabledChecks[ei].addEventListener('change', function () {
      var tName = this.getAttribute('data-tool-name');
      if (state.mcpTools[tName]) {
        state.mcpTools[tName].enabled = this.checked;
        saveMcpTools();
        chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
      }
    });
  }

  var editBtns = mcpContent.querySelectorAll('.ai-req-mcp-tool-edit-btn');
  for (var ebi = 0; ebi < editBtns.length; ebi++) {
    editBtns[ebi].addEventListener('click', function () {
      openMcpToolEditor(this.getAttribute('data-tool-name'));
    });
  }

  var testBtns = mcpContent.querySelectorAll('.ai-req-mcp-tool-test-btn');
  for (var tbi = 0; tbi < testBtns.length; tbi++) {
    testBtns[tbi].addEventListener('click', function () {
      openMcpToolTester(this.getAttribute('data-tool-name'));
    });
  }

  var deleteBtns = mcpContent.querySelectorAll('.ai-req-mcp-tool-delete-btn');
  for (var di = 0; di < deleteBtns.length; di++) {
    deleteBtns[di].addEventListener('click', function () {
      var dName = this.getAttribute('data-tool-name');
      if (confirm('\u786E\u5B9A\u5220\u9664\u5DE5\u5177 "' + dName + '"\uFF1F')) {
        deleteMcpTool(dName);
        chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
        refreshMainPanelContent();
        showToast('\u5DF2\u5220\u9664: ' + dName);
      }
    });
  }

  if (state.mcpPanelTab === 'logs') {
    chrome.runtime.sendMessage({ type: 'MCP_GET_CALL_LOGS' }, function (resp) {
      var logs = (resp && resp.logs) || [];
      var logListEl = mcpContent.querySelector('.ai-req-mcp-log-list');
      if (!logListEl) return;
      logListEl.innerHTML = '';
      if (logs.length === 0) {
        logListEl.innerHTML = '<div class="ai-req-mcp-empty">\u6682\u65E0\u8C03\u7528\u65E5\u5FD7</div>';
        return;
      }
      for (var li = logs.length - 1; li >= 0; li--) {
        var log = logs[li];
        var date = new Date(log.timestamp || Date.now());
        var timeStr = pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
        var logItem = document.createElement('div');
        logItem.className = 'ai-req-mcp-log-item';
        var timeSpan = document.createElement('span');
        timeSpan.className = 'ai-req-mcp-log-time';
        timeSpan.textContent = timeStr;
        var toolSpan = document.createElement('span');
        toolSpan.className = 'ai-req-mcp-log-tool';
        toolSpan.textContent = log.toolName || '';
        var statusSpan = document.createElement('span');
        statusSpan.className = 'ai-req-mcp-log-status';
        statusSpan.textContent = String(log.status || 0);
        var durSpan = document.createElement('span');
        durSpan.className = 'ai-req-mcp-log-duration';
        durSpan.textContent = (log.duration || 0) + 'ms';
        var errSpan = document.createElement('span');
        errSpan.className = 'ai-req-mcp-log-error';
        errSpan.textContent = log.error || '';
        logItem.appendChild(timeSpan);
        logItem.appendChild(toolSpan);
        logItem.appendChild(statusSpan);
        logItem.appendChild(durSpan);
        if (log.error) logItem.appendChild(errSpan);
        (function (logEntry) {
          logItem.addEventListener('click', function () {
            var expanded = logItem.querySelector('.ai-req-mcp-log-detail');
            if (expanded) {
              expanded.remove();
              return;
            }
            var detail = document.createElement('div');
            detail.className = 'ai-req-mcp-log-detail';
            var argsDiv = document.createElement('div');
            argsDiv.className = 'ai-req-mcp-log-detail-section';
            argsDiv.innerHTML = '<div class="ai-req-mcp-log-detail-label">\u8BF7\u6C42\u53C2\u6570</div>';
            var argsPre = document.createElement('pre');
            argsPre.className = 'ai-req-mcp-log-detail-code';
            try {
              argsPre.textContent = JSON.stringify(JSON.parse(logEntry.argsSummary || '{}'), null, 2);
            } catch (e) {
              argsPre.textContent = logEntry.argsSummary || '';
            }
            argsDiv.appendChild(argsPre);
            detail.appendChild(argsDiv);
            var modeDiv = document.createElement('div');
            modeDiv.className = 'ai-req-mcp-log-detail-section';
            modeDiv.innerHTML = '<div class="ai-req-mcp-log-detail-label">\u4EE3\u7406\u6A21\u5F0F</div><div>' + escapeHtml(logEntry.proxyMode || '') + '</div>';
            detail.appendChild(modeDiv);
            logItem.appendChild(detail);
          });
        })(log);
        logListEl.appendChild(logItem);
      }
    });
  }
}

function refreshMcpStatusBar(mcpContent) {
  var dotEl = mcpContent.querySelector('.ai-req-mcp-status-dot');
  var textEl = mcpContent.querySelector('.ai-req-mcp-status-text');
  var btnEl = mcpContent.querySelector('.ai-req-mcp-start-btn');
  if (!dotEl || !textEl || !btnEl) return;

  chrome.runtime.sendMessage({ type: 'MCP_GET_STATUS' }, function (resp) {
    if (resp && resp.helperConnected) {
      dotEl.className = 'ai-req-mcp-status-dot ai-req-mcp-status-dot-on';
      textEl.textContent = 'MCP \u25CF \u5DF2\u542F\u52A8 ws://localhost:' + (resp.serverPort || 9527);
      btnEl.textContent = '\u505C\u6B62';
      btnEl.className = 'ai-req-mcp-start-btn ai-req-mcp-stop-btn';
    } else {
      dotEl.className = 'ai-req-mcp-status-dot ai-req-mcp-status-dot-off';
      textEl.textContent = 'MCP \u25CB \u672A\u542F\u52A8';
      btnEl.textContent = '\u542F\u52A8';
      btnEl.className = 'ai-req-mcp-start-btn';
    }
  });
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function openMcpToolEditor(toolName) {
  var tool = state.mcpTools[toolName];
  if (!tool) return;

  var overlay = document.createElement('div');
  overlay.className = 'ai-req-mcp-editor-overlay';

  var modal = document.createElement('div');
  modal.className = 'ai-req-mcp-editor-modal';

  var titleEl = document.createElement('div');
  titleEl.className = 'ai-req-mcp-editor-title';
  titleEl.textContent = '\u7F16\u8F91 MCP \u5DE5\u5177';

  var body = document.createElement('div');
  body.className = 'ai-req-mcp-editor-body';

  var nameField = document.createElement('div');
  nameField.className = 'ai-req-mcp-editor-field';
  nameField.innerHTML = '<label class="ai-req-mcp-editor-label">\u540D\u79F0</label><input type="text" class="ai-req-mcp-editor-input ai-req-mcp-editor-name" value="' + escapeHtml(tool.name || toolName) + '">';

  var descField = document.createElement('div');
  descField.className = 'ai-req-mcp-editor-field';
  descField.innerHTML = '<label class="ai-req-mcp-editor-label">\u63CF\u8FF0</label><textarea class="ai-req-mcp-editor-textarea ai-req-mcp-editor-desc">' + escapeHtml(tool.description || '') + '</textarea>';

  var enabledField = document.createElement('div');
  enabledField.className = 'ai-req-mcp-editor-field';
  enabledField.innerHTML = '<label class="ai-req-mcp-editor-label">\u542F\u7528\u72B6\u6001</label><input type="checkbox" class="ai-req-mcp-editor-enabled"' + (tool.enabled !== false ? ' checked' : '') + '>';

  body.appendChild(nameField);
  body.appendChild(descField);
  body.appendChild(enabledField);

  var props = (tool.inputSchema && tool.inputSchema.properties) || {};
  var required = (tool.inputSchema && tool.inputSchema.required) || [];
  var propKeys = Object.keys(props);
  if (propKeys.length > 0) {
    var propSection = document.createElement('div');
    propSection.className = 'ai-req-mcp-editor-section';
    var propTitle = document.createElement('div');
    propTitle.className = 'ai-req-mcp-editor-section-title';
    propTitle.textContent = '\u53C2\u6570\u63CF\u8FF0';
    propSection.appendChild(propTitle);

    for (var pi = 0; pi < propKeys.length; pi++) {
      var pName = propKeys[pi];
      var pDef = props[pName];
      var pDesc = pDef.description || '';
      var pType = pDef.type || 'string';
      var isReq = required.indexOf(pName) !== -1;
      var pField = document.createElement('div');
      pField.className = 'ai-req-mcp-editor-field';
      var pHtml = '<label class="ai-req-mcp-editor-label">' + escapeHtml(pName) + ' <span class="ai-req-mcp-editor-type">(' + escapeHtml(pType) + ')</span></label>';
      pHtml += '<input type="text" class="ai-req-mcp-editor-input ai-req-mcp-editor-prop-desc" data-prop-name="' + escapeHtml(pName) + '" value="' + escapeHtml(pDesc) + '" placeholder="\u53C2\u6570\u63CF\u8FF0">';
      pHtml += '<label class="ai-req-mcp-editor-required-label"><input type="checkbox" class="ai-req-mcp-editor-prop-required" data-prop-name="' + escapeHtml(pName) + '"' + (isReq ? ' checked' : '') + '> Required</label>';
      pField.innerHTML = pHtml;
      propSection.appendChild(pField);
    }
    body.appendChild(propSection);
  }

  var actions = document.createElement('div');
  actions.className = 'ai-req-mcp-editor-actions';

  var saveBtn = document.createElement('button');
  saveBtn.className = 'ai-req-btn ai-req-btn-primary';
  saveBtn.textContent = '\u4FDD\u5B58';
  saveBtn.addEventListener('click', function () {
    var newName = modal.querySelector('.ai-req-mcp-editor-name').value.trim();
    var newDesc = modal.querySelector('.ai-req-mcp-editor-desc').value.trim();
    var newEnabled = modal.querySelector('.ai-req-mcp-editor-enabled').checked;

    tool.description = newDesc;
    tool.enabled = newEnabled;

    if (newName && newName !== toolName) {
      delete state.mcpTools[toolName];
      tool.name = newName;
      state.mcpTools[newName] = tool;
    }

    var propDescInputs = modal.querySelectorAll('.ai-req-mcp-editor-prop-desc');
    for (var pdi = 0; pdi < propDescInputs.length; pdi++) {
      var pn = propDescInputs[pdi].getAttribute('data-prop-name');
      var pdVal = propDescInputs[pdi].value.trim();
      if (tool.inputSchema && tool.inputSchema.properties && tool.inputSchema.properties[pn]) {
        if (pdVal) {
          tool.inputSchema.properties[pn].description = pdVal;
        } else {
          delete tool.inputSchema.properties[pn].description;
        }
      }
    }

    var reqChecks = modal.querySelectorAll('.ai-req-mcp-editor-prop-required');
    var newRequired = [];
    for (var ri = 0; ri < reqChecks.length; ri++) {
      if (reqChecks[ri].checked) {
        newRequired.push(reqChecks[ri].getAttribute('data-prop-name'));
      }
    }
    if (tool.inputSchema) {
      tool.inputSchema.required = newRequired;
    }

    saveMcpTools();
    chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
    overlay.remove();
    refreshMainPanelContent();
    showToast('MCP \u5DE5\u5177\u5DF2\u4FDD\u5B58');
  });

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'ai-req-btn ai-req-btn-secondary';
  cancelBtn.textContent = '\u53D6\u6D88';
  cancelBtn.addEventListener('click', function () {
    overlay.remove();
  });

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);

  modal.appendChild(titleEl);
  modal.appendChild(body);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.remove();
  });

  safeAppendChild(overlay);
}

function openMcpToolTester(toolName) {
  var tool = state.mcpTools[toolName];
  if (!tool) return;

  var overlay = document.createElement('div');
  overlay.className = 'ai-req-mcp-editor-overlay';

  var modal = document.createElement('div');
  modal.className = 'ai-req-mcp-editor-modal ai-req-mcp-tester-modal';

  var titleEl = document.createElement('div');
  titleEl.className = 'ai-req-mcp-editor-title';
  titleEl.textContent = '\u6D4B\u8BD5 MCP \u5DE5\u5177: ' + toolName;

  var body = document.createElement('div');
  body.className = 'ai-req-mcp-editor-body';

  var props = (tool.inputSchema && tool.inputSchema.properties) || {};
  var required = (tool.inputSchema && tool.inputSchema.required) || [];
  var propKeys = Object.keys(props);

  if (propKeys.length === 0) {
    var noParam = document.createElement('div');
    noParam.className = 'ai-req-mcp-empty';
    noParam.textContent = '\u8BE5\u5DE5\u5177\u65E0\u53C2\u6570';
    body.appendChild(noParam);
  }

  for (var pi = 0; pi < propKeys.length; pi++) {
    var pName = propKeys[pi];
    var pDef = props[pName];
    var pType = pDef.type || 'string';
    var pDesc = pDef.description || '';
    var isReq = required.indexOf(pName) !== -1;

    var pField = document.createElement('div');
    pField.className = 'ai-req-mcp-editor-field';

    var label = document.createElement('label');
    label.className = 'ai-req-mcp-editor-label';
    label.textContent = pName + ' (' + pType + ')' + (isReq ? ' *' : '');

    var input;
    if (pType === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'ai-req-mcp-tester-input ai-req-mcp-tester-param';
    } else if (pType === 'number' || pType === 'integer') {
      input = document.createElement('input');
      input.type = 'number';
      input.className = 'ai-req-mcp-editor-input ai-req-mcp-tester-param';
    } else if (pType === 'object' || pType === 'array') {
      input = document.createElement('textarea');
      input.className = 'ai-req-mcp-editor-textarea ai-req-mcp-tester-param';
      input.placeholder = '\u8F93\u5165 JSON ' + pType;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'ai-req-mcp-editor-input ai-req-mcp-tester-param';
      if (pDef.enum && pDef.enum.length > 0) {
        input.placeholder = '\u53EF\u9009\u503C: ' + pDef.enum.join(', ');
      }
    }
    input.setAttribute('data-param-name', pName);
    input.setAttribute('data-param-type', pType);

    if (pDesc) {
      var descHint = document.createElement('div');
      descHint.className = 'ai-req-mcp-editor-hint';
      descHint.textContent = pDesc;
      pField.appendChild(label);
      pField.appendChild(descHint);
    } else {
      pField.appendChild(label);
    }
    pField.appendChild(input);
    body.appendChild(pField);
  }

  var resultArea = document.createElement('div');
  resultArea.className = 'ai-req-mcp-tester-result';
  resultArea.style.display = 'none';

  var actions = document.createElement('div');
  actions.className = 'ai-req-mcp-editor-actions';

  var execBtn = document.createElement('button');
  execBtn.className = 'ai-req-btn ai-req-btn-primary';
  execBtn.textContent = '\u6267\u884C';
  execBtn.addEventListener('click', function () {
    var args = {};
    var paramInputs = modal.querySelectorAll('.ai-req-mcp-tester-param');
    for (var ai = 0; ai < paramInputs.length; ai++) {
      var pInput = paramInputs[ai];
      var pN = pInput.getAttribute('data-param-name');
      var pT = pInput.getAttribute('data-param-type');
      var val;
      if (pT === 'boolean') {
        val = pInput.checked;
      } else if (pT === 'number' || pT === 'integer') {
        val = pInput.value.trim() !== '' ? Number(pInput.value) : undefined;
      } else if (pT === 'object' || pT === 'array') {
        var rawText = pInput.value.trim();
        if (rawText) {
          try {
            val = JSON.parse(rawText);
          } catch (e) {
            resultArea.style.display = 'block';
            resultArea.innerHTML = '<div class="ai-req-mcp-tester-error">\u53C2\u6570 ' + escapeHtml(pN) + ' JSON \u89E3\u6790\u5931\u8D25: ' + escapeHtml(e.message) + '</div>';
            return;
          }
        }
      } else {
        val = pInput.value;
      }
      if (val !== undefined) args[pN] = val;
    }

    execBtn.disabled = true;
    execBtn.textContent = '\u6267\u884C\u4E2D...';

    chrome.runtime.sendMessage({ type: 'MCP_TOOL_TEST', toolName: toolName, arguments: args }, function (resp) {
      execBtn.disabled = false;
      execBtn.textContent = '\u6267\u884C';
      resultArea.style.display = 'block';
      if (resp && resp.ok) {
        var statusClass = resp.status >= 200 && resp.status < 300 ? 'ai-req-mcp-tester-success' : 'ai-req-mcp-tester-warn';
        resultArea.innerHTML = '<div class="ai-req-mcp-tester-status ' + statusClass + '">\u72B6\u6001\u7801: ' + (resp.status || 0) + '</div>';
        var resultPre = document.createElement('pre');
        resultPre.className = 'ai-req-mcp-tester-body';
        try {
          resultPre.textContent = JSON.stringify(resp.body, null, 2);
        } catch (e2) {
          resultPre.textContent = String(resp.body);
        }
        resultArea.appendChild(resultPre);
      } else {
        resultArea.innerHTML = '<div class="ai-req-mcp-tester-error">\u8BF7\u6C42\u5931\u8D25: ' + escapeHtml((resp && resp.error) || '\u672A\u77E5\u9519\u8BEF') + '</div>';
      }
    });
  });

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'ai-req-btn ai-req-btn-secondary';
  cancelBtn.textContent = '\u5173\u95ED';
  cancelBtn.addEventListener('click', function () {
    overlay.remove();
  });

  actions.appendChild(execBtn);
  actions.appendChild(cancelBtn);

  modal.appendChild(titleEl);
  modal.appendChild(body);
  modal.appendChild(resultArea);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.remove();
  });

  safeAppendChild(overlay);
}