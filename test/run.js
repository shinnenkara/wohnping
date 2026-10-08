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
  "storage-clears-baseline",
  "parse-json",
  "parse-html",
  "watch-baseline",
  "watch-new-id",
  "watch-should-fill",
  "watch-fill-result",
  "package-boundary",
];
const REQUIRED_CONTRACTS = 13;

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
loadScript("parse/search-results.js");

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

function rowsOf(listings) {
  return Object.values(listings)
    .map((row) => ({ id: String(row.id), status: row.status, title: row.title || "" }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function statusesOf(listings) {
  const out = {};
  for (const row of rowsOf(listings)) out[row.id] = row.status;
  return out;
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
  const first = Immo.listings.upsertAll({}, input.first, true);
  const second = Immo.listings.upsertAll(first.listings, input.second, false);
  return {
    afterBaseline: { fresh: first.fresh.map((row) => row.id), rows: rowsOf(first.listings) },
    afterNext: { fresh: second.fresh.map((row) => row.id), rows: rowsOf(second.listings) },
  };
}

function runListingsReplied(input) {
  const existing = {};
  for (const item of input.existing) existing[item.id] = storedRow(item);
  const replied = Immo.listings.upsertAll(existing, input.incoming, false);
  const trimExisting = {};
  trimExisting[input.trim.newId] = storedRow({ id: input.trim.newId, status: "new", firstSeen: 0, title: "Neu" });
  for (let i = 1; i <= input.trim.droppable; i += 1) {
    const id = `drop-${i}`;
    trimExisting[id] = storedRow({ id, status: "dismissed", firstSeen: i, title: id });
  }
  const trimmed = Immo.listings.upsertAll(
    trimExisting,
    [{ id: input.trim.incomingId, title: "Extra", replied: false }],
    false,
  );
  const before = new Set(Object.keys(trimExisting));
  before.add(String(input.trim.incomingId));
  const after = new Set(Object.keys(trimmed.listings));
  const dropped = [...before].filter((id) => !after.has(id)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const keptIds = [input.trim.newId, input.trim.incomingId];
  return {
    statuses: statusesOf(replied.listings),
    trim: {
      size: after.size,
      dropped,
      kept: keptIds
        .map((id) => ({ id, status: trimmed.listings[id] ? trimmed.listings[id].status : null }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
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

async function runStorage(input) {
  const result = {};
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
          watching: false,
          paused: false,
          lastReloadAt: 0,
          listings: {},
        }),
      },
    };
    const state = await Immo.storage.saveSettings({}, nextUrl);
    result[name] = state.baselineUrl;
  }
  return result;
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

async function bootWorker(localData, sessionData) {
  const local = memoryArea(localData);
  const session = memoryArea(sessionData);
  const notificationIds = [];
  const chrome = {
    storage: { local, session },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
    },
    alarms: {
      async clear() {},
      async create() {},
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
      async create() {
        return { id: 1 };
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
  const context = { console, URL, Date, Intl, chrome };
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
    local,
    session,
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
    rows: rowsOf(stored.listings),
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
    rows: rowsOf(stored.listings),
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
    status: local.listings[input.id] ? local.listings[input.id].status : null,
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
  "storage-clears-baseline": runStorage,
  "parse-json"(input, file) {
    const listings = Immo.search.listingsFromJsonText(fs.readFileSync(file, "utf8"));
    assert.deepEqual(listings, Immo.search.extractListings(input));
    return { listings };
  },
  "parse-html"(_input, file) {
    const { document } = parseHTML(fs.readFileSync(file, "utf8"));
    return { listings: Immo.search.parseSearchResults(document) };
  },
  "watch-baseline": runWatchBaseline,
  "watch-new-id": runWatchNewId,
  "watch-should-fill": runWatchShouldFill,
  "watch-fill-result": runWatchFillResult,
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
