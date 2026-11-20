// @extension/hmr dev-only injection (page flavor) — prepended into extension-page chunks
// (popup/options) by watchRebuildPlugin, wrapped in an IIFE that defines __HMR_ID and __HMR_URL. Reloads the
// document when a rebuild lands, deferring while the tab is hidden; re-dials every 2 s while the server is away.
// Never present in prod builds.
(function connect() {
  let ws;
  try {
    ws = new WebSocket(__HMR_URL);
  } catch (ignored) {
    return; // dev convenience only — never break the page if the reload server is absent
  }
  ws.onerror = () => {};
  ws.onclose = () => setTimeout(connect, 2_000);
  ws.onmessage = event => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.type === 'do_update' && message.id === __HMR_ID) {
        ws.onclose = null;
        try {
          ws.send(JSON.stringify({ type: 'done_update' }));
        } catch (ignored) {
          // reload server went away mid-update — the reload below still runs
        }
        const doReload = () => window.location.reload();
        if (document.hidden) {
          const onVisible = () => {
            document.removeEventListener('visibilitychange', onVisible);
            doReload();
          };
          document.addEventListener('visibilitychange', onVisible);
        } else {
          doReload();
        }
      }
    } catch (ignored) {
      // not a reload-server message — ignore
    }
  };
})();
