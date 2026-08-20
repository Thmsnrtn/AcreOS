/**
 * A Pax tool may not report an effect it did not have.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `schedule_background_job` advertised an enum of four job types —
 * `bulk_property_import`, `bulk_lead_import`, `campaign_send`,
 * `report_generation` — and its entire implementation was:
 *
 *     logger.info(`[AI Tools] Background job scheduled: …`);
 *     return { success: true, data: { …, status: "queued" } };
 *
 * A user who asked Pax to run the overnight campaign send was told it was
 * queued. Nothing was queued; none of those four job types exists anywhere in
 * `server/jobs` or the outbox. Deleted 2026-08-19 rather than wired, because
 * wiring it means BUILDING four job types and the defect is that it claimed to
 * already have them.
 *
 * ── WHY A SCAN AND NOT A CASE PER TOOL ──────────────────────────────────────
 * A test naming `schedule_background_job` proves that one symbol is gone and
 * says nothing about the next handler someone writes the same way. This governs
 * the SHAPE: a switch case that returns `success: true` while calling nothing
 * that can have the effect its return value describes.
 *
 * ── WHAT THE FIRST VERSION OF THIS FILE GOT WRONG ───────────────────────────
 * It shipped 2026-08-19 governing one file with one predicate, and was wrong on
 * both counts within a day:
 *
 *   SCOPE.  It read `server/ai/tools.ts` and nothing else. `executeSupportTool`
 *   in `server/ai/supportAgent.ts` — 76 more cases, dispatched by a model
 *   talking to a paying customer — was never scanned, and held two handlers of
 *   the identical shape (`create_followup_task`, `clear_org_cache`).
 *
 *   PREDICATE.  It asked whether the body awaited ANYTHING. Four support tools
 *   awaited an `activity_log` insert and then reported a system effect they had
 *   not had: sessions invalidated, tokens refreshed, caches resynced. The audit
 *   row is what makes that shape dangerous rather than obvious — it looks like
 *   I/O to a skimming reader and satisfies `\bawait\b` outright.
 *
 * Both corrections landed 2026-08-20. The lesson generalises past this file: a
 * gate proves the property it MEASURES over the population it READS, and both
 * halves are assumptions until something falsifies them. So the falsification
 * block below mutates in the real defect — the code as it actually shipped, not
 * a synthetic stand-in — and asserts the gate fires; the audit-row case is
 * there precisely because the previous predicate was green on it.
 *
 * ── THE REGISTERS ───────────────────────────────────────────────────────────
 * Two, kept separate because they make different claims. PURE_COMPUTATION says
 * the handler is arithmetic on its own arguments; STATIC_CONTENT says it
 * returns authored constant guidance. Each claim is checkable by reading the
 * handler, and neither excuses a handler that reports on the account.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Every dispatch switch that answers a model's tool call.
 *
 * `server/ai/supportAgent.ts` was added 2026-08-20. This file governed only
 * `tools.ts` for its first day and `executeSupportTool` — 76 further cases,
 * addressed by a model talking to a paying customer — was never scanned. It
 * held two handlers of the exact `schedule_background_job` shape:
 * `create_followup_task` returned `taskCreated: true` and created no task, and
 * `clear_org_cache` reported "Successfully cleared 3 cache(s)" having pushed
 * three string literals into a local array. A rule installed on one file is a
 * rule about that file, not about the defect.
 */
const TOOL_SWITCHES = [
  "server/ai/tools.ts",
  "server/ai/supportAgent.ts",
] as const;

/**
 * Handlers that legitimately return `success: true` having touched nothing:
 * they compute from their arguments and return the number. Each is arithmetic
 * with no I/O by nature, not a stub waiting to be wired.
 */
