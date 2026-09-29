/**
 * Founder ruling 2026-09-29 #1 — the S3 document store (DEFECT-0046).
 *
 * Tenancy lives in the object key: every object sits under `org/<orgId>/`, and
 * every read takes the caller's org and refuses a reference outside that
 * prefix. These tests drive the real module against a recording S3 double, so
 * a regression that dropped the prefix check, or signed a URL for another
 * org's object, goes red here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const s3 = vi.hoisted(() => ({
  sent: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  signed: [] as Array<{ input: Record<string, unknown>; expiresIn: number }>,
}));

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    kind = "put";
    constructor(public input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    kind = "get";
    constructor(public input: Record<string, unknown>) {}
  }
  class S3Client {
    async send(cmd: { kind: string; input: Record<string, unknown> }) {
      s3.sent.push({ kind: cmd.kind, input: cmd.input });
      if (cmd.kind === "get") return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      return {};
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_c: unknown, cmd: { input: Record<string, unknown> }, opts: { expiresIn: number }) => {
    s3.signed.push({ input: cmd.input, expiresIn: opts.expiresIn });
    return `https://signed.example/${String(cmd.input.Key)}`;
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  documentStoreConfigured,
  getOrgObject,
  putOrgObject,
  signedOrgObjectUrl,
} from "../../server/services/documentStore";
import { photoStorageAvailable, persistPhotoBytes } from "../../server/services/photoStorage";

const ENV_KEYS = ["DOCUMENTS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function configure() {
  process.env.DOCUMENTS_S3_BUCKET = "acre-docs";
  process.env.AWS_ACCESS_KEY_ID = "AKIA_TEST";
  process.env.AWS_SECRET_ACCESS_KEY = "secret";
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  s3.sent.length = 0;
  s3.signed.length = 0;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("dormant until configured", () => {
  it("needs the bucket AND both credentials", () => {
    expect(documentStoreConfigured()).toBe(false);
    expect(photoStorageAvailable()).toBe(false);
    configure();
    expect(documentStoreConfigured()).toBe(true);
    expect(photoStorageAvailable()).toBe(true);
    delete process.env.AWS_SECRET_ACCESS_KEY;
    expect(documentStoreConfigured()).toBe(false);
  });

  it("a write with storage unconfigured throws and sends nothing — no row can be recorded for dropped bytes", async () => {
    await expect(putOrgObject(7, "a.jpg", Buffer.from([1]))).rejects.toThrow(/not configured/);
    await expect(persistPhotoBytes(7, "a.jpg", Buffer.from([1]))).rejects.toThrow(/not configured/);
    expect(s3.sent).toEqual([]);
  });
});

describe("tenancy is in the key", () => {
  it("every object is written under org/<orgId>/ and the returned reference names it", async () => {
    configure();
    const ref = await persistPhotoBytes(7, "rehabs/r1/p1.jpg", Buffer.from([1, 2]), "image/jpeg");
    expect(ref).toBe("s3://acre-docs/org/7/rehabs/r1/p1.jpg");
    expect(s3.sent).toHaveLength(1);
    expect(s3.sent[0]).toMatchObject({
      kind: "put",
      input: { Bucket: "acre-docs", Key: "org/7/rehabs/r1/p1.jpg", ContentType: "image/jpeg", ServerSideEncryption: "AES256" },
    });
  });

  it("refuses traversal, absolute and empty keys, and a non-positive org — before anything is sent", async () => {
    configure();
    for (const bad of ["../8/x.jpg", "a/../../8/x", "/org/8/x", "", "./x", "a\\..\\b"]) {
      await expect(putOrgObject(7, bad, Buffer.from([1])), bad).rejects.toThrow(/invalid object key/);
    }
    await expect(putOrgObject(0, "x", Buffer.from([1]))).rejects.toThrow(/invalid organization/);
    await expect(putOrgObject(-1, "x", Buffer.from([1]))).rejects.toThrow(/invalid organization/);
    expect(s3.sent).toEqual([]);
    expect(await putOrgObject(7, "a/b.c", Buffer.from([1]))).toBe("s3://acre-docs/org/7/a/b.c");
  });

  it("an org cannot sign, or read, another org's object — whatever the row says", async () => {
    configure();
    const other = "s3://acre-docs/org/8/rehabs/r1/p1.jpg";
    await expect(signedOrgObjectUrl(7, other)).rejects.toThrow(/does not belong/);
    await expect(getOrgObject(7, other)).rejects.toThrow(/does not belong/);
    // A prefix that merely STARTS with the org id is not the org's prefix.
    await expect(signedOrgObjectUrl(7, "s3://acre-docs/org/70/x.jpg")).rejects.toThrow(/does not belong/);
    // Another bucket, or a legacy /uploads path, is not a reference into this store.
    await expect(signedOrgObjectUrl(7, "s3://elsewhere/org/7/x.jpg")).rejects.toThrow(/not a reference/);
    await expect(getOrgObject(7, "/uploads/field-scout/abc")).rejects.toThrow(/not a reference/);
    expect(s3.sent).toEqual([]);
    expect(s3.signed).toEqual([]);
  });

  it("the org's own object is signed short-lived and read back from its own key", async () => {
    configure();
    const ref = "s3://acre-docs/org/7/imports/3/0-deed.pdf";
    const url = await signedOrgObjectUrl(7, ref);
    expect(url).toBe("https://signed.example/org/7/imports/3/0-deed.pdf");
    expect(s3.signed[0]).toEqual({ input: { Bucket: "acre-docs", Key: "org/7/imports/3/0-deed.pdf" }, expiresIn: 300 });
    const bytes = await getOrgObject(7, ref);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(s3.sent[0]).toMatchObject({ kind: "get", input: { Key: "org/7/imports/3/0-deed.pdf" } });
  });
});
