/**
 * Legal-run Leg 6.4 — deleteAllOrgObjects() removes every object under the
 * org's S3 prefix, across pages, never touches a key outside the prefix, and
 * throws (rather than reporting success) when S3 reports per-object errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
  pages: [] as Array<{ Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string }>,
  listCalls: [] as any[],
  deleteCalls: [] as any[],
  deleteErrors: [] as Array<{ Key: string; Code: string }>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@aws-sdk/client-s3", () => {
  class ListObjectsV2Command { constructor(public input: any) {} }
  class DeleteObjectsCommand { constructor(public input: any) {} }
  class S3Client {
    async send(cmd: any) {
      if (cmd instanceof ListObjectsV2Command) {
        s3.listCalls.push(cmd.input);
        return s3.pages.shift() ?? { Contents: [] };
      }
      if (cmd instanceof DeleteObjectsCommand) {
        s3.deleteCalls.push(cmd.input);
        return { Errors: s3.deleteErrors };
      }
      throw new Error("unexpected command");
    }
  }
  return { S3Client, ListObjectsV2Command, DeleteObjectsCommand };
});

import { deleteAllOrgObjects } from "../../server/services/documentStore";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.DOCUMENTS_S3_BUCKET = "bkt";
  process.env.AWS_ACCESS_KEY_ID = "x";
  process.env.AWS_SECRET_ACCESS_KEY = "y";
  s3.pages = [];
  s3.listCalls = [];
  s3.deleteCalls = [];
  s3.deleteErrors = [];
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("deleteAllOrgObjects", () => {
  it("lists under exactly org/<id>/ and deletes every page", async () => {
    s3.pages = [
      { Contents: [{ Key: "org/7/a.pdf" }, { Key: "org/7/photos/b.jpg" }], IsTruncated: true, NextContinuationToken: "t1" },
      { Contents: [{ Key: "org/7/c.csv" }], IsTruncated: false },
    ];
    const out = await deleteAllOrgObjects(7);
    expect(out.objectsDeleted).toBe(3);
    expect(s3.listCalls.map((c) => c.Prefix)).toEqual(["org/7/", "org/7/"]);
    expect(s3.listCalls[1].ContinuationToken).toBe("t1");
    expect(s3.deleteCalls.flatMap((c) => c.Delete.Objects.map((o: any) => o.Key))).toEqual([
      "org/7/a.pdf",
      "org/7/photos/b.jpg",
      "org/7/c.csv",
    ]);
  });

  it("never deletes a key outside the org prefix (org/70/ is not org/7/)", async () => {
    s3.pages = [{ Contents: [{ Key: "org/7/a" }, { Key: "org/70/b" }, { Key: "org/8/c" }] }];
    await deleteAllOrgObjects(7);
    const keys = s3.deleteCalls.flatMap((c) => c.Delete.Objects.map((o: any) => o.Key));
    expect(keys).toEqual(["org/7/a"]);
  });

  it("throws when S3 reports any object it could not delete", async () => {
    s3.pages = [{ Contents: [{ Key: "org/7/a" }] }];
    s3.deleteErrors = [{ Key: "org/7/a", Code: "AccessDenied" }];
    await expect(deleteAllOrgObjects(7)).rejects.toThrow(/could not be deleted/);
  });

  it("refuses an invalid org id and an unconfigured store", async () => {
    await expect(deleteAllOrgObjects(0)).rejects.toThrow(/invalid organization id/);
    delete process.env.DOCUMENTS_S3_BUCKET;
    await expect(deleteAllOrgObjects(7)).rejects.toThrow(/not configured/);
  });
});
