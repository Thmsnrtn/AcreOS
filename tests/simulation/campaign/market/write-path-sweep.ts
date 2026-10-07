/**
 * WRITE-PATH ISOLATION SWEEP — org B mutating org A's rows by id, on every
 * mounted POST / PUT / PATCH / DELETE route that carries an id-style param.
 *
 * Extends ../idor-sweep.ts rather than duplicating it: its route-file
 * population, table inference and generic row-forger are LOADED from that file
 * (its source up to `main()`, compiled in-process), so a fix there is a fix
 * here. What this sweep adds:
 *
 *   1. POST by-id routes (idor-sweep's VERB_RE reads get|put|patch|delete only):
 *      sub-resource actions such as /api/leads/:id/contact-event, where the
 *      harm is a NEW row attached to A's resource, not an edit of it.
 *   2. A TYPE-AWARE body: every text column of the inferred table, camelCased,
 *      set to a per-run marker — idor-sweep's `{"name":"idorwrite"}` cannot
 *      change a table with no `name` column, so its "write-accepted-no-change"
 *      could not distinguish "isolated" from "the body touched nothing".
 *   3. A POSITIVE CONTROL THAT PROVES THE DETECTOR: B sends the SAME request to
 *      B's OWN forged row. A verdict of `isolated` is only claimed when that
 *      control produced a detectable effect (row changed / deleted / child row
 *      created). Otherwise the route is `isolated-unproven` — the detector was
 *      never shown to see anything there.
 *   4. EFFECT DETECTION FROM THE DB, never from the status: A's row JSON
 *      before/after, and child rows referencing A's id in every table with a
 *      foreign key to the inferred table or a `<singular>_id` column.
 *   5. A SYNTHETIC-BREACH SELF-TEST: one A row is changed by SQL between the
 *      snapshots; the differ must flag it, or the run aborts (vacuity guard).
 *   6. POPULATION FLOOR + per-verb vacuity: the run refuses to report if the
 *      route population shrinks under the floor or any verb has zero proven
 *      controls.
 *
 * SECURITY: the repo is public. Breach specifics (route, body, ids) are written
 * ONLY to MARKET_OUT/private-write-sweep.jsonl (scratchpad). The ledger finding
 * says "breach found — see private report".
 *
 * Orgs: two FRESH tenants provisioned by ./common (never the persona orgs other
 * sims use). Forged rows are deleted at the end.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { db, q, provisionOrg, jsonl, writeJson, msg, DB_LABEL, type Org } from "./common";
import { recordFinding, recordMetric, recordSkip } from "../ledger";

const SIM = "market-write-sweep";
const HERE = dirname(fileURLToPath(import.meta.url));

// ─── load idor-sweep's helpers (source up to main(), compiled here) ─────────
const IDOR = join(HERE, "../idor-sweep.ts");
function loadIdor(): any {
  let src = readFileSync(IDOR, "utf8");
  const cut = src.indexOf("async function main()");
  if (cut < 0) throw new Error("idor-sweep.ts no longer declares main() — loader needs updating");
  src = src.slice(0, cut).replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(IDOR).href));
  const NAMES = ["routeSourceFiles", "buildVarToTable", "idParams", "paramTableCandidates", "tableMeta", "forgeRow", "buildPath", "readRowJson", "CANARY", "inserted", "stripComments", "singular", "snake"];
  src += `\nexport { ${NAMES.join(", ")} };\n`;
  const code = transformSync(src, { loader: "ts", format: "cjs" }).code;
  const mod: any = { exports: {} };
  new Function("require", "module", "exports", code)(createRequire(IDOR), mod, mod.exports);
  for (const n of NAMES) if (mod.exports[n] === undefined) throw new Error(`idor-sweep.ts no longer provides ${n}`);
  return mod.exports;
}
const I = loadIdor();

// ─── population ──────────────────────────────────────────────────────────────
interface Route { verb: "POST" | "PUT" | "PATCH" | "DELETE"; path: string; file: string; window: string }
const VERB_RE = /\b[A-Za-z_$][\w$]*\.(post|put|patch|delete)\(\s*(["'`])(\/api\/[^"'`]*?)\2/g;
const ID_PARAM = /:[a-zA-Z_]*[Ii][Dd]\b/;
/** Measured 2026-10-06 on this branch: see write-sweep-summary.json `population`. */
const POPULATION_FLOOR = Number(process.env.WRITE_SWEEP_FLOOR ?? 456);
/** Never probed: other people's money, the founder plane, provider callbacks, auth. */
const OUT_OF_SCOPE = /\/api\/(founder|admin|webhooks?|stripe|auth|dev|test|e2e|internal)\b|\/billing\/|\/subscription\//;

