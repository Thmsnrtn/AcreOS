/**
 * breakGlassCard.test.ts — the outside-the-app safety net stays honest.
 *
 * Founder decision 2026-07-28 #8: scaffold the break-glass card + Controls
 * section NOW; the founder provisions the GitHub secrets later; NOTHING is
 * presented as armed until it actually is.
 *
 * Source-shape coverage (drift-proof by construction):
 *  1. The exact secret names are PARSED out of the three workflow .yml files
 *    (`${{ secrets.X }}`), so renaming a secret in a workflow without updating
 *    the card/section breaks this build.
 *  2. The card carries every parsed secret name verbatim, both provisioning
 *    paths (gh CLI and the GitHub web UI), and the keep-a-copy-outside-the-app
 *    header.
 *  3. The Control Center section never renders an armed/green state — the app
 *    cannot read GitHub repo secrets, so it must say "Can't verify from here".
 *  4. The email route exists, founder-gated, on the SYSTEM mail lane, with the
 *    honest { sent: false, reason } failure shape.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");

/** Every `${{ secrets.X }}` reference in a workflow, minus GITHUB_TOKEN
 *  (auto-provided by Actions — nothing for the founder to set). */
function secretsUsedBy(workflowRel: string): string[] {
  const src = read(workflowRel);
  const names = new Set<string>();
  for (const m of src.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (m[1] !== "GITHUB_TOKEN") names.add(m[1]);
  }
  return [...names];
}

const WORKFLOWS = [
  ".github/workflows/uptime-probe.yml",
  ".github/workflows/release-watchdog.yml",
  ".github/workflows/daily-pulse.yml",
] as const;

const card = read("docs/runbooks/break-glass-card.md");
const controls = read("client/src/pages/founder/autopilot-control.tsx");
const routes = read("server/routes-founder-intelligence.ts");

describe("workflow secret names (ground truth parsed from the .yml files)", () => {
  it("the dormant watchdogs still use the exact secrets the scaffolding documents", () => {
    // If any of these change, the card + Controls section copy is stale.
    expect(secretsUsedBy(".github/workflows/uptime-probe.yml").sort()).toEqual([
      "UPTIME_PROBE_TOKEN",
      "UPTIME_PROBE_URL",
    ]);
    expect(secretsUsedBy(".github/workflows/release-watchdog.yml")).toEqual([
      "DEPLOY_ALERT_WEBHOOK",
    ]);
    expect(secretsUsedBy(".github/workflows/daily-pulse.yml")).toContain("NTFY_TOPIC");
  });
});

describe("docs/runbooks/break-glass-card.md — the one-pager", () => {
  it("contains every secret name any external watchdog actually uses, verbatim", () => {
    for (const wf of WORKFLOWS) {
      for (const name of secretsUsedBy(wf)) {
        expect(card, `card must name ${name} (used by ${wf})`).toContain(name);
      }
    }
  });

  it("gives BOTH provisioning paths: gh CLI and the GitHub web UI", () => {
    expect(card).toMatch(/gh secret set UPTIME_PROBE_URL/);
    expect(card).toMatch(/gh secret set UPTIME_PROBE_TOKEN/);
    expect(card).toMatch(/gh secret set DEPLOY_ALERT_WEBHOOK/);
    expect(card).toMatch(/Settings.*→.*Secrets and variables.*→.*Actions/);
    expect(card).toMatch(/New repository secret/);
  });

  it("covers the server-side half of the probe token (Fly secret)", () => {
    expect(card).toMatch(/fly secrets set UPTIME_PROBE_TOKEN/);
  });

  it("tells the founder to keep a copy OUTSIDE the app (print / emailed copy)", () => {
    expect(card).toMatch(/OUTSIDE THE APP/i);
    expect(card).toMatch(/print/i);
    expect(card).toMatch(/emailed copy/i);
  });

  it("starts with 'is it just you' triage anchored on the daily pulse one-liner", () => {
    expect(card).toMatch(/is it down, or is it just you/i);
    expect(card).toMatch(/one-liner arrive/i);
  });

  it("names who hosts what with login URLs (Fly, GitHub, Stripe, ntfy)", () => {
    expect(card).toContain("https://fly.io/dashboard");
    expect(card).toContain("https://github.com/Thmsnrtn/AcreOS");
    expect(card).toContain("https://dashboard.stripe.com");
    expect(card).toContain("https://ntfy.sh");
  });

  it("never claims a dormant watchdog is armed", () => {
    expect(card).toMatch(/dormant until you set/i);
    expect(card).not.toMatch(/watchdogs? (is|are) (already )?armed/i);
  });
});

