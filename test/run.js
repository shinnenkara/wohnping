import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { writePackage } from "../scripts/pack.js";

// Golden files are the contract. This runner has no flag that rewrites them.
if (process.argv.some((arg) => arg === "--update" || arg === "-u")) {
  throw new Error("Golden files are not rewritten by the runner.");
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "test", "fixtures");
const WORKER = path.join(ROOT, "background", "service-worker.js");

const CONTRACTS = [
  "url-canonical",
  "url-validate",
  "greeting",
  "listings-baseline-and-fresh",
  "listings-replied-and-trim",
  "listings-details",
  "storage-clears-baseline",
  "storage-migrates",
  "storage-write-error",
  "inbox-and-same-flat",
  "profile-and-cap",
  "send-outcome",
  "reload-delay",
  "parse-json",
  "parse-html",
  "parse-expose",
  "parse-chat",
  "watch-baseline",
  "watch-new-id",
  "watch-should-fill",
  "watch-fill-result",
  "sent-today",
  "parse-inbox",
  "package-boundary",
];
const REQUIRED_CONTRACTS = 24;

const PACKAGE_PERMISSIONS = ["alarms", "notifications", "storage", "tabs"];
const PACKAGE_HOSTS = ["https://*.immobilienscout24.de/*", "https://immobilienscout24.de/*"];
const PACKAGE_DENY_FILES = ["package.json", "package-lock.json"];
const PACKAGE_DENY_PREFIXES = ["test/", "node_modules/", "scripts/", "docs/"];

function loadScript(rel) {
  const abs = path.join(ROOT, rel);
  vm.runInThisContext(fs.readFileSync(abs, "utf8"), { filename: abs });
}

loadScript("lib/url.js");
loadScript("lib/greeting.js");
loadScript("lib/listings.js");
loadScript("lib/storage.js");
loadScript("lib/reload.js");
loadScript("parse/search-results.js");
loadScript("parse/expose-page.js");
loadScript("parse/chat-thread.js");
loadScript("parse/conversations.js");

const Immo = globalThis.Immo;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function inputPath(id) {
  const json = path.join(FIXTURES, `${id}.input.json`);
  const html = path.join(FIXTURES, `${id}.input.html`);
  if (fs.existsSync(json)) return json;
  if (fs.existsSync(html)) return html;
  return null;
}

function expectedPath(id) {
  const file = path.join(FIXTURES, `${id}.expected.json`);
  return fs.existsSync(file) ? file : null;
}

function enforceCensus() {
  if (CONTRACTS.length !== REQUIRED_CONTRACTS) {
    throw new Error(`The contract list is ${CONTRACTS.length}, the required count is ${REQUIRED_CONTRACTS}.`);
  }
  if (new Set(CONTRACTS).size !== CONTRACTS.length) throw new Error("Duplicate contract id.");
  const known = new Set(CONTRACTS);
  for (const id of CONTRACTS) {
    if (typeof EXECUTE[id] !== "function") throw new Error(`Missing runner for ${id}.`);
    if (!inputPath(id)) throw new Error(`Missing input for ${id}.`);
    if (!expectedPath(id)) throw new Error(`Missing golden output for ${id}.`);
  }
  for (const file of fs.readdirSync(FIXTURES)) {
    const match = /^(.*)\.(input|expected)\.(json|html)$/.exec(file);
    if (!match || !known.has(match[1])) throw new Error(`Fixture is not in the contract list: ${file}`);
  }
}

function requestOf(request) {
  if (!request) return null;
  return { status: request.status, source: request.source, reason: request.reason || "" };
}

