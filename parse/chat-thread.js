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

  function bubbleDate(node) {
    const lines = node.querySelectorAll(".font-lightgray");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const on = parseDay(textOf(lines[i]));
      if (on) return on;
    }
    return "";
  }

  function parse(doc) {
    let best = null;
    let incoming = 0;
    let outgoing = 0;
    const containers = doc.querySelectorAll('[data-testid="message-container"]');
    for (let index = 0; index < containers.length; index += 1) {
      const node = containers[index];
      if (node.querySelector('[data-testid="system-message"]')) continue;
      const on = bubbleDate(node);
      if (!on) continue;
      const direction = node.querySelector('img[alt="message bubble arrow"]') ? "in" : "out";
      if (direction === "in") incoming += 1;
      else outgoing += 1;
      if (!best || on > best.on || (on === best.on && index > best.index)) {
        best = { on, direction, index };
      }
    }
    const address = textOf(doc.querySelector('[data-testid="user-address"]'))
      || textOf(doc.querySelector('[data-testid="listing-header-address"]'));
    let exposeId = "";
    const link = doc.querySelector('a[href*="/expose/"]');
    if (link) {
      const match = String(link.getAttribute("href") || "").match(/\/expose\/(\d+)/);
      if (match) exposeId = match[1];
    }
    return {
      address,
      exposeId,
      direction: best ? best.direction : "",
      on: best ? best.on : "",
      in: incoming,
      out: outgoing,
    };
  }

  Immo.chat = { parse };
})(globalThis);
