/**
 * /learn-content/* is unhashed, refreshed-in-place content, so it must never be
 * served with the 1-year immutable static cache. Real HTTP against the real
 * serveStatic() middleware mounted on a fixture dist — both serving routes:
 * express.static (setHeaders) and the preCompressedAssets .gz/.br siblings,
 * which bypass express.static entirely.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import request from "supertest";
import { serveStatic } from "../../server/static";

const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache, no-store, must-revalidate";

let dist: string;
let app: express.Express;
const priorEnv = process.env.NODE_ENV;

function write(rel: string, body: string | Buffer) {
  const file = path.join(dist, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

beforeAll(() => {
  process.env.NODE_ENV = "production"; // production cache semantics; read at mount time
  dist = fs.mkdtempSync(path.join(os.tmpdir(), "learn-content-cache-"));
  write("index.html", "<html><head></head><body>shell</body></html>");
  write("sw.js", "// sw");
  write("assets/app-abc123.js", "console.log(1)");
  write("assets/app-abc123.js.gz", zlib.gzipSync("console.log(1)"));
  write("learn-content/lesson.json", '{"a":1}');
  write("learn-content/lesson.json.gz", zlib.gzipSync('{"a":1}'));
  write("learn-content/plain-only.json", '{"b":2}');
  app = express();
  serveStatic(app, dist);
});

afterAll(() => {
  if (priorEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorEnv;
  if (dist) fs.rmSync(dist, { recursive: true, force: true });
});

function expectNoCache(res: request.Response) {
  expect(res.headers["cache-control"]).toBe(NO_CACHE);
  expect(res.headers["pragma"]).toBe("no-cache");
  expect(res.headers["expires"]).toBe("0");
}

describe("/learn-content/* is never immutable", () => {
  it("uncompressed json (express.static route)", async () => {
    const res = await request(app).get("/learn-content/plain-only.json").set("Accept-Encoding", "identity");
    expect(res.status).toBe(200);
    expectNoCache(res);
  });

  it("gzip sibling (preCompressedAssets route)", async () => {
    const res = await request(app).get("/learn-content/lesson.json").set("Accept-Encoding", "gzip");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expectNoCache(res);
  });

  it("compression-capable client without a sibling falls back to express.static", async () => {
    const res = await request(app).get("/learn-content/plain-only.json").set("Accept-Encoding", "gzip, br");
    expect(res.status).toBe(200);
    expectNoCache(res);
  });
});

describe("hashed /assets/* keeps the 1-year immutable cache", () => {
  it("via express.static", async () => {
    const res = await request(app).get("/assets/app-abc123.js").set("Accept-Encoding", "identity");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(IMMUTABLE);
  });

  it("via the precompressed sibling", async () => {
    const res = await request(app).get("/assets/app-abc123.js").set("Accept-Encoding", "gzip");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers["cache-control"]).toBe(IMMUTABLE);
  });
});

describe(".html and /sw.js keep their no-cache treatment", () => {
  it("/sw.js", async () => {
    const res = await request(app).get("/sw.js");
    expect(res.status).toBe(200);
    expectNoCache(res);
  });

  it("a static .html file", async () => {
    write("page.html", "<p>x</p>");
    const res = await request(app).get("/page.html");
    expect(res.status).toBe(200);
    expectNoCache(res);
  });
});
