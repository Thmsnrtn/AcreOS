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
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CONSTITUTION } from "@shared/governance/constitution";

const ROOT = path.resolve(__dirname, "../..");
const LINT = path.join(ROOT, "scripts/check-no-fabrication.mjs");
const src = fs.readFileSync(LINT, "utf8");
const allowlist = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/no-fabrication.allowlist.json"), "utf8"),
) as { _README: string; allowlist: Array<{ file: string; line: number; category: string; note: string }> };

function run(): string {
  return execFileSync("node", [LINT], { cwd: ROOT, encoding: "utf8" });
}

describe("the fabrication gate covers the rendering layer", () => {
  it("walks client/src", () => {
    expect(
      src,
      "client/src is gone from the fabrication walk. The rendering layer is " +
        "where an invented number becomes a fact the customer acts on.",
    ).toContain('const CLIENT_DIR = join(REPO_ROOT, "client", "src");');
    expect(src).toContain("walkTsFiles(CLIENT_DIR, files);");
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
