/**
 * Model-change annunciator (trust audit, 2026-07-28) — the machine ANNOUNCES
 * when its brain changes.
 *
 * The autopilot's judgment is rented from external AI models routed by
 * aiRouter.ts, and env switches (AI_HAIKU_DEFAULT_ENABLED, cascade knobs) or a
 * models.ts pin bump can silently swap the decision-maker. Every bit of earned
 * trust — clean cycles, calibration, agreement — was earned by a SPECIFIC
 * model configuration; when it changes silently, the founder experiences
 * personality drift in something they were told was earning their trust.
 * "It's not the thing I trained" breaks relationship-shaped trust.
 *
 * The fix is honesty, not stability: fingerprint the authoritative model
 * config (every routed model id + the tier map + the routing flags), persist
 * the last-seen fingerprint in platform_settings (same marker pattern as
 * railSunsetDecisionCards.ts), and when it changes, say so in the Letter in
 * plain words — with the explicit instruction to treat the track record as
 * provisional while the new brain re-proves itself.
 *
 * HONESTY RULES:
 *  - Raw model ids live ONLY in the stored snapshot (for the audit trail).
 *    The founder-facing notice speaks in plain roles ("everyday reasoning",
 *    "hard-decision reasoning", "quick-task") — never vendor strings.
 *  - First sight is not a change: with nothing to compare against, we record
 *    the baseline and stay silent. Announcing a change we didn't observe
 *    would be an invention.
 *  - Every failure path returns silence ({changed:false, notice:null}),
 *    never a guessed notice.
 */
import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { platformSettings } from "@shared/schema";
import { logger } from "../../utils/logger";
import {
  MODEL_SIMPLE,
  MODEL_MODERATE,
  MODEL_COMPLEX,
  MODEL_REASONING,
  MODEL_CRITICAL,
  MODEL_VISION,
  getTierToModelMap,
  getModelRoutingFlags,
} from "../aiRouter";

/** platform_settings key holding the last-seen fingerprint + change ring. */
export const MODEL_FINGERPRINT_KEY = "autopilot.model_config_fingerprint";

/** The change ring keeps only the last N events (newest first). */
export const MAX_MODEL_CHANGE_EVENTS = 5;

/** The Letter carries the notice only while the change is this fresh. */
export const MODEL_CHANGE_NOTICE_WINDOW_DAYS = 14;

export interface ModelConfigSnapshot {
  /** Routing slot → raw model id. Raw ids NEVER leave this snapshot. */
  models: Record<string, string>;
  /** TaskTier → raw model id (already honoring AI_HAIKU_DEFAULT_ENABLED). */
  tierMap: Record<string, string>;
  /** The env switches that can silently swap the decision-maker. */
  flags: { haikuDefaultEnabled: boolean; cascadeEnabled: boolean; qualityThreshold: number };
}

export interface ModelChangeEvent {
  changedAt: string; // ISO
  /** Plain-words diff — role names only, no raw model ids. */
  summary: string;
  before: ModelConfigSnapshot | null;
  after: ModelConfigSnapshot;
}

export interface ModelChangeCheck {
  /** True only when THIS call detected a new fingerprint. */
  changed: boolean;
  /** The founder-facing sentence while a change is within the notice window; else null. */
  notice: string | null;
  /** The persisted ring of recent changes, newest first. */
  recentChanges: ModelChangeEvent[];
}

/**
 * Routing slot → plain founder-facing role, per the tier semantics in
 * aiRouter (SIMPLE→micro tasks, MODERATE/standard/background→everyday work,
 * COMPLEX/critical-tier→hard calls, CRITICAL→highest stakes). This is the
 * ONLY vocabulary the notice may use.
 */
export const MODEL_ROLE_WORDS: Record<string, string> = {
  quickTask: "quick-task",
  everydayReasoning: "everyday-reasoning",
  hardDecision: "hard-decision reasoning",
  deepReasoning: "step-by-step calculation",
  highestStakes: "highest-stakes reasoning",
  vision: "document-reading",
};

/** Capture the authoritative model-config surface, live from aiRouter. */
export function captureModelConfigSnapshot(): ModelConfigSnapshot {
  return {
    models: {
      quickTask: MODEL_SIMPLE,
      everydayReasoning: MODEL_MODERATE,
      hardDecision: MODEL_COMPLEX,
      deepReasoning: MODEL_REASONING,
      highestStakes: MODEL_CRITICAL,
      vision: MODEL_VISION,
    },
    tierMap: { ...getTierToModelMap() },
    flags: getModelRoutingFlags(),
  };
}

