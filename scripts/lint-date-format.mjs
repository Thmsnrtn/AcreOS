#!/usr/bin/env node
// ============================================================================
// scripts/lint-date-format.mjs — date-format single-source ratchet.
// ----------------------------------------------------------------------------
// The house rule (census §1 systemic issue #4, "date-format anarchy"): all
// human-facing dates go through lib/format.ts (formatDate / formatDateTime /
// formatRelative), never raw `.toLocaleDateString()` / `.toLocaleTimeString()`
// — those drift per-locale and per-call-site (leads showed 6 different idioms).
// The W2-2 codemod migrated ~95 files onto the helpers; this ratchet locks the
// win so new drift can't creep back, and lets the remaining grandfathered
// sites be driven to zero.
//
// SCOPE: only `.toLocaleDateString(` / `.toLocaleTimeString(` (DATE/TIME). Bare
// `.toLocaleString()` is overwhelmingly NUMBER formatting (1,234 separators) —
// legitimate and intentionally NOT matched.
//
// Bidirectional baseline (same idiom as lint-page-hex / lint-css-hover):
//   - a NON-baseline file with any hit            → FAIL (route it through lib/format)
//   - a baseline file ABOVE its count             → FAIL (new offender in a known file)
//   - a baseline file BELOW its count             → FAIL ("good — tighten the baseline")
//   - a baseline entry whose file is now clean    → FAIL stale (remove the entry)
//   - everything at baseline                       → PASS
// The only way the number moves is DOWN, locked in by editing this baseline.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCAN_DIR = join(ROOT, "client", "src");

const HIT_RE = /\.toLocale(?:Date|Time)String\s*\(/g;

// Grandfathered sites awaiting migration to lib/format. DRIVE TO ZERO; never add.
const BASELINE = new Map([
  ["client/src/components/borrower/StatementsPanel.tsx", 2],
  ["client/src/components/calendar-widget.tsx", 1],
  ["client/src/components/conversation-tray.tsx", 1],
  ["client/src/components/founder-bridge/BridgeHeader.tsx", 2],
  ["client/src/components/founder-chat/artifacts/mrr_sparkline.tsx", 1],
  ["client/src/components/founder/ActivityTimeline.tsx", 2],
  ["client/src/components/founder/MorningBriefing.tsx", 1],
  ["client/src/components/notification-banner.tsx", 1],
  ["client/src/components/pax-copilot-rail.tsx", 2],
  ["client/src/components/pax-tasks-settings-tab.tsx", 1],
  ["client/src/components/signature-capture.tsx", 1],
  ["client/src/components/sms-conversation.tsx", 1],
  ["client/src/components/support-content.tsx", 1],
  ["client/src/components/team-general-channel.tsx", 1],
  ["client/src/components/template-editor.tsx", 3],
  ["client/src/pages/changelog.tsx", 1],
  ["client/src/pages/command-center.tsx", 1],
  ["client/src/pages/deal-room-share.tsx", 1],
  ["client/src/pages/field-note-detail.tsx", 1],
  ["client/src/pages/field-notes-archive.tsx", 1],
  ["client/src/pages/founder/command.tsx", 1],
  ["client/src/pages/founder/cost.tsx", 1],
  ["client/src/pages/founder/inspector.tsx", 1],
  ["client/src/pages/land-credit.tsx", 1],
  ["client/src/pages/outreach/mail/compose.tsx", 1],
  ["client/src/pages/transparency.tsx", 1],
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx$/.test(entry.name) && !/\.(test|spec)\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const counts = new Map();
let scanned = 0;
let total = 0;
for (const file of walk(SCAN_DIR)) {
  const rel = relative(ROOT, file);
  scanned++;
  const src = readFileSync(file, "utf8");
  const n = (src.match(HIT_RE) || []).length;
  if (n > 0) {
    counts.set(rel, n);
    total += n;
  }
}

const newOffenders = [];
const grew = [];
const shrank = [];
for (const [rel, n] of counts) {
  const base = BASELINE.get(rel);
  if (base === undefined) newOffenders.push(`${rel} (${n})`);
  else if (n > base) grew.push(`${rel}: ${n} > baseline ${base}`);
  else if (n < base) shrank.push(`${rel}: ${n} < baseline ${base} — set baseline to ${n}`);
}
const stale = [];
for (const [rel, base] of BASELINE) {
  if (!counts.has(rel)) stale.push(`${rel} (was ${base}, now 0 — remove the entry)`);
}

console.log(
  `[lint-date-format] scanned ${scanned} tsx files; toLocaleDate/TimeString hits: ${total}; ` +
    `baseline files: ${BASELINE.size}; new offenders: ${newOffenders.length} file(s); stale baseline entries: ${stale.length}`,
);

const fail = newOffenders.length || grew.length || shrank.length || stale.length;
if (fail) {
  if (newOffenders.length)
    console.error(
      `[lint-date-format] FAIL — new file(s) using toLocaleDate/TimeString. Route human-facing dates through lib/format.ts (formatDate/formatDateTime/formatRelative):\n` +
        newOffenders.map((o) => `  • ${o}`).join("\n"),
    );
  if (grew.length)
    console.error(`[lint-date-format] FAIL — baseline file(s) grew:\n` + grew.map((o) => `  • ${o}`).join("\n"));
  if (shrank.length)
    console.error(
      `[lint-date-format] FAIL — improvement! lock it in by lowering the baseline:\n` +
        shrank.map((o) => `  • ${o}`).join("\n"),
    );
  if (stale.length)
    console.error(
      `[lint-date-format] FAIL — stale baseline (migrated — good!); remove the entr(y/ies):\n` +
        stale.map((o) => `  • ${o}`).join("\n"),
    );
  process.exit(1);
}

console.log("[lint-date-format] PASS");
