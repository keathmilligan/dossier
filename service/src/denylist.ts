import { hostOf, schemeOf } from "./normalize.js";

export const BLOCKED_SCHEMES = new Set([
  "chrome:",
  "chrome-extension:",
  "edge:",
  "about:",
  "file:",
  "devtools:",
]);

/** Host-suffix patterns. `mail` alone is intentionally absent. */
export const BUILTIN_HOST_SUFFIXES = [
  // banks / payments
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "citi.com",
  "capitalone.com",
  "paypal.com",
  "stripe.com",
  // health
  "mychart.org",
  "mychart.com",
  "epic.com",
  "unitedhealth.com",
  "anthem.com",
  "cigna.com",
  "kp.org",
  // mail
  "gmail.com",
  "mail.google.com",
  "outlook.com",
  "outlook.live.com",
  "office.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "icloud.com",
  // identity
  "accounts.google.com",
  "login.microsoftonline.com",
  "okta.com",
  "auth0.com",
  "id.apple.com",
  // password managers
  "lastpass.com",
  "1password.com",
  "bitwarden.com",
  "dashlane.com",
];

export function hostMatchesSuffix(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase().replace(/^\./, "");
  if (!p) return false;
  return h === p || h.endsWith(`.${p}`);
}

export function matchesUserPattern(url: string, pattern: string): boolean {
  if (pattern.startsWith("re:")) {
    try {
      return new RegExp(pattern.slice(3), "i").test(url);
    } catch {
      return false;
    }
  }
  const host = hostOf(url);
  if (!host) return false;
  return hostMatchesSuffix(host, pattern);
}

export interface DenylistHit {
  blocked: boolean;
  reason?: string;
  pattern?: string;
}

export function checkDenylist(
  url: string,
  userPatterns: Array<{ pattern: string; reason?: string | null }> = [],
): DenylistHit {
  const scheme = schemeOf(url);
  if (scheme && BLOCKED_SCHEMES.has(scheme)) {
    return { blocked: true, reason: `scheme ${scheme} is blocked`, pattern: scheme };
  }
  const host = hostOf(url);
  if (host) {
    for (const suffix of BUILTIN_HOST_SUFFIXES) {
      if (hostMatchesSuffix(host, suffix)) {
        return { blocked: true, reason: `host matches ${suffix} denylist`, pattern: suffix };
      }
    }
  }
  for (const row of userPatterns) {
    if (matchesUserPattern(url, row.pattern)) {
      return {
        blocked: true,
        reason: row.reason || `host matches user denylist`,
        pattern: row.pattern,
      };
    }
  }
  return { blocked: false };
}

export function hostAllowedByWatchlist(host: string, hosts: string[]): boolean {
  return hosts.some((entry) => hostMatchesSuffix(host, entry));
}
