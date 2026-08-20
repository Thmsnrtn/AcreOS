/**
 * B5 / B6 — direct-mail double-print interim, and the dead recovery queue.
 * (Founder picker rulings, 2026-08-16. See docs/implementation/BLOCKERS.md.)
 *
 * B5 — the defect. `CommunicationsService.sendDirectMailWithRetry` recurses up
 * to MAX_RETRIES around `lobService.sendLetter`. `lobService` catches provider
 * errors internally and hands back `{ success: false, errorType }`, so a
 * network failure AFTER Lob accepted the letter is indistinguishable from one
 * before — it classifies as `network_error`, which `isRetryableError` calls
 * retryable, and the recursion PRINTS THE LETTER AGAIN. Real money, and a real
 * second letter in a real mailbox.
 *
 * The founder chose the INTERIM, explicitly not the full `withOutwardAction`
 * boundary: one idempotency key minted at the top of the send and threaded
 * through the recursion, so every retry in a chain shares it and a duplicate
 * send inside the chain is suppressed. It protects the IN-PROCESS CHAIN ONLY —
 * which is the exact scope of the bug, since process death ends the chain — and
 * it is NOT a durable idempotency boundary. These tests assert that scope in
 * both directions: suppressed inside one chain (b), and NOT suppressed across
 * chains (c), because blocking a deliberate second mailing would be a worse
 * failure than the one being fixed.
 *
 * B6 — the exhausted-retry path enqueued `('lob', 'sendLetter')`, an operation
 * `apiQueue.executeJob` does not implement and throws on. Every such job burned
 * its retries and settled in `failed`, permanently: a recovery path that was
 * dead while the enqueue implied it was not. The founder chose to stop
 * enqueuing and surface the failure honestly rather than implement `sendLetter`
 * (implementing it would make dormant jobs print physical mail on the next
 * deploy, with no DATABASE_URL here to inspect the backlog first).
 *
 * VACUITY: test (a) is the control. Every "Lob was not called twice" assertion
 * below could pass because Lob is never called at all — (a) proves the happy
 * path really does reach the provider exactly once, so the counts mean what
 * they say. Each test's mutation check is recorded next to it.
 */

import fs from "fs";
import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── State the mocks read/write ────────────────────────────────────────────

type LobResult = {
  success: boolean;
  lobMailingId?: string;
  expectedDeliveryDate?: string;
  isTestMode: boolean;
  error?: string;
  errorType?: string;
};

const state = {
  // `ctx` records the lane/tenant context the caller now passes (BYO send
  // rails, 2026-08-20). This file does not assert on it — tests/unit/
  // directMailLaneAdoption.test.ts does — but capturing it keeps the mock an
  // honest record of the real call.
  lobCalls: [] as Array<{ toName: string; mode: string; ctx?: unknown }>,
  /** Consumed in order; the fallback makes an unexpected extra call VISIBLE. */
  lobResults: [] as LobResult[],
  alerts: [] as any[],
  activities: [] as any[],
  org: {
    id: 42,
    name: "Test Land Co",
    settings: {
      mailMode: "test",
      companyAddress: "1 Main St",
      companyCity: "Austin",
      companyState: "TX",
      companyZip: "78701",
    },
  } as any,
  lead: {
    id: 7,
    firstName: "Lee",
    lastName: "Owner",
    address: "2 Dirt Rd",
    city: "Llano",
    state: "TX",
    zip: "78643",
  } as any,
};

const SUCCESS: LobResult = {
  success: true,
  lobMailingId: "ltr_first",
  expectedDeliveryDate: "2026-08-24",
  isTestMode: true,
};

/**
 * A retryable failure that, in the real defect, happens AFTER Lob accepted the
 * letter: `lobService` reports a classified `network_error` and nothing in the
 * result says whether the piece was already created.
 */
const RETRYABLE_FAILURE_AFTER_ACCEPTANCE: LobResult = {
  success: false,
  isTestMode: true,
  error: "Network error connecting to Lob",
  errorType: "network_error",
};

