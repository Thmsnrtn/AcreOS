/**
 * The founder build is served — and only for the paths it owns.
 *
 * P1-9 / X-2 split the client into two Vite outputs: the customer bundle
 * (dist/public, base "/") and the founder bundle (dist/founder, base
 * "/founder-app/"). The customer router has no founder routes any more, so a
 * founder URL that reached the CUSTOMER shell would render NotFound — the
 * server-side shell selector in server/static.ts is what makes the split work,
 * and it is a gate over a property ("every founder path is answered with the
 * founder shell, every other path with the customer shell"), so this file runs
 * the real serveStatic() over a fixture dist rather than reading its source.
 *
 * Real HTTP, both shells, env + CSP nonce on both, the founder asset
 * namespace's stale-chunk and source-map guards, and the API branch untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import request from "supertest";
import { serveStatic } from "../../server/static";
import { isFounderBuildPath } from "../../shared/founder-surface-paths";

const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache, no-store, must-revalidate";

const NON_PREFIXED_FOUNDER_PAGES = [
  "/admin/safety-gates",
  "/executive-dashboard",
  "/dunning",
  "/reseller",
  "/agent-performance",
  "/job-health",
];

let root: string;
let app: express.Express;
const priorEnv = { NODE_ENV: process.env.NODE_ENV, key: process.env.VITE_CLERK_PUBLISHABLE_KEY };

function write(base: string, rel: string, body: string | Buffer) {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function mount(dist: string): express.Express {
  const a = express();
  // Stand-in for the CSP middleware that sets the per-request nonce.
  a.use((_req, res, next) => {
    res.locals.cspNonce = "N0NCE";
    next();
  });
  serveStatic(a, dist);
  return a;
}

beforeAll(() => {
  process.env.NODE_ENV = "production";
  process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_test_founder_split";
  root = fs.mkdtempSync(path.join(os.tmpdir(), "founder-build-served-"));
  const pub = path.join(root, "public");
  const founder = path.join(root, "founder");
  write(pub, "index.html", '<html><head></head><body data-shell="customer"><script data-csp-nonce></script></body></html>');
  write(pub, "assets/app-abc123.js", "console.log('customer')");
  write(founder, "founder.html", '<html><head></head><body data-shell="founder"><script data-csp-nonce></script></body></html>');
  write(founder, "founder-assets/page-def456.js", "console.log('founder')");
  write(founder, "founder-assets/page-def456.js.gz", zlib.gzipSync("console.log('founder')"));
  // A stray map that a partial build or a hand-copied artifact left behind.
  write(founder, "founder-assets/page-def456.js.map", '{"version":3,"sources":["secret.ts"]}');
  write(founder, "founder-assets/page-def456.js.map.gz", zlib.gzipSync('{"version":3}'));
  app = mount(pub);
});

afterAll(() => {
  if (priorEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorEnv.NODE_ENV;
  if (priorEnv.key === undefined) delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
  else process.env.VITE_CLERK_PUBLISHABLE_KEY = priorEnv.key;
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("the shell selector: founder paths get the founder shell", () => {
  it.each(["/founder", "/founder/", "/founder/decisions", "/founder/autopilot/control", "/founder/inspector/agents/ada?x=1", ...NON_PREFIXED_FOUNDER_PAGES])(
    "%s → dist/founder/founder.html, with env and the CSP nonce, never cached",
    async (p) => {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain('data-shell="founder"');
      // Same finalizeShellHtml as the customer shell: nonce stamped on the marked tag…
      expect(res.text).toContain('nonce="N0NCE" data-csp-nonce');
      // …and the runtime env injected before </head>.
      expect(res.text).toContain("window.__ENV__=");
      expect(res.text).toContain('"VITE_CLERK_PUBLISHABLE_KEY":"pk_test_founder_split"');
      expect(res.headers["cache-control"]).toBe(NO_CACHE);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    },
  );

  it.each(["/", "/today", "/maps", "/deals/42", "/pricing", "/auth"])("%s → the customer shell, untouched", async (p) => {
    const res = await request(app).get(p);
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-shell="customer"');
    expect(res.text).toContain('nonce="N0NCE" data-csp-nonce');
    expect(res.text).toContain("window.__ENV__=");
  });

  it("/commissions keeps the CUSTOMER shell — its page module is shared with Finance → Commissions", async () => {
    const res = await request(app).get("/commissions");
    expect(res.text).toContain('data-shell="customer"');
  });

  it.each(["/founder-dashboard", "/foundry", "/dunning/extra", "/reseller/x", "/admin/safety-gates/x"])(
    "%s is not a founder-shell path (prefix lookalikes and nested children stay customer)",
    async (p) => {
      const res = await request(app).get(p);
      expect(res.text).toContain('data-shell="customer"');
    },
  );

  it("the API branch is untouched: /api/founder/* that reaches the catch-all is a JSON 404, never a shell", async () => {
    const res = await request(app).get("/api/founder/anything");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("data-shell");
    expect(res.headers["content-type"]).toMatch(/json/);
  });

  it("the server's selector and the client's hand-off share ONE path list", () => {
    // shared/founder-surface-paths.ts is imported by BOTH server/static.ts and
    // client/src/lib/cross-build.ts; this pins the contract they agree on.
    for (const p of ["/founder", "/founder/x/y", ...NON_PREFIXED_FOUNDER_PAGES]) expect(isFounderBuildPath(p)).toBe(true);
    for (const p of ["/", "/today", "/commissions", "/founder-dashboard", "/foundry", "/dunning/x"]) {
      expect(isFounderBuildPath(p), p).toBe(false);
    }
  });
});

describe("the founder asset namespace (/founder-app/founder-assets/…)", () => {
  it("serves a hashed chunk with the 1-year immutable cache", async () => {
    const res = await request(app).get("/founder-app/founder-assets/page-def456.js").set("Accept-Encoding", "identity");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(IMMUTABLE);
  });

  it("prefers the pre-compressed twin, with the same immutable cache", async () => {
    const res = await request(app).get("/founder-app/founder-assets/page-def456.js").set("Accept-Encoding", "gzip");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers["cache-control"]).toBe(IMMUTABLE);
  });

  it.each([
    "/founder-app/founder-assets/gone-zzz.js",
    "/founder-app/founder-assets/gone-zzz.css",
    "/founder-app/founder-assets/gone-zzz.js.br",
  ])("a stale chunk %s is a 404 text, never the HTML shell (F-D10)", async (p) => {
    const res = await request(app).get(p).set("Accept-Encoding", "identity");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toBe("asset not found");
  });

  it("nothing under /founder-app is an SPA route: an unknown path is a 404, not a shell", async () => {
    const res = await request(app).get("/founder-app/anything/else");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("data-shell");
  });

  it.each([
    "/founder-app/founder-assets/page-def456.js.map",
    "/founder-app/founder-assets/page-def456.js.map.gz",
    "/founder-app/founder-assets/page-def456.js.map?v=2",
  ])("a source map that is on disk is still refused: %s", async (p) => {
    const res = await request(app).get(p).set("Accept-Encoding", "identity");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("secret.ts");
  });

  it("the raw founder.html is never cached (it references hashed asset URLs)", async () => {
    const res = await request(app).get("/founder-app/founder.html");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(NO_CACHE);
  });

  it("the customer namespace is unchanged: a hashed asset is immutable, a stale one 404s", async () => {
    const ok = await request(app).get("/assets/app-abc123.js").set("Accept-Encoding", "identity");
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toBe(IMMUTABLE);
    const gone = await request(app).get("/assets/gone-zzz.js").set("Accept-Encoding", "identity");
    expect(gone.status).toBe(404);
    expect(gone.text).toBe("asset not found");
  });
});

describe("a dist with no founder output (dev tree, stale or partial dist)", () => {
  it("falls back to the customer shell rather than serving a broken founder shell or crashing", async () => {
    const lone = fs.mkdtempSync(path.join(os.tmpdir(), "founder-build-missing-"));
    try {
      const pub = path.join(lone, "public");
      write(pub, "index.html", '<html><head></head><body data-shell="customer"></body></html>');
      const res = await request(mount(pub)).get("/founder");
      expect(res.status).toBe(200);
      expect(res.text).toContain('data-shell="customer"');
    } finally {
      fs.rmSync(lone, { recursive: true, force: true });
    }
  });
});
