/**
 * Alert spine (services/alertSpine.ts) — Tier 1D of the elevation blueprint.
 *
 * The ONE policy layer in front of the four alert nervous systems
 * (notifyOnCall, sendSolenePage, domain_audit_findings, system_alerts).
 *
 * Coverage:
 *   1. critical ⇒ BOTH page transports invoked (notifyOnCall + sendSolenePage)
 *      + finding + system_alerts row — and exactly ONE page even though
 *      recordFinding internally re-routes criticals to the pager (the dedupe
 *      window suppresses the double).
 *   2. warning ⇒ NO page; finding (severity "warn") + system_alerts row.
 *   3. info ⇒ finding only; no system_alerts, no page.
 *   4. dedupe window: a flapping critical with the same (source, dedupeKey)
 *      pages once; a different dedupeKey pages again.
 *   5. HEADLINE FIX: recordFinding(severity:"critical") — called directly,
 *      not via raiseAlert — now actually pages. warn findings do not.
 *   6. New dark signal: transparency-draft staleness (>30d unpublished and
 *      no recent publication) raises an info alert through the spine; a
 *      recent publication suppresses it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── shared insert-capturing db mock ──────────────────────────────────────────

type InsertedValues = Record<string, any>;

function makeDbMock(insertCalls: InsertedValues[]) {
  return {
    insert: (_table: unknown) => ({
      values: (vals: InsertedValues) => {
        insertCalls.push(vals);
        const p: any = Promise.resolve([]);
        p.onConflictDoUpdate = () => Promise.resolve([]);
        p.returning = () => Promise.resolve([{ id: insertCalls.length }]);
        return p;
      },
    }),
  };
}

// A findings upsert carries `detector` + `dedupeKey`; a system_alerts insert
// carries `message` + `type`. Distinguish by shape, not table identity (module
// resets between tests make identity comparisons brittle).
const findingInserts = (calls: InsertedValues[]) =>
  calls.filter((v) => "detector" in v && "dedupeKey" in v);
const systemAlertInserts = (calls: InsertedValues[]) =>
  calls.filter((v) => "message" in v && "type" in v);

describe("alertSpine policy layer", () => {
  let spine: typeof import("../../server/services/alertSpine");
  let domainAudit: typeof import("../../server/services/audit/domainAudit");
  let notifyOnCallSpy: ReturnType<typeof vi.fn>;
  let sendSolenePageSpy: ReturnType<typeof vi.fn>;
  let insertCalls: InsertedValues[];

  beforeEach(async () => {
    vi.resetModules();

    notifyOnCallSpy = vi.fn().mockResolvedValue({
      notificationId: 1,
      push: { sent: 1, failed: 0 },
      emailSent: true,
      ackTimerRegistered: true,
    });
    sendSolenePageSpy = vi.fn().mockResolvedValue({
      eventId: 1,
      deliveryStatus: "delivered",
      deliveryDetail: null,
    });
    insertCalls = [];

    vi.doMock("../../server/db", () => ({ db: makeDbMock(insertCalls) }));
    vi.doMock("../../server/utils/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    vi.doMock("../../server/services/oncall", () => ({
      notifyOnCall: notifyOnCallSpy,
    }));
    vi.doMock("../../server/services/solene/pagerService", () => ({
      sendSolenePage: sendSolenePageSpy,
    }));

    spine = await import("../../server/services/alertSpine");
    domainAudit = await import("../../server/services/audit/domainAudit");
    spine.__resetAlertSpineForTests();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const baseInput = {
    source: "test_detector",
    title: "Something broke",
    detail: "The thing is broken in a specific way.",
    dedupeKey: "thing:broken",
  } as const;

  it("critical ⇒ pages through BOTH transports + finding + system_alerts (and pages exactly once)", async () => {
    const result = await spine.raiseAlert({ severity: "critical", ...baseInput });

    expect(result.paged).toBe(true);
    expect(result.findingRecorded).toBe(true);
    expect(result.systemAlertWritten).toBe(true);

    // Page transport A: notifyOnCall — exactly ONE page even though
    // recordFinding internally re-routes criticals to the pager (the spine's
    // window suppresses the double).
    expect(notifyOnCallSpy).toHaveBeenCalledTimes(1);
    expect(notifyOnCallSpy).toHaveBeenCalledWith(
      "P0",
      "Something broke",
      "The thing is broken in a specific way.",
      expect.objectContaining({ source: "test_detector", dedupeKey: "thing:broken" }),
    );

    // Page transport B: Solene ntfy.
    expect(sendSolenePageSpy).toHaveBeenCalledTimes(1);
    expect(sendSolenePageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical", subject: "Something broke" }),
    );

    // Durable finding (upsert) at critical severity.
    const findings = findingInserts(insertCalls);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      detector: "test_detector",
      severity: "critical",
      dedupeKey: "thing:broken",
    });

    // system_alerts row.
    const alerts = systemAlertInserts(insertCalls);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: "critical", title: "Something broke" });
  });

  it("warning ⇒ finding + system_alerts, NO page", async () => {
    const result = await spine.raiseAlert({ severity: "warning", ...baseInput });

    expect(result.paged).toBe(false);
    expect(notifyOnCallSpy).not.toHaveBeenCalled();
    expect(sendSolenePageSpy).not.toHaveBeenCalled();

    const findings = findingInserts(insertCalls);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn"); // spine maps warning → findings "warn"

    const alerts = systemAlertInserts(insertCalls);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(result.systemAlertWritten).toBe(true);
  });

  it("info ⇒ finding only — no system_alerts, no page", async () => {
    const result = await spine.raiseAlert({ severity: "info", ...baseInput });

    expect(result.paged).toBe(false);
    expect(result.systemAlertWritten).toBe(false);
    expect(notifyOnCallSpy).not.toHaveBeenCalled();
    expect(sendSolenePageSpy).not.toHaveBeenCalled();

    expect(findingInserts(insertCalls)).toHaveLength(1);
    expect(systemAlertInserts(insertCalls)).toHaveLength(0);
  });

  it("dedupe window suppresses repeat pages for the same key; a different key pages", async () => {
    const first = await spine.raiseAlert({ severity: "critical", ...baseInput });
    const second = await spine.raiseAlert({ severity: "critical", ...baseInput });

    expect(first.paged).toBe(true);
    expect(second.paged).toBe(false);
    expect(notifyOnCallSpy).toHaveBeenCalledTimes(1);
    expect(sendSolenePageSpy).toHaveBeenCalledTimes(1);
    // system_alerts is windowed too — a flapping check doesn't spam /admin/alerts.
    expect(systemAlertInserts(insertCalls)).toHaveLength(1);

    const third = await spine.raiseAlert({
      severity: "critical",
      ...baseInput,
      dedupeKey: "other:condition",
    });
    expect(third.paged).toBe(true);
    expect(notifyOnCallSpy).toHaveBeenCalledTimes(2);
  });

  it("HEADLINE: recordFinding(severity:'critical') called directly now pages", async () => {
    await domainAudit.recordFinding({
      domain: "compliance",
      detector: "some_audit",
      severity: "critical",
      title: "Critical audit finding",
      detail: "This used to rot in a table nobody watches.",
      citedReason: "Tier 1D",
      dedupeKey: "audit:bad",
    });

    expect(notifyOnCallSpy).toHaveBeenCalledTimes(1);
    expect(notifyOnCallSpy).toHaveBeenCalledWith(
      "P0",
      "Critical audit finding",
      "This used to rot in a table nobody watches.",
      expect.objectContaining({ source: "some_audit", dedupeKey: "audit:bad" }),
    );
    expect(sendSolenePageSpy).toHaveBeenCalledTimes(1);
    // The finding itself still landed.
    expect(findingInserts(insertCalls)).toHaveLength(1);
  });

  it("recordFinding(severity:'warn') does NOT page", async () => {
    await domainAudit.recordFinding({
      domain: "reliability",
      detector: "some_audit",
      severity: "warn",
      title: "Warn finding",
      detail: "Not page-worthy.",
      citedReason: "Tier 1D",
      dedupeKey: "audit:meh",
    });

    expect(notifyOnCallSpy).not.toHaveBeenCalled();
    expect(sendSolenePageSpy).not.toHaveBeenCalled();
    expect(findingInserts(insertCalls)).toHaveLength(1);
  });
});

// ── New dark signal: transparency-draft staleness ────────────────────────────

describe("checkTransparencyDraftStaleness (Tier 1D dark signal)", () => {
  let raiseAlertSpy: ReturnType<typeof vi.fn>;
  let executeResults: Array<{ rows: any[] }>;

  beforeEach(() => {
    vi.resetModules();

    raiseAlertSpy = vi.fn().mockResolvedValue({
      paged: false,
      findingRecorded: true,
      systemAlertWritten: false,
    });
    executeResults = [];

    vi.doMock("../../server/db", () => ({
      db: { execute: vi.fn(() => Promise.resolve(executeResults.shift() ?? { rows: [] })) },
    }));
    vi.doMock("../../server/utils/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    vi.doMock("../../server/services/pax/alignmentDetectors", () => ({
      alignmentDetectors: [],
    }));
    vi.doMock("../../server/services/alertSpine", () => ({
      raiseAlert: raiseAlertSpy,
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

  it("raises an info alert when the oldest draft is >30d unpublished and nothing was published recently", async () => {
    executeResults.push(
      { rows: [{ id: 7, created_at: daysAgo(45).toISOString() }] }, // oldest stale draft
      { rows: [{ last_published: null }] }, // never published
    );

    const { checkTransparencyDraftStaleness } = await import(
      "../../server/jobs/transparencyReportAggregator"
    );
    const raised = await checkTransparencyDraftStaleness();

    expect(raised).toBe(true);
    expect(raiseAlertSpy).toHaveBeenCalledTimes(1);
    expect(raiseAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "info",
        source: "transparency_draft_staleness",
        dedupeKey: "transparency:draft_stale",
        domain: "alignment",
      }),
    );
  });

  it("stays silent when a report was published inside the window", async () => {
    executeResults.push(
      { rows: [{ id: 7, created_at: daysAgo(45).toISOString() }] }, // old superseded draft exists…
      { rows: [{ last_published: daysAgo(10).toISOString() }] }, // …but cadence is healthy
    );

    const { checkTransparencyDraftStaleness } = await import(
      "../../server/jobs/transparencyReportAggregator"
    );
    const raised = await checkTransparencyDraftStaleness();

    expect(raised).toBe(false);
    expect(raiseAlertSpy).not.toHaveBeenCalled();
  });
});
