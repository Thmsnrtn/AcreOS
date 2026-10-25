/**
 * The open-data bucket (any S3-compatible store; Cloudflare R2 recommended).
 *
 * Off unless all four OPEN_DATA_BUCKET_* keys are set (the founder creates the
 * bucket and keys — a vendor account is money, so it stays in founder hands).
 * An upload is not "done" when PUT returns: we HEAD the object and require the
 * bucket's own byte count to match before writing a receipt. Receipts are the
 * only evidence getCorporaStatus() accepts for "ingested".
 */

import { OPEN_DATA_BUCKET_ENV_KEYS } from "@shared/openData/corporaManifest";
import { bucketIdentity, type CorpusUploadReceipt } from "../openData/corporaStatus";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

// The DB is imported lazily so the showcase builder (a CLI that may run
// without DATABASE_URL) can use the upload path without opening a pool.

export interface BucketConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secret: string;
}

export function bucketConfigFromEnv(env: Record<string, string | undefined> = process.env): BucketConfig | null {
  const [endpoint, bucket, accessKeyId, secret] = OPEN_DATA_BUCKET_ENV_KEYS.map((k) => (env[k] ?? "").trim());
  if (!endpoint || !bucket || !accessKeyId || !secret) return null;
  return { endpoint, bucket, accessKeyId, secret };
}

export interface UploadReceipt extends CorpusUploadReceipt {
  etag: string | null;
  uploadedAt: Date;
}

/** Minimal client surface — injectable so the confirm-before-receipt rule is testable. */
export interface ObjectStoreClient {
  /** bucketIdentity() of the bucket this client writes to — named on every receipt. */
  bucket: string;
  put(key: string, body: Buffer, contentType: string): Promise<{ etag: string | null }>;
  /** Stream a file (bulk artifacts are too large to buffer); `bytes` is its size. */
  putFile?(key: string, filePath: string, bytes: number, contentType: string): Promise<{ etag: string | null }>;
  headBytes(key: string): Promise<number | null>;
  /** Stream an object down to a local file (D2c lineage reads release artifacts back); resolves to its byte count. */
  getFile?(key: string, destPath: string): Promise<number>;
}

export async function s3ClientFor(cfg: BucketConfig): Promise<ObjectStoreClient> {
  const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secret },
  });
  return {
    bucket: bucketIdentity(cfg.endpoint, cfg.bucket),
    async put(key, body, contentType) {
      const r = await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
      return { etag: r.ETag ?? null };
    },
    async putFile(key, filePath, bytes, contentType) {
      const { createReadStream } = await import("node:fs");
      const r = await s3.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: createReadStream(filePath), ContentLength: bytes, ContentType: contentType }),
      );
      return { etag: r.ETag ?? null };
    },
    async getFile(key, destPath) {
      const r = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      if (!r.Body) throw new Error(`bucket returned no body for ${key}`);
      const { createWriteStream, statSync } = await import("node:fs");
      const { pipeline } = await import("node:stream/promises");
      await pipeline(r.Body as NodeJS.ReadableStream, createWriteStream(destPath));
      return statSync(destPath).size;
    },
    async headBytes(key) {
      try {
        const r = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return typeof r.ContentLength === "number" ? r.ContentLength : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * The bulk-artifact upload (D2a): streams the file, then requires the bucket's
 * HEAD byte count to equal the built artifact's. `artifact` carries the size
 * and SHA-256 measured when it was built; the file is re-measured first so a
 * file changed after build is refused rather than receipted under the old digest.
 */
export async function uploadFileAndConfirm(
  client: ObjectStoreClient,
  corpusKey: string,
  objectKey: string,
  artifact: { localPath: string; bytes: number; sha256: string; contentType: string },
): Promise<UploadReceipt> {
  if (!client.putFile) throw new Error("this object store cannot stream files — refusing to buffer a bulk artifact");
  if (artifact.bytes === 0) throw new Error(`refusing to upload an empty object: ${objectKey}`);
  const { fileDigest } = await import("./streamingArtifacts");
  const now = await fileDigest(artifact.localPath);
  if (now.bytes !== artifact.bytes || now.sha256 !== artifact.sha256) {
    throw new Error(`${artifact.localPath} changed after it was built (${now.bytes} bytes, ${now.sha256}) — not uploaded`);
  }
  const { etag } = await client.putFile(objectKey, artifact.localPath, artifact.bytes, artifact.contentType);
  const landed = await client.headBytes(objectKey);
  if (landed !== artifact.bytes) {
    throw new Error(`bucket reports ${landed ?? "no"} bytes for ${objectKey}, expected ${artifact.bytes} — not ingested`);
  }
  return { corpusKey, objectKey, bytes: artifact.bytes, sha256: artifact.sha256, bucket: client.bucket, etag, uploadedAt: clock.now() };
}

/**
 * Record a confirmed upload on its county's coverage row (owned_artifacts):
 * the county's artifacts and their receipts live with the county.
 */
export async function recordReceipt(state: string, county: string, r: UploadReceipt): Promise<void> {
  const { db } = await import("../../db");
  const { countyDiscoveryQueue } = await import("@shared/schema");
  const { and, eq } = await import("drizzle-orm");
  const where = and(eq(countyDiscoveryQueue.state, state.toUpperCase()), eq(countyDiscoveryQueue.county, county.toLowerCase().replace(/ county$/i, "").trim()));
  const [row] = await db.select({ artifacts: countyDiscoveryQueue.ownedArtifacts }).from(countyDiscoveryQueue).where(where).limit(1);
  if (!row) throw new Error(`no coverage row for ${county}, ${state} — request the county before recording its artifacts`);
  const entry = { corpusKey: r.corpusKey, objectKey: r.objectKey, bytes: r.bytes, sha256: r.sha256, bucket: r.bucket, etag: r.etag, uploadedAt: r.uploadedAt.toISOString() };
  const kept = (row.artifacts ?? []).filter((a) => !(a.objectKey === r.objectKey && a.sha256 === r.sha256));
  await db.update(countyDiscoveryQueue).set({ ownedArtifacts: [...kept, entry] }).where(where);
}

/** Receipts for getCorporaStatus(); an unreadable table degrades to "none". */
export async function loadIngestReceipts(): Promise<CorpusUploadReceipt[]> {
  try {
    const { db } = await import("../../db");
    const { countyDiscoveryQueue } = await import("@shared/schema");
    const { isNotNull } = await import("drizzle-orm");
    const rows = await db
      .select({ artifacts: countyDiscoveryQueue.ownedArtifacts })
      .from(countyDiscoveryQueue)
      .where(isNotNull(countyDiscoveryQueue.ownedArtifacts));
    return rows.flatMap((r) => (r.artifacts ?? []).map((a) => ({ corpusKey: a.corpusKey, objectKey: a.objectKey, bytes: a.bytes, sha256: a.sha256, bucket: a.bucket ?? "" })));
  } catch (err) {
    logger.warn("[openDataBucket] receipts unreadable — reporting none", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return [];
  }
}
