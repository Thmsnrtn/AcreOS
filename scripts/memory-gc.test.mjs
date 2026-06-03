/**
 * memory-gc.test.mjs — vitest coverage for the GC scanner.
 *
 * Builds tiny ephemeral memory dirs with crafted fixtures to hit each
 * detector. Read-only — nothing under the real Solene memory dir is touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scan,
  renderReport,
  parseFrontmatter,
  tokenize,
  jaccard,
  findDatesOlderThan,
  findTemporalTerms,
  findAntonymHits,
  findLinkTargets,
  sanitize,
} from "./memory-gc.mjs";

function mkfixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-gc-fixture-"));
}

function writeMemory(dir, file, frontmatter, body = "") {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const raw = `---\n${fm}\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(dir, file), raw, "utf8");
}

describe("parseFrontmatter", () => {
  it("extracts simple keys", () => {
    const { frontmatter, body } = parseFrontmatter(
      "---\nname: foo\ndescription: bar baz\n---\n\nhello\n",
    );
    expect(frontmatter.name).toBe("foo");
    expect(frontmatter.description).toBe("bar baz");
    expect(body.trim()).toBe("hello");
  });

  it("handles no-frontmatter docs", () => {
    const { frontmatter, body } = parseFrontmatter("just text");
    expect(frontmatter).toEqual({});
    expect(body).toBe("just text");
  });
});

describe("tokenize + jaccard", () => {
  it("drops stopwords + lowercases", () => {
    expect(tokenize("The Quick BROWN fox")).toEqual(["quick", "brown", "fox"]);
  });
  it("computes Jaccard", () => {
    expect(jaccard(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0);
    const sim = jaccard(["a", "b", "c", "d"], ["a", "b", "c", "e"]);
    expect(sim).toBeCloseTo(3 / 5, 5);
  });
});

describe("primitive detectors", () => {
  it("findDatesOlderThan flags old dates", () => {
    const today = new Date("2026-06-03T00:00:00Z");
    expect(findDatesOlderThan("on 2025-01-01 we did X", 30, today)).toEqual([
      "2025-01-01",
    ]);
    expect(findDatesOlderThan("on 2026-06-01 we did X", 30, today)).toEqual([]);
  });
  it("findTemporalTerms hits the listed phrases", () => {
    expect(findTemporalTerms("this is in flight right now")).toContain(
      "in flight",
    );
    expect(findTemporalTerms("stable forever")).toEqual([]);
  });
  it("findAntonymHits catches always/never across docs", () => {
    expect(findAntonymHits("always do X", "never do X")).toContainEqual([
      "always",
      "never",
    ]);
  });
  it("findLinkTargets parses [[slug]]", () => {
    expect(findLinkTargets("see [[foo]] and [[bar-baz]]")).toEqual([
      "foo",
      "bar-baz",
    ]);
  });
});

describe("sanitize", () => {
  it("redacts long hex blobs", () => {
    const s = sanitize("token abcdef0123456789abcdef0123456789abcdef01 end");
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("abcdef0123456789abcdef0123456789abcdef01");
  });
  it("redacts sk_-style keys", () => {
    const s = sanitize("key " + "sk" + "_live_ABCDEFGHIJKLMNOPQRSTUVWX done"); // secret-scan:allow
    expect(s).toContain("[REDACTED]");
  });
  it("leaves normal prose alone", () => {
    expect(sanitize("hello world")).toBe("hello world");
  });
});

describe("scan integration", () => {
  let dir;
  beforeEach(() => {
    dir = mkfixture();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("empty dir → all counts zero", () => {
    const result = scan(dir, new Date("2026-06-03T00:00:00Z"));
    expect(result.totalFiles).toBe(0);
    expect(result.staleDated).toEqual([]);
    expect(result.staleTemporal).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.contradictions).toEqual([]);
    expect(result.orphans).toEqual([]);
    expect(result.indexHygiene).toEqual([]);
  });

  it("flags potentially_stale_dated when description has old date", () => {
    writeMemory(dir, "old.md", {
      name: "old",
      description: "implemented on 2025-01-01 with shipped feature",
    });
    const result = scan(dir, new Date("2026-06-03T00:00:00Z"));
    expect(result.staleDated).toHaveLength(1);
    expect(result.staleDated[0].name).toBe("old");
    expect(result.staleDated[0].dates).toContain("2025-01-01");
  });

  it("flags likely_stale_temporal on 'currently in flight'", () => {
    writeMemory(dir, "wip.md", {
      name: "wip",
      description: "currently in flight migration of the queue",
    });
    const result = scan(dir, new Date("2026-06-03T00:00:00Z"));
    expect(result.staleTemporal.length).toBeGreaterThan(0);
    const hit = result.staleTemporal.find((s) => s.name === "wip");
    expect(hit).toBeDefined();
    expect(hit.terms.some((t) => t === "currently" || t === "in flight")).toBe(
      true,
    );
  });

  it("flags duplicate_candidate on high-overlap descriptions", () => {
    writeMemory(dir, "a.md", {
      name: "alpha",
      description:
        "always verify dispatch claims before staging files committing work",
    });
    writeMemory(dir, "b.md", {
      name: "beta",
      description:
        "always verify dispatch claims before staging files committing work properly",
    });
    const result = scan(dir, new Date("2026-06-03T00:00:00Z"));
    expect(result.duplicates.length).toBeGreaterThan(0);
    expect(result.duplicates[0].similarity).toBeGreaterThanOrEqual(0.6);
  });

  it("flags contradiction_candidate on always/never antonym", () => {
    writeMemory(dir, "x.md", {
      name: "x",
      description: "always commit with explicit file names",
    });
    writeMemory(dir, "y.md", {
      name: "y",
      description: "never commit with explicit file names",
    });
    const result = scan(dir, new Date("2026-06-03T00:00:00Z"));
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(result.contradictions[0].antonyms[0]).toEqual(["always", "never"]);
  });

  it("flags orphaned_reference for [[non-existent]] link", () => {
    writeMemory(
      dir,
      "src.md",
      { name: "src", description: "references something" },
      "see [[non-existent-slug]] for more.",
    );
    const result = scan(dir, new Date("2026-06-03T00:00:00Z"));
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].missingTarget).toBe("non-existent-slug");
  });

  it("flags unindexed_memory + dead_index_entry via MEMORY.md", () => {
    writeMemory(dir, "present.md", {
      name: "present",
      description: "live memory",
    });
    fs.writeFileSync(
      path.join(dir, "MEMORY.md"),
      "- [Missing](missing.md) — does not exist\n",
      "utf8",
    );
    const result = scan(dir, new Date("2026-06-03T00:00:00Z"));
    const dead = result.indexHygiene.find((h) => h.kind === "dead_index_entry");
    const unindexed = result.indexHygiene.find(
      (h) => h.kind === "unindexed_memory",
    );
    expect(dead).toBeDefined();
    expect(dead.entry).toBe("missing.md");
    expect(unindexed).toBeDefined();
    expect(unindexed.file).toBe("present.md");
  });

  it("renderReport produces the expected sections", () => {
    writeMemory(dir, "old.md", {
      name: "old",
      description: "implemented on 2025-01-01",
    });
    const result = scan(dir, new Date("2026-06-03T00:00:00Z"));
    const report = renderReport(result);
    expect(report).toContain("# Memory GC scan — 2026-06-03");
    expect(report).toContain("## Summary");
    expect(report).toContain("## Stale candidates");
    expect(report).toContain("## Duplicate candidates");
    expect(report).toContain("## Contradiction candidates");
    expect(report).toContain("## Orphaned references");
    expect(report).toContain("## MEMORY.md hygiene");
    expect(report).toContain("informational");
  });
});
