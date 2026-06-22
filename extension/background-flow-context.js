'use strict';

var FLOW_CONTEXT_LIST_TOOL = 'list_recorded_flows';
var FLOW_CONTEXT_DETAIL_TOOL = 'get_recorded_flow_context';
var FLOW_CONTEXT_FLOWS_PREFIX = 'ai_req_flows_';
var FLOW_CONTEXT_TOOLS_PREFIX = 'ai_req_mcp_tools_';
var FLOW_CONTEXT_CONFIG_KEY = 'ai_req_analyzer_config';
var FLOW_CONTEXT_GUIDANCE =
  '步骤仅用于理解业务语境，不要求按顺序执行。请根据用户目标选择最相关的工具。' +
  '不要仅因为参考步骤出现写操作就自动调用写工具，必须以用户当前明确目标为准。';

function isFlowContextSystemTool(toolName) {
  return toolName === FLOW_CONTEXT_LIST_TOOL || toolName === FLOW_CONTEXT_DETAIL_TOOL;
}

function parseExtensionConfigFromItems(items) {
  var cfg = {
    enableFlowContextListTool: true,
    enableFlowContextDetailTool: true
  };
  try {
    var raw = items && items[FLOW_CONTEXT_CONFIG_KEY];
    if (!raw) return cfg;
    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      if (parsed.enableFlowContextListTool === false) cfg.enableFlowContextListTool = false;
      if (parsed.enableFlowContextDetailTool === false) cfg.enableFlowContextDetailTool = false;
    }
  } catch (e) {}
  return cfg;
}

function buildFlowContextSystemToolDefinitions(config) {
  var defs = {};
  if (config.enableFlowContextListTool !== false) {
    defs[FLOW_CONTEXT_LIST_TOOL] = {
      name: FLOW_CONTEXT_LIST_TOOL,
      description:
        '列出当前已录制的业务流程及其关联 MCP 工具数量。' +
        '当用户未明确流程名，或需要查看有哪些流程可用时调用。',
      inputSchema: { type: 'object', properties: {} },
      enabled: true,
      _meta: { flowContextSystem: true, kind: 'list_flows' }
    };
  }
  if (config.enableFlowContextDetailTool !== false) {
    defs[FLOW_CONTEXT_DETAIL_TOOL] = {
      name: FLOW_CONTEXT_DETAIL_TOOL,
      description:
        '根据录制流程名称或 ID 查询该流程相关的 MCP 工具集、参考步骤和使用建议。' +
        '当用户说“使用/按照/基于 XXX 流程”或提到某个已录制业务流程时，应先调用本工具获取上下文。' +
        '返回的步骤仅用于理解业务语境，不要求按顺序执行。',
      inputSchema: {
        type: 'object',
        properties: {
          flowName: { type: 'string', description: '录制流程名称' },
          flowId: { type: 'string', description: '录制流程 ID，优先于 flowName' }
        }
      },
      enabled: true,
      _meta: { flowContextSystem: true, kind: 'flow_context' }
    };
  }
  return defs;
}

function appendFlowContextSystemTools(toolsObj, config) {
  var defs = buildFlowContextSystemToolDefinitions(config || {});
  var keys = Object.keys(defs);
  for (var i = 0; i < keys.length; i++) {
    toolsObj[keys[i]] = defs[keys[i]];
  }
  return toolsObj;
}

function parseStoredJsonObject(raw) {
  if (!raw) return null;
  try {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (typeof raw === 'object') return raw;
  } catch (e) {}
  return null;
}

function buildRecordedFlowDataset(items) {
  var flowsByHost = {};
  var toolsByHost = {};
  var allFlows = [];
  var storageKeys = Object.keys(items || {});
  var ki;
  for (ki = 0; ki < storageKeys.length; ki++) {
    var key = storageKeys[ki];
    if (key.indexOf(FLOW_CONTEXT_FLOWS_PREFIX) === 0) {
      var flowHost = key.substring(FLOW_CONTEXT_FLOWS_PREFIX.length);
      var flowsObj = parseStoredJsonObject(items[key]);
      if (!flowsObj || typeof flowsObj !== 'object') continue;
      flowsByHost[flowHost] = flowsObj;
      var fk = Object.keys(flowsObj);
      for (var fi = 0; fi < fk.length; fi++) {
        var f = flowsObj[fk[fi]];
        if (!f || !f.id) continue;
        allFlows.push({ hostname: flowHost, flow: f });
      }
      continue;
    }
    if (key.indexOf(FLOW_CONTEXT_TOOLS_PREFIX) === 0) {
      var toolHost = key.substring(FLOW_CONTEXT_TOOLS_PREFIX.length);
      var toolsObj = parseStoredJsonObject(items[key]);
      if (toolsObj && typeof toolsObj === 'object') {
        toolsByHost[toolHost] = toolsObj;
      }
    }
  }
  return {
    flowsByHost: flowsByHost,
    toolsByHost: toolsByHost,
    allFlows: allFlows
  };
}

