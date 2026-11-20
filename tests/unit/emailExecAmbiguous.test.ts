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

describe("email exec maps a MIXED history to ambiguous (#630 follow-up)", () => {
  // The corner the #630 audit filed as a note: `performSend`'s retry loop
  // used to report only the LAST error, so an attempt whose outcome was
  // unknown (response lost — SES may have accepted it) followed by a clean
  // provider 4xx returned the 4xx's errorType with attempts ≥ 1, and the
  // exec mapped it to `failed` — re-execution (incl. corrected content)
  // permitted over a possibly-sent first attempt. `performSend` now
  // surfaces `someAttemptOutcomeUnknown` for the whole history and the
  // classifier fails closed on it. Two SES attempts per send
  // (maxRetries: 1, ~1ms backoff).
  const MIXED = { ...BASE, retryConfig: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2 } };

  it.each([
    {
      label: "network-error attempt, then a throttling 4xx",
      first: () => sesError("ECONNRESET", "read ECONNRESET"),
      second: () => sesError("Throttling", "Throttling: rate exceeded"),
      finalError: /rate limit exceeded/,
    },
    {
      label: "unknown attempt (SES 5xx), then a limit-exceeded 4xx",
      first: () => sesError("ServiceUnavailable", "Service unavailable"),
      second: () => sesError("LimitExceededException", "Daily message quota exceeded"),
      finalError: /Daily email quota exceeded/,
    },
  ])("$label → ambiguous: the retry refuses without calling SES again", async ({ first, second, finalError }) => {
    sesSend.mockRejectedValueOnce(first()).mockRejectedValue(second());
    const key = `email-amb:mixed:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    const firstSend = await emailService.sendEmail({ ...MIXED, idempotencyKey: key });
    expect(firstSend.success).toBe(false);
    // The surfaced error is the FINAL attempt's clean 4xx — on final
    // errorType alone this would have recorded `failed` before the fix.
    expect(firstSend.error).toMatch(finalError);
    expect(S.row!.status).toBe("ambiguous");
    expect(sesSend).toHaveBeenCalledTimes(2);

    const retry = await emailService.sendEmail({ ...MIXED, idempotencyKey: key });
    expect(retry.success).toBe(false);
    expect(retry.error).toMatch(/AMBIGUOUS prior outcome/);
    expect(sesSend).toHaveBeenCalledTimes(2);
  });

  it("performSend result carries the history flag (no idempotency key)", async () => {
    sesSend
      .mockRejectedValueOnce(sesError("ECONNRESET", "read ECONNRESET"))
      .mockRejectedValue(sesError("Throttling", "Throttling: rate exceeded"));

    const result = await emailService.sendEmail({ ...MIXED });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("rate_limit");
    expect(result.attempts).toBe(2);
    expect(result.someAttemptOutcomeUnknown).toBe(true);
  });

  it("a purely provable history does NOT set the flag and stays failed", async () => {
    sesSend
      .mockRejectedValueOnce(sesError("Throttling", "Throttling: rate exceeded"))
      .mockRejectedValue(sesError("MessageRejected", "Message rejected: bad recipient"));

    const result = await emailService.sendEmail({ ...MIXED });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("recipient_rejected");
    expect(result.attempts).toBe(2);
    expect(result.someAttemptOutcomeUnknown).toBe(false);

    // And through the exec: the recording is `failed`, not `ambiguous`.
    sesSend.mockReset();
    emailCircuitBreaker.reset();
    sesSend
      .mockRejectedValueOnce(sesError("Throttling", "Throttling: rate exceeded"))
      .mockRejectedValue(sesError("MessageRejected", "Message rejected: bad recipient"));
    const key = `email-amb:pure:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const viaExec = await emailService.sendEmail({ ...MIXED, idempotencyKey: key });
    expect(viaExec.success).toBe(false);
    expect(S.row!.status).toBe("failed");
    expect(sesSend).toHaveBeenCalledTimes(2);
  });
});