const NON_RETRYABLE_FAILURE: LobResult = {
  success: false,
  isTestMode: true,
  error: "Invalid or undeliverable address",
  errorType: "address_invalid",
};

const logCalls = {
  error: [] as any[][],
  warn: [] as any[][],
  info: [] as any[][],
};

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("../../server/db", () => ({ db: {} }));

vi.mock("../../server/utils/logger", () => ({
  logger: {
    error: (...args: any[]) => { logCalls.error.push(args); },
    warn: (...args: any[]) => { logCalls.warn.push(args); },
    info: (...args: any[]) => { logCalls.info.push(args); },
    debug: () => {},
  },
}));

vi.mock("../../server/services/lobService", () => ({
  lobService: {
    isConfigured: () => true,
    // 2026-08-20 (BYO send rails, founder decision 2026-07-17): the direct-mail
    // precheck is now TENANT-AWARE — `isConfigured()` sees only the platform env
    // keys and refused BYOK orgs that were perfectly well configured on their
    // own Lob account. The mock keeps returning "configured" so the chain-claim
    // behaviour this file pins is reached exactly as before; only the seam moved.
    isConfiguredForOrg: async () => true,
    sendLetter: async (options: any, mode: string, ctx?: any) => {
      state.lobCalls.push({ toName: options.to.name, mode, ctx });
      const next = state.lobResults.shift();
      if (!next) {
        // An unqueued call is a real send the test did not expect. Returning a
        // distinct success makes it show up as an extra element in lobCalls
        // rather than silently reusing the last scripted result.
        return { success: true, lobMailingId: "ltr_UNEXPECTED", isTestMode: true };
      }
      return next;
    },
    isRetryableError: (t: string) =>
      ["rate_limited", "server_error", "network_error"].includes(t),
  },
  LobErrorType: {},
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getLead: async () => state.lead,
    getOrganization: async () => state.org,
    createLeadActivity: async (a: any) => { state.activities.push(a); },
    createSystemAlert: async (a: any) => { state.alerts.push(a); },
  },
}));

vi.mock("../../server/services/emailService", () => ({
  emailService: { isConfigured: async () => true, sendEmail: async () => ({ success: true }) },
}));

vi.mock("../../server/services/smsService", () => ({
  smsService: { isConfigured: () => true },
  sendOrgSMS: async () => ({ success: true }),
}));

vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: () => ({ blocked: false }),
  canSendViaChannel: () => ({ allowed: true }),
  checkTcpaConsent: async () => ({ blocked: false, canSms: true }),
}));

vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => ({ allowed: true }),
  describeFrequencySkip: () => "",
}));

// directMail is only pulled in by apiQueue.executeJob's dynamic import.
vi.mock("../../server/services/directMail", () => ({
  directMailService: { sendPostcard: async () => ({ id: "psc_1" }) },
}));

import {
  communicationsService,
  __directMailChainClaimCountForTests,
} from "../../server/services/communications";
import { apiQueueService } from "../../server/services/apiQueue";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

/**
 * Source ratchets below must assert on CODE, not on prose — the same trap
 * workflowActionHonesty.test.ts documents. The B6 comment at the removed
 * enqueue QUOTES the shape it forbids (`apiQueueService.enqueue('lob', …)`) so
 * a future reader knows what was taken out; matching raw source would fire the
 * ratchet on its own documentation and be permanently red. Strip comments
 * first, then assert.
 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const CONTENT = { subject: "We buy land", body: "Offer enclosed." };

const send = () => communicationsService.sendDirectMailToLead(7, 42, CONTENT);

/** Chain keys are logged with the suppression records; harvest them. */
function loggedChainKeys(): string[] {
  const keys: string[] = [];
  for (const args of [...logCalls.warn, ...logCalls.error]) {
    for (const arg of args) {
      const key = arg?.metadata?.chainKey ?? arg?.metadata?.detail?.chainKey;
      if (typeof key === "string") keys.push(key);
    }
  }
  return keys;
}

