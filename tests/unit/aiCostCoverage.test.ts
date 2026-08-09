/**
 * AI cost-enforcement coverage — derived set-invariant
 * (Master Handoff Wave 0 item 0.3, 2026-08-09).
 *
 * Every tool-calling AI agent entry point must enforce the platform cost
 * envelope: consult the daily cost ceiling BEFORE spending, and land its
 * spend in ai_telemetry_events (the ledger the ceiling sums and the COGS
 * rollup reads). There are exactly three sanctioned ways to satisfy that:
 *
 *   A. route through routeAITask (the chokepoint does both), or
 *   B. call the aiSpendGuard pair — assertAiSpendAllowed(...) +
 *      recordExternalAiSpend(...) (vaService / supportAgent pattern), or
 *   C. implement both inline — assertWithinAiCostCeiling(...) AND a direct
 *      aiTelemetryEvents write (the Pax pattern in executive.ts).
 *
 * Like workflowActionHonesty.test.ts, the covered set is DERIVED from the
 * source, not hardcoded: a file counts as a tool-calling entry when its
 * comment-stripped code either
 *   (a) calls `chat.completions.create(` and passes tools (OpenAI wire), or
 *   (b) CALLS Solene's `streamChatWithFailover(` streaming fabric
 *       (Anthropic wire; call sites only, never the declaring transport).
 * A future agent surface that ships without cost enforcement therefore fails
 * CI here, without anyone editing a list.
 *
 * GRANULARITY (honest limitation): the check is file-level. It proves the
 * file participates in an enforcement pattern, not that every code path
 * inside it is individually guarded (e.g. supportAgent's analyze_screenshot
 * sub-call is only reachable inside the already-guarded processSupportChat
 * loop). Path-level proof is what migrating onto routeAITask buys (F-16
 * Phases 2–3, gated on a keyed environment + eval — see
 * docs/audit-2026-08/F-16-router-tool-migration-plan.md).
 *
 * KNOWN_GAPS below is a dated, down-only allowlist of surfaces found WITHOUT
 * full enforcement at the time of writing. Entries may only be REMOVED (by
 * wiring real enforcement) — a gap file that becomes enforced fails the suite
 * until its entry is deleted, and a new unlisted gap fails immediately.
 *
 * idempotent: true — pure source analysis, no DB, no network.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../..");

/** Strip comments so prose mentioning an API is never mistaken for a call. */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function walkTsFiles(dir: string, onFile: (full: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walkTsFiles(full, onFile);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) continue;
    onFile(full);
  }
}

/**
 * The sanctioned chokepoint itself: it now carries `tools:` on its request
 * body (F-16 Phase 1) and IS the enforcement, so it is excluded from the
 * derivation exactly as scripts/ratchets/openai-bypass.json excludes it.
 */
const CHOKEPOINT = path.join("server", "services", "aiRouter.ts");

interface DerivedFile {
  rel: string;
  code: string; // comment-stripped
}

