import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("logger", () => {
  it("writes a readable line with timestamp, level, event and details", () => {
    const dir = mkdtempSync(join(tmpdir(), "dossier-log-"));
    const logPath = join(dir, "dossier.log");
    const logger = createLogger(logPath, { silent: true });
    logger.info("site_added", { topic_id: "t1", host: "example.com" });
    const contents = readFileSync(logPath, "utf8");
    expect(contents).toMatch(/^\d{4}-\d{2}-\d{2}T.*\[INFO] site_added/);
    expect(contents).toContain("topic_id=t1");
    expect(contents).toContain("host=example.com");
  });

  it("never prints or writes a raw token/authorization value", () => {
    const dir = mkdtempSync(join(tmpdir(), "dossier-log-"));
    const logPath = join(dir, "dossier.log");
    const logger = createLogger(logPath, { silent: true });
    logger.info("health_checked", { token: "super-secret-value", ok: true });
    const contents = readFileSync(logPath, "utf8");
    expect(contents).not.toContain("super-secret-value");
    expect(contents).toContain("ok=true");
  });

  it("stays quiet when silent and logPath is null", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = createLogger(null, { silent: true });
    logger.info("noop");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs to console when not silent", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = createLogger(null);
    logger.info("service_started", { url: "http://127.0.0.1:18765" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("service_started");
    spy.mockRestore();
  });

  it("rotates the file once it exceeds the size threshold", () => {
    const dir = mkdtempSync(join(tmpdir(), "dossier-log-"));
    const logPath = join(dir, "dossier.log");
    const logger = createLogger(logPath, { silent: true, maxBytes: 1000 });
    for (let i = 0; i < 50; i++) logger.info("capture_ingested", { url: `https://example.com/${i}` });
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(statSync(logPath).size).toBeLessThan(2000);
  });
});
