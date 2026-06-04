#!/usr/bin/env node
/**
 * KRIEGER — Desktop-feel Audit Runbook.
 *
 * Driver for the playwright.desktop-feel.config.ts suite. Used by:
 *   1. .github/workflows/desktop-feel-audit.yml (every 6h cron).
 *   2. Solene for manual triggers ("run a desktop-feel audit").
 *
 * Behavior:
 *   - Runs the Playwright suite against the target URL.
 *   - Parses the JSON report (tests/e2e-desktop-feel/results/
 *     playwright-report.json).
 *   - Writes a per-run structured summary:
 *       tests/e2e-desktop-feel/results/<ISO_DATE>.json
 *   - Writes a per-run markdown call-out:
 *       docs/internal/desktop-feel-results-<ISO_DATE>.md
 *     with a green/amber/red per project (viewport × theme) table.
 *   - Exits non-zero if any project is RED so the CI workflow fails
 *     and the GH issue auto-opener fires.
 *
 * Usage:
 *   TARGET_URL=https://acreos.io node scripts/run-desktop-feel-audit.mjs
 *   TARGET_URL=https://acreos.io node scripts/run-desktop-feel-audit.mjs \
 *     --project=desktop-laptop-1280-dark
 *
 * Flags:
 *   --project=<name>   restrict to a single project (skips matrix expansion)
 *   --no-write         skip writing summary files (dry-run / debug)
 *   --skip-run         parse the existing JSON report only
 *
 * Exit codes:
 *   0 — all projects GREEN (or AMBER with no hard reds).
 *   2 — at least one project RED.
 *   3 — config error (missing TARGET_URL, missing report file, etc.).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const RESULTS_DIR = join(REPO_ROOT, "tests", "e2e-desktop-feel", "results");
const REPORT_PATH = join(RESULTS_DIR, "playwright-report.json");
const DOCS_DIR = join(REPO_ROOT, "docs", "internal");

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    }),
);

function log(...parts) {
  // eslint-disable-next-line no-console
  console.log("[desktop-feel-audit]", ...parts);
}

function fatal(code, msg) {
  // eslint-disable-next-line no-console
  console.error("[desktop-feel-audit] FATAL:", msg);
  process.exit(code);
}

const targetUrl = process.env.TARGET_URL ?? process.env.PLAYWRIGHT_BASE_URL;
if (!targetUrl && !flags["skip-run"]) {
  fatal(
    3,
    "TARGET_URL is required (or pass --skip-run to parse an existing report). " +
      "Example: TARGET_URL=https://acreos.io node scripts/run-desktop-feel-audit.mjs",
  );
}

if (!flags["skip-run"]) {
  mkdirSync(RESULTS_DIR, { recursive: true });

  const pwArgs = [
    "playwright",
    "test",
    "--config=playwright.desktop-feel.config.ts",
  ];
  if (flags.project) {
    pwArgs.push(`--project=${flags.project}`);
  }

  log("invoking:", "npx", pwArgs.join(" "));
  log("target URL:", targetUrl);
  const res = spawnSync("npx", pwArgs, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TARGET_URL: targetUrl,
      PLAYWRIGHT_BASE_URL: targetUrl,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  log("playwright exited with code", res.status);
}

if (!existsSync(REPORT_PATH)) {
  fatal(
    3,
    `no playwright JSON report at ${REPORT_PATH} — did Playwright run?`,
  );
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
} catch (err) {
  fatal(3, `failed to parse ${REPORT_PATH}: ${err.message}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Classify each project × test result into green / amber / red.
// ────────────────────────────────────────────────────────────────────────────

function classify(report) {
  const perProject = {};

  function visitSuite(suite) {
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        for (const t of spec.tests ?? []) {
          const proj = t.projectName ?? "unknown";
          if (!perProject[proj]) perProject[proj] = { specs: [] };
          const finalResult = (t.results ?? []).slice(-1)[0] ?? {};
          perProject[proj].specs.push({
            title: spec.title,
            file: spec.file,
            status: finalResult.status ?? t.status ?? "unknown",
            durationMs: finalResult.duration ?? 0,
            retries: (t.results ?? []).length - 1,
          });
        }
      }
    }
    for (const s of suite.suites ?? []) visitSuite(s);
  }

  for (const s of report.suites ?? []) visitSuite(s);

  const summary = {};
  for (const [proj, data] of Object.entries(perProject)) {
    let red = 0,
      amber = 0,
      green = 0;
    for (const sp of data.specs) {
      if (sp.status === "failed" || sp.status === "timedOut") red++;
      else if (sp.status === "skipped" || sp.retries > 0) amber++;
      else green++;
    }
    const classification = red > 0 ? "red" : amber > 0 ? "amber" : "green";
    summary[proj] = {
      classification,
      counts: { red, amber, green },
      specs: data.specs,
    };
  }
  return summary;
}

const classified = classify(report);
const projectNames = Object.keys(classified).sort();

const totalReds = projectNames.filter(
  (p) => classified[p].classification === "red",
).length;
const totalAmbers = projectNames.filter(
  (p) => classified[p].classification === "amber",
).length;
const totalGreens = projectNames.filter(
  (p) => classified[p].classification === "green",
).length;

log(
  `classified ${projectNames.length} projects — red=${totalReds} amber=${totalAmbers} green=${totalGreens}`,
);

// ────────────────────────────────────────────────────────────────────────────
// Write JSON + Markdown summaries.
// ────────────────────────────────────────────────────────────────────────────

const isoDate = new Date().toISOString().replace(/[:.]/g, "-");

const summary = {
  runAt: new Date().toISOString(),
  targetUrl: targetUrl ?? "(unspecified — parsed existing report)",
  totals: { red: totalReds, amber: totalAmbers, green: totalGreens },
  projects: classified,
};

if (!flags["no-write"]) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const jsonOut = join(RESULTS_DIR, `${isoDate}.json`);
  writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
  log("wrote", jsonOut);

  mkdirSync(DOCS_DIR, { recursive: true });
  const mdOut = join(DOCS_DIR, `desktop-feel-results-${isoDate}.md`);
  const mdLines = [];
  mdLines.push(`# Desktop-feel Audit — ${summary.runAt}`);
  mdLines.push("");
  mdLines.push(`**Target:** ${summary.targetUrl}`);
  mdLines.push(
    `**Totals:** ${totalGreens} green · ${totalAmbers} amber · ${totalReds} red`,
  );
  mdLines.push("");
  mdLines.push("## Per-project classification (viewport × theme)");
  mdLines.push("");
  mdLines.push("| Project | Status | Green | Amber | Red |");
  mdLines.push("|---|---|---|---|---|");
  for (const proj of projectNames) {
    const c = classified[proj];
    const icon =
      c.classification === "red"
        ? "RED"
        : c.classification === "amber"
          ? "AMBER"
          : "GREEN";
    mdLines.push(
      `| \`${proj}\` | ${icon} | ${c.counts.green} | ${c.counts.amber} | ${c.counts.red} |`,
    );
  }
  mdLines.push("");

  if (totalReds > 0) {
    mdLines.push("## Red details");
    mdLines.push("");
    for (const proj of projectNames) {
      const c = classified[proj];
      if (c.classification !== "red") continue;
      mdLines.push(`### \`${proj}\``);
      mdLines.push("");
      for (const sp of c.specs) {
        if (sp.status === "failed" || sp.status === "timedOut") {
          mdLines.push(
            `- **${sp.status}** — \`${sp.title}\` (${sp.durationMs}ms, ${sp.retries} retries)`,
          );
        }
      }
      mdLines.push("");
    }
  }

  writeFileSync(mdOut, mdLines.join("\n"));
  log("wrote", mdOut);
}

if (totalReds > 0) {
  log(`exiting 2 — ${totalReds} project(s) RED`);
  process.exit(2);
}
log("exiting 0 — no red projects");
process.exit(0);
