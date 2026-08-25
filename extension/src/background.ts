import { api, ApiError } from "./api";
import { nativeGetToken } from "./native";
import { shouldCaptureUrl } from "./capture";
import { hostOfUrl, hostPermissionOrigins, hostWatchedBy, normalizeHost } from "./sites";

const DWELL_MS = 8000;
const NATIVE_NAME = "com.dossier.native";
const HOSTS_ALARM = "dossier-refresh-hosts";

interface ExtState {
  paused: boolean;
  assistOpen: boolean;
}

interface TopicSummary {
  id: string;
  title: string;
}

const nav = new Map<number, { url: string; startedAt: number; captured: boolean; timer?: number }>();

/** Last focused tab URL — kept so the hotkey can request permission as its first await. */
let lastActiveUrl: string | undefined;

function rememberActiveTab(tab: chrome.tabs.Tab): void {
  if (!tab.active || !tab.url) return;
  lastActiveUrl = tab.url;
}

async function loadState(): Promise<ExtState> {
  const s = await chrome.storage.session.get(["paused", "assistOpen"]);
  return {
    paused: Boolean(s.paused),
    assistOpen: Boolean(s.assistOpen),
  };
}

async function saveState(partial: Partial<ExtState>): Promise<void> {
  await chrome.storage.session.set(partial);
  await updateBadge();
}

async function getActiveTopicId(): Promise<string | null> {
  const { activeTopicId } = await chrome.storage.local.get(["activeTopicId"]);
  return (activeTopicId as string) ?? null;
}

async function setActiveTopicId(id: string | null): Promise<void> {
  await chrome.storage.local.set({ activeTopicId: id });
}

async function getWatchedHosts(): Promise<string[]> {
  const { watchedHosts } = await chrome.storage.local.get(["watchedHosts"]);
  return (watchedHosts as string[]) ?? [];
}

async function refreshWatchedHosts(): Promise<string[]> {
  try {
    const data = await api<{ hosts: string[] }>("GET", "/hosts");
    await chrome.storage.local.set({ watchedHosts: data.hosts });
    return data.hosts;
  } catch {
    return getWatchedHosts();
  }
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
  if (st.paused) {
    await chrome.action.setBadgeText({ text: "‖" });
    await chrome.action.setBadgeBackgroundColor({ color: "#5f6368" });
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = hostOfUrl(tab?.url);
  const hosts = await getWatchedHosts();
  const watched = Boolean(host && hostWatchedBy(host, hosts));
  if (watched) {
    await chrome.action.setBadgeText({ text: "IN" });
    await chrome.action.setBadgeBackgroundColor({ color: "#81c995" });
  } else if (st.assistOpen) {
    await chrome.action.setBadgeText({ text: "HELP" });
    await chrome.action.setBadgeBackgroundColor({ color: "#c5221f" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

function notify(message: string): void {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Dossier",
    message,
  });
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

async function considerTab(tab: chrome.tabs.Tab, reason: "nav" | "activate" | "flush"): Promise<void> {
  const st = await loadState();
  if (st.paused) return;
  if (!tab.id || !tab.url) return;
  if (!shouldCaptureUrl(tab.url, Boolean(tab.incognito))) return;
  const hosts = await getWatchedHosts();
  const host = hostOfUrl(tab.url);
  if (!host || !hostWatchedBy(host, hosts)) return;

  const existing = nav.get(tab.id);
  if (!existing || existing.url !== tab.url) {
    if (existing?.timer) clearTimeout(existing.timer);
    const startedAt = Date.now();
    const entry = { url: tab.url, startedAt, captured: false };
    const timer = setTimeout(() => {
      void maybeCapture(tab.id!, entry.url);
    }, DWELL_MS) as unknown as number;
    nav.set(tab.id, { ...entry, timer });
    void injectHighlight(tab.id);
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
      source: "watching",
      readable_text: extracted.readable_text,
      incognito: Boolean(tab.incognito),
    });
  } catch {
    entry.captured = false;
  }
}

const openPanels = new Set<number>();

function markPanel(windowId: number, open: boolean): void {
  if (open) openPanels.add(windowId);
  else openPanels.delete(windowId);
}

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "save-highlight", title: "Save highlight to Dossier", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "assist", title: "Dossier: assist with this thread", contexts: ["page"] });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  chrome.alarms.create(HOSTS_ALARM, { periodInMinutes: 5 });
  void ensureToken();
  void refreshWatchedHosts();
});

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  const windowId = tab.windowId;
  if (tabId === undefined || windowId === undefined) return;
  if (openPanels.has(windowId)) {
    void closeSidePanel(tabId, windowId);
    return;
  }
  // First call in this gesture must be open() or Chrome drops it.
  void chrome.sidePanel.open({ tabId }).then(() => markPanel(windowId, true));
});

