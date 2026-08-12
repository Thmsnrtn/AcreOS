/**
 * Outward-action coverage ratchet.
 *
 * BI148's operational SLO — "No duplicate consequential action after retry" —
 * is not satisfied by the boundary EXISTING. It is satisfied by every
 * consequential send going THROUGH it. Building the primitive and wiring one
 * path is progress, not completion, and the gap between the two is exactly the
 * kind of thing that reads as done in a commit message and is still open a year
 * later.
 *
 * So this counts the consequential send call sites that are NOT yet protected
 * and holds that count down-only, the same discipline the repo already uses for
 * `as any`, raw `res.status`, unreached exports and table count.
 *
 * TO LOWER IT: pass an `idempotencyKey` derived from durable domain identity
 * (a campaign piece id, a note-payment notice id) at the call site — never a
 * random value, which would defeat the mechanism on the retry it exists to
 * protect. Then lower the baseline in the same commit.
 *
 * WHAT COUNTS AS A SEND SITE: a call to one of the outward transports named in
 * PROTECTABLE_SENDS, from production code (not tests, not the transport module
 * itself, and not a comment).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SERVER = path.join(ROOT, "server");

/**
 * The outward transports whose duplicate execution has a real-world
 * consequence: money spent, a counterparty contacted twice.
 *
 * Deliberately NOT every I/O call. A duplicate READ is harmless; this is about
 * consequential WRITES to the outside world (BI73's consequence classes:
 * external communication and financial commitment).
 */
const PROTECTABLE_SENDS = [
  { id: "directMailService.sendLetter", re: /directMailService\.sendLetter\s*\(/g },
  { id: "directMailService.sendPostcard", re: /directMailService\.sendPostcard\s*\(/g },
  { id: "lobService.sendLetter", re: /lobService\.sendLetter\s*\(/g },
  { id: "lobService.sendPostcard", re: /lobService\.sendPostcard\s*\(/g },
];

/**
 * Unprotected consequential send call sites. May only DECREASE.
 *
 * 2026-08-12 (initial): 4 — VERIFIED by running the scanner, not estimated.
 *   The outward-action boundary (server/services/actions/outwardAction.ts) and
 *   its claim ledger landed with `directMailService.sendLetter` accepting an
 *   `idempotencyKey`. No CALL SITE passes one yet, so every site is still
 *   counted. That is deliberate: the primitive is available and adopted
 *   nowhere, and this number says so out loud rather than letting "idempotency
 *   shipped" stand as a claim the code does not support.
 *
 *   The four:
 *     server/routes-campaigns.ts     sendLetter, sendPostcard — the bulk-mail
 *                                    path; highest volume, highest spend
 *     server/services/apiQueue.ts    sendPostcard — a RETRY QUEUE calling an
 *                                    unprotected send. This is the exact shape
 *                                    of the defect and is the first to fix.
 *     server/services/communications.ts  lobService.sendLetter
 *
 * HONEST SCOPE: this ratchet covers the PHYSICAL MAIL transports only
 * (directMailService + lobService), because that is where a duplicate costs
 * money per piece and reaches a real counterparty. Email (`emailService`), SMS
 * (`smsService`), the `directMail.ts` / `mailProvider.ts` wrappers and e-sign
 * are equally consequential and are NOT yet counted here. Widening
 * PROTECTABLE_SENDS to cover them is the next increment; doing it now would
 * have produced a baseline nobody could act on in one change.
 */
const UNPROTECTED_SEND_SITES_BASELINE = 4;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip line and block comments so prose about a send is not counted as one. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (l.trimStart().startsWith("//") || l.trimStart().startsWith("*") ? "" : l))
    .join("\n");
}

interface SendSite {
  file: string;
  send: string;
  protected: boolean;
}

function findSendSites(): SendSite[] {
  const sites: SendSite[] = [];
  for (const file of walk(SERVER)) {
    const rel = path.relative(ROOT, file);
    // The transport modules themselves define the functions; they are not
    // call sites, and outwardAction.ts only mentions them in documentation.
    if (
      rel.endsWith("services/directMailService.ts") ||
      rel.endsWith("services/lobService.ts") ||
      rel.endsWith("services/actions/outwardAction.ts")
    ) {
      continue;
    }
    const src = stripComments(fs.readFileSync(file, "utf8"));
    for (const send of PROTECTABLE_SENDS) {
      send.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = send.re.exec(src)) !== null) {
        // A site is protected when an idempotencyKey travels with the call.
        // Look at the call's argument region rather than the whole file, so one
        // protected site does not mask an unprotected sibling.
        const region = src.slice(m.index, m.index + 900);
        sites.push({
          file: rel,
          send: send.id,
          protected: /idempotencyKey\s*:/.test(region),
        });
      }
    }
  }
  return sites;
}

describe("outward-action coverage", () => {
  it("finds the send sites at all — a scanner that finds nothing passes vacuously", () => {
    const sites = findSendSites();
    expect(
      sites.length,
      "no consequential send sites found; the scanner is broken, not the code",
    ).toBeGreaterThan(0);
  });

  it(`unprotected consequential send sites stay at or below ${UNPROTECTED_SEND_SITES_BASELINE}`, () => {
    const unprotected = findSendSites().filter((s) => !s.protected);
    expect(
      unprotected.length,
      `Unprotected consequential send sites grew to ${unprotected.length}:\n` +
        unprotected.map((s) => `  ✗ ${s.file}  ${s.send}`).join("\n") +
        `\n\nEvery one of these can double-send when its job retries after a partial\n` +
        `success. Pass an idempotencyKey derived from durable domain identity —\n` +
        `never a random value — and lower the baseline in the same commit.`,
    ).toBeLessThanOrEqual(UNPROTECTED_SEND_SITES_BASELINE);
  });

  it("the baseline is not stale — it must track adoption as it improves", () => {
    // "Fix the occurrence, not the baseline" has a mirror: when a count
    // legitimately drops, lower it in the same commit (CLAUDE.md).
    const unprotected = findSendSites().filter((s) => !s.protected);
    expect(
      unprotected.length,
      "unprotected send sites dropped below the baseline — LOWER UNPROTECTED_SEND_SITES_BASELINE",
    ).toBe(UNPROTECTED_SEND_SITES_BASELINE);
  });

  it("the transport accepts an idempotency key, so the ratchet CAN be lowered", () => {
    // A down-only ratchet with no mechanism to lower it is a permanent
    // accusation, not a gate.
    const dms = fs.readFileSync(
      path.join(ROOT, "server/services/directMailService.ts"),
      "utf8",
    );
    expect(dms).toMatch(/idempotencyKey\?\s*:\s*string/);
    expect(dms).toContain("withOutwardAction");
  });
});
