// ============================================================================
// SHARED/SCHEMA/DOMAIN-AUDIT-FINDINGS.TS
// ----------------------------------------------------------------------------
// IRIS — the ONE shared continuous-audit substrate that six domains
// (Lena/Beatrice/Quinn/Andrei/Tess/Iyari) write into. Each domain ships
// per-domain "audit loop" detectors that emit findings; the founder Command
// cockpit renders "is it green?" off this single table.
//
// COMPANY/FOUNDER-LEVEL — there is intentionally NO organization_id. A finding
// is a fact about the COMPANY ("the tax-reserve bucket is under-funded",
// "observation ingest stalled"), not about a customer tenant. A finding MAY
// optionally point at a subject (an org id / parcel / etc.) via subject_ref,
// but the row itself is platform-scoped. This mirrors the founder-cockpit
// pattern and the leading-org-index lint correctly skips it (no org column).
//
// Dedupe: a detector re-firing the SAME finding must NOT duplicate. The
// (detector, dedupe_key) UNIQUE lets recordFinding() upsert — insert once,
// then bump last_seen_at on every subsequent firing. Resolution is explicit
// (resolveFinding / acknowledgeFinding) or automatic (staleFindings marks
// open findings not seen in N days as 'stale').
//
// Mirror in scripts/migrate.mjs (STATEMENTS) + migrations/0135_domain_audit_findings.sql.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Six founder domains + the three the cockpit groups them under (product/cs/
// growth come online when those domains add detectors). Kept as a const tuple
// so the substrate, detectors, and read route share one source of truth.
export const DOMAIN_AUDIT_DOMAINS = [
  "finance", // Lena — capital allocation, reserves, unit economics
  "compliance", // Beatrice — legal / security / disclosure
  "alignment", // Quinn — constitutional drift / ethics
  "ai", // Andrei — Pax model behaviour / eval drift
  "reliability", // Tess — SLOs / uptime / observability
  "future", // Iyari — R&D / horizon signals ("acorn stopped growing")
  "product", // Maren (later)
  "cs", // Rafe (later)
  "growth", // Soren (later)
] as const;
export type DomainAuditDomain = (typeof DOMAIN_AUDIT_DOMAINS)[number];

export const DOMAIN_AUDIT_SEVERITIES = ["info", "warn", "critical"] as const;
export type DomainAuditSeverity = (typeof DOMAIN_AUDIT_SEVERITIES)[number];

export const DOMAIN_AUDIT_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
  "stale",
] as const;
export type DomainAuditStatus = (typeof DOMAIN_AUDIT_STATUSES)[number];

export const domainAuditFindings = pgTable(
  "domain_audit_findings",
  {
    id: serial("id").primaryKey(),
    // One of DOMAIN_AUDIT_DOMAINS. Stored as text (not enum) so a new domain's
    // detector can ship without a schema migration.
    domain: text("domain").notNull(),
    // The detector id that emitted this finding (e.g. "tax_reserve",
    // "observation_rate"). Half of the dedupe identity.
    detector: text("detector").notNull(),
    // info | warn | critical
    severity: text("severity").notNull(),
    // Short human title rendered in the cockpit.
    title: text("title").notNull(),
    // Longer human detail — the "what + how bad".
    detail: text("detail").notNull(),
    // The charter rule / immutable / SLO the finding violates. This is the
    // "why it matters" line the cockpit shows next to the finding.
    citedReason: text("cited_reason").notNull(),
    // open | acknowledged | resolved | stale
    status: text("status").notNull().default("open"),
    // The other half of the dedupe identity. Re-firing the same logical finding
    // with the same (detector, dedupe_key) UPDATES last_seen_at rather than
    // inserting a duplicate row.
    dedupeKey: text("dedupe_key").notNull(),
    // Optional pointer to what the finding is about (an org id, a parcel apn,
    // a bucket name, …). NULL for company-wide findings.
    subjectRef: text("subject_ref"),
    // Detector-specific structured payload (counts, thresholds, balances).
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Cockpit's primary query: group/filter by status, severity, domain.
    index("domain_audit_findings_status_severity_domain_idx").on(
      table.status,
      table.severity,
      table.domain,
    ),
    // Dedupe identity — recordFinding() upserts on this.
    uniqueIndex("domain_audit_findings_detector_dedupe_idx").on(
      table.detector,
      table.dedupeKey,
    ),
  ],
);

export type DomainAuditFinding = typeof domainAuditFindings.$inferSelect;
export type InsertDomainAuditFinding = typeof domainAuditFindings.$inferInsert;
