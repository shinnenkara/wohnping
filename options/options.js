const Immo = globalThis.Immo;
const form = document.querySelector("#settings");
const urlNote = document.querySelector("#url-note");
const saveNote = document.querySelector("#save-note");
const lengthEl = document.querySelector("#length");
const statusEl = document.querySelector("#watch-status");
const detailEl = document.querySelector("#watch-detail");
const warningEl = document.querySelector("#watch-warning");
const controls = document.querySelector("#watch-controls");
const tabActions = document.querySelector("#watch-tab");

function field(name) {
  return form.elements[name];
}

function profileFromForm() {
  return {
    salutation: field("salutation").value,
    firstName: field("firstName").value.trim(),
    lastName: field("lastName").value.trim(),
    email: field("email").value.trim(),
    phone: field("phone").value.trim(),
    street: field("street").value.trim(),
    houseNumber: field("houseNumber").value.trim(),
    postcode: field("postcode").value.trim(),
    city: field("city").value.trim(),
    message: field("message").value,
    moveInDateType: field("moveInDateType").value,
    moveInDate: field("moveInDate").value.trim(),
    numberOfAdults: field("numberOfAdults").value.trim(),
    numberOfKids: field("numberOfKids").value.trim(),
    hasPets: field("hasPets").value,
    petDetails: field("petDetails").value.trim(),
    employmentStatus: field("employmentStatus").value,
    incomeAmount: field("incomeAmount").value.trim(),
    forCommercialPurposes: field("forCommercialPurposes").value,
    rentArrears: field("rentArrears").value,
    insolvencyProcess: field("insolvencyProcess").value,
    smoker: field("smoker").value,
  };
}

function renderAuto(state) {
  const missing = Immo.listings.missingFields(profileFromForm());
  const box = field("autoSend");
  const savedOn = !!(state && state.autoSend);
  box.checked = savedOn && missing.length === 0;
  box.disabled = missing.length > 0;
  const note = document.querySelector("#auto-send-note");
  note.textContent = missing.length ? `Auto-Senden bleibt aus. Es fehlt: ${missing.join(", ")}.` : "";
  const sent = document.querySelector("#sent-today");
  if (state && state.counts) {
    sent.dataset.count = String(state.counts.sentToday || 0);
    sent.dataset.auto = String(state.counts.autoSent || 0);
  }
  const count = Number(sent.dataset.count || 0);
  const auto = Number(sent.dataset.auto || 0);
  const cap = Number(field("dailyCap").value) || (state && state.dailyCap) || 20;
  sent.textContent = `Heute gesendet: ${count} (manuell und automatisch). Automatisch: ${auto} von ${cap}.`;
}

function fillForm(state) {
  field("searchUrl").value = state.searchUrl || "";
  const profile = state.profile || {};
  for (const key of [
    "salutation", "firstName", "lastName", "email", "phone", "street", "houseNumber", "postcode", "city", "message",
    "moveInDateType", "moveInDate", "numberOfAdults", "numberOfKids", "hasPets", "petDetails",
    "employmentStatus", "incomeAmount", "forCommercialPurposes", "rentArrears", "insolvencyProcess", "smoker",
  ]) {
    if (profile[key] != null && field(key)) field(key).value = profile[key];
  }
  toggleFollowUps();
  refreshPreview();
  showUrlNotes(field("searchUrl").value);
  if (state.dailyCap) field("dailyCap").value = state.dailyCap;
  renderAuto(state);
}

function toggleFollowUps() {
  document.querySelector("#move-in-date").hidden = field("moveInDateType").value !== "CONCRETE";
  document.querySelector("#pet-details").hidden = field("hasPets").value !== "TRUE";
}

