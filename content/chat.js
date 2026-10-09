(function () {
  const Immo = globalThis.Immo;
  let lastSig = "";
  let timer = 0;
  let seenBubble = false;

  function conversationId() {
    const match = location.pathname.match(/\/messenger\/messages\/([0-9a-f-]{8,80})/i);
    return match ? match[1] : "";
  }

  function signature(status, id) {
    return [id, status.exposeId, status.address, status.direction, status.on, status.in, status.out].join("\n");
  }

  async function publish() {
    const id = conversationId();
    if (!id || !Immo.chat) return;
    let status;
    try {
      status = Immo.chat.parse(document);
    } catch {
      return;
    }
    if (!status.direction || !status.on) return;
    const sig = signature(status, id);
    if (sig === lastSig) return;
    lastSig = sig;
    try {
      await chrome.runtime.sendMessage({
        type: "chat-status",
        conversationId: id,
        exposeId: status.exposeId,
        address: status.address,
        direction: status.direction,
        on: status.on,
        in: status.in,
        out: status.out,
      });
    } catch {
      if (lastSig === sig) lastSig = "";
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(publish, 300);
  }

  const root = document.documentElement;
  const observer = new MutationObserver(() => {
    if (document.querySelector('[data-testid="message-container"]')) seenBubble = true;
    if (seenBubble) schedule();
  });
  observer.observe(root, { childList: true, subtree: true });
  const giveUp = setTimeout(() => {
    if (!seenBubble) observer.disconnect();
  }, 15000);
  if (document.querySelector('[data-testid="message-container"]')) {
    seenBubble = true;
    clearTimeout(giveUp);
    schedule();
  }
})();
