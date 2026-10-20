/**
 * Public trust surfaces may not claim a SOC 2 audit or a running backup regime
 * that nothing in the repository or its operations evidences.
 *
 * ── THE DEFECT (audit 2026-10) ──────────────────────────────────────────────
 *   - landing/FinalCTA.tsx rendered "SOC 2 Type 1 in progress · 2026-Q3 target"
 *     to every visitor. The quarter passed; no auditor engagement exists.
 *   - security.tsx badged "SOC 2 Type 1 — in flight" and said controls were
 *     "mapped to the AICPA Trust Services Criteria and audited continuously".
 *   - security.tsx said "Backups are encrypted …, retained on a rolling 30-day
 *     window, and stored in a region-isolated bucket". The backup bucket is
 *     not provisioned (docs/company/roadmap-2026-10.md, K3 and P0-05 "no actual
 *     recovery claim"); server/jobs/dbBackup.ts only uploads when
 *     DB_BACKUP_S3_BUCKET is set, and otherwise leaves the dump on local disk.
 *
 * ── EVIDENCE COUPLING ───────────────────────────────────────────────────────
 * A SOC 2 claim is permitted only when an auditor artefact is committed under
 * docs/compliance/soc2/ (an engagement letter or report). A backup-regime claim
 * is permitted only when docs/ops/backup-restore-drill.md records a performed
 * restore drill. Neither exists today, so both claims are forbidden; adding the
 * evidence is what lifts the ban, not editing this test.
 *
 * ── METHOD ──────────────────────────────────────────────────────────────────
 * Parse, not scan: the TypeScript compiler walks each file and only JSX text
 * and string/template literals are read, so a comment recording why a claim
 * was removed can never trip the gate. The population is enumerated below and
 * every member must yield text (per-member vacuity).
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

/** Every public trust/marketing surface. Adding one means adding it here. */
function population(): string[] {
  const landingDir = path.join(ROOT, "client/src/pages/landing");
  const landing = fs
    .readdirSync(landingDir)
    .filter((f) => /\.(tsx|ts)$/.test(f))
    .map((f) => `client/src/pages/landing/${f}`);
  return [
    ...landing,
    "client/src/pages/landing.tsx",
    "client/src/pages/security.tsx",
    "client/src/pages/transparency.tsx",
    "client/src/pages/status.tsx",
    "client/src/pages/privacy.tsx",
    "client/src/pages/pricing.tsx",
    "client/src/pages/terms.tsx",
    "client/src/pages/auth-page.tsx",
  ];
}

/** Rendered-ish text of a source: JSX text and string/template literal content. */
function literalTexts(fileName: string, src: string): string[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const t = n.getText(sf).replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push(n.text);
    } else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const SOC2_CLAIM = /\bSOC\s?-?2\b|\bAICPA\b|\bTrust Services Criteria\b|\baudited (continuously|annually|by)\b|\bISO\s?27001\b/i;
const BACKUP_CLAIM =
  /\b(encrypted|nightly|daily|hourly|automated|continuous|rolling)\b[^.]{0,40}\bbackups?\b|\bbackups? (are|is|run|get)\b[^.]{0,60}\b(encrypted|retained|rolling|stored|replicated|tested|taken)\b|region-isolated/i;

const SOC2_EVIDENCE_DIR = path.join(ROOT, "docs/compliance/soc2");
const BACKUP_EVIDENCE = path.join(ROOT, "docs/ops/backup-restore-drill.md");

function findings(files: string[], re: RegExp, read: (f: string) => string = (f) => fs.readFileSync(path.join(ROOT, f), "utf8")) {
  return files.flatMap((f) =>
    literalTexts(f, read(f))
      .filter((t) => re.test(t))
      .map((t) => `${f}: "${t.slice(0, 120)}"`),
  );
}

describe("population and parser are real", () => {
  it("every member exists and yields text", () => {
    const files = population();
    expect(files.length).toBeGreaterThanOrEqual(20);
    for (const f of files) {
      expect(fs.existsSync(path.join(ROOT, f)), `${f} is gone — update the population`).toBe(true);
      expect(literalTexts(f, fs.readFileSync(path.join(ROOT, f), "utf8")).length, `${f} yielded no text`).toBeGreaterThan(0);
    }
  });

  it("canary: the extractor reads a true claim that is still on the security page", () => {
    const t = literalTexts("security.tsx", fs.readFileSync(path.join(ROOT, "client/src/pages/security.tsx"), "utf8"));
    expect(t.some((x) => x.includes("AES-256-GCM"))).toBe(true);
  });

  it("canary: the predicates catch the removed claims, and ignore comments", () => {
    const old = `export const A = () => (<div>
      <span>SOC 2 Type 1 in progress · 2026-Q3 target</span>
      <p>Backups are encrypted with the same standard, retained on a
        rolling 30-day window, and stored in a region-isolated bucket.</p>
      <p>mapped to the AICPA Trust Services Criteria and audited continuously.</p>
    </div>);`;
    expect(literalTexts("x.tsx", old).filter((t) => SOC2_CLAIM.test(t)).length).toBe(2);
    expect(literalTexts("x.tsx", old).filter((t) => BACKUP_CLAIM.test(t)).length).toBe(1);
    const commentOnly = `// removed "SOC 2 Type 1 in progress"; backups are encrypted (not true)\nexport const B = 1;`;
    expect(literalTexts("y.tsx", commentOnly).filter((t) => SOC2_CLAIM.test(t) || BACKUP_CLAIM.test(t))).toEqual([]);
    // Negative control: a customer's own export "backup" is not a backup-regime claim.
    expect(BACKUP_CLAIM.test("Export everything to CSV in one click — or a full backup.")).toBe(false);
  });
});

describe("no unevidenced compliance or backup claims on public surfaces", () => {
  it("no SOC 2 / audit claim unless an auditor artefact is committed", () => {
    const hasEvidence = fs.existsSync(SOC2_EVIDENCE_DIR) && fs.readdirSync(SOC2_EVIDENCE_DIR).length > 0;
    const found = findings(population(), SOC2_CLAIM);
    if (!hasEvidence) {
      expect(
        found,
        "a public surface claims SOC 2 / an audit with no auditor artefact under docs/compliance/soc2/",
      ).toEqual([]);
    }
  });

  it("no backup-regime claim unless a restore drill is recorded", () => {
    const hasEvidence = fs.existsSync(BACKUP_EVIDENCE);
    const found = findings(population(), BACKUP_CLAIM);
    if (!hasEvidence) {
      expect(
        found,
        "a public surface claims a running backup regime; the bucket is not provisioned and no " +
          "restore drill is recorded at docs/ops/backup-restore-drill.md",
      ).toEqual([]);
    }
  });
});
