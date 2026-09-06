/**
 * The fabrication gate named the UI and scanned the server.
 *
 * `scripts/check-no-fabrication.mjs` enforces the hard-stop *"no invented
 * numbers, fake activity, or placeholder data presented as real"*. Its own
 * header explains why it exists:
 *
 *   > AcreOS sells truth. A dashboard number, a skip-trace phone, a
 *   > deal-velocity stat … If any of them is `Math.floor(Math.random() * …)`,
 *   > **we are lying with a confident UI.**
 *
 * It then scanned `server/routes-*.ts`, `server/storage*`, and
 * `server/services/**` — and stopped. The UI it names was outside the walk, so
 * a component rendering `Math.floor(Math.random() * 40) + 50` as a match score
 * passed every gate in `npm run check`. A fabrication invented in the
 * rendering layer never touches a route handler at all.
 *
 * The same shape as unit 54, on a different hard-stop: a real rule, automated,
 * applied to one layer. Being automated is what makes it read as covered.
 *
 * WHAT THE WIDENING FOUND: nothing bad, and that is worth stating plainly
 * rather than dressing up. All 16 client hits are ids, camera jitter in the
 * map flythrough, a shadcn skeleton width, and one decorative image picker with
 * no call sites. The value here is not a fix — it is that the next one cannot
 * ship silently.
 *
 * WHAT IT STILL DOES NOT CATCH: a hardcoded plausible constant. `Math.random`
 * is one way to invent a number and the only one a token scan can see.
 * Refuse-not-fabricate remains a judgement a reviewer makes; this gate narrows
 * where the judgement can be skipped.
 *
 * WHY THE COVERAGE CHECK RUNS THE GATE INSTEAD OF READING IT (2026-08-16)
 * ──────────────────────────────────────────────────────────────────────
 * This test used to prove "client/src is scanned" by asserting the lint's
 * SOURCE TEXT contained `walkTsFiles(CLIENT_DIR, files);`. That is the same
 * defect the gate itself just shed: the gate keyed on ONE SPELLING
 * (`Math.random`), so a seeded PRNG fabricating the same customer-visible
 * number shipped green; this test keyed on ONE SPELLING of a call site, so
 * the refactor that widened FORBIDDEN_TOKENS into a list broke it while the
 * property it cared about never changed. Re-pointing it at the new spelling
 * would have rebuilt the trap one rename further along.
 *
 * So the coverage claim is now BEHAVIOURAL, in two layers:
 *   1. `--measure` is run and the client/src/** root's own file count is read
 *      off the real walk — not off the source that performs it;
 *   2. a fabrication is PLANTED in a client/src the gate really walks, and the
 *      gate must NAME it. The plant happens inside a throwaway sandbox repo
 *      root (every other scan root symlinked to the real tree) so a concurrent
 *      agent's `npm run lint:no-fabrication` never sees a probe file, and so a
 *      crashed test can never leave one behind in client/src.
 * Rename CLIENT_DIR, inline the walk, restructure the roots — these stay green.
 * Stop scanning the rendering layer and they cannot.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CONSTITUTION } from "@shared/governance/constitution";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");
const LINT = path.join(ROOT, "scripts/check-no-fabrication.mjs");
const src = fs.readFileSync(LINT, "utf8");
const allowlist = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/no-fabrication.allowlist.json"), "utf8"),
) as { _README: string; allowlist: Array<{ file: string; line: number; category: string; note: string }> };

function run(): string {
  return execFileSync("node", [LINT], { cwd: ROOT, encoding: "utf8" });
}

interface ExecFailure {
  status?: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Run a gate script to completion, capturing both streams whether it passes or
 * fails. `stdio` is explicit because execFileSync otherwise echoes the child's
 * stderr straight through to the parent — a FAIL this test EXPECTS would print
 * a scary red block in an otherwise green run.
 */
