(function (root) {
  const Immo = root.Immo || (root.Immo = {});

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
  const BLOCKING = new Set(["draft", "sending", "sent", "needs-you"]);
  const REQUIRED_FIELDS = [
    ["firstName", "Vorname"],
    ["lastName", "Nachname"],
    ["email", "E-Mail"],
    ["phone", "Telefon"],
    ["street", "Straße"],
    ["houseNumber", "Hausnummer"],
    ["postcode", "PLZ"],
    ["city", "Ort"],
    ["incomeAmount", "Monatliches netto Haushaltseinkommen"],
    ["message", "Nachricht"],
  ];

  function localDay(now) {
    const date = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

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

  function rowKey(row) {
    if (!row) return "";
    if (row.addressKey) return row.addressKey;
    return addressKey(row.details && row.details.address);
  }

  function createRequest(listingId, status, reason, source, now) {
    const stamp = now || Date.now();
    return {
      listingId: String(listingId),
      status,
      reason: reason || "",
      source,
      createdAt: stamp,
      sentAt: status === "sent" ? stamp : 0,
      answeredAt: 0,
    };
  }

  function cleanListing(prev, stamp) {
    const id = String(prev.id);
    const details = prev.details ? pickDetails(prev.details) : null;
    const row = {
      id,
      url: prev.url || `https://www.immobilienscout24.de/expose/${id}`,
      title: prev.title || "",
      price: prev.price || "",
      area: prev.area || "",
      rooms: prev.rooms ?? "",
      firstSeen: prev.firstSeen || stamp,
      lastSeen: prev.lastSeen || prev.firstSeen || stamp,
      collapsed: !!prev.collapsed,
      addressKey: prev.addressKey || addressKey(details && details.address),
    };
    if (details && Object.keys(details).length) row.details = details;
    if (prev.seenAt) row.seenAt = prev.seenAt;
    if (prev.dismissedAt) row.dismissedAt = prev.dismissedAt;
    return row;
  }

  function absorbLegacy(prev, existingRequest, stamp) {
    const listing = cleanListing(prev, stamp);
    let request = existingRequest || null;
    if (prev.status === "dismissed" && !listing.dismissedAt) listing.dismissedAt = prev.appliedAt || prev.firstSeen || stamp;
    if ((prev.status === "opened" || prev.status === "filled" || prev.status === "seen") && !listing.seenAt) {
      listing.seenAt = prev.appliedAt || prev.firstSeen || stamp;
    }
    if (!request) {
      if (prev.status === "filled") request = createRequest(listing.id, "draft", "", "manual", prev.appliedAt || stamp);
      else if (prev.status === "no-form") request = createRequest(listing.id, "skipped", "no-form", "manual", prev.appliedAt || stamp);
      else if (prev.status === "replied") request = createRequest(listing.id, "sent", "", "scout", prev.appliedAt || prev.firstSeen || stamp);
    }
    return { listing, request };
  }

  function listingFromCard(item, stamp) {
    return {
      id: String(item.id),
      url: item.url || `https://www.immobilienscout24.de/expose/${item.id}`,
      title: item.title || "",
      price: item.price || "",
      area: item.area || "",
      rooms: item.rooms ?? "",
      firstSeen: stamp,
      lastSeen: stamp,
      collapsed: false,
      addressKey: "",
    };
  }

  function updateListing(prev, item, stamp) {
    const next = {
      ...prev,
      title: item.title || prev.title,
      price: item.price || prev.price,
      area: item.area || prev.area || "",
      rooms: item.rooms !== "" && item.rooms != null ? item.rooms : prev.rooms,
      url: item.url || prev.url,
      lastSeen: stamp,
    };
    delete next.status;
    delete next.searchUrl;
    delete next.appliedAt;
    delete next.thread;
    return next;
  }

  function migrateBundle(data, now) {
    const stamp = now || Date.now();
    const listingsIn = data && data.listings && typeof data.listings === "object" && !Array.isArray(data.listings) ? data.listings : {};
    const hits = data && data.hits && typeof data.hits === "object" && !Array.isArray(data.hits) ? { ...data.hits } : {};
    const requests = data && data.requests && typeof data.requests === "object" && !Array.isArray(data.requests) ? { ...data.requests } : {};
    const threads = data && data.threads && typeof data.threads === "object" && !Array.isArray(data.threads) ? { ...data.threads } : {};
    const listings = {};
    let dirty = false;
    for (const [id, prev] of Object.entries(listingsIn)) {
      if (!prev || typeof prev !== "object") continue;
      const absorbed = absorbLegacy(prev, requests[id], stamp);
      listings[id] = absorbed.listing;
      if (absorbed.request && !requests[id]) {
        requests[id] = absorbed.request;
        dirty = true;
      }
      if (prev.status || prev.thread || prev.searchUrl || prev.appliedAt) dirty = true;
      if (!hits[id]) {
        hits[id] = {
          listingId: id,
          firstSeen: absorbed.listing.firstSeen,
          lastSeen: absorbed.listing.lastSeen,
          inBaseline: true,
        };
        dirty = true;
      }
      const embedded = prev.thread;
      if (embedded && embedded.conversationId) {
        const conv = String(embedded.conversationId);
        const current = threads[conv] || {};
        threads[conv] = {
          conversationId: conv,
          direction: embedded.direction === "in" ? "in" : "out",
          on: embedded.on || current.on || "",
          in: countOf(embedded.in != null ? embedded.in : current.in),
          out: countOf(embedded.out != null ? embedded.out : current.out),
          exposeId: current.exposeId || id,
          addressKey: current.addressKey || rowKey(absorbed.listing),
          listingId: current.listingId || id,
        };
        dirty = true;
        const inbound = threads[conv].direction === "in" || countOf(threads[conv].in) > 0;
        const req = requests[id];
        if (inbound && req && req.status === "sent" && !req.answeredAt) {
          requests[id] = { ...req, answeredAt: stamp };
          dirty = true;
        }
      }
    }
    return { listings, hits, requests, threads, dirty };
  }

  function upsertAll(existingListings, existingHits, existingRequests, incoming, baseline, now) {
    const stamp = now || Date.now();
    const listings = {};
    const hits = { ...(existingHits || {}) };
    const requests = { ...(existingRequests || {}) };
    for (const [id, prev] of Object.entries(existingListings || {})) {
      if (!prev) continue;
      const absorbed = absorbLegacy(prev, requests[id], stamp);
      listings[id] = absorbed.listing;
      if (absorbed.request && !requests[id]) requests[id] = absorbed.request;
    }
    const fresh = [];
    for (const item of incoming || []) {
      if (!item || !item.id) continue;
      const id = String(item.id);
      const prev = listings[id];
      if (!prev) {
        const row = listingFromCard(item, stamp);
        listings[id] = row;
        hits[id] = { listingId: id, firstSeen: stamp, lastSeen: stamp, inBaseline: !!baseline };
        if (item.replied) requests[id] = requests[id] || createRequest(id, "sent", "", "scout", stamp);
        else if (!baseline) fresh.push(row);
      } else {
        const next = updateListing(prev, item, stamp);
        listings[id] = next;
        const hit = hits[id] || {
          listingId: id,
          firstSeen: prev.firstSeen || stamp,
          lastSeen: stamp,
          inBaseline: false,
        };
        hits[id] = {
          listingId: id,
          firstSeen: hit.firstSeen || prev.firstSeen || stamp,
          lastSeen: stamp,
          inBaseline: baseline ? true : !!hit.inBaseline,
        };
        if (item.replied && !requests[id] && !next.dismissedAt) {
          requests[id] = createRequest(id, "sent", "", "scout", stamp);
        }
      }
    }
    return { listings, hits, requests, fresh };
  }

  function mergeDetails(listings, id, details, title, now) {
    const key = String(id || "");
    if (!/^\d+$/.test(key)) return listings;
    const cleaned = pickDetails(details);
    const name = String(title || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const stamp = now || Date.now();
    const prev = listings[key];
    const address = addressKey(cleaned.address);
    if (!prev) {
      const row = {
        id: key,
        url: `https://www.immobilienscout24.de/expose/${key}`,
        title: name,
        price: "",
        area: "",
        rooms: "",
        firstSeen: stamp,
        lastSeen: stamp,
        collapsed: false,
        addressKey: address,
        details: cleaned,
      };
      return { ...listings, [key]: row };
    }
    const absorbed = absorbLegacy(prev, null, stamp).listing;
    return {
      ...listings,
      [key]: {
        ...absorbed,
        title: absorbed.title || name,
        details: { ...(absorbed.details || {}), ...cleaned },
        addressKey: address || absorbed.addressKey || "",
      },
    };
  }

  function inbound(record) {
    return !!record && (record.direction === "in" || countOf(record.in) > 0);
  }

  function answerIfInbound(requests, listingId, record, now) {
    const next = { ...(requests || {}) };
    const req = next[listingId];
    if (!inbound(record) || !req || req.status !== "sent" || req.answeredAt) return next;
    next[listingId] = { ...req, answeredAt: now || Date.now() };
    return next;
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

  function rememberThread(threads, record) {
    const next = { ...(threads || {}) };
    const prev = next[record.conversationId] || {};
    next[record.conversationId] = {
      conversationId: record.conversationId,
      direction: record.direction,
      on: record.on,
      addressKey: record.addressKey || prev.addressKey || "",
      exposeId: record.exposeId || prev.exposeId || "",
      in: countOf(record.in),
      out: countOf(record.out),
      listingId: record.listingId || prev.listingId || "",
    };
    return next;
  }

  function findByAddress(listings, key) {
    if (!key) return "";
    const hits = Object.values(listings).filter((row) => rowKey(row) === key);
    return hits.length === 1 ? String(hits[0].id) : "";
  }

  function takeThreads(listings, threads, requests, listingId, now) {
    const key = String(listingId || "");
    const row = listings[key];
    let nextThreads = { ...(threads || {}) };
    let nextRequests = { ...(requests || {}) };
    if (!row) return { listings, threads: nextThreads, requests: nextRequests };
    const matchedKey = rowKey(row);
    for (const item of Object.values(nextThreads)) {
      const byId = !!(item.exposeId && item.exposeId === key);
      const byAddress = !!(matchedKey && item.addressKey && item.addressKey === matchedKey);
      if (!byId && !byAddress) continue;
      nextThreads = rememberThread(nextThreads, { ...item, listingId: key });
      nextRequests = answerIfInbound(nextRequests, key, item, now);
    }
    return { listings, threads: nextThreads, requests: nextRequests };
  }

  function applyChat(listings, threads, requests, message, now) {
    const record = normalizeThread(message);
    if (!record) return null;
    let listingId = "";
    if (record.exposeId && listings[record.exposeId]) listingId = record.exposeId;
    else listingId = findByAddress(listings, record.addressKey);
    const nextThreads = rememberThread(threads, { ...record, listingId });
    const nextRequests = listingId ? answerIfInbound(requests, listingId, record, now) : { ...(requests || {}) };
    return { listings, threads: nextThreads, requests: nextRequests };
  }

  function markSeen(listings, id, now) {
    const key = String(id);
    const row = listings[key];
    if (!row || row.seenAt) return listings;
    return { ...listings, [key]: { ...row, seenAt: now || Date.now() } };
  }

  function markDismissed(listings, id, now) {
    const key = String(id);
    const row = listings[key];
    if (!row || row.dismissedAt) return listings;
    return { ...listings, [key]: { ...row, dismissedAt: now || Date.now() } };
  }

  function setCollapsed(listings, id, collapsed) {
    const key = String(id);
    if (!listings[key]) return listings;
    return { ...listings, [key]: { ...listings[key], collapsed: !!collapsed } };
  }

  function clearBaseline(hits) {
    const next = {};
    for (const [id, hit] of Object.entries(hits || {})) {
      next[id] = { ...hit, inBaseline: false };
    }
    return next;
  }

  function isNew(listing, hit, request) {
    if (!listing || !hit || hit.inBaseline) return false;
    if (listing.seenAt || listing.dismissedAt) return false;
    if (request) return false;
    return true;
  }

  function sameFlatConflict(listing, listings, requests) {
    const key = rowKey(listing);
    if (!key) return "";
    for (const other of Object.values(listings || {})) {
      if (!other || String(other.id) === String(listing.id)) continue;
      if (rowKey(other) !== key) continue;
      const req = requests && requests[other.id];
      if (req && BLOCKING.has(req.status)) return String(other.id);
    }
    return "";
  }

  function inbox(listings, hits, requests) {
    const fresh = [];
    const needsYou = [];
    for (const hit of Object.values(hits || {})) {
      const id = String(hit.listingId || "");
      if (isNew((listings || {})[id], hit, (requests || {})[id])) fresh.push(id);
    }
    for (const [id, req] of Object.entries(requests || {})) {
      if (req && req.status === "needs-you") needsYou.push(String(id));
    }
    fresh.sort();
    needsYou.sort();
    return { fresh, needsYou };
  }

  function nextAutoSend(listings, hits, requests) {
    const rows = Object.values(hits || {})
      .filter((hit) => {
        const id = String(hit.listingId || "");
        const listing = (listings || {})[id];
        return isNew(listing, hit, (requests || {})[id]) && !sameFlatConflict(listing, listings, requests);
      })
      .sort((a, b) => (a.firstSeen || 0) - (b.firstSeen || 0) || String(a.listingId).localeCompare(String(b.listingId)));
    return rows.length ? (listings || {})[String(rows[0].listingId)] || null : null;
  }

  function missingFields(profile) {
    const source = profile || {};
    const missing = [];
    for (const [key, label] of REQUIRED_FIELDS) {
      if (!String(source[key] || "").trim()) missing.push(label);
    }
    if (source.moveInDateType === "CONCRETE" && !String(source.moveInDate || "").trim()) missing.push("Datum");
    return missing;
  }

  function applySendOutcome(request, outcome, now) {
    if (!request) return null;
    const stamp = now || Date.now();
    if (outcome === "sent") return { ...request, status: "sent", reason: "", sentAt: request.sentAt || stamp };
    const map = {
      captcha: ["needs-you", "captcha"],
      login: ["needs-you", "login"],
      plus: ["skipped", "plus"],
      "no-form": ["skipped", "no-form"],
      form: ["needs-you", "form"],
      cap: ["skipped", "cap"],
    };
    const pair = map[outcome];
    if (!pair) return request;
    return { ...request, status: pair[0], reason: pair[1] };
  }

  function putDraft(requests, listingId, now) {
    const key = String(listingId);
    const prev = (requests || {})[key];
    if (prev && prev.status !== "draft" && prev.status !== "needs-you" && prev.status !== "skipped") return requests || {};
    const next = { ...(requests || {}) };
    next[key] = prev && prev.status === "draft"
      ? prev
      : createRequest(key, "draft", "", "manual", now || Date.now());
    return next;
  }

  function putOutcome(requests, listingId, outcome, source, now) {
    const key = String(listingId);
    const stamp = now || Date.now();
    const prev = (requests || {})[key] || createRequest(key, "draft", "", source || "manual", stamp);
    if (prev.status === "sent" && outcome !== "sent") return requests || {};
    const next = { ...(requests || {}) };
    next[key] = applySendOutcome(prev, outcome, stamp);
    return next;
  }

  function sentTallies(requests, now) {
    const day = localDay(now == null ? Date.now() : now);
    let shown = 0;
    let auto = 0;
    for (const req of Object.values(requests || {})) {
      if (!req || req.status !== "sent" || !req.sentAt) continue;
      if (localDay(req.sentAt) !== day) continue;
      if (req.source === "auto") {
        auto += 1;
        shown += 1;
      } else if (req.source === "manual") {
        shown += 1;
      }
    }
    return { shown, auto };
  }

  function rowStamp(row, now) {
    if (row && /^\d{4}-\d{2}-\d{2}$/.test(row.on || "")) {
      const [year, month, day] = row.on.split("-").map(Number);
      return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
    }
    return now || Date.now();
  }

  function matchConversation(listings, row) {
    if (row && row.exposeId && listings[row.exposeId]) return String(row.exposeId);
    const key = addressKey(row && row.address);
    if (!key) return "";
    const hits = Object.values(listings || {}).filter((item) => rowKey(item) === key);
    return hits.length === 1 ? String(hits[0].id) : "";
  }

  function applyConversationList(listings, requests, rows, now) {
    const stampNow = now || Date.now();
    const nextListings = { ...(listings || {}) };
    const nextRequests = { ...(requests || {}) };
    const matched = [];
    for (const row of rows || []) {
      const id = matchConversation(nextListings, row);
      if (!id) continue;
      matched.push(id);
      if (row.deactivated) nextListings[id] = { ...nextListings[id], deactivated: true };
      const prev = nextRequests[id];
      const stamp = rowStamp(row, stampNow);
      let next = prev || null;
      if (!prev) {
        next = createRequest(id, "sent", "", "scout", stamp);
        next.sentAt = stamp;
      } else if (prev.status === "draft" || prev.status === "sending") {
        const source = prev.source === "manual" || prev.source === "auto" ? prev.source : "scout";
        next = { ...prev, status: "sent", reason: "", source, sentAt: prev.sentAt || stamp };
      } else if (prev.status === "sent" && !prev.sentAt) {
        next = { ...prev, sentAt: stamp };
      }
      if (next && next.status === "sent" && row.reply && !next.answeredAt) {
        next = { ...next, answeredAt: stamp };
      }
      if (next) nextRequests[id] = next;
    }
    matched.sort();
    return { listings: nextListings, requests: nextRequests, matched };
  }

  function cappedToday(requests, day) {
    return Object.values(requests || {}).some((req) => req && req.status === "skipped" && req.reason === "cap" && localDay(req.createdAt) === day);
  }

  function dropRequest(requests, listingId) {
    const next = { ...(requests || {}) };
    delete next[String(listingId)];
    return next;
  }

  Immo.listings = {
    addressKey,
    localDay,
    createRequest,
    migrateBundle,
    upsertAll,
    mergeDetails,
    takeThreads,
    applyChat,
    markSeen,
    markDismissed,
    setCollapsed,
    clearBaseline,
    isNew,
    sameFlatConflict,
    inbox,
    nextAutoSend,
    missingFields,
    applySendOutcome,
    putDraft,
    putOutcome,
    cappedToday,
    dropRequest,
    sentTallies,
    applyConversationList,
  };
})(globalThis);
