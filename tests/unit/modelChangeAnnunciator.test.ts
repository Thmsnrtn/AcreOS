/**
 * Model-change annunciator (trust audit, 2026-07-28) — "my brain changed."
 *
 * The autopilot's judgment is rented from external models routed by
 * aiRouter.ts; env switches (AI_HAIKU_DEFAULT_ENABLED etc.) or a models.ts
 * pin bump can silently swap the decision-maker. This suite pins the fix:
 *
 *   1. The fingerprint is STABLE — same config → same hash, independent of
 *      object key order (sorted JSON + sha256).
 *   2. Change detection against the platform_settings store: first sight is
 *      a silent baseline (never an invented announcement); a real change
 *      updates the store, records an event, and returns the notice; the
 *      event ring keeps only the last MAX_MODEL_CHANGE_EVENTS.
 *   3. The notice speaks in plain roles — a raw model id must NEVER reach
 *      the founder (raw ids live only in the stored snapshot).
 *   4. Source-shape: narrate.ts gathers + carries modelChangeNotice and
 *      home.tsx renders it (muted-but-visible, never hidden when present) —
 *      same contract pattern as letterTrackRecord.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── aiRouter mock — a controllable model-config surface ─────────────────────
const routerState = {
  simple: "deepseek/deepseek-chat",
  moderate: "anthropic/claude-haiku-4-5-20251001",
  complex: "anthropic/claude-sonnet-4-6",
  reasoning: "deepseek/deepseek-reasoner",
  critical: "anthropic/claude-opus-4-8",
  vision: "openai/gpt-4o",
  flags: { haikuDefaultEnabled: true, cascadeEnabled: true, qualityThreshold: 6 },
};

vi.mock("../../server/services/aiRouter", () => ({
  get MODEL_SIMPLE() {
    return routerState.simple;
  },
  get MODEL_MODERATE() {
    return routerState.moderate;
  },
  get MODEL_COMPLEX() {
    return routerState.complex;
  },
  get MODEL_REASONING() {
    return routerState.reasoning;
  },
  get MODEL_CRITICAL() {
    return routerState.critical;
  },
  get MODEL_VISION() {
    return routerState.vision;
  },
  getTierToModelMap: () =>
    routerState.flags.haikuDefaultEnabled
      ? { critical: routerState.complex, standard: routerState.moderate, background: routerState.moderate }
      : { critical: routerState.complex, standard: routerState.complex, background: routerState.complex },
  getModelRoutingFlags: () => ({ ...routerState.flags }),
}));

// ── platform_settings store mock (house pattern: railSunsetDecisionCards) ───
let storedRow: { id: number; value: unknown } | null = null;
const inserted: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];

vi.mock("../../server/db", () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (storedRow ? [storedRow] : [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => {
        inserted.push(v);
        storedRow = { id: 1, value: v.value };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updated.push(v);
          if (storedRow) storedRow = { ...storedRow, value: v.value };
        }),
      })),
    })),
  };
  return { db };
});

import {
  captureModelConfigSnapshot,
  fingerprintOf,
  stableStringify,
  describeConfigDiff,
  buildModelChangeNotice,
  checkModelChange,
  MAX_MODEL_CHANGE_EVENTS,
  MODEL_FINGERPRINT_KEY,
  type ModelConfigSnapshot,
  type ModelChangeEvent,
} from "../../server/services/autopilot/modelChangeAnnunciator";
import { buildFounderBrief, type FounderBriefInputs } from "../../server/services/autopilot/narrate";

const ROOT = path.resolve(__dirname, "../..");
const homeSrc = fs.readFileSync(path.join(ROOT, "client/src/pages/founder/home.tsx"), "utf-8");
const narrateSrc = fs.readFileSync(
  path.join(ROOT, "server/services/autopilot/narrate.ts"),
  "utf-8",
);

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0); // 2026-07-28T12:00Z
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every raw model id in play — none may ever appear in founder-facing text. */
const RAW_ID_FRAGMENTS = [
  "anthropic/",
  "deepseek/",
  "openai/",
  "claude",
  "gpt-4o",
  "haiku-4-5",
  "sonnet-4-6",
  "opus-4-8",
];

function expectNoRawIds(text: string) {
  for (const frag of RAW_ID_FRAGMENTS) {
    expect(text.toLowerCase()).not.toContain(frag.toLowerCase());
  }
}

