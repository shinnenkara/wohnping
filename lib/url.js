(function (root) {
  const Immo = root.Immo || (root.Immo = {});
  const TRACKING = /^(enteredFrom|viewMode|referrer|source|gclid|fbclid|mc|tracking)$/i;
  const MESSAGE_CAP = 2000;

  function isScoutHost(hostname) {
    return hostname === "immobilienscout24.de" || hostname.endsWith(".immobilienscout24.de");
  }

  function canonicalUrl(raw) {
    const url = new URL(raw);
    url.hash = "";
    if (url.searchParams.get("pagenumber") === "1") url.searchParams.delete("pagenumber");
    const kept = [];
    for (const [key, value] of url.searchParams.entries()) {
      if (TRACKING.test(key) || key.toLowerCase().startsWith("utm_")) continue;
      kept.push([key, value]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    url.search = "";
    for (const [key, value] of kept) url.searchParams.append(key, value);
    const path = url.pathname.replace(/\/$/, "") || "/";
    return url.origin + path + url.search;
  }

  function sameSearch(a, b) {
    if (!a || !b) return false;
    try {
      return canonicalUrl(a) === canonicalUrl(b);
    } catch {
      return false;
    }
  }

  function hasNewestSort(url) {
    const sorting = url.searchParams.get("sorting") || url.searchParams.get("sortierung");
    return sorting === "2";
  }

  function validateSearchUrl(raw) {
    const text = String(raw || "").trim();
    if (!text) return { error: "Bitte eine Such-URL einfügen." };
    let url;
    try {
      url = new URL(text);
    } catch {
      return { error: "Die URL ist ungültig." };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { error: "Die URL ist ungültig." };
    }
    if (url.hostname !== "www.immobilienscout24.de" && url.hostname !== "immobilienscout24.de") {
      return { error: "Nur Suchen von immobilienscout24.de." };
    }
    if (url.pathname.includes("/expose/")) {
      return { error: "Das ist ein Inserat, keine Suche." };
    }
    if (!url.pathname.includes("/Suche/")) {
      return { error: "Die URL muss eine Suche sein (Pfad /Suche/)." };
    }
    if (url.searchParams.get("pagenumber") === "1") url.searchParams.delete("pagenumber");
    const warnings = [];
    const page = url.searchParams.get("pagenumber");
    if (page && page !== "1") {
      warnings.push("Die URL ist nicht Seite 1. Neue Angebote stehen auf der ersten Seite.");
    }
    if (!hasNewestSort(url)) {
      warnings.push("Keine Sortierung nach Aktualität erkannt (sorting=2). Neue Angebote erscheinen dann oft nicht auf Seite 1.");
    }
    url.hash = "";
    return { url: url.toString(), warnings };
  }

  Immo.url = {
    MESSAGE_CAP,
    isScoutHost,
    canonicalUrl,
    sameSearch,
    validateSearchUrl,
  };
})(globalThis);
