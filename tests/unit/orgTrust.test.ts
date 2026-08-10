/**
 * X-A slice 1 — the org-level trust-tier spine (abuse and bad-customer spine).
 *
 * Pins:
 *   1. The tier ladder itself (new → established → trusted) and honest
 *      resolution: stored tier comes back; missing org, garbage value, and a
 *      DB error all fail CLOSED to "new" — a broken read must never widen
 *      anyone's caps.
 *   2. Caps-table sanity: every allowance is monotonically NON-DECREASING as
 *      trust grows, and every restriction (cooldown) NON-INCREASING — a tier
 *      you earn can never be worse than the one below it.
 *   3. Migration honesty (the repo's canonical defect class): the schema
 *      column has BOTH artifacts (migrations/0229 + the scripts/migrate.mjs
 *      release-command mirror), the existing-org seed is a DETERMINISTIC
 *      expression over real columns only (created_at / last_active_at /
 *      subscription_status / dunning_stage — no invented per-org numbers),
 *      and only the founder's own org auto-seeds 'trusted'.
 *   4. Enforcement boundary: the caps CONFIG is consumed today ONLY by the
 *      portal-link lifecycle + abuse-report context (routes-borrower.ts).
 *      NO send/mail service imports it — chokepoint enforcement is a
 *      founder-queued decision (docs/proposals/x-a-send-chokepoint-caps.md),
 *      and wiring it without that ruling should turn this suite red.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── DB mock (decisionQueueMerge house pattern) ─────────────────────────────

let orgRow: Record<string, unknown> | null = null;
let dbShouldThrow = false;

vi.mock("../../server/db", () => ({
  db: {
    query: {
      organizations: {
        findFirst: vi.fn(async () => {
          if (dbShouldThrow) throw new Error("connection refused");
          return orgRow;
        }),
      },
    },
  },
}));

import {
  resolveOrgTrustCaps,
  resolveOrgTrustTier,
  type OrgTrustCaps,
  type OrgTrustTier,
} from "../../server/services/orgTrust";

// The ladder, bottom-up. Deliberately a LOCAL copy: the module keeps its
// tier/caps tables internal (fleet-6 verifier catch — exported, they had no
// production consumer and tripped the reachability gate), so tests observe
// them through the resolvers, and this list is source-pinned below.
const TIERS: OrgTrustTier[] = ["new", "established", "trusted"];

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

beforeEach(() => {
  orgRow = null;
  dbShouldThrow = false;
});

// ─── 1. Tier ladder + honest resolution ─────────────────────────────────────

describe("the tier ladder and honest resolution", () => {
  it("the ladder is exactly new → established → trusted, and stays module-internal", () => {
    const src = read("server/services/orgTrust.ts");
    expect(src).toContain('const ORG_TRUST_TIERS = ["new", "established", "trusted"] as const');
    // Fleet-6 verifier catch: exported, the tier/caps tables had no production
    // consumer (reachability-gate red). They are observable ONLY through
    // resolveOrgTrustTier/resolveOrgTrustCaps now — keep it that way.
    expect(src).not.toMatch(/export const ORG_TRUST_TIERS/);
    expect(src).not.toMatch(/export const ORG_TRUST_CAPS/);
    expect(src).not.toMatch(/export function isOrgTrustTier/);
    // The investor-scoped tiers (platinum/gold/…) must NOT leak in — the
    // fail-closed test below proves a stored "platinum" resolves to "new".
    for (const tier of TIERS) {
      expect(resolveOrgTrustCaps(tier)).toBeTruthy();
    }
  });

  it("resolves the stored tier", async () => {
    orgRow = { trustTier: "established" };
    expect(await resolveOrgTrustTier(7)).toBe("established");
    orgRow = { trustTier: "trusted" };
    expect(await resolveOrgTrustTier(7)).toBe("trusted");
  });

  it("fails CLOSED to 'new' on a missing org, a garbage stored value, and a DB error", async () => {
    orgRow = null;
    expect(await resolveOrgTrustTier(404)).toBe("new");

    orgRow = { trustTier: "platinum" }; // investor-tier leak or corruption
    expect(await resolveOrgTrustTier(7)).toBe("new");

    dbShouldThrow = true;
    expect(await resolveOrgTrustTier(7)).toBe("new");
  });
});

// ─── 2. Caps-table sanity ───────────────────────────────────────────────────

/** Caps where a HIGHER number = MORE allowance (must not shrink with trust). */
const ALLOWANCE_CAPS: Array<keyof OrgTrustCaps> = [
  "wedgeSendsPerDay",
  "wedgeRecipientsPerDay",
  "portalLinksActiveMax",
  "portalLinkRefreshesPerDay",
  "portalLinkTtlDays",
  "exportJobsPerHour",
  "exportRowsPerDay",
];
/** Caps where a LOWER number = MORE allowance (must not grow with trust). */
const RESTRICTION_CAPS: Array<keyof OrgTrustCaps> = [
  "wedgeSameRecipientCooldownDays",
];

