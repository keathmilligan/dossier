export const SENSITIVE_QUERY =
  /^(token|session|sig|signature|auth|code|access_key|password|passwd)$/i;

export function stripSensitiveQuery(url: URL): void {
  const drop: string[] = [];
  url.searchParams.forEach((_value, key) => {
    if (SENSITIVE_QUERY.test(key)) drop.push(key);
  });
  for (const key of drop) url.searchParams.delete(key);
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.protocol === "http:" || url.protocol === "https:") url.protocol = "https:";
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
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;
  const search = url.searchParams.toString();
  url.search = search ? `?${search}` : "";
  return url.toString();
}

export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}
