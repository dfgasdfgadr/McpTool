function inferFlowKind(flow) {
  if (!flow) return 'manual';
  if (flow.kind === 'manual' || flow.kind === 'recorded') return flow.kind;
  if ((flow.steps && flow.steps.length) || (flow.verifiedRequestIds && flow.verifiedRequestIds.length)) {
    return 'recorded';
  }
  return 'manual';
}

function loadFlowsObjectForHostname(hostname) {
  var key = getFlowsKey(hostname);
  try {
    var saved = storageGet(key, null);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return {};
}

function persistFlowsObjectForHostname(hostname, flowsObj) {
  var key = getFlowsKey(hostname);
  storageSet(key, JSON.stringify(flowsObj || {}));
  if (hostname === location.hostname) {
    state.flows = flowsObj || {};
  }
}

function getMergedFlowsMap() {
  var ds = state.mcpViewDataset;
  if (ds && ds.flowsById && typeof ds.flowsById === 'object') return ds.flowsById;
  return state.flows || {};
}

function getFlowById(flowId) {
  if (!flowId) return null;
  var map = getMergedFlowsMap();
  return map[flowId] || null;
}

function syncFlowIntoViewDataset(flow) {
  if (!flow || !flow.id) return;
  if (state.mcpViewDataset && state.mcpViewDataset.flowsById) {
    state.mcpViewDataset.flowsById[flow.id] = flow;
  }
  if (flow.hostname === '*') return;
  if (flow.hostname === location.hostname || !flow.hostname) {
    state.flows[flow.id] = flow;
  }
}

function removeFlowFromViewDataset(flowId) {
  if (state.mcpViewDataset && state.mcpViewDataset.flowsById) {
    delete state.mcpViewDataset.flowsById[flowId];
  }
  delete state.flows[flowId];
}

function createManualFlow(name, hostname) {
  ensureFlowState();
  var host = hostname || location.hostname;
  var id = 'flow_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  var flow = {
    id: id,
    kind: 'manual',
    name: name || '未命名流程',
    hostname: host,
    startedAt: Date.now(),
    endedAt: Date.now(),
    steps: [],
    verifiedRequestIds: [],
    classifications: {},
    requestMeta: {},
    manualVerificationOverrides: {},
    notes: '',
    mcpToolNames: []
  };
  var flowsObj = loadFlowsObjectForHostname(host);
  flowsObj[id] = flow;
  persistFlowsObjectForHostname(host, flowsObj);
  syncFlowIntoViewDataset(flow);
  return flow;
}

function persistFlowRecord(flow) {
  if (!flow || !flow.id) return;
  var host = flow.hostname || location.hostname;
  var flowsObj = loadFlowsObjectForHostname(host);
  flowsObj[flow.id] = flow;
  persistFlowsObjectForHostname(host, flowsObj);
  syncFlowIntoViewDataset(flow);
}

function resolveToolHostForMembership(toolName) {
  if (typeof resolveMcpToolHostFromView === 'function') {
    return resolveMcpToolHostFromView(toolName);
  }
  return location.hostname;
}

function loadToolForMembership(toolName) {
  var host = resolveToolHostForMembership(toolName);
  var toolsObj = loadToolsObjectForHostname(host);
  if (!toolsObj[toolName] && host === location.hostname && state.mcpTools && state.mcpTools[toolName]) {
    toolsObj = state.mcpTools;
  }
  return { host: host, tool: toolsObj[toolName] || null, toolsObj: toolsObj };
}

function persistToolForMembership(host, toolsObj) {
  persistToolsObjectForHostname(host, toolsObj);
}

function removeToolFromFlowIndex(flow, toolName) {
  if (!flow || !flow.mcpToolNames) return;
  var idx = flow.mcpToolNames.indexOf(toolName);
  if (idx >= 0) flow.mcpToolNames.splice(idx, 1);
}

function appendToolToFlowIndex(flow, toolName) {
  if (!flow) return;
  if (!flow.mcpToolNames) flow.mcpToolNames = [];
  if (flow.mcpToolNames.indexOf(toolName) === -1) flow.mcpToolNames.push(toolName);
}

function setToolFlowMeta(tool, flow, toolHost) {
  if (!tool) return;
  if (!tool._meta) tool._meta = {};
  if (!flow) {
    delete tool._meta.flow;
    if (typeof stripFlowTagFromDescription === 'function') stripFlowTagFromDescription(tool);
    return;
  }
  var flowHost = flow.hostname || location.hostname;
  tool._meta.flow = {
    flowId: flow.id,
    flowName: flow.name,
    hostname: flowHost
  };
  var th = toolHost || (flowHost === '*' ? null : flowHost);
  if (th) tool._meta.flow.toolHost = th;
  if (typeof applyFlowTagToToolDescription === 'function') {
    applyFlowTagToToolDescription(tool, flow.name);
  }
}

