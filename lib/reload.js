(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  function nextDelay(random) {
    const roll = typeof random === "function" ? Number(random()) : Math.random();
    const unit = Number.isFinite(roll) && roll >= 0 && roll < 1 ? roll : 0;
    return 1 + unit * 4;
  }

  Immo.reload = { nextDelay };
})(globalThis);
