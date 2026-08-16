/**
 * §1026.41 statement delivery — the BYO-identity block.
 *
 * Founder decision 2026-07-17 ("no re-fronting platform send rails") makes
 * the borrower statement email a COUNTERPARTY send: it is regulated lender
 * correspondence, branded "Sent by <org>", addressed to the org's own
 * borrower. Labelling it `purpose: "counterparty"` means emailService
 * REFUSES the send when the org has no connected identity, instead of
 * quietly putting AcreOS's @acreos.io identity on it.
 *
 * Founder ruling 2026-08-16 ("New state + founder alert") is what these
 * tests pin:
 *
 *   1. The refusal lands in its OWN terminal state,
 *      `blocked_no_org_identity` — not `failed`, which would retry a
 *      statutory statement forever against an org that cannot satisfy the
 *      precondition by retrying, and not `suppressed`, which would blame
 *      the borrower for the org's missing mailbox.
 *   2. A row in that state is NOT retried: re-entering the notifier
 *      returns before SES is touched.
 *   3. A founder/org alert is raised through the repo's one alert spine,
 *      NAMING the org and COUNTING the affected borrowers from real rows.
 *   4. The discriminator does not over-capture: a genuine SES
 *      configuration failure (which also categorises to
 *      "configuration_error", but from inside the retry loop) still lands
 *      in `failed` and stays retryable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── In-memory rows the db mock reads from ──────────────────────────────
type StatementRow = {
  id: string;
  loanId: string;
  loanType: string;
  organizationId: number;
  cycleStart: string;
  cycleEnd: string;
  dueDate: string;
  amountDueCents: number;
  deliveryStatus: string;
  deliveredAt: Date | null;
  deliveryMethod: string | null;
  deliveryError: string | null;
};

type NoteRow = { id: number; organizationId: number; borrowerId: number | null };
type LeadRow = {
  id: number;
  organizationId: number;
  firstName: string | null;
  email: string | null;
};

const STATEMENTS = new Map<string, StatementRow>();
const NOTES = new Map<number, NoteRow>();
const LEADS = new Map<number, LeadRow>();

/** The row the notifier is operating on — the only row it ever updates. */
let updateTargetId = "stmt-1";
let lastUpdateValues: Partial<StatementRow> | null = null;

/** When true, the blocked-scope count query throws (count derivation fails). */
let failScopeQuery = false;

/** Result the mocked emailService returns. Each test installs its own. */
let sendEmailSpy = vi.fn(async (_opts: unknown) => ({
  success: true,
  messageId: "m-1",
  attempts: 1,
}));

const raiseAlertSpy = vi.fn(async (_input: unknown) => ({
  paged: false,
  findingRecorded: true,
  systemAlertWritten: true,
}));

vi.mock("../emailService", () => ({
  emailService: { sendEmail: (opts: unknown) => sendEmailSpy(opts) },
}));

vi.mock("../alertSpine", () => ({
  raiseAlert: (input: unknown) => raiseAlertSpy(input),
}));

vi.mock("../../storage", () => ({
  storage: {
    getLead: async (orgId: number, id: number) => {
      const row = LEADS.get(id);
      if (!row || row.organizationId !== orgId) return undefined;
      return row;
    },
    getOrganization: async (id: number) => ({
      id,
      name: "Ridgeline Capital",
      settings: {},
    }),
  },
}));

