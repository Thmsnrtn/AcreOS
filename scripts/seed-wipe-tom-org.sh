#!/usr/bin/env bash
# =============================================================================
# seed-wipe-tom-org.sh
#
# PURPOSE: Surgically remove seed / sample data from Tom's founder org.
#
# SAFETY CONTRACT:
#   - All operations are scoped to the org with is_founder = true
#   - All lead, property, deal, and note deletes are SOFT (deleted_at = now())
#   - Campaigns are hard-deleted (no deleted_at column, template-only records)
#   - The entire mutation block runs in a single transaction — any error rolls back
#   - Tom must type "WIPE" to proceed — no accidental execution
#   - Everything is logged to scripts/wipe-runs/
#
# REVIEWED BY: Beatrice Whitfield (CRO) — see docs/internal/seed-wipe-dry-run.md
#
# CONSTITUTION NOTE: This wipes the FOUNDER's own seed data, not customer data.
# Customer data is not at risk. This script will abort if no org with
# is_founder = true is found, or if more than one is found.
#
# RUN:
#   Option A (Fly SSH):
#     flyctl ssh console -a acreos -C "bash /app/scripts/seed-wipe-tom-org.sh"
#   Option B (local with staged tunnel):
#     flyctl proxy 5432:5432 -a acreos-db &
#     DATABASE_URL="postgres://..." bash scripts/seed-wipe-tom-org.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/wipe-runs"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%S)"
LOG_FILE="${LOG_DIR}/wipe-${TIMESTAMP}.log"

mkdir -p "${LOG_DIR}"

# Tee all output to log file
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "============================================================"
echo "  AcreOS Seed-Data Wipe Script"
echo "  Started: ${TIMESTAMP}"
echo "  Log: ${LOG_FILE}"
echo "============================================================"
echo ""

# ─── Prerequisite: DATABASE_URL must be set ───────────────────────────────────

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "Set it before running this script, e.g.:"
  echo "  DATABASE_URL='postgres://...' bash scripts/seed-wipe-tom-org.sh"
  exit 1
fi

# ─── Step 0: Confirm founder org ──────────────────────────────────────────────

echo "STEP 0: Identifying founder org..."
echo ""