function rowsOf(listings, hits, requests) {
  const hitMap = hits || {};
  const requestMap = requests || {};
  return Object.values(listings)
    .map((row) => ({
      id: String(row.id),
      title: row.title || "",
      inBaseline: !!(hitMap[row.id] && hitMap[row.id].inBaseline),
      request: requestOf(requestMap[row.id]),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function storedRow(partial) {
  return {
    url: partial.url || `https://www.immobilienscout24.de/expose/${partial.id}`,
    title: partial.title || "",
    price: partial.price || "",
    area: partial.area || "",
    rooms: partial.rooms ?? "",
    collapsed: false,
    ...partial,
  };
}

function runUrlCanonical(input) {
  return {
    left: Immo.url.canonicalUrl(input.left),
    right: Immo.url.canonicalUrl(input.right),
    sameLeftRight: Immo.url.sameSearch(input.left, input.right),
    sameLeftOther: Immo.url.sameSearch(input.left, input.other),
  };
}

function projectValidation(result) {
  if (result.error) return { error: result.error };
  return { url: result.url, warnings: result.warnings };
}

function runUrlValidate(input) {
  return { cases: input.cases.map((item) => projectValidation(Immo.url.validateSearchUrl(item.raw))) };
}

function runGreeting(input) {
  return {
    cases: input.cases.map((item) => ({
      greeting: Immo.greeting.buildGreeting(item.name),
      message: Immo.greeting.buildMessage(item.template, item.name),
    })),
  };
}

function runListingsBaseline(input) {
  const first = Immo.listings.upsertAll({}, {}, {}, input.first, true, 1000);
  const second = Immo.listings.upsertAll(first.listings, first.hits, first.requests, input.second, false, 2000);
  return {
    afterBaseline: { fresh: first.fresh.map((row) => row.id), rows: rowsOf(first.listings, first.hits, first.requests) },
    afterNext: { fresh: second.fresh.map((row) => row.id), rows: rowsOf(second.listings, second.hits, second.requests) },
  };
}

function threadId(n) {
  return `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
}

function runListingsDetails(input) {
  const existing = { [input.existing.id]: storedRow(input.existing) };
  const stamped = Immo.listings.upsertAll(existing, {}, {}, input.incoming, false, 1000);
  const merged = Immo.listings.mergeDetails(stamped.listings, input.existing.id, input.details, "", 1000);
  const kept = merged[input.existing.id];
  const answered = Immo.listings.applyChat(merged, {}, stamped.requests, {
    conversationId: input.thread.conversationId,
    direction: input.thread.direction,
    on: input.thread.on,
    exposeId: input.existing.id,
    in: 1,
    out: 0,
  }, 3000);
  const after = Immo.listings.upsertAll(merged, {}, stamped.requests, input.incoming, false, 2000);
  const survived = after.listings[kept.id];
  const created = Immo.listings.mergeDetails({}, input.freshId, input.details, input.freshTitle, 1000);
  const held = Immo.listings.applyChat(created, {}, {}, input.held, 1000);
  const taken = Immo.listings.takeThreads(created, held.threads, {}, input.freshId, 1000);
  const addressListings = {
    [input.freshId]: storedRow({
      id: input.freshId,
      details: { address: input.details.address },
    }),
  };
  const byAddress = Immo.listings.applyChat(addressListings, {}, {}, input.chat, 1000);
  const ambiguousListings = {
    a: storedRow({ id: "a", details: { address: input.details.address } }),
    b: storedRow({ id: "b", details: { address: input.chat.address } }),
  };
  const ambiguous = Immo.listings.applyChat(ambiguousListings, {}, {}, input.chat, 1000);
  let capped = {};
  for (let n = 1; n <= input.cap; n += 1) {
    const step = Immo.listings.applyChat(capped.listings || {}, capped.threads || {}, capped.requests || {}, {
      conversationId: threadId(n),
      direction: "out",
      on: "2026-10-01",
    }, 1000);
    capped = step;
  }
  const leaked = JSON.stringify({
    kept,
    survived,
    taken: taken.listings[input.freshId],
    byAddress: byAddress.listings[input.freshId],
    ambiguous,
    capped,
  }).includes("DECOY");
  return {
    merged: {
      hasStatus: Object.prototype.hasOwnProperty.call(kept, "status"),
      title: kept.title,
      coldRent: kept.details.coldRent,
      photoCount: kept.details.photoCount,
      addressKey: kept.addressKey,
    },
    answered: answered.requests[input.existing.id].answeredAt === 3000,
    answeredStatus: answered.requests[input.existing.id].status,
    created: {
      hasStatus: Object.prototype.hasOwnProperty.call(created[input.freshId], "status"),
      title: created[input.freshId].title,
    },
    survived: {
      coldRent: survived.details.coldRent,
    },
    byExposeId: {
      direction: taken.threads[input.held.conversationId].direction,
      listingId: taken.threads[input.held.conversationId].listingId,
    },
    byAddress: {
      direction: byAddress.threads[input.chat.conversationId].direction,
      listingId: byAddress.threads[input.chat.conversationId].listingId,
    },
    ambiguous: {
      attached: Object.values(ambiguous.threads).some((thread) => thread.listingId),
      held: Object.keys(ambiguous.threads).length,
    },
    cap: {
      size: Object.keys(capped.threads).length,
      keptLast: !!capped.threads[threadId(input.cap)],
      droppedFirst: !capped.threads[threadId(1)],
    },
    keysEqual: Immo.listings.addressKey(input.details.address) === Immo.listings.addressKey(input.chat.address),
    leaked,
  };
}

async function runReloadDelay(input) {
  const delays = input.rolls.map((roll) => Immo.reload.nextDelay(() => roll));
  const high = Immo.reload.nextDelay(() => input.high);
  const worker = await bootWorker(watchLocal(input.searchUrl), {});
  await worker.fireAlarm();
  const scheduled = worker.alarmCreates[worker.alarmCreates.length - 1] || {};
  const delay = scheduled.delayInMinutes;
  return {
    delays,
    highInRange: high >= 1 && high < 5,
    rescheduled: delay >= 1 && delay < 5 && scheduled.periodInMinutes == null,
  };
}

function runListingsReplied(input) {
  const existing = {};
  for (const item of input.existing) existing[item.id] = storedRow(item);
  const replied = Immo.listings.upsertAll(existing, {}, {}, input.incoming, false, 5000);
  const requests = {};
  for (const id of Object.keys(replied.requests).sort()) {
    requests[id] = requestOf(replied.requests[id]);
  }
  const dismissed = Object.values(replied.listings)
    .filter((row) => row.dismissedAt)
    .map((row) => row.id)
    .sort();
  const trimExisting = {};
  trimExisting[input.trim.newId] = storedRow({ id: input.trim.newId, status: "new", firstSeen: 0, title: "Neu" });
  for (let i = 1; i <= input.trim.droppable; i += 1) {
    const id = `drop-${i}`;
    trimExisting[id] = storedRow({ id, status: "dismissed", firstSeen: i, title: id });
  }
  const trimmed = Immo.listings.upsertAll(
    trimExisting,
    {},
    {},
    [{ id: input.trim.incomingId, title: "Extra", replied: false }],
    false,
    6000,
  );
  return {
    requests,
    dismissed,
    keptSize: Object.keys(trimmed.listings).length,
  };
}

function memoryArea(initial) {
  const data = { ...initial };
  return {
    async get(keys) {
      const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of list) if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
      return out;
    },
    async set(patch) {
      Object.assign(data, patch);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    snapshot() {
      return structuredClone(data);
    },
  };
}

const FIXED_NOW = Date.parse("2026-11-03T12:00:00");

function fixedSettings(extra) {
  return {
    watching: false,
    paused: false,
    autoSend: false,
    dailyCap: 20,
    sentOn: "2026-11-03",
    sentCount: 0,
    ...extra,
  };
}

async function runStorage(input) {
  const result = {};
  Immo.storage.now = () => FIXED_NOW;
  try {
    for (const [name, nextUrl] of [
      ["changed", input.nextSearchUrl],
      ["unchanged", input.savedSearchUrl],
    ]) {
      globalThis.chrome = {
        storage: {
          local: memoryArea({
            profile: {},
            searchUrl: input.savedSearchUrl,
            baselineUrl: input.baselineUrl,
            settings: fixedSettings(),
            listings: {},
            hits: input.hits,
            requests: {},
            threads: {},
          }),
        },
      };
      const state = await Immo.storage.saveSettings({}, nextUrl);
      const hit = state.hits["10"];
      result[name] = { baselineUrl: state.baselineUrl, inBaseline: !!(hit && hit.inBaseline) };
    }
  } finally {
    Immo.storage.now = null;
  }
  return result;
}

function runStorageMigrates(input) {
  const composed = Immo.storage.composeState(input.stored, FIXED_NOW);
  const listing = composed.state.listings["10"];
  const request = composed.state.requests["10"];
  const thread = Object.values(composed.state.threads)[0];
  return {
    watching: composed.state.settings.watching,
    autoSend: composed.state.settings.autoSend,
    removed: composed.remove.slice().sort(),
    listingHasStatus: !!(listing && listing.status),
    seenAt: !!(listing && listing.seenAt),
    hitBaseline: composed.state.hits["10"].inBaseline,
    request: request ? { status: request.status, source: request.source } : null,
    threadListingId: thread ? thread.listingId : "",
    answered: !!(request && request.answeredAt),
  };
}

async function runStorageWriteError(input) {
  Immo.storage.now = () => FIXED_NOW;
  const local = memoryArea(input.stored);
  local.set = async () => {
    throw new Error(input.message);
  };
  const session = memoryArea({});
  globalThis.chrome = { storage: { local, session } };
  let failure = null;
  try {
    await Immo.storage.saveSettings({ firstName: "Ada" }, input.stored.searchUrl);
  } catch (err) {
    failure = err.storageFailure;
  } finally {
    Immo.storage.now = null;
  }
  return {
    failure,
    title: local.snapshot().listings["10"].title,
    session: session.snapshot().storageError,
  };
}

function runInbox(input) {
  const box = Immo.listings.inbox(input.listings, input.hits, input.requests);
  return {
    fresh: box.fresh,
    needsYou: box.needsYou,
    blocked: Immo.listings.sameFlatConflict(input.listings[input.focus], input.listings, input.requests),
    next: (Immo.listings.nextAutoSend(input.listings, input.hits, input.requests) || {}).id || "",
  };
}

function runProfile(input) {
  const rolled = Immo.storage.normalizeSettings(input.yesterday, FIXED_NOW);
  const held = Immo.storage.normalizeSettings(input.today, FIXED_NOW);
  const wide = Immo.storage.normalizeSettings(input.wideCap, FIXED_NOW);
  return {
    missing: Immo.listings.missingFields(input.incomplete),
    complete: Immo.listings.missingFields(input.complete),
    exact: Immo.listings.missingFields(input.exact),
    rolled: { sentOn: rolled.sentOn, sentCount: rolled.sentCount },
    held: { sentOn: held.sentOn, sentCount: held.sentCount },
    cap: wide.dailyCap,
    cappedToday: Immo.listings.cappedToday({
      a: { status: "skipped", reason: "cap", createdAt: FIXED_NOW },
    }, "2026-11-03"),
  };
}

async function runSentToday(input) {
  const now = Date.parse(input.now);
  const requests = {};
  for (const [id, req] of Object.entries(input.requests)) {
    let sentAt = 0;
    if (req.sentOn === "today") sentAt = now;
    else if (req.sentOn === "yesterday") {
      const prior = new Date(now);
      prior.setDate(prior.getDate() - 1);
      sentAt = prior.getTime();
    }
    requests[id] = {
      listingId: id,
      status: req.status,
      reason: "",
      source: req.source,
      createdAt: sentAt,
      sentAt,
      answeredAt: 0,
    };
  }
  const tallies = Immo.listings.sentTallies(requests, now);
  const applied = Immo.listings.applyConversationList(input.listings, input.open, input.rows, now);
  const view = {};
  for (const id of Object.keys(applied.requests).sort()) {
    const req = applied.requests[id];
    view[id] = {
      status: req.status,
      source: req.source,
      answered: !!req.answeredAt,
      sentToday: Immo.listings.localDay(req.sentAt) === Immo.listings.localDay(now),
    };
  }
  return {
    shown: tallies.shown,
    auto: tallies.auto,
    capIgnoresManual: tallies.auto < input.cap && tallies.shown > tallies.auto,
    messagesDelay: input.rolls.map((roll) => Immo.reload.nextMessagesDelay(() => roll)),
    matched: applied.matched,
    requests: view,
    deactivated: Object.values(applied.listings).filter((row) => row.deactivated).map((row) => row.id).sort(),
  };
}

async function runSendOutcome(input) {
  const out = {};
  for (const outcome of input.outcomes) {
    const next = Immo.listings.applySendOutcome(input.request, outcome, 80);
    out[outcome] = { status: next.status, reason: next.reason, sent: next.status === "sent" };
  }
  const readyProfile = {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "030123",
    street: "Hauptstr",
    houseNumber: "1",
    postcode: "10115",
    city: "Berlin",
    incomeAmount: "3000",
    message: "Guten Tag.",
    moveInDateType: "FROM_NOW",
  };
  const capWorker = await bootWorker({
    profile: readyProfile,
    searchUrl: input.searchUrl,
    baselineUrl: input.searchUrl,
    settings: fixedSettings({ watching: true, autoSend: true, sentCount: 20, dailyCap: 20 }),
    listings: {},
    hits: {},
    requests: {},
    threads: {},
  }, { watchTabId: 7 }, FIXED_NOW);
  await sendWatchLoaded(capWorker, { searchUrl: input.searchUrl, tabId: 7 }, [
    { id: "21", title: "Grenze" },
    { id: "22", title: "Bleibt" },
  ]);
  const capStored = capWorker.local.snapshot();
  const loginWorker = await bootWorker({
    profile: {},
    searchUrl: input.searchUrl,
    baselineUrl: input.searchUrl,
    settings: fixedSettings({ watching: true, autoSend: true, sentCount: 3 }),
    listings: {
      "9": {
        id: "9",
        title: "Wand",
        url: "https://www.immobilienscout24.de/expose/9",
        price: "",
        area: "",
        rooms: "",
        firstSeen: 1,
        lastSeen: 1,
        collapsed: false,
        addressKey: "",
      },
    },
    hits: { "9": { listingId: "9", firstSeen: 1, lastSeen: 1, inBaseline: false } },
    requests: {
      "9": { listingId: "9", status: "sending", reason: "", source: "auto", createdAt: 1, sentAt: 0, answeredAt: 0 },
    },
    threads: {},
  }, { watchTabId: 7, sendingId: "9", sendingTabId: 4 }, FIXED_NOW);
  await loginWorker.send({ type: "send-result", id: "9", outcome: "login" });
  const loginStored = loginWorker.local.snapshot();
  return {
    ...out,
    capRun: {
      skipped: requestOf(capStored.requests["21"]),
      untouched: capStored.requests["22"] || null,
      sentCount: capStored.settings.sentCount,
      autoSend: capStored.settings.autoSend,
      tabs: capWorker.tabCreates.length,
      notified: capWorker.notificationIds.includes("cap-reached"),
    },
    loginRun: {
      request: requestOf(loginStored.requests["9"]),
      autoSend: loginStored.settings.autoSend,
      watching: loginStored.settings.watching,
    },
  };
}

function listenerBag() {
  const list = [];
  return {
    addListener(fn) {
      list.push(fn);
    },
    get list() {
      return list;
    },
  };
}

function exposeListing(item) {
  return {
    id: String(item.id),
    url: item.url || `https://www.immobilienscout24.de/expose/${item.id}`,
    title: item.title || "",
    price: item.price || "",
    area: item.area || "",
    rooms: item.rooms ?? "",
    replied: !!item.replied,
  };
}

async function bootWorker(localData, sessionData, now) {
  const local = memoryArea(localData);
  const session = memoryArea(sessionData);
  const notificationIds = [];
  const alarmCreates = [];
  const tabCreates = [];
  const clock = typeof now === "number" ? now : null;
  function FixedDate(...args) {
    if (!args.length) return new Date(clock == null ? Date.now() : clock);
    return new Date(...args);
  }
  FixedDate.now = () => (clock == null ? Date.now() : clock);
  FixedDate.parse = Date.parse;
  FixedDate.UTC = Date.UTC;
  const chrome = {
    storage: { local, session },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
    },
    alarms: {
      async clear() {},
      async create(_name, info) {
        alarmCreates.push(info || {});
      },
      onAlarm: listenerBag(),
    },
    notifications: {
      async create(id) {
        notificationIds.push(id);
      },
      onClicked: listenerBag(),
    },
    tabs: {
      async get() {
        return null;
      },
      async create(info) {
        tabCreates.push(info || {});
        return { id: tabCreates.length };
      },
      async update() {},
      async query() {
        return [];
      },
      async reload() {},
      async remove() {},
      async sendMessage() {},
      onRemoved: listenerBag(),
    },
    windows: {
      async update() {},
      async getAll() {
        return [{ id: 1 }];
      },
    },
    runtime: {
      getURL(file) {
        return `chrome-extension://cage/${file}`;
      },
      onMessage: listenerBag(),
      onInstalled: listenerBag(),
      onStartup: listenerBag(),
    },
  };
  const context = { console, URL, Date: clock == null ? Date : FixedDate, Intl, chrome };
  vm.createContext(context);
  context.importScripts = (...urls) => {
    for (const url of urls) {
      const abs = path.resolve(path.dirname(WORKER), url);
      vm.runInContext(fs.readFileSync(abs, "utf8"), context, { filename: abs });
    }
  };
  vm.runInContext(fs.readFileSync(WORKER, "utf8"), context, { filename: WORKER });
  await new Promise((resolve) => setImmediate(resolve));
  return {
    notificationIds,
    alarmCreates,
    tabCreates,
    local,
    session,
    fireAlarm() {
      const listeners = chrome.alarms.onAlarm.list;
      if (listeners.length !== 1) throw new Error("Expected one alarm listener.");
      return listeners[0]({ name: "watch-reload" });
    },
    send(message, sender = {}) {
      const listeners = chrome.runtime.onMessage.list;
      if (listeners.length !== 1) throw new Error("Expected one message listener.");
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No response for ${message.type}`)), 1000);
        const stayed = listeners[0](message, sender, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
        if (stayed !== true) {
          clearTimeout(timer);
          reject(new Error("Message listener closed early."));
        }
      });
    },
  };
}

function watchLocal(searchUrl, listings = {}) {
  return {
    profile: {},
    searchUrl,
    watching: true,
    paused: false,
    lastReloadAt: 0,
    listings,
    baselineUrl: "",
  };
}

async function sendWatchLoaded(worker, input, listings) {
  return worker.send(
    { type: "watch-loaded", url: input.searchUrl, listings: listings.map(exposeListing) },
    { tab: { id: input.tabId } },
  );
}

async function runWatchBaseline(input) {
  const worker = await bootWorker(watchLocal(input.searchUrl), { watchTabId: input.tabId });
  const response = await sendWatchLoaded(worker, input, input.listings);
  const stored = worker.local.snapshot();
  return {
    added: response.added,
    notificationIds: worker.notificationIds,
    baselineUrl: stored.baselineUrl,
    rows: rowsOf(stored.listings, stored.hits, stored.requests),
  };
}

async function runWatchNewId(input) {
  const worker = await bootWorker(watchLocal(input.searchUrl), { watchTabId: input.tabId });
  await sendWatchLoaded(worker, input, input.first);
  const response = await sendWatchLoaded(worker, input, input.second);
  const stored = worker.local.snapshot();
  return {
    added: response.added,
    notificationIds: worker.notificationIds,
    rows: rowsOf(stored.listings, stored.hits, stored.requests),
  };
}

async function runWatchShouldFill(input) {
  const worker = await bootWorker(watchLocal(""), {});
  const plain = await worker.send({ type: "should-fill", id: input.id });
  const forced = await worker.send({ type: "should-fill", id: input.id, force: true });
  return {
    plain: { fill: plain.fill },
    forced: { fill: forced.fill, hasProfile: !!forced.profile },
  };
}

async function runWatchFillResult(input) {
  const worker = await bootWorker(watchLocal("", { [input.id]: input.seed }), { pendingIds: { [input.id]: true } });
  await worker.send({ type: "fill-result", id: input.id, status: "filled" });
  const local = worker.local.snapshot();
  const session = worker.session.snapshot();
  return {
    request: requestOf(local.requests[input.id]),
    status: local.listings[input.id] && local.listings[input.id].status ? local.listings[input.id].status : null,
    pendingIds: session.pendingIds || {},
  };
}

function findEocd(buf) {
  const signature = 0x06054b50;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === signature) return i;
  }
  throw new Error("Zip has no central directory.");
}

function readZip(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const files = [];
  const contents = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Bad zip central header.");
    const method = buf.readUInt16LE(cursor + 10);
    const size = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extra = buf.readUInt16LE(cursor + 30);
    const comment = buf.readUInt16LE(cursor + 32);
    const localOff = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    if (method !== 0) throw new Error(`Zip entry is compressed: ${name}`);
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtra = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + localNameLen + localExtra;
    files.push(name);
    contents.set(name, buf.subarray(start, start + size));
    cursor += 46 + nameLen + extra + comment;
  }
  files.sort();
  return { files, contents };
}

function sortedCopy(values) {
  return [...(values || [])].sort();
}

async function runPackageBoundary() {
  const { outPath } = writePackage(ROOT);
  const packed = readZip(fs.readFileSync(outPath));
  const manifest = JSON.parse(packed.contents.get("manifest.json").toString("utf8"));
  const permissions = sortedCopy(manifest.permissions);
  const hostPermissions = sortedCopy(manifest.host_permissions);
  assert.deepEqual(permissions, PACKAGE_PERMISSIONS);
  assert.deepEqual(hostPermissions, PACKAGE_HOSTS);
  for (const name of packed.files) {
    if (PACKAGE_DENY_FILES.includes(name)) throw new Error(`Package contains ${name}`);
    if (PACKAGE_DENY_PREFIXES.some((prefix) => name.startsWith(prefix))) throw new Error(`Package contains ${name}`);
  }
  return { permissions, host_permissions: hostPermissions, files: packed.files };
}

const EXECUTE = {
  "url-canonical": runUrlCanonical,
  "url-validate": runUrlValidate,
  greeting: runGreeting,
  "listings-baseline-and-fresh": runListingsBaseline,
  "listings-replied-and-trim": runListingsReplied,
  "listings-details": runListingsDetails,
  "reload-delay": runReloadDelay,
  "storage-clears-baseline": runStorage,
  "storage-migrates": runStorageMigrates,
  "storage-write-error": runStorageWriteError,
  "inbox-and-same-flat": runInbox,
  "profile-and-cap": runProfile,
  "send-outcome": runSendOutcome,
  "parse-json"(input, file) {
    const listings = Immo.search.listingsFromJsonText(fs.readFileSync(file, "utf8"));
    assert.deepEqual(listings, Immo.search.extractListings(input));
    return { listings };
  },
  "parse-html"(_input, file) {
    const { document } = parseHTML(fs.readFileSync(file, "utf8"));
    return { listings: Immo.search.parseSearchResults(document) };
  },
  "parse-expose"(input) {
    const out = {};
    for (const [name, html] of Object.entries(input.cases)) {
      const { document } = parseHTML(html);
      out[name] = Immo.expose.parse(document);
    }
    return out;
  },
  "parse-chat"(_input, file) {
    const { document } = parseHTML(fs.readFileSync(file, "utf8"));
    return Immo.chat.parse(document);
  },
  "watch-baseline": runWatchBaseline,
  "watch-new-id": runWatchNewId,
  "watch-should-fill": runWatchShouldFill,
  "watch-fill-result": runWatchFillResult,
  "sent-today": runSentToday,
  "parse-inbox"(_input, file) {
    const { document } = parseHTML(fs.readFileSync(file, "utf8"));
    return { rows: Immo.inbox.parse(document) };
  },
  "package-boundary": runPackageBoundary,
};

function loadInput(id) {
  const file = inputPath(id);
  if (file.endsWith(".html")) return { input: null, file };
  return { input: readJson(file), file };
}

let finished = false;

test("contracts", async (t) => {
  enforceCensus();
  for (const id of CONTRACTS) {
    await t.test(id, async () => {
      const { input, file } = loadInput(id);
      const actual = await EXECUTE[id](input, file);
      assert.deepEqual(actual, readJson(expectedPath(id)));
    });
  }
  finished = true;
});

process.on("beforeExit", () => {
  if (!finished) {
    console.error("Contract runner did not finish.");
    process.exit(1);
  }
});
