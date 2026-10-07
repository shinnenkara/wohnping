(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function formatPlain(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Intl.NumberFormat("de-DE").format(value);
    }
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (/[^\d.,\s-]/.test(raw)) return raw;
    const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
    const num = Number(normalized);
    return Number.isFinite(num) ? new Intl.NumberFormat("de-DE").format(num) : raw;
  }

  function formatSpan(value, suffix) {
    if (value == null || value === "") return "";
    if (typeof value === "object") {
      const min = value.min ?? value.from;
      const max = value.max ?? value.to;
      if (min != null && max != null && String(min) !== String(max)) {
        return `${formatPlain(min)} - ${formatPlain(max)} ${suffix}`;
      }
      if (value.value != null && value.value !== "") return formatSpan(value.value, suffix);
      if (min != null && min !== "") return `${formatPlain(min)} ${suffix}`;
      if (max != null && max !== "") return `${formatPlain(max)} ${suffix}`;
      return "";
    }
    const plain = formatPlain(value);
    if (!plain) return "";
    if (plain.includes(suffix)) return plain;
    return `${plain} ${suffix}`;
  }

  function fromRealEstate(id, realEstate) {
    const space = realEstate.livingSpace ?? realEstate.livingSpaceSqm ?? "";
    return {
      id: String(id),
      url: `https://www.immobilienscout24.de/expose/${id}`,
      title: String(realEstate.title || "").trim().slice(0, 200),
      price: formatSpan(realEstate.price, "€"),
      area: formatSpan(space, "m²"),
      rooms: realEstate.numberOfRooms ?? "",
    };
  }

  function extractListings(data) {
    const found = [];
    const seen = new Set();

    function visit(node, depth) {
      if (!node || depth > 14 || found.length > 300) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      if (typeof node !== "object") return;
      const realEstate = node["resultlist.realEstate"] || node.realEstate;
      const id = node["@id"] || (realEstate && (node.id || node["@id"]));
      if (realEstate && typeof realEstate === "object" && id != null && id !== "") {
        const key = String(id);
        if (!seen.has(key)) {
          seen.add(key);
          found.push(fromRealEstate(key, realEstate));
        }
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") visit(value, depth + 1);
      }
    }

    visit(data, 0);
    return found;
  }

  function listingsFromJsonText(text) {
    if (!text || (!text.includes("resultListModel") && !text.includes("resultlist.resultlist"))) return [];
    const candidates = [];
    try {
      candidates.push(JSON.parse(text));
    } catch {
      /* script is not raw JSON */
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        candidates.push(JSON.parse(text.slice(start, end + 1)));
      } catch {
        /* embedded object is not standalone JSON */
      }
    }
    for (const data of candidates) {
      const listings = extractListings(data);
      if (listings.length) return listings;
    }
    return [];
  }

  const REPLIED = /kontaktiert|anfrage gesendet|erneut kontaktieren/i;
  const AMOUNT = "(\\d+(?:\\.\\d{3})*(?:,\\d+)?)";

  function textOf(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function matchMeasure(text, unitPattern, suffix) {
    const re = new RegExp(`${AMOUNT}(?:\\s*-\\s*${AMOUNT})?\\s*${unitPattern}`);
    const match = text.match(re);
    if (!match) return "";
    const body = match[2] ? `${match[1]} - ${match[2]}` : match[1];
    return `${body} ${suffix}`;
  }

  function matchRooms(text) {
    const match = text.match(/(\d+(?:,\d+)?)\s*(?:Zi\.|Zimmer)/);
    return match ? match[1] : "";
  }

  function listingFromText(id, title, text) {
    return {
      id: String(id),
      url: `https://www.immobilienscout24.de/expose/${id}`,
      title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 200),
      price: matchMeasure(text, "€", "€"),
      area: matchMeasure(text, "m²", "m²"),
      rooms: matchRooms(text),
      replied: REPLIED.test(text),
    };
  }

  function skipListingCard(card) {
    if (card.closest("[data-immo-ext]")) return true;
    if (card.classList.contains("ad-card") || card.classList.contains("stacked-cards")) return true;
    const main = card.querySelector(".card-attributes a[href]");
    const href = main ? main.getAttribute("href") || "" : "";
    return /\/neubau\//.test(href);
  }

  function parseListingCards(doc) {
    const map = new Map();
    for (const card of doc.querySelectorAll(".listing-card[data-obid]")) {
      if (skipListingCard(card)) continue;
      const id = String(card.getAttribute("data-obid") || "").trim();
      if (!id || map.has(id)) continue;
      const headline = card.querySelector('[data-testid="headline"]');
      const attrs = card.querySelector('[data-testid="attributes"]');
      const source = attrs || card;
      map.set(id, listingFromText(id, textOf(headline), textOf(source)));
      map.get(id).replied = REPLIED.test(textOf(card));
    }
    return [...map.values()];
  }

  function cardFor(link) {
    let node = link;
    const doc = link.ownerDocument;
    while (node && node.parentElement && node.parentElement !== doc.body) {
      const parent = node.parentElement;
      const ids = new Set();
      for (const anchor of parent.querySelectorAll('a[href*="/expose/"]')) {
        const match = (anchor.getAttribute("href") || "").match(/\/expose\/(\d+)/);
        if (match) ids.add(match[1]);
      }
      if (ids.size > 1) return node;
      node = parent;
    }
    return link.closest("article, li, [data-id]") || link.parentElement || link;
  }

  function parseLinkCards(doc) {
    const map = new Map();
    const links = doc.querySelectorAll('a[href*="/expose/"]');
    for (const link of links) {
      if (link.closest("[data-immo-ext], .stacked-cards, .ad-card")) continue;
      const href = link.href || link.getAttribute("href") || "";
      const match = href.match(/\/expose\/(\d+)/);
      if (!match || map.has(match[1])) continue;
      const card = cardFor(link);
      const headline = card.querySelector && card.querySelector('[data-testid="headline"]');
      const title = headline ? textOf(headline) : (link.getAttribute("title") || link.innerText || link.textContent || "");
      map.set(match[1], listingFromText(match[1], title, textOf(card)));
    }
    return [...map.values()];
  }

  function parseCards(doc) {
    if (doc.querySelector(".listing-card[data-obid]")) return parseListingCards(doc);
    return parseLinkCards(doc);
  }

  function applyReplied(listings, doc) {
    const replied = new Set(parseLinkCards(doc).filter((item) => item.replied).map((item) => item.id));
    return listings.map((item) => ({ ...item, replied: replied.has(String(item.id)) }));
  }

  function parseSearchResults(doc) {
    if (doc.querySelector(".listing-card[data-obid]")) return parseListingCards(doc);
    const scripts = doc.querySelectorAll("script");
    for (const script of scripts) {
      const listings = listingsFromJsonText(script.textContent || "");
      if (listings.length) return applyReplied(listings, doc);
    }
    return parseLinkCards(doc);
  }

  Immo.search = { extractListings, listingsFromJsonText, parseSearchResults, parseCards };
})(globalThis);
