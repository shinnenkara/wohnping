(function (root) {
  const Immo = root.Immo || (root.Immo = {});

  function unitRoll(random) {
    const roll = typeof random === "function" ? Number(random()) : Math.random();
    return Number.isFinite(roll) && roll >= 0 && roll < 1 ? roll : 0;
  }

  function nextDelay(random) {
    return 1 + unitRoll(random) * 4;
  }

  function nextMessagesDelay(random) {
    return 15 + unitRoll(random) * 15;
  }

  Immo.reload = { nextDelay, nextMessagesDelay };
})(globalThis);
