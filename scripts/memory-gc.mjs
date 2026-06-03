#!/usr/bin/env node
/**
 * memory-gc.mjs — read-only scanner for the Solene memory dir.
 *
 * Surfaces stale / duplicate / contradictory / orphaned-link / index-hygiene
 * candidates as a dated markdown report. Does NOT modify any memory file.
 *
 * Usage:
 *   node scripts/memory-gc.mjs scan [--out <report-path>]
 *   node scripts/memory-gc.mjs --help
 *
 * Env:
 *   SOLENE_MEMORY_DIR — override default memory dir (used in tests).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// ──────────────────────────────────────────────────────────────────────
// Constants

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "with", "on",
]);

const TEMPORAL_TERMS = [
  "in flight", "wip", "in progress", "currently", "open", "queued",
  "pending", "today", "this week",
];

const RECENT_TERMS = ["recent", "today", "this week"];

const ANTONYM_PAIRS = [
  ["always", "never"],
  ["must", "cannot"],
  ["enabled", "disabled"],
  ["use", "avoid"],
  ["enable", "disable"],
  ["permitted", "forbidden"],
];

const DATE_RE = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
const STALE_DAYS = 30;
const JACCARD_THRESHOLD = 0.6;

// Credential-shape sanitization (drawn from failure-modes/0003 pattern):
// long alphanumeric blobs that look like API keys / tokens.
const CREDENTIAL_SHAPES = [
  /\b(sk|pk|rk|ey|ghp|gho|ghu|ghs|xox[abprs])[-_][A-Za-z0-9_-]{20,}\b/g,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

function sanitize(text) {
  let out = text;
  for (const re of CREDENTIAL_SHAPES) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Frontmatter parser (minimal, no deps)

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { frontmatter: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const fm = {};
  let currentKey = null;
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) {
      currentKey = m[1];
      fm[currentKey] = m[2].trim();
    } else if (currentKey && /^\s+/.test(line)) {
      fm[currentKey] += " " + line.trim();
    }
  }
  return { frontmatter: fm, body };
}

// ──────────────────────────────────────────────────────────────────────
// Tokenization + similarity

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ──────────────────────────────────────────────────────────────────────
// Scan

function loadMemories(memoryDir) {
  const entries = fs.readdirSync(memoryDir, { withFileTypes: true });
  const memories = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".md")) continue;
    if (e.name === "MEMORY.md") continue;
    const filePath = path.join(memoryDir, e.name);
    const raw = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    const { frontmatter, body } = parseFrontmatter(raw);
    memories.push({
      file: e.name,
      filePath,
      name: frontmatter.name || e.name.replace(/\.md$/, ""),
      description: frontmatter.description || "",
      type: frontmatter.type || "",
      originSessionId: frontmatter.originSessionId || "",
      body,
      raw,
      mtime: stat.mtimeMs,
    });
  }
  return memories;
}

function findDatesOlderThan(text, days, today) {
  const cutoff = today.getTime() - days * 24 * 60 * 60 * 1000;
  const hits = [];
  let m;
  // Reset state for global regex.
  const re = new RegExp(DATE_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    const dt = Date.parse(iso + "T00:00:00Z");
    if (!Number.isNaN(dt) && dt < cutoff) hits.push(iso);
  }
  return hits;
}

function findTemporalTerms(text) {
  const low = text.toLowerCase();
  return TEMPORAL_TERMS.filter((t) => low.includes(t));
}

function findRecentTerms(text) {
  const low = text.toLowerCase();
  return RECENT_TERMS.filter((t) => low.includes(t));
}

function findAntonymHits(textA, textB) {
  const la = textA.toLowerCase();
  const lb = textB.toLowerCase();
  const hits = [];
  for (const [w1, w2] of ANTONYM_PAIRS) {
    const re1 = new RegExp(`\\b${w1}\\b`);
    const re2 = new RegExp(`\\b${w2}\\b`);
    const aHasW1 = re1.test(la);
    const aHasW2 = re2.test(la);
    const bHasW1 = re1.test(lb);
    const bHasW2 = re2.test(lb);
    // Antonym pair present across the two descriptions.
    if ((aHasW1 && bHasW2) || (aHasW2 && bHasW1)) {
      hits.push([w1, w2]);
    }
  }
  return hits;
}

function findLinkTargets(body) {
  const targets = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    targets.push(m[1].trim());
  }
  return targets;
}

function loadMemoryIndex(memoryDir) {
  const indexPath = path.join(memoryDir, "MEMORY.md");
  if (!fs.existsSync(indexPath)) return { exists: false, entries: [] };
  const raw = fs.readFileSync(indexPath, "utf8");
  const entries = [];
  const re = /\[[^\]]+\]\(([^)]+\.md)\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    entries.push(m[1].trim());
  }
  return { exists: true, entries, raw };
}

function scan(memoryDir, today = new Date()) {
  const memories = loadMemories(memoryDir);
  const byName = new Map();
  for (const mem of memories) byName.set(mem.name, mem);

  const staleDated = [];
  const staleTemporal = [];
  const duplicates = [];
  const contradictions = [];
  const orphans = [];
  const indexHygiene = [];

  // 1+2. Stale candidates
  for (const mem of memories) {
    const desc = mem.description;
    const datedHits = findDatesOlderThan(desc, STALE_DAYS, today);
    if (datedHits.length > 0) {
      staleDated.push({
        name: mem.name,
        file: mem.file,
        dates: datedHits,
        description: desc,
      });
    }
    const temporalHits = findTemporalTerms(desc);
    if (temporalHits.length > 0) {
      staleTemporal.push({
        name: mem.name,
        file: mem.file,
        terms: temporalHits,
        description: desc,
        kind: "likely_stale_temporal",
      });
    }
    // mtime-based "recent" check
    const mtimeAge = today.getTime() - mem.mtime;
    if (mtimeAge > STALE_DAYS * 24 * 60 * 60 * 1000) {
      const recentHits = findRecentTerms(desc);
      if (recentHits.length > 0) {
        staleTemporal.push({
          name: mem.name,
          file: mem.file,
          terms: recentHits,
          description: desc,
          kind: "likely_stale_temporal_mtime",
        });
      }
    }
  }

  // 3. Duplicates (token-overlap Jaccard)
  const tokenized = memories.map((m) => ({
    mem: m,
    tokens: tokenize(m.description),
  }));
  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      const a = tokenized[i];
      const b = tokenized[j];
      if (a.tokens.length === 0 || b.tokens.length === 0) continue;
      const sim = jaccard(a.tokens, b.tokens);
      if (sim >= JACCARD_THRESHOLD) {
        duplicates.push({
          a: { name: a.mem.name, file: a.mem.file, description: a.mem.description },
          b: { name: b.mem.name, file: b.mem.file, description: b.mem.description },
          similarity: sim,
        });
      }
    }
  }

  // 4. Contradictions (antonym pair overlap)
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];
      const antoHits = findAntonymHits(a.description, b.description);
      if (antoHits.length > 0) {
        contradictions.push({
          a: { name: a.name, file: a.file, description: a.description },
          b: { name: b.name, file: b.file, description: b.description },
          antonyms: antoHits,
        });
      }
    }
  }

  // 5. Orphaned references
  for (const mem of memories) {
    const targets = findLinkTargets(mem.body);
    for (const tgt of targets) {
      if (!byName.has(tgt)) {
        orphans.push({
          source: mem.name,
          file: mem.file,
          missingTarget: tgt,
        });
      }
    }
  }

  // 6. MEMORY.md hygiene
  const index = loadMemoryIndex(memoryDir);
  if (index.exists) {
    const indexFileSet = new Set(index.entries);
    // Dead entries
    for (const entry of index.entries) {
      const fullPath = path.join(memoryDir, entry);
      if (!fs.existsSync(fullPath)) {
        indexHygiene.push({
          kind: "dead_index_entry",
          entry,
        });
      }
    }
    // Unindexed memories
    for (const mem of memories) {
      if (!indexFileSet.has(mem.file)) {
        indexHygiene.push({
          kind: "unindexed_memory",
          name: mem.name,
          file: mem.file,
        });
      }
    }
  }

  return {
    memoryDir,
    today,
    totalFiles: memories.length,
    staleDated,
    staleTemporal,
    duplicates,
    contradictions,
    orphans,
    indexHygiene,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Report rendering

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function renderReport(result) {
  const lines = [];
  const date = isoDate(result.today);
  lines.push(`# Memory GC scan — ${date}`);
  lines.push("");
  lines.push(`Scanned: ${result.totalFiles} memory files in ${result.memoryDir}.`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Potentially stale (dated): ${result.staleDated.length}`);
  lines.push(`- Likely stale (temporal language): ${result.staleTemporal.length}`);
  lines.push(`- Duplicate candidates: ${result.duplicates.length}`);
  lines.push(`- Contradiction candidates: ${result.contradictions.length}`);
  lines.push(`- Orphaned references: ${result.orphans.length}`);
  lines.push(`- MEMORY.md hygiene issues: ${result.indexHygiene.length}`);
  lines.push("");

  lines.push("## Stale candidates");
  if (result.staleDated.length === 0 && result.staleTemporal.length === 0) {
    lines.push("_None._");
  } else {
    if (result.staleDated.length > 0) {
      lines.push("");
      lines.push("### Potentially stale (dated)");
      for (const s of result.staleDated) {
        lines.push(`- **${s.name}** (\`${s.file}\`) — dates: ${s.dates.join(", ")}`);
        lines.push(`  - description: ${sanitize(s.description)}`);
      }
    }
    if (result.staleTemporal.length > 0) {
      lines.push("");
      lines.push("### Likely stale (temporal language)");
      for (const s of result.staleTemporal) {
        lines.push(`- **${s.name}** (\`${s.file}\`) — terms: ${s.terms.join(", ")} (${s.kind})`);
        lines.push(`  - description: ${sanitize(s.description)}`);
      }
    }
  }
  lines.push("");

  lines.push("## Duplicate candidates (Jaccard ≥ 0.6)");
  if (result.duplicates.length === 0) {
    lines.push("_None._");
  } else {
    for (const d of result.duplicates) {
      lines.push(`- **${d.a.name}** ↔ **${d.b.name}** — similarity ${d.similarity.toFixed(2)}`);
      lines.push(`  - \`${d.a.file}\`: ${sanitize(d.a.description)}`);
      lines.push(`  - \`${d.b.file}\`: ${sanitize(d.b.description)}`);
    }
  }
  lines.push("");

  lines.push("## Contradiction candidates");
  if (result.contradictions.length === 0) {
    lines.push("_None._");
  } else {
    for (const c of result.contradictions) {
      const antos = c.antonyms.map(([a, b]) => `${a}/${b}`).join(", ");
      lines.push(`- **${c.a.name}** ↔ **${c.b.name}** — antonym pairs: ${antos}`);
      lines.push(`  - \`${c.a.file}\`: ${sanitize(c.a.description)}`);
      lines.push(`  - \`${c.b.file}\`: ${sanitize(c.b.description)}`);
    }
  }
  lines.push("");

  lines.push("## Orphaned references");
  if (result.orphans.length === 0) {
    lines.push("_None._");
  } else {
    for (const o of result.orphans) {
      lines.push(`- in **${o.source}** (\`${o.file}\`): \`[[${o.missingTarget}]]\` — no memory with that name`);
    }
  }
  lines.push("");

  lines.push("## MEMORY.md hygiene");
  if (result.indexHygiene.length === 0) {
    lines.push("_None._");
  } else {
    for (const h of result.indexHygiene) {
      if (h.kind === "dead_index_entry") {
        lines.push(`- dead_index_entry: MEMORY.md points at \`${h.entry}\` but the file does not exist`);
      } else if (h.kind === "unindexed_memory") {
        lines.push(`- unindexed_memory: **${h.name}** (\`${h.file}\`) exists but is not listed in MEMORY.md`);
      }
    }
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("**This report is informational. Solene reviews each entry; no auto-pruning has been done.**");
  lines.push("");

  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
// CLI

function defaultMemoryDir() {
  if (process.env.SOLENE_MEMORY_DIR) return process.env.SOLENE_MEMORY_DIR;
  const home = process.env.HOME || "";
  return path.resolve(home, ".claude/projects/-Users-user-AcreOS-AcreOS/memory");
}

function helpText() {
  return [
    "memory-gc.mjs — read-only scanner for the Solene memory dir.",
    "",
    "Usage:",
    "  node scripts/memory-gc.mjs scan [--out <report-path>]",
    "  node scripts/memory-gc.mjs --help",
    "",
    "Operations:",
    "  scan   Walk the memory dir, parse frontmatter, and emit a markdown",
    "         report covering:",
    "           - potentially_stale_dated     (dates >30d old in description)",
    "           - likely_stale_temporal       (in flight / today / wip etc.)",
    "           - duplicate_candidate         (Jaccard ≥ 0.6 token overlap)",
    "           - contradiction_candidate     (antonym pairs across memories)",
    "           - orphaned_reference          ([[name]] with no target file)",
    "           - dead_index_entry            (MEMORY.md points at missing file)",
    "           - unindexed_memory            (file exists, not in MEMORY.md)",
    "",
    "Default report path:",
    "  docs/internal/memory-gc-report-<YYYY-MM-DD>.md",
    "",
    "Env:",
    "  SOLENE_MEMORY_DIR  Override the memory directory (used in tests).",
    "",
    "This scan is READ-ONLY. No memory file is modified. Solene reviews the",
    "report manually per docs/internal/memory-gc-discipline.md.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { cmd: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--out") {
      args.out = argv[++i];
    } else if (!args.cmd) {
      args.cmd = a;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.cmd) {
    console.log(helpText());
    return 0;
  }
  if (args.cmd !== "scan") {
    console.log(`Unknown command: ${args.cmd}`);
    console.log(helpText());
    return 1;
  }

  const memoryDir = defaultMemoryDir();
  if (!fs.existsSync(memoryDir)) {
    console.log(`Memory dir not found: ${memoryDir}`);
    return 1;
  }

  const today = new Date();
  const result = scan(memoryDir, today);
  const report = renderReport(result);

  const outPath =
    args.out ??
    path.resolve(
      process.cwd(),
      `docs/internal/memory-gc-report-${isoDate(today)}.md`,
    );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report, "utf8");

  console.log(`Scanned ${result.totalFiles} memory files in ${memoryDir}.`);
  console.log(`Report written to ${outPath}.`);
  console.log(
    `Summary: stale-dated=${result.staleDated.length} stale-temporal=${result.staleTemporal.length} ` +
      `dupes=${result.duplicates.length} contradictions=${result.contradictions.length} ` +
      `orphans=${result.orphans.length} index-hygiene=${result.indexHygiene.length}`,
  );
  return 0;
}

// Exports for tests
export {
  parseFrontmatter,
  tokenize,
  jaccard,
  scan,
  renderReport,
  sanitize,
  findDatesOlderThan,
  findTemporalTerms,
  findAntonymHits,
  findLinkTargets,
};

// Direct-execution guard
const isMain = (() => {
  try {
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
    const self = new URL(import.meta.url).pathname;
    return invoked === self;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.log(`memory-gc failed: ${err?.message ?? err}`);
      process.exit(1);
    },
  );
}
