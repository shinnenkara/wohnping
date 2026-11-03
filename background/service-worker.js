importScripts("../lib/url.js", "../lib/listings.js", "../lib/storage.js", "../lib/reload.js");

const ALARM = "watch-reload";
const MESSAGES_ALARM = "messages-reload";
const MESSAGES_URL = "https://www.immobilienscout24.de/messenger/conversations";
const Immo = globalThis.Immo;
const SESSION_KEYS = [
  "watchTabId",
  "watchOffSearch",
  "watchMissing",
  "pendingIds",
  "sendingTabId",
  "sendingId",
  "capNotifiedOn",
  "storageError",
  "messagesTabId",
];

function scheduleReload() {
  return chrome.alarms.create(ALARM, { delayInMinutes: Immo.reload.nextDelay() });
}

function scheduleMessages() {
  return chrome.alarms.create(MESSAGES_ALARM, { delayInMinutes: Immo.reload.nextMessagesDelay() });
}

async function getTabOrNull(id) {
  if (!id) return null;
  try {
    return await chrome.tabs.get(id);
  } catch {
    return null;
  }
}

async function sessionBits() {
  return chrome.storage.session.get(SESSION_KEYS);
}

async function getWatchTab() {
  const { watchTabId } = await sessionBits();
  return getTabOrNull(watchTabId);
}

function latestSeen(hits) {
  let latest = 0;
  for (const hit of Object.values(hits || {})) {
    if (hit && hit.lastSeen > latest) latest = hit.lastSeen;
  }
  return latest;
}

function presentListing(listing, request, threads, listings, requests) {
  const related = Object.values(threads || {}).filter((thread) => thread && thread.listingId === listing.id);
  related.sort((a, b) => String(b.on || "").localeCompare(String(a.on || "")));
  const thread = related[0] || null;
  return {
    ...listing,
    request: request
      ? {
          status: request.status,
          reason: request.reason,
          source: request.source,
          sentAt: request.sentAt,
          answeredAt: request.answeredAt,
        }
      : null,
    sameFlat: Immo.listings.sameFlatConflict(listing, listings, requests),
    thread: thread
      ? { direction: thread.direction, on: thread.on, in: thread.in, out: thread.out }
      : null,
  };
}

async function publicState() {
  const local = await Immo.storage.getAll();
  const session = await sessionBits();
  const tab = await getTabOrNull(session.watchTabId);
  const counts = Immo.listings.inbox(local.listings, local.hits, local.requests);
  const tallies = Immo.listings.sentTallies(local.requests);
  const listings = Object.values(local.listings)
    .map((item) => presentListing(item, local.requests[item.id], local.threads, local.listings, local.requests))
    .sort((a, b) => (b.lastSeen || b.firstSeen || 0) - (a.lastSeen || a.firstSeen || 0));
  return {
    profile: local.profile,
    searchUrl: local.searchUrl,
    watching: local.settings.watching,
    paused: local.settings.paused,
    autoSend: local.settings.autoSend,
    dailyCap: local.settings.dailyCap,
    sentOn: local.settings.sentOn,
    sentCount: local.settings.sentCount,
    counts: {
      new: counts.fresh.length,
      needsYou: counts.needsYou.length,
      sentToday: tallies.shown,
      autoSent: tallies.auto,
    },
    baselineUrl: local.baselineUrl,
    listings,
    lastReloadAt: latestSeen(local.hits),
    watchTabOpen: !!tab,
    watchOffSearch: !!(tab && session.watchOffSearch),
    watchMissing: !!(local.settings.watching && !local.settings.paused && !tab && session.watchMissing),
    warnings: local.searchUrl ? Immo.url.validateSearchUrl(local.searchUrl).warnings || [] : [],
    storageError: session.storageError || null,
    missingFields: Immo.listings.missingFields(local.profile),
  };
}

