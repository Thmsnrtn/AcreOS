/**
 * AI Prompt Leakage — Founder/Codename Scrub
 *
 * Lila §2 flagged that customer-facing AI prompts can leak founder-only
 * codenames (Atlas, Sophie, Forge, Beacon, Sentinel, Ledger, Shield,
 * Oracle, Compass, Crucible) and founder-POV phrasing into customer
 * output (Pax inbox drafts, Pax suggestions, AI lead summaries, AI
 * direct-mail copy, AI campaign copy).
 *
 * Per the persona architecture (see MEMORY.md): customers see Pax only.
 * The founder-side board (Sophie/Forge/Atlas/etc.) is internal taxonomy
 * and must never appear in customer-visible LLM input or output.
 *
 * This suite locks the customer-visible prompt files: it loads each
 * file as text and asserts that none of the leaked terms appear in
 * any of the literal prompt regions. The test deliberately ignores
 * import names, validator type imports, and similar non-prompt code
 * paths via per-file allowlists.
 *
 * If a customer-visible prompt is added in the future and contains
 * a leaked codename, this test will fail and force the author to
 * either scrub the leak or move the prompt to a founder-only surface.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Customer-visible AI prompt files ────────────────────────────────────────
//
// Each entry is a file whose LLM prompt strings (or LLM-generated content
// templates) reach a customer surface. Adding a file here makes the leak
// scan apply to that file. If a file mixes customer + founder usage, split
// it (e.g., `pax_customer.ts` + `<role>_founder.ts`) before adding here.

interface CustomerPromptSource {
  path: string;
  /**
   * Substrings that, when found in the file, are NOT considered a leak.
   * These are non-prompt code paths (import names, type names, internal
   * channel docblocks, telemetry codenames, etc.).
   */
  allow?: string[];
}

