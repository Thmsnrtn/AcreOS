/**
 * agent_investor commission wedge (Wave 2 pass C).
 *
 * Pins the honest-partial promotion of agent_investor roadmap → beta:
 *
 *   1. The commission surface is reachable by an agent_investor org BEHIND the
 *      Finance door — a persona-gated child of the money module + a
 *      /finance/commissions route — and is NOT a new top-level nav entry (the
 *      five customer doors are unchanged: "No new top-level nav entries EVER").
 *   2. It gates to agent_investor and refuses/omits honestly when unconfigured
 *      (NotFound for other personas; honest empty states, never a fabricated
 *      commission number).
 *   3. The deal-close seam auto-records the closing agent's commission with the
 *      CORRECT recordDealCommission argument order (guards the swapped-arg bug),
 *      only when an explicit config exists (never fabricate).
 *   4. The duplicate standalone /api/commissions router is gone — one source of
 *      truth.
 *   5. The MLS / client-vs-own-book / dual-agency hard-stops stay roadmap and
 *      disclosed.
 *
 * Source-shape assertions (node env, no DOM) — same pattern as
 * tailVerticalGates.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getBusinessType } from "../../shared/business-types";

const ROOT = path.resolve(__dirname, "../..");
const SERVER = path.join(ROOT, "server");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("agent_investor is beta (honest-partial commission wedge)", () => {
  it("the registry entry is beta", () => {
    expect(getBusinessType("agent_investor")?.maturity).toBe("beta");
  });
});

describe("commission surface lives BEHIND the Finance door (no new nav entry)", () => {
  const sidebar = read("client/src/components/layout-sidebar.tsx");
  const navItems = read("client/src/lib/nav-items.ts");
  const app = read("client/src/App.tsx");

  it("the money (Finance) module carries a persona-gated Commissions child", () => {
    // The commission child must sit inside the money module (the Finance door),
    // between the `id: "money"` header and the next module (`id: "ai-hub"`).
    const moneyIdx = sidebar.indexOf('id: "money"');
    const nextModuleIdx = sidebar.indexOf('id: "ai-hub"', moneyIdx);
    expect(moneyIdx, "money module must exist").toBeGreaterThan(-1);
    expect(nextModuleIdx, "ai-hub module must follow money").toBeGreaterThan(moneyIdx);
    const block = sidebar.slice(moneyIdx, nextModuleIdx);
    // It IS the Finance door.
    expect(block).toMatch(/label:\s*"Finance"/);
    // A child (not a top-level module) with the commission route, gated to
    // agent_investor via businessTypeOnly.
    expect(block).toContain('href: "/finance/commissions"');
    expect(block).toMatch(/businessTypeOnly:\s*\["agent_investor"\]/);
  });

  it("the child filter honours NavChild.businessTypeOnly (persona-gated children)", () => {
    expect(sidebar).toContain("childBusinessTypeAllows");
    // The interface must actually carry the field the child sets.
    expect(sidebar).toMatch(/interface NavChild[\s\S]*?businessTypeOnly\?:/);
  });

  it("/finance/commissions is NOT a top-level door — the door lists are unchanged", () => {
    // The five customer doors + Inbox/Settings, verbatim. Adding the commission
    // surface must not have touched these (that would be a new nav entry).
    expect(navItems).toMatch(
      /MOBILE_DOORS\s*=\s*\["today",\s*"map",\s*"deals",\s*"money",\s*"ai-hub"\]/,
    );
    expect(navItems).toMatch(
      /DEFAULT_SIDEBAR_ITEMS\s*=\s*\["today",\s*"map",\s*"deals",\s*"money",\s*"ai-hub",\s*"inbox",\s*"settings"\]/,
    );
    // The route is never a top-level NavModule href (only a child href).
    expect(sidebar).not.toMatch(/id:\s*"[^"]*",\s*label:[^\n]*\n\s*icon:[^\n]*\n\s*href:\s*"\/finance\/commissions"/);
  });

  it("App.tsx registers the /finance/commissions route (reachable)", () => {
    expect(app).toContain('<Route path="/finance/commissions">');
    expect(app).toContain("FinanceCommissionsPage");
  });
});

describe("the customer commission page gates + stays honest", () => {
  const page = read("client/src/pages/finance-commissions.tsx");
  const commissions = read("client/src/pages/commissions.tsx");

  it("gates to agent_investor and NotFounds every other persona", () => {
    expect(page).toMatch(/businessType\s*!==\s*"agent_investor"/);
    expect(page).toContain("<NotFound />");
    expect(page).toContain("CommissionsPage");
  });

  it("discloses the roadmap hard-stops in the persona voice (not fabricated)", () => {
    expect(page).toMatch(/MLS/);
    expect(page).toMatch(/own book/i);
    expect(page).toMatch(/dual-agency/i);
  });

  it("the underlying page renders honest empty/zero states, never an invented number", () => {
    // The commission page must show explicit empty states when nothing is
    // configured rather than a placeholder commission figure.
    expect(commissions).toContain("No commission records for");
    expect(commissions).toContain("No team members found");
    // It accepts the disclosure intro slot the customer surface passes.
    expect(commissions).toMatch(/intro\?:\s*ReactNode/);
    expect(commissions).toContain("{intro}");
  });
});

describe("deal-close auto-record — correct signature + honesty gate", () => {
  const deals = read("server/routes-deals.ts");
  const service = read("server/services/commissionService.ts");

  it("the service signature is (orgId, teamMemberId, dealId, salePriceCents)", () => {
    const sig = service.match(
      /export async function recordDealCommission\(\s*organizationId: number,\s*teamMemberId: number,\s*dealId: number,\s*salePriceCents: number/,
    );
    expect(sig, "recordDealCommission signature must be pinned").toBeTruthy();
  });

  it("the close seam calls recordDealCommission with args in the signature order (guards the swapped-arg bug)", () => {
    // org.id → teamMemberId(deal.assignedTo) → dealId(deal.id) → salePriceCents(cents).
    // The prior bug passed (org.id, dealId, agentId, amount) — assignedTo MUST
    // come before deal.id here or the record is booked against the wrong ids.
    const call = deals.match(
      /recordDealCommission\(\s*org\.id\s*,\s*deal\.assignedTo!?\s*,\s*deal\.id\s*,\s*Math\.round\([^)]*\*\s*100\)/,
    );
    expect(call, "recordDealCommission must be called with (org.id, deal.assignedTo, deal.id, cents)").toBeTruthy();
  });

  it("records ONLY when an explicit config exists — skips silently otherwise (never fabricate)", () => {
    // The honesty gate: hasCommissionConfig must be checked and short-circuit
    // BEFORE recordDealCommission runs.
    const gateIdx = deals.indexOf("hasCommissionConfig(org.id)");
    const recordIdx = deals.indexOf("recordDealCommission(\n");
    expect(gateIdx, "hasCommissionConfig gate must be present").toBeGreaterThan(-1);
    expect(recordIdx, "recordDealCommission call must be present").toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(recordIdx);
    expect(deals).toMatch(/hasCommissionConfig\(org\.id\)\)\)\s*return;/);
    // hasCommissionConfig only returns true for a real saved config row.
    expect(service).toContain("export async function hasCommissionConfig");
    expect(service).toMatch(/provider,\s*"commission_config"/);
  });
});

describe("single source of truth — the duplicate router is gone", () => {
  it("server/routes-commissions.ts no longer exists", () => {
    expect(fs.existsSync(path.join(SERVER, "routes-commissions.ts"))).toBe(false);
  });

  it("routes.ts no longer imports or mounts a second /api/commissions router", () => {
    const routes = read("server/routes.ts");
    expect(routes).not.toMatch(/import\s+commissionsRouter/);
    expect(routes).not.toMatch(/app\.use\(['"]\/api\/commissions['"][^)]*commissionsRouter/);
  });

  it("the surviving commission routes are the admin-scoped ones in routes-organization.ts", () => {
    const org = read("server/routes-organization.ts");
    expect(org).toContain('api.get("/api/commissions/summaries"');
    expect(org).toContain('api.post("/api/commissions/:id/pay"');
    // Config write stays admin-scoped (requireAdminOrAbove) — not widened.
    expect(org).toMatch(/api\.put\("\/api\/commissions\/config",[\s\S]*?requireAdminOrAbove\(\)/);
  });
});
