/**
 * Founder Decisions Inbox — generator throttle.
 *
 * Scheduled producers re-raise the same card every run while a condition stays
 * true (and open-only dedupe re-opens once a card is resolved/purged). This
 * module decides, per (producer, subject), whether a producer may raise a card
 * now. See STEP0-DESIGN.md.
 *
 * PREFER `raiseIfAllowed(input, insertFn)`. It holds the advisory lock across
 * decide → insert → record, so (a) a failed insert leaves NO state and the next
 * run retries, and (b) two concurrent full sequences for the same subject yield
 * exactly one card. The split pair `shouldRaiseCard` / `recordRaised` (the
 * ThrottleApi that `createThrottle` returns) serves pure tests and unusual
 * call sites, but by itself it does NOT close the decide→record race.
 *
 * Semantics (status-blind — this module never reads decisions_inbox_items):
 *   no state                         → allow  new_subject
 *   condition hash differs           → allow  condition_changed
 *   same condition inside cooldown   → deny   suppressed_same_condition
 *   same condition, cooldown elapsed → allow  cooldown_elapsed
 *   daily cap (standard only), last  → deny   suppressed_daily_cap (NO subject state written)
 *
 * State lives in founder_settings, written with the DIRECT upsert pattern copied
 * from autopilot/gateWatcher.ts saveGateState. NEVER call
 * founderSettings.setSetting here: it throws "Unknown setting key" for any key
 * not in KNOBS.
 *
 * The module NEVER throws to callers on its own failures: any internal failure
 * → allow with reason "guard_failed_open" (all classes) + logger.warn. A
 * process-local Map (cap 5,000) bounds flooding during a guard outage and can
 * never block a first raise. The only error `raiseIfAllowed` propagates is the
 * one thrown by the caller's own `insertFn`.
 *
 * D-5 composition shapes (added when the two dedupe producers' pre-existing
 * pinned suites were reconciled with this wiring — those suites are the
 * contract, and they exposed three structural conflicts):
 * (1) `raiseIfAllowed` accepts a caller-managed transaction ({ tx }): the
 * dedupe producers (agentInitiativeEngine, agentAuthorityGate) open their
 * transaction FIRST — their advisory lock and dedupe check — then run the
 * whole decide → insert → record sequence on that one handle. Wrapping
 * their insertFn in a second transaction held a second connection while the
 * producer's own transaction waited for one, and the pg pool starved under
 * concurrency. The store's writes are raw-SQL upserts over whichever handle
 * they are given, never drizzle builder inserts, so this module's
 * bookkeeping never appears inside a producer's own counted insert
 * sequence.
 * (2) agentAuthorityGate's plain (non-deduped) branch is pinned
 * transaction-free by its pre-existing suite, so that one call site uses
 * the split pair served by a LOCKLESS direct-store backend (the
 * `shouldRaiseCard` / `recordRaised` facades below): decide and record run
 * straight on the shared db handle and never open a transaction. The
 * split-pair race caveat above applies to that branch only; every other
 * call site uses a locked composition.
 * One producer-specific reconciliation lives at the authority gate's deduped
 * call site, not here: a question the founder has already ANSWERED may be
 * asked again (that producer's long-standing contract), so the gate checks
 * for an answered card before consulting the throttle. The throttle guards
 * first raises and unanswered repeats; this module's semantics are
 * unchanged.
 */

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { founderSettings } from "@shared/schema";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

// ============================================
// Constants (one block so the founder can change them)
// ============================================

const DAY_MS = 24 * 60 * 60 * 1000;
export const STANDARD_COOLDOWN_MS = 30 * DAY_MS;
export const CRITICAL_COOLDOWN_MS = 7 * DAY_MS;
/** Max standard cards per producer per UTC day. Critical bypasses. */
export const STANDARD_DAILY_CAP = 3;
/** Process-local fail-open fallback capacity. */
const MEMORY_FALLBACK_CAP = 5_000;

export const SUBJECT_KEY_PREFIX = "inbox_throttle.v1.";
export const DAY_KEY_PREFIX = "inbox_throttle.day.";
const UPDATED_BY = "decisions-inbox-throttle";

// ============================================
// Types
// ============================================