beforeEach(() => {
  storedRow = null;
  inserted.length = 0;
  updated.length = 0;
  routerState.simple = "deepseek/deepseek-chat";
  routerState.moderate = "anthropic/claude-haiku-4-5-20251001";
  routerState.complex = "anthropic/claude-sonnet-4-6";
  routerState.reasoning = "deepseek/deepseek-reasoner";
  routerState.critical = "anthropic/claude-opus-4-8";
  routerState.vision = "openai/gpt-4o";
  routerState.flags = { haikuDefaultEnabled: true, cascadeEnabled: true, qualityThreshold: 6 };
});

// ── 1. fingerprint stability ────────────────────────────────────────────────

describe("fingerprint — stable and key-order independent", () => {
  it("same config → same hash across repeated captures", () => {
    const a = fingerprintOf(captureModelConfigSnapshot());
    const b = fingerprintOf(captureModelConfigSnapshot());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("object key order does not change the hash", () => {
    const snapA: ModelConfigSnapshot = {
      models: { quickTask: "m1", everydayReasoning: "m2" },
      tierMap: { critical: "m3", standard: "m2" },
      flags: { haikuDefaultEnabled: true, cascadeEnabled: true, qualityThreshold: 6 },
    };
    const snapB = {
      flags: { qualityThreshold: 6, cascadeEnabled: true, haikuDefaultEnabled: true },
      tierMap: { standard: "m2", critical: "m3" },
      models: { everydayReasoning: "m2", quickTask: "m1" },
    } as ModelConfigSnapshot;
    expect(stableStringify(snapA)).toBe(stableStringify(snapB));
    expect(fingerprintOf(snapA)).toBe(fingerprintOf(snapB));
  });

  it("a different model id yields a different hash", () => {
    const a = fingerprintOf(captureModelConfigSnapshot());
    routerState.moderate = "anthropic/claude-haiku-5-0";
    const b = fingerprintOf(captureModelConfigSnapshot());
    expect(a).not.toBe(b);
  });

  it("a flag flip alone yields a different hash", () => {
    const a = fingerprintOf(captureModelConfigSnapshot());
    routerState.flags = { ...routerState.flags, haikuDefaultEnabled: false };
    const b = fingerprintOf(captureModelConfigSnapshot());
    expect(a).not.toBe(b);
  });
});

// ── 2. change detection + persistence ───────────────────────────────────────

describe("checkModelChange — detection against the settings store", () => {
  it("first sight records the baseline SILENTLY (never an invented announcement)", async () => {
    const res = await checkModelChange(NOW);
    expect(res.changed).toBe(false);
    expect(res.notice).toBeNull();
    expect(res.recentChanges).toEqual([]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].key).toBe(MODEL_FINGERPRINT_KEY);
    const value = inserted[0].value as { fingerprint: string; snapshot: ModelConfigSnapshot };
    expect(value.fingerprint).toBe(fingerprintOf(captureModelConfigSnapshot()));
    // Raw ids DO live in the stored snapshot (the audit trail).
    expect(value.snapshot.models.everydayReasoning).toBe("anthropic/claude-haiku-4-5-20251001");
  });

  it("unchanged config → no change, no write", async () => {
    await checkModelChange(NOW);
    updated.length = 0;
    const res = await checkModelChange(NOW + DAY_MS);
    expect(res.changed).toBe(false);
    expect(res.notice).toBeNull();
    expect(updated).toHaveLength(0);
  });

  it("a model swap → changed, store updated, event recorded, honest notice", async () => {
    await checkModelChange(NOW - DAY_MS);
    routerState.moderate = "anthropic/claude-haiku-5-0";
    const res = await checkModelChange(NOW);
    expect(res.changed).toBe(true);
    expect(res.recentChanges).toHaveLength(1);
    expect(res.recentChanges[0].summary).toContain("everyday-reasoning model changed");
    expect(res.notice).toContain("My underlying AI model changed on July 28, 2026");
    expect(res.notice).toContain("Treat my track record as provisional");
    expect(updated).toHaveLength(1);
    // The store now holds the NEW fingerprint — a re-check is quiet but keeps
    // the notice alive inside the 14-day re-proving window.
    const again = await checkModelChange(NOW + DAY_MS);
    expect(again.changed).toBe(false);
    expect(again.notice).toContain("My underlying AI model changed");
  });

  it("the notice expires after the 14-day window (silence, not a stale banner)", async () => {
    await checkModelChange(NOW - 20 * DAY_MS);
    routerState.complex = "anthropic/claude-sonnet-5-0";
    await checkModelChange(NOW - 15 * DAY_MS);
    const res = await checkModelChange(NOW);
    expect(res.changed).toBe(false);
    expect(res.notice).toBeNull();
    expect(res.recentChanges).toHaveLength(1); // history kept, banner gone
  });

  it("the event ring keeps only the last MAX_MODEL_CHANGE_EVENTS, newest first", async () => {
    await checkModelChange(NOW - 10 * DAY_MS);
    const swaps = ["a", "b", "c", "d", "e", "f", "g"];
    for (let i = 0; i < swaps.length; i++) {
      routerState.moderate = `anthropic/test-model-${swaps[i]}`;
      await checkModelChange(NOW - (swaps.length - i) * DAY_MS);
    }
    const res = await checkModelChange(NOW);
    expect(res.recentChanges).toHaveLength(MAX_MODEL_CHANGE_EVENTS);
    const events = res.recentChanges as ModelChangeEvent[];
    // Newest first: the last swap ("g") is the newest surviving event.
    expect(events[0].after.models.everydayReasoning).toBe("anthropic/test-model-g");
    // Oldest events dropped: the first swaps are gone from the ring.
    expect(events.map((e) => e.after.models.everydayReasoning)).not.toContain(
      "anthropic/test-model-a",
    );
  });

  it("a store failure returns silence — never a guessed notice, never a throw", async () => {
    const { db } = await import("../../server/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("db down");
    });
    const res = await checkModelChange(NOW);
    expect(res).toEqual({ changed: false, notice: null, recentChanges: [] });
  });
});