const PURE_COMPUTATION: Record<string, string> = {
  calculate_amortization:
    "Amortisation schedule from principal/rate/term. No source of truth to read.",
  calculate_roi:
    "ROI from the figures the caller passes. Reading a deal would be a different tool.",
  calculate_payment_schedule:
    "Payment schedule from the loan terms in the args, same shape as amortisation.",
  analyze_user_sentiment:
    "Keyword/punctuation scoring over the message strings in the args. Advises the " +
    "agent on tone; asserts nothing about the account.",
  estimate_resolution_confidence:
    "Additive score over the issue category and the context list in the args. " +
    "Advises the agent whether to escalate; asserts nothing about the account.",
};

/**
 * Handlers that return curated CONSTANT content — a tutorial, a walkthrough, a
 * troubleshooting playbook — selected by a key in the args.
 *
 * Distinct from PURE_COMPUTATION and kept separate because the claim being made
 * is different, and each claim should be checkable on its own terms. Here the
 * claim is: the return value is authored guidance, not a report about the
 * customer's account, so `success: true` means "here is the guidance" and can
 * be honest without touching anything. Adding a name here is a claim that the
 * handler reads no source of truth and reports no effect.
 */
const STATIC_CONTENT: Record<string, string> = {
  generate_tutorial: "Static tutorial map keyed by `topic`. Authored steps, no account read.",
  get_feature_walkthrough: "Static walkthrough map keyed by feature. Same shape as above.",
  get_contextual_suggestions: "Static suggestion map keyed by the current page/context.",
  get_troubleshooting_steps: "Static playbook map keyed by issue category.",
};

const EXEMPT: Record<string, string> = { ...PURE_COMPUTATION, ...STATIC_CONTENT };

/**
 * Anything that reaches outside this function.
 *
 * `await` is the load-bearing half and the reason this rule is cheap: every
 * handler that reads or writes anything in this codebase awaits something —
 * storage, the db, a service, a dynamic import, a fetch. A case that returns
 * `success: true` having awaited nothing has, by construction, done nothing
 * beyond arithmetic on its own arguments. The explicit patterns cover the
 * synchronous shapes as well, so a future non-async effect is still seen.
 */
