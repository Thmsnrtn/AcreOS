// ============================================================================
// SHARED/SCHEMA/IR-SEVERITY.TS
// ----------------------------------------------------------------------------
// Single source of truth for the incident-response / system-alert SEVERITY
// ladder.
//
// Before this module the IR severity ("info" | "warning" | "critical") lived
// as free strings scattered across server/services/alerting.ts,
// server/services/alertPolicy.ts, and the system_alerts.severity column
// comment. Nothing stopped a new call site from inventing "warn" or "high"
// or "CRITICAL", which would silently fall through `severityToPriority` to P3
// (log-only) — i.e. a paging-class alert that never pages. Locking the ladder
// to a typed const closes that drift class: the compiler rejects any severity
// the ladder doesn't define, and the rank map keeps comparisons honest.
//
// This is the IR/alerting ladder specifically. Other audit surfaces have
// their own (deliberately separate) ladders — KRIEGER_SEVERITIES,
// FAILURE_MODE_SEVERITIES, the pax-audit info|warn|fail|critical ladder.
// Those are intentionally NOT unified here; they grade different things.
// ============================================================================

/**
 * The locked incident-response severity ladder, ordered most→least severe.
 * `system_alerts.severity` stores one of these values.
 */
export const IR_SEVERITIES = ["critical", "warning", "info"] as const;

export type IrSeverity = (typeof IR_SEVERITIES)[number];

/** Numeric rank for ordering / comparison. Lower = more severe. */
export const IR_SEVERITY_RANK: Record<IrSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** The default severity used when a producer doesn't specify one. */
export const IR_SEVERITY_DEFAULT: IrSeverity = "info";

const IR_SEVERITY_SET: ReadonlySet<string> = new Set(IR_SEVERITIES);

/** Type guard — true when `value` is a valid locked IR severity. */
export function isIrSeverity(value: unknown): value is IrSeverity {
  return typeof value === "string" && IR_SEVERITY_SET.has(value);
}

/**
 * Coerce an arbitrary (possibly legacy / external) severity string to the
 * locked ladder. Unknown values fall back to `IR_SEVERITY_DEFAULT` rather
 * than throwing, so a malformed upstream severity degrades to "info" instead
 * of crashing the alert path. A couple of common synonyms are normalised so
 * the coercion isn't lossier than it needs to be.
 */
export function coerceIrSeverity(value: unknown): IrSeverity {
  if (isIrSeverity(value)) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (isIrSeverity(v)) return v;
    if (v === "warn") return "warning";
    if (v === "error" || v === "fatal" || v === "high") return "critical";
    if (v === "informational" || v === "debug" || v === "low") return "info";
  }
  return IR_SEVERITY_DEFAULT;
}