async function updateBadge() {
  const state = await Immo.storage.getAll();
  if (state.settings.watching && state.settings.paused) {
    await chrome.action.setBadgeBackgroundColor({ color: "#a16207" });
    await chrome.action.setBadgeText({ text: "Pause" });
  } else if (state.settings.watching) {
    await chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });
    await chrome.action.setBadgeText({ text: "On" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

async function pushWatchState() {
  const tab = await getWatchTab();
  if (!tab) return;
  const state = await publicState();
  const payload = {
    type: "watch-state",
    isWatchTab: true,
    watching: state.watching,
    paused: state.paused,
    offSearch: state.watchOffSearch,
  };
  try {
    await chrome.tabs.sendMessage(tab.id, payload);
  } catch {
    /* content script runs again after the next load */
  }
}

function validatedOrThrow(searchUrl) {
  const result = Immo.url.validateSearchUrl(searchUrl);
  if (result.error) {
    const error = new Error(result.error);
    error.userMessage = result.error;
    throw error;
  }
  return result;
}

async function rememberTab(tabId) {
  await chrome.storage.session.set({ watchTabId: tabId, watchMissing: false, watchOffSearch: false });
}

async function createWatchTab(url) {
  const tab = await chrome.tabs.create({ url, pinned: true, active: false });
  await rememberTab(tab.id);
  return tab;
}

async function focusTab(tab) {
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    /* the tab still exists even if the window could not be focused */
  }
}

async function findRestoredWatchTab(searchUrl) {
  const tabs = await chrome.tabs.query({ pinned: true });
  return (
    tabs.find((tab) => {
      if (!tab.url || !Immo.url.sameSearch(tab.url, searchUrl)) return false;
      return /^(Wohnping|Pause|Watch|Paused) · /.test(tab.title || "");
    }) || null
  );
}

async function getMessagesTab() {
  const { messagesTabId } = await sessionBits();
  return getTabOrNull(messagesTabId);
}

async function rememberMessagesTab(tabId) {
  await chrome.storage.session.set({ messagesTabId: tabId });
}

async function findRestoredMessagesTab() {
  const tabs = await chrome.tabs.query({ pinned: true });
  return (
    tabs.find((tab) => {
      const title = tab.title || "";
      const url = tab.url || "";
      return title.startsWith("Wohnping · Nachrichten") || url.includes("/messenger/conversations");
    }) || null
  );
}

async function createMessagesTab() {
  const tab = await chrome.tabs.create({ url: MESSAGES_URL, pinned: true, active: false });
  await rememberMessagesTab(tab.id);
  return tab;
}

async function ensureMessages() {
  const state = await Immo.storage.getAll();
  if (!state.settings.watching || state.settings.paused) {
    await chrome.alarms.clear(MESSAGES_ALARM);
    return;
  }
  let tab = await getMessagesTab();
  if (!tab) {
    tab = await findRestoredMessagesTab();
    if (tab) await rememberMessagesTab(tab.id);
  }
  if (!tab) await createMessagesTab();
  await scheduleMessages();
}

async function pushMessagesState() {
  const tab = await getMessagesTab();
  if (!tab) return;
  const state = await publicState();
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "messages-state",
      isMessagesTab: true,
      watching: state.watching,
      paused: state.paused,
      counts: state.counts,
    });
  } catch {
    /* the conversations page sets the bar again after the next load */
  }
}

async function ensureWatch() {
  const state = await Immo.storage.getAll();
  if (!state.settings.watching || state.settings.paused || !state.searchUrl) {
    await chrome.alarms.clear(ALARM);
    await ensureMessages();
    await updateBadge();
    return;
  }
  let tab = await getWatchTab();
  if (!tab) {
    tab = await findRestoredWatchTab(state.searchUrl);
    if (tab) await rememberTab(tab.id);
  }
  if (!tab) tab = await createWatchTab(state.searchUrl);
  await scheduleReload();
  await ensureMessages();
  await updateBadge();
}

async function saveSettingsPatch(operation, settings) {
  await Immo.storage.writeLocal(operation, { settings });
}

async function start() {
  const state = await Immo.storage.getAll();
  const validated = validatedOrThrow(state.searchUrl);
  if (validated.url !== state.searchUrl) {
    await Immo.storage.saveSettings(state.profile, validated.url);
  }
  const fresh = await Immo.storage.getAll();
  const patch = {
    settings: { ...fresh.settings, watching: true, paused: false },
    searchUrl: validated.url,
  };
  if (fresh.baselineUrl && !Immo.url.sameSearch(fresh.baselineUrl, validated.url)) {
    patch.baselineUrl = "";
    patch.hits = Immo.listings.clearBaseline(fresh.hits);
  }
  await Immo.storage.writeLocal("start", patch);
  let tab = await getWatchTab();
  if (!tab) {
    tab = await createWatchTab(validated.url);
  } else {
    if (!Immo.url.sameSearch(tab.url || "", validated.url)) {
      await chrome.tabs.update(tab.id, { url: validated.url });
    }
    await chrome.tabs.update(tab.id, { pinned: true });
    await focusTab(tab);
    await rememberTab(tab.id);
  }
  await scheduleReload();
  await ensureMessages();
  await updateBadge();
  return { ok: true, warnings: validated.warnings, state: await publicState() };
}