async function closeSidePanel(tabId: number, windowId: number): Promise<void> {
  const closer = (
    chrome.sidePanel as typeof chrome.sidePanel & {
      close?: (opts: { tabId: number }) => Promise<void>;
    }
  ).close;
  try {
    if (closer) await closer.call(chrome.sidePanel, { tabId });
    else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
      await chrome.sidePanel.setOptions({ tabId, enabled: true, path: "src/ui/panel.html" });
    }
  } finally {
    markPanel(windowId, false);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HOSTS_ALARM) void refreshWatchedHosts().then(() => updateBadge());
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void chrome.tabs.get(details.tabId).then((tab) => {
    rememberActiveTab(tab);
    void considerTab(tab, "nav");
  });
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  void chrome.tabs.get(details.tabId).then((tab) => {
    rememberActiveTab(tab);
    void considerTab(tab, "nav");
  });
});

chrome.tabs.onActivated.addListener((info) => {
  void chrome.tabs.get(info.tabId).then((tab) => {
    rememberActiveTab(tab);
    void considerTab(tab, "activate");
    void updateBadge();
  });
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    rememberActiveTab(tab);
    void updateBadge();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
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

async function injectAssist(tabId: number): Promise<void> {
  await saveState({ assistOpen: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["assist.js"] });
}

async function injectHighlight(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["highlight.js"] }).catch(() => undefined);
}

interface SiteStatus {
  host: string | null;
  watched: boolean;
  hosts: Array<{ host: string }>;
}

async function siteStatus(topicId: string): Promise<SiteStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = hostOfUrl(tab?.url);
  const data = await api<{ hosts: Array<{ host: string }> }>("GET", `/topics/${topicId}/hosts`);
  const watched = Boolean(host && hostWatchedBy(host, data.hosts.map((h) => h.host)));
  return { host, watched, hosts: data.hosts };
}

async function addSite(topicId: string, rawHost: string): Promise<Array<{ host: string }>> {
  const host = normalizeHost(rawHost);
  if (!host) throw new ApiError(400, "invalid_host", "not a valid hostname");
  const origins = hostPermissionOrigins(host);
  const have = await chrome.permissions.contains({ origins });
  if (!have) {
    // Popup/panel already requested during the click. The hotkey tries to
    // request before calling us. A request here only works if this call is
    // still inside a user gesture (MV3 service workers often are not).
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins });
    } catch {
      granted = false;
    }
    if (!granted) {
      throw new ApiError(
        400,
        "permission_denied",
        "Host permission was not granted. Use Add site on a topic in the side panel so Chrome can show the permission prompt.",
      );
    }
  }
  const data = await api<{ hosts: Array<{ host: string }> }>("POST", `/topics/${topicId}/hosts`, { host });
  await setActiveTopicId(topicId);
  await refreshWatchedHosts();
  await updateBadge();
  return data.hosts;
}

