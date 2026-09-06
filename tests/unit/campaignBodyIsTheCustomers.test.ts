/**
 * A campaign's message body must be what the customer wrote.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `campaigns` stores the composed body in `content`. The direct-mail path in
 * `routes-campaigns.ts` reads it correctly. The EMAIL and SMS paths did not:
 *
 *   email: (campaign as any).templateContent
 *       || (campaign as any).htmlContent
 *       || `<p>${(campaign as any).textContent || campaign.name}</p>`
 *
 *   sms:   (campaign as any).textContent
 *       || (campaign as any).smsBody
 *       || campaign.name || "Message from AcreOS"
 *
 * None of `templateContent`, `htmlContent`, `textContent` or `smsBody` is a
 * column of `campaigns`. Every one resolved to `undefined` on every row, so both
 * chains fell through to `campaign.name`.
 *
 * **Every recipient of every email campaign received `<p>{the campaign's
 * internal name}</p>`, and every SMS recipient received that name as the entire
 * message.** These are `purpose: 'counterparty'` sends — a customer's own leads,
 * real people, receiving an internal label instead of the message their
 * counterparty composed. The customer's `content` was never read.
 *
 * The test-send route had the same reads, so the one control an operator has for
 * checking what will go out showed a placeholder too.
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────────
 * That the ghost columns cannot come back, that `content` is what is read, and
 * that an empty body REFUSES rather than falling back to the name. The
 * name-substitution assertion is the load-bearing one: a future author reaching
 * for a "sensible default" here reintroduces the exact defect.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { campaigns } from "@shared/schema";
import { stripComments } from "../helpers/stripComments";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../../server/routes-campaigns.ts"),
  "utf8",
);
const CODE = stripComments(SRC);

const GHOSTS = ["templateContent", "htmlContent", "textContent", "smsBody"] as const;

describe("the ghost content columns do not exist", () => {
  it("VACUITY: the real content column does, and is what the fix reads", () => {
    // If `content` were also absent this whole file would be asserting against a
    // schema that cannot support it, and the fix would be as wrong as the defect.
    const cols = new Set(Object.keys(getTableColumns(campaigns as any)));
    expect(cols.has("content"), "campaigns.content is gone — re-derive this fix").toBe(true);
    expect(CODE).toMatch(/campaign\.content/);
  });

  it.each(GHOSTS)("%s is not a column of campaigns", (ghost) => {
    const cols = new Set(Object.keys(getTableColumns(campaigns as any)));
    expect(
      cols.has(ghost),
      `${ghost} is now a real column — if it was added deliberately, this file should be ` +
        "rewritten to assert the send reads it, not deleted",
    ).toBe(false);
  });

  it.each(GHOSTS)("the sender no longer reads %s", (ghost) => {
    expect(
      CODE,
      `routes-campaigns.ts reads campaign.${ghost}, which is undefined on every row — ` +
        "the send will fall through to whatever default follows it",
    ).not.toContain(ghost);
  });
});

describe("an empty body refuses instead of sending the campaign's name", () => {
  it("no send path substitutes campaign.name for the message body", () => {
    // The precise shape of the defect: `|| campaign.name` in a body expression.
    // Asserted at the whole-file level because it appeared in three of them.
    // Scoped to BODY expressions. `campaign.name` as an email SUBJECT is
    // legitimate — a campaign's title is a reasonable subject line, and the
    // subject path refuses when both are empty. As the message BODY it is the
    // defect. An unscoped assertion conflated the two and failed on the correct
    // subject line.
    const BODY_VARS = ["htmlTemplate", "messageBody", "html", "text", "testBody"];
    const offenders = BODY_VARS.filter((v) => {
      const m = new RegExp(`const ${v}\\s*=\\s*([^;]*);`, "s").exec(CODE);
      return m ? /campaign\.name/.test(m[1]) : false;
    });
    expect(
      offenders,
      "a send path falls back to the campaign's internal name as the message body — " +
        "that is what shipped to real recipients",
    ).toEqual([]);
  });

  it("each of the three send paths refuses on empty content", () => {
    // One refusal per path: bulk email, SMS, test send. Counting them is what
    // catches a future author fixing two and leaving the third, which is the
    // failure mode CLAUDE.md names for exactly this file shape.
    const refusals = [...CODE.matchAll(/has no content/g)];
    expect(
      refusals.length,
      `expected a refusal in each of the three send paths, found ${refusals.length}`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("the direct-mail path still reads content, as it always did", () => {
    // The control. It was correct before this change and must stay correct —
    // and its correctness is the evidence that `content` is the right column.
    expect(CODE).toMatch(/front:\s*campaign\.content/);
  });
});
