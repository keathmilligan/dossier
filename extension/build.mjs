import { build } from "vite";
import { copyFileSync, existsSync, watch } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(root, "dist");
const watchMode = process.argv.includes("--watch");

async function buildUi() {
  await build({
    root,
    base: "./",
    publicDir: "public",
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      watch: null,
      modulePreload: false,
      rollupOptions: {
        input: {
          popup: resolve(root, "src/ui/popup.html"),
          panel: resolve(root, "src/ui/panel.html"),
          background: resolve(root, "src/background.ts"),
        },
        output: {
          entryFileNames: (c) => (c.name === "background" ? "background.js" : "src/ui/[name].js"),
          chunkFileNames: "chunks/[name].js",
          assetFileNames: (c) =>
            c.name?.endsWith(".css") ? "src/ui/[name][extname]" : "assets/[name][extname]",
        },
      },
    },
  });
}

async function buildContent(name, entry) {
  await build({
    root,
    publicDir: false,
    configFile: false,
    build: {
      outDir,
      emptyOutDir: false,
      watch: null,
      lib: {
        entry: resolve(root, entry),
        name: `dossier_${name}`,
        formats: ["iife"],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  });
}

function copyManifest() {
  const manifestSrc = resolve(root, "public/manifest.json");
  const manifestDest = resolve(outDir, "manifest.json");
  if (existsSync(manifestSrc)) copyFileSync(manifestSrc, manifestDest);
}

async function buildAll() {
  await buildUi();
  await buildContent("extract", "src/content/extract.ts");
  await buildContent("assist", "src/content/assist.ts");
  await buildContent("highlight", "src/content/highlight.ts");
  copyManifest();
  console.log("extension built →", outDir);
}

await buildAll();

if (watchMode) {
  let timer;
  let running = false;
  let queued = false;

  const kick = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await buildAll();
    } catch (err) {
      console.error(err);
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
  watch(resolve(root, "public"), { recursive: true }, onChange);
  console.log("watching src/ and public/");
}
