#!/usr/bin/env node
/**
 * Founder-recovery preflight — verifies the laptop has everything the
 * mission needs and prints the current public DNS/DKIM posture.
 * Read-only; touches no secrets.
 */

import { execSync } from "node:child_process";

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  console.log(`  ✗ ${m}`);
  failures++;
};
let failures = 0;

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

console.log("── CLI tooling ──");
try { ok(`node ${process.version}`); } catch { bad("node"); }
try { ok(`flyctl: ${sh("fly version").split("\n")[0]}`); } catch { bad("flyctl missing — https://fly.io/docs/flyctl/install/"); }
try { ok(`fly auth: ${sh("fly auth whoami")}`); } catch { bad("fly not logged in — run: fly auth login"); }
try {
  await import("@playwright/test");
  ok("@playwright/test resolvable (run `npx playwright install chromium` once if the bridge fails to launch)");
} catch { bad("@playwright/test not installed — run: npm ci"); }

console.log("\n── CDP bridge ──");
try {
  const res = await fetch("http://localhost:9222/json/version", { signal: AbortSignal.timeout(2000) });
  ok(`bridge up: ${(await res.json()).Browser}`);
} catch {
  bad("bridge not running — start it: node scripts/founder-recovery/browser.mjs");
}

console.log("\n── Public DNS posture (acreos.io) ──");
const doh = async (name, type) => {
  const res = await fetch(`https://dns.google/resolve?name=${name}&type=${type}`, { signal: AbortSignal.timeout(8000) });
  const d = await res.json();
  return (d.Answer || []).map((a) => a.data);
};
try {
  const spf = await doh("acreos.io", "TXT");
  spf.some((r) => r.includes("v=spf1")) ? ok("apex SPF present") : bad("apex SPF missing");
  const dmarc = await doh("_dmarc.acreos.io", "TXT");
  dmarc.length ? ok(`DMARC: ${dmarc[0].slice(0, 60)}`) : bad("DMARC missing");
  const mx = await doh("mail.acreos.io", "MX");
  mx.length ? ok("MAIL FROM MX present") : bad("MAIL FROM MX missing");
  const apexMx = await doh("acreos.io", "MX");
  apexMx.length
    ? ok(`apex MX: ${apexMx.join(", ")}`)
    : console.log("  · apex MX absent — inbound @acreos.io bounces (Phase 4 fixes this if wanted)");
} catch (e) {
  bad(`DNS checks failed: ${e.message}`);
}

console.log(
  failures
    ? `\n${failures} blocker(s) above — fix them, then re-run.`
    : "\nAll clear — hand PROMPT.md to the agent.",
);
process.exit(failures ? 1 : 0);