async function pause() {
  const state = await Immo.storage.getAll();
  await saveSettingsPatch("pause", { ...state.settings, watching: true, paused: true });
  await chrome.alarms.clear(ALARM);
  await chrome.alarms.clear(MESSAGES_ALARM);
  await updateBadge();
  await pushWatchState();
  await pushMessagesState();
  return { ok: true, state: await publicState() };
}

async function resume() {
  const state = await Immo.storage.getAll();
  if (!state.settings.watching) return start();
  validatedOrThrow(state.searchUrl);
  await saveSettingsPatch("resume", { ...state.settings, paused: false });
  let tab = await getWatchTab();
  if (!tab) tab = await createWatchTab(state.searchUrl);
  await scheduleReload();
  await ensureMessages();
  await updateBadge();
  await pushWatchState();
  await pushMessagesState();
  return { ok: true, state: await publicState() };
}

async function stop() {
  const tab = await getWatchTab();
  const state = await Immo.storage.getAll();
  await saveSettingsPatch("stop", { ...state.settings, watching: false, paused: false });
  await chrome.alarms.clear(ALARM);
  await chrome.alarms.clear(MESSAGES_ALARM);
  await chrome.storage.session.remove(["watchOffSearch", "watchMissing"]);
  await updateBadge();
  await pushMessagesState();
  if (tab) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "watch-state",
        isWatchTab: true,
        watching: false,
        paused: false,
        offSearch: false,
      });
    } catch {
      /* tab may already be gone */
    }
  }
  return { ok: true, state: await publicState() };
}

async function closeWatchTab() {
  const tab = await getWatchTab();
  const result = await stop();
  if (tab) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* already closed */
    }
  }
  return result;
}

async function showWatchTab() {
  const tab = await getWatchTab();
  if (!tab) return { error: "Kein Watch-Tab offen.", state: await publicState() };
  await focusTab(tab);
  return { ok: true, state: await publicState() };
}

async function reloadWatchTab() {
  const state = await Immo.storage.getAll();
  const tab = await getWatchTab();
  if (!tab) return { error: "Kein Watch-Tab offen.", state: await publicState() };
  if (!state.searchUrl) return { error: "Keine Such-URL gespeichert.", state: await publicState() };
  await chrome.storage.session.set({ watchOffSearch: false });
  if (tab.url && Immo.url.sameSearch(tab.url, state.searchUrl)) await chrome.tabs.reload(tab.id);
  else await chrome.tabs.update(tab.id, { url: state.searchUrl });
  if (state.settings.watching && !state.settings.paused) await scheduleReload();
  return { ok: true, state: await publicState() };
}

async function returnToSearch() {
  const state = await Immo.storage.getAll();
  const tab = await getWatchTab();
  if (!tab) return { error: "Kein Watch-Tab offen.", state: await publicState() };
  if (!state.searchUrl) return { error: "Keine Such-URL gespeichert.", state: await publicState() };
  await chrome.tabs.update(tab.id, { url: state.searchUrl, active: true });
  await chrome.storage.session.set({ watchOffSearch: false });
  return { ok: true, state: await publicState() };
}

async function notifyListing(item) {
  const bits = [
    item.title || "Inserat",
    item.price,
    item.area,
    item.rooms !== "" && item.rooms != null ? `${item.rooms} Zi.` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  await chrome.notifications.create(`expose-${item.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Neues Angebot",
    message: bits.slice(0, 240),
  });
}

function reasonLabel(reason) {
  const labels = {
    captcha: "Captcha",
    login: "Anmeldung",
    plus: "Plus",
    cap: "Tageslimit",
    "no-form": "kein Formular",
    form: "Formular",
  };
  return labels[reason] || "Prüfung";
}

async function notifyNeeds(listing, request) {
  const name = (listing && listing.title) || "Inserat";
  await chrome.notifications.create(`need-${listing ? listing.id : "0"}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Wohnping braucht dich",
    message: `${name} · ${reasonLabel(request && request.reason)}`.slice(0, 240),
  });
}

