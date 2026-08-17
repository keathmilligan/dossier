import { api, ApiError } from "./api";
import { nativeGetToken } from "./native";
import { shouldCaptureUrl } from "./capture";

const DWELL_MS = 8000;
const NATIVE_NAME = "com.dossier.native";

interface SessionState {
  sessionId: string | null;
  topicIds: string[];
  paused: boolean;
  assistOpen: boolean;
  watchingHosts: string[];
}

const nav = new Map<number, { url: string; startedAt: number; captured: boolean; timer?: number }>();

async function loadState(): Promise<SessionState> {
  const s = await chrome.storage.session.get(["sessionId", "topicIds", "paused", "assistOpen"]);
  const local = await chrome.storage.local.get(["watchingHosts"]);
  return {
    sessionId: (s.sessionId as string) ?? null,
    topicIds: (s.topicIds as string[]) ?? [],
    paused: Boolean(s.paused),
    assistOpen: Boolean(s.assistOpen),
    watchingHosts: (local.watchingHosts as string[]) ?? [],
  };
}

async function saveState(partial: Partial<SessionState>): Promise<void> {
  const { watchingHosts, ...session } = partial;
  if (Object.keys(session).length) await chrome.storage.session.set(session);
  if (watchingHosts) await chrome.storage.local.set({ watchingHosts });
  await updateBadge();
}

async function ensureToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get(["token"]);
  if (typeof stored.token === "string" && stored.token) return stored.token;
  const fromNative = await nativeGetToken();
  if (fromNative) {
    await chrome.storage.local.set({ token: fromNative });
    return fromNative;
  }
  return null;
}

async function updateBadge(): Promise<void> {
  const st = await loadState();
  let text = "";
  if (st.paused) text = "‖";
  else if (st.sessionId) text = "REC";
  else if (st.assistOpen) text = "HELP";
  else if (st.watchingHosts.length) text = "WATCH";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: st.paused ? "#5f6368" : "#c5221f" });
}

async function extractTab(tabId: number): Promise<{
  title: string;
  readable_text: string;
  url: string;
  referrer: string;
} | null> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["extract.js"],
    });
    const [got] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        (globalThis as unknown as { __DOSSIER_EXTRACT__?: { title: string; readable_text: string; url: string; referrer: string } })
          .__DOSSIER_EXTRACT__ ?? null,
    });
    return got?.result ?? null;
  } catch {
    return null;
  }
}

async function sendCapture(payload: Record<string, unknown>): Promise<void> {
  await api("POST", "/capture", payload);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function watchingMatch(url: string, hosts: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

async function considerTab(tab: chrome.tabs.Tab, reason: "nav" | "activate" | "flush"): Promise<void> {
  const st = await loadState();
  if (st.paused) return;
  if (!tab.id || !tab.url) return;
  if (!shouldCaptureUrl(tab.url, Boolean(tab.incognito))) return;
  const session = Boolean(st.sessionId);
  const watch = watchingMatch(tab.url, st.watchingHosts);
  if (!session && !watch) return;

  const existing = nav.get(tab.id);
  if (!existing || existing.url !== tab.url) {
    if (existing?.timer) clearTimeout(existing.timer);
    const startedAt = Date.now();
    const entry = { url: tab.url, startedAt, captured: false };
    const timer = setTimeout(() => {
      void maybeCapture(tab.id!, entry.url);
    }, DWELL_MS) as unknown as number;
    nav.set(tab.id, { ...entry, timer });
    return;
  }
  if (reason !== "nav" && Date.now() - existing.startedAt >= DWELL_MS) {
    await maybeCapture(tab.id, existing.url);
  }
}

async function maybeCapture(tabId: number, url: string): Promise<void> {
  const st = await loadState();
  if (st.paused) return;
  const entry = nav.get(tabId);
  if (!entry || entry.url !== url || entry.captured) return;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab || tab.url !== url) return;
  const extracted = await extractTab(tabId);
  if (!extracted) return;
  entry.captured = true;
  try {
    await sendCapture({
      url: extracted.url,
      title: extracted.title,
      referrer: extracted.referrer,
      dwell_ms: Date.now() - entry.startedAt,
      source: st.sessionId ? "session" : "watching",
      session_id: st.sessionId,
      readable_text: extracted.readable_text,
      incognito: Boolean(tab.incognito),
    });
  } catch {
    entry.captured = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "file-page", title: "File this page in Dossier", contexts: ["page"] });
  chrome.contextMenus.create({ id: "save-highlight", title: "Save highlight to Dossier", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "assist", title: "Dossier: assist with this thread", contexts: ["page"] });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  void ensureToken();
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void chrome.tabs.get(details.tabId).then((tab) => considerTab(tab, "nav"));
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void chrome.tabs.get(details.tabId).then((tab) => considerTab(tab, "nav"));
});

