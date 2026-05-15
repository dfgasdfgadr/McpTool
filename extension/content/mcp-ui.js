/** \u7AD9\u70B9\u4E13\u7528\u503C\uFF1A\u5217\u8868\u4E2D\u6392\u9664\u5F53\u524D\u6807\u7B7E\u9875 hostname \u6765\u6E90\u7684 merged \u5DE5\u5177 */
var MCP_SITE_FILTER_EXCLUDE_CURRENT = '__exclude_current__';

function ensureMcpListUi() {
  if (!state.mcpListUi) {
    state.mcpListUi = {
      keyword: '',
      groupMode: 'none',
      filterEnabled: 'all',
      riskLevels: {},
      toolbarCollapsed: false,
      siteFilter: 'all'
    };
  } else if (!state.mcpListUi.siteFilter) {
    state.mcpListUi.siteFilter = 'all';
  }
}

function getMcpListToolsMap() {
  var ds = state.mcpViewDataset;
  if (!ds) return {};
  if (ds.ok && ds.tools && typeof ds.tools === 'object') return ds.tools;
  if (ds.ok === false) return {};
  return state.mcpTools || {};
}

function resolveMcpToolHostFromView(toolName) {
  var ds = state.mcpViewDataset;
  if (ds && ds.hostByTool && ds.hostByTool[toolName]) return ds.hostByTool[toolName];
  return location.hostname;
}

function mcpSafeFilenameSegment(seg) {
  return String(seg || 'host').replace(/[^a-zA-Z0-9._-]+/g, '_').substring(0, 120);
}

function passesMcpListFilters(tool, ui) {
  if (ui.filterEnabled === 'on' && tool.enabled === false) return false;
  if (ui.filterEnabled === 'off' && tool.enabled !== false) return false;
  var rl = ((tool._meta || {}).riskLevel || 'low').toLowerCase();
  var rf = ui.riskLevels || {};
  var anyRisk = false;
  var rk;
  for (rk in rf) {
    if (rf.hasOwnProperty(rk) && rf[rk]) {
      anyRisk = true;
      break;
    }
  }
  if (anyRisk && !rf[rl]) return false;
  return true;
}

function mcpToolMatchesKeyword(tool, name, kwLower) {
  if (!kwLower) return true;
  var meta = tool._meta || {};
  var hay = (name + '\n' + (tool.description || '') + '\n' + (meta.method || '') + ' ' + (meta.pathname || '')).toLowerCase();
  return hay.indexOf(kwLower) !== -1;
}

function getMcpToolGroupKey(name, tool, groupMode) {
  var meta = tool._meta || {};
  if (groupMode === 'method') return (meta.method || 'GET').toUpperCase();
  if (groupMode === 'risk') return String((meta.riskLevel || 'low')).toLowerCase();
  if (groupMode === 'pathPrefix') {
    var p = meta.pathname || '';
    var seg = p.replace(/^\/+/, '').split('/')[0];
    return seg ? seg : '(root)';
  }
  return '';
}

function getFilteredSortedMcpToolNames() {
  ensureMcpListUi();
  var ui = state.mcpListUi;
  var kwLower = (ui.keyword || '').trim().toLowerCase();
  var toolsMap = getMcpListToolsMap();
  var all = Object.keys(toolsMap || {});
  var pass = [];
  var ii;
  for (ii = 0; ii < all.length; ii++) {
    var nm = all[ii];
    var tl = toolsMap[nm];
    if (!tl) continue;
    if (!passesMcpListFilters(tl, ui)) continue;
    if (!mcpToolMatchesKeyword(tl, nm, kwLower)) continue;
    pass.push(nm);
  }
  pass.sort();
  return pass;
}

function buildMcpToolListInnerHTML() {
  ensureMcpListUi();
  var ui = state.mcpListUi;
  var html = '';
  if (!state.mcpViewDataset) {
    return '<div class="ai-req-mcp-empty">\u6B63\u5728\u52A0\u8F7D\u5DE5\u5177\u5217\u8868...</div>';
  }
  if (!state.mcpViewDataset.ok) {
    return '<div class="ai-req-mcp-empty">\u65E0\u6CD5\u52A0\u8F7D\u5DE5\u5177\u6570\u636E\uFF0C\u8BF7\u5173\u95ED\u518D\u6253\u5F00 MCP \u9762\u677F\u91CD\u8BD5</div>';
  }
  var toolsMap = getMcpListToolsMap();
  var hostByTool = (state.mcpViewDataset && state.mcpViewDataset.hostByTool) || {};
  var sfUi = ui.siteFilter || 'all';
  var showHostChip = sfUi === 'all' || sfUi === MCP_SITE_FILTER_EXCLUDE_CURRENT;
  var toolNames = getFilteredSortedMcpToolNames();
  var gm2 = ui.groupMode || 'none';
  var lastGk = '\u0000';
  if (Object.keys(toolsMap || {}).length === 0) {
    html += '<div class="ai-req-mcp-empty">\u6682\u65E0 MCP \u5DE5\u5177\uFF08\u5F53\u524D\u7B5B\u9009\u8303\u56F4\uFF09\uFF0C\u53EF\u5207\u6362\u300C\u5168\u90E8\u7AD9\u70B9\u300D\u6216\u6362\u7AD9\u70B9\u67E5\u770B</div>';
  } else if (toolNames.length === 0) {
    html += '<div class="ai-req-mcp-empty">\u65E0\u5339\u914D\u9879\uFF0C\u8C03\u6574\u7B5B\u9009\u6216\u5173\u952E\u8BCD</div>';
  }
  var ti;
  for (ti = 0; ti < toolNames.length; ti++) {
    var name = toolNames[ti];
    var tool = toolsMap[name];
    var riskLevel = (tool._meta && tool._meta.riskLevel) || 'low';
    var enabled = tool.enabled !== false;
    var desc = tool.description || '';
    var picked = state.selectedMcpToolNames[name] ? true : false;
    var meta = tool._meta || {};
    var routeLine = ((meta.method || 'GET').toUpperCase() + ' ' + (meta.pathname || '')).trim();
    if (gm2 !== 'none') {
      var gk = getMcpToolGroupKey(name, tool, gm2);
      if (gk !== lastGk) {
        lastGk = gk;
        html += '<div class="ai-req-mcp-group-header"><span class="ai-req-mcp-group-title">' + escapeHtml(gk) + '</span></div>';
      }
    }
    html += '<div class="ai-req-mcp-tool-item" data-tool-name="' + escapeHtml(name) + '">';
    html += '<div class="ai-req-mcp-tool-main">';
    html += '<label class="ai-req-mcp-tool-pick-wrap"><input type="checkbox" class="ai-req-mcp-tool-pick" data-tool-name="' + escapeHtml(name) + '"' + (picked ? ' checked' : '') + '></label>';
    html += '<div class="ai-req-mcp-tool-right">';
    html += '<div class="ai-req-mcp-tool-header">';
    html += '<span class="ai-req-mcp-tool-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>';
    if (showHostChip && hostByTool[name]) {
      html +=
        '<span class="ai-req-mcp-tool-host" title="\u6765\u6E90\u7AD9\u70B9">' +
        escapeHtml(hostByTool[name]) +
        '</span>';
    }
    html += '<span class="ai-req-mcp-risk ai-req-mcp-risk-' + escapeHtml(riskLevel) + '">' + escapeHtml(riskLevel) + '</span>';
    html += '<label class="ai-req-mcp-toggle"><input type="checkbox" class="ai-req-mcp-tool-enabled" data-tool-name="' + escapeHtml(name) + '"' + (enabled ? ' checked' : '') + '></label>';
    html += '</div>';
    html += '<div class="ai-req-mcp-tool-route">' + escapeHtml(routeLine) + '</div>';
    html += '<div class="ai-req-mcp-tool-desc">' + escapeHtml(desc) + '</div>';
    html += '<div class="ai-req-mcp-tool-actions">';
    html += '<button type="button" class="ai-req-mcp-tool-edit-btn" data-tool-name="' + escapeHtml(name) + '">\u7F16\u8F91</button>';
    html += '<button type="button" class="ai-req-mcp-tool-test-btn" data-tool-name="' + escapeHtml(name) + '">\u6D4B\u8BD5</button>';
    html += '<button type="button" class="ai-req-mcp-tool-delete-btn" data-tool-name="' + escapeHtml(name) + '">\u5220\u9664</button>';
    html += '</div>';
    html += '</div></div></div>';
  }
  return html;
}

