const EXPOSE_URL = /immobilienscout24\.de\/expose\/\d+/;

const ICONS = {
  collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>',
};

const statusEl = document.querySelector("#status");
const detailEl = document.querySelector("#detail");
const warningEl = document.querySelector("#warning");
const controls = document.querySelector("#controls");
const tabActions = document.querySelector("#tab-actions");
const pageActions = document.querySelector("#page-actions");
const list = document.querySelector("#list");

let onExpose = false;

const watchHandlers = {
  start: () => call("start"),
  pause: () => call("pause"),
  resume: () => call("resume"),
  stop: () => call("stop"),
  reload: () => call("reload-watch-tab"),
  show: () => call("show-watch-tab"),
  close: () => call("close-watch-tab"),
  returnToSearch: () => call("return-to-search"),
};

async function call(type, extra) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (res && res.state) render(res.state);
  else if (!res || !res.error) warningEl.textContent = "";
  if (res && res.error) {
    const rest = res.state ? warningEl.textContent : "";
    warningEl.textContent = rest ? `${res.error} ${rest}` : res.error;
  }
  return res;
}

function render(state) {
  controls.replaceChildren();
  tabActions.replaceChildren();
  pageActions.replaceChildren();

  controls.append(...Immo.actions.sessionControls(state, watchHandlers));
  tabActions.append(...Immo.actions.watchTabControls(state, watchHandlers));
  if (onExpose) {
    pageActions.append(Immo.actions.button({ label: "Diese Seite ausfüllen", onClick: fillActiveTab }));
  }

  Immo.actions.applyStatus(state, statusEl, detailEl);
  warningEl.textContent = Immo.actions.watchNotes(state, { includeWarnings: true });

  const hidden = new Set(["seen", "dismissed", "replied"]);
  const rows = state.listings.filter((item) => !hidden.has(item.status)).slice(0, 24);
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "Keine offenen Angebote. Inserate, die du schon kontaktiert hast, bleiben ausgeblendet.";
    list.append(empty);
    return;
  }
  for (const item of rows) {
    list.append(listingRow(item));
  }
}

function listingRow(item) {
  const collapsed = !!item.collapsed;
  const li = document.createElement("li");
  li.className = collapsed ? "listing collapsed" : "listing";

  const name = item.title || `Inserat ${item.id}`;
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = name;
  title.title = name;

  const toggle = Immo.actions.button({
    label: collapsed ? "Aufklappen" : "Einklappen",
    icon: collapsed ? ICONS.expand : ICONS.collapse,
    variant: "quiet",
    onClick: () => call("set-collapsed", { id: item.id, collapsed: !collapsed }),
  });
  toggle.classList.add("listing-toggle");

  const body = document.createElement("div");
  body.className = "listing-body";

  const idEl = document.createElement("div");
  idEl.className = "listing-id";
  idEl.textContent = item.id;

  const facts = [];
  if (item.price) facts.push(item.price);
  if (item.area) facts.push(item.area);
  if (item.rooms !== "" && item.rooms != null) facts.push(`${item.rooms} Zi.`);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = facts.join(" · ");
  if (!facts.length) meta.hidden = true;

  const applied = item.status === "filled";
  const actions = document.createElement("div");
  actions.className = "row";
  actions.append(Immo.actions.button({
    label: applied ? "Erneut ausfüllen" : "Ausfüllen",
    variant: applied ? "secondary" : "",
    onClick: () => call("open-and-fill", { id: item.id }),
  }));

  const stamp = document.createElement("div");
  stamp.className = "listing-stamp";
  const stampShown = stampLine(item);
  stamp.textContent = stampShown.text;
  if (stampShown.title) stamp.title = stampShown.title;
  if (!stampShown.text) stamp.hidden = true;

  body.append(idEl, meta, actions, stamp);
  li.append(title, toggle, body);
  return li;
}

function stampLine(item) {
  const bits = [];
  const titles = [];
  if (item.firstSeen) {
    const shown = Immo.actions.formatStamp(item.firstSeen);
    bits.push(`Erfasst ${shown.label}`);
    titles.push(`Erfasst ${shown.full}`);
  }
  if (item.appliedAt) {
    const shown = Immo.actions.formatStamp(item.appliedAt);
    bits.push(`Ausgefüllt ${shown.label}`);
    titles.push(`Ausgefüllt ${shown.full}`);
  }
  return { text: bits.join(" · "), title: titles.join(" · ") };
}

document.querySelector("#options").addEventListener("click", () => chrome.runtime.openOptionsPage());

async function fillActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !EXPOSE_URL.test(tab.url || "")) {
    warningEl.textContent = "Öffne zuerst ein Inserat, dann diese Schaltfläche.";
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "fill-now" });
    warningEl.textContent = res && res.error ? res.error : "Ausfüllen gestartet. Bitte das Inserat prüfen.";
  } catch {
    warningEl.textContent = "Die Seite ist noch nicht bereit. Kurz warten und erneut versuchen.";
  }
}

Promise.all([
  chrome.runtime.sendMessage({ type: "get-state" }),
  chrome.tabs.query({ active: true, currentWindow: true }),
]).then(([res, tabs]) => {
  const tab = tabs && tabs[0];
  onExpose = !!(tab && EXPOSE_URL.test(tab.url || ""));
  if (res && res.state) render(res.state);
});
