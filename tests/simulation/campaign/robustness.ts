/**
 * Robustness & concurrency sim — the things a real customer base does by
 * accident: double-clicks, flaky networks that retry, pasted Unicode, a CSV
 * from Excel with a BOM, a body the client forgot to JSON-encode, a 2 MB note.
 *
 * Every probe records WHAT CAME BACK; a 5xx or a duplicate row is a finding.
 *
 *   SIM_BASE_URL=http://localhost:5000 DATABASE_URL=... npx tsx tests/simulation/campaign/robustness.ts
 */
import pg from "pg";
import { SimClient, concurrently, percentile } from "./client";
import { recordFinding, recordMetric, recordSkip } from "./ledger";

const SIM = "robustness";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const c = new SimClient("land-operator-desktop");

async function orgIdOf(slug: string): Promise<number> {
  const r = await db.query(
    `SELECT o.id FROM organizations o JOIN users u ON u.id = o.owner_id WHERE u.clerk_user_id = $1 ORDER BY o.id LIMIT 1`,
    [`e2e_persona_${slug.replace(/[^a-z0-9]+/g, "_")}`],
  );
  return r.rows[0]?.id;
}

function lead(suffix: string) {
  return {
    firstName: "Robust",
    lastName: `Probe ${suffix}`,
    propertyAddress: `${suffix} Sim Road`,
    county: "Cochise",
    state: "AZ",
    acreage: "10",
    email: `robust+${suffix}@example.com`,
    phone: "+15005550006",
  };
}

