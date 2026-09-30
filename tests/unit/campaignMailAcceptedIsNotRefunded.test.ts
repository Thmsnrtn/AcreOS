/**
 * Quality directive 2026-09-29 — a campaign letter the provider ACCEPTED is
 * never refunded because OUR record of it failed to save.
 *
 * `POST /api/campaigns/:id/send-direct-mail` pushed the piece as sent, then a
 * failing mailing-order write fell into the same catch, which pushed it again
 * as failed: counted sent AND failed, and the failed count refunded a letter
 * already in the post. Source-level pin (the route has no harness): the
 * accepted flag is set after the provider call and checked FIRST in the
 * catch, before any failure is recorded.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-campaigns.ts"), "utf8"));
const start = src.indexOf('"/api/campaigns/:id/send-direct-mail"');
const body = src.slice(start, src.indexOf("const successCount = sendResults.filter", start));

describe("campaign direct mail: accepted means sent", () => {
  it("reads the route body (vacuity)", () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toMatch(/sendLetter\(/);
  });

  it("the accepted flag is set right after the provider accepts the piece", () => {
    const push = body.indexOf("sendResults.push({ leadId: lead.id, success: true, lobId: result.id");
    const flag = body.indexOf("providerAccepted = true", push);
    expect(push).toBeGreaterThan(0);
    expect(flag).toBeGreaterThan(push);
    expect(body.indexOf("createMailingOrderPiece(", push)).toBeGreaterThan(flag); // before any local write
  });

  it("the catch checks it before recording a failure", () => {
    const catchAt = body.indexOf("} catch (err: any) {", body.indexOf("providerAccepted = true"));
    const check = body.indexOf("if (providerAccepted)", catchAt);
    const failPush = body.indexOf("success: false", catchAt);
    expect(check).toBeGreaterThan(catchAt);
    expect(failPush).toBeGreaterThan(check);
  });
});

describe("campaign direct mail: one send per operation", () => {
  it("the send hook holds one key across retries of the same send and settles it", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../client/src/hooks/use-campaigns.ts"), "utf8"));
    const start = src.indexOf("export function useSendDirectMail(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\nexport ", start + 10));
    expect(body).toMatch(/useOperationKey\(\)/);
    expect(body).toMatch(/keyFor\(\{\s*campaignId: data\.campaignId,\s*\.\.\.body\s*\}\)/);
    expect(body).toMatch(/operationKey\.settle\(\)/);
    expect(body).not.toMatch(/idempotent:\s*true/);
  });
});
