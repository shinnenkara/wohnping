(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  const FIELDS = [
    ["address", '[data-qa="is24-expose-address"] .address-text'],
    ["coldRent", "dd.is24qa-kaltmiete"],
    ["warmRent", "dd.is24qa-gesamtmiete"],
    ["extraCosts", "dd.is24qa-nebenkosten"],
    ["heatingCosts", "dd.is24qa-heizkosten"],
    ["rooms", "dd.is24qa-zimmer"],
    ["area", "dd.is24qa-wohnflaeche-ca"],
    ["availableFrom", "dd.is24qa-bezugsfrei-ab"],
    ["landlord", '[data-qa="company-name"]'],
  ];

  function textOf(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").replace(/^\+\s*/, "").trim();
  }

  function parse(doc) {
    const details = {};
    for (const [key, selector] of FIELDS) {
      const value = textOf(doc.querySelector(selector));
      if (value) details[key] = value;
    }
    const gallery = doc.querySelector(".galleryEntryContainer");
    if (gallery) details.photoCount = gallery.querySelectorAll('img[data-testid="gallery-entry-image"]').length;
    const title = textOf(doc.querySelector('h1[data-qa="expose-title"]')).slice(0, 200);
    return { title, details };
  }

  Immo.expose = { parse };
})(globalThis);