// db mock. Unlike delivery.test.ts (which dispatches by select-call
// ORDER), this one dispatches on the table handed to .from() plus whether
// .limit() was called — the module now issues four distinct select shapes
// and call-order dispatch would be silently wrong the moment one moves.
//
//   periodicStatements + limit(1) → the by-id re-read
//   periodicStatements, no limit  → the blocked-scope count query
//   notes + limit(1)              → the note behind this statement
//   notes, no limit               → the borrower ids behind blocked rows
vi.mock("../../db", () => {
  const db = {
    select: (_projection?: unknown) => {
      const state: { table: unknown; limited: boolean } = {
        table: null,
        limited: false,
      };
      const step: any = {
        from: (t: unknown) => {
          state.table = t;
          return step;
        },
        where: (_p: unknown) => step,
        limit: (_n: number) => {
          state.limited = true;
          return step;
        },
        then: (onFulfilled: any, onRejected: any) => {
          const name = tableName(state.table);
          let rows: unknown[];
          if (name === "periodic_statements") {
            rows = state.limited
              ? // by-id re-read: the notifier always asks for the row it
                // was called with.
                [STATEMENTS.get(updateTargetId)].filter(Boolean)
              : failScopeQuery
                ? (() => {
                    throw new Error("simulated count-query failure");
                  })()
                : // blocked-scope query: every blocked row in the org.
                  Array.from(STATEMENTS.values()).filter(
                    (s) => s.deliveryStatus === "blocked_no_org_identity",
                  );
          } else if (name === "notes") {
            rows = state.limited
              ? [
                  NOTES.get(
                    Number(STATEMENTS.get(updateTargetId)?.loanId ?? NaN),
                  ),
                ].filter(Boolean)
              : // borrower resolution for the blocked loans.
                Array.from(STATEMENTS.values())
                  .filter((s) => s.deliveryStatus === "blocked_no_org_identity")
                  .map((s) => NOTES.get(Number(s.loanId)))
                  .filter(Boolean);
          } else {
            throw new Error(`unexpected table in select(): ${String(name)}`);
          }
          return Promise.resolve(rows).then(onFulfilled, onRejected);
        },
      };
      return step;
    },
    update: (_table: unknown) => ({
      set: (values: Partial<StatementRow>) => ({
        where: (_pred: unknown) => {
          const row = STATEMENTS.get(updateTargetId);
          if (row) {
            STATEMENTS.set(updateTargetId, { ...row, ...values });
            lastUpdateValues = values;
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

/** Read a drizzle pg-table's SQL name without importing drizzle internals. */
function tableName(table: unknown): string | undefined {
  if (!table || typeof table !== "object") return undefined;
  for (const sym of Object.getOwnPropertySymbols(table)) {
    if (String(sym).includes("Name")) {
      const v = (table as Record<symbol, unknown>)[sym];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}

// Import AFTER mocks.
import {
  notifyStatementGenerated,
} from "./delivery";
import { ORG_IDENTITY_BLOCK_REASON, isOrgIdentityRefusal } from "./orgIdentityBlock";
import {
  DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY,
  PERIODIC_STATEMENT_TERMINAL_DELIVERY_STATUSES,
} from "@shared/schema/reg-z";

/** The exact shape emailService.ts:628-640 returns when the org has no identity. */
const IDENTITY_REFUSAL = {
  success: false,
  error:
    "No connected email identity for this organization. Connect your email account or verify your sending domain (Settings → Connections) to email sellers and buyers — platform email is reserved for system notices.",
  errorType: "configuration_error",
  attempts: 0,
  retryable: false,
} as const;

function stmt(
  id: string,
  loanId: string,
  deliveryStatus: string,
): StatementRow {
  return {
    id,
    loanId,
    loanType: "note",
    organizationId: 7,
    cycleStart: "2026-06-01",
    cycleEnd: "2026-06-30",
    dueDate: "2026-07-01",
    amountDueCents: 50_000,
    deliveryStatus,
    deliveredAt: null,
    deliveryMethod: null,
    deliveryError: null,
  };
}

/**
 * Seed org 7 with the statement under test plus TWO statements already
 * blocked, on three notes belonging to only TWO distinct borrowers. That
 * asymmetry is the point: the alert must report 3 statements but 2
 * borrowers, which is only possible if the count is derived from rows.
 */
function seed(opts: { statusUnderTest?: string } = {}) {
  STATEMENTS.clear();
  NOTES.clear();
  LEADS.clear();
  updateTargetId = "stmt-1";
  lastUpdateValues = null;
  failScopeQuery = false;
  raiseAlertSpy.mockClear();
  sendEmailSpy = vi.fn(async (_opts: unknown) => ({
    success: true,
    messageId: "m-1",
    attempts: 1,
  }));

  STATEMENTS.set("stmt-1", stmt("stmt-1", "42", opts.statusUnderTest ?? "pending"));
  STATEMENTS.set(
    "stmt-2",
    stmt("stmt-2", "43", DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY),
  );
  STATEMENTS.set(
    "stmt-3",
    stmt("stmt-3", "44", DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY),
  );

  NOTES.set(42, { id: 42, organizationId: 7, borrowerId: 99 });
  NOTES.set(43, { id: 43, organizationId: 7, borrowerId: 100 });
  // Same borrower as note 43 — two notes, one person.
  NOTES.set(44, { id: 44, organizationId: 7, borrowerId: 100 });

  LEADS.set(99, {
    id: 99,
    organizationId: 7,
    firstName: "Sam",
    email: "borrower@example.com",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── The lane label ─────────────────────────────────────────────────────

describe("statement email rides the org's own identity", () => {
  it("labels the send purpose 'counterparty', never the platform default", async () => {
    seed();
    await notifyStatementGenerated("stmt-1");
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const call = sendEmailSpy.mock.calls[0][0] as {
      purpose?: string;
      organizationId?: number;
      to?: string;
    };
    // Omitting `purpose` would default to 'system' inside emailService
    // (`options.purpose ?? 'system'`) and re-front lender mail onto the
    // AcreOS platform sender — the exact thing the 2026-07-17 ruling bans.
    expect(call.purpose).toBe("counterparty");
    expect(call.organizationId).toBe(7);
    expect(call.to).toBe("borrower@example.com");
  });
});

// ── The new state ──────────────────────────────────────────────────────

describe("org-identity refusal → blocked_no_org_identity", () => {
  beforeEach(() => {
    seed();
    sendEmailSpy = vi.fn(async () => IDENTITY_REFUSAL);
  });

  it("lands the row in blocked_no_org_identity, NOT failed and NOT suppressed", async () => {
    const result = await notifyStatementGenerated("stmt-1");

    const stored = STATEMENTS.get("stmt-1")!;
    expect(stored.deliveryStatus).toBe("blocked_no_org_identity");
    // The three outcomes must stay distinguishable to a reader of the row.
    expect(stored.deliveryStatus).not.toBe("failed");
    expect(stored.deliveryStatus).not.toBe("bounced");
    expect(stored.deliveryStatus).not.toBe("suppressed");
    expect(stored.deliveryError).toBe(ORG_IDENTITY_BLOCK_REASON);
    // No channel was used — nothing reached SES.
    expect(stored.deliveryMethod).toBeNull();
    expect(stored.deliveredAt).toBeNull();

    expect(result.delivered).toBe(false);
    expect(result.blockedNoOrgIdentity).toBe(true);
    // Not the borrower's fault: the no-recipient flag must stay off.
    expect(result.skippedNoRecipient).toBeUndefined();
  });

  it("registers the new state as TERMINAL in the shared vocabulary", () => {
    // This is the retry policy itself — the notifier's gate reads this
    // exact array. If the value is dropped from it, the state silently
    // becomes retryable again.
    expect(PERIODIC_STATEMENT_TERMINAL_DELIVERY_STATUSES).toContain(
      DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY,
    );
    expect(PERIODIC_STATEMENT_TERMINAL_DELIVERY_STATUSES).toContain("delivered");
    // `failed` must NOT be terminal — transient errors are still retried.
    expect(PERIODIC_STATEMENT_TERMINAL_DELIVERY_STATUSES).not.toContain(
      "failed",
    );
  });
});

// ── Non-retry ──────────────────────────────────────────────────────────

describe("a blocked statement is never retried", () => {
  it("returns without touching SES when the row is already blocked", async () => {
    seed({ statusUnderTest: DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY });

    const result = await notifyStatementGenerated("stmt-1");

    // The gate fires before recipient resolution and before any send.
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(result.attempted).toBe(false);
    expect(result.blockedNoOrgIdentity).toBe(true);
    expect(result.skippedTerminalStatus).toBe(true);
    // Nothing was rewritten — the row keeps its terminal state.
    expect(lastUpdateValues).toBeNull();
    expect(STATEMENTS.get("stmt-1")!.deliveryStatus).toBe(
      DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY,
    );
  });

  it("still retries a row left in 'failed' — non-retry is specific to the block", async () => {
    seed({ statusUnderTest: "failed" });

    await notifyStatementGenerated("stmt-1");

    // `failed` is transient by definition, so it must fall through the
    // terminal gate and attempt the send again.
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });
});

// ── The alert ──────────────────────────────────────────────────────────

describe("founder/org alert on the block", () => {
  beforeEach(() => {
    seed();
    sendEmailSpy = vi.fn(async () => IDENTITY_REFUSAL);
  });

  it("raises through the alert spine, naming the org", async () => {
    await notifyStatementGenerated("stmt-1");

    expect(raiseAlertSpy).toHaveBeenCalledTimes(1);
    const alert = raiseAlertSpy.mock.calls[0][0] as {
      severity: string;
      source: string;
      title: string;
      detail: string;
      dedupeKey: string;
      domain: string;
      organizationId: number;
      metadata: Record<string, unknown>;
    };

    // Named, not just an id.
    expect(alert.title).toContain("Ridgeline Capital");
    expect(alert.title).toContain("org 7");
    expect(alert.organizationId).toBe(7);
    expect(alert.domain).toBe("compliance");
    expect(alert.dedupeKey).toBe("org:7");
    expect(alert.source).toBe("periodic_statement_delivery");
    // Visible + actionable, not a 3am page.
    expect(alert.severity).toBe("warning");
    expect(alert.detail).toContain("Settings → Connections");
  });

  it("counts affected borrowers from real rows — 3 statements, 2 borrowers", async () => {
    await notifyStatementGenerated("stmt-1");

    const alert = raiseAlertSpy.mock.calls[0][0] as {
      detail: string;
      metadata: { statementsBlocked: number; borrowersAffected: number | null };
    };

    // stmt-1 (just blocked) + stmt-2 + stmt-3 = 3 blocked statements,
    // across notes 42/43/44, which belong to borrowers 99/100/100 = 2
    // distinct people. A hardcoded or row-count-shaped number could not
    // produce this pair.
    expect(alert.metadata.statementsBlocked).toBe(3);
    expect(alert.metadata.borrowersAffected).toBe(2);
    expect(alert.detail).toContain("3 §1026.41 periodic statement(s)");
    expect(alert.detail).toContain("2 borrower(s)");
  });

  it("names the org WITHOUT a number when the count cannot be derived", async () => {
    failScopeQuery = true;

    const result = await notifyStatementGenerated("stmt-1");

    // The block itself must still be recorded — a failed count is not a
    // reason to lose the state.
    expect(STATEMENTS.get("stmt-1")!.deliveryStatus).toBe(
      DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY,
    );
    expect(result.blockedNoOrgIdentity).toBe(true);

    expect(raiseAlertSpy).toHaveBeenCalledTimes(1);
    const alert = raiseAlertSpy.mock.calls[0][0] as {
      title: string;
      detail: string;
      metadata: { statementsBlocked: number | null; borrowersAffected: number | null };
    };

    // The org is still named …
    expect(alert.title).toContain("Ridgeline Capital");
    // … but no number is invented. Null, NOT 0 — a zero would contradict
    // the blocked row we just wrote and read as "nothing is affected".
    expect(alert.metadata.statementsBlocked).toBeNull();
    expect(alert.metadata.borrowersAffected).toBeNull();
    expect(alert.detail).toContain("An undetermined number of");
    expect(alert.detail).not.toContain("0 §1026.41");
  });

  it("does not re-alert when a terminal blocked row is re-entered", async () => {
    seed({ statusUnderTest: DELIVERY_STATUS_BLOCKED_NO_ORG_IDENTITY });
    await notifyStatementGenerated("stmt-1");
    // Nothing new happened; the existing finding already carries the org.
    expect(raiseAlertSpy).not.toHaveBeenCalled();
  });
});

// ── The discriminator does not over-capture ────────────────────────────

describe("isOrgIdentityRefusal", () => {
  it("accepts the pre-flight refusal shape", () => {
    expect(isOrgIdentityRefusal(IDENTITY_REFUSAL)).toBe(true);
  });

  it("rejects a real SES configuration failure (attempts >= 1)", () => {
    // categorizeError() maps a live ConfigurationSetDoesNotExistException
    // to the SAME errorType, but it can only arise inside the retry loop,
    // so it always carries attempts >= 1. That one IS worth retrying.
    expect(
      isOrgIdentityRefusal({
        success: false,
        error: "Email service configuration error",
        errorType: "configuration_error",
        attempts: 3,
        retryable: false,
      }),
    ).toBe(false);
  });

  it("rejects quota + recipient pre-flight refusals", () => {
    expect(
      isOrgIdentityRefusal({
        success: false,
        error: "Daily send limit reached for warmup day 1",
        errorType: "quota_exceeded",
        attempts: 0,
        retryable: false,
      }),
    ).toBe(false);
    expect(
      isOrgIdentityRefusal({
        success: false,
        error: "All recipient(s) are on the suppression list",
        errorType: "recipient_rejected",
        attempts: 0,
      }),
    ).toBe(false);
  });
});

describe("a live SES configuration error still lands in 'failed'", () => {
  it("does not get laundered into the terminal blocked state", async () => {
    seed();
    sendEmailSpy = vi.fn(async () => ({
      success: false,
      error: "Email service configuration error",
      errorType: "configuration_error",
      attempts: 3,
      retryable: false,
    }));

    const result = await notifyStatementGenerated("stmt-1");

    const stored = STATEMENTS.get("stmt-1")!;
    expect(stored.deliveryStatus).toBe("failed");
    expect(stored.deliveryMethod).toBe("email");
    expect(result.blockedNoOrgIdentity).toBeUndefined();
    // A retryable-class failure must not raise the BYO alert.
    expect(raiseAlertSpy).not.toHaveBeenCalled();
  });
});
