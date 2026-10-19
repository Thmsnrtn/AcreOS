/**
 * POPULATION: every physical-mail send in server/ resolves its lane
 * (founder decision 2026-10-17, server/services/mail/mailLane.ts).
 *
 * houseMailLane.test.ts proves the lane rule through the send chokepoints it
 * knows about. This file proves there are no OTHER chokepoints: it walks every
 * .ts file under server/ (comments stripped), finds every primitive that can
 * put a postcard or letter in the mail, and requires that
 *
 *   1. the file is in SEND_SITES — a new send path fails here until it is
 *      listed AND resolves a lane;
 *   2. every listed file still contains a primitive (per-member vacuity: a
 *      regex that silently stops matching reads exactly like a clean file);
 *   3. every listed file resolves the lane (`resolveMailLane` /
 *      `assertSendableLane`) and never reaches the platform Lob key except
 *      through `getLobClientForLane` or its own documented system path;
 *   4. Lob clients are constructed only in the known modules, the platform
 *      key resolver is called only from the known places, and only the two
 *      callers that charge a piece themselves may claim it is prepaid;
 *   5. every send site pays for a house piece ONLY through the purchased-only
 *      debit (chargeHouseMail / chargeHouseMailPiece) and refunds ONLY
 *      through refundUnbilledHouseMail — no pool draw, no generic balance
 *      debit or credit grant (founder decision 2026-10-17 B).
 *
 * Address verification (`usVerifications.verify`) is held to the same list.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "tests" || ent.name === "__tests__") continue;
      walk(p, out);
    } else if (/\.ts$/.test(ent.name) && !/\.(test|spec)\.ts$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(path.join(ROOT, "server")).map((abs) => ({
  rel: path.relative(ROOT, abs).split(path.sep).join("/"),
  src: stripComments(fs.readFileSync(abs, "utf8")),
}));

/** Primitives that print or post a piece (Lob SDK, PostGrid print-mail API, raw Lob send endpoints). */
const SEND_PRIMITIVE = /\.\s*(?:postcards|letters)\s*(?:as\s+any\s*\))?\s*\.\s*create\s*\(|api\.postgrid\.com\/print-mail|api\.lob\.com\/v1\/(?:postcards|letters)/;
/** Address verification on a Lob account. */
const VERIFY_PRIMITIVE = /\.\s*usVerifications\s*\.\s*verify\s*\(/;
const LANE_CALL = /\b(?:resolveMailLane|assertSendableLane)\s*\(/;

/**
 * Every file that may print or post a piece. Each resolves the lane in-file.
 * Adding a send path means adding it here — and the lane check below then
 * runs over it.
 */
const SEND_SITES: Record<string, string> = {
  "server/services/directMailService.ts": "router-sent pieces (outreach queue, sequences) — prepareLobSend",
  "server/services/directMail.ts": "campaign sends + API queue — prepareLane",
  "server/services/lobService.ts": "communications counterparty letters — resolveClient",
  "server/services/mailProvider.ts": "autopilot send_letter — planLobSend",
  "server/services/mail/providers/postgrid.ts": "PostGrid adapter — own key only",
};

/** Files that verify addresses on a Lob account. */
const VERIFY_SITES = new Set(["server/services/directMailService.ts"]);

/**
 * Where `verifyAddress(…)` is called, and with which purpose (founder decision
 * 2026-10-18): only the sender-identity check is free on AcreOS's account;
 * every other caller checks LEAD addresses under an address-check lane.
 */
const VERIFY_CALLERS: Record<string, "sender_identity" | "lead_address"> = {
  "server/routes-communications.ts": "sender_identity",
  "server/routes-campaigns.ts": "lead_address",
};

/** Where a Lob SDK client may be constructed. */
const LOB_CONSTRUCTORS = new Set([
  "server/services/directMailService.ts", // the credential authority (own key / house lane)
  "server/services/directMail.ts", // env clients for the house lane + test-mode
  "server/services/lobService.ts", // env clients for org-less system mail + test-mode
  "server/services/mailProvider.ts", // org-less AcreOS system mail
]);

/** Where the PLATFORM Lob key resolver may be called. */
const PLATFORM_KEY_CALLERS = new Set([
  "server/services/mail/liveSendInterlock.ts", // its definition
  "server/services/directMailService.ts", // getLobClientForLane (house) + house-lane verification
  "server/services/mailProvider.ts", // org-less system mail only
  "server/services/mail/mailLane.ts", // houseMailConfigured probe
]);

/** The only callers that charge a piece themselves and may say so. */
const PREPAID_CLAIMANTS = new Set([
  "server/services/mail/mailFlusher.ts", // outreach queue pre-paid every house piece at queue time
  "server/routes-campaigns.ts", // campaign route pre-pays its mailing order
]);

/**
 * A prepaid CLAIM: `housePrepaid: <value>` whose value is not just forwarding
 * another housePrepaid (a type annotation `housePrepaid?: boolean` /
 * `housePrepaid: boolean` never matches).
 */
const PREPAID_CLAIM = /\bhousePrepaid\s*:(?!\s*boolean\b)(?![^,\n})]*\bhousePrepaid\b)/;

/** Every way server code can take or return credits / pool. */
const GENERIC_DEBIT = /\b(?:poolDebit|deductCredits|deductOrFundFromTrial|recordUsage)\s*\(/;
const GENERIC_REFUND = /\b(?:refundPoolDebit|addCredits)\s*\(/;
const HOUSE_CHARGE = /\bchargeHouseMail(?:Piece)?\s*\(/;
const HOUSE_REFUND = /\brefundUnbilledHouseMail\s*\(/;

const hits = (re: RegExp) => FILES.filter((f) => re.test(f.src)).map((f) => f.rel).sort();

describe("the detector reads what it claims to (canaries)", () => {
  it("matches each send shape and ignores one inside a comment", () => {
    const shapes = [
      "await client.postcards.create({})",
      "await lob.letters.create({})",
      "await (lob.letters as any).create({})",
      'fetch("https://api.postgrid.com/print-mail/v1/letters")',
      'fetch("https://api.lob.com/v1/letters", { method: "POST" })',
    ];
    for (const s of shapes) expect(SEND_PRIMITIVE.test(stripComments(s)), s).toBe(true);
    expect(SEND_PRIMITIVE.test(stripComments("// await lob.letters.create({})"))).toBe(false);
    expect(VERIFY_PRIMITIVE.test("await client.usVerifications.verify({})")).toBe(true);
    expect(LANE_CALL.test(stripComments("// resolveMailLane(orgId)"))).toBe(false);
  });

  it("the walk read server/ at all (population floor)", () => {
    expect(FILES.length).toBeGreaterThan(500);
  });
});

describe("every physical-mail send site resolves a lane", () => {
  it("no file sends mail outside SEND_SITES", () => {
    const unlisted = hits(SEND_PRIMITIVE).filter((f) => !(f in SEND_SITES));
    expect(
      unlisted,
      "A new physical-mail send path. List it in SEND_SITES and make it resolve the lane " +
        "(mail/mailLane.ts) before it contacts a provider — own key or house mail with a verified identity.",
    ).toEqual([]);
  });

  it("every listed site still sends (per-member vacuity)", () => {
    const found = new Set(hits(SEND_PRIMITIVE));
    const stale = Object.keys(SEND_SITES).filter((f) => !found.has(f));
    expect(stale, "listed send site no longer matches a send primitive — renamed, or the detector went blind").toEqual([]);
  });

  it("every listed site calls the lane resolver", () => {
    const byRel = new Map(FILES.map((f) => [f.rel, f.src]));
    const missing = Object.keys(SEND_SITES).filter((f) => !LANE_CALL.test(byRel.get(f) ?? ""));
    expect(missing).toEqual([]);
  });

  it("address verification runs only in the known sites", () => {
    expect(hits(VERIFY_PRIMITIVE)).toEqual([...VERIFY_SITES].sort());
  });

  it("directMailService.verifyAddress takes the org and a purpose, and reads its own key first", () => {
    const src = FILES.find((f) => f.rel === "server/services/directMailService.ts")!.src;
    const body = src.slice(src.indexOf("export async function verifyAddress"));
    expect(body).toMatch(/^export async function verifyAddress\(address: RecipientAddress, organizationId: number, use: AddressCheckUse\)/);
    expect(body.indexOf("getOwnLobClient(organizationId)")).toBeGreaterThan(-1);
    expect(body.indexOf("getOwnLobClient(organizationId)")).toBeLessThan(body.indexOf("usVerifications"));
    // A lead-address check without a house lane is refused before the platform client.
    expect(body.indexOf("use.lane.lane !== 'house'")).toBeGreaterThan(-1);
    expect(body.indexOf("use.lane.lane !== 'house'")).toBeLessThan(body.indexOf("getPlatformLobClient()"));
  });

  it("every verifyAddress caller names its purpose; only the sender-identity check is free", () => {
    // Callers of THE Lob verifier (server/services/addressVerification.ts is a
    // different, non-Lob verifier with the same name).
    const callers = FILES.filter(
      (f) =>
        f.rel !== "server/services/directMailService.ts" &&
        /\bverifyAddress\s*\(/.test(f.src) &&
        /\bverifyAddress\b[^;]*directMailService|directMailService[^;]*\bverifyAddress\b/.test(f.src),
    );
    expect(callers.map((f) => f.rel).sort()).toEqual(Object.keys(VERIFY_CALLERS).sort());
    for (const f of callers) {
      const calls = f.src.split(/\bverifyAddress\s*\(/).slice(1);
      expect(calls.length, f.rel).toBeGreaterThan(0);
      for (const c of calls) {
        const args = c.slice(0, c.indexOf(");"));
        expect(args, `${f.rel}: a verifyAddress call without the expected purpose`).toMatch(
          new RegExp(`purpose:\\s*"${VERIFY_CALLERS[f.rel]}"`),
        );
      }
    }
  });
});

describe("the platform Lob key is reachable only where the lane allows it", () => {
  it("Lob clients are constructed only in the known modules", () => {
    expect(hits(/\bnew\s+Lob\s*\(/)).toEqual([...LOB_CONSTRUCTORS].sort());
  });

  it("the platform key resolver is called only from the known places", () => {
    expect(hits(/\bresolvePlatformLobKey\s*\(/)).toEqual([...PLATFORM_KEY_CALLERS].sort());
  });

  it("the old silent-fallback resolver is gone", () => {
    // getLobClient(orgId) returned the org's key OR the platform key with no
    // lane decision. Its replacement splits the two.
    expect(hits(/\bgetLobClient\s*\(/).filter((f) => f !== "server/services/directMail.ts")).toEqual([]);
    const dm = FILES.find((f) => f.rel === "server/services/directMail.ts")!.src;
    // directMail.ts keeps a PRIVATE env-client accessor named getLobClient(mode).
    expect(dm).toMatch(/private getLobClient\(mode: MailMode\)/);
  });

  it("getLobClientForLane hands the platform key ONLY to a house lane", () => {
    const src = FILES.find((f) => f.rel === "server/services/directMailService.ts")!.src;
    const start = src.indexOf("export async function getLobClientForLane");
    const end = src.indexOf("function getPlatformLobClient");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    const ownBranch = body.indexOf("lane.lane === 'own_account'");
    const platform = body.indexOf("resolvePlatformLobKey");
    expect(ownBranch).toBeGreaterThan(-1);
    // The own-account branch returns before the platform key is read.
    const ownReturn = body.indexOf("return own;");
    expect(ownReturn).toBeGreaterThan(ownBranch);
    expect(platform).toBeGreaterThan(ownReturn);
  });

  it("only the callers that charge a piece themselves claim it is prepaid", () => {
    expect(PREPAID_CLAIM.test("housePrepaid: true,")).toBe(true);
    expect(PREPAID_CLAIM.test("housePrepaid: (ship.debitedCents ?? 0) > 0,")).toBe(true);
    expect(PREPAID_CLAIM.test("housePrepaid: shipment.housePrepaid === true,")).toBe(false);
    expect(PREPAID_CLAIM.test("housePrepaid?: boolean;")).toBe(false);
    expect(PREPAID_CLAIM.test("housePrepaid: boolean,")).toBe(false);
    const claimants = hits(PREPAID_CLAIM);
    expect(claimants).toEqual([...PREPAID_CLAIMANTS].sort());
  });
});

describe("the routes that charge for mail resolve the lane BEFORE they charge", () => {
  const body = (rel: string, start: string, end: string) => {
    const src = FILES.find((f) => f.rel === rel)!.src;
    const a = src.indexOf(start);
    const b = src.indexOf(end, a + 1);
    expect(a, `${start} not found in ${rel}`).toBeGreaterThan(-1);
    expect(b, `${end} not found in ${rel}`).toBeGreaterThan(a);
    return src.slice(a, b);
  };

  it("POST /api/outreach/mail/queue: lane → refusal → house pre-paid from purchased credits, in the shipment transaction", () => {
    const h = body("server/routes-outreach-mail.ts", '"/api/outreach/mail/queue"', "app.post(");
    const lane = h.indexOf("resolveMailLane(");
    const refused = h.indexOf('lane.lane === "refused"');
    const house = h.indexOf('if (lane.lane === "house") houseLane = lane;');
    const charge = h.indexOf("await chargeHouseMail(");
    expect(lane).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(lane);
    expect(house).toBeGreaterThan(refused);
    expect(charge).toBeGreaterThan(house);
    // The house charge runs in the shipment's transaction, and a house lane
    // is decided BEFORE the pool branch, which a house piece never reaches.
    expect(h.slice(charge, h.indexOf("})", charge))).toMatch(/tx: tx as unknown as PrimaryDb/);
    expect(h.indexOf(": await poolDebit(")).toBeGreaterThan(h.indexOf(": houseCharge"));
  });

  it("POST /api/campaigns/:id/send-direct-mail: lane → refusal → claim → purchased-only charge; refunds only unbilled", () => {
    const h = body("server/routes-campaigns.ts", "send-direct-mail", "api.post(");
    const lane = h.indexOf("resolveMailLane(");
    const refused = h.indexOf("mailLane.lane === 'refused'");
    const claim = h.indexOf("storage.createMailingOrder(");
    const debit = h.indexOf("houseCharge = await chargeHouseMail(");
    expect(lane).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(lane);
    expect(claim).toBeGreaterThan(refused);
    expect(debit).toBeGreaterThan(claim);
    expect(h).toMatch(/usingOrgLobCredentials = mailLane\.lane === 'own_account'/);
    // No generic balance debit or credit grant anywhere in the handler.
    expect(h).not.toMatch(/\bdeductCredits\s*\(|\baddCredits\s*\(|\bgetBalance\s*\(/);
    expect(h).toMatch(HOUSE_REFUND);
  });
});

describe("house mail is paid ONLY through the purchased-only debit (decision B)", () => {
  const src = (rel: string) => FILES.find((f) => f.rel === rel)!.src;

  it("no send site takes or returns credits any other way", () => {
    for (const f of Object.keys(SEND_SITES)) {
      expect(GENERIC_DEBIT.test(src(f)), `${f} debits through a generic credit path`).toBe(false);
      expect(GENERIC_REFUND.test(src(f)), `${f} refunds through a generic credit path`).toBe(false);
    }
  });

  it("every send site that can reach the house lane charges through chargeHouseMail and refunds through refundUnbilledHouseMail (vacuity per member)", () => {
    const house = Object.keys(SEND_SITES).filter((f) => f !== "server/services/mail/providers/postgrid.ts");
    expect(house.length).toBe(4);
    for (const f of house) {
      expect(HOUSE_CHARGE.test(src(f)), `${f} never pre-pays a house piece`).toBe(true);
      expect(HOUSE_REFUND.test(src(f)), `${f} never settles a failed house piece`).toBe(true);
    }
  });

  it("the lane module itself never draws on the pool, a trial or the generic balance debit", () => {
    const lane = src("server/services/mail/mailLane.ts");
    expect(lane).toMatch(/export async function chargeHouseMail\(/); // vacuity
    expect(lane).not.toMatch(/\b(?:poolDebit|deductCredits|deductOrFundFromTrial|hasEnoughCredits|evaluateCredits)\s*\(/);
    // The one refund call it makes is behind the billing verdict.
    const refund = lane.slice(lane.indexOf("export async function refundUnbilledHouseMail("));
    expect(refund.indexOf("providerDidNotBill(failure)")).toBeGreaterThan(-1);
    expect(refund.indexOf("providerDidNotBill(failure)")).toBeLessThan(refund.indexOf("refundPoolDebit("));
  });

  it("the flusher's refunds of a pre-paid shipment withhold a piece whose billing is unknown", () => {
    const fl = src("server/services/mail/mailFlusher.ts");
    expect(fl).toMatch(/const withheldCents = providerDidNotBill\(err\) \? 0 : debitShareCents\(ship, 1\)/);
    expect(fl).toMatch(/err\.failedPieceNotBilled \? 0 : 1/);
  });
});

