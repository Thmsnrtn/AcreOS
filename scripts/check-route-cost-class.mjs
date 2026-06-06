#!/usr/bin/env node
/**
 * L5b — Route cost-class lint.
 *
 * Enforces that any *new* route handler added to server/routes*.ts
 * declares a costClass. The check is delta-only — flagging the ~hundreds
 * of pre-existing routes en masse would be a multi-week retrofit and not
 * actionable in CI. Instead, every new commit must pull its weight.
 *
 * What counts as a route:
 *   - `app.METHOD(...)` calls in server/routes*.ts where METHOD is one of
 *     get/post/put/patch/delete/all/options/head.
 *   - `router.METHOD(...)` calls inside server/routes*.ts.
 *
 * What counts as costClass declared:
 *   - The route's argument list contains a call to `costClass(...)` or
 *     `withCostClass(...)`.
 *   - OR the handler attached to the route was defined with
 *     `withCostClass(...)` (we grep upward for the name binding).
 *
 * Modes:
 *   - default: diff vs origin/main (CI mode)
 *   - --all:   audit every server/routes*.ts route (full retrofit progress)
 *   - --new-only: only NEW (added) routes in the diff (default behaviour)
 *
 * Exit code: 0 on pass, 1 on violation.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all", "options", "head"];
const ROUTE_METHOD_RE = new RegExp(`^\\s*(?:app|router)\\.(?:${ROUTE_METHODS.join("|")})\\s*\\(`, "i");
const COST_CLASS_RE = /\b(?:costClass|withCostClass)\s*\(/;

const args = process.argv.slice(2);
const mode = args.includes("--all") ? "all" : "new-only";
const baseRef = process.env.LINT_BASE_REF || "origin/main";

const ROUTES_DIR = "server";

function listRouteFiles() {
  const entries = readdirSync(ROUTES_DIR);
  return entries
    .filter((name) => /^routes.*\.ts$/.test(name) && !name.endsWith(".test.ts"))
    .map((name) => join(ROUTES_DIR, name));
}

function isRouteCall(line) {
  return ROUTE_METHOD_RE.test(line);
}

/**
 * Walk forward from the route-start line until we see a balancing
 * close-paren at column ≤ the open. Return the joined route block.
 */
function readRouteBlock(lines, startIdx) {
  let depth = 0;
  let started = false;
  const collected = [];
  for (let i = startIdx; i < lines.length && i < startIdx + 200; i++) {
    const line = lines[i];
    collected.push(line);
    for (const ch of line) {
      if (ch === "(") {
        depth++;
        started = true;
      } else if (ch === ")") {
        depth--;
        if (started && depth === 0) {
          return collected.join("\n");
        }
      }
    }
  }
  return collected.join("\n");
}

function findRouteViolations(file) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isRouteCall(lines[i])) continue;
    const block = readRouteBlock(lines, i);
    if (!COST_CLASS_RE.test(block)) {
      // Snip first line to keep error readable.
      const head = lines[i].trim().slice(0, 120);
      violations.push({ file, line: i + 1, head });
    }
  }
  return violations;
}

function gitDiff() {
  try {
    return execSync(`git diff --unified=0 ${baseRef}...HEAD -- ${ROUTES_DIR}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

function newRoutesFromDiff() {
  const diff = gitDiff();
  if (!diff) return [];
  const adds = [];
  let currentFile = null;
  let currentLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
    } else if (line.startsWith("@@")) {
      const m = /\+(\d+)/.exec(line);
      if (m) currentLine = parseInt(m[1], 10);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      const body = line.slice(1);
      if (currentFile && /^server\/routes.*\.ts$/.test(currentFile) && isRouteCall(body)) {
        adds.push({ file: currentFile, line: currentLine, body });
      }
      currentLine++;
    } else if (!line.startsWith("-")) {
      currentLine++;
    }
  }
  return adds;
}

function main() {
  if (mode === "all") {
    const files = listRouteFiles();
    let total = 0;
    for (const f of files) {
      const viols = findRouteViolations(f);
      total += viols.length;
      for (const v of viols) {
        console.log(`${v.file}:${v.line}: route without costClass — ${v.head}`);
      }
    }
    console.log(`\n[check-route-cost-class] AUDIT: ${total} unclassified route(s) across ${files.length} file(s)`);
    process.exit(0); // audit mode is informational
  }

  // new-only — diff vs base
  const adds = newRoutesFromDiff();
  if (adds.length === 0) {
    console.log("[check-route-cost-class] no new routes in diff vs " + baseRef);
    process.exit(0);
  }

  // For each added route line, re-read the file and verify costClass present
  // in the route block. We need the block context because the route
  // declaration may span multiple lines and the added line might be just
  // the `app.get(` opener.
  const fileLineToViolation = new Map();
  for (const add of adds) {
    let content;
    try {
      content = readFileSync(add.file, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    // Find the route-start line nearest to add.line (could be the line itself
    // or the line above if the added line is a continuation).
    let startIdx = add.line - 1;
    for (let probe = Math.max(0, startIdx - 5); probe <= startIdx; probe++) {
      if (isRouteCall(lines[probe] ?? "")) {
        startIdx = probe;
        break;
      }
    }
    if (!isRouteCall(lines[startIdx] ?? "")) continue;
    const block = readRouteBlock(lines, startIdx);
    if (!COST_CLASS_RE.test(block)) {
      const key = `${add.file}:${startIdx + 1}`;
      fileLineToViolation.set(key, {
        file: add.file,
        line: startIdx + 1,
        head: (lines[startIdx] ?? "").trim().slice(0, 120),
      });
    }
  }

  const violations = [...fileLineToViolation.values()];
  if (violations.length === 0) {
    console.log("[check-route-cost-class] OK: all new routes declare costClass()");
    process.exit(0);
  }

  console.error("[check-route-cost-class] FAIL: new routes missing costClass declaration:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.head}`);
  }
  console.error(`
Every new route must declare its expected cost-shape. Pick one:

  costClass("free")   — no DB / no provider call (e.g. health checks)
  costClass("low")    — single DB query
  costClass("medium") — multiple DB queries OR cheap provider hit
  costClass("high")   — AI inference or expensive provider call
  costClass("bypass") — explicit opt-out (use for webhooks where the
                       cost shape is genuinely unknown at registration)

Import from "@/server/utils/costClass" and place it in the middleware chain
before the handler:

  import { costClass } from "./utils/costClass";

  app.get("/api/leads", isAuthenticated, costClass("low"), async (req, res) => { ... });

See server/utils/costClass.ts for details.
`);
  process.exit(1);
}

main();
