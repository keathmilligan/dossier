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
  embed(text: string): Promise<number[] | null>;
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
  embedModel: string;
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

  async embed(text: string): Promise<number[] | null> {
    try {
      const res = await this.timedFetch(
        `${this.opts.baseUrl}/embeddings`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: this.opts.embedModel,
            input: text.slice(0, 8000),
          }),
        },
        Math.min(this.opts.timeoutMs, 8000),
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      return body.data?.[0]?.embedding ?? null;
    } catch {
      return null;
    }
  }

  async chat(opts: {
    system: string;
    messages: ChatMessage[];
    tools?: ToolSpec[];
    json?: boolean;
  }): Promise<ChatResult | null> {
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
        messages: [{ role: "system", content: opts.system }, ...opts.messages],
      };
      if (tools?.length) payload.tools = tools;
      if (opts.json) payload.response_format = { type: "json_object" };
      const res = await this.timedFetch(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
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
      if (!msg) return null;
      const toolCalls: ChatToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
        name: tc.function.name,
        arguments: parseArgs(tc.function.arguments),
      }));
      return {
        content: msg.content ?? "",
        toolCalls: toolCalls.length ? toolCalls : undefined,
      };
    } catch {
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

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
