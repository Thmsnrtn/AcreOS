#!/usr/bin/env node
// ============================================================================
// scripts/check-mail-lane.mjs
// ----------------------------------------------------------------------------
// R-2 mail-lane containment gate (founder ruling 2026-08-11, SEND LANE).
//
// WHY
// ───
// Physical mail had FOUR parallel Lob clients with four credential stories,
// only one of which resolved the org's own key. `lobService.ts` and
// `directMail.ts` read process.env directly and both were reachable from
// `services/communications.ts`, so "counterparty mail rides the customer's own
// connected identity" was true of some paths and false of others. The founder
// ruled: ONE door (`server/services/mail/mailLanes.ts`), and the platform key
// stays reachable only for system mail and the registered activation wedge.
//
// WHAT IT CHECKS  (two assertions; the load-bearing one is DERIVED)
// ─────────────────────────────────────────────────────────────────
// A. DERIVED — SEND-PATH PURITY. Enumerate every file that constructs a Lob
//    client (`new Lob(`) by GREP, not from a list. Each such file must
//    (1) import from `mail/mailLanes` — i.e. get its key from the door — and
//    (2) contain zero Lob credential env tokens. A fifth Lob client added
//    anywhere in the repo fails this automatically; there is no list to
//    forget to update. This is the assertion that bites.
//
// B. ALLOWLISTED — CREDENTIAL-ENV CONTAINMENT. Any file naming a Lob
//    credential / arm-switch env var must appear in
//    scripts/mail-lane.allowlist.json with a role and a reason. The allowlist
//    was derived by walking every mail-sending path from every surface, not
//    from the brief — see the map in the R-2 report. Roles:
//      resolver      — THE platform-key resolver + live-send interlock
//      observability — health/readiness/setup/probe reads; MUST NOT send
//      registry      — config/connection metadata naming the var as a string
//      verification  — Lob address lookups (no paper, no counterparty)
//      webhook       — inbound signature secret
//      redaction     — secret-scrubbing patterns
//      test          — a test pinning one of the above
//
//    Entries are checked for STALENESS in both directions: an allowlisted file
//    that no longer exists, or no longer names a Lob env var, is a failure —
//    "fix the occurrence, then shrink the allowlist in the same commit". The
//    allowlist may only shrink.
//
// Cost-table overrides (LOB_POSTCARD_4X6_CENTS, LOB_LETTER_BW_CENTS, …) are
// deliberately NOT credentials and are excluded by pattern, not by allowlist.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

/** Lob CREDENTIAL + arm-switch env vars. Not the *_CENTS cost overrides. */
const CREDENTIAL_TOKENS = [
  "LOB_API_KEY",
  "LOB_TEST_API_KEY",
  "LOB_LIVE_API_KEY",
  "LOB_LIVE_SEND_ENABLED",
  "LOB_WEBHOOK_SECRET",
];
const CREDENTIAL_RE = new RegExp(`\\b(${CREDENTIAL_TOKENS.join("|")})\\b`);

/** The one door every Lob client must resolve its key through. */
const DOOR = "mail/mailLanes";
const DOOR_FILE = "server/services/mail/mailLanes.ts";

const SCAN_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;
const SCAN_ROOTS = ["server/", "client/", "shared/", "scripts/", "tests/", "oz/"];

