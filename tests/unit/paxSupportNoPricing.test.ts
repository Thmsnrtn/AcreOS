/**
 * apply_credit is unreachable for the model at every stance and every pause
 * state (AUTONOMY_SPEC.md §4.3, §7; founder decision 8, 2026-09-02).
 *
 * A credit on what the customer pays AcreOS is the founder's pricing
 * hard-stop (CLAUDE.md DO-NOT-DO list: "pricing changes … founder-only
 * forever"). It is therefore NOT a customer approval — a kernel ask would
 * put a pricing decision in front of the customer to tap — and not a model
 * decision. executeSupportTool refuses it before ANY gate, with one plain
 * sentence, and touches nothing: no Stripe balance, no memory row, no ask.
 *
 * Both halves are pinned, because either alone is satisfiable by a broken
 * fix:
 *   BEHAVIOUR  the full matrix — 2 stances × 3 pause states, plus the
 *              trusted-replay path — refuses, and the Stripe spy is never
 *              called; a positive control (retry_payment on the replay)
 *              proves the spy is wired, so "never called" is observed.
 *   SOURCE     the fix_type enum the model reads no longer offers
 *              apply_credit or an amount; the nested case label stays (the
 *              classification ratchets read it) and its body contains no
 *              Stripe write.
 *
 * Probe that must turn this red: re-enable the case (restore the
 * `stripe.customers.update` body and drop the guard at the top of
 * executeSupportTool).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const H = vi.hoisted(() => ({
  getPaxControls: vi.fn(async () => ({
    stance: "ask_before_sending" as "ask_before_sending" | "ask_before_everything",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  })),
  proposePendingAction: vi.fn(async (input: any) => ({ id: 77, status: "pending", ...input })),
  stripeInvoicesPay: vi.fn(async () => ({ id: "in_1", status: "paid" })),
  stripeCustomersUpdate: vi.fn(async () => ({})),
  dbInsertValues: vi.fn(async () => undefined),
  recordPaxEffect: vi.fn(async () => ({ written: true })),
}));

vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: H.getPaxControls };
});
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: H.dbInsertValues }),
  },
}));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/services/approvalKernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/approvalKernel")>();
  return { ...actual, proposePendingAction: H.proposePendingAction };
});
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: H.recordPaxEffect }));
vi.mock("../../server/storage", () => ({ storage: { logActivity: vi.fn() }, db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("openai", () => ({ default: class {} }));
vi.mock("stripe", () => ({
  default: class {
    invoices = { pay: H.stripeInvoicesPay, voidInvoice: vi.fn() };
    customers = { update: H.stripeCustomersUpdate };
    billingPortal = { sessions: { create: vi.fn(async () => ({ url: "https://billing" })) } };
  },
}));
vi.mock("../../server/stripeClient", () => ({ subscriptionPeriodIso: vi.fn(), STRIPE_API_VERSION: "2024-06-20" }));
vi.mock("../../server/services/decisionsInbox", () => ({ decisionsInboxService: {} }));
vi.mock("../../server/services/data-source-broker.js", () => ({ dataSourceBroker: {} }));
vi.mock("../../server/services/propertyEnrichment.js", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/complianceValidator", () => ({ validateCompliance: vi.fn() }));
vi.mock("../../server/services/aiSpendGuard", () => ({ assertAiSpendAllowed: vi.fn(), recordExternalAiSpend: vi.fn() }));

import { executeSupportTool, supportToolDefinitions, APPLY_CREDIT_REFUSAL } from "../../server/ai/supportAgent";

const org = { id: 7, name: "Test Org", ownerId: "u-owner", stripeCustomerId: "cus_1" } as any;
const CREDIT = { fix_type: "apply_credit", amount_cents: 500, reason: "goodwill" };

type Stance = "ask_before_sending" | "ask_before_everything";
type PauseState = "active" | "paused" | "check_failed";

const STANCES: Stance[] = ["ask_before_sending", "ask_before_everything"];
const PAUSE_STATES: PauseState[] = ["active", "paused", "check_failed"];

function setState(stance: Stance, pause: PauseState) {
  H.getPaxControls.mockResolvedValue({
    stance,
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: pause !== "active",
    pausedUntil: pause === "paused" ? new Date(Date.now() + 3600_000) : null,
    pausedBy: null,
    checkFailed: pause === "check_failed",
    timezone: "America/Chicago",
  });
}

const matrix = STANCES.flatMap((s) => PAUSE_STATES.map((p) => [s, p] as const));

beforeEach(() => {
  vi.clearAllMocks();
  setState("ask_before_sending", "active");
});

describe("apply_credit — refused before any gate, everywhere", () => {
  it("vacuity: the matrix covers every stance × every pause state", () => {
    expect(matrix).toHaveLength(6);
  });

  it.each(matrix)("stance %s, pause %s: refuses with the one sentence; Stripe, memory and the kernel untouched", async (stance, pause) => {
    setState(stance, pause);
    const result = await executeSupportTool("apply_billing_fix", { ...CREDIT }, org, 12, { origin: "support", userId: "u-1" });
    expect(result.success).toBe(false);
    expect(result.error).toBe(APPLY_CREDIT_REFUSAL);
    expect(result.error).toContain("a person will review this");
    expect(H.stripeCustomersUpdate).not.toHaveBeenCalled();
    expect(H.stripeInvoicesPay).not.toHaveBeenCalled();
    expect(H.dbInsertValues).not.toHaveBeenCalled();
    expect(H.proposePendingAction).not.toHaveBeenCalled();
    expect(H.recordPaxEffect).not.toHaveBeenCalled();
    // Before ANY gate: the controls are not consulted for it.
    expect(H.getPaxControls).not.toHaveBeenCalled();
  });

  it("even the trusted replay cannot apply a credit (no frozen row could exist, and none would run)", async () => {
    const result = await executeSupportTool("apply_billing_fix", { ...CREDIT }, org, 12, {
      trustedApproval: true,
      origin: "approval_replay",
      userId: "u-1",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(APPLY_CREDIT_REFUSAL);
    expect(H.stripeCustomersUpdate).not.toHaveBeenCalled();
  });

  it("positive control: the Stripe spy IS wired — retry_payment on the replay reaches invoices.pay", async () => {
    // The caller is the ORG OWNER. Since 2026-09-04 executeSupportTool checks
    // the permission ladder like tools.ts does, and apply_billing_fix requires
    // `financial_write`. `trustedApproval` deliberately does NOT bypass that —
    // tools.ts states the rule in its own gate: a human tapping Approve on a
    // frozen action is a witnessed send, not evidence that the human holds the
    // permission. So the positive control needs a caller who actually does;
    // "u-1" holds nothing, which is now a refusal rather than a pass.
    const result = await executeSupportTool(
      "apply_billing_fix",
      { fix_type: "retry_payment", invoice_id: "in_1", reason: "card updated" },
      org,
      12,
      { trustedApproval: true, origin: "approval_replay", userId: "u-owner" },
    );
    expect(result.success).toBe(true);
    expect(H.stripeInvoicesPay).toHaveBeenCalledWith("in_1");
    // And without the tap it freezes (always-ask) — so the refusal above is
    // a refusal, not "everything refuses".
    const ask = await executeSupportTool(
      "apply_billing_fix",
      { fix_type: "retry_payment", invoice_id: "in_1", reason: "card updated" },
      org,
      12,
      { origin: "support" },
    );
    expect(ask.data?.pendingApproval).toBe(true);
  });
});

describe("apply_credit — the source the model reads", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const src = stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, "server/ai/supportAgent.ts"), "utf8"));

  it("the fix_type enum offers no credit and no amount", () => {
    const def = supportToolDefinitions.apply_billing_fix as any;
    const fixTypes: string[] = def.parameters.properties.fix_type.enum;
    expect(fixTypes.length, "the enum went empty").toBeGreaterThan(0);
    expect(fixTypes).not.toContain("apply_credit");
    expect(def.parameters.properties.amount_cents).toBeUndefined();
    expect(def.description).toContain("Requires customer confirmation");
  });

  it("the nested case label stays for the classification ratchets, and its body writes nothing", () => {
    const at = src.indexOf('case "apply_credit": {');
    expect(at, "the apply_credit label vanished — paxPauseSupportGate's GATED list would go stale").toBeGreaterThan(-1);
    // The body: up to the next nested case label.
    const end = src.indexOf("case ", at + 10);
    const body = src.slice(at, end);
    expect(body).not.toContain("stripe.customers.update");
    expect(body).not.toContain("db.insert(");
    expect(body).toContain("APPLY_CREDIT_REFUSAL");
  });

  it("the guard runs before the controls read and before the switch", () => {
    const fnAt = src.indexOf("export async function executeSupportTool(");
    const guardAt = src.indexOf("asksForCredit(toolName, args)", fnAt);
    const readAt = src.indexOf("await getPaxControls(org.id)", fnAt);
    const switchAt = src.indexOf("switch (toolName)", fnAt);
    expect(guardAt).toBeGreaterThan(fnAt);
    expect(guardAt).toBeLessThan(readAt);
    expect(readAt).toBeLessThan(switchAt);
  });
});
