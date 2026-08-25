import type { ChatResult, ChatToolCall } from "./models.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmClient {
  health(): Promise<boolean>;
  chat(opts: {
    system: string;
    messages: ChatMessage[];
    tools?: ToolSpec[];
    json?: boolean;
  }): Promise<ChatResult | null>;
}

export interface OllamaOptions {
  baseUrl: string;
  chatModel: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class OllamaClient implements LlmClient {
  constructor(private readonly opts: OllamaOptions) {}

  async health(): Promise<boolean> {
    try {
      const root = this.opts.baseUrl.replace(/\/v1\/?$/, "");
      const res = await this.timedFetch(`${root}/api/tags`, { method: "GET" }, 1500);
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(opts: {
    system: string;
    messages: ChatMessage[];
    tools?: ToolSpec[];
    json?: boolean;
  }): Promise<ChatResult | null> {
    const started = Date.now();
    const messages = [{ role: "system", content: opts.system }, ...opts.messages];
    console.log(
      `llm chat start model=${this.opts.chatModel} messages=${messages.length} tools=${opts.tools?.length ?? 0} json=${Boolean(opts.json)}`,
    );
    for (const m of messages) {
      console.log(`llm chat  ${m.role}: ${snip(m.content)}`);
    }
    try {
      const tools = opts.tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      const payload: Record<string, unknown> = {
        model: this.opts.chatModel,
        messages,
      };
      if (tools?.length) payload.tools = tools;
      if (opts.json) payload.response_format = { type: "json_object" };
      const res = await this.timedFetch(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const ms = Date.now() - started;
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        console.log(`llm chat error model=${this.opts.chatModel} status=${res.status} ms=${ms} ${snip(err)}`);
        return null;
      }
      const body = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };
      const msg = body.choices?.[0]?.message;
      if (!msg) {
        console.log(`llm chat error model=${this.opts.chatModel} ms=${ms} empty_response`);
        return null;
      }
      const toolCalls: ChatToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
        name: tc.function.name,
        arguments: parseArgs(tc.function.arguments),
      }));
      const content = msg.content ?? "";
      console.log(
        `llm chat ok model=${this.opts.chatModel} ms=${ms} tools=${toolCalls.length} ${snip(content || toolCalls.map((t) => t.name).join(","))}`,
      );
      return {
        content,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      };
    } catch (err) {
      console.log(`llm chat error model=${this.opts.chatModel} ms=${Date.now() - started} ${errMsg(err)}`);
      return null;
    }
  }

  private async timedFetch(url: string, init: RequestInit, timeoutMs = this.opts.timeoutMs): Promise<Response> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }
}

const SNIP = 2000;

function snip(s: string, n = SNIP): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n)}…[${s.length} chars]`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
