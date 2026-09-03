/**
 * A KILL is not finished while its switch is still on the wall.
 *
 * `platform_feature_flags` is seeded by migration and outlives the features it
 * names. Three seeded keys refer to subsystems whose code is deleted:
 *
 *   - `feature_vision_ai` — KILL executed 2026-08-01. `routes-vision-ai.ts`,
 *     `services/visionAI.ts`, `pages/vision-ai.tsx` gone; both satellite tables
 *     dropped.
 *   - `feature_voice_ai` — KILL executed 2026-08-01. The pipeline and its two
 *     tables gone.
 *   - `feature_negotiation_copilot` — KILL executed 2026-08-13, **by this
 *     program, four units ago**. The router, service, page, seven satellite
 *     components and three further API endpoints were deleted; the flag stayed.
 *
 * That last one is the reason this file exists. Unit 76 executed a founder
 * ruling thoroughly enough to find a rail the deletion ledger had not recorded
 * — and still left the switch behind, because nothing was looking at the flag
 * catalogue.
 *
 * WHY IT MATTERS MORE NOW THAN IT DID LAST WEEK. Unit 81 found that two of the
 * three founder flag toggles wrote a back-compat column nothing read, so
 * flipping any flag was inert. Fixing that turned a dead row from a curiosity
 * into a **live control that reports success and changes nothing**, on a console
 * whose entire job is telling the founder what is switched on. Making the writes
 * work raised the stakes on the catalogue being true.
 *
 * WHAT THE FIX IS. `RETIRED_FLAG_KEYS` hides these from `getAll` (so the console
 * and `/api/config/features` never see them), makes `getByKey` answer ABSENT (so
 * a stored `state: "on"` can never be honoured), and makes `setFlag` throw (so a
 * write is refused rather than accepted and ignored).
 *
 * **The ROWS are deleted too, as of the founder ruling on B16** — a `DELETE FROM
 * platform_feature_flags` in `scripts/migrate.mjs`, applied on the next deploy.
 * That is platform config rather than customer data, which is why it needed only
 * the same class of ruling the 2026-08-01 dead-table drops took.
 *
 * **THE REGISTER STAYS AFTER THE ROWS GO, and that is the point.** It is not
 * bookkeeping for three rows; it is what catches the NEXT kill's leftover
 * switch — the defect unit 76 created and nothing noticed. Deleting it once the
 * rows are gone would remove the only thing looking at the flag catalogue.
 *
 * BOTH DIRECTIONS ARE CHECKED, as every register in this repo is: each key here
 * must still be unreferenced by any code, and each deleted subsystem must still
 * have its flag listed. The second direction is the one that would have caught
 * unit 76's residue on the day it was created.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RETIRED_FLAG_KEYS } from "../../server/services/featureFlags";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping — see the note in the service describe below. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
  }
  return out;
}

/** Production sources — where a live flag key would be referenced. */
const SOURCES = [
  ...walk(path.join(ROOT, "server")),
  ...walk(path.join(ROOT, "client/src")),
].filter((p) => !p.endsWith("server/services/featureFlags.ts"));

function referencesKey(key: string): string[] {
  const hits: string[] = [];
  for (const abs of SOURCES) {
    const src = fs.readFileSync(abs, "utf8");
    if (src.includes(`"${key}"`) || src.includes(`'${key}'`)) {
      hits.push(path.relative(ROOT, abs));
    }
  }
  return hits;
}

describe("a retired flag is retired because nothing uses it", () => {
  it("finds the register (vacuity guard)", () => {
    expect(Object.keys(RETIRED_FLAG_KEYS).length, "RETIRED_FLAG_KEYS is empty")
      .toBeGreaterThan(0);
  });

  it("no code references any retired key", () => {
    // The claim the whole register rests on. If a key is referenced again — a
    // new `requireLadderFlag("feature_voice_ai")`, say — then either the
    // subsystem is back and the key should leave this list, or the reference is
    // a mistake. Either way it is a decision, not a silent state.
    for (const [key, verdict] of Object.entries(RETIRED_FLAG_KEYS)) {
      expect(
        referencesKey(key).join(", "),
        `${key} is referenced in code again, but it is listed as retired ` +
          `(${verdict}). If the subsystem is genuinely back, take the key out ` +
          `of RETIRED_FLAG_KEYS in the same change; if not, the reference is ` +
          `gating on a flag that can never be enabled.`,
      ).toBe("");
    }
  });

  it("every entry names a real verdict", () => {
    for (const [key, verdict] of Object.entries(RETIRED_FLAG_KEYS)) {
      expect(verdict.length, `${key} has a stub reason`).toBeGreaterThan(40);
      expect(/KILL|FREEZE|retired|deleted/i.test(verdict), `${key}'s reason names no verdict`)
        .toBe(true);
    }
  });
});

