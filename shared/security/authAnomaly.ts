/**
 * Auth-anomaly checker (PKG-6c, detection half) — a PURE function over a batch
 * of sign-in events. No I/O, no persistence, no clock reads: the caller supplies
 * the events (and optionally `now`), the module returns findings.
 *
 * There is no in-repo source of sign-in FAILURE events today (Clerk hosts the
 * credential step; `auth_fail_attempts` has no writers). This module is what an
 * ops-side feed would be run through; see docs/security/auth-anomaly-alerting.md.
 * It takes no action on accounts — it only describes what it saw.
 *
 * WINDOW SEMANTICS. Windows are CLOSED intervals: a set of events is "within N
 * minutes" when (latest - earliest) <= N minutes, so two events exactly N
 * minutes apart ARE in the same window and N minutes + 1 ms apart are not.
 *
 * `now` (optional): events later than `now` are ignored (clock skew / replay).
 * When omitted it defaults to the latest event time in the batch, so the
 * function stays deterministic with no wall-clock read. The checker does not
 * trim old events; the caller chooses the batch and de-duplicates repeat
 * findings by (rule, identifier/ip, windowStart).
 *
 * Output: one finding per (rule, subject) — the EARLIEST qualifying window —
 * sorted by windowStart, then rule, then identifier, then ip.
 */

export type AuthEventKind = "sign_in_failure" | "sign_in_success";

export interface AuthEvent {
  kind: AuthEventKind;
  /** Email or user id string. Compared trimmed and case-insensitively. */
  identifier: string;
  /** Source IP (IPv4, IPv6, or IPv4-mapped IPv6). */
  ip: string;
  /** A Date or an ISO-8601 string. An unparseable value throws RangeError. */
  occurredAt: Date | string;
}

// ── PROPOSED thresholds — tune on first real data ─────────────────────────

/** PROPOSED — tune on first real data. Rule (a): failures for one identifier. */
export const IDENTIFIER_BURST_MIN_FAILURES = 5;
/** PROPOSED — tune on first real data. Rule (a) window. */
export const IDENTIFIER_BURST_WINDOW_MS = 10 * 60 * 1000;

/** PROPOSED — tune on first real data. Rule (b): failures from one subnet. */
export const IP_BURST_MIN_FAILURES = 20;
/** PROPOSED — tune on first real data. Rule (b): distinct identifiers hit. */
export const IP_BURST_MIN_DISTINCT_IDENTIFIERS = 5;
/** PROPOSED — tune on first real data. Rule (b) window. */
export const IP_BURST_WINDOW_MS = 10 * 60 * 1000;

/**
 * PROPOSED — tune on first real data. Rule (c): a success for an identifier
 * strictly after that identifier met rule (a), and no later than this long
 * after the moment the burst reached its threshold.
 */
export const SUCCESS_AFTER_BURST_WINDOW_MS = 15 * 60 * 1000;

export type AuthAnomalyRule =
  | "identifier_burst"
  | "ip_burst"
  | "success_after_burst";

export interface AuthAnomalyFinding {
  rule: AuthAnomalyRule;
  /** Normalised (trimmed, lower-cased). Set for rules (a) and (c). */
  identifier?: string;
  /** Rule (b): the subnet ("a.b.c.0/24" or "x:x:x:x::/64"). Rule (c): the success IP. */
  ip?: string;
  /** ISO-8601. */
  windowStart: string;
  /** ISO-8601. */
  windowEnd: string;
  evidence: {
    /** Failures inside the window (rules a, b, c). */
    failureCount: number;
    /** Distinct identifiers among those failures (rule b; 1 for a and c). */
    distinctIdentifiers: number;
    /** Distinct source IPs among those failures. */
    distinctIps: number;
    /** Successes counted (rule c: 1; otherwise 0). */
    successCount: number;
  };
}

interface Norm {
  kind: AuthEventKind;
  id: string;
  ip: string;
  t: number;
}

const RULE_ORDER: Record<AuthAnomalyRule, number> = {
  identifier_burst: 0,
  ip_burst: 1,
  success_after_burst: 2,
};

function toMs(v: Date | string): number {
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  if (!Number.isFinite(ms)) {
    throw new RangeError("authAnomaly: unparseable occurredAt");
  }
  return ms;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const normId = (s: string): string => s.trim().toLowerCase();

/**
 * Subnet key for an IP, or null when it cannot be parsed.
 * CHOICE: IPv4 → /24; IPv6 → /64 (the standard end-site allocation, so one
 * host or household rotating addresses inside its prefix stays one subnet).
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as the IPv4 address.
 */
export function subnetOf(ip: string): string | null {
  let s = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) s = mapped[1];
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    return `${o[0]}.${o[1]}.${o[2]}.0/24`;
  }
  if (!s.includes(":") || !/^[0-9a-f:]+$/.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
    return null;
  }
  const p = groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16));
  return `${p.join(":")}::/64`;
}