describe("caps-table sanity — earning trust can never make an org worse off", () => {
  it("every tier has a complete, positive, finite cap set", () => {
    for (const tier of TIERS) {
      const caps = resolveOrgTrustCaps(tier);
      for (const key of [...ALLOWANCE_CAPS, ...RESTRICTION_CAPS]) {
        expect(Number.isFinite(caps[key])).toBe(true);
        expect(caps[key]).toBeGreaterThan(0);
      }
    }
  });

  it("allowances are non-decreasing and restrictions non-increasing up the ladder", () => {
    for (let i = 1; i < TIERS.length; i++) {
      const below = resolveOrgTrustCaps(TIERS[i - 1]);
      const above = resolveOrgTrustCaps(TIERS[i]);
      for (const key of ALLOWANCE_CAPS) {
        expect(above[key]).toBeGreaterThanOrEqual(below[key]);
      }
      for (const key of RESTRICTION_CAPS) {
        expect(above[key]).toBeLessThanOrEqual(below[key]);
      }
    }
  });

  it("the cap-set shape is exactly the documented seven-plus-one keys (no silent additions)", () => {
    for (const tier of TIERS) {
      expect(Object.keys(resolveOrgTrustCaps(tier)).sort()).toEqual(
        [...ALLOWANCE_CAPS, ...RESTRICTION_CAPS].sort(),
      );
    }
  });
});

// ─── 3. Migration honesty ───────────────────────────────────────────────────