beforeEach(() => {
  state.lobCalls = [];
  state.lobResults = [];
  state.alerts = [];
  state.activities = [];
  logCalls.error = [];
  logCalls.warn = [];
  logCalls.info = [];
});

// ── (a) VACUITY GUARD ─────────────────────────────────────────────────────

describe("(a) control — a normal single-attempt send actually sends", () => {
  /**
   * MUTATION CHECK (run): forcing `claimDirectMailChainSend` to return
   * `refuse` unconditionally — a guard that suppresses everything, the exact
   * shape a vacuous suite would not notice — turns this red with 0 Lob calls
   * (7 of 16 red overall). Without this control, every "Lob was called once,
   * not twice" assertion below would still pass under that mutation for
   * entirely the wrong reason.
   */
  it("calls Lob exactly once and reports the real mailing id", async () => {
    state.lobResults = [SUCCESS];

    const result = await send();

    expect(state.lobCalls).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(result.lobMailingId).toBe("ltr_first");
    // SANDBOX HONESTY (2026-08-20 audit). This chain resolved the Lob TEST
    // client: nothing printed and nothing was mailed. `success: true` alone
    // would let a caller render "letter sent" for a no-op, so the sandbox flag
    // rides out on the result as well as into the activity metadata below.
    expect(result.isTestMode).toBe(true);
    // The send is recorded — the guard did not swallow the bookkeeping.
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0].type).toBe("communication_direct_mail");
    // No alert on a clean send.
    expect(state.alerts).toHaveLength(0);
  });

  it("releases the chain claim, so the guard map does not leak", async () => {
    state.lobResults = [SUCCESS];
    await send();
    expect(__directMailChainClaimCountForTests()).toBe(0);
  });
});

// ── (b) THE DEFECT ────────────────────────────────────────────────────────

describe("(b) a retryable failure after Lob accepted must not print twice", () => {
  /**
   * MUTATION CHECK (run, and it corrected an assumption). The guard has TWO
   * parts and they were measured separately:
   *
   *  · Dropping only `&& chainPermitsAnotherSend` from the retry condition
   *    leaves Lob called ONCE — the pre-send claim still refuses the second
   *    attempt. All three tests in this block still go red (the result is a
   *    suppression, not a `network_error`), so the assertions bite, but this
   *    mutation alone does NOT double-print.
   *  · Disabling the pre-send claim as well — the true pre-B5 state — makes it
   *    TWO Lob calls, i.e. two physical letters, and this test reports
   *    "expected [ …(2) ] to have a length of 1 but got 2". Two rather than
   *    three because the second scripted result succeeds and ends the chain.
   *
   * So the pre-send claim is what stops the double print; the retry condition
   * stops a pointless sleep-then-refuse and keeps the failure surfacing on the
   * frame that can still see it.
   */
  it("makes exactly ONE Lob call for the whole chain", async () => {
    // Scripted so that the pre-fix code would happily print two more letters.
    state.lobResults = [
      RETRYABLE_FAILURE_AFTER_ACCEPTANCE,
      { ...SUCCESS, lobMailingId: "ltr_SECOND_PRINT" },
      { ...SUCCESS, lobMailingId: "ltr_THIRD_PRINT" },
    ];

    const result = await send();

    expect(state.lobCalls).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("network_error");
    // Nothing recorded a second mailing id.
    expect(JSON.stringify(state.activities)).not.toContain("SECOND_PRINT");
  });

  it("says out loud why it stopped retrying", async () => {
    state.lobResults = [RETRYABLE_FAILURE_AFTER_ACCEPTANCE, SUCCESS];

    await send();

    const suppression = logCalls.warn.find((args) =>
      String(args[0]).includes("retry suppressed"),
    );
    expect(suppression).toBeDefined();
    expect(suppression![1]?.metadata?.leadId).toBe(7);
    expect(suppression![1]?.metadata?.organizationId).toBe(42);
  });

  it("still surfaces the failure — a suppressed retry is not a quiet one", async () => {
    state.lobResults = [RETRYABLE_FAILURE_AFTER_ACCEPTANCE, SUCCESS];

    await send();

    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0].type).toBe("direct_mail_failure");
    expect(state.alerts[0].organizationId).toBe(42);
    expect(state.alerts[0].relatedEntityId).toBe(7);
    // The attempt count is the REAL one. The chain stopped after one attempt,
    // so claiming three retries would be a fabricated number.
    expect(state.alerts[0].metadata.attemptsMade).toBe(1);
    expect(state.alerts[0].message).toContain("after 1 attempt");
  });
});

