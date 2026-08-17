#!/usr/bin/env node
/**
 * Chrome native-messaging host. Length-prefixed JSON on stdin/stdout.
 * Commands: ping, get_token, ensure_running.
 */
import { defaultDataDir, loadOrCreateToken, pathsFor, ensureDataDir } from "./config.js";

const paths = pathsFor(defaultDataDir());
ensureDataDir(paths.dataDir);
const token = loadOrCreateToken(paths.tokenPath);

function send(msg: unknown): void {
  const json = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

function handle(raw: unknown): unknown {
  const cmd = raw && typeof raw === "object" ? (raw as { cmd?: string }).cmd : undefined;
  if (cmd === "ping") return { ok: true };
  if (cmd === "get_token") return { token };
  if (cmd === "ensure_running") return { ok: true };
  return { error: "unknown_cmd" };
}

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const n = buf.readUInt32LE(0);
    if (buf.length < 4 + n) break;
    const body = buf.subarray(4, 4 + n).toString("utf8");
    buf = buf.subarray(4 + n);
    try {
      send(handle(JSON.parse(body)));
    } catch (err) {
      send({ error: err instanceof Error ? err.message : "parse" });
    }
  }
});
