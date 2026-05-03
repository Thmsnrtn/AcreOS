# Blob Storage Audit — AcreOS

Date: 2026-05-03
Owner: Cost / Infra
Status: Recommendation — no migration executed yet

## Goal

Identify any binary blobs (PDFs, images, audio, large JSON dumps) that
are persisted into Postgres directly. Where present, recommend a path
to S3-compatible object storage with signed URLs to keep the operational
DB small (cheaper backups, faster pg_dump, less I/O on the primary).

## Method

1. `grep -n "bytea\|customType\|file_bytes\|file_data\|raw_bytes" shared/schema.ts migrations/*.sql`
2. `grep -n "pdfBase64\|imageData\|fileContent\|attachment_data" shared/schema.ts`
3. `grep -n "imageUrl\|fileUrl\|s3Url\|storageKey\|signedUrl" shared/schema.ts`
4. Manual review of large jsonb columns whose payloads include
   base64-encoded artefacts.

## Findings

### Postgres `bytea` columns
**None.** No `bytea` columns exist in the schema or in any migration.

### `text`/`jsonb` columns that smuggle binary content

| Table | Column | Type | Notes |
|---|---|---|---|
| `form_1099_batches` | `result_blob` | `jsonb` | Contains a `fireFile` text field (the IRS FIRE filing — usually < 100 KB), plus per-form metadata. Per-form PDF buffers are *not* persisted here in the current code path (the route synthesizes them from metadata). Acceptable as-is for now. |

The original `form1099Batch.ts` interface defines a `recipientPdfs`
array with base64 PDFs, but the persistence path stores only metadata
(`forms`, `fireFile`, `summary`) — see `server/services/form1099Batch.ts`
lines 86–105. No PDF bytes are written to DB.

### URL-only references (already external)

| Table | Column | Provider |
|---|---|---|
| `satellite_snapshots` | `image_url` | Google / Mapbox / Sentinel — already URLs |
| `properties` photos | (jsonb arrays of URLs) | external |
| `attachments` (notes / messages) | URL strings | external |

### S3-compatible client surface

`@aws-sdk/client-ses` is wired for email (server/services/emailService.ts).
There is **no** `@aws-sdk/client-s3` dependency yet. R2 / S3 bucket
configuration is not present in `fly.toml` secrets template.

## Risk Assessment

The DB is **clean** of large blobs today. The cost savings from a blob
migration would be marginal (< 5% of pg storage based on estimating
`form_1099_batches.result_blob`).

The real risk is *future* drift:

- A well-meaning addition that base64-encodes a generated PDF into a
  `result_blob` jsonb column "for convenience"
- A photo-upload feature that writes raw bytes into a new column instead
  of uploading to a bucket and storing the URL
- Embedding caches that grow unbounded in jsonb

## Recommendation (do NOT execute yet)

1. **Add a guardrail eslint rule** that flags `bytea`, `customType`
   declarations whose serialization is `Buffer`, and any `jsonb`
   column whose `$type` includes `Base64` / `Buffer` in its name.
   Owner: platform.
2. **Pre-provision an R2 bucket** (`acreos-blobs-prod`) and add
   `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` to
   `fly-secrets.example`. No code changes — just the secret skeleton.
3. **When the first real blob need lands** (e.g. founder voice memos,
   photo-upload v2, persistent 1099 PDFs):
   - Install `@aws-sdk/client-s3` (R2 is S3-compatible).
   - Add `server/services/blobStorage.ts` with `putBlob` /
     `getSignedUrl` helpers.
   - Store only `{ bucket, key, contentType, sizeBytes, sha256 }` in
     Postgres. Never persist the bytes.
4. **Worker as the upload boundary.** PDF render jobs in the
   `worker` process group already write base64 to `outbox.payload`
   today (see `server/worker.ts` `handlePdfRender`). When the bucket
   exists, change the worker to upload the buffer to R2 and write the
   resulting `bucket/key` back to outbox instead — no client-facing
   change, but `outbox` rows shrink from ~MB to ~bytes.

## Open questions

- Do we want CDN signing in front of R2 (Cloudflare R2 + Workers) or
  direct presigned URLs? CDN signing is preferred for any content
  served to >10 viewers; presigned for one-off downloads.
- Retention policy on bucket objects — match Postgres TTL (7 yr for
  1099 forms, 30 d for transient PDFs).

## Acceptance for this audit

- [x] No raw `bytea` in schema or migrations
- [x] No production code path writes PDF / image bytes into Postgres
- [x] Migration plan documented
- [ ] Guardrail eslint rule (deferred — not required by this wave)
- [ ] R2 bucket provisioned (deferred — not required by this wave)
