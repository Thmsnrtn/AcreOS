/**
 * Founder ruling 2026-09-29 #3 (DEFECT-0106) — every writer that can END a
 * lender's subscription starts the borrower wind-down clock.
 *
 * The 90-day wind-down is keyed on `organizations.subscription_ended_at`. A
 * writer that sets `subscriptionStatus` to an ended status WITHOUT stamping it
 * would leave the clock unset (the phase code would then stamp it late, on
 * first sight — a borrower's notice period starting days or weeks after the
 * lender actually left). So the population is enumerated here: every server
 * object literal assigning `subscriptionStatus` a value that could be an
 * ended status — a `cancelled`/`canceled` literal, or any non-literal
 * expression — and each file holding one must call `subscriptionEndedPatch(`
 * at least as many times as it has such sites.
 *
 * Adding a new writer without the stamp fails "no unregistered writer"; a
 * registered writer losing its stamp fails its own row.
 */
import { describe, it, expect, vi } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");

/** Literal statuses that can never mean "ended". */
const NOT_ENDED_LITERAL = /^["'](active|trialing|paused|suspended|past_due|unpaid|incomplete)["']/;

/** Assignments of `subscriptionStatus:` whose value could be an ended status. */
function endCapableSites(src: string): string[] {
  const sites: string[] = [];
  for (const m of src.matchAll(/\bsubscriptionStatus\s*:\s*([^,\n}]+)/g)) {
    const v = m[1].trim();
    if (NOT_ENDED_LITERAL.test(v)) continue;
    // A READ of the column into another object — a select projection or an
    // org row's own field — is not a write. Only these exact shapes: a value
    // taken from `req.body.subscriptionStatus` (or any other object) IS a
    // write of whatever that object holds.
    if (/^(organizations|orgsTable)\.subscriptionStatus$/.test(v)) continue;
    if (/^\(?(org|o|r)\??\.subscription_?[sS]tatus( \?\? ("[^"]*"|null))?\)?( as [\w |]+)?$/.test(v)) continue;
    // A ternary whose every branch is a non-ended literal.
    const branches = v.match(/\?\s*(["'][^"']*["'])\s*:\s*(["'][^"']*["'])\s*$/);
    if (branches && NOT_ENDED_LITERAL.test(branches[1]) && NOT_ENDED_LITERAL.test(branches[2])) continue;
    // A type annotation (`subscriptionStatus: string | null`).
    if (/^(string|number|boolean|text\()/.test(v)) continue;
    sites.push(v);
  }
  // Assignment form: `updates.subscriptionStatus = …` (not a comparison).
  for (const m of src.matchAll(/\.subscriptionStatus\s*=(?!=)\s*([^;\n]+)/g)) {
    const v = m[1].trim();
    if (!NOT_ENDED_LITERAL.test(v)) sites.push(v);
  }
  return sites;
}

/** The writers found when this gate was written, with their site counts. */
const WRITERS: Record<string, number> = {
  "server/webhookHandlers.ts": 2, // subscription.deleted + subscription.updated → canceled
  "server/routes-billing.ts": 1, // refund-and-cancel
  "server/services/dunning.ts": 1, // dunning reaches "cancelled"
  "server/ai/supportAgent.ts": 1, // Stripe resync writes the raw Stripe status
};

// server/ AND scripts/ — a maintenance script can end a subscription too.
const files = execSync("git ls-files 'server/*.ts' 'scripts/*.ts' 'scripts/*.mjs'", { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.includes(".test."));
const found: Record<string, { sites: number; stamps: number }> = {};
for (const f of files) {
  const src = stripComments(readFileSync(resolve(ROOT, f), "utf8"));
  const sites = endCapableSites(src).length;
  if (sites > 0) found[f] = { sites, stamps: (src.match(/\bsubscriptionEndedPatch\(/g) ?? []).length };
}

describe("every writer that can end a subscription stamps the wind-down clock", () => {
  it("the scan read the whole server tree (population floor)", () => {
    expect(files).toContain("server/webhookHandlers.ts");
    expect(files.length).toBeGreaterThan(1000);
  });

  it("the site detector is live (canaries)", () => {
    expect(endCapableSites(`db.update(o).set({ subscriptionStatus: "cancelled" })`)).toHaveLength(1);
    expect(endCapableSites(`x.set({ subscriptionStatus: sub.status as any })`)).toHaveLength(1);
    expect(endCapableSites(`x.set({ subscriptionStatus: "active" })`)).toHaveLength(0);
    expect(endCapableSites(`select({ subscriptionStatus: organizations.subscriptionStatus })`)).toHaveLength(0);
    expect(endCapableSites(`interface F { subscriptionStatus: string | null }`)).toHaveLength(0);
    // Values taken from another object are writes of what it holds.
    expect(endCapableSites(`x.set({ subscriptionStatus: req.body.subscriptionStatus })`)).toHaveLength(1);
    expect(endCapableSites(`const facts = { subscriptionStatus: org.subscriptionStatus }`)).toHaveLength(0);
    expect(endCapableSites(`({ subscriptionStatus: (r.subscription_status ?? null) as string | null })`)).toHaveLength(0);
    expect(endCapableSites(`({ subscriptionStatus: x ? "past_due" : "active" })`)).toHaveLength(0);
    expect(endCapableSites(`({ subscriptionStatus: x ? "cancelled" : "suspended" })`)).toHaveLength(1);
    // Assignment form.
    expect(endCapableSites(`updates.subscriptionStatus = "cancelled";`)).toHaveLength(1);
    expect(endCapableSites(`if (org.subscriptionStatus === "cancelled") {}`)).toHaveLength(0);
  });

  it("no unregistered writer", () => {
    expect(Object.keys(found).filter((f) => !(f in WRITERS))).toEqual([]);
  });

  for (const [file, sites] of Object.entries(WRITERS)) {
    it(`${file} still writes (vacuity) and stamps every end-capable site`, () => {
      expect(found[file], `${file} no longer has an end-capable subscriptionStatus write`).toBeDefined();
      expect(found[file].sites).toBe(sites);
      expect(found[file].stamps).toBeGreaterThanOrEqual(sites);
    });
  }

  it("no raw-SQL writer sets subscription_status (it would bypass the stamp)", () => {
    const raw = files.filter((f) =>
      /\bSET\b[^;]*\bsubscription_status\s*=/i.test(stripComments(readFileSync(resolve(ROOT, f), "utf8"))),
    );
    expect(raw).toEqual([]);
  });
});
