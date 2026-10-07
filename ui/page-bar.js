(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  function button(label, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.style.cssText = [
      "all: initial",
      "font: 600 12px/1 system-ui, sans-serif",
      "color: #0f766e",
      "background: #ffffff",
      "border-radius: 999px",
      "padding: 6px 10px",
      "cursor: pointer",
      "margin-left: 8px",
    ].join(";");
    if (onClick) el.addEventListener("click", onClick);
    return el;
  }

  function clear() {
    document.querySelectorAll("[data-immo-ext='bar'], [data-immo-ext='spacer']").forEach((el) => el.remove());
  }

  function mount({ text, actions }) {
    clear();
    const bar = document.createElement("div");
    bar.dataset.immoExt = "bar";
    bar.style.cssText = [
      "all: initial",
      "position: fixed",
      "z-index: 2147483647",
      "top: 0",
      "left: 0",
      "right: 0",
      "display: flex",
      "align-items: center",
      "gap: 8px",
      "box-sizing: border-box",
      "padding: 8px 12px",
      "background: #0f766e",
      "color: #f0fdfa",
      "font: 13px/1.4 system-ui, sans-serif",
    ].join(";");

    const label = document.createElement("div");
    label.style.cssText = "all: initial; font: 13px/1.4 system-ui, sans-serif; color: #f0fdfa; flex: 1;";
    label.textContent = text || "";
    bar.appendChild(label);

    for (const action of actions || []) {
      bar.appendChild(button(action.label, action.onClick));
    }

    const spacer = document.createElement("div");
    spacer.dataset.immoExt = "spacer";
    spacer.style.cssText = "display: block; height: 44px;";
    if (document.body) document.body.prepend(spacer);
    document.documentElement.appendChild(bar);
    spacer.style.height = `${bar.offsetHeight}px`;
  }

  Immo.pageBar = { mount, clear };
})(globalThis);
