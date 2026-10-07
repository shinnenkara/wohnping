importScripts("../lib/url.js", "../lib/listings.js", "../lib/storage.js");

const ALARM = "watch-reload";
const Immo = globalThis.Immo;

function alarmDelay() {
  return 1;
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
  return chrome.storage.session.get(["watchTabId", "watchOffSearch", "watchMissing", "pendingIds"]);
}

async function getWatchTab() {
  const { watchTabId } = await sessionBits();
  return getTabOrNull(watchTabId);
}

async function publicState() {
  const local = await Immo.storage.getAll();
  const session = await sessionBits();
  const tab = await getTabOrNull(session.watchTabId);
  const listings = Object.values(local.listings).sort((a, b) => b.firstSeen - a.firstSeen);
  return {
    profile: local.profile,
    searchUrl: local.searchUrl,
    watching: local.watching,
    paused: local.paused,
    lastReloadAt: local.lastReloadAt,
    baselineUrl: local.baselineUrl,
    listings,
    watchTabOpen: !!tab,
    watchOffSearch: !!(tab && session.watchOffSearch),
    watchMissing: !!(local.watching && !local.paused && !tab && session.watchMissing),
    warnings: local.searchUrl ? Immo.url.validateSearchUrl(local.searchUrl).warnings || [] : [],
  };
}

async function updateBadge() {
  const state = await Immo.storage.getAll();
  if (state.watching && state.paused) {
    await chrome.action.setBadgeBackgroundColor({ color: "#a16207" });
    await chrome.action.setBadgeText({ text: "Pause" });
  } else if (state.watching) {
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
    /* the watch tab still exists even if the window could not be focused */
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

async function ensureWatch() {
  const state = await Immo.storage.getAll();
  if (!state.watching || state.paused || !state.searchUrl) {
    await chrome.alarms.clear(ALARM);
    await updateBadge();
    return;
  }
  let tab = await getWatchTab();
  if (!tab) {
    tab = await findRestoredWatchTab(state.searchUrl);
    if (tab) await rememberTab(tab.id);
  }
  if (!tab) tab = await createWatchTab(state.searchUrl);
  await chrome.alarms.create(ALARM, { periodInMinutes: alarmDelay() });
  await updateBadge();
}

async function start() {
  const state = await Immo.storage.getAll();
  const validated = validatedOrThrow(state.searchUrl);
  if (validated.url !== state.searchUrl) {
    await Immo.storage.saveSettings(state.profile, validated.url);
  }
  const fresh = await Immo.storage.getAll();
  if (!Immo.url.sameSearch(fresh.baselineUrl, validated.url)) {
    await chrome.storage.local.set({ baselineUrl: "" });
  }
  await chrome.storage.local.set({ watching: true, paused: false, searchUrl: validated.url });
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
  await chrome.alarms.create(ALARM, { periodInMinutes: alarmDelay() });
  await updateBadge();
  return { ok: true, warnings: validated.warnings, state: await publicState() };
}

async function pause() {
  await chrome.storage.local.set({ watching: true, paused: true });
  await chrome.alarms.clear(ALARM);
  await updateBadge();
  await pushWatchState();
  return { ok: true, state: await publicState() };
}

async function resume() {
  const state = await Immo.storage.getAll();
  if (!state.watching) return start();
  validatedOrThrow(state.searchUrl);
  await chrome.storage.local.set({ paused: false });
  let tab = await getWatchTab();
  if (!tab) tab = await createWatchTab(state.searchUrl);
  await chrome.alarms.create(ALARM, { periodInMinutes: alarmDelay() });
  await updateBadge();
  await pushWatchState();
  return { ok: true, state: await publicState() };
}

async function stop() {
  const tab = await getWatchTab();
  await chrome.storage.local.set({ watching: false, paused: false });
  await chrome.alarms.clear(ALARM);
  await chrome.storage.session.remove(["watchOffSearch", "watchMissing"]);
  await updateBadge();
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
  await chrome.storage.local.set({ lastReloadAt: Date.now() });
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

async function openAndFill(id) {
  const state = await Immo.storage.getAll();
  const item = state.listings[String(id)];
  if (!item) return { error: "Unbekanntes Inserat.", state: await publicState() };
  const session = await sessionBits();
  const pendingIds = { ...(session.pendingIds || {}), [String(id)]: true };
  await chrome.storage.session.set({ pendingIds });
  await chrome.storage.local.set({ listings: Immo.listings.setStatus(state.listings, id, "opened") });
  await chrome.tabs.create({ url: item.url, active: true });
  return { ok: true, state: await publicState() };
}

async function dismiss(id) {
  const state = await Immo.storage.getAll();
  await chrome.storage.local.set({ listings: Immo.listings.setStatus(state.listings, id, "dismissed") });
  return { ok: true, state: await publicState() };
}

async function setCollapsed(id, collapsed) {
  const state = await Immo.storage.getAll();
  await chrome.storage.local.set({ listings: Immo.listings.setCollapsed(state.listings, id, collapsed) });
  return { ok: true, state: await publicState() };
}

async function onAlarm() {
  const state = await Immo.storage.getAll();
  if (!state.watching || state.paused) return;
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
  await chrome.storage.local.set({ lastReloadAt: Date.now() });
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
    watching: state.watching,
    paused: state.paused,
    offSearch,
  };
}

async function onWatchLoaded(message, sender) {
  const gate = await onWatchGate(message, sender);
  if (!gate.isWatchTab || !gate.watching || gate.offSearch) return gate;
  const state = await Immo.storage.getAll();
  const baseline = !state.baselineUrl || !Immo.url.sameSearch(state.baselineUrl, state.searchUrl);
  const { listings, fresh } = Immo.listings.upsertAll(state.listings, message.listings || [], baseline);
  await chrome.storage.local.set({
    listings,
    baselineUrl: state.searchUrl,
    lastReloadAt: Date.now(),
  });
  if (!state.paused) {
    for (const item of fresh) await notifyListing(item);
  }
  return { ...gate, added: fresh.length };
}

async function onShouldFill(message) {
  const id = String(message.id || "");
  const session = await sessionBits();
  const pending = session.pendingIds || {};
  if (!message.force && !pending[id]) return { fill: false };
  const state = await Immo.storage.getAll();
  return { fill: true, profile: state.profile };
}

async function onFillResult(message) {
  const id = String(message.id || "");
  const session = await sessionBits();
  const pendingIds = { ...(session.pendingIds || {}) };
  delete pendingIds[id];
  await chrome.storage.session.set({ pendingIds });
  if (message.status === "filled" || message.status === "no-form") {
    const state = await Immo.storage.getAll();
    const extra = message.status === "filled" ? { appliedAt: Date.now() } : {};
    await chrome.storage.local.set({ listings: Immo.listings.setStatus(state.listings, id, message.status, extra) });
  }
  return { ok: true };
}

async function handle(message, sender) {
  switch (message.type) {
    case "get-state":
      return { state: await publicState() };
    case "save-settings": {
      await Immo.storage.saveSettings(message.profile, message.searchUrl);
      return { ok: true, state: await publicState() };
    }
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
    case "should-fill":
      return onShouldFill(message);
    case "fill-result":
      return onFillResult(message);
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) onAlarm();
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const match = String(notificationId).match(/^expose-(\d+)$/);
  if (match) openAndFill(match[1]);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { watchTabId } = await sessionBits();
  if (tabId !== watchTabId) return;
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
