/**
 * The marketplace is on the DO-NOT-DO list. Every door into it must be too.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * CLAUDE.md records a standing founder decision: "No marketplace before ~25
 * customers." Three mounts honour it —
 * `/api/marketplace`, `/api/buyer-network` and `/api/investor-verification`
 * all carry `requireLadderFlag("feature_marketplace")`, which fails closed.
 *
 * `/api/matching` had `isAuthenticated, getOrCreateOrg` and nothing else.
 * Buyer matching IS the marketplace, reached through an ungated door.
 *
 * And it was live, not latent. `GET /api/matching/:propertyId/buyers` called
 * `matchmaking.findBuyersForListing`, which reads EVERY `investor_profiles`
 * row on the platform with no organization predicate — display name, bio,
 * location, `investment_range` (a competitor's buying budget) and
 * `verification_documents` — and returned them to any authenticated member of
 * any organization.
 *
 * It surfaced on 2026-09-04, when the org-scope lint was widened to Drizzle's
 * relational query API: `db.query.investorProfiles.findMany({})` has no
 * `.from(`, so the gate had never read that call site, or the other 279.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * The population is DERIVED from the dependency, not typed: any `routes-*.ts`
 * that imports the marketplace schema or the matchmaking service is a
 * marketplace door, and its mount must carry the flag. A fifth router added
 * next year that touches either fails here without anyone remembering to add
 * it to a list.
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Comments stripped: the fix explains the old mount, by name, right above it. */
const code = (rel: string) =>
  read(rel)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

const LADDER_FLAG = 'requireLadderFlag("feature_marketplace")';

/** Route files that depend on marketplace code, whatever they are called. */
function marketplaceRouteFiles(): string[] {
  return fs
    .readdirSync(path.join(ROOT, "server"))
    .filter((f) => /^routes-.*\.ts$/.test(f) && !f.endsWith(".test.ts"))
    .filter((f) => {
      const src = code(`server/${f}`);
      return (
        /from\s+["'][^"']*schema\/marketplace["']/.test(src) ||
        /from\s+["'][^"']*services\/matchmaking["']/.test(src)
      );
    })
    .map((f) => `server/${f}`);
}

/** The `app.use('<path>', …)` line that mounts a given router file. */
function mountLineFor(routeFile: string, routes: string): string | null {
  const base = path.basename(routeFile, ".ts");
  const importLine = new RegExp(`import\\s+(\\w+)\\s+from\\s+["']\\./${base}["']`).exec(routes);
  if (!importLine) return null;
  const ident = importLine[1];
  const mount = new RegExp(`app\\.use\\([^\\n]*${ident}\\s*\\)`, "g").exec(routes);
  return mount ? mount[0] : null;
}