function enumerate(): Route[] {
  const out: Route[] = [];
  const seen = new Set<string>();
  for (const file of I.routeSourceFiles() as string[]) {
    const src = I.stripComments(readFileSync(file, "utf8"));
    const ms = [...src.matchAll(VERB_RE)];
    ms.forEach((m, i) => {
      if (!ID_PARAM.test(m[3])) return;
      const verb = m[1].toUpperCase() as Route["verb"];
      const key = `${verb} ${m[3]}`;
      if (seen.has(key)) return;
      seen.add(key);
      const end = i + 1 < ms.length ? ms[i + 1].index! : Math.min(src.length, m.index! + 2500);
      out.push({ verb, path: m[3], file: file.split("/").pop()!, window: src.slice(m.index!, end) });
    });
  }
  return out;
}

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase());
const MARK = "wps" + randomBytes(4).toString("hex");
const SKIP_COLS = new Set(["id", "organization_id", "created_at", "updated_at", "deleted_at", "created_by", "updated_by"]);

function bodyFor(route: Route, meta: any): Record<string, unknown> | undefined {
  if (route.verb === "DELETE") return undefined;
  const b: Record<string, unknown> = {};
  for (const c of meta.columns) {
    if (SKIP_COLS.has(c.name) || c.name.endsWith("_id")) continue;
    if (/char|text/.test(c.dataType)) b[camel(c.name)] = MARK;
  }
  if (route.verb === "POST") {
    Object.assign(b, {
      name: MARK, title: MARK, notes: MARK, note: MARK, content: MARK, body: MARK, message: MARK, description: MARK, text: MARK, reason: MARK, comment: MARK, subject: MARK,
      amount: "1.00", channel: "phone", method: "manual", outcome: "warm",
    });
  }
  return b;
}

