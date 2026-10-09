(function () {
  const Immo = globalThis.Immo;
  let paused = false;
  let watching = false;

  function send(message) {
    return chrome.runtime.sendMessage(message);
  }

  function stripPrefix(title) {
    return String(title || "").replace(/^(Wohnping|Pause|Watch|Paused) · /, "");
  }

  function applyTitle() {
    if (!watching) {
      const raw = stripPrefix(document.title);
      if (document.title !== raw) document.title = raw;
      return;
    }
    const prefix = paused ? "Pause · " : "Wohnping · ";
    const raw = stripPrefix(document.title);
    const next = prefix + raw;
    if (document.title !== next) document.title = next;
  }

  function drawBar(state) {
    state = { ...state, offSearch: !!(state.offSearch || state.watchOffSearch) };
    paused = !!state.paused;
    watching = !!state.watching && !!state.isWatchTab;
    if (!state.isWatchTab || !state.watching) {
      Immo.pageBar.clear();
      applyTitle();
      return;
    }

    let text = "Dieser Tab wird etwa alle ein bis fünf Minuten neu geladen, um neue Angebote zu finden. Ein Inserat öffnet einen neuen Tab.";
    if (state.paused) {
      text = "Pause. Dieser Tab wird nicht neu geladen.";
    } else if (state.offSearch) {
      text = "Dieser Tab ist nicht mehr auf der Suchseite. Es wird nichts gelesen, bis du zurück zur Suche gehst.";
    }

    const actions = [
      { label: "Neu laden", onClick: () => send({ type: "reload-watch-tab" }) },
    ];
    if (state.offSearch) {
      actions.push({ label: "Zurück zur Suche", onClick: () => send({ type: "return-to-search" }) });
    }
    if (state.paused) {
      actions.push({
        label: "Fortsetzen",
        onClick: async () => {
          const res = await send({ type: "resume" });
          if (res && res.state) drawBar({ ...res.state, isWatchTab: true });
        },
      });
    } else {
      actions.push({
        label: "Pause",
        onClick: async () => {
          const res = await send({ type: "pause" });
          if (res && res.state) drawBar({ ...res.state, isWatchTab: true });
        },
      });
    }
    actions.push({ label: "Stopp", onClick: () => send({ type: "stop" }) });

    Immo.pageBar.mount({ text, actions });
    applyTitle();
  }

  function interceptClicks() {
    document.addEventListener(
      "click",
      (event) => {
        if (!watching) return;
        const link = event.target && event.target.closest ? event.target.closest('a[href*="/expose/"]') : null;
        if (!link || link.closest("[data-immo-ext]")) return;
        event.preventDefault();
        event.stopPropagation();
        window.open(link.href, "_blank", "noopener");
      },
      true
    );
  }

  let titleObserver;
  function watchTitle() {
    applyTitle();
    const titleEl = document.querySelector("title");
    if (!titleEl || titleObserver) return;
    titleObserver = new MutationObserver(() => applyTitle());
    titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "watch-state") return;
    drawBar(message);
    sendResponse({ ok: true });
  });

  async function init() {
    let gate;
    try {
      gate = await send({ type: "watch-gate", url: location.href });
    } catch {
      return;
    }
    if (!gate || !gate.isWatchTab) return;
    interceptClicks();
    watchTitle();
    drawBar(gate);
    if (!gate.watching || gate.offSearch) return;
    let listings = [];
    try {
      listings = Immo.search.parseSearchResults(document);
    } catch {
      listings = [];
    }
    try {
      await send({ type: "watch-loaded", url: location.href, listings });
    } catch {
      /* the bar already explains the tab */
    }
  }

  init();
})();
