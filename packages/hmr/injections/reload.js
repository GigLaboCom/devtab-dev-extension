// @extension/hmr dev-only injection (extension flavor) — prepended into the background chunk (and any page a rule
// names) by watchRebuildPlugin, wrapped in an IIFE that defines __HMR_ID and __HMR_URL (the reload server the build
// picked: ws://localhost:<the host port>); on a rebuild it reloads the WHOLE extension. Self-contained on purpose: no imports, so it can be read raw and
// dropped into any chunk. Never present in prod builds. Re-dials every 2 s while the server is away, so a
// restarted `pnpm dev` still reloads an extension built by the previous one.
(function connect() {
  let ws;
  try {
    ws = new WebSocket(__HMR_URL);
  } catch (ignored) {
    return; // dev convenience only — never break the extension if the reload server is absent
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
        chrome.runtime.reload();
      }
    } catch (ignored) {
      // not a reload-server message — ignore
    }
  };
})();
