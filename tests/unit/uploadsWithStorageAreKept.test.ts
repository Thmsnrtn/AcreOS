/**
 * Founder ruling 2026-09-29 #1 (AWS S3) — with the document store configured,
 * the two photo routes that DEFECT-0164 made refuse now KEEP the bytes, and
 * record the store reference rather than a path nothing serves.
 *
 * The sibling `uploadsWithoutStorageAreRefused.test.ts` pins the unconfigured
 * side (503, no row). This file drives the real `photoStorage` and
 * `documentStore` modules against a recording S3 double, so the org prefix,
 * the write-before-row order and the signed-URL tenancy are exercised end to
 * end through the routes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";

const h = vi.hoisted(() => ({
  order: [] as string[],
  puts: [] as Array<Record<string, unknown>>,
  rehabRows: [] as Array<Record<string, unknown>>,
  createFieldScoutPhoto: vi.fn(async (v: Record<string, unknown>) => {
    h.order.push("row");
    return { id: 99, ...v };
  }),
  findFieldScoutPhotoByHash: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
  createFieldScoutVisit: vi.fn(async (v: Record<string, unknown>) => ({ id: 3, ...v })),
  visitPhotos: [] as Array<Record<string, unknown>>,
  files: [] as Array<Record<string, unknown>>,
  /** 1-based index of the S3 put that fails; 0 = none. */
  failPutAt: 0,
  pipelineFails: false,
  rowSeq: 0,
}));

const FILE = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: "image/jpeg", originalname: "a.jpg", size: 3 };

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
      if (cmd.kind === "put") {
        if (h.failPutAt && h.puts.length + 1 === h.failPutAt) throw new Error("S3 unavailable");
        h.order.push("put");
        h.puts.push(cmd.input);
      }
      return {};
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_c: unknown, cmd: { input: { Key: string } }) => `https://signed.example/${cmd.input.Key}`,
}));
vi.mock("../../server/middleware/fileUploadSecurity", () => {
  const withFiles = (_req: unknown, _res: unknown, next: () => void) => {
    // multer populates req.body with the multipart text fields.
    (_req as { files: unknown[]; body: unknown }).files = h.files;
    (_req as { body: unknown }).body ??= {};
    next();
  };
  return {
    createUploadMiddleware: () => ({ array: () => withFiles, single: () => withFiles }),
    validateFileMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown }, _s: unknown, n: () => void) => {
    req.user = { id: "u1" };
    n();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    n();
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => Object.assign(Promise.resolve([{ id: "r1" }]), { orderBy: async () => h.rehabRows });
    return q;
  };
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          h.order.push(`insert:${String(v.s3Key)}`);
          return [{ id: `p${++h.rowSeq}`, ...v }];
        },
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            h.order.push(`update:${String(s.s3Key)}`);
            return [{ id: `p${h.rowSeq}`, ...s }];
          },
        }),
      }),
    }),
  };
  return { db: { select, transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } };
});
vi.mock("../../server/storage", () => ({
  db: {},
  storage: {
    getLead: async () => ({ id: 5 }),
    getProperty: async () => null,
    createFieldScoutPhoto: h.createFieldScoutPhoto,
    findFieldScoutPhotoByHash: h.findFieldScoutPhotoByHash,
    createFieldScoutVisit: h.createFieldScoutVisit,
    getFieldScoutVisits: async () => [{ id: 3, leadId: null, propertyId: null }],
    countFieldScoutVisits: async () => 1,
    getFieldScoutPhotosByVisit: async () => h.visitPhotos,
  },
}));
vi.mock("../../server/services/imagePipeline", () => ({
  processUploadedImage: async () => {
    if (h.pipelineFails) throw new Error("sharp: unsupported image format");
    return { hash: "abc", stripped: Buffer.from([1]), variants: {} };
  },
}));

import { registerRehabPhotoRoutes } from "../../server/routes-rehab-photos";
import fieldScoutRouter from "../../server/routes-field-scout";

const app = express();
app.use(express.json());
registerRehabPhotoRoutes(app);
app.use("/api", (req, _res, next) => {
  (req as unknown as { organization: unknown; user: unknown }).organization = { id: 7 };
  (req as unknown as { user: unknown }).user = { id: "u1" };
  next();
}, fieldScoutRouter);

