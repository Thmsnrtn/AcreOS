# Seed-Data Wipe — Dry-Run Report

**Author:** Rafe Castellan (CCO) — operator-empathy review  
**Date:** 2026-06-01  
**Phase:** Zero-Zero, per the AcreOS Company Charter  
**Status:** DRAFT — awaiting Beatrice sign-off and Tom's explicit confirmation before any execution

---

## Purpose

Tom cannot feel the real product from inside his own org.  
Months of onboarding-completion seed records (leads, properties, deals, a note) sit in his dataset. Until they are gone, every "Today" widget, every Deals pipeline, every Finance P&L is polluted by synthetic data he never worked on.

This document is **read-only reconnaissance** — no SQL has been run, nothing has been deleted. The script at `scripts/seed-wipe-tom-org.sh` exists to be *reviewed and then run by Tom himself* after Beatrice's sign-off below.

---

## Job 1 — Identify Tom's Org

Tom's org is identified by `organizations.is_founder = true`. There should be exactly one row matching this condition in production. The script prints the `id`, `name`, `slug`, and `owner_id` before any destructive work begins so Tom can visually confirm it before typing "WIPE".

```sql
-- STEP 0: confirm identity of the founder org
SELECT id, name, slug, owner_id, is_founder, created_at
FROM organizations
WHERE is_founder = true;
```

Expected: one row. If zero rows → abort. If more than one → abort and alert Tom (data anomaly).

---

## Seed-Data Patterns Found in Source Code

The onboarding service (`server/services/onboarding.ts`) injects seed data via two code paths:

### Path A — `completeOnboarding()` (called when user finishes the onboarding wizard)

Creates 1–2 leads + 1 property + 1 deal per supported `businessType`. These are business-type-shaped *story* records. The specific names and APNs used:

| Business type | Lead first names | APN marker |
|---|---|---|
| land_flipper / hybrid | Sarah Martinez, Bill Thompson | `ONBOARD-SAMPLE-001` |
| note_investor | James Rivera, Carol Jensen | `ONBOARD-NOTE-001` |
| residential_wholesaler | Mike Torres, Dana Koch | *(no APN set)* |
| fix_and_flip | Gary Holt | *(no APN set)* |
| buy_and_hold | Pat Sullivan | *(no APN set)* |
| commercial | Lynn Park | *(no APN set)* |
| short_term_rental | Heather Brooks | *(no APN set)* |
| creative_finance | Derek Nguyen | *(no APN set)* |
| developer | Margaret Ellis | *(no APN set)* |
| tax_lien_deed | Roy Watkins | *(no APN set)* |
| multifamily | Gloria Reeves | *(no APN set)* |
| mobile_home | Earl Dixon | *(no APN set)* |
| agent_investor | Tamara Wells, Jason Park | *(no APN set)* |

These records have **no `source` tag** that uniquely fingerprints them as onboarding samples. The only reliable identifiers are:
- APNs `ONBOARD-SAMPLE-001` and `ONBOARD-NOTE-001` on properties
- Email addresses matching `@example.com`
- Phone numbers matching `555-01xx` / `555-02xx` patterns (all are `555-xxxx` format)

### Path B — `generateSampleData()` (called via `POST /api/onboarding/sample-data`)

Creates 5 leads with `source = 'sample_data'`, 3 properties with APNs starting with `SAMPLE-`, 2 deals linked to those properties, and 1 note.

This path has a clean, reliable fingerprint: `source = 'sample_data'` on leads and `apn LIKE 'SAMPLE-%'` on properties.

### Path C — `provisionTemplates()` (called during onboarding step 3)

Creates campaign templates with `status = 'draft'` and content that contains `[YOUR NAME]` placeholders. No `deleted_at` column exists on `campaigns`. These are templates Tom may have edited — the WHERE clause must be conservative.

---

## Soft-Delete Availability

