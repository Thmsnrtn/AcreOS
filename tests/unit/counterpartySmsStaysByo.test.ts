/**
 * Founder decision 2026-10-17 carved PHYSICAL mail out of the BYO send-rail
 * rule — and nothing else. Counterparty SMS stays strictly BYO: every
 * counterparty text goes through `sendOrgSMS`, which must ask the comms
 * router for the org's OWN identity (`requireByoIdentity: true`), and the
 * Twilio provider must then resolve BYO credentials only — never the platform
 * account. (Counterparty email is held by counterpartyIdentityPreflight.test.ts
 * and emailPurposeEnforcement.test.ts.)
 *
 * Comments are stripped before every predicate, so a comment that names the
 * flag cannot stand in for it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

function bodyOf(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  // The next top-level declaration ends the unit.
  const rest = src.slice(start + signature.length);
  const end = rest.search(/\n(?:export\s+)?(?:async\s+)?function\s|\nexport\s+const\s/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("counterparty SMS requires the org's own identity", () => {
  it("sendOrgSMS asks the router for BYO only, on its one send call", () => {
    const body = bodyOf(read("server/services/smsService.ts"), "export async function sendOrgSMS(");
    const calls = body.split("commsRouter.route(").slice(1);
    expect(calls.length, "sendOrgSMS no longer sends through commsRouter.route — the detector went blind").toBe(1);
    const args = calls[0].slice(0, calls[0].indexOf("});"));
    expect(args).toMatch(/\brequireByoIdentity\s*:\s*true\b/);
  });

  it("the Twilio provider's BYO branch never resolves the platform credentials", () => {
    const src = read("server/services/comms/providers/twilio.ts");
    const at = src.indexOf("const creds = opts.requireByoIdentity");
    expect(at).toBeGreaterThan(-1);
    const ternary = src.slice(at, src.indexOf(";", at));
    // The platform branch is the ternary's LAST arm; everything before it is BYO.
    const split = ternary.lastIndexOf(": await resolveCredentials(opts.organizationId)");
    expect(split, "the platform branch moved — re-read the provider").toBeGreaterThan(-1);
    const byoBranch = ternary.slice(0, split);
    expect(byoBranch).toMatch(/getOrgTwilioCredentials\(/);
    expect(byoBranch).not.toMatch(/resolveCredentials\(|TWILIO_ACCOUNT_SID|process\.env/);
  });

  it("the physical-mail lane module decides no SMS or email send", () => {
    const lane = read("server/services/mail/mailLane.ts");
    expect(lane).toMatch(/export async function resolveMailLane\(/); // vacuity
    expect(lane).not.toMatch(/smsService|commsRouter|emailService|sendOrgSMS|sendEmail\(/);
  });
});