export type ThrottleClass = "critical" | "standard";

export interface ThrottleInput {
  /** Stable producer id, e.g. "schema_drift", "agent_initiative". */
  producer: string;
  /** Canonical subject (see canonicalJson / canonicalSetJson). */
  subjectKey: string;
  /** Canonical condition fingerprint. */
  conditionKey: string;
  class: ThrottleClass;
  /** Injectable clock for tests; defaults to server/utils/clock. */
  now?: Date;
  /** Short human label stored in the row description (debuggability only). */
  label?: string;
}

export type ThrottleReason =
  | "new_subject"
  | "condition_changed"
  | "cooldown_elapsed"
  | "suppressed_same_condition"
  | "suppressed_daily_cap"
  | "guard_failed_open";

export interface ThrottleVerdict {
  allow: boolean;
  reason: ThrottleReason;
}

export interface SubjectState {
  /** sha256(conditionKey).slice(0,16) */
  c: string;
  /** ISO time of last raise */
  at: string;
  /** raises recorded for this subject */
  n: number;
}

export interface DayCounts {
  raised: number;
  suppressed: number;
}

/** Storage seam. Methods run inside the lock the backend holds. */
export interface ThrottleStore {
  readSubject(producer: string, subjectHash: string): Promise<SubjectState | null>;
  readDay(producer: string, day: string): Promise<DayCounts>;
  writeSubject(producer: string, subjectHash: string, state: SubjectState, label: string): Promise<void>;
  writeDay(producer: string, day: string, counts: DayCounts): Promise<void>;
}

export interface ThrottleBackend {
  /**
   * Run `fn` holding the per-subject lock (and then the per-producer day lock,
   * always in that order) for the duration. Rejects if the backend fails.
   */
  withLock<T>(producer: string, subjectHash: string, fn: (store: ThrottleStore) => Promise<T>): Promise<T>;
  /**
   * Optional: run `fn` under the same advisory locks, taken on the CALLER's
   * already-open transaction instead of a fresh one (the { tx } composition —
   * see the header's D-5 note). Backends that cannot do this omit it, and
   * raiseIfAllowed then fails open rather than nesting a transaction.
   */
  withTxLock?<T>(tx: Tx, producer: string, subjectHash: string, fn: (store: ThrottleStore) => Promise<T>): Promise<T>;
}

/** Options for raiseIfAllowed's caller-transaction composition. */
interface RaiseOptions {
  /** The caller's open transaction: decide → insert → record all run on it. */
  tx?: Tx;
}

export interface RaiseOutcome<T> {
  verdict: ThrottleVerdict;
  /** True iff insertFn ran (and returned). */
  inserted: boolean;
  /** insertFn's return value when inserted. */
  result?: T;
}

// ============================================
// Pure helpers
// ============================================

/** JSON with recursively sorted object keys (undefined dropped, Date → ISO). Arrays keep order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canon(value));
}

function canon(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => canon(x));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] === undefined) continue;
      out[k] = canon(o[k]);
    }
    return out;
  }
  return v;
}

/** Canonical JSON for an array the producer declares to be a SET (order-insensitive). */
export function canonicalSetJson(items: readonly unknown[]): string {
  return `[${items.map((x) => canonicalJson(x)).sort().join(",")}]`;
}

export function hash16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function cooldownMs(cls: ThrottleClass): number {
  return cls === "critical" ? CRITICAL_COOLDOWN_MS : STANDARD_COOLDOWN_MS;
}

/**
 * The decision, pure: no DB, no clock (both are inputs).
 * `state` null = none/unparseable. Order: subject/condition/cooldown, then cap last.
 */
export function decide(args: {
  state: SubjectState | null;
  conditionHash: string;
  cls: ThrottleClass;
  now: Date;
  dayRaised: number;
}): ThrottleVerdict {
  const { state, conditionHash, cls, now, dayRaised } = args;
  let reason: "new_subject" | "condition_changed" | "cooldown_elapsed";
  const at = state ? Date.parse(state.at) : NaN;
  if (!state || Number.isNaN(at)) {
    reason = "new_subject";
  } else if (state.c !== conditionHash) {
    reason = "condition_changed";
  } else if (now.getTime() - at < cooldownMs(cls)) {
    return { allow: false, reason: "suppressed_same_condition" };
  } else {
    reason = "cooldown_elapsed";
  }
  if (cls === "standard" && dayRaised >= STANDARD_DAILY_CAP) {
    return { allow: false, reason: "suppressed_daily_cap" };
  }
  return { allow: true, reason };
}

