/**
 * Founder diet slice — the /founder/legal-readiness checklist copy is
 * served as data (/legal-readiness.json) instead of riding inside the
 * founder bundle as JS (the BD-6 / diet pattern, applied to the founder
 * surface whose bundle sits at its ceiling).
 *
 * Pins:
 *  1. the served asset deep-equals the source-of-truth data module AND
 *     is the generator's exact output (the command in the module header);
 *  2. the client lib's guard accepts the real data and rejects malformed
 *     payloads (a bad asset must surface as a load error, never a
 *     silently-empty page);
 *  3. the builder rehydrates every section's icon name to the same
 *     Lucide component the pre-extraction page rendered, in order, and
 *     the status counter reproduces the page's summary counts;
 *  4. nothing in the client value-imports the data module (it would
 *     re-bundle the copy the asset exists to externalise) and the page
 *     reads the asset through the lib's hook + the shared loader.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as lucide from "lucide-react";
import { LEGAL_READINESS_DATA } from "../../client/src/data/legal-readiness-data";
import {
  LEGAL_READINESS_URL,
  buildLegalReadinessSections,
  countLegalReadinessByStatus,
  isLegalReadinessData,
} from "../../client/src/lib/legal-readiness";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// The no-rebundle sweep walks all of client/src; declare its budget.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel: string): unknown => JSON.parse(read(rel));

const ASSET = readJson("client/public/legal-readiness.json");

// ── 1. Verbatim: asset data == module data ────────────────────────────────

describe("legal-readiness asset is verbatim the data module", () => {
  it("legal-readiness.json deep-equals LEGAL_READINESS_DATA", () => {
    expect(ASSET).toEqual(LEGAL_READINESS_DATA);
  });

  it("legal-readiness.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/legal-readiness.json")).toBe(
      JSON.stringify(LEGAL_READINESS_DATA, null, 2) + "\n",
    );
  });

  it("the checklist keeps its full shape (9 sections, 43 items)", () => {
    expect(LEGAL_READINESS_DATA.sections).toHaveLength(9);
    expect(
      LEGAL_READINESS_DATA.sections.reduce((n, s) => n + s.items.length, 0),
    ).toBe(43);
  });
});

// ── 2. The guard ──────────────────────────────────────────────────────────

describe("isLegalReadinessData", () => {
  it("accepts the real data", () => {
    expect(isLegalReadinessData(LEGAL_READINESS_DATA)).toBe(true);
    expect(isLegalReadinessData(ASSET)).toBe(true);
  });

  it("rejects malformed payloads", () => {
    const section = LEGAL_READINESS_DATA.sections[0];
    const bad: unknown[] = [
      null,
      undefined,
      "sections",
      [],
      {},
      { sections: null },
      { sections: [] },
      { sections: [{ ...section, title: "" }] },
      { sections: [{ ...section, title: 7 }] },
      { sections: [{ ...section, icon: "NotARealIcon" }] },
      { sections: [{ ...section, icon: undefined }] },
      { sections: [{ ...section, items: [] }] },
      { sections: [{ ...section, items: "nope" }] },
      {
        sections: [
          { ...section, items: [{ label: "x", status: "done", note: "" }] },
        ],
      },
      {
        sections: [
          {
            ...section,
            items: [{ label: "x", status: "bogus", note: "y" }],
          },
        ],
      },
      {
        sections: [
          { ...section, items: [{ label: "x", status: "done" }] },
        ],
      },
    ];
    for (const value of bad) {
      expect(isLegalReadinessData(value)).toBe(false);
    }
  });
});

// ── 3. Rehydration + counts ───────────────────────────────────────────────

describe("buildLegalReadinessSections / countLegalReadinessByStatus", () => {
  it("rehydrates icons to the named lucide components, in order", () => {
    const built = buildLegalReadinessSections(LEGAL_READINESS_DATA);
    expect(built.map((s) => s.title)).toEqual(
      LEGAL_READINESS_DATA.sections.map((s) => s.title),
    );
    for (const [i, s] of built.entries()) {
      const key = LEGAL_READINESS_DATA.sections[i].icon;
      expect(
        (lucide as Record<string, unknown>)[key],
        `${key} is not a lucide export`,
      ).toBeDefined();
      expect(s.icon).toBe((lucide as Record<string, unknown>)[key]);
      expect(s.items).toEqual(LEGAL_READINESS_DATA.sections[i].items);
    }
  });

  it("status counts match the pre-extraction page's summary badges", () => {
    const built = buildLegalReadinessSections(LEGAL_READINESS_DATA);
    expect(countLegalReadinessByStatus(built, "done")).toBe(13);
    expect(countLegalReadinessByStatus(built, "needs-tom")).toBe(13);
    expect(countLegalReadinessByStatus(built, "needs-vendor")).toBe(9);
    expect(countLegalReadinessByStatus(built, "open")).toBe(8);
  });
});

// ── 4. Wiring: no re-bundle, page reads through the loader ───────────────

describe("legal-readiness wiring", () => {
  it("no client file value-imports the data module", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const src = stripComments(fs.readFileSync(full, "utf8"));
          for (const m of src.matchAll(
            /import\s+(type\s+)?\{[^}]*\}\s+from\s+["']([^"']+)["']/g,
          )) {
            if (m[1]) continue; // type-only imports are erased — fine
            if (m[2].endsWith("/data/legal-readiness-data")) {
              offenders.push(path.relative(ROOT, full));
            }
          }
        }
      }
    };
    walk(path.join(ROOT, "client/src"));
    expect(offenders).toEqual([]);
  });

  it("the lib loads the asset through the shared static-data loader", () => {
    const lib = read("client/src/lib/legal-readiness.ts");
    expect(LEGAL_READINESS_URL).toBe("/legal-readiness.json");
    expect(lib).toContain("useStaticData");
    expect(lib).toContain("LEGAL_READINESS_URL");
  });

  it("the page renders through the lib hook with a visible load error", () => {
    const page = read("client/src/pages/founder/legal-readiness.tsx");
    expect(page).toContain("useLegalReadinessSections");
    expect(page).toContain('data-testid="legal-readiness-load-error"');
    expect(page).toContain('role="alert"');
    // The copy literal must not still live in the page.
    expect(page).not.toContain("Form the operating entity (LLC)");
  });
});
