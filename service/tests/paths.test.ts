import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathsFor } from "../src/config.js";

describe("paths", () => {
  it("puts config.toml in the config dir and token/db in the data dir", () => {
    const p = pathsFor({ dataDir: "/data/dossier", configDir: "/cfg/dossier" });
    expect(p.configPath).toBe(join("/cfg/dossier", "config.toml"));
    expect(p.tokenPath).toBe(join("/data/dossier", "token"));
    expect(p.dbPath).toBe(join("/data/dossier", "dossier.sqlite"));
  });
});
