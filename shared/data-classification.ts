/**
 * data-classification — column-level data-classification registry.
 *
 * Tahoe / Beatrice. A central, typed scheme that maps `table.column` → a
 * data-classification class. This is the single source of truth for "how
 * sensitive is this field", consumed by:
 *
 *   1. redactByClassification() — scrubs/labels an object before it crosses a
 *      trust boundary (the customer-visible audit log uses this to label any
 *      pii / sensitive_financial values it surfaces in event metadata).
 *   2. tests/unit/dataClassificationRegistry.test.ts — a lint that fails if a
 *      column whose name strongly implies PII (ssn, tax_id, email, phone, …)
 *      lands in shared/schema.ts without a classification declared here.
 *
 * The classification is intentionally column-grained (not table-grained): a
 * `users` row mixes `public` (id), `pii` (email, phone) and the org table
 * mixes `pii` (legal entity / address) with `sensitive_financial`
 * (tax-id last-4, Stripe ids). Encoding it at the column level is what lets
 * the redactor make per-field decisions.
 *
 * Classes (ordered least → most sensitive):
 *   public               — safe to expose anywhere (ids, timestamps, status)
 *   internal             — operational, not customer-secret, not for export
 *   pii                  — personally identifiable (name, email, phone, address)
 *   sensitive_financial  — tax ids, bank/Stripe ids, card data, balances
 */

export const DATA_CLASSES = [
  "public",
  "internal",
  "pii",
  "sensitive_financial",
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

/** How sensitive each class is, ascending. Used by the redactor's threshold. */
export const DATA_CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  pii: 2,
  sensitive_financial: 3,
};

/** Human-facing label per class, for the audit UI legend. */
export const DATA_CLASS_LABEL: Record<DataClass, string> = {
  public: "Public",
  internal: "Internal",
  pii: "Personal",
  sensitive_financial: "Financial",
};

/**
 * The registry. Keyed by `<table>.<column>` using the *SQL* column name
 * (snake_case) so it lines up with what migrations and raw queries see. The
 * lint test maps Drizzle pgColumn names back to SQL names before checking.
 *
 * Highest-risk tables only — this is a risk register, not an exhaustive map.
 * A column that is absent is treated as `internal` by classify() unless its
 * name matches the PII heuristic (then the lint forces an explicit entry).
 */
export const CLASSIFICATION_REGISTRY: Record<string, DataClass> = {
  // ─── users ────────────────────────────────────────────────────────────────
  "users.id": "public",
  "users.email": "pii",
  "users.first_name": "pii",
  "users.last_name": "pii",
  "users.phone": "pii",
  "users.profile_image_url": "internal",
  "users.created_at": "public",

  // ─── organizations ──────────────────────────────────────────────────────────
  "organizations.id": "public",
  "organizations.name": "internal",
  "organizations.legal_entity_name": "pii",
  "organizations.tax_id_last4": "sensitive_financial",
  "organizations.tax_id_type": "sensitive_financial",
  "organizations.tax_address": "pii",
  "organizations.stripe_customer_id": "sensitive_financial",
  "organizations.stripe_subscription_id": "sensitive_financial",
  "organizations.subscription_tier": "internal",
  "organizations.created_at": "public",

  // ─── leads ──────────────────────────────────────────────────────────────────
  "leads.id": "public",
  "leads.first_name": "pii",
  "leads.last_name": "pii",
  "leads.email": "pii",
  "leads.phone": "pii",
  "leads.mailing_address": "pii",
  "leads.mailing_city": "pii",
  "leads.mailing_state": "internal",
  "leads.mailing_zip": "pii",
  "leads.status": "public",
  "leads.organization_id": "public",
  "leads.created_at": "public",

  // ─── financial_ledger ───────────────────────────────────────────────────────
  "financial_ledger.id": "public",
  "financial_ledger.organization_id": "public",
  "financial_ledger.amount_cents": "sensitive_financial",
  "financial_ledger.balance_cents": "sensitive_financial",
  "financial_ledger.counterparty_name": "pii",
  "financial_ledger.entry_type": "internal",
  "financial_ledger.created_at": "public",

  // ─── support tickets ────────────────────────────────────────────────────────
  "support_tickets.id": "public",
  "support_tickets.organization_id": "public",
  "support_tickets.subject": "internal",
  "support_tickets.body": "pii",
  "support_tickets.requester_email": "pii",
  "support_tickets.status": "public",
  "support_tickets.created_at": "public",
};

/**
 * Column-name heuristic. If a column's *name* matches one of these and the
 * column is NOT declared in the registry, the lint test fails — forcing an
 * explicit classification decision rather than silently shipping a PII field.
 */
export const PII_NAME_PATTERNS: RegExp[] = [
  /(^|_)ssn(_|$)/i,
  /social_security/i,
  /(^|_)email(_|$)/i,
  /(^|_)phone(_|$)/i,
  /tax_id(?!_type)/i, // tax_id, tax_id_last4 — but allow explicit type column
  /(^|_)dob(_|$)/i,
  /date_of_birth/i,
  /(^|_)first_name(_|$)/i,
  /(^|_)last_name(_|$)/i,
];

/**
 * Look up a column's classification. Unknown columns default to `internal`
 * (operational, not exposed) — the lint guarantees PII-named columns can't
 * stay unknown.
 */
export function classify(table: string, column: string): DataClass {
  return CLASSIFICATION_REGISTRY[`${table}.${column}`] ?? "internal";
}

/** True if the column name looks like PII per the heuristic. */
export function looksLikePII(column: string): boolean {
  return PII_NAME_PATTERNS.some((rx) => rx.test(column));
}

export interface RedactOptions {
  /**
   * The table the object's keys belong to, used to look up per-key class.
   * If omitted, keys are classified by name heuristic only.
   */
  table?: string;
  /**
   * Classes at or above this rank are redacted. Default: `pii` (so pii and
   * sensitive_financial are scrubbed; public + internal pass through).
   */
  redactAtOrAbove?: DataClass;
  /**
   * When true, redacted values become a class label (e.g. "[Personal]")
   * instead of "[redacted]". The audit UI uses labels so the customer can see
   * *that* a sensitive field changed without seeing the value.
   */
  label?: boolean;
}

/**
 * Redact/label a flat record by classification. Nested objects are recursed
 * with the same table context. Non-object inputs pass through untouched.
 *
 * MOUNTED BY: server/utils/customerAudit.ts (event metadata sanitisation)
 * and any data-export path that wants class-aware scrubbing.
 */
export function redactByClassification<T>(value: T, opts: RedactOptions = {}): T {
  const threshold = DATA_CLASS_RANK[opts.redactAtOrAbove ?? "pii"];

  const redactKey = (key: string, v: unknown): unknown => {
    const cls = opts.table
      ? classify(opts.table, key)
      : looksLikePII(key)
        ? "pii"
        : "internal";
    if (DATA_CLASS_RANK[cls] >= threshold) {
      return opts.label ? `[${DATA_CLASS_LABEL[cls]}]` : "[redacted]";
    }
    if (v !== null && typeof v === "object") {
      return redactByClassification(v, opts);
    }
    return v;
  };

  if (Array.isArray(value)) {
    return value.map((item) => redactByClassification(item, opts)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactKey(k, v);
    }
    return out as T;
  }
  return value;
}
