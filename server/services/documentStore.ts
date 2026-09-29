/**
 * Customer file bytes — documents, photos, imports (founder ruling 2026-09-29
 * #1: AWS S3; DEFECT-0046, DEFECT-0143, DEFECT-0164).
 *
 * Before this there was no blob store: uploads were accepted into memory and
 * the bytes dropped (photos), or written to one machine's /tmp and lost on the
 * next deploy (document imports). The routes were made to REFUSE instead of
 * pretending; this is the store that lets them keep the file.
 *
 * TENANCY IS IN THE KEY. Every object lives under `org/<orgId>/…`, the stored
 * reference is `s3://<bucket>/org/<orgId>/…`, and every read or delete takes
 * the caller's org and refuses a reference outside that org's prefix. A row
 * that was ever mis-attributed cannot hand one tenant a signed URL to
 * another's file, whatever the row says.
 *
 * DORMANT UNTIL CONFIGURED. `documentStoreConfigured()` is false until
 * DOCUMENTS_S3_BUCKET and AWS credentials exist (🔑 founder provisions; the
 * same AWS account already serves backups and SES). Callers check it first
 * and refuse honestly; `putOrgObject` throws if called anyway, so nothing can
 * record a row for bytes it did not keep.
 */
import { logger } from "../utils/logger";

export type StoredObjectRef = `s3://${string}`;

export function documentStoreConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.DOCUMENTS_S3_BUCKET && !!env.AWS_ACCESS_KEY_ID && !!env.AWS_SECRET_ACCESS_KEY;
}

function bucket(): string {
  const b = process.env.DOCUMENTS_S3_BUCKET;
  if (!b || !documentStoreConfigured()) {
    throw new Error("Document storage is not configured (DOCUMENTS_S3_BUCKET and AWS credentials)");
  }
  return b;
}

/** A relative key inside the org's namespace; no traversal, no absolute paths. */
function orgObjectKey(organizationId: number, key: string): string {
  if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error(`invalid organization id ${organizationId}`);
  const clean = key.replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || clean.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error(`invalid object key '${key}'`);
  }
  return `org/${organizationId}/${clean}`;
}

/** The object key a reference names — only if it lies inside this org's prefix. */
function keyForOrg(organizationId: number, ref: string): string {
  const prefix = `s3://${bucket()}/`;
  if (!ref.startsWith(prefix)) throw new Error("not a reference into this document store");
  const key = ref.slice(prefix.length);
  if (!key.startsWith(`org/${organizationId}/`)) throw new Error("reference does not belong to this organization");
  return key;
}

async function s3() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
}

/** Write bytes into the org's namespace. Returns the reference to store on the row. */
export async function putOrgObject(
  organizationId: number,
  key: string,
  bytes: Buffer | Uint8Array,
  contentType?: string,
): Promise<StoredObjectRef> {
  const Bucket = bucket();
  const Key = orgObjectKey(organizationId, key);
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3();
  await client.send(
    new PutObjectCommand({
      Bucket,
      Key,
      Body: bytes,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }),
  );
  logger.info("[documentStore] stored object", { organizationId, key: Key, bytes: bytes.length });
  return `s3://${Bucket}/${Key}`;
}

/** A short-lived signed GET URL — only for a reference inside the org's prefix. */
export async function signedOrgObjectUrl(organizationId: number, ref: string, expiresInSec = 300): Promise<string> {
  const Key = keyForOrg(organizationId, ref);
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  return getSignedUrl(await s3(), new GetObjectCommand({ Bucket: bucket(), Key }), { expiresIn: expiresInSec });
}

/** Read an object's bytes — only for a reference inside the org's prefix. */
export async function getOrgObject(organizationId: number, ref: string): Promise<Buffer> {
  const Key = keyForOrg(organizationId, ref);
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const out = await (await s3()).send(new GetObjectCommand({ Bucket: bucket(), Key }));
  const body = out.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
  if (!body) throw new Error("empty object body");
  return Buffer.from(await body.transformToByteArray());
}
