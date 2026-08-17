type Topic = { id: string; title: string; intent: string; watching_confirmed: number };
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
    li.textContent = t.title;
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
  renderWatch(data.policy?.yaml_text ?? null);
  await renderTab();
}

function renderWatch(yaml: string | null): void {
  const hosts = yaml ? parseHosts(yaml) : [];
  show("watch-box", hosts.length > 0 && !topic?.watching_confirmed);
  $("watch-hosts").innerHTML = hosts.map((h) => `<li>${h}</li>`).join("");
}

function parseHosts(yaml: string): string[] {
  const m = yaml.match(/hosts:\s*\n((?:\s+-\s+.+\n?)+)/);
  if (!m) return [];
  return m[1]!.split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

async function renderTab(): Promise<void> {
  for (const name of ["chat", "queue", "brief", "policy", "rejected"]) {
    show(`tab-${name}`, tab === name);
    const btn = document.querySelector<HTMLButtonElement>(`#tabs [data-tab="${name}"]`);
    if (btn) btn.classList.toggle("on", tab === name);
  }
  if (!topic) return;
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

$("tabs").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn?.dataset.tab) return;
  tab = btn.dataset.tab;
  void renderTab();
});

$("chat-send").addEventListener("click", async () => {
  if (!topic) return;
  const input = $("chat-input") as HTMLTextAreaElement;
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  const data = await call<{
    thread_id: string;
    messages: Array<{ role: string; content: string }>;
    proposal?: { id: string; diff_text: string };
    structure_plan?: Array<{ title: string; slug: string }>;
  }>("POST", `/topics/${topic.id}/chat`, { message, thread_id: threadId });
  threadId = data.thread_id;
  const log = $("chat-log");
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

$("enable-watch").addEventListener("click", async () => {
  if (!topic) return;
  const hosts = parseHosts(($("policy-yaml").textContent ?? "") + "\n" + ($("policy-edit") as HTMLTextAreaElement).value);
  const origins = hosts.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);
  const granted = await chrome.permissions.request({ origins });
  if (!granted) return;
  await call("PATCH", `/topics/${topic.id}`, { watching_confirmed: true });
  await send({ type: "watching-hosts", hosts });
  show("watch-box", false);
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
