/**
 * An organization parameter that is OPTIONAL is an organization parameter that
 * gets dropped.
 *
 * ── WHAT THE 2026-08-20 RULE-2 AUDIT FOUND ──────────────────────────────────
 * 140 register entries were adjudicated; six units were confirmed live
 * cross-tenant paths after two independent refutation attempts each. Five of the
 * six were the SAME SHAPE, and it is a shape a query-level gate cannot see:
 *
 *     export async function calibrateSellerIntent(orgId?: number) { … }
 *
 * The org arrives. The signature says it may be absent. The body never mentions
 * it again. Every caller in production passed `org.id` — the value was there the
 * whole time, and the function simply did not use it, because nothing made it.
 *
 * `GET /api/ml/calibration-report` is `isAuthenticated, getOrCreateOrg` only, so
 * any authenticated tenant user received a "calibration report" computed over
 * EVERY tenant's seller-intent predictions, leads, deals and opportunity scores,
 * labelled as their own. That is a cross-tenant disclosure and a fabrication at
 * once: the numbers are presented as the org's and are not.
 *
 * ── WHY THIS FILE EXISTS ALONGSIDE THE GATE ─────────────────────────────────
 * `check-org-scoped-fetch` now enforces the QUERIES: those units came out of its
 * registers in the commit that fixed them, so a regression is a new offender and
 * the gate fails. What the gate cannot see is the SIGNATURE. A future edit that
 * re-marks `orgId` optional would pass every query check on the day it landed
 * and re-open the hole the first time someone called it without an argument.
 *
 * So this pins the parameter shape, and the route guard the audit found missing.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) =>
  stripCommentsPreservingLines(readFileSync(resolve(ROOT, rel), "utf8"));

/**
 * Every calibration entry point reachable from `/api/ml/calibration-report`.
 * All five took `orgId?: number` and used it in none of their bodies.
 */
const CALIBRATION_FNS = [
  "runFullCalibration",
  "computeConfidenceIntervals",
  "runBacktestAccuracy",
  "calibrateSellerIntent",
  "calibrateRadar",
];

describe("vacuity — the units this file is about still exist", () => {
  it("finds the calibration module and every function named", () => {
    const src = read("server/services/outcomeCalibrationLoop.ts");
    expect(src.length, "the calibration module is empty or gone").toBeGreaterThan(2000);
    for (const fn of CALIBRATION_FNS) {
      expect(src, `${fn} was renamed or removed — re-derive this list`).toContain(
        `export async function ${fn}(`,
      );
    }
  });
});

describe("the org parameter is REQUIRED, so it cannot be silently absent", () => {
  it("no calibration entry point takes an optional orgId", () => {
    const src = read("server/services/outcomeCalibrationLoop.ts");
    for (const fn of CALIBRATION_FNS) {
      const at = src.indexOf(`export async function ${fn}(`);
      const sig = src.slice(at, src.indexOf(")", at) + 1);
      expect(
        sig,
        `${fn} takes an OPTIONAL org again. Every production caller passes one; ` +
          `making it optional is what let the whole module scan platform-wide ` +
          `while its route was reachable by any authenticated tenant user.`,
      ).not.toMatch(/orgId\s*\?\s*:/);
      expect(sig, `${fn} no longer takes an org at all`).toContain("orgId");
    }
  });

  it("each calibration body actually USES the org it demands", () => {
    // The signature alone proves nothing: `orgId: number` with a body that
    // ignores it is the same defect wearing a stricter type. This is the
    // assertion that would have failed before the fix.
    const src = read("server/services/outcomeCalibrationLoop.ts");
    for (const fn of CALIBRATION_FNS.filter((f) => f !== "runFullCalibration")) {
      const at = src.indexOf(`export async function ${fn}(`);
      const next = CALIBRATION_FNS.map((o) => src.indexOf(`export async function ${o}(`))
        .filter((i) => i > at)
        .sort((a, b) => a - b)[0];
      const body = src.slice(at, next === undefined ? src.length : next);
      const uses = body.split("orgId").length - 1;
      expect(
        uses,
        `${fn} names orgId ${uses} time(s) — only the signature. That is exactly ` +
          `the state the audit found: the org supplied, accepted, and discarded.`,
      ).toBeGreaterThan(1);
    }
  });

  it("the Pax learning entry point takes the org before the id", () => {
    const src = read("server/services/paxLearning.ts");
    const at = src.indexOf("async learnFromHumanResolution(");
    expect(at, "learnFromHumanResolution was renamed or removed").toBeGreaterThan(-1);
    const sig = src.slice(at, src.indexOf(")", at) + 1);
    expect(
      sig,
      "learnFromHumanResolution takes only a ticketId again. It reads a support " +
        "ticket and files an LLM distillation of it into Pax's learning corpus " +
        "attributed to whatever org that unverified row names.",
    ).toContain("organizationId");
  });
});

describe("the route guard the audit found missing", () => {
  // `POST /api/support/tickets/:id/resolve-human` read the ticket by bare id and
  // went straight to `if (!ticket) notFound`. Its four siblings in the same file
  // all compare `ticket.organizationId` to `org.id` first. One handler out of
  // five, and it was the one that writes a resolution AND feeds the text to Pax.
  // MATCHED ON THE SHAPE, NOT THE VARIABLE NAME. The first draft of this
  // hardcoded `ticket.organizationId` and counted four of the five real guards,
  // because one handler binds the row as `ticketForGuard`. Pinning a rule to an
  // identifier someone is free to rename is the same brittleness that let a
  // trigger survive being renamed `…_RENAMED` — see the two laws in CLAUDE.md.
  const GUARD = /\w+\.organizationId\s*!==\s*org\.id\s*&&\s*!org\.isFounder/g;

  it("every ticket handler that fetches a ticket by id also compares the org", () => {
    const src = read("server/routes-support-tickets.ts");
    const guards = src.match(GUARD) ?? [];
    expect(
      guards.length,
      "the org-scope guard count in routes-support-tickets.ts fell. The " +
        "resolve-human handler is the one that was missing it.",
    ).toBeGreaterThanOrEqual(5);
  });

  it("the resolve-human handler specifically carries it", () => {
    // Named rather than counted, because a count is satisfied by a guard added
    // anywhere in the file — including one added twice to a handler that already
    // had it, which is precisely how a count-only check goes green over the gap.
    const src = read("server/routes-support-tickets.ts");
    const at = src.indexOf('"/api/support/tickets/:id/resolve-human"');
    expect(at, "the resolve-human route moved or was renamed").toBeGreaterThan(-1);
    const handler = src.slice(at, at + 2500);
    expect(
      handler,
      "resolve-human fetches a ticket by bare id and never compares its org. " +
        "Any authenticated user can write a resolution onto another tenant's " +
        "ticket, and the text is then fed to an LLM and stored under the victim.",
    ).toMatch(GUARD);
    expect(handler, "the handler no longer binds the organization at all").toContain(
      "req.organization",
    );
  });
});
