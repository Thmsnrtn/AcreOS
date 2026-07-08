/**
 * SOLENE CHAT — strategy-layer retrieval (Launch-Week WS3, "The Brain").
 *
 * Gives the founder chat read access to the company's strategy documents —
 * the constitution, the north-star machine doc, the live roadmap, the
 * deletion ledger, the cost audit, and the launch-week plan — so answers to
 * CEO questions are grounded in the REAL strategy layer and every claim can
 * cite where it came from.
 *
 * Mechanism (deliberately boring — no vector infra):
 *   - Docs are repo files under docs/company/. We lazy-read per request with
 *     an mtime cache, so a redeploy or an edited doc is picked up without a
 *     restart while steady-state turns cost zero fs reads.
 *   - Each doc is split into markdown sections; a pure keyword scorer ranks
 *     sections against the founder's question; we keep the top sections
 *     within a hard token budget.
 *   - Every emitted section carries a `[SOURCE: docs/company/<file> § <heading>]`
 *     label so the model can (and is instructed to) cite it.
 *
 * Everything below the fs boundary is pure and exported for tests.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../../../utils/logger";

// ============================================================================
// The strategy library
// ============================================================================

export interface StrategyDocSpec {
  /** Stable id used by eval fixtures + tests (filename minus .md). */
  id: string;
  /** Basename under docs/company/. */
  file: string;
  /** Short human title, shown in the doc index. */
  title: string;
  /**
   * Alias keywords that boost this doc's sections when they appear in the
   * question — keeps retrieval deterministic for the CEO-question eval
   * without any embedding infrastructure.
   */
  keywords: string[];
}

export const STRATEGY_DOCS: readonly StrategyDocSpec[] = [
  {
    id: "CONSTITUTION",
    file: "CONSTITUTION.md",
    title: "The AcreOS Constitution (what we will never do)",
    keywords: ["constitution", "immutable", "principle", "principles", "values", "never", "commitments"],
  },
  {
    id: "mature-machine",
    file: "mature-machine.md",
    title: "Mature Machine — north-star horizons, gates, autonomy switch schedule",
    keywords: ["gate", "gates", "horizon", "horizons", "autonomy", "switch", "switches", "machine", "north-star", "hire", "trust"],
  },
  {
    id: "roadmap-2026-07",
    file: "roadmap-2026-07.md",
    title: "Roadmap — July 2026 (waves, execution ledger)",
    keywords: ["roadmap", "wave", "waves", "next", "milestone", "milestones", "plan", "wedge", "gate", "gates"],
  },
  {
    id: "deletion-ledger",
    file: "deletion-ledger.md",
    title: "Deletion Ledger — what we removed and why",
    keywords: ["deleted", "deletion", "removed", "retired", "ledger", "killed", "cut"],
  },
  {
    id: "cost-audit-2026-07-07",
    file: "cost-audit-2026-07-07.md",
    title: "Cost Audit 2026-07-07 — founder bill, ceilings, margins, runway posture",
    keywords: ["cost", "costs", "spend", "spent", "spending", "ceiling", "ceilings", "budget", "burn", "runway", "margin", "margins", "bill", "envelope", "ai"],
  },
  {
    id: "launch-week-2026-07",
    file: "launch-week-2026-07.md",
    title: "Launch Week 2026-07 — workstreams, drills, first campaign recipe",
    keywords: ["launch", "campaign", "ad", "ads", "drill", "drills", "go", "no-go", "workstream", "recipe", "marketing"],
  },
];

/** Default token budget for strategy sections within the chat context. */
export const STRATEGY_CONTEXT_TOKEN_BUDGET = 5_000;

/** Per-doc raw read cap (bytes) — a runaway doc can't blow the prompt. */
export const STRATEGY_DOC_MAX_BYTES = 120_000;

// ============================================================================
// Pure: sectioning
// ============================================================================

export interface StrategyDocSection {
  docId: string;
  file: string;
  heading: string;
  body: string;
}

/**
 * Split a markdown doc into sections at #/##/### headings. Content before
 * the first heading becomes an "(intro)" section. Pure.
 */
