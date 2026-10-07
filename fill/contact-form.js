(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  const OPENER = /nachricht schreiben|kontaktieren|kontakt aufnehmen|anbieter kontaktieren|^nachricht$|^kontakt$/i;
  const SEND = /anfrage\s+senden|nachricht\s+senden|\babsenden\b|^senden$/i;
  const COMPANY = /\b(GmbH|AG|KG|OHG|UG|GbR|e\. ?K\.|Hausverwaltung)\b/;
  const UI_CHROME = /telefonnummer|\banzeigen\b|\bnachricht\b/i;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function visible(el) {
    if (!el || el.closest("[data-immo-ext]")) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  }

  function queryAllDeep(node, selector) {
    const out = [];
    const walk = (current) => {
      if (!current || !current.querySelectorAll) return;
      out.push(...current.querySelectorAll(selector));
      for (const el of current.querySelectorAll("*")) {
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(node);
    return out;
  }

  function labelText(el) {
    const doc = el.ownerDocument;
    if (el.id) {
      const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent || "";
    }
    const parent = el.closest("label");
    if (parent) return parent.textContent || "";
    return el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
  }

  function fieldBlob(el) {
    return [el.name, el.id, el.getAttribute("autocomplete"), el.getAttribute("placeholder"), el.getAttribute("aria-label"), labelText(el)]
      .filter(Boolean)
      .join(" ");
  }

  function setNativeValue(el, value) {
    const proto = el instanceof el.ownerDocument.defaultView.HTMLTextAreaElement
      ? el.ownerDocument.defaultView.HTMLTextAreaElement.prototype
      : el instanceof el.ownerDocument.defaultView.HTMLSelectElement
        ? el.ownerDocument.defaultView.HTMLSelectElement.prototype
        : el.ownerDocument.defaultView.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isEmpty(el) {
    return !String(el.value || "").trim();
  }

  function findMessageField(doc) {
    const areas = queryAllDeep(doc, "textarea").filter(visible);
    const labeled = areas.find((el) => /nachricht|message|anmerkung|mitteilung/i.test(fieldBlob(el)));
    if (labeled) return labeled;
    if (areas.length === 1) return areas[0];
    const inputs = queryAllDeep(doc, "input").filter((el) => visible(el) && /nachricht|message/i.test(fieldBlob(el)));
    return inputs[0] || null;
  }

  function findOpener(doc) {
    const controls = queryAllDeep(doc, "button, a, [role='button']");
    let best = null;
    let bestScore = 0;
    for (const el of controls) {
      if (!visible(el) || el.closest("[data-immo-ext]")) continue;
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 80 || SEND.test(text) || el.getAttribute("type") === "submit") continue;
      if (!OPENER.test(text)) continue;
      let score = 1;
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") score += 2;
      const hint = `${el.getAttribute("data-qa") || ""} ${el.getAttribute("class") || ""}`;
      if (/contact|kontakt/i.test(hint)) score += 2;
      if (el.tagName === "A") {
        const href = el.getAttribute("href") || "";
        if (href && !href.startsWith("#")) score -= 3;
      }
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function normalizedText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function hasControls(el) {
    return Boolean(el.querySelector("button, a, svg"));
  }

  function findContactName(doc) {
    const named = queryAllDeep(doc, "[data-qa='contactName']");
    for (const el of named) {
      if (!visible(el)) continue;
      if (hasControls(el)) continue;
      const text = normalizedText(el);
      if (text && text.length <= 80) return text;
    }

    const scopes = queryAllDeep(doc, "[data-qa*='contact' i], [data-qa*='realtor' i], [data-qa*='anbieter' i], [class*='contact' i], [class*='Contact']");
    const roots = scopes.length ? scopes : [doc.body || doc];
    let person = "";
    let company = "";
    for (const scope of roots) {
      const nodes = queryAllDeep(scope, "h1, h2, h3, h4, p, span, li, dd, strong, div");
      for (const el of nodes) {
        if (el.closest("[data-immo-ext]")) continue;
        if (hasControls(el)) continue;
        const text = normalizedText(el);
        if (!text || text.length > 80 || UI_CHROME.test(text)) continue;
        if (/^(Frau|Herr)\b/.test(text)) {
          if (!person || text.length < person.length) person = text;
        } else if (COMPANY.test(text) && (!company || text.length < company.length)) {
          company = text;
        }
      }
    }
    return person || company;
  }

  function matchField(el, pattern) {
    return pattern.test(fieldBlob(el));
  }

  const PROFILE_FIELDS = [
    { key: "firstName", pattern: /vorname|first.?name|given-name/i },
    { key: "lastName", pattern: /nachname|last.?name|familienname|family-name/i },
    { key: "email", pattern: /e-?mail/i },
    { key: "phone", pattern: /telefon|phone|mobil|\btel\b/i },
    { key: "houseNumber", pattern: /hausnummer|haus.?nr|house.?number/i },
    { key: "street", pattern: /straße|strasse|street-address|\bstreet\b/i },
    { key: "postcode", pattern: /\bplz\b|postleitzahl|postcode|postal-code/i },
    { key: "city", pattern: /\bort\b|wohnort|\bstadt\b|address-level2|\bcity\b/i },
  ];

  const SALUTATION_VALUE = { Herr: "MALE", Frau: "FEMALE" };
  const SKIP_NAMES = new Set(["sendUserProfile", "followAnAgent"]);

  function editable(el) {
    return el && !el.disabled && !SKIP_NAMES.has(el.name) && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && el.type !== "submit";
  }

  function fillEmptyFields(doc, profile) {
    const controls = queryAllDeep(doc, "input, select, textarea").filter((el) => visible(el) && editable(el));
    for (const spec of PROFILE_FIELDS) {
      const value = profile[spec.key];
      if (!value) continue;
      const el = controls.find((candidate) => matchField(candidate, spec.pattern));
      if (el && isEmpty(el)) setNativeValue(el, value);
    }
    const salutation = controls.find((el) => el.tagName === "SELECT" && /anrede|salutation/i.test(fieldBlob(el)));
    if (salutation && isEmpty(salutation) && profile.salutation) {
      const wanted = SALUTATION_VALUE[profile.salutation];
      const option = [...salutation.options].find((item) => item.text.trim() === profile.salutation || item.value === profile.salutation || item.value === wanted);
      if (option) setNativeValue(salutation, option.value);
    }
  }

  function findNamed(doc, name) {
    return queryAllDeep(doc, `[name="${name}"], #${CSS.escape(name)}`).find((el) => visible(el) && !el.disabled && !SKIP_NAMES.has(el.name)) || null;
  }

  function fillNamedSelect(doc, name, value) {
    if (!value) return;
    const el = findNamed(doc, name);
    if (!el || el.tagName !== "SELECT" || !isEmpty(el)) return;
    const option = [...el.options].find((item) => item.value === value);
    if (option) setNativeValue(el, option.value);
  }

  function fillNamedInput(doc, name, value) {
    if (value == null || value === "") return;
    const el = findNamed(doc, name);
    if (el && el.tagName !== "SELECT" && isEmpty(el)) setNativeValue(el, value);
  }

  function findMoveInDate(doc) {
    return queryAllDeep(doc, "#moveInDate, [name='moveInDate'], [data-testid='moveInDate'] input").find((el) => visible(el) && !el.disabled) || null;
  }

  function findPetDetails(doc) {
    return queryAllDeep(doc, "input, textarea").find((el) => {
      if (!visible(el) || !editable(el)) return false;
      if (/moveInDate|numberOfAdults|numberOfKids|incomeAmount|firstName|lastName|email|phone|street|house|postcode|city/i.test(`${el.name} ${el.id}`)) return false;
      return /anzahl|tierart|haustier/i.test(fieldBlob(el));
    }) || null;
  }

  async function waitFor(read, ms) {
    const started = Date.now();
    while (Date.now() - started < ms) {
      const found = read();
      if (found) return found;
      await sleep(200);
    }
    return null;
  }

  async function fillExtra(doc, profile) {
    const missing = [];
    fillNamedSelect(doc, "moveInDateType", profile.moveInDateType);
    if (profile.moveInDateType === "CONCRETE") {
      const date = await waitFor(() => findMoveInDate(doc), 2500);
      if (date && isEmpty(date) && profile.moveInDate) setNativeValue(date, profile.moveInDate);
      if (!date || isEmpty(date)) missing.push("Datum");
    }
    fillNamedSelect(doc, "hasPets", profile.hasPets);
    if (profile.hasPets === "TRUE") {
      const pets = await waitFor(() => findPetDetails(doc), 2500);
      if (pets && isEmpty(pets) && profile.petDetails) setNativeValue(pets, profile.petDetails);
      if (!pets || isEmpty(pets)) missing.push("Anzahl und Tierart");
    }
    fillNamedInput(doc, "numberOfAdults", profile.numberOfAdults);
    fillNamedInput(doc, "numberOfKids", profile.numberOfKids);
    fillNamedSelect(doc, "employmentStatus", profile.employmentStatus);
    fillNamedInput(doc, "incomeAmount", profile.incomeAmount);
    for (const name of ["forCommercialPurposes", "rentArrears", "insolvencyProcess", "smoker"]) {
      fillNamedSelect(doc, name, profile[name]);
    }
    const watched = ["moveInDateType", "numberOfAdults", "numberOfKids", "hasPets", "employmentStatus", "incomeAmount", "forCommercialPurposes", "rentArrears", "insolvencyProcess", "smoker"];
    for (const name of watched) {
      const el = findNamed(doc, name);
      if (el && isEmpty(el) && profile[name]) missing.push(name);
    }
    return missing;
  }

  function leftoverRequired(doc, messageEl) {
    const controls = queryAllDeep(doc, "input, select, textarea").filter((el) => visible(el) && editable(el));
    return controls.some((el) => {
      if (el === messageEl) return false;
      const required = el.required || el.getAttribute("aria-required") === "true";
      return required && isEmpty(el);
    });
  }

  function isLogin(doc) {
    const path = (doc.defaultView && doc.defaultView.location.pathname) || "";
    return /login|anmelden|einloggen|sign-?in/i.test(path);
  }

  async function fill(profile) {
    const doc = document;
    const started = Date.now();
    let clickedOpen = false;
    while (Date.now() - started < 15000) {
      if (isLogin(doc)) return { status: "login" };
      const messageEl = findMessageField(doc);
      if (messageEl) {
        const name = findContactName(doc);
        const message = Immo.greeting.buildMessage(profile.message, name);
        fillEmptyFields(doc, profile);
        setNativeValue(messageEl, message);
        const missing = await fillExtra(doc, profile);
        const extra = missing.length > 0 || leftoverRequired(doc, messageEl);
        const detail = extra
          ? "Ausgefüllt. Weitere Pflichtfelder sind noch leer. Bitte prüfen und selbst senden."
          : "Ausgefüllt. Bitte prüfen und selbst senden.";
        return { status: "filled", detail };
      }
      if (!clickedOpen && Date.now() - started > 2000) {
        clickedOpen = true;
        const opener = findOpener(doc);
        if (opener) opener.click();
      }
      await sleep(400);
    }
    if (isLogin(doc)) return { status: "login" };
    return { status: "no-form" };
  }

  Immo.contactForm = { fill, findContactName, findMessageField, findOpener, setNativeValue };
})(globalThis);