const CUSTOMER_PROMPT_FILES: CustomerPromptSource[] = [
  {
    path: "server/ai/supportAgent.ts",
    // Internal telemetry fields (`sophieAnalysis`, `Sophie (AI)` strings
    // are addressed in customerSupportAutoResolver.ts; here only PAX_SYSTEM_PROMPT
    // and tool-internal classifier prompts run, but the file also references
    // `sophieAnalysis` as an internal telemetry field — that never reaches
    // customer surfaces).
    allow: [
      "sophieAnalysis",
      "[sophie]",
      "sophie:",
      "sophie_csm",
      // Code comment about implementation detail of finding Sophie's
      // last draft — internal, not part of any LLM prompt body.
      "// Try to find a draft response from Sophie's last",
    ],
  },
  {
    path: "server/ai/vaService.ts",
    allow: ["validateAtlasOutput", "AtlasOutputType"],
  },
  {
    path: "server/services/customerNarrative.ts",
    // Docblock comments describing internal architecture are not
    // part of any LLM prompt body. The actual customer-letter prompt
    // (CUSTOMER_LETTER_SYSTEM_PROMPT) is the one this test guards.
    allow: [
      "sophie_csm",
      "Sophie as a name stays",
      "* Mirror of the founder letter",
      "the founder-side board",
      "// from the founder audit UI",
      "Pax. The founder-side board",
    ],
  },
  {
    path: "server/services/customerSupportAutoResolver.ts",
    // Internal codename telemetry retained for senderId / agent traces;
    // customer-facing senderName + prompt content are scrubbed.
    allow: [
      "senderId: \"sophie\"",
      "senderId: \"sophie_genius\"",
      "[SophieGeniusMode]",
      "by Sophie (confidence",
      "sophieAnalysis",
      "* Sophie",
      "// Sophie",
      "Sophie's Confidence Mode",
      "SOPHIE_CONFIDENCE_MODE",
      "sophieGeniusMode",
      "Path 1: Sophie",
      "Path 2: Sophie",
      "Sophie auto-resolves",
      "Sophie is confident",
      "1. Sophie ",
      "2. Sophie ",
      "Sophie auto-resolved",
      "Sophie (primary)",
      "Sophie Genius Mode",
      // Docblock comments about routing / founder visibility — not
      // part of any LLM prompt body.
      "* This is a CUSTOMER-FACING service",
      "* Transparency: all auto-resolutions are logged so the founder",
      "// When Sophie's confidence is",
      "// escalating to the founder inbox",
      "* Get auto-resolution stats for the founder briefing",
    ],
  },
  {
    path: "server/services/revenueProtection.ts",
    // Code comments documenting which agent owns which dunning band.
    // Not part of any LLM prompt body.
    allow: [
      "// Score 70-89 (red): Sophie",
      "// Score 40-69 (yellow): Sophie",
    ],
  },
  {
    path: "server/services/leadQualification.ts",
  },
  {
    path: "server/services/leadNurturer.ts",
  },
  // aiTutor.ts retired 2026-06-08 — Academy module removed.
  {
    path: "server/services/onboardingAutonomy.ts",
    // Code-comment / docblock references describing internal agent routing
    // are allowed; the customer-visible `description` strings are scrubbed.
    allow: [
      "// Onboarding Autonomy — Sophie's",
      "introduce Sophie",
      "Sophie routes a direct",
      "ownerAgentCodename: \"sophie_csm\"",
      "Sophie recommends",
      " * Onboarding Autonomy — Sophie's",
      " *   0   day0_welcome           Welcome + introduce Sophie",
      " * attention — Sophie routes a direct message into the founder inbox.",
      "Sophie's 30-day",
      "// If stalled, surface to the founder decision inbox",
    ],
  },
  {
    path: "server/services/agentActionExecutors.ts",
    // Internal agent codename registrations are allowed; the customer-
    // facing email HTML and senderName strings are scrubbed.
    allow: [
      "registerExecutor(\"sophie_csm\"",
      "registerExecutor(\"forge_revenue\"",
      "registerExecutor(\"beacon_marketing\"",
      "registerExecutor(\"ledger_finance\"",
      "registerExecutor(\"atlas_cto\"",
      "registerExecutor(\"sentinel_devops\"",
      "registerExecutor(\"shield_legal\"",
      "registerExecutor(\"oracle_analytics\"",
      "registerExecutor(\"compass_pm\"",
      "registerExecutor(\"crucible_qa\"",
      "// ─── Sophie",
      "// ─── Forge",
      "// ─── Beacon",
      "// ─── Ledger",
      "// ─── Atlas",
      "// ─── Sentinel",
      "// ─── Shield",
      "// ─── Oracle",
      "// ─── Compass",
      "// ─── Crucible",
      "grantedBy: \"sophie_csm\"",
      // File-header docblock listing internal agent inventory.
      "* Agent Action Executors — Sovereign Company Protocol",
      "All 10 agents now have executors",
      // systemAlerts rows are surfaced only on the founder dashboard
      // (/sovereign console), never to customers. Codename mentions
      // in alert.message bodies are founder-internal telemetry.
      "Ledger detected an unusual financial pattern",
      "acknowledged by Atlas",
      "Shield detected a compliance concern",
      "Crucible detected a quality concern",
      "Shield flagged a ${riskType}",
    ],
  },
  {
    path: "server/routes-ai-draft.ts",
  },
  {
    path: "server/routes-customer-letter.ts",
  },
  // routes-academy.ts retired 2026-06-08 — Academy module removed.
  {
    path: "server/routes-deals.ts",
  },
  {
    path: "server/routes-realtime.ts",
  },
];

// ─── Leaked terms ────────────────────────────────────────────────────────────

const FOUNDER_CODENAMES = [
  "Atlas",
  "Sophie",
  "Forge",
  "Beacon",
  "Sentinel",
  "Ledger",
  "Shield",
  "Oracle",
  "Compass",
  "Crucible",
];

const FOUNDER_POV_PHRASES = [
  "as the CTO",
  "as the CEO",
  "the founder",
  "AcreOS founder",
  // "Thomas" intentionally NOT included as a bare token: it is too easily
  // a false-positive against unrelated identifiers. A leak of the founder
  // name in a customer prompt would manifest as one of the phrases above
  // or as one of the codenames; if a future leak surfaces "Thomas" verbatim
  // we'll add it here.
];