const ENV_KEYS = ["DOCUMENTS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.DOCUMENTS_S3_BUCKET = "acre-docs";
  process.env.AWS_ACCESS_KEY_ID = "AKIA_TEST";
  process.env.AWS_SECRET_ACCESS_KEY = "secret";
  h.order.length = 0;
  h.puts.length = 0;
  h.rehabRows = [];
  h.visitPhotos = [];
  h.files = [FILE];
  h.failPutAt = 0;
  h.pipelineFails = false;
  h.rowSeq = 0;
  h.createFieldScoutPhoto.mockClear();
  h.createFieldScoutVisit.mockClear();
  h.findFieldScoutPhotoByHash.mockReset();
  h.findFieldScoutPhotoByHash.mockResolvedValue(null);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("rehab photos with the store configured", () => {
  it("writes the bytes under the org's prefix BEFORE the row names them, and records the s3:// reference", async () => {
    const res = await request(app).post("/api/rehabs/r1/photos");
    expect(res.status).toBe(201);
    expect(h.puts).toHaveLength(1);
    expect(h.puts[0]).toMatchObject({ Bucket: "acre-docs", Key: "org/7/rehabs/r1/p1.jpg", Body: FILE.buffer });
    const ref = "s3://acre-docs/org/7/rehabs/r1/p1.jpg";
    expect(h.order).toEqual(["insert:pending", "put", `update:${ref}`]);
    expect(res.body.photos[0].s3Key).toBe(ref);
  });

  it("the list signs this org's stored photos and gives nothing for a row with no file or another org's reference", async () => {
    h.rehabRows = [
      { id: "a", tag: "before", s3Key: "s3://acre-docs/org/7/rehabs/r1/a.jpg" },
      { id: "b", tag: "before", s3Key: "rehabs/r1/b.jpg" }, // pre-storage record: bytes never kept
      { id: "c", tag: "after", s3Key: "s3://acre-docs/org/8/rehabs/r9/c.jpg" }, // mis-attributed row
    ];
    const res = await request(app).get("/api/rehabs/r1/photos");
    expect(res.status).toBe(200);
    expect(res.body.storageAvailable).toBe(true);
    const all = [...res.body.groups.before, ...res.body.groups.after] as Array<{ id: string; imageUrl: string | null }>;
    const url = Object.fromEntries(all.map((p) => [p.id, p.imageUrl]));
    expect(url).toEqual({
      a: "https://signed.example/org/7/rehabs/r1/a.jpg",
      b: null,
      c: null,
    });
  });
});

describe("DriveMode field photos with the store configured", () => {
  it("stores the processed image under the org's prefix and records the reference, not an /uploads path", async () => {
    const res = await request(app).post("/api/leads/5/photos");
    expect(res.status).toBe(200);
    expect(h.puts[0]).toMatchObject({ Key: "org/7/field-scout/abc" });
    expect(h.order).toEqual(["put", "row"]); // bytes first, then the row that names them
    const row = h.createFieldScoutPhoto.mock.calls[0][0];
    expect(row.url).toBe("s3://acre-docs/org/7/field-scout/abc");
    expect([row.thumbnailUrl, row.cardUrl, row.fullUrl]).toEqual([null, null, null]);
    expect(JSON.stringify(row)).not.toMatch(/\/uploads\//);
  });

  it("a pre-storage row with the same hash does not block the upload (it held no image)", async () => {
    h.findFieldScoutPhotoByHash.mockResolvedValue({ id: 1, url: "/uploads/field-scout/abc" });
    const res = await request(app).post("/api/leads/5/photos");
    expect(res.status).toBe(200);
    expect(res.body.deduped).toEqual([]);
    expect(h.puts).toHaveLength(1);
    expect(h.createFieldScoutPhoto).toHaveBeenCalledTimes(1);
  });

  it("a stored photo with the same hash is deduplicated — nothing re-written", async () => {
    h.findFieldScoutPhotoByHash.mockResolvedValue({ id: 1, url: "s3://acre-docs/org/7/field-scout/abc" });
    const res = await request(app).post("/api/leads/5/photos");
    expect(res.status).toBe(200);
    expect(res.body.deduped).toEqual(["abc"]);
    expect(h.puts).toHaveLength(0);
    expect(h.createFieldScoutPhoto).not.toHaveBeenCalled();
  });

  it("a failed store records no row", async () => {
    h.failPutAt = 1;
    const res = await request(app).post("/api/leads/5/photos");
    expect(res.status).toBe(500);
    expect(h.createFieldScoutPhoto).not.toHaveBeenCalled();
  });

  it("when the pipeline cannot hash, the key is the content hash — never the client filename two photos share", async () => {
    h.pipelineFails = true;
    const other = { ...FILE, buffer: Buffer.from([0xff, 0xd8, 0x01]) }; // a different photo, same "a.jpg"
    h.files = [FILE, other];
    const res = await request(app).post("/api/leads/5/photos");
    expect(res.status).toBe(200);
    const keys = h.puts.map((p) => p.Key);
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    expect(keys).toEqual([`org/7/field-scout/${sha(FILE.buffer)}`, `org/7/field-scout/${sha(other.buffer)}`]);
    expect(keys.some((k) => String(k).includes("a.jpg"))).toBe(false);
  });

  it("a store failure mid-batch says which photos were saved (503), instead of a bare 500 over kept files", async () => {
    h.pipelineFails = true;
    h.files = [FILE, { ...FILE, buffer: Buffer.from([7]), originalname: "b.jpg" }];
    h.failPutAt = 2;
    const res = await request(app).post("/api/leads/5/photos");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("partial_upload");
    expect(res.body.message).toMatch(/^1 of 2 photos were saved\. b\.jpg/);
    expect(res.body.details.savedCount).toBe(1);
    expect(h.createFieldScoutPhoto).toHaveBeenCalledTimes(1);
  });

  it("the visit list signs this org's stored photos only", async () => {
    h.visitPhotos = [
      { id: 1, url: "s3://acre-docs/org/7/field-scout/abc" },
      { id: 2, url: "/uploads/field-scout/old" },
      { id: 3, url: "s3://acre-docs/org/8/field-scout/abc" },
      { id: 4, url: "s3://acre-docs/org/7/../8/field-scout/abc" },
    ];
    const res = await request(app).get("/api/field-scout/visits");
    expect(res.status).toBe(200);
    const urls = (res.body.visits[0].photos as Array<{ imageUrl: string | null }>).map((p) => p.imageUrl);
    expect(urls).toEqual(["https://signed.example/org/7/field-scout/abc", null, null, null]);
  });
});

describe("visit logging never records a photo it did not receive (DEFECT-0164)", () => {
  it("photo pointers in the body are refused even with storage configured, and no visit or photo row is written", async () => {
    const res = await request(app)
      .post("/api/field-scout/visits")
      .send({ leadId: 5, latitude: 1, longitude: 2, photos: [{ url: "s3://acre-docs/org/7/field-scout/x", imageHash: "abc" }] });
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe("photo_pointers_not_accepted");
    expect(h.createFieldScoutVisit).not.toHaveBeenCalled();
    expect(h.createFieldScoutPhoto).not.toHaveBeenCalled();
  });

  it("a visit without photos is still logged", async () => {
    const res = await request(app).post("/api/field-scout/visits").send({ leadId: 5, latitude: 1, longitude: 2 });
    expect(res.status).toBe(201);
    expect(h.createFieldScoutVisit).toHaveBeenCalledTimes(1);
  });
});

describe("rehab photos — a store failure mid-batch", () => {
  it("reports which photos were saved (503) and rolls back only the failed one", async () => {
    h.files = [FILE, { ...FILE, originalname: "b.jpg" }];
    h.failPutAt = 2;
    const res = await request(app).post("/api/rehabs/r1/photos");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("partial_upload");
    expect(res.body.details.savedCount).toBe(1);
    expect(res.body.details.photos[0].s3Key).toBe("s3://acre-docs/org/7/rehabs/r1/p1.jpg");
  });
});