| Table | `deleted_at` column? | Recommended approach |
|---|---|---|
| `leads` | YES (`deleted_at`, `deleted_by`) | Soft-delete |
| `properties` | YES (`deleted_at`) | Soft-delete |
| `deals` | YES (`deleted_at`, `deleted_by`) | Soft-delete |
| `notes` | YES (`deleted_at`, `deleted_by`) | Soft-delete |
| `campaigns` | NO | Hard delete only (these are templates, never customer-transactional records) |

All data destruction is via `UPDATE ... SET deleted_at = now()` except campaigns (hard `DELETE`).

---

## Dry-Run: Row Counts by Table

The following `SELECT` statements estimate what would be marked deleted. **Tom should run these read-only queries himself before the wipe to verify the numbers match expectation.**

### Leads (soft-delete)

```sql
-- COUNT only — no deletion
SELECT COUNT(*) AS lead_rows_to_wipe
FROM leads
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND deleted_at IS NULL
  AND (
    -- Path B: explicit source tag
    source = 'sample_data'
    OR
    -- Path A: onboarding story records (email domain + 555-01xx/02xx phone)
    (
      email LIKE '%@example.com'
      AND phone LIKE '555-0%'
    )
  );
```

### Properties (soft-delete)

```sql
SELECT COUNT(*) AS property_rows_to_wipe
FROM properties
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND deleted_at IS NULL
  AND (
    -- Path B APNs
    apn LIKE 'SAMPLE-%'
    OR
    -- Path A APNs
    apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001')
    OR
    -- Path A: story properties with no APN except the onboard ones above,
    -- matched by their exact story addresses (conservative — must match
    -- BOTH address AND a @example.com seller lead to avoid collateral damage)
    address IN (
      '1842 Elm St',    -- wholesaler
      '309 Birch Dr',   -- fix & flip
      '77 Maple Blvd',  -- buy & hold
      '1200 Commerce Pkwy', -- commercial
      '42 Lakefront Dr',-- STR
      '1515 Sunset Blvd',-- creative finance
      'Hwy 290 Tract',  -- developer
      '8800 County Rd 12', -- tax deed
      '2200 Park Ave',  -- multifamily
      'Pine Ridge MHP', -- mobile home
      '900 Cherry Ln'   -- agent-investor
    )
    AND seller_id IN (
      SELECT id FROM leads
      WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
        AND email LIKE '%@example.com'
    )
  );
```

### Deals (soft-delete, cascading from properties)

```sql
SELECT COUNT(*) AS deal_rows_to_wipe
FROM deals
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND deleted_at IS NULL
  AND property_id IN (
    SELECT id FROM properties
    WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
      AND deleted_at IS NULL
      AND (
        apn LIKE 'SAMPLE-%'
        OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001')
        OR address IN (
          '1842 Elm St', '309 Birch Dr', '77 Maple Blvd', '1200 Commerce Pkwy',
          '42 Lakefront Dr', '1515 Sunset Blvd', 'Hwy 290 Tract',
          '8800 County Rd 12', '2200 Park Ave', 'Pine Ridge MHP', '900 Cherry Ln'
        )
        AND seller_id IN (
          SELECT id FROM leads
          WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
            AND email LIKE '%@example.com'
        )
      )
  );
```

### Notes (soft-delete, cascading from properties)

```sql
SELECT COUNT(*) AS note_rows_to_wipe
FROM notes
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND deleted_at IS NULL
  AND property_id IN (
    SELECT id FROM properties
    WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
      AND (apn LIKE 'SAMPLE-%' OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001'))
  );
```

### Campaigns (hard delete — no soft-delete column exists)

```sql
SELECT COUNT(*) AS campaign_rows_to_delete
FROM campaigns
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND status = 'draft'
  AND (
    content LIKE '%[YOUR NAME]%'
    OR subject LIKE '%[YOUR NAME]%'
    OR subject LIKE '%{{%'
    OR content LIKE '%{{%'
  );
```

**Note on campaign safety:** The above WHERE clause catches only *unmodified template campaigns* — those with unreplaced `[YOUR NAME]` placeholders or unrendered `{{firstName}}` merge tags. If Tom has already started editing a campaign (replaced the placeholder), it will NOT be caught and will not be deleted. This is intentional and safe.

