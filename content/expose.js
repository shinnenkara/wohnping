(function () {
  const Immo = globalThis.Immo;

  function exposeId() {
    const match = location.pathname.match(/\/expose\/(\d+)/);
    return match ? match[1] : "";
  }

  function showNote(text, warn) {
    document.querySelectorAll("[data-immo-ext='expose-note']").forEach((el) => el.remove());
    const bar = document.createElement("div");
    bar.dataset.immoExt = "expose-note";
    bar.style.cssText = [
      "all: initial",
      "position: fixed",
      "z-index: 2147483646",
      "left: 12px",
      "bottom: 12px",
      "max-width: 360px",
      "box-sizing: border-box",
      "padding: 10px 12px",
      "border-radius: 10px",
      "font: 13px/1.4 system-ui, sans-serif",
      "box-shadow: 0 8px 24px rgba(0,0,0,.18)",
      warn ? "background: #fff7ed; color: #9a3412;" : "background: #f0fdfa; color: #115e59;",
    ].join(";");
    bar.textContent = text;
    document.documentElement.appendChild(bar);
  }

  async function maybeFill(force) {
    const id = exposeId();
    if (!id) return;
    let decision;
    try {
      decision = await chrome.runtime.sendMessage({ type: "should-fill", id, force: !!force });
    } catch {
      return;
    }
    if (!decision || !decision.fill) return;
    let result;
    try {
      result = await Immo.contactForm.fill(decision.profile || {});
    } catch {
      showNote("Das Formular konnte nicht ausgefüllt werden.", true);
      return;
    }
    if (result.status === "login") {
      showNote("Bitte bei ImmoScout anmelden. Das Formular wurde nicht ausgefüllt.", true);
    } else if (result.status === "no-form") {
      showNote("Kein Freitext-Formular auf diesem Inserat.", true);
    } else {
      showNote(result.detail || "Ausgefüllt. Bitte prüfen und selbst senden.", false);
    }
    try {
      await chrome.runtime.sendMessage({ type: "fill-result", id, status: result.status });
    } catch {
      /* the note on the page still explains the result */
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "fill-now") return;
    maybeFill(true).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ error: String(err) })
    );
    return true;
  });

  let ownBar = false;

  function drawFillBar(state) {
    if (!state || state.isWatchTab || !state.watching) {
      if (ownBar) {
        Immo.pageBar.clear();
        ownBar = false;
      }
      return;
    }
    Immo.pageBar.mount({
      text: state.paused
        ? "Pause. Dieses Inserat kannst du trotzdem ausfüllen."
        : "Dieses Inserat kannst du ausfüllen. Senden bleibt bei dir.",
      actions: [{ label: "Inserat ausfüllen", onClick: () => maybeFill(true) }],
    });
    ownBar = true;
  }

  async function syncFillBar() {
    let gate;
    try {
      gate = await chrome.runtime.sendMessage({ type: "watch-gate", url: location.href });
    } catch {
      return;
    }
    if (gate && gate.isWatchTab) return;
    let local = {};
    try {
      local = await chrome.storage.local.get(["watching", "paused"]);
    } catch {
      return;
    }
    drawFillBar({ watching: !!local.watching, paused: !!local.paused });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes.watching && !changes.paused) return;
    syncFillBar();
  });

  function captureExpose() {
    const id = exposeId();
    if (!id || !Immo.expose) return;
    let sent = false;
    const publish = (force) => {
      if (sent) return true;
      let parsed;
      try {
        parsed = Immo.expose.parse(document);
      } catch {
        return false;
      }
      const galleryKnown = Object.prototype.hasOwnProperty.call(parsed.details, "photoCount");
      const ready = !!(parsed.details.coldRent && parsed.details.landlord && galleryKnown);
      const hasPayload = !!(parsed.title || Object.keys(parsed.details).length);
      if ((!ready && !force) || !hasPayload) return false;
      sent = true;
      try {
        const pending = chrome.runtime.sendMessage({
          type: "expose-details",
          id,
          title: parsed.title || "",
          details: parsed.details,
        });
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      } catch {
        /* the listing page can close before the worker answers */
      }
      return true;
    };
    if (publish(false)) return;
    const root = document.querySelector("#is24-content") || document.body;
    const observer = new MutationObserver(() => {
      if (publish(false)) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      publish(true);
    }, 8000);
  }

  syncFillBar();
  maybeFill(false);
  captureExpose();
})();
