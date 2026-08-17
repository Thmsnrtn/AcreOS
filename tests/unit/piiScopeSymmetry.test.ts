/**
 * A protected WRITE with an unprotected READ protects nothing.
 *
 * `server/middleware/roleScope.ts` defines `tenant_pii_read` and
 * `tenant_pii_write` — "SSN, prior addresses, screening results" — and the scope
 * table denies both to `member`, `va` and `viewer`.
 *
 * `POST /api/skip-traces` carried `requireScope("tenant_pii_write")`. The three
 * READS three lines above it carried nothing:
 *
 *   GET /api/skip-traces
 *   GET /api/skip-traces/:id
 *   GET /api/skip-traces/lead/:leadId
 *
 * `skip_traces.results` is typed `{ phones, emails, addresses }` — phone
 * numbers, email addresses and address history for a real person. So the scope
 * stopped a denied role from ORDERING a skip trace and let them read every one
 * the org had already bought.
 *
 * **Reads are what exfiltrate.** A write gate without its matching read gate is
 * the most misleading shape in an authorization system, because the surface
 * looks protected: someone thought about the scope, named it correctly, and
 * applied it to the wrong half.
 *
 * This is the same class as the ten export endpoints (unit 34) and the four lead
 * writes (unit 30) — a rule that exists and is applied to some surfaces and not
 * others — but it is the sharpest instance, because the protected and
 * unprotected routes sit in the same file within twenty lines of each other.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping. See destructivePermissionCoverage for why. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away.");
  return out.join("\n");
}

function code(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

/** Every route that returns or accepts tenant PII, and the scope it must carry. */
const PII_ROUTES = [
  { file: "server/routes-leads.ts", match: 'api.get("/api/skip-traces"', scope: "tenant_pii_read" },
  { file: "server/routes-leads.ts", match: 'api.get("/api/skip-traces/:id"', scope: "tenant_pii_read" },
  { file: "server/routes-leads.ts", match: 'api.get("/api/skip-traces/lead/:leadId"', scope: "tenant_pii_read" },
  { file: "server/routes-leads.ts", match: 'api.post("/api/skip-traces"', scope: "tenant_pii_write" },
] as const;

function registration(src: string, match: string): string {
  const at = src.indexOf(match);
  if (at === -1) return "";
  const end = src.indexOf("\n", at);
  return end === -1 ? src.slice(at) : src.slice(at, end);
}

describe("tenant PII is scoped on the way OUT, not only on the way in", () => {
  it("finds every route it claims to check (vacuity guard)", () => {
    for (const r of PII_ROUTES) {
      expect(
        registration(code(r.file), r.match).length,
        `${r.match} not found — renamed?`,
      ).toBeGreaterThan(0);
    }
  });

  it("every skip-trace route carries its scope", () => {
    for (const r of PII_ROUTES) {
      expect(
        registration(code(r.file), r.match),
        `${r.match} does not enforce ${r.scope}`,
      ).toContain(`requireScope("${r.scope}")`);
    }
  });

  it("the READS are gated, not just the write", () => {
    // Stated separately and deliberately. The write was already gated when this
    // was found; asserting "every route has a scope" alone would have passed on
    // three of four if the reads were dropped again, since the message would not
    // say which half was missing.
    const reads = PII_ROUTES.filter((r) => r.scope === "tenant_pii_read");
    expect(reads.length, "no PII reads registered — did they move?").toBe(3);
    for (const r of reads) {
      expect(
        registration(code(r.file), r.match),
        `${r.match} is a PII READ with no tenant_pii_read scope — reads are what exfiltrate`,
      ).toContain('requireScope("tenant_pii_read")');
    }
  });

  it("the scope really is denied to the roles this protects", () => {
    // The gate matters only because member, va and viewer lack the scope. If the
    // table changed to grant it, these routes would be open again and every
    // assertion above would still pass — so the premise is checked too.
    const scopes = code("server/middleware/roleScope.ts");
    for (const role of ["member", "viewer", "va"]) {
      const at = scopes.indexOf(`  ${role}: new Set([`);
      expect(at, `role ${role} not found in ROLE_SCOPES`).toBeGreaterThan(-1);
      const block = scopes.slice(at, scopes.indexOf("]),", at));
      expect(block, `${role} now has tenant_pii_read`).not.toContain("tenant_pii_read");
    }
    // ...and that owner/admin DO have it, or the gate would lock everyone out.
    for (const role of ["owner", "admin"]) {
      const at = scopes.indexOf(`  ${role}: new Set([`);
      const block = scopes.slice(at, scopes.indexOf("]),", at));
      expect(block, `${role} lost tenant_pii_read`).toContain("tenant_pii_read");
    }
  });

  it("the PII columns this protects still hold PII", () => {
    // If `results` ever stopped carrying contact data the scope would be
    // protecting nothing, and this test would be enforcing a rule with no
    // subject. Checked so the justification cannot outlive the data.
    const schema = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
    const at = schema.indexOf('export const skipTraces = pgTable("skip_traces"');
    expect(at, "skip_traces table not found").toBeGreaterThan(-1);
    const table = schema.slice(at, at + 1800);
    expect(table).toMatch(/phones\?:/);
    expect(table).toMatch(/emails\?:/);
    expect(table).toMatch(/addresses\?:/);
  });
});
