/**
 * A price Pax quotes, or an amount an approval card shows, is the amount the
 * send actually charges.
 *
 * TWO QUOTES, TWO CHARGE SITES, ONE SOURCE (server/services/sendPricing.ts):
 *
 *   quote_outbound_cost (campaign prices)  ←→  routes-campaigns send handlers
 *     The handlers' per-recipient literals (`costPerSms = 3`, `costPerMms = 5`,
 *     `costPerEmail = 1`) and the `/api/pricing/rates` copies now read
 *     CAMPAIGN_SEND_PRICE_CREDITS; direct mail reads DIRECT_MAIL_COSTS. Pinned
 *     on the comment-stripped source: each charge site must assign from the
 *     constant, and no numeric literal may come back.
 *
 *   ask card / artifact cost (Pax's own sends)  ←→  send_sms / send_email bodies
 *     PAX_DIRECT_SEND_PRICE_CREDITS is 0 because those executors debit nothing.
 *     If a debit is ever added to one of them, this file fails until the
 *     constant (and so the card) says what it now charges.
 *
 * Mutations recorded (reverted after each red run):
 *   - routes-campaigns `costPerSms = CAMPAIGN_SEND_PRICE_CREDITS.sms` → `= 3`: red.
 *   - add `await creditService.deductCredits(org.id, 3, "sms")` to the
 *     send_sms case in tools.ts: red ("Pax's own sends debit nothing").
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";
import {
  CAMPAIGN_SEND_PRICE_CREDITS,
  DIRECT_MAIL_COSTS,
  paxSendCost,
  quoteOutboundSend,
} from "../../server/services/sendPricing";
import { summarizeAsk } from "../../server/services/paxAskSummary";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) => stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8")) as string;

function caseBody(src: string, name: string): string {
  const m = new RegExp(`\\n {6}case "${name}": \\{\\n`).exec(src);
  if (!m) return "";
  let depth = 1;
  let i = m.index + m[0].length;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") depth -= 1;
    i += 1;
  }
  return src.slice(m.index + m[0].length, i);
}

const DEBIT = /\b(?:deductCredits|poolDebit|recordUsage|deductOrFundFromTrial|chargeCredits)\s*\(/;

describe("campaign charge sites read the one price table", () => {
  const src = code("server/routes-campaigns.ts");

  it.each([
    ["costPerSms", "sms"],
    ["costPerMms", "mms"],
    ["costPerEmail", "email"],
  ] as const)("%s is assigned from CAMPAIGN_SEND_PRICE_CREDITS.%s", (local, key) => {
    expect(src).toMatch(new RegExp(`const ${local} = CAMPAIGN_SEND_PRICE_CREDITS\\.${key};`));
    expect(src, `${local} is a literal again`).not.toMatch(new RegExp(`const ${local} = \\d`));
  });

  it("the public rates endpoint quotes the same constants", () => {
    expect(src).toMatch(/email_sent: \{ name: "Email", costCents: CAMPAIGN_SEND_PRICE_CREDITS\.email/);
    expect(src).toMatch(/sms_sent: \{ name: "SMS Text", costCents: CAMPAIGN_SEND_PRICE_CREDITS\.sms/);
  });

  it("the direct-mail send debits DIRECT_MAIL_COSTS[pieceType] × pieces", () => {
    expect(src).toMatch(/const costPerPiece = DIRECT_MAIL_COSTS\[pieceType\];/);
  });

  it("a quote is that price times the count", () => {
    const rails = { ownMailAccount: false, ownEmailAccount: false, emailCanSend: true, smsConnected: false };
    expect(quoteOutboundSend({ channel: "postcard", recipients: 500, pieceType: "postcard_6x9", rails }).totalCredits).toBe(
      500 * DIRECT_MAIL_COSTS.postcard_6x9,
    );
    expect(quoteOutboundSend({ channel: "email", recipients: 40, rails }).totalCredits).toBe(40 * CAMPAIGN_SEND_PRICE_CREDITS.email);
  });
});

describe("Pax's own sends: the card's amount is the executor's charge", () => {
  const tools = code("server/ai/tools.ts");

  it.each(["send_sms", "send_email"])("%s debits nothing, so the card's 0 credits is true", (name) => {
    const body = caseBody(tools, name);
    expect(body.length, `${name} case not found — re-pin`).toBeGreaterThan(200);
    expect(body, `${name} now debits credits: set PAX_DIRECT_SEND_PRICE_CREDITS to the real charge`).not.toMatch(DEBIT);
    expect(paxSendCost(name, { lead_id: 1 })?.credits).toBe(0);
  });

  it("the predicate sees a debit (falsified on a mutated body)", () => {
    const mutated = caseBody(tools, "send_sms") + "\nawait creditService.deductCredits(org.id, 3, 'sms');";
    expect(mutated).toMatch(DEBIT);
  });

  it("the ask card and the artifact render the same cost", () => {
    const args = { lead_id: 12, message: "Hi" };
    const summary = summarizeAsk({ id: 1, toolName: "send_sms", args, status: "pending", expiresAt: null });
    expect(summary.cost).toEqual(paxSendCost("send_sms", args));
    expect(summary.cost).toMatchObject({ recipients: 1, credits: 0, dollars: "$0.00" });
    expect(summarizeAsk({ id: 2, toolName: "update_lead_status", args: { lead_id: 1, status: "dead" }, status: "pending", expiresAt: null }).cost).toBeNull();
  });
});
