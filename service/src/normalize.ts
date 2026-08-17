export const SENSITIVE_QUERY =
  /^(token|session|sig|signature|auth|code|access_key|password|passwd)$/i;

export function stripSensitiveQuery(url: URL): void {
  const drop: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY.test(key)) drop.push(key);
  }
  for (const key of drop) url.searchParams.delete(key);
}

/** Collapse a URL to the recapture key. Invalid input is returned trimmed. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    url.protocol = "https:";
  }
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  stripSensitiveQuery(url);

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  url.pathname = path;

  const search = url.searchParams.toString();
  url.search = search ? `?${search}` : "";
  return url.toString();
}

export function hostOf(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (!url.hostname) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function schemeOf(raw: string): string | null {
  try {
    return new URL(raw.trim()).protocol.toLowerCase();
  } catch {
    const m = raw.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    return m ? `${m[1].toLowerCase()}:` : null;
  }
}