async function main() {
  await db.connect();
  const orgId = await orgIdOf("land-operator-desktop");
  if (!orgId) throw new Error("persona org not found — run tests/personas/seedDb.ts first; every DB-backed check below would read 0 rows");
  console.log(`[${SIM}] org ${orgId}`);

  // ── 1. Double-submit: 10 identical lead creates fired at once ───────────
  {
    const tag = `dbl-${Date.now()}`;
    const results = await concurrently(10, () => c.post("/api/leads", lead(tag)));
    const statuses = results.map((r) => r.status);
    const rows = await db.query(`SELECT count(*)::int AS n FROM leads WHERE organization_id=$1 AND last_name=$2`, [orgId, `Probe ${tag}`]);
    recordMetric(SIM, "double-submit statuses", statuses);
    recordMetric(SIM, "double-submit rows created", rows.rows[0].n);
    if (rows.rows[0].n > 1) {
      recordFinding({ sim: SIM, id: "A-ROB-1", product: "AcreOS", sev: "P2", area: "data-integrity",
        title: `A double-clicked 'Add lead' creates duplicates: 10 identical concurrent POST /api/leads produced ${rows.rows[0].n} rows`,
        evidence: `statuses=${JSON.stringify(statuses)}; rows with last_name='Probe ${tag}' = ${rows.rows[0].n}`,
        impact: "No idempotency key or dedupe on create; a flaky mobile network that retries will fill the pipeline with duplicates the customer then has to merge by hand.",
        repro: "fire 10 identical POST /api/leads concurrently" });
    }
    if (statuses.some((s) => s >= 500)) {
      recordFinding({ sim: SIM, id: "A-ROB-1b", product: "AcreOS", sev: "P1", area: "robustness",
        title: "Concurrent identical lead creates produced a 5xx", evidence: JSON.stringify(statuses) });
    }
  }

  // ── 2. Concurrent status updates on one lead (lost-update check) ────────
  {
    const created = await c.post("/api/leads", lead(`race-${Date.now()}`));
    const id = created.body?.id;
    if (!id) {
      recordSkip({ sim: SIM, step: "status-race", reason: `create returned ${created.status}: ${created.text.slice(0, 200)}` });
    } else {
      const statuses = ["contacted", "negotiating", "under_contract", "closed", "dead"];
      const results = await concurrently(20, (i) => c.put(`/api/leads/${id}`, { status: statuses[i % statuses.length] }));
      const codes = results.map((r) => r.status);
      const after = await c.get(`/api/leads/${id}`);
      recordMetric(SIM, "status-race codes", codes);
      recordMetric(SIM, "status-race final", after.body?.status);
      if (codes.some((s) => s >= 500)) {
        recordFinding({ sim: SIM, id: "A-ROB-2", product: "AcreOS", sev: "P1", area: "robustness",
          title: "Concurrent PATCH /api/leads/:id status updates produced a 5xx", evidence: JSON.stringify(codes) });
      }
      const invalid = results.filter((r) => r.status === 200 && !statuses.includes(r.body?.status));
      if (invalid.length) {
        recordFinding({ sim: SIM, id: "A-ROB-2b", product: "AcreOS", sev: "P2", area: "data-integrity",
          title: "A 200 response to a status PATCH echoed a status that was not the one requested",
          evidence: invalid.slice(0, 3).map((r) => r.text.slice(0, 120)).join(" | ") });
      }
    }
  }

  // ── 3. Malformed bodies a real client sends ─────────────────────────────
  const malformed: Array<[string, Parameters<SimClient["call"]>[3] & { body?: unknown }, string]> = [
    ["not-json", { raw: "{firstName: 'x'", headers: { "content-type": "application/json" } }, "truncated JSON"],
    ["form-encoded", { raw: "firstName=x&lastName=y", headers: { "content-type": "application/x-www-form-urlencoded" } }, "form body to a JSON route"],
    ["empty-json-content-type", { raw: "", headers: { "content-type": "application/json" } }, "empty body with JSON content-type"],
    ["array-body", { raw: "[1,2,3]", headers: { "content-type": "application/json" } }, "JSON array instead of object"],
    ["huge-string", { raw: JSON.stringify({ ...lead("huge"), notes: "x".repeat(2_000_000) }), headers: { "content-type": "application/json" } }, "2 MB notes field"],
    ["unicode", { raw: JSON.stringify({ ...lead("uni"), firstName: "Zoë 🌵 ﷽ ' \" \\ \u0000", lastName: "O'Brien–Ñandú" }), headers: { "content-type": "application/json" } }, "unicode + NUL + quotes"],
    ["wrong-types", { raw: JSON.stringify({ firstName: 123, lastName: true, acreage: { a: 1 }, email: ["a"] }), headers: { "content-type": "application/json" } }, "wrong primitive types"],
    ["prototype-keys", { raw: JSON.stringify(lead("proto")).replace(/}$/, ',"__proto__":{"isFounder":true,"organizationId":1},"constructor":{"prototype":{"isAdmin":true}}}'), headers: { "content-type": "application/json" } }, "__proto__ / constructor keys (sent as raw JSON text so they are own keys on the wire)"],
    ["extra-fields", { raw: JSON.stringify({ ...lead("extra"), organizationId: 1, isFounder: true, deletedAt: null }), headers: { "content-type": "application/json" } }, "server-owned organizationId/isFounder supplied by client"],
    ["client-id", { raw: JSON.stringify({ ...lead("cid"), id: 900000000 + Math.floor(Math.random() * 1e6) }), headers: { "content-type": "application/json" } }, "client-chosen primary key"],
  ];
  for (const [name, opts, desc] of malformed) {
    const r = await c.call("POST", "/api/leads", undefined, opts);
    recordMetric(SIM, `malformed:${name}`, { status: r.status, ms: Math.round(r.ms), body: r.text.slice(0, 160) });
    if (r.status >= 500 || r.status === 0) {
      recordFinding({ sim: SIM, id: `A-ROB-3-${name}`, product: "AcreOS", sev: "P1", area: "robustness",
        title: `POST /api/leads with ${desc} returned ${r.status}`, evidence: r.text.slice(0, 300) });
    }
    if (name === "extra-fields") {
      if (r.status >= 300 || !r.body?.id) recordSkip({ sim: SIM, step: "mass-assignment", reason: `create did not succeed (${r.status}), so organizationId persistence could not be observed` });
    }
    if (name === "client-id" && r.status < 300 && r.body?.id) {
      const asked = JSON.parse(String((opts as any).raw)).id;
      if (Number(r.body.id) === Number(asked)) {
        recordFinding({ sim: SIM, id: "A-ROB-3-client-id", product: "AcreOS", sev: "P1", area: "data-integrity",
          title: "POST /api/leads accepted a client-supplied id", evidence: `asked id ${asked} → created id ${r.body.id}` });
      }
    }
    if (name === "extra-fields" && r.status < 300 && r.body?.id) {
      const row = await db.query(`SELECT organization_id, created_at FROM leads WHERE id=$1`, [r.body.id]);
      if (!row.rows[0]) throw new Error("mass-assignment probe: created lead not found in DB — the check would be vacuous");
      if (row.rows[0].organization_id !== orgId) {
        recordFinding({ sim: SIM, id: "A-ROB-3-mass-assign", product: "AcreOS", sev: "P0", area: "tenant-isolation",
          title: "Client-supplied organizationId/createdAt were persisted on lead create (mass assignment)",
          evidence: JSON.stringify(row.rows[0]) });
      }
    }
    if (name === "unicode" && r.status < 300 && r.body?.id) {
      const back = await c.get(`/api/leads/${r.body.id}`);
      if (back.body?.firstName && !back.body.firstName.includes("Zoë")) {
        recordFinding({ sim: SIM, id: "A-ROB-3-unicode", product: "AcreOS", sev: "P2", area: "data-integrity",
          title: "Unicode in a name field did not round-trip", evidence: back.body.firstName });
      }
    }
  }

  // ── 4. CSV import realism: BOM, CRLF, quoted commas, 10k rows ───────────
  {
    const header = "First Name,Last Name,Property Address,County,State,Acreage,Email,Phone\r\n";
    const row = (i: number) => `"Rob ${i}","Csv, Jr.","${i} Import Way","Cochise","AZ","${(i % 40) + 1}","csv${i}@example.com","+1500555${String(i).padStart(4, "0")}"\r\n`;
    const small = "﻿" + header + Array.from({ length: 200 }, (_, i) => row(i)).join("");
    const big = header + Array.from({ length: 10_001 }, (_, i) => row(i)).join("");
    for (const [name, csv] of [["bom-crlf-200", small], ["10001-rows", big]] as const) {
      const fd = new FormData();
      fd.append("file", new Blob([csv], { type: "text/csv" }), `${name}.csv`);
      const t0 = performance.now();
      const r = await c.call("POST", "/api/leads/import", undefined, { raw: fd });
      const ms = Math.round(performance.now() - t0);
      recordMetric(SIM, `csv:${name}`, { status: r.status, ms, body: r.text.slice(0, 200) });
      if (r.status >= 500 || r.status === 0) {
        recordFinding({ sim: SIM, id: `A-ROB-4-${name}`, product: "AcreOS", sev: "P1", area: "robustness",
          title: `CSV import (${name}) returned ${r.status}`, evidence: r.text.slice(0, 300) });
      }
      if (name === "bom-crlf-200" && r.status < 300) {
        const n = await db.query(`SELECT count(*)::int AS n FROM leads WHERE organization_id=$1 AND last_name='Csv, Jr.'`, [orgId]);
        recordMetric(SIM, "csv:bom-crlf-200 rows", n.rows[0].n);
        if (n.rows[0].n === 0) {
          recordFinding({ sim: SIM, id: "A-ROB-4-bom", product: "AcreOS", sev: "P2", area: "import",
            title: "A UTF-8 BOM + CRLF CSV (what Excel on Windows exports) imported 0 leads", evidence: r.text.slice(0, 300) });
        }
      }
    }
  }

  // ── 5. List endpoints under a realistic page: pagination + latency ──────
  {
    const probes = ["/api/leads", "/api/leads?page=1&limit=50", "/api/leads?limit=100000", "/api/leads?page=-1", "/api/leads?page=abc", "/api/deals", "/api/properties", "/api/notes", "/api/campaigns", "/api/inbox", "/api/dashboard/today", "/api/auth/user"];
    for (const p of probes) {
      const times: number[] = [];
      let last: any = null;
      for (let i = 0; i < 5; i++) { last = await c.get(p); times.push(last.ms); }
      recordMetric(SIM, `latency ${p}`, { status: last.status, p50: Math.round(percentile(times, 50)), p95: Math.round(percentile(times, 95)), bytes: last.text.length });
      if (last.status >= 500) {
        recordFinding({ sim: SIM, id: `A-ROB-5-${p}`, product: "AcreOS", sev: "P1", area: "robustness", title: `GET ${p} returned ${last.status}`, evidence: last.text.slice(0, 300) });
      }
      const rowsBack = Array.isArray(last.body) ? last.body : Array.isArray(last.body?.data) ? last.body.data : null;
      if (p.includes("limit=100000") && last.status === 200 && rowsBack === null) throw new Error("limit probe: unrecognised list shape — the check would be vacuous");
      if (p.includes("limit=100000") && last.status === 200 && rowsBack && rowsBack.length > 1000) {
        recordFinding({ sim: SIM, id: "A-ROB-5-limit", product: "AcreOS", sev: "P2", area: "performance",
          title: "GET /api/leads?limit=100000 honoured the limit (no server-side cap)", evidence: `returned ${rowsBack!.length} rows, ${last.text.length} bytes` });
      }
    }
  }

  // ── 6. 404/405 shapes and request-id propagation ────────────────────────
  {
    const r404 = await c.get("/api/this-route-does-not-exist");
    const r405 = await c.call("DELETE", "/api/auth/user");
    const rid = r404.headers.get("x-request-id");
    recordMetric(SIM, "404 shape", { status: r404.status, body: r404.text.slice(0, 160), requestId: !!rid });
    recordMetric(SIM, "405 shape", { status: r405.status, body: r405.text.slice(0, 160) });
    if (r404.status === 200 && r404.text.includes("<!DOCTYPE")) {
      recordFinding({ sim: SIM, id: "A-ROB-6", product: "AcreOS", sev: "P3", area: "api-contract",
        title: "Unknown /api/* path returns the SPA HTML with 200 instead of a JSON 404", evidence: r404.text.slice(0, 120) });
    }
  }

  await db.end();
  console.log(`[${SIM}] done`);
}

main().catch((e) => { console.error(e); process.exit(1); });
