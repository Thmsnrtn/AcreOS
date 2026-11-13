/**
 * P1-5 / I-5 R4 — founder alerting when an AI cost ceiling trips.
 * Pins: first trip per scope per day emails the founder naming the
 * scope; repeats are suppressed; FOUNDER_ALERT_EMAIL unset → log-only,
 * no send attempted; a failing send never throws back into the gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  // Typed parameter: an unparameterised vi.fn leaves mock.calls as an
  // empty tuple, so mock.calls[0][0] is a TS2493/TS2352 pair under
  // check:tests. The shape mirrors what notifyAiCeilingTrip passes.
  sendEmail: vi.fn(
    async (_options: { to: string; subject: string; html: string; from?: string; fromName?: string; idempotencyKey?: string; organizationId?: number }) => ({ success: true }),
  ),
  errorLogs: [] as string[],
  warnLogs: [] as string[],
}));

vi.mock("../../server/services/emailService", () => ({ emailService: { sendEmail: h.sendEmail } }));
vi.mock("../../server/utils/logger", () => ({
  logger: {
    error: (msg: string) => { h.errorLogs.push(String(msg)); },
    warn: (msg: string) => { h.warnLogs.push(String(msg)); },
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { notifyAiCeilingTrip, __resetAiCostAlertDedupForTests } from "../../server/services/aiCostAlert";

const ORIG_ENV = { ...process.env };
const TRIP = { scope: "platform_background" as const, orgId: null, windowKey: "daily" as const, currentCents: 1100, ceilingCents: 1050 };

describe("aiCostAlert — founder trip alerting (R4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.errorLogs.length = 0;
    h.warnLogs.length = 0;
    __resetAiCostAlertDedupForTests();
    process.env.FOUNDER_ALERT_EMAIL = "founder@example.test";
    delete process.env.AI_COST_ALERT_FROM;
    h.sendEmail.mockResolvedValue({ success: true });
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("emails the founder on the first trip, naming the scope and the numbers", async () => {
    await notifyAiCeilingTrip(TRIP);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const arg = h.sendEmail.mock.calls[0][0];
    expect(arg.to).toBe("founder@example.test");
    expect(arg.subject).toContain("70%");
    expect(arg.html).toContain("$11.00");
    expect(arg.html).toContain("$10.50");
    // Protected send: the idempotency key IS the dedup identity
    // (scope:orgId:UTC-day); a platform trip has no org to scope to.
    const today = new Date().toISOString().slice(0, 10);
    expect(arg.idempotencyKey).toBe(`ai-cost-alert:platform_background:platform:${today}`);
    expect(arg.organizationId).toBeUndefined();
    expect(h.errorLogs.some((m) => m.includes("[ai-cost-alert]"))).toBe(true);
  });

  it("suppresses repeat trips for the same scope on the same day", async () => {
    await notifyAiCeilingTrip(TRIP);
    await notifyAiCeilingTrip(TRIP);
    await notifyAiCeilingTrip({ ...TRIP, currentCents: 1400 });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a different scope the same day still alerts", async () => {
    await notifyAiCeilingTrip(TRIP);
    await notifyAiCeilingTrip({ scope: "org_background", orgId: 7, windowKey: "background_monthly", currentCents: 1000, ceilingCents: 1000 });
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    const second = h.sendEmail.mock.calls[1][0];
    expect(second.subject).toContain("org 7");
    // An org trip scopes the outward-action claim to that org, with the
    // same dedup-derived key.
    const today = new Date().toISOString().slice(0, 10);
    expect(second.idempotencyKey).toBe(`ai-cost-alert:org_background:7:${today}`);
    expect(second.organizationId).toBe(7);
  });

  it("FOUNDER_ALERT_EMAIL unset → log-only, no send attempted, still resolves", async () => {
    delete process.env.FOUNDER_ALERT_EMAIL;
    await expect(notifyAiCeilingTrip(TRIP)).resolves.toBeUndefined();
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.warnLogs.some((m) => m.includes("FOUNDER_ALERT_EMAIL is unset"))).toBe(true);
  });

  it("a failing send never throws back into the gate", async () => {
    h.sendEmail.mockResolvedValue({ success: false, error: "smtp down", errorType: "permanent" } as never);
    await expect(notifyAiCeilingTrip(TRIP)).resolves.toBeUndefined();
  });
});
