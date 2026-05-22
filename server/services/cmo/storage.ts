/**
 * Storage abstraction for rendered MP4s + voice MP3s + manifest JSON.
 *
 * v1 uses local FS on the Fly worker machine (mounted at /data/cmo or
 * the equivalent persistent path). Files retrieved via `fly ssh sftp`
 * or via a server-side download route gated on isFounder.
 *
 * v2 swaps in Cloudflare R2 via the S3-compatible API. Selection is
 * via `CMO_STORAGE_DRIVER` env var ("local" — default; or "r2"). A
 * dual-write mode (`CMO_STORAGE_DUAL_WRITE=true`) writes every PUT to
 * both backends and reads R2-first with local fallback, so we can flip
 * the canonical store after the backfill without downtime.
 *
 * Callers never see absolute paths — they get StoragePath handles
 * ("local:cmo/renders/<id>/9x16.mp4" or "r2:acreos-cmo/...") and use
 * read/write/url helpers.
 *
 * StoragePath grammar: "{scheme}:{key}"
 *   scheme: 'local' | 'r2'
 *   key:    forward-slash-delimited path within the scheme's namespace
 */

import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../../utils/logger";

function storageRoot(): string {
  return process.env.CMO_STORAGE_ROOT ?? "/data/cmo";
}

export type StoragePath = `${"local" | "r2"}:${string}`;

export interface StorageDriver {
  write(key: string, data: Buffer | Uint8Array): Promise<StoragePath>;
  read(p: StoragePath): Promise<Buffer>;
  /** Returns a URL the founder UI can use to GET the asset. Local impl
   *  returns a server-relative /api/founder/cmo/asset/<key> path; R2 impl
   *  returns a signed URL. */
  url(p: StoragePath, opts?: { expiresInSec?: number }): Promise<string>;
  exists(p: StoragePath): Promise<boolean>;
  delete(p: StoragePath): Promise<void>;
}

/** Strip the scheme prefix off a StoragePath. Accepts either scheme so
 *  legacy callers that hardcode `local:` still work after a driver flip. */
function unwrapKey(p: StoragePath): string {
  const colon = p.indexOf(":");
  if (colon < 0) {
    throw new Error(`[cmo:storage] invalid StoragePath '${p}'`);
  }
  return p.slice(colon + 1);
}

function assertSafeKey(key: string): void {
  if (key.includes("..") || key.startsWith("/")) {
    throw new Error(`[cmo:storage] invalid key '${key}'`);
  }
}

class LocalFsDriver implements StorageDriver {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async write(key: string, data: Buffer | Uint8Array): Promise<StoragePath> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return `local:${key}` as StoragePath;
  }

  async read(p: StoragePath): Promise<Buffer> {
    return fs.readFile(this.resolve(unwrapKey(p)));
  }

  async url(p: StoragePath, _opts?: { expiresInSec?: number }): Promise<string> {
    const key = unwrapKey(p);
    return `/api/founder/cmo/asset?key=${encodeURIComponent(key)}`;
  }

  async exists(p: StoragePath): Promise<boolean> {
    try {
      await fs.access(this.resolve(unwrapKey(p)));
      return true;
    } catch {
      return false;
    }
  }

  async delete(p: StoragePath): Promise<void> {
    try {
      await fs.unlink(this.resolve(unwrapKey(p)));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
    }
  }
}

// ─── R2 driver (S3-compatible via @aws-sdk/client-s3) ────────────────────

interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  accountId: string;
}

function readR2Config(): R2Config | null {
  const accessKeyId = process.env.CMO_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CMO_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CMO_R2_BUCKET;
  const accountId = process.env.CMO_R2_ACCOUNT_ID;
  if (!accessKeyId || !secretAccessKey || !bucket || !accountId) return null;
  return { accessKeyId, secretAccessKey, bucket, accountId };
}