describe("a deleted subsystem does not keep its switch", () => {
  /**
   * Evidence of deletion, derived from the filesystem rather than restated.
   * A flag is REQUIRED to be in the register exactly while its subsystem's code
   * is absent — so the list cannot silently shrink, and cannot go stale in the
   * other direction either.
   */
  const SUBSYSTEMS: Record<string, string[]> = {
    feature_vision_ai: ["server/services/visionAI.ts", "client/src/pages/vision-ai.tsx"],
    feature_voice_ai: ["server/services/voiceAI.ts", "server/routes-voice.ts"],
    feature_negotiation_copilot: [
      "server/services/negotiationCopilot.ts",
      "client/src/pages/negotiation-copilot.tsx",
    ],
    // Pax controls program (2026-09-02): the panel the flag gated is gone.
    "feature.autonomy-matrix": ["client/src/components/settings/autonomy-panel.tsx"],
  };

  it("each deleted subsystem's flag is registered", () => {
    let checked = 0;
    for (const [key, files] of Object.entries(SUBSYSTEMS)) {
      const allGone = files.every((f) => !fs.existsSync(path.join(ROOT, f)));
      if (!allGone) continue;
      checked += 1;
      expect(
        key in RETIRED_FLAG_KEYS,
        `${key} left RETIRED_FLAG_KEYS while its subsystem is still deleted ` +
          `(${files.join(", ")} do not exist). The founder console would offer ` +
          `a toggle for it again — a control that reports success and changes ` +
          `nothing.`,
      ).toBe(true);
    }
    expect(
      checked,
      "no subsystem evaluated as deleted — the evidence paths have gone stale, " +
        "so this check is inspecting nothing",
    ).toBe(Object.keys(SUBSYSTEMS).length);
  });
});

describe("the service treats a retired key as absent, not as off", () => {
  /**
   * COMMENTS STRIPPED, and a mutation is why. Removing the filter line from
   * `getAll` left the comment above it — *"Retired keys are filtered HERE … See
   * RETIRED_FLAG_KEYS"* — and the assertion, which only looked for the symbol
   * name, passed against a function that no longer filtered anything.
   *
   * That is the seventh time in this program that prose has satisfied a check
   * meant for code, and the first from this direction: previously a comment
   * describing a DEFECT tripped the detector for that defect; here a comment
   * describing the FIX satisfied the check for the fix.
   */
  const svc = stripComments(
    fs.readFileSync(path.join(ROOT, "server/services/featureFlags.ts"), "utf8"),
  );

  it("getAll filters them out", () => {
    // Filtered in the service, not at each caller: the founder console,
    // /api/config/features and anything else reading the catalogue must all see
    // the same set, or the console and the customer disagree.
    const at = svc.indexOf("async getAll(");
    const body = svc.slice(at, svc.indexOf("\n  },", at));
    expect(
      body,
      "getAll stopped filtering retired keys — the founder console would list " +
        "toggles for deleted subsystems again",
    ).toContain("rows.filter((r) => !(r.key in RETIRED_FLAG_KEYS))");
  });

  it("getByKey answers null, so a stored `on` can never be honoured", () => {
    // Absent, not off. `isEnabled` treats a missing flag as off-for-everyone
    // except a founder provisioning it, which is the right answer for a
    // subsystem that does not exist. Returning `off` instead would leave the
    // stored row's state as something a future refactor could start reading.
    const at = svc.indexOf("async getByKey(");
    const body = svc.slice(at, svc.indexOf("\n  },", at));
    expect(body).toContain("if (key in RETIRED_FLAG_KEYS) return null;");
    // Before the DB read, or the row's state is what gets returned.
    expect(body.indexOf("RETIRED_FLAG_KEYS")).toBeLessThan(body.indexOf("db\n"));
  });

  it("setFlag refuses instead of accepting and ignoring", () => {
    const at = svc.indexOf("async setFlag(");
    const body = svc.slice(at, svc.indexOf("\n  },", at));
    expect(body).toContain("throw new RetiredFeatureFlagError(");
    // Before the update is built, not after it runs.
    expect(body.indexOf("RetiredFeatureFlagError")).toBeLessThan(body.indexOf("db\n"));
  });

  it("the dead rows are deleted in the deploy path, and the register outlives them", () => {
    // Founder ruling on B16. The DELETE runs on the next deploy; the register is
    // what keeps working afterwards, so a later reader does not remove it as
    // "bookkeeping for rows that no longer exist".
    const migrate = fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");
    // Every DELETE statement against the flag table, not just the first: the
    // B16 kill and the 2026-09-02 autonomy-matrix kill are two migrations.
    const needle = 'DELETE FROM "platform_feature_flags"';
    const stmts: string[] = [];
    for (let at = migrate.indexOf(needle); at > -1; at = migrate.indexOf(needle, at + 1)) {
      stmts.push(migrate.slice(at, migrate.indexOf("`", at)));
    }
    expect(stmts.length, "the B16 row deletion is gone from scripts/migrate.mjs").toBeGreaterThan(0);
    for (const key of Object.keys(RETIRED_FLAG_KEYS)) {
      expect(
        stmts.some((stmt) => stmt.includes(`'${key}'`)),
        `${key} is registered as retired but no DELETE in migrate.mjs names it`,
      ).toBe(true);
    }
  });

  it("both admin write surfaces render the refusal as 404", () => {
    // 404 is the same answer getByKey gives, and it is the truth: as far as
    // this system is concerned the flag is not there. A 500 would read as a
    // bug in the console.
    for (const rel of ["server/routes-feature-flags.ts", "server/routes.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} does not handle RetiredFeatureFlagError`).toContain(
        "RetiredFeatureFlagError",
      );
    }
  });
});
