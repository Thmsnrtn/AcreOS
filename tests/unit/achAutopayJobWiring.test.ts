/**
 * achAutopayJobWiring.test.ts — proves the ACH autopay money path is WIRED, not
 * merely written.
 *
 * This repo's single most common defect is "built but unwired": a service with
 * zero call sites, a job that is never registered, a route file that is never
 * mounted. Wave C shipped `server/services/achAutopay.ts` (the engine),
 * `server/services/achMandateSetup.ts` (authorization capture) and
 * `server/jobs/achAutopayRun.ts` (the cycle) — and the first two had ZERO call
 * sites while the job was never started, so nothing debited and no route
 * exposed any of it.
 *
 * These assertions are made against SOURCE TEXT rather than by importing the
 * server (importing routes-borrower.ts would pull in Express, Stripe and the
 * whole storage layer). They are deliberately about existence-of-wiring, which
 * is exactly what text can prove and what a green agent report cannot.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { JOB_ROSTER, achAutopayDormantReason } from "../../server/jobs/jobRegistry";
import { ACH_AUTOPAY_JOB_NAME } from "../../server/jobs/achAutopayRun";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", "..", rel), "utf8");
}

const jobSource = read("server/jobs/achAutopayRun.ts");
const orchestratorSource = read("server/jobs/runScheduledJobs.ts");
const routeSource = read("server/routes-borrower.ts");
const portalSource = read("client/src/pages/borrower-portal.tsx");

describe("ach_autopay_cycle is actually registered", () => {
  it("the orchestrator imports AND calls the job's start function", () => {
    expect(orchestratorSource).toMatch(
      /import\s*\{\s*startAchAutopayJob\s*\}\s*from\s*"\.\/achAutopayRun"/,
    );
    expect(orchestratorSource).toContain("startAchAutopayJob();");
  });

  it("the scheduling wrapper lives in the job module, not inline in runScheduledJobs.ts", () => {
    expect(jobSource).toContain("export function startAchAutopayJob()");
    expect(jobSource).toMatch(/trackInterval\(/);
    // The orchestrator must contain only the call — no setInterval/lock for it.
    expect(orchestratorSource).not.toContain("ach_autopay_cycle");
  });

  it("takes the job lock under the exact roster name, as a literal", () => {
    // A literal (not a constant) because jobRosterCoverage.test.ts extracts
    // roster parity from `withJobLock("…")` literals — a constant there would
    // make the roster entry look like a phantom and blind the deadman.
    expect(jobSource).toContain(`withJobLock("${ACH_AUTOPAY_JOB_NAME}"`);
    expect(ACH_AUTOPAY_JOB_NAME).toBe("ach_autopay_cycle");
  });

  it("is rostered as an hourly CRITICAL job with a dormancy reason", () => {
    const entry = JOB_ROSTER.find((e) => e.name === ACH_AUTOPAY_JOB_NAME);
    expect(entry, "ach_autopay_cycle must be in JOB_ROSTER or the deadman is blind").toBeTruthy();
    expect(entry!.critical).toBe(true);
    expect(entry!.intervalMs).toBe(60 * 60 * 1000);
    expect(entry!.disabledWhen).toBeTypeOf("function");
    expect(entry!.disabledReason).toBeTruthy();
  });

  it("the job body and the roster evaluate the SAME dormancy predicate", () => {
    const entry = JOB_ROSTER.find((e) => e.name === ACH_AUTOPAY_JOB_NAME)!;
    const prevSim = process.env.SIMULATION_MODE_STRIPE;
    const prevKey = process.env.STRIPE_SECRET_KEY;
    try {
      process.env.SIMULATION_MODE_STRIPE = "true";
      expect(achAutopayDormantReason()).toContain("SIMULATION_MODE_STRIPE");
      expect(entry.disabledWhen!()).toBe(true);

      delete process.env.SIMULATION_MODE_STRIPE;
      delete process.env.STRIPE_SECRET_KEY;
      expect(achAutopayDormantReason()).toContain("STRIPE_SECRET_KEY");
      expect(entry.disabledWhen!()).toBe(true);

      process.env.STRIPE_SECRET_KEY = "sk_test_wiring";
      expect(achAutopayDormantReason()).toBeNull();
      expect(entry.disabledWhen!()).toBe(false);
    } finally {
      if (prevSim === undefined) delete process.env.SIMULATION_MODE_STRIPE;
      else process.env.SIMULATION_MODE_STRIPE = prevSim;
      if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = prevKey;
    }
  });

  it("refuses to run the cycle while dormant (a dark cycle is logged, not silent)", () => {
    expect(jobSource).toContain("achAutopayDormantReason()");
    expect(jobSource).toMatch(/ACH autopay cycle skipped/);
  });
});

describe("mandate capture and the autopay toggle are exposed as routes", () => {
  it("mounts mandate setup, mandate confirm and an autopay status read", () => {
    expect(routeSource).toContain('api.get("/api/borrower/autopay"');
    expect(routeSource).toContain('"/api/borrower/autopay/mandate"');
    expect(routeSource).toContain('"/api/borrower/autopay/mandate/confirm"');
    expect(routeSource).toContain('api.post("/api/borrower/autopay"');
  });

  it("calls the previously-orphaned mandate services", () => {
    for (const fn of [
      "startAchMandateSetup",
      "confirmAchMandateSetup",
      "revokeAchMandatesForNote",
      "getAchMandateSummary",
    ]) {
      expect(routeSource, `${fn} must have a call site`).toContain(`${fn}(`);
    }
  });

  it("authenticates every ACH route with the existing borrower session middleware", () => {
    // Extract each ACH route registration and assert the middleware chain.
    const achRoutes = routeSource.match(/api\.(get|post)\(\s*\n?\s*"\/api\/borrower\/autopay[^"]*"[\s\S]{0,120}?async/g);
    expect(achRoutes, "expected the ACH autopay routes to be found").toBeTruthy();
    expect(achRoutes!.length).toBeGreaterThanOrEqual(4);
    for (const chunk of achRoutes!) {
      expect(chunk, `missing validateBorrowerSession in: ${chunk}`).toContain("validateBorrowerSession");
      expect(chunk, `missing rate limiter in: ${chunk}`).toContain("portalPaymentRateLimiter");
    }
  });

  it("uses Errors.* helpers rather than raw res.status on the ACH paths", () => {
    const achBlockStart = routeSource.indexOf("BORROWER ACH AUTOPAY (Session-authenticated)");
    const achBlockEnd = routeSource.indexOf("// Toggle autopay for borrower portal");
    expect(achBlockStart).toBeGreaterThan(-1);
    expect(achBlockEnd).toBeGreaterThan(achBlockStart);
    const block = routeSource.slice(achBlockStart, achBlockEnd);
    expect(block).not.toContain("res.status(");
    expect(block).toContain("Errors.badRequest");
    expect(block).toContain("Errors.notFound");
  });

  it("NO route submits a debit — only the job may move money", () => {
    // The single debit entry point is submitDebitForNote/submitDueDebits, called
    // from server/jobs/achAutopayRun.ts via runAchAutopayCycle. A route that
    // called it would be a second money path with its own idempotency story.
    expect(routeSource).not.toContain("submitDebitForNote");
    expect(routeSource).not.toContain("submitDueDebits");
    expect(routeSource).not.toContain("runAchAutopayCycle");
  });

  it("enabling autopay is gated on an armed mandate", () => {
    expect(routeSource).toContain("no_active_mandate");
    expect(routeSource).toMatch(/wantEnabled\s*&&\s*!mandate\.armed/);
  });

  it("disabling autopay revokes the stored authorization (NACHA stop-on-request)", () => {
    expect(routeSource).toMatch(/revokeAchMandatesForNote\(\{/);
    expect(routeSource).toContain("Borrower turned autopay off in the borrower portal.");
  });
});

describe("the borrower portal toggle no longer over-promises", () => {
  it("only claims automatic collection when the mandate is armed", () => {
    expect(portalSource).toContain("autopayEnabled && autopayArmed && (");
    // The old unconditional promise must be gone.
    expect(portalSource).not.toContain("we'll collect this payment automatically");
  });

  it("says what is missing when autopay is on but nothing can be collected", () => {
    expect(portalSource).toContain("Autopay is on but no bank account is");
  });

  it("disables the switch when ACH could not actually debit", () => {
    expect(portalSource).toMatch(/!autopayEnabled\s*&&\s*!autopayArmed\s*&&\s*autopayStatus\?\.achAvailable\s*!==\s*true/);
  });

  it("renders the server's verbatim authorization text rather than its own copy", () => {
    expect(portalSource).toContain("autopayStatus.authorization.authorizationText");
    expect(portalSource).toContain("displayedAuthorizationText");
  });

  it("handles the hosted-verification return leg and the cancel leg honestly", () => {
    expect(portalSource).toContain("ach_setup");
    expect(portalSource).toContain("/api/borrower/autopay/mandate/confirm");
    expect(portalSource).toContain("no bank details were saved, autopay stays off, and nothing was debited");
  });
});
