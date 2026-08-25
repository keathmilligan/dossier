import { hostWatchedBy, normalizeHost, requestHostPermission } from "../sites";
import { send } from "../runtime";

type Topic = { id: string; title: string; hosts?: Array<{ host: string }> };
type TopicHost = { id: string; host: string; added_at: string };
type Policy = { include: string[]; exclude: string[] };
type Filing = {
  id: string;
  state: string;
  item_title: string;
  url: string;
  readable_text: string | null;
  highlight_text: string | null;
  captured_at?: string;
};

let topic: Topic | null = null;
let policy: Policy = { include: [], exclude: [] };
let queue: Filing[] = [];
let qIndex = 0;
let tab = "policy";
let currentHost: string | null = null;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await send<{ data?: T; error?: string; detail?: string }>({
    type: "api",
    method,
    path,
    body,
  });
  if (r.error) throw new Error(r.detail || r.error);
  return r.data as T;
}

const $ = (id: string) => document.getElementById(id)!;

function show(id: string, on: boolean): void {
  $(id).hidden = !on;
}

async function refreshCurrentHost(): Promise<void> {
  const s = await send<{ host?: string | null }>({ type: "current-host" });
  currentHost = s.host ?? null;
  const hint = $("add-site-hint");
  hint.textContent = currentHost
    ? `Add ${currentHost} to a topic with Add site.`
    : "This page can't be added as a site.";
}

async function loadTopics(): Promise<void> {
  await refreshCurrentHost();
  const data = await call<{ topics: Topic[] }>("GET", "/topics");
  const ul = $("topic-list");
  ul.innerHTML = "";
  for (const t of data.topics) {
    const li = document.createElement("li");
    li.className = "topic";
    const title = document.createElement("span");
    title.textContent = t.title;
    const actions = document.createElement("span");
    actions.className = "topic-actions";
    const already = Boolean(currentHost && hostWatchedBy(currentHost, (t.hosts ?? []).map((h) => h.host)));
    const add = document.createElement("button");
    add.className = "primary";
    add.textContent = already ? "Added" : "Add site";
    add.disabled = !currentHost || already;
    add.title = !currentHost
      ? "This page can't be added"
      : already
        ? `${currentHost} is already on “${t.title}”`
        : `Add ${currentHost} to “${t.title}”`;
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      void addPageToTopic(t, add);
    });
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      void removeTopic(t);
    });
    actions.append(add, del);
    li.append(title, actions);
    li.addEventListener("click", () => void openTopic(t.id));
    ul.appendChild(li);
  }
}

async function addPageToTopic(t: Topic, btn: HTMLButtonElement): Promise<void> {
  if (!currentHost) return;
  const host = currentHost;
  const granted = await requestHostPermission(host);
  if (!granted) {
    alert("Host permission declined. The site was not added.");
    return;
  }
  const r = await send<{ error?: string; detail?: string }>({
    type: "add-site",
    topicId: t.id,
    host,
  });
  if (r.error) {
    alert(r.detail || r.error);
    return;
  }
  btn.textContent = "Added";
  btn.disabled = true;
}

async function openTopic(id: string): Promise<void> {
  const data = await call<{
    topic: Topic;
    policy: Policy;
    hosts: TopicHost[];
  }>("GET", `/topics/${id}`);
  topic = data.topic;
  policy = data.policy ?? { include: [], exclude: [] };
  $("topic-title").textContent = topic.title;
  show("topics-view", false);
  show("topic-view", true);
  await send({ type: "set-active-topic", topicId: topic.id });
  renderPolicy();
  renderSites(data.hosts);
  await renderTab();
}

function renderPolicy(): void {
  paintTerms("include-list", policy.include, (term) => void removeTerm("include", term));
  paintTerms("exclude-list", policy.exclude, (term) => void removeTerm("exclude", term));
}

function paintTerms(elId: string, terms: string[], onRemove: (term: string) => void): void {
  const ul = $(elId);
  ul.innerHTML = "";
  for (const term of terms) {
    const li = document.createElement("li");
    li.className = "chip";
    const span = document.createElement("span");
    span.textContent = term;
    const rm = document.createElement("button");
    rm.className = "danger";
    rm.textContent = "×";
    rm.title = `Remove ${term}`;
    rm.addEventListener("click", () => onRemove(term));
    li.append(span, rm);
    ul.appendChild(li);
  }
}

async function addTerm(kind: "include" | "exclude"): Promise<void> {
  if (!topic) return;
  const input = $(`${kind}-input`) as HTMLInputElement;
  const term = input.value.trim();
  if (!term) return;
  const next = {
    include: kind === "include" ? uniqueTerms([...policy.include, term]) : policy.include,
    exclude: kind === "exclude" ? uniqueTerms([...policy.exclude, term]) : policy.exclude,
  };
  await savePolicy(next);
  input.value = "";
}