async function notifyCap(cap) {
  await chrome.notifications.create("cap-reached", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Tageslimit erreicht",
    message: `Automatisches Senden stoppt bei ${cap}. Manuelles Ausfüllen geht weiter.`.slice(0, 240),
  });
}

async function openAndFill(id) {
  const state = await Immo.storage.getAll();
  const item = state.listings[String(id)];
  if (!item) return { error: "Unbekanntes Inserat.", state: await publicState() };
  const session = await sessionBits();
  const pendingIds = { ...(session.pendingIds || {}), [String(id)]: true };
  await chrome.storage.session.set({ pendingIds });
  await Immo.storage.writeLocal("open-and-fill", { listings: Immo.listings.markSeen(state.listings, id) });
  await chrome.tabs.create({ url: item.url, active: true });
  return { ok: true, state: await publicState() };
}

async function dismiss(id) {
  const state = await Immo.storage.getAll();
  await Immo.storage.writeLocal("dismiss", { listings: Immo.listings.markDismissed(state.listings, id) });
  return { ok: true, state: await publicState() };
}

async function setCollapsed(id, collapsed) {
  const state = await Immo.storage.getAll();
  await Immo.storage.writeLocal("set-collapsed", { listings: Immo.listings.setCollapsed(state.listings, id, collapsed) });
  return { ok: true, state: await publicState() };
}

async function clearSending(id) {
  const session = await sessionBits();
  const pendingIds = { ...(session.pendingIds || {}) };
  delete pendingIds[id];
  const patch = { pendingIds };
  if (session.sendingId === id) {
    await chrome.storage.session.remove(["sendingId", "sendingTabId"]);
  }
  await chrome.storage.session.set(patch);
  return session;
}

async function considerAutoSend() {
  const state = await Immo.storage.getAll();
  if (!state.settings.watching || state.settings.paused || !state.settings.autoSend) return;
  if (Immo.listings.missingFields(state.profile).length) return;
  const session = await sessionBits();
  if (session.sendingId) {
    const tab = await getTabOrNull(session.sendingTabId);
    if (tab) return;
    const request = state.requests[session.sendingId];
    if (request && request.status === "sending") {
      const requests = {
        ...state.requests,
        [session.sendingId]: { ...request, status: "needs-you", reason: request.reason || "" },
      };
      await Immo.storage.writeLocal("send-result", { requests });
      await notifyNeeds(state.listings[session.sendingId], requests[session.sendingId]);
    }
    await chrome.storage.session.remove(["sendingId", "sendingTabId"]);
    return;
  }
  const next = Immo.listings.nextAutoSend(state.listings, state.hits, state.requests);
  if (!next) return;
  const autoToday = Math.max(state.settings.sentCount, Immo.listings.sentTallies(state.requests).auto);
  if (autoToday >= state.settings.dailyCap) {
    const day = state.settings.sentOn;
    if (!Immo.listings.cappedToday(state.requests, day)) {
      const requests = {
        ...state.requests,
        [next.id]: Immo.listings.createRequest(next.id, "skipped", "cap", "auto"),
      };
      await Immo.storage.writeLocal("auto-send", { requests });
    }
    if (session.capNotifiedOn !== day) {
      await chrome.storage.session.set({ capNotifiedOn: day });
      await notifyCap(state.settings.dailyCap);
    }
    return;
  }
  const requests = {
    ...state.requests,
    [next.id]: Immo.listings.createRequest(next.id, "sending", "", "auto"),
  };
  await Immo.storage.writeLocal("auto-send", { requests });
  const tab = await chrome.tabs.create({ url: next.url, active: false });
  await chrome.storage.session.set({
    sendingId: String(next.id),
    sendingTabId: tab.id,
    pendingIds: { ...(session.pendingIds || {}), [String(next.id)]: "auto" },
  });
}

