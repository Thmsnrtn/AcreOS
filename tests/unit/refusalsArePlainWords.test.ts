/**
 * A refusal a founder or customer can see says what happened, why, and what
 * unlocks it — in plain words.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The simulation platform's adversarial year (2026-10-08) read every refusal
 * the product gave: 26 of 159 tool refusals were plain words, and 1 of 23 runs
 * the founder reads about in Story. Pax relayed `{"success":false,"error":"Lead
 * 5 not found"}` to a customer; the founder read `terminated: empty_result —
 * Nothing further to add.`; the support worker was told `refund_purchase
 * refused: $75.00 is over the $50.00 limit`. Re-scored with the checker below,
 * that run was 0 of 159.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * One checker, shared/refusal/plainRefusal.ts `judgeRefusal`, used by the
 * product, by this gate and by the red-team world scorer — so the measure and
 * the thing measured cannot drift. A refusal object in a member of the
 * population must be BUILT where it is returned (toolRefusal / plainRefusal /
 * toolFailure with literal parts, or a registered builder this test calls),
 * so the words can be read and judged here.
 *
 * ── THE POPULATION ──────────────────────────────────────────────────────────
 * Not a list someone remembered: every non-test file under server/ is parsed,
 * and every file holding at least DISCOVERY_MIN refusal objects must be named
 * below — COVERED (zero violations), EXCLUDED (with the reason no person reads
 * its refusals), or in the UNCOVERED register with its exact count of raw
 * refusals, which may only SHRINK. A new tool switch that nobody listed fails
 * here, not in a customer's chat.
 *
 * ── STORY ───────────────────────────────────────────────────────────────────
 * A failed or cancelled run is shown to the founder through
 * dispatchOutcomeInWords (GET /api/founder/dispatches → outcomeInWords). Every
 * termination reason the two runners can record (their union types, parsed)
 * must have plain words, and the route and the world scorer must consume the
 * projection rather than the stored technical note.
 *
 * Mutations run against this file (each went red — recorded in the commit):
 *   1. tools.ts: a lead lookup back to `return { success: false, error: "Lead not found" }`.
 *   2. supportAgent.ts: `return toolFailure(...)` back to `{ success: false, error: error.message }`.
 *   3. plainRefusal.ts: delete RUN_STOP_WORDS.empty_result (it falls to the generic sentence).
 *   4. routes-dispatch.ts: drop the `outcomeInWords` property.
 *   5. remove server/ai/supportAgent.ts from COVERED (discovery names it).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  judgeRefusal,
  refusalTextOf,
  plainRefusal,
  dispatchOutcomeInWords,
  toolFailure,
} from "../../shared/refusal/plainRefusal";

const isPlainRefusal = (t: string) => judgeRefusal(t).plain;
import { scanRefusals, countRefusalObjects } from "../helpers/refusalPopulation";
import { listServerSources, parseSource, rel, REPO_ROOT } from "../helpers/serverPopulation";
import { PAX_PAUSE_COPY } from "../../shared/pax-glossary";
import { undeclaredSupportScopeMessage, supportScopeRefusalMessage } from "../../server/ai/supportToolScopes";

const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8");

/** Builders whose outputs are verified below by calling them. */
const REGISTERED_BUILDERS = new Set(["paxControlsRefusalMessage", "undeclaredSupportScopeMessage", "supportScopeRefusalMessage"]);
/** Constants whose text is read from source and judged below. */
const REGISTERED_CONSTANTS = new Set(["APPLY_CREDIT_REFUSAL", "VOID_INVOICE_REFUSAL"]);
/**
 * Text handed through from outside the population, counted per file. A role
 * worker's draft is frozen by the autopilot's hand registry, and when the
 * freeze is refused its words are the registry's (server/services/autopilot).
 */
const REGISTERED_PASS_THROUGH = new Set(["frozen.output"]);
const OPTS = { registeredBuilders: REGISTERED_BUILDERS, registeredConstants: REGISTERED_CONSTANTS, registeredPassThrough: REGISTERED_PASS_THROUGH };

/** Every refusal a model relays to a customer or the founder, from these files, is plain words. */
const COVERED: Record<string, { floor: number; passThrough: number }> = {
  // Pax's tool switch — a customer's chat.
  "server/ai/tools.ts": { floor: 60, passThrough: 0 },
  // The support agent's tool switch — a customer's ticket.
  "server/ai/supportAgent.ts": { floor: 30, passThrough: 0 },
  // The support and retention workers — their words become replies and emails.
  "server/services/solene/roleWorkers/tools.ts": { floor: 25, passThrough: 3 },
  // The founder's chat with Solene.
  "server/services/solene/chat/businessTools.ts": { floor: 12, passThrough: 0 },
  // Skip-trace results reach the person who asked for the lookup (W5a, 2026-10-11:
  // the owner opt-out refusals made it a member; its older "not configured"
  // refusals were rewritten in plain words rather than registered as debt).
  "server/services/skipTracingService.ts": { floor: 4, passThrough: 0 },
};