async function removeTerm(kind: "include" | "exclude", term: string): Promise<void> {
  const key = term.toLowerCase();
  const next = {
    include: kind === "include" ? policy.include.filter((t) => t.toLowerCase() !== key) : policy.include,
    exclude: kind === "exclude" ? policy.exclude.filter((t) => t.toLowerCase() !== key) : policy.exclude,
  };
  await savePolicy(next);
}

async function savePolicy(next: Policy): Promise<void> {
  if (!topic) return;
  const data = await call<{ policy: Policy }>("PUT", `/topics/${topic.id}/policy`, next);
  policy = data.policy;
  renderPolicy();
}

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function renderSites(hosts: TopicHost[]): void {
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
    rm.addEventListener("click", () => void removeSite(h.host));
    li.append(span, rm);
    ul.appendChild(li);
  }
}

async function loadSites(): Promise<void> {
  if (!topic) return;
  const data = await call<{ hosts: TopicHost[] }>("GET", `/topics/${topic.id}/hosts`);
  renderSites(data.hosts);
}

async function addSite(): Promise<void> {
  if (!topic) return;
  const input = $("add-host") as HTMLInputElement;
  const raw = input.value.trim();
  if (!raw) return;
  const host = normalizeHost(raw);
  if (!host) {
    alert("not a valid hostname");
    return;
  }
  const granted = await requestHostPermission(host);
  if (!granted) {
    alert("Host permission declined. The site was not added.");
    return;
  }
  const r = await send<{ error?: string; detail?: string; hosts?: TopicHost[] }>({
    type: "add-site",
    topicId: topic.id,
    host,
  });
  if (r.error) {
    alert(r.detail || r.error);
    return;
  }
  input.value = "";
  renderSites(r.hosts ?? []);
}

async function removeSite(host: string): Promise<void> {
  if (!topic) return;
  const r = await send<{ hosts?: TopicHost[] }>({ type: "remove-site", topicId: topic.id, host });
  renderSites(r.hosts ?? []);
}

function showRejected(): boolean {
  return ($("show-rejected") as HTMLInputElement).checked;
}

function queuePath(): string {
  return showRejected()
    ? `/topics/${topic!.id}/queue?include_rejected=1`
    : `/topics/${topic!.id}/queue`;
}

async function renderTab(): Promise<void> {
  for (const name of ["policy", "sites", "queue"]) {
    show(`tab-${name}`, tab === name);
    const btn = document.querySelector<HTMLButtonElement>(`#tabs [data-tab="${name}"]`);
    if (btn) {
      btn.classList.toggle("on", tab === name);
      btn.setAttribute("aria-selected", tab === name ? "true" : "false");
    }
  }
  if (!topic) return;
  if (tab === "sites") await loadSites();
  if (tab === "queue") await loadQueue();
}

async function loadQueue(): Promise<void> {
  if (!topic) return;
  const keepId = queue[qIndex]?.id;
  const data = await call<{ filings: Filing[] }>("GET", queuePath());
  queue = data.filings;
  const kept = keepId ? queue.findIndex((f) => f.id === keepId) : -1;
  qIndex = kept >= 0 ? kept : 0;
  paintQueue();
}

function paintQueue(): void {
  const ul = $("queue");
  ul.innerHTML = "";
  queue.forEach((f, i) => {
    const li = document.createElement("li");
    if (i === qIndex) li.classList.add("active");
    const snip = (f.highlight_text || f.readable_text || "").slice(0, 240);
    const when = f.captured_at ? escapeHtml(new Date(f.captured_at).toLocaleString()) : "";
    const link = f.url
      ? `<a href="${escapeHtml(f.url)}" target="_blank" rel="noreferrer">${escapeHtml(f.url)}</a>`
      : "";
    const reject =
      f.state !== "rejected"
        ? `<button type="button" class="danger reject" data-id="${escapeHtml(f.id)}">Reject</button>`
        : "";
    li.innerHTML = `<div class="queue-head">
        <strong>${escapeHtml(f.item_title)}</strong>
        <span class="badge badge-${escapeHtml(f.state)}">${escapeHtml(f.state)}</span>
      </div>
      ${snip ? `<div class="snippet">${escapeHtml(snip)}</div>` : ""}
      ${link}
      ${when ? `<div class="hint">${when}</div>` : ""}
      ${reject}`;
    li.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button, a")) return;
      qIndex = i;
      paintQueue();
    });
    li.querySelector(".reject")?.addEventListener("click", (e) => {
      e.stopPropagation();
      qIndex = i;
      void verdict();
    });
    ul.appendChild(li);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

$("create").addEventListener("click", async () => {
  const title = ($("new-title") as HTMLInputElement).value.trim();
  if (!title) return;
  const data = await call<{ topic: Topic }>("POST", "/topics", { title });
  ($("new-title") as HTMLInputElement).value = "";
  tab = "policy";
  await openTopic(data.topic.id);
});

$("back").addEventListener("click", () => {
  topic = null;
  show("topic-view", false);
  show("topics-view", true);
  void loadTopics();
});

$("delete-topic").addEventListener("click", () => {
  if (topic) void removeTopic(topic);
});

async function removeTopic(t: Topic): Promise<void> {
  if (!confirm(`Delete “${t.title}”? This cannot be undone.`)) return;
  await call("DELETE", `/topics/${t.id}`);
  if (topic?.id === t.id) {
    topic = null;
    show("topic-view", false);
    show("topics-view", true);
  }
  await loadTopics();
}

$("tabs").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn?.dataset.tab) return;
  tab = btn.dataset.tab;
  void renderTab();
});

