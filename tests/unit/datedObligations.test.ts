/**
 * Dated obligations registry (master-handoff O1, generalizing audit F-18-1).
 *
 * Four jobs:
 *   1. Pin the pure countdown (obligationStatus / imminentObligations) and the
 *      env gate that keeps an UNSET credential out of the "imminent" set.
 *   2. Pin the SEEDS: the ATTOM row migrated from vendorCredentialExpiry, and
 *      the statute re-reviews DERIVED from statuteRegister.nextReviewDue —
 *      including the policy that nextReviewDue exists ONLY where a dated
 *      review exists and is exactly reviewedAt + 365d (never an invented date).
 *   3. INTEGRATION-TIME RENEWAL LINT (derived, mirrors aiCostCoverage.test.ts):
 *      every CONNECTOR_REGISTRY entry with authType apikey|oauth and every
 *      paid-env provider registration must have an obligations row OR a dated,
 *      reasoned NO_RENEWAL_ALLOWLIST entry — a hard boolean per integration,
 *      not a count. A future paid integration that ships without anyone
 *      recording whether its credential has a renewal date fails CI here.
 *   4. Keep the Controls-door "Obligations year view" an honest MIRROR of the
 *      registry (the client cannot import server code, so it carries a static
 *      copy; this lint is what makes that copy trustworthy).
 *
 * idempotent: true — pure data + source analysis, no DB, no network.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  DATED_OBLIGATIONS,
  DEFAULT_PAGE_THRESHOLDS,
  isVendorCredential,
  imminentObligations,
  obligationStatus,
  pageThresholdsFor,
  type DatedObligation,
} from "../../server/services/datedObligations";
import { STATUTE_REGISTER } from "@shared/governance/statuteRegister";
import { CONNECTOR_REGISTRY } from "../../server/services/connectors/registry";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// 1. Registry shape + pure countdown
// ---------------------------------------------------------------------------

describe("datedObligations — registry shape", () => {
  it("every row carries a plain what, a real ISO due date, an owner, a kind and a note", () => {
    expect(DATED_OBLIGATIONS.length).toBeGreaterThan(0);
    for (const o of DATED_OBLIGATIONS) {
      expect(o.what, "what").toBeTruthy();
      expect(o.due, `${o.what} due`).toMatch(ISO_DATE);
      expect(Number.isNaN(Date.parse(o.due)), `${o.what} due parseable`).toBe(false);
      expect(o.owner, `${o.what} owner`).toBeTruthy();
      expect(
        ["vendor_credential", "license_review", "governance_review", "ops_drill", "custom"],
        `${o.what} kind`,
      ).toContain(o.kind);
      // The note doubles as the readiness check's "fix" line — a bare token
      // there tells the founder nothing.
      expect(o.note.length, `${o.what} note must say the renewal path`).toBeGreaterThan(20);
    }
  });

  it("every vendor_credential row carries vendor + envVar + soleSourceFor (the adapter and env gate need them)", () => {
    const credentialRows = DATED_OBLIGATIONS.filter((o) => o.kind === "vendor_credential");
    expect(credentialRows.length).toBeGreaterThan(0);
    for (const o of credentialRows) {
      expect(isVendorCredential(o), `${o.what} passes isVendorCredential`).toBe(true);
    }
  });

  it("what-lines are unique (they anchor dedupe keys and the year-view mirror)", () => {
    const whats = DATED_OBLIGATIONS.map((o) => o.what);
    expect(new Set(whats).size).toBe(whats.length);
  });
});

describe("datedObligations — pure countdown", () => {
  const attom = DATED_OBLIGATIONS.find((o) => o.envVar === "ATTOM_API_KEY")!;

  it("computes whole days remaining relative to the injected now, soonest first", () => {
    const now = new Date(`${attom.due}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 10);
    const rows = obligationStatus(now);
    expect(rows.find((o) => o.what === attom.what)!.daysLeft).toBe(10);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].daysLeft).toBeLessThanOrEqual(rows[i].daysLeft);
    }
  });

  it("reports a negative daysLeft after the date passes", () => {
    const past = new Date(`${attom.due}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() + 5);
    expect(obligationStatus(past).find((o) => o.what === attom.what)!.daysLeft).toBeLessThan(0);
  });

  it("imminentObligations env-gates vendor_credential rows (an UNSET key is already-degraded, not impending)", () => {
    const now = new Date(`${attom.due}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 3);
    const withKey = imminentObligations(now, 14, (k) => (k === "ATTOM_API_KEY" ? "set" : undefined));
    expect(withKey.some((o) => o.what === attom.what)).toBe(true);
    const withoutKey = imminentObligations(now, 14, () => undefined);
    expect(withoutKey.some((o) => o.what === attom.what)).toBe(false);
  });

  it("imminentObligations does NOT env-gate rows without an envVar (a review has no key to check)", () => {
    const review = DATED_OBLIGATIONS.find((o) => o.kind === "governance_review")!;
    const now = new Date(`${review.due}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 9);
    const rows = imminentObligations(now, 14, () => undefined);
    expect(rows.some((o) => o.what === review.what)).toBe(true);
  });

  it("imminentObligations excludes rows outside the window", () => {
    const now = new Date(`${attom.due}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 100);
    expect(
      imminentObligations(now, 14, () => "set").some((o) => o.what === attom.what),
    ).toBe(false);
  });

  it("pageThresholdsFor honours a per-row override and defaults to [14, 7, 2, 0]", () => {
    expect([...DEFAULT_PAGE_THRESHOLDS]).toEqual([14, 7, 2, 0]);
    const base = DATED_OBLIGATIONS[0];
    expect(pageThresholdsFor(base)).toEqual(DEFAULT_PAGE_THRESHOLDS);
    const overridden: DatedObligation = { ...base, pageThresholds: [30, 1] };
    expect([...pageThresholdsFor(overridden)]).toEqual([30, 1]);
  });
});

// ---------------------------------------------------------------------------
// 2. Seeds — only KNOWN dates, each traceable
// ---------------------------------------------------------------------------

describe("datedObligations — seeded truths", () => {
  it("carries the ATTOM trial row migrated from vendorCredentialExpiry (F-18-1)", () => {
    const attom = DATED_OBLIGATIONS.find((o) => o.envVar === "ATTOM_API_KEY");
    expect(attom, "ATTOM row present").toBeTruthy();
    expect(attom!.kind).toBe("vendor_credential");
    expect(attom!.vendor).toBe("ATTOM");
    expect(attom!.due).toMatch(ISO_DATE);
  });

  it("statuteRegister.nextReviewDue exists ONLY where a dated review exists, and is exactly reviewedAt + 365d", () => {
    const withDue = STATUTE_REGISTER.filter((e) => e.nextReviewDue);
    // The two dated founder reviews are the seed; losing them silently would
    // un-watch a governance date.
    expect(withDue.map((e) => e.id).sort()).toEqual(
      ["money.no-platform-custody", "tcpa.dnc-and-litigator-scrub"].sort(),
    );
    for (const e of withDue) {
      expect(e.reviewedAt, `${e.id} nextReviewDue without reviewedAt — nothing anchors it`).toBeTruthy();
      expect(
        e.nextReviewDue,
        `${e.id} nextReviewDue must be reviewedAt + 365d (the annual re-review policy)`,
      ).toBe(addDaysIso(e.reviewedAt!, 365));
    }
  });

  it("every statute entry with nextReviewDue surfaces as a governance_review obligation (and none are invented)", () => {
    const fromRegister = STATUTE_REGISTER.filter((e) => e.nextReviewDue).map(
      (e) => `Statute review: ${e.id} @ ${e.nextReviewDue}`,
    );
    const inRegistry = DATED_OBLIGATIONS.filter((o) => o.kind === "governance_review").map(
      (o) => `${o.what} @ ${o.due}`,
    );
    expect(inRegistry.sort()).toEqual(fromRegister.sort());
  });
});

// ---------------------------------------------------------------------------
// 3. Integration-time renewal lint (derived — mirrors aiCostCoverage.test.ts)
// ---------------------------------------------------------------------------

/**
 * Integrations with NO dated renewal obligation, each with a dated reason.
 * The honest default here is org-BYO: nearly every connector credential is
 * the CUSTOMER's own account (stored per-org in pax_connector_instances), so
 * its renewal is the customer's calendar, not the platform's. DO NOT add an
 * entry to ship a new paid integration without thinking — if the credential
 * has a known lapse date, it belongs in DATED_OBLIGATIONS instead.
 */
