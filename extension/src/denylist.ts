import { hostOf } from "./normalize";

export const BLOCKED_SCHEMES = new Set([
  "chrome:",
  "chrome-extension:",
  "edge:",
  "about:",
  "file:",
  "devtools:",
]);

export const BUILTIN_HOST_SUFFIXES = [
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "citi.com",
  "capitalone.com",
  "paypal.com",
  "stripe.com",
  "mychart.org",
  "mychart.com",
  "epic.com",
  "unitedhealth.com",
  "anthem.com",
  "cigna.com",
  "kp.org",
  "gmail.com",
  "mail.google.com",
  "outlook.com",
  "outlook.live.com",
  "office.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "icloud.com",
  "accounts.google.com",
  "login.microsoftonline.com",
  "okta.com",
  "auth0.com",
  "id.apple.com",
  "lastpass.com",
  "1password.com",
  "bitwarden.com",
  "dashlane.com",
];

export function hostMatchesSuffix(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase().replace(/^\./, "");
  return Boolean(p) && (h === p || h.endsWith(`.${p}`));
}

export function isDeniedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (BLOCKED_SCHEMES.has(u.protocol)) return true;
    const host = hostOf(url);
    if (!host) return false;
    return BUILTIN_HOST_SUFFIXES.some((s) => hostMatchesSuffix(host, s));
  } catch {
    return true;
  }
}