/** Files whose refusals no person reads, and why. */
const EXCLUDED: Record<string, string> = {
  "server/services/solene/dispatchToolExecutor.ts":
    "the code-dispatch runner's file and shell tools answer an engineering model; the founder reads the run's outcome through dispatchOutcomeInWords, which this file also gates",
};

/**
 * Raw refusals not yet in plain words — exact counts, and they may only SHRINK.
 * Each is a service whose result a caller turns into what a person sees;
 * converting one means building its refusals with toolRefusal/plainRefusal
 * and lowering (or deleting) its line here in the same commit.
 */
const UNCOVERED: Record<string, number> = {
  "server/services/agent-skills.ts": 68,
  "server/services/communications.ts": 19,
  "server/services/connectors/executor.ts": 14,
  "server/services/listingSyndication.ts": 11,
  "server/services/emailService.ts": 11,
  "server/services/smsService.ts": 8,
  "server/ai/vaService.ts": 6,
  "server/services/autopilot/hands/apply-refund.ts": 6,
  "server/services/etlOrchestrator.ts": 6,
  "server/services/integrationFrameworkV12.ts": 6,
  "server/services/agentOrchestration.ts": 5,
  "server/services/aiOfferService.ts": 5,
  "server/services/autopilot/hands/run-ad-campaign.ts": 5,
  "server/services/autopilot/hands/send-email.ts": 5,
  "server/services/autopilot/hands/send-sms.ts": 5,
  "server/services/browserAutomation.ts": 5,
  "server/services/executionEngine.ts": 5,
  "server/services/autopilot/hands/registry.ts": 4,
  "server/services/autopilot/hands/reply-support-ticket.ts": 4,
  "server/services/comps.ts": 4,
  "server/services/core-agents.ts": 4,
  "server/services/task-runner.ts": 4,
  "server/services/inboundEmailService.ts": 3,
  "server/services/orgEmailIdentity.ts": 3,
  "server/services/paxAskExecutors.ts": 3,
};

/** The register's total — it may only go down. */
const UNCOVERED_TOTAL_BASELINE = 219;

/** A file holding this many refusal objects is a dispatch surface and must be named above. */
const DISCOVERY_MIN = 3;

describe("the checker", () => {
  it("fails the raw refusals the adversarial run recorded (canaries)", () => {
    for (const raw of [
      '{"success":false,"error":"Lead 5 not found"}',
      "Lead not found",
      "terminated: empty_result — Nothing further to add.",
      "refund_purchase refused: $75.00 is over the $50.00 limit. Escalate this ticket to the founder.",
      "$2500 is over the $500 hard-stop — a budget that large is founder-only and un-delegable.",
      "Stripe sync failed: Error: Request was retried 3 times",
      "TCPA quiet hours: cannot contact before 8 AM or after 9 PM recipient local time (America/Denver).",
    ]) {
      expect(isPlainRefusal(refusalTextOf(raw)), raw).toBe(false);
    }
  });

  it("passes a refusal that says what, why and what unlocks it", () => {
    const t = plainRefusal({ what: "No lead with that number is in this account", why: "It may have been deleted", unlock: "Search your leads by name to find it" });
    expect(judgeRefusal(t)).toEqual({ plain: true, problems: [] });
    expect(isPlainRefusal(refusalTextOf(JSON.stringify(toolFailure("The page did not load"))))).toBe(true);
  });

  it("each rule is load-bearing: one defect per probe, each caught", () => {
    const good = "The email was not sent. This lead has no email address on file. Add their email on the lead's page.";
    expect(isPlainRefusal(good)).toBe(true);
    expect(isPlainRefusal(good.replace("This lead", "lead_id"))).toBe(false); // code identifier
    expect(isPlainRefusal(good.replace(" Add their email on the lead's page.", ""))).toBe(false); // no way forward
    expect(isPlainRefusal(good.replace("no email address", "a null email"))).toBe(false); // programming value
    expect(isPlainRefusal("Error: " + good)).toBe(false);
    expect(isPlainRefusal(good.replace("was not sent", "was terminated"))).toBe(false); // jargon
  });
});

