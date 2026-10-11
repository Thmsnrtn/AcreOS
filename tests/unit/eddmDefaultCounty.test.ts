/**
 * The EDDM map opened on the org's own county by asking
 * /api/organizations/current — a route that does not exist (404 in every
 * browser run, W2 audit 2026-10-10), so it always fell back to TX/Hidalgo.
 * It now reads the org's target counties (GET /api/target-counties, a real
 * route) and opens on the first active one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { eddmDefaultCounty } from "../../client/src/pages/outreach/mail/eddmDefaults";

const ROOT = path.resolve(__dirname, "../..");

describe("EDDM default county", () => {
  it("every API path the EDDM tab GETs is a route the server mounts", () => {
    const src = stripComments(readFileSync(path.join(ROOT, "client/src/pages/outreach/mail/eddm.tsx"), "utf8"));
    const paths = Array.from(src.matchAll(/apiRequest\(\s*"GET"\s*,\s*["'`](\/api\/[^"'`?$]+)/g)).map((m) => m[1]);
    expect(paths.length, "the EDDM tab reads no API by GET — the scan stopped matching").toBeGreaterThan(0);
    const server = readdirSync(path.join(ROOT, "server"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => stripComments(readFileSync(path.join(ROOT, "server", f), "utf8")))
      .join("\n");
    for (const p of paths) expect(server, `${p} is not a mounted GET route`).toMatch(new RegExp(`\\.get\\(\\s*["']${p.replace(/[/.]/g, "\\$&")}["']`));
  });

  it("opens on the first ACTIVE target county, else the first one, else Hidalgo, TX", () => {
    expect(eddmDefaultCounty([{ name: "Luna", state: "NM", status: "researching" }, { name: "DeKalb County", state: "tn", status: "active" }])).toEqual({ state: "TN", county: "DeKalb" });
    expect(eddmDefaultCounty([{ name: "Luna", state: "NM", status: "researching" }])).toEqual({ state: "NM", county: "Luna" });
    expect(eddmDefaultCounty([])).toEqual({ state: "TX", county: "Hidalgo" });
    expect(eddmDefaultCounty(undefined)).toEqual({ state: "TX", county: "Hidalgo" });
  });
});
