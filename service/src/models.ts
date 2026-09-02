export type ItemSource = "watching" | "manual";
export type FilingState = "queued" | "filed" | "rejected";
export const FILING_STATES: FilingState[] = ["queued", "filed", "rejected"];
export const DEFAULT_QUEUE_STATES: FilingState[] = ["queued", "filed"];
export const QUEUE_LIMIT = 100;

export interface Topic {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface TopicHost {
  id: string;
  topic_id: string;
  host: string;
  added_at: string;
}

export interface Policy {
  id: string;
  topic_id: string;
  prompt: string;
  updated_at: string;
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
  readable_text: string | null;
  highlight_text: string | null;
}

export interface Filing {
  id: string;
  item_id: string;
  topic_id: string;
  state: FilingState;
}

export interface QueueFiling extends Filing {
  item_title: string;
  url: string;
  readable_text: string | null;
  highlight_text: string | null;
  captured_at: string;
}

export interface CaptureBody {
  url: string;
  title?: string;
  referrer?: string | null;
  dwell_ms?: number;
  source: ItemSource;
  topic_ids?: string[];
  readable_text?: string | null;
  highlight_text?: string | null;
  incognito?: boolean;
}

export interface AssistRequest {
  url?: string;
  title?: string;
  thread_text?: string;
  selection?: string;
  draft_box?: string;
  venue?: string;
  topic_id?: string | null;
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
