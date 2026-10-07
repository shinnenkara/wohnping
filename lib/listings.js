(function (root) {
  const Immo = root.Immo || (root.Immo = {});
  const MAX_LISTINGS = 400;

  function trim(listings) {
    const entries = Object.values(listings);
    if (entries.length <= MAX_LISTINGS) return listings;
    const next = { ...listings };
    let extra = entries.length - MAX_LISTINGS;
    const droppable = entries
      .filter((entry) => entry.status === "dismissed" || entry.status === "seen" || entry.status === "replied")
      .sort((a, b) => a.firstSeen - b.firstSeen);
    for (const entry of droppable) {
      if (extra <= 0) break;
      delete next[entry.id];
      extra -= 1;
    }
    return next;
  }

  function upsertAll(existing, incoming, baseline) {
    const listings = { ...existing };
    const fresh = [];
    for (const item of incoming) {
      if (!item || !item.id) continue;
      const id = String(item.id);
      const prev = listings[id];
      const replied = !!item.replied;
      if (!prev) {
        const firstSeen = Date.now();
        const status = replied ? "replied" : "new";
        const row = {
          id,
          url: item.url,
          title: item.title || "",
          price: item.price || "",
          area: item.area || "",
          rooms: item.rooms ?? "",
          firstSeen,
          status,
          collapsed: false,
        };
        if (replied) row.appliedAt = firstSeen;
        listings[id] = row;
        if (status === "new" && !baseline) fresh.push(row);
      } else {
        let status = prev.status;
        if (replied && (status === "seen" || status === "new")) status = "replied";
        else if (!replied && status === "seen") status = "new";
        const next = {
          ...prev,
          title: item.title || prev.title,
          price: item.price || prev.price,
          area: item.area || prev.area || "",
          rooms: item.rooms !== "" && item.rooms != null ? item.rooms : prev.rooms,
          url: item.url || prev.url,
          status,
        };
        if (status === "replied" && !prev.appliedAt) next.appliedAt = Date.now();
        listings[id] = next;
      }
    }
    return { listings: trim(listings), fresh };
  }

  function setStatus(listings, id, status, extra) {
    const key = String(id);
    if (!listings[key]) return listings;
    const patch = extra && typeof extra === "object" ? extra : {};
    return { ...listings, [key]: { ...listings[key], ...patch, status } };
  }

  function setCollapsed(listings, id, collapsed) {
    const key = String(id);
    if (!listings[key]) return listings;
    return { ...listings, [key]: { ...listings[key], collapsed: !!collapsed } };
  }

  Immo.listings = { MAX_LISTINGS, upsertAll, setStatus, setCollapsed, trim };
})(globalThis);
