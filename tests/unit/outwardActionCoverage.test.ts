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
 *
 * A TRAP THIS SCANNER WALKED INTO ONCE, AND NOW DOCUMENTS
 * -------------------------------------------------------
 * `directMailService` is exported by TWO different modules:
 *
 *   server/services/directMailService.ts — a FUNCTION module
 *                                          (`export async function sendLetter`)
 *   server/services/directMail.ts        — a CLASS instance
 *                                          (`export const directMailService = new DirectMailService()`)
 *
 * Both call Lob directly. The symbol is identical at every call site, so a
 * name-only scan cannot tell which transport a site uses — and the first
 * version of this ratchet counted sites that call the CLASS while the
 * idempotency option had only been added to the FUNCTION module. Passing a key
 * at those sites would have lowered the number while protecting nothing, which
 * is the worst possible outcome for a governance gate.
 *
 * Both transports now accept an `idempotencyKey`, so the count is honest either
 * way. The duplication itself is a real BI67 violation (one capability
 * interface per category, one adapter) and is recorded in
 * docs/implementation/ARCHITECTURE_DELTA.md as a MERGE candidate — but merging
 * two live mail paths is its own unit of work, not a side effect of this one.
 */
const PROTECTABLE_SENDS = [
  { id: "directMailService.sendLetter", re: /directMailService\.sendLetter\s*\(/g },
  { id: "directMailService.sendPostcard", re: /directMailService\.sendPostcard\s*\(/g },
  { id: "lobService.sendLetter", re: /lobService\.sendLetter\s*\(/g },
  { id: "lobService.sendPostcard", re: /lobService\.sendPostcard\s*\(/g },
  { id: "emailService.sendEmail", re: /emailService\.sendEmail\s*\(/g },
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
 * 2026-08-12 (4 -> 2): the two bulk-mail sites in server/routes-campaigns.ts
 *   now pass `idempotencyKey: mailing-order:{orderId}:lead:{leadId}`. That key
 *   was the whole unblock: both rows exist BEFORE the send, and scoping to the
 *   ORDER rather than the lead is what makes it safe — retrying this batch is
 *   suppressed, while a later deliberate mailing to the same lead creates a new
 *   mailing order and therefore a new key. A lead-only key would have silently
 *   blocked the second touch, which is a worse failure than the one being
 *   fixed. The replay path is handled too: MailAlreadySentError is recorded as
 *   SENT (carrying the real Lob id), not as a failure, so the sent count cannot
 *   understate and no operator is invited to re-send something already posted.
 *
 *   The remaining two are genuinely blocked, not merely undone — see
 *   docs/implementation/BLOCKERS.md B5 and B6:
 *     server/services/apiQueue.ts        sendPostcard — unreachable today (no
 *                                        enqueue site produces that operation)
 *                                        and wiring it needs an orgId the call
 *                                        does not pass, which would change
 *                                        which Lob credentials are used.
 *     server/services/communications.ts  lobService.sendLetter — a live
 *                                        double-print path, but its key
 *                                        semantics and the boundary's
 *                                        fail-open/closed posture on a money
 *                                        path are founder decisions.
 *
 * 2026-08-12 (2 -> 61): SCOPE EXPANSION, not a regression. `emailService.
 *   sendEmail` joined PROTECTABLE_SENDS, adding 59 previously-uncounted send
 *   sites. (A raw grep suggested 76; the scanner reports 61 because it strips
 *   comments and excludes the transport module itself. The number here is the
 *   one the scanner produced, not the one the grep suggested — an estimated
 *   baseline is a guess wearing a ratchet's clothes.) The number went UP because the measurement got
 *   honest, not because anything got worse: those sites were always
 *   unprotected, and a ratchet reading "2" while 59 unguarded email sends
 *   existed was understating the real surface — exactly the kind of
 *   comfortable-but-false number this whole program exists to abolish.
 *
 *   `emailService.sendEmail` now accepts an `idempotencyKey` (opt-in, engaging
 *   only when `organizationId` is also present, since the claim is
 *   tenant-scoped), so the count is lowerable rather than a permanent
 *   accusation. Email replay returns success with the ORIGINAL provider message
 *   id rather than throwing: unlike physical mail, an email caller almost
 *   always just wants to know the message went out, and the real SES id is the
 *   honest answer. Nothing is fabricated.
 *
 * STILL OUT OF SCOPE, and named so the number is not mistaken for the whole
 * truth: SMS (`smsService`, ~10 sites), the `directMail.ts`/`mailProvider.ts`
 * wrappers reached through other symbols, and e-sign. Each needs its transport
 * wired before it can be counted without making the ratchet unlowerable.
 */
// 61 -> 60 on 2026-08-14: B19 class 3 (founder ruling) deleted sixteen module
// orphans, and one of them carried an unprotected consequential send site. Not
// a hardening: a deletion. The register tracks adoption in BOTH directions, so
// it FAILED stale-high until this was lowered — which is the half that stops a
// reduction being banked instead of recorded.
// 60 -> 59 (turn 6) -> 57 (turn 7) -> 55 (turn 8, schedule_call +
// send_guided_walkthrough): the agent callers move onto the witnessed seam.
const UNPROTECTED_SEND_SITES_BASELINE = 55;

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

  it("every counted transport accepts an idempotency key", () => {
    // A down-only ratchet with no mechanism to lower it is a permanent
    // accusation, not a gate — and a ratchet whose "fix" is a no-op is worse
    // than no ratchet. `directMailService` is exported by two different
    // modules (see the note on PROTECTABLE_SENDS); if only one accepted a key,
    // lowering this count would protect nothing at three of the four sites.
    for (const rel of [
      "server/services/directMailService.ts", // the function module
      "server/services/directMail.ts", // the class instance
      "server/services/emailService.ts",
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} must accept an idempotencyKey`).toMatch(
        /idempotencyKey\?\s*:\s*string/,
      );
      expect(src, `${rel} must route through the boundary`).toContain(
        "withOutwardAction",
      );
    }
  });
});
