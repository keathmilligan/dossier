import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const tsc = resolve(root, "node_modules/typescript/bin/tsc");

let server = null;
let timer;
let running = false;
let queued = false;

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: root, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))));
  });
}

function stopServer() {
  return new Promise((ok) => {
    if (!server) return ok();
    const p = server;
    server = null;
    const done = () => ok();
    p.once("exit", done);
    p.kill("SIGTERM");
    setTimeout(() => {
      if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    }, 2000);
  });
}

async function startServer() {
  await stopServer();
  const p = spawn(process.execPath, ["dist/index.js"], { cwd: root, stdio: "inherit" });
  server = p;
  p.on("exit", (code, signal) => {
    if (server === p) {
      server = null;
      if (signal !== "SIGTERM" && code) console.error(`dossierd exited ${code}`);
    }
  });
}

async function rebuild() {
  console.log("rebuilding…");
  await run(process.execPath, [tsc]);
  await startServer();
}

const kick = async () => {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    await rebuild();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
  } finally {
    running = false;
    if (queued) {
      queued = false;
      await kick();
    }
  }
};

const onChange = (_event, filename) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (filename) console.log("changed:", filename);
    void kick();
  }, 100);
};

watch(resolve(root, "src"), { recursive: true }, onChange);

const shutdown = () => {
  void stopServer().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await kick();
console.log("watching src/");