/** Group by key, each group sorted ascending by time. */
function groupBy(rows: Norm[], key: (n: Norm) => string | null): Map<string, Norm[]> {
  const m = new Map<string, Norm[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export function evaluateAuthEvents(
  events: readonly AuthEvent[],
  now?: Date | string,
): AuthAnomalyFinding[] {
  if (events.length === 0) return [];
  const all: Norm[] = events.map((e) => ({
    kind: e.kind,
    id: normId(e.identifier),
    ip: e.ip.trim(),
    t: toMs(e.occurredAt),
  }));
  const nowMs = now === undefined ? Math.max(...all.map((n) => n.t)) : toMs(now);
  const rows = all
    .filter((n) => n.t <= nowMs)
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const failures = rows.filter((r) => r.kind === "sign_in_failure");
  const successes = rows.filter((r) => r.kind === "sign_in_success");
  const out: AuthAnomalyFinding[] = [];

  // Rules (a) and (c), per identifier.
  const succById = groupBy(successes, (n) => n.id);
  for (const [id, fs] of groupBy(failures, (n) => n.id)) {
    const T = IDENTIFIER_BURST_MIN_FAILURES;
    let first: AuthAnomalyFinding | null = null;
    // Moments a burst reached threshold: the T-th failure of each qualifying window.
    const metAts: { metAt: number; start: number; count: number }[] = [];
    let j = 0;
    for (let i = 0; i < fs.length; i++) {
      if (j < i) j = i;
      while (j + 1 < fs.length && fs[j + 1].t - fs[i].t <= IDENTIFIER_BURST_WINDOW_MS) j++;
      const count = j - i + 1;
      if (count >= T) {
        const win = fs.slice(i, j + 1);
        if (!first) {
          first = {
            rule: "identifier_burst",
            identifier: id,
            windowStart: iso(fs[i].t),
            windowEnd: iso(fs[j].t),
            evidence: {
              failureCount: count,
              distinctIdentifiers: 1,
              distinctIps: new Set(win.map((w) => w.ip)).size,
              successCount: 0,
            },
          };
        }
        metAts.push({ metAt: fs[i + T - 1].t, start: fs[i].t, count });
      }
    }
    if (!first) continue;
    out.push(first);

    const ss = succById.get(id) ?? [];
    let hit: AuthAnomalyFinding | null = null;
    for (const b of metAts) {
      const s = ss.find((x) => x.t > b.metAt && x.t - b.metAt <= SUCCESS_AFTER_BURST_WINDOW_MS);
      if (s && (!hit || s.t < Date.parse(hit.windowEnd))) {
        const inWin = fs.filter((f) => f.t >= b.start && f.t <= b.metAt);
        hit = {
          rule: "success_after_burst",
          identifier: id,
          ip: s.ip,
          windowStart: iso(b.start),
          windowEnd: iso(s.t),
          evidence: {
            failureCount: inWin.length,
            distinctIdentifiers: 1,
            distinctIps: new Set(inWin.map((w) => w.ip)).size,
            successCount: 1,
          },
        };
      }
    }
    if (hit) out.push(hit);
  }

  // Rule (b), per subnet. Events with an unparseable IP are excluded here only.
  const subnetOfCache = new Map<string, string | null>();
  const sn = (ip: string): string | null => {
    if (!subnetOfCache.has(ip)) subnetOfCache.set(ip, subnetOf(ip));
    return subnetOfCache.get(ip) ?? null;
  };
  for (const [subnet, fs] of groupBy(failures, (n) => sn(n.ip))) {
    let j = 0;
    for (let i = 0; i < fs.length; i++) {
      if (j < i) j = i;
      while (j + 1 < fs.length && fs[j + 1].t - fs[i].t <= IP_BURST_WINDOW_MS) j++;
      const win = fs.slice(i, j + 1);
      const ids = new Set(win.map((w) => w.id)).size;
      if (win.length >= IP_BURST_MIN_FAILURES && ids >= IP_BURST_MIN_DISTINCT_IDENTIFIERS) {
        out.push({
          rule: "ip_burst",
          ip: subnet,
          windowStart: iso(fs[i].t),
          windowEnd: iso(fs[j].t),
          evidence: {
            failureCount: win.length,
            distinctIdentifiers: ids,
            distinctIps: new Set(win.map((w) => w.ip)).size,
            successCount: 0,
          },
        });
        break; // earliest qualifying window only
      }
    }
  }

  const cmp = (a?: string, b?: string) => ((a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0);
  return out.sort(
    (a, b) =>
      cmp(a.windowStart, b.windowStart) ||
      RULE_ORDER[a.rule] - RULE_ORDER[b.rule] ||
      cmp(a.identifier, b.identifier) ||
      cmp(a.ip, b.ip),
  );
}
