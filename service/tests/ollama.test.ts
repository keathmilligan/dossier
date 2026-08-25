import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../src/ollama.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function client(fetchImpl: typeof fetch): OllamaClient {
  return new OllamaClient({
    baseUrl: "http://127.0.0.1:11434/v1",
    chatModel: "llama3.2",
    timeoutMs: 5000,
    fetchImpl,
  });
}

function lines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

describe("ollama_log", () => {
  it("logs chat request and reply to stdout", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const llm = client(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "hello back" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await llm.chat({ system: "be brief", messages: [{ role: "user", content: "hi" }] });
    const out = lines(spy);
    expect(out.some((l) => l.startsWith("llm chat start") && l.includes("model=llama3.2"))).toBe(true);
    expect(out.some((l) => l.includes("user:") && l.includes("hi"))).toBe(true);
    expect(out.some((l) => l.startsWith("llm chat ok") && l.includes("hello back"))).toBe(true);
  });

  it("logs chat HTTP errors", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const llm = client(async () => new Response("nope", { status: 500 }));
    await llm.chat({ system: "s", messages: [{ role: "user", content: "q" }] });
    expect(lines(spy).some((l) => l.startsWith("llm chat error") && l.includes("status=500"))).toBe(true);
  });

});
