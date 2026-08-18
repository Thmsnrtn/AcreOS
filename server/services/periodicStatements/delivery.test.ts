/**
 * Tests for §1026.41 statement-ready notifier.
 *
 * Covers:
 *   1. Subject + body composition (no attachment, link points at the
 *      portal deep-link, "Month YYYY" wording).
 *   2. Idempotency — re-running notifyStatementGenerated for a row
 *      whose delivery_status is already 'delivered' is a no-op (no
 *      second SES send).
 *   3. The link goes to the portal endpoint, never to a raw PDF URL
 *      (per Beatrice's directive: session-gated, never world-readable).
 *   4. A suppressed/missing recipient marks the row 'suppressed', not
 *      'delivered', so the row's state is auditable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── In-memory state the db/storage mocks read from ─────────────────────
type StatementRow = {
  id: string;
  loanId: string;
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

type NoteRow = {
  id: number;
  organizationId: number;
  borrowerId: number | null;
};

type LeadRow = {
  id: number;
  organizationId: number;
  firstName: string | null;
  email: string | null;
};

const STATEMENTS = new Map<string, StatementRow>();
const NOTES = new Map<number, NoteRow>();
const LEADS = new Map<number, LeadRow>();

// Each test installs its own sendEmail spy by mutating this ref.
let sendEmailSpy = vi.fn(async (_opts: unknown) => ({ success: true, messageId: "m-1", attempts: 1 }));

vi.mock("../emailService", () => ({
  emailService: {
    sendEmail: (opts: unknown) => sendEmailSpy(opts),
  },
}));

vi.mock("../../storage", () => ({
  storage: {
    getLead: async (orgId: number, id: number) => {
      const row = LEADS.get(id);
      if (!row || row.organizationId !== orgId) return undefined;
      return row;
    },
    getOrganization: async (id: number) => ({ id, name: "Acme Lender", settings: {} }),
  },
}));

// db mock — supports the four shapes the delivery module uses:
//   select(...).from(periodicStatements).where(...).limit(1)
//   select(...).from(notes).where(...).limit(1)
//   update(periodicStatements).set(values).where(eq(id, X))
//   (the insert path lives in index.ts, not delivery.ts)
//
// We dispatch by counting select() calls in test order (the delivery
// function always does periodicStatements first, then notes).
let selectCallNumber = 0;
let lastUpdatedId: string | null = null;
let lastUpdateValues: Partial<StatementRow> | null = null;

vi.mock("../../db", () => {
  const db = {
    select: (_projection?: unknown) => {
      selectCallNumber += 1;
      const myCall = selectCallNumber;
      const step: any = {
        from: (_t: unknown) => step,
        where: (_p: unknown) => step,
        limit: (_n: number) => step,
        then: (onFulfilled: any, onRejected: any) => {
          let rows: unknown[];
          if (myCall === 1) {
            // delivery.ts: SELECT periodic_statements WHERE id = X LIMIT 1
            rows = Array.from(STATEMENTS.values());
          } else {
            // delivery.ts: SELECT notes WHERE id = X LIMIT 1
            rows = Array.from(NOTES.values());
          }
          return Promise.resolve(rows).then(onFulfilled, onRejected);
        },
      };
      return step;
    },
    update: (_table: unknown) => ({
      set: (values: Partial<StatementRow>) => ({
        where: (_pred: unknown) => {
          // We don't decode the WHERE predicate; the delivery function
          // only ever updates exactly one statement row at a time, and
          // STATEMENTS holds exactly one row in each test.
          const id = Array.from(STATEMENTS.keys())[0];
          if (id) {
            const row = STATEMENTS.get(id)!;
            STATEMENTS.set(id, { ...row, ...values });
            lastUpdatedId = id;
            lastUpdateValues = values;
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

// Import AFTER mocks.
import {
  buildStatementEmail,
  notifyStatementGenerated,
} from "./delivery";

// ── Fixtures ───────────────────────────────────────────────────────────

function seed(overrides: { deliveryStatus?: string; borrowerEmail?: string | null } = {}) {
  STATEMENTS.clear();
  NOTES.clear();
  LEADS.clear();
  selectCallNumber = 0;
  lastUpdatedId = null;
  lastUpdateValues = null;
  sendEmailSpy = vi.fn(async (_opts: unknown) => ({ success: true, messageId: "m-1", attempts: 1 }));

  STATEMENTS.set("stmt-1", {
    id: "stmt-1",
    loanId: "42",
    organizationId: 7,
    cycleStart: "2026-06-01",
    cycleEnd: "2026-06-30",
    dueDate: "2026-07-01",
    amountDueCents: 50_000,
    deliveryStatus: overrides.deliveryStatus ?? "pending",
    deliveredAt: null,
    deliveryMethod: null,
    deliveryError: null,
  });
  NOTES.set(42, { id: 42, organizationId: 7, borrowerId: 99 });
  LEADS.set(99, {
    id: 99,
    organizationId: 7,
    firstName: "Sam",
    email: overrides.borrowerEmail === undefined ? "borrower@example.com" : overrides.borrowerEmail,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── buildStatementEmail (pure) ──────────────────────────────────────────

describe("buildStatementEmail — pure body composition", () => {
  it("sets the subject to 'Your AcreOS statement for [Month Year] is ready'", () => {
    const built = buildStatementEmail({
      borrowerFirstName: "Sam",
      orgName: "Acme Lender",
      statement: { id: "stmt-1", cycleStart: "2026-06-01", dueDate: "2026-07-01", amountDueCents: 50_000 },
    });
    expect(built.subject).toBe("Your AcreOS statement for June 2026 is ready");
  });

  it("includes the borrower's first name in the greeting when provided", () => {
    const built = buildStatementEmail({
      borrowerFirstName: "Sam",
      orgName: "Acme Lender",
      statement: { id: "stmt-1", cycleStart: "2026-06-01", dueDate: "2026-07-01", amountDueCents: 50_000 },
    });
    expect(built.text).toContain("Hi Sam,");
    expect(built.html).toContain("Hi Sam,");
  });

  it("falls back to 'Hi,' when borrower first name is missing", () => {
    const built = buildStatementEmail({
      borrowerFirstName: null,
      orgName: "Acme Lender",
      statement: { id: "stmt-1", cycleStart: "2026-06-01", dueDate: "2026-07-01", amountDueCents: 50_000 },
    });
    expect(built.text.startsWith("Hi,")).toBe(true);
  });

  it("links to the portal deep-link, never to a raw PDF URL (Beatrice gate)", () => {
    const built = buildStatementEmail({
      borrowerFirstName: "Sam",
      orgName: "Acme Lender",
      statement: { id: "stmt-1", cycleStart: "2026-06-01", dueDate: "2026-07-01", amountDueCents: 50_000 },
    });
    expect(built.pdfUrl).toContain("/portal?statement=stmt-1");
    // The body must not embed the raw PDF endpoint — that path requires
    // a session cookie and would 401 from an email client.
    expect(built.text).not.toContain("/api/borrower/periodic-statements/");
    expect(built.html).not.toContain("/api/borrower/periodic-statements/");
  });

  it("does not include any base64 attachment markers", () => {
    const built = buildStatementEmail({
      borrowerFirstName: "Sam",
      orgName: "Acme Lender",
      statement: { id: "stmt-1", cycleStart: "2026-06-01", dueDate: "2026-07-01", amountDueCents: 50_000 },
    });
    // No Content-Disposition: attachment, no base64 payload — links only.
    expect(built.html.toLowerCase()).not.toContain("content-disposition");
    expect(built.html.toLowerCase()).not.toContain("base64,");
  });

  it("includes the #154 CAN-SPAM postal-address placeholder", () => {
    const built = buildStatementEmail({
      borrowerFirstName: "Sam",
      orgName: "Acme Lender",
      statement: { id: "stmt-1", cycleStart: "2026-06-01", dueDate: "2026-07-01", amountDueCents: 50_000 },
    });
    expect(built.text).toContain("#154");
    expect(built.html).toContain("#154");
  });
});

// ── notifyStatementGenerated (idempotency + persistence) ───────────────

describe("notifyStatementGenerated — send + persist", () => {
  it("marks the row SENT on success — the carrier accepted it, nobody observed delivery", async () => {
    // WAS `expect(stored.deliveryStatus).toBe("delivered")`, which pinned the
    // defect as the contract. `result.success` is SES accepting a
    // SendRawEmailCommand — custody, not receipt — and nothing in AcreOS
    // consumes a bounce or delivery notification, so "delivered" asserted an
    // observation that never happened and could never be corrected. On a
    // §1026.41 statement that is a regulated record claiming an unseen event,
    // and since "delivered" is terminal, a bounced statement was never
    // re-attempted either.
    seed();
    const result = await notifyStatementGenerated("stmt-1");
    expect(result.attempted).toBe(true);
    expect(result.delivered).toBe(true);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const stored = STATEMENTS.get("stmt-1")!;
    expect(stored.deliveryStatus).toBe("sent");
    expect(stored.deliveredAt).toBeInstanceOf(Date);
    expect(stored.deliveryMethod).toBe("email");
  });

  it("nothing writes `delivered` — it is reserved for an observation we do not make", async () => {
    // The honest absence. `delivered` stays in the vocabulary because a future
    // SES delivery notification should write it; until that observer exists,
    // no code path may claim it. If this starts failing, either the observer
    // landed (good — update this) or somebody reinstated the false claim.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs
      .readFileSync(path.resolve(__dirname, "delivery.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(
      /deliveryStatus:\s*"delivered"/.test(src),
      "delivery.ts writes `delivered` again — that claims a delivery nobody observed",
    ).toBe(false);
  });

  it("is idempotent — re-running for an already-sent row is a no-op", async () => {
    seed({ deliveryStatus: "sent" });
    const result = await notifyStatementGenerated("stmt-1");
    expect(result.attempted).toBe(false);
    expect(result.delivered).toBe(true);
    expect(result.skippedAlreadyDelivered).toBe(true);
    // SES was never touched.
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it("marks the row 'suppressed' when no borrower email is on file", async () => {
    seed({ borrowerEmail: null });
    const result = await notifyStatementGenerated("stmt-1");
    expect(result.delivered).toBe(false);
    expect(result.skippedNoRecipient).toBe(true);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    const stored = STATEMENTS.get("stmt-1")!;
    expect(stored.deliveryStatus).toBe("suppressed");
    expect(stored.deliveryError).toBe("no_borrower_email_on_file");
  });

  it("passes the correct payload to emailService (subject, text+html, no attachment)", async () => {
    seed();
    await notifyStatementGenerated("stmt-1");
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const call = sendEmailSpy.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
      organizationId: number;
    };
    expect(call.to).toBe("borrower@example.com");
    expect(call.subject).toContain("June 2026");
    expect(call.organizationId).toBe(7);
    expect(call.text).toContain("June 2026");
    expect(call.html).toContain("June 2026");
    // Per Beatrice: no PDF attachment — link only.
    expect(call.html.toLowerCase()).not.toContain("base64,");
    expect(call.text).toContain("/portal?statement=stmt-1");
  });

  it("marks the row 'failed' when SES rejects the send", async () => {
    seed();
    sendEmailSpy = vi.fn(async () => ({
      success: false,
      error: "Throttling: rate exceeded",
      errorType: "rate_limit",
      attempts: 3,
    } as const));
    const result = await notifyStatementGenerated("stmt-1");
    expect(result.delivered).toBe(false);
    expect(result.errorType).toBe("rate_limit");
    const stored = STATEMENTS.get("stmt-1")!;
    expect(stored.deliveryStatus).toBe("failed");
    expect(stored.deliveryError).toContain("Throttling");
  });

  it("marks the row 'bounced' when SES rejects the recipient", async () => {
    seed();
    sendEmailSpy = vi.fn(async () => ({
      success: false,
      error: "recipient address rejected",
      errorType: "recipient_rejected",
      attempts: 1,
    } as const));
    const result = await notifyStatementGenerated("stmt-1");
    expect(result.delivered).toBe(false);
    const stored = STATEMENTS.get("stmt-1")!;
    expect(stored.deliveryStatus).toBe("bounced");
  });
});
