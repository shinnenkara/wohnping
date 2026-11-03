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

  const DEFAULT_SETTINGS = {
    watching: false,
    paused: false,
    autoSend: false,
    dailyCap: 20,
    sentOn: "",
    sentCount: 0,
  };

  const LOCAL_KEYS = ["profile", "searchUrl", "baselineUrl", "settings", "listings", "hits", "requests", "threads"];
  const LEGACY_KEYS = ["watching", "paused", "lastReloadAt"];

  function currentNow() {
    return typeof Immo.storage.now === "function" ? Immo.storage.now() : Date.now();
  }

  function clampCap(value) {
    const n = Number(value);
    if (!Number.isInteger(n)) return 20;
    if (n < 1) return 1;
    if (n > 50) return 50;
    return n;
  }

  function normalizeSettings(raw, now) {
    const source = raw && typeof raw === "object" ? raw : {};
    const settings = {
      watching: !!source.watching,
      paused: !!source.paused,
      autoSend: !!source.autoSend,
      dailyCap: clampCap(source.dailyCap == null ? 20 : source.dailyCap),
      sentOn: /^\d{4}-\d{2}-\d{2}$/.test(source.sentOn || "") ? source.sentOn : "",
      sentCount: Number.isInteger(source.sentCount) && source.sentCount >= 0 ? source.sentCount : 0,
    };
    const day = Immo.listings.localDay(now);
    if (settings.sentOn !== day) {
      settings.sentOn = day;
      settings.sentCount = 0;
    }
    return settings;
  }

  function settingsDiffer(raw, normalized) {
    if (!raw || typeof raw !== "object") return true;
    return !!raw.watching !== normalized.watching
      || !!raw.paused !== normalized.paused
      || !!raw.autoSend !== normalized.autoSend
      || clampCap(raw.dailyCap == null ? 20 : raw.dailyCap) !== normalized.dailyCap
      || raw.sentOn !== normalized.sentOn
      || raw.sentCount !== normalized.sentCount;
  }

  function composeState(data, now) {
    const source = data || {};
    const stamp = now == null ? Date.now() : now;
    const bundle = Immo.listings.migrateBundle(source, stamp);
    const hadSettings = !!(source.settings && typeof source.settings === "object" && !Array.isArray(source.settings));
    const legacyFlags = LEGACY_KEYS.some((key) => source[key] != null);
    const baseSettings = hadSettings
      ? source.settings
      : {
          watching: !!source.watching,
          paused: !!source.paused,
          autoSend: false,
          dailyCap: 20,
          sentOn: "",
          sentCount: 0,
        };
    const settings = normalizeSettings(baseSettings, stamp);
    const state = {
      profile: { ...DEFAULT_PROFILE, ...(source.profile || {}) },
      searchUrl: source.searchUrl || "",
      baselineUrl: source.baselineUrl || "",
      settings,
      listings: bundle.listings,
      hits: bundle.hits,
      requests: bundle.requests,
      threads: bundle.threads,
    };
    const patch = {};
    if (bundle.dirty) {
      patch.listings = bundle.listings;
      patch.hits = bundle.hits;
      patch.requests = bundle.requests;
      patch.threads = bundle.threads;
    }
    if ((legacyFlags && !hadSettings) || (hadSettings && settingsDiffer(source.settings, settings))) {
      patch.settings = settings;
    }
    const remove = legacyFlags ? LEGACY_KEYS.filter((key) => source[key] != null) : [];
    return { state, patch, remove, persist: Object.keys(patch).length > 0 || remove.length > 0 };
  }

  function emptyState() {
    const composed = composeState({}, currentNow());
    return composed.state;
  }

  function failureFrom(operation, patch, err) {
    const message = err && (err.message || String(err)) || "Speichern fehlgeschlagen.";
    return {
      operation,
      keys: Object.keys(patch || {}).sort(),
      message,
    };
  }

  async function recordFailure(failure) {
    if (!chrome.storage || !chrome.storage.session) return;
    try {
      await chrome.storage.session.set({ storageError: failure });
    } catch {
      /* the caller still receives the original write error */
    }
  }

  async function clearFailure() {
    if (!chrome.storage || !chrome.storage.session) return;
    try {
      await chrome.storage.session.remove("storageError");
    } catch {
      /* a cleared error is not required for the write to count */
    }
  }

  async function writeLocal(operation, patch) {
    try {
      await chrome.storage.local.set(patch);
    } catch (err) {
      const failure = failureFrom(operation, patch, err);
      await recordFailure(failure);
      const error = new Error(failure.message);
      error.storageFailure = failure;
      error.userMessage = `${failure.operation}: ${failure.keys.join(", ")}: ${failure.message}`;
      throw error;
    }
    await clearFailure();
  }

  async function getAll() {
    const data = await chrome.storage.local.get([...LOCAL_KEYS, ...LEGACY_KEYS]);
    const composed = composeState(data, currentNow());
    if (composed.persist) {
      try {
        await chrome.storage.local.set(composed.patch);
        if (composed.remove.length) await chrome.storage.local.remove(composed.remove);
        await clearFailure();
      } catch (err) {
        await recordFailure(failureFrom("migrate", composed.patch, err));
      }
    }
    return composed.state;
  }

  async function saveSettings(profile, searchUrl, options) {
    const current = await getAll();
    const nextProfile = { ...DEFAULT_PROFILE, ...profile };
    const nextUrl = String(searchUrl || "").trim();
    let settings = current.settings;
    if (options && Object.prototype.hasOwnProperty.call(options, "dailyCap")) {
      settings = { ...settings, dailyCap: clampCap(options.dailyCap) };
    }
    if (options && Object.prototype.hasOwnProperty.call(options, "autoSend")) {
      settings = { ...settings, autoSend: !!options.autoSend };
    }
    if (Immo.listings.missingFields(nextProfile).length) settings = { ...settings, autoSend: false };
    const patch = { profile: nextProfile, searchUrl: nextUrl };
    if (settings.autoSend !== current.settings.autoSend || settings.dailyCap !== current.settings.dailyCap) {
      patch.settings = settings;
    }
    if (nextUrl !== current.searchUrl) {
      patch.baselineUrl = "";
      patch.hits = Immo.listings.clearBaseline(current.hits);
    }
    await writeLocal("save-settings", patch);
    return getAll();
  }

  async function saveRecords(operation, patch) {
    await writeLocal(operation, patch);
    return getAll();
  }

  Immo.storage = {
    DEFAULT_PROFILE,
    DEFAULT_SETTINGS,
    getAll,
    saveSettings,
    saveRecords,
    writeLocal,
    emptyState,
    composeState,
    normalizeSettings,
    clampCap,
    now: null,
  };
})(globalThis);
