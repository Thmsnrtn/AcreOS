/**
 * Quality directive 2026-09-29 (founder operation) — every funnel bar is the
 * same cohort as the signups bar.
 *
 * The onboarding-funnel page counted step completions over a 50-row,
 * unwindowed org list and set them beside a 30-day signup total: steps could
 * exceed signups, and old orgs counted in a "last 30 days" funnel. The
 * activation funnel divided by every org ever created — including yesterday's,
 * which had no chance to hit a 30-day milestone — plus the founder's own.
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({ rows: [] as unknown[], executed: [] as unknown[] }));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => S.rows }) }),
    execute: async (q: unknown) => {
      S.executed.push(q);
      return { rows: [] };
    },
  },
}));

const at = (d: string) => new Date(d);
const row = (orgId: string, steps: number, ttfv: number | null) => ({
  orgId,
  signupAt: at("2026-09-20"),
  timeToFirstValueSeconds: ttfv,
  abandonedAtStep: null,
  measuredDate: "2026-09-29",
  step1CompletedAt: steps >= 1 ? at("2026-09-20") : null,
  step2CompletedAt: steps >= 2 ? at("2026-09-20") : null,
  step3CompletedAt: steps >= 3 ? at("2026-09-20") : null,
  step4CompletedAt: steps >= 4 ? at("2026-09-20") : null,
  step5CompletedAt: steps >= 5 ? at("2026-09-20") : null,
});

describe("onboarding funnel", () => {
  it("step counts come from the same signup cohort, so no step can exceed signups", async () => {
    S.rows = [row("1", 5, 60), row("2", 2, null), row("3", 0, null)];
    const { getFunnelSummary } = await import("../../server/services/onboarding/firstValueInstrumentation");
    const s = await getFunnelSummary(30);
    expect(s.totalSignups).toBe(3);
    expect(s.stepCompletedCounts).toEqual({ 1: 2, 2: 2, 3: 1, 4: 1, 5: 1 });
    for (const n of Object.values(s.stepCompletedCounts)) expect(n).toBeLessThanOrEqual(s.totalSignups);
  });
});

describe("activation funnel cohort", () => {
  it("counts only orgs whose window has closed, excludes founder/system orgs and queue-written first_mailer_sent", async () => {
    const { getActivationFunnel } = await import("../../server/services/activation");
    await getActivationFunnel(30);
    const q = new PgDialect().sqlToQuery(S.executed[0] as never);
    const text = q.sql.replace(/\s+/g, " ");
    expect(text).toMatch(/created_at <= now\(\) - \(\$\d+::int \* INTERVAL '1 day'\)/);
    expect(text).toMatch(/coalesce\(is_founder, false\) = false/);
    expect(text).toMatch(/event_value->>'source', ''\) = 'outreach:mail:queue'/);
  });
});
