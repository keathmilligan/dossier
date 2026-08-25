import { nativeGetToken } from "./native";

const BASE = "http://127.0.0.1:18765";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

async function storedToken(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(["token"]);
  return typeof stored.token === "string" && stored.token ? stored.token : undefined;
}

async function token(refresh = false): Promise<string> {
  if (!refresh) {
    const existing = await storedToken();
    if (existing) return existing;
  }
  const fromNative = await nativeGetToken();
  if (fromNative) {
    await chrome.storage.local.set({ token: fromNative });
    return fromNative;
  }
  const existing = await storedToken();
  if (existing) return existing;
  throw new ApiError(401, "no_token", "service token not available");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method: string, path: string, body: unknown | undefined, bearer: string): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${bearer}`,
    connection: "close",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

/** Chromium keeps a dead keep-alive socket after dossierd restarts. Retry once. */
async function requestResilient(
  method: string,
  path: string,
  body: unknown | undefined,
  bearer: string,
): Promise<Response> {
  try {
    return await request(method, path, body, bearer);
  } catch {
    await delay(120);
    try {
      return await request(method, path, body, bearer);
    } catch {
      throw new ApiError(503, "service_down", "dossierd is not running");
    }
  }
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let bearer = await token();
  let res = await requestResilient(method, path, body, bearer);
  if (res.status === 401) {
    bearer = await token(true);
    res = await requestResilient(method, path, body, bearer);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/markdown")) {
    return (await res.text()) as T;
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
  if (!res.ok) {
    throw new ApiError(res.status, json.error ?? "error", json.detail);
  }
  return json as T;
}
