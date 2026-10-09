/**
 * Stored tier names fold before they reach limits or money.
 *
 * `organizations.subscription_tier` still holds legacy names (solo → starter,
 * operator → pro, empire → scale). THE folds are `limitsTierFor` (limits) and
 * `tierForSubscriptionTier` / `monthlyRevenueCentsFor` (money). The revenue
 * agent indexed TIER_LIMITS with the raw value and filtered on
 * ('free','starter','pro') — a legacy Starter org never got a nudge — and
 * priced MRR from its own table (Scale at $399, against the canonical $79).
 * Five founder MRR surfaces and the support-ops summary carried their own
 * price lists too ($49/$149/$399/$799; $59/$179/$449/$899 with a "sprout"
 * tier that does not exist).
 *
 * Behavioural for the revenue agent; then an AST gate over server/, shared/
 * and client/src: no element access keyed by a raw subscription tier, no cast
 * of one to a tier type, no comparison of one to a paid tier literal. The
 * only exemption is the alias table inside the fold itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const H = vi.hoisted(() => ({ orgs: [] as any[], paying: [] as any[], briefs: [] as any[], decisions: [] as any[] }));

vi.mock("../../server/storage", () => ({
  db: {
    execute: vi.fn(async (q: any) => {
      const text = JSON.stringify(q?.queryChunks ?? q);
      if (text.includes("lead_count")) return { rows: H.orgs };
      if (text.includes("GROUP BY subscription_tier")) return { rows: H.paying };
      return { rows: [] };
    }),
  },
}));
vi.mock("../../server/services/finance/runwayModel", () => ({ liveMrrDetail: vi.fn(async () => ({ cents: 15_800, payingOrgs: 2 })) }));
vi.mock("../../server/services/emailService", () => ({ emailService: { sendEmail: vi.fn() } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

beforeEach(() => {
  H.orgs = [];
  H.paying = [];
  H.briefs = [];
  H.decisions = [];
});

async function agent() {
  const { RevenueAgent } = await import("../../server/agents/revenue");
  const a: any = new RevenueAgent();
  a.logDecision = async (d: any) => { H.decisions.push(d); };
  a.storeBrief = async (type: string, content: any) => { H.briefs.push({ type, content }); };
  return a;
}

describe("revenue agent folds legacy tier names", () => {
  it("a legacy 'solo' org near its Starter lead limit gets the upgrade nudge", async () => {
    const { TIER_LIMITS } = await import("../../shared/billing/tier-limits");
    const cap = TIER_LIMITS.starter.leads!;
    H.orgs = [{ id: 9, name: "Legacy Solo", subscription_tier: "solo", lead_count: cap, property_count: 0, note_count: 0 }];
    await (await agent()).checkUsageLimits();
    expect(H.decisions.map((d) => d.data)).toEqual([expect.objectContaining({ orgId: 9, resource: "leads", tier: "starter" })]);
  });

  it("a legacy 'empire' (Scale) org is not nudged, and garbage reads as free", async () => {
    const { TIER_LIMITS } = await import("../../shared/billing/tier-limits");
    H.orgs = [
      { id: 1, name: "Empire", subscription_tier: "empire", lead_count: 10_000_000, property_count: 0, note_count: 0 },
      { id: 2, name: "Garbage", subscription_tier: "plat1num", lead_count: TIER_LIMITS.free.leads!, property_count: 0, note_count: 0 },
    ];
    await (await agent()).checkUsageLimits();
    expect(H.decisions.map((d) => [d.data.orgId, d.data.tier])).toEqual([[2, "free"]]);
  });

  it("the weekly brief's MRR is the canonical live MRR, and the breakdown is folded", async () => {
    H.paying = [
      { subscription_tier: "operator", count: 1 },
      { subscription_tier: "pro", count: 1 },
      { subscription_tier: "empire", count: 2 },
    ];
    await (await agent()).generateWeeklyRevenueBrief();
    const weekly = H.briefs.find((b) => b.type === "weekly")!.content;
    expect(weekly.mrrCents).toBe(15_800);
    expect(weekly.payingCustomers).toBe(2);
    expect(weekly.tierBreakdown).toEqual([{ tier: "pro", count: 2 }, { tier: "scale", count: 2 }]);
  });
});

describe("no raw subscription tier reaches a limit, a price or a ladder", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const RAW = /\b(subscriptionTier|subscription_tier)\b/;
  const PAID = /^["'](starter|pro|scale|solo|operator|empire)["']$/;
  /** The fold itself: its alias table is keyed by the raw value, by definition. */
  const EXEMPT = new Set(["shared/billing/tier-pricing.ts index SUBSCRIPTION_TIER_ALIASES[subscriptionTier.toLowerCase()]"]);

  function rawTierUses(file: string, text: string): string[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isElementAccessExpression(n) && RAW.test(n.argumentExpression.getText(sf))) out.push(`${file} index ${n.getText(sf)}`);
      if (ts.isAsExpression(n) && RAW.test(n.expression.getText(sf)) && /Tier/.test(n.type.getText(sf))) out.push(`${file} cast ${n.getText(sf)}`);
      if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) {
        const l = n.left.getText(sf);
        const r = n.right.getText(sf);
        if ((RAW.test(l) && PAID.test(r)) || (RAW.test(r) && PAID.test(l))) out.push(`${file} compare ${n.getText(sf)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out.filter((x) => !EXEMPT.has(x) && !/limitsTierFor\(|tierForSubscriptionTier\(/.test(x));
  }

  it("canaries: each shape is seen, and comments are not", () => {
    expect(rawTierUses("f.ts", `const a = TIER_LIMITS[org.subscriptionTier];`)).toHaveLength(1);
    expect(rawTierUses("f.ts", `const t = (org.subscriptionTier ?? "free") as SubscriptionTier;`)).toHaveLength(1);
    expect(rawTierUses("f.ts", `if (o.subscription_tier === "pro") {}`)).toHaveLength(1);
    expect(rawTierUses("f.tsx", `const x = <A tier={(o.subscriptionTier || "free") as TierKey} />;`)).toHaveLength(1);
    expect(rawTierUses("f.ts", `// TIER_LIMITS[org.subscriptionTier]\nconst a = TIER_LIMITS[limitsTierFor(org.subscriptionTier)];`)).toHaveLength(0);
  });

  it("holds over server/, shared/ and client/src (floor: the files that mention a tier)", () => {
    const files = execSync("git ls-files server shared client/src", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    let mentioning = 0;
    const found: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      if (!RAW.test(text)) continue;
      mentioning++;
      found.push(...rawTierUses(f, text));
    }
    expect(files.length).toBeGreaterThan(2400); // measured 2,518 on 2026-10-09
    expect(mentioning).toBeGreaterThan(85); // measured 93
    expect(found, found.join("\n")).toEqual([]);
  });
});