async function onAlarm() {
  const state = await Immo.storage.getAll();
  if (!state.settings.watching || state.settings.paused) return;
  try {
    const tab = await getWatchTab();
    if (!tab) {
      await chrome.storage.session.remove("watchTabId");
      await chrome.storage.session.set({ watchMissing: true });
      return;
    }
    if (!tab.url || !Immo.url.sameSearch(tab.url, state.searchUrl)) {
      await chrome.storage.session.set({ watchOffSearch: true });
      await pushWatchState();
      return;
    }
    await chrome.storage.session.set({ watchOffSearch: false });
    if (tab.discarded) await chrome.tabs.update(tab.id, { url: state.searchUrl });
    else await chrome.tabs.reload(tab.id);
  } finally {
    const latest = await Immo.storage.getAll();
    if (latest.settings.watching && !latest.settings.paused) await scheduleReload();
  }
}

async function onWatchGate(message, sender) {
  const tabId = sender.tab && sender.tab.id;
  const { watchTabId } = await sessionBits();
  if (!tabId || tabId !== watchTabId) return { isWatchTab: false };
  const state = await Immo.storage.getAll();
  const offSearch = !Immo.url.sameSearch(message.url, state.searchUrl);
  await chrome.storage.session.set({ watchOffSearch: offSearch });
  return {
    isWatchTab: true,
    watching: state.settings.watching,
    paused: state.settings.paused,
    offSearch,
  };
}

async function onWatchLoaded(message, sender) {
  const gate = await onWatchGate(message, sender);
  if (!gate.isWatchTab || !gate.watching || gate.offSearch) return gate;
  const state = await Immo.storage.getAll();
  const baseline = !state.baselineUrl || !Immo.url.sameSearch(state.baselineUrl, state.searchUrl);
  const saved = Immo.listings.upsertAll(
    state.listings,
    state.hits,
    state.requests,
    message.listings || [],
    baseline,
  );
  await Immo.storage.writeLocal("watch-loaded", {
    listings: saved.listings,
    hits: saved.hits,
    requests: saved.requests,
    baselineUrl: state.searchUrl,
  });
  if (!state.settings.paused) {
    for (const item of saved.fresh) await notifyListing(item);
    await considerAutoSend();
  }
  return { ...gate, added: saved.fresh.length };
}

async function onShouldFill(message) {
  const id = String(message.id || "");
  const session = await sessionBits();
  const pending = session.pendingIds || {};
  const auto = pending[id] === "auto";
  if (!message.force && !pending[id]) return { fill: false };
  const state = await Immo.storage.getAll();
  return { fill: true, submit: auto && !message.force, profile: state.profile };
}

async function onExposeDetails(message, sender) {
  const id = String(message.id || "");
  if (!/^\d+$/.test(id)) return { error: "Unbekanntes Inserat." };
  const state = await Immo.storage.getAll();
  let listings = Immo.listings.mergeDetails(state.listings, id, message.details, message.title);
  const session = await sessionBits();
  const tabId = sender && sender.tab && sender.tab.id;
  const auto = session.sendingId === id && tabId === session.sendingTabId;
  if (!auto) listings = Immo.listings.markSeen(listings, id);
  const claimed = Immo.listings.takeThreads(listings, state.threads, state.requests, id);
  if (auto && Immo.listings.sameFlatConflict(claimed.listings[id], claimed.listings, claimed.requests)) {
    await Immo.storage.writeLocal("expose-details", {
      listings: claimed.listings,
      threads: claimed.threads,
      requests: Immo.listings.dropRequest(claimed.requests, id),
    });
    await chrome.storage.session.remove(["sendingId", "sendingTabId"]);
    const pendingIds = { ...(session.pendingIds || {}) };
    delete pendingIds[id];
    await chrome.storage.session.set({ pendingIds });
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* the tab can already be gone */
      }
    }
    return { ok: true, sameFlat: true };
  }
  await Immo.storage.writeLocal("expose-details", {
    listings: claimed.listings,
    threads: claimed.threads,
    requests: claimed.requests,
  });
  return { ok: true };
}

async function onChatStatus(message) {
  const state = await Immo.storage.getAll();
  const result = Immo.listings.applyChat(state.listings, state.threads, state.requests, message);
  if (!result) return { error: "Unvollständiger Chat." };
  await Immo.storage.writeLocal("chat-status", { threads: result.threads, requests: result.requests });
  return { ok: true };
}