function normalizeFlowNameText(name) {
  return String(name || '').trim().toLowerCase();
}

function inferFlowKind(flow) {
  if (!flow) return 'manual';
  if (flow.kind === 'manual' || flow.kind === 'recorded') return flow.kind;
  if ((flow.steps && flow.steps.length) || (flow.verifiedRequestIds && flow.verifiedRequestIds.length)) {
    return 'recorded';
  }
  return 'manual';
}

function countFlowTools(flow, toolsObj) {
  var names = (flow && flow.mcpToolNames) || [];
  var n = 0;
  for (var i = 0; i < names.length; i++) {
    if (toolsObj && toolsObj[names[i]]) n++;
  }
  return n;
}

function handleListRecordedFlows(dataset) {
  var list = (dataset && dataset.allFlows) || [];
  list.sort(function (a, b) {
    var ta = (a.flow.endedAt || a.flow.startedAt || 0);
    var tb = (b.flow.endedAt || b.flow.startedAt || 0);
    return tb - ta;
  });
  var flows = [];
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    var flow = entry.flow;
    var toolsObj = (dataset.toolsByHost && dataset.toolsByHost[entry.hostname]) || {};
    var kind = inferFlowKind(flow);
    flows.push({
      id: flow.id,
      name: flow.name || flow.id,
      hostname: entry.hostname,
      kind: kind,
      toolCount: ((flow.mcpToolNames || []).length),
      linkedToolCount: countFlowTools(flow, toolsObj),
      stepCount: (flow.steps || []).length,
      updatedAt: flow.endedAt || flow.startedAt || 0,
      summary: kind === 'manual' ? '手动工具分组' : ((flow.name || flow.id) + ' 相关流程')
    });
  }
  if (flows.length === 0) {
    return {
      ok: true,
      flows: [],
      message: '暂无已录制流程。请先在扩展 Flow 页录制并生成 MCP 工具。'
    };
  }
  return { ok: true, flows: flows };
}

function findFlowsByQuery(dataset, flowId, flowName) {
  var idTrim = String(flowId || '').trim();
  if (idTrim) {
    var exact = [];
    var list = dataset.allFlows || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].flow.id === idTrim) exact.push(list[i]);
    }
    return { mode: 'id', matches: exact };
  }
  var nameTrim = String(flowName || '').trim();
  if (!nameTrim) {
    return { mode: 'none', matches: [] };
  }
  var norm = normalizeFlowNameText(nameTrim);
  var exactName = [];
  var partial = [];
  for (var j = 0; j < (dataset.allFlows || []).length; j++) {
    var item = dataset.allFlows[j];
    var fn = normalizeFlowNameText(item.flow.name || '');
    if (fn === norm) exactName.push(item);
    else if (fn.indexOf(norm) >= 0 || norm.indexOf(fn) >= 0) partial.push(item);
  }
  if (exactName.length) return { mode: 'exact', matches: exactName };
  return { mode: 'partial', matches: partial };
}

function extractStepRefsFromToolMeta(meta) {
  var refs = [];
  var steps = (meta && meta.flow && meta.flow.steps) || [];
  for (var i = 0; i < steps.length; i++) {
    var idx = steps[i].stepIndex;
    if (typeof idx === 'number' && refs.indexOf(idx) < 0) refs.push(idx);
  }
  refs.sort(function (a, b) { return a - b; });
  return refs;
}

function buildFlowToolEntry(toolName, toolDef) {
  if (!toolDef) {
    return {
      name: toolName,
      status: 'missing',
      warning: '该工具已被删除或未同步。'
    };
  }
  var meta = toolDef._meta || {};
  var required = (toolDef.inputSchema && toolDef.inputSchema.required) || [];
  var status = 'available';
  var warning = '';
  if (toolDef.enabled === false) {
    status = 'disabled';
    warning = '该工具当前未暴露给 MCP 客户端。';
  }
  var entry = {
    name: toolName,
    description: toolDef.description || '',
    method: (meta.method || 'GET').toUpperCase(),
    path: meta.pathname || '',
    riskLevel: meta.riskLevel || 'low',
    enabled: toolDef.enabled !== false,
    required: required.slice(),
    stepRefs: extractStepRefsFromToolMeta(meta),
    status: status
  };
  if (warning) entry.warning = warning;
  return entry;
}

