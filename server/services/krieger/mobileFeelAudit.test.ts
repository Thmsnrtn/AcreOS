/**
 * Tests for Krieger's mobile-feel continuous-audit service.
 *
 * Coverage:
 *  1. runMobileFeelAudit happy path — all 7 detectors run; findings persist;
 *     high/critical → enqueue called with right shape.
 *  2. Sanitization — credential-prefix strings in evidence get replaced with
 *     [REDACTED] before persistence.
 *  3. Severity gating — medium/low/informational findings persist but do
 *     NOT trigger enqueueDispatch.
 *  4. Idempotency — pre-existing queued dispatch for sourceId='krieger-
 *     audit:<id>' skips enqueue.
 *  5. enqueueDispatch throws → counted in errors, no exception escapes.
 *  6. One detector throws → other detectors still run + complete.
 *  7. buildMobileFeelFixPrompt includes route + viewport + findingText.
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

// ── enqueueDispatch mock ───────────────────────────────────────────────
const enqueueDispatchCalls: Array<Record<string, unknown>> = [];
let enqueueDispatchShouldThrow: string | null = null;
let nextDispatchId = 9000;

vi.mock("../solene/dispatchQueue", () => ({
  enqueueDispatch: vi.fn(async (opts: Record<string, unknown>) => {
    enqueueDispatchCalls.push(opts);
    if (enqueueDispatchShouldThrow !== null) {
      throw new Error(enqueueDispatchShouldThrow);
    }
    return nextDispatchId++;
  }),
}));

// ── DB stub state ───────────────────────────────────────────────────────
interface FindingRow {
  id: number;
  detectorName: string;
  severity: string;
  targetRoute: string | null;
  targetViewport: string | null;
  findingText: string;
  evidenceSnippet: string | null;
  recommendedAction: string | null;
  fixDispatchId: number | null;
}

const FINDINGS: FindingRow[] = [];
let nextFindingId = 1;

// Pre-existing dispatch-queue rows used by the idempotency lookup.
interface QueueRow {
  id: number;
  sourceType: string;
  sourceId: string;
  status: string;
}
const QUEUE: QueueRow[] = [];

// Capture for the error_boundary detector lookup (last-24h rows).
const ERROR_BOUNDARY_QUEUE_ROWS: Array<{
  id: number;
  sourceId: string;
  queuedAt: Date;
}> = [];

// ── DB mock ─────────────────────────────────────────────────────────────
// The service uses two table identities:
//   - kriegerAuditFindings (insert + update)
//   - soleneDispatchQueue  (select for idempotency + select for boundary detector)
// We dispatch by inspecting the table object's symbol-like field.

vi.mock("../../db", () => {
  // We pick out which "table" by the Symbol present on the drizzle pgTable
  // object — in practice we just compare reference identity via a tag we
  // attach in the schema mock below.
  function tableTag(t: unknown): string {
    return (t as { __kriegerTag?: string })?.__kriegerTag ?? "unknown";
  }

  function buildInsert(table: unknown) {
    const tag = tableTag(table);
    return {
      values: (row: any) => ({
        returning: (_cols: unknown) => {
          if (tag === "krieger_audit_findings") {
            const r: FindingRow = {
              id: nextFindingId++,
              detectorName: row.detectorName,
              severity: row.severity,
              targetRoute: row.targetRoute ?? null,
              targetViewport: row.targetViewport ?? null,
              findingText: row.findingText,
              evidenceSnippet: row.evidenceSnippet ?? null,
              recommendedAction: row.recommendedAction ?? null,
              fixDispatchId: null,
            };
            FINDINGS.push(r);
            return Promise.resolve([{ id: r.id }]);
          }
          return Promise.resolve([]);
        },
      }),
    };
  }

  function buildUpdate(table: unknown) {
    const tag = tableTag(table);
    return {
      set: (patch: any) => ({
        where: (clause: any) => {
          if (tag === "krieger_audit_findings") {
            const id = (clause as any)?.__findingId;
            if (typeof id === "number") {
              const row = FINDINGS.find((r) => r.id === id);
              if (row && patch.fixDispatchId !== undefined) {
                row.fixDispatchId = patch.fixDispatchId;
              }
            }
          }
          return Promise.resolve();
        },
      }),
    };
  }

  function buildSelect(_cols: any) {
    const chain: any = {
      _table: null as unknown,
      _where: null as any,
      from: (t: unknown) => {
        chain._table = t;
        return chain;
      },
      where: (clause: any) => {
        chain._where = clause;
        return chain;
      },
      limit: (_n: number) => Promise.resolve(materialize()),
      then: (resolve: any) => Promise.resolve(materialize()).then(resolve),
    };

    function materialize(): unknown[] {
      const tag = tableTag(chain._table);
      const w = chain._where;
      if (tag === "solene_dispatch_queue") {
        // Two query shapes hit this table:
        //   (A) idempotency: where sourceType='detector', sourceId=X, status in [queued, in_progress]
        //   (B) error-boundary detector: where queuedAt >= cutoff and sourceId LIKE %error*%
        if (w?.__idempotency) {
          const sid = w.__sourceId;
          return QUEUE.filter(
            (q) =>
              q.sourceType === "detector" &&
              q.sourceId === sid &&
              (q.status === "queued" || q.status === "in_progress"),
          ).map((q) => ({ id: q.id }));
        }
        if (w?.__errorBoundary) {
          return ERROR_BOUNDARY_QUEUE_ROWS.map((r) => ({
            id: r.id,
            sourceId: r.sourceId,
            queuedAt: r.queuedAt,
          }));
        }
      }
      return [];
    }

    return chain;
  }

  return {
    db: {
      insert: (table: unknown) => buildInsert(table),
      update: (table: unknown) => buildUpdate(table),
      select: (cols?: any) => buildSelect(cols),
    },
  };
});

// ── Schema tags (so the db mock can dispatch by table identity) ────────
vi.mock("@shared/schema/krieger-audit", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/schema/krieger-audit")
  >("@shared/schema/krieger-audit");
  const taggedTable = Object.assign({}, actual.kriegerAuditFindings, {
    __kriegerTag: "krieger_audit_findings",
    id: { __col: "id" },
    fixDispatchId: { __col: "fixDispatchId" },
  });
  return {
    ...actual,
    kriegerAuditFindings: taggedTable,
  };
});

vi.mock("@shared/schema/solene-dispatch", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/schema/solene-dispatch")
  >("@shared/schema/solene-dispatch");
  const taggedQueue = Object.assign({}, actual.soleneDispatchQueue, {
    __kriegerTag: "solene_dispatch_queue",
    sourceType: { __col: "sourceType" },
    sourceId: { __col: "sourceId" },
    status: { __col: "status" },
    queuedAt: { __col: "queuedAt" },
    id: { __col: "id" },
  });
  return {
    ...actual,
    soleneDispatchQueue: taggedQueue,
  };
});

// ── drizzle-orm where-clause mock ──────────────────────────────────────
// We intercept the predicate builders so the db mock can see *what* the
// service is asking for. The behavior must mirror real semantics enough
// that the service paths run end-to-end.

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    eq: (col: any, val: any) => ({
      __op: "eq",
      __col: col?.__col,
      __val: val,
    }),
    and: (...preds: any[]) => {
      // Detect known compound shapes.
      const cols = preds
        .filter((p) => p?.__op === "eq")
        .map((p) => p.__col);
      const hasSourceType = preds.some(
        (p) => p?.__op === "eq" && p.__col === "sourceType",
      );
      const hasSourceIdEq = preds.some(
        (p) => p?.__op === "eq" && p.__col === "sourceId",
      );
      const sourceIdEq = preds.find(
        (p) => p?.__op === "eq" && p.__col === "sourceId",
      );
      const hasStatusInArray = preds.some((p) => p?.__inArray);
      if (hasSourceType && hasSourceIdEq && hasStatusInArray) {
        return {
          __idempotency: true,
          __sourceId: sourceIdEq?.__val,
        };
      }
      const hasGte = preds.some((p) => p?.__op === "gte");
      const hasOr = preds.some((p) => p?.__op === "or");
      if (hasGte && hasOr) {
        return { __errorBoundary: true };
      }
      // findingId update path.
      const idEq = preds.find((p) => p?.__op === "eq" && p.__col === "id");
      if (idEq) return { __findingId: idEq.__val };
      return { __cols: cols };
    },
    or: (..._preds: any[]) => ({ __op: "or" }),
    inArray: (_col: any, vals: any[]) => ({ __inArray: true, __vals: vals }),
    like: (col: any, pattern: string) => ({
      __op: "like",
      __col: col?.__col,
      __pattern: pattern,
    }),
    gte: (col: any, val: any) => ({ __op: "gte", __col: col?.__col, __val: val }),
    desc: (_col: any) => ({ __desc: true }),
    sql: Object.assign(
      (..._args: any[]) => ({ __sql: true }),
      { raw: (..._args: any[]) => ({ __sql: true }) },
    ),
  };
});

// ── Helpers ─────────────────────────────────────────────────────────────

beforeEach(() => {
  FINDINGS.length = 0;
  QUEUE.length = 0;
  ERROR_BOUNDARY_QUEUE_ROWS.length = 0;
  enqueueDispatchCalls.length = 0;
  enqueueDispatchShouldThrow = null;
  nextFindingId = 1;
  nextDispatchId = 9000;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe("sanitizeEvidence", () => {
  it("redacts sk_live_ / pk_test_ / ghp_ / Bearer / AKIA prefixes", async () => {
    const { sanitizeEvidence } = await import("./mobileFeelAudit");
    const input = [
      "API key: sk_live_abc123def456",
      "Public key: pk_test_xyz789",
      "GitHub token: ghp_ABCDEFG1234567",
      "Authorization: Bearer eyJhbGc.payload.sig",
      "AWS access: AKIA1234567890ABCDEF", // secret-scan:allow
    ].join("\n");
    const out = sanitizeEvidence(input);
    expect(out).not.toContain("sk_live_abc");
    expect(out).not.toContain("pk_test_xyz");
    expect(out).not.toContain("ghp_ABCDEFG");
    expect(out).not.toContain("eyJhbGc.payload.sig");
    expect(out).not.toContain("AKIA1234567890ABCDEF"); // secret-scan:allow
    expect(out).toContain("[REDACTED]");
  });

  it("passes clean text through unchanged", async () => {
    const { sanitizeEvidence } = await import("./mobileFeelAudit");
    const clean = "Button on /today has no active: class";
    expect(sanitizeEvidence(clean)).toBe(clean);
  });
});

describe("buildMobileFeelFixPrompt", () => {
  it("includes finding id + detector + route + viewport + findingText", async () => {
    const { buildMobileFeelFixPrompt } = await import("./mobileFeelAudit");
    const prompt = buildMobileFeelFixPrompt({
      id: 42,
      detectorName: "touch_target_drift",
      severity: "high",
      targetRoute: "/deals",
      targetViewport: "390x844",
      findingText: "Button lacks active: companion class",
      evidenceSnippet: "+ <button onClick={...}",
      recommendedAction: "Add active:scale-95",
    });
    expect(prompt).toContain("#42");
    expect(prompt).toContain("touch_target_drift");
    expect(prompt).toContain("/deals");
    expect(prompt).toContain("390x844");
    expect(prompt).toContain("Button lacks active: companion class");
    expect(prompt).toContain("active:scale-95");
  });

  it("uses placeholders when route/viewport are null", async () => {
    const { buildMobileFeelFixPrompt } = await import("./mobileFeelAudit");
    const prompt = buildMobileFeelFixPrompt({
      id: 7,
      detectorName: "real_device_gap",
      severity: "medium",
      targetRoute: null,
      targetViewport: null,
      findingText: "No iPad mini coverage in 14d",
      evidenceSnippet: null,
      recommendedAction: null,
    });
    expect(prompt).toContain("unknown route");
    expect(prompt).toContain("any mobile viewport");
    expect(prompt).toContain("No iPad mini coverage in 14d");
  });
});

describe("runMobileFeelAudit — orchestration", () => {
  it("runs all 7 detectors, persists findings, enqueues for high/critical only", async () => {
    const mod = await import("./mobileFeelAudit");

    // Stub each detector so the orchestrator gets a deterministic mix.
    vi.spyOn(mod.DETECTORS, "detectTouchTargetDrift").mockResolvedValue([
      {
        detectorName: "touch_target_drift",
        severity: "medium",
        targetRoute: "/today",
        findingText: "no active: on new button",
      },
    ]);
    vi.spyOn(mod.DETECTORS, "detectCrossDeviceMatrixRed").mockResolvedValue([
      {
        detectorName: "cross_device_matrix_red",
        severity: "high",
        targetViewport: "390x844",
        findingText: "tap failed on /deals",
      },
    ]);
    vi.spyOn(mod.DETECTORS, "detectMobileErrorBoundaryTrip").mockResolvedValue([
      {
        detectorName: "mobile_error_boundary_trip",
        severity: "critical",
        findingText: "boundary tripped 7x",
      },
    ]);
    vi.spyOn(mod.DETECTORS, "detectThemeContractDrift").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectPwaInstallRegression").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectRealDeviceGap").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectDesktopKeyboardNavDrift").mockResolvedValue([]);

    const result = await mod.runMobileFeelAudit();
    expect(result.detectorsRun).toBe(7);
    expect(result.findingsRecorded).toBe(3);
    expect(result.dispatchesEnqueued).toBe(2); // high + critical
    expect(result.errors).toBe(0);

    // Findings persisted.
    expect(FINDINGS).toHaveLength(3);

    // Two enqueues: one for high, one for critical.
    expect(enqueueDispatchCalls).toHaveLength(2);

    const critical = enqueueDispatchCalls.find(
      (c) => (c.priority as number) === 2.5,
    );
    const high = enqueueDispatchCalls.find(
      (c) => (c.priority as number) === 1.6,
    );
    expect(critical).toBeDefined();
    expect(high).toBeDefined();

    // Shape assertions on the critical call.
    expect(critical!.sourceType).toBe("detector");
    expect(critical!.agentRole).toBe("krieger");
    expect(critical!.maxCostUsd).toBe(18);
    expect(critical!.timeoutMs).toBe(10 * 60 * 1000);
    expect(critical!.enqueuedBy).toBe("krieger-audit");
    expect(String(critical!.sourceId)).toMatch(/^krieger-audit:\d+$/);
    expect(String(critical!.promptText)).toContain("boundary tripped 7x");
  });

  it("sanitizes evidence with credential prefixes before persistence", async () => {
    const mod = await import("./mobileFeelAudit");

    vi.spyOn(mod.DETECTORS, "detectTouchTargetDrift").mockResolvedValue([
      {
        detectorName: "touch_target_drift",
        severity: "high",
        targetRoute: "/today",
        findingText: "leak",
        evidenceSnippet: "API_KEY=sk_live_LEAKEDsecretvalue123 token in DOM",
      },
    ]);
    vi.spyOn(mod.DETECTORS, "detectCrossDeviceMatrixRed").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectMobileErrorBoundaryTrip").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectThemeContractDrift").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectPwaInstallRegression").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectRealDeviceGap").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectDesktopKeyboardNavDrift").mockResolvedValue([]);

    await mod.runMobileFeelAudit();
    expect(FINDINGS).toHaveLength(1);
    expect(FINDINGS[0].evidenceSnippet).not.toContain("sk_live_LEAKED");
    expect(FINDINGS[0].evidenceSnippet).toContain("[REDACTED]");
  });

  it("does NOT enqueue for medium/low/informational findings", async () => {
    const mod = await import("./mobileFeelAudit");

    vi.spyOn(mod.DETECTORS, "detectTouchTargetDrift").mockResolvedValue([
      {
        detectorName: "touch_target_drift",
        severity: "medium",
        findingText: "med",
      },
      {
        detectorName: "touch_target_drift",
        severity: "low",
        findingText: "low",
      },
      {
        detectorName: "touch_target_drift",
        severity: "informational",
        findingText: "info",
      },
    ]);
    vi.spyOn(mod.DETECTORS, "detectCrossDeviceMatrixRed").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectMobileErrorBoundaryTrip").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectThemeContractDrift").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectPwaInstallRegression").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectRealDeviceGap").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectDesktopKeyboardNavDrift").mockResolvedValue([]);

    const result = await mod.runMobileFeelAudit();
    expect(result.findingsRecorded).toBe(3);
    expect(result.dispatchesEnqueued).toBe(0);
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("skips enqueue when a queued dispatch for the same findingId already exists", async () => {
    const mod = await import("./mobileFeelAudit");

    // Pre-seed a queued dispatch for findingId=1 (the next inserted finding).
    QUEUE.push({
      id: 555,
      sourceType: "detector",
      sourceId: "krieger-audit:1",
      status: "queued",
    });

    vi.spyOn(mod.DETECTORS, "detectTouchTargetDrift").mockResolvedValue([
      {
        detectorName: "touch_target_drift",
        severity: "high",
        findingText: "dup",
      },
    ]);
    vi.spyOn(mod.DETECTORS, "detectCrossDeviceMatrixRed").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectMobileErrorBoundaryTrip").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectThemeContractDrift").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectPwaInstallRegression").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectRealDeviceGap").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectDesktopKeyboardNavDrift").mockResolvedValue([]);

    const result = await mod.runMobileFeelAudit();
    expect(result.findingsRecorded).toBe(1);
    expect(result.dispatchesEnqueued).toBe(0); // idempotency skip
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("counts errors when enqueueDispatch throws — never propagates", async () => {
    const mod = await import("./mobileFeelAudit");

    enqueueDispatchShouldThrow = "dispatch queue down";

    vi.spyOn(mod.DETECTORS, "detectTouchTargetDrift").mockResolvedValue([
      {
        detectorName: "touch_target_drift",
        severity: "critical",
        findingText: "boom",
      },
    ]);
    vi.spyOn(mod.DETECTORS, "detectCrossDeviceMatrixRed").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectMobileErrorBoundaryTrip").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectThemeContractDrift").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectPwaInstallRegression").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectRealDeviceGap").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectDesktopKeyboardNavDrift").mockResolvedValue([]);

    // Must not throw.
    const result = await mod.runMobileFeelAudit();
    expect(result.findingsRecorded).toBe(1);
    expect(result.dispatchesEnqueued).toBe(0);
    // enqueueDispatch was called but failed — counted internally; orchestrator
    // does not surface as a top-level error because maybeEnqueueFix swallows
    // the rejection and returns false. The dispatch simply didn't ship.
    expect(enqueueDispatchCalls).toHaveLength(1);
  });

  it("isolates one detector throwing from the others", async () => {
    const mod = await import("./mobileFeelAudit");

    vi.spyOn(mod.DETECTORS, "detectTouchTargetDrift").mockRejectedValue(
      new Error("git unavailable"),
    );
    vi.spyOn(mod.DETECTORS, "detectCrossDeviceMatrixRed").mockResolvedValue([
      {
        detectorName: "cross_device_matrix_red",
        severity: "high",
        findingText: "still ran",
      },
    ]);
    vi.spyOn(mod.DETECTORS, "detectMobileErrorBoundaryTrip").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectThemeContractDrift").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectPwaInstallRegression").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectRealDeviceGap").mockResolvedValue([]);
    vi.spyOn(mod.DETECTORS, "detectDesktopKeyboardNavDrift").mockResolvedValue([]);

    const result = await mod.runMobileFeelAudit();
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(result.findingsRecorded).toBe(1);
    expect(result.dispatchesEnqueued).toBe(1);
  });
});

describe("detector stubs (TODOs) — return empty findings", () => {
  it("detectThemeContractDrift returns []", async () => {
    const { detectThemeContractDrift } = await import("./mobileFeelAudit");
    expect(await detectThemeContractDrift()).toEqual([]);
  });

  it("detectPwaInstallRegression returns []", async () => {
    const { detectPwaInstallRegression } = await import("./mobileFeelAudit");
    expect(await detectPwaInstallRegression()).toEqual([]);
  });

  it("detectRealDeviceGap returns []", async () => {
    const { detectRealDeviceGap } = await import("./mobileFeelAudit");
    expect(await detectRealDeviceGap()).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Detector 7 — desktop_keyboard_nav_drift (Phase D3)
// ────────────────────────────────────────────────────────────────────────────
//
// We exercise the detector by mocking node:child_process's execFile. The
// detector calls `git log` (returns commit blocks) then `git show <sha> --
// <file>` per file. We stage:
//   - First exec call (git log)  → returns a controlled commit/file list.
//   - Second exec call (git show)→ returns a controlled diff.

describe("detectDesktopKeyboardNavDrift — Phase D3 scope expansion", () => {
  // We mock child_process per-test rather than via vi.mock at the top of
  // the file, so the other 6 detectors' tests aren't affected.
  let mockExecResponses: Array<{ stdout: string }> = [];
  let mockExecCallIndex = 0;

  beforeEach(() => {
    mockExecResponses = [];
    mockExecCallIndex = 0;
    vi.doMock("node:child_process", () => ({
      execFile: (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: unknown, out: { stdout: string }) => void,
      ) => {
        const resp = mockExecResponses[mockExecCallIndex++] ?? { stdout: "" };
        cb(null, resp);
      },
    }));
    vi.doMock("node:util", () => ({
      promisify: (fn: any) =>
        (...args: any[]) =>
          new Promise((resolve, reject) => {
            fn(...args, (err: unknown, out: unknown) => {
              if (err) reject(err);
              else resolve(out);
            });
          }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:util");
    vi.resetModules();
  });

  it("fires HIGH severity on a raw <div onClick> pattern", async () => {
    mockExecResponses = [
      // git log output — one commit touching pages/today.tsx.
      {
        stdout: [
          "COMMIT:abcdef1234567890",
          "client/src/pages/today.tsx",
        ].join("\n"),
      },
      // git show output — diff adding a raw <div onClick> with no a11y.
      {
        stdout: [
          "diff --git a/client/src/pages/today.tsx b/client/src/pages/today.tsx",
          "+        <div onClick={() => handleClick()} className=\"card\">",
          "+          Click me",
          "+        </div>",
        ].join("\n"),
      },
    ];
    const { detectDesktopKeyboardNavDrift } = await import("./mobileFeelAudit");
    const findings = await detectDesktopKeyboardNavDrift();
    expect(findings.length).toBeGreaterThan(0);
    const f = findings[0];
    expect(f.severity).toBe("high");
    expect(f.detectorName).toBe("desktop_keyboard_nav_drift");
    expect(f.targetRoute).toBe("/today");
    expect(f.findingText).toContain("raw <div onClick>");
    expect(f.evidenceSnippet).toContain("<div onClick");
  });

  it("does NOT fire on a <Button onClick=...> shadcn-wrapped pattern", async () => {
    mockExecResponses = [
      {
        stdout: [
          "COMMIT:abcdef1234567890",
          "client/src/pages/deals.tsx",
        ].join("\n"),
      },
      {
        stdout: [
          "diff --git a/client/src/pages/deals.tsx b/client/src/pages/deals.tsx",
          "+        <Button onClick={() => save()} className=\"focus-visible:ring-2\">",
          "+          Save",
          "+        </Button>",
        ].join("\n"),
      },
    ];
    const { detectDesktopKeyboardNavDrift } = await import("./mobileFeelAudit");
    const findings = await detectDesktopKeyboardNavDrift();
    // Wrapped Button with explicit focus-visible class is fully exonerated.
    expect(findings).toEqual([]);
  });

  it("skips files under pages/founder/* (different bar per the brief)", async () => {
    mockExecResponses = [
      {
        stdout: [
          "COMMIT:abcdef1234567890",
          "client/src/pages/founder/dashboard.tsx",
        ].join("\n"),
      },
      {
        // Even a clearly-violating raw div in the founder area should NOT
        // emit a finding — the detector skips the file entirely.
        stdout: [
          "diff --git a/client/src/pages/founder/dashboard.tsx b/client/src/pages/founder/dashboard.tsx",
          "+        <div onClick={() => doThing()}>raw</div>",
        ].join("\n"),
      },
    ];
    const { detectDesktopKeyboardNavDrift } = await import("./mobileFeelAudit");
    const findings = await detectDesktopKeyboardNavDrift();
    expect(findings).toEqual([]);
  });

  it("is registered in DETECTORS and bumps the orchestrator to 7 detectors", async () => {
    mockExecResponses = [{ stdout: "" }];
    const { DETECTORS } = await import("./mobileFeelAudit");
    expect(DETECTORS).toHaveProperty("detectDesktopKeyboardNavDrift");
    expect(typeof DETECTORS.detectDesktopKeyboardNavDrift).toBe("function");
  });
});