describe("every marketplace door carries the ladder flag", () => {
  const routes = code("server/routes.ts");
  const files = marketplaceRouteFiles();

  it("finds the marketplace route files by their dependencies (vacuity guard)", () => {
    // If this ever comes back empty the rule below is vacuous, and a green run
    // would mean "no marketplace doors" rather than "all of them are gated".
    expect(files.length, "no route file imports marketplace code — the derivation is broken").toBeGreaterThanOrEqual(2);
    expect(files).toContain("server/routes-marketplace.ts");
    expect(files).toContain("server/routes-matching.ts");
  });

  for (const file of marketplaceRouteFiles()) {
    it(`${path.basename(file)} is mounted behind the flag`, () => {
      const mount = mountLineFor(file, routes);
      expect(mount, `${file} has no mount in routes.ts — find it before trusting this test`).not.toBeNull();
      expect(
        mount,
        `${file} reaches marketplace data and is mounted without ${LADDER_FLAG}. ` +
          `"No marketplace before ~25 customers" is a standing founder decision, and ` +
          `an ungated door to the same service is the decision not being enforced.`,
      ).toContain(LADDER_FLAG);
    });
  }

  it("the three siblings that always had it still do", () => {
    // Named as well as derived — these three are the reason the rule exists,
    // and a rename that dropped one from the derivation would otherwise pass.
    for (const p of ["/api/marketplace", "/api/buyer-network", "/api/investor-verification"]) {
      const m = new RegExp(`app\\.use\\('${p}'[^\\n]*`).exec(routes);
      expect(m, `${p} is no longer mounted`).not.toBeNull();
      expect(m![0], `${p} lost the ladder flag`).toContain(LADDER_FLAG);
    }
  });

  it("the flag fails closed, which is what makes gating equal to closing", () => {
    // A gate that opens on an error is not a gate — and this one is the only
    // thing standing between the unscoped read and any authenticated user.
    const gate = read("server/middleware/featureGate.ts");
    const at = gate.indexOf("export function requireLadderFlag");
    const fn = gate.slice(at, at + 900);
    expect(fn).toContain("Errors.featureUnavailable(res)");
    expect(fn).toMatch(/catch\s*\{[\s\S]{0,200}featureUnavailable/);
  });
});

describe("the read behind the door — the obligation, then the fix", () => {
  /**
   * ── THIS ASSERTION WAS REWRITTEN, NOT DELETED (2026-09-04) ────────────────
   *
   * It used to read "findBuyersForListing is recorded as untriaged tenancy
   * debt", and it pinned an OBLIGATION: the ladder flag closes the exposure but
   * does not scope the query, so if the trigger fires and the flag flips on,
   * the unscoped read is live again. Holding that in the register rather than
   * in someone's memory was the entire point.
   *
   * The obligation has since been discharged. Deleting the test would delete
   * the invariant with it; so the assertion is rewritten to the NEW truth, and
   * it now pins the fix in both directions — the register entry is gone
   * BECAUSE the code is scoped, and it must not come back by either route.
   *
   * The register entry disappearing on its own would be ambiguous: an entry
   * removed because the query was fixed and an entry removed because someone
   * tidied the file look identical in JSON. So the code half is asserted too.
   */
  it("findBuyersForListing is scoped to the seller, and its debt entry is gone", () => {
    const register = JSON.parse(read("scripts/org-scope-route-widening.json")) as {
      rule1: { method: string[] };
      rule3: string[];
      _TRIAGED: Record<string, string>;
      _UNTRIAGED_2026_09_04?: string;
    };

    expect(
      register.rule1.method,
      "findBuyersForListing is back in the rule-1 register, which means the " +
        "unit lost its organization argument again and the read behind the " +
        "ladder flag is once more unscoped.",
    ).not.toContain("server/services/matchmaking.ts::findBuyersForListing");

    // The cross-org PROFILE read remains and is correct — the buyers for your
    // listing are in other organizations — so it carries a reason of its own
    // rather than vanishing silently.
    const chainKey = "server/services/matchmaking.ts::findBuyersForListing::investorProfiles";
    expect(
      register.rule3,
      "the profile read is no longer registered at all. It is a deliberate " +
        "cross-org read and must stay visible with its reason attached.",
    ).toContain(chainKey);
    expect(register._TRIAGED[chainKey], "that entry lost its reason").toBeTruthy();

    // And the code, because a register is a claim about code.
    const service = read("server/services/matchmaking.ts");
    const at = service.indexOf("async findBuyersForListing(");
    expect(at, "findBuyersForListing is gone or renamed").toBeGreaterThan(-1);
    const body = service.slice(at, at + 2000);
    expect(
      body,
      "the listing is no longer resolved against the caller's organization.",
    ).toContain("eq(marketplaceListings.sellerOrganizationId, sellerOrganizationId)");
    expect(
      body,
      "matched buyers carry the raw investor_profiles row again, including " +
        "verification_documents.",
    ).toContain("publicInvestorFields(profile)");

    // The untriaged block stays, and stays honest about the burn-down.
    expect(register._UNTRIAGED_2026_09_04, "the untriaged block is gone").toBeTruthy();
    expect(register._UNTRIAGED_2026_09_04).toContain("findBuyersForListing");
  });
});
