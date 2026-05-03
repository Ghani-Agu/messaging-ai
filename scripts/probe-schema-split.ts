/**
 * Validates the single-tool design (P4r-2 / P4r-4) against real Claude.
 *
 * History: P4r-3 split this into a metadata-only tool with reply as
 * natural content; the probe found that Sonnet 4.6 with forced tool_use
 * emits the tool_use block exclusively (no text alongside). P4r-4
 * reverted to the original P4r-2 single-tool design — reply lives
 * inside the tool args. This probe now re-validates the reverted design
 * against live Sonnet 4.6.
 *
 * Usage:  npm run probe:schema
 *
 * Cost:   ~$0.003 per run.
 *
 * Exit 0 = single-tool design works as expected.
 * Exit 1 = at least one validation failed.
 * Exit 2 = setup error (missing key, network, etc).
 */

import { defaultVoiceProfile } from "@/lib/validators";
import { buildPrompt } from "@/server/ai/prompts/system";
import { RealClaudeClient } from "@/server/ai/real-claude-client";

async function main(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[probe-schema] ANTHROPIC_API_KEY not set");
    return 2;
  }

  const { system, userMessage } = buildPrompt({
    tenantName: "Probe Test Co",
    voice: defaultVoiceProfile(),
    citations: [],
    history: [],
    message: "What are your hours of operation?",
  });

  const client = new RealClaudeClient({ apiKey });

  console.log(
    "[probe-schema] making real Sonnet 4.6 call (single-tool design)…",
  );
  let result;
  try {
    result = await client.sendReply({ system, userMessage, maxTokens: 600 });
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : "Unknown";
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[probe-schema] FAIL: client threw ${name}: ${msg}`);
    if (
      name === "AnthropicToolRefusalError" ||
      name === "AnthropicMissingMetadataError"
    ) {
      console.error(
        "[probe-schema] Single-tool design is failing — this is unexpected",
      );
      console.error("[probe-schema] for an empty-citations 'what are your hours'");
      console.error("[probe-schema] prompt. Investigate: prompt content, model");
      console.error("[probe-schema] alias rotation, or upstream API change.");
    }
    return 1;
  }

  const checks: Record<string, boolean> = {
    replyNonEmpty: result.toolArgs.reply.length > 0,
    replyLooksNatural:
      result.toolArgs.reply.length > 20 && !/^[A-Z_]+$/.test(result.toolArgs.reply),
    hasLanguage: ["ar", "fr", "en", "darija"].includes(result.toolArgs.language),
    hasGroundedness:
      typeof result.toolArgs.groundedness === "number" &&
      result.toolArgs.groundedness >= 0 &&
      result.toolArgs.groundedness <= 1,
    hasCitationsUsed: Array.isArray(result.toolArgs.citations_used),
    hasEscalationRecommended:
      typeof result.toolArgs.escalation_recommended === "boolean",
    usagePresent: result.usage !== null,
  };

  console.log("[probe-schema] checks:");
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? "✓" : "✗"} ${k}`);
  }

  console.log("[probe-schema] response detail:");
  console.log(`  modelId: ${result.modelId}`);
  console.log(`  retriesUsed: ${result.retriesUsed}`);
  console.log(
    `  reply (first 200 chars): ${JSON.stringify(result.toolArgs.reply.slice(0, 200))}`,
  );
  console.log(`  toolArgs.language: ${result.toolArgs.language}`);
  console.log(`  toolArgs.groundedness: ${result.toolArgs.groundedness}`);
  console.log(
    `  toolArgs.citations_used: ${JSON.stringify(result.toolArgs.citations_used)}`,
  );
  console.log(
    `  toolArgs.escalation_recommended: ${result.toolArgs.escalation_recommended}`,
  );
  console.log(`  usage: ${JSON.stringify(result.usage)}`);

  // Caching note: cache_creation_input_tokens may be 0 if the cache
  // breakpoint segments are below Anthropic's minimum (1024 tokens for
  // Sonnet). Probe-shaped prompts (defaultVoiceProfile, no citations)
  // sit just below; real production tenants with full voice profiles +
  // tier-1 facts cross the threshold. NOT a probe failure.
  if ((result.usage?.cacheCreationInputTokens ?? 0) === 0) {
    console.log(
      "  note: cache_creation_input_tokens=0 — likely below Anthropic's",
    );
    console.log(
      "        per-segment minimum (~1024 tokens). Production tenants with",
    );
    console.log(
      "        non-default voice profiles + tier-1 facts should clear it.",
    );
  }

  const allPass = Object.values(checks).every((v) => v);
  if (allPass) {
    console.log(
      "\n[probe-schema] PASS — single-tool design confirmed against live Sonnet 4.6.",
    );
    return 0;
  } else {
    console.log("\n[probe-schema] FAIL — at least one check failed.");
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[probe-schema] uncaught error:", err);
    process.exit(2);
  });

export {};