describe("the population is enumerated, not remembered", () => {
  const discovered = new Map<string, number>();
  for (const f of listServerSources()) {
    const src = fs.readFileSync(f, "utf8");
    const n = countRefusalObjects(f, src);
    if (n >= DISCOVERY_MIN) discovered.set(rel(f), n);
  }

  it("discovery reads the server and finds the surfaces (floor)", () => {
    expect(discovered.size, [...discovered.keys()].join(", ")).toBeGreaterThanOrEqual(10);
  });

  it("every discovered refusal surface is covered, excluded with a reason, or registered with its count", () => {
    const named = new Set([...Object.keys(COVERED), ...Object.keys(EXCLUDED), ...Object.keys(UNCOVERED)]);
    const unnamed = [...discovered.keys()].filter((f) => !named.has(f));
    expect(unnamed, "a file returning refusals that nobody classified — add it to COVERED, EXCLUDED or UNCOVERED").toEqual([]);
  });

  it("every named member is still discovered (a vanished member means the reader stopped reading it)", () => {
    for (const f of [...Object.keys(COVERED), ...Object.keys(EXCLUDED), ...Object.keys(UNCOVERED)]) {
      expect(discovered.has(f), `${f} is named here but discovery no longer finds it`).toBe(true);
    }
  });

  it("the discovery predicate itself finds a refusal surface (canary)", () => {
    const fixture = [
      "export function a() { return { success: false, error: 'x' }; }",
      "export function b() { return { ok: false, text: `y` }; }",
      "export function c(r: any) { return { success: r.ok, output: r.why }; }",
      "export function d() { return { success: true, error: 'never counted' }; }",
    ].join("\n");
    expect(countRefusalObjects("fixture.ts", fixture)).toBe(3);
  });
});

describe.each(Object.entries(COVERED))("plain refusals: %s", (file, { floor, passThrough }) => {
  const scan = scanRefusals(file, read(file), OPTS);

  it("vacuity: the reader finds this file's refusals", () => {
    expect(scan.objects + scan.builderCalls, `only ${scan.objects} refusal objects and ${scan.builderCalls} builder calls read`).toBeGreaterThanOrEqual(floor);
    expect(scan.passThrough).toBe(passThrough);
  });

  it("has no raw, jargon or unreadable refusal", () => {
    expect(scan.violations).toEqual([]);
  });
});

describe("the raw-refusal register only shrinks", () => {
  it("the total is the baseline (lower it when a file is converted)", () => {
    expect(Object.values(UNCOVERED).reduce((a, b) => a + b, 0)).toBe(UNCOVERED_TOTAL_BASELINE);
  });
  it.each(Object.entries(UNCOVERED))("%s holds exactly its registered count", (file, count) => {
    const scan = scanRefusals(file, read(file), OPTS);
    // Exact, so a fix forces the line down in the same commit (CLAUDE.md:
    // "fix the occurrence, not the baseline").
    expect(scan.rawObjects, `${file}: lower UNCOVERED to the new count, or delete the line at 0`).toBe(count);
  });
});

describe("the gate catches each shape it exists for (canaries)", () => {
  const scan = (src: string) => scanRefusals("canary.ts", src, OPTS).violations;
  it("a bare not-found", () => expect(scan('function f() { return { success: false, error: "Lead not found" }; }')).toHaveLength(1));
  it("an exception's message", () => expect(scan("function f(err: Error) { return { success: false, error: `Failed: ${err.message}` }; }").length).toBeGreaterThan(0));
  it("a pass-through of someone else's error", () => expect(scan("function f(r: any) { return { success: r.success, error: r.error }; }")).toHaveLength(1));
  it("a builder fed a raw reason", () => expect(scan('function f(err: any) { return toolRefusal({ what: "The email was not sent", why: err.message, unlock: "Try again" }); }').length).toBeGreaterThan(0));
  it("a builder fed jargon", () => expect(scan('function f() { return { ok: false, text: plainRefusal({ what: "terminated", why: "empty_result", unlock: "dispatch again" }) }; }').length).toBeGreaterThan(0));
  it("a comment quoting a raw refusal is not code", () => expect(scan('// return { success: false, error: "Lead not found" }\nfunction f() { return 1; }')).toEqual([]));
  it("a clean refusal passes", () =>
    expect(scan('function f() { return toolRefusal({ what: "No lead with that number is in this account", why: "It may have been deleted", unlock: "Search your leads by name to find it" }); }')).toEqual([]));
});

