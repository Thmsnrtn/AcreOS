/**
 * A VA asked for help, got "success", and nobody was ever told.
 *
 * `POST /api/va/escalate` — "escalate task to human supervisor" — accepted a
 * `taskId`, a `reason`, an `urgency` and a `supervisorUserId`, pushed a record
 * into `organizations.settings.va_escalations`, and returned
 * `{ success: true, escalation }`.
 *
 * That was the whole route. Three separate facts, each verified against HEAD
 * before this was written:
 *
 *   1. **Nothing reads the key.** `va_escalations` appears in exactly two
 *      places in the entire repository, and both are inside this handler — the
 *      read and the write of its own read-modify-write. No route, job, service
 *      or screen consumes it.
 *   2. **The supervisor was never notified.** `supervisorUserId` was stored and
 *      otherwise unused. No notification, no task, no alert, no mail.
 *   3. **Nothing calls it.** No caller anywhere in `client/src`.
 *
 * So the one function of an escalation — reaching a human — did not happen, and
 * the response said it had. This is the "recorded as sent but never sent"
 * family the borrower reminder ladder was rebuilt to remove, on a path where
 * the message is *someone is stuck and needs help*.
 *
 * WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
 * -------------------------------------------
 * The route now does what its own name and parameters declare: it raises an
 * in-app notification to the named supervisor. That is not a new feature — it
 * is the minimum implementation of the contract the signature already
 * published. **In-app only**: no email, no SMS, nothing leaves the building.
 *
 * `supervisorUserId` became REQUIRED, because an escalation with no recipient
 * reaches nobody — the same class of check as the `taskId` and `reason` the
 * route already required. It is safe to tighten: nothing calls this route.
 *
 * The recipient is validated as an org member. It arrives in the request body
 * and is about to have a notification row written for it; unchecked, that is a
 * write into another organization's user's inbox.
 *
 * `system_alert` from the closed `NOTIFICATION_TYPES` set. `task_assigned`
 * would read to the supervisor as "a task was assigned to you", which is not
 * what happened, and widening a closed vocabulary for one caller is what makes
 * such a set stop meaning anything.
 *
 * The log is now bounded — `organizations` is SELECTed in full on every
 * org-scoped request. Trimming the oldest is safe ONLY because the escalation
 * is delivered as a notification; before that, dropping an entry would have
 * dropped the escalation itself. That ordering is the whole reason unit 47
 * declined to paste its cap onto this log.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NOTIFICATION_TYPES } from "@shared/schema";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

const va = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-va-engine.ts"), "utf8"),
);

/** The escalate handler alone, bounded at the next registration — never to EOF. */
const escalate = (() => {
  const marker = 'api.post("/api/va/escalate"';
  const at = va.indexOf(marker);
  if (at === -1) return "";
  const rest = va.slice(at + marker.length);
  const next = rest.search(/\bapi\.(get|post|put|patch|delete)\(/);
  return next === -1 ? va.slice(at) : va.slice(at, at + marker.length + next);
})();

describe("the escalation reaches a human", () => {
  it("finds the handler (vacuity guard)", () => {
    expect(escalate.length, "the escalate route is gone — renamed?").toBeGreaterThan(600);
  });

  it("raises a notification to the supervisor", () => {
    // The entire point of the route, and the thing it did not do.
    expect(
      escalate,
      "escalate no longer notifies anyone — it is back to writing a record " +
        "nothing reads and returning success",
    ).toContain("storage.createNotification(");
    expect(escalate).toMatch(/userId:\s*String\(supervisorUserId\)/);
  });

  it("uses a type from the closed set", () => {
    const m = /type:\s*"([\w_]+)"/.exec(escalate);
    expect(m, "the notification declares no type").not.toBeNull();
    expect(
      (NOTIFICATION_TYPES as readonly string[]).includes(m![1]),
      `"${m![1]}" is not in NOTIFICATION_TYPES — widening a closed vocabulary ` +
        `for one caller is what makes it stop meaning anything`,
    ).toBe(true);
  });

  it("sends nothing outside the building", () => {
    // In-app only, deliberately. A supervisor alert is internal state; making
    // it an email would be an outbound message on a path nobody asked for.
    for (const rail of ["sendEmail", "sendSMS", "sendOrgSMS", "sendToLead", "dispatchWebhook"]) {
      expect(escalate, `escalate now reaches an external rail via ${rail}`).not.toContain(rail);
    }
  });
});

describe("an escalation with no recipient is refused", () => {
  it("requires supervisorUserId", () => {
    expect(escalate).toMatch(/if\s*\(!supervisorUserId\)/);
    expect(escalate).toContain("reaches nobody");
  });

  it("validates the recipient is in this organization", () => {
    // The id arrives in the request body and a notification row is written for
    // it. Unchecked, that writes into another org's user's inbox.
    expect(
      escalate,
      "the supervisor id is used without an org-membership check — that is a " +
        "cross-tenant write into another organization's notifications",
    ).toContain("assertUserIsOrgMember(");
    const at = escalate.indexOf("assertUserIsOrgMember(");
    const notify = escalate.indexOf("storage.createNotification(");
    expect(at, "the membership check runs AFTER the notification is written")
      .toBeLessThan(notify);
  });
});

describe("the response says what actually happened", () => {
  it("reports whether the supervisor was reached", () => {
    // `success: true` alone claimed a delivery that never occurred.
    expect(escalate).toMatch(/notified:\s*escalation\.notifiedAt !== null/);
  });

  it("notifiedAt is set from the delivery, not assumed", () => {
    // Written only after createNotification returns. If the call throws, the
    // record stays null and the response says notified: false — the same rule
    // as the reminder ladder, where `sent` is written only alongside the rail
    // that accepted it.
    const call = escalate.indexOf("storage.createNotification(");
    const set = escalate.indexOf("escalation.notifiedAt = ");
    const catchAt = escalate.indexOf("} catch (err) {", call);
    expect(set, "notifiedAt is never set").toBeGreaterThan(-1);
    expect(set, "notifiedAt is set before the notification is raised").toBeGreaterThan(call);
    // Inside the TRY body, not merely after the call. Setting it in the catch
    // would also satisfy "after", and would mark a FAILED delivery as
    // notified — the precise lie this whole unit exists to remove. A first
    // draft of this test asserted only the ordering and passed that mutation.
    expect(catchAt, "the delivery is no longer guarded").toBeGreaterThan(-1);
    expect(
      set,
      "notifiedAt is set in the catch block — a failed delivery would be " +
        "recorded as a successful one",
    ).toBeLessThan(catchAt);
    expect(escalate, "a failed delivery is not recorded as one").toContain(
      "recorded but the supervisor was NOT notified",
    );
  });
});

describe("the log is bounded, and only now safe to bound", () => {
  it("trims to a cap", () => {
    expect(escalate).toMatch(/slice\(-MAX_VA_ESCALATIONS\)/);
    const m = /const MAX_VA_ESCALATIONS = (\d+);/.exec(va);
    expect(m, "MAX_VA_ESCALATIONS is not defined").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![1]), "the bound is high enough to be decorative").toBeLessThanOrEqual(2000);
  });

  it("trimming is only safe because delivery happens elsewhere", () => {
    // Stated as an assertion, not a comment, because the ordering is the whole
    // argument: unit 47 explicitly declined to cap this log while the blob was
    // the ONLY record of an escalation. Dropping the oldest entry would have
    // dropped a request for help. It is safe now, and only now.
    expect(escalate.indexOf("storage.createNotification(")).toBeLessThan(
      escalate.indexOf("slice(-MAX_VA_ESCALATIONS)"),
    );
  });

  it("preserves the rest of the settings blob", () => {
    expect(escalate).toMatch(/\.\.\.\(orgRecord\?\.settings \?\? \{\}\)/);
  });

  it("no longer reaches settings through a cast", () => {
    expect(
      /\(orgRecord as any\)\??\.settings\?\.va_escalations/.test(va),
      "va_escalations reads through `as any` again — the cast is what let the " +
        "field stay undeclared",
    ).toBe(false);
    expect(va).toContain("orgRecord?.settings?.va_escalations");
  });
});

describe("the premise that made this a defect", () => {
  it("still nothing else reads the key (so the notification IS the delivery)", () => {
    // If a reader appeared, the escalation would have a second path to a human
    // and the argument above would need revisiting — so it is checked rather
    // than assumed. Both occurrences must be inside this one handler.
    const hits = [...va.matchAll(/va_escalations/g)].map((m) => m.index ?? 0);
    expect(hits.length, "va_escalations is gone from the handler").toBeGreaterThan(0);
    const start = va.indexOf('api.post("/api/va/escalate"');
    const end = start + escalate.length;
    for (const i of hits) {
      expect(
        i >= start && i <= end,
        "va_escalations is now referenced OUTSIDE the escalate handler. If " +
          "something reads it back, revisit the retention bound — trimming was " +
          "argued safe only because the notification is the sole delivery.",
      ).toBe(true);
    }
  });

  it("the schema declares the field", () => {
    const schema = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
    const at = schema.indexOf('export const organizations = pgTable("organizations"');
    expect(at).toBeGreaterThan(-1);
    expect(/va_escalations\??\s*:\s*Array</.test(schema.slice(at, at + 14000))).toBe(true);
  });
});
