/**
 * Storage driver smoke tests — Pillar 8.2 of the R2 cutover plan.
 *
 * We mostly assert wiring (driver selection by env var, R2 client gated
 * on env vars, dual-write composition). We do not hit the network; the
 * R2 client only constructs lazily when a method is called.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  _internal,
  _resetStorageForTests,
  getStorage,
  renderKey,
  type StoragePath,
} from "./storage";

const R2_ENV_KEYS = [
  "CMO_R2_ACCESS_KEY_ID",
  "CMO_R2_SECRET_ACCESS_KEY",
  "CMO_R2_BUCKET",
  "CMO_R2_ACCOUNT_ID",
  "CMO_STORAGE_DRIVER",
  "CMO_STORAGE_DUAL_WRITE",
  "CMO_STORAGE_ROOT",
] as const;

function snapshotEnv() {
  const before: Record<string, string | undefined> = {};
  for (const k of R2_ENV_KEYS) before[k] = process.env[k];
  return before;
}

function restoreEnv(before: Record<string, string | undefined>) {
  for (const k of R2_ENV_KEYS) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
}

describe("cmo/storage driver selection", () => {
  let envBefore: Record<string, string | undefined>;
  let tmpRoot: string;

  beforeEach(async () => {
    envBefore = snapshotEnv();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cmo-storage-"));
    process.env.CMO_STORAGE_ROOT = tmpRoot;
    _resetStorageForTests();
  });

  afterEach(async () => {
    restoreEnv(envBefore);
    _resetStorageForTests();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("defaults to LocalFsDriver when CMO_STORAGE_DRIVER is unset", () => {
    delete process.env.CMO_STORAGE_DRIVER;
    delete process.env.CMO_STORAGE_DUAL_WRITE;
    const d = getStorage();
    expect(d).toBeInstanceOf(_internal.LocalFsDriver);
  });

  it("LocalFsDriver round-trips write/read/exists/delete", async () => {
    const d = getStorage();
    const key = renderKey("test-render", "manifest.json");
    const payload = Buffer.from('{"ok":true}');

    const sp = await d.write(key, payload);
    expect(sp).toBe(`local:${key}`);
    expect(await d.exists(sp)).toBe(true);

    const round = await d.read(sp);
    expect(round.toString()).toBe('{"ok":true}');

    // Legacy callers hardcode `local:` prefix even after driver flips —
    // the unwrap should tolerate either scheme.
    expect(await d.exists(`local:${key}` as StoragePath)).toBe(true);

    await d.delete(sp);
    expect(await d.exists(sp)).toBe(false);
  });

  it("LocalFsDriver delete is idempotent on missing keys", async () => {
    const d = getStorage();
    await expect(d.delete(`local:renders/nope/x.mp4` as StoragePath)).resolves.toBeUndefined();
  });

  it("LocalFsDriver rejects path traversal", async () => {
    const d = getStorage();
    await expect(d.write("../escape.mp4", Buffer.from("x"))).rejects.toThrow(/invalid key/);
  });

  it("throws when CMO_STORAGE_DRIVER=r2 but R2 env vars are missing", () => {
    process.env.CMO_STORAGE_DRIVER = "r2";
    delete process.env.CMO_R2_ACCESS_KEY_ID;
    delete process.env.CMO_R2_SECRET_ACCESS_KEY;
    delete process.env.CMO_R2_BUCKET;
    delete process.env.CMO_R2_ACCOUNT_ID;
    expect(() => getStorage()).toThrow(/R2 env vars missing/);
  });

  it("constructs R2Driver only when all four R2 env vars are present", () => {
    process.env.CMO_STORAGE_DRIVER = "r2";
    process.env.CMO_R2_ACCESS_KEY_ID = "ak";
    process.env.CMO_R2_SECRET_ACCESS_KEY = "sk";
    process.env.CMO_R2_BUCKET = "acreos-cmo-test";
    process.env.CMO_R2_ACCOUNT_ID = "abc123";
    const d = getStorage();
    expect(d).toBeInstanceOf(_internal.R2Driver);
  });

  it("composes DualWriteDriver when CMO_STORAGE_DUAL_WRITE=true (local primary)", () => {
    process.env.CMO_STORAGE_DRIVER = "local";
    process.env.CMO_STORAGE_DUAL_WRITE = "true";
    process.env.CMO_R2_ACCESS_KEY_ID = "ak";
    process.env.CMO_R2_SECRET_ACCESS_KEY = "sk";
    process.env.CMO_R2_BUCKET = "acreos-cmo-test";
    process.env.CMO_R2_ACCOUNT_ID = "abc123";
    const d = getStorage();
    expect(d).toBeInstanceOf(_internal.DualWriteDriver);
  });

  it("composes DualWriteDriver when driver=r2 with dual-write (R2 primary)", () => {
    process.env.CMO_STORAGE_DRIVER = "r2";
    process.env.CMO_STORAGE_DUAL_WRITE = "true";
    process.env.CMO_R2_ACCESS_KEY_ID = "ak";
    process.env.CMO_R2_SECRET_ACCESS_KEY = "sk";
    process.env.CMO_R2_BUCKET = "acreos-cmo-test";
    process.env.CMO_R2_ACCOUNT_ID = "abc123";
    const d = getStorage();
    expect(d).toBeInstanceOf(_internal.DualWriteDriver);
  });

  it("readR2Config returns null if any required env var is missing", () => {
    delete process.env.CMO_R2_ACCESS_KEY_ID;
    process.env.CMO_R2_SECRET_ACCESS_KEY = "sk";
    process.env.CMO_R2_BUCKET = "b";
    process.env.CMO_R2_ACCOUNT_ID = "a";
    expect(_internal.readR2Config()).toBeNull();
  });

  it("readR2Config returns config when all env vars set", () => {
    process.env.CMO_R2_ACCESS_KEY_ID = "ak";
    process.env.CMO_R2_SECRET_ACCESS_KEY = "sk";
    process.env.CMO_R2_BUCKET = "bucket";
    process.env.CMO_R2_ACCOUNT_ID = "acct";
    const cfg = _internal.readR2Config();
    expect(cfg).toEqual({
      accessKeyId: "ak",
      secretAccessKey: "sk",
      bucket: "bucket",
      accountId: "acct",
    });
  });

  it("throws on unknown driver name", () => {
    process.env.CMO_STORAGE_DRIVER = "azure";
    expect(() => getStorage()).toThrow(/unknown driver/);
  });
});

describe("cmo/storage DualWriteDriver composition", () => {
  let tmpA: string;
  let tmpB: string;

  beforeEach(async () => {
    tmpA = await fs.mkdtemp(path.join(os.tmpdir(), "cmo-dual-a-"));
    tmpB = await fs.mkdtemp(path.join(os.tmpdir(), "cmo-dual-b-"));
  });

  afterEach(async () => {
    await fs.rm(tmpA, { recursive: true, force: true });
    await fs.rm(tmpB, { recursive: true, force: true });
  });

  it("write hits both backends and returns the primary scheme", async () => {
    const primary = new _internal.LocalFsDriver(tmpA);
    const secondary = new _internal.LocalFsDriver(tmpB);
    const dual = new _internal.DualWriteDriver(primary, secondary);

    const sp = await dual.write("renders/x/voice.mp3", Buffer.from("audio"));
    expect(sp).toBe("local:renders/x/voice.mp3");

    expect(await primary.exists(sp)).toBe(true);
    expect(await secondary.exists(sp)).toBe(true);
  });

  it("read prefers primary, falls back to secondary", async () => {
    const primary = new _internal.LocalFsDriver(tmpA);
    const secondary = new _internal.LocalFsDriver(tmpB);
    const dual = new _internal.DualWriteDriver(primary, secondary);

    // Only write to secondary (simulate backfill landed but primary missed it).
    await secondary.write("renders/x/voice.mp3", Buffer.from("from-secondary"));

    const got = await dual.read("local:renders/x/voice.mp3" as StoragePath);
    expect(got.toString()).toBe("from-secondary");
  });

  it("delete clears both backends (idempotent)", async () => {
    const primary = new _internal.LocalFsDriver(tmpA);
    const secondary = new _internal.LocalFsDriver(tmpB);
    const dual = new _internal.DualWriteDriver(primary, secondary);

    await dual.write("renders/x/voice.mp3", Buffer.from("audio"));
    await dual.delete("local:renders/x/voice.mp3" as StoragePath);

    expect(await primary.exists("local:renders/x/voice.mp3" as StoragePath)).toBe(false);
    expect(await secondary.exists("local:renders/x/voice.mp3" as StoragePath)).toBe(false);
  });
});
