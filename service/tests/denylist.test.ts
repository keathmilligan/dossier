import { describe, expect, it } from "vitest";
import { checkDenylist } from "../src/denylist.js";

describe("denylist", () => {
  it("blocks gmail, IdP, chrome, file", () => {
    expect(checkDenylist("https://mail.google.com/mail").blocked).toBe(true);
    expect(checkDenylist("https://accounts.google.com/signin").blocked).toBe(true);
    expect(checkDenylist("chrome://extensions").blocked).toBe(true);
    expect(checkDenylist("file:///tmp/secret").blocked).toBe(true);
    expect(checkDenylist("https://login.microsoftonline.com/x").blocked).toBe(true);
  });

  it("does not treat 'mail' as a host suffix of docs.example.com", () => {
    expect(checkDenylist("https://docs.example.com/mail").blocked).toBe(false);
    expect(checkDenylist("https://example.com/article").blocked).toBe(false);
  });

  it("honors user regex and host patterns", () => {
    expect(
      checkDenylist("https://secret.internal/x", [{ pattern: "secret.internal", reason: "corp" }])
        .blocked,
    ).toBe(true);
    expect(
      checkDenylist("https://ok.example.com/a", [{ pattern: "re:forbidden", reason: "x" }]).blocked,
    ).toBe(false);
    expect(
      checkDenylist("https://ok.example.com/forbidden", [{ pattern: "re:forbidden" }]).blocked,
    ).toBe(true);
  });
});
