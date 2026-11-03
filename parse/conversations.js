(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  function textOf(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function parseDay(text) {
    const match = String(text || "").match(/(\d{2})\.(\d{2})\.(\d{2})/);
    if (!match) return "";
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = 2000 + Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parse(doc) {
    const rows = [];
    const nodes = doc.querySelectorAll('[data-testid="conversation"]');
    for (const node of nodes) {
      const address = textOf(node.querySelector('[data-testid="address"]'));
      const blob = textOf(node);
      const dated = blob.match(/\b(\d{2}\.\d{2}\.\d{2})\b/);
      const clock = blob.match(/\b(\d{1,2}:\d{2})\b/);
      const preview = textOf(node.querySelector('[data-testid="previewMsg"]'));
      const expose = preview.match(/\/expose\/(\d+)/);
      const system = /wohnung bereits deaktiviert/i.test(preview);
      rows.push({
        address,
        exposeId: expose ? expose[1] : "",
        on: dated ? parseDay(dated[1]) : "",
        today: !dated && !!clock,
        automatic: /automatisch versendet/i.test(blob),
        deactivated: !!node.querySelector('[data-testid="deactivated-badge"]'),
        reply: !!preview && !system,
      });
    }
    return rows;
  }

  Immo.inbox = { parse };
})(globalThis);