let tracked;
try {
  tracked = execSync("git ls-files", { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
} catch {
  console.error("[mail-lane] could not run `git ls-files` — skipping (fail-open).");
  process.exit(0);
}

const files = tracked.filter(
  (p) => SCAN_EXT.test(p) && SCAN_ROOTS.some((r) => p.startsWith(r)) && existsSync(join(REPO, p)),
);

const read = (p) => readFileSync(join(REPO, p), "utf8");

// ── Allowlist ────────────────────────────────────────────────────────────────
const ALLOWLIST_PATH = join(__dirname, "mail-lane.allowlist.json");
let allowlist = [];
try {
  allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).entries;
} catch (err) {
  console.error(`[mail-lane] cannot read ${ALLOWLIST_PATH}: ${err.message}`);
  process.exit(1);
}
const allowed = new Map(allowlist.map((e) => [e.file, e]));

const failures = [];

// ── A. DERIVED: every Lob client must resolve through the door ───────────────
// A Lob CLIENT is a file that both IMPORTS the `lob` package and constructs it.
// Requiring the import keeps prose that merely quotes the constructor (e.g. the
// governance registry describing this very gate) out of the derived set.
const NEW_LOB_RE = /^(?!\s*(?:\/\/|\*|\/\*)).*\bnew\s+Lob\s*\(/m;
const IMPORTS_LOB_RE = /(?:^|\n)\s*import\s+[^;]*\bfrom\s+['"]lob['"]|require\(\s*['"]lob['"]\s*\)/;
const lobClients = files.filter((p) => {
  if (p === DOOR_FILE) return false;
  const src = read(p);
  return IMPORTS_LOB_RE.test(src) && NEW_LOB_RE.test(src);
});

for (const p of lobClients) {
  const src = read(p);
  const isTest = p.startsWith("tests/");
  if (!src.includes(DOOR) && !isTest) {
    failures.push(
      `${p}: constructs a Lob client but does not import from '${DOOR}'. ` +
        `Every Lob credential comes from mailLanes.assertMailLane — there is no second door.`,
    );
  }
  if (CREDENTIAL_RE.test(src) && !isTest) {
    failures.push(
      `${p}: constructs a Lob client AND names a Lob credential env var ` +
        `(${src.match(CREDENTIAL_RE)[1]}). Send paths never read env keys.`,
    );
  }
}

if (lobClients.length === 0) {
  failures.push(
    "[mail-lane] found ZERO Lob client constructions — the derived check has nothing to " +
      "assert against, which means this gate has silently stopped working. Investigate before shipping.",
  );
}

// ── B. Credential-env containment ────────────────────────────────────────────
const offenders = [];
for (const p of files) {
  if (p === "scripts/check-mail-lane.mjs") continue;
  const src = read(p);
  if (!CREDENTIAL_RE.test(src)) continue;
  if (!allowed.has(p)) offenders.push(p);
}

for (const p of offenders) {
  failures.push(
    `${p}: names a Lob credential env var but is not in scripts/mail-lane.allowlist.json. ` +
      `Route it through server/services/mail/mailLanes.ts, or add an allowlist entry with a role + reason.`,
  );
}

// ── B2. Allowlist staleness — it may only SHRINK ─────────────────────────────
for (const entry of allowlist) {
  if (!existsSync(join(REPO, entry.file))) {
    failures.push(
      `allowlist entry '${entry.file}' points at a file that no longer exists — remove the entry (the allowlist may only shrink).`,
    );
    continue;
  }
  if (!CREDENTIAL_RE.test(read(entry.file))) {
    failures.push(
      `allowlist entry '${entry.file}' no longer names a Lob credential env var — remove the entry (the allowlist may only shrink).`,
    );
  }
  if (!entry.role || !entry.reason) {
    failures.push(`allowlist entry '${entry.file}' is missing a role or a reason.`);
  }
  if (entry.role === "send") {
    failures.push(
      `allowlist entry '${entry.file}' claims role "send" — a send path may never read a credential env var.`,
    );
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error("\n[mail-lane] FAILED — physical-mail credential containment broken:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    `\n  Lob clients found (derived): ${lobClients.length ? lobClients.join(", ") : "(none)"}` +
      `\n  Allowlisted credential-env files: ${allowlist.length}\n`,
  );
  process.exit(1);
}

console.log(
  `[mail-lane] OK — ${lobClients.length} Lob client(s), all resolving through ${DOOR}; ` +
    `${allowlist.length} allowlisted non-send credential-env file(s).`,
);