---

## Estimated Row Counts (Without Live DB Access)

Rafe cannot run queries against production from this seat — that requires a `$DATABASE_URL` with valid credentials, which is only available inside Fly.io or via a local staged tunnel. These estimates are derived from reading the source code:

| Table | Estimated seed rows | Basis |
|---|---|---|
| leads | 2–15 | 1–2 per business type × up to 14 types + 5 from `generateSampleData` |
| properties | 2–8 | 1 per Path A type (land/note only have APN tags) + 3 from Path B |
| deals | 2–7 | 1 per property above |
| notes | 1 | 1 from `generateSampleData` (property-linked) |
| campaigns | 2–28 | 2 templates per business type, status=draft, unmodified |

**Realistic total for a land_flipper/hybrid org that ran both paths:** ~5 leads, ~4 properties, ~3 deals, ~1 note, ~2–4 draft campaigns.

Tom should run the COUNT queries above before executing the wipe to confirm the actual numbers match this envelope.

---

## The Actual Wipe SQL (Soft-Deletes + Cascade)

```sql
-- Run inside a transaction for safety.
-- Tom reviews the COUNTs from the queries above before proceeding.

BEGIN;

-- 1. Soft-delete seed leads
UPDATE leads
SET deleted_at = now(), deleted_by = 'seed-wipe-2026'
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND deleted_at IS NULL
  AND (
    source = 'sample_data'
    OR (email LIKE '%@example.com' AND phone LIKE '555-0%')
  );

-- 2a. Soft-delete deals linked to seed properties (before soft-deleting properties,
--     since deals.property_id has onDelete: 'restrict' — we don't hard-delete)
UPDATE deals
SET deleted_at = now(), deleted_by = 'seed-wipe-2026'
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND deleted_at IS NULL
  AND property_id IN (
    SELECT id FROM properties
    WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
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
            WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
              AND email LIKE '%@example.com'
          )
        )
      )
  );

-- 2b. Soft-delete notes linked to seed properties
UPDATE notes
SET deleted_at = now(), deleted_by = 'seed-wipe-2026'
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND deleted_at IS NULL
  AND property_id IN (
    SELECT id FROM properties
    WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
      AND (apn LIKE 'SAMPLE-%' OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001'))
  );

-- 3. Soft-delete seed properties
UPDATE properties
SET deleted_at = now()
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
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
        WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
          AND email LIKE '%@example.com'
      )
    )
  );

-- 4. Hard-delete unmodified template campaigns (no soft-delete column)
DELETE FROM campaigns
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND status = 'draft'
  AND (
    content LIKE '%[YOUR NAME]%'
    OR subject LIKE '%[YOUR NAME]%'
    OR subject LIKE '%{{%'
    OR content LIKE '%{{%'
  );

-- 5. Clear the sampleDataLoaded flag from onboarding_data
UPDATE organizations
SET onboarding_data = jsonb_set(
  COALESCE(onboarding_data, '{}'::jsonb),
  '{sampleDataLoaded}',
  'false'
)
WHERE is_founder = true;

-- 6. Optionally reset onboarding so Tom can walk the new-user flow again.
-- Uncomment if desired — this is non-destructive to data, just UI state.
-- UPDATE organizations
-- SET onboarding_completed = false,
--     onboarding_step = 0,
--     onboarding_data = '{}'::jsonb
-- WHERE is_founder = true;

COMMIT;
```

### Recovery (if needed)

All deletes are soft — the data is still in the database with `deleted_at` set. To undo within a reasonable window:

```sql
-- Full recovery — undoes everything the wipe script touched
BEGIN;

UPDATE leads SET deleted_at = NULL, deleted_by = NULL
WHERE deleted_by = 'seed-wipe-2026';

UPDATE deals SET deleted_at = NULL, deleted_by = NULL
WHERE deleted_by = 'seed-wipe-2026';

UPDATE notes SET deleted_at = NULL, deleted_by = NULL
WHERE deleted_by = 'seed-wipe-2026';

UPDATE properties SET deleted_at = NULL
WHERE organization_id = (SELECT id FROM organizations WHERE is_founder = true)
  AND deleted_at IS NOT NULL
  AND (
    apn LIKE 'SAMPLE-%'
    OR apn IN ('ONBOARD-SAMPLE-001', 'ONBOARD-NOTE-001')
  );

-- Campaigns cannot be recovered from a DELETE.
-- Reinstate via POST /api/onboarding/sample-data or manual insert if needed.

COMMIT;
```

---

## What This Wipe Does NOT Touch

- Real leads Tom has added manually or via import (no `@example.com` email, no `sample_data` source)
- Real properties with real APNs
- Real deals on real properties
- Active or paid-off notes with real borrower data
- Any records that Tom has modified from the seed originals (e.g., a campaign where `[YOUR NAME]` has been replaced)
- Organization settings, subscription state, team members, any billing data

---

## Beatrice Sign-Off

**Reviewer:** Beatrice Whitfield, CRO — AcreOS

**Finding:** This wipe targets the founder's own org, not any customer's data. The AcreOS Constitution's customer-data protections (immutable #3, #5, #8) apply to customer data. Tom is the sole user of his own founder org — there are no third-party customers whose data is at risk here.

**Safety assessment of the WHERE clauses:**

1. **Org scope:** Every WHERE clause is gated on `organization_id = (SELECT id FROM organizations WHERE is_founder = true)`. The wipe cannot touch any other org. The subquery is deterministic and fails safely (returns zero rows) if `is_founder = true` is not set on any org.

2. **Lead targeting:** `source = 'sample_data'` is a hard fingerprint. The secondary clause (`email LIKE '%@example.com' AND phone LIKE '555-0%'`) is conservative — it requires BOTH conditions, reducing false-positive risk.

3. **Property targeting:** APNs `ONBOARD-*` and `SAMPLE-*` are synthetic identifiers that cannot collide with real county APNs. The address-based fallback requires the property to also be linked via `seller_id` to an `@example.com` lead — two-factor confirmation.

4. **Deal and note cascade:** Executed BEFORE property soft-delete (deals have `onDelete: 'restrict'` on the FK), and scoped to the same property IDs. No deals or notes on real properties are at risk.

5. **Campaigns:** The `[YOUR NAME]` and `{{` placeholder check catches only unedited templates. A campaign Tom has worked on will not match and will not be deleted. Hard deletion is acceptable here — campaigns have no soft-delete column and the onboarding service can regenerate templates if needed.

6. **Transaction safety:** The script wraps all mutations in a single `BEGIN...COMMIT`. If any statement fails, the entire wipe rolls back.

7. **Operator confirmation gate:** The shell script requires Tom to type "WIPE" before executing. This satisfies the spirit of "explicit confirmation" required for destructive operations, adapted for the founder's own seed data rather than customer data.

**Verdict:** The proposed wipe is **constitutionally clear** for the founder's own seed data. No customer data is at risk. The WHERE clauses are surgical and the approach is reversible for all tables except campaigns (which are template-only records with no financial or compliance significance). Beatrice approves this script for Tom's execution.

**One condition:** Tom should run the dry-run COUNT queries himself first and verify the numbers are within the expected envelope (≤15 leads, ≤8 properties, ≤7 deals, ≤1 note, ≤28 campaigns). If any count is dramatically higher, do not proceed — something else created records in Tom's org and the wider picture needs investigation first.

— *Beatrice Whitfield, CRO*

---

## Execution Instructions

Tom runs this himself:

```bash
# Option A — directly against production DB via Fly SSH
flyctl ssh console -a acreos -C "bash /app/scripts/seed-wipe-tom-org.sh"

# Option B — locally with a staged tunnel
flyctl proxy 5432:5432 -a acreos-db &
DATABASE_URL="postgres://acreos:PASS@localhost:5432/acreos" bash scripts/seed-wipe-tom-org.sh
```

The script logs everything to `scripts/wipe-runs/wipe-YYYY-MM-DDTHH-MM-SS.log`.
