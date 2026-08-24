import { describe, expect, it } from "vitest";
import { createTopic } from "../src/topics.js";
import { chatTopic, createProposal } from "../src/chat.js";
import { normalizePolicyYaml, parsePolicyYaml } from "../src/policy.js";
import { makeCtx, mockLlm, SAMPLE_POLICY } from "./harness.js";

const SLOPPY = `topic:quantum computing
intent:Track hardware and algorithms
include:
  - qubit coherence
exclude:
  - pop science recaps
rank:
  - implementation notes first
extract:
  - architecture claims
voice:
  default:precise and sourced
deploy:
  - hn
hosts:
  - https://arxiv.org
  - example.com
`;

describe("policy_yaml", () => {
  it("inserts a space after mapping colons without breaking URLs", () => {
    const out = normalizePolicyYaml(SLOPPY);
    expect(out).toContain("topic: quantum computing");
    expect(out).toContain("default: precise and sourced");
    expect(out).toContain("- https://arxiv.org");
    const doc = parsePolicyYaml(out);
    expect(doc.topic).toBe("quantum computing");
    expect(doc.voice.default).toBe("precise and sourced");
  });

  it("accepts sloppy LLM yaml in createProposal", () => {
    const ctx = makeCtx();
    const { topic } = createTopic(ctx, "Quantum computing");
    const proposal = createProposal(ctx, topic.id, null, SLOPPY);
    expect(proposal.yaml_text).toContain("topic: quantum computing");
    expect(parsePolicyYaml(proposal.yaml_text).topic).toBe("quantum computing");
  });

  it("still rejects non-mapping yaml", () => {
    expect(() => parsePolicyYaml("just a string")).toThrow(/mapping/);
  });

  it("quotes *globs* and coerces sloppy LLM policy shape", () => {
    const messy = `topic: quantum computing
intent:
  includes:
    - news
    - events
  excludes:
    - academic papers
include:
  - news
  - *events*
  - *technology*
voice: default
deploy:
  hosts:
    - arxiv.org
extract:
  - headlines
`;
    expect(normalizePolicyYaml(messy)).toContain('"*events*"');
    const doc = parsePolicyYaml(messy);
    expect(doc.topic).toBe("quantum computing");
    expect(doc.include).toEqual(["news", "events", "technology"]);
    expect(doc.exclude).toEqual(["academic papers"]);
    expect(doc.voice.default).toBe("precise and sourced");
    expect(doc.hosts).toContain("arxiv.org");
    expect(doc.extract).toEqual(["headlines"]);
  });
});

describe("propose_policy_does_not_fail_chat", () => {
  it("returns a tool error instead of 400 when yaml is unusable", async () => {
    let round = 0;
    const ctx = makeCtx(
      mockLlm({
        chat: () => {
          round += 1;
          if (round === 1) {
            return {
              content: "",
              toolCalls: [{ name: "propose_policy", arguments: { yaml: "::::" } }],
            };
          }
          return { content: "I could not draft a valid policy yet." };
        },
      }),
    );
    const { topic } = createTopic(ctx, "Quantum computing");
    const res = await chatTopic(ctx, topic.id, "track quantum computing");
    expect(res.messages.some((m) => m.role === "assistant" && /could not draft/.test(m.content))).toBe(
      true,
    );
    expect(res.proposal).toBeUndefined();
  });

  it("parses SAMPLE_POLICY unchanged", () => {
    expect(parsePolicyYaml(SAMPLE_POLICY).topic).toBe("local capture");
  });
});
