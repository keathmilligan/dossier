import { normalizeHost, requestHostPermission } from "../sites";
import { send } from "../runtime";

interface TopicSummary {
  id: string;
  title: string;
  has_policy: boolean;
}

interface SiteStatus {
  host: string | null;
  watched: boolean;
  hosts: Array<{ host: string }>;
}

const $ = (id: string) => document.getElementById(id)!;

let topics: TopicSummary[] = [];
let currentTopicId: string | null = null;
let currentHost: string | null = null;

async function openSidePanel(): Promise<void> {
  try {
    const win = await chrome.windows.getCurrent();
    if (win.id === undefined) throw new Error("no window");
    await chrome.sidePanel.open({ windowId: win.id });
  } catch (err) {
    $("msg").textContent = (err as Error).message;
  }
}

async function refresh(): Promise<void> {
  const health = await send<{ ok?: boolean; llm?: boolean; paused?: boolean; error?: string }>({
    type: "health",
  });
  const el = $("health");
  if (health.error) {
    el.textContent = "service not running";
    el.className = "status bad";
    $("token-box").hidden = health.error === "no_token" || health.error === "unauthorized";
    return;
  }
  el.textContent = health.llm ? "healthy · llm" : "healthy · no llm";
  el.className = "status ok";
  $("token-box").hidden = true;

  const seen = await chrome.storage.local.get(["seenFirstRun"]);
  if (!seen.seenFirstRun) {
    $("first-run").hidden = false;
    await chrome.storage.local.set({ seenFirstRun: true });
  }

  const res = await send<{ data?: { topics: TopicSummary[] }; error?: string }>({
    type: "api",
    method: "GET",
    path: "/topics",
  });
  topics = (res.data?.topics ?? []).filter((t) => t.has_policy);

  if (topics.length === 0) {
    show("no-policy", true);
    show("site-box", false);
    return;
  }
  show("no-policy", false);
  show("site-box", true);

  const active = await send<{ topicId: string | null }>({ type: "get-active-topic" });
  currentTopicId = topics.some((t) => t.id === active.topicId) ? active.topicId : topics[0]!.id;

  const select = $("topic-select") as HTMLSelectElement;
  select.innerHTML = topics
    .map((t) => `<option value="${t.id}" ${t.id === currentTopicId ? "selected" : ""}>${escapeHtml(t.title)}</option>`)
    .join("");

  await refreshSiteStatus();
}

function show(id: string, on: boolean): void {
  $(id).hidden = !on;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function topicTitle(id: string | null): string {
  return topics.find((t) => t.id === id)?.title ?? "";
}

async function refreshSiteStatus(): Promise<void> {
  if (!currentTopicId) return;
  const status = await send<SiteStatus & { error?: string }>({ type: "site-status", topicId: currentTopicId });
  const btn = $("toggle-site") as HTMLButtonElement;
  const hostEl = $("current-host");
  currentHost = status.host ?? null;
  if (status.error || !status.host) {
    hostEl.textContent = "This page can't be captured.";
    btn.disabled = true;
    btn.textContent = "Add this site";
  } else {
    hostEl.textContent = status.host;
    btn.disabled = false;
    btn.textContent = status.watched ? `Remove this site from “${topicTitle(currentTopicId)}”` : `Add this site to “${topicTitle(currentTopicId)}”`;
    btn.classList.toggle("danger-fill", status.watched);
  }
  paintSiteList(status.hosts ?? []);
}

function paintSiteList(hosts: Array<{ host: string }>): void {
  $("site-count").textContent = String(hosts.length);
  const ul = $("site-list");
  ul.innerHTML = "";
  for (const h of hosts) {
    const li = document.createElement("li");
    li.className = "site-row";
    const span = document.createElement("span");
    span.textContent = h.host;
    const rm = document.createElement("button");
    rm.className = "danger";
    rm.textContent = "×";
    rm.title = `Remove ${h.host}`;
    rm.addEventListener("click", async () => {
      await send({ type: "remove-site", topicId: currentTopicId, host: h.host });
      await refreshSiteStatus();
    });
    li.append(span, rm);
    ul.appendChild(li);
  }
}

$("save-token").addEventListener("click", async () => {
  const token = ($("token") as HTMLInputElement).value.trim();
  if (!token) return;
  await send({ type: "set-token", token });
  await refresh();
});

$("pin").addEventListener("click", async () => {
  const r = await send<{ error?: string }>({ type: "pin" });
  $("msg").textContent = r.error ?? "Pinned.";
});

$("pause").addEventListener("click", () => void send({ type: "pause" }).then(refresh));
$("resume").addEventListener("click", () => void send({ type: "resume" }).then(refresh));
$("panel").addEventListener("click", openSidePanel);
$("panel-empty").addEventListener("click", openSidePanel);

$("topic-select").addEventListener("change", async (e) => {
  currentTopicId = (e.target as HTMLSelectElement).value;
  await send({ type: "set-active-topic", topicId: currentTopicId });
  await refreshSiteStatus();
});

$("toggle-site").addEventListener("click", async () => {
  if (!currentTopicId) return;
  const btn = $("toggle-site") as HTMLButtonElement;
  btn.disabled = true;
  const removing = btn.classList.contains("danger-fill");
  try {
    if (!removing) {
      if (!currentHost || !normalizeHost(currentHost)) {
        $("site-msg").textContent = "This page can't be captured.";
        return;
      }
      // First await: permissions.request must run during the click gesture.
      const granted = await requestHostPermission(currentHost);
      if (!granted) {
        $("site-msg").textContent = "Host permission declined. The site was not added.";
        return;
      }
    }
    const r = await send<{ error?: string; detail?: string }>({
      type: removing ? "remove-site" : "add-site",
      topicId: currentTopicId,
      host: currentHost,
    });
    if (r.error) {
      $("site-msg").textContent = r.detail || r.error;
    } else {
      $("site-msg").textContent = removing ? "Removed." : "Added.";
    }
  } catch (err) {
    $("site-msg").textContent = (err as Error).message;
  } finally {
    await refreshSiteStatus();
  }
});

void refresh().catch(() => undefined);
window.setInterval(() => {
  void refresh().catch(() => undefined);
}, 2500);

export {};