async function onFillResult(message) {
  const id = String(message.id || "");
  const session = await sessionBits();
  const pendingIds = { ...(session.pendingIds || {}) };
  delete pendingIds[id];
  await chrome.storage.session.set({ pendingIds });
  const status = message.status;
  if (status !== "filled" && status !== "no-form" && status !== "plus" && status !== "captcha") return { ok: true };
  const state = await Immo.storage.getAll();
  if (!state.listings[id]) return { ok: true };
  let requests = state.requests;
  if (status === "filled") requests = Immo.listings.putDraft(requests, id);
  else if (status === "no-form") requests = Immo.listings.putOutcome(requests, id, "no-form", "manual");
  else if (status === "plus") requests = Immo.listings.putOutcome(requests, id, "plus", "manual");
  else if (status === "captcha") requests = Immo.listings.putOutcome(requests, id, "captcha", "manual");
  await Immo.storage.writeLocal("fill-result", { requests });
  return { ok: true };
}

async function onSendResult(message) {
  const id = String(message.id || "");
  const outcome = message.outcome;
  const state = await Immo.storage.getAll();
  const current = state.requests[id];
  if (!current || !state.listings[id]) return { ok: true };
  if (current.status === "sent" && outcome === "sent") return { ok: true };
  const next = Immo.listings.applySendOutcome(current, outcome);
  let settings = state.settings;
  if (outcome === "sent" && current.source === "auto" && current.status !== "sent") {
    settings = { ...settings, sentCount: settings.sentCount + 1, sentOn: Immo.listings.localDay() };
  }
  if (outcome === "login" && current.source === "auto") settings = { ...settings, autoSend: false };
  await Immo.storage.writeLocal("send-result", { requests: { ...state.requests, [id]: next }, settings });
  const session = await clearSending(id);
  if (session.sendingId === id && session.sendingTabId) {
    if (outcome === "sent") {
      try {
        await chrome.tabs.remove(session.sendingTabId);
      } catch {
        /* already closed */
      }
    } else if (outcome === "captcha") {
      const tab = await getTabOrNull(session.sendingTabId);
      if (tab) await focusTab(tab);
    }
  }
  if (current.source === "auto" && outcome !== "sent") await notifyNeeds(state.listings[id], next);
  const latest = await Immo.storage.getAll();
  if (latest.settings.autoSend && latest.settings.watching && !latest.settings.paused && outcome !== "login") {
    await considerAutoSend();
  }
  return { ok: true };
}

async function focusExpose(id) {
  const state = await Immo.storage.getAll();
  const item = state.listings[String(id)];
  if (!item) return openAndFill(id);
  const session = await sessionBits();
  if (session.sendingId === String(id) && session.sendingTabId) {
    const sending = await getTabOrNull(session.sendingTabId);
    if (sending) {
      await focusTab(sending);
      return { ok: true, state: await publicState() };
    }
  }
  const tabs = await chrome.tabs.query({});
  const open = tabs.find((tab) => tab.url && tab.url.includes(`/expose/${id}`));
  if (open) {
    await focusTab(open);
    return { ok: true, state: await publicState() };
  }
  return openAndFill(id);
}

async function handle(message, sender) {
  switch (message.type) {
    case "get-state":
      return { state: await publicState() };
    case "save-settings":
      await Immo.storage.saveSettings(message.profile, message.searchUrl, {
        autoSend: message.autoSend,
        dailyCap: message.dailyCap,
      });
      return { ok: true, state: await publicState() };
    case "start":
      return start();
    case "pause":
      return pause();
    case "resume":
      return resume();
    case "stop":
      return stop();
    case "close-watch-tab":
      return closeWatchTab();
    case "show-watch-tab":
      return showWatchTab();
    case "return-to-search":
      return returnToSearch();
    case "reload-watch-tab":
      return reloadWatchTab();
    case "open-and-fill":
      return openAndFill(message.id);
    case "dismiss":
      return dismiss(message.id);
    case "set-collapsed":
      return setCollapsed(message.id, message.collapsed);
    case "watch-gate":
      return onWatchGate(message, sender);
    case "watch-loaded":
      return onWatchLoaded(message, sender);
    case "expose-details":
      return onExposeDetails(message, sender);
    case "chat-status":
      return onChatStatus(message);
    case "should-fill":
      return onShouldFill(message);
    case "fill-result":
      return onFillResult(message);
    case "send-result":
      return onSendResult(message);
    case "messages-gate":
      return onMessagesGate(message, sender);
    case "inbox-loaded":
      return onInboxLoaded(message);
    case "reload-messages-tab":
      return reloadMessagesTab();
    default:
      return { error: "Unbekannte Aktion." };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse).catch((err) => {
    sendResponse({ error: err.userMessage || err.message || String(err) });
  });
  return true;
});

