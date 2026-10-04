#!/usr/bin/env node
/**
 * The npm-audit gate for .github/workflows/security.yml.
 *
 * It replaces an inline script that printed only COUNTS ("high: 5") and
 * failed. On 2026-10-04 that blocked a production deploy, and the log never
 * said which package or advisory. A gate that cannot name what it found has
 * no path to green except deleting it. This one prints every
 * critical/high finding, with its advisory, the packages it reaches through,
 * and whether any of those packages ship to production.
 *
 * It also gives npm audit the assessed-exception channel Trivy already has in
 * .trivyignore. `security/npm-audit-accepted.json` may accept an advisory only
 * when ALL of these hold, each checked here rather than trusted:
 *   - every installed package the advisory reaches is dev-only in
 *     package-lock.json. A production dependency can never be accepted; fix it.
 *   - the entry carries a written justification and a re-review trigger.
 *   - the entry's `reviewBy` date has not passed. Acceptances expire.
 *   - the advisory is still reported. A stale entry fails, so an ignore can
 *     never outlive its reason unseen.
 *
 * Usage: node scripts/npm-audit-gate.mjs <npm-audit-report.json>
 *          [accepted.json] [package-lock.json]
 */
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["critical", "high"]);

/** The advisory URLs a vulnerability entry ultimately rests on, following `via` chains. */
function advisoriesOf(name, vulns, seen = new Set()) {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const out = new Set();
  for (const via of vulns[name]?.via ?? []) {
    if (typeof via === "string") for (const a of advisoriesOf(via, vulns, seen)) out.add(a);
    else if (via && via.url) out.add(via.url);
  }
  return out;
}

/**
 * Pure: evaluate an npm audit report against the accepted register.
 * Returns the printable lines and the failures; the CLI exits non-zero on any failure.
 */
export function evaluate(report, accepted, lockPackages, today = new Date().toISOString().slice(0, 10)) {
  const vulns = report?.vulnerabilities ?? {};
  const lines = [];
  const failures = [];
  const meta = report?.metadata?.vulnerabilities ?? {};
  lines.push(
    `Vulnerabilities — critical: ${meta.critical ?? 0}, high: ${meta.high ?? 0}, ` +
      `moderate: ${meta.moderate ?? 0}, low: ${meta.low ?? 0}, info: ${meta.info ?? 0}`,
  );

  const byUrl = new Map((accepted ?? []).map((a) => [a.advisory, a]));
  for (const a of accepted ?? []) {
    if (!a.advisory || !/^https:\/\/github\.com\/advisories\/GHSA-/.test(a.advisory))
      failures.push(`accepted entry has no GHSA advisory URL: ${JSON.stringify(a)}`);
    if (!a.justification || a.justification.trim().length < 40)
      failures.push(`accepted ${a.advisory}: justification missing or too thin`);
    if (!a.reviewTrigger || !a.reviewTrigger.trim()) failures.push(`accepted ${a.advisory}: no reviewTrigger`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.reviewBy ?? "")) failures.push(`accepted ${a.advisory}: reviewBy must be YYYY-MM-DD`);
    else if (a.reviewBy < today) failures.push(`accepted ${a.advisory}: expired on ${a.reviewBy} — re-assess and renew, or fix`);
  }

  const reportedAdvisories = new Set();
  const isDevOnly = (name) => {
    const nodes = Object.entries(lockPackages ?? {}).filter(([k]) => k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`));
    return nodes.length > 0 && nodes.every(([, p]) => p.dev === true);
  };

  for (const [name, v] of Object.entries(vulns)) {
    const advisories = advisoriesOf(name, vulns);
    for (const a of advisories) reportedAdvisories.add(a);
    if (!BLOCKING.has(v.severity)) continue;
    const devOnly = isDevOnly(name);
    const acceptedAll = advisories.size > 0 && [...advisories].every((a) => byUrl.has(a));
    const verdict = !acceptedAll ? "BLOCKING" : devOnly ? "accepted (dev-only)" : "BLOCKING — accepted advisory reaches a PRODUCTION package";
    lines.push(`${v.severity.padEnd(8)} ${name.padEnd(28)} ${devOnly ? "dev " : "PROD"} ${verdict}  ${[...advisories].join(" ")}`);
    if (!acceptedAll || !devOnly) failures.push(`${v.severity} ${name}: ${verdict}`);
  }

  for (const a of accepted ?? []) {
    if (a.advisory && !reportedAdvisories.has(a.advisory))
      failures.push(`accepted ${a.advisory} is no longer reported — remove the stale entry`);
  }
  return { lines, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [reportPath = "npm-audit-report.json", acceptedPath = "security/npm-audit-accepted.json", lockPath = "package-lock.json"] =
    process.argv.slice(2);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const accepted = JSON.parse(readFileSync(acceptedPath, "utf8")).accepted ?? [];
  const lock = JSON.parse(readFileSync(lockPath, "utf8")).packages ?? {};
  const { lines, failures } = evaluate(report, accepted, lock);
  for (const l of lines) console.log(l);
  const moderate = report?.metadata?.vulnerabilities?.moderate ?? 0;
  if (moderate > 0) console.log(`::warning::npm audit found ${moderate} moderate vulnerabilities. Review and patch within 30 days per CVE SLA.`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`::error::${f}`);
    console.log("::error::npm audit gate failed. Patch within 24h (critical) or 7d (high) per CVE SLA, or assess a dev-only advisory in security/npm-audit-accepted.json.");
    process.exit(1);
  }
  console.log("npm audit gate: PASS");
}
