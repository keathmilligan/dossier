import { normalizeHost, requestHostPermission } from "../sites";

type Topic = { id: string; title: string; intent: string; has_policy: boolean };
type TopicHost = { id: string; host: string; added_at: string };
type OutlineNode = { id: string; title: string; slug: string; kind: string };
type Filing = {
  id: string;
  state: string;
  item_title: string;
  url: string;
  readable_text: string | null;
  highlight_text: string | null;
  rationale: string | null;
  node_id: string | null;
  score: number | null;
};

let topic: Topic | null = null;
let threadId: string | null = null;
let proposalId: string | null = null;
let structurePlan: Array<{ title: string; slug: string }> | null = null;
let nodes: OutlineNode[] = [];
let queue: Filing[] = [];
let qIndex = 0;
let tab = "chat";

function send<T = unknown>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp as T);
    });
  });
}

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

async function loadTopics(): Promise<void> {
  const data = await call<{ topics: Topic[] }>("GET", "/topics");
  const ul = $("topic-list");
  ul.innerHTML = "";
  for (const t of data.topics) {
    const li = document.createElement("li");
    li.className = "topic";
    const title = document.createElement("span");
    title.textContent = t.title;
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      void removeTopic(t);
    });
    li.append(title, del);
    li.addEventListener("click", () => void openTopic(t.id));
    ul.appendChild(li);
  }
}

async function openTopic(id: string): Promise<void> {
  const data = await call<{
    topic: Topic;
    policy: { yaml_text: string } | null;
    nodes: OutlineNode[];
    pending_proposal: { id: string; yaml_text: string; diff_text: string; accepted_at: string | null } | null;
    hosts: TopicHost[];
  }>("GET", `/topics/${id}`);
  topic = data.topic;
  nodes = data.nodes;
  $("topic-title").textContent = topic.title;
  show("topics-view", false);
  show("topic-view", true);
  $("policy-yaml").textContent = data.policy?.yaml_text ?? "(no accepted policy)";
  ($("policy-edit") as HTMLTextAreaElement).value = data.policy?.yaml_text ?? "";
  if (data.pending_proposal && !data.pending_proposal.accepted_at) {
    proposalId = data.pending_proposal.id;
    $("proposal-diff").textContent = data.pending_proposal.diff_text;
    show("proposal", true);
  }
  await send({ type: "set-active-topic", topicId: topic.id });
  renderSites(data.hosts);
  await renderTab();
}

