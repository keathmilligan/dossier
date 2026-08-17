import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { migrateLegacyConfig, pathsFor } from "../src/config.js";

describe("paths", () => {
  it("puts config.toml in the config dir and token/db in the data dir", () => {
    const p = pathsFor({ dataDir: "/data/dossier", configDir: "/cfg/dossier" });
    expect(p.configPath).toBe(join("/cfg/dossier", "config.toml"));
    expect(p.tokenPath).toBe(join("/data/dossier", "token"));
    expect(p.dbPath).toBe(join("/data/dossier", "dossier.sqlite"));
  });

  it("moves a legacy share-dir config.toml once", () => {
    const root = mkdtempSync(join(tmpdir(), "dossier-paths-"));
    const dataDir = join(root, "share");
    const configDir = join(root, "config");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "config.toml"), "listen = \"127.0.0.1\"\n");
    const p = pathsFor({ dataDir, configDir });
    migrateLegacyConfig(p);
    expect(existsSync(p.configPath)).toBe(true);
    expect(existsSync(join(dataDir, "config.toml"))).toBe(false);
    expect(readFileSync(p.configPath, "utf8")).toContain("127.0.0.1");
    writeFileSync(join(dataDir, "config.toml"), "listen = \"should-not-move\"\n");
    migrateLegacyConfig(p);
    expect(readFileSync(p.configPath, "utf8")).toContain("127.0.0.1");
  });
});
