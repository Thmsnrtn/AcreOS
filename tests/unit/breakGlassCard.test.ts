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
import { readFileSync, readdirSync } from "node:fs";
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

/**
 * THE POPULATION — derived, not typed.
 *
 * This was a hardcoded list of three workflows, and on 2026-09-05 that turned
 * out to be a claim about the card's completeness that nothing checked. Three
 * MORE secret-gated automations existed the whole time — the desktop-feel,
 * customer-journey and borrower-cookie audits, all gated on `TARGET_URL` — and
 * none of their secrets appeared on the card. Neither did `SOLENE_PAGE_SECRET`,
 * the paging channel three red paths use, nor `SENTRY_AUTH_TOKEN`. Four of
 * seven documented, with a green gate over the other three, because the gate's
 * population was written down instead of found.
 *
 * A dormancy-gated workflow is one that CHECKS FOR A SECRET AND CHANGES
 * BEHAVIOUR when it is absent — `if [ -z "${X:-}" ]` over a name it also reads
 * from `secrets.`. That predicate finds them; a list does not.
 *
 * Comments are stripped first, population included. The three audits carry
 * explanatory comments naming `TARGET_URL` and the guard itself, and a
 * predicate that reads its own documentation is the trap this repo has already
 * paid for four times in one day.
 */
const withoutComments = (src: string) =>
  src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

/** Guard-gated secrets in one workflow: `-z "${X:-}"` where X is a secret. */
function dormancyGatedSecrets(workflowRel: string): string[] {
  const src = withoutComments(read(workflowRel));
  const guarded = new Set(
    [...src.matchAll(/-z\s+"\$\{?([A-Za-z_][A-Za-z0-9_]*)(?::-)?\}?"/g)].map((m) => m[1]),
  );
  const fromSecrets = new Set(
    [...src.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]).filter((n) => n !== "GITHUB_TOKEN"),
  );
  // A guard usually names the ENV var, which is bound to the secret above it.
  const envToSecret = new Map(
    [...src.matchAll(
      /^\s*([A-Z_][A-Z0-9_]*):\s*\$\{\{\s*(?:github\.event\.inputs\.\w+\s*\|\|\s*)?secrets\.([A-Za-z0-9_]+)\s*\}\}/gm,
    )].map((m) => [m[1], m[2]] as const),
  );
  const out = new Set<string>();
  for (const g of guarded) {
    if (fromSecrets.has(g)) out.add(g);
    const mapped = envToSecret.get(g);
    if (mapped) out.add(mapped);
  }
  return [...out].sort();
}

const ALL_WORKFLOWS = readdirSync(path.join(root, ".github/workflows"))
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => `.github/workflows/${f}`)
  .sort();

/** Every workflow that goes quiet without a secret the founder must set. */
const WORKFLOWS = ALL_WORKFLOWS.filter((rel) => dormancyGatedSecrets(rel).length > 0);

/**
 * WORD-BOUNDED, not `toContain`.
 *
 * Falsifying this file caught its own assertion: replacing `TARGET_URL` with
 * `TARGET_URL_REDACTED` throughout the card left every `toContain("TARGET_URL")`
 * satisfied, so the gate certified a card that no longer names the secret. That
 * is the substring trap CLAUDE.md records paying for once already — a trigger
 * pinned by name surviving a rename to `…_RENAMED`.
 */
const names = (haystack: string, needle: string) =>
  new RegExp(`(?<![A-Za-z0-9_])${needle}(?![A-Za-z0-9_])`).test(haystack);

