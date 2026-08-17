import { parseThread } from "./parse-thread";
import { isDeniedUrl } from "../denylist";

const ROOT_ID = "dossier-assist-root";

type AssistResponse = {
  mode: "gap" | "grounded";
  what_i_know: string[];
  talking_points: string[];
  draft: string | null;
  cite: { item_id: string; url: string; quote: string } | null;
  gap: string | null;
  item_ids: string[];
  topic_id: string | null;
};

function ensurePanel(): HTMLElement {
  let host = document.getElementById(ROOT_ID);
  if (host) return host;
  host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.right = "0";
  host.style.zIndex = "2147483646";
  document.documentElement.appendChild(host);
  return host;
}

function render(data: AssistResponse, denied: boolean): void {
  const host = ensurePanel();
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const cite = data.cite
    ? `<p class="cite"><a href="${escapeHtml(data.cite.url)}" target="_blank" rel="noreferrer">${escapeHtml(data.cite.quote || data.cite.url)}</a></p>`
    : "";
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel { font: 13px/1.45 system-ui, sans-serif; color: #e8eaed; background: #1b1d21; width: 360px; max-height: 100vh; overflow: auto; box-shadow: -4px 0 24px #0008; padding: 12px 14px 16px; }
      h1 { font-size: 14px; margin: 0 0 8px; }
      h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #9aa0a6; margin: 12px 0 4px; }
      ul { margin: 0; padding-left: 16px; }
      .gap { background: #3c2f12; color: #fdd663; padding: 8px; border-radius: 6px; }
      .warn { background: #3c1f1f; color: #f28b82; padding: 8px; border-radius: 6px; margin-bottom: 8px; }
      button { background: #8ab4f8; color: #202124; border: 0; border-radius: 6px; padding: 6px 10px; margin-right: 6px; margin-top: 8px; cursor: pointer; font-weight: 600; }
      button.secondary { background: #3c4043; color: #e8eaed; }
      .draft { white-space: pre-wrap; background: #2a2d32; padding: 8px; border-radius: 6px; }
      .row { display: flex; justify-content: space-between; align-items: center; }
    </style>
    <div class="panel">
      <div class="row">
        <h1>Dossier assist</h1>
        <button class="secondary" id="close">Close</button>
      </div>
      ${denied ? `<p class="warn">Helping you reply. This thread will not be saved unless you Pin.</p>` : ""}
      ${data.gap ? `<p class="gap">${escapeHtml(data.gap)}</p>` : ""}
      <h2>What I know</h2>
      <ul>${(data.what_i_know ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>"}</ul>
      <h2>Talking points</h2>
      <ul>${(data.talking_points ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>—</li>"}</ul>
      <h2>Draft</h2>
      <div class="draft">${escapeHtml(data.draft ?? "")}</div>
      <h2>Cite</h2>
      ${cite || "<p>—</p>"}
      <div>
        ${data.draft ? `<button id="copy">Copy draft</button>` : ""}
        <button id="pin">Pin</button>
        <button id="keep" class="secondary">Keep</button>
      </div>
    </div>
  `;
  shadow.getElementById("close")?.addEventListener("click", () => host.remove());
  shadow.getElementById("copy")?.addEventListener("click", () => {
    if (data.draft) void navigator.clipboard.writeText(data.draft);
  });
  shadow.getElementById("pin")?.addEventListener("click", () => {
    const thread = parseThread();
    chrome.runtime.sendMessage({ type: "assist", pin: true, thread });
  });
  shadow.getElementById("keep")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "keep",
      payload: {
        topic_id: data.topic_id,
        venue: parseThread().venue,
        thread_url: location.href,
        draft: data.draft ?? "",
        talking_points: data.talking_points,
        item_ids: data.item_ids,
        gap: data.gap,
      },
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function run(pin = false): Promise<void> {
  chrome.runtime.sendMessage({ type: "assist-open", open: true });
  const thread = parseThread();
  const denied = isDeniedUrl(thread.url);
  const resp = (await chrome.runtime.sendMessage({
    type: "assist",
    pin,
    thread,
  })) as AssistResponse & { error?: string };
  if (resp?.error) {
    render(
      {
        mode: "gap",
        what_i_know: [],
        talking_points: [],
        draft: null,
        cite: null,
        gap: resp.error,
        item_ids: [],
        topic_id: null,
      },
      denied,
    );
    return;
  }
  render(resp, denied);
}

void run();