function patchMcpToolListSection(mcpContent) {
  if (!mcpContent || state.mcpPanelTab !== 'list') return;
  var listEl = mcpContent.querySelector('.ai-req-mcp-tool-list');
  if (!listEl) return;

  ensureMcpListUi();
  var sfReq = state.mcpListUi.siteFilter || 'all';

  chrome.runtime.sendMessage(
    {
      type: 'MCP_GET_TOOLS_VIEW',
      siteFilter: sfReq,
      currentTabHostname: typeof location !== 'undefined' ? location.hostname : ''
    },
    function (resp) {
    if (chrome.runtime.lastError) {
      console.warn('[AI_REQ_ANALYZER] MCP_GET_TOOLS_VIEW:', chrome.runtime.lastError.message);
      state.mcpViewDataset = { ok: false };
    } else {
      state.mcpViewDataset = resp && resp.ok ? resp : { ok: false };
    }

    var siteSel = mcpContent.querySelector('.ai-req-mcp-site-filter');
    var ds = state.mcpViewDataset;
    var hosts = (ds && ds.hosts) || [];

    if (siteSel && ds && ds.ok) {
      var curSf = state.mcpListUi.siteFilter || 'all';
      if (
        curSf !== 'all' &&
        curSf !== MCP_SITE_FILTER_EXCLUDE_CURRENT &&
        hosts.indexOf(curSf) === -1
      ) {
        state.mcpListUi.siteFilter = 'all';
        patchMcpToolListSection(mcpContent);
        return;
      }
      var mergedCnt = typeof ds.mergedToolCount === 'number' ? ds.mergedToolCount : 0;
      var exRemain =
        typeof ds.excludeCurrentRemainCount === 'number' ? ds.excludeCurrentRemainCount : mergedCnt;
      var htc = ds.hostToolCounts || {};
      var tabHost = typeof location !== 'undefined' ? location.hostname : '';
      var opts =
        '<option value="all"' +
        (curSf === 'all' ? ' selected' : '') +
        '>\u5168\u90E8\u7AD9\u70B9\uFF08' +
        mergedCnt +
        '\uFF09\u00B7Cursor\u5408\u5E76</option>';
      opts +=
        '<option value="' +
        MCP_SITE_FILTER_EXCLUDE_CURRENT +
        '"' +
        (curSf === MCP_SITE_FILTER_EXCLUDE_CURRENT ? ' selected' : '') +
        '>\u6392\u9664\u5F53\u524D\u9875\uFF08' +
        exRemain +
        '\uFF09\u00B7\u9690\u85CF ' +
        escapeHtml(tabHost || '\uFF08\u672A\u77E5\uFF09') +
        '</option>';
      var hi;
      for (hi = 0; hi < hosts.length; hi++) {
        var h = hosts[hi];
        var hn = htc[h] != null ? htc[h] : 0;
        opts +=
          '<option value="' +
          escapeHtml(h) +
          '"' +
          (h === curSf ? ' selected' : '') +
          '>' +
          escapeHtml(h) +
          ' (' +
          hn +
          ')</option>';
      }
      siteSel.innerHTML = opts;
      siteSel.value = curSf;
    }

    var exBtnSync = mcpContent.querySelector('.ai-req-mcp-exclude-current-btn');
    if (exBtnSync) {
      var onEx = (state.mcpListUi.siteFilter || 'all') === MCP_SITE_FILTER_EXCLUDE_CURRENT;
      exBtnSync.classList.toggle('ai-req-chip-on', onEx);
      exBtnSync.textContent = onEx ? '\u663E\u793A\u5168\u90E8\u7AD9\u70B9' : '\u6392\u9664\u5F53\u524D\u9875';
    }

    listEl.innerHTML = buildMcpToolListInnerHTML();

    var miniBar = mcpContent.querySelector('.ai-req-mcp-toolbar-mini');
    if (miniBar) {
      var fv = getFilteredSortedMcpToolNames().length;
      var ta = Object.keys(getMcpListToolsMap() || {}).length;
      var line = '\u663E\u793A ' + fv + ' / \u5171 ' + ta;
      if (ds && ds.ok && typeof ds.mergedToolCount === 'number') {
        line +=
          ' \u00B7 \u5168\u5E93\u5408\u5E76 ' +
          ds.mergedToolCount +
          ' \u00B7 Cursor\u5DF2\u542F\u7528 ' +
          ds.mergedEnabledCount;
      }
      miniBar.textContent = line;
    }

    bindMcpToolListRowEvents(mcpContent);
  });
}

