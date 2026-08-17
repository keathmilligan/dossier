function send<T = unknown>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp as T);
    });
  });
}

const $ = (id: string) => document.getElementById(id)!;

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

  const topics = await send<{ data?: { topics: Array<{ id: string; title: string }> }; error?: string }>({
    type: "api",
    method: "GET",
    path: "/topics",
  });
  const box = $("topics");
  box.innerHTML = "";
  for (const t of topics.data?.topics ?? []) {
    const lab = document.createElement("label");
    lab.className = "chk";
    lab.innerHTML = `<input type="checkbox" value="${t.id}" /> ${t.title}`;
    box.appendChild(lab);
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
$("panel").addEventListener("click", () => void send({ type: "open-panel" }));

$("start").addEventListener("click", async () => {
  const ids = Array.from(document.querySelectorAll<HTMLInputElement>("#topics input:checked")).map(
    (i) => i.value,
  );
  const r = await send<{ error?: string }>({ type: "session-start", topicIds: ids });
  $("msg").textContent = r.error ?? "Recording.";
});

$("stop").addEventListener("click", async () => {
  await send({ type: "session-stop" });
  $("msg").textContent = "Session stopped.";
});

void refresh();

export {};
