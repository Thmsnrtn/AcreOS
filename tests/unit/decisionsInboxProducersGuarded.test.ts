/**
 * Population ratchet: every writer of `decisions_inbox_items` under server/** is
 * either GUARDED by the generator throttle (calls raiseIfAllowed / shouldRaiseCard
 * imported from decisionsInboxThrottle) or EXEMPT with a written reason.
 *
 * Why this is a gate over the whole population, not over nine files: a guard on
 * the producers we know is a claim about those files. A tenth inserter that is
 * in neither list fails the discovery assertion below.
 *
 * Source is read through the repo's comment stripper and then PARSED with
 * TypeScript, so a guard call (or an insert) that appears only in a comment, a
 * string, or as a bare identifier reference is never counted. The mutation
 * canary at the bottom proves that: it mutates the thing the gate governs.
 */
import fs from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { stripComments } from "../helpers/stripComments";
import { REPO_ROOT, listServerSources, rel } from "../helpers/serverPopulation";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

interface Guarded {
  status: "guarded";
  /** Minimum insert sites expected in the file (vacuity floor). */
  minInserts: number;
}
interface Exempt {
  status: "exempt";
  reason: string;
  minInserts: number;
}

const PRODUCERS: Record<string, Guarded | Exempt> = {
  "server/services/schemaDriftDetector.ts": { status: "guarded", minInserts: 1 },
  "server/services/stripeDriftDetector.ts": { status: "guarded", minInserts: 1 },
  "server/services/pillarReviewer.ts": { status: "guarded", minInserts: 1 },
  "server/services/vendorSecretRotation.ts": { status: "guarded", minInserts: 1 },
  "server/services/agentRetractCron.ts": { status: "guarded", minInserts: 1 },
  "server/services/agentInitiativeEngine.ts": { status: "guarded", minInserts: 1 },
  "server/services/agentAuthorityGate.ts": { status: "guarded", minInserts: 2 },
  "server/services/onboardingAutonomy.ts": { status: "guarded", minInserts: 2 },
  "server/routes-founder-dlq.ts": { status: "guarded", minInserts: 1 },

  "server/services/decisionsInbox.ts": {
    status: "exempt",
    minInserts: 7,
    reason:
      "service creators (escalation/alert/churn/feature-request/direct/outcome check-in/shadow promotion): request-driven, per-subject lanes with their own dedupe, or one-shot seeds",
  },
  "server/services/solene/letterReply.ts": {
    status: "exempt",
    minInserts: 1,
    reason: "founder echo of their own Letter reply — must never be throttled",
  },
  "server/services/founderInterruptArbiter.ts": {
    status: "exempt",
    minInserts: 1,
    reason: "recordDeferredInterrupt persists an arbiter deferral — a deferral must never be dropped",
  },
  "server/services/cmo/renderOrchestrator.ts": {
    status: "exempt",
    minInserts: 1,
    reason: "one card per rendered bundle; the render job already skips scripts with a ready render",
  },
  "server/services/rosyRiver.ts": {
    status: "exempt",
    minInserts: 2,
    reason:
      "notifyFounder = informational digests with new content each period; proposeCodeChange writes a companion agent_tasks row first, so a card-only guard would orphan task rows (driver ruling 2026-11-09)",
  },
};

const GUARD_NAMES = new Set(["raiseIfAllowed", "shouldRaiseCard"]);
const THROTTLE_MODULE = /decisionsInboxThrottle$/;
const RAW_INSERT = /insert\s+into\s+"?decisions_inbox_items/i;

export interface FileFacts {
  inserts: number;
  guardCalls: number;
}

function endsWithTable(e: ts.Expression): boolean {
  if (ts.isIdentifier(e)) return e.text === "decisionsInboxItems";
  if (ts.isPropertyAccessExpression(e)) return e.name.text === "decisionsInboxItems";
  return false;
}

/** Parse comment-stripped source; count insert sites and imported-guard call sites. */
export function analyse(fileName: string, source: string): FileFacts {
  const sf = ts.createSourceFile(fileName, stripComments(source), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const guardLocals = new Set<string>();
  const nsLocals = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!THROTTLE_MODULE.test(st.moduleSpecifier.text)) continue;
    const nb = st.importClause?.namedBindings;
    if (!nb) continue;
    if (ts.isNamespaceImport(nb)) nsLocals.add(nb.name.text);
    else {
      for (const el of nb.elements) {
        if (GUARD_NAMES.has((el.propertyName ?? el.name).text)) guardLocals.add(el.name.text);
      }
    }
  }
  let inserts = 0;
  let guardCalls = 0;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee) && guardLocals.has(callee.text)) guardCalls += 1;
      else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        nsLocals.has(callee.expression.text) &&
        GUARD_NAMES.has(callee.name.text)
      ) {
        guardCalls += 1;
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "insert" &&
        n.arguments.length > 0 &&
        endsWithTable(n.arguments[0])
      ) {
        inserts += 1;
      }
    }
    if (
      (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) &&
      RAW_INSERT.test(n.text)
    ) {
      inserts += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { inserts, guardCalls };
}

