/**
 * The borrower ladder asks through the kernel — and the level machinery is
 * gone (AUTONOMY_SPEC.md §4.4 "Borrower ladder DISPATCH", §4.5, §7;
 * founder decision 2026-09-02 #3: prepare only, every rung waits for a tap).
 *
 * THE DEFECT IT GUARDS
 * ────────────────────
 * Before wave 1 the ladder parked a reminder row `awaiting_approval` and
 * NOTHING else happened: no queue row, no badge, no card — a second approval
 * store nobody read (spec confusion: "one queue"). And the parking hinged on
 * `organizations.paxAutonomyLevel`, a column with no writer, whose
 * `unattendedSendPermitted` reading would have dispatched a borrower
 * collection notice unattended for any org that somehow stored "supervised".
 *
 * WHAT IS ASSERTED
 * ────────────────
 *   Source (population = every `REMINDER_STATUS.awaitingApproval` WRITE in
 *   financeAgent.ts, derived; vacuity ≥ 1):
 *   - each write is paired with a `proposePendingAction(` call inside the
 *     same function, BEFORE the write (probe: remove the pairing → red)
 *   - the proposal freezes noteId + reminderId + type on the row and names
 *     origin "finance_ladder" (frozen cross-agent contract 2)
 *   - repo-wide zero hits on paxAutonomyLevel / unattendedSendPermitted /
 *     getOrgAutonomyLevel in production code and tests (the schema column
 *     itself is the ONE tolerated residue until wave 2's drop migration)
 *
 *   Behaviour (the REAL service, stores stood up as doubles):
 *   - a rung nobody tapped → proposePendingAction called with the contract
 *     shape, the row reads awaiting_approval, NO rail is touched
 *   - a tapped rung (humanApproved) → no proposal, the rail IS reached
 *   - paused org → queued with the glossary refusal, no proposal, no rail
 *   - staging: paused → { created: false, reason: "pax_paused" };
 *     borrowerReminders off → reason "pax_off"; nothing written either way
 *   - sendManualReminder dispatches the PARKED row when one exists (one
 *     notice, one row) and creates a fresh one only when none is parked
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const H = vi.hoisted(() => ({
  getPaxControls: vi.fn(async (_orgId: number): Promise<PaxControlsState> => ({
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null as { userId: string; name: string } | null,
    checkFailed: false,
    stance: "ask_before_sending" as const,
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    timezone: "America/Chicago",
  })),
  proposePendingAction: vi.fn(async (params: any) => ({ id: 901, ...params })),
  recordPaxEffect: vi.fn(async (_effect: PaxEffect) => ({ written: true })),
  sendToLead: vi.fn(async (_options: CommunicationOptions) => ({ success: true, channel: "email" })),
  checkSendRateLimit: vi.fn(async () => ({ allowed: true })),
  recordAutonomousSend: vi.fn(async () => undefined),
  storage: {
    getNote: vi.fn(async (_orgId: number, _noteId: number) => null as any),
    getLead: vi.fn(async () => null as any),
    updateNote: vi.fn(async () => undefined),
    recordReminderOutcome: vi.fn(
      async (_id: number, _outcome: { status: string; reason?: string | null; acceptedBy?: string | null }) =>
        undefined,
    ),
    findLadderReminder: vi.fn(async () => undefined as any),
    createPaymentReminder: vi.fn(async (r: any) => ({ id: 77, ...r })),
    getOrganizationIntegration: vi.fn(async () => null),
    getOrganization: vi.fn(async () => ({ id: 7, name: "Acme Land" })),
  },
  selectRows: [] as any[],
}));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => {
  const chain: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (onF: any, onR: any) => Promise.resolve(H.selectRows).then(onF, onR);
  return { storage: H.storage, db: { select: () => chain } };
});
vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: H.getPaxControls };
});
vi.mock("../../server/services/approvalKernel", () => ({
  proposePendingAction: H.proposePendingAction,
}));
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: H.recordPaxEffect }));
vi.mock("../../server/services/communications", () => ({
  communicationsService: { sendToLead: H.sendToLead },
}));
vi.mock("../../server/services/autonomyGuardrails", () => ({
  checkSendRateLimit: H.checkSendRateLimit,
  recordAutonomousSend: H.recordAutonomousSend,
}));
vi.mock("../../server/services/orgEmailIdentity", () => ({
  getIdentityForSend: async () => ({ fromEmail: "owner@acme-land.com" }),
}));
vi.mock("../../server/services/integrationCredentials", () => ({
  readIntegrationCredentials: () => null,
}));
vi.mock("../../server/services/credits", () => ({ usageMeteringService: { recordUsage: vi.fn() } }));
vi.mock("../../server/services/systemActivityLogger", () => ({ logActivity: vi.fn() }));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: () => null }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { financeAgentService, REMINDER_STATUS } from "../../server/services/financeAgent";
import type { PaxControlsState } from "../../server/services/paxControls";
import type { PaxEffect } from "../../server/services/paxReceipts";
import type { CommunicationOptions } from "../../server/services/communications";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ORG_ID = 7;
const PAUSED_UNTIL = new Date(Date.now() + 6 * 60 * 60 * 1000);

function controls(over: Partial<PaxControlsState> = {}): PaxControlsState {
  return {
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    stance: "ask_before_sending" as const,
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    timezone: "America/Chicago",
    ...over,
  };
}

const ACTIVE_NOTE = {
  id: 12,
  organizationId: ORG_ID,
  status: "active",
  borrowerId: 42,
  nextPaymentDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  reminderCount: 0,
  currentBalance: "1000",
} as any;

const BORROWER = { id: 42, organizationId: ORG_ID, email: "borrower@example.com", firstName: "Bill" } as any;

const REMINDER = {
  id: 501,
  organizationId: ORG_ID,
  noteId: 12,
  borrowerId: 42,
  type: "late",
  channel: "email",
  content: "Your payment is past due.",
};

beforeEach(() => {
  vi.clearAllMocks();
  H.selectRows = [];
  H.getPaxControls.mockResolvedValue(controls());
  H.storage.getNote.mockResolvedValue(ACTIVE_NOTE);
  H.storage.getLead.mockResolvedValue(BORROWER);
  H.storage.findLadderReminder.mockResolvedValue(undefined);
});

// ── Source: every awaiting_approval write is paired with a kernel proposal ──

describe("source: every REMINDER_STATUS.awaitingApproval write is paired with proposePendingAction", () => {
  const code = stripComments(read("server/services/financeAgent.ts"));
  // A WRITE is a `finish(REMINDER_STATUS.awaitingApproval` or a
  // `status: REMINDER_STATUS.awaitingApproval` — the tally's `case` label in
  // dispatchDueReminders is a READ and is not counted.
  const writes = [...code.matchAll(/(finish\(\s*|status:\s*)REMINDER_STATUS\.awaitingApproval/g)].map((m) => m.index!);

  it("vacuity: the population is non-empty and the tally read is excluded", () => {
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(code).toContain("case REMINDER_STATUS.awaitingApproval:");
  });

  it.each(writes.map((at, i) => [i, at] as const))(
    "write #%i sits inside a function that proposed a kernel ask before it",
    (_i, at) => {
      // The enclosing function: the nearest `async <name>(` above the write.
      const before = code.slice(0, at);
      const fnStart = Math.max(before.lastIndexOf("\n  async "), before.lastIndexOf("\n  private async "));
      expect(fnStart).toBeGreaterThan(-1);
      const fnBody = code.slice(fnStart, at);
      const proposeAt = fnBody.indexOf("proposePendingAction(");
      expect(proposeAt, "an awaiting_approval parking with no kernel ask beside it — the row would wait in a store nobody reads").toBeGreaterThan(-1);
      // The proposal is awaited, names the ladder's tool, freezes noteId + reminderId + type, and states its origin.
      const proposal = fnBody.slice(proposeAt);
      expect(fnBody.slice(proposeAt - 40, proposeAt)).toMatch(/await\s+$/);
      expect(proposal).toContain('toolName: "send_borrower_reminder"');
      expect(proposal).toMatch(/args:\s*\{[^}]*reminderId[^}]*noteId[^}]*type[^}]*\}/);
      expect(proposal).toContain('origin: "finance_ladder"');
      expect(proposal).toMatch(/sourceRef:\s*\{[^}]*noteId[^}]*borrowerId[^}]*reminderId[^}]*\}/);
    },
  );

  it("the pairing is gated on the human's tap, not on any level", () => {
    const dispatch = code.indexOf("async dispatchReminder(");
    const body = code.slice(dispatch, code.indexOf("\n  private subjectForStage", dispatch));
    expect(body).toContain("if (!options.humanApproved)");
    expect(body).not.toMatch(/autonomy|assisted|supervised/);
  });
});

// ── Source: the level machinery is gone, repo-wide ──────────────────────────

describe("zero hits: paxAutonomyLevel / unattendedSendPermitted / getOrgAutonomyLevel", () => {
  const NAMES = ["paxAutonomyLevel", "unattendedSendPermitted", "getOrgAutonomyLevel"];
  /**
   * The ONE tolerated residue: the column definition itself, dropped by a
   * wave-2 migration once this ratchet is green (spec §3d, §4.1). Its line
   * in shared/schema.ts may mention the name; nothing else may.
   */
  const COLUMN_DEFINITION = /^\s*paxAutonomyLevel:\s*varchar\("pax_autonomy_level"/m;
  /**
   * The second tolerated form: an assertion that a name is ABSENT. This scan
   * hunts READERS and WRITERS, and `expect(src.includes("X")).toBe(false)` is
   * neither — it is another gate enforcing the same deletion (approvalKernel
   * .test.ts pins that tools.ts no longer carries the level branches). Left
   * unstripped, one gate's evidence reads as another gate's violation and the
   * only way to green is to delete an enforcement. Narrow by construction: it
   * strips the single assertion form, so ANY other mention in the same file
   * still fails.
   */
  const ABSENCE_ASSERTION = /expect\(\s*\w+(?:\.\w+)*\.includes\(\s*(["'`])(?:paxAutonomyLevel|unattendedSendPermitted|getOrgAutonomyLevel)\1\s*\)\s*\)\.toBe\(false\)/g;

  function* walk(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", ".git", "ratchets"].includes(entry.name)) continue;
        yield* walk(full);
      } else if (/\.(ts|tsx|mjs|js|sql)$/.test(entry.name)) {
        yield full;
      }
    }
  }

  // Parked as `it.todo` while wave 1 was mid-flight: at agent B's last run the
  // remaining hits were all in files A and C had not yet landed. Central
  // verification flipped it back on once all six slices were committed
  // (2026-09-04) — the assertion body was never weakened.
  it("no production file, script or test names the deleted level machinery (vacuity: the walk is real)", () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const dir of ["server", "shared", "client", "scripts", "tests"]) {
      for (const full of walk(path.join(ROOT, dir))) {
        scanned++;
        const rel = path.relative(ROOT, full).split(path.sep).join("/");
        if (rel === "tests/unit/financeLadderAsksThroughKernel.test.ts") continue;
        let src = fs.readFileSync(full, "utf-8");
        if (rel === "shared/schema.ts") src = src.replace(COLUMN_DEFINITION, "");
        src = src.replace(ABSENCE_ASSERTION, "");
        src = stripComments(src);
        for (const name of NAMES) {
          if (src.includes(name)) hits.push(`${rel}: ${name}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(1000);
    expect(hits, "the autonomy-level machinery must have zero readers and zero writers (schema column definition excepted until its drop migration)").toEqual([]);
  });
});

// ── Behaviour: dispatch parks through the kernel ─────────────────────────────

describe("dispatchReminder — a rung nobody tapped parks as a kernel ask; a tap dispatches", () => {
  it("untapped → proposePendingAction with the frozen contract, row awaiting_approval, no rail touched", async () => {
    const outcome = await financeAgentService.dispatchReminder(REMINDER);

    expect(outcome.status).toBe(REMINDER_STATUS.awaitingApproval);
    expect(H.proposePendingAction).toHaveBeenCalledTimes(1);
    expect(H.proposePendingAction.mock.calls[0][0]).toEqual({
      organizationId: ORG_ID,
      toolName: "send_borrower_reminder",
      args: { reminderId: 501, noteId: 12, type: "late" },
      origin: "finance_ladder",
      sourceRef: { noteId: 12, borrowerId: 42, reminderId: 501 },
    });
    expect(H.sendToLead).not.toHaveBeenCalled();
    expect(H.storage.updateNote).not.toHaveBeenCalled();
    const [id, recorded] = H.storage.recordReminderOutcome.mock.calls[0];
    expect(id).toBe(501);
    expect(recorded.status).toBe("awaiting_approval");
    expect(recorded.reason).toContain("Waiting for your tap");
    expect(recorded.reason).not.toMatch(/autonomy|assisted|Pax controls/);
    // The parking leaves a receipt naming the ask it created.
    expect(H.recordPaxEffect).toHaveBeenCalledTimes(1);
    expect(H.recordPaxEffect.mock.calls[0][0]).toMatchObject({
      orgId: ORG_ID,
      actor: "rule",
      engine: "borrower_dispatch",
      entityType: "payment_reminder",
      entityId: 501,
      witnessed: false,
      after: { pendingActionId: 901 },
    });
  });

  it("tapped (humanApproved) → no proposal, the rail is reached, the row reads sent", async () => {
    const outcome = await financeAgentService.dispatchReminder(REMINDER, { humanApproved: true });

    expect(outcome.status).toBe(REMINDER_STATUS.sent);
    expect(H.proposePendingAction).not.toHaveBeenCalled();
    expect(H.sendToLead).toHaveBeenCalledTimes(1);
    expect(H.sendToLead.mock.calls[0][0]).toMatchObject({ organizationId: ORG_ID, leadId: 42, channel: "email" });
    const [, recorded] = H.storage.recordReminderOutcome.mock.calls[0];
    expect(recorded.status).toBe("sent");
    expect(recorded.acceptedBy).toBe("email");
  });

  it("paused org → queued with the glossary refusal; no proposal, no rail — even when tapped", async () => {
    H.getPaxControls.mockResolvedValue(controls({ paused: true, pausedUntil: PAUSED_UNTIL, pausedBy: { userId: "u-2", name: "Maria Lopez" } }));

    for (const options of [{}, { humanApproved: true }]) {
      H.storage.recordReminderOutcome.mockClear();
      const outcome = await financeAgentService.dispatchReminder(REMINDER, options);
      expect(outcome.status).toBe(REMINDER_STATUS.queued);
      expect(outcome.reason).toContain("Pax is paused until");
      expect(outcome.reason).toContain("Maria Lopez");
      expect(outcome.reason).not.toContain(PAUSED_UNTIL.toISOString());
      expect(outcome.reason).toMatch(/Settings → Pax\b/);
    }
    expect(H.proposePendingAction).not.toHaveBeenCalled();
    expect(H.sendToLead).not.toHaveBeenCalled();
  });

  it("failed controls read → fails CLOSED: queued with 'could not verify'", async () => {
    H.getPaxControls.mockResolvedValue(controls({ paused: true, checkFailed: true, stance: "ask_before_everything", borrowerReminders: false }));
    const outcome = await financeAgentService.dispatchReminder(REMINDER);
    expect(outcome.status).toBe(REMINDER_STATUS.queued);
    expect(outcome.reason).toContain("could not verify");
    expect(H.sendToLead).not.toHaveBeenCalled();
    expect(H.proposePendingAction).not.toHaveBeenCalled();
  });

  it("the stance does not change the answer: a rung waits for a tap at both stances", async () => {
    for (const stance of ["ask_before_sending", "ask_before_everything"] as const) {
      H.proposePendingAction.mockClear();
      H.getPaxControls.mockResolvedValue(controls({ stance }));
      const outcome = await financeAgentService.dispatchReminder(REMINDER);
      expect(outcome.status).toBe(REMINDER_STATUS.awaitingApproval);
      expect(H.proposePendingAction).toHaveBeenCalledTimes(1);
    }
    expect(H.sendToLead).not.toHaveBeenCalled();
  });
});

// ── Behaviour: staging honours pause and the switch ─────────────────────────

describe("ensureLadderRung — nothing is prepared while paused or while the switch is off", () => {
  it("paused → { created: false, reason: 'pax_paused' }, no row written, no receipt", async () => {
    H.getPaxControls.mockResolvedValue(controls({ paused: true, pausedUntil: PAUSED_UNTIL }));
    const result = await financeAgentService.ensureLadderRung(ACTIVE_NOTE, BORROWER);
    expect(result).toMatchObject({ created: false, reason: "pax_paused" });
    expect(H.storage.createPaymentReminder).not.toHaveBeenCalled();
    expect(H.recordPaxEffect).not.toHaveBeenCalled();
  });

  it("borrowerReminders off → reason 'pax_off', nothing written", async () => {
    H.getPaxControls.mockResolvedValue(controls({ borrowerReminders: false }));
    const result = await financeAgentService.ensureLadderRung(ACTIVE_NOTE, BORROWER);
    expect(result).toMatchObject({ created: false, reason: "pax_off" });
    expect(H.storage.createPaymentReminder).not.toHaveBeenCalled();
  });

  it("on → the rung is prepared (status scheduled, never sent) and leaves a 'prepared' receipt", async () => {
    const result = await financeAgentService.ensureLadderRung(ACTIVE_NOTE, BORROWER);
    expect(result.created).toBe(true);
    expect(H.storage.createPaymentReminder).toHaveBeenCalledTimes(1);
    const row = H.storage.createPaymentReminder.mock.calls[0][0];
    expect(row.status).toBe("scheduled");
    expect(row.organizationId).toBe(ORG_ID);
    expect(H.recordPaxEffect).toHaveBeenCalledTimes(1);
    expect(H.recordPaxEffect.mock.calls[0][0]).toMatchObject({
      engine: "borrower_staging",
      actor: "rule",
      stance: "ask_before_sending",
      entityType: "payment_reminder",
      entityId: 77,
      witnessed: false,
    });
    expect(H.sendToLead).not.toHaveBeenCalled();
  });

  it("controls handed in by the caller are used — no second read", async () => {
    await financeAgentService.ensureLadderRung(ACTIVE_NOTE, BORROWER, new Date(), controls({ paused: true }));
    expect(H.getPaxControls).not.toHaveBeenCalled();
    expect(H.storage.createPaymentReminder).not.toHaveBeenCalled();
  });
});

// ── Behaviour: the tap lands on the parked row ──────────────────────────────

describe("sendManualReminder — the tap dispatches the parked row (one notice, one row)", () => {
  it("a parked awaiting_approval row for (note, type) is dispatched with humanApproved; no new row is minted", async () => {
    H.selectRows = [{ id: 501, borrowerId: 42, type: "late", channel: "email", content: "Your payment is past due." }];

    const result = await financeAgentService.sendManualReminder(12, ORG_ID, "late");

    expect(result.success).toBe(true);
    expect(result.reminderId).toBe(501);
    expect(result.status).toBe(REMINDER_STATUS.sent);
    expect(H.storage.createPaymentReminder).not.toHaveBeenCalled();
    expect(H.proposePendingAction).not.toHaveBeenCalled();
    expect(H.sendToLead).toHaveBeenCalledTimes(1);
    expect(H.storage.recordReminderOutcome.mock.calls[0][0]).toBe(501);
  });

  it("no parked row → a fresh row is created and dispatched with humanApproved, as before", async () => {
    H.selectRows = [];
    const result = await financeAgentService.sendManualReminder(12, ORG_ID, "due");
    expect(result.success).toBe(true);
    expect(result.reminderId).toBe(77);
    expect(H.storage.createPaymentReminder).toHaveBeenCalledTimes(1);
    expect(H.proposePendingAction).not.toHaveBeenCalled();
    expect(H.sendToLead).toHaveBeenCalledTimes(1);
  });
});
