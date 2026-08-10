/**
 * Gate-tamper watch ratchet (master-handoff item F3, "eternal lines") — the
 * CI half of the gate-estate integrity system.
 *
 * Three jobs:
 *   1. ETERNAL LINES: the COMMITTED manifest
 *      (server/services/autopilot/gateTamperManifest.json) must verify clean
 *      against the repo. Any edit to a gate-estate file (a ratchet baseline,
 *      a governance registry, a named ratchet test, a gate workflow) without
 *      re-running scripts/regenerate-gate-manifest.mjs fails HERE — the
 *      amendment forcing function, same shape as the sovereign-immutables
 *      fixture hash.
 *   2. PARITY: the regen script (plain .mjs, cannot import TS) and the TS
 *      module carry deliberate mirror copies of the estate list; this test
 *      pins the script's output equal to the TS builder's, so the two
 *      enumerations cannot drift.
 *   3. DETECTOR BEHAVIOR (fixture-driven): a mutated hash, a deleted pinned
 *      file, an unpinned estate file, and a vanished manifest are each
 *      reported as findings — and a root with no estate at all is SKIPPED
 *      honestly, never reported as verified.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  GATE_ESTATE,
  GATE_MANIFEST_RELPATH,
  buildGateManifest,
  computeGateEstate,
  verifyGateManifest,
  type GateEstateSpec,
} from "../../server/services/autopilot/gateTamperWatch";

const ROOT = path.resolve(__dirname, "../..");

describe("gate-tamper watch — eternal lines (the committed manifest is truth)", () => {
  it("the committed manifest exists", () => {
    expect(
      fs.existsSync(path.join(ROOT, GATE_MANIFEST_RELPATH)),
      `${GATE_MANIFEST_RELPATH} is missing — run: node scripts/regenerate-gate-manifest.mjs`,
    ).toBe(true);
  });

  it("every named estate file exists (a gate file may never silently vanish)", () => {
    const { missingNamed } = computeGateEstate(ROOT);
    expect(
      missingNamed,
      `named gate-estate file(s) are gone: ${missingNamed.join(", ")}`,
    ).toEqual([]);
  });

  it("the committed manifest verifies clean against the repo", () => {
    const verdict = verifyGateManifest(ROOT);
    expect(verdict.skipped).toBe(false);
    expect(
      verdict.findings,
      "The gate estate changed without regenerating the pinned manifest.\n" +
        "If your change to a ratchet baseline / governance registry / ratchet " +
        "test / gate workflow is legitimate and reviewed, lock it in with:\n" +
        "    node scripts/regenerate-gate-manifest.mjs\n" +
        "and commit the manifest diff alongside the change. Findings:\n" +
        verdict.findings.map((f) => `  ${f.kind}: ${f.file} — ${f.detail}`).join("\n"),
    ).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.checked).toBeGreaterThan(0);
  });

  it("the regen script's output equals the TS builder's (the two estate copies cannot drift)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-manifest-"));
    try {
      const out = path.join(tmp, "manifest.json");
      execFileSync("node", [path.join(ROOT, "scripts/regenerate-gate-manifest.mjs"), "--out", out], {
        cwd: ROOT,
      });
      const scripted = JSON.parse(fs.readFileSync(out, "utf8"));
      const built = buildGateManifest(ROOT);
      expect(scripted.files).toEqual(built.files);
      expect(scripted.algorithm).toBe(built.algorithm);
      expect(scripted.note).toBe(built.note);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Fixture-driven detector behavior
// ───────────────────────────────────────────────────────────────────────────

/** A tiny self-contained estate in a temp root, independent of the real repo. */
function makeFixture(): { root: string; estate: GateEstateSpec; manifestPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-estate-"));
  fs.mkdirSync(path.join(root, "gates"), { recursive: true });
  fs.writeFileSync(path.join(root, "gates/a.json"), '{"baseline": 3}\n');
  fs.writeFileSync(path.join(root, "gates/b.json"), '{"baseline": 7}\n');
  fs.writeFileSync(path.join(root, "named.txt"), "the line\n");
  const estate: GateEstateSpec = {
    dirs: [{ dir: "gates", ext: ".json" }],
    files: ["named.txt"],
  };
  return { root, estate, manifestPath: path.join(root, "manifest.json") };
}

function writeManifest(root: string, estate: GateEstateSpec, manifestPath: string): void {
  fs.writeFileSync(manifestPath, `${JSON.stringify(buildGateManifest(root, estate), null, 2)}\n`);
}

describe("gate-tamper watch — detector behavior (fixtures)", () => {
  it("a freshly built manifest verifies clean", () => {
    const { root, estate, manifestPath } = makeFixture();
    try {
      writeManifest(root, estate, manifestPath);
      const v = verifyGateManifest(root, estate, manifestPath);
      expect(v.ok).toBe(true);
      expect(v.skipped).toBe(false);
      expect(v.checked).toBe(3);
      expect(v.findings).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a mutated listed file as hash_mismatch", () => {
    const { root, estate, manifestPath } = makeFixture();
    try {
      writeManifest(root, estate, manifestPath);
      fs.writeFileSync(path.join(root, "gates/a.json"), '{"baseline": 9999}\n'); // the tamper
      const v = verifyGateManifest(root, estate, manifestPath);
      expect(v.ok).toBe(false);
      expect(v.findings).toHaveLength(1);
      expect(v.findings[0].kind).toBe("hash_mismatch");
      expect(v.findings[0].file).toBe("gates/a.json");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a deleted pinned file as missing_file", () => {
    const { root, estate, manifestPath } = makeFixture();
    try {
      writeManifest(root, estate, manifestPath);
      fs.rmSync(path.join(root, "named.txt"));
      const v = verifyGateManifest(root, estate, manifestPath);
      expect(v.ok).toBe(false);
      expect(v.findings.map((f) => [f.kind, f.file])).toContainEqual(["missing_file", "named.txt"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a new, never-pinned estate file as unlisted_file", () => {
    const { root, estate, manifestPath } = makeFixture();
    try {
      writeManifest(root, estate, manifestPath);
      fs.writeFileSync(path.join(root, "gates/c.json"), '{"baseline": 1}\n');
      const v = verifyGateManifest(root, estate, manifestPath);
      expect(v.ok).toBe(false);
      expect(v.findings.map((f) => [f.kind, f.file])).toContainEqual(["unlisted_file", "gates/c.json"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a vanished manifest as manifest_missing (estate on disk, pin gone)", () => {
    const { root, estate, manifestPath } = makeFixture();
    try {
      const v = verifyGateManifest(root, estate, manifestPath); // never written
      expect(v.ok).toBe(false);
      expect(v.findings.map((f) => f.kind)).toEqual(["manifest_missing"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("SKIPS honestly when no estate is on disk (deployed image) — never claims verified", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-empty-"));
    try {
      const estate: GateEstateSpec = { dirs: [{ dir: "gates", ext: ".json" }], files: ["named.txt"] };
      const v = verifyGateManifest(root, estate, path.join(root, "manifest.json"));
      expect(v.skipped).toBe(true);
      expect(v.ok).toBe(false); // skipped is NOT a pass
      expect(v.reason).toContain("cannot verify");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("buildGateManifest refuses while a named estate file is missing", () => {
    const { root, estate } = makeFixture();
    try {
      fs.rmSync(path.join(root, "named.txt"));
      expect(() => buildGateManifest(root, estate)).toThrow(/named estate files are missing/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