FOUNDER_ORG=$(psql "${DATABASE_URL}" -t -A -c "
SELECT id || '|' || name || '|' || slug || '|' || owner_id || '|' || created_at::text
FROM organizations
WHERE is_founder = true;
")

if [ -z "${FOUNDER_ORG}" ]; then
  echo "ERROR: No org with is_founder = true found in the database."
  echo "Nothing to wipe. Exiting safely."
  exit 1
fi

ORG_COUNT=$(echo "${FOUNDER_ORG}" | wc -l | tr -d ' ')
if [ "${ORG_COUNT}" -gt 1 ]; then
  echo "ERROR: Found ${ORG_COUNT} orgs with is_founder = true."
  echo "Data anomaly — please investigate before proceeding."
  echo "${FOUNDER_ORG}"
  exit 1
fi

ORG_ID=$(echo "${FOUNDER_ORG}" | cut -d'|' -f1)
ORG_NAME=$(echo "${FOUNDER_ORG}" | cut -d'|' -f2)
ORG_SLUG=$(echo "${FOUNDER_ORG}" | cut -d'|' -f3)
ORG_OWNER=$(echo "${FOUNDER_ORG}" | cut -d'|' -f4)
ORG_CREATED=$(echo "${FOUNDER_ORG}" | cut -d'|' -f5)

echo "  Found founder org:"
echo "    id:         ${ORG_ID}"
echo "    name:       ${ORG_NAME}"
echo "    slug:       ${ORG_SLUG}"
echo "    owner_id:   ${ORG_OWNER}"
echo "    created_at: ${ORG_CREATED}"
echo ""

# ─── Step 1: Dry-run counts ───────────────────────────────────────────────────

echo "STEP 1: Dry-run — counting rows that WOULD be wiped..."
echo ""

LEAD_COUNT=$(psql "${DATABASE_URL}" -t -A -c "
SELECT COUNT(*) FROM leads
WHERE organization_id = ${ORG_ID}
  AND deleted_at IS NULL
  AND (
    source = 'sample_data'
    OR (email LIKE '%@example.com' AND phone LIKE '555-0%')
  );
")

PROPERTY_COUNT=$(psql "${DATABASE_URL}" -t -A -c "
SELECT COUNT(*) FROM properties
WHERE organization_id = ${ORG_ID}
  AND deleted_at IS NULL
  AND (
    apn LIKE 'SAMPLE-%'
    OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001')
    OR (
      address IN (
        '1842 Elm St', '309 Birch Dr', '77 Maple Blvd', '1200 Commerce Pkwy',
        '42 Lakefront Dr', '1515 Sunset Blvd', 'Hwy 290 Tract',
        '8800 County Rd 12', '2200 Park Ave', 'Pine Ridge MHP', '900 Cherry Ln'
      )
      AND seller_id IN (
        SELECT id FROM leads
        WHERE organization_id = ${ORG_ID} AND email LIKE '%@example.com'
      )
    )
  );
")

DEAL_COUNT=$(psql "${DATABASE_URL}" -t -A -c "
SELECT COUNT(*) FROM deals
WHERE organization_id = ${ORG_ID}
  AND deleted_at IS NULL
  AND property_id IN (
    SELECT id FROM properties
    WHERE organization_id = ${ORG_ID}
      AND deleted_at IS NULL
      AND (
        apn LIKE 'SAMPLE-%'
        OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001')
        OR (
          address IN (
            '1842 Elm St', '309 Birch Dr', '77 Maple Blvd', '1200 Commerce Pkwy',
            '42 Lakefront Dr', '1515 Sunset Blvd', 'Hwy 290 Tract',
            '8800 County Rd 12', '2200 Park Ave', 'Pine Ridge MHP', '900 Cherry Ln'
          )
          AND seller_id IN (
            SELECT id FROM leads
            WHERE organization_id = ${ORG_ID} AND email LIKE '%@example.com'
          )
        )
      )
  );
")

NOTE_COUNT=$(psql "${DATABASE_URL}" -t -A -c "
SELECT COUNT(*) FROM notes
WHERE organization_id = ${ORG_ID}
  AND deleted_at IS NULL
  AND property_id IN (
    SELECT id FROM properties
    WHERE organization_id = ${ORG_ID}
      AND (apn LIKE 'SAMPLE-%' OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001'))
  );
")

CAMPAIGN_COUNT=$(psql "${DATABASE_URL}" -t -A -c "
SELECT COUNT(*) FROM campaigns
WHERE organization_id = ${ORG_ID}
  AND status = 'draft'
  AND (
    content LIKE '%[YOUR NAME]%'
    OR subject LIKE '%[YOUR NAME]%'
    OR subject LIKE '%{{%'
    OR content LIKE '%{{%'
  );
")

TOTAL=$((LEAD_COUNT + PROPERTY_COUNT + DEAL_COUNT + NOTE_COUNT + CAMPAIGN_COUNT))

echo "  Leads to soft-delete:      ${LEAD_COUNT}"
echo "  Properties to soft-delete: ${PROPERTY_COUNT}"
echo "  Deals to soft-delete:      ${DEAL_COUNT}"
echo "  Notes to soft-delete:      ${NOTE_COUNT}"
echo "  Campaigns to hard-delete:  ${CAMPAIGN_COUNT}"
echo "  ─────────────────────────────────────"
echo "  TOTAL rows affected:       ${TOTAL}"
echo ""

# Safety check — if counts are outside expected envelope, warn loudly
if [ "${LEAD_COUNT}" -gt 20 ] || [ "${PROPERTY_COUNT}" -gt 15 ] || [ "${TOTAL}" -gt 60 ]; then
  echo "WARNING: Row counts are higher than the expected envelope."
  echo "  Expected: ≤15 leads, ≤8 properties, total ≤40"
  echo "  Found:    ${LEAD_COUNT} leads, ${PROPERTY_COUNT} properties, ${TOTAL} total"
  echo ""
  echo "This may mean other records were created in the founder org that look"
  echo "like seed data but aren't. Review docs/internal/seed-wipe-dry-run.md"
  echo "before proceeding."
  echo ""
fi

if [ "${TOTAL}" -eq 0 ]; then
  echo "Nothing to wipe — all counts are zero. The org may already be clean."
  echo "Exiting without making any changes."
  exit 0
fi

# ─── Step 2: Confirmation gate ────────────────────────────────────────────────

echo "============================================================"
echo "  CONFIRMATION REQUIRED"
echo "============================================================"
echo ""
echo "  You are about to wipe seed data from Tom's founder org:"
echo ""
echo "    Org:  ${ORG_NAME} (id=${ORG_ID})"
echo "    Rows: ${TOTAL} records across 5 tables"
echo ""
echo "  Leads, properties, deals, and notes will be SOFT-DELETED"
echo "  (deleted_at set — recoverable via SQL UPDATE)."
echo ""
echo "  Campaigns will be HARD-DELETED (no soft-delete column exists)."
echo ""
echo "  To cancel: Ctrl+C or type anything other than WIPE."
echo ""
printf "  Type WIPE to proceed: "
read -r CONFIRMATION

if [ "${CONFIRMATION}" != "WIPE" ]; then
  echo ""
  echo "Confirmation not received ('${CONFIRMATION}'). Aborting. No changes made."
  exit 0
fi

echo ""
echo "Confirmation received. Proceeding with wipe..."
echo ""

# ─── Step 3: Execute wipe in a single transaction ────────────────────────────

echo "STEP 3: Executing wipe transaction..."

WIPE_RESULT=$(psql "${DATABASE_URL}" -t -A -c "
BEGIN;

-- 1. Soft-delete seed leads
UPDATE leads
SET deleted_at = now(), deleted_by = 'seed-wipe-${TIMESTAMP}'
WHERE organization_id = ${ORG_ID}
  AND deleted_at IS NULL
  AND (
    source = 'sample_data'
    OR (email LIKE '%@example.com' AND phone LIKE '555-0%')
  );

-- 2a. Soft-delete deals on seed properties (before properties — FK restrict)
UPDATE deals
SET deleted_at = now(), deleted_by = 'seed-wipe-${TIMESTAMP}'
WHERE organization_id = ${ORG_ID}
  AND deleted_at IS NULL
  AND property_id IN (
    SELECT id FROM properties
    WHERE organization_id = ${ORG_ID}
      AND deleted_at IS NULL
      AND (
        apn LIKE 'SAMPLE-%'
        OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001')
        OR (
          address IN (
            '1842 Elm St', '309 Birch Dr', '77 Maple Blvd', '1200 Commerce Pkwy',
            '42 Lakefront Dr', '1515 Sunset Blvd', 'Hwy 290 Tract',
            '8800 County Rd 12', '2200 Park Ave', 'Pine Ridge MHP', '900 Cherry Ln'
          )
          AND seller_id IN (
            SELECT id FROM leads
            WHERE organization_id = ${ORG_ID} AND email LIKE '%@example.com'
          )
        )
      )
  );

-- 2b. Soft-delete notes on seed properties
UPDATE notes
SET deleted_at = now(), deleted_by = 'seed-wipe-${TIMESTAMP}'
WHERE organization_id = ${ORG_ID}
  AND deleted_at IS NULL
  AND property_id IN (
    SELECT id FROM properties
    WHERE organization_id = ${ORG_ID}
      AND (apn LIKE 'SAMPLE-%' OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001'))
  );

-- 3. Soft-delete seed properties
UPDATE properties
SET deleted_at = now()
WHERE organization_id = ${ORG_ID}
  AND deleted_at IS NULL
  AND (
    apn LIKE 'SAMPLE-%'
    OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001')
    OR (
      address IN (
        '1842 Elm St', '309 Birch Dr', '77 Maple Blvd', '1200 Commerce Pkwy',
        '42 Lakefront Dr', '1515 Sunset Blvd', 'Hwy 290 Tract',
        '8800 County Rd 12', '2200 Park Ave', 'Pine Ridge MHP', '900 Cherry Ln'
      )
      AND seller_id IN (
        SELECT id FROM leads
        WHERE organization_id = ${ORG_ID} AND email LIKE '%@example.com'
      )
    )
  );

-- 4. Hard-delete unmodified template campaigns
DELETE FROM campaigns
WHERE organization_id = ${ORG_ID}
  AND status = 'draft'
  AND (
    content LIKE '%[YOUR NAME]%'
    OR subject LIKE '%[YOUR NAME]%'
    OR subject LIKE '%{{%'
    OR content LIKE '%{{%'
  );

-- 5. Clear sampleDataLoaded flag
UPDATE organizations
SET onboarding_data = jsonb_set(
  COALESCE(onboarding_data, '{}'::jsonb),
  '{sampleDataLoaded}',
  'false'
)
WHERE id = ${ORG_ID};

COMMIT;
")

echo ""
echo "============================================================"
echo "  WIPE COMPLETE"
echo "============================================================"
echo ""
echo "  Org: ${ORG_NAME} (id=${ORG_ID})"
echo "  Rows affected (pre-wipe estimate): ${TOTAL}"
echo "  Timestamp: ${TIMESTAMP}"
echo "  Log: ${LOG_FILE}"
echo ""
echo "  To recover (soft-deletes only):"
echo "    UPDATE leads SET deleted_at = NULL, deleted_by = NULL"
echo "      WHERE deleted_by = 'seed-wipe-${TIMESTAMP}';"
echo "    UPDATE deals SET deleted_at = NULL, deleted_by = NULL"
echo "      WHERE deleted_by = 'seed-wipe-${TIMESTAMP}';"
echo "    UPDATE notes SET deleted_at = NULL, deleted_by = NULL"
echo "      WHERE deleted_by = 'seed-wipe-${TIMESTAMP}';"
echo ""
echo "  NOTE: Campaign hard-deletes cannot be recovered via SQL."
echo "  Use POST /api/onboarding/sample-data to regenerate templates."
echo ""