function deriveToolCallingFiles(): DerivedFile[] {
  const out: DerivedFile[] = [];
  walkTsFiles(path.join(ROOT, "server"), (full) => {
    const rel = path.relative(ROOT, full);
    if (rel === CHOKEPOINT) return;
    const code = stripComments(fs.readFileSync(full, "utf-8"));

    // (a) OpenAI-wire function calling: a completions call plus a tools
    //     payload in the same file (`tools:` property/annotation or an
    //     explicit tool_choice). Deliberately NOT a bare `tools,` shorthand
    //     match — prompt prose inside template strings ("proptech tools, or
    //     …" in selfAssessmentAgent.ts) false-positives on it. The remaining
    //     bias is toward false POSITIVES (a prompt containing "tools:" drags
    //     a single-shot file in), which fail CI loudly and get fixed — never
    //     toward silently exempting a real tool caller.
    const callsCompletions = code.includes("chat.completions.create(");
    const passesTools = /\btools\s*:/.test(code) || code.includes("tool_choice");

    // (b) Solene's Anthropic-wire streaming fabric: call sites of
    //     streamChatWithFailover — not the module that declares it
    //     (providerSelector.ts is transport, not an entry point).
    const callsSoleneFabric =
      code.includes("streamChatWithFailover(") &&
      !/function\*?\s+streamChatWithFailover/.test(code);

    if ((callsCompletions && passesTools) || callsSoleneFabric) {
      out.push({ rel, code });
    }
  });
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function enforcementOf(code: string) {
  const router = code.includes("routeAITask(");
  const spendGuard =
    code.includes("assertAiSpendAllowed(") && code.includes("recordExternalAiSpend(");
  const inlineCeiling = code.includes("assertWithinAiCostCeiling");
  const inlineLedger = code.includes("aiTelemetryEvents");
  return {
    enforced: router || spendGuard || (inlineCeiling && inlineLedger),
    router,
    spendGuard,
    inlineCeiling,
    inlineLedger,
  };
}

/**
 * Surfaces WITHOUT full ceiling+ledger enforcement, found 2026-08-09 during
 * Wave 0 item 0.3. Each is a founder-queue decision (wiring a founder-side
 * agent's cost path has model/latency implications — lead call, not a wave
 * agent's). DO NOT add entries to ship a new unguarded surface — this list
 * only shrinks.
 */
const KNOWN_GAPS: Record<string, { since: string; note: string }> = {
  "server/routes-founder-chat.ts": {
    since: "2026-08-09",
    note:
      "Atlas's MAIN agentic loop (POST /api/founder/chat/stream) calls " +
      "client.chat.completions.create directly (~:437 at time of writing) with " +
      "NO cost-ceiling consult and NO aiTelemetryEvents write — Atlas spend is " +
      "invisible to the ceiling and to COGS. (Atlas's synthesis/delegation " +
      "TOOLS route through routeAITask, but the loop that drives them does " +
      "not.) TODO(founder queue): route the loop through tool-aware " +
      "routeAITask (F-16 Phase 2) or add the aiSpendGuard pair.",
  },
  "server/services/solene/chat/turnRunner.ts": {
    since: "2026-08-09",
    note:
      "PARTIAL: Solene consults assertWithinAiCostCeiling (~:243) and has its " +
      "own per-turn cost cap + [ai-cost] logs + capitalTracker rows, but never " +
      "writes ai_telemetry_events — so the ceiling it consults cannot SEE " +
      "Solene's own spend. TODO(founder queue): mirror spend into " +
      "aiTelemetryEvents (recordExternalAiSpend) or migrate per F-16.",
  },
  // paxSupportResolver.ts was in this allowlist on 2026-08-09 for a few hours:
  // a WIRED, customer-triggered tool loop (fires on every ticket creation) with
  // zero cost enforcement. CLOSED same day (Wave 0.3): resolveTicketWithPax now
  // carries assertAiSpendAllowed + recordExternalAiSpend on both completion
  // sites — the derived invariant below enforces it like its siblings.
  "server/services/decisionsInbox.ts": {
    since: "2026-08-09",
    note:
      "createFromFeatureRequest forces a single tool call on gpt-4o-mini " +
      "(~:348) with no ceiling consult and no telemetry. NOTE: no call sites " +
      "for createFromFeatureRequest were found outside its module — likely " +
      "built-but-unwired. TODO(founder queue): migrate to routeAITask " +
      "(single forced tool call — a Phase 2-shaped but low-risk move) or " +
      "delete if confirmed dead.",
  },
  "server/services/negotiationOrchestrator.ts": {
    since: "2026-08-09",
    note:
      "runNegotiationAssistant is a genuine agentic loop (up to 6 rounds of " +
      "gpt-4o with tools, ~:876) with no ceiling consult and no telemetry; " +
      "the file's other gpt-4o single-shots (~:80,:194,:559) are wired via " +
      "routes-core-ai.ts and equally unguarded. NOTE: runNegotiationAssistant " +
      "itself has ZERO call sites — built-but-unwired. TODO(founder queue): " +
      "aiSpendGuard the file now and/or migrate per F-16; decide fate of the " +
      "unwired loop.",
  },
};

describe("AI cost-enforcement coverage (derived)", () => {
  const derived = deriveToolCallingFiles();
  const derivedRels = derived.map((d) => d.rel);

  it("the derivation still finds the known agent surfaces (guards the derivation itself)", () => {
    // A derived invariant that derives nothing green-lights anything.
    for (const expected of [
      path.join("server", "ai", "executive.ts"), // Pax
      path.join("server", "ai", "vaService.ts"), // VA agent
      path.join("server", "ai", "supportAgent.ts"), // support agent
      path.join("server", "routes-founder-chat.ts"), // Atlas main loop
      path.join("server", "services", "solene", "chat", "turnRunner.ts"), // Solene
    ]) {
      expect(derivedRels, `derivation must find ${expected}`).toContain(expected);
    }
    expect(derivedRels).not.toContain(CHOKEPOINT);
  });

  it("every tool-calling entry file enforces cost (router | spend-guard | inline ceiling+ledger) or is a documented, dated gap", () => {
    const offenders: string[] = [];
    for (const { rel, code } of derived) {
      if (rel in KNOWN_GAPS) continue;
      const e = enforcementOf(code);
      if (!e.enforced) {
        offenders.push(
          `${rel} — routeAITask:${e.router} aiSpendGuard:${e.spendGuard} ` +
            `inlineCeiling:${e.inlineCeiling} inlineLedger:${e.inlineLedger}`,
        );
      }
    }
    expect(
      offenders,
      `Tool-calling AI entry files with NO cost enforcement. Wire routeAITask, ` +
        `the aiSpendGuard pair, or inline ceiling+aiTelemetryEvents — do NOT ` +
        `add a KNOWN_GAPS entry for new code:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the KNOWN_GAPS allowlist only shrinks: every entry still exists, is still derived, and still lacks enforcement", () => {
    for (const [rel, gap] of Object.entries(KNOWN_GAPS)) {
      const full = path.join(ROOT, rel);
      expect(fs.existsSync(full), `${rel} vanished — delete its KNOWN_GAPS entry`).toBe(true);
      expect(
        derivedRels,
        `${rel} no longer matches the tool-calling derivation — delete its KNOWN_GAPS entry`,
      ).toContain(rel);
      const e = enforcementOf(stripComments(fs.readFileSync(full, "utf-8")));
      expect(
        e.enforced,
        `${rel} (gap since ${gap.since}) now has full enforcement — DELETE its ` +
          `KNOWN_GAPS entry in the same commit so the allowlist keeps shrinking`,
      ).toBe(false);
    }
  });

  // ── Enforcement-location pins for the guarded agents ──────────────────────
  // WHERE each file's enforcement lived at time of writing (2026-08-09);
  // assertions are on tokens (line numbers drift), locations are documentation.

  it("Pax (server/ai/executive.ts) enforces inline: ceiling via enforcePaxCostCeilings (~:363) + aiTelemetryEvents write in recordPaxTelemetry (~:407)", () => {
    const code = stripComments(
      fs.readFileSync(path.join(ROOT, "server/ai/executive.ts"), "utf-8"),
    );
    expect(code).toContain("assertWithinAiCostCeiling");
    expect(code).toContain("aiTelemetryEvents");
    const e = enforcementOf(code);
    expect(e.enforced).toBe(true);
  });

  it("VA agent (server/ai/vaService.ts) uses the aiSpendGuard pair (assert ~:665/:792, record ~:673/:711/:857)", () => {
    const code = stripComments(
      fs.readFileSync(path.join(ROOT, "server/ai/vaService.ts"), "utf-8"),
    );
    expect(code).toContain("assertAiSpendAllowed(");
    expect(code).toContain("recordExternalAiSpend(");
  });

  it("support agent (server/ai/supportAgent.ts) uses the aiSpendGuard pair (assert ~:5298, record ~:5307/:5373)", () => {
    const code = stripComments(
      fs.readFileSync(path.join(ROOT, "server/ai/supportAgent.ts"), "utf-8"),
    );
    expect(code).toContain("assertAiSpendAllowed(");
    expect(code).toContain("recordExternalAiSpend(");
  });

  // ── Tamper pin on the companion ratchet ───────────────────────────────────

  it("the openai-bypass ratchet still points down from ≤ 89 and still targets the bypass pattern", () => {
    const ratchet = JSON.parse(
      fs.readFileSync(path.join(ROOT, "scripts/ratchets/openai-bypass.json"), "utf-8"),
    );
    expect(ratchet.direction).toBe("down");
    expect(ratchet.baselineCount).toBeLessThanOrEqual(89);
    expect(ratchet.pattern).toContain("chat\\.completions\\.create");
    expect(ratchet.exclude).toContain("server/services/aiRouter.ts");
  });
});
