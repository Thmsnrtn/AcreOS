/**
 * Giving (W5a, founder decision 2026-10-09) — the three rules in
 * shared/trust/giving.ts, each a consequential gate (spend authority, and what
 * a member is told was given). Mutation-checked 2026-10-11: dropping the cap
 * comparison, the founder check, the unset-cap refusal, or reading anything
 * but receipts into the member panel turns a test here red.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CENTS_PER_MEMBER_PER_MONTH,
  computeGivingPledge,
  evaluateGivingApproval,
  evaluateGivingReceipt,
  givingMonthFor,
  memberGivingPanel,
} from "../../shared/trust/giving";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// One test walks server/ for every caller of approveGivingMonth.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const bank = { id: 1, state: "TN", county: "Hamilton", name: "Chattanooga Area Food Bank" };

describe("1. count, never invent", () => {
  it("pledges $1 per paying member to the mapped food bank, by county", () => {
    const p = computeGivingPledge(
      [
        { organizationId: 1, area: { state: "TN", county: "Hamilton" } },
        { organizationId: 2, area: { state: "tn", county: "hamilton county" } },
        { organizationId: 3, area: { state: "TN", county: "Knox" } },
        { organizationId: 4, area: null },
      ],
      [bank],
    );
    expect(CENTS_PER_MEMBER_PER_MONTH).toBe(100);
    expect(p.payingMembers).toBe(4);
    expect(p.pledgeCents).toBe(200);
    expect(p.lines.find((l) => l.county === "Hamilton")).toMatchObject({ members: 2, cents: 200, foodBankId: 1 });
    expect(p.lines.find((l) => l.county === "Knox")).toMatchObject({ members: 1, cents: 0, foodBankId: null });
    expect(p.unmappedMembers).toBe(1);
    expect(p.membersWithoutCounty).toBe(1);
  });
  it("no members, no pledge — never a placeholder", () => {
    expect(computeGivingPledge([], [bank])).toMatchObject({ payingMembers: 0, pledgeCents: 0, lines: [] });
  });
  it("counts the previous calendar month", () => {
    expect(givingMonthFor(new Date("2026-10-02T07:00:00Z"))).toBe("2026-09");
    expect(givingMonthFor(new Date("2027-01-02T07:00:00Z"))).toBe("2026-12");
  });
});

describe("2. nothing moves without the founder, a cap, and an amount within it", () => {
  const base = { amountCents: 300, pledgeCents: 300, capCents: 1000 as number | null, approverIsFounder: true, monthStatus: "awaiting_founder" as const };
  it("the founder approves within the cap", () => {
    expect(evaluateGivingApproval(base)).toEqual({ ok: true });
  });
  it("no cap set ⇒ nothing can be approved", () => {
    const r = evaluateGivingApproval({ ...base, capCents: null });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toMatch(/Set a monthly giving cap first/);
  });
  it("over the cap ⇒ refused", () => {
    expect(evaluateGivingApproval({ ...base, capCents: 299 })).toMatchObject({ ok: false });
  });
  it("exactly the cap ⇒ allowed (the cap is inclusive)", () => {
    expect(evaluateGivingApproval({ ...base, capCents: 300 })).toEqual({ ok: true });
  });
  it("not the founder ⇒ refused, and over $500 it says it is a hard stop", () => {
    expect(evaluateGivingApproval({ ...base, approverIsFounder: false })).toMatchObject({ ok: false });
    const big = evaluateGivingApproval({ ...base, amountCents: 50_001, pledgeCents: 60_000, capCents: 100_000, approverIsFounder: false });
    expect(big.ok).toBe(false);
    expect(!big.ok && big.reason).toMatch(/\$500/);
  });
  it("cannot approve more than was pledged, a non-integer, or a decided month", () => {
    expect(evaluateGivingApproval({ ...base, amountCents: 301 })).toMatchObject({ ok: false });
    expect(evaluateGivingApproval({ ...base, amountCents: 1.5 })).toMatchObject({ ok: false });
    expect(evaluateGivingApproval({ ...base, monthStatus: "approved" as never })).toMatchObject({ ok: false });
  });
  it("the approval route takes the founder flag from requireFounder, never from the request body", () => {
    const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../../server/routes-giving.ts"), "utf8"));
    expect(src).toMatch(/approverIsFounder:\s*req\.isFounder === true/);
    expect(src).not.toMatch(/approverIsFounder:\s*(parsed|req\.body)/);
  });
  it("no scheduled job approves: the only caller of approveGivingMonth is the founder route", () => {
    const root = path.resolve(__dirname, "../../server");
    const callers: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && /approveGivingMonth\s*\(/.test(stripComments(fs.readFileSync(p, "utf8")))) callers.push(path.relative(root, p));
      }
    };
    walk(root);
    expect(callers.sort()).toEqual(["routes-giving.ts", "services/trust/givingService.ts"]);
  });
});

describe("3. only receipts are 'given'", () => {
  it("a receipt needs an approved month, a reference, and fits within the approval", () => {
    const ok = { amountCents: 200, monthStatus: "approved" as const, approvedCents: 300, alreadyReceiptedCents: 0, reference: "CONF-1" };
    expect(evaluateGivingReceipt(ok)).toEqual({ ok: true });
    expect(evaluateGivingReceipt({ ...ok, monthStatus: "awaiting_founder" })).toMatchObject({ ok: false });
    expect(evaluateGivingReceipt({ ...ok, reference: "  " })).toMatchObject({ ok: false });
    expect(evaluateGivingReceipt({ ...ok, alreadyReceiptedCents: 150 })).toMatchObject({ ok: false });
  });
  it("the member panel sums receipts only, and says 'nothing yet' without one", () => {
    expect(memberGivingPanel(bank, [])).toMatchObject({ state: "nothing_yet", givenCents: 0, asOf: null });
    expect(memberGivingPanel(null, [{ amountCents: 500, paidOn: "2026-10-01", reference: "R", receiptUrl: null }])).toMatchObject({ state: "nothing_yet", givenCents: 0 });
    const p = memberGivingPanel(bank, [
      { amountCents: 200, paidOn: "2026-09-03", reference: "R-1", receiptUrl: null },
      { amountCents: 300, paidOn: "2026-10-04", reference: "R-2", receiptUrl: "https://example.org/r2" },
    ]);
    expect(p).toMatchObject({ state: "given", givenCents: 500, asOf: "2026-10-04", receiptReference: "R-2", foodBankName: bank.name });
  });
  it("the member route and panel read no pledge or approval field (population: the member-facing files)", () => {
    const files = ["server/services/trust/givingService.ts#memberGivingPanelFor", "client/src/components/settings/MembershipGivingPanel.tsx"];
    for (const f of files) {
      const [file, fn] = f.split("#");
      let src = stripComments(fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"));
      if (fn) {
        const start = src.indexOf(`export async function ${fn}`);
        expect(start, `${fn} not found — the population moved`).toBeGreaterThan(0);
        src = src.slice(start, src.indexOf("\nexport ", start + 10));
      }
      expect(src.length, `${file} read as empty`).toBeGreaterThan(300);
      for (const forbidden of ["pledgeCents", "approvedCents", "givingMonths", "lines"]) {
        expect(src.includes(forbidden), `${file} reads ${forbidden}`).toBe(false);
      }
    }
  });
});
