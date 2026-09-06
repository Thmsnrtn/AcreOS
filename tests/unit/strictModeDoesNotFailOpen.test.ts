/**
 * A gate that permits when it cannot check is not a gate.
 *
 * `complianceGate` wrapped its whole body in one `try`, and the catch called
 * `next()` under the comment *"Compliance gate should never block normal
 * operation on error"*. That is correct for the ADVISORY default — the gate's
 * documented job there is to add an `X-Compliance-Warnings` header, not to
 * gatekeep — and **wrong for `COMPLIANCE_STRICT_MODE=true`, whose entire promise
 * is to block operations with violations.**
 *
 * So a `checkUsury` throw let a note with a usury violation through, in the mode
 * configured to stop it. The failure mode of the safety feature was the absence
 * of the safety feature.
 *
 * WORSE, AND THE PART THAT IS EASY TO MISS: the audit-log write sat inside the
 * same `try`, BEFORE the strict-mode block. A failed `createAuditLogEntry`
 * therefore also skipped the refusal — **the two things that make strict mode
 * meaningful, the block and the evidence, failed together and in the permitting
 * direction.** One catch, two very different failures, one permissive outcome.
 *
 * THE SHAPE, which is this session's recurring one. Units 89–93 kept finding
 * UNKNOWN rendered as a definite favourable value: an empty list read as "no job
 * has failed", a caught error read as "you have none", a missing risk band read
 * as "low", a failed compliance fetch read as "Compliant". This is the same
 * substitution with the highest stakes attached — *we could not check* rendered
 * as *permitted*.
 *
 * WHAT IS **NOT** CHANGED, deliberately. Advisory mode still fails open, because
 * that is what the file has always said it is for and blocking ordinary work on
 * a warning-generator's hiccup would be worse than the hiccup.
 *
 * The other fail-open gates in `server/middleware` were read and left alone:
 * `usageLimitGate` and `aiByokThresholdGate` trade a slowly-accruing plan
 * overage against immediately blocking legitimate work, and say so inline;
 * `rateLimit` / `redisRateLimit` are the standard availability trade;
 * `expensiveEndpointGuard` names its posture in the log line;
 * `requirePaxDisclosure` carries a written rationale in its own header. Those are
 * considered decisions with their reasoning attached, and relitigating them
 * without evidence would be churn. `complianceGate` was the one whose fail-open
 * contradicted a mode it also implements.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

const gateRaw = fs.readFileSync(path.join(ROOT, "server/middleware/complianceGate.ts"), "utf8");
const gate = stripComments(gateRaw);

/** Every `catch (…) {` body in the file, taken by brace balance. */
function catchBodies(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/catch\s*\([^)]*\)\s*\{/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(src.slice(m.index! + m[0].length, i - 1));
  }
  return out;
}

describe("strict mode refuses when it cannot check", () => {
  it("finds the catch blocks (vacuity guard)", () => {
    // Two, by design: one for determining compliance, one for recording it.
    // If the brace walk broke, every assertion below would pass vacuously.
    expect(catchBodies(gate).length, "no catch blocks parsed from complianceGate").toBe(2);
  });

  it("no catch permits unconditionally", () => {
    // The original defect in one line: `catch { logger.error(…); next(); }`.
    for (const body of catchBodies(gate)) {
      const permits = /\bnext\(\)/.test(body);
      if (!permits) continue;
      expect(
        /isStrictMode/.test(body),
        "a catch in complianceGate calls next() without consulting strict mode. " +
          "In strict mode the gate's promise is to BLOCK violations, so a check " +
          "that did not run has cleared nothing — and permitting makes the mode " +
          "a no-op exactly when its dependencies are unhealthy.",
      ).toBe(true);
    }
  });

  it("a failure to DETERMINE refuses in strict mode", () => {
    const at = gate.indexOf("collectWarnings(checkType, req)");
    expect(at, "the determine step is gone").toBeGreaterThan(-1);
    const body = catchBodies(gate.slice(at))[0];
    expect(body).toContain("isStrictMode");
    expect(body).toContain("Errors.serviceUnavailable");
    expect(
      body.indexOf("isStrictMode"),
      "the advisory fall-through runs before the strict-mode refusal",
    ).toBeLessThan(body.indexOf("next()"));
  });

  it("a failure to RECORD refuses in strict mode too", () => {
    // The half that is easy to miss. In strict mode the audit entry IS the
    // promise — a blocked violation nobody can evidence is not much better than
    // an unblocked one.
    const at = gate.indexOf("createAuditLogEntry");
    expect(at, "the audit write is gone").toBeGreaterThan(-1);
    const body = catchBodies(gate.slice(at))[0];
    expect(body).toContain("isStrictMode");
    expect(body).toContain("Errors.serviceUnavailable");
  });

  it("the audit write has its OWN try, so it cannot swallow the block", () => {
    // The structural fix. Both used to share one catch, so a failed INSERT
    // skipped the refusal — and neither the block nor the record happened.
    const decide = gate.indexOf("isStrictMode && warnings.some");
    const audit = gate.indexOf("createAuditLogEntry");
    expect(decide, "the strict-mode decision is gone").toBeGreaterThan(-1);
    expect(
      audit,
      "the audit write moved after the decision — the record would then miss " +
        "the very operations strict mode blocks",
    ).toBeLessThan(decide);
    const between = gate.slice(audit, decide);
    expect(
      between,
      "there is no catch between the audit write and the decision, so they are " +
        "sharing a try again",
    ).toContain("catch");
  });

  it("advisory mode still fails open, and that is deliberate", () => {
    // Stated as its own assertion so a later sweep does not "finish the job" by
    // making the default mode block on a warning-generator's hiccup.
    const at = gate.indexOf("collectWarnings(checkType, req)");
    const body = catchBodies(gate.slice(at))[0];
    expect(body, "advisory mode no longer falls through").toContain("next()");
    expect(gateRaw, "the advisory posture lost its explanation").toMatch(
      /warns; it does not\s+\* *gatekeep|does not block operations outright/i,
    );
  });

  it("the strict-mode block itself survives", () => {
    // Vacuity guard for the whole file: if the 422 went, everything above would
    // be describing a mode that no longer does anything.
    expect(gate).toContain("Compliance violation detected. Operation blocked in strict mode.");
    expect(gate).toContain("COMPLIANCE_STRICT_MODE");
  });
});
