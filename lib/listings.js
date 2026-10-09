(function (root) {
  const Immo = root.Immo || (root.Immo = {});
  const MAX_LISTINGS = 400;

  function trim(listings) {
    const entries = Object.values(listings);
    if (entries.length <= MAX_LISTINGS) return listings;
    const next = { ...listings };
    let extra = entries.length - MAX_LISTINGS;
    const droppable = entries
      .filter((entry) => entry.status === "dismissed" || entry.status === "seen" || entry.status === "replied")
      .sort((a, b) => a.firstSeen - b.firstSeen);
    for (const entry of droppable) {
      if (extra <= 0) break;
      delete next[entry.id];
      extra -= 1;
    }
    return next;
  }

  const DETAIL_KEYS = [
    "address",
    "coldRent",
    "warmRent",
    "extraCosts",
    "heatingCosts",
    "rooms",
    "area",
    "availableFrom",
    "landlord",
  ];
  const MAX_THREADS = 30;

  function addressKey(text) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const street = raw.split(",")[0].trim().toLowerCase();
    const postcode = raw.match(/\b(\d{5})\b/);
    if (!street || !postcode) return "";
    return `${street}|${postcode[1]}`;
  }

  function countOf(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 10000) return 0;
    return n;
  }

  function pickDetails(details) {
    const next = {};
    for (const key of DETAIL_KEYS) {
      const value = details && details[key] != null ? String(details[key]).replace(/\s+/g, " ").trim() : "";
      if (value) next[key] = value;
    }
    if (details && Object.prototype.hasOwnProperty.call(details, "photoCount")) {
      const photos = Number(details.photoCount);
      if (Number.isInteger(photos) && photos >= 0 && photos <= 10000) next.photoCount = photos;
    }
    return next;
  }

  function listingAddressKey(row) {
    return addressKey(row && row.details && row.details.address);
  }

  function normalizeThread(message) {
    const conversationId = String((message && message.conversationId) || "").trim();
    const direction = message && (message.direction === "in" || message.direction === "out") ? message.direction : "";
    const on = String((message && message.on) || "");
    if (!/^[0-9a-f-]{8,80}$/i.test(conversationId)) return null;
    if (!direction || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
    const exposeId = /^\d+$/.test(String((message && message.exposeId) || "")) ? String(message.exposeId) : "";
    return {
      conversationId,
      direction,
      on,
      addressKey: addressKey(message && message.address),
      exposeId,
      in: countOf(message && message.in),
      out: countOf(message && message.out),
    };
  }

  function threadView(record) {
    return {
      conversationId: record.conversationId,
      direction: record.direction,
      on: record.on,
      in: countOf(record.in),
      out: countOf(record.out),
    };
  }

  function rememberThread(threads, record) {
    const next = { ...(threads || {}) };
    delete next[record.conversationId];
    next[record.conversationId] = {
      conversationId: record.conversationId,
      direction: record.direction,
      on: record.on,
      addressKey: record.addressKey || "",
      exposeId: record.exposeId || "",
      in: countOf(record.in),
      out: countOf(record.out),
    };
    const ids = Object.keys(next);
    while (ids.length > MAX_THREADS) {
      delete next[ids.shift()];
    }
    return next;
  }

  function findByAddress(listings, key) {
    if (!key) return "";
    const hits = Object.values(listings).filter((row) => listingAddressKey(row) === key);
    return hits.length === 1 ? String(hits[0].id) : "";
  }

  function upsertAll(existing, incoming, baseline, searchUrl) {
    const listings = { ...existing };
    const fresh = [];
    const seenOn = searchUrl ? String(searchUrl) : "";
    for (const item of incoming) {
      if (!item || !item.id) continue;
      const id = String(item.id);
      const prev = listings[id];
      const replied = !!item.replied;
      if (!prev) {
        const firstSeen = Date.now();
        const status = replied ? "replied" : "new";
        const row = {
          id,
          url: item.url,
          title: item.title || "",
          price: item.price || "",
          area: item.area || "",
          rooms: item.rooms ?? "",
          firstSeen,
          status,
          collapsed: false,
        };
        if (seenOn) row.searchUrl = seenOn;
        if (replied) row.appliedAt = firstSeen;
        listings[id] = row;
        if (status === "new" && !baseline) fresh.push(row);
      } else {
        let status = prev.status;
        if (replied && (status === "seen" || status === "new")) status = "replied";
        else if (!replied && status === "seen") status = "new";
        const next = {
          ...prev,
          title: item.title || prev.title,
          price: item.price || prev.price,
          area: item.area || prev.area || "",
          rooms: item.rooms !== "" && item.rooms != null ? item.rooms : prev.rooms,
          url: item.url || prev.url,
          status,
        };
        if (seenOn) next.searchUrl = seenOn;
        if (status === "replied" && !prev.appliedAt) next.appliedAt = Date.now();
        listings[id] = next;
      }
    }
    return { listings: trim(listings), fresh };
  }

  function mergeDetails(listings, id, details, title) {
    const key = String(id || "");
    if (!/^\d+$/.test(key)) return listings;
    const cleaned = pickDetails(details);
    const name = String(title || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const prev = listings[key];
    if (!prev) {
      const row = {
        id: key,
        url: `https://www.immobilienscout24.de/expose/${key}`,
        title: name,
        price: "",
        area: "",
        rooms: "",
        firstSeen: Date.now(),
        status: "opened",
        collapsed: false,
        searchUrl: "",
        details: cleaned,
      };
      return trim({ ...listings, [key]: row });
    }
    return {
      ...listings,
      [key]: {
        ...prev,
        title: prev.title || name,
        details: { ...(prev.details || {}), ...cleaned },
      },
    };
  }

  function takeThreads(listings, threads, listingId) {
    const key = String(listingId || "");
    const row = listings[key];
    const nextThreads = { ...(threads || {}) };
    if (!row) return { listings, threads: nextThreads };
    const matchedKey = listingAddressKey(row);
    let nextRow = row;
    for (const item of Object.values(nextThreads)) {
      const byId = !!(item.exposeId && item.exposeId === key);
      const byAddress = !!(matchedKey && item.addressKey && item.addressKey === matchedKey);
      if (!byId && !byAddress) continue;
      nextRow = { ...nextRow, thread: threadView(item) };
      delete nextThreads[item.conversationId];
    }
    return { listings: { ...listings, [key]: nextRow }, threads: nextThreads };
  }

  function applyChat(listings, threads, message) {
    const record = normalizeThread(message);
    if (!record) return null;
    const exposeId = record.exposeId;
    let listingId = "";
    if (exposeId && listings[exposeId]) listingId = exposeId;
    else listingId = findByAddress(listings, record.addressKey);
    if (!listingId) {
      return { listings, threads: rememberThread(threads, record) };
    }
    const nextThreads = { ...(threads || {}) };
    delete nextThreads[record.conversationId];
    return {
      listings: {
        ...listings,
        [listingId]: { ...listings[listingId], thread: threadView(record) },
      },
      threads: nextThreads,
    };
  }

  function setStatus(listings, id, status, extra) {
    const key = String(id);
    if (!listings[key]) return listings;
    const patch = extra && typeof extra === "object" ? extra : {};
    return { ...listings, [key]: { ...listings[key], ...patch, status } };
  }

  function setCollapsed(listings, id, collapsed) {
    const key = String(id);
    if (!listings[key]) return listings;
    return { ...listings, [key]: { ...listings[key], collapsed: !!collapsed } };
  }

  Immo.listings = {
    MAX_LISTINGS,
    MAX_THREADS,
    addressKey,
    upsertAll,
    mergeDetails,
    takeThreads,
    applyChat,
    setStatus,
    setCollapsed,
    trim,
  };
})(globalThis);
