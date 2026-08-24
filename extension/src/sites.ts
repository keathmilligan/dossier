import { hostOf } from "./normalize";

export { hostOf };

/** True if `host` is exactly, or a subdomain of, one of `hosts`. */
export function hostWatchedBy(host: string, hosts: string[]): boolean {
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

export function hostOfUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return hostOf(url);
}

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Accepts a raw URL, bare hostname, or `www.`/`*.`-prefixed hostname typed by hand. */
export function normalizeHost(raw: string): string | null {
  const trimmed = (raw || "").trim().toLowerCase();
  if (!trimmed) return null;
  const host = trimmed
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\*\./, "")
    .replace(/^www\./, "");
  return HOSTNAME_RE.test(host) ? host : null;
}

/** Optional-host origins for a normalized hostname (the site and its subdomains). */
export function hostPermissionOrigins(host: string): string[] {
  // Must be a subset of manifest optional_host_permissions (http/https only).
  // `*://` is not allowed — Chrome treats it as a different scheme.
  return [
    `https://${host}/*`,
    `http://${host}/*`,
    `https://*.${host}/*`,
    `http://*.${host}/*`,
  ];
}

/**
 * Prompt for host access. Must be the first await in a user-gesture handler
 * (popup/panel click, or a command). Returns false if the host is invalid or
 * the user declined.
 */
export async function requestHostPermission(rawHost: string): Promise<boolean> {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  return chrome.permissions.request({ origins: hostPermissionOrigins(host) });
}