const NO_RENEWAL_ALLOWLIST: Record<string, { since: string; reason: string }> = {
  "connector:gmail": {
    since: "2026-08-10",
    reason:
      "Org-BYO OAuth grant: the token is the customer's own Google account (per-org row in " +
      "pax_connector_instances) — renewal is the CUSTOMER's, not a platform calendar date. The " +
      "platform OAuth app credentials carry no recorded dated lapse.",
  },
  "connector:slack": {
    since: "2026-08-10",
    reason:
      "Org-BYO webhook: the customer pastes their own Slack incoming-webhook URL — nothing " +
      "platform-side expires on a known date.",
  },
  "connector:stripe": {
    since: "2026-08-10",
    reason:
      "Org-BYO API key: the customer's own Stripe secret key, stored per-org — renewal (if Stripe " +
      "ever rolls it) is the customer's, with no platform date to watch.",
  },
  "connector:quickbooks": {
    since: "2026-08-10",
    reason:
      "Org-BYO OAuth grant: the customer's own Intuit account authorises it — renewal is the " +
      "customer's; the platform OAuth app credentials carry no recorded dated lapse.",
  },
  "connector:google_drive": {
    since: "2026-08-10",
    reason:
      "Org-BYO OAuth grant: the customer's own Google account — renewal is the customer's; the " +
      "platform OAuth app credentials carry no recorded dated lapse.",
  },
  "connector:dropbox": {
    since: "2026-08-10",
    reason:
      "Org-BYO OAuth grant: the customer's own Dropbox account — renewal is the customer's; the " +
      "platform OAuth app credentials carry no recorded dated lapse.",
  },
  "connector:docusign": {
    since: "2026-08-10",
    reason:
      "Org-BYO OAuth grant: the customer's own DocuSign account — renewal is the customer's; the " +
      "platform OAuth app credentials carry no recorded dated lapse.",
  },
  "connector:google_calendar": {
    since: "2026-08-10",
    reason:
      "Org-BYO OAuth grant: the customer's own Google account — renewal is the customer's; the " +
      "platform OAuth app credentials carry no recorded dated lapse.",
  },
  "connector:propstream": {
    since: "2026-08-10",
    reason:
      "Org-BYO API key: the customer's own PropStream account key, stored per-org — its term is " +
      "the customer's contract, not a platform date.",
  },
  "connector:batch_leads": {
    since: "2026-08-10",
    reason:
      "Org-BYO API key: the customer's own BatchLeads account key, stored per-org — its term is " +
      "the customer's contract, not a platform date.",
  },
  "connector:mls": {
    since: "2026-08-10",
    reason:
      "Org-BYO credentials: the customer's own RESO/MLS access token and base URL — MLS access " +
      "terms are the customer's, not a platform date.",
  },
  "provider-env:REGRID_API_KEY": {
    since: "2026-08-10",
    reason:
      "No platform key provisioned and no dated terms on record: docs/company/live-operation-keys.md " +
      "Tier 2 defers paid data keys ('add these when volume justifies') and records no Regrid " +
      "provisioning date. When a key is provisioned on dated terms, add a vendor_credential row " +
      "and delete this entry.",
  },
  "provider-env:BATCHDATA_API_KEY": {
    since: "2026-08-10",
    reason:
      "No credential provisioned: providers-init.ts registers BatchData inert ('only fires when " +
      "BATCHDATA_API_KEY is set') and no key or dated terms are on record. When provisioned on " +
      "dated terms, add a vendor_credential row and delete this entry.",
  },
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");

function hasObligationFor(key: string): boolean {
  if (key.startsWith("provider-env:")) {
    const env = key.slice("provider-env:".length);
    return DATED_OBLIGATIONS.some((o) => o.envVar === env);
  }
  const id = key.slice("connector:".length);
  return DATED_OBLIGATIONS.some(
    (o) => o.kind === "vendor_credential" && slug(o.vendor ?? "") === id,
  );
}

/**
 * Derive the credential-carrying integration surface from source, not a list:
 *  - connectors: every CONNECTOR_REGISTRY entry whose authType is apikey|oauth
 *    (webhook/none entries hold no expiring credential);
 *  - paid-env providers: every provider module registered in providers-init.ts
 *    whose tierRequired is not "free" and whose source reads a credential-
 *    shaped env var (…_API_KEY / …_TOKEN / …_SECRET).
 */
function deriveRenewalSurface(): string[] {
  const keys = new Set<string>();

  for (const c of CONNECTOR_REGISTRY) {
    if (c.authType === "apikey" || c.authType === "oauth") keys.add(`connector:${c.id}`);
  }

  const initSrc = read("server/providers-init.ts");
  // If this extraction ever derives nothing, the guard test below fails on
  // the known provider-env members — a derivation that derives nothing must
  // never green-light anything.
  const modules = [...initSrc.matchAll(/from "\.\/services\/providers\/([\w-]+)"/g)].map((m) => m[1]);
  for (const mod of modules) {
    const src = read(`server/services/providers/${mod}.ts`);
    const tier = src.match(/tierRequired:\s*"(\w+)"/)?.[1];
    if (!tier || tier === "free") continue;
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (/(_API_KEY|_TOKEN|_SECRET)$/.test(m[1])) keys.add(`provider-env:${m[1]}`);
    }
  }

  return [...keys].sort();
}

