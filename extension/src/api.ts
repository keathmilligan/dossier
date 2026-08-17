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

async function token(): Promise<string> {
  const stored = await chrome.storage.local.get(["token"]);
  if (typeof stored.token === "string" && stored.token) return stored.token;
  throw new ApiError(401, "no_token", "service token not available");
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${await token()}`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(503, "service_down", "dossierd is not running");
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
