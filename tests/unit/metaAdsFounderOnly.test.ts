/**
 * Paid advertising is a founder instrument. There is no customer path in.
 *
 * BLOCKERS B11 asked the question and the founder answered it on 2026-08-13:
 *
 *   > this was meant for me as the founder to run ads for this AcreOS only.
 *   > Never for a customer to be able to run their own ads. That's how it
 *   > should work properly.
 *
 * So the founder gate unit 50 added as an INTERIM measure is the permanent
 * answer, and this file is what makes it permanent.
 *
 * THE MIRROR IMAGE OF THE ACTUM CASE, NOT AN EXCEPTION TO IT
 * ---------------------------------------------------------
 * `metaAdsService` posts to graph.facebook.com against a single
 * `META_AD_ACCOUNT_ID` with `META_ACCESS_TOKEN` — one platform ad account, no
 * per-org account anywhere. That is structurally the same shape the 2026-07-29
 * ruling deleted for payments: one platform `ACTUM_MERCHANT_ID` for all orgs,
 * so borrower money would have moved on AcreOS's own merchant account.
 *
 * The shape is the same and the verdict is opposite, because the question the
 * ruling asks is *whose money is it*. Customer money on the platform's account
 * is banned. AcreOS's own money on AcreOS's own account, buying AcreOS's own
 * advertising, is AcreOS being its own customer — there is no customer to
 * protect and no funds transiting anything.
 *
 * **The only thing keeping those two apart is that no customer path exists.**
 * Which is why that is what this file asserts, rather than asserting something
 * about ad accounts: the day a customer can reach these routes, the ads rail
 * stops being AcreOS advertising itself and becomes AcreOS fronting its ad
 * account for customers — the same re-fronting the BYO email-sender ruling
 * forbids, and with no cost recovery at all.
 *
 * WHAT THE READS WERE DOING, UNGATED. `GET …/campaigns/:id/stats` carried
 * `[isAuthenticated, getOrCreateOrg]` and nothing else until this ruling. It
 * returns spend, impressions, clicks and cost-per-lead for ANY campaign id on
 * the platform ad account, so any authenticated member of any org could read
 * AcreOS's own marketing performance by iterating ids. Gating the spend and
 * leaving the reads open is the half-applied rule B11 was written about, one
 * layer down.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { signatureMatches } from "../../server/middleware/metaWebhookSignature";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const routes = read("server/routes-elite-features.ts");

/** Every `app.<verb>("<path>", …)` line whose path mentions meta ads. */
function adRouteLines(): string[] {
  return routes
    .split("\n")
    .filter((l) => /^\s*app\.(get|post|put|patch|delete)\(/.test(l) && /meta-ads/.test(l));
}

describe("every meta-ads route is founder-only", () => {
  const lines = adRouteLines();

  it("finds the routes at all (vacuity guard)", () => {
    // Three: create campaign, read stats, sync catalog. A rename that this file
    // could not see would make every assertion below vacuous.
    expect(lines.length, "no meta-ads routes found in routes-elite-features.ts").toBe(3);
  });

  it("each one carries requireFounder", () => {
    for (const line of lines) {
      expect(
        line,
        `${line.trim().slice(0, 90)}… is reachable without requireFounder. Paid ` +
          `advertising is a founder instrument (founder ruling 2026-08-13): it ` +
          `spends AcreOS's own money on AcreOS's own ad account, which is only ` +
          `acceptable BECAUSE no customer can reach it.`,
      ).toContain("requireFounder");
    }
  });

  it("each one lives in the /api/founder/* namespace", () => {
    // The gate is the enforcement; the namespace is what makes the rule legible
    // to someone reading routes rather than middleware. A `/api/meta-ads/*` path
    // reads as a customer feature that happens to be gated today.
    for (const line of lines) {
      expect(
        line,
        `${line.trim().slice(0, 90)}… is back outside /api/founder/*`,
      ).toMatch(/"\/api\/founder\/meta-ads\//);
    }
  });

  it("no client bundle calls them", () => {
    // The strongest form of "no customer path": not gated, absent. If a customer
    // surface ever appears, it will show up here before anyone has to reason
    // about which middleware it inherited.
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && /meta-ads/.test(fs.readFileSync(full, "utf8"))) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, "client/src"));
    expect(
      hits.join(", "),
      "a client surface calls the meta-ads routes. Even behind requireFounder " +
        "in the customer bundle, that is the customer-feature shape the founder " +
        "ruled out — a founder instrument belongs on the founder plane.",
    ).toBe("");
  });
});

