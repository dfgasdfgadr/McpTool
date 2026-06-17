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
  mcpExportPath: ''
};

var CONFIG_KEY = 'ai_req_analyzer_config';
var MOCK_RULES_KEY_PREFIX = 'ai_req_mock_rules_';
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
    groupMode: 'none',
    filterEnabled: 'all',
    riskLevels: {},
    toolbarCollapsed: false,
    siteFilter: 'all',
    selectedToolName: null,
    inspectorOpen: false
  }
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
