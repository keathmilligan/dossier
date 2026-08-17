const BAR_ID = "dossier-highlight-bar";

function show(x: number, y: number, text: string): void {
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement("button");
    bar.id = BAR_ID;
    bar.textContent = "Save highlight";
    bar.style.cssText =
      "position:fixed;z-index:2147483646;background:#8ab4f8;color:#202124;border:0;border-radius:6px;padding:4px 8px;font:12px system-ui;cursor:pointer;";
    document.documentElement.appendChild(bar);
    bar.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const t = bar!.dataset.text ?? "";
      chrome.runtime.sendMessage({ type: "highlight", text: t, url: location.href, title: document.title });
      bar!.remove();
    });
  }
  bar.dataset.text = text;
  bar.style.left = `${Math.min(x, window.innerWidth - 140)}px`;
  bar.style.top = `${Math.max(8, y - 36)}px`;
}

document.addEventListener("mouseup", (e) => {
  const text = document.getSelection()?.toString().trim() ?? "";
  if (text.length < 8) {
    document.getElementById(BAR_ID)?.remove();
    return;
  }
  show(e.clientX, e.clientY, text);
});

export {};
