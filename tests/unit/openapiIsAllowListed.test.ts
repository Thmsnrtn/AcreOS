/**
 * The public API document is a curated artifact, never a reflection of the
 * running server.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `GET /api/docs/openapi.json` is deliberately unauthenticated — the mount
 * comment says so — and served with `Access-Control-Allow-Origin: *`. It used
 * to merge `reflectAppPaths(appRef)`, a walk of the LIVE Express stack, into
 * the response, filtered by a 15-entry `PRIVATE_PATH_PREFIXES` deny-list.
 *
 * A deny-list is allow-BY-DEFAULT. Every route family nobody thought to add
 * was published: `/api/scp/v2/*` — the sovereign control plane, whose
 * operations are `trust/promote`, `trust/demote`, `evolution/rollback`,
 * `evolution/pause` — plus `/api/dsar/`, `/api/legal-hold/`, `/api/dunning/`,
 * `/api/data-api/` and `/api/mcp`.
 *
 * Those endpoints ARE guarded; `/api/scp/v2` carries isAuthenticated +
 * getOrCreateOrg + requireFounder. What leaked was their EXISTENCE — and this
 * codebase spends a status code concealing exactly that: `requireFounder`
 * returns 404 rather than 403 so a non-founder cannot learn a founder route is
 * there. One endpoint was handing out the map the other pays to hide.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *   1. The public document is the hand-curated spec and nothing else, so
 *      adding a route to the app cannot add it here.
 *   2. The reflector is not wired into the response — a deny-list cannot come
 *      back by being extended.
 *   3. No path the deny-list would have missed is in the document, checked
 *      against the actual prefixes rather than a remembered list.
 *   4. The document is still non-empty, so "publish nothing" is not how this
 *      passes.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { generateOpenAPISpec } from "../../server/openapi-spec";

const ROOT = path.resolve(__dirname, "../..");
const DOCS = "server/routes-api-docs.ts";
const src = stripComments(fs.readFileSync(path.join(ROOT, DOCS), "utf8"));

const spec = generateOpenAPISpec() as { paths?: Record<string, unknown> };
const publicPaths = Object.keys(spec.paths ?? {});

describe("the document exists and is real (vacuity guard)", () => {
  it("publishes a substantial curated surface", () => {
    // "Publish nothing" would satisfy every containment assertion below.
    expect(
      publicPaths.length,
      "the curated spec is empty — this file would then certify nothing",
    ).toBeGreaterThan(10);
  });
});

describe("the response is the curated spec, not the router", () => {
  it("the handler serves generateOpenAPISpec() alone", () => {
    const at = src.indexOf("'/openapi.json'");
    expect(at, "the spec route is gone — re-point this test").toBeGreaterThan(-1);
    const handler = src.slice(at, src.indexOf("});", at));
    expect(handler).toContain("generateOpenAPISpec()");
    expect(
      handler,
      "the live-router reflection is merged into the public document again. A " +
        "deny-list is allow-by-default: every route family nobody thought to " +
        "add gets published, including the founder surfaces requireFounder " +
        "returns 404 to hide.",
    ).not.toContain("reflectAppPaths");
    expect(handler).not.toContain("reflectedCache");
  });

  it("the reflector survives only as an audit helper, never in the response", () => {
    // Keeping it is deliberate — "which live routes are undocumented" is a
    // useful signal. It just must not decide what strangers can see.
    expect(src).toContain("export function reflectedPathsForAudit");
    const audit = src.slice(src.indexOf("export function reflectedPathsForAudit"));
    expect(audit).toContain("reflectAppPaths(appRef)");
  });
});

describe("nothing private reaches the public document", () => {
  // Read the prefixes from the reflector itself rather than repeating them —
  // a remembered list drifts, and the drift is invisible.
  const reflector = stripComments(
    fs.readFileSync(path.join(ROOT, "server/openapi-reflector.ts"), "utf8"),
  );
  const listed = /PRIVATE_PATH_PREFIXES[^=]*=\s*\[([\s\S]*?)\]/.exec(reflector);

  it("reads the reflector's own prefix list (derivation guard)", () => {
    expect(listed, "PRIVATE_PATH_PREFIXES is gone or changed shape").not.toBeNull();
  });

  const prefixes = [...(listed?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  it("publishes none of them", () => {
    expect(prefixes.length).toBeGreaterThan(5);
    const leaked = publicPaths.filter((p) => prefixes.some((pre) => p.startsWith(pre)));
    expect(leaked, "a private prefix is in the curated document").toEqual([]);
  });

  it("publishes none of the families the deny-list MISSED either", () => {
    // These are the ones that were actually leaking. They are checked
    // explicitly because the deny-list above never mentioned them — which is
    // the entire failure this test exists for.
    const missedByTheDenyList = [
      "/api/scp",
      "/api/dsar",
      "/api/legal-hold",
      "/api/dunning",
      "/api/data-api",
      "/api/mcp",
      "/scp",
      "/dsar",
    ];
    const leaked = publicPaths.filter((p) =>
      missedByTheDenyList.some((pre) => p === pre || p.startsWith(`${pre}/`)),
    );
    expect(leaked, "a control-plane or compliance surface is documented publicly").toEqual([]);
  });
});

describe("the human page renders without anything the CSP blocks", () => {
  // It used to load Swagger UI from unpkg.com, which is in neither script-src
  // nor style-src, and in production script-src requires a per-request nonce.
  // The page was a blank div.
  it("loads no external asset", () => {
    const at = src.indexOf("docsRouter.get('/'");
    expect(at, "the docs page route is gone — re-point this test").toBeGreaterThan(-1);
    const handler = src.slice(at);
    for (const host of ["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"]) {
      expect(
        handler,
        `the docs page loads assets from ${host}, which the CSP does not allow — ` +
          "the page will render blank",
      ).not.toContain(host);
    }
    expect(handler).not.toMatch(/<script\s+src=/);
  });

  it("needs no JavaScript at all", () => {
    const at = src.indexOf("docsRouter.get('/'");
    const handler = src.slice(at);
    expect(
      handler,
      "the page executes script again; script-src requires a per-request nonce " +
        "in production, so an inline block is refused too",
    ).not.toMatch(/<script[\s>]/);
  });

  it("renders the same curated paths the spec serves", () => {
    const at = src.indexOf("docsRouter.get('/'");
    const handler = src.slice(at);
    expect(handler).toContain("generateOpenAPISpec()");
    expect(handler).toContain("esc(");
  });
});
