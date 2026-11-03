(function () {
  const Immo = globalThis.Immo;
  const PREFIX = "Wohnping · Nachrichten";

  function send(message) {
    return chrome.runtime.sendMessage(message);
  }

  function applyTitle() {
    if (document.title !== PREFIX) document.title = PREFIX;
  }

  function barText(state) {
    const counts = state.counts || {};
    const summary = `Neu ${counts.new || 0} · Aktion nötig ${counts.needsYou || 0} · Heute gesendet ${counts.sentToday || 0}`;
    if (state.paused) return `${summary}. Pause. Diese Liste wird nicht neu geladen.`;
    return `${summary}. Diese Liste wird etwa alle 15 bis 30 Minuten neu geladen.`;
  }

  function drawBar(state) {
    const actions = [{ label: "Neu laden", onClick: () => send({ type: "reload-messages-tab" }) }];
    if (state.paused) {
      actions.push({
        label: "Fortsetzen",
        onClick: async () => {
          const res = await send({ type: "resume" });
          if (res && res.state) drawBar({ ...state, ...res.state, isMessagesTab: true });
        },
      });
    } else {
      actions.push({
        label: "Pause",
        onClick: async () => {
          const res = await send({ type: "pause" });
          if (res && res.state) drawBar({ ...state, ...res.state, isMessagesTab: true });
        },
      });
    }
    actions.push({ label: "Stopp", onClick: () => send({ type: "stop" }) });
    Immo.pageBar.mount({ text: barText(state), actions });
    applyTitle();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "messages-state") return;
    drawBar(message);
    sendResponse({ ok: true });
  });

  async function publish(rows) {
    try {
      const res = await send({ type: "inbox-loaded", rows });
      return res && res.counts ? res.counts : null;
    } catch {
      return null;
    }
  }

  async function init() {
    let gate;
    try {
      gate = await send({ type: "messages-gate", url: location.href });
    } catch {
      return;
    }
    const owned = !!(gate && gate.isMessagesTab);
    if (owned) {
      applyTitle();
      drawBar(gate);
      const titleEl = document.querySelector("title");
      if (titleEl) {
        const observer = new MutationObserver(() => applyTitle());
        observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
      }
    }
    const read = () => (Immo.inbox ? Immo.inbox.parse(document) : []);
    let rows = read();
    if (!rows.length) {
      await new Promise((resolve) => {
        const root = document.querySelector('[data-testid="conversations-list"]') || document.body;
        if (!root) {
          resolve();
          return;
        }
        const observer = new MutationObserver(() => {
          rows = read();
          if (rows.length) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(root, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          rows = read();
          resolve();
        }, 8000);
      });
    }
    if (!rows.length) return;
    const counts = await publish(rows);
    if (owned && counts) drawBar({ ...gate, counts });
  }

  init();
})();
