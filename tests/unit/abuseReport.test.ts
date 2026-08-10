/**
 * X-A slice 1 — "Report this page": the portal abuse-report affordance.
 *
 * The borrower portal is an EXTERNAL surface — the visitor was sent there by
 * a customer org, and if the page is a phishing lure they need a one-tap way
 * to tell a human. This suite pins the ONE-EVENT-HOP contract and the
 * native-item discipline:
 *
 *   1. createFromAbuseReport writes ONE decisions-door row: itemType
 *      "abuse_report", riskLevel high, Class-B arbitration, actionPayload
 *      ALWAYS null (suspension and every other consequence stay founder-only
 *      decisions), reporter's verbatim reason in contextBundle ONLY (never in
 *      the model-read sophieAnalysis — the createFromAppeal discipline).
 *   2. It is a NATIVE item, NOT a mirror: absent from MIRRORED_QUEUE_ITEM_TYPES
 *      so every disposition verb works on it directly.
 *   3. Open-card dedupe per (org, page); arbiter deferral lands the row as
 *      deferred, never dropped; empty reason refuses to file.
 *   4. Wiring pins: the POST /api/borrower/report-page endpoint exists, is
 *      rate-limited, and calls the service directly (one hop — no
 *      intermediate store, no batch job); the portal pages render the footer
 *      control with a labeled textarea.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Arbiter mock (controllable — decisionQueueMerge house pattern) ─────────

const ARBITER_CALLS: Array<{ source: string; interruptClass: string; subject: string }> = [];
let arbiterMode: "deliver" | "defer" = "deliver";
const DEFER_UNTIL = new Date("2026-08-15T12:00:00Z");

vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => {
    ARBITER_CALLS.push({ source: req.source, interruptClass: req.interruptClass, subject: req.subject });
    if (arbiterMode === "defer") {
      return {
        outcome: "defer_to_letter",
        interruptClass: req.interruptClass,
        reason: "budget consumed",
        quietHoursActive: false,
        budget: { used: 5, limit: 5 },
        deferUntil: DEFER_UNTIL,
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
  recordDeferredInterrupt: vi.fn(async () => null),
}));

// ─── Collaborator mocks (same set the decisionQueueMerge suite uses) ────────

vi.mock("../../server/services/agentActionExecutors", () => ({
  executeAction: vi.fn(),
  hasExecutor: vi.fn(() => false),
}));

vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: {
    attemptResolution: vi.fn(async () => ({
      autoResolved: false,
      geniusResponse: null,
      geniusConfidence: 0,
    })),
  },
}));

vi.mock("../../server/utils/openaiClient", () => ({
  requireOpenAIClient: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}));

// ─── DB mock ────────────────────────────────────────────────────────────────

const INSERTED: Array<Record<string, any>> = [];
let nextId = 1;

const FIND_FIRST: Record<string, any> = {};

function findFirstFor(table: string) {
  return vi.fn(async () => FIND_FIRST[table] ?? null);
}

vi.mock("../../server/db", () => {
  const db = {
    query: {
      supportTickets: { findFirst: findFirstFor("supportTickets") },
      systemAlerts: { findFirst: findFirstFor("systemAlerts") },
      featureRequests: { findFirst: findFirstFor("featureRequests") },
      organizations: { findFirst: findFirstFor("organizations") },
      decisionsInboxItems: { findFirst: findFirstFor("decisionsInboxItems") },
      paxDecisionAppeals: { findFirst: findFirstFor("paxDecisionAppeals") },
      paxRefusalPayloads: { findFirst: findFirstFor("paxRefusalPayloads") },
      recourseDrafts: { findFirst: findFirstFor("recourseDrafts") },
    },
    insert: (_t: any) => ({
      values: (row: Record<string, any>) => ({
        returning: () => {
          const withId = { id: nextId++, ...row };
          INSERTED.push(withId);
          return Promise.resolve([withId]);
        },
      }),
    }),
    update: (_t: any) => ({
      set: (_v: Record<string, any>) => ({ where: (_w: any) => Promise.resolve() }),
    }),
  };
  return { db };
});

import {
  decisionsInboxService,
  ABUSE_REPORT_ITEM_TYPE,
  ABUSE_REPORT_REASON_MAX_CHARS,
  isMirroredQueueItemType,
  MIRRORED_QUEUE_ITEM_TYPES,
} from "../../server/services/decisionsInbox";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

const REPORT = {
  pagePath: "/portal/note_abc123",
  reason: "This asks me to wire money to a personal account. Looks like a scam.",
  organizationId: 7,
  noteId: 42,
  orgTrustTier: "new",
  reporterIp: "203.0.113.5",
  reporterUserAgent: "Mozilla/5.0",
};

beforeEach(() => {
  ARBITER_CALLS.length = 0;
  INSERTED.length = 0;
  nextId = 1;
  arbiterMode = "deliver";
  for (const k of Object.keys(FIND_FIRST)) delete FIND_FIRST[k];
});

// ─── 1. One hop: report → queue row ─────────────────────────────────────────

describe("createFromAbuseReport — one event hop onto the decisions door", () => {
  it("files a Class-B abuse_report card: riskLevel high, NO executable payload, verbatim in context only", async () => {
    const res = await decisionsInboxService.createFromAbuseReport(REPORT);

    expect(res.created).toBe(true);
    expect(ARBITER_CALLS).toHaveLength(1);
    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED).toHaveLength(1);
    expect(INSERTED[0]).toMatchObject({
      itemType: ABUSE_REPORT_ITEM_TYPE,
      riskLevel: "high",
      status: "pending",
      actionPayload: null,
      organizationId: 7,
      ownerAgentCodename: "quinn",
    });
    expect(INSERTED[0].contextBundle).toMatchObject({
      pagePath: "/portal/note_abc123",
      reporterReason: REPORT.reason,
      noteId: 42,
      orgTrustTier: "new",
      reporterIp: "203.0.113.5",
    });
    // Free-text discipline: the reporter's words feed the FOUNDER, not the
    // model-read analysis text (createFromAppeal discipline).
    expect(INSERTED[0].sophieAnalysis).not.toContain("wire money");
  });

  it("caps the verbatim reason at the documented maximum", async () => {
    const long = "x".repeat(ABUSE_REPORT_REASON_MAX_CHARS + 500);
    await decisionsInboxService.createFromAbuseReport({ ...REPORT, reason: long });
    expect(INSERTED[0].contextBundle.reporterReason).toHaveLength(ABUSE_REPORT_REASON_MAX_CHARS);
  });

  it("refuses to file an empty reason — no row, no arbitration", async () => {
    const res = await decisionsInboxService.createFromAbuseReport({ ...REPORT, reason: "   " });
    expect(res).toEqual({ itemId: null, created: false });
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("an unresolvable token still files (org null) — a phishing page must be reportable", async () => {
    const res = await decisionsInboxService.createFromAbuseReport({
      ...REPORT,
      organizationId: null,
      noteId: null,
      orgTrustTier: null,
    });
    expect(res.created).toBe(true);
    expect(INSERTED[0].organizationId).toBeNull();
    expect(INSERTED[0].contextBundle).not.toHaveProperty("noteId");
    expect(INSERTED[0].contextBundle).not.toHaveProperty("orgTrustTier");
  });

  it("dedupes on an OPEN report for the same (org, page) — no second row, no arbitration", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 5,
      itemType: ABUSE_REPORT_ITEM_TYPE,
      status: "pending",
      organizationId: 7,
      contextBundle: { pagePath: "/portal/note_abc123" },
    };
    const res = await decisionsInboxService.createFromAbuseReport(REPORT);
    expect(res).toEqual({ itemId: 5, created: false });
    expect(INSERTED).toHaveLength(0);
    expect(ARBITER_CALLS).toHaveLength(0);
  });

  it("null-pagePath reports dedupe too — the SQL predicate branches to IS NULL (fleet-6 verifier catch)", async () => {
    // `->>'pagePath' = 'null'` never matches SQL NULL, so before the branch
    // fix every null-page report filed a fresh row — compounding the rate-limit
    // hole for direct API callers that omit pagePath. Pin BOTH layers: the
    // in-process re-check dedupes on null === null…
    FIND_FIRST.decisionsInboxItems = {
      id: 6,
      itemType: ABUSE_REPORT_ITEM_TYPE,
      status: "pending",
      organizationId: null,
      contextBundle: { reason: "spam" },
    };
    const res = await decisionsInboxService.createFromAbuseReport({
      ...REPORT,
      pagePath: null,
      organizationId: null,
      noteId: null,
      orgTrustTier: null,
    });
    expect(res).toEqual({ itemId: 6, created: false });
    expect(INSERTED).toHaveLength(0);
    // …and the SQL layer carries the IS NULL branch (source-pinned since the
    // mock intercepts the query itself).
    const src = read("server/services/decisionsInbox.ts");
    expect(src).toMatch(/pagePath == null\s*\?\s*sql`\$\{decisionsInboxItems\.contextBundle\}->>'pagePath' IS NULL`/);
  });

  it("a RESOLVED report for the same page does not block a fresh filing", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 5,
      itemType: ABUSE_REPORT_ITEM_TYPE,
      status: "approved",
      organizationId: 7,
      contextBundle: { pagePath: "/portal/note_abc123" },
    };
    const res = await decisionsInboxService.createFromAbuseReport(REPORT);
    expect(res.created).toBe(true);
    expect(INSERTED).toHaveLength(1);
  });

  it("arbiter deferral lands the report as deferred — the row is never dropped", async () => {
    arbiterMode = "defer";
    const res = await decisionsInboxService.createFromAbuseReport(REPORT);
    expect(res.created).toBe(true);
    expect(INSERTED[0].status).toBe("deferred");
    expect(INSERTED[0].deferredUntil).toEqual(DEFER_UNTIL);
  });
});

// ─── 2. Native item, not a mirror ───────────────────────────────────────────

describe("abuse_report is a NATIVE queue item — not a mirror", () => {
  it("is absent from the mirror registry and unrecognized by the mirror guard", () => {
    expect(Object.keys(MIRRORED_QUEUE_ITEM_TYPES)).not.toContain(ABUSE_REPORT_ITEM_TYPE);
    expect(isMirroredQueueItemType(ABUSE_REPORT_ITEM_TYPE)).toBe(false);
  });

  it("terminal disposition verbs work on it directly (refuseIfMirror lets it through)", async () => {
    FIND_FIRST.decisionsInboxItems = {
      id: 9,
      itemType: ABUSE_REPORT_ITEM_TYPE,
      status: "pending",
      actionPayload: null,
      contextBundle: {},
    };
    // Would throw MirrorDispositionError for a mirror type — must not here.
    await expect(
      decisionsInboxService.reject(9, "false alarm — page is legitimate"),
    ).resolves.toBeUndefined();
  });

  it("has an owning agent on the roster mapping (quinn — Chief of Alignment)", () => {
    expect(decisionsInboxService.inferAgent(ABUSE_REPORT_ITEM_TYPE)).toBe("quinn");
  });
});

// ─── 3. Wiring pins — endpoint + portal affordance actually exist ───────────

describe("wiring pins — the report path is built AND wired, both sides", () => {
  it("POST /api/borrower/report-page exists, is rate-limited, and calls the service in ONE hop", () => {
    const src = read("server/routes-borrower.ts");
    expect(src).toContain('"/api/borrower/report-page"');
    // BOTH limiters ride the route registration itself. Two gates compose
    // (fleet-6 verifier catch): borrowerPortalKey trusts the CALLER-SUPPLIED
    // accessToken as its bucket key, so a rotating random token minted a
    // fresh bucket per request and the per-token cap never tripped — the
    // IP-keyed gate bounds that adversary, while real borrowers with one
    // token stay governed by the tighter per-token budget.
    expect(src).toMatch(/report-page",\s*abuseReportIpLimiter,\s*abuseReportRateLimiter/);
    expect(src).toMatch(/abuseReportRateLimiter = createRateLimiter\(\{ maxRequests: 5, windowMs: 60 \* 60 \* 1000 \}, borrowerPortalKey\)/);
    expect(src).toMatch(/abuseReportIpLimiter = createRateLimiter\(\s*\{ maxRequests: 30, windowMs: 60 \* 60 \* 1000 \},\s*\(req\) => `abuse-ip:\$\{req\.ip/);
    // One hop: the handler calls the service directly — no intermediate store.
    expect(src).toContain("decisionsInboxService.createFromAbuseReport(");
    // No token oracle: the acknowledgment is identical either way.
    expect(src).toMatch(/res\.json\(\{ received: true \}\)/);
  });

  it("the portal page renders the footer control with a labeled textarea (a11y)", () => {
    const page = read("client/src/pages/borrower-portal.tsx");
    expect(page).toContain("function ReportPageFooter");
    expect(page).toContain('"/api/borrower/report-page"');
    expect(page).toContain('htmlFor="report-page-reason"');
    expect(page).toContain('id="report-page-reason"');
    // Rendered on the sign-in screen, the expired screen, AND the verified
    // dashboard — a small footer control, never a new route or nav entry.
    const renders = page.match(/<ReportPageFooter accessToken=\{accessToken\} \/>/g) ?? [];
    expect(renders.length).toBeGreaterThanOrEqual(3);
    // NOT a new route: App.tsx is untouched by this affordance.
    const app = read("client/src/App.tsx");
    expect(app).not.toContain("report-page");
  });

  it("the schema's itemType comment records the new native type", () => {
    const schema = read("shared/schema.ts");
    expect(schema).toMatch(/abuse_report \(X-A: NATIVE item/);
  });
});