const EFFECTFUL = /\bawait\b|storage\.|\bdb\.|\bfetch\(/;

/**
 * A WRITE to the audit trail. Not the effect — the record that the agent meant
 * to have one.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `await` alone was too weak, and the tools that proved it were live for a day.
 * `invalidate_user_sessions` in `supportAgent.ts` was:
 *
 *     await db.insert(activityLog).values({ action: "support_invalidate_sessions", … });
 *     return { success: true, data: { sessionsInvalidated: true,
 *              message: "The user will need to log in again." } };
 *
 * It touched no session store. `refresh_auth_tokens` and `trigger_data_resync`
 * were the same shape — the latter pushed INVENTED cache names into a local
 * array first. All three satisfied `\bawait\b`, so the gate that existed to
 * catch exactly this passed them. The audit row is what makes the shape
 * dangerous rather than obvious: it looks like I/O, so the handler reads as
 * wired to anyone skimming, and to any regex that only asks whether something
 * was awaited.
 *
 * Only writes are discounted. `db.select().from(activityLog)` is a genuine read
 * whose rows ARE the answer a support tool returns, so a handler doing that has
 * had a real effect for this rule's purpose and must not be flagged.
 */
const AUDIT_WRITE =
  /(?:insert|update)\s*\(\s*(?:activityLog|auditLog|billingAuditLog)\b|\blogActivity\s*\(|\bcreateActivityLog\s*\(/;

/**
 * The statements in `body` that reach outside the function, one entry per
 * statement rather than per token, so a write split across lines is judged
 * whole. Matching per LINE would let `await db\n  .insert(activityLog)` read as
 * a real effect because line one never mentions the table.
 */
function effectStatements(body: string): string[] {
  const out: string[] = [];
  const re = new RegExp(EFFECTFUL.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let start = m.index;
    while (start > 0 && !";{}".includes(body[start - 1])) start -= 1;
    let end = body.indexOf(";", m.index);
    if (end === -1) end = body.length - 1;
    out.push(body.slice(start, end + 1));
    re.lastIndex = end; // one site per statement
  }
  return out;
}

/** True when at least one thing the handler reached for was not an audit row. */
function hasRealEffect(body: string): boolean {
  return effectStatements(body).some((s) => !AUDIT_WRITE.test(s));
}

/** `case "name": { … }` bodies from a tool-dispatch switch. */
function switchCases(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /\n {6}case "([a-z_0-9]+)": \{\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
      i += 1;
    }
    out.push({ name: m[1], body: src.slice(m.index + m[0].length, i) });
  }
  return out;
}

function claimsSuccessWithoutEffect(src: string): string[] {
  return switchCases(src)
    .filter((c) => /success:\s*true/.test(c.body))
    .filter((c) => !hasRealEffect(c.body))
    .map((c) => c.name)
    .filter((n) => !(n in EXEMPT));
}

const source = (rel: string) =>
  stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** Cases across every dispatch switch, so the registers can be checked once. */
function allCaseNames(): Set<string> {
  const names = new Set<string>();
  for (const rel of TOOL_SWITCHES) for (const c of switchCases(source(rel))) names.add(c.name);
  return names;
}

describe.each(TOOL_SWITCHES)("no tool reports success without doing anything: %s", (rel) => {
  it("vacuity: the switch is found and parses", () => {
    // Every assertion below is an absence check over `switchCases`. If the regex
    // stops matching — a reformat, a refactor of the dispatch — the offender
    // list is empty and this file certifies a file it never parsed.
    const cases = switchCases(source(rel));
    expect(cases.length, `only ${cases.length} tool cases parsed out of ${rel}`).toBeGreaterThan(50);

    const names = new Set(cases.map((c) => c.name));
    const expected: Record<string, string[]> = {
      "server/ai/tools.ts": ["get_leads", "create_lead", "send_email", "calculate_roi"],
      "server/ai/supportAgent.ts": [
        "search_knowledge_base",
        "fix_common_issue",
        "get_account_summary",
        "escalate_to_human",
      ],
    };
    for (const known of expected[rel]) {
      expect(names.has(known), `the switch parser lost "${known}" in ${rel}`).toBe(true);
    }

    // And the predicate must still be discriminating on this file: if
    // `hasRealEffect` were vacuously true, no offender could ever surface.
    const withEffect = cases.filter((c) => hasRealEffect(c.body));
    expect(withEffect.length, `no handler in ${rel} registers a real effect`).toBeGreaterThan(10);
  });

  it("finds no handler claiming an effect it did not have", () => {
    expect(
      claimsSuccessWithoutEffect(source(rel)),
      `${rel}: this handler returns success: true without doing anything that can ` +
        "have the effect its return value describes. Writing an activity_log row " +
        "does NOT count — that records the intent, not the outcome. Either make it " +
        "do the thing, or make it refuse: a tool that reports " +
        '`sessionsInvalidated: true` and invalidates nothing is worse than one that ' +
        "does not exist. If it is genuinely pure arithmetic on its args, add it to " +
        "PURE_COMPUTATION; if it returns authored constant guidance, add it to " +
        "STATIC_CONTENT. Either way, with the reason.",
    ).toEqual([]);
  });
});

describe("the registers describe tools that exist", () => {
  it("every exempted name is a real case in some dispatch switch", () => {
    const names = allCaseNames();
    expect(names.size, "no cases parsed from any switch").toBeGreaterThan(100);
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(names.has(name), `exempted "${name}" (${reason}) is not a tool`).toBe(true);
    }
  });
});

describe("the rule is falsifiable", () => {
  it("FIRES on the handler that was deleted from tools.ts", () => {
    // The original, restored into a copy of the source. Not a synthetic shape —
    // this is the code that shipped.
    const src = source("server/ai/tools.ts");
    const mutated = src.replace(
      '      case "extract_properties_from_text": {',
      '      case "schedule_background_job": {\n' +
        "        logger.info(`[AI Tools] Background job scheduled: ${args.job_type}`);\n" +
        '        return { success: true, data: { jobType: args.job_type, status: "queued" } };\n' +
        "      }\n\n" +
        '      case "extract_properties_from_text": {',
    );
    expect(mutated, "the mutation did not apply — re-anchor it").not.toBe(src);
    expect(claimsSuccessWithoutEffect(mutated)).toContain("schedule_background_job");
  });

  it("FIRES on a handler whose only effect is an audit row", () => {
    // `invalidate_user_sessions` as it actually shipped in supportAgent.ts.
    // This is the mutation that matters: it passed the previous predicate,
    // because it awaits. The claim in its return value — the user is logged
    // out — is not something any part of this body does.
    const src = source("server/ai/supportAgent.ts");
    const mutated = src.replace(
      '      case "get_account_summary": {',
      '      case "invalidate_user_sessions": {\n' +
        "        await db.insert(activityLog).values({\n" +
        "          organizationId: org.id,\n" +
        '          action: "support_invalidate_sessions",\n' +
        '          entityType: "organization",\n' +
        "          entityId: org.id,\n" +
        '          description: "Support agent invalidated user sessions",\n' +
        "        });\n" +
        "        return {\n" +
        "          success: true,\n" +
        "          data: {\n" +
        "            sessionsInvalidated: true,\n" +
        '            message: "The user will need to log in again.",\n' +
        "          },\n" +
        "        };\n" +
        "      }\n\n" +
        '      case "get_account_summary": {',
    );
    expect(mutated, "the mutation did not apply — re-anchor it").not.toBe(src);
    expect(claimsSuccessWithoutEffect(mutated)).toContain("invalidate_user_sessions");
  });

  it("does NOT fire on a handler that writes through storage", () => {
    // The negative control. A rule that flagged real handlers would be turned
    // off within a week.
    const src = source("server/ai/tools.ts");
    const mutated = src.replace(
      '      case "extract_properties_from_text": {',
      '      case "__probe_real_write__": {\n' +
        "        await storage.createLead({ organizationId: org.id });\n" +
        "        return { success: true, data: { created: true } };\n" +
        "      }\n\n" +
        '      case "extract_properties_from_text": {',
    );
    expect(mutated).not.toBe(src);
    expect(claimsSuccessWithoutEffect(mutated)).toEqual([]);
  });

  it("does NOT fire on a handler that audits AND does the thing", () => {
    // The other half of the negative control, and the reason `hasRealEffect`
    // asks whether ANY site is non-audit rather than whether the FIRST is:
    // real handlers routinely write the row and then do the work.
    const src = source("server/ai/supportAgent.ts");
    const mutated = src.replace(
      '      case "get_account_summary": {',
      '      case "__probe_audit_then_write__": {\n' +
        '        await db.insert(activityLog).values({ organizationId: org.id, action: "x" });\n' +
        "        await db.update(organizations).set({ onboardingStep: 0 })\n" +
        "          .where(eq(organizations.id, org.id));\n" +
        "        return { success: true, data: { applied: true } };\n" +
        "      }\n\n" +
        '      case "get_account_summary": {',
    );
    expect(mutated).not.toBe(src);
    expect(claimsSuccessWithoutEffect(mutated)).toEqual([]);
  });

  it("does NOT fire on a handler that READS the audit trail", () => {
    // `db.select().from(activityLog)` is a real read whose rows are the answer.
    // Discounting it would flag every activity-history tool in the file.
    const src = source("server/ai/supportAgent.ts");
    const mutated = src.replace(
      '      case "get_account_summary": {',
      '      case "__probe_audit_read__": {\n' +
        "        const rows = await db.select().from(activityLog)\n" +
        "          .where(eq(activityLog.organizationId, org.id));\n" +
        "        return { success: true, data: { rows } };\n" +
        "      }\n\n" +
        '      case "get_account_summary": {',
    );
    expect(mutated).not.toBe(src);
    expect(claimsSuccessWithoutEffect(mutated)).toEqual([]);
  });
});

describe("deleted tools are gone from every register that named them", () => {
  it("leaves no definition, intent or dispatch entry behind", () => {
    // Deleting a tool definition and leaving its intent-registry entry behind
    // is this repository's most common residue; the entry would keep declaring
    // a door and a scope for something that cannot be called.
    const files = [
      "server/ai/tools.ts",
      "server/ai/supportAgent.ts",
      "server/services/appIntents/intentScopes.ts",
    ];
    const deleted = [
      "schedule_background_job",
      "invalidate_user_sessions",
      "refresh_auth_tokens",
      "trigger_data_resync",
      "clear_org_cache",
    ];
    for (const rel of files) {
      // Comments are stripped, so the tombstones that explain each deletion do
      // not count as references.
      const src = source(rel);
      for (const name of deleted) {
        expect(src, `${rel} still references ${name}`).not.toContain(name);
      }
    }
  });

  it("advertises no check_data_integrity module the handler does not query", () => {
    // The same defect in the same file: the enum listed `notes` and `campaigns`
    // and the handler queried neither, so asking about either returned
    // `issuesFound: 0` — which reads as "checked, all clean" rather than "not
    // checked". The handler then reported `notes` in its `modulesChecked` list.
    //
    // Scoped deliberately to the two DISPATCH-KEY enums in this file rather
    // than generalised to every enum. A survey of all enum-valued tool args
    // across both switches found the rest are pass-through — the handler hands
    // the value to a service (`getServiceStatus(service)`) or writes it to a
    // column — where naming each value in the body would be the anomaly, not
    // the requirement. A general rule here would be almost entirely false
    // positives, and a gate that cries wolf gets deleted.
    const src = source("server/ai/supportAgent.ts");
    const enumBlock = /enum: \[([^\]]*?)\],\s*description: "Which module to check"/.exec(src);
    expect(enumBlock, "the check_data_integrity enum moved — re-anchor this").not.toBeNull();
    const advertised = [...enumBlock![1].matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1])
      .filter((v) => v !== "all");
    expect(advertised.length, "no modules parsed out of the enum").toBeGreaterThan(0);

    const handler = switchCases(src).find((c) => c.name === "check_data_integrity");
    expect(handler, "check_data_integrity is not in the dispatch switch").toBeDefined();

    expect(
      advertised.filter((m) => !handler!.body.includes(`module === "${m}"`)),
      "check_data_integrity advertises these modules to the model and queries none of them",
    ).toEqual([]);

    // And the reported coverage must match what it actually checked.
    const reported = /modulesChecked: module === "all" \? \[([^\]]*)\]/.exec(handler!.body);
    expect(reported, "modulesChecked moved — re-anchor this").not.toBeNull();
    const claimed = [...reported![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(claimed.sort()).toEqual([...advertised].sort());
  });

  it("advertises no fix_common_issue type the handler cannot perform", () => {
    // The enum listed eight; five had no case at all and fell through to "not
    // yet implemented" — so the model offered a customer five repairs that
    // could only fail. The enum is a promise to the model, same as a return
    // value is a promise to the user.
    const src = source("server/ai/supportAgent.ts");
    const enumBlock = /enum: \[([^\]]*?)\],\s*description: "The type of issue to fix"/.exec(src);
    expect(enumBlock, "the fix_common_issue enum moved — re-anchor this").not.toBeNull();
    const advertised = [...enumBlock![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(advertised.length, "no fix types parsed out of the enum").toBeGreaterThan(0);

    const handler = switchCases(src).find((c) => c.name === "fix_common_issue");
    expect(handler, "fix_common_issue is not in the dispatch switch").toBeDefined();
    const implemented = [...handler!.body.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);

    expect(
      advertised.filter((a) => !implemented.includes(a)),
      "fix_common_issue advertises these to the model and has no case for them",
    ).toEqual([]);
  });
});
