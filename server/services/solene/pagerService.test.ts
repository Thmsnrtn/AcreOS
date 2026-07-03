/**
 * Tests for Solene pager service.
 *
 * Coverage:
 *  - sendSolenePage delivers to ntfy with correct headers per severity
 *  - Failed ntfy push still persists the event with delivery_status=failed
 *  - Network errors caught, persisted, never thrown
 *  - SOLENE_PAGE_TOPIC env override
 *  - pageTopic() default fallback
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  nextPageId = 1;
  throwOnInsert = false;
  fetchMode = "ok";
  delete process.env.SOLENE_PAGE_TOPIC;
  delete process.env.NODE_ENV;

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
