/**
 * A write to `organizations.settings` that REPLACES instead of merging silently
 * disarms the per-org simulation kill-switch.
 *
 * `server/utils/simulationMode.ts` calls itself "the single source of truth for
 * no real-world side effects" and names three layers, the third being
 * `org.settings.simulationMode`. When it is true, no mail, SMS, email or
 * webhook leaves the building for that org.
 *
 * It lives in a jsonb blob shared with two dozen unrelated preferences —
 * showTips, checklistDismissed, dashboard widget order — and **it was not
 * declared in that column's own `$type<>`**, while being read through
 * `(org as any).settings.simulationMode`. Two consequences, and the second is
 * the dangerous one:
 *
 *   1. A typed write composed from the column's type could not carry the flag.
 *   2. A write that assigned `settings` wholesale — rather than spreading the
 *      existing object — would drop it, and every gate downstream would read
 *      `false` and start sending for real. Nothing would error, nothing would
 *      log, and the only symptom would be real mail arriving from an org that
 *      was supposed to be simulated.
 *
 * **Every writer merges today.** That was verified across `routes-organization`
 * (which also `.strict()`-parses its patch), `services/onboarding` (seven sites)
 * and `storage/orgRepo`. This file exists so it stays true, because the
 * property is invisible at every individual call site: `settings: { ...x }` and
 * `settings: { ... }` differ by three characters and only one of them is safe.
 *
 * DERIVED FROM SOURCE, not listed. A hand-maintained list of writers is exactly
 * what went stale in the webhook live-trigger case (`CLAUDE.md`), so the scan
 * below finds the writes itself and requires each to spread.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isOrgSimulated } from "../../server/utils/simulationMode";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("the kill-switch is part of its column's contract", () => {
  const schema = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
  const at = schema.indexOf('export const organizations = pgTable("organizations"');
  const table = schema.slice(at, at + 9000);

  it("finds the organizations table (vacuity guard)", () => {
    expect(at, "organizations table not found — renamed?").toBeGreaterThan(-1);
    expect(table).toContain('jsonb("settings")');
  });

  it("simulationMode is DECLARED, not reached through a cast", () => {
    // Undeclared, the flag sits outside the shape its own column publishes:
    // no typed write can carry it, and a typed write can drop it.
    expect(
      /simulationMode\??\s*:\s*boolean/.test(table),
      "organizations.settings no longer declares simulationMode — a safety flag " +
        "outside its column's own type cannot be written by typed code and can " +
        "be erased by it",
    ).toBe(true);
  });

  it("the reader agrees with the declaration", () => {
    expect(isOrgSimulated({ settings: { simulationMode: true } })).toBe(true);
    expect(isOrgSimulated({ settings: { simulationMode: false } })).toBe(false);
    expect(isOrgSimulated({ settings: {} })).toBe(false);
    expect(isOrgSimulated(null)).toBe(false);
  });

  it("nothing reads it through a cast any more", () => {
    const repo = stripComments(
      fs.readFileSync(path.join(ROOT, "server/storage/orgRepo.ts"), "utf8"),
    );
    expect(repo).toContain("settings?.simulationMode");
    expect(
      /\(\s*org\s+as\s+any\s*\)\??\.settings/.test(repo),
      "orgRepo reaches settings through `as any` again — the cast is what let " +
        "the field stay undeclared",
    ).toBe(false);
  });
});

// ─── Every settings write merges ──────────────────────────────────────────────

interface Write { file: string; line: number; text: string }

/**
 * Writes that assign `organizations.settings`. Matched on the assignment
 * itself — `settings: {` inside an update/insert payload — and classified by
 * whether the object literal spreads an existing settings value.
 */