// ── 3. plain-language translation — no raw model ids to the founder ─────────

describe("plain-language translation — raw ids never reach the founder", () => {
  it("a model-swap notice names the ROLE, never the vendor id", async () => {
    await checkModelChange(NOW - DAY_MS);
    routerState.moderate = "anthropic/claude-haiku-5-0";
    routerState.critical = "anthropic/claude-opus-5-0";
    const res = await checkModelChange(NOW);
    expect(res.notice).not.toBeNull();
    expect(res.notice).toContain("everyday-reasoning");
    expect(res.notice).toContain("highest-stakes reasoning");
    expectNoRawIds(res.notice!);
    expectNoRawIds(res.recentChanges[0].summary);
  });

  it("the kill-switch flip is described in plain words", async () => {
    await checkModelChange(NOW - DAY_MS);
    routerState.flags = { ...routerState.flags, haikuDefaultEnabled: false };
    const res = await checkModelChange(NOW);
    expect(res.changed).toBe(true);
    expect(res.notice).toContain("everyday and quick work moved onto the hard-decision model");
    expectNoRawIds(res.notice!);
  });

  it("an unreadable prior snapshot degrades to the honest generic diff", () => {
    expect(describeConfigDiff(null, captureModelConfigSnapshot())).toBe(
      "my model configuration changed",
    );
  });

  it("buildModelChangeNotice carries the exact provisional-trust framing", () => {
    const notice = buildModelChangeNotice({
      changedAt: new Date(NOW).toISOString(),
      summary: "the quick-task model changed",
      before: null,
      after: captureModelConfigSnapshot(),
    });
    expect(notice).toBe(
      "My underlying AI model changed on July 28, 2026 (the quick-task model changed). " +
        "Treat my track record as provisional while I re-prove myself on the new brain.",
    );
  });
});

// ── 4. the brief carries it; home.tsx renders it ────────────────────────────

describe("brief + home.tsx — the notice flows to the founder surface", () => {
  it("buildFounderBrief passes modelChangeNotice through (null-safe back-compat)", () => {
    const baseInputs: FounderBriefInputs = {
      partOfDay: "morning",
      founderName: "Tom",
      pulse: {
        mrr: 0,
        trials: 0,
        weeklySpendUsd: 0,
        envelopeStatus: "green",
        uptimePct: null,
        dispatchesCompletedLast24h: 0,
        dispatchesFlaggedLast24h: 0,
        decisionsWaitingCount: 0,
      },
      openAsks: [],
      plannedFocus: null,
      operatingMode: null,
      trustLedger: [],
    };
    expect(buildFounderBrief(baseInputs).modelChangeNotice).toBeNull();
    const notice = "My underlying AI model changed on July 28, 2026 (the quick-task model changed). Treat my track record as provisional while I re-prove myself on the new brain.";
    expect(
      buildFounderBrief({ ...baseInputs, modelChangeNotice: notice }).modelChangeNotice,
    ).toBe(notice);
  });

  it("narrate.ts gathers the notice best-effort from the annunciator", () => {
    expect(narrateSrc).toContain("checkModelChange");
    expect(narrateSrc).toContain("modelChangeNotice");
  });

  it("home.tsx renders brief.modelChangeNotice when present (never hidden)", () => {
    expect(homeSrc).toContain("modelChangeNotice: string | null");
    expect(homeSrc).toContain("brief.modelChangeNotice");
    expect(homeSrc).toContain("letter-model-change-notice");
  });
});
