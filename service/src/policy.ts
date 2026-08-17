import { parse as parseYaml } from "yaml";
import { createTwoFilesPatch } from "diff";
import type { PolicyDocument } from "./models.js";
import { badRequest } from "./errors.js";

export function parsePolicyYaml(text: string): PolicyDocument {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw badRequest("invalid_policy", err instanceof Error ? err.message : "YAML parse failed");
  }
  if (!raw || typeof raw !== "object") {
    throw badRequest("invalid_policy", "policy must be a mapping");
  }
  const o = raw as Record<string, unknown>;
  const voiceRaw = o.voice;
  if (!voiceRaw || typeof voiceRaw !== "object") {
    throw badRequest("invalid_policy", "voice.default is required");
  }
  const voiceObj = voiceRaw as Record<string, unknown>;
  if (typeof voiceObj.default !== "string" || !voiceObj.default.trim()) {
    throw badRequest("invalid_policy", "voice.default is required");
  }
  return {
    topic: reqString(o, "topic"),
    intent: reqString(o, "intent"),
    include: reqStringList(o, "include"),
    exclude: reqStringList(o, "exclude"),
    rank: reqStringList(o, "rank"),
    extract: reqStringList(o, "extract"),
    voice: {
      default: voiceObj.default,
      hn: optString(voiceObj.hn),
      github: optString(voiceObj.github),
      social: optString(voiceObj.social),
      email: optString(voiceObj.email),
    },
    deploy: reqStringList(o, "deploy"),
    hosts: reqStringList(o, "hosts").map((h) =>
      h.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(),
    ),
    ...o,
  };
}

export function policyDiff(accepted: string | null, proposed: string): string {
  return createTwoFilesPatch(
    "accepted.yaml",
    "proposed.yaml",
    accepted ?? "",
    proposed.endsWith("\n") ? proposed : `${proposed}\n`,
    "",
    "",
  );
}

function reqString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || !v.trim()) {
    throw badRequest("invalid_policy", `${key} is required`);
  }
  return v;
}

function reqStringList(o: Record<string, unknown>, key: string): string[] {
  const v = o[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw badRequest("invalid_policy", `${key} must be a list of strings`);
  }
  return v as string[];
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function extractYamlFence(text: string): string | null {
  const m = text.match(/```(?:ya?ml)\s*\n([\s\S]*?)```/i);
  return m?.[1]?.trim() ? m[1] : null;
}