describe("registered builders say plain words for every input", () => {
  it("the Pax pause refusals", () => {
    const until = new Date("2026-10-12T15:00:00Z");
    for (const t of [
      PAX_PAUSE_COPY.checkFailedRefusal,
      PAX_PAUSE_COPY.refusal({ until, byName: "Maria", timeZone: "America/Chicago" }),
      PAX_PAUSE_COPY.refusal({ until: null, byName: null, timeZone: "America/Chicago" }),
    ]) expect(judgeRefusal(t), t).toEqual({ plain: true, problems: [] });
  });
  it("the support scope refusals", () => {
    for (const t of [undeclaredSupportScopeMessage("apply_billing_fix"), supportScopeRefusalMessage("apply_billing_fix", "financial_write" as never)]) {
      expect(judgeRefusal(t), t).toEqual({ plain: true, problems: [] });
    }
  });
  it.each(["APPLY_CREDIT_REFUSAL", "VOID_INVOICE_REFUSAL"])("%s, read from its declaration", (constName) => {
    const sf = parseSource("supportAgent.ts", read("server/ai/supportAgent.ts"));
    let text: string | null = null;
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === constName && n.initializer) {
        const parts: string[] = [];
        const walk = (e: ts.Expression): void => {
          if (ts.isBinaryExpression(e)) { walk(e.left); walk(e.right); } else if (ts.isStringLiteral(e)) parts.push(e.text);
        };
        walk(n.initializer);
        text = parts.join("");
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(text, `${constName} not found`).not.toBeNull();
    expect(judgeRefusal(text!)).toEqual({ plain: true, problems: [] });
  });
});

describe("Story: a failed or cancelled run reads in plain words", () => {
  /** String-literal members of a union named by a type alias or a property signature. */
  function unionMembers(file: string, name: string): string[] {
    const sf = parseSource(file, read(file));
    const out: string[] = [];
    const take = (t: ts.TypeNode) => {
      if (ts.isUnionTypeNode(t)) for (const m of t.types) take(m);
      else if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) out.push(t.literal.text);
    };
    const visit = (n: ts.Node) => {
      if (ts.isTypeAliasDeclaration(n) && n.name.text === name) take(n.type);
      if (ts.isPropertySignature(n) && n.name && ts.isIdentifier(n.name) && n.name.text === name && n.type) take(n.type);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }
  const reasons = [
    ...unionMembers("server/services/solene/dispatchRunner.ts", "terminationReason"),
    ...unionMembers("server/services/solene/roleWorkers/runner.ts", "RoleTermination"),
  ];

  it("vacuity: both runners' termination unions are read", () => {
    expect(reasons).toContain("empty_result");
    expect(reasons).toContain("no_publishable_artifact");
    expect(new Set(reasons).size).toBeGreaterThanOrEqual(14);
  });

  it("every way a run can stop has its own plain words", () => {
    // A reason with no words of its own falls to the generic sentence.
    const generic = dispatchOutcomeInWords("failed", "terminated: not_a_real_reason — detail");
    const missing = [...new Set(reasons)].filter((r) => dispatchOutcomeInWords("failed", `terminated: ${r} — detail`) === generic);
    expect(missing, "add RUN_STOP_WORDS entries for these").toEqual([]);
  });

  it("every stored shape of a failed or cancelled run projects to plain words", () => {
    const shapes: Array<[string, string]> = [
      ["failed", "terminated: empty_result — Nothing further to add."],
      ["failed", "terminated: empty_result — empty_result: the retention worker ended without acting on any of the 4 waiting item(s) — \"Done.\""],
      ["failed", "[dead-letter] terminated: timeout — ran past 600000ms"],
      ["failed", "aborted in flight: panic stop"],
      ["failed", "reaped: orphaned in_progress past timeout (likely a worker crash mid-dispatch)"],
      ["cancelled", "cancelled by founder: not now"],
      ["cancelled", "cancelled: panic stop"],
      ["failed", "TypeError: Cannot read properties of undefined (reading 'x')"],
      ...reasons.map((r): [string, string] => ["failed", `terminated: ${r} — detail`]),
    ];
    for (const [status, summary] of shapes) {
      const shown = dispatchOutcomeInWords(status, summary);
      expect(shown, summary).not.toBeNull();
      expect(judgeRefusal(shown!), `${summary} → ${shown}`).toEqual({ plain: true, problems: [] });
    }
    expect(dispatchOutcomeInWords("completed", "done")).toBeNull();
  });

  it("the founder's surface serves the projection, and the world scorer judges it", () => {
    const sf = parseSource("routes-dispatch.ts", read("server/routes-dispatch.ts"));
    let adopted = false;
    const visit = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "outcomeInWords" && ts.isCallExpression(n.initializer) && n.initializer.expression.getText() === "dispatchOutcomeInWords") adopted = true;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(adopted, "GET /api/founder/dispatches must serve outcomeInWords: dispatchOutcomeInWords(…)").toBe(true);

    const world = parseSource("world.ts", read("tests/simulation/redteam/world.ts"));
    const calls = new Set<string>();
    const v2 = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) calls.add(n.expression.text);
      ts.forEachChild(n, v2);
    };
    v2(world);
    expect([...calls]).toEqual(expect.arrayContaining(["dispatchOutcomeInWords", "judgeRefusal", "refusalTextOf"]));
  });
});
