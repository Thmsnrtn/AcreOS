/**
 * "Opted out" is one rule — doNotContact OR optOutDate — read through
 * server/services/leadContactability.ts by every outreach path.
 *
 * The revocation paths set BOTH flags; an edit can clear `doNotContact` and
 * leave `optOutDate`. The TCPA consent check that every sequence, workflow,
 * communications send and Pax send used read `doNotContact` alone, as did the
 * email campaign audience, the Today/Pax follow-up suggestions and the
 * autopilot SMS hand — so a lead with an opt-out on file was contactable.
 *
 * Three layers:
 *   1. behaviour: the consent check refuses a lead whose only opt-out is the date;
 *   2. the enumerated outreach paths each route through the helper (per-member
 *      vacuity, so a path that stops calling it is named);
 *   3. population: a raw `doNotContact` predicate ANYWHERE in server/ fails,
 *      except the allowlisted non-predicates below — so a new outreach path
 *      that bypasses the helper is caught without being listed first.
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

describe("the consent check reads the whole opt-out rule", () => {
  it("a lead whose only opt-out is optOutDate is blocked on every channel", async () => {
    const { checkTcpaConsentFromLead, canSendViaChannel } = await import("../../server/services/tcpaCompliance");
    const lead = { tcpaConsent: true, doNotContact: false, optOutDate: new Date("2026-09-01T00:00:00Z") };
    expect(checkTcpaConsentFromLead(lead).blocked).toBe(true);
    for (const ch of ["email", "sms", "phone", "direct_mail"] as const) {
      expect(canSendViaChannel(lead, ch).allowed, ch).toBe(false);
    }
    // CONTROL: the same lead without the date is contactable.
    expect(checkTcpaConsentFromLead({ ...lead, optOutDate: null }).blocked).toBe(false);
  });
});

/** Outreach paths and the helper each must call. */
const OUTREACH_PATHS: Array<[file: string, mustCall: RegExp]> = [
  ["server/services/tcpaCompliance.ts", /leadHasOptedOut\(/],
  ["server/services/sequenceProcessor.ts", /checkTcpaConsentFromLead\(|canSendViaChannel\(/],
  ["server/ai/tools.ts", /checkTcpaConsentFromLead\(/],
  ["server/services/workflow-engine.ts", /canSendViaChannel\(/],
  ["server/services/communications.ts", /checkTcpaConsentFromLead\(/],
  // Email and SMS audiences both go through canSendViaChannel (→
  // checkTcpaConsentFromLead → leadHasOptedOut) since the merge with the
  // cost-efficiency stack, whose email audience reports per-bucket skips.
  ["server/routes-campaigns.ts", /leadHasOptedOut\(|canSendViaChannel\(lead, "email"\)/],
  ["server/routes-outreach-mail.ts", /leadNotOptedOutSql\(/],
  ["server/services/mail/mailFlusher.ts", /leadNotOptedOutSql\(/],
  ["server/services/preMailDedupe.ts", /leadHasOptedOut\(/],
  ["server/services/autonomyGuardrails.ts", /leadHasOptedOut\(/],
  ["server/services/smsService.ts", /leadHasOptedOut\(/],
  ["server/services/autopilot/hands/send-sms.ts", /leadHasOptedOut\(/],
  ["server/routes-today.ts", /leadHasOptedOut\(/],
  ["server/routes-pax-insights.ts", /leadHasOptedOut\(/],
  ["server/routes-dashboard.ts", /leadHasOptedOut\(/],
];

describe("every enumerated outreach path routes through the helper", () => {
  it.each(OUTREACH_PATHS)("%s", (file, mustCall) => {
    const src = stripComments(readFileSync(join(process.cwd(), file), "utf8"));
    expect(src, `${file} no longer calls the shared opt-out rule`).toMatch(mustCall);
  });

  it("the campaign SMS audience uses the (now complete) channel check", () => {
    const src = stripComments(readFileSync(join(process.cwd(), "server/routes-campaigns.ts"), "utf8"));
    expect(src).toMatch(/canSendViaChannel\(l!, "sms"\)/);
  });

  it("the partial lead the Pax send tools build carries optOutDate", () => {
    const src = stripComments(readFileSync(join(process.cwd(), "server/ai/tools.ts"), "utf8"));
    expect([...src.matchAll(/leadForCompliance = \{[^}]*optOutDate: lead\.optOutDate[^}]*\}/g)].length).toBe(2);
  });
});

/** A read of doNotContact used as a CONDITION. */
const RAW_PREDICATES = [
  /if\s*\([^)\n]*\.doNotContact\b/,
  /!\s*[\w.?]+\.doNotContact\b/,
  /\.doNotContact\b\s*(===|!==|==|!=|&&|\|\||\?(?![.?]))/,
  /\$\{\s*\w+\.doNotContact\s*\}\s*IS\b/,
  /eq\(\s*\w+\.doNotContact\s*,/,
  /\.(find|filter|some|every)\(\s*\(?\w+\)?\s*=>\s*!?\s*\w+\.doNotContact\b/,
];
/** Exact lines whose match is NOT an outreach decision, with why. Keyed by line, not file, so the rest of each file stays in the population. */
const NOT_PREDICATES: Array<{ file: string; line: string; why: string }> = [
  {
    file: "server/routes-leads.ts",
    line: "if (updates.doNotContact === false || updates.optOutDate === null || updates.optOutReason === null) {",
    why: "bulkConsentRefusal (cost-efficiency stack): refuses a bulk EDIT that would lift an opt-out; it reads the patch, not a lead, and decides no contact",
  },
  {
    file: "server/services/leadContactability.ts",
    line: "return lead.doNotContact === true || (lead.optOutDate !== null && lead.optOutDate !== undefined);",
    why: "the rule itself",
  },
  {
    file: "server/services/leadContactability.ts",
    line: "return sql`(${leads.doNotContact} IS NOT TRUE AND ${leads.optOutDate} IS NULL)`;",
    why: "the rule itself, as SQL",
  },
  {
    file: "server/services/autonomyGuardrails.ts",
    line: 'reason: lead.doNotContact ? "Lead is marked do-not-contact" : "Lead has opted out of communications",',
    why: "chooses the refusal WORDING after leadHasOptedOut has already refused",
  },
  {
    file: "server/storage/leadRepo.ts",
    line: "if (primary.doNotContact === true || duplicate.doNotContact === true) mergedData.doNotContact = true;",
    why: "mergeLeads carries the flag across a merge (inside a leadHasOptedOut branch); it decides no contact",
  },
];

describe("no raw doNotContact predicate outside the helper", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(join(process.cwd(), "server"));

  it("VACUITY: server/ was read, and the matcher sees the shapes it forbids", () => {
    expect(files.length).toBeGreaterThanOrEqual(1000);
    for (const src of [
      "if (lead.doNotContact) return;",
      "const ok = !lead.doNotContact;",
      "lead.doNotContact === true || x",
      "sql`${leads.doNotContact} IS NOT TRUE`",
      "eq(leads.doNotContact, true)",
      "rows.filter((l) => !l.doNotContact)",
    ]) {
      expect(RAW_PREDICATES.some((re) => re.test(src)), src).toBe(true);
    }
    for (const ok of ["do_not_contact: lead.doNotContact ?? false,", "doNotContact: leads.doNotContact,", ".set({ doNotContact: true })"]) {
      expect(RAW_PREDICATES.some((re) => re.test(ok)), ok).toBe(false);
    }
  });

  it("every match is allowlisted", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(process.cwd(), f);
      stripComments(readFileSync(f, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (!RAW_PREDICATES.some((re) => re.test(line))) return;
          if (NOT_PREDICATES.some((n) => n.file === rel && n.line === line.trim())) return;
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders, "read opt-out through leadHasOptedOut / leadNotOptedOutSql").toEqual([]);
  });

  it("the allowlist is not stale", () => {
    for (const n of NOT_PREDICATES) {
      const src = stripComments(readFileSync(join(process.cwd(), n.file), "utf8"));
      expect(src.split("\n").some((l) => l.trim() === n.line), `${n.file}: allowlisted line is gone — remove its entry`).toBe(true);
    }
  });
});