/** Deterministic JSON with recursively sorted object keys (key-order independent). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** sha256 over the stable JSON — the identity of "the brain" as configured. */
export function fingerprintOf(snapshot: ModelConfigSnapshot): string {
  return crypto.createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

/**
 * Plain-words diff between two snapshots. Role vocabulary only — a raw model
 * id must never appear in the output. When the prior snapshot is unreadable
 * the honest summary is the generic one, never a reconstructed detail.
 */
export function describeConfigDiff(
  before: ModelConfigSnapshot | null,
  after: ModelConfigSnapshot,
): string {
  if (!before || typeof before !== "object" || !before.models || !before.flags) {
    return "my model configuration changed";
  }
  const parts: string[] = [];
  const slots = new Set([...Object.keys(before.models), ...Object.keys(after.models)]);
  for (const slot of slots) {
    if (before.models[slot] !== after.models[slot]) {
      parts.push(`the ${MODEL_ROLE_WORDS[slot] ?? "a routing"} model changed`);
    }
  }
  if (before.flags.haikuDefaultEnabled !== after.flags.haikuDefaultEnabled) {
    parts.push(
      after.flags.haikuDefaultEnabled
        ? "everyday and quick work moved back onto its usual everyday model"
        : "everyday and quick work moved onto the hard-decision model (the rollback switch)",
    );
  }
  if (before.flags.cascadeEnabled !== after.flags.cascadeEnabled) {
    parts.push(
      after.flags.cascadeEnabled
        ? "the automatic quality-retry safeguard was turned on"
        : "the automatic quality-retry safeguard was turned off",
    );
  }
  if (before.flags.qualityThreshold !== after.flags.qualityThreshold) {
    parts.push("the quality bar for automatic retries changed");
  }
  return parts.length > 0 ? parts.join("; ") : "my model configuration changed";
}

/** The founder-facing sentence. Plain, honest, and explicitly provisional. */
export function buildModelChangeNotice(event: ModelChangeEvent): string {
  const date = new Date(event.changedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    `My underlying AI model changed on ${date} (${event.summary}). ` +
    `Treat my track record as provisional while I re-prove myself on the new brain.`
  );
}

interface StoredFingerprint {
  fingerprint?: string;
  snapshot?: ModelConfigSnapshot | null;
  firstSeenAt?: string;
  recentChanges?: ModelChangeEvent[];
}

/** Notice for the newest change still inside the window; else null. */
function noticeFromRecent(recent: ModelChangeEvent[], nowMs: number): string | null {
  const newest = recent[0];
  if (!newest?.changedAt) return null;
  const at = Date.parse(newest.changedAt);
  if (!Number.isFinite(at)) return null;
  const windowMs = MODEL_CHANGE_NOTICE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return nowMs - at <= windowMs ? buildModelChangeNotice(newest) : null;
}

/**
 * Compare the live model config against the last-seen fingerprint in
 * platform_settings. On a change: persist the new fingerprint + snapshot,
 * append a change event (ring of MAX_MODEL_CHANGE_EVENTS), and return the
 * plain-language notice. Fail-quiet: any storage failure returns silence —
 * never an invented notice, never a thrown error into the Letter.
 */
export async function checkModelChange(nowMs: number = Date.now()): Promise<ModelChangeCheck> {
  try {
    const current = captureModelConfigSnapshot();
    const fingerprint = fingerprintOf(current);

    const rows = await db
      .select()
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.scope, "global"),
          isNull(platformSettings.scopeRef),
          eq(platformSettings.key, MODEL_FINGERPRINT_KEY),
        ),
      )
      .limit(1);
    const row = rows[0];

    if (!row) {
      // First sight — record the baseline, announce nothing (there is no
      // observed change to report; claiming one would be an invention).
      await db.insert(platformSettings).values({
        key: MODEL_FINGERPRINT_KEY,
        scope: "global",
        scopeRef: null,
        value: {
          fingerprint,
          snapshot: current,
          firstSeenAt: new Date(nowMs).toISOString(),
          recentChanges: [],
        } satisfies StoredFingerprint,
        defaultValue: {},
        category: "autopilot",
        description:
          "Model-change annunciator: last-seen AI model-config fingerprint + snapshot + the ring of recent changes. Raw model ids live here only; the Letter speaks in plain roles.",
        lastChangedBy: "model-change-annunciator",
        lastChangedAt: new Date(nowMs),
      });
      return { changed: false, notice: null, recentChanges: [] };
    }

    const stored = (row.value ?? {}) as StoredFingerprint;
    const recent: ModelChangeEvent[] = Array.isArray(stored.recentChanges)
      ? stored.recentChanges
      : [];

    if (stored.fingerprint === fingerprint) {
      // Unchanged — but a recent change keeps its notice for the whole
      // re-proving window, not just the tick that detected it.
      return { changed: false, notice: noticeFromRecent(recent, nowMs), recentChanges: recent };
    }

    const event: ModelChangeEvent = {
      changedAt: new Date(nowMs).toISOString(),
      summary: describeConfigDiff(stored.snapshot ?? null, current),
      before: stored.snapshot ?? null,
      after: current,
    };
    const recentChanges = [event, ...recent].slice(0, MAX_MODEL_CHANGE_EVENTS);

    await db
      .update(platformSettings)
      .set({
        value: {
          fingerprint,
          snapshot: current,
          firstSeenAt: event.changedAt,
          recentChanges,
        } satisfies StoredFingerprint,
        lastChangedBy: "model-change-annunciator",
        lastChangedAt: new Date(nowMs),
      })
      .where(eq(platformSettings.id, row.id));

    logger.info("[modelChangeAnnunciator] model configuration changed", {
      metadata: { summary: event.summary },
    });
    return { changed: true, notice: buildModelChangeNotice(event), recentChanges };
  } catch (err) {
    logger.warn("[modelChangeAnnunciator] check failed — staying silent (never invented)", {
      metadata: { detail: err instanceof Error ? err.message : err },
    });
    return { changed: false, notice: null, recentChanges: [] };
  }
}
