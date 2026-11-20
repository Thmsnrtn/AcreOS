/**
 * N1 (#624 audit follow-up) — the email outward-action exec maps
 * transport/unknown outcomes to `ambiguous`, not `failed`.
 *
 * Before this fix, `sendEmail`'s exec mapped EVERY structured
 * `performSend` failure to `ExecOutcome {status: "failed"}`, including the
 * retry-loop-exhausted transport return where SES may have accepted the
 * message and the response was lost. Under #624's failed-first precedence a
 * `failed` recording additionally permits corrected-content execution under
 * the same key — exactly what an unknown outcome must not allow.
 *
 * These tests drive `sendEmail` end to end through `withOutwardAction`
 * (mocked SES + an in-memory claim row, as in
 * outwardActionFailedCorrection.test.ts) and observe the recording through
 * the only seam that matters — what a SECOND send under the same key does:
 * a `failed` recording re-executes (SES is called again); an `ambiguous`
 * recording refuses without touching SES again. A corrected-content retry
 * after an ambiguous recording must refuse too.
 *
 * `retryConfig: { maxRetries: 0 }` keeps each send to one SES attempt
 * (otherwise the retry loop's real backoff delays would slow the file).
 * `emailCircuitBreaker.reset()` in beforeEach matters: the breaker opens
 * after 3 consecutive SES failures, and this file makes many — without the
 * reset, later cases would see CircuitOpenError (`unknown`) instead of the
 * error they inject.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);

const sesSend = vi.fn();
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send(...args: unknown[]) {
      return sesSend(...args);
    }
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
  SendRawEmailCommand: class {
    constructor(public input: unknown) {}
  },
  GetSendQuotaCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../../server/storage", () => ({
  storage: new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "getOrganizationIntegration") return vi.fn().mockResolvedValue(undefined);
        if (prop === "getVerifiedEmailDomains") return vi.fn().mockResolvedValue([]);
        // Every other storage call the service makes along the send path
        // (logs, suppression bookkeeping) is a benign no-op here.
        return vi.fn().mockResolvedValue(undefined);
      },
    },
  ),
  db: {},
}));

const getIdentityForSend = vi.fn();
vi.mock("../../server/services/orgEmailIdentity", () => ({
  getIdentityForSend: (orgId: number) => getIdentityForSend(orgId),
}));

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: vi.fn().mockReturnValue({
    accessKeyId: "org-key",
    secretAccessKey: "org-secret",
    fromEmail: "deals@customer-domain.com",
  }),
}));

vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(async (addrs: string[]) => ({ allowed: addrs, suppressed: [] })),
  isSuppressed: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../server/services/emailWarmup", () => ({
  reserveSend: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn().mockResolvedValue("tok"),
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://acreos.io/u/tok"),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── In-memory outward-actions claim row ────────────────────────────────────
// Same shape as outwardActionFailedCorrection.test.ts, except the INSERT is
// stateful: the first claim wins (returns the new row), later claims
// conflict (return []) so the existing-row path decides.
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ op: "and", a }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  sql: Object.assign(() => ({ op: "sql" }), { raw: () => ({ op: "sql" }) }),
}));
const T = vi.hoisted(() => ({
  outwardActions: { id: "col:id", status: "col:status", organizationId: "col:org", actionKind: "col:kind", idempotencyKey: "col:key", attempts: "col:attempts" },
}));
vi.mock("@shared/schema", () => ({ outwardActions: T.outwardActions }));

const S = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
}));

function eqs(cond: unknown, out: Array<{ col: unknown; val: unknown }> = []) {
  const c = cond as { op?: string; col?: unknown; val?: unknown; a?: unknown[] };
  if (c?.op === "eq") out.push({ col: c.col, val: c.val });
  for (const x of c?.a ?? []) eqs(x, out);
  return out;
}

vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (S.row) return [];
            S.row = {
              id: 1,
              organizationId: v.organizationId,
              actionKind: v.actionKind,
              idempotencyKey: v.idempotencyKey,
              requestHash: v.requestHash,
              status: "in_flight",
              externalId: null,
              attempts: 1,
              lastError: null,
            };
            return [{ id: 1 }];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (S.row ? [{ ...S.row }] : []),
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const wantStatus = eqs(cond).find((e) => e.col === T.outwardActions.status)?.val;
          const applies = wantStatus === undefined || S.row!.status === wantStatus;
          if (applies) S.row = { ...S.row!, ...v, status: (v.status as string) ?? S.row!.status };
          const res = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> };
          res.returning = async () => (applies ? [{ id: S.row!.id }] : []);
          return res;
        },
      }),
    }),
  },
}));

import { emailService } from "../../server/services/emailService";
import { emailCircuitBreaker } from "../../server/utils/circuitBreaker";

const BASE = {
  to: "seller@example.com",
  subject: "About your parcel",
  html: "<p>Hi</p>",
  organizationId: 42,
  purpose: "system" as const,
  retryConfig: { maxRetries: 0 },
};

beforeEach(() => {
  S.row = null;
  sesSend.mockReset();
  emailCircuitBreaker.reset();
  getIdentityForSend.mockReset().mockResolvedValue(null);
  process.env.AWS_ACCESS_KEY_ID = "platform-key";
  process.env.AWS_SECRET_ACCESS_KEY = "platform-secret";
  process.env.AWS_SES_FROM_EMAIL = "no-reply@acreos.io";
});

function sesError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name, code: name });
}

describe("email exec maps transport/unknown outcomes to ambiguous (N1)", () => {
  it.each([
    {
      label: "network error (dropped connection after the request left)",
      error: sesError("ECONNRESET", "read ECONNRESET"),
      firstError: /Network error while sending email/,
    },
    {
      label: "unknown error (unclassifiable throw from the send)",
      error: new Error("socket hang up"),
      firstError: /socket hang up/,
    },
  ])("$label → ambiguous: the retry refuses without calling SES again", async ({ error, firstError }) => {
    sesSend.mockRejectedValue(error);
    const key = `email-amb:transport:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    const first = await emailService.sendEmail({ ...BASE, idempotencyKey: key });
    expect(first.success).toBe(false);
    expect(first.error).toMatch(firstError);
    expect(S.row!.status).toBe("ambiguous");
    expect(sesSend).toHaveBeenCalledTimes(1);

    // The identical retry must NOT re-execute: the provider may already
    // have performed it.
    const second = await emailService.sendEmail({ ...BASE, idempotencyKey: key });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/AMBIGUOUS prior outcome/);
    expect(sesSend).toHaveBeenCalledTimes(1);
  });

  it("corrected content under an ambiguous key refuses (no corrected-content execution)", async () => {
    sesSend.mockRejectedValue(sesError("ETIMEDOUT", "Connection timed out"));
    const key = "email-amb:corrected:1";

    const first = await emailService.sendEmail({ ...BASE, idempotencyKey: key });
    expect(first.success).toBe(false);
    expect(S.row!.status).toBe("ambiguous");

    const corrected = await emailService.sendEmail({
      ...BASE,
      idempotencyKey: key,
      subject: "About your parcel (corrected)",
    });
    expect(corrected.success).toBe(false);
    expect(corrected.error).toMatch(/changed content/);
    expect(sesSend).toHaveBeenCalledTimes(1);
  });
});

describe("email exec keeps provably-unperformed failures as failed (N1)", () => {
  it.each([
    {
      label: "SES definitively rejects the recipient (MessageRejected)",
      error: sesError("MessageRejected", "Message rejected: bad recipient"),
      firstError: /Recipient email address was rejected/,
    },
    {
      label: "SES definitively rejects an unverified sender (MessageRejected)",
      error: sesError("MessageRejected", "Email address is not verified"),
      firstError: /Sender email or domain not verified/,
    },
    {
      label: "SES throttles (received 4xx, not an acceptance)",
      error: sesError("Throttling", "Throttling: rate exceeded"),
      firstError: /rate limit exceeded/,
    },
    {
      label: "SES limit exceeded (received 4xx, not an acceptance)",
      error: sesError("LimitExceededException", "Daily message quota exceeded"),
      firstError: /Daily email quota exceeded/,
    },
    {
      label: "SES configuration set missing (received 4xx, pre-acceptance)",
      error: sesError("ConfigurationSetDoesNotExistException", "Configuration set does not exist"),
      firstError: /Email service configuration error/,
    },
  ])("$label → failed: the identical retry re-executes", async ({ error, firstError }) => {
    sesSend.mockRejectedValue(error);
    const key = `email-amb:failed:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    const first = await emailService.sendEmail({ ...BASE, idempotencyKey: key });
    expect(first.success).toBe(false);
    expect(first.error).toMatch(firstError);
    expect(S.row!.status).toBe("failed");
    expect(sesSend).toHaveBeenCalledTimes(1);

    // The identical retry re-executes — the provider proved it accepted
    // nothing, so a second attempt is safe.
    const second = await emailService.sendEmail({ ...BASE, idempotencyKey: key });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(firstError);
    expect(sesSend).toHaveBeenCalledTimes(2);
  });

  it("pre-transport refusal (invalid address, attempts 0) → failed, SES never called", async () => {
    const key = "email-amb:invalid:1";

    const first = await emailService.sendEmail({ ...BASE, to: "not-an-email", idempotencyKey: key });
    expect(first.success).toBe(false);
    expect(first.error).toMatch(/Invalid email address/);
    expect(S.row!.status).toBe("failed");
    expect(sesSend).not.toHaveBeenCalled();

    const second = await emailService.sendEmail({ ...BASE, to: "not-an-email", idempotencyKey: key });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/Invalid email address/);
    expect(sesSend).not.toHaveBeenCalled();
  });
});