function bindMcpToolListRowEvents(mcpContent) {
  var enabledChecks = mcpContent.querySelectorAll('.ai-req-mcp-tool-enabled');
  var ei;
  for (ei = 0; ei < enabledChecks.length; ei++) {
    enabledChecks[ei].addEventListener('change', function () {
      var tName = this.getAttribute('data-tool-name');
      var host = resolveMcpToolHostFromView(tName);
      if (setMcpToolEnabledOnHost(host, tName, this.checked)) {
        chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
        if (state.mcpPanelTab === 'list') patchMcpToolListSection(mcpContent);
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
        deleteMcpToolFromHost(resolveMcpToolHostFromView(dName), dName);
        chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
        patchMcpToolListSection(mcpContent);
        showToast('\u5DF2\u5220\u9664: ' + dName);
      }
    });
  }

  var pickBoxes = mcpContent.querySelectorAll('.ai-req-mcp-tool-pick');
  for (var pi = 0; pi < pickBoxes.length; pi++) {
    pickBoxes[pi].addEventListener('change', function (evPk) {
      evPk.stopPropagation();
      var pnm = this.getAttribute('data-tool-name');
      if (!state.selectedMcpToolNames) state.selectedMcpToolNames = {};
      if (this.checked) state.selectedMcpToolNames[pnm] = true;
      else delete state.selectedMcpToolNames[pnm];
    });
  }
}

function refreshMainPanelContent() {
  var bodyEl = state.mainPanel.querySelector('.ai-req-main-body');
  if (!bodyEl) return;

  if (state.mcpPanelTab === 'list' || state.mcpPanelTab === 'logs' || state.mcpPanelTab === 'localExports') {
    var reqList = bodyEl.querySelector('.ai-req-request-list');
    if (reqList) reqList.style.display = 'none';
    var oldMcp = bodyEl.querySelector('.ai-req-mcp-content');
    if (oldMcp) oldMcp.remove();
    var mcpContent = document.createElement('div');
    mcpContent.className = 'ai-req-mcp-content';
    if (state.mcpPanelTab === 'list') {
      mcpContent.innerHTML = buildMcpToolListHTML();
    } else if (state.mcpPanelTab === 'logs') {
      mcpContent.innerHTML = buildMcpLogListHTML();
    } else {
      mcpContent.innerHTML = buildMcpLocalExportsHTML();
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
  ensureMcpListUi();
  var ui = state.mcpListUi;
  var collapsed = !!ui.toolbarCollapsed;
  var html = '';
  html += '<div class="ai-req-mcp-toolbar-wrap' + (collapsed ? ' ai-req-mcp-toolbar-collapsed' : '') + '">';
  html += '<div class="ai-req-mcp-collapse-bar">';
  html += '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-toolbar-collapse-btn">';
  html += collapsed ? '\u5C55\u5F00\u5DE5\u5177\u680F' : '\u6536\u8D77\u5DE5\u5177\u680F';
  html += '</button>';
  html += '<span class="ai-req-mcp-toolbar-mini"></span>';
  html += '</div>';
  html += '<div class="ai-req-mcp-toolbar-expandable">';
  html += '<div class="ai-req-mcp-status-bar">';
  html += '<span class="ai-req-mcp-status-dot ai-req-mcp-status-dot-off"></span>';
  html += '<span class="ai-req-mcp-status-text">MCP \u25CB \u672A\u542F\u52A8</span>';
  html += '<button class="ai-req-mcp-start-btn">\u542F\u52A8</button>';
  html += '</div>';
  html += '<div class="ai-req-mcp-site-filter-row">';
  html += '<label class="ai-req-mcp-site-filter-label">\u7AD9\u70B9</label>';
  html += '<select class="ai-req-mcp-site-filter" aria-label="MCP \u5DE5\u5177\u6309\u7AD9\u70B9\u7B5B\u9009"></select>';
  html +=
    '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-exclude-current-btn">\u6392\u9664\u5F53\u524D\u9875</button>';
  html +=
    '<span class="ai-req-mcp-site-filter-hint">\u4E0B\u62C9\u663E\u793A\u5404\u7AD9\u5DE5\u5177\u6570\uFF1B\u300C\u6392\u9664\u5F53\u524D\u9875\u300D\u9690\u85CF\u5F53\u524D\u6807\u7B7E\u9875\u57DF\u540D\u5728\u5168\u5E93\u5408\u5E76\u4E2D\u7684\u5DE5\u5177\u3002</span>';
  html += '</div>';
  html += '<div class="ai-req-mcp-filter-row">';
  html += '<input type="search" class="ai-req-mcp-list-search" placeholder="\u641C\u7D22\u5DE5\u5177/\u63CF\u8FF0/path..." value="' + escapeHtml(ui.keyword || '') + '">';
  html += '<select class="ai-req-mcp-group-select">';
  var gm = ui.groupMode || 'none';
  html += '<option value="none"' + (gm === 'none' ? ' selected' : '') + '>\u5E73\u94FA</option>';
  html += '<option value="method"' + (gm === 'method' ? ' selected' : '') + '>\u6309\u65B9\u6CD5</option>';
  html += '<option value="risk"' + (gm === 'risk' ? ' selected' : '') + '>\u6309\u98CE\u9669</option>';
  html += '<option value="pathPrefix"' + (gm === 'pathPrefix' ? ' selected' : '') + '>\u6309\u8DEF\u5F84\u9996\u6BB5</option>';
  html += '</select>';
  var fe = ui.filterEnabled || 'all';
  html += '<button type="button" class="ai-req-mcp-fe-chip' + (fe === 'all' ? ' ai-req-chip-on' : '') + '" data-mcp-fe="all">\u5168\u90E8</button>';
  html += '<button type="button" class="ai-req-mcp-fe-chip' + (fe === 'on' ? ' ai-req-chip-on' : '') + '" data-mcp-fe="on">\u5DF2\u542F\u7528</button>';
  html += '<button type="button" class="ai-req-mcp-fe-chip' + (fe === 'off' ? ' ai-req-chip-on' : '') + '" data-mcp-fe="off">\u5DF2\u5173\u95ED</button>';
  var risks = ui.riskLevels || {};
  html += '<button type="button" class="ai-req-mcp-risk-chip' + (risks.low ? ' ai-req-chip-on' : '') + '" data-mcp-risk="low">low</button>';
  html += '<button type="button" class="ai-req-mcp-risk-chip' + (risks.medium ? ' ai-req-chip-on' : '') + '" data-mcp-risk="medium">med</button>';
  html += '<button type="button" class="ai-req-mcp-risk-chip' + (risks.high ? ' ai-req-chip-on' : '') + '" data-mcp-risk="high">high</button>';
  html += '</div>';
  html += '<div class="ai-req-mcp-bulk-actions">';
  html += '<input type="file" accept="application/json,.json" class="ai-req-mcp-import-file-input" tabindex="-1" aria-hidden="true">';
  html += '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-exp-all">\u5168\u90E8\u5BFC\u51FA</button>';
  html += '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-exp-sel">\u5DF2\u9009\u5BFC\u51FA</button>';
  html += '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-imp-btn">\u5BFC\u5165...</button>';
  html += '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-sel-all">\u5168\u9009</button>';
  html += '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-sel-clear">\u6E05\u9009</button>';
  html += '<button type="button" class="ai-req-btn ai-req-btn-primary ai-req-mcp-merge-selected">\u5408\u5E76\u5DF2\u9009</button>';
  html += '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-dedupe-tools">\u5220\u9664\u91CD\u590D\u5DE5\u5177</button>';
  html += '<button type="button" class="ai-req-btn ai-req-btn-danger ai-req-mcp-del-selected">\u5220\u9664\u5DF2\u9009</button>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  html += '<div class="ai-req-mcp-tool-list">';
  html += buildMcpToolListInnerHTML();
  html += '</div>';
  html += '<div class="ai-req-mcp-tab-bar">';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'list' ? ' active' : '') + '" data-mcp-tab="list">\u5DE5\u5177\u5217\u8868</button>';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'logs' ? ' active' : '') + '" data-mcp-tab="logs">\u8C03\u7528\u65E5\u5FD7</button>';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'localExports' ? ' active' : '') + '" data-mcp-tab="localExports">\u8BFB\u53D6\u672C\u5730\u5DE5\u5177\u5217\u8868</button>';
  html += '</div>';
  return html;
}

