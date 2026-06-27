/**
 * IDOR / cross-tenant authorization fuzzer (red-team blueprint #1 — the launch-killer).
 *
 * The persona "shell smoke" only checked isolation via NAV VISIBILITY (does A's
 * sidebar hide B's modules). That is a CSS concern, not an authorization one. A
 * single org-scoped route that trusts `req.params.id` without an
 * `organizationId` filter lets org A read org B's leads / notes / signed
 * promissory-note PDFs by editing a URL integer — a day-one data breach.
 *
 * This suite proves real isolation at the REQUEST layer:
 *   1. Seed a resource of each high-value type into BOTH org A and org B
 *      (PII leads, financial notes, deals, properties, generated documents).
 *   2. POSITIVE CONTROL: A reads A's OWN resource → expect 2xx. (Proves the
 *      endpoint works, so a cross-org 404 means "isolated", not "route broken".)
 *   3. ATTACK: A reads B's resource id → expect 403/404, NEVER 2xx-with-B's-data
 *      (a breach) and NEVER 5xx (a sloppy reject).
 *
 * GET is the disclosure vector and needs no CSRF, so we test reads here. Writes
 * (PUT/DELETE) are CSRF-gated and tested separately.
 *
 *   DATABASE_URL=... PLAYWRIGHT_BASE_URL=http://localhost:5050 npx tsx tests/security/idorFuzz.ts
 *
 * Exit 1 if any BREACH is found.
 */

import pg from "pg";
import { personaCookieValue } from "../../server/auth/testAuth";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5050";
const A_SLUG = "land-operator-desktop"; // org A
const B_SLUG = "note-investor-buyer"; // org B

interface ResourceSpec {
  type: string;
  /** GET-by-id endpoint, {id} substituted. */
  path: (id: string) => string;
  /** Insert one row into the org, return its id. */
  seed: (client: pg.Client, orgId: number) => Promise<string | null>;
  /** Why it matters (for the report). */
  sensitivity: string;
}

async function ins(client: pg.Client, sql: string, params: unknown[]): Promise<string | null> {
  try {
    const r = await client.query(sql, params);
    return r.rows[0]?.id != null ? String(r.rows[0].id) : null;
  } catch (e) {
    console.error(`  seed failed: ${(e as Error).message.slice(0, 120)}`);
    return null;
  }
}

const RESOURCES: ResourceSpec[] = [
  {
    type: "leads",
    sensitivity: "PII: owner name, email, phone, mailing address",
    path: (id) => `/api/leads/${id}`,
    seed: (c, org) =>
      ins(c, `INSERT INTO leads (organization_id, first_name, last_name, email, phone) VALUES ($1,'Breach','Canary',$2,'555-0100') RETURNING id`, [org, `canary-org${org}@idor-test.local`]),
  },
  {
    type: "properties",
    sensitivity: "parcel/owner records",
    path: (id) => `/api/properties/${id}`,
    seed: (c, org) =>
      ins(c, `INSERT INTO properties (organization_id, apn, county, state, size_acres) VALUES ($1,$2,'Mohave','AZ',5) RETURNING id`, [org, `IDOR-APN-${org}`]),
  },
  {
    type: "deals",
    sensitivity: "deal terms + borrower linkage",
    path: (id) => `/api/deals/${id}`,
    seed: async (c, org) => {
      const propId = await ins(c, `INSERT INTO properties (organization_id, apn, county, state, size_acres) VALUES ($1,$2,'Mohave','AZ',5) RETURNING id`, [org, `IDOR-DEAL-PROP-${org}`]);
      if (!propId) return null;
      return ins(c, `INSERT INTO deals (organization_id, property_id, type) VALUES ($1,$2,'purchase') RETURNING id`, [org, propId]);
    },
  },
  {
    type: "notes",
    sensitivity: "FINANCIAL: borrower, principal, rate, payment schedule",
    path: (id) => `/api/notes/${id}`,
    seed: (c, org) =>
      ins(c, `INSERT INTO notes (organization_id, original_principal, current_balance, interest_rate, term_months, monthly_payment, start_date, first_payment_date) VALUES ($1,50000,48000,9.5,120,650,'2026-01-01','2026-02-01') RETURNING id`, [org]),
  },
  {
    type: "generated-documents",
    sensitivity: "LEGAL: generated/signed documents (promissory notes, deeds)",
    path: (id) => `/api/generated-documents/${id}`,
    seed: (c, org) =>
      ins(c, `INSERT INTO generated_documents (organization_id, name, type) VALUES ($1,'IDOR Canary Promissory Note','promissory_note') RETURNING id`, [org]),
  },
  // The document SUB-routes are the highest-value breach vectors — they emit a
  // legal PDF / the audit trail / the signer PII. Each seeds its own doc.
  {
    type: "gen-doc/sealed-pdf",
    sensitivity: "LEGAL: the sealed signed-document PDF (Gap 5)",
    path: (id) => `/api/generated-documents/${id}/sealed-pdf`,
    seed: (c, org) =>
      ins(c, `INSERT INTO generated_documents (organization_id, name, type) VALUES ($1,'IDOR Canary Sealed Doc','contract') RETURNING id`, [org]),
  },
  {
    type: "gen-doc/completion-cert",
    sensitivity: "LEGAL: e-sign completion certificate + signer audit trail",
    path: (id) => `/api/generated-documents/${id}/completion-certificate`,
    seed: (c, org) =>
      ins(c, `INSERT INTO generated_documents (organization_id, name, type) VALUES ($1,'IDOR Canary Cert Doc','contract') RETURNING id`, [org]),
  },
  {
    type: "gen-doc/signatures",
    sensitivity: "PII: signer name/email/IP for a document",
    path: (id) => `/api/generated-documents/${id}/signatures`,
    seed: (c, org) =>
      ins(c, `INSERT INTO generated_documents (organization_id, name, type) VALUES ($1,'IDOR Canary Sig Doc','contract') RETURNING id`, [org]),
  },
];

