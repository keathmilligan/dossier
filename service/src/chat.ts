import type { AppContext } from "./context.js";
import type { ChatKind, StructurePlanNode } from "./models.js";
import { badRequest, llmUnavailable, notFound } from "./errors.js";
import { newId, nowIso } from "./ids.js";
import { extractYamlFence, formatPolicyYaml, parsePolicyYaml, policyDiff, yamlFromToolArg } from "./policy.js";
import { PROMPT_POLICY } from "./prompts.js";
import { renderBrief } from "./brief.js";
import { acceptedPolicy, getTopic } from "./store.js";
import type { ChatMessage, ToolSpec } from "./ollama.js";

const TOOLS: ToolSpec[] = [
  {
    name: "propose_policy",
    description: "Store a policy YAML proposal and return a unified diff vs the accepted policy. Does not activate it.",
    parameters: {
      type: "object",
      properties: { yaml: { type: "string" } },
      required: ["yaml"],
    },
  },
  {
    name: "propose_structure",
    description: "Return an outline plan. Does not mutate the topic.",
    parameters: {
      type: "object",
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              slug: { type: "string" },
              parent_slug: { type: "string" },
              position: { type: "number" },
            },
            required: ["title", "slug"],
          },
        },
      },
      required: ["nodes"],
    },
  },
  {
    name: "get_brief",
    description: "Current brief markdown, optionally one section slug.",
    parameters: {
      type: "object",
      properties: { node_slug: { type: "string" } },
    },
  },
  {
    name: "get_queue_stats",
    description: "Filing counts by state for this topic.",
    parameters: { type: "object", properties: {} },
  },
];

export interface ChatResponse {
  thread_id: string;
  messages: Array<{ role: string; content: string }>;
  proposal?: { id: string; yaml_text: string; diff_text: string };
  structure_plan?: StructurePlanNode[];
}

export async function chatTopic(
  ctx: AppContext,
  topicId: string,
  message: string,
  threadId?: string,
  kind: ChatKind = "setup",
): Promise<ChatResponse> {
  const topic = getTopic(ctx.db, topicId);
  if (!topic) throw notFound("topic_not_found");
  if (!message.trim()) throw badRequest("empty_message");

  let tid = threadId;
  if (tid) {
    const existing = ctx.db.prepare("SELECT id FROM chat_threads WHERE id = ? AND topic_id = ?").get(
      tid,
      topicId,
    );
    if (!existing) throw notFound("thread_not_found");
  } else {
    tid = newId();
    ctx.db
      .prepare("INSERT INTO chat_threads(id, topic_id, kind, created_at) VALUES (?, ?, ?, ?)")
      .run(tid, topicId, kind, nowIso());
  }

  insertMessage(ctx, tid, "user", message);

  const history = ctx.db
    .prepare("SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY created_at")
    .all(tid) as ChatMessage[];

  let structurePlan: StructurePlanNode[] | undefined;
  let lastProposal: { id: string; yaml_text: string; diff_text: string } | undefined;
  const llmMessages: ChatMessage[] = history.map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  let assistantText = "";
  for (let round = 0; round < 4; round++) {
    const result = await ctx.llm.chat({
      system: PROMPT_POLICY,
      messages: llmMessages,
      tools: TOOLS,
    });
    if (!result) throw llmUnavailable();

    if (result.toolCalls?.length) {
      for (const call of result.toolCalls) {
        const toolResult = runTool(ctx, topicId, tid, call.name, call.arguments);
        if (toolResult.proposal) lastProposal = toolResult.proposal;
        if (toolResult.structure_plan) structurePlan = toolResult.structure_plan;
        llmMessages.push({
          role: "tool",
          content: toolResult.content,
        });
      }
      if (result.content.trim()) assistantText = result.content;
      continue;
    }
    assistantText = result.content;
    break;
  }

  const fenced = extractYamlFence(assistantText);
  if (fenced && !lastProposal) {
    try {
      lastProposal = createProposal(ctx, topicId, tid, fenced);
    } catch {
      /* leave as chat text */
    }
  }

  if (assistantText.trim()) insertMessage(ctx, tid, "assistant", assistantText);

  const messages = ctx.db
    .prepare("SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY created_at")
    .all(tid) as Array<{ role: string; content: string }>;

  return { thread_id: tid, messages, proposal: lastProposal, structure_plan: structurePlan };
}

function insertMessage(ctx: AppContext, threadId: string, role: string, content: string): void {
  ctx.db
    .prepare("INSERT INTO chat_messages(id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId(), threadId, role, content, nowIso());
}

function runTool(
  ctx: AppContext,
  topicId: string,
  threadId: string,
  name: string,
  args: Record<string, unknown>,
): { content: string; proposal?: { id: string; yaml_text: string; diff_text: string }; structure_plan?: StructurePlanNode[] } {
  if (name === "propose_policy") {
    try {
      const proposal = createProposal(ctx, topicId, threadId, yamlFromToolArg(args.yaml));
      return { content: proposal.diff_text, proposal };
    } catch (err) {
      return { content: `propose_policy failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (name === "propose_structure") {
    const nodes = (Array.isArray(args.nodes) ? args.nodes : []) as StructurePlanNode[];
    return {
      content: JSON.stringify({ applied: false, nodes }),
      structure_plan: nodes,
    };
  }
  if (name === "get_brief") {
    return { content: renderBrief(ctx.db, topicId) };
  }
  if (name === "get_queue_stats") {
    const rows = ctx.db
      .prepare("SELECT state, COUNT(*) AS n FROM filings WHERE topic_id = ? GROUP BY state")
      .all(topicId) as Array<{ state: string; n: number }>;
    return { content: JSON.stringify(Object.fromEntries(rows.map((r) => [r.state, r.n]))) };
  }
  return { content: `unknown tool ${name}` };
}

export function createProposal(
  ctx: AppContext,
  topicId: string,
  threadId: string | null,
  yamlText: string,
): { id: string; yaml_text: string; diff_text: string } {
  const yaml = formatPolicyYaml(parsePolicyYaml(yamlText));
  const accepted = acceptedPolicy(ctx.db, topicId);
  const diffText = policyDiff(accepted?.yaml_text ?? null, yaml);
  const id = newId();
  ctx.db
    .prepare(
      "INSERT INTO policy_proposals(id, topic_id, yaml_text, diff_text, thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, topicId, yaml, diffText, threadId, nowIso());
  return { id, yaml_text: yaml, diff_text: diffText };
}