function buildMcpLocalExportsHTML() {
  var pathDisp = (state.config && state.config.mcpExportPath) ? state.config.mcpExportPath.trim() : '';
  var html = '';
  html += '<div class="ai-req-mcp-status-bar">';
  html += '<span class="ai-req-mcp-status-dot ai-req-mcp-status-dot-off"></span>';
  html += '<span class="ai-req-mcp-status-text">MCP \u25CB \u672A\u542F\u52A8</span>';
  html += '<button class="ai-req-mcp-start-btn">\u542F\u52A8</button>';
  html += '</div>';
  html += '<div class="ai-req-mcp-local-exports-panel">';
  html += '<div class="ai-req-mcp-local-path-row"><span class="ai-req-mcp-local-path-label">\u5BFC\u51FA\u76EE\u5F55\uFF1A</span> ';
  html += '<span class="ai-req-mcp-local-path-value">' +
    (pathDisp ? escapeHtml(pathDisp) : escapeHtml('\uFF08\u672A\u914D\u7F6E\uFF0C\u8BF7\u6253\u5F00\u8BBE\u7F6E\u586B\u5199 MCP \u5BFC\u51FA\u76EE\u5F55\uFF09')) +
    '</span></div>';
  html += '<p class="ai-req-mcp-local-hint">\u9700 MCP \u52A9\u624B\u5DF2\u8FDE\u63A5\uFF1B\u5217\u8868\u7531\u52A9\u624B\u8BFB\u53D6\u672C\u673A\u76EE\u5F55\u3002\u8DEF\u5F84\u5728\u300C\u914D\u7F6E\u300D\u4E2D\u4FEE\u6539\u3002</p>';
  html += '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-local-refresh">\u5237\u65B0\u5217\u8868</button>';
  html += '<div class="ai-req-mcp-local-export-list"><div class="ai-req-mcp-local-export-placeholder">\u70B9\u51FB\u300C\u5237\u65B0\u5217\u8868\u300D\u52A0\u8F7D\u5DF2\u5BFC\u51FA\u7684 JSON</div></div>';
  html += '</div>';
  html += '<div class="ai-req-mcp-tab-bar">';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'list' ? ' active' : '') + '" data-mcp-tab="list">\u5DE5\u5177\u5217\u8868</button>';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'logs' ? ' active' : '') + '" data-mcp-tab="logs">\u8C03\u7528\u65E5\u5FD7</button>';
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'localExports' ? ' active' : '') + '" data-mcp-tab="localExports">\u8BFB\u53D6\u672C\u5730\u5DE5\u5177\u5217\u8868</button>';
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
  html += '<button class="ai-req-mcp-tab' + (state.mcpPanelTab === 'localExports' ? ' active' : '') + '" data-mcp-tab="localExports">\u8BFB\u53D6\u672C\u5730\u5DE5\u5177\u5217\u8868</button>';
  html += '</div>';
  return html;
}