// The CEILING, the simulation guard and the platform-account premise are
// asserted in adSpendAuthority.test.ts, which owns the spend itself. Repeating
// them here would give two files that must be edited together and one that
// would quietly be forgotten.

describe("the public lead webhook fails closed", () => {
  const SECRET = "test-app-secret";
  const body = Buffer.from(JSON.stringify({ entry: [{ changes: [] }] }));
  const valid =
    "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");

  it("accepts a correctly signed body (vacuity guard)", () => {
    expect(signatureMatches(valid, body, SECRET)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const forged =
      "sha256=" + crypto.createHmac("sha256", "wrong").update(body).digest("hex");
    expect(signatureMatches(forged, body, SECRET)).toBe(false);
  });

  it("rejects a body that was altered after signing", () => {
    const altered = Buffer.from(JSON.stringify({ entry: [{ changes: ["injected"] }] }));
    expect(signatureMatches(valid, altered, SECRET)).toBe(false);
  });

  it("rejects a malformed or truncated signature instead of throwing", () => {
    // `timingSafeEqual` throws on differing buffer lengths. A verifier that
    // throws inside the handler answers 500, and a 500 is not a rejection —
    // some retry policies treat it as "try again", and none of them treat it as
    // "this was forged".
    for (const bad of ["", "sha256=", "sha256=deadbeef", "nothex", valid.slice(0, -4)]) {
      expect(() => signatureMatches(bad, body, SECRET)).not.toThrow();
      expect(signatureMatches(bad, body, SECRET), `accepted: ${bad}`).toBe(false);
    }
  });

  it("the webhook route is wired to the verifier, not to an inline check", () => {
    const at = routes.indexOf('app.post("/api/webhooks/meta-lead-ads"');
    expect(at, "the lead-ads webhook is gone").toBeGreaterThan(-1);
    const line = routes.slice(at, routes.indexOf("\n", at));
    expect(
      line,
      "the lead-ads webhook lost its signature middleware. It CREATES LEADS on " +
        "an unauthenticated request — the previous inline check was skipped " +
        "entirely when META_APP_SECRET was unset AND when the caller simply " +
        "omitted the header.",
    ).toContain("verifyMetaWebhookSignature");
  });

  it("the verifier refuses when no secret is configured", () => {
    // Fail-closed, matching twilioSignature.ts and inboundEmailSignature.ts. A
    // verifier that waves requests through on a missing secret is worse than no
    // verifier, because the code reads as though it is protected.
    const mw = read("server/middleware/metaWebhookSignature.ts");
    const at = mw.indexOf("export function verifyMetaWebhookSignature");
    const body = mw.slice(at);
    expect(body).toContain("if (!secret)");
    const missingSecret = body.slice(body.indexOf("if (!secret)"), body.indexOf("const header"));
    expect(
      missingSecret,
      "the missing-secret branch calls next() — that is fail-OPEN",
    ).not.toContain("next()");
    expect(
      missingSecret,
      "the missing-secret branch no longer refuses",
    ).toContain("Errors.unauthorized(res)");
  });

  it("it hashes the raw body, not a re-serialisation of the parsed one", () => {
    // JSON.stringify(req.body) is not guaranteed to reproduce the bytes Meta
    // signed, so hashing it can reject a VALID delivery as well as accept an
    // altered one.
    // Asserted against CODE only. This file's own header quotes the defective
    // line, and the middleware's header explains it — a comment describing a
    // defect must not trip the check for that defect. It is the fifth time this
    // program has hit that, which is why it is now a habit rather than a
    // surprise.
    const mw = read("server/middleware/metaWebhookSignature.ts")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(mw).toContain("rawBody");
    expect(mw, "the verifier re-serialises the parsed body").not.toContain(
      "JSON.stringify(req.body)",
    );
  });
});