chrome.tabs.onActivated.addListener((info) => {
  void chrome.tabs.get(info.tabId).then((tab) => considerTab(tab, "activate"));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "file-page") void pinTab(tab, "manual");
  if (info.menuItemId === "save-highlight") {
    void sendCapture({
      url: tab.url,
      title: tab.title,
      source: "manual",
      highlight_text: info.selectionText,
      readable_text: info.selectionText,
      incognito: Boolean(tab.incognito),
    });
  }
  if (info.menuItemId === "assist") void injectAssist(tab.id);
});

async function pinTab(tab: chrome.tabs.Tab, source: "manual" | "pin"): Promise<unknown> {
  if (!tab.id || !tab.url) throw new Error("no tab");
  if (tab.incognito) throw new ApiError(400, "incognito");
  const extracted = await extractTab(tab.id);
  const st = await loadState();
  return sendCapture({
    url: extracted?.url ?? tab.url,
    title: extracted?.title ?? tab.title,
    referrer: extracted?.referrer,
    source,
    topic_ids: st.topicIds.length ? st.topicIds : undefined,
    readable_text: extracted?.readable_text ?? "",
    incognito: false,
  });
}

async function injectAssist(tabId: number): Promise<void> {
  await saveState({ assistOpen: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["assist.js"] });
}

async function injectHighlight(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["highlight.js"] });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  void (async () => {
    try {
      if (msg?.type === "health") {
        await ensureToken();
        const h = await api<{ ok: boolean; llm: boolean; db: boolean; paused: boolean }>("GET", "/health");
        sendResponse(h);
        return;
      }
      if (msg?.type === "set-token") {
        await chrome.storage.local.set({ token: msg.token });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "pin") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error("no tab");
        sendResponse(await pinTab(tab, "manual"));
        return;
      }
      if (msg?.type === "highlight") {
        await sendCapture({
          url: msg.url,
          title: msg.title,
          source: "manual",
          highlight_text: msg.text,
          readable_text: msg.text,
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "assist") {
        const data = await api("POST", msg.pin ? "/assist/pin" : "/assist", {
          ...msg.thread,
          pin: Boolean(msg.pin),
        });
        sendResponse(data);
        return;
      }
      if (msg?.type === "keep") {
        sendResponse(await api("POST", "/compositions", msg.payload));
        return;
      }
      if (msg?.type === "assist-open") {
        await saveState({ assistOpen: Boolean(msg.open) });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "open-panel") {
        const win = await chrome.windows.getCurrent();
        if (win.id) await chrome.sidePanel.open({ windowId: win.id });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "session-start") {
        const granted = await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] });
        if (!granted) {
          sendResponse({ error: "permission_denied" });
          return;
        }
        const res = await api<{ session: { id: string } }>("POST", "/sessions", { topic_ids: msg.topicIds });
        await saveState({ sessionId: res.session.id, topicIds: msg.topicIds, paused: false });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await injectHighlight(tab.id);
        sendResponse(res);
        return;
      }
      if (msg?.type === "session-stop") {
        const st = await loadState();
        if (st.sessionId) await api("POST", `/sessions/${st.sessionId}/stop`);
        await saveState({ sessionId: null });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "pause") {
        await api("POST", "/pause");
        await saveState({ paused: true });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "resume") {
        await api("POST", "/resume");
        await saveState({ paused: false });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "watching-hosts") {
        await saveState({ watchingHosts: msg.hosts ?? [] });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "api") {
        sendResponse({ data: await api(msg.method, msg.path, msg.body) });
        return;
      }
      sendResponse({ error: "unknown" });
    } catch (err) {
      const e = err as ApiError;
      sendResponse({ error: e.code ?? e.message, detail: e.detail, status: e.status });
    }
  })();
  return true;
});

void ensureToken().then(() => updateBadge());
void NATIVE_NAME;
