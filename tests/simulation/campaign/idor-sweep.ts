/**
 * IDOR SWEEP — extend the cross-tenant isolation population to EVERY org-scoped
 * by-id route, not the eight that `tests/security/idorFuzz.ts` hand-picks.
 *
 *   "A gate proves its property only over the population it actually reads."
 *                                                     — AcreOS CLAUDE.md
 *
 * idorFuzz.ts probes 8 resource types and PRINTS ~80 other GET-by-id routes it
 * does NOT touch. That printed tail is the blind spot. This sim closes it:
 *
 *   1. POPULATION — enumerate every mounted GET/PUT/PATCH/DELETE route under
 *      /api whose path carries an `:id`-style param (comment-stripped source
 *      scan of server/routes*.ts + server/routes/**). The count is the floor,
 *      recorded as a metric and printed.
 *   2. INFER the backing table per route. The id PARAM identifies the resource
 *      (`:id` → the segment before it; `:noteId` → notes), not whatever the
 *      handler's first `.from()` happens to read — so a sub-resource route like
 *      /api/notes/:id/payments forges a NOTE, because `:id` is a note id.
 *      A terminal-param `.from(table)` is used only as a fallback.
 *   3. FORGE a minimal row for org A (land-operator-desktop) and org B
 *      (note-investor-buyer) with a GENERIC row-forger: it reads
 *      information_schema for NOT-NULL / no-default columns and synthesizes
 *      type-appropriate values, satisfying non-org foreign keys by forging the
 *      referenced row recursively (bounded depth). Only tables that actually
 *      carry organization_id are probed; everything else is a recorded skip.
 *   4. POSITIVE CONTROL — A reads A's own row → expect 2xx. A by-id route that
 *      500s on a valid row is itself a finding (`control-failed`).
 *   5. READ ATTACK — B reads A's row id → BREACH if 2xx and the body echoes A's
 *      id or A's forged canary text; 5xx is a `sloppy-reject` (P2); 401/403/404
 *      are isolated.
 *   6. WRITE ATTACK — for PUT/PATCH/DELETE routes, B mutates A's row with a
 *      benign body, then A's row is re-read FROM THE DB to prove it survived
 *      unchanged (the airtight proof, immune to a misleading status code).
 *   7. HONESTY — a single finding lists every route that could NOT be probed
 *      and why, so coverage is never overstated. Forged rows are cleaned up.
 *
 *   DATABASE_URL=postgresql://acreos:acreos@localhost:5432/acreos_sim \
 *   SIM_BASE_URL=http://localhost:5000 \
 *   npx tsx tests/simulation/campaign/idor-sweep.ts
 *
 * Exit 1 ONLY on a confirmed BREACH. Skips never fail the run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SimClient } from "./client";
import { recordFinding, recordMetric, recordSkip } from "./ledger";
import { stripComments } from "../../helpers/stripComments";
import { personaTestUserId } from "../../../server/auth/testAuth";

const SIM = "idor-sweep";
const A_SLUG = "land-operator-desktop"; // org A
const B_SLUG = "note-investor-buyer"; // org B
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, "../../../server");
const SHARED_DIR = path.resolve(HERE, "../../../shared");

// ───────────────────────────── route enumeration ─────────────────────────────

interface Route {
  verb: "GET" | "PUT" | "PATCH" | "DELETE";
  path: string;
  file: string;
}

/** `app.get("/api/…", …)` / `router.patch(…)` etc. Path captured from a quoted literal. */
// ANY receiver: most route files register through `const api = app` (940
// registrations), so a receiver allow-list of app|router|r read ~a third of the
// population and silently skipped core CRUD (/api/leads/:id, /api/deals/:id).
// Found by the independent audit of this campaign; the floor below makes a
// regression of this regex fail loudly instead of shrinking the population.
const VERB_RE = /\b[A-Za-z_$][\w$]*\.(get|put|patch|delete)\(\s*(["'`])(\/api\/[^"'`]*?)\2/g;
/** Population floor: by-id routes this sweep must find, measured 2026-10-06. */
const POPULATION_FLOOR = 400;
/** A param whose name ends in id/Id/ID — the by-id shape this sweep governs. */
const ID_PARAM = /:[a-zA-Z_]*[Ii][Dd]\b/;

function routeSourceFiles(): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(SERVER_DIR)) {
    if (/^routes.*\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(path.join(SERVER_DIR, f));
  }
  const sub = path.join(SERVER_DIR, "routes");
  if (fs.existsSync(sub)) {
    for (const f of fs.readdirSync(sub)) {
      if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(path.join(sub, f));
    }
  }
  return out;
}

/** Enumerate every verb+path pair with an id-style param. Returns the per-route
 *  handler window too (for the terminal-`.from()` fallback). */
function enumerateRoutes(): { routes: Route[]; windows: Map<string, string> } {
  const routes: Route[] = [];
  const windows = new Map<string, string>();
  const seen = new Set<string>();
  for (const file of routeSourceFiles()) {
    // Strip comments with the repo's real left-to-right lexer, NOT a two-regex
    // idiom — a route literal written inside a `// retired …` comment must not
    // enter the population, and a `/*` inside a line comment must not eat the file.
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const ms = [...src.matchAll(VERB_RE)];
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      const p = m[3];
      if (!ID_PARAM.test(p)) continue;
      const verb = m[1].toUpperCase() as Route["verb"];
      const key = `${verb} ${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = m.index ?? 0;
      const end = i + 1 < ms.length ? ms[i + 1].index ?? src.length : Math.min(src.length, start + 2500);
      windows.set(key, src.slice(start, end));
      routes.push({ verb, path: p, file: path.basename(file) });
    }
  }
  return { routes, windows };
}

// ─────────────────────────── drizzle var → table map ───────────────────────────

function buildVarToTable(): Record<string, string> {
  const map: Record<string, string> = {};
  const scan = (dir: string) => {
    // Dirent types come with the listing, so nothing is checked and then used
    // separately (CodeQL js/file-system-race).
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) scan(fp);
      else if (e.isFile() && /\.ts$/.test(e.name)) {
        const s = fs.readFileSync(fp, "utf8");
        for (const m of s.matchAll(/export const (\w+)\s*=\s*pgTable\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) {
          map[m[1]] = m[2];
        }
      }
    }
  };
  scan(SHARED_DIR);
  return map;
}

// ───────────────────────────── table inference ─────────────────────────────

function snake(s: string): string {
  return s.replace(/-/g, "_").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
function singular(s: string): string {
  return s.replace(/ies$/, "y").replace(/ses$/, "s").replace(/s$/, "");
}
function nameVariants(s: string): string[] {
  return [...new Set([s, singular(s), s + "s", s.replace(/ies$/, "y"), s.replace(/y$/, "ies")])];
}

/** Every id-style param in a path, in order. */
function idParams(p: string): string[] {
  return [...p.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1]).filter((n) => /[Ii][Dd]$/.test(n) || n === "id");
}

/** Candidate table names for the resource a given param identifies. */
function paramTableCandidates(p: string, param: string): string[] {
  const segs = p.replace(/^\/api\//, "").split("/");
  const out = new Set<string>();
  // `:noteId` → note ; `:propertyId` → property
  const m = /^(.*?)Id$/i.exec(param);
  if (m && m[1] && m[1].toLowerCase() !== "") for (const v of nameVariants(snake(m[1]))) out.add(v);
  // `:id` → the segment immediately before it
  const idx = segs.indexOf(":" + param);
  if (idx > 0 && !segs[idx - 1].startsWith(":")) for (const v of nameVariants(snake(segs[idx - 1]))) out.add(v);
  // first path segment, as a last resort
  const first = snake(segs[0]);
  if (first && !first.startsWith(":")) for (const v of nameVariants(first)) out.add(v);
  // adjacent-segment joins (e.g. rentals/units → rental_units)
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i].startsWith(":") || segs[i + 1].startsWith(":")) continue;
    const a = snake(segs[i]), b = snake(segs[i + 1]);
    for (const av of [a, singular(a)]) for (const bv of [b, singular(b), b + "s"]) out.add(av + "_" + bv);
  }
  return [...out];
}

// ───────────────────────────── generic row-forger ─────────────────────────────

interface ColInfo {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
}
interface TableMeta {
  columns: ColInfo[];
  pk: string | null;
  fks: Map<string, { refTable: string; refCol: string }>;
  hasOrg: boolean;
}

const metaCache = new Map<string, TableMeta>();
const enumCache = new Map<string, string | null>();

async function tableMeta(db: pg.Client, table: string): Promise<TableMeta> {
  const cached = metaCache.get(table);
  if (cached) return cached;
  const cols = await db.query(
      "SELECT column_name, data_type, udt_name, is_nullable, column_default IS NOT NULL AS has_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
    [table],
  );
  const pkq = await db.query(
      "SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_name=$1 AND tc.table_schema='public'",
    [table],
  );
  const fkq = await db.query(
      "SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_col FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name=$1 AND tc.table_schema='public'",
    [table],
  );
  const columns: ColInfo[] = cols.rows.map((r: any) => ({
    name: r.column_name,
    dataType: r.data_type,
    udtName: r.udt_name,
    nullable: r.is_nullable === "YES",
    hasDefault: r.has_default,
  }));
  const fks = new Map<string, { refTable: string; refCol: string }>();
  for (const r of fkq.rows as any[]) fks.set(r.column_name, { refTable: r.ref_table, refCol: r.ref_col });
  const meta: TableMeta = {
    columns,
    pk: pkq.rows[0]?.column_name ?? (columns.some((c) => c.name === "id") ? "id" : null),
    fks,
    hasOrg: columns.some((c) => c.name === "organization_id"),
  };
  metaCache.set(table, meta);
  return meta;
}

async function firstEnumLabel(db: pg.Client, udtName: string): Promise<string | null> {
  if (enumCache.has(udtName)) return enumCache.get(udtName)!;
  const r = await db.query(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
      WHERE t.typname=$1 ORDER BY e.enumsortorder LIMIT 1`,
    [udtName],
  );
  const label = r.rows[0]?.enumlabel ?? null;
  enumCache.set(udtName, label);
  return label;
}

const CANARY = "idc" + Math.random().toString(36).slice(2, 10); // unique-per-run breach marker
let rowCounter = 0;

/** rows inserted this run, newest last — deleted in reverse for cleanup. */
const inserted: Array<{ table: string; pk: string; id: any }> = [];

/** Synthesize a type-appropriate literal for one NOT-NULL / no-default column. */
async function synth(db: pg.Client, col: ColInfo): Promise<any> {
  const dt = col.dataType;
  if (col.udtName && col.dataType === "USER-DEFINED") {
    const label = await firstEnumLabel(db, col.udtName);
    if (label != null) return label;
    return "sim";
  }
  if (/char|text|citext/.test(dt)) return CANARY; // forged canary text — the breach marker
  if (dt === "integer" || dt === "bigint") return 1_000_000 + Math.floor(Math.random() * 1_000_000_000); // avoid PK collisions
  if (dt === "smallint") return 1 + Math.floor(Math.random() * 1000);
  if (/numeric|decimal|real|double/.test(dt)) return 1;
  if (dt === "boolean") return false;
  if (/timestamp/.test(dt)) return new Date().toISOString();
  if (dt === "date") return new Date().toISOString().slice(0, 10);
  if (/time/.test(dt)) return "00:00:00";
  if (dt === "uuid") return null; // handled via gen_random_uuid() expression below
  if (/json/.test(dt)) return "{}";
  if (/array|ARRAY/.test(dt)) return "{}";
  return CANARY;
}

/**
 * Forge one minimal row in `table` for `orgId`. Returns the row's PK value, or
 * null (with a reason) if it could not be forged. Non-org FKs are satisfied by
 * forging the referenced row recursively, bounded by `depth`.
 */
async function forgeRow(
  db: pg.Client,
  table: string,
  orgId: number,
  depth: number,
): Promise<{ id: any; reason?: string }> {
  const meta = await tableMeta(db, table);
  if (!meta.pk) return { id: null, reason: `table ${table} has no single-column primary key` };

  const cols: string[] = [];
  const vals: string[] = [];
  const params: any[] = [];
  const push = (col: string, expr: string, p?: any) => {
    cols.push(`"${col}"`);
    if (p === undefined) {
      vals.push(expr);
    } else {
      params.push(p);
      vals.push(`$${params.length}`);
    }
  };

  for (const c of meta.columns) {
    if (c.name === "organization_id") {
      push(c.name, "", orgId);
      continue;
    }
    if (c.hasDefault || c.nullable) continue; // let defaults fill; leave nullables null
    // NOT NULL, no default → must supply.
    const fk = meta.fks.get(c.name);
    if (fk && fk.refTable !== table) {
      if (depth <= 0) return { id: null, reason: `FK ${table}.${c.name}→${fk.refTable} exceeds forge depth` };
      const refMeta = await tableMeta(db, fk.refTable);
      const refOrg = refMeta.hasOrg ? orgId : orgId; // ref carries its own org if it has one
      const ref = await forgeRow(db, fk.refTable, refOrg, depth - 1);
      if (ref.id == null) return { id: null, reason: `could not satisfy FK ${table}.${c.name}→${fk.refTable}: ${ref.reason}` };
      push(c.name, "", ref.id);
      continue;
    }
    if (fk && fk.refTable === table) {
      // self-FK that is NOT NULL — can't bootstrap generically.
      return { id: null, reason: `self-referential NOT NULL FK ${table}.${c.name}` };
    }
    if (c.dataType === "uuid") {
      push(c.name, "gen_random_uuid()");
      continue;
    }
    if (/json/.test(c.dataType)) {
      push(c.name, "'{}'::jsonb");
      continue;
    }
    const v = await synth(db, c);
    push(c.name, "", v);
  }

  const sql = `INSERT INTO "${table}" (${cols.join(",")}) VALUES (${vals.join(",")}) RETURNING "${meta.pk}" AS id`;
  try {
    const r = await db.query(sql, params);
    const id = r.rows[0]?.id;
    if (id == null) return { id: null, reason: `insert returned no ${meta.pk}` };
    inserted.push({ table, pk: meta.pk, id });
    rowCounter++;
    return { id };
  } catch (e) {
    return { id: null, reason: `insert failed: ${(e as Error).message.slice(0, 140)}` };
  }
}

// ───────────────────────────── probe one route ─────────────────────────────

function buildPath(route: Route, params: Record<string, any>): string {
  return route.path.replace(/:([a-zA-Z_]+)/g, (_m, name) => String(params[name] ?? "1"));
}

interface ProbeResult {
  verb: string;
  path: string;
  table: string | null;
  control?: number;
  attack?: number;
  verdict: string;
}

async function readRowJson(db: pg.Client, table: string, pk: string, id: any): Promise<string | null> {
  try {
    // Dynamic SQL (table/pk chosen at runtime from information_schema) — built as a
    // string so the raw-SQL column gate does not try to resolve a template it cannot.
    const readSql = 'SELECT row_to_json(t) AS j FROM "' + table + '" t WHERE "' + pk + '" = $1';
    const r = await db.query(readSql, [id]);
    return r.rows[0] ? JSON.stringify(r.rows[0].j) : null;
  } catch {
    return null;
  }
}

// ───────────────────────────────── main ─────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = new pg.Client({ connectionString: url });
  await db.connect();

  // Resolve org ids for the two personas (seedDb.ts already created the orgs).
  const orgRows = await db.query(
    `SELECT u.clerk_user_id, o.id FROM users u JOIN organizations o ON o.owner_id = u.id
      WHERE u.clerk_user_id = ANY($1)`,
    [[personaTestUserId(A_SLUG), personaTestUserId(B_SLUG)]],
  );
  const orgOf = (slug: string) => orgRows.rows.find((r: any) => r.clerk_user_id === personaTestUserId(slug))?.id;
  const orgA = orgOf(A_SLUG), orgB = orgOf(B_SLUG);
  if (!orgA || !orgB) throw new Error("could not resolve both persona orgs — run tests/personas/seedDb.ts first");
  console.log(`org A (${A_SLUG}) = ${orgA}   org B (${B_SLUG}) = ${orgB}`);
  console.log(`breach canary marker = ${CANARY}\n`);

  const clientA = new SimClient(A_SLUG);
  const clientB = new SimClient(B_SLUG);

  const orgCols = new Set<string>(
    (
      await db.query(
      "SELECT table_name FROM information_schema.columns WHERE column_name='organization_id' AND table_schema='public'",
      )
    ).rows.map((r: any) => r.table_name),
  );
  const allTables = new Set<string>(
    (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(
      (r: any) => r.table_name,
    ),
  );

  const { routes, windows } = enumerateRoutes();
  const varToTable = buildVarToTable();

  // ── POPULATION FLOOR ──
  console.log(`POPULATION: ${routes.length} mounted /api by-id routes (GET/PUT/PATCH/DELETE with an :id-style param).`);
  recordMetric(SIM, "population_byid_routes", routes.length);
  if (routes.length < POPULATION_FLOOR) {
    // A shrunken population reads exactly like a clean one. Refuse to report.
    console.error(`POPULATION ${routes.length} is under the floor ${POPULATION_FLOOR}: the route extractor stopped reading part of the server.`);
    process.exit(2);
  }
  const verbCounts: Record<string, number> = {};
  for (const r of routes) verbCounts[r.verb] = (verbCounts[r.verb] || 0) + 1;
  recordMetric(SIM, "population_by_verb", verbCounts);

  // Infer a backing table for each route (param-driven, terminal-from() fallback).
  function inferTable(route: Route): string | null {
    const ps = idParams(route.path);
    const primary = ps[0];
    if (primary) {
      for (const cand of paramTableCandidates(route.path, primary)) if (orgCols.has(cand)) return cand;
    }
    // terminal-param fallback: if the id param is the LAST path segment, the
    // handler's `.from(table)` is likely the resource itself (not a sub-table).
    const terminal = primary && route.path.trimEnd().endsWith(":" + primary);
    if (terminal) {
      const win = windows.get(`${route.verb} ${route.path}`) ?? "";
      for (const m of win.matchAll(/\.from\(\s*(\w+)/g)) {
        const t = varToTable[m[1]];
        if (t && orgCols.has(t)) return t;
      }
    }
    return null;
  }

  // Row cache so a GET and a PUT on the same table reuse one forged pair.
  const forged = new Map<string, { id: any; reason?: string }>();
  async function getForged(table: string, org: number): Promise<{ id: any; reason?: string }> {
    const key = `${table}#${org}`;
    const hit = forged.get(key);
    if (hit) return hit;
    const res = await forgeRow(db, table, org, 2);
    forged.set(key, res);
    return res;
  }

  const results: ProbeResult[] = [];
  const gaps: Array<{ route: string; reason: string }> = [];
  let probed = 0;
  let breaches = 0;
  // Vacuity guard: how many GET routes had A's OWN response actually echo the
  // forged canary. If this is 0 the whole P0 detector is decoration — a breach
  // could never be seen because A's content never appears on the wire at all.
  let controlHadCanary = 0;
  let getProbed = 0;

  for (const route of routes) {
    const rkey = `${route.verb} ${route.path}`;
    const table = inferTable(route);
    if (!table) {
      // Is there any table under a guessable name at all (just not org-scoped)?
      const anyExists = idParams(route.path).some((pp) =>
        paramTableCandidates(route.path, pp).some((c) => allTables.has(c)),
      );
      const reason = anyExists
        ? "backing table is not org-scoped (no organization_id) or differently named — not a tenant-isolation surface"
        : "could not infer an org-scoped backing table from route/param/handler";
      gaps.push({ route: rkey, reason });
      recordSkip({ sim: SIM, step: rkey, reason });
      results.push({ verb: route.verb, path: route.path, table: null, verdict: "skip" });
      continue;
    }

    // Forge A and B rows (cached per table+org).
    const aRow = await getForged(table, orgA);
    const bRow = await getForged(table, orgB);
    if (aRow.id == null || bRow.id == null) {
      const reason = `forge failed for ${table}: ${aRow.reason ?? bRow.reason}`;
      gaps.push({ route: rkey, reason });
      recordSkip({ sim: SIM, step: rkey, reason });
      results.push({ verb: route.verb, path: route.path, table, verdict: "skip-forge" });
      continue;
    }
    probed++;

    const ps = idParams(route.path);
    const primary = ps[0];
    // substitute A's forged id for the primary param; other params → "1".
    const aParams: Record<string, any> = {};
    for (const pp of [...route.path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1])) {
      aParams[pp] = pp === primary ? aRow.id : "1";
    }
    const meta = await tableMeta(db, table);

    if (route.verb === "GET") {
      // Positive control: A reads A's own row.
      const ctrl = await clientA.get(buildPath(route, aParams));
      // Attack: B reads A's row.
      const atk = await clientB.get(buildPath(route, aParams));
      const body = atk.text ?? "";
      getProbed++;
      if ((ctrl.text ?? "").includes(CANARY)) controlHadCanary++;
      let verdict: string;
      if (atk.status >= 200 && atk.status < 300) {
        // The ONLY sound leak signal is A's forged CANARY text — content B never
        // supplied. The row id is NOT a signal: B puts it in the attack URL, and
        // many handlers reflect the path param straight back in the envelope
        // (e.g. {"rehabId": "<id B sent>", total: 0}) — a reflected id is not a
        // disclosure. So canary-present → confirmed P0; 2xx-without-canary →
        // weak-authz P2 to verify by hand (the route answered success to a
        // cross-tenant id instead of 403/404, but disclosed no proven A data —
        // could be an empty/own-shaped envelope, or a projection that omits the
        // text columns the canary lives in).
        // Second, independent signal: a response object stamped with ORG A's id.
        // A route can leak a DIFFERENT row of A's than the one forged, and that
        // row never carries the canary. This rule was falsified against a real
        // defect before it was trusted.
        const stampedWithA = new RegExp(`"organization_?[iI]d"\\s*:\\s*${orgA}\\b`).test(body);
        if (body.includes(CANARY) || stampedWithA) {
          verdict = "BREACH";
          breaches++;
          recordFinding({
            id: `idor-sweep-read-${table}`,
            product: "AcreOS",
            sev: "P0",
            area: "tenant-isolation",
            title: `Cross-tenant READ breach: org B read org A's ${table} via ${route.verb} ${route.path}`,
            evidence: `B GET ${buildPath(route, aParams)} → ${atk.status}; body ${body.includes(CANARY) ? `contains A's forged canary text "${CANARY}"` : `carries org A's organizationId ${orgA}`} (content B never supplied). control(A reads own)=${ctrl.status}. body[0:240]=${body.slice(0, 240)}`,
            impact: `Org B discloses org A's ${table} row by editing a URL id — a day-one cross-tenant data breach.`,
            repro: `GET ${buildPath(route, aParams)} with cookie __session=${(clientB as any).cookieValue}`,
            sim: SIM,
          });
        } else {
          verdict = "2xx-weak-authz";
          recordFinding({
            id: `idor-sweep-read-weakauthz-${table}-${route.path.replace(/[^a-z0-9]+/gi, "-")}`,
            product: "AcreOS",
            sev: "P2",
            area: "tenant-isolation",
            title: `Cross-tenant read answered 2xx (no proven A data) instead of 403/404: ${route.verb} ${route.path}`,
            evidence: `B GET A's ${table} id → ${atk.status}; body does NOT contain A's canary "${CANARY}", so no A data is proven leaked — but a by-id route SHOULD 403/404 a cross-tenant id, not 2xx. Often a reflected id / empty-own-shaped envelope; verify no A projection leaks with a fuller row. control(A reads own)=${ctrl.status}. body[0:200]=${body.slice(0, 200)}`,
            impact: "Missing ownership check on a by-id route: it serves a 2xx envelope for a resource the caller's org does not own. Not a proven disclosure, but the authz posture is wrong — confirm no field leaks once the parent row carries data.",
            sim: SIM,
          });
        }
      } else if (atk.status >= 500) {
        verdict = `sloppy-reject-${atk.status}`;
        recordFinding({
          id: `idor-sweep-sloppy-${table}-${route.verb}`,
          product: "AcreOS",
          sev: "P2",
          area: "tenant-isolation",
          title: `Sloppy cross-tenant reject (5xx): ${route.verb} ${route.path}`,
          evidence: `B GET A's ${table} id → ${atk.status} (expected 403/404). control(A reads own)=${ctrl.status}. body[0:160]=${body.slice(0, 160)}`,
          impact: "A 5xx on a cross-tenant id means the handler ran past the authz check and threw — the isolation is incidental, not enforced.",
          sim: SIM,
        });
      } else {
        // A refusal is only evidence of isolation when the owner's own read worked.
        verdict = ctrl.status >= 200 && ctrl.status < 300 ? "isolated" : `unverified(control=${ctrl.status})`;
      }

      // Control-failed is itself a finding class (a by-id route that 500s on a valid row).
      if (!(ctrl.status >= 200 && ctrl.status < 300)) {
        const sev = ctrl.status >= 500 ? "P2" : "P3";
        recordFinding({
          id: `idor-sweep-control-${table}-${route.verb}`,
          product: "AcreOS",
          sev: sev as any,
          area: "by-id-route-health",
          title: `Positive control non-2xx: A reading A's own ${table} via ${route.verb} ${route.path} → ${ctrl.status}`,
          evidence: `A GET ${buildPath(route, aParams)} → ${ctrl.status}. body[0:200]=${(ctrl.text ?? "").slice(0, 200)}. (Forged row ${meta.pk}=${aRow.id} in org A exists in DB.)`,
          impact:
            ctrl.status >= 500
              ? "A valid-row by-id route 500s — either a real bug or a multi-param/shape the forger could not satisfy; isolation verdict for this route is weaker (cross-org 404 may mean 'route broken', not 'isolated')."
              : "By-id route rejects A's own valid row (likely a route shape/param the generic forge did not satisfy, e.g. multi-param coupling).",
          sim: SIM,
        });
      }

      results.push({ verb: route.verb, path: route.path, table, control: ctrl.status, attack: atk.status, verdict });
      console.log(
        `${verdict.startsWith("BREACH") ? "✗" : verdict.startsWith("isolated") ? "✓" : "!"} ${route.verb.padEnd(6)} ${route.path.padEnd(52)} tbl=${table.padEnd(26)} ctrl=${ctrl.status} atk=${atk.status} → ${verdict}`,
      );
    } else {
      // WRITE vector: B mutates A's row; prove A's row survives unchanged in DB.
      const before = await readRowJson(db, table, meta.pk!, aRow.id);
      const p = buildPath(route, aParams);
      const resp =
        route.verb === "DELETE"
          ? await clientB.delete(p)
          : route.verb === "PUT"
            ? await clientB.put(p, { name: "idorwrite" })
            : await clientB.patch(p, { name: "idorwrite" });
      const after = await readRowJson(db, table, meta.pk!, aRow.id);
      const survived = after != null;
      const unchanged = survived && after === before;
      let verdict: string;
      if (route.verb === "DELETE" && !survived) {
        verdict = "WRITE-BREACH(deleted)";
        breaches++;
        recordFinding({
          id: `idor-sweep-delete-${table}`,
          product: "AcreOS",
          sev: "P0",
          area: "tenant-isolation",
          title: `Cross-tenant DELETE breach: org B deleted org A's ${table} via ${route.verb} ${route.path}`,
          evidence: `B DELETE ${p} → ${resp.status}; A's row ${meta.pk}=${aRow.id} is GONE from the DB afterward.`,
          impact: "Org B destroyed org A's data by editing a URL id — catastrophic cross-tenant write.",
          repro: `DELETE ${p} with cookie __session=${(clientB as any).cookieValue}`,
          sim: SIM,
        });
      } else if ((route.verb === "PUT" || route.verb === "PATCH") && survived && !unchanged) {
        verdict = "WRITE-BREACH(mutated)";
        breaches++;
        recordFinding({
          id: `idor-sweep-mutate-${table}-${route.verb}`,
          product: "AcreOS",
          sev: "P0",
          area: "tenant-isolation",
          title: `Cross-tenant ${route.verb} breach: org B mutated org A's ${table} via ${route.path}`,
          evidence: `B ${route.verb} ${p} → ${resp.status}; A's row ${meta.pk}=${aRow.id} CHANGED. before=${(before ?? "").slice(0, 160)} after=${(after ?? "").slice(0, 160)}`,
          impact: "Org B altered org A's data by editing a URL id — cross-tenant write breach.",
          repro: `${route.verb} ${p} body {"name":"idorwrite"} with cookie __session=${(clientB as any).cookieValue}`,
          sim: SIM,
        });
      } else if (resp.status >= 500) {
        verdict = `sloppy-reject-${resp.status}`;
        recordFinding({
          id: `idor-sweep-write-sloppy-${table}-${route.verb}`,
          product: "AcreOS",
          sev: "P2",
          area: "tenant-isolation",
          title: `Sloppy cross-tenant write reject (5xx): ${route.verb} ${route.path}`,
          evidence: `B ${route.verb} A's ${table} id → ${resp.status} (expected 403/404). A row survived=${survived} unchanged=${unchanged}.`,
          impact: "A 5xx on a cross-tenant write means the handler ran past the authz check — isolation is incidental.",
          sim: SIM,
        });
      } else if (resp.status >= 200 && resp.status < 300 && unchanged) {
        verdict = "write-accepted-no-change";
        recordFinding({
          id: `idor-sweep-write-accepted-${table}-${route.verb}`,
          product: "AcreOS",
          sev: "P2",
          area: "tenant-isolation",
          title: `Cross-tenant ${route.verb} answered 2xx (row unchanged): ${route.path}`,
          evidence: `B ${route.verb} A's ${table} id → ${resp.status} but A's row is byte-identical afterward. Benign body may be why nothing changed; a route that 2xx's a cross-tenant write instead of 403/404 still warrants a by-hand check.`,
          impact: "A cross-tenant mutation that returns success (even as a no-op) is a weak authz posture; verify it cannot change anything with a fuller body.",
          sim: SIM,
        });
      } else {
        verdict = survived ? "isolated" : "isolated(gone?)";
      }
      results.push({ verb: route.verb, path: route.path, table, attack: resp.status, verdict });
      console.log(
        `${verdict.includes("BREACH") ? "✗" : verdict.startsWith("isolated") ? "✓" : "!"} ${route.verb.padEnd(6)} ${route.path.padEnd(52)} tbl=${table.padEnd(26)} atk=${resp.status} survived=${survived} → ${verdict}`,
      );
    }
  }

  // ── metrics ──
  recordMetric(SIM, "probed_routes", probed);
  recordMetric(SIM, "skipped_routes", gaps.length);
  recordMetric(SIM, "breaches", breaches);
  recordMetric(SIM, "get_probed", getProbed);
  recordMetric(SIM, "control_had_canary", controlHadCanary);

  // ── population-gap finding (honesty about coverage) ──
  if (gaps.length > 0) {
    const byReason: Record<string, string[]> = {};
    for (const g of gaps) (byReason[g.reason] ||= []).push(g.route);
    const summary = Object.entries(byReason)
      .map(([reason, rs]) => `• ${rs.length} route(s): ${reason}\n    ${rs.sort().join("\n    ")}`)
      .join("\n");
    recordFinding({
      id: "idor-sweep-population-gap",
      product: "AcreOS",
      sev: "P2",
      area: "tenant-isolation-coverage",
      title: `IDOR sweep could not probe ${gaps.length} of ${routes.length} by-id routes (coverage gap)`,
      evidence: `Probed ${probed}/${routes.length}. Unprobed, grouped by reason:\n${summary}`,
      impact:
        "Each unprobed by-id route is an UNTESTED isolation surface. A route backed by an org-scoped table under a name the inferrer missed is a false sense of coverage — triage these by hand or add an explicit table mapping.",
      sim: SIM,
    });
  }

  // ── cleanup forged rows, newest first ──
  let cleaned = 0;
  for (let i = inserted.length - 1; i >= 0; i--) {
    const row = inserted[i];
    try {
      const delSql = 'DELETE FROM "' + row.table + '" WHERE "' + row.pk + '" = $1'; // dynamic SQL, see readSql
      await db.query(delSql, [row.id]);
      cleaned++;
    } catch {
      /* best-effort */
    }
  }
  recordMetric(SIM, "forged_rows", rowCounter);
  recordMetric(SIM, "cleaned_rows", cleaned);

  // ── summary ──
  console.log(`\n── IDOR sweep summary ──`);
  console.log(`population (by-id routes):   ${routes.length}  ${JSON.stringify(verbCounts)}`);
  console.log(`probed (org-scoped table):   ${probed}`);
  console.log(`skipped (coverage gap):      ${gaps.length}`);
  console.log(`forged rows / cleaned:       ${rowCounter} / ${cleaned}`);
  console.log(`breaches:                    ${breaches}`);
  const isolated = results.filter((r) => r.verdict.startsWith("isolated")).length;
  const controlIssues = results.filter((r) => typeof r.control === "number" && !(r.control! >= 200 && r.control! < 300)).length;
  console.log(`isolated (clean rejects):    ${isolated}`);
  console.log(`control-failed by-id routes: ${controlIssues}`);
  console.log(`GET detector live-ness:      A's own response echoed the canary on ${controlHadCanary}/${getProbed} GET routes (0 would mean the P0 read detector is vacuous)`);
  if (getProbed > 0 && controlHadCanary === 0) {
    recordFinding({
      id: "idor-sweep-detector-vacuous",
      product: "AcreOS",
      sev: "P1",
      area: "sim-integrity",
      title: "IDOR read detector may be vacuous — A's forged canary never appeared in any own-read response",
      evidence: `Across ${getProbed} probed GET routes, A reading A's OWN forged row never returned the canary "${CANARY}". The P0 read-breach signal (canary in a cross-tenant response) therefore had no live baseline — a real read breach could have gone undetected.`,
      impact: "The sweep's read-isolation verdict cannot be trusted until at least one control proves A's forged content reaches the wire.",
      sim: SIM,
    });
  }
  console.log(
    breaches === 0
      ? `\n✓ No confirmed cross-tenant breach across ${probed} probed by-id routes.`
      : `\n✗ ${breaches} BREACH(es) — cross-tenant data exposure.`,
  );

  await db.end();
  if (breaches > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  // A sim failure (not a breach) should be visible but must not be mistaken for
  // a passing isolation result; exit non-zero only for a genuine crash.
  process.exit(2);
});