function discover(): { read: number; facts: Map<string, FileFacts> } {
  const files = listServerSources();
  const facts = new Map<string, FileFacts>();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    // Cheap prefilter: a file with an insert must name the table somewhere.
    if (!text.includes("decisionsInboxItems") && !text.includes("decisions_inbox_items")) continue;
    const a = analyse(f, text);
    if (a.inserts > 0) facts.set(rel(f), a);
  }
  return { read: files.length, facts };
}

describe("decisions inbox producers are all guarded or explicitly exempt", () => {
  let cache: ReturnType<typeof discover> | undefined;
  const pop = () => (cache ??= discover());

  it("reads a real population of server sources (floor)", () => {
    const { read, facts } = pop();
    expect(REPO_ROOT.length).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(300);
    expect(facts.size).toBeGreaterThanOrEqual(10);
  });

  it("discovered inserters equal PRODUCERS exactly — a new writer in neither list fails", () => {
    const { facts } = pop();
    const discovered = [...facts.keys()].sort();
    const declared = Object.keys(PRODUCERS).sort();
    expect(discovered, "unlisted inserter(s) or stale PRODUCERS entry — classify guarded/exempt-with-reason").toEqual(declared);
  });

  it("per-member vacuity: each member's insert pattern was actually found", () => {
    const { facts } = pop();
    for (const [file, spec] of Object.entries(PRODUCERS)) {
      const f = facts.get(file);
      expect(f, `${file} discovered`).toBeDefined();
      expect(f!.inserts, `${file} insert sites`).toBeGreaterThanOrEqual(spec.minInserts);
    }
  });

  it("every GUARDED producer calls the throttle at least once per insert site", () => {
    const { facts } = pop();
    for (const [file, spec] of Object.entries(PRODUCERS)) {
      if (spec.status !== "guarded") continue;
      const f = facts.get(file)!;
      expect(f.guardCalls, `${file}: guard calls vs insert sites (${f.inserts})`).toBeGreaterThanOrEqual(Math.max(1, f.inserts));
    }
  });

  it("every EXEMPT producer carries a written reason", () => {
    for (const [file, spec] of Object.entries(PRODUCERS)) {
      if (spec.status !== "exempt") continue;
      expect(spec.reason.trim().length, `${file} reason`).toBeGreaterThan(20);
    }
  });

  it("mutation canary: a guard that exists only in a comment, a string, a bare reference or a local lookalike is UNGUARDED", () => {
    const expr = `db.insert(decisionsInboxItems).values({ itemType: "x" })`;
    const insert = `await ${expr};`;
    const imp = `import { raiseIfAllowed } from "./decisionsInboxThrottle";\n`;

    // control: a real guard is seen
    const real = analyse("real.ts", `${imp}await raiseIfAllowed(i, () => ${expr});`);
    expect(real).toEqual({ inserts: 1, guardCalls: 1 });

    const inComment = analyse("c.ts", `${imp}// await raiseIfAllowed(i, fn)\n/* raiseIfAllowed(i, fn) */\n${insert}`);
    expect(inComment).toEqual({ inserts: 1, guardCalls: 0 });

    const inString = analyse("s.ts", `${imp}const doc = "raiseIfAllowed(i, fn)"; const t = \`raiseIfAllowed(\${1})\`;\n${insert}`);
    expect(inString.guardCalls).toBe(0);

    const bareRef = analyse("b.ts", `${imp}const g = raiseIfAllowed;\n${insert}`);
    expect(bareRef.guardCalls).toBe(0);

    const localLookalike = analyse("l.ts", `async function raiseIfAllowed() {}\nawait raiseIfAllowed();\n${insert}`);
    expect(localLookalike.guardCalls).toBe(0);

    // the two-regex trap: a `/*` inside a line comment must not eat the live guard that follows
    const trap = analyse("t.ts", `${imp}// see /api/x/*. retired\nawait raiseIfAllowed(i, () => ${expr});`);
    expect(trap).toEqual({ inserts: 1, guardCalls: 1 });

    // discovery canaries: an insert inside a comment is not an insert; raw SQL and namespace-qualified table are
    expect(analyse("d1.ts", `// db.insert(decisionsInboxItems)\n`).inserts).toBe(0);
    expect(analyse("d2.ts", "await db.execute(sql`INSERT INTO decisions_inbox_items (a) VALUES (1)`);").inserts).toBe(1);
    expect(analyse("d3.ts", `await db.insert(schema.decisionsInboxItems).values({});`).inserts).toBe(1);

    // classification the real test applies: inserts>0 && guardCalls<inserts → fails the guarded rule
    const unguarded = analyse("u.ts", `${imp}// raiseIfAllowed(i, fn)\n${insert}`);
    expect(unguarded.guardCalls).toBeLessThan(Math.max(1, unguarded.inserts));
  });
});
