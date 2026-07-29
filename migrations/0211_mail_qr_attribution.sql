-- ============================================================================
-- 0211 — Wave B "Wire the engine": direct-mail attribution gets real data
-- ----------------------------------------------------------------------------
-- The outreach benchmark's P0: the direct-mail attribution funnel was a
-- capable-looking UI over permanent zeros.
--
--   * mail_shipment_pieces.qr_scan_count was READ in eight places (funnel,
--     response timeline, template comparison, cohort report, CSV export,
--     In-Flight table) and WRITTEN in none. There was no QR generation and no
--     scan endpoint.
--   * The In-Flight tracker's "USPS scan timestamps" were UI-only: printed_at
--     / in_transit_at / delivered_at were declared and never populated,
--     because no Lob delivery-event ingest existed.
--   * tracking_number_assignments existed but the mail queue path never
--     invoked the pool, so inbound calls could not attribute to a campaign.
--
-- This migration adds the storage those three feeds need. It adds NO new
-- surface: the analytics that consume it were already built.
--
-- Mirrors shared/schema/finance.ts + scripts/migrate.mjs.
-- Additive + idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

-- ── 1. The per-piece QR short code actually printed on the mail piece ───────
-- HMAC-signed and opaque (see server/services/mail/qrCodes.ts). NULL means the
-- piece predates instrumentation: downstream surfaces must report it as "not
-- instrumented", never as "0 scans measured".
ALTER TABLE "mail_shipment_pieces" ADD COLUMN IF NOT EXISTS "qr_code" text;

-- Public /r/:code redirect lookup. UNIQUE so a code can never resolve to two
-- pieces, which would make attribution ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "mail_shipment_pieces_qr_code_uidx"
  ON "mail_shipment_pieces" ("qr_code");

-- Lob webhook ingest lookup (provider piece id → our piece row).
CREATE INDEX IF NOT EXISTS "mail_shipment_pieces_provider_piece_idx"
  ON "mail_shipment_pieces" ("provider_piece_id");

-- ── 2. Scan events — the evidence behind qr_scan_count ─────────────────────
-- One row per HTTP hit on /r/:code, INCLUDING the hits we deliberately do not
-- count (bot, prefetch, rapid repeat) with the reason recorded. The rollup
-- column stays the fast read; this table is why anyone should believe it.
--
-- Nothing here identifies the scanner: client_fingerprint is a truncated HMAC
-- of (ip + user-agent) used only to recognise a repeat hit from the same
-- client inside the dedupe window. The raw IP and user agent are never stored.
CREATE TABLE IF NOT EXISTS "mail_qr_scan_events" (
  "id" serial PRIMARY KEY,
  "piece_id" integer NOT NULL REFERENCES "mail_shipment_pieces" ("id") ON DELETE CASCADE,
  "shipment_id" integer NOT NULL REFERENCES "mail_shipments" ("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "scanned_at" timestamp with time zone NOT NULL DEFAULT now(),
  "client_fingerprint" text,
  "counted" boolean NOT NULL DEFAULT true,
  "suppressed_reason" text
);

CREATE INDEX IF NOT EXISTS "mail_qr_scan_events_piece_fp_idx"
  ON "mail_qr_scan_events" ("piece_id", "client_fingerprint", "scanned_at");
CREATE INDEX IF NOT EXISTS "mail_qr_scan_events_shipment_scanned_idx"
  ON "mail_qr_scan_events" ("shipment_id", "scanned_at");
CREATE INDEX IF NOT EXISTS "mail_qr_scan_events_org_scanned_idx"
  ON "mail_qr_scan_events" ("organization_id", "scanned_at");

-- ── 3. Tracking numbers ↔ mail shipments ───────────────────────────────────
-- campaign_id points at a MARKETING campaign; a mail shipment is a different
-- id space. Giving the link its own nullable column keeps a shipment's inbound
-- calls from being attributed to whichever campaign shares its numeric id.
ALTER TABLE "tracking_number_assignments" ADD COLUMN IF NOT EXISTS "mail_shipment_id" integer;

CREATE INDEX IF NOT EXISTS "tracking_number_assignments_mail_shipment_idx"
  ON "tracking_number_assignments" ("mail_shipment_id");
