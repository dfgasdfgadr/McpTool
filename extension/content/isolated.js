(function () {
  function init() {
    storageHydrateThen(function () {
      loadConfig();
      loadMockRules();
      loadMcpTools();
      setupMenuCommands();
      setupRequestInterception();
    });
  }

  function onDOMContentLoaded() {
    if (state.uiReady) return;
    state.uiReady = true;
    injectStyles();
    createFloatingBall();
    createMainPanel();
    createConfigPanel();
    createJsonEditor();
    createRewriteEditor();
    startDomGuard();

    if (!state.config.apiKey) {
      setTimeout(function () {
        openConfigPanel();
      }, 500);
    }
  }

  function startDomGuard() {
    setInterval(function () {
      if (state.floatingBall && !document.contains(state.floatingBall)) {
        try { getContainer().appendChild(state.floatingBall); } catch (e) {}
      }
      if (state.mainPanel && !document.contains(state.mainPanel)) {
        try { getContainer().appendChild(state.mainPanel); } catch (e2) {}
      }
      ensureElementInViewport(state.floatingBall, 56, 56, '20px', '20px');
      ensureElementInViewport(state.mainPanel, 420, 620, '90px', '20px');
    }, 2000);
  }

  init();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDOMContentLoaded);
  } else {
    onDOMContentLoaded();
  }
  window.addEventListener('load', onDOMContentLoaded);
  setTimeout(onDOMContentLoaded, 1500);
})();