function canAssignToolToFlow(flow, toolHost) {
  if (!flow) return false;
  if (flow.hostname === '*') return true;
  var fh = flow.hostname || location.hostname;
  return String(toolHost || '') === String(fh);
}

function sortToolsByFlowOrder(flow, toolNames) {
  var order = (flow && flow.mcpToolNames) || [];
  var rank = {};
  var i;
  for (i = 0; i < order.length; i++) rank[order[i]] = i;
  var inList = (toolNames || []).slice();
  inList.sort(function (a, b) {
    var ra = Object.prototype.hasOwnProperty.call(rank, a) ? rank[a] : 999999;
    var rb = Object.prototype.hasOwnProperty.call(rank, b) ? rank[b] : 999999;
    if (ra !== rb) return ra - rb;
    return String(a).localeCompare(String(b));
  });
  return inList;
}

function insertToolsInFlowOrder(flow, toolNames, beforeToolName) {
  if (!flow) return [];
  var order = (flow.mcpToolNames || []).slice();
  var moving = toolNames || [];
  var cleaned = [];
  var mi;
  for (mi = 0; mi < order.length; mi++) {
    if (moving.indexOf(order[mi]) === -1) cleaned.push(order[mi]);
  }
  var insertAt = cleaned.length;
  if (beforeToolName) {
    var bi = cleaned.indexOf(beforeToolName);
    if (bi >= 0) insertAt = bi;
  }
  cleaned.splice.apply(cleaned, [insertAt, 0].concat(moving));
  return cleaned;
}

function reorderToolsInFlow(flowId, orderedNames, options) {
  options = options || {};
  var flow = getFlowById(flowId);
  if (!flow) return { ok: false, error: 'FLOW_NOT_FOUND' };
  var valid = [];
  var seen = {};
  var i;
  for (i = 0; i < (orderedNames || []).length; i++) {
    var n = orderedNames[i];
    if (seen[n]) continue;
    seen[n] = true;
    valid.push(n);
  }
  var current = flow.mcpToolNames || [];
  for (i = 0; i < current.length; i++) {
    if (!seen[current[i]]) valid.push(current[i]);
  }
  flow.mcpToolNames = valid;
  persistFlowRecord(flow);
  if (options.sync !== false) syncFlowMembershipAndMcp();
  return { ok: true, reordered: valid.length };
}

function assignToolsToFlow(toolNames, targetFlowId, options) {
  options = options || {};
  var flow = getFlowById(targetFlowId);
  if (!flow) return { ok: false, error: 'FLOW_NOT_FOUND' };
  var names = toolNames || [];
  var moved = 0;
  var rejected = 0;
  var ni;
  for (ni = 0; ni < names.length; ni++) {
    var toolName = names[ni];
    if (typeof isFlowContextSystemToolName === 'function' && isFlowContextSystemToolName(toolName)) continue;
    var loaded = loadToolForMembership(toolName);
    if (!loaded.tool) continue;
    if (!canAssignToolToFlow(flow, loaded.host)) {
      rejected++;
      continue;
    }
    var oldFlowId = loaded.tool._meta && loaded.tool._meta.flow && loaded.tool._meta.flow.flowId;
    if (oldFlowId === targetFlowId) continue;
    if (oldFlowId) {
      var oldFlow = getFlowById(oldFlowId);
      if (oldFlow) {
        removeToolFromFlowIndex(oldFlow, toolName);
        persistFlowRecord(oldFlow);
      }
    }
    appendToolToFlowIndex(flow, toolName);
    setToolFlowMeta(loaded.tool, flow, loaded.host);
    persistToolForMembership(loaded.host, loaded.toolsObj);
    moved++;
  }
  if (moved > 0) {
    persistFlowRecord(flow);
    if (options.sync !== false) syncFlowMembershipAndMcp();
  }
  return { ok: true, moved: moved, rejected: rejected };
}

