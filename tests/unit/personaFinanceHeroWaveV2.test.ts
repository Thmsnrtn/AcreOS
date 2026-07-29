/**
 * Finance-door hero wave V2 (founder ruling #11 2026-07-28,
 * docs/company/founder-decisions-2026-07-28.md §11).
 *
 * The Finance door was the thinnest persona layer: 3 hero branches for 9
 * personas — tax_delinquent fell through to null and subdivider shared the
 * generic Project P&L hero. Wave V2 adds two REAL heroes:
 *
 *   tax_delinquent → CertificatesBookHero, reading the same org-scoped
 *     /api/tax-certificates/dashboard/summary aggregate as /redemption-clock
 *     and the Today widget. The endpoint is ownerOrAdmin-gated, so members
 *     get an honest suppressed state — never zeros presented as the book.
 *   subdivider → SubdividerLotEconomicsHero, reading the new org-scoped
 *     /api/lots/economics-summary roll-up (subdivision_plans +
 *     lot_basis_allocations — see lotEconomicsSummaryRoute.test.ts for the
 *     endpoint's behavior tests).
 *
 * Component files (.tsx) are asserted via source-shape contracts — the same
 * pattern as critical-path-render.test.ts and landlordFamilyGates.test.ts —
 * because these tests run in the node env with no DOM.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const HERO_PATH = path.resolve(
  __dirname,
  "../../client/src/components/finance/PersonaFinanceHero.tsx",
);
const ROUTES_PATH = path.resolve(__dirname, "../../server/routes-lot-basis.ts");

const hero = fs.readFileSync(HERO_PATH, "utf-8");
const routesSrc = fs.readFileSync(ROUTES_PATH, "utf-8");

describe("PersonaFinanceHero — wave V2 dispatch table", () => {
  it("tax_delinquent gets its own certificates-book hero (no more null fall-through)", () => {
    expect(hero).toContain('persona === "tax_delinquent"');
    expect(hero).toMatch(/if \(isTaxDelinquent\) return <CertificatesBookHero \/>;/);
  });

  it("subdivider gets its own lot-economics hero (no longer the shared Project P&L)", () => {
    expect(hero).toContain('persona === "subdivider"');
    expect(hero).toMatch(/if \(isSubdivider\) return <SubdividerLotEconomicsHero \/>;/);
  });

  it("the projects branch is now exactly fix_flipper + landlord (subdivider graduated out)", () => {
    const match = hero.match(/const isProjects =([\s\S]*?);/);
    expect(match, "isProjects assignment must exist").toBeTruthy();
    expect(match![1]).toContain('"fix_flipper"');
    expect(match![1]).toContain('"landlord"');
    expect(match![1]).not.toContain('"subdivider"');
  });

  it("existing branches survive: note book, wholesaler, and the land_investor null default", () => {
    expect(hero).toContain('persona === "note_investor"');
    expect(hero).toContain('persona === "wholesaler"');
    expect(hero).toContain("return null");
  });

  it("the V2 heroes do NOT ride the portfolio-summary query (they own their endpoints)", () => {
    expect(hero).toMatch(/enabled: isNoteBook \|\| isWholesaler \|\| isProjects/);
  });
});

describe("CertificatesBookHero — real data + honest states", () => {
  it("reads the same real org-scoped aggregate as /redemption-clock (dashboard/summary)", () => {
    expect(hero).toContain('"/api/tax-certificates/dashboard/summary"');
  });

  it("renders only fields the endpoint actually returns", () => {
    for (const field of [
      "totalCapitalCents",
      "activeCount",
      "overdueCount",
      "within30Count",
      "within90Count",
    ]) {
      expect(hero, field).toContain(field);
    }
  });

  it("members hitting the ownerOrAdmin gate (403) get an honest suppressed state, never zeros", () => {
    const restricted = hero.match(
      /errMessage\.includes\("403"\)[\s\S]*?text-certs-restricted/,
    );
    expect(restricted, "403 branch must render the restricted note").toBeTruthy();
    expect(hero).toContain("owners and admins only");
  });

  it("zero active certificates → EmptyState with real CTAs to the redemption clock + auction worksheet", () => {
    const empty = hero.match(/activeCount === 0[\s\S]*?<EmptyState[\s\S]*?testId="certs-hero-empty"/);
    expect(empty, "activeCount===0 must render EmptyState").toBeTruthy();
    expect(empty![0]).toContain('href: "/redemption-clock"');
    expect(empty![0]).toContain('href: "/auction-worksheet"');
    expect(empty![0]).toContain('headline="No active certificates"');
  });

  it("loading → Skeleton hero; failure → QueryErrorState with retry", () => {
    expect(hero).toContain('<HeroLoadingSkeleton label="Loading certificates book" />');
    expect(hero).toMatch(/testId="certs-hero-error"/);
    const errBlock = hero.match(/testId="certs-hero-error"[\s\S]{0,400}/);
    // QueryErrorState props appear just above testId in the JSX — assert the
    // component + retry wiring exist in the cert hero body.
    const certHero = hero.match(/function CertificatesBookHero\(\)[\s\S]*?\n\/\/ ── subdivider/);
    expect(certHero).toBeTruthy();
    expect(certHero![0]).toContain("<QueryErrorState");
    expect(certHero![0]).toContain("onRetry={() => refetch()}");
    expect(errBlock).toBeTruthy();
  });
});

describe("SubdividerLotEconomicsHero — real data + honest states", () => {
  const subHero = hero.match(/function SubdividerLotEconomicsHero\(\)[\s\S]*$/);

  it("reads the org-scoped lot-economics roll-up endpoint", () => {
    expect(hero).toContain('"/api/lots/economics-summary"');
  });

  it("renders only fields the roll-up actually returns", () => {
    expect(subHero).toBeTruthy();
    for (const field of [
      "plansCount",
      "lotsAllocated",
      "lotsSold",
      "basisAllocatedCents",
      "realizedSaleProceedsCents",
      "realizedCogsCents",
    ]) {
      expect(subHero![0], field).toContain(field);
    }
  });

  it("nothing in the stack yet → 'No subdivision plans yet' EmptyState with real CTAs", () => {
    const empty = subHero![0].match(/plansCount === 0[\s\S]*?<EmptyState[\s\S]*?testId="lots-hero-empty"/);
    expect(empty, "empty branch must render EmptyState").toBeTruthy();
    expect(empty![0]).toContain('headline="No subdivision plans yet"');
    expect(empty![0]).toContain('href: "/properties"');
    expect(empty![0]).toContain('href: "/lot-pricing"');
  });

  it("no recorded closings → honest 'No closings yet' / no fabricated proceeds", () => {
    expect(subHero![0]).toContain("No closings yet");
    expect(subHero![0]).toMatch(/lotsSold > 0 \? \(/);
    expect(subHero![0]).toContain("No lot sales recorded yet");
  });

  it("no allocations yet → honest 'Not allocated yet' tile instead of $0", () => {
    expect(subHero![0]).toContain("Not allocated yet");
  });

  it("loading → Skeleton hero; failure → QueryErrorState with retry", () => {
    expect(subHero![0]).toContain('<HeroLoadingSkeleton label="Loading lot economics" />');
    expect(subHero![0]).toContain("<QueryErrorState");
    expect(subHero![0]).toContain("onRetry={() => refetch()}");
    expect(subHero![0]).toContain('testId="lots-hero-error"');
  });
});

describe("server counterpart — /api/lots/economics-summary exists and is org-scoped", () => {
  it("routes-lot-basis registers the GET endpoint the hero queries", () => {
    expect(routesSrc).toContain('"/api/lots/economics-summary"');
  });

  it("aggregates are scoped to the request org on BOTH tables (no cross-org leakage)", () => {
    expect(routesSrc).toContain("eq(subdivisionPlans.organizationId, orgId)");
    // The allocations aggregate reuses the file's existing org-scope predicate.
    const summaryBlock = routesSrc.match(/economics-summary[\s\S]*$/);
    expect(summaryBlock).toBeTruthy();
    expect(summaryBlock![0]).toContain("eq(lotBasisAllocations.organizationId, orgId)");
  });

  it("realized sums are filtered to rows where a closing was actually recorded", () => {
    expect(routesSrc).toMatch(/realizedSalePriceCents[\s\S]*?FILTER \(WHERE[\s\S]*?realizedAt.*IS NOT NULL/);
  });
});
