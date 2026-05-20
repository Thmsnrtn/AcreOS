/**
 * Storage abstraction for rendered MP4s + voice MP3s + manifest JSON.
 *
 * v1 uses local FS on the Fly worker machine (mounted at /data/cmo or
 * the equivalent persistent path). Files retrieved via `fly ssh sftp`
 * or via a server-side download route gated on isFounder.
 *
 * Designed so v2's R2 swap is a one-line config change, not a refactor.
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

const STORAGE_ROOT = process.env.CMO_STORAGE_ROOT ?? "/data/cmo";

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

class LocalFsDriver implements StorageDriver {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  private resolve(key: string): string {
    // Reject path traversal. The key must be a relative forward-slash path.
    if (key.includes("..") || key.startsWith("/")) {
      throw new Error(`[cmo:storage] invalid key '${key}'`);
    }
    return path.join(this.root, key);
  }

  async write(key: string, data: Buffer | Uint8Array): Promise<StoragePath> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return `local:${key}` as StoragePath;
  }

  async read(p: StoragePath): Promise<Buffer> {
    const key = this.unwrap(p);
    return fs.readFile(this.resolve(key));
  }

  async url(p: StoragePath, _opts?: { expiresInSec?: number }): Promise<string> {
    const key = this.unwrap(p);
    return `/api/founder/cmo/asset?key=${encodeURIComponent(key)}`;
  }

  async exists(p: StoragePath): Promise<boolean> {
    const key = this.unwrap(p);
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(p: StoragePath): Promise<void> {
    const key = this.unwrap(p);
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      // Idempotent: missing is fine.
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
    }
  }

  private unwrap(p: StoragePath): string {
    if (!p.startsWith("local:")) {
      throw new Error(`[cmo:storage] LocalFsDriver got non-local path '${p}'`);
    }
    return p.slice("local:".length);
  }
}

/**
 * Stub for R2/S3. Throws if invoked. v2 will land a real implementation
 * here and a single env-var flip switches the default driver. Keeps the
 * interface honest so callers don't accidentally use FS-specific behavior.
 */
class R2DriverStub implements StorageDriver {
  async write(): Promise<StoragePath> {
    throw new Error("[cmo:storage] R2 driver not implemented in v1 — set CMO_STORAGE_ROOT to use local FS");
  }
  async read(): Promise<Buffer> { throw new Error("not implemented"); }
  async url(): Promise<string> { throw new Error("not implemented"); }
  async exists(): Promise<boolean> { throw new Error("not implemented"); }
  async delete(): Promise<void> { throw new Error("not implemented"); }
}

let cachedDriver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cachedDriver) return cachedDriver;

  const driver = process.env.CMO_STORAGE_DRIVER ?? "local";
  if (driver === "local") {
    logger.info(`[cmo:storage] using local FS driver at ${STORAGE_ROOT}`);
    cachedDriver = new LocalFsDriver(STORAGE_ROOT);
  } else if (driver === "r2") {
    cachedDriver = new R2DriverStub();
  } else {
    throw new Error(`[cmo:storage] unknown driver '${driver}'`);
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
