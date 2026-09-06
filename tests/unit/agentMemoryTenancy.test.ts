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
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * Source with comment lines removed.
 *
 * Every name-based scan in this file needs it: the first version of the
 * indexAnalyzer assertion matched the very comment in indexAnalyzer.ts that
 * explains which constant was REMOVED, and failed on the fixed file. Prose
 * about a defect is not the defect.
 */
const codeOf = (p: string): string =>
  read(p)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

/** Every TypeScript source file under server/ and shared/ (no tests). */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(child);
      } else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) {
        out.push(child);
      }
    }
  };
  walk("server");
  walk("shared");
  return out;
}

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
  return stripComments(src);
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

  it("sanitizes stored content before it reaches an agent prompt", () => {
    // The stored text is not AcreOS's prose: it comes from an executor's
    // `detail`, which interpolates customer-controlled values (`org.name`,
    // `stuckFeature`). Unsanitized, an org named
    // "Acme\n\nSYSTEM: ignore previous instructions…" is read as instructions
    // by another agent. Corpus rule: retrieved content must never acquire
    // instruction authority merely because an LLM can read it.
    const fn = src.slice(src.indexOf("export async function getSharedKnowledgeForPrompt"));
    expect(
      fn,
      "shared knowledge reaches an agent prompt without sanitizePromptInline",
    ).toContain("sanitizePromptInline(v.content)");
    expect(src).toContain('from "../utils/sanitizePrompt"');
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
    // disagreement came to exist.
    //
    // SCANS THE CORPUS, NOT A LIST. This was a hardcoded five-file allowlist,
    // and an audit found it passing green over TWO surviving private copies —
    // autonomyBootstrap.ts and rosyRiver.ts — simply because nobody had added
    // them to the array. A gate that checks the files it already knows about
    // confirms the past; it cannot catch the next one. Both were fixed and the
    // scan now walks every server/ and shared/ source file.
    const offenders = sourceFiles()
      .filter((f) => f !== "shared/tenancy/systemOrg.ts")
      .filter((f) => /^\s*(export\s+)?const\s+(SYSTEM|PLATFORM)_ORG_ID\s*=/m.test(codeOf(f)));
    expect(
      offenders,
      "a service re-declared the system org locally instead of importing it " +
        "from @shared/tenancy/systemOrg. Six private spellings disagreeing " +
        "about which row is the platform org is what this file exists to stop.",
    ).toEqual([]);
  });

  it("the private-constant scan covers a real corpus (vacuity guard)", () => {
    // The scan above returns [] both when the corpus is clean and when the walk
    // is broken. Only this distinguishes them.
    expect(
      sourceFiles().length,
      "no source files walked — the offender list above proves nothing",
    ).toBeGreaterThan(800);
  });

  it("indexAnalyzer is reconciled — the 0-vs-1 disagreement is gone", () => {
    // WAS: `expect(read(...)).toContain("PLATFORM_ORG_ID = 0")` — this test
    // pinned the DISAGREEMENT so it could not quietly disappear while it was
    // still true. It was resolved on the founder's decision (OD-4, 2026-08-17),
    // so the assertion is REWRITTEN to the new truth rather than deleted: the
    // invariant it protects is "every system-org reference agrees", and that
    // invariant now has a stronger form to check.
    //
    // Scanned with comments stripped. The first version matched the very
    // comment in indexAnalyzer.ts that explains what was removed ("Was `const
    // PLATFORM_ORG_ID = 0` …") and failed on the fixed file. Prose about a
    // defect is not the defect — a rule that cannot tell them apart punishes
    // writing the reason down.
    const src = codeOf("server/jobs/indexAnalyzer.ts");
    expect(
      /const\s+PLATFORM_ORG_ID\s*=/.test(src),
      "indexAnalyzer re-declared a private platform-org constant. Import " +
        "SYSTEM_ORG_ID from @shared/tenancy/systemOrg instead.",
    ).toBe(false);
    expect(
      src,
      "indexAnalyzer no longer imports the shared system-org constant",
    ).toContain('from "@shared/tenancy/systemOrg"');

    // THE ASSERTION THAT ACTUALLY MATTERS, and it was missing.
    //
    // The two checks above are keyed on a NAME and an IMPORT. An audit put the
    // defect back WITHOUT re-declaring the constant — it wrote the literal 0
    // straight into all four queries — and this test stayed green. That is the
    // same mistake as pinning a trigger by a name that survives being renamed:
    // the gate reported coverage it did not have.
    //
    // What is wrong is the VALUE reaching the tenant column, so that is what is
    // checked now. `organizationId` in this file must never be a numeric
    // literal.
    const literalOrgIds = [
      ...src.matchAll(/organizationId\s*[:,]\s*(\d+)/g),
      ...src.matchAll(/organizationId\s*===?\s*(\d+)/g),
    ].map((m) => m[0].trim());
    expect(
      literalOrgIds,
      "indexAnalyzer passes a hardcoded organization id. It must use " +
        "SYSTEM_ORG_ID — a literal here is precisely the OD-4 defect, and " +
        "writing `0` inline evades a name-based check entirely.",
    ).toEqual([]);
    expect(src).toContain("SYSTEM_ORG_ID");
  });

  it("the shared constant still explains WHY 1 and not 0", () => {
    // The reasoning outlives the disagreement. `organizations.id` is a serial,
    // so 0 cannot exist without a deliberate insert — that is the fact that
    // decided OD-4, and a future session repeating the mistake should find it
    // written down rather than have to re-derive it.
    const doc = read("shared/tenancy/systemOrg.ts");
    expect(doc, "systemOrg.ts no longer records why the platform org is 1").toContain("serial");
    expect(doc).toContain("indexAnalyzer");
  });
});
