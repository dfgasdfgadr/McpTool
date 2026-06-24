var STORAGE_CACHE = {};

function isExtensionContextValid() {
  try {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.id === 'string' && chrome.runtime.id.length > 0);
  } catch (e) {
    return false;
  }
}

var extensionContextInvalidLogged = false;
function warnExtensionContextInvalidOnce() {
  if (extensionContextInvalidLogged) return;
  extensionContextInvalidLogged = true;
  console.warn('[AI_REQ_ANALYZER] 扩展已重载或更新，当前页面脚本已失效。请刷新本页后再使用（Extension context invalidated）。');
}

function storageGet(key, defVal) {
  if (Object.prototype.hasOwnProperty.call(STORAGE_CACHE, key)) return STORAGE_CACHE[key];
  return defVal;
}

function storageSet(key, val) {
  if (!isExtensionContextValid()) {
    warnExtensionContextInvalidOnce();
    return;
  }
  if (val === null || typeof val === 'undefined') {
    delete STORAGE_CACHE[key];
    try {
      chrome.storage.local.remove(key);
    } catch (e) {}
    return;
  }
  STORAGE_CACHE[key] = val;
  var o = {};
  o[key] = val;
  try {
    chrome.storage.local.set(o, function () {
      if (chrome.runtime.lastError) {
        console.warn('[AI_REQ_ANALYZER] storageSet error:', chrome.runtime.lastError.message);
      }
    });
  } catch (e) {
    console.warn('[AI_REQ_ANALYZER] storageSet exception:', e.message);
  }
}

function storageHydrateThen(cb) {
  if (!isExtensionContextValid()) {
    warnExtensionContextInvalidOnce();
    try {
      if (typeof cb === 'function') cb();
    } catch (eCb) {}
    return;
  }
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
  temperature: 1,
  mcpPort: 9527,
  mcpToken: '',
  mcpAutoSync: false,
  mcpToolNaming: 'full',
  mcpExportPath: '',
  enableFlowContextListTool: true,
  enableFlowContextDetailTool: true,
  enableBrainstormMcpTool: true
};

var CONFIG_KEY = 'ai_req_analyzer_config';
var MOCK_RULES_KEY_PREFIX = 'ai_req_mock_rules_';
var FLOWS_KEY_PREFIX = 'ai_req_flows_';
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
  ui: {
    activeMainTab: 'requests',
    requestKeyword: ''
  },
  uiReady: false,
  menuReady: false,
  mcpTools: {},
  flows: {},
  activeFlowId: null,
  flowRecording: false,
  activeFlowLastStepId: null,
  activeFlowLastActionAt: 0,
  flowUi: {
    selectedFlowId: null,
    selectedStepId: null,
    filterClassification: 'all'
  },
  recordingTrayVisible: false,
  recordingTrayEl: null,
  activeFlowRecordingSignatures: null,
  mcpPanelTab: 'list',
  listFilters: {
    dupOnly: false,
    mock: 'all',
    analyzed: 'all',
    methods: {},
    groupMode: 'none'
  },
  selectedReqIds: {},
  selectedMcpToolNames: {},
  mcpUseEnhancedGeneration: false,
  mcpViewDataset: null,
  mcpListUi: {
    keyword: '',
    viewMode: 'flowTree',
    groupMode: 'none',
    filterEnabled: 'all',
    riskLevels: {},
    toolbarCollapsed: false,
    siteFilter: 'all',
    selectedToolName: null,
    selectedFlowId: null,
    collapsedFlowIds: {},
    inspectorOpen: false,
    scrollToFlowId: null
  },
  fieldSources: {},
  provenanceSelectionReady: false
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

function getFlowsKey(hostname) {
  return FLOWS_KEY_PREFIX + (hostname || location.hostname);
}

function ensureFlowState() {
  if (!state.flows || typeof state.flows !== 'object') state.flows = {};
  if (!state.flowUi || typeof state.flowUi !== 'object') {
    state.flowUi = {
      selectedFlowId: null,
      selectedStepId: null,
      filterClassification: 'all'
    };
  }
  if (!state.flowUi.filterClassification) state.flowUi.filterClassification = 'all';
}

function loadFlows() {
  ensureFlowState();
  try {
    var saved = storageGet(getFlowsKey(), null);
    if (saved) {
      var parsed = JSON.parse(saved);
      state.flows = parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch (e) {
    state.flows = {};
  }
}

function saveFlows() {
  ensureFlowState();
  storageSet(getFlowsKey(), JSON.stringify(state.flows || {}));
}

function createFlow(name) {
  ensureFlowState();
  var id = 'flow_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  var flow = {
    id: id,
    kind: 'recorded',
    name: name || '未命名流程',
    hostname: location.hostname,
    startedAt: Date.now(),
    endedAt: null,
    steps: [],
    verifiedRequestIds: [],
    classifications: {},
    requestMeta: {},
    manualVerificationOverrides: {},
    notes: '',
    mcpToolNames: []
  };
  state.flows[id] = flow;
  state.activeFlowId = id;
  state.flowRecording = true;
  state.activeFlowLastStepId = null;
  state.activeFlowLastActionAt = 0;
  state.activeFlowRecordingSignatures = {};
  state.flowUi.selectedFlowId = id;
  state.flowUi.selectedStepId = null;
  saveFlows();
  return flow;
}

function getActiveFlow() {
  ensureFlowState();
  if (!state.activeFlowId) return null;
  return state.flows[state.activeFlowId] || null;
}

function finishFlow(flowId) {
  ensureFlowState();
  var id = flowId || state.activeFlowId;
  if (!id || !state.flows[id]) return null;
  state.flows[id].endedAt = Date.now();
  if (state.activeFlowId === id) {
    state.flowRecording = false;
    state.activeFlowId = null;
    state.activeFlowLastStepId = null;
    state.activeFlowLastActionAt = 0;
    state.activeFlowRecordingSignatures = null;
  }
  saveFlows();
  return state.flows[id];
}