async function onMessagesAlarm() {
  const state = await Immo.storage.getAll();
  if (!state.settings.watching || state.settings.paused) return;
  try {
    let tab = await getMessagesTab();
    if (!tab) {
      tab = await findRestoredMessagesTab();
      if (tab) await rememberMessagesTab(tab.id);
    }
    if (!tab) {
      await createMessagesTab();
      return;
    }
    if (tab.discarded || !tab.url || !tab.url.includes("/messenger/conversations")) {
      await chrome.tabs.update(tab.id, { url: MESSAGES_URL });
    } else {
      await chrome.tabs.reload(tab.id);
    }
  } finally {
    const latest = await Immo.storage.getAll();
    if (latest.settings.watching && !latest.settings.paused) await scheduleMessages();
  }
}

async function onMessagesGate(_message, sender) {
  const tabId = sender.tab && sender.tab.id;
  const { messagesTabId } = await sessionBits();
  if (!tabId || tabId !== messagesTabId) return { isMessagesTab: false };
  const state = await publicState();
  return {
    isMessagesTab: true,
    watching: state.watching,
    paused: state.paused,
    counts: state.counts,
  };
}

async function reloadMessagesTab() {
  const state = await Immo.storage.getAll();
  let tab = await getMessagesTab();
  if (!tab) return { error: "Kein Nachrichten-Tab offen.", state: await publicState() };
  if (tab.discarded || !tab.url || !tab.url.includes("/messenger/conversations")) {
    await chrome.tabs.update(tab.id, { url: MESSAGES_URL });
  } else {
    await chrome.tabs.reload(tab.id);
  }
  if (state.settings.watching && !state.settings.paused) await scheduleMessages();
  return { ok: true, state: await publicState() };
}

async function onInboxLoaded(message) {
  const state = await Immo.storage.getAll();
  const applied = Immo.listings.applyConversationList(state.listings, state.requests, message.rows || []);
  const same = JSON.stringify(applied.listings) === JSON.stringify(state.listings)
    && JSON.stringify(applied.requests) === JSON.stringify(state.requests);
  if (!same) {
    await Immo.storage.writeLocal("inbox-loaded", { listings: applied.listings, requests: applied.requests });
  }
  const latest = await publicState();
  return { ok: true, counts: latest.counts };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) return onAlarm();
  if (alarm.name === MESSAGES_ALARM) return onMessagesAlarm();
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const need = String(notificationId).match(/^need-(\d+)$/);
  const expose = String(notificationId).match(/^expose-(\d+)$/);
  if (need) return focusExpose(need[1]);
  if (expose) return openAndFill(expose[1]);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await sessionBits();
  if (tabId === session.sendingTabId && session.sendingId) {
    const state = await Immo.storage.getAll();
    const request = state.requests[session.sendingId];
    if (request && request.status === "sending") {
      const next = { ...request, status: "needs-you", reason: request.reason || "" };
      await Immo.storage.writeLocal("send-result", { requests: { ...state.requests, [session.sendingId]: next } });
      await notifyNeeds(state.listings[session.sendingId], next);
    }
    await chrome.storage.session.remove(["sendingId", "sendingTabId"]);
  }
  if (tabId === session.messagesTabId) {
    await chrome.storage.session.remove("messagesTabId");
  }
  if (tabId !== session.watchTabId) return;
  const windows = await chrome.windows.getAll();
  await chrome.storage.session.remove("watchTabId");
  if (windows.length === 0) return;
  await chrome.storage.session.set({ watchMissing: true, watchOffSearch: false });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") ensureWatch();
});

chrome.runtime.onStartup.addListener(() => {
  ensureWatch();
});

updateBadge();
