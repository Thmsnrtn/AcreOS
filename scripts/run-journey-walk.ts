#!/usr/bin/env tsx
/**
 * Journey-proof harness — the staging runner CLI.
 *
 * Runs one declarative walk spec against staging on a fresh dedicated org
 * and writes the evidence record INTO THE REPO at
 * docs/evidence/<date>/<spec>-journey-walk.md.
 *
 *   npx tsx scripts/run-journey-walk.ts --spec wholesale
 *   npx tsx scripts/run-journey-walk.ts --spec wholesale --input txAssignment=12 --input ilAssignment=13
 *   npx tsx scripts/run-journey-walk.ts --spec wholesale --check   # validate + probe /api/version only
 *
 * AUTH: the staging-only E2E token comes from ACREOS_STAGING_E2E_TOKEN in
 * the environment (present in-machine on walk sessions). This script never
 * prints the token, never writes it to the record, and never passes it to
 * any host but staging. The walk org is a fresh E2E persona per run
 * (cookie __session=e2e-persona-<slug>), so no walk ever touches another
 * walk's org or data.
 *
 * MANUAL STEPS: steps the machine cannot do (UI-only seeding, the e-sign
 * rail) pause the run and prompt for the operator's act — and for any ids
 * later steps need (--input key=value answers the same prompts
 * non-interactively). A missing value stops the walk loudly; the runner
 * never invents an operator's observation.
 *
 * EXIT CODES: 0 = PASS (the record is a full green walk). 2 = PARTIAL (a
 * manual step or a blocked Pax leg remains — the record says which). 1 =
 * FAIL or refused to start (no token, bad spec, non-staging URL).
 */
import "../server/outboundGuard";
import readline from "node:readline";
import { getWalkSpec } from "../tests/journey/specs/index";
import { StagingDriver, assertStagingBaseUrl } from "../tests/journey/drivers/staging";
import { runWalk, writeWalkRecord } from "../tests/journey/runner";
import { validateWalkSpec } from "../tests/journey/walk-spec";

function parseArgs(argv: string[]): { spec: string; check: boolean; inputs: Record<string, string> } {
  let spec = "";
  let check = false;
  const inputs: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spec" && argv[i + 1]) spec = argv[++i];
    else if (arg === "--check") check = true;
    else if (arg === "--input" && argv[i + 1]) {
      const raw = argv[++i];
      const eq = raw.indexOf("=");
      if (eq <= 0) throw new Error(`--input takes key=value, got ${JSON.stringify(raw)}`);
      inputs[raw.slice(0, eq)] = raw.slice(eq + 1);
    } else if (arg.startsWith("--spec=")) spec = arg.slice("--spec=".length);
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (!spec) throw new Error("usage: run-journey-walk.ts --spec <id> [--check] [--input key=value ...]");
  return { spec, check, inputs };
}

async function promptForManualInput(step: { id: string; collects?: { key: string; prompt: string }[] }): Promise<Record<string, string>> {
  if (!process.stdin.isTTY) {
    throw new Error(`step ${step.id} needs operator values but stdin is not a TTY — re-run with --input key=value`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const out: Record<string, string> = {};
  try {
    for (const c of step.collects ?? []) {
      out[c.key] = await new Promise<string>((resolve) => {
        rl.question(`\n[manual step ${step.id}] ${c.prompt}\n${c.key}: `, (answer) => resolve(answer.trim()));
      });
    }
  } finally {
    rl.close();
  }
  return out;
}

async function main(): Promise<number> {
  const { spec: specId, check, inputs } = parseArgs(process.argv.slice(2));
  const spec = getWalkSpec(specId);
  const errors = validateWalkSpec(spec);
  if (errors.length) {
    console.error(`walk spec ${specId} is invalid:\n- ${errors.join("\n- ")}`);
    return 1;
  }
  if (check) {
    // --check needs no token: the version probe is unauthenticated. It still
    // goes through the staging driver's base-URL refusal first (https +
    // "staging"), so the probe can never be pointed at production or any
    // other host by the environment.
    const baseUrl = assertStagingBaseUrl(process.env.ACREOS_STAGING_URL ?? "https://acreos-staging.fly.dev");
    const res = await fetch(`${baseUrl}/api/version`);
    const version = (await res.json().catch(() => ({}))) as { sha?: unknown };
    console.log(`staging /api/version: ${JSON.stringify(version)}`);
    if (version.sha === "unknown") {
      console.log("NOTE: staging's /api/version returns {\"sha\":\"unknown\"} — the record will say so, not carry a SHA from elsewhere.");
    }
    console.log(`spec ${specId} v${spec.version} is valid; staging reachable; walk not run (--check).`);
    return 0;
  }
  const driver = new StagingDriver({ manualInputs: inputs, promptForManualInput: promptForManualInput });
  const version = await driver.version();
  console.log(`staging /api/version: ${JSON.stringify(version)}`);
  if (version.sha === "unknown") {
    console.log("NOTE: staging's /api/version returns {\"sha\":\"unknown\"} — the record will say so, not carry a SHA from elsewhere.");
  }
  console.log(`running walk ${specId} on staging…`);
  const report = await runWalk(spec, driver);
  const relPath = await writeWalkRecord(report, process.cwd());
  console.log(`record written: ${relPath}`);
  console.log(`verdict: ${report.verdict}`);
  if (report.passed) return 0;
  if (report.verdict.startsWith("PARTIAL")) return 2;
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`run-journey-walk failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