const INTERNAL_TERMINOLOGY = [
  "calm matrix",
  "sovereign company protocol",
  "founder mode",
  "JC#",
];

const LEAKED_TERMS = [
  ...FOUNDER_CODENAMES,
  ...FOUNDER_POV_PHRASES,
  ...INTERNAL_TERMINOLOGY,
];

// ─── Scanner ─────────────────────────────────────────────────────────────────

function scanFileForLeaks(
  filePath: string,
  allow: string[] = [],
): { term: string; line: number; snippet: string }[] {
  const abs = resolve(__dirname, "..", "..", filePath);
  const text = readFileSync(abs, "utf-8");
  const lines = text.split("\n");
  const leaks: { term: string; line: number; snippet: string }[] = [];

  // A COMMENT CANNOT REACH A CUSTOMER.
  //
  // This scanner read every line, so a docblock explaining WHY a founder-only
  // boundary exists was flagged as a leak of it — the mirror image of the
  // recorded trap where a source gate matches its own fix comments and calls
  // that behaviour. Only whole-line comments are skipped (first non-space
  // characters are `//`, `*` or `/*`), so a string containing `//` — a URL, a
  // path — is still scanned.
  //
  // Guarded by a floor: if comment-skipping ever swallowed most of a file, the
  // gate would silently stop scanning it, which is exactly the vacuous green
  // this repository fails gates for.
  const isWholeLineComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);
  const scannable = lines.filter((l) => !isWholeLineComment(l));
  if (lines.length > 20 && scannable.length < lines.length * 0.2) {
    throw new Error(
      `${filePath}: comment-skipping removed ${lines.length - scannable.length} of ` +
        `${lines.length} lines. The scanner is no longer reading this file — fix the ` +
        `comment detection rather than accepting a green.`,
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isWholeLineComment(line)) continue;
    // Skip the line if any allowlisted substring matches the line.
    if (allow.some((a) => line.includes(a))) continue;

    for (const term of LEAKED_TERMS) {
      // Codenames are only leaks when they appear with a word boundary —
      // we don't want to false-positive on words like "atlasMemory" or
      // "AtlasOutputType" used as identifier/type names. (Those are
      // already shielded by a per-file allow entry where applicable; the
      // word-boundary regex is the second line of defense.)
      const isCodename = FOUNDER_CODENAMES.includes(term);
      const pattern = isCodename
        ? new RegExp(`\\b${term}\\b`)
        : new RegExp(term, "i");
      if (pattern.test(line)) {
        leaks.push({ term, line: i + 1, snippet: line.trim().slice(0, 200) });
      }
    }
  }

  return leaks;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AI Prompt Leakage — customer-visible prompts must not contain founder codenames or POV", () => {
  for (const source of CUSTOMER_PROMPT_FILES) {
    it(`${source.path} contains no founder codenames or POV phrases`, () => {
      const leaks = scanFileForLeaks(source.path, source.allow ?? []);
      if (leaks.length > 0) {
        const detail = leaks
          .slice(0, 20)
          .map((l) => `  L${l.line}: [${l.term}] ${l.snippet}`)
          .join("\n");
        throw new Error(
          `Found ${leaks.length} potential founder-POV / codename leak(s) in ${source.path}:\n${detail}\n\nIf this is a non-customer-facing usage (telemetry, internal codename, docblock), add it to the per-file allow list. Otherwise, scrub it — customers must never see internal codenames in AI output.`,
        );
      }
      expect(leaks).toEqual([]);
    });
  }

  it("PAX_SYSTEM_PROMPT in supportAgent.ts is the canonical Pax persona", () => {
    const abs = resolve(__dirname, "..", "..", "server/ai/supportAgent.ts");
    const text = readFileSync(abs, "utf-8");
    expect(text).toMatch(
      /const PAX_SYSTEM_PROMPT = `You are Pax, the AcreOS Support Agent/,
    );
  });
});
