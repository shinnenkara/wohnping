(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  const ICONS = {
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
  };

  function button({ label, variant, title, icon, onClick }) {
    const el = document.createElement("button");
    el.type = "button";
    if (icon) {
      el.className = variant ? `icon ${variant}` : "icon";
      el.setAttribute("aria-label", label);
      el.title = title || label;
      el.innerHTML = icon;
    } else {
      el.textContent = label;
      if (variant) el.className = variant;
      if (title) el.title = title;
    }
    if (onClick) el.addEventListener("click", onClick);
    return el;
  }

  function sessionControls(state, handlers) {
    const actions = [];
    if (!state.watching) {
      actions.push(button({ label: "Starten", onClick: handlers.start }));
    } else if (state.paused) {
      actions.push(
        button({ label: "Fortsetzen", icon: ICONS.play, onClick: handlers.resume }),
        button({ label: "Stopp", variant: "secondary", onClick: handlers.stop })
      );
    } else {
      actions.push(
        button({ label: "Pause", icon: ICONS.pause, onClick: handlers.pause }),
        button({ label: "Stopp", variant: "secondary", onClick: handlers.stop })
      );
    }
    if (state.watching && state.watchTabOpen) {
      actions.push(button({
        label: "Neu laden",
        icon: ICONS.refresh,
        variant: "secondary",
        onClick: handlers.reload,
      }));
    }
    return actions;
  }

  function watchTabControls(state, handlers) {
    if (!state.watching || !state.watchTabOpen) return [];
    const label = document.createElement("span");
    label.className = "watch-tab-label";
    label.textContent = "Watch-Tab";
    const actions = [
      label,
      button({ label: "Zeigen", variant: "secondary", title: "Watch-Tab zeigen", onClick: handlers.show }),
      button({ label: "Schließen", variant: "secondary", title: "Watch-Tab schließen", onClick: handlers.close }),
    ];
    if (state.watchOffSearch) {
      actions.push(button({ label: "Zur Suche", variant: "secondary", onClick: handlers.returnToSearch }));
    }
    return actions;
  }

  function watchStatus(state) {
    if (!state.watching) return "Aus";
    if (state.paused) return "Pause";
    return "Beobachtet";
  }

  function formatStamp(ts) {
    const date = new Date(ts);
    const now = new Date();
    const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const full = date.toLocaleString("de-DE");
    let label = time;
    if (date.toDateString() !== now.toDateString()) {
      const sameYear = date.getFullYear() === now.getFullYear();
      const day = date.toLocaleDateString("de-DE", sameYear
        ? { day: "numeric", month: "numeric" }
        : { day: "numeric", month: "numeric", year: "numeric" });
      label = `${day} ${time}`;
    }
    return { label, full };
  }

  function reloadLabel(ts) {
    const shown = formatStamp(ts);
    return { label: `Letztes Laden ${shown.label}`, full: shown.full };
  }

  function applyStatus(state, statusEl, detailEl) {
    statusEl.textContent = watchStatus(state);
    if (!state.lastReloadAt) {
      detailEl.textContent = "";
      detailEl.removeAttribute("title");
      return;
    }
    const shown = reloadLabel(state.lastReloadAt);
    detailEl.textContent = shown.label;
    detailEl.title = shown.full;
  }

  function watchNotes(state, options) {
    const notes = [];
    if (state.storageError) {
      const err = state.storageError;
      const keys = Array.isArray(err.keys) ? err.keys.join(", ") : "";
      notes.push(`Speichern fehlgeschlagen (${err.operation}${keys ? `: ${keys}` : ""}): ${err.message}`);
    }
    if (state.watchMissing) notes.push("Der Watch-Tab wurde geschlossen. Bitte erneut starten.");
    if (state.watchOffSearch) notes.push("Der Watch-Tab ist nicht mehr auf der Suchseite.");
    if (options && options.includeWarnings && state.warnings && state.warnings.length) {
      notes.push(...state.warnings);
    }
    return notes.join(" ");
  }

  Immo.actions = {
    button,
    sessionControls,
    watchTabControls,
    applyStatus,
    formatStamp,
    watchNotes,
  };
})(globalThis);
