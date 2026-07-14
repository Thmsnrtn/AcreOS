/**
 * Horizon A5 — doctrine corpus ingestion + auditable completeness.
 *
 * Pins:
 *  - the disk walk: *.md under the doctrine dirs + sovereign-protocol/
 *    immutables.json, repo-relative sourceRefs, missing dirs skipped.
 *  - upsert on the (org NULL, 'doctrine', sourceRef) natural key.
 *  - content-hash skip: unchanged files are neither re-embedded nor written.
 *  - changed content updates the existing row in place.
 *  - FAIL-OPEN per file: one bad file never stops the walk (counted failed).
 *  - completeness math: missing + staleHash + extraInStore, computed
 *    disk-vs-store DIRECTLY, with the externally-managed feedback dir named.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Embedding stub — Voyage-with-fallback is pinned by learningLoop's own
// suite. Throwing on demand exercises the per-file fail-open path.
const EMBED_FAIL_FOR = new Set<string>();
const embedMock = vi.fn(async (text: string) => {
  for (const marker of EMBED_FAIL_FOR) {
    if (text.includes(marker)) throw new Error("simulated embed failure");
  }
  return { vector: new Array(8).fill(0.1), model: "voyage-3-large" };
});
vi.mock("../../server/services/solene/learningLoop", () => ({
  embedDocumentTextFailOpen: (text: string) => embedMock(text),
}));

// ─── DB mock ─────────────────────────────────────────────────────────────
// STORE maps sourceRef → { id, contentHash }. The existing-row lookup calls
// .limit(1) (per-file natural-key probe — the sourceRef is recovered from
// the where expression's params); the completeness store read awaits the
// .where() chain directly and gets every row.

const STORE = new Map<string, { id: number; contentHash: string }>();
const INSERTS: Array<Record<string, any>> = [];
const UPDATES: Array<{ id: number | null; values: Record<string, any> }> = [];
let nextId = 1000;

function collectParamValues(expr: any, out: unknown[] = []): unknown[] {
  if (!expr || typeof expr !== "object") return out;
  if ("value" in expr && (typeof expr.value === "string" || typeof expr.value === "number")) {
    out.push(expr.value);
  }
  const chunks = expr.queryChunks ?? [];
  for (const c of chunks) collectParamValues(c, out);
  return out;
}

function sourceRefFromWhere(whereExpr: any): string | null {
  const values = collectParamValues(whereExpr).filter(
    (v): v is string => typeof v === "string" && v !== "doctrine",
  );
  return values[0] ?? null;
}

vi.mock("../../server/db", () => {
  const db = {
    select: (_proj?: any) => ({
      from: (_t: any) => ({
        where: (whereExpr: any) => {
          const chain: any = {
            limit: async (_n: number) => {
              const ref = sourceRefFromWhere(whereExpr);
              const row = ref ? STORE.get(ref) : undefined;
              return row ? [{ id: row.id, contentHash: row.contentHash }] : [];
            },
            then(onF: (rows: any[]) => any, onR?: (e: any) => any) {
              const rows = [...STORE.entries()].map(([sourceRef, r]) => ({
                sourceRef,
                contentHash: r.contentHash,
              }));
              return Promise.resolve(rows).then(onF, onR);
            },
          };
          return chain;
        },
      }),
    }),
    insert: (_t: any) => ({
      values: async (row: Record<string, any>) => {
        INSERTS.push(row);
        STORE.set(row.sourceRef, { id: nextId++, contentHash: row.contentHash });
      },
    }),
    update: (_t: any) => ({
      set: (values: Record<string, any>) => ({
        where: async (whereExpr: any) => {
          const ids = collectParamValues(whereExpr).filter(
            (v): v is number => typeof v === "number",
          );
          UPDATES.push({ id: ids[0] ?? null, values });
          const id = ids[0];
          for (const [ref, row] of STORE) {
            if (row.id === id) STORE.set(ref, { id, contentHash: values.contentHash });
          }
        },
      }),
    }),
  };
  return { db };
});

import {
  walkDoctrineFiles,
  ingestDoctrineCorpus,
  corpusCompleteness,
  DOCTRINE_NAMESPACE,
} from "../../server/services/solene/doctrineIngest";
import { logger } from "../../server/utils/logger";
import crypto from "node:crypto";

// ─── Fixture repo tree ───────────────────────────────────────────────────

let ROOT: string;

function write(rel: string, content: string): void {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
  STORE.clear();
  INSERTS.length = 0;
  UPDATES.length = 0;
  EMBED_FAIL_FOR.clear();
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "doctrine-ingest-test-"));
  write("docs/company/CONSTITUTION.md", "# Constitution\nDoctrine A.");
  write("docs/company/decision-memos/memo-1.md", "# Memo 1\nRuling.");
  write("docs/internal/team-roster.md", "# Roster\nInternal doctrine.");
  write("sovereign-protocol/constitution.md", "# Sovereign\nPrinciples.");
  write("sovereign-protocol/immutables.json", '{"version":"1.1.0"}');
  // Noise that must be ignored by the walk:
  write("docs/company/notes.txt", "not markdown");
  write("server/services/foo.md", "outside the doctrine dirs");
});

// ─── Walk ────────────────────────────────────────────────────────────────

describe("walkDoctrineFiles", () => {
  it("finds *.md recursively under the doctrine dirs + immutables.json, repo-relative + sorted", async () => {
    const { walkedDirs, files } = await walkDoctrineFiles(ROOT);
    expect(files).toEqual([
      "docs/company/CONSTITUTION.md",
      "docs/company/decision-memos/memo-1.md",
      "docs/internal/team-roster.md",
      "sovereign-protocol/constitution.md",
      "sovereign-protocol/immutables.json",
    ]);
    // Only the dirs that exist in this fixture were walked.
    expect(walkedDirs).toEqual(["docs/company", "docs/internal", "sovereign-protocol"]);
  });

  it("skips non-markdown files and files outside the doctrine dirs", async () => {
    const { files } = await walkDoctrineFiles(ROOT);
    expect(files).not.toContain("docs/company/notes.txt");
    expect(files).not.toContain("server/services/foo.md");
  });
});

// ─── Ingest ──────────────────────────────────────────────────────────────

describe("ingestDoctrineCorpus", () => {
  it("inserts every walked file as an org-NULL doctrine row with repo-relative sourceRef + full-text hash", async () => {
    const r = await ingestDoctrineCorpus({ rootDir: ROOT });
    expect(r).toEqual({ walked: 5, ingested: 5, skippedUnchanged: 0, failed: 0 });
    expect(INSERTS).toHaveLength(5);
    for (const row of INSERTS) {
      expect(row.organizationId).toBeNull();
      expect(row.namespace).toBe(DOCTRINE_NAMESPACE);
      expect(row.embedding).toHaveLength(8);
    }
    const constitution = INSERTS.find((r2) => r2.sourceRef === "docs/company/CONSTITUTION.md");
    expect(constitution).toBeDefined();
    expect(constitution!.contentHash).toBe(sha256("# Constitution\nDoctrine A."));
    expect(constitution!.contentSnippet).toBe("# Constitution\nDoctrine A.");
  });

  it("hash-skip: an unchanged file is neither re-embedded nor written", async () => {
    await ingestDoctrineCorpus({ rootDir: ROOT });
    INSERTS.length = 0;
    embedMock.mockClear();

    const r = await ingestDoctrineCorpus({ rootDir: ROOT });
    expect(r).toEqual({ walked: 5, ingested: 0, skippedUnchanged: 5, failed: 0 });
    expect(INSERTS).toHaveLength(0);
    expect(UPDATES).toHaveLength(0);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("changed content updates the existing row in place (natural-key upsert)", async () => {
    await ingestDoctrineCorpus({ rootDir: ROOT });
    write("docs/company/CONSTITUTION.md", "# Constitution\nDoctrine A — amended.");

    const r = await ingestDoctrineCorpus({ rootDir: ROOT });
    expect(r.ingested).toBe(1);
    expect(r.skippedUnchanged).toBe(4);
    expect(UPDATES).toHaveLength(1);
    expect(UPDATES[0].values.contentHash).toBe(sha256("# Constitution\nDoctrine A — amended."));
  });

  it("FAIL-OPEN per file: one embed failure counts failed and never stops the walk", async () => {
    EMBED_FAIL_FOR.add("Internal doctrine");
    const r = await ingestDoctrineCorpus({ rootDir: ROOT });
    expect(r).toEqual({ walked: 5, ingested: 4, skippedUnchanged: 0, failed: 1 });
    expect(INSERTS.map((row) => row.sourceRef)).not.toContain("docs/internal/team-roster.md");
    expect(logger.warn).toHaveBeenCalledWith(
      "doctrineIngest.file_failed",
      expect.objectContaining({
        metadata: expect.objectContaining({ relPath: "docs/internal/team-roster.md" }),
      }),
    );
  });

  it("long files store a truncated snippet but hash the FULL text (chunking gap is honest)", async () => {
    const long = "L".repeat(9000);
    write("docs/company/long-doc.md", long);
    await ingestDoctrineCorpus({ rootDir: ROOT });
    const row = INSERTS.find((r2) => r2.sourceRef === "docs/company/long-doc.md");
    expect(row).toBeDefined();
    expect(row!.contentHash).toBe(sha256(long));
    expect(row!.contentSnippet.length).toBeLessThan(long.length);
    expect(row!.contentSnippet.endsWith("… [truncated]")).toBe(true);
    expect(row!.metadata.truncated).toBe(true);
  });
});

// ─── Completeness ────────────────────────────────────────────────────────

describe("corpusCompleteness", () => {
  it("full parity: everything ingested → no missing / stale / extra, counts match", async () => {
    await ingestDoctrineCorpus({ rootDir: ROOT });
    const c = await corpusCompleteness({ rootDir: ROOT });
    expect(c.filesOnDisk).toBe(5);
    expect(c.inStore).toBe(5);
    expect(c.missing).toEqual([]);
    expect(c.staleHash).toEqual([]);
    expect(c.extraInStore).toEqual([]);
    expect(c.walkedDirs).toEqual(["docs/company", "docs/internal", "sovereign-protocol"]);
  });

  it("missing + staleHash + extraInStore computed disk-vs-store directly", async () => {
    await ingestDoctrineCorpus({ rootDir: ROOT });

    // missing: a new doc on disk not yet in the store
    write("docs/company/new-doc.md", "brand new doctrine");
    // stale: disk content changed since ingest
    write("docs/internal/team-roster.md", "# Roster\nInternal doctrine v2.");
    // extra: a store row whose doc was deleted from disk
    fs.rmSync(path.join(ROOT, "sovereign-protocol/constitution.md"));

    const c = await corpusCompleteness({ rootDir: ROOT });
    expect(c.filesOnDisk).toBe(5); // 4 originals remaining + new-doc
    expect(c.inStore).toBe(5); // the 5 originally ingested
    expect(c.missing).toEqual(["docs/company/new-doc.md"]);
    expect(c.staleHash).toEqual(["docs/internal/team-roster.md"]);
    expect(c.extraInStore).toEqual(["sovereign-protocol/constitution.md"]);
  });

  it("names the externally-managed feedback dir instead of pretending it was walked", async () => {
    const c = await corpusCompleteness({ rootDir: ROOT });
    expect(c.externallyManaged.some((s) => s.includes("feedback_"))).toBe(true);
    expect(c.externallyManaged.some((s) => s.includes("externally") || s.includes("outside the repo"))).toBe(true);
  });
});
