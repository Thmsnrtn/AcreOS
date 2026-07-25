/**
 * Canonical formatters for the app. Use these instead of inline
 * `.toLocaleString()`, `.toFixed(0)`, `${...}%`, ad-hoc date strings,
 * etc. Centralizes rules so a change (e.g. adding i18n) happens
 * once.
 */

import { formatDistanceToNow, format as dfFormat } from "date-fns";

// ── Money ───────────────────────────────────────────────────────────

/** Format cents as "$1,234" (no decimals for whole dollars). */
export function dollars(cents: number | null | undefined, opts: { showSign?: boolean } = {}): string {
  if (cents == null) return "—";
  const abs = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(abs);
  if (opts.showSign && cents > 0) return `+${formatted}`;
  if (cents < 0) return `−${formatted}`;
  return formatted;
}

/** Format cents as "$1.2K" / "$1.2M" for dense surfaces. */
export function dollarsCompact(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${Math.round(dollars)}`;
}

/**
 * Format a dollar-valued amount (NOT cents) with explicit 2-decimal
 * precision. Use when the underlying value is a dollar number (string
 * parsed via Number(), currency column, etc.) — the standard path on
 * most AcreOS surfaces that don't use cents storage.
 *
 * Accepts number | string | null | undefined. Returns "—" for
 * null/undefined/empty/NaN, otherwise a currency-formatted string
 * like "$1,234.56".
 *
 * This is the canonical replacement for bare `.toLocaleString()` on
 * money values — bare toLocaleString drops cents on integer values,
 * causing rendered totals to be short by up to $0.99. On a money
 * surface a borrower paying the displayed number is cheated.
 */
export function usd(
  amount: number | string | null | undefined,
  opts: { noCents?: boolean; showSign?: boolean } = {}
): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  const digits = opts.noCents ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(n));
  if (opts.showSign && n > 0) return `+${formatted}`;
  if (n < 0) return `−${formatted}`;
  return formatted;
}

// ── Counts ──────────────────────────────────────────────────────────

/** Format integer counts. 1,234 style for normal, 1.2K/1.2M compact. */
export function count(n: number | null | undefined, compact = false): string {
  if (n == null) return "—";
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toLocaleString("en-US");
}

// ── Percent ─────────────────────────────────────────────────────────

/**
 * "85%" from 85 — or from 0.85 with `{ fraction: true }`.
 *
 * The unit is EXPLICIT, never guessed. The old magnitude heuristic
 * ("values ≤ 1 are fractions") silently broke for any fractional ratio
 * above 1: the public Land Deal Calculator rendered a 197.2% ROI as
 * "2.0%" because 1.972 > 1 skipped the ×100 (2026-07 production-gate
 * audit). Callers holding a ratio (0.85 = 85%) pass `fraction: true`;
 * callers holding percent points (85 = 85%) pass nothing.
 */
export function percent(
  value: number | null | undefined,
  opts: { decimals?: number; fraction?: boolean } = {},
): string {
  if (value == null) return "—";
  const v = opts.fraction ? value * 100 : value;
  return `${v.toFixed(opts.decimals ?? 0)}%`;
}

// ── Dates ───────────────────────────────────────────────────────────

type DateInput = Date | string | number | null | undefined;

/** Parse any accepted date input; null when missing or invalid. */
function toDate(input: DateInput): Date | null {
  if (input == null || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Module-level cached formatters — Intl.DateTimeFormat construction is
// expensive; these helpers run inside render loops (tables, feeds).
const HOUSE_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const HOUSE_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * House absolute date: "Jun 11, 2026".
 *
 * Convention source: the dominant explicit `toLocaleDateString` option
 * set across the client (`{ year: "numeric", month: "short", day:
 * "numeric" }` — leads, deals, finance surfaces) and the existing
 * `shortDate` helper below. Pure Intl, no date-fns.
 *
 * Returns "—" for null/undefined/invalid input.
 *
 * W2-2 codemod target: all bare `toLocaleDateString(...)` call sites
 * route through here.
 */
export function formatDate(date: DateInput): string {
  const d = toDate(date);
  return d ? HOUSE_DATE_FMT.format(d) : "—";
}

/**
 * House absolute datetime: "Jun 11, 2026 · 9:47 PM" (matches the
 * existing `shortDateTime` middot convention). Pure Intl.
 *
 * Returns "—" for null/undefined/invalid input.
 *
 * W2-2 codemod target: `toLocaleString(...)` call sites rendering a
 * date+time route through here.
 */
export function formatDateTime(date: DateInput): string {
  const d = toDate(date);
  if (!d) return "—";
  return `${HOUSE_DATE_FMT.format(d)} · ${HOUSE_TIME_FMT.format(d)}`;
}

/**
 * House relative date: "just now" / "5m ago" / "2h ago" / "3d ago",
 * falling back to {@link formatDate} ("Jun 11, 2026") once the moment
 * is more than 7 days in the past — relative phrasing loses meaning
 * past a week. Future timestamps (beyond 60s of clock skew, which
 * reads as "just now") also fall back to the absolute date.
 *
 * Pass `now` explicitly in tests for determinism; defaults to
 * `Date.now()` at call time. Pure function, Intl only.
 *
 * Returns "—" for null/undefined/invalid input.
 *
 * W2-2 codemod target: ad-hoc "X ago" math and `formatDistanceToNow`
 * call sites route through here.
 */
export function formatRelative(date: DateInput, now: Date | number = Date.now()): string {
  const d = toDate(date);
  if (!d) return "—";
  const nowMs = now instanceof Date ? now.getTime() : now;
  const diffMs = nowMs - d.getTime();
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  if (diffMs < -MINUTE) return formatDate(d); // future beyond skew
  if (diffMs < MINUTE) return "just now";
  if (diffMs < HOUR) return `${Math.floor(diffMs / MINUTE)}m ago`;
  if (diffMs < DAY) return `${Math.floor(diffMs / HOUR)}h ago`;
  if (diffMs <= 7 * DAY) return `${Math.floor(diffMs / DAY)}d ago`;
  return formatDate(d);
}

/**
 * Relative: "2h ago", "3d ago". Uses date-fns naming.
 * Legacy — prefer {@link formatRelative} (W2-2 house primitive; no
 * date-fns dependency, deterministic via explicit `now`). The W2-2
 * codemod will consolidate call sites onto formatRelative.
 */
export function relative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Short absolute: "Apr 21, 2026".
 * Legacy — prefer {@link formatDate} (same output, Intl only).
 */
export function shortDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return dfFormat(d, "MMM d, yyyy");
}

/**
 * Short datetime: "Apr 21, 2026 · 9:47 PM".
 * Legacy — prefer {@link formatDateTime} (same output, Intl only).
 */
export function shortDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return dfFormat(d, "MMM d, yyyy · h:mm a");
}

// ── Pluralization ───────────────────────────────────────────────────

/**
 * Simple pluralizer for the known English labels used in this app.
 * Prefer over ad-hoc ternaries to keep grammar consistent.
 *
 *   plural(1, "decision")          → "1 decision"
 *   plural(2, "decision")          → "2 decisions"
 *   plural(3, "property", "properties") → "3 properties"
 */
export function plural(
  n: number,
  singular: string,
  pluralForm?: string,
): string {
  if (n === 1) return `1 ${singular}`;
  if (pluralForm) return `${n.toLocaleString("en-US")} ${pluralForm}`;
  if (/y$/.test(singular)) return `${n.toLocaleString("en-US")} ${singular.replace(/y$/, "ies")}`;
  if (/(s|x|z|ch|sh)$/.test(singular)) return `${n.toLocaleString("en-US")} ${singular}es`;
  return `${n.toLocaleString("en-US")} ${singular}s`;
}

// ── Acres / land units ──────────────────────────────────────────────

/** "12.5 acres" / "1 acre" with simple pluralization. */
export function acres(n: number | null | undefined): string {
  if (n == null) return "—";
  const rounded = Math.round(n * 10) / 10;
  return `${rounded.toLocaleString("en-US")} ${rounded === 1 ? "acre" : "acres"}`;
}

// ── Trust / calibration scoring ─────────────────────────────────────

/** Brier score is [0..1], lower is better. Adds qualitative suffix. */
export function brier(score: number | null | undefined): string {
  if (score == null) return "—";
  if (score < 0.1) return `${score.toFixed(3)} (excellent)`;
  if (score < 0.2) return `${score.toFixed(3)} (good)`;
  if (score < 0.3) return `${score.toFixed(3)} (mediocre)`;
  return `${score.toFixed(3)} (poor)`;
}
