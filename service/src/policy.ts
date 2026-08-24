import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { createTwoFilesPatch } from "diff";
import type { PolicyDocument } from "./models.js";
import { badRequest } from "./errors.js";

export function yamlFromToolArg(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") return stringifyYaml(raw);
  return "";
}

export function normalizePolicyYaml(text: string): string {
  const spaced = text.replace(
    /^(\s*(?:-\s+)?)([A-Za-z_][\w.-]*)(:)(\S)/gm,
    (all, pre: string, key: string, colon: string, rest: string) =>
      /^(https?|ftp|mailto|file)$/i.test(key) ? all : `${pre}${key}${colon} ${rest}`,
  );
  return spaced.replace(/^(\s*-\s+)([*&!%@`].*)$/gm, (all, pre: string, rest: string) => {
    const t = rest.trimEnd();
    if (/^['"|]/.test(t)) return all;
    return `${pre}${JSON.stringify(t)}`;
  });
}

export function parsePolicyYaml(text: string): PolicyDocument {
  let raw: unknown;
  try {
    raw = parseYaml(normalizePolicyYaml(text));
  } catch (err) {
    throw badRequest("invalid_policy", err instanceof Error ? err.message : "YAML parse failed");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("invalid_policy", "policy must be a mapping");
  }
  const o = raw as Record<string, unknown>;
  const topic = asString(o.topic);
  if (!topic) throw badRequest("invalid_policy", "topic is required");
  const nested = o.intent && typeof o.intent === "object" && !Array.isArray(o.intent)
    ? (o.intent as Record<string, unknown>)
    : {};
  const deployObj = o.deploy && typeof o.deploy === "object" && !Array.isArray(o.deploy)
    ? (o.deploy as Record<string, unknown>)
    : {};
  return {
    topic,
    intent: asString(o.intent) || topic,
    include: uniqueStrings([...asStringList(o.include), ...asStringList(nested.include ?? nested.includes)]),
    exclude: uniqueStrings([...asStringList(o.exclude), ...asStringList(nested.exclude ?? nested.excludes)]),
    rank: asStringList(o.rank),
    extract: asStringList(o.extract),
    voice: coerceVoice(o.voice),
    deploy: asStringList(o.deploy),
    hosts: uniqueStrings([...asStringList(o.hosts), ...asStringList(deployObj.hosts)]).map((h) =>
      h.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(),
    ),
  };
}

export function formatPolicyYaml(doc: PolicyDocument): string {
  return stringifyYaml({
    topic: doc.topic,
    intent: doc.intent,
    include: doc.include,
    exclude: doc.exclude,
    rank: doc.rank,
    extract: doc.extract,
    voice: doc.voice,
    deploy: doc.deploy,
    hosts: doc.hosts,
  });
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

function asString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const parts: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const list = asStringList(val);
      if (list.length) parts.push(`${k}: ${list.join(", ")}`);
      else if (typeof val === "string" && val.trim()) parts.push(`${k}: ${val.trim()}`);
    }
    return parts.join("; ");
  }
  return "";
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return typeof v === "string" && v.trim() ? [cleanTerm(v)] : [];
  return v
    .map((x) => (typeof x === "string" ? x : x == null ? "" : String(x)))
    .map(cleanTerm)
    .filter(Boolean);
}

function cleanTerm(s: string): string {
  const t = s.trim();
  const stripped = t.replace(/^\*+|\*+$/g, "").trim();
  return stripped || t;
}

function uniqueStrings(xs: string[]): string[] {
  return [...new Set(xs)];
}

function coerceVoice(v: unknown): PolicyDocument["voice"] {
  if (typeof v === "string" && v.trim()) return { default: v.trim() === "default" ? "precise and sourced" : v.trim() };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const d = typeof o.default === "string" && o.default.trim() ? o.default.trim() : "precise and sourced";
    return {
      default: d,
      hn: optString(o.hn),
      github: optString(o.github),
      social: optString(o.social),
      email: optString(o.email),
    };
  }
  return { default: "precise and sourced" };
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

export function extractYamlFence(text: string): string | null {
  const fenced = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/i);
  if (fenced?.[1]?.trim() && looksLikePolicy(fenced[1])) return fenced[1];
  const doc = text.match(/(?:^|\n)---\s*\n([\s\S]*?)(?:\n---\s*(?:\n|$)|$)/);
  if (doc?.[1]?.trim() && looksLikePolicy(doc[1])) return doc[1];
  return fenced?.[1]?.trim() ? fenced[1] : null;
}

function looksLikePolicy(text: string): boolean {
  return /^(topic|intent|include|exclude|hosts|voice)\s*:/m.test(text);
}