// ── (c) LEGITIMATE REPEAT MAIL ────────────────────────────────────────────

describe("(c) a new send starts a new chain, gets a NEW key, and sends", () => {
  /**
   * MUTATION CHECK (run, and it corrected an assumption). Cross-chain sending
   * is held up by TWO independent things, and only the pair matters:
   *
   *  · Making `newDirectMailChainKey` return a CONSTANT (the `lead:{id}`
   *    semantics the founder explicitly did not choose) reddens only the
   *    key-uniqueness test below. Repeat mail still sends, because the claim
   *    is released when its chain returns, so the next chain finds an empty
   *    map regardless of the key.
   *  · Disabling the release alone reddens only the two leak tests. Repeat
   *    mail still sends, because each chain mints its own key.
   *  · BOTH together = a permanent per-lead key, and that is the failure the
   *    blocker calls worse than the bug: 9 of 16 red, with "sends again after
   *    an earlier chain failed" reporting 0 Lob calls on the second send —
   *    mail a customer meant to send, silently suppressed forever.
   */
  it("sends again after an earlier chain failed", async () => {
    state.lobResults = [RETRYABLE_FAILURE_AFTER_ACCEPTANCE];
    const first = await send();
    expect(first.success).toBe(false);
    expect(state.lobCalls).toHaveLength(1);

    // A deliberate re-send later. Same lead, same content, new chain.
    state.lobResults = [{ ...SUCCESS, lobMailingId: "ltr_second_chain" }];
    const second = await send();

    expect(state.lobCalls).toHaveLength(2);
    expect(second.success).toBe(true);
    expect(second.lobMailingId).toBe("ltr_second_chain");
  });

  it("sends again even after a chain that SUCCEEDED — identical content included", async () => {
    state.lobResults = [SUCCESS, { ...SUCCESS, lobMailingId: "ltr_repeat" }];

    const first = await send();
    const second = await send();

    expect(first.lobMailingId).toBe("ltr_first");
    expect(second.lobMailingId).toBe("ltr_repeat");
    expect(state.lobCalls).toHaveLength(2);
  });

  it("uses a different key for each chain", async () => {
    state.lobResults = [RETRYABLE_FAILURE_AFTER_ACCEPTANCE];
    await send();
    state.lobResults = [RETRYABLE_FAILURE_AFTER_ACCEPTANCE];
    await send();

    const keys = loggedChainKeys();
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(keys.length);
    // Scoped to org and lead so a key is readable in a log line.
    for (const key of keys) expect(key.startsWith("dm-chain:42:7:")).toBe(true);
  });

  it("leaves no claim behind after either chain", async () => {
    state.lobResults = [RETRYABLE_FAILURE_AFTER_ACCEPTANCE];
    await send();
    state.lobResults = [SUCCESS];
    await send();
    expect(__directMailChainClaimCountForTests()).toBe(0);
  });
});

// ── (d) B6 — the dead recovery queue ──────────────────────────────────────

