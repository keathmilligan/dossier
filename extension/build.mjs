import { build } from "vite";
import { mkdirSync, copyFileSync, existsSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(root, "dist");
const watch = process.argv.includes("--watch");

async function buildUi() {
  await build({
    root,
    base: "./",
    publicDir: "public",
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      watch: watch ? {} : null,
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
      watch: watch ? {} : null,
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

await buildUi();
await buildContent("extract", "src/content/extract.ts");
await buildContent("assist", "src/content/assist.ts");
await buildContent("highlight", "src/content/highlight.ts");

const manifestSrc = resolve(root, "public/manifest.json");
const manifestDest = resolve(outDir, "manifest.json");
if (existsSync(manifestSrc)) copyFileSync(manifestSrc, manifestDest);

// Side panel / popup paths in the built HTML live under src/ui/
console.log("extension built →", outDir);