describe("integration-time renewal lint (derived)", () => {
  const surface = deriveRenewalSurface();

  it("the derivation still finds the known credential surfaces (guards the derivation itself)", () => {
    // A derived invariant that derives nothing green-lights anything.
    for (const expected of [
      "connector:gmail",
      "connector:stripe",
      "provider-env:ATTOM_API_KEY",
      "provider-env:REGRID_API_KEY",
      "provider-env:BATCHDATA_API_KEY",
    ]) {
      expect(surface, `derivation must find ${expected}`).toContain(expected);
    }
    // webhook-auth connectors hold no expiring credential and must stay out.
    expect(surface).not.toContain("connector:zapier");
    expect(surface).not.toContain("connector:make");
  });

  it("every apikey/oauth connector and every paid-env provider has an obligations row OR a dated, reasoned allowlist entry", () => {
    const offenders = surface.filter(
      (key) => !hasObligationFor(key) && !(key in NO_RENEWAL_ALLOWLIST),
    );
    expect(
      offenders,
      `Credential-carrying integrations with NO recorded renewal posture. Either the credential ` +
        `has a known lapse date (add a DATED_OBLIGATIONS row in server/services/datedObligations.ts) ` +
        `or it genuinely has none (add a dated, reasoned NO_RENEWAL_ALLOWLIST entry here — org-BYO ` +
        `credentials belong to the customer and say so):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the allowlist stays honest: every entry is still derived, still uncovered, dated, and actually reasoned", () => {
    for (const [key, entry] of Object.entries(NO_RENEWAL_ALLOWLIST)) {
      expect(surface, `${key} no longer derived — delete its allowlist entry`).toContain(key);
      expect(
        hasObligationFor(key),
        `${key} now has an obligations row — DELETE its allowlist entry in the same commit`,
      ).toBe(false);
      expect(entry.since, `${key} since`).toMatch(ISO_DATE);
      expect(
        entry.reason.length,
        `${key} reason must actually explain why no renewal date exists`,
      ).toBeGreaterThan(60);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The Controls-door year view stays an honest mirror + stays WIRED
// ---------------------------------------------------------------------------

describe("obligations year view (client mirror)", () => {
  const pageSrc = read("client/src/pages/founder/autopilot-control.tsx");

  it("OBLIGATIONS_YEAR_VIEW mirrors the registry exactly (what + due, both directions)", () => {
    const block = pageSrc.match(/const OBLIGATIONS_YEAR_VIEW[^=]*=\s*\[([\s\S]*?)\n\];/);
    expect(block, "OBLIGATIONS_YEAR_VIEW must be extractable from autopilot-control.tsx").toBeTruthy();
    const mirror = [...block![1].matchAll(/what:\s*"([^"]+)",\s*\n\s*due:\s*"(\d{4}-\d{2}-\d{2})"/g)]
      .map((m) => `${m[1]} @ ${m[2]}`)
      .sort();
    const registry = DATED_OBLIGATIONS.map((o) => `${o.what} @ ${o.due}`).sort();
    expect(
      mirror,
      "The year view drifted from server/services/datedObligations.ts — update the mirror in the " +
        "same change as the registry (a founder surface showing a stale date is fabrication).",
    ).toEqual(registry);
  });

  it("the section is actually RENDERED on the Controls door (built-but-unwired defence)", () => {
    expect(pageSrc).toContain("<ObligationsYearSection />");
  });

  it("the year view never claims green — past-due renders as attention, not done", () => {
    // Source pin on the honesty rule: the row dot is amber or negative-toned,
    // never the success token (acr-pos — the dead acr-success alias was swept
    // repo-wide in the 2026-08 dead-token sweep).
    const section = pageSrc.slice(pageSrc.indexOf("function ObligationsYearSection"));
    const body = section.slice(0, section.indexOf("\n}\n"));
    expect(body).not.toContain("bg-acr-pos");
    expect(body).toContain("bg-acr-warn");
    expect(body).toContain("bg-acr-neg");
  });
});