function refreshPreview() {
  const message = field("message").value;
  const frau = Immo.greeting.buildMessage(message, "Frau Dr. Maria Müller");
  const herr = Immo.greeting.buildMessage(message, "Herr Schmidt");
  document.querySelector("#preview-frau").textContent = frau;
  document.querySelector("#preview-herr").textContent = herr;
  const longest = Math.max(frau.length, herr.length);
  lengthEl.textContent = `${longest} / ${Immo.url.MESSAGE_CAP} Zeichen mit Anrede`;
  lengthEl.className = longest > Immo.url.MESSAGE_CAP ? "warn" : "muted";
}

function showUrlNotes(value) {
  if (!String(value || "").trim()) {
    urlNote.textContent = "";
    return;
  }
  const result = Immo.url.validateSearchUrl(value);
  urlNote.textContent = result.error || (result.warnings || []).join(" ");
}

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

async function call(type) {
  const res = await chrome.runtime.sendMessage({ type });
  if (res && res.state) renderWatch(res.state);
  if (res && res.error) {
    const rest = res.state ? warningEl.textContent : "";
    warningEl.textContent = rest ? `${res.error} ${rest}` : res.error;
  }
  return res;
}

function renderWatch(state) {
  renderAuto(state);
  controls.replaceChildren(...Immo.actions.sessionControls(state, watchHandlers));
  tabActions.replaceChildren(...Immo.actions.watchTabControls(state, watchHandlers));
  Immo.actions.applyStatus(state, statusEl, detailEl);
  warningEl.textContent = Immo.actions.watchNotes(state);
}

field("message").addEventListener("input", refreshPreview);
field("moveInDateType").addEventListener("change", toggleFollowUps);
field("hasPets").addEventListener("change", toggleFollowUps);
field("searchUrl").addEventListener("input", () => showUrlNotes(field("searchUrl").value));
form.addEventListener("input", () => renderAuto({
  autoSend: field("autoSend").checked,
  dailyCap: Number(field("dailyCap").value) || 20,
}));
field("autoSend").addEventListener("change", () => {
  const missing = Immo.listings.missingFields(profileFromForm());
  if (field("autoSend").checked && missing.length) {
    field("autoSend").checked = false;
    document.querySelector("#auto-send-note").textContent = `Auto-Senden bleibt aus. Es fehlt: ${missing.join(", ")}.`;
  }
});

document.querySelector("#use-tab").addEventListener("click", async () => {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const ordered = [...windows.filter((win) => win.focused), ...windows.filter((win) => !win.focused)];
  let chosen = null;
  for (const win of ordered) {
    const active = (win.tabs || []).find((tab) => tab.active && tab.url && /immobilienscout24\.de/.test(tab.url));
    if (active) {
      chosen = active;
      break;
    }
  }
  if (!chosen) {
    urlNote.textContent = "Kein geöffneter ImmobilienScout24-Tab gefunden.";
    return;
  }
  field("searchUrl").value = chosen.url;
  showUrlNotes(chosen.url);
  saveNote.textContent = "URL übernommen. Speichern, dann Starten.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveNote.textContent = "";
  let searchUrl = field("searchUrl").value.trim();
  if (searchUrl) {
    const result = Immo.url.validateSearchUrl(searchUrl);
    if (result.error) {
      urlNote.textContent = result.error;
      return;
    }
    searchUrl = result.url;
    field("searchUrl").value = searchUrl;
    showUrlNotes(searchUrl);
  }
  const res = await chrome.runtime.sendMessage({
    type: "save-settings",
    profile: profileFromForm(),
    searchUrl,
    autoSend: field("autoSend").checked,
    dailyCap: Number(field("dailyCap").value),
  });
  if (res && res.error) {
    urlNote.textContent = res.error;
    return;
  }
  saveNote.textContent = "Gespeichert. Starten öffnet diese URL in einem eigenen Tab.";
  if (res && res.state) renderWatch(res.state);
});

chrome.runtime.sendMessage({ type: "get-state" }).then((res) => {
  if (!res || !res.state) return;
  fillForm(res.state);
  renderWatch(res.state);
});
