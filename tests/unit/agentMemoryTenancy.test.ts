/**
 * `agent_memory` writers: three that had never written a row, and a read that
 * spanned every tenant.
 *
 * Found by the §55 raw-corpus reconciliation, against the corpus invariant
 * "AcreOS's knowledge graph must never become a path around tenancy" — and in
 * exactly the blind spot `check-org-scoped-fetch.mjs --blind-spot` measures,
 * which is why no tenancy gate had ever objected.
 *
 * THE TABLE. `agent_memory` has `organization_id` (NOT NULL, FK), `agent_type`,
 * `memory_type`, `key` (NOT NULL) and `value` (jsonb, NOT NULL). There is NO
 * `content` column.
 *
 * THE WRITERS. Three of them wrote `content` — a column that does not exist —
 * while omitting `organization_id`, `key` and/or `value`. Each passed `as any`
 * to silence the type error and wrapped the insert in an empty `catch {}`, so
 * every call violated NOT NULL, threw, and was swallowed:
 *
 *   agentKnowledgeGraph.shareKnowledge  — omitted organization_id + value; its
 *                                         catch comment blamed a "duplicate
 *                                         key", and `agent_memory` has NO
 *                                         unique constraint to violate.
 *   companyAgents.storeMemory           — omitted organization_id, key, value.
 *   overrideLearner                     — omitted organization_id + value.
 *
 * So knowledge sharing, company-agent memory and override learning had each
 * never persisted anything, while their logs and return values implied success.
 *
 * THE READ. `getAgentKnowledge` filtered on `agent_type` ALONE, returning every
 * organization's rows, and its docstring says the result becomes "the agent's
 * context for AI calls". It had no production caller, which is the only reason
 * this was latent rather than live.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Every module that inserts into `agent_memory`. */
const WRITERS = [
  "server/services/agentKnowledgeGraph.ts",
  "server/services/companyAgents.ts",
  "server/services/overrideLearner.ts",
  "server/services/atlasMemory.ts",
  "server/ai/executive.ts",
  "server/services/autonomyGuardrails.ts",
  "server/services/marketNetworkContributor.ts",
];

/**
 * Comments stripped before any scan.
 *
 * The first version of this file scanned raw source, and the `as any` check
 * failed on THREE FILES IT HAD JUST FIXED — because the comments explaining the
 * removed cast contain the words "as any". A scanner that cannot tell code from
 * prose is the same mechanism `lint-reachability.mjs` records being fooled by a
 * symbol named in a TODO. Strip first, then look.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The text of each `db.insert(agentMemory).values({ … })` call in a file. */
function insertBlocks(raw: string): string[] {
  const src = codeOnly(raw);
  const blocks: string[] = [];
  const marker = "insert(agentMemory).values({";
  let at = src.indexOf(marker);
  while (at !== -1) {
    // The block ends at the first `})` that closes the values object. Bounded
    // slice rather than a brace walk: these are flat literals, and a slice that
    // overruns would only make the assertions STRICTER, never weaker.
    const end = src.indexOf("})", at);
    blocks.push(src.slice(at, end === -1 ? at + 800 : end));
    at = src.indexOf(marker, at + 1);
  }
  return blocks;
}

describe("the scan finds the writers it claims to check (vacuity guard, first)", () => {
  it("every listed writer exists and really inserts into agent_memory", () => {
    // Without this, a renamed file or a changed call shape would silently
    // reduce this file to asserting nothing at all.
    const found = WRITERS.filter((f) => insertBlocks(read(f)).length > 0);
    expect(
      found,
      "a module listed here no longer inserts into agent_memory the way this " +
        "test looks for. Re-point the scan — do not delete the entry.",
    ).toEqual(WRITERS);
  });
});

describe("no agent_memory insert omits a NOT NULL column", () => {
  it("every insert supplies organization_id, key and value", () => {
    const violations: string[] = [];
    for (const file of WRITERS) {
      for (const block of insertBlocks(read(file))) {
        for (const col of ["organizationId", "key", "value"]) {
          // `[:,\n}]` accepts SHORTHAND properties (`organizationId,`) as well
          // as `organizationId: x`. Requiring a colon reported three false
          // positives against files that were already correct — and a check
          // that cries wolf is one somebody deletes.
          if (!new RegExp(`\\b${col}\\s*[:,\\n}]`).test(block)) {
            violations.push(`${file} — insert missing \`${col}\``);
          }
        }
      }
    }
    expect(
      violations,
      "an insert into agent_memory omits a NOT NULL column. It will throw at " +
        "runtime, and every call site here wraps the insert in a catch — so it " +
        "fails SILENTLY and the subsystem reports success while storing " +
        "nothing.\n" + violations.join("\n"),
    ).toEqual([]);
  });

  it("no insert writes `content`, which is not a column on this table", () => {
    const violations = WRITERS.flatMap((file) =>
      insertBlocks(read(file))
        .filter((b) => /\bcontent\s*[:,]/.test(b) && !/value\s*:\s*\{[^}]*content/.test(b))
        .map(() => `${file} — writes a bare \`content\` field`),
    );
    expect(
      violations,
      "`agent_memory` has no `content` column; the payload goes in `value` " +
        "(jsonb).\n" + violations.join("\n"),
    ).toEqual([]);
  });

  it("no insert into agent_memory is cast with `as any`", () => {
    // The cast is what let three inserts name a nonexistent column and omit
    // three required ones without the compiler saying a word.
    const violations = WRITERS.flatMap((file) =>
      insertBlocks(read(file))
        .filter((b) => /as any/.test(b))
        .map(() => `${file} — insert cast with \`as any\``),
    );
    expect(
      violations,
      "an `as any` on an agent_memory insert. That cast hid a missing NOT NULL " +
        "tenant key for the life of three subsystems.\n" + violations.join("\n"),
    ).toEqual([]);
  });
});