describe("autopilot-control.tsx — 'Safety net outside the app' section", () => {
  // The section's own source, isolated so honesty assertions can't be
  // satisfied by unrelated parts of the page.
  const start = controls.indexOf("function ExternalSafetyNetSection");
  const end = controls.indexOf("\n// ── Step-Away Readiness");
  const defsStart = controls.indexOf("const EXTERNAL_WATCHDOGS");
  const section = controls.slice(defsStart, end);

  it("the section exists, with the email-the-card button wired to the route", () => {
    expect(start).toBeGreaterThan(-1);
    expect(defsStart).toBeGreaterThan(-1);
    expect(section).toContain("Safety net outside the app");
    expect(section).toContain("/api/founder/intelligence/break-glass/email");
    expect(section).toContain('data-testid="email-break-glass-card"');
  });

  it("lists all three external watchdogs with the exact dormant-arming secret names", () => {
    for (const key of ["daily-pulse", "uptime-probe", "release-watchdog"]) {
      expect(section).toContain(`key: "${key}"`);
    }
    for (const name of ["UPTIME_PROBE_URL", "UPTIME_PROBE_TOKEN", "DEPLOY_ALERT_WEBHOOK", "NTFY_TOPIC"]) {
      expect(section).toContain(name);
    }
  });

  it("NEVER renders an armed/green state — the app cannot read GitHub secrets", () => {
    // Original invariant: every watchdog state line admits unverifiability
    // because the app cannot read GitHub secrets. Wave 0.9 (F-18-2) changed
    // that premise for ONE card: the uptime probe is now verifiable BY
    // BEHAVIOR (landed samples power the step-away external_watchdogs
    // check), so its static copy points at that live check instead of
    // claiming unverifiability. The other watchdogs remain
    // can't-verify-from-here, and the static section still may not claim
    // armed/green itself — armed is only ever the LIVE check's word.
    expect(section.match(/Can't verify from here/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(section).toContain("step-away readiness");
    // …and the section contains no success styling and no armed claim at all.
    expect(section).not.toContain("acr-success");
    expect(section).not.toMatch(/status.*armed|"Armed"|>Armed</i);
    // The indicator dot is amber, unconditionally (no ternary picking a color).
    expect(section).toContain('rounded-full bg-acr-warn"');
  });

  it("dormant entries carry the here's-how setup steps from the card", () => {
    expect(section).toMatch(/gh secret set UPTIME_PROBE_URL/);
    expect(section).toMatch(/gh secret set DEPLOY_ALERT_WEBHOOK/);
    expect(section).toMatch(/Settings → Secrets and variables → Actions/);
  });

  it("the honest {sent,reason} outcome surfaces in the toast (no pretend success)", () => {
    expect(section).toContain("sent: boolean; reason: string | null");
    expect(section).toContain("Card NOT sent");
  });
});

describe("routes-founder-intelligence.ts — the email route", () => {
  const routeStart = routes.indexOf('"/break-glass/email"');
  const routeSection = routes.slice(
    routes.lastIndexOf("router.post", routeStart),
    routes.indexOf("export default router"),
  );

  it("POST /break-glass/email exists and is founder-gated", () => {
    expect(routeStart).toBeGreaterThan(-1);
    expect(routeSection).toContain("requireFounder");
  });

  it("sends on the SYSTEM mail lane only (BYO-rails decision)", () => {
    expect(routeSection).toContain('purpose: "system"');
    expect(routeSection).not.toContain('"counterparty"');
  });

  it("every failure path answers { sent: false, reason } honestly", () => {
    // Missing card file, missing founder email, and a failed send all return
    // sent:false with a real reason — never a fabricated success.
    expect(routeSection.match(/sent: false/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(routeSection).toContain("sent: result.success");
    expect(routeSection).toMatch(/reason/);
  });
});