export function splitIntoSections(spec: { id: string; file: string }, markdown: string): StrategyDocSection[] {
  const lines = markdown.split("\n");
  const sections: StrategyDocSection[] = [];
  let heading = "(intro)";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body.length > 0 || sections.length === 0) {
      sections.push({ docId: spec.id, file: spec.file, heading, body });
    }
    buf = [];
  };
  for (const line of lines) {
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[2].trim() || "(untitled)";
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections.filter((s) => s.body.length > 0);
}

// ============================================================================
// Pure: scoring + selection
// ============================================================================

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "did", "do", "does",
  "for", "from", "has", "have", "how", "i", "in", "is", "it", "its", "of",
  "on", "or", "our", "s", "so", "that", "the", "their", "them", "then",
  "there", "they", "this", "to", "us", "was", "we", "were", "what", "whats",
  "when", "where", "which", "who", "why", "will", "with", "would", "you",
  "your",
]);

/** Tokenize a question into lowercase content terms. Pure. */
export function tokenizeQuery(question: string): string[] {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9$%-]+/)
        .map((t) => t.replace(/^-+|-+$/g, ""))
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
    ),
  );
}

/**
 * Score one section against the query terms. Heading hits weigh 3x; body
 * hits are counted with a per-term cap so one repetitive section can't
 * drown everything; doc-keyword matches add a flat boost per matched
 * keyword (applied to every section of that doc). Pure.
 */
export function scoreSection(
  queryTerms: string[],
  section: { heading: string; body: string },
  docKeywordMatches: number,
): number {
  const heading = section.heading.toLowerCase();
  const body = section.body.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (heading.includes(term)) score += 3;
    let idx = 0;
    let hits = 0;
    while (hits < 5) {
      idx = body.indexOf(term, idx);
      if (idx === -1) break;
      hits++;
      idx += term.length;
    }
    score += hits;
  }
  score += docKeywordMatches * 4;
  return score;
}

/** Count how many of the doc's alias keywords appear in the question. Pure. */
export function countDocKeywordMatches(spec: Pick<StrategyDocSpec, "keywords" | "id">, queryTerms: string[], questionLower: string): number {
  let n = 0;
  for (const kw of spec.keywords) {
    if (queryTerms.includes(kw) || (kw.length >= 4 && questionLower.includes(kw))) n++;
  }
  if (queryTerms.some((t) => spec.id.toLowerCase().includes(t) && t.length >= 4)) n++;
  return n;
}

export interface SelectedStrategySection extends StrategyDocSection {
  score: number;
  tokens: number;
}

function sectionTokens(s: StrategyDocSection): number {
  return Math.ceil((s.heading.length + s.body.length) / 4);
}

/**
 * Select the sections to inject for a question, within a token budget.
 *
 * Rules (pure, deterministic):
 *  - Only sections with score > 0 are eligible.
 *  - Every doc whose alias keywords matched the question is guaranteed its
 *    single top section (so "roadmap" questions always surface the roadmap).
 *  - Remaining budget fills with the globally highest-scoring sections.
 */
export function selectStrategySections(
  question: string,
  sectionsByDoc: Map<string, { spec: Pick<StrategyDocSpec, "id" | "keywords">; sections: StrategyDocSection[] }>,
  budgetTokens: number = STRATEGY_CONTEXT_TOKEN_BUDGET,
): SelectedStrategySection[] {
  const queryTerms = tokenizeQuery(question);
  const questionLower = question.toLowerCase();
  if (queryTerms.length === 0) return [];

  const scored: SelectedStrategySection[] = [];
  const guaranteedDocIds = new Set<string>();

  for (const { spec, sections } of sectionsByDoc.values()) {
    const kwMatches = countDocKeywordMatches(spec, queryTerms, questionLower);
    if (kwMatches > 0) guaranteedDocIds.add(spec.id);
    for (const s of sections) {
      const score = scoreSection(queryTerms, s, kwMatches);
      if (score > 0) {
        scored.push({ ...s, score, tokens: sectionTokens(s) });
      }
    }
  }

  // Deterministic ranking: score desc, then docId, then heading.
  scored.sort(
    (a, b) => b.score - a.score || a.docId.localeCompare(b.docId) || a.heading.localeCompare(b.heading),
  );

  const kept: SelectedStrategySection[] = [];
  const keptKeys = new Set<string>();
  let used = 0;
  const keyOf = (s: StrategyDocSection) => `${s.docId}::${s.heading}`;

  // Pass 1 — guarantee each keyword-matched doc its top section.
  for (const docId of guaranteedDocIds) {
    const top = scored.find((s) => s.docId === docId);
    if (top && !keptKeys.has(keyOf(top))) {
      kept.push(top);
      keptKeys.add(keyOf(top));
      used += top.tokens;
    }
  }

  // Pass 2 — fill remaining budget by global rank.
  for (const s of scored) {
    if (keptKeys.has(keyOf(s))) continue;
    if (used + s.tokens > budgetTokens) continue;
    kept.push(s);
    keptKeys.add(keyOf(s));
    used += s.tokens;
  }

  // Stable output order: by doc, then original score.
  kept.sort((a, b) => a.docId.localeCompare(b.docId) || b.score - a.score);
  return kept;
}

