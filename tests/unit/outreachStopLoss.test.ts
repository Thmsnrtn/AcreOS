/**
 * outreachStopLoss.test.ts — the founder's monthly mail+data spend line
 * (founder decisions 2026-07-28, rulings #4 + #5).
 *
 * Locks in:
 *   1. The pure pause math:
 *        paused = mtd >= line AND (no ack for this month OR mtd >= ack + line)
 *      including the ack (resume) semantics: an "I've looked" resumes the
 *      month until spend crosses another FULL line past the acknowledgment,
 *      and an ack from a prior month is ignored (the line resets monthly).
 *   2. Fail-closed: an unreadable ledger (mtd null / non-finite) is ALWAYS
 *      paused, with the exact honest reason — never a fabricated zero.
 *   3. The $500/month default from the founder's ruling, and normalization
 *      of invalid line values back to it.
 *   4. Source shape: the two verified mail-dispatch chokepoints
 *      (mailFlusher.ts, directMail.ts) actually call the gate, the flusher
 *      gates BEFORE claiming (skipped ≠ dropped), and the pause pages the
 *      founder through the real pagerService at urgent.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  computeStopLossState,
  normalizeLineCents,
  currentMonthKey,
  DEFAULT_OUTREACH_STOPLOSS_MONTHLY_CENTS,
  LEDGER_UNREADABLE_REASON,
} from "../../server/services/outreachStopLoss";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONTH = "2026-07";
const LINE = 50_000; // $500 — the founder's ruling

describe("the founder's ruling — $500/month default", () => {
  it("defaults to 50_000 cents ($500/month, ruling #5)", () => {
    expect(DEFAULT_OUTREACH_STOPLOSS_MONTHLY_CENTS).toBe(50_000);
  });

  it("normalizeLineCents falls back to the default for invalid values", () => {
    expect(normalizeLineCents(NaN)).toBe(50_000);
    expect(normalizeLineCents(0)).toBe(50_000);
    expect(normalizeLineCents(-100)).toBe(50_000);
    expect(normalizeLineCents(Infinity)).toBe(50_000);
    expect(normalizeLineCents("not a number")).toBe(50_000);
    expect(normalizeLineCents(undefined)).toBe(50_000);
  });

  it("normalizeLineCents keeps a founder-raised line (floored to whole cents)", () => {
    expect(normalizeLineCents(120_000)).toBe(120_000);
    expect(normalizeLineCents(120_000.9)).toBe(120_000);
  });
});

describe("computeStopLossState — pause math without an ack", () => {
  it("runs while spend is under the line", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: 49_999,
      ack: null,
      monthKey: MONTH,
    });
    expect(s.paused).toBe(false);
    expect(s.effectiveThresholdCents).toBe(LINE);
  });

  it("pauses exactly AT the line (>=, not >)", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: 50_000,
      ack: null,
      monthKey: MONTH,
    });
    expect(s.paused).toBe(true);
    expect(s.reason).toContain("$500");
  });

  it("pauses past the line", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: 87_500,
      ack: null,
      monthKey: MONTH,
    });
    expect(s.paused).toBe(true);
  });

  it("zero spend runs", () => {
    expect(
      computeStopLossState({ lineCents: LINE, mtdSpendCents: 0, ack: null, monthKey: MONTH })
        .paused,
    ).toBe(false);
  });
});

describe("computeStopLossState — founder resume (ack) semantics", () => {
  it("an ack for this month resumes outreach past the line", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: 60_000,
      ack: { monthKey: MONTH, acknowledgedAtCents: 55_000 },
      monthKey: MONTH,
    });
    expect(s.paused).toBe(false);
    // Pauses again a FULL line past the acknowledgment.
    expect(s.effectiveThresholdCents).toBe(55_000 + LINE);
  });

  it("pauses AGAIN once spend crosses ack + line", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: 105_000, // = 55_000 + 50_000
      ack: { monthKey: MONTH, acknowledgedAtCents: 55_000 },
      monthKey: MONTH,
    });
    expect(s.paused).toBe(true);
  });

  it("an ack from a PRIOR month is ignored — the line resets monthly", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: 60_000,
      ack: { monthKey: "2026-06", acknowledgedAtCents: 55_000 },
      monthKey: MONTH,
    });
    expect(s.paused).toBe(true);
    expect(s.effectiveThresholdCents).toBe(LINE);
  });

  it("a malformed ack (non-finite / negative) is ignored, which can only pause sooner", () => {
    for (const bad of [NaN, Infinity, -1]) {
      const s = computeStopLossState({
        lineCents: LINE,
        mtdSpendCents: 60_000,
        ack: { monthKey: MONTH, acknowledgedAtCents: bad },
        monthKey: MONTH,
      });
      expect(s.paused).toBe(true);
    }
  });

  it("an ack never unpauses spend that is still under the base line (trivially running)", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: 10_000,
      ack: { monthKey: MONTH, acknowledgedAtCents: 5_000 },
      monthKey: MONTH,
    });
    expect(s.paused).toBe(false);
  });
});

describe("computeStopLossState — fail closed on an unreadable ledger", () => {
  it("mtd null → paused with the exact honest reason", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: null,
      ack: null,
      monthKey: MONTH,
    });
    expect(s.paused).toBe(true);
    expect(s.reason).toBe(LEDGER_UNREADABLE_REASON);
    expect(s.effectiveThresholdCents).toBeNull();
  });

  it("mtd non-finite → paused (never treated as zero)", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: NaN,
      ack: null,
      monthKey: MONTH,
    });
    expect(s.paused).toBe(true);
    expect(s.reason).toBe(LEDGER_UNREADABLE_REASON);
  });

  it("an ack cannot override an unreadable ledger — resuming blind is refused", () => {
    const s = computeStopLossState({
      lineCents: LINE,
      mtdSpendCents: null,
      ack: { monthKey: MONTH, acknowledgedAtCents: 55_000 },
      monthKey: MONTH,
    });
    expect(s.paused).toBe(true);
  });
});

describe("currentMonthKey", () => {
  it("is UTC YYYY-MM", () => {
    expect(currentMonthKey(new Date(Date.UTC(2026, 6, 28)))).toBe("2026-07");
    expect(currentMonthKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
  });
});

describe("source shape — the chokepoints are really gated", () => {
  const flusherSrc = readFileSync(
    resolve(__dirname, "../../server/services/mail/mailFlusher.ts"),
    "utf8",
  );
  const directMailSrc = readFileSync(
    resolve(__dirname, "../../server/services/directMail.ts"),
    "utf8",
  );
  const stopLossSrc = readFileSync(
    resolve(__dirname, "../../server/services/outreachStopLoss.ts"),
    "utf8",
  );

  it("mailFlusher checks the stop-loss BEFORE claiming shipments (skipped stays queued)", () => {
    expect(flusherSrc).toContain("getOutreachStopLossStatus");
    const gateIdx = flusherSrc.indexOf("getOutreachStopLossStatus");
    const claimIdx = flusherSrc.indexOf("UPDATE mail_shipments SET status = 'sending'");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(claimIdx);
    // Paused cycle sends nothing and pages the founder (marker-guarded).
    expect(flusherSrc).toContain("notifyOutreachPausedOnce");
  });

  it("directMail gates BOTH platform-credential send paths (postcard + letter)", () => {
    // REWRITTEN, not deleted (R-2 consolidation, 2026-08-11). This used to
    // require TWO `assertOutreachNotPaused(` call sites, one per send path.
    // R-2 moved credential resolution into a single `resolveSendCredential`
    // that both paths call, so there is now ONE gate covering both — strictly
    // better than two copies that could drift, and a count-based pin would
    // have read the improvement as a regression.
    //
    // The invariant is unchanged and is now checked by construction: every
    // send path obtains its credential through the resolver, and the resolver
    // gates a live platform key.
    for (const site of ["directMail.sendPostcard", "directMail.sendLetter"]) {
      expect(
        directMailSrc,
        `${site} must obtain its credential through resolveSendCredential`,
      ).toContain(`this.resolveSendCredential(orgId, mode, lane, '${site}')`);
    }

    // No send path may build a Lob client from a credential it resolved any
    // other way — that would route around the gate entirely.
    const lobClients = (directMailSrc.match(/new Lob\(\{ apiKey: credential\.apiKey \}\)/g) ?? []).length;
    const resolverCalls = (directMailSrc.match(/this\.resolveSendCredential\(/g) ?? []).length;
    expect(lobClients).toBeGreaterThanOrEqual(2);
    expect(resolverCalls).toBeGreaterThanOrEqual(lobClients);

    // And the resolver really gates — on the KEY IN HAND, not on a mode.
    const resolver = directMailSrc.slice(directMailSrc.indexOf("private async resolveSendCredential("));
    expect(resolver).toContain("if (!credential.isTestKey) {");
    expect(resolver).toContain("assertOutreachNotPaused(site)");
  });

  it("the pause pages the founder via the real pagerService at urgent, with plain words", () => {
    expect(stopLossSrc).toContain('await import("./solene/pagerService")');
    expect(stopLossSrc).toContain('severity: "urgent"');
    expect(stopLossSrc).toContain("Nothing sends until you tap resume in Costs.");
  });

  it("the line is read through founderSettings (founder-adjustable, never machine-set)", () => {
    expect(stopLossSrc).toContain('getNumberSetting');
    expect(stopLossSrc).toContain("OUTREACH_STOPLOSS_MONTHLY_CENTS");
  });
});
