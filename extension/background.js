'use strict';

var MENU_IDS = {
  OPEN_PANEL: 'ai_req_analyzer_open_panel',
  OPEN_CONFIG: 'ai_req_analyzer_open_config',
  RESET_POS: 'ai_req_analyzer_reset_positions',
  DIAG: 'ai_req_analyzer_diagnostics'
};

function installMenus() {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: MENU_IDS.OPEN_PANEL,
      title: '打开请求分析面板',
      contexts: ['page', 'frame', 'editable', 'link', 'selection', 'audio', 'video', 'image']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.OPEN_CONFIG,
      title: '配置',
      contexts: ['page', 'frame', 'editable', 'link', 'selection', 'audio', 'video', 'image']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.RESET_POS,
      title: '重置悬浮窗位置',
      contexts: ['page', 'frame', 'editable', 'link', 'selection', 'audio', 'video', 'image']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.DIAG,
      title: '诊断运行状态',
      contexts: ['page', 'frame', 'editable', 'link', 'selection', 'audio', 'video', 'image']
    });
  });
}

chrome.runtime.onInstalled.addListener(function () {
  installMenus();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(function () {
    installMenus();
  });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab || typeof tab.id === 'undefined') return;
  var action = null;
  if (info.menuItemId === MENU_IDS.OPEN_PANEL) action = 'open_panel';
  else if (info.menuItemId === MENU_IDS.OPEN_CONFIG) action = 'open_config';
  else if (info.menuItemId === MENU_IDS.RESET_POS) action = 'reset_positions';
  else if (info.menuItemId === MENU_IDS.DIAG) action = 'diagnostics';
  if (!action) return;
  chrome.tabs.sendMessage(tab.id, {
    type: 'AI_REQ_ANALYZER_MENU',
    action: action
  }).catch(function () {});
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return;

  if (message.type === 'INJECT_PAGE_HOOK') {
    var tabId = sender.tab && sender.tab.id;
    if (typeof tabId === 'undefined') {
      sendResponse({ ok: false, error: 'no sender.tab（内容脚本发往后台即可获得 tab）' });
      return false;
    }
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId, allFrames: false },
        world: 'MAIN',
        files: ['content/page-hook.js']
      },
      function () {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message || 'executeScript failed'
          });
        } else {
          sendResponse({ ok: true });
        }
      }
    );
    return true;
  }

  if (message.type === 'READ_PAGE_HOOK_INSTALLED') {
    var tid = sender.tab && sender.tab.id;
    if (typeof tid === 'undefined') {
      sendResponse({ hooked: false, error: 'no tab id' });
      return false;
    }
    chrome.scripting.executeScript(
      {
        target: { tabId: tid, allFrames: false },
        world: 'MAIN',
        func: function () {
          try {
            return !!window.__AI_REQ_ANALYZER_HOOKED__;
          } catch (e) {
            return false;
          }
        }
      },
      function (results) {
        if (chrome.runtime.lastError) {
          sendResponse({ hooked: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({
          hooked: !!(results && results[0] && results[0].result)
        });
      }
    );
    return true;
  }

  if (message.type !== 'AI_CHAT_COMPLETIONS') return;

  var p = message.payload || {};
  var url = p.url;
  var apiKey = p.apiKey;
  var model = p.model;
  var messages = p.messages;
  var temperature = p.temperature;

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: temperature
    })
  })
    .then(function (res) {
      return res.text().then(function (text) {
        return { ok: res.ok, status: res.status, text: text };
      });
    })
    .then(function (r) {
      try {
        var data = JSON.parse(r.text);
        if (data.choices && data.choices[0] && data.choices[0].message) {
          sendResponse({
            ok: true,
            content: data.choices[0].message.content
          });
        } else {
          sendResponse({
            ok: false,
            error: 'AI返回格式异常: ' + r.text
          });
        }
      } catch (e) {
        sendResponse({
          ok: false,
          error: '解析AI响应失败: ' + e.message + ' · ' + (r.text || '').slice(0, 200)
        });
      }
    })
    .catch(function (err) {
      sendResponse({
        ok: false,
        error: 'AI请求失败: ' + (err && err.message ? err.message : String(err))
      });
    });

  return true;
});