describe("migration artifacts — the column ships with BOTH DDL artifacts and an honest seed", () => {
  it("schema declares trust_tier with default 'new'", () => {
    const schema = read("shared/schema.ts");
    expect(schema).toContain('trustTier: text("trust_tier").notNull().default("new")');
  });

  it("migrations/0229 adds the column and seeds existing orgs deterministically from real columns", () => {
    const sql = read("migrations/0229_org_trust_tier_and_portal_link_expiry.sql");
    expect(sql).toMatch(/ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trust_tier" text NOT NULL DEFAULT 'new'/);
    // The seed rule reads REAL data only — age, activity, standing…
    for (const col of ['"created_at"', '"last_active_at"', '"subscription_status"', '"dunning_stage"']) {
      expect(sql).toContain(col);
    }
    // …and is pinned to FIXED timestamps with a CLOSED activity window —
    // last_active_at only moves forward, so the [2026-07-11, 2026-08-10]
    // window freezes the cohort and a deploy re-run (migrate.mjs replays
    // every statement) can never silently promote an org that became active
    // later (fleet-6 verifier catch: the open-ended window was a promotion
    // side channel around the founder-carded ladder).
    expect(sql).toContain("timestamp '2026-08-10'");
    expect(sql).toContain(`"last_active_at" >= timestamp '2026-07-11'`);
    expect(sql).toContain(`"last_active_at" <= timestamp '2026-08-10'`);
    expect(sql).not.toMatch(/trust_tier"\s*=\s*CASE[\s\S]*now\(\)[\s\S]*END/);
    // Only the founder's own org auto-seeds 'trusted' — 'trusted' is earned
    // or founder-granted, never given away by a backfill.
    const trustedGrants = sql.match(/THEN 'trusted'/g) ?? [];
    expect(trustedGrants).toHaveLength(1);
    expect(sql).toMatch(/WHEN "is_founder" = true THEN 'trusted'/);
  });

  it("the release-command mirror (scripts/migrate.mjs — what prod actually runs) carries the same DDL", () => {
    const migrate = read("scripts/migrate.mjs");
    expect(migrate).toContain(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trust_tier" text NOT NULL DEFAULT 'new'`);
    expect(migrate).toMatch(/WHEN "is_founder" = true THEN 'trusted'/);
    // The mirror carries the SAME closed activity window — it is the artifact
    // that actually re-runs on every deploy, so the freeze matters most here.
    expect(migrate).toContain(`"last_active_at" <= timestamp '2026-08-10'`);
  });
});

// ─── 4. Enforcement boundary — config only, founder-queued chokepoints ──────

describe("enforcement boundary — the spine is wired to its two consumers and NOTHING send-shaped", () => {
  /** Every server file importing orgTrust (recursive walk, source-derived). */
  function orgTrustImporters(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const src = fs.readFileSync(full, "utf-8");
          // Matches "./services/orgTrust" (routes) AND "./orgTrust" (siblings
          // inside services/) — the walker must see both import shapes.
          if (/from\s+["'][^"']*\/orgTrust["']/.test(src)) {
            out.push(path.relative(ROOT, full));
          }
        }
      }
    };
    walk(path.join(ROOT, "server"));
    return out.sort();
  }

  it("orgTrust has exactly three importers today, and none of them enforces anything", () => {
    // Built AND wired — but ONLY at seams that refuse nothing. If this list
    // grows a send/mail/export chokepoint, that is the founder-queued
    // enforcement decision shipping without its ruling
    // (docs/proposals/x-a-send-chokepoint-caps.md) — this test should go red
    // and the baseline should only change WITH that ruling recorded.
    //
    //   routes-borrower.ts        — portal-link TTL + abuse-report context.
    //   services/portalLink.ts    — the shared rebind core; financeAgent
    //                               reaches trust caps only THROUGH it, for
    //                               link TTLs (a portal-lifecycle affordance,
    //                               not a send cap).
    //   routes-founder-customers.ts — REWRITTEN, NOT RELAXED (X-A slice 2).
    //     GET /api/founder/trust-signals, the founder trust panel's read
    //     endpoint. It is NOT enforcement, and the next test proves each
    //     clause rather than asserting it: the path is GET-only, it never
    //     writes trust_tier, and it resolves caps purely to DISPLAY them —
    //     tagged with resolveOrgTrustCapStatus() so every cap but
    //     portalLinkTtlDays renders as "proposed". Slice 2 built the evidence
    //     a future ruling would act on; it changed what no org may do.
    expect(orgTrustImporters()).toEqual([
      "server/routes-borrower.ts",
      "server/routes-founder-customers.ts",
      "server/services/portalLink.ts",
    ]);
  });

  it("the founder panel importer is a READ surface — GET only, no tier write, caps only displayed", () => {
    const panelRoutes = read("server/routes-founder-customers.ts");
    // Read-only: the trust-signals path exists only as a GET.
    expect(panelRoutes).toMatch(/app\.get\(\s*\n\s*"\/api\/founder\/trust-signals"/);
    expect(panelRoutes).not.toMatch(
      /app\.(post|put|patch|delete)\(\s*\n?\s*"\/api\/founder\/trust-signals/,
    );
    // Never writes the column it reads.
    expect(panelRoutes).not.toMatch(/set\(\s*\{[^}]*trustTier/);
    // Caps are resolved next to their real status, so the surface renders
    // "proposed" for everything the founder has not ruled on.
    expect(panelRoutes).toContain("resolveOrgTrustCapStatus()");
    expect(panelRoutes).toContain("PROPOSED — NOT ENFORCED");
    // And it touches no send/mail/export rail.
    expect(panelRoutes).not.toMatch(/emailService|sendEmail|sendSms|twilio/i);
  });

  it("both importers consume the tier/caps live (not dead exports)", () => {
    const routes = read("server/routes-borrower.ts");
    // Abuse-report context stamps the reported org's tier for founder triage.
    expect(routes).toContain("resolveOrgTrustTier(note.organizationId)");
    const portalLink = read("server/services/portalLink.ts");
    // The rebind stamps the org's tier TTL on every rotated link.
    expect(portalLink).toContain("resolveOrgTrustTier(orgId)");
    expect(portalLink).toContain("resolveOrgTrustCaps(tier).portalLinkTtlDays");
  });
});