function refreshLocalExportsFileList(mcpContent) {
  var listEl = mcpContent.querySelector('.ai-req-mcp-local-export-list');
  if (!listEl) return;
  var dirPath = state.config && state.config.mcpExportPath ? String(state.config.mcpExportPath).trim() : '';
  if (!dirPath) {
    listEl.innerHTML =
      '<div class="ai-req-mcp-empty">\u8BF7\u5728\u914D\u7F6E\u4E2D\u586B\u5199 MCP \u5BFC\u51FA\u76EE\u5F55\uFF08\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\uFF09</div>';
    return;
  }
  listEl.innerHTML = '<div class="ai-req-mcp-local-export-loading">\u52A0\u8F7D\u4E2D...</div>';
  chrome.runtime.sendMessage({ type: 'MCP_LIST_EXPORT_DIR', dirPath: dirPath }, function (res) {
    if (chrome.runtime.lastError) {
      listEl.innerHTML =
        '<div class="ai-req-mcp-empty">' + escapeHtml(chrome.runtime.lastError.message) + '</div>';
      return;
    }
    if (!res || !res.ok) {
      listEl.innerHTML =
        '<div class="ai-req-mcp-empty">' + escapeHtml((res && res.error) || '\u5931\u8D25') + '</div>';
      return;
    }
    var files = res.files || [];
    if (files.length === 0) {
      listEl.innerHTML = '<div class="ai-req-mcp-empty">\u76EE\u5F55\u4E2D\u65E0 .json \u6587\u4EF6</div>';
      return;
    }
    var html = '';
    var fi;
    for (fi = 0; fi < files.length; fi++) {
      var f = files[fi];
      var encName = encodeURIComponent(f.name);
      var dt = new Date(f.mtimeMs || 0);
      var timeStr =
        dt.getFullYear() +
        '-' +
        pad2(dt.getMonth() + 1) +
        '-' +
        pad2(dt.getDate()) +
        ' ' +
        pad2(dt.getHours()) +
        ':' +
        pad2(dt.getMinutes());
      html += '<div class="ai-req-mcp-local-file-row">';
      html += '<span class="ai-req-mcp-local-file-name">' + escapeHtml(f.name) + '</span>';
      html += '<span class="ai-req-mcp-local-file-mtime">' + escapeHtml(timeStr) + '</span>';
      html +=
        '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-local-imp-skip" data-local-import="merge-skip" data-file-name="' +
        encName +
        '">\u5BFC\u5165\uFF08\u5408\u5E76\uFF09</button>';
      html +=
        '<button type="button" class="ai-req-btn ai-req-btn-secondary ai-req-mcp-local-imp-ow" data-local-import="merge-overwrite" data-file-name="' +
        encName +
        '">\u5BFC\u5165\u5E76\u8986\u76D6</button>';
      html +=
        '<button type="button" class="ai-req-btn ai-req-btn-danger ai-req-mcp-local-imp-repl" data-local-import="replace" data-file-name="' +
        encName +
        '">\u6E05\u9664\u5E76\u5BFC\u5165</button>';
      html += '</div>';
    }
    listEl.innerHTML = html;
  });
}

function runLocalMcpExportImport(_mcpContent, fileName, mode) {
  var dirPath = state.config && state.config.mcpExportPath ? String(state.config.mcpExportPath).trim() : '';
  if (!dirPath || !fileName) {
    showToast('\u8DEF\u5F84\u6216\u6587\u4EF6\u540D\u65E0\u6548');
    return;
  }
  if (mode === 'replace') {
    if (
      !confirm(
        '\u5C06\u6E05\u7A7A\u5F53\u524D\u7AD9\u70B9\u4E0B\u5168\u90E8 MCP \u5DE5\u5177\uFF0C\u518D\u4EE5\u6587\u4EF6\u300C' +
          fileName +
          '\u300D\u5168\u91CF\u66FF\u6362\u3002\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\uFF08\u53EF\u518D\u5BFC\u5165\u5907\u4EFD\uFF09\u3002\u786E\u5B9A\uFF1F'
      )
    ) {
      return;
    }
  }
  chrome.runtime.sendMessage(
    { type: 'MCP_READ_EXPORT_FILE', dirPath: dirPath, fileName: fileName },
    function (res) {
      if (chrome.runtime.lastError) {
        showToast(chrome.runtime.lastError.message);
        return;
      }
      if (!res || !res.ok) {
        showToast((res && res.error) || '\u8BFB\u53D6\u5931\u8D25');
        return;
      }
      var parsed;
      try {
        parsed = JSON.parse(res.text || '{}');
      } catch (eParse) {
        showToast('JSON \u89E3\u6790\u5931\u8D25');
        return;
      }
      var outcome;
      if (mode === 'merge-skip') {
        outcome = applyMcpToolsImport(parsed, 'merge', 'skip');
      } else if (mode === 'merge-overwrite') {
        outcome = applyMcpToolsImport(parsed, 'merge', 'overwrite');
      } else {
        outcome = applyMcpToolsImport(parsed, 'replace');
      }
      if (outcome && outcome.ok) {
        saveMcpTools();
        chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
        if (mode === 'replace') {
          state.selectedMcpToolNames = {};
        }
        showToast('\u5DF2\u5BFC\u5165 ' + outcome.imported + ' \u4E2A\u5DE5\u5177');
      } else {
        showToast((outcome && outcome.error) || '\u5BFC\u5165\u5931\u8D25');
      }
    }
  );
}

function bindLocalExportsPanelEvents(mcpContent) {
  var refreshBtn = mcpContent.querySelector('.ai-req-mcp-local-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () {
      refreshLocalExportsFileList(mcpContent);
    });
  }
  var listEl = mcpContent.querySelector('.ai-req-mcp-local-export-list');
  if (listEl) {
    listEl.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-local-import]');
      if (!btn) return;
      var mode = btn.getAttribute('data-local-import');
      var enc = btn.getAttribute('data-file-name');
      if (!enc || !mode) return;
      var fileName;
      try {
        fileName = decodeURIComponent(enc);
      } catch (eDec) {
        return;
      }
      runLocalMcpExportImport(mcpContent, fileName, mode);
    });
  }
  refreshLocalExportsFileList(mcpContent);
}