class R2Driver implements StorageDriver {
  private config: R2Config;
  // The S3 client + presigner are loaded lazily so the SDK is never
  // imported on local-only deployments (keeps cold-start light).
  private clientPromise:
    | Promise<{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cmds: any;
        getSignedUrl: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          client: any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          command: any,
          opts: { expiresIn: number },
        ) => Promise<string>;
      }>
    | null = null;

  constructor(config: R2Config) {
    this.config = config;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const s3 = await import("@aws-sdk/client-s3");
        const presigner = await import("@aws-sdk/s3-request-presigner");
        const client = new s3.S3Client({
          region: "auto",
          endpoint: `https://${this.config.accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
          },
        });
        return {
          client,
          cmds: {
            PutObjectCommand: s3.PutObjectCommand,
            GetObjectCommand: s3.GetObjectCommand,
            DeleteObjectCommand: s3.DeleteObjectCommand,
            HeadObjectCommand: s3.HeadObjectCommand,
            ListObjectsV2Command: s3.ListObjectsV2Command,
          },
          getSignedUrl: presigner.getSignedUrl,
        };
      })();
    }
    return this.clientPromise;
  }

  private contentTypeFor(key: string): string {
    const ext = path.extname(key).toLowerCase();
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".mp3") return "audio/mpeg";
    if (ext === ".json") return "application/json";
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    return "application/octet-stream";
  }

  async write(key: string, data: Buffer | Uint8Array): Promise<StoragePath> {
    assertSafeKey(key);
    const { client, cmds } = await this.getClient();
    await client.send(
      new cmds.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: Buffer.isBuffer(data) ? data : Buffer.from(data),
        ContentType: this.contentTypeFor(key),
      }),
    );
    return `r2:${key}` as StoragePath;
  }

  async read(p: StoragePath): Promise<Buffer> {
    const key = unwrapKey(p);
    assertSafeKey(key);
    const { client, cmds } = await this.getClient();
    const resp = await client.send(
      new cmds.GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    const body = resp.Body;
    if (!body) throw new Error(`[cmo:storage] R2 returned empty body for '${key}'`);
    // Body is a Readable stream in Node
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async url(p: StoragePath, opts?: { expiresInSec?: number }): Promise<string> {
    const key = unwrapKey(p);
    assertSafeKey(key);
    const { client, cmds, getSignedUrl } = await this.getClient();
    const ttl = opts?.expiresInSec ?? 300;
    return getSignedUrl(
      client,
      new cmds.GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: ttl },
    );
  }

  async exists(p: StoragePath): Promise<boolean> {
    const key = unwrapKey(p);
    assertSafeKey(key);
    const { client, cmds } = await this.getClient();
    try {
      await client.send(
        new cmds.HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      // 404 / NotFound — anything else bubbles.
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  async delete(p: StoragePath): Promise<void> {
    const key = unwrapKey(p);
    assertSafeKey(key);
    const { client, cmds } = await this.getClient();
    await client.send(
      new cmds.DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  /** Lists keys under a prefix. Exposed for backfill scripts and the
   *  founder asset-browser route; not part of the core StorageDriver
   *  interface (local FS doesn't need it). */
  async listObjects(prefix: string): Promise<string[]> {
    assertSafeKey(prefix);
    const { client, cmds } = await this.getClient();
    const out: string[] = [];
    let continuationToken: string | undefined;
    do {
      const resp = await client.send(
        new cmds.ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of resp.Contents ?? []) {
        if (obj.Key) out.push(obj.Key);
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }
}

/**
 * Dual-write composite: every write hits BOTH backends; reads come from
 * the primary (R2) first, falling back to the secondary (local). Used
 * during the local→R2 cutover so we can backfill + verify before
 * flipping the canonical store.
 *
 * The returned StoragePath uses the primary's scheme; if the primary
 * write fails the call throws (don't silently lose data).
 */
class DualWriteDriver implements StorageDriver {
  constructor(
    private primary: StorageDriver,
    private secondary: StorageDriver,
  ) {}

  async write(key: string, data: Buffer | Uint8Array): Promise<StoragePath> {
    const primaryPath = await this.primary.write(key, data);
    try {
      await this.secondary.write(key, data);
    } catch (err) {
      logger.warn(
        `[cmo:storage] dual-write secondary failed for '${key}' — primary write succeeded; secondary is now stale`,
        { metadata: { err: err instanceof Error ? err.message : String(err) } },
      );
    }
    return primaryPath;
  }

  async read(p: StoragePath): Promise<Buffer> {
    try {
      return await this.primary.read(p);
    } catch (primaryErr) {
      try {
        return await this.secondary.read(p);
      } catch {
        throw primaryErr;
      }
    }
  }

  async url(p: StoragePath, opts?: { expiresInSec?: number }): Promise<string> {
    try {
      return await this.primary.url(p, opts);
    } catch {
      return this.secondary.url(p, opts);
    }
  }

  async exists(p: StoragePath): Promise<boolean> {
    if (await this.primary.exists(p)) return true;
    return this.secondary.exists(p);
  }

  async delete(p: StoragePath): Promise<void> {
    // Delete from both — idempotent on miss.
    await Promise.allSettled([this.primary.delete(p), this.secondary.delete(p)]);
  }
}

let cachedDriver: StorageDriver | null = null;

/** Reset the cached driver — used by tests so env-var changes take effect. */
export function _resetStorageForTests(): void {
  cachedDriver = null;
}

export function getStorage(): StorageDriver {
  if (cachedDriver) return cachedDriver;

  const driverName = process.env.CMO_STORAGE_DRIVER ?? "local";
  const dualWrite = process.env.CMO_STORAGE_DUAL_WRITE === "true";

  const root = storageRoot();
  const buildLocal = () => new LocalFsDriver(root);
  const buildR2 = (): R2Driver => {
    const cfg = readR2Config();
    if (!cfg) {
      throw new Error(
        "[cmo:storage] CMO_STORAGE_DRIVER=r2 but R2 env vars missing " +
          "(need CMO_R2_ACCESS_KEY_ID, CMO_R2_SECRET_ACCESS_KEY, CMO_R2_BUCKET, CMO_R2_ACCOUNT_ID)",
      );
    }
    return new R2Driver(cfg);
  };

  if (driverName === "local") {
    if (dualWrite) {
      logger.info(`[cmo:storage] dual-write mode: primary=local(${root}), secondary=r2`);
      cachedDriver = new DualWriteDriver(buildLocal(), buildR2());
    } else {
      logger.info(`[cmo:storage] using local FS driver at ${root}`);
      cachedDriver = buildLocal();
    }
  } else if (driverName === "r2") {
    if (dualWrite) {
      logger.info(`[cmo:storage] dual-write mode: primary=r2, secondary=local(${root})`);
      cachedDriver = new DualWriteDriver(buildR2(), buildLocal());
    } else {
      logger.info(`[cmo:storage] using R2 driver (bucket=${process.env.CMO_R2_BUCKET})`);
      cachedDriver = buildR2();
    }
  } else {
    throw new Error(`[cmo:storage] unknown driver '${driverName}'`);
  }
  return cachedDriver;
}

/**
 * Composes a canonical key for a render. The shape is part of the public
 * contract so external tools (e.g. Meta's video upload, manifest scripts)
 * can predict where a file lives without round-tripping through the DB.
 *
 *   renders/<renderId>/<aspectRatio>.mp4
 *   renders/<renderId>/manifest.json
 *   renders/<renderId>/voice.mp3
 */
export function renderKey(renderId: string, filename: string): string {
  return `renders/${renderId}/${filename}`;
}

export function assetKey(provider: string, externalId: string, ext: string): string {
  return `assets/${provider}/${externalId}.${ext}`;
}

// Test-only exports — gated by the underscore convention.
export const _internal = {
  LocalFsDriver,
  R2Driver,
  DualWriteDriver,
  readR2Config,
};
