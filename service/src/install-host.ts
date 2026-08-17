#!/usr/bin/env node
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

export const EXTENSION_ID = "nohjgllifaeekjbodpjlkacopbnflhco";

const here = dirname(fileURLToPath(import.meta.url));
const serviceRoot = resolve(here, "..");
const repoRoot = resolve(serviceRoot, "..");
const nativeJs = join(serviceRoot, "dist", "native.js");
const wrapper = join(repoRoot, "native", "dossier-native.sh");

const manifest = {
  name: "com.dossier.native",
  description: "Dossier native messaging host",
  path: wrapper,
  type: "stdio",
  allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
};

function hostDirs(): string[] {
  const home = homedir();
  if (platform() === "darwin") {
    return [
      join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
      join(home, "Library", "Application Support", "Chromium", "NativeMessagingHosts"),
      join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
    ];
  }
  if (platform() === "win32") {
    return [join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "dossier")];
  }
  return [
    join(home, ".config", "google-chrome", "NativeMessagingHosts"),
    join(home, ".config", "chromium", "NativeMessagingHosts"),
    join(home, ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
  ];
}

mkdirSync(dirname(wrapper), { recursive: true });
writeFileSync(
  wrapper,
  `#!/bin/sh\nexec node ${JSON.stringify(nativeJs)}\n`,
  { mode: 0o755 },
);
try {
  chmodSync(wrapper, 0o755);
} catch {
  /* windows */
}

const dests: string[] = [];
for (const dir of hostDirs()) {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "com.dossier.native.json");
  writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n");
  dests.push(dest);
}

writeFileSync(join(repoRoot, "native", "com.dossier.native.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Installed native host manifests:");
for (const d of dests) console.log(`  ${d}`);
console.log(`Wrapper: ${wrapper}`);
console.log(`Extension ID: ${EXTENSION_ID}`);