function bindMcpContentEvents(mcpContent) {
  refreshMcpStatusBar(mcpContent);

  ensureMcpListUi();

  var collapseTb = mcpContent.querySelector('.ai-req-mcp-toolbar-collapse-btn');
  if (collapseTb) {
    collapseTb.addEventListener('click', function () {
      ensureMcpListUi();
      state.mcpListUi.toolbarCollapsed = !state.mcpListUi.toolbarCollapsed;
      refreshMainPanelContent();
    });
  }

  var siteFilterSel = mcpContent.querySelector('.ai-req-mcp-site-filter');
  if (siteFilterSel && state.mcpPanelTab === 'list') {
    siteFilterSel.addEventListener('change', function () {
      ensureMcpListUi();
      state.mcpListUi.siteFilter = siteFilterSel.value || 'all';
      patchMcpToolListSection(mcpContent);
    });
  }

  var exCurBtn = mcpContent.querySelector('.ai-req-mcp-exclude-current-btn');
  if (exCurBtn && state.mcpPanelTab === 'list') {
    exCurBtn.addEventListener('click', function () {
      ensureMcpListUi();
      if ((state.mcpListUi.siteFilter || 'all') === MCP_SITE_FILTER_EXCLUDE_CURRENT) {
        state.mcpListUi.siteFilter = 'all';
      } else {
        state.mcpListUi.siteFilter = MCP_SITE_FILTER_EXCLUDE_CURRENT;
      }
      patchMcpToolListSection(mcpContent);
    });
  }

  var mcpSearch = mcpContent.querySelector('.ai-req-mcp-list-search');
  if (mcpSearch) {
    mcpSearch.addEventListener('input', function () {
      ensureMcpListUi();
      state.mcpListUi.keyword = mcpSearch.value;
      patchMcpToolListSection(mcpContent);
    });
  }

  var grpSel = mcpContent.querySelector('.ai-req-mcp-group-select');
  if (grpSel) {
    grpSel.addEventListener('change', function () {
      ensureMcpListUi();
      state.mcpListUi.groupMode = grpSel.value || 'none';
      patchMcpToolListSection(mcpContent);
    });
  }

  var feChips = mcpContent.querySelectorAll('.ai-req-mcp-fe-chip');
  var fc;
  for (fc = 0; fc < feChips.length; fc++) {
    feChips[fc].addEventListener('click', function () {
      ensureMcpListUi();
      var v = this.getAttribute('data-mcp-fe');
      state.mcpListUi.filterEnabled = v || 'all';
      patchMcpToolListSection(mcpContent);
    });
  }

  var rkChips = mcpContent.querySelectorAll('.ai-req-mcp-risk-chip');
  for (fc = 0; fc < rkChips.length; fc++) {
    rkChips[fc].addEventListener('click', function () {
      ensureMcpListUi();
      var rk = this.getAttribute('data-mcp-risk');
      if (!state.mcpListUi.riskLevels) state.mcpListUi.riskLevels = {};
      state.mcpListUi.riskLevels[rk] = !state.mcpListUi.riskLevels[rk];
      patchMcpToolListSection(mcpContent);
    });
  }

  var startBtn = mcpContent.querySelector('.ai-req-mcp-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', function () {
      var btn = startBtn;
      if (btn.textContent === '\u542F\u52A8') {
        chrome.runtime.sendMessage({ type: 'MCP_START_HELPER', payload: { mcpPort: state.config.mcpPort || 9527 } }, function (resp) {
          if (resp && resp.ok) {
            setTimeout(function () { refreshMcpStatusBar(mcpContent); }, 500);
          } else {
            showToast('MCP \u542F\u52A8\u5931\u8D25: ' + ((resp && resp.error) || '\u672A\u77E5\u9519\u8BEF'));
            setTimeout(function () { refreshMcpStatusBar(mcpContent); }, 200);
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

  if (state.mcpPanelTab === 'list') {
    patchMcpToolListSection(mcpContent);
  }

  var expAllBtn = mcpContent.querySelector('.ai-req-mcp-exp-all');
  if (expAllBtn) {
    expAllBtn.addEventListener('click', function () {
      var sanHead = confirm('\u5BFC\u51FA\u65F6\u5220\u9664 Authorization/Cookie \u7B49\u654F\u611F\u5934\uFF1F');
      var mapFull = getMcpListToolsMap();
      var pkgFull = buildMcpToolsExportPayload(mapFull, !!sanHead);
      var sfTag = state.mcpListUi.siteFilter || 'all';
      var fnameBase;
      if (sfTag === 'all') {
        fnameBase = 'mcp-tools_allmerged_' + mcpFmtDateTag();
      } else if (sfTag === MCP_SITE_FILTER_EXCLUDE_CURRENT) {
        fnameBase =
          'mcp-tools_exclude_' + mcpSafeFilenameSegment(location.hostname) + '_' + mcpFmtDateTag();
      } else {
        fnameBase = 'mcp-tools_' + mcpSafeFilenameSegment(sfTag) + '_' + mcpFmtDateTag();
      }
      exportMcpPkgToConfiguredDirOrDownload(pkgFull, fnameBase);
    });
  }

  var expSelBtn = mcpContent.querySelector('.ai-req-mcp-exp-sel');
  if (expSelBtn) {
    expSelBtn.addEventListener('click', function () {
      var snames = getSelectedMcpToolNamesOrdered();
      if (!snames.length) {
        showToast('\u5148\u52FE\u9009\u8981\u5BFC\u51FA\u7684\u5DE5\u5177');
        return;
      }
      var subset = {};
      var si;
      var tmSel = getMcpListToolsMap();
      for (si = 0; si < snames.length; si++) subset[snames[si]] = tmSel[snames[si]];
      var sanSel = confirm('\u8131\u654F\u5934\u90E8\u518D\u5BFC\u51FA\uFF1F');
      var pkgSel = buildMcpToolsExportPayload(subset, !!sanSel);
      var sfSel = state.mcpListUi.siteFilter || 'all';
      var selMid =
        sfSel === 'all'
          ? 'merged'
          : sfSel === MCP_SITE_FILTER_EXCLUDE_CURRENT
            ? 'exclude_' + mcpSafeFilenameSegment(location.hostname)
            : mcpSafeFilenameSegment(sfSel);
      var fnameSel = 'mcp-tools_sel_' + selMid + '_' + mcpFmtDateTag();
      exportMcpPkgToConfiguredDirOrDownload(pkgSel, fnameSel);
      showToast('\u5DF2\u9009 ' + snames.length + '\u4E2A\u5DE5\u5177');
    });
  }

  var impBtn = mcpContent.querySelector('.ai-req-mcp-imp-btn');
  var impInput = mcpContent.querySelector('.ai-req-mcp-import-file-input');
  if (impBtn && impInput) {
    impBtn.addEventListener('click', function () {
      impInput.click();
    });
    impInput.addEventListener('change', function () {
      var f = impInput.files && impInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function (evRf) {
        try {
          var parsedImp = JSON.parse(String(evRf.target.result || '{}'));
          var mergeFirst = confirm('\u786E\u5B9A=\u5408\u5E76\u5BFC\u5165 | \u53D6\u6D88=\u5168\u91CF\u66FF\u6362');
          var outcome;
          if (mergeFirst) {
            var cmode = (prompt('\u540C\u540D: skip | overwrite | rename', 'skip') || 'skip').toLowerCase();
            if (['skip', 'overwrite', 'rename'].indexOf(cmode) === -1) cmode = 'skip';
            outcome = applyMcpToolsImport(parsedImp, 'merge', cmode);
          } else {
            if (!confirm('\u786E\u5B9A\u7528\u6587\u4EF6\u5B8C\u5168\u66FF\u6362\u672C\u7AD9\u70B9 MCP \u5DE5\u5177\u914D\u7F6E\uFF1F')) {
              outcome = { ok: false, error: 'cancelled' };
            } else {
              outcome = applyMcpToolsImport(parsedImp, 'replace');
            }
          }
          if (outcome && outcome.ok) {
            saveMcpTools();
            chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
            refreshMainPanelContent();
            showToast('\u5BFC\u5165\u6210\u529F ' + (outcome.imported || '') + '');
          } else if (outcome && outcome.error !== 'cancelled') {
            showToast('\u5BFC\u5165\u5931\u8D25: ' + outcome.error);
          }
        } catch (eImp) {
          showToast('\u89E3\u6790\u5931\u8D25: ' + eImp.message);
        }
        impInput.value = '';
      };
      reader.readAsText(f, 'UTF-8');
    });
  }

  var selAllMc = mcpContent.querySelector('.ai-req-mcp-sel-all');
  if (selAllMc) {
    selAllMc.addEventListener('click', function () {
      if (!state.selectedMcpToolNames) state.selectedMcpToolNames = {};
      var vis = getFilteredSortedMcpToolNames();
      var vx;
      for (vx = 0; vx < vis.length; vx++) state.selectedMcpToolNames[vis[vx]] = true;
      patchMcpToolListSection(mcpContent);
    });
  }

  var selClrMc = mcpContent.querySelector('.ai-req-mcp-sel-clear');
  if (selClrMc) {
    selClrMc.addEventListener('click', function () {
      state.selectedMcpToolNames = {};
      patchMcpToolListSection(mcpContent);
    });
  }

  var mergeBtn = mcpContent.querySelector('.ai-req-mcp-merge-selected');
  if (mergeBtn) {
    mergeBtn.addEventListener('click', function () {
      var mnames = getSelectedMcpToolNamesOrdered();
      if (mnames.length < 2) {
        showToast('\u5408\u5E76\u81F3\u5C11\u9009\u4E24\u9879');
        return;
      }
      var hbMerge = (state.mcpViewDataset && state.mcpViewDataset.hostByTool) || {};
      var hostsSeen = {};
      var mi;
      for (mi = 0; mi < mnames.length; mi++) {
        var hhM = hbMerge[mnames[mi]];
        if (hhM) hostsSeen[hhM] = true;
      }
      var uh = Object.keys(hostsSeen);
      if (uh.length !== 1) {
        showToast(
          '\u5408\u5E76\u4EC5\u652F\u6301\u540C\u4E00\u7AD9\u70B9\u4E0B\u7684\u5DE5\u5177\uFF0C\u8BF7\u5207\u6362\u7AD9\u70B9\u7B5B\u9009\u6216\u53EA\u9009\u540C\u4E00\u57DF\u540D\u6765\u6E90\u7684\u9879'
        );
        return;
      }
      var targetHost = uh[0];
      var toolsObjMerge = loadToolsObjectForHostname(targetHost);
      var mobjs = [];
      for (mi = 0; mi < mnames.length; mi++) {
        if (toolsObjMerge[mnames[mi]]) mobjs.push(toolsObjMerge[mnames[mi]]);
      }
      try {
        var mergedToolDef = mergeMcpToolDefinitions(mobjs);
        for (mi = 0; mi < mnames.length; mi++) delete toolsObjMerge[mnames[mi]];
        state.selectedMcpToolNames = {};
        toolsObjMerge[mergedToolDef.name] = mergedToolDef;
        persistToolsObjectForHostname(targetHost, toolsObjMerge);
        chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
        patchMcpToolListSection(mcpContent);
        showToast('\u5DF2\u5408\u5E76\u4E3A ' + mergedToolDef.name);
      } catch (errM) {
        showToast('\u5408\u5E76\u5931\u8D25: ' + errM.message);
      }
    });
  }

  var dedupeMcBtn = mcpContent.querySelector('.ai-req-mcp-dedupe-tools');
  if (dedupeMcBtn) {
    dedupeMcBtn.addEventListener('click', function () {
      if (!confirm('\u6309\u8DEF\u5F84\u6A21\u677F/pathPatternKey \u6216 METHOD+pathname\u7B7E\u540D\u4FDD\u7559\u5B57\u5178\u5E8F\u9996\u4E2A\u5DE5\u5177\uFF0C\u5220\u9664\u5176\u4F59\u91CD\u590D\u9879\u3002\u786E\u5B9A\uFF1F')) return;
      var sfDed = state.mcpListUi.siteFilter || 'all';
      if (sfDed === 'all' || sfDed === MCP_SITE_FILTER_EXCLUDE_CURRENT) {
        showToast(
          '\u8BF7\u5148\u5728\u300C\u7AD9\u70B9\u300D\u4E2D\u9009\u62E9\u5177\u4F53\u57DF\u540D\uFF0C\u518D\u6267\u884C\u5220\u9664\u91CD\u590D\uFF08\u4EC5\u9488\u5BF9\u5355\u7AD9\u5B58\u50A8\uFF09'
        );
        return;
      }
      var nDed = removeDuplicateMcpToolsByConflictKeyForHostname(sfDed);
      chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
      patchMcpToolListSection(mcpContent);
      showToast(nDed ? '\u5DF2\u5220\u9664\u91CD\u590D ' + nDed + ' \u4E2A' : '\u65E0\u91CD\u590D\u5DE5\u5177');
    });
  }

  var delSelBtn = mcpContent.querySelector('.ai-req-mcp-del-selected');
  if (delSelBtn) {
    delSelBtn.addEventListener('click', function () {
      var dnm = getSelectedMcpToolNamesOrdered();
      if (!dnm.length) {
        showToast('\u5148\u52FE\u9009\u8981\u5220\u9664\u7684\u9879\u76EE');
        return;
      }
      if (!confirm('\u786E\u5B9A\u5220\u9664\u5DF2\u9009 ' + dnm.length + ' \u9879\uFF1F')) return;
      var hbDel = (state.mcpViewDataset && state.mcpViewDataset.hostByTool) || {};
      var dj;
      for (dj = 0; dj < dnm.length; dj++) {
        var tn = dnm[dj];
        var hh = hbDel[tn] || location.hostname;
        deleteMcpToolFromHost(hh, tn);
      }
      state.selectedMcpToolNames = {};
      chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
      patchMcpToolListSection(mcpContent);
      showToast('\u5DF2\u6279\u91CF\u5220\u9664');
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

  if (state.mcpPanelTab === 'localExports') {
    bindLocalExportsPanelEvents(mcpContent);
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
      textEl.textContent = 'MCP \u25CB \u672A\u542F\u52A8' + (resp && resp.helperError ? '\uFF08' + resp.helperError + '\uFF09' : '');
      btnEl.textContent = '\u542F\u52A8';
      btnEl.className = 'ai-req-mcp-start-btn';
    }
  });
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function mcpFmtDateTag() {
  var d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

var MCP_EXPORT_NM_UTF8_SOFT_LIMIT = 1040000;

function exportMcpPkgToConfiguredDirOrDownload(pkg, filenameBase) {
  var dir = state.config && state.config.mcpExportPath ? String(state.config.mcpExportPath).trim() : '';
  var jsonText = JSON.stringify(pkg, null, 2);
  var byteLen = jsonText.length;
  try {
    if (typeof TextEncoder !== 'undefined') byteLen = new TextEncoder().encode(jsonText).length;
  } catch (eTe) {}

  function fallbackDownload(extraMsg) {
    downloadMcpPkgWithFilename(pkg, filenameBase);
    if (extraMsg) showToast(extraMsg);
  }

  if (!dir) {
    fallbackDownload('\u672A\u914D\u7F6E MCP \u5BFC\u51FA\u76EE\u5F55\uFF0C\u5DF2\u4F7F\u7528\u6D4F\u89C8\u5668\u4E0B\u8F7D\u5230\u9ED8\u8BA4\u6587\u4EF6\u5939');
    return;
  }

  if (byteLen > MCP_EXPORT_NM_UTF8_SOFT_LIMIT) {
    fallbackDownload(
      '\u5BFC\u51FA\u8FC7\u5927\uFF08Native Messaging \u9650\u5236 ~1MB\uFF09\uFF0C\u5DF2\u6539\u4E3A\u6D4F\u89C8\u5668\u4E0B\u8F7D'
    );
    return;
  }

  var baseName = /\.json$/i.test(filenameBase) ? filenameBase : filenameBase + '.json';

  chrome.runtime.sendMessage(
    {
      type: 'MCP_WRITE_EXPORT_FILE',
      dirPath: dir,
      fileName: baseName,
      text: jsonText
    },
    function (res) {
      if (chrome.runtime.lastError) {
        fallbackDownload('\u5199\u5165\u5931\u8D25\uFF0C\u5DF2\u6539\u4E3A\u4E0B\u8F7D\uFF1A' + chrome.runtime.lastError.message);
        return;
      }
      if (!res || !res.ok) {
        fallbackDownload(
          '\u5199\u5165\u914D\u7F6E\u76EE\u5F55\u5931\u8D25\uFF0C\u5DF2\u6539\u4E3A\u4E0B\u8F7D' +
            ((res && res.error) ? '\uFF1A' + res.error : '')
        );
        return;
      }
      showToast('\u5DF2\u5199\u5165\u914D\u7F6E\u76EE\u5F55\uFF1A' + baseName);
    }
  );
}

function downloadMcpPkgWithFilename(pkg, filenameBase) {
  var blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = /\.json$/i.test(filenameBase) ? filenameBase : filenameBase + '.json';
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 2500);
}

function getSelectedMcpToolNamesOrdered() {
  var outArr = [];
  var sm = state.selectedMcpToolNames || {};
  var tm = getMcpListToolsMap();
  var nm;
  for (nm in tm) {
    if (!Object.prototype.hasOwnProperty.call(tm, nm)) continue;
    if (sm[nm]) outArr.push(nm);
  }
  return outArr;
}
function openMcpToolEditor(toolName) {
  var editingHost = resolveMcpToolHostFromView(toolName);
  var toolsObj = loadToolsObjectForHostname(editingHost);
  var tool = toolsObj[toolName];
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
      delete toolsObj[toolName];
      tool.name = newName;
      toolsObj[newName] = tool;
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

    persistToolsObjectForHostname(editingHost, toolsObj);
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
  var testerHost = resolveMcpToolHostFromView(toolName);
  var toolsObjTester = loadToolsObjectForHostname(testerHost);
  var tool = toolsObjTester[toolName];
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