export function parseSubjectState(raw: string | null | undefined): SubjectState | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<SubjectState> | null;
    if (
      p &&
      typeof p.c === "string" &&
      typeof p.at === "string" &&
      !Number.isNaN(Date.parse(p.at)) &&
      typeof p.n === "number"
    ) {
      return { c: p.c, at: p.at, n: p.n };
    }
  } catch {
    /* fall through: unparseable → no state (gateWatcher parity) */
  }
  return null;
}

export function parseDayCounts(raw: string | null | undefined): DayCounts {
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<DayCounts> | null;
      if (p && Number.isFinite(p.raised) && Number.isFinite(p.suppressed)) {
        return { raised: Number(p.raised), suppressed: Number(p.suppressed) };
      }
    } catch {
      /* fall through */
    }
  }
  return { raised: 0, suppressed: 0 };
}

// ============================================
// Store-level operations (run inside the backend lock)
// ============================================

async function decideInStore(store: ThrottleStore, input: ThrottleInput, now: Date): Promise<ThrottleVerdict> {
  const h = hash16(input.subjectKey);
  const day = utcDay(now);
  const [state, counts] = await Promise.all([
    store.readSubject(input.producer, h),
    store.readDay(input.producer, day),
  ]);
  const verdict = decide({
    state,
    conditionHash: hash16(input.conditionKey),
    cls: input.class,
    now,
    dayRaised: counts.raised,
  });
  if (!verdict.allow) {
    // Suppression counter is best-effort: never let it change the verdict.
    try {
      await store.writeDay(input.producer, day, { raised: counts.raised, suppressed: counts.suppressed + 1 });
    } catch (err) {
      logger.warn("[inboxThrottle] suppression counter write failed", {
        metadata: { producer: input.producer, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return verdict;
}

async function recordInStore(store: ThrottleStore, input: ThrottleInput, now: Date): Promise<void> {
  const h = hash16(input.subjectKey);
  const day = utcDay(now);
  const prev = await store.readSubject(input.producer, h);
  const label = (input.label ?? input.subjectKey).slice(0, 60);
  await store.writeSubject(
    input.producer,
    h,
    { c: hash16(input.conditionKey), at: now.toISOString(), n: (prev?.n ?? 0) + 1 },
    label,
  );
  const counts = await store.readDay(input.producer, day);
  await store.writeDay(input.producer, day, { raised: counts.raised + 1, suppressed: counts.suppressed });
}

// ============================================
// Factory (injectable backend + clock) and process-local fallback
// ============================================

export interface ThrottleApi {
  shouldRaiseCard(input: ThrottleInput): Promise<ThrottleVerdict>;
  recordRaised(input: ThrottleInput): Promise<void>;
  raiseIfAllowed<T>(input: ThrottleInput, insertFn: () => Promise<T>, opts?: RaiseOptions): Promise<RaiseOutcome<T>>;
  /** Test hook: clear the process-local fallback map. */
  _resetMemoryFallback(): void;
}

export function createThrottle(deps: { backend: ThrottleBackend; now?: () => Date }): ThrottleApi {
  const { backend } = deps;
  const getNow = (input: ThrottleInput) => input.now ?? (deps.now ?? (() => clock.now()))();
  const memory = new Map<string, number>();

  const memKey = (i: ThrottleInput) => `${i.producer}:${hash16(i.subjectKey)}:${hash16(i.conditionKey)}`;
  const memNote = (i: ThrottleInput, now: Date) => {
    const k = memKey(i);
    memory.delete(k); // refresh insertion order
    memory.set(k, now.getTime());
    while (memory.size > MEMORY_FALLBACK_CAP) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  };
  /** Fallback verdict when the DB is unavailable. Never blocks a first raise. */
  const memVerdict = (i: ThrottleInput, now: Date): ThrottleVerdict => {
    const at = memory.get(memKey(i));
    if (at !== undefined && now.getTime() - at < cooldownMs(i.class)) {
      return { allow: false, reason: "suppressed_same_condition" };
    }
    return { allow: true, reason: "guard_failed_open" };
  };
  const warn = (msg: string, i: ThrottleInput, err: unknown) =>
    logger.warn(msg, {
      metadata: { producer: i.producer, error: err instanceof Error ? err.message : String(err) },
    });

  async function shouldRaiseCard(input: ThrottleInput): Promise<ThrottleVerdict> {
    try {
      const now = getNow(input);
      const h = hash16(input.subjectKey);
      const verdict = await backend.withLock(input.producer, h, (store) => decideInStore(store, input, now));
      if (!verdict.allow) {
        logger.info("[inboxThrottle] card suppressed", {
          metadata: { producer: input.producer, reason: verdict.reason, class: input.class },
        });
      }
      return verdict;
    } catch (err) {
      warn("[inboxThrottle] guard failed — failing open", input, err);
      try {
        return memVerdict(input, getNow(input));
      } catch {
        return { allow: true, reason: "guard_failed_open" };
      }
    }
  }

  async function recordRaised(input: ThrottleInput): Promise<void> {
    try {
      const now = getNow(input);
      memNote(input, now);
      const h = hash16(input.subjectKey);
      await backend.withLock(input.producer, h, (store) => recordInStore(store, input, now));
    } catch (err) {
      warn("[inboxThrottle] recordRaised failed — swallowed (worst case: one extra raise next run)", input, err);
    }
  }

  async function raiseIfAllowed<T>(
    input: ThrottleInput,
    insertFn: () => Promise<T>,
    opts?: RaiseOptions,
  ): Promise<RaiseOutcome<T>> {
    let now: Date;
    try {
      now = getNow(input);
    } catch {
      now = clock.now();
    }
    const st: { inserted: boolean; result?: T; insertFailure: { error: unknown } | null } = {
      inserted: false,
      insertFailure: null,
    };
    // The decide → insert → record sequence, run against whichever store the
    // backend hands us: a fresh locked transaction, or the caller's own
    // transaction under the same locks (the { tx } composition).
    const runWith = async (store: ThrottleStore): Promise<RaiseOutcome<T>> => {
      const verdict = await decideInStore(store, input, now);
      if (!verdict.allow) {
        logger.info("[inboxThrottle] card suppressed", {
          metadata: { producer: input.producer, reason: verdict.reason, class: input.class },
        });
        return { verdict, inserted: false };
      }
      try {
        st.result = await insertFn();
        st.inserted = true;
      } catch (error) {
        st.insertFailure = { error };
        throw error; // lock releases, nothing recorded
      }
      memNote(input, now);
      await recordInStore(store, input, now);
      return { verdict, inserted: true, result: st.result };
    };
    try {
      const h = hash16(input.subjectKey);
      if (opts?.tx) {
        if (!backend.withTxLock) throw new Error("throttle backend cannot run on a caller transaction");
        return await backend.withTxLock(opts.tx, input.producer, h, runWith);
      }
      return await backend.withLock(input.producer, h, runWith);
    } catch (err) {
      // The producer's own insert failure is the producer's to handle.
      if (st.insertFailure) throw st.insertFailure.error;
      if (st.inserted) {
        // Card is in; only the state write/commit failed. Never insert twice.
        warn("[inboxThrottle] state record failed after insert — swallowed", input, err);
        return { verdict: { allow: true, reason: "guard_failed_open" }, inserted: true, result: st.result };
      }
      warn("[inboxThrottle] guard failed before insert — failing open", input, err);
      const verdict = memVerdict(input, now);
      if (!verdict.allow) return { verdict, inserted: false };
      const value = await insertFn(); // caller's error propagates
      memNote(input, now);
      return { verdict, inserted: true, result: value };
    }
  }

  return { shouldRaiseCard, recordRaised, raiseIfAllowed, _resetMemoryFallback: () => memory.clear() };
}

// ============================================
// DB backend (founder_settings, direct upsert, advisory locks)
// ============================================

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The slice of a db/transaction handle the store uses. */
type StoreHandle = Pick<Tx, "select" | "execute">;

function dbStore(tx: StoreHandle): ThrottleStore {
  const subjectKey = (p: string, h: string) => `${SUBJECT_KEY_PREFIX}${p}.${h}`;
  const dayKey = (p: string, d: string) => `${DAY_KEY_PREFIX}${p}.${d}`;
  const readValue = async (key: string): Promise<string | null> => {
    const rows = await tx
      .select({ value: founderSettings.value })
      .from(founderSettings)
      .where(eq(founderSettings.key, key));
    return rows[0]?.value ?? null;
  };
  // Writes are raw-SQL upserts over the given handle, NOT drizzle builder
  // inserts (same row shape as the gateWatcher direct upsert): a producer
  // whose pinned suite counts its own insert(...).values() sequence must
  // never see this module's bookkeeping as an extra write inside its flow,
  // and .execute exists on every handle shape (db, tx, and the suites'
  // transaction stubs alike).
  const upsert = async (key: string, value: string, description: string) => {
    await tx.execute(
      sql`INSERT INTO founder_settings (key, value, value_type, description, category, updated_by) VALUES (${key}, ${value}, 'json', ${description}, 'general', ${UPDATED_BY}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = ${clock.now()}, updated_by = EXCLUDED.updated_by`,
    );
  };
  return {
    async readSubject(p, h) {
      return parseSubjectState(await readValue(subjectKey(p, h)));
    },
    async readDay(p, d) {
      return parseDayCounts(await readValue(dayKey(p, d)));
    },
    async writeSubject(p, h, state, label) {
      await upsert(subjectKey(p, h), JSON.stringify(state), `Inbox throttle state — ${p}: ${label}`);
    },
    async writeDay(p, d, counts) {
      await upsert(dayKey(p, d), JSON.stringify(counts), `Inbox throttle day counters — ${p} ${d}`);
    },
  };
}

async function takeThrottleLocks(handle: StoreHandle, producer: string, subjectHash: string): Promise<void> {
  // Fixed order (subject, then producer-day) so locks cannot deadlock.
  await handle.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`inbox_throttle:${producer}:${subjectHash}`}))`);
  await handle.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`inbox_throttle:${producer}:day`}))`);
}

const dbThrottleBackend: ThrottleBackend = {
  async withLock(producer, subjectHash, fn) {
    return db.transaction(async (tx) => {
      await takeThrottleLocks(tx, producer, subjectHash);
      return fn(dbStore(tx));
    });
  },
  async withTxLock(tx, producer, subjectHash, fn) {
    await takeThrottleLocks(tx, producer, subjectHash);
    return fn(dbStore(tx));
  },
};

/**
 * Lockless backend over the shared db handle. Backs the split-pair facades
 * for the one call site that may not open a transaction (agentAuthorityGate's
 * plain branch — see the header's D-5 note). Never used by raiseIfAllowed's
 * locked composition.
 */
const dbDirectBackend: ThrottleBackend = {
  async withLock(_producer, _subjectHash, fn) {
    // The store uses only .select/.execute, which the shared db handle
    // provides exactly as a transaction handle does; the cast bridges the
    // two handles' session generics, nothing behavioural.
    return fn(dbStore(db as unknown as Tx));
  },
};

// ============================================
// Default instance — the facade producers call
// ============================================

const defaultThrottle = createThrottle({ backend: dbThrottleBackend });

export const raiseIfAllowed = <T>(
  input: ThrottleInput,
  insertFn: () => Promise<T>,
  opts?: RaiseOptions,
): Promise<RaiseOutcome<T>> => defaultThrottle.raiseIfAllowed(input, insertFn, opts);

/**
 * The split pair over the LOCKLESS direct store — only for the one call site
 * whose pre-existing producer contract forbids opening a transaction
 * (agentAuthorityGate's plain branch; see the header's D-5 note). Every other
 * producer uses the locked raiseIfAllowed composition above.
 */
const unlatchedThrottle = createThrottle({ backend: dbDirectBackend });

export const shouldRaiseCard = (input: ThrottleInput): Promise<ThrottleVerdict> => unlatchedThrottle.shouldRaiseCard(input);

export const recordRaised = (input: ThrottleInput): Promise<void> => unlatchedThrottle.recordRaised(input);
