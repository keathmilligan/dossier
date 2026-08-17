export type TopicStatus = "watching" | "active" | "drafting" | "shelved";
export type NodeKind = "inbox" | "section";
export type ItemSource = "session" | "watching" | "manual" | "pin";
export type ItemOrigin = "public" | "private";
export type FilingState = "inbox" | "proposed" | "filed" | "rejected" | "related";
export type Verdict = "keep" | "demote" | "reject" | "reread";
export type ExtractKind = "claim" | "quote" | "entity" | "note" | "architecture";
export type JobKind = "embed" | "judge" | "extract";
export type JobState = "queued" | "running" | "done" | "failed";
export type ChatKind = "setup" | "policy" | "brief" | "reply";
export type ChatRole = "user" | "assistant" | "system";

export interface Topic {
  id: string;
  title: string;
  intent: string;
  status: TopicStatus;
  venues_json: string;
  auto_accept_confidence: number;
  watching_confirmed: number;
  created_at: string;
  updated_at: string;
}

export interface Policy {
  id: string;
  topic_id: string;
  version: number;
  yaml_text: string;
  accepted_at: string;
}

export interface PolicyDocument {
  topic: string;
  intent: string;
  include: string[];
  exclude: string[];
  rank: string[];
  extract: string[];
  voice: {
    default: string;
    hn?: string;
    github?: string;
    social?: string;
    email?: string;
  };
  deploy: string[];
  hosts: string[];
  [key: string]: unknown;
}

export interface NodeRow {
  id: string;
  topic_id: string;
  parent_id: string | null;
  kind: NodeKind;
  title: string;
  slug: string;
  position: number;
}

export interface Item {
  id: string;
  url: string;
  url_normalized: string;
  title: string;
  referrer: string | null;
  captured_at: string;
  dwell_ms: number;
  source: ItemSource;
  session_id: string | null;
  readable_text: string | null;
  highlight_text: string | null;
  origin: ItemOrigin;
}

export interface Filing {
  id: string;
  item_id: string;
  topic_id: string;
  node_id: string | null;
  state: FilingState;
  score: number | null;
  rationale: string | null;
  rank_in_node: number | null;
  pinned: number;
  verdict: Verdict | null;
}

export interface SessionRow {
  id: string;
  topic_ids: string;
  started_at: string;
  ended_at: string | null;
  paused: number;
}

export interface CaptureBody {
  url: string;
  title?: string;
  referrer?: string | null;
  dwell_ms?: number;
  source: ItemSource;
  session_id?: string | null;
  topic_ids?: string[];
  readable_text?: string | null;
  highlight_text?: string | null;
  incognito?: boolean;
}

export interface JudgeResult {
  include: boolean;
  node_slug?: string | null;
  score?: number;
  rationale?: string;
  extracts?: Array<{
    kind: ExtractKind;
    text: string;
    attribution?: string;
  }>;
}

export interface StructurePlanNode {
  title: string;
  slug: string;
  parent_slug?: string | null;
  position?: number;
}

export interface AssistRequest {
  url?: string;
  title?: string;
  thread_text?: string;
  selection?: string;
  draft_box?: string;
  venue?: string;
  topic_id?: string | null;
  pin?: boolean;
  include_private?: boolean;
}

export interface AssistCite {
  item_id: string;
  url: string;
  quote: string;
}

export interface AssistResponse {
  mode: "gap" | "grounded";
  what_i_know: string[];
  talking_points: string[];
  draft: string | null;
  cite: AssistCite | null;
  gap: string | null;
  item_ids: string[];
  topic_id: string | null;
  topics?: Array<{ id: string; title: string }>;
}

export interface ChatToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  toolCalls?: ChatToolCall[];
}