function settingsWrites(): {
  merging: Write[];
  replacing: Write[];
  indirect: Write[];
  scanned: number;
} {
  const merging: Write[] = [];
  const replacing: Write[] = [];
  const indirect: Write[] = [];
  let scanned = 0;

  // The opener of an actual organization write. `settings: {` alone is not
  // enough — it also appears in read-only response payloads (supportAgent's
  // diagnostics tool builds one), and a scan that counted those would report a
  // safe file as unsafe, which is how a security test gets deleted.
  const OPENER = /updateOrganization\(|update\(organizations\)|insert\(organizations\)/g;

  for (const abs of walk(path.join(ROOT, "server"))) {
    const rel = path.relative(ROOT, abs);
    const src = stripComments(fs.readFileSync(abs, "utf8"));
    if (!OPENER.test(src)) continue;
    OPENER.lastIndex = 0;

    for (const open of src.matchAll(OPENER)) {
      // The payload: from the opener to the end of its call expression, bounded
      // so an unbalanced file cannot swallow the rest of the module.
      const from = open.index ?? 0;
      let depth = 0;
      let end = from;
      for (; end < src.length && end < from + 4000; end++) {
        const ch = src[end];
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) break; }
      }
      const payload = src.slice(from, end + 1);

      // A write that passes a PRECOMPUTED value — `settings: merged` — cannot
      // be classified by reading the literal, because there is none. Those are
      // collected separately and registered by hand below, rather than
      // silently skipped: an unclassifiable write is not a safe one.
      const indirectKey = /(^|\n)\s*settings:\s*([A-Za-z_$][\w$]*)\s*[,}]/.exec(payload);
      if (indirectKey) {
        indirect.push({
          file: rel,
          line: src.slice(0, from + indirectKey.index).split("\n").length,
          text: indirectKey[0].trim(),
        });
      }

      const key = /(^|\n)\s*settings:\s*\{/.exec(payload);
      if (!key) continue;
      scanned++;

      // The object literal that follows the key, to its closing brace — the
      // spread can be on any line inside it.
      const litStart = payload.indexOf("{", key.index + key[0].indexOf("settings"));
      let d = 0;
      let litEnd = litStart;
      for (; litEnd < payload.length; litEnd++) {
        if (payload[litEnd] === "{") d++;
        else if (payload[litEnd] === "}") { d--; if (d === 0) break; }
      }
      const literal = payload.slice(litStart, litEnd + 1);
      const line = src.slice(0, from + key.index).split("\n").length;
      const w: Write = { file: rel, line, text: literal.split("\n")[0].trim() };
      if (/\.\.\./.test(literal)) merging.push(w);
      else replacing.push(w);
    }
  }
  return { merging, replacing, indirect, scanned };
}

describe("no settings write can clear a flag it does not know about", () => {
  const { merging, replacing, indirect, scanned } = settingsWrites();

  it("finds the writes (vacuity guard)", () => {
    // A scan that finds nothing would pass this file forever, including after
    // someone added the replacing write it exists to catch.
    expect(
      scanned,
      "no organizations.settings writes found — has the write shape changed?",
    ).toBeGreaterThan(3);
    expect(merging.length + replacing.length).toBe(scanned);
    expect(merging.length, "no MERGING write found — the scan is not classifying")
      .toBeGreaterThan(0);
  });

  it("every write spreads the existing settings", () => {
    expect(
      replacing.map((w) => `${w.file}:${w.line}  ${w.text}`).join("\n"),
      "These assign organizations.settings WITHOUT spreading the existing " +
        "object. `settings` is a shared blob: replacing it drops every key the " +
        "writer did not think about — including simulationMode, the per-org " +
        "kill-switch that stops real mail, SMS, email and webhooks leaving the " +
        "building. A dropped kill-switch reads as false, logs nothing, and the " +
        "first symptom is real mail from an org that was supposed to be " +
        "simulated. Write `settings: { ...current.settings, ...patch }`.",
    ).toBe("");
  });

  it("every write that passes a precomputed value is registered", () => {
    // The scan's honest limitation: it classifies object literals, and cannot
    // tell whether a variable was built by merging without following dataflow.
    // Rather than skip those, each is named here with the reason it is safe —
    // and the reason is asserted below, not just asserted to exist.
    const REGISTERED = new Set(["server/routes-organization.ts"]);
    const stray = indirect.filter((w) => !REGISTERED.has(w.file));
    expect(
      stray.map((w) => `${w.file}:${w.line}  ${w.text}`).join("\n"),
      "These write organizations.settings from a variable, so this file cannot " +
        "see whether the variable merged. Either inline the spread, or add the " +
        "file here alongside an assertion that its merge is real.",
    ).toBe("");
  });

  it("the registered indirect write really does merge", () => {
    // PATCH /api/organization/settings — the customer-facing one, and the only
    // settings write a member can reach. It builds `merged` on the line above,
    // so the safety is one line away from the write and worth pinning directly.
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-organization.ts"), "utf8"),
    );
    const at = src.indexOf('api.patch("/api/organization/settings"');
    expect(at, "the settings PATCH route is gone — renamed?").toBeGreaterThan(-1);
    const handler = src.slice(at, at + 3000);
    expect(
      /const\s+merged\s*=\s*\{\s*\.\.\.\(?\s*current/.test(handler),
      "the settings PATCH no longer merges onto the current settings — it would " +
        "drop every key its zod schema does not name, simulationMode included",
    ).toBe(true);
    expect(handler).toContain("settings: merged");
  });

  it("the merge-detector can tell the two apart (vacuity guard)", () => {
    // The whole file rests on the spread check. Asserted against known shapes
    // so a broken classifier fails here rather than passing everything.
    const merge = "settings: {\n  ...current,\n  showTips: true,\n}";
    const replace = "settings: {\n  showTips: true,\n}";
    expect(/\.\.\./.test(merge)).toBe(true);
    expect(/\.\.\./.test(replace)).toBe(false);
  });
});