function runGate(script: string, args: string[] = []): { code: number; out: string } {
  try {
    const out = execFileSync("node", [script, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as ExecFailure;
    return {
      code: typeof e.status === "number" ? e.status : -1,
      out: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

const PROBE_DIR = "__fabrication_scope_probe__";

/**
 * A throwaway repo root the gate can be pointed at. `REPO_ROOT` is derived from
 * the script's own location, so copying the script into `<sandbox>/scripts/`
 * makes `<sandbox>` the root it walks. Every scan root except client/src is a
 * symlink to the real tree, and client/src is a directory of symlinks to the
 * real client/src's children — identical to the real repo in what it scans,
 * while still accepting a planted file that never touches the working tree.
 */
function buildSandbox(): string {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "no-fabrication-scope-"));
  fs.mkdirSync(path.join(sandbox, "scripts"));
  for (const f of ["check-no-fabrication.mjs", "no-fabrication.allowlist.json"]) {
    fs.copyFileSync(path.join(ROOT, "scripts", f), path.join(sandbox, "scripts", f));
  }
  fs.symlinkSync(path.join(ROOT, "server"), path.join(sandbox, "server"), "dir");
  const clientSrc = path.join(sandbox, "client", "src");
  fs.mkdirSync(clientSrc, { recursive: true });
  for (const entry of fs.readdirSync(path.join(ROOT, "client", "src"))) {
    fs.symlinkSync(path.join(ROOT, "client", "src", entry), path.join(clientSrc, entry));
  }
  return sandbox;
}

/**
 * Tear the sandbox down. Every symlink in it points at the REAL repo, so the
 * links are unlinked BY HAND first and the recursive delete only ever sees
 * files this test created. (Node's recursive rm lstats and would not follow
 * them either — this is the belt to that suspenders. A recursive delete that
 * walks into client/src is not a bug you get to fix afterwards.)
 */
function destroySandbox(sandbox: string): void {
  const unlinkLinks = (dir: string): void => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) fs.unlinkSync(full);
      else if (st.isDirectory()) unlinkLinks(full);
    }
  };
  try {
    unlinkLinks(sandbox);
  } catch (cleanupErr) {
    // Cleanup must never mask the assertion that sent us here. The rm below is
    // safe to reach with links still in place — it lstats rather than follows.
    void cleanupErr;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
}

describe("the fabrication gate covers the rendering layer", () => {
  it("walks client/src — the client tree is a live scan root at RUN time", () => {
    // Read off the walk, not off the source that performs it: --measure prints
    // each root's realised file count. A source-text assertion here would pin a
    // spelling; this pins the property.
    const { code, out } = runGate(LINT, ["--measure"]);
    expect(code, `--measure did not exit 0:\n${out}`).toBe(0);
    const m = /(ok|STARVED)\s+(\d+)\s+\(floor \d+\)\s+client\/src\/\*\*/.exec(out);
    expect(
      m,
      "client/src is gone from the fabrication walk — the gate no longer reports " +
        "it as a scan root at all. The rendering layer is where an invented " +
        `number becomes a fact the customer acts on. Output was:\n${out}`,
    ).not.toBeNull();
    expect(m![1], `client/src is a starved scan root:\n${out}`).toBe("ok");
    expect(Number(m![2]), "far fewer client files walked than client/src holds")
      .toBeGreaterThan(300);
  });

  it("…and a fabrication planted in client/src is actually REPORTED", () => {
    const sandbox = buildSandbox();
    try {
      const probeDir = path.join(sandbox, "client", "src", PROBE_DIR);
      fs.mkdirSync(probeDir);
      // The two shapes the widening was written for: a plain .ts helper and a
      // .tsx component. The third is the exclusion — a component TEST's fixture
      // must not be enumerated as a fabrication.
      const probes = {
        ts: path.join(probeDir, "match-score.ts"),
        tsx: path.join(probeDir, "score-card.tsx"),
        excluded: path.join(probeDir, "score-card.test.tsx"),
      };
      fs.writeFileSync(probes.ts, "export const buyerMatchScore = Math.floor(Math.random() * 40) + 50;\n");
      fs.writeFileSync(probes.tsx, "export const dealVelocityDays = Math.floor(Math.random() * 33) + 12;\n");
      fs.writeFileSync(probes.excluded, "export const fixtureScore = Math.floor(Math.random() * 40) + 50;\n");

      // A mutation that does not mutate proves nothing. Before reading any
      // result below, confirm the probes exist and carry the token — otherwise
      // "the gate reported nothing" would be a fact about this test, not the gate.
      for (const p of Object.values(probes)) {
        expect(fs.existsSync(p), `probe was never written: ${p}`).toBe(true);
        expect(fs.readFileSync(p, "utf8"), `probe lost its token: ${p}`).toContain("Math.random");
      }

      const sandboxLint = path.join(sandbox, "scripts", "check-no-fabrication.mjs");
      const planted = runGate(sandboxLint);
      expect(
        planted.code,
        `a fabrication sitting in client/src did not fail the gate:\n${planted.out}`,
      ).toBe(1);
      expect(
        planted.out,
        "the gate did not name the planted .ts fabrication — client/src is walked " +
          `but not scanned, or not walked at all:\n${planted.out}`,
      ).toContain(`client/src/${PROBE_DIR}/match-score.ts:1`);
      expect(
        planted.out,
        "the gate did not name the planted .tsx fabrication. Components are .tsx; " +
          `a walk that collects only .ts sees none of the pages:\n${planted.out}`,
      ).toContain(`client/src/${PROBE_DIR}/score-card.tsx:1`);
      expect(
        planted.out,
        "a .test.tsx fixture was reported as a fabrication — component-test " +
          "fixtures would flood the register and get it re-baselined",
      ).not.toContain("score-card.test.tsx");

      // Control. Remove the plant and the SAME sandbox passes, which is what
      // makes the failure above attributable to the probe rather than to any
      // difference between the sandbox and the real repo.
      fs.rmSync(probeDir, { recursive: true, force: true });
      const control = runGate(sandboxLint);
      expect(
        control.code,
        `the sandbox does not mirror the real repo — it fails with no probe in it:\n${control.out}`,
      ).toBe(0);
      expect(control.out).toContain("[check-no-fabrication] PASS");
    } finally {
      destroySandbox(sandbox);
    }
  });

  it("scans .tsx, not only .ts", () => {
    // Components are .tsx. A walk that collected only .ts would satisfy the
    // assertion above and still see none of the pages.
    expect(src).toContain('entry.endsWith(".tsx")');
    // …and skips .test.tsx, or the fixtures in component tests would be
    // enumerated as fabrications.
    expect(src).toContain('name.endsWith(".test.tsx")');
  });

  it("really scans the client files (vacuity guard)", () => {
    const out = run();
    const m = /scanned (\d+) files/.exec(out);
    expect(m, `the lint's summary line changed shape:\n${out}`).not.toBeNull();
    // ~730 client .tsx files alone; the server set was already ~1,300.
    expect(Number(m![1]), "far fewer files scanned than client/src holds")
      .toBeGreaterThan(1800);
  });

  it("passes with every hit annotated and nothing stale", () => {
    const out = run();
    expect(out).toContain("new: 0");
    expect(
      out,
      "an allowlist entry no longer matches a hit. Entries are LINE-ANCHORED: " +
        "when code moves, re-anchor the line — deleting the entry quietly " +
        "widens the gate.",
    ).toContain("stale allowlist: 0");
    expect(out).toContain("[check-no-fabrication] PASS");
  });
});

describe("the client entries say what they are", () => {
  const client = allowlist.allowlist.filter((e) => e.file.startsWith("client/"));

  it("there are client entries at all", () => {
    expect(client.length, "no client hits are annotated").toBeGreaterThan(10);
  });

  it("none is marked P0-FIX-PENDING", () => {
    // If one ever is, the widening found a live fabrication in the UI and this
    // assertion is the wrong thing to keep green — fix the occurrence.
    expect(client.filter((e) => e.category === "P0-FIX-PENDING").map((e) => e.file)).toEqual([]);
  });

  it("every one carries a real note, not a placeholder", () => {
    // An allowlist whose notes say "legitimate use" is a list of unexamined
    // call sites wearing the costume of a review.
    for (const e of client) {
      expect(e.note.length, `${e.file}:${e.line} has a stub note`).toBeGreaterThan(30);
      expect(
        /legitimate use|see above|n\/a|todo/i.test(e.note),
        `${e.file}:${e.line} has a placeholder note`,
      ).toBe(false);
    }
  });

  it("the decorative image picker carries its warning", () => {
    // The one entry that is a judgement rather than a fact: a random pick from
    // 28 curated aerials is fine as a background and would be fabrication if
    // attached to a specific parcel. It has no call sites today, so the note is
    // addressed to whoever gives it one.
    const aerial = client.find((e) => e.file.endsWith("aerial-images.ts"));
    expect(aerial, "the aerial-images entry is gone").toBeDefined();
    expect(aerial!.note).toContain("ZERO call sites");
    expect(aerial!.note.toLowerCase()).toContain("fabrication");
  });
});

describe("the registry says what the gate actually covers", () => {
  const entry = CONSTITUTION.find((i) => i.id === "truth.no-fabrication");

  it("the entry exists and is lint-enforced", () => {
    expect(entry).toBeDefined();
    expect(entry!.enforcement.kind).toBe("lint");
  });

  it("its refs resolve", () => {
    for (const ref of entry!.enforcement.refs) {
      expect(fs.existsSync(path.join(ROOT, ref)), `${ref} does not exist`).toBe(true);
    }
  });

  it("it states the scope AND the limit", () => {
    // The entry used to be a bare pointer at the script, which read as full
    // coverage of a hard-stop while the gate saw one layer. Units 51–52
    // established that this registry is the checkable form of the rules; a
    // pointer that overstates its gate is the registry lying about itself.
    const note = entry!.enforcement.note ?? "";
    expect(note, "the no-fabrication entry lost its scope note").toContain("client/src");
    expect(
      note,
      "the entry no longer records what the gate CANNOT catch — a hardcoded " +
        "plausible constant is invented data that no Math.random scan sees",
    ).toContain("hardcoded plausible constant");
  });
});
