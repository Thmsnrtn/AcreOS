// The simulation world's network and database edge, preloaded into the web,
// worker and harness processes with `node --import`. It modifies no AcreOS
// source.
//
//  1. world-shim.mjs (founder sim): Clerk stand-in, egress ledger + firewall,
//     TLS mocks for Stripe / SES / Twilio when a rule says the provider is UP.
//  2. fetch-redirect.cjs (market sim): Twilio, Lob, SendGrid, Stripe-over-fetch
//     and Meta calls go to the market PROVIDER STAND-IN, which reproduces the
//     providers' real failure modes as the twin decides them.
//  3. The DB TAP (web and worker only): every request that carries the
//     harness's `x-simplat-actor-org` header runs inside an async context
//     naming the tenant it acts for. Every pg query made in that context is
//     inspected: rows returned with an organization_id of ANOTHER tenant are
//     recorded (reads), and the connection's `simplat.actor_org` is set before
//     each write so the tenant-tap trigger (tenant-tap.sql) records any write
//     to another tenant's row. Counters (queries inspected, queries that
//     carried an organization_id column) are flushed so a monitor can tell
//     "nothing foreign was read" from "nothing was read".
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import http from "node:http";
import "../campaign/founder/world-shim.mjs";

const require = createRequire(import.meta.url);
if (process.env.PROVIDER_PORT) require("../campaign/market/fetch-redirect.cjs");

const ROLE = process.env.WORLD_ROLE || "app";
const TAP_LOG = process.env.SIMPLAT_DBTAP_LOG || "";
const TAP_STATS = process.env.SIMPLAT_DBTAP_STATS || "";
const als = new AsyncLocalStorage();

if (TAP_LOG && (ROLE === "web" || ROLE === "worker")) {
  // ── request context ──
  const origEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, req, res) {
    if (event === "request" && req && req.headers) {
      const h = req.headers["x-simplat-actor-org"];
      const org = h != null && /^\d+$/.test(String(h)) ? Number(h) : null;
      if (org != null) return als.run({ actorOrg: org, path: `${req.method} ${String(req.url).split("?")[0]}` }, () => origEmit.apply(this, arguments));
    }
    return origEmit.apply(this, arguments);
  };

  // ── pg tap ──
  const pg = require("pg");
  const stats = { role: ROLE, pid: process.pid, inspected: 0, withOrgColumn: 0, foreignReads: 0, writesTagged: 0 };
  const flush = () => { if (TAP_STATS) try { fs.writeFileSync(`${TAP_STATS}.${ROLE}.json`, JSON.stringify({ ...stats, at: new Date().toISOString() })); } catch { /* best effort */ } };
  setInterval(flush, 1000).unref();
  const record = (o) => { try { fs.appendFileSync(TAP_LOG, JSON.stringify({ ts: new Date().toISOString(), role: ROLE, ...o }) + "\n"); } catch { /* best effort */ } };
  const WRITE = /^\s*(insert|update|delete|merge)\b/i;
  const textOf = (c) => (typeof c === "string" ? c : c && typeof c.text === "string" ? c.text : "");
  const tableOf = (t) => /\b(?:from|into|update)\s+"?([a-z_][a-z0-9_]*)"?/i.exec(t)?.[1] ?? null;

  function inspect(ctx, text, res) {
    stats.inspected++;
    const r = Array.isArray(res) ? res[res.length - 1] : res;
    if (!r || !Array.isArray(r.fields)) return;
    const idx = r.fields.findIndex((f) => f.name === "organization_id" || f.name === "organizationId");
    if (idx < 0) return;
    stats.withOrgColumn++;
    const name = r.fields[idx].name;
    const orgs = new Set();
    for (const row of r.rows || []) {
      const v = Array.isArray(row) ? row[idx] : row[name];
      const n = v == null ? null : Number(v);
      if (n != null && Number.isFinite(n) && n > 0 && n !== ctx.actorOrg) orgs.add(n);
    }
    if (orgs.size) {
      stats.foreignReads++;
      record({ kind: WRITE.test(text) ? "write-returning" : "read", actorOrg: ctx.actorOrg, path: ctx.path, table: tableOf(text), rowOrgs: [...orgs], sql: text.replace(/\s+/g, " ").slice(0, 240) });
    }
  }

  const origQuery = pg.Client.prototype.query;
  pg.Client.prototype.query = function (config, values, callback) {
    const ctx = als.getStore();
    const text = textOf(config);
    const isWrite = WRITE.test(text);
    // Tag the connection for the write trigger: the actor, or '' to clear a previous one.
    if (isWrite && (ctx || this.__simplatActor)) {
      const actor = ctx ? String(ctx.actorOrg) : "";
      this.__simplatActor = actor;
      stats.writesTagged++;
      origQuery.call(this, "select set_config('simplat.actor_org', $1, false)", [actor]).catch?.(() => {});
    }
    if (!ctx) return origQuery.apply(this, arguments);
    const cb = typeof values === "function" ? values : typeof callback === "function" ? callback : typeof config?.callback === "function" ? config.callback : null;
    if (cb) {
      const wrapped = function (err, res) { if (!err) { try { inspect(ctx, text, res); } catch { /* never break the app */ } } return cb.apply(this, arguments); };
      if (typeof values === "function") return origQuery.call(this, config, wrapped);
      if (typeof callback === "function") return origQuery.call(this, config, values, wrapped);
      config.callback = wrapped;
      return origQuery.call(this, config, values);
    }
    const p = origQuery.apply(this, arguments);
    if (p && typeof p.then === "function") {
      return p.then((res) => { try { inspect(ctx, text, res); } catch { /* never break the app */ } return res; });
    }
    return p;
  };
}
