(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  const DEFAULT_PROFILE = {
    salutation: "Herr",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    houseNumber: "",
    postcode: "",
    city: "",
    message: "",
    moveInDateType: "FROM_NOW",
    moveInDate: "",
    numberOfAdults: "1",
    numberOfKids: "0",
    hasPets: "FALSE",
    petDetails: "",
    employmentStatus: "INDEFINITE_PERIOD",
    incomeAmount: "",
    forCommercialPurposes: "FALSE",
    rentArrears: "FALSE",
    insolvencyProcess: "FALSE",
    smoker: "FALSE",
  };

  const LOCAL_KEYS = ["profile", "searchUrl", "watching", "paused", "lastReloadAt", "listings", "baselineUrl", "threads"];

  function emptyState() {
    return {
      profile: { ...DEFAULT_PROFILE },
      searchUrl: "",
      watching: false,
      paused: false,
      lastReloadAt: 0,
      listings: {},
      baselineUrl: "",
      threads: {},
    };
  }

  async function getAll() {
    const data = await chrome.storage.local.get(LOCAL_KEYS);
    return {
      profile: { ...DEFAULT_PROFILE, ...(data.profile || {}) },
      searchUrl: data.searchUrl || "",
      watching: !!data.watching,
      paused: !!data.paused,
      lastReloadAt: data.lastReloadAt || 0,
      listings: data.listings || {},
      baselineUrl: data.baselineUrl || "",
      threads: data.threads && typeof data.threads === "object" && !Array.isArray(data.threads) ? data.threads : {},
    };
  }

  async function saveSettings(profile, searchUrl) {
    const current = await getAll();
    const nextProfile = { ...DEFAULT_PROFILE, ...profile };
    const nextUrl = String(searchUrl || "").trim();
    const patch = { profile: nextProfile, searchUrl: nextUrl };
    if (nextUrl !== current.searchUrl) patch.baselineUrl = "";
    await chrome.storage.local.set(patch);
    return getAll();
  }

  Immo.storage = { DEFAULT_PROFILE, getAll, saveSettings, emptyState };
})(globalThis);