function buildReferenceSteps(flow, toolsObj) {
  var steps = (flow && flow.steps) || [];
  var toolNames = (flow && flow.mcpToolNames) || [];
  var out = [];
  for (var si = 0; si < steps.length; si++) {
    var step = steps[si];
    var stepToolNames = [];
    for (var ti = 0; ti < toolNames.length; ti++) {
      var tn = toolNames[ti];
      var toolDef = toolsObj[tn];
      if (!toolDef) continue;
      var refs = extractStepRefsFromToolMeta(toolDef._meta || {});
      if (refs.indexOf(step.index) >= 0 && stepToolNames.indexOf(tn) < 0) {
        stepToolNames.push(tn);
      }
    }
    out.push({
      index: step.index,
      title: step.title || ('步骤 ' + step.index),
      toolNames: stepToolNames
    });
  }
  return out;
}

function assembleFlowContext(entry, toolsObj) {
  var flow = entry.flow;
  var kind = inferFlowKind(flow);
  var toolNames = (flow.mcpToolNames || []).slice();
  var tools = [];
  var warnings = [];
  for (var i = 0; i < toolNames.length; i++) {
    tools.push(buildFlowToolEntry(toolNames[i], toolsObj[toolNames[i]]));
  }
  if (toolNames.length === 0) {
    warnings.push('该流程尚未生成 MCP 工具，AI 只能参考步骤，不能直接调用相关接口。');
  }
  var guidance = FLOW_CONTEXT_GUIDANCE;
  if (kind === 'manual') {
    guidance += ' 此流程为手动工具分组，无录制步骤。';
  }
  return {
    schemaVersion: 1,
    id: flow.id,
    name: flow.name || flow.id,
    hostname: entry.hostname,
    kind: kind,
    summary: kind === 'manual' ? '手动工具分组' : ((flow.name || '未命名流程') + ' 相关流程'),
    tools: tools,
    referenceSteps: kind === 'manual' ? [] : buildReferenceSteps(flow, toolsObj),
    guidance: guidance,
    warnings: warnings.length ? warnings : undefined
  };
}

function handleGetRecordedFlowContext(dataset, toolArguments) {
  var args = toolArguments || {};
  var query = findFlowsByQuery(dataset, args.flowId, args.flowName);
  if (query.mode === 'none') {
    return {
      ok: false,
      errorCode: 'INVALID_FLOW_CONTEXT_ARGS',
      message: '请提供 flowName 或 flowId。'
    };
  }
  if (!query.matches.length) {
    return {
      ok: false,
      errorCode: 'FLOW_NOT_FOUND',
      message: '未找到匹配的录制流程。'
    };
  }
  if (query.matches.length > 1) {
    var candidates = [];
    for (var ci = 0; ci < query.matches.length; ci++) {
      candidates.push({
        id: query.matches[ci].flow.id,
        name: query.matches[ci].flow.name || query.matches[ci].flow.id,
        hostname: query.matches[ci].hostname
      });
    }
    return {
      ok: false,
      errorCode: 'AMBIGUOUS_FLOW_NAME',
      message: '找到多个名称相近的流程，请指定 flowId。',
      candidates: candidates
    };
  }
  var hit = query.matches[0];
  var hostTools = (dataset.toolsByHost && dataset.toolsByHost[hit.hostname]) || {};
  return {
    ok: true,
    flow: assembleFlowContext(hit, hostTools)
  };
}

function executeFlowContextSystemTool(toolName, toolArguments, items) {
  try {
    var dataset = buildRecordedFlowDataset(items);
    if (toolName === FLOW_CONTEXT_LIST_TOOL) {
      return handleListRecordedFlows(dataset);
    }
    if (toolName === FLOW_CONTEXT_DETAIL_TOOL) {
      return handleGetRecordedFlowContext(dataset, toolArguments);
    }
    return {
      ok: false,
      errorCode: 'FLOW_CONTEXT_SYSTEM_ERROR',
      message: '未知系统工具: ' + toolName
    };
  } catch (e) {
    return {
      ok: false,
      errorCode: 'FLOW_CONTEXT_SYSTEM_ERROR',
      message: '无法读取录制流程上下文，请确认扩展和 MCP helper 已连接并重新同步。',
      detail: e && e.message ? e.message : String(e)
    };
  }
}