function unassignToolsFromFlow(toolNames, options) {
  options = options || {};
  var names = toolNames || [];
  var count = 0;
  var ni;
  for (ni = 0; ni < names.length; ni++) {
    var toolName = names[ni];
    if (typeof isFlowContextSystemToolName === 'function' && isFlowContextSystemToolName(toolName)) continue;
    var loaded = loadToolForMembership(toolName);
    if (!loaded.tool) continue;
    var oldFlowId = loaded.tool._meta && loaded.tool._meta.flow && loaded.tool._meta.flow.flowId;
    if (!oldFlowId) continue;
    var oldFlow = getFlowById(oldFlowId);
    if (oldFlow) {
      removeToolFromFlowIndex(oldFlow, toolName);
      persistFlowRecord(oldFlow);
    }
    setToolFlowMeta(loaded.tool, null);
    persistToolForMembership(loaded.host, loaded.toolsObj);
    count++;
  }
  if (count > 0 && options.sync !== false) syncFlowMembershipAndMcp();
  return { ok: true, moved: count };
}

function renameFlow(flowId, newName) {
  var flow = getFlowById(flowId);
  if (!flow) return { ok: false, error: 'FLOW_NOT_FOUND' };
  var trimmed = String(newName || '').trim();
  if (!trimmed) return { ok: false, error: 'EMPTY_NAME' };
  flow.name = trimmed;
  persistFlowRecord(flow);
  var toolsMap = typeof getMcpListToolsMap === 'function' ? getMcpListToolsMap() : (state.mcpTools || {});
  var keys = Object.keys(toolsMap);
  var ki;
  for (ki = 0; ki < keys.length; ki++) {
    var tn = keys[ki];
    var meta = toolsMap[tn] && toolsMap[tn]._meta;
    if (!meta || !meta.flow || meta.flow.flowId !== flowId) continue;
    var loaded = loadToolForMembership(tn);
    if (!loaded.tool) continue;
    setToolFlowMeta(loaded.tool, flow, loaded.host);
    persistToolForMembership(loaded.host, loaded.toolsObj);
  }
  syncFlowMembershipAndMcp();
  return { ok: true, flow: flow };
}

function deleteFlowById(flowId) {
  ensureFlowState();
  if (state.activeFlowId === flowId && state.flowRecording) {
    return { ok: false, error: 'RECORDING_ACTIVE' };
  }
  var flow = getFlowById(flowId);
  if (!flow) return { ok: false, error: 'FLOW_NOT_FOUND' };
  var toolNames = (flow.mcpToolNames || []).slice();
  unassignToolsFromFlow(toolNames, { sync: false });
  var host = flow.hostname || location.hostname;
  var flowsObj = loadFlowsObjectForHostname(host);
  delete flowsObj[flowId];
  persistFlowsObjectForHostname(host, flowsObj);
  removeFlowFromViewDataset(flowId);
  if (state.flowUi && state.flowUi.selectedFlowId === flowId) {
    state.flowUi.selectedFlowId = null;
  }
  syncFlowMembershipAndMcp();
  return { ok: true };
}

function pruneMissingToolRefs(flowId) {
  var flow = getFlowById(flowId);
  if (!flow) return { ok: false, error: 'FLOW_NOT_FOUND' };
  var toolsMap = typeof getMcpListToolsMap === 'function' ? getMcpListToolsMap() : (state.mcpTools || {});
  var kept = [];
  var removed = 0;
  var i;
  for (i = 0; i < (flow.mcpToolNames || []).length; i++) {
    var tn = flow.mcpToolNames[i];
    if (toolsMap[tn]) kept.push(tn);
    else removed++;
  }
  flow.mcpToolNames = kept;
  persistFlowRecord(flow);
  return { ok: true, removed: removed };
}

function syncFlowMembershipAndMcp() {
  if (typeof saveMcpTools === 'function') saveMcpTools();
  try {
    chrome.runtime.sendMessage({ type: 'MCP_SYNC_TOOLS' });
  } catch (e) {}
}

