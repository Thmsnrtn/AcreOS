/**
 * Tests for Solene pager service.
 *
 * Coverage:
 *  - sendSolenePage delivers to ntfy with correct headers per severity
 *  - Failed ntfy push still persists the event with delivery_status=failed
 *  - Network errors caught, persisted, never thrown
 *  - SOLENE_PAGE_TOPIC env override
 *  - pageTopic() default fallback
 *  - Jarvis 2.2 interrupt arbiter wrapper: severity → class mapping
 *    (critical → A, urgent → B, explicit interruptClass:"A" override), Class A
 *    byte-identical delivery even when the arbiter defers or throws
 *    (fail OPEN), Class B held pages persist as skipped + a deferral row and
 *    skip BOTH transports (fail CLOSED-quiet).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Jarvis 2.2 — interrupt arbiter mock ────────────────────────────────────

interface ArbiterCall {
  source: string;
  interruptClass: string;
  channel: string;
  subject: string;
}
const ARBITER_CALLS: ArbiterCall[] = [];
const DEFERRALS: Array<{ interruptClass: string; outcome: string }> = [];
let arbiterMode: "deliver" | "defer" | "throw" = "deliver";

vi.mock("../founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => {
    ARBITER_CALLS.push({
      source: req.source,
      interruptClass: req.interruptClass,
      channel: req.channel,
      subject: req.subject,
    });
    if (arbiterMode === "throw") throw new Error("arbiter exploded");
    if (arbiterMode === "defer") {
      return {
        outcome: "defer_to_letter",
        interruptClass: req.interruptClass,
        reason: "weekly founder-decision budget consumed (5/5)",
        quietHoursActive: false,
        budget: { used: 5, limit: 5 },
        deferUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
    }
    return {
      outcome: "deliver",
      interruptClass: req.interruptClass,
      reason: "within budget",
      quietHoursActive: false,
      budget: { used: 0, limit: 5 },
      deferUntil: null,
    };
  }),
  recordDeferredInterrupt: vi.fn(async (req: any, decision: any) => {
    DEFERRALS.push({ interruptClass: req.interruptClass, outcome: decision.outcome });
    return 1;
  }),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface InsertedPage {
  id: number;
  severity: string;
  subject: string;
  body: string;
  deliveryStatus: string;
  deliveryDetail: string | null;
}

const PAGES: InsertedPage[] = [];
let nextPageId = 1;
let throwOnInsert = false;

vi.mock("../../db", () => {
  const db = {
    insert: (_table: unknown) => ({
      values: (row: any) => ({
        returning: (_proj: unknown) => {
          if (throwOnInsert) {
            return Promise.reject(new Error("simulated db failure"));
          }
          const inserted: InsertedPage = {
            id: nextPageId++,
            severity: row.severity,
            subject: row.subject,
            body: row.body,
            deliveryStatus: row.deliveryStatus,
            deliveryDetail: row.deliveryDetail ?? null,
          };
          PAGES.push(inserted);
          return Promise.resolve([{ id: inserted.id }]);
        },
      }),
    }),
  };
  return { db };
});

// Email fallback (second channel) mock.
const EMAILS: Array<{ to: string; subject: string }> = [];
let emailMode: "ok" | "fail" = "ok";
vi.mock("../emailService", () => ({
  emailService: {
    sendEmail: vi.fn(async (input: { to: string; subject: string }) => {
      EMAILS.push({ to: input.to, subject: input.subject });
      return emailMode === "ok"
        ? { success: true }
        : { success: false, error: "smtp down" };
    }),
  },
}));

// Capture fetch calls for assertions.
interface FetchCall {
  url: string;
  init: any;
}
const FETCH_CALLS: FetchCall[] = [];
let fetchMode: "ok" | "http_500" | "throw" = "ok";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  PAGES.length = 0;
  FETCH_CALLS.length = 0;
  ARBITER_CALLS.length = 0;
  DEFERRALS.length = 0;
  arbiterMode = "deliver";
  nextPageId = 1;
  throwOnInsert = false;
  fetchMode = "ok";
  emailMode = "ok";
  EMAILS.length = 0;
  delete process.env.SOLENE_PAGE_TOPIC;
  delete process.env.NODE_ENV;
  delete process.env.FOUNDER_EMAIL;

  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    FETCH_CALLS.push({ url: String(url), init });
    if (fetchMode === "throw") {
      throw new Error("network unreachable");
    }
    if (fetchMode === "http_500") {
      return { ok: false, status: 500 } as Response;
    }
    return { ok: true, status: 200 } as Response;
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

import { sendSolenePage, pageTopic } from "./pagerService";

// ────────────────────────────────────────────────────────────────────────────
// pageTopic
// ────────────────────────────────────────────────────────────────────────────

describe("pageTopic", () => {
  it("returns the built-in default when env unset", () => {
    expect(pageTopic()).toBe("acreos-solene-urgent-norton-9k4m7q3z");
  });

  it("uses SOLENE_PAGE_TOPIC override when set", () => {
    process.env.SOLENE_PAGE_TOPIC = "rotated-topic-name";
    expect(pageTopic()).toBe("rotated-topic-name");
  });

  it("returns null in production when env unset — the repo-visible default topic must never carry real pages", () => {
    delete process.env.SOLENE_PAGE_TOPIC;
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(pageTopic()).toBeNull();
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sendSolenePage — happy path delivery
// ────────────────────────────────────────────────────────────────────────────

describe("sendSolenePage delivery", () => {
  it("posts to ntfy with urgent priority + tag headers", async () => {
    const result = await sendSolenePage({
      severity: "urgent",
      subject: "AWS prod access approved",
      body: "Tom — AWS approved at 14:02 UTC. Launch arc unblocked.",
    });
    expect(result.deliveryStatus).toBe("delivered");
    expect(result.eventId).toBe(1);
    expect(FETCH_CALLS).toHaveLength(1);
    const call = FETCH_CALLS[0];
    expect(call.url).toContain("ntfy.sh");
    expect(call.url).toContain("acreos-solene-urgent-norton-9k4m7q3z");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers.Title).toBe("Solene: AWS prod access approved");
    expect(call.init.headers.Priority).toBe("4");
    expect(call.init.headers.Tags).toBe("warning");
    expect(call.init.body).toContain("Launch arc unblocked");
  });

  it("posts to ntfy with critical priority + siren tag", async () => {
    const result = await sendSolenePage({
      severity: "critical",
      subject: "5xx spike",
      body: "8.4% error rate over 5 min on /api/leads",
    });
    expect(result.deliveryStatus).toBe("delivered");
    expect(FETCH_CALLS).toHaveLength(1);
    expect(FETCH_CALLS[0].init.headers.Priority).toBe("5");
    expect(FETCH_CALLS[0].init.headers.Tags).toBe("warning,siren");
  });

  it("persists the event with delivered status", async () => {
    await sendSolenePage({
      severity: "urgent",
      subject: "LLC EIN issued",
      body: "EIN: redacted",
    });
    expect(PAGES).toHaveLength(1);
    expect(PAGES[0].deliveryStatus).toBe("delivered");
    expect(PAGES[0].severity).toBe("urgent");
    expect(PAGES[0].subject).toBe("LLC EIN issued");
    expect(PAGES[0].deliveryDetail).toBe("ntfy HTTP 200");
  });

  it("honours SOLENE_PAGE_TOPIC override at send time", async () => {
    process.env.SOLENE_PAGE_TOPIC = "rotated-topic";
    await sendSolenePage({
      severity: "urgent",
      subject: "test",
      body: "test",
    });
    expect(FETCH_CALLS[0].url).toContain("rotated-topic");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sendSolenePage — failure modes
// ────────────────────────────────────────────────────────────────────────────

describe("sendSolenePage failure handling", () => {
  it("records delivery_status=failed when ntfy returns non-2xx", async () => {
    fetchMode = "http_500";
    const result = await sendSolenePage({
      severity: "critical",
      subject: "x",
      body: "y",
    });
    expect(result.deliveryStatus).toBe("failed");
    expect(result.deliveryDetail).toBe("ntfy HTTP 500");
    expect(PAGES).toHaveLength(1);
    expect(PAGES[0].deliveryStatus).toBe("failed");
  });

  it("records delivery_status=failed when fetch throws", async () => {
    fetchMode = "throw";
    const result = await sendSolenePage({
      severity: "urgent",
      subject: "x",
      body: "y",
    });
    expect(result.deliveryStatus).toBe("failed");
    expect(result.deliveryDetail).toContain("network unreachable");
    expect(PAGES).toHaveLength(1);
    expect(PAGES[0].deliveryStatus).toBe("failed");
  });

  it("falls back to email when ntfy fails and FOUNDER_EMAIL is set — page still DELIVERED", async () => {
    fetchMode = "http_500";
    process.env.FOUNDER_EMAIL = "tom@example.com";
    const result = await sendSolenePage({
      severity: "critical",
      subject: "5xx spike",
      body: "details",
    });
    expect(EMAILS).toHaveLength(1);
    expect(EMAILS[0].to).toBe("tom@example.com");
    expect(EMAILS[0].subject).toContain("CRITICAL");
    expect(result.deliveryStatus).toBe("delivered");
    expect(result.deliveryDetail).toContain("email fallback delivered");
  });

  it("records failure honestly when BOTH channels fail", async () => {
    fetchMode = "throw";
    emailMode = "fail";
    process.env.FOUNDER_EMAIL = "tom@example.com";
    const result = await sendSolenePage({
      severity: "urgent",
      subject: "x",
      body: "y",
    });
    expect(result.deliveryStatus).toBe("failed");
    expect(result.deliveryDetail).toContain("email fallback ALSO failed");
  });

  it("skips the email fallback entirely when FOUNDER_EMAIL is unset", async () => {
    fetchMode = "http_500";
    const result = await sendSolenePage({ severity: "urgent", subject: "x", body: "y" });
    expect(EMAILS).toHaveLength(0);
    expect(result.deliveryStatus).toBe("failed");
  });

  it("in production with no topic, the email fallback still reaches the founder", async () => {
    process.env.NODE_ENV = "production";
    process.env.FOUNDER_EMAIL = "tom@example.com";
    const result = await sendSolenePage({ severity: "critical", subject: "incident", body: "z" });
    expect(FETCH_CALLS).toHaveLength(0); // push refused (no topic)
    expect(EMAILS).toHaveLength(1);
    expect(result.deliveryStatus).toBe("delivered");
    expect(result.deliveryDetail).toContain("push refused");
    expect(result.deliveryDetail).toContain("email fallback delivered");
  });

  it("never throws when db persistence fails — returns null eventId", async () => {
    throwOnInsert = true;
    const result = await sendSolenePage({
      severity: "urgent",
      subject: "x",
      body: "y",
    });
    expect(result.eventId).toBeNull();
    // Delivery itself was OK
    expect(result.deliveryStatus).toBe("delivered");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Jarvis 2.2 — interrupt arbiter wrapper
// ────────────────────────────────────────────────────────────────────────────

describe("sendSolenePage interrupt arbiter wrapper (Jarvis 2.2)", () => {
  it("maps severity explicitly: critical → Class A, urgent → Class B", async () => {
    await sendSolenePage({ severity: "critical", subject: "a", body: "b" });
    await sendSolenePage({ severity: "urgent", subject: "c", body: "d" });

    expect(ARBITER_CALLS).toHaveLength(2);
    expect(ARBITER_CALLS[0]).toMatchObject({
      source: "pager",
      interruptClass: "A",
      channel: "ntfy_push",
    });
    expect(ARBITER_CALLS[1]).toMatchObject({ interruptClass: "B" });
  });

  it("honors an explicit interruptClass:'A' override on an urgent page (customer-harm/money call sites)", async () => {
    await sendSolenePage({
      severity: "urgent",
      interruptClass: "A",
      subject: "customer-surface regression",
      body: "x",
    });
    expect(ARBITER_CALLS[0].interruptClass).toBe("A");
  });

  it("Class B held by the arbiter: no ntfy push, no email fallback, event persisted as skipped, deferral row recorded", async () => {
    arbiterMode = "defer";
    process.env.FOUNDER_EMAIL = "tom@example.com"; // fallback must NOT fire for a held page

    const result = await sendSolenePage({ severity: "urgent", subject: "s", body: "b" });

    expect(FETCH_CALLS).toHaveLength(0);
    expect(EMAILS).toHaveLength(0);
    expect(result.deliveryStatus).toBe("skipped");
    expect(result.deliveryDetail).toContain("interrupt arbiter defer_to_letter");
    expect(result.deliveryDetail).toContain("budget consumed");
    // The page-discipline ledger still records the event verbatim.
    expect(PAGES).toHaveLength(1);
    expect(PAGES[0].deliveryStatus).toBe("skipped");
    // Never dropped: a deferral row was written.
    expect(DEFERRALS).toEqual([{ interruptClass: "B", outcome: "defer_to_letter" }]);
  });

  it("Class A is BYTE-IDENTICAL to pre-arbiter behavior even when the arbiter tries to defer", async () => {
    arbiterMode = "defer";

    const result = await sendSolenePage({ severity: "critical", subject: "fire", body: "b" });

    expect(FETCH_CALLS).toHaveLength(1);
    expect(FETCH_CALLS[0].init.headers.Priority).toBe("5");
    expect(result.deliveryStatus).toBe("delivered");
    expect(DEFERRALS).toHaveLength(0);
  });

  it("fails OPEN for Class A: an arbiter throw never blocks a critical page", async () => {
    arbiterMode = "throw";

    const result = await sendSolenePage({ severity: "critical", subject: "fire", body: "b" });

    expect(FETCH_CALLS).toHaveLength(1);
    expect(result.deliveryStatus).toBe("delivered");
  });

  it("fails CLOSED-quiet for Class B: an arbiter throw defers (skipped + deferral row), never spams", async () => {
    arbiterMode = "throw";

    const result = await sendSolenePage({ severity: "urgent", subject: "s", body: "b" });

    expect(FETCH_CALLS).toHaveLength(0);
    expect(result.deliveryStatus).toBe("skipped");
    expect(result.deliveryDetail).toContain("fails CLOSED-quiet");
    expect(DEFERRALS).toEqual([{ interruptClass: "B", outcome: "defer_next_pulse" }]);
  });
});