$("include-add").addEventListener("click", () => void addTerm("include"));
$("exclude-add").addEventListener("click", () => void addTerm("exclude"));
$("include-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") void addTerm("include");
});
$("exclude-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") void addTerm("exclude");
});

$("show-rejected").addEventListener("change", () => {
  if (tab === "queue") void loadQueue();
});

$("add-host-btn").addEventListener("click", () => void addSite());
$("add-host").addEventListener("keydown", (e) => {
  if (e.key === "Enter") void addSite();
});

document.addEventListener("keydown", (e) => {
  if (tab !== "queue" || !topic) return;
  const t = e.target as HTMLElement;
  if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
  if (e.key === "j") {
    qIndex = Math.min(queue.length - 1, qIndex + 1);
    paintQueue();
  } else if (e.key === "k") {
    qIndex = Math.max(0, qIndex - 1);
    paintQueue();
  } else if (e.key === "x") {
    void verdict();
  }
});

async function verdict(): Promise<void> {
  const f = queue[qIndex];
  if (!f || !topic || f.state === "rejected") return;
  await call("POST", `/filings/${f.id}/verdict`, { action: "reject" });
  await loadQueue();
}

const HEALTH_POLL_MS = 2500;
let connected = false;

function setCaptureToggle(paused: boolean, enabled: boolean): void {
  const input = $("capture-toggle") as HTMLInputElement;
  input.checked = enabled && !paused;
  input.disabled = !enabled;
}

async function syncHealth(): Promise<boolean> {
  try {
    const h = await send<{ ok?: boolean; llm?: boolean; paused?: boolean; error?: string }>({ type: "health" });
    if (h.error) {
      $("health").textContent = "service not running";
      $("health").className = "status bad";
      $("token-box").hidden = h.error !== "no_token" && h.error !== "unauthorized";
      setCaptureToggle(true, false);
      return false;
    }
    $("health").textContent = h.llm ? "healthy · llm" : "healthy";
    $("health").className = "status ok";
    $("token-box").hidden = true;
    setCaptureToggle(Boolean(h.paused), true);
    return true;
  } catch {
    $("health").textContent = "service not running";
    $("health").className = "status bad";
    setCaptureToggle(true, false);
    return false;
  }
}

async function onConnectionChange(ok: boolean): Promise<void> {
  const was = connected;
  connected = ok;
  if (ok && !was) {
    if (!topic) await loadTopics().catch(() => undefined);
    else await renderTab().catch(() => undefined);
  }
}

$("capture-toggle").addEventListener("change", () => {
  const on = ($("capture-toggle") as HTMLInputElement).checked;
  void send({ type: on ? "resume" : "pause" }).then(() => syncHealth());
});

$("save-token").addEventListener("click", async () => {
  const token = ($("token") as HTMLInputElement).value.trim();
  if (!token) return;
  await send({ type: "set-token", token });
  connected = await syncHealth();
  if (connected) await loadTopics().catch(() => undefined);
});

void chrome.windows.getCurrent().then((win) => {
  if (win.id !== undefined) void send({ type: "panel-visibility", windowId: win.id, open: true });
});
window.addEventListener("pagehide", () => {
  void chrome.windows.getCurrent().then((win) => {
    if (win.id !== undefined) void send({ type: "panel-visibility", windowId: win.id, open: false });
  });
});

void (async () => {
  const seen = await chrome.storage.local.get(["seenFirstRun"]);
  if (!seen.seenFirstRun) {
    $("first-run").hidden = false;
    await chrome.storage.local.set({ seenFirstRun: true });
  }
  connected = await syncHealth();
  if (connected) await loadTopics().catch(() => undefined);
  window.setInterval(() => {
    void syncHealth().then(onConnectionChange);
    if (connected && !topic) {
      const prev = currentHost;
      void refreshCurrentHost()
        .then(() => {
          if (prev !== currentHost) return loadTopics();
        })
        .catch(() => undefined);
    }
  }, HEALTH_POLL_MS);
})();

export {};