function buildFlowTreeGroups(toolsMap, flowsMap, options) {
  options = options || {};
  toolsMap = toolsMap || {};
  flowsMap = flowsMap || {};
  var filteredSet = options.filteredToolSet || null;
  var hostByTool = options.hostByTool || {};

  var systemTools = [];
  var otherTools = [];
  var byFlowId = {};
  var flowIdsFromMap = Object.keys(flowsMap);
  var fi;
  for (fi = 0; fi < flowIdsFromMap.length; fi++) {
    byFlowId[flowIdsFromMap[fi]] = [];
  }

  var toolNames = Object.keys(toolsMap);
  var ti;
  for (ti = 0; ti < toolNames.length; ti++) {
    var name = toolNames[ti];
    if (filteredSet && !filteredSet[name]) continue;
    var tool = toolsMap[name];
    if (!tool) continue;
    if (typeof isFlowContextSystemToolName === 'function' && isFlowContextSystemToolName(name)) {
      systemTools.push(name);
      continue;
    }
    if (tool._meta && tool._meta.flowContextSystem) {
      systemTools.push(name);
      continue;
    }
    var flowId = tool._meta && tool._meta.flow && tool._meta.flow.flowId;
    if (flowId) {
      if (!byFlowId[flowId]) byFlowId[flowId] = [];
      byFlowId[flowId].push(name);
    } else {
      otherTools.push(name);
    }
  }

  var namedGroups = [];
  var duplicateNames = {};
  var nameCounts = {};
  for (fi = 0; fi < flowIdsFromMap.length; fi++) {
    var f = flowsMap[flowIdsFromMap[fi]];
    if (!f) continue;
    var fn = f.name || f.id;
    nameCounts[fn] = (nameCounts[fn] || 0) + 1;
  }
  for (fi = 0; fi < flowIdsFromMap.length; fi++) {
    var fid = flowIdsFromMap[fi];
    var flow = flowsMap[fid];
    if (!flow) continue;
    var title = flow.name || flow.id;
    var subtitle = '';
    if (flow.hostname === '*') subtitle = '\u8de8\u7ad9';
    else if (nameCounts[title] > 1) subtitle = flow.hostname || '';
    var missingRefs = [];
    var mcpNames = flow.mcpToolNames || [];
    var mi;
    for (mi = 0; mi < mcpNames.length; mi++) {
      if (!toolsMap[mcpNames[mi]]) missingRefs.push(mcpNames[mi]);
    }
    namedGroups.push({
      key: fid,
      title: title,
      subtitle: subtitle,
      flowId: fid,
      kind: inferFlowKind(flow),
      tools: sortToolsByFlowOrder(flow, byFlowId[fid] || []),
      missingRefs: missingRefs,
      flow: flow
    });
    delete byFlowId[fid];
  }

  var orphanFlowIds = Object.keys(byFlowId);
  for (fi = 0; fi < orphanFlowIds.length; fi++) {
    var ofid = orphanFlowIds[fi];
    if (!byFlowId[ofid] || byFlowId[ofid].length === 0) continue;
    var sampleTool = toolsMap[byFlowId[ofid][0]];
    var sampleMeta = sampleTool && sampleTool._meta && sampleTool._meta.flow;
    namedGroups.push({
      key: ofid,
      title: (sampleMeta && sampleMeta.flowName) || ofid,
      subtitle: (sampleMeta && sampleMeta.hostname) || '',
      flowId: ofid,
      kind: 'recorded',
      tools: (byFlowId[ofid] || []).sort(),
      missingRefs: [],
      flow: null
    });
  }

  namedGroups.sort(function (a, b) {
    return String(a.title).localeCompare(String(b.title), 'zh-CN');
  });

  systemTools.sort();
  otherTools.sort();

  return [
    {
      key: '__system__',
      title: '系统工具',
      flowId: null,
      kind: 'system',
      tools: systemTools,
      missingRefs: [],
      flow: null
    }
  ].concat(namedGroups).concat([
    {
      key: '__other__',
      title: '其他',
      flowId: null,
      kind: 'other',
      tools: otherTools,
      missingRefs: [],
      flow: null
    }
  ]);
}

function buildFilteredToolNameSet(toolsMap, ui) {
  var set = {};
  if (!toolsMap) return set;
  var kwLower = (ui && ui.keyword || '').trim().toLowerCase();
  var keys = Object.keys(toolsMap);
  var i;
  for (i = 0; i < keys.length; i++) {
    var nm = keys[i];
    var tl = toolsMap[nm];
    if (!tl) continue;
    if (typeof passesMcpListFilters === 'function' && !passesMcpListFilters(tl, ui)) continue;
    if (typeof mcpToolMatchesKeyword === 'function' && !mcpToolMatchesKeyword(tl, nm, kwLower)) continue;
    set[nm] = true;
  }
  return set;
}

function listAssignableFlows() {
  var map = getMergedFlowsMap();
  var ids = Object.keys(map);
  var out = [];
  var i;
  for (i = 0; i < ids.length; i++) {
    var f = map[ids[i]];
    if (!f) continue;
    out.push({ id: f.id, name: f.name || f.id, kind: inferFlowKind(f) });
  }
  out.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name), 'zh-CN');
  });
  return out;
}
