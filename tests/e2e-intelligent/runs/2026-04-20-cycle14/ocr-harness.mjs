/**
 * OCR harness — Raj C01
 *
 * Uploads each fixture in ../../fixtures/ocr/*.json to
 * /api/document-intelligence/upload as a data:text/plain;base64 URL,
 * triggers /process, then fetches /risks and scores the returned
 * riskFlags against the fixture's expected.anomalies.
 *
 * Scoring is keyword-based: each expected anomaly's `type`
 * (e.g. "mineral_reservation") is tokenized and matched against the
 * returned flag's issue + recommendation text. Scoring is permissive
 * because the underlying model (gpt-4o) won't produce identical
 * wording across runs — it's enough that the flag surfaces with
 * compatible severity.
 *
 * Usage:
 *   CLERK_SECRET=sk_live_... node ocr-harness.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/ocr");
const BASE = process.env.BASE || "https://acreos.io";
const CLERK = process.env.CLERK_SECRET;
const FOUNDER_USER_ID = process.env.FOUNDER_USER_ID || "user_3CaZCrUqwtHueUi1bdSgyxkHQV3";
if (!CLERK) { console.error("CLERK_SECRET required"); process.exit(2); }

// ─── Clerk sign-in via ticket + cookie jar ──────────────────────────

let cookieJar = "";
function updateJar(setCookieHeaders) {
  const all = setCookieHeaders || [];
  const flat = Array.isArray(all) ? all : (typeof all === "string" ? all.split(/,(?=[^ ]+=)/) : []);
  const bag = new Map();
  for (const kv of cookieJar.split(";").map((s) => s.trim()).filter(Boolean)) {
    const eq = kv.indexOf("=");
    if (eq > 0) bag.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  for (const sc of flat) {
    const first = sc.split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    bag.set(first.slice(0, eq), first.slice(eq + 1));
  }
  cookieJar = Array.from(bag).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function req(method, url, { body, json = true } = {}) {
  const headers = { "Cookie": cookieJar };
  if (body) headers["Content-Type"] = "application/json";
  const csrf = cookieJar.match(/csrf_token=([^;]+)/)?.[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const res = await fetch(url.startsWith("http") ? url : BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.raw?.()["set-cookie"];
  if (setCookie) updateJar(setCookie);
  const text = await res.text();
  if (!json) return { status: res.status, text };
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

async function mintTicket(userId) {
  const res = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${CLERK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 3600 }),
  });
  const body = await res.json();
  if (!body.token) throw new Error(`Failed to mint ticket: ${JSON.stringify(body)}`);
  return body.token;
}

async function signIn(userId) {
  const ticket = await mintTicket(userId);
  const CAPI = `${BASE}/__clerk/v1`;
  // Step 1: POST the ticket to create a sign_in attempt
  const step1 = await fetch(`${CAPI}/client/sign_ins`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieJar },
    body: new URLSearchParams({ strategy: "ticket", ticket }).toString(),
    redirect: "manual",
  });
  const sc1 = step1.headers.getSetCookie ? step1.headers.getSetCookie() : [];
  if (sc1) updateJar(sc1);
  const j1 = await step1.json();
  const sid = j1?.response?.id || j1?.id;
  if (!sid) throw new Error(`sign_ins POST failed: ${JSON.stringify(j1)}`);
  // Step 2: touch to emit the __session cookie on the acreos.io origin
  await req("GET", "/api/auth/user");
  // Re-check with a second touch so any cookie refresh propagates
  const me = await req("GET", "/api/auth/user");
  return me;
}

// ─── Scoring ────────────────────────────────────────────────────────

function tokenize(s) {
  return s.toLowerCase().replace(/[_/\-]/g, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
}

function matchAnomaly(expected, flags) {
  const expectedTokens = new Set(tokenize(expected.type));
  for (const f of flags) {
    const haystack = `${f.issue || ""} ${f.recommendation || ""}`.toLowerCase();
    const flagTokens = new Set(tokenize(haystack));
    // Consider it a match if ≥2 distinctive tokens overlap
    let overlap = 0;
    for (const t of expectedTokens) if (flagTokens.has(t)) overlap++;
    if (overlap >= 2) return f;
    // Special cases: common single-word anomaly types
    const singles = ["mineral", "easement", "lien", "judgment", "redemption", "delinquent", "access"];
    for (const single of singles) {
      if (expected.type.toLowerCase().includes(single) && haystack.includes(single)) return f;
    }
  }
  return null;
}

// ─── Drive the pipeline ─────────────────────────────────────────────

async function run() {
  console.log("[ocr-harness] signing in as founder...");
  const me = await signIn(FOUNDER_USER_ID);
  if (me.status !== 200) {
    console.error("[ocr-harness] sign-in failed:", me);
    process.exit(1);
  }
  console.log("[ocr-harness] signed in:", me.body.email);

  const fixtures = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json")).sort();
  const results = [];
  for (const file of fixtures) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf-8"));
    console.log(`\n[${fixture.id}] uploading...`);
    const fileUrl = `data:text/plain;base64,${Buffer.from(fixture.text).toString("base64")}`;
    const up = await req("POST", "/api/document-intelligence/upload", {
      body: { documentName: `${fixture.id}.txt`, documentType: docTypeForKind(fixture.kind), fileUrl },
    });
    if (up.status !== 200) { results.push({ id: fixture.id, status: "fail", step: "upload", body: up.body }); continue; }
    const docId = up.body?.document?.id;
    console.log(`  uploaded as doc #${docId}, processing...`);
    const proc = await req("POST", `/api/document-intelligence/documents/${docId}/process`);
    if (proc.status !== 200) { results.push({ id: fixture.id, status: "fail", step: "process", body: proc.body }); continue; }
    // risks come back embedded in process response, but double-fetch for safety
    const risks = await req("GET", `/api/document-intelligence/documents/${docId}/risks`);
    const flags = risks.body?.risks || proc.body?.analysis?.riskFlags || [];
    console.log(`  got ${flags.length} risk flags`);

    // Score
    const expected = fixture.expected?.anomalies || [];
    const matches = expected.map((e) => ({ expected: e, match: matchAnomaly(e, flags) }));
    const hits = matches.filter((m) => m.match).length;
    const pass = expected.length === 0 ? flags.length === 0 : hits >= Math.ceil(expected.length * 0.5);
    results.push({ id: fixture.id, status: pass ? "pass" : "partial", expected: expected.length, hits, flags: flags.length, matches });
  }

  console.log("\n=== OCR harness results ===");
  for (const r of results) {
    console.log(`${r.status.toUpperCase().padEnd(7)} ${r.id.padEnd(30)} ${r.hits ?? 0}/${r.expected ?? 0} anomalies matched (${r.flags ?? 0} total flags)`);
  }
  const passed = results.filter((r) => r.status === "pass").length;
  console.log(`\nOverall: ${passed}/${results.length} fixtures pass`);
  fs.writeFileSync(path.join(__dirname, "ocr-harness-results.json"), JSON.stringify(results, null, 2));
}

function docTypeForKind(kind) {
  if (!kind) return "contract";
  if (kind.includes("deed")) return "deed";
  if (kind.includes("title")) return "title_report";
  if (kind.includes("tax")) return "tax_bill";
  return "contract";
}

run().catch((err) => { console.error(err); process.exit(1); });