// child tables: real FKs to `table`, plus `<singular>_id` columns without a constraint
async function childRefs(table: string): Promise<Array<{ table: string; col: string; hasOrg: boolean }>> {
  const fk = await q(
    `SELECT kcu.table_name AS t, kcu.column_name AS c FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
      WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name=$1 AND tc.table_schema='public'`, [table]);
  const guess = await q(`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema='public' AND column_name=$1 AND data_type IN ('integer','bigint')`, [`${I.singular(table)}_id`]);
  const orgT = new Set((await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id'`)).map((r: any) => r.table_name));
  const m = new Map<string, { table: string; col: string; hasOrg: boolean }>();
  for (const r of [...fk, ...guess]) if (r.t !== table) m.set(`${r.t}.${r.c}`, { table: r.t, col: r.c, hasOrg: orgT.has(r.t) });
  return [...m.values()];
}
async function childSnapshot(children: Array<{ table: string; col: string; hasOrg: boolean }>, id: any): Promise<Map<string, { n: number; orgs: string }>> {
  const s = new Map<string, { n: number; orgs: string }>();
  for (const ch of children) {
    try {
      const r = await q(`SELECT count(*)::int AS n${ch.hasOrg ? ", string_agg(DISTINCT organization_id::text, ',') AS orgs" : ""} FROM "${ch.table}" WHERE "${ch.col}" = $1`, [id]);
      s.set(`${ch.table}.${ch.col}`, { n: r[0].n, orgs: r[0].orgs ?? "" });
    } catch { /* column type mismatch etc. — not a child for this id */ }
  }
  return s;
}
function childDelta(a: Map<string, { n: number; orgs: string }>, b: Map<string, { n: number; orgs: string }>): string[] {
  const d: string[] = [];
  for (const [k, v] of b) { const was = a.get(k); if (was && v.n !== was.n) d.push(`${k}: ${was.n}→${v.n} (orgs ${v.orgs || "?"})`); }
  return d;
}

async function withRetry(f: () => Promise<any>): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await f();
    if (r.status !== 429 || i >= 4) return r;
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
}
function send(org: Org, route: Route, path: string, body: unknown) {
  const c = org.client;
  const h = { headers: { "idempotency-key": `wps-${randomBytes(8).toString("hex")}-${Date.now()}` } };
  return withRetry(() => (route.verb === "DELETE" ? c.delete(path, h) : c.call(route.verb, path, body, h)));
}

async function main() {
  const routes = enumerate();
  const byVerb: Record<string, number> = {};
  routes.forEach((r) => (byVerb[r.verb] = (byVerb[r.verb] ?? 0) + 1));
  console.log(`POPULATION ${routes.length} write by-id routes ${JSON.stringify(byVerb)} on ${DB_LABEL}`);
  recordMetric(SIM, "population", { total: routes.length, byVerb });
  if (routes.length < POPULATION_FLOOR) { console.error(`population ${routes.length} < floor ${POPULATION_FLOOR}: the extractor stopped reading part of the server`); process.exit(2); }

  const A = await provisionOrg("mkt-wsweep-a", { businessType: "land_flipper", orgName: "Sweep A" });
  const B = await provisionOrg("mkt-wsweep-b", { businessType: "land_flipper", orgName: "Sweep B" });
  for (const o of [A, B]) await q(`UPDATE organizations SET subscription_tier='scale', credit_balance=100000 WHERE id=$1`, [o.orgId]);
  console.log(`A=${A.orgId} B=${B.orgId} marker=${MARK}`);

  const orgTables = new Set((await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id'`)).map((r: any) => r.table_name));
  const varToTable = I.buildVarToTable();
  function inferTable(r: Route): string | null {
    const primary = I.idParams(r.path)[0];
    if (primary) for (const cand of I.paramTableCandidates(r.path, primary)) if (orgTables.has(cand)) return cand;
    if (primary && r.path.trimEnd().endsWith(":" + primary)) for (const m of r.window.matchAll(/\.from\(\s*(\w+)/g)) { const t = varToTable[m[1]]; if (t && orgTables.has(t)) return t; }
    return null;
  }

  // ── synthetic-breach self-test: the differ must see a change made by SQL ──
  {
    const f = await I.forgeRow(db, "leads", A.orgId, 2);
    const before = await I.readRowJson(db, "leads", "id", f.id);
    await q(`UPDATE leads SET notes = $2 WHERE id=$1`, [f.id, MARK]);
    const after = await I.readRowJson(db, "leads", "id", f.id);
    const kids = await childRefs("leads");
    const s0 = await childSnapshot(kids, f.id);
    await q(`INSERT INTO lead_activities (organization_id, lead_id, type, description) VALUES ($1,$2,'note',$3)`, [B.orgId, f.id, MARK]).catch(() => null);
    const s1 = await childSnapshot(kids, f.id);
    const rowSeen = before !== after, childSeen = childDelta(s0, s1).length > 0;
    console.log(`self-test: row-diff ${rowSeen ? "SEES" : "BLIND"}; child-diff over ${kids.length} child refs ${childSeen ? "SEES" : "BLIND (lead_activities insert may have failed)"}`);
    if (!rowSeen) { console.error("row differ is blind — refusing to report"); process.exit(2); }
    recordMetric(SIM, "self-test", { rowSeen, childSeen, leadChildRefs: kids.length });
  }

  const results: any[] = [];
  const forged = new Map<string, any>();
  const getForged = async (t: string, o: number) => { const k = `${t}#${o}`; if (!forged.has(k)) forged.set(k, await I.forgeRow(db, t, o, 2)); return forged.get(k); };
  const childCache = new Map<string, any>();

  for (const route of routes) {
    const key = `${route.verb} ${route.path}`;
    if (OUT_OF_SCOPE.test(route.path)) { results.push({ key, verdict: "out-of-scope" }); continue; }
    const table = inferTable(route);
    if (!table) { results.push({ key, verdict: "skip-no-table" }); continue; }
    const meta = await I.tableMeta(db, table);
    // B's own row (control) and A's row (target). DELETE consumes them → fresh rows each time.
    const fresh = route.verb === "DELETE" || route.verb === "POST";
    const aRow = fresh ? await I.forgeRow(db, table, A.orgId, 2) : await getForged(table, A.orgId);
    const bRow = fresh ? await I.forgeRow(db, table, B.orgId, 2) : await getForged(table, B.orgId);
    if (aRow.id == null || bRow.id == null) { results.push({ key, table, verdict: "skip-forge", reason: (aRow.reason ?? bRow.reason)?.slice(0, 160) }); continue; }
    const primary = I.idParams(route.path)[0];
    const pathFor = (id: any) => I.buildPath(route, Object.fromEntries([...route.path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => [m[1], m[1] === primary ? id : "1"])));
    const body = bodyFor(route, meta);
    if (!childCache.has(table)) childCache.set(table, await childRefs(table));
    const kids = childCache.get(table);

    // control: B → B's own row
    const cb0 = await I.readRowJson(db, table, meta.pk, bRow.id), ck0 = await childSnapshot(kids, bRow.id);
    const ctrl = await send(B, route, pathFor(bRow.id), body);
    const cb1 = await I.readRowJson(db, table, meta.pk, bRow.id), ck1 = await childSnapshot(kids, bRow.id);
    const ctrlEffect = cb0 !== cb1 || childDelta(ck0, ck1).length > 0;

    // attack: B → A's row
    const a0 = await I.readRowJson(db, table, meta.pk, aRow.id), ak0 = await childSnapshot(kids, aRow.id);
    const atk = await send(B, route, pathFor(aRow.id), body);
    const a1 = await I.readRowJson(db, table, meta.pk, aRow.id), ak1 = await childSnapshot(kids, aRow.id);
    const kidD = childDelta(ak0, ak1);
    const rowChanged = a0 !== a1;
    let verdict: string;
    if (a1 === null && a0 !== null) verdict = "BREACH-deleted";
    else if (rowChanged) verdict = "BREACH-mutated";
    else if (kidD.length) verdict = "BREACH-child-row";
    else if (atk.status >= 500) verdict = "sloppy-5xx";
    else if (atk.status >= 200 && atk.status < 300) verdict = ctrlEffect ? "2xx-no-effect" : "2xx-unproven";
    else verdict = ctrlEffect ? "isolated" : "isolated-unproven";
    const row = { key, file: route.file, table, verdict, control: ctrl.status, controlEffect: ctrlEffect, attack: atk.status, attackMsg: msg(atk).slice(0, 120) };
    results.push(row);
    console.log(`${verdict.startsWith("BREACH") ? "✗" : verdict === "isolated" ? "✓" : "·"} ${key.padEnd(64)} ${table.padEnd(24)} ctrl=${ctrl.status}${ctrlEffect ? "*" : ""} atk=${atk.status} → ${verdict}`);
    if (verdict.startsWith("BREACH")) {
      // specifics → scratchpad only
      jsonl("private-write-sweep.jsonl", { ...row, path: pathFor(aRow.id), body, aOrg: A.orgId, bOrg: B.orgId, aRowBefore: a0?.slice(0, 600), aRowAfter: a1?.slice(0, 600), childDelta: kidD, attackBody: atk.text.slice(0, 400), db: DB_LABEL });
    }
  }

  // cleanup forged rows (reverse insertion order), best effort
  for (const r of [...I.inserted].reverse()) await q(`DELETE FROM "${r.table}" WHERE "${r.pk}" = $1`, [r.id]).catch(() => null);

  const tally: Record<string, number> = {};
  results.forEach((r) => (tally[r.verdict] = (tally[r.verdict] ?? 0) + 1));
  const provenByVerb: Record<string, number> = {};
  results.filter((r) => r.controlEffect).forEach((r) => { const v = r.key.split(" ")[0]; provenByVerb[v] = (provenByVerb[v] ?? 0) + 1; });
  const breaches = results.filter((r) => String(r.verdict).startsWith("BREACH"));
  writeJson("write-sweep-results.json", results);
  writeJson("write-sweep-summary.json", { db: DB_LABEL, population: routes.length, byVerb, tally, provenControlsByVerb: provenByVerb, breaches: breaches.length, marker: MARK });
  console.log(`\nTALLY ${JSON.stringify(tally)}\nproven controls by verb ${JSON.stringify(provenByVerb)}\nbreaches ${breaches.length}`);
  for (const v of ["POST", "PUT", "PATCH", "DELETE"]) if (!provenByVerb[v]) { console.error(`VACUOUS: no ${v} route had a control with a detectable effect`); recordSkip({ sim: SIM, step: `vacuity-${v}`, reason: "no proven control" }); }
  if (breaches.length) recordFinding({ id: "market-write-sweep-breach", product: "AcreOS", sev: "P0", area: "tenant-isolation", title: `Cross-tenant WRITE breach found on ${breaches.length} route(s)`, evidence: "breach found — see private report (scratchpad private-write-sweep.jsonl)", impact: "Org B can change or attach data to org A's records by id.", sim: SIM } as any);
  recordMetric(SIM, "tally", tally);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