function renderSites(hosts: TopicHost[]): void {
  show("sites-no-policy", !topic?.has_policy);
  show("sites-ui", Boolean(topic?.has_policy));
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
  // First await: permissions.request must run during the click/Enter gesture.
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

async function renderTab(): Promise<void> {
  for (const name of ["chat", "sites", "queue", "brief", "policy", "rejected"]) {
    show(`tab-${name}`, tab === name);
    const btn = document.querySelector<HTMLButtonElement>(`#tabs [data-tab="${name}"]`);
    if (btn) btn.classList.toggle("on", tab === name);
  }
  if (!topic) return;
  if (tab === "sites") await loadSites();
  if (tab === "queue") await loadQueue("inbox,proposed", "queue");
  if (tab === "rejected") await loadQueue("rejected", "rejected");
  if (tab === "brief") {
    const data = await call<{ markdown: string }>("GET", `/topics/${topic.id}/brief`);
    $("brief").textContent = data.markdown;
  }
}

async function loadQueue(states: string, elId: string): Promise<void> {
  if (!topic) return;
  const data = await call<{ filings: Filing[]; nodes: OutlineNode[] }>(
    "GET",
    `/topics/${topic.id}/queue?states=${states}`,
  );
  nodes = data.nodes;
  queue = data.filings;
  qIndex = 0;
  paintQueue(elId);
}

function paintQueue(elId: string): void {
  const ul = $(elId);
  ul.innerHTML = "";
  queue.forEach((f, i) => {
    const li = document.createElement("li");
    if (i === qIndex) li.classList.add("active");
    const snip = (f.highlight_text || f.rationale || f.readable_text || "").slice(0, 240);
    li.innerHTML = `<strong>${escapeHtml(f.item_title)}</strong> <span class="badge">${f.state}</span>
      <div class="snippet">${escapeHtml(snip)}</div>
      <a href="${escapeHtml(f.url)}" target="_blank" rel="noreferrer">${escapeHtml(f.url)}</a>`;
    li.addEventListener("click", () => {
      qIndex = i;
      paintQueue(elId);
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
  const data = await call<{ topic: Topic; thread_id: string }>("POST", "/topics", { title });
  threadId = data.thread_id;
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
    threadId = null;
    proposalId = null;
    structurePlan = null;
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

$("chat-send").addEventListener("click", async () => {
  if (!topic) return;
  const input = $("chat-input") as HTMLTextAreaElement;
  const sendBtn = $("chat-send") as HTMLButtonElement;
  const message = input.value.trim();
  if (!message || sendBtn.disabled) return;
  input.value = "";
  const log = $("chat-log");
  log.insertAdjacentHTML(
    "beforeend",
    `<div class="msg user"><strong>user</strong> ${escapeHtml(message)}</div>
     <div class="msg assistant pending" id="chat-pending"><strong>assistant</strong> <span class="working">Working</span></div>`,
  );
  sendBtn.disabled = true;
  input.disabled = true;
  try {
    const data = await call<{
      thread_id: string;
      messages: Array<{ role: string; content: string }>;
      proposal?: { id: string; diff_text: string };
      structure_plan?: Array<{ title: string; slug: string }>;
    }>("POST", `/topics/${topic.id}/chat`, { message, thread_id: threadId });
    threadId = data.thread_id;
    log.innerHTML = data.messages
      .map((m) => `<div class="msg ${m.role}"><strong>${m.role}</strong> ${escapeHtml(m.content)}</div>`)
      .join("");
    if (data.proposal) {
      proposalId = data.proposal.id;
      $("proposal-diff").textContent = data.proposal.diff_text;
      show("proposal", true);
    }
    if (data.structure_plan?.length) {
      structurePlan = data.structure_plan;
      $("structure-plan").textContent = JSON.stringify(data.structure_plan, null, 2);
      show("structure", true);
    }
  } catch (err) {
    $("chat-pending")?.remove();
    log.insertAdjacentHTML(
      "beforeend",
      `<div class="msg error">${escapeHtml((err as Error).message)}</div>`,
    );
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
});

$("accept-policy").addEventListener("click", async () => {
  if (!topic || !proposalId) return;
  await call("POST", `/topics/${topic.id}/policy/accept`, { proposal_id: proposalId });
  show("proposal", false);
  await openTopic(topic.id);
});

$("apply-structure").addEventListener("click", async () => {
  if (!topic || !structurePlan) return;
  await call("POST", `/topics/${topic.id}/structure/apply`, { nodes: structurePlan });
  show("structure", false);
  await openTopic(topic.id);
});

$("propose-yaml").addEventListener("click", async () => {
  if (!topic) return;
  const yaml = ($("policy-edit") as HTMLTextAreaElement).value;
  const data = await call<{ proposal: { id: string; diff_text: string } }>(
    "POST",
    `/topics/${topic.id}/policy/propose`,
    { yaml_text: yaml },
  );
  proposalId = data.proposal.id;
  $("proposal-diff").textContent = data.proposal.diff_text;
  show("proposal", true);
  tab = "chat";
  void renderTab();
});

$("add-host-btn").addEventListener("click", () => void addSite());
$("add-host").addEventListener("keydown", (e) => {
  if (e.key === "Enter") void addSite();
});

$("export").addEventListener("click", async () => {
  if (!topic) return;
  const md = await call<string>("GET", `/topics/${topic.id}/export.md`);
  const blob = new Blob([typeof md === "string" ? md : String(md)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${topic.title.replace(/\s+/g, "-")}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

document.addEventListener("keydown", (e) => {
  if (tab !== "queue" || !topic) return;
  const t = e.target as HTMLElement;
  if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
  if (e.key === "j") {
    qIndex = Math.min(queue.length - 1, qIndex + 1);
    paintQueue("queue");
  } else if (e.key === "k") {
    qIndex = Math.max(0, qIndex - 1);
    paintQueue("queue");
  } else if (e.key === "x") {
    void verdict("reject");
  } else if (e.key === "Enter") {
    void verdict("keep");
  } else if (/^[1-9]$/.test(e.key)) {
    const sections = nodes.filter((n) => n.kind === "section");
    const node = sections[Number(e.key) - 1];
    if (node) void verdict("refile", node.id);
  }
});

async function verdict(action: string, node_id?: string): Promise<void> {
  const f = queue[qIndex];
  if (!f || !topic) return;
  await call("POST", `/filings/${f.id}/verdict`, { action, node_id });
  await loadQueue("inbox,proposed", "queue");
}

void (async () => {
  try {
    const h = await send<{ ok?: boolean; llm?: boolean; error?: string }>({ type: "health" });
    $("health").textContent = h.error ? "service not running" : h.llm ? "healthy · llm" : "healthy";
    $("health").className = h.error ? "status bad" : "status ok";
  } catch {
    $("health").textContent = "service not running";
    $("health").className = "status bad";
  }
  await loadTopics();
})();

export {};
