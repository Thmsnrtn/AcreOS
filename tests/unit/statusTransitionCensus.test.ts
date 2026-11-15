/**
 * §7.4.18 census — every writer of `notes.status` on the ORIGINATED book,
 * enumerated from source, so the activation gate's population cannot grow
 * a new back door silently.
 *
 * The gate (server/services/notes/originationGate.ts) guards activation at
 * noteRepo.createNote / noteRepo.updateNote. Before Leg 3, three
 * payment-side sites flipped status with direct `.update(notes)` writes
 * the gate never saw (the statute register's §1026.43 residual). Leg 3
 * routed those through the one pure rule
 * (shared/notes/servicedStatus.ts nextServicedStatus — a payment never
 * consummates a pending note, never un-defaults a defaulted one). This
 * test enumerates EVERY `.update(notes)` call site in server/**, reads
 * the `.set(...)` that follows it, and classifies every site that can
 * write `status`:
 *
 *   ROUTED    the set computes status via nextServicedStatus(...)
 *   REVERSAL  the ACH-return / refund reversal shape: status is
 *             'active' ONLY when the locked row was 'paid_off' and a
 *             balance was restored; otherwise the locked status stands.
 *             It cannot activate a pending note — 'pending' is never
 *             the locked status it lifts, and the guard names paid_off.
 *   GATE      noteRepo.updateNote's two `.set(setValues)` writes (the
 *             set is a variable, so the content rule cannot see it):
 *             the ONLY indirect sites allowed, in the one file that
 *             contains the gate call itself.
 *
 * Any other status-writing site FAILS this test until it is routed,
 * guarded, or classified here with its reason. Non-status updates
 * (escrow balances, ATR columns, autopay flags) are enumerated and
 * ignored by design. The dunning/delinquency writers were looked for
 * specifically: none writes notes.status outside these sites (the
 * ladder writes note_events; delinquency status changes flow through
 * the payment and update paths above).
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "..", "..");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(p));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** The argument text of the first `.set(...)` at/after `from`, balanced. */
function setArgument(src: string, from: number): string | null {
  const at = src.indexOf(".set(", from);
  if (at === -1) return null;
  // Start INSIDE the paren: depth 1, return when its close brings it to 0.
  // (Starting at 0 works for object literals but never terminates on a
  // bare-identifier argument like .set(setValues) — the scan runs off the
  // end and the site is silently unclassified.)
  let depth = 1;
  for (let i = at + 5; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return src.slice(at + 5, i);
    }
  }
  return null;
}

interface Site {
  file: string;
  setText: string;
  writesStatus: boolean;
  indirect: boolean;
}

function census(): Site[] {
  const sites: Site[] = [];
  for (const file of walkTs(path.join(ROOT, "server"))) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const re = /\.update\(\s*notes\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const setText = setArgument(src, m.index) ?? "";
      const trimmed = setText.trim();
      sites.push({
        file: path.relative(ROOT, file),
        setText,
        writesStatus: /(^|[{,\s])status\s*:/.test(setText),
        indirect: /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed),
      });
    }
  }
  return sites;
}

describe("status-transition census — every .update(notes) site is classified (§7.4.18)", () => {
  const sites = census();

  it("finds the update population (the census is not vacuous)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(10);
    expect(sites.some((s) => s.writesStatus)).toBe(true);
  });

  it("every literal status write is ROUTED (nextServicedStatus) or a paid_off-only REVERSAL", () => {
    const offenders: string[] = [];
    for (const s of sites) {
      if (!s.writesStatus || s.indirect) continue;
      if (s.setText.includes("nextServicedStatus(")) continue; // ROUTED
      if (/locked\.status === ["']paid_off["']/.test(s.setText)) continue; // REVERSAL guard
      offenders.push(`${s.file}: ${s.setText.slice(0, 120)}…`);
    }
    expect(
      offenders,
      `unclassified status writers — route them through nextServicedStatus, ` +
        `guard them to the paid_off reversal shape, or classify them here with a reason:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the three payment paths each carry a ROUTED status write", () => {
    for (const file of [
      "server/storage/noteRepo.ts",
      "server/services/achAutopay.ts",
      "server/services/borrower/portalPaymentPosting.ts",
    ]) {
      const routed = sites.some(
        (s) => s.file === file && s.writesStatus && s.setText.includes("nextServicedStatus("),
      );
      expect(routed, `${file} must route its payment status write through nextServicedStatus`).toBe(true);
    }
  });

  it("the two reversal sites keep the paid_off-only guard (a reversal never activates a pending note)", () => {
    const reversals = sites.filter((s) => s.writesStatus && /locked\.status === ["']paid_off["']/.test(s.setText));
    expect(reversals.map((s) => s.file).sort()).toEqual([
      "server/services/achAutopay.ts",
      "server/webhookHandlers.ts",
    ]);
    for (const r of reversals) {
      // The guard's shape: 'active' appears ONLY as the paid_off branch.
      expect(r.setText).toMatch(/\? ["']active["']/);
      expect(r.setText).toContain(": locked.status");
    }
  });

  it("indirect .set(variable) writes into notes exist ONLY in noteRepo.updateNote, beside the gate call", () => {
    const indirect = sites.filter((s) => s.indirect);
    expect(indirect.map((s) => s.file)).toEqual([
      "server/storage/noteRepo.ts",
      "server/storage/noteRepo.ts",
    ]);
    const repoSrc = stripComments(
      fs.readFileSync(path.join(ROOT, "server/storage/noteRepo.ts"), "utf8"),
    );
    expect(repoSrc).toContain("assertActivationAllowed");
    expect(repoSrc).toContain('existing.status === "pending"');
  });
});
