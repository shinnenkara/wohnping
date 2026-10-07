(function (root) {
  const Immo = root.Immo || (root.Immo = {});
  const TITLES = /^(dr\.?|prof\.?|dipl\.-ing\.?|dipl\.\s*ing\.?|ing\.?|mag\.?|med\.?)$/i;
  const LEGAL = /^(gmbh|ag|kg|ohg|ug|gbr|mbh|co\.?|e\.?k\.?|&|und)$/i;

  function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function lastName(rest) {
    const parts = clean(rest)
      .replace(/[.,]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((part) => !TITLES.test(part))
      .filter((part) => !LEGAL.test(part));
    return parts[parts.length - 1] || "";
  }

  function buildGreeting(rawName) {
    const text = clean(rawName);
    if (!text) return "Guten Tag,";
    const person = text.match(/^(Frau|Herr)\b\s*(.*)$/i);
    if (!person) {
      if (/\b(GmbH|AG|KG|OHG|UG|GbR|e\. ?K\.|Hausverwaltung|Immobilien)\b/i.test(text)) {
        return "Sehr geehrte Damen und Herren,";
      }
      return "Guten Tag,";
    }
    const name = lastName(person[2]);
    if (!name) return "Guten Tag,";
    if (person[1].toLowerCase() === "frau") return `Sehr geehrte Frau ${name},`;
    return `Sehr geehrter Herr ${name},`;
  }

  function buildMessage(template, rawName) {
    const greeting = buildGreeting(rawName);
    const body = String(template || "").trim();
    return body ? `${greeting}\n\n${body}` : greeting;
  }

  Immo.greeting = { buildGreeting, buildMessage };
})(globalThis);
