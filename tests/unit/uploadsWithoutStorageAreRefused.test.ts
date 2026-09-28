/**
 * DEFECT-0164 — an upload with nowhere to keep its bytes is refused, never
 * reported as stored.
 *
 * Rehab photos (lender-draw and tax-basis evidence) and DriveMode field
 * photos each wrote a row pointing at a key or /uploads/... URL that nothing
 * serves, dropped the bytes, and answered success ("N photo(s) uploaded",
 * "Saved to the lead."). The field-scout voice memo fallback answered 200
 * "pending" over audio nothing kept. Each is now a 503 that says what
 * happened, with no row written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  inserts: 0,
  createFieldScoutPhoto: vi.fn(),
  findFieldScoutPhotoByHash: vi.fn(async () => null),
}));

const FILE = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: "image/jpeg", originalname: "a.jpg", size: 3 };

vi.mock("../../server/middleware/fileUploadSecurity", () => {
  const withFiles = (_req: unknown, _res: unknown, next: () => void) => {
    (_req as { files: unknown[] }).files = [FILE];
    next();
  };
  const withFile = (_req: unknown, _res: unknown, next: () => void) => {
    (_req as { file: unknown }).file = FILE;
    next();
  };
  return {
    createUploadMiddleware: () => ({ array: () => withFiles, single: () => withFile }),
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
    q.where = () => Object.assign(Promise.resolve([{ id: "r1" }]), { orderBy: async () => [] });
    return q;
  };
  const insert = () => {
    h.inserts++;
    return { values: () => ({ returning: async () => [{ id: "p1" }] }) };
  };
  return { db: { select, insert, update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }) } };
});
vi.mock("../../server/storage", () => ({
  db: {},
  storage: {
    getLead: async () => ({ id: 5 }),
    createFieldScoutPhoto: h.createFieldScoutPhoto,
    findFieldScoutPhotoByHash: h.findFieldScoutPhotoByHash,
  },
}));
vi.mock("../../server/services/imagePipeline", () => ({
  processUploadedImage: async () => ({ hash: "abc", stripped: Buffer.from([1]), variants: {} }),
}));

import { registerRehabPhotoRoutes } from "../../server/routes-rehab-photos";
import fieldScoutRouter from "../../server/routes-field-scout";

const app = express();
app.use(express.json());
registerRehabPhotoRoutes(app);
app.use("/api", (req, _res, next) => {
  (req as unknown as { organization: unknown }).organization = { id: 7 };
  next();
}, fieldScoutRouter);

beforeEach(() => {
  h.inserts = 0;
  h.createFieldScoutPhoto.mockReset();
  delete process.env.OPENAI_API_KEY;
});

describe("DEFECT-0164 — rehab photos", () => {
  it("refuses the upload with a 503 and writes no row (was: 201 over dropped bytes)", async () => {
    const res = await request(app).post("/api/rehabs/r1/photos");
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/was not saved/);
    expect(h.inserts).toBe(0);
  });

  it("the list says the files behind existing records were not kept", async () => {
    const res = await request(app).get("/api/rehabs/r1/photos");
    expect(res.status).toBe(200);
    expect(res.body.storageAvailable).toBe(false);
  });
});

describe("DEFECT-0164 — DriveMode field photos", () => {
  it("refuses with a 503 and creates no photo record (was: 200 'Saved to the lead.')", async () => {
    const res = await request(app).post("/api/leads/5/photos");
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/was not saved/);
    expect(h.createFieldScoutPhoto).not.toHaveBeenCalled();
  });
});

describe("DEFECT-0164 — voice memo fallback", () => {
  it("no transcriber is a 503 that says the recording was not kept (was: 200 'pending')", async () => {
    const res = await request(app).post("/api/voice/transcribe");
    expect(res.status).toBe(503);
    expect(res.body).not.toHaveProperty("pending");
    expect(res.body.message).toMatch(/not kept/);
  });
});

// ── Population ───────────────────────────────────────────────────────────────
// The two routes above were found by reading the upload sites one by one. A
// new upload route must be CLASSIFIED here before it can ship: a file that
// accepts bytes and is not in this register fails the gate.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = resolve(__dirname, "../..");
type Verdict = "refused-without-storage" | "parsed-not-kept" | "stored-in-db";
const UPLOAD_SITES: Record<string, Verdict> = {
  "server/routes-rehab-photos.ts": "refused-without-storage",
  "server/routes-field-scout.ts": "refused-without-storage", // photos; its voice memo is transcribed or 503
  "server/routes-properties.ts": "parsed-not-kept", // CSV import
  "server/routes-leads.ts": "parsed-not-kept", // CSV import
  "server/routes-import-export.ts": "parsed-not-kept", // CSV / ZIP jobs (ZIP files on /tmp: DEFECT-0143)
  "server/routes-bid-estimates.ts": "parsed-not-kept", // bid PDF text extraction
  "server/routes-ai.ts": "parsed-not-kept", // voice → transcript
  "server/routes-founder-life-cockpit.ts": "stored-in-db", // encrypted vault bytea
};

describe("DEFECT-0164 — every upload site is classified", () => {
  // 'server/*.ts' — 'server/**/*.ts' skips every top-level server file.
  const files = execSync("git ls-files 'server/*.ts'", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.includes(".test.") && f !== "server/middleware/fileUploadSecurity.ts");
  const found = files.filter((f) => {
    const src = stripComments(readFileSync(resolve(ROOT, f), "utf8"));
    return /createUploadMiddleware\(|\bmulter\(/.test(src);
  });

  it("the scan read the whole server tree (population floor)", () => {
    expect(files).toContain("server/routes.ts");
    expect(files.length).toBeGreaterThan(1000);
  });

  it("no upload site exists outside the register", () => {
    expect(found.filter((f) => !(f in UPLOAD_SITES))).toEqual([]);
  });

  for (const [file, verdict] of Object.entries(UPLOAD_SITES)) {
    it(`${file} is still an upload site (vacuity) and honours '${verdict}'`, () => {
      expect(found).toContain(file);
      if (verdict === "refused-without-storage") {
        const src = stripComments(readFileSync(resolve(ROOT, file), "utf8"));
        expect(src).toMatch(/photoStorageAvailable\(\)/);
        expect(src).toMatch(/persistPhotoBytes\(/);
      }
    });
  }
});

// ── The offline queue ────────────────────────────────────────────────────────
// Audit follow-up: the service worker queued DriveMode's multipart photo
// under the /api/leads prefix via request.text() — mangling the JPEG — and
// answered 202 "Saved offline", which DriveMode toasted as "Saved to the lead."
describe("DEFECT-0164 — the service worker never queues a multipart body", () => {
  const sw = readFileSync(resolve(ROOT, "client/public/sw.js"), "utf8");
  const routes = sw.match(/const OFFLINE_QUEUEABLE_ROUTES = \[[\s\S]*?\];/)?.[0];
  const fn = sw.match(/function isOfflineQueueable\([\s\S]*?\n\}/)?.[0];
  const isOfflineQueueable = new Function(`${routes}\n${fn}\nreturn isOfflineQueueable;`)() as (
    m: string,
    p: string,
    ct: string | null,
  ) => boolean;

  it("the predicate was located (vacuity)", () => {
    expect(routes).toBeTruthy();
    expect(fn).toBeTruthy();
    expect(sw).toMatch(/if \(isOfflineQueueable\(request\.method, url\.pathname, request\.headers\.get\('content-type'\)\)\)/);
  });

  it("a photo upload is not queued; a JSON lead save still is", () => {
    expect(isOfflineQueueable("POST", "/api/leads/5/photos", "multipart/form-data; boundary=x")).toBe(false);
    expect(isOfflineQueueable("POST", "/api/leads", "application/json")).toBe(true);
    expect(isOfflineQueueable("POST", "/api/field-scout/quick-add", "application/json")).toBe(true);
  });
});
