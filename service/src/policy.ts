export function normalizePrompt(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}