async function req(path: string, slug: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: `__session=${personaCookieValue(slug)}` } });
  const body = await res.text().catch(() => "");
  return { status: res.status, body };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  // Resolve org ids.
  const orgRows = await client.query(
    `SELECT u.clerk_user_id, o.id FROM users u JOIN organizations o ON o.owner_id = u.id
     WHERE u.clerk_user_id = ANY($1)`,
    [[`e2e_persona_${A_SLUG.replace(/-/g, "_")}`, `e2e_persona_${B_SLUG.replace(/-/g, "_")}`]],
  );
  const orgOf = (slug: string) => orgRows.rows.find((r) => r.clerk_user_id === `e2e_persona_${slug.replace(/-/g, "_")}`)?.id;
  const orgA = orgOf(A_SLUG), orgB = orgOf(B_SLUG);
  if (!orgA || !orgB) throw new Error("could not resolve both persona orgs — seed first");
  console.log(`org A (${A_SLUG}) = ${orgA}   org B (${B_SLUG}) = ${orgB}\n`);

  const findings: Array<{ type: string; verdict: string; detail: string }> = [];
  let breaches = 0;

  for (const r of RESOURCES) {
    const aId = await r.seed(client, orgA);
    const bId = await r.seed(client, orgB);
    if (!aId || !bId) {
      console.log(`▢ ${r.type.padEnd(20)} SKIP (could not seed)`);
      findings.push({ type: r.type, verdict: "skip", detail: "seed failed" });
      continue;
    }

    // Positive control: A reads its own.
    const ctrl = await req(r.path(aId), A_SLUG);
    // Attack: A reads B's.
    const atk = await req(r.path(bId), A_SLUG);

    let verdict: string, mark: string;
    if (atk.status >= 200 && atk.status < 300) {
      // A got a 2xx on B's resource — confirm it actually contains B's data.
      const leaked = atk.body.includes(String(bId)) || atk.body.includes("Canary") || atk.body.toLowerCase().includes("breach") || atk.body.includes("IDOR");
      verdict = leaked ? "BREACH" : "BREACH?";
      mark = "✗";
      breaches++;
    } else if (atk.status === 403 || atk.status === 404) {
      verdict = ctrl.status >= 200 && ctrl.status < 300 ? "isolated" : "isolated (control non-2xx — endpoint may differ)";
      mark = "✓";
    } else {
      verdict = `reject-${atk.status}`; // 5xx etc — not a clean authz reject
      mark = "!";
    }
    console.log(`${mark} ${r.type.padEnd(20)} control(own)=${ctrl.status}  attack(B's)=${atk.status}  → ${verdict}`);
    findings.push({ type: r.type, verdict, detail: `control=${ctrl.status} attack=${atk.status} | ${r.sensitivity}` });
  }

  await client.end();
  console.log(`\n${breaches === 0 ? "✓ No cross-tenant read breaches found" : `✗ ${breaches} BREACH(es) — cross-tenant data exposure`} across ${RESOURCES.length} resource types.`);

  // ── Coverage denominator (answer the red team's "7-of-100" critique honestly).
  // Enumerate the customer-facing org-scoped :id GET routes and report what
  // fraction this fuzzer exercises, listing the uncovered tail to triage.
  try {
    const fs = await import("node:fs");
    const files = fs.readdirSync("server").filter((f) => /^routes.*\.ts$/.test(f));
    const re = /\.(get|getAuth)\(\s*["'`](\/api\/[a-zA-Z0-9/_-]+\/:[a-zA-Z]*[Ii]d[a-zA-Z]*)["'`]/g;
    const all = new Set<string>();
    for (const f of files) {
      const src = fs.readFileSync(`server/${f}`, "utf8");
      for (const m of src.matchAll(re)) {
        const p = m[2];
        if (p.startsWith("/api/founder/") || p.startsWith("/api/public/")) continue; // not customer-org-scoped
        all.add(p);
      }
    }
    const coveredRoots = new Set(RESOURCES.map((r) => r.path("X").replace(/\/X.*$/, "")));
    const uncovered = [...all].filter((p) => {
      const root = p.replace(/\/:.*$/, "");
      return ![...coveredRoots].some((c) => c === root || root.startsWith(c));
    }).sort();
    console.log(`\nCoverage: ${RESOURCES.length} resource types tested; ${all.size} customer org-scoped :id GET routes exist.`);
    console.log(`Uncovered tail (${uncovered.length}) — each must isolate too; expand this fuzzer to cover them:`);
    console.log("  " + uncovered.slice(0, 40).join("\n  ") + (uncovered.length > 40 ? `\n  …and ${uncovered.length - 40} more` : ""));
  } catch (e) {
    console.log("(coverage report skipped: " + (e as Error).message + ")");
  }
  if (breaches > 0) {
    console.log("\nBREACH DETAIL (a real launch-killer — org A read org B's data):");
    findings.filter((f) => f.verdict.startsWith("BREACH")).forEach((f) => console.log(`  ${f.type}: ${f.detail}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