async function removeSite(topicId: string, rawHost: string): Promise<Array<{ host: string }>> {
  const host = normalizeHost(rawHost) ?? rawHost;
  const data = await api<{ hosts: Array<{ host: string }> }>(
    "DELETE",
    `/topics/${topicId}/hosts/${encodeURIComponent(host)}`,
  );
  const stillUsed = await refreshWatchedHosts();
  if (!stillUsed.some((h) => h === host)) {
    await chrome.permissions.remove({ origins: hostPermissionOrigins(host) }).catch(() => undefined);
  }
  await updateBadge();
  return data.hosts;
}

async function resolveTopicForHotkey(): Promise<{ id: string; title: string } | null> {
  const topics = await api<{ topics: TopicSummary[] }>("GET", "/topics");
  const eligible = topics.topics;
  if (eligible.length === 0) {
    notify("Create a topic first (open the side panel).");
    return null;
  }
  const active = await getActiveTopicId();
  const found = eligible.find((t) => t.id === active);
  if (found) return found;
  if (eligible.length === 1) {
    await setActiveTopicId(eligible[0]!.id);
    return eligible[0]!;
  }
  notify("Open a topic in the side panel first, then use the hotkey.");
  return null;
}

async function toggleSiteForHotkey(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !shouldCaptureUrl(tab.url, Boolean(tab.incognito))) {
    notify("This page can't be captured.");
    return;
  }
  const host = hostOfUrl(tab.url);
  if (!host) return;
  const topic = await resolveTopicForHotkey();
  if (!topic) return;
  try {
    const status = await siteStatus(topic.id);
    if (status.watched) {
      await removeSite(topic.id, host);
      notify(`Removed ${host} from “${topic.title}”.`);
    } else {
      await addSite(topic.id, host);
      notify(`Added ${host} to “${topic.title}”.`);
    }
  } catch (err) {
    const e = err as ApiError;
    notify(e.detail || e.code || "Could not update the site list.");
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-site") return;
  const raw = hostOfUrl(lastActiveUrl);
  const host = raw ? normalizeHost(raw) : null;
  void (async () => {
    // First await must be permissions.request so the command still counts
    // as a user gesture. Already-granted origins resolve without a prompt.
    if (host) {
      try {
        await chrome.permissions.request({ origins: hostPermissionOrigins(host) });
      } catch {
        // Service workers often lack a gesture token; addSite will fail clearly.
      }
    }
    await toggleSiteForHotkey();
  })();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void (async () => {
    try {
      if (msg?.type === "panel-visibility") {
        if (typeof msg.windowId === "number") markPanel(msg.windowId, Boolean(msg.open));
        sendResponse({ ok: true });
        return;
      }
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
        const data = await api("POST", "/assist", msg.thread);
        sendResponse(data);
        return;
      }
      if (msg?.type === "assist-open") {
        await saveState({ assistOpen: Boolean(msg.open) });
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
      if (msg?.type === "get-active-topic") {
        sendResponse({ topicId: await getActiveTopicId() });
        return;
      }
      if (msg?.type === "set-active-topic") {
        await setActiveTopicId(msg.topicId ?? null);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "current-host") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const host = hostOfUrl(tab?.url);
        const capturable = Boolean(
          tab?.url && host && shouldCaptureUrl(tab.url, Boolean(tab.incognito)),
        );
        sendResponse({ host: capturable ? host : null, capturable });
        return;
      }
      if (msg?.type === "site-status") {
        sendResponse(await siteStatus(msg.topicId));
        return;
      }
      if (msg?.type === "add-site") {
        const host = msg.host ?? (await siteStatus(msg.topicId)).host;
        if (!host) throw new ApiError(400, "no_host", "current tab has no host");
        const hosts = await addSite(msg.topicId, host);
        sendResponse({ ok: true, host, hosts });
        return;
      }
      if (msg?.type === "remove-site") {
        const host = msg.host ?? (await siteStatus(msg.topicId)).host;
        if (!host) throw new ApiError(400, "no_host", "current tab has no host");
        const hosts = await removeSite(msg.topicId, host);
        sendResponse({ ok: true, host, hosts });
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

void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
  if (tab) rememberActiveTab(tab);
});
void ensureToken().then(() => updateBadge());
void NATIVE_NAME;
