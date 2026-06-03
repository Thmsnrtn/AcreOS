/**
 * Tests for the Solene failure-mode library (Layer 3 L3.12).
 *
 * Coverage:
 *  - loadFailureModeLibrary parses YAML frontmatter + body from disk
 *  - loadFailureModeLibrary excludes README.md
 *  - loadFailureModeLibrary returns empty when the dir is missing
 *  - In-process cache hit avoids the second disk read
 *  - seedFailureModesFromDisk inserts when slug is new, updates when slug exists
 *  - seedFailureModesFromDisk is idempotent (replay → all skipped)
 *  - loadFailureModePreambleFor always includes top-3 critical/high modes
 *  - loadFailureModePreambleFor matches additional modes by plannedFiles
 *  - loadFailureModePreambleFor honors the 6 KB cap
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────
// DB mock — supports the select/insert/update shapes the service uses.
// ─────────────────────────────────────────────────────────────────────────

interface FailureModeRow {
  id: number;
  slug: string;
  title: string;
  severity: string;
  category: string;
  description: string;
  triggerPatterns: string[];
  prevention: string;
  exampleIncidentRefs: string[];
  retiredAt: Date | null;
}

const ROWS: FailureModeRow[] = [];
let nextRowId = 1;

interface PredicateInfo {
  slugEq?: string;
}
function parseWhere(pred: any, set: (info: PredicateInfo) => void) {
  const info: PredicateInfo = {};
  walk(pred);
  set(info);
  function walk(node: any) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const c of node) walk(c);
      return;
    }
    if (typeof node === "object") {
      if (node.op === "eq" && node.col === "slug") {
        info.slugEq = node.val;
      } else if (Array.isArray(node.preds)) {
        for (const c of node.preds) walk(c);
      }
    }
  }
}

function buildDbMock() {
  let pendingSlugEq: string | undefined;
  const reset = () => {
    pendingSlugEq = undefined;
  };

  const selectChain: any = {
    from() {
      return selectChain;
    },
    where(pred: any) {
      parseWhere(pred, (info) => {
        pendingSlugEq = info.slugEq;
      });
      return selectChain;
    },
    limit(_n: number) {
      return selectChain;
    },
    then(onFulfilled: any, onRejected: any) {
      const matched = pendingSlugEq
        ? ROWS.filter((r) => r.slug === pendingSlugEq).map((r) => ({ id: r.id }))
        : ROWS.map((r) => ({ id: r.id }));
      reset();
      return Promise.resolve(matched).then(onFulfilled, onRejected);
    },
  };

  return {
    insert: () => ({
      values: async (row: any) => {
        ROWS.push({
          id: nextRowId++,
          slug: row.slug,
          title: row.title,
          severity: row.severity,
          category: row.category,
          description: row.description,
          triggerPatterns: row.triggerPatterns ?? [],
          prevention: row.prevention,
          exampleIncidentRefs: row.exampleIncidentRefs ?? [],
          retiredAt: row.retiredAt ?? null,
        });
      },
    }),
    update: () => ({
      set: (patch: any) => ({
        where: (pred: any) => {
          let pendingSlug: string | undefined;
          parseWhere(pred, (info) => {
            pendingSlug = info.slugEq;
          });
          if (pendingSlug) {
            for (const r of ROWS) {
              if (r.slug === pendingSlug) Object.assign(r, patch);
            }
          }
          return Promise.resolve();
        },
      }),
    }),
    select: () => selectChain,
  };
}

vi.mock("../../db", () => ({ db: buildDbMock() }));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ preds }),
    eq: (col: any, val: unknown) => {
      const name =
        typeof col === "object" && col !== null && "name" in col
          ? (col as any).name
          : "unknown";
      return { op: "eq", col: name, val };
    },
    sql: (() => {
      const tag: any = (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({
        op: "sql",
      });
      return tag;
    })(),
  };
});

vi.mock("@shared/schema/solene-failure-modes", () => ({
  soleneFailureModes: {
    id: { name: "id" },
    slug: { name: "slug" },
  },
  FAILURE_MODE_SEVERITIES: ["low", "medium", "high", "critical"],
  FAILURE_MODE_CATEGORIES: [
    "credential_handling",
    "dispatch_collision",
    "scope_drift",
    "regression_class",
    "ux_regression",
    "other",
  ],
  FAILURE_MODE_DISK_CACHE_MS: 60_000,
  FAILURE_MODE_PREAMBLE_MAX_BYTES: 6 * 1024,
}));

import {
  loadFailureModeLibrary,
  seedFailureModesFromDisk,
  loadFailureModePreambleFor,
  _resetFailureModeCache,
} from "./failureModeLibrary";

// ─────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────

const FIXTURE_CRIT = `---
slug: credential-leak
title: Credential value leaked into stdout
severity: critical
category: credential_handling
trigger_patterns:
  - "echo $"
  - "ANTHROPIC_API_KEY"
prevention: |
  Verify by length or hash only.
example_incident_refs:
  - feedback_credential_value_handling.md
---

# Credential leak narrative.

The body of the failure mode goes here.
`;

const FIXTURE_HIGH = `---
slug: stale-doc
title: Stale-doc-driven dispatch
severity: high
category: scope_drift
trigger_patterns:
  - "exhaustive-completion"
  - "_refinement-resume"
prevention: |
  Grep before dispatching from a roadmap doc.
example_incident_refs:
  - feedback_verify_before_dispatch.md
---

# Stale doc narrative.
`;

const FIXTURE_MED = `---
slug: medium-thing
title: Some medium thing
severity: medium
category: other
trigger_patterns:
  - "weird_pattern"
prevention: |
  Be careful.
example_incident_refs: []
---

# Medium narrative.
`;

const FIXTURE_CRIT_2 = `---
slug: sweep-collision
title: git add sweep collision
severity: critical
category: dispatch_collision
trigger_patterns:
  - "git add -A"
  - "git commit -am"
prevention: |
  Stage by exact name.
example_incident_refs:
  - aff4c273
---

# Sweep narrative.
`;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "solene-failmode-test-"));
  process.env.SOLENE_FAILURE_MODE_DIR = tmpDir;
  ROWS.length = 0;
  nextRowId = 1;
  _resetFailureModeCache();
});

afterEach(async () => {
  delete process.env.SOLENE_FAILURE_MODE_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// loadFailureModeLibrary
// ─────────────────────────────────────────────────────────────────────────

describe("loadFailureModeLibrary", () => {
  it("parses frontmatter + body from disk", async () => {
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    await fs.writeFile(path.join(tmpDir, "0002-stale-doc.md"), FIXTURE_HIGH);

    const modes = await loadFailureModeLibrary();
    expect(modes).toHaveLength(2);

    const crit = modes.find((m) => m.slug === "credential-leak");
    expect(crit).toBeDefined();
    expect(crit!.title).toBe("Credential value leaked into stdout");
    expect(crit!.severity).toBe("critical");
    expect(crit!.category).toBe("credential_handling");
    expect(crit!.triggerPatterns).toContain("echo $");
    expect(crit!.triggerPatterns).toContain("ANTHROPIC_API_KEY");
    expect(crit!.prevention.toLowerCase()).toContain("length or hash");
    expect(crit!.exampleIncidentRefs).toContain(
      "feedback_credential_value_handling.md",
    );
    expect(crit!.description).toContain("Credential leak narrative");
  });

  it("excludes README.md", async () => {
    await fs.writeFile(
      path.join(tmpDir, "README.md"),
      "# README; not a failure mode",
    );
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    const modes = await loadFailureModeLibrary();
    expect(modes).toHaveLength(1);
    expect(modes[0].slug).toBe("credential-leak");
  });

  it("returns empty when the dir is missing", async () => {
    process.env.SOLENE_FAILURE_MODE_DIR = path.join(tmpDir, "does-not-exist");
    _resetFailureModeCache();
    const modes = await loadFailureModeLibrary();
    expect(modes).toEqual([]);
  });

  it("uses the in-process cache on a second call", async () => {
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    const first = await loadFailureModeLibrary();
    expect(first).toHaveLength(1);
    // Mutate disk; cached read should NOT pick this up within cache window.
    await fs.writeFile(path.join(tmpDir, "0002-stale-doc.md"), FIXTURE_HIGH);
    const second = await loadFailureModeLibrary();
    expect(second).toHaveLength(1); // still cached
    // Cache reset should let it pick the new file up.
    _resetFailureModeCache();
    const third = await loadFailureModeLibrary();
    expect(third).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// seedFailureModesFromDisk
// ─────────────────────────────────────────────────────────────────────────

describe("seedFailureModesFromDisk", () => {
  it("inserts when slug is new", async () => {
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    const result = await seedFailureModesFromDisk();
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(ROWS).toHaveLength(1);
    expect(ROWS[0].slug).toBe("credential-leak");
  });

  it("is idempotent on replay — slug already present → skipped count rises", async () => {
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    await seedFailureModesFromDisk();
    _resetFailureModeCache();
    const second = await seedFailureModesFromDisk();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(ROWS).toHaveLength(1); // still just one row
  });

  it("refreshes non-key columns on existing slug", async () => {
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    await seedFailureModesFromDisk();
    // Rewrite the file with a new title.
    const v2 = FIXTURE_CRIT.replace(
      "Credential value leaked into stdout",
      "Credential leaked v2",
    );
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), v2);
    _resetFailureModeCache();
    const result = await seedFailureModesFromDisk();
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(ROWS[0].title).toBe("Credential leaked v2");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// loadFailureModePreambleFor
// ─────────────────────────────────────────────────────────────────────────

describe("loadFailureModePreambleFor", () => {
  it("always includes top critical+high modes regardless of plannedFiles", async () => {
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    await fs.writeFile(path.join(tmpDir, "0002-stale-doc.md"), FIXTURE_HIGH);
    await fs.writeFile(path.join(tmpDir, "0003-medium.md"), FIXTURE_MED);

    const preamble = await loadFailureModePreambleFor("iris", undefined);
    expect(preamble).toContain("credential-leak");
    expect(preamble).toContain("stale-doc");
    // Medium-severity is NOT auto-included.
    expect(preamble).not.toContain("medium-thing");
    // Rendered shape — heading per mode.
    expect(preamble).toMatch(/### \[CRITICAL\] .* \(`credential-leak`\)/);
  });

  it("includes additional modes when plannedFiles match a trigger pattern", async () => {
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    await fs.writeFile(path.join(tmpDir, "0002-stale-doc.md"), FIXTURE_HIGH);
    await fs.writeFile(path.join(tmpDir, "0003-medium.md"), FIXTURE_MED);

    // plannedFiles contains the medium-tier trigger pattern as a substring.
    const preamble = await loadFailureModePreambleFor("iris", [
      "server/services/foo/weird_pattern_handler.ts",
    ]);
    // critical + high are still there.
    expect(preamble).toContain("credential-leak");
    expect(preamble).toContain("stale-doc");
    // Medium-tier should now appear because plannedFiles matched its trigger.
    expect(preamble).toContain("medium-thing");
  });

  it("caps the top-severity list at 3", async () => {
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), FIXTURE_CRIT);
    await fs.writeFile(path.join(tmpDir, "0002-stale-doc.md"), FIXTURE_HIGH);
    await fs.writeFile(path.join(tmpDir, "0003-sweep.md"), FIXTURE_CRIT_2);
    // Add a 4th critical mode that should NOT be auto-included.
    const fourthCrit = FIXTURE_CRIT.replace("credential-leak", "fourth-crit").replace(
      "Credential value leaked into stdout",
      "Fourth critical mode",
    );
    await fs.writeFile(path.join(tmpDir, "0004-fourth.md"), fourthCrit);

    const preamble = await loadFailureModePreambleFor("iris", undefined);
    const headingCount = (preamble.match(/### \[/g) ?? []).length;
    expect(headingCount).toBeLessThanOrEqual(3);
  });

  it("respects the 6 KB cap with a truncation suffix", async () => {
    // Inflate the prevention text to push the rendered preamble past 6 KB.
    const huge = FIXTURE_CRIT.replace(
      "Verify by length or hash only.",
      "x".repeat(5000),
    );
    await fs.writeFile(path.join(tmpDir, "0001-credential-leak.md"), huge);
    const huge2 = FIXTURE_HIGH.replace(
      "Grep before dispatching from a roadmap doc.",
      "y".repeat(5000),
    );
    await fs.writeFile(path.join(tmpDir, "0002-stale-doc.md"), huge2);

    const preamble = await loadFailureModePreambleFor("iris", undefined);
    expect(preamble).toContain("… [truncated]");
    expect(Buffer.byteLength(preamble, "utf8")).toBeLessThanOrEqual(
      6 * 1024 + 64,
    );
  });

  it("returns the empty fallback when ledger dir is empty", async () => {
    const preamble = await loadFailureModePreambleFor("iris", undefined);
    expect(preamble).toContain("No failure modes on file");
  });
});