describe("the knowledge graph is not a path around tenancy", () => {
  const src = read("server/services/agentKnowledgeGraph.ts");

  it("getAgentKnowledge takes an organizationId and filters on it", () => {
    expect(
      src,
      "getAgentKnowledge no longer requires an organizationId — it would " +
        "return every tenant's agent memory, and its own docstring says that " +
        "becomes the agent's context for AI calls.",
    ).toMatch(/getAgentKnowledge\(\s*\n?\s*organizationId: number/);

    // BOTH queries, not just the first. The function runs two: own memories and
    // shared knowledge. Scoping one and not the other leaks half.
    const body = src.slice(src.indexOf("export async function getAgentKnowledge"));
    const scoped = body
      .slice(0, body.indexOf("return { ownMemories"))
      .match(/eq\(agentMemory\.organizationId, organizationId\)/g);
    expect(
      scoped?.length,
      "one of getAgentKnowledge's two queries is not org-scoped",
    ).toBe(2);
  });

  it("the platform's own agents ask for the platform org explicitly", () => {
    // Named at the call site rather than defaulted inside the query, so a
    // customer-plane caller cannot receive platform rows by omitting an
    // argument and never noticing.
    expect(src).toContain("getAgentKnowledge(SYSTEM_ORG_ID, agentCodename, 10)");
  });

  it("the prompt section reads `value`, and emits nothing when it is empty", () => {
    // It used to map `m.content` — the nonexistent column — so every line would
    // have rendered "- undefined". A prompt that announces TEAM INTELLIGENCE
    // and then lists nothing invites the model to fill the gap.
    const fn = src.slice(src.indexOf("export async function getSharedKnowledgeForPrompt"));
    expect(fn).not.toMatch(/\$\{?m\.content\}?/);
    expect(fn).toContain("m.value");
    expect(fn).toContain("if (lines.length === 0) return \"\";");
  });
});

describe("the system org has one definition", () => {
  it("is a shared constant, not a private copy per service", () => {
    const constant = read("shared/tenancy/systemOrg.ts");
    expect(constant).toContain("export const SYSTEM_ORG_ID = 1");
    for (const file of [
      "server/services/agentKnowledgeGraph.ts",
      "server/services/companyAgents.ts",
      "server/services/overrideLearner.ts",
      "server/services/marketNetworkContributor.ts",
      "server/services/marketIntelligence.ts",
      "server/jobs/courseCompletionCheck.ts",
      "server/services/selfAssessmentAgent.ts",
      "server/services/agentPromotionGate.ts",
    ]) {
      expect(read(file), `${file} does not import the shared constant`).toContain(
        '@shared/tenancy/systemOrg',
      );
    }
  });

  it("no service declares its own copy of the constant", () => {
    // Two did (`selfAssessmentAgent`, `agentPromotionGate`), and three more used
    // a bare `1` with a comment. A private copy is exactly how the 0/1
    // disagreement below came to exist.
    const offenders = [
      "server/services/selfAssessmentAgent.ts",
      "server/services/agentPromotionGate.ts",
      "server/services/marketNetworkContributor.ts",
      "server/services/marketIntelligence.ts",
      "server/jobs/courseCompletionCheck.ts",
    ].filter((f) => /const\s+(SYSTEM|PLATFORM)_ORG_ID\s*=/.test(read(f)));
    expect(
      offenders,
      "a service re-declared the system org locally instead of importing it.",
    ).toEqual([]);
  });

  it("records that indexAnalyzer still disagrees (0 vs 1)", () => {
    // The disagreement is REAL and deliberately not silently "fixed":
    // repointing a live job from org 0 to org 1 changes which rows it acts on,
    // and no session has had a DATABASE_URL to look. Pinned so the note cannot
    // quietly disappear while the disagreement remains.
    expect(read("server/jobs/indexAnalyzer.ts")).toContain("PLATFORM_ORG_ID = 0");
    expect(
      read("shared/tenancy/systemOrg.ts"),
      "the shared constant no longer records the 0-vs-1 disagreement. If " +
        "indexAnalyzer was reconciled, say so there and drop this assertion " +
        "deliberately.",
    ).toContain("indexAnalyzer");
  });
});