/** The `secrets: [...]` arrays in EXTERNAL_WATCHDOGS, parsed rather than grepped. */
function panelSecrets(sectionSrc: string): string[] {
  const out = new Set<string>();
  for (const m of sectionSrc.matchAll(/secrets:\s*\[([^\]]*)\]/g)) {
    for (const q of m[1].matchAll(/"([A-Za-z0-9_]+)"/g)) out.add(q[1]);
  }
  return [...out].sort();
}

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
  it("reads a real population of dormancy-gated workflows (vacuity guard)", () => {
    // The floor is the whole point. If the guard predicate stops matching, this
    // gate passes over an EMPTY set — which reads exactly like a complete card.
    expect(ALL_WORKFLOWS.length, "no workflows were read at all").toBeGreaterThan(10);
    expect(
      WORKFLOWS.length,
      "no dormancy-gated workflow was found. Eight existed on 2026-09-05 " +
        "(uptime-probe, release-watchdog, daily-pulse, deploy, customer-surface-monitor " +
        "and the three quality audits). Re-point dormancyGatedSecrets — do not " +
        "let this population empty.",
    ).toBeGreaterThanOrEqual(6);
  });

  it("names every secret whose ABSENCE silently changes behaviour, verbatim", () => {
    // Not "every secret these workflows use" — deploy.yml's FLY_API_TOKEN is CI
    // plumbing the founder never touches during an outage, and putting it here
    // would make the card longer without making it truer. The card's job is the
    // set whose absence makes an automation go quiet, which is exactly the set
    // the guard predicate finds.
    const gated = [...new Set(WORKFLOWS.flatMap((wf) => dormancyGatedSecrets(wf)))].sort();
    expect(gated.length, "the guard predicate found no gated secrets at all").toBeGreaterThanOrEqual(6);
    for (const name of gated) {
      const users = WORKFLOWS.filter((wf) => dormancyGatedSecrets(wf).includes(name));
      expect(
        names(card, name),
        `card must name ${name} — without it ${users.join(", ")} goes quiet, and the ` +
          "founder has no record from outside the app that the secret exists. That is " +
          "how TARGET_URL, SOLENE_PAGE_SECRET and SENTRY_AUTH_TOKEN were missing from " +
          "this card while three audits reported success for months.",
      ).toBe(true);
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

  it("lists every dormancy-gated automation with the exact arming secret names", () => {
    // Was three keys, typed. That list WAS the panel's completeness claim, and
    // nothing checked it — so when three TARGET_URL-gated audits appeared, the
    // panel stayed silent about them and this test stayed green.
    for (const key of [
      "daily-pulse", "uptime-probe", "release-watchdog",
      "desktop-feel-audit", "customer-journey-audit", "borrower-cookie-e2e",
    ]) {
      expect(section, `${key} is dormancy-gated but absent from the panel`).toContain(`key: "${key}"`);
    }
  });

  it("every gated secret the card documents is armable from the panel too", () => {
    // The card is the OFFLINE copy; the panel is the in-app one. A secret on one
    // and not the other means the founder's answer depends on which he happens
    // to look at.
    //
    // Asserted against the parsed `secrets:` ARRAYS, not the section text —
    // falsification caught that too. Deleting SOLENE_PAGE_SECRET from the arrays
    // left the test green, because the prose in a `how:` step still mentioned it.
    // The arrays are what the UI renders as "Secrets to set"; prose is not.
    //
    // SENTRY_AUTH_TOKEN is the deliberate exception, named rather than filtered
    // silently: it gates sourcemap upload inside the deploy pipeline, not an
    // automation that watches the business. It belongs on the card (it explains
    // an unreadable stack trace) and not in a panel whose subject is "what is
    // watching while I sleep".
    const PIPELINE_ONLY = new Set(["SENTRY_AUTH_TOKEN"]);
    const gated = [...new Set(WORKFLOWS.flatMap((wf) => dormancyGatedSecrets(wf)))]
      .filter((n) => !PIPELINE_ONLY.has(n))
      .sort();
    const armable = panelSecrets(section);
    expect(gated.length).toBeGreaterThanOrEqual(5);
    expect(armable.length, "no `secrets: [...]` arrays were parsed out of the panel").toBeGreaterThanOrEqual(5);
    for (const name of gated) {
      expect(
        armable,
        `${name} gates an automation the card tells the founder about, but the ` +
          "in-app panel never offers it as a secret to set.",
      ).toContain(name);
    }
  });

  it("NEVER renders an armed/green state — the app cannot read GitHub secrets", () => {
    // Every watchdog state line admits unverifiability…
    expect(section.match(/Can't verify from here/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
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
