/**
 * Pillar G — useNativeFilesystem hook.
 *
 * Bridges the @capacitor/filesystem plugin (in deps + capacitor.config.ts
 * but previously unused in client code) so field-scout photos, offline
 * report exports, and large-blob caches can persist outside the
 * localStorage 5MB quota.
 *
 * Falls back to a no-op stub on web so callers don't have to branch.
 *
 *   const fs = useNativeFilesystem();
 *   await fs.writeFile("scout/photo-123.jpg", base64, { directory: "data" });
 *   const back = await fs.readFile("scout/photo-123.jpg");
 *   await fs.deleteFile("scout/photo-123.jpg");
 *   const files = await fs.listDirectory("scout");
 */

import { useCallback, useMemo } from "react";

// We type the plugin loosely because the plugin module is loaded lazily
// at the first call to keep the bundle web-only-friendly.
type FilesystemDirectory = "data" | "documents" | "cache" | "external" | "external_storage";

interface WriteOptions {
  directory?: FilesystemDirectory;
  recursive?: boolean;
}

interface FsApi {
  isNative: boolean;
  writeFile: (path: string, base64Data: string, opts?: WriteOptions) => Promise<{ uri: string } | null>;
  readFile: (path: string, opts?: WriteOptions) => Promise<string | null>;
  deleteFile: (path: string, opts?: WriteOptions) => Promise<boolean>;
  listDirectory: (path: string, opts?: WriteOptions) => Promise<string[]>;
  estimateUsage: () => Promise<{ usedBytes: number; quotaBytes: number | null }>;
}

const isCapacitorAvailable = (): boolean => {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
};

export function useNativeFilesystem(): FsApi {
  const isNative = useMemo(() => isCapacitorAvailable(), []);

  const writeFile = useCallback<FsApi["writeFile"]>(
    async (path, base64Data, opts = {}) => {
      if (!isNative) return null;
      try {
        const { Filesystem, Directory } = (await import("@capacitor/filesystem")) as unknown as {
          Filesystem: { writeFile: (input: unknown) => Promise<{ uri: string }> };
          Directory: Record<string, string>;
        };
        const directory = (Directory as Record<string, string>)[(opts.directory ?? "data").toUpperCase()] ?? Directory.Data;
        const result = await Filesystem.writeFile({
          path,
          data: base64Data,
          directory,
          recursive: opts.recursive ?? true,
        });
        return { uri: result.uri };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useNativeFilesystem] writeFile failed", err);
        return null;
      }
    },
    [isNative],
  );

  const readFile = useCallback<FsApi["readFile"]>(
    async (path, opts = {}) => {
      if (!isNative) return null;
      try {
        const { Filesystem, Directory } = (await import("@capacitor/filesystem")) as unknown as {
          Filesystem: { readFile: (input: unknown) => Promise<{ data: string }> };
          Directory: Record<string, string>;
        };
        const directory = (Directory as Record<string, string>)[(opts.directory ?? "data").toUpperCase()] ?? Directory.Data;
        const result = await Filesystem.readFile({ path, directory });
        return result.data ?? null;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useNativeFilesystem] readFile failed", err);
        return null;
      }
    },
    [isNative],
  );

  const deleteFile = useCallback<FsApi["deleteFile"]>(
    async (path, opts = {}) => {
      if (!isNative) return false;
      try {
        const { Filesystem, Directory } = (await import("@capacitor/filesystem")) as unknown as {
          Filesystem: { deleteFile: (input: unknown) => Promise<void> };
          Directory: Record<string, string>;
        };
        const directory = (Directory as Record<string, string>)[(opts.directory ?? "data").toUpperCase()] ?? Directory.Data;
        await Filesystem.deleteFile({ path, directory });
        return true;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useNativeFilesystem] deleteFile failed", err);
        return false;
      }
    },
    [isNative],
  );

  const listDirectory = useCallback<FsApi["listDirectory"]>(
    async (path, opts = {}) => {
      if (!isNative) return [];
      try {
        const { Filesystem, Directory } = (await import("@capacitor/filesystem")) as unknown as {
          Filesystem: { readdir: (input: unknown) => Promise<{ files: Array<{ name: string }> }> };
          Directory: Record<string, string>;
        };
        const directory = (Directory as Record<string, string>)[(opts.directory ?? "data").toUpperCase()] ?? Directory.Data;
        const result = await Filesystem.readdir({ path, directory });
        return (result.files ?? []).map((f) => f.name);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useNativeFilesystem] listDirectory failed", err);
        return [];
      }
    },
    [isNative],
  );

  const estimateUsage = useCallback<FsApi["estimateUsage"]>(async () => {
    // Capacitor doesn't expose quota directly. Use the Web Storage API
    // if available; on iOS/Android the quota is effectively the device's
    // remaining space.
    const nav = typeof navigator !== "undefined"
      ? (navigator as Navigator & { storage?: { estimate?: () => Promise<StorageEstimate> } })
      : null;
    if (nav?.storage?.estimate) {
      try {
        const est = await nav.storage.estimate();
        return { usedBytes: est.usage ?? 0, quotaBytes: est.quota ?? null };
      } catch {
        return { usedBytes: 0, quotaBytes: null };
      }
    }
    return { usedBytes: 0, quotaBytes: null };
  }, []);

  return { isNative, writeFile, readFile, deleteFile, listDirectory, estimateUsage };
}