describe("(d) the exhausted path no longer enqueues a job that cannot run", () => {
  /**
   * MUTATION CHECK (run): re-adding the
   * `apiQueueService.enqueue('lob','sendLetter', …)` call to
   * handleDirectMailFailure reddens 9 of 16 — the spy assertion, the source
   * ratchet, and the alert assertions too, because the restored enqueue hits
   * the database before the alert is written and takes the surfacing down with
   * it. That cascade is itself the argument: the enqueue sat in front of the
   * only part of this path that ever worked.
   */
  it("does not enqueue anything when the send finally fails", async () => {
    const enqueueSpy = vi.spyOn(apiQueueService, "enqueue");
    state.lobResults = [NON_RETRYABLE_FAILURE];

    const result = await send();

    expect(result.success).toBe(false);
    expect(enqueueSpy).not.toHaveBeenCalled();
    enqueueSpy.mockRestore();
  });

  it("still surfaces the failure through the alert seam and an error log", async () => {
    state.lobResults = [NON_RETRYABLE_FAILURE];

    await send();

    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0].type).toBe("direct_mail_failure");
    expect(state.alerts[0].alertType).toBe("system_error");

    const failureLog = logCalls.error.find((args) =>
      String(args[0]).includes("Direct mail send failed"),
    );
    expect(failureLog).toBeDefined();
    const detail = failureLog![2]?.metadata?.detail;
    expect(detail.leadId).toBe(7);
    expect(detail.organizationId).toBe(42);
    expect(detail.errorType).toBe("address_invalid");
  });

  it("source ratchet: communications.ts enqueues no lob/sendLetter job", () => {
    const src = read("server/services/communications.ts");
    const code = stripComments(src);

    expect(code).not.toMatch(/enqueue\(\s*['"]lob['"]/);
    expect(code).not.toMatch(/apiQueueService/);
    // Not even the import survives — the dead coupling is gone, not just the
    // call. (Asserted on stripped CODE; the comment mentions apiQueue on
    // purpose, and must be free to.)
    expect(code).not.toMatch(/from ['"]\.\/apiQueue['"]/);

    // The removal is explained where a reader will meet it, with the condition
    // for putting it back. These assert on the PROSE deliberately.
    expect(src).toContain("B6");
    expect(src).toContain("api_jobs");
    expect(src).toContain("job.id");
  });

  it("apiQueue refuses an unimplemented Lob operation by naming the real fault", async () => {
    const job = {
      id: "job_abc",
      type: "lob",
      operation: "sendLetter",
      payload: {},
    } as any;

    await expect(apiQueueService.executeJob(job)).rejects.toThrow(/NOT IMPLEMENTED/);
    await expect(apiQueueService.executeJob(job)).rejects.toThrow(/bug at/);
    await expect(apiQueueService.executeJob(job)).rejects.toThrow(/job_abc/);
  });

  it("apiQueue still runs the Lob operation it does implement", async () => {
    const job = {
      id: "job_def",
      type: "lob",
      operation: "sendPostcard",
      payload: {},
    } as any;

    await expect(apiQueueService.executeJob(job)).resolves.toEqual({ id: "psc_1" });
  });
});

// ── Scope honesty ─────────────────────────────────────────────────────────

describe("the interim is documented as an interim, not as a durable boundary", () => {
  it("says in the source that it protects the in-process chain only", () => {
    const src = read("server/services/communications.ts");
    expect(src).toContain("durable idempotency boundary");
    expect(src).toContain("in-process retry chain");
    expect(src).toContain("withOutwardAction");
    expect(src).toContain("BLOCKERS B5");
  });

  it("does not write to the durable outward_actions table", () => {
    const code = stripComments(read("server/services/communications.ts"));
    // The interim reuses the boundary's pure DECISION, never its storage. A
    // random per-chain key must never reach `outward_actions`, whose keys are
    // required to be derived from durable domain identity.
    expect(code).toContain("classifyExisting");
    expect(code).not.toMatch(/withOutwardAction\s*\(/);
    expect(code).not.toMatch(/outwardActions/);
  });
});