/** Render one selected section with its citation label. Pure. */
export function renderStrategySection(s: SelectedStrategySection): string {
  return `[SOURCE: docs/company/${s.file} § "${s.heading}"]\n${s.body}`;
}

/** One-line index of the whole library, so the model knows what exists. Pure. */
export function renderStrategyDocIndex(specs: readonly StrategyDocSpec[] = STRATEGY_DOCS): string {
  const lines = specs.map((d) => `- docs/company/${d.file} — ${d.title}`);
  return `## Strategy library (cite as [SOURCE: docs/company/<file>])\n${lines.join("\n")}`;
}

// ============================================================================
// Fs boundary — lazy read + mtime cache
// ============================================================================

interface CachedDoc {
  mtimeMs: number;
  sections: StrategyDocSection[];
}

const docCache = new Map<string, CachedDoc>();

/** Test hook — clear the mtime cache. */
export function clearStrategyDocCache(): void {
  docCache.clear();
}

async function loadDocSections(
  spec: StrategyDocSpec,
  rootDir: string,
): Promise<StrategyDocSection[] | null> {
  const abs = path.resolve(rootDir, "docs/company", spec.file);
  try {
    const stat = await fs.stat(abs);
    const cached = docCache.get(spec.id);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.sections;
    }
    const raw = await fs.readFile(abs, "utf8");
    const capped = raw.length > STRATEGY_DOC_MAX_BYTES ? raw.slice(0, STRATEGY_DOC_MAX_BYTES) : raw;
    const sections = splitIntoSections(spec, capped);
    docCache.set(spec.id, { mtimeMs: stat.mtimeMs, sections });
    return sections;
  } catch (err) {
    // A missing doc is stated absent, never fabricated — callers get null.
    logger.warn("[soleneChat] strategyDocs.load_failed", {
      docId: spec.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface StrategyBlock {
  /** Strategy-doc id ("roadmap-2026-07"). */
  docId: string;
  label: string;
  content: string;
}

/**
 * Load + select the strategy sections relevant to a question. Never throws;
 * a doc that can't be read simply contributes nothing. Always appends the
 * library index (tiny) so the model can name where an unanswered question
 * WOULD live.
 */
export async function buildStrategyBlocks(
  question: string,
  opts?: { rootDir?: string; budgetTokens?: number },
): Promise<StrategyBlock[]> {
  const rootDir = opts?.rootDir ?? process.cwd();
  const sectionsByDoc = new Map<
    string,
    { spec: Pick<StrategyDocSpec, "id" | "keywords">; sections: StrategyDocSection[] }
  >();
  for (const spec of STRATEGY_DOCS) {
    const sections = await loadDocSections(spec, rootDir);
    if (sections && sections.length > 0) {
      sectionsByDoc.set(spec.id, { spec, sections });
    }
  }

  const selected = selectStrategySections(
    question,
    sectionsByDoc,
    opts?.budgetTokens ?? STRATEGY_CONTEXT_TOKEN_BUDGET,
  );

  const blocks: StrategyBlock[] = selected.map((s) => ({
    docId: s.docId,
    label: `strategy:${s.docId}`,
    content: renderStrategySection(s),
  }));

  blocks.push({
    docId: "__index__",
    label: "strategy:index",
    content: renderStrategyDocIndex(),
  });

  return blocks;
}
