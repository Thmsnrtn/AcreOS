/**
 * One credential redactor. There were SIX, and they disagreed.
 *
 * Unit 120. Six modules each carried a private `CREDENTIAL_PATTERNS` list for
 * scrubbing credential-shaped substrings before persistence or egress:
 * `krieger/mobileFeelAudit`, `solene/constitutionalGuard`, `solene/speculations`,
 * `solene/confidenceParser`, `pax/continuousAudit`, `embeddings/voyageClient`.
 * (The audit that found them counted four; the consolidation itself found two
 * more — a duplicate hunt that trusts its inventory is a duplicate hunt that
 * stops early.)
 *
 * Krieger's comment claimed the "same prefix set as the wave's other Phase-C
 * agents"; continuousAudit's claimed "an independent copy of the prefix list
 * specified in the phase-C contract." Both false, bidirectionally:
 *
 *   Slack token `xoxb-…`  → redacted by constitutionalGuard, PERSISTED VERBATIM
 *                            by the other five
 *   session JWT `eyJ….…`  → redacted by constitutionalGuard only
 *   GitHub OAuth `gho_…`  → redacted by krieger/speculations/continuousAudit,
 *                            persisted by constitutionalGuard/confidenceParser/voyage
 *
 * WHICH SECRETS SURVIVED INTO AN AUDIT ROW DEPENDED ON WHICH AGENT WROTE IT.
 * `server/utils/redactCredentials.ts` now owns the union; the six call sites
 * delegate (voyageClient keeps its distinct `[redacted-credential]` marker via
 * the marker parameter). This file pins the union, the delegation, and that no
 * seventh copy appears.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { redactCredentials, detectCredentialPatterns } from "../../server/utils/redactCredentials";
import { sanitizeEvidence as kriegerSanitize } from "../../server/services/krieger/mobileFeelAudit";
import { sanitizeEvidence as soleneSanitize } from "../../server/services/solene/constitutionalGuard";
import { sanitizeCredentials as paxSanitize } from "../../server/services/pax/continuousAudit";
import { sanitizeForVoyage } from "../../server/services/embeddings/voyageClient";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

/** Every shape ANY of the six lists caught — the union is the contract now. */
const SECRETS: Array<[string, string]> = [
  ["stripe-secret", "payment failed for sk_live_a1B2c3D4e5F6g7H8"], // secret-scan:allow
  ["stripe-pub", "client key pk_test_a1B2c3D4e5F6g7H8"], // secret-scan:allow
  ["posthog-project", "posthog key phc_a1B2c3D4e5F6g7H8"], // secret-scan:allow
  ["posthog-personal", "personal key phx_a1B2c3D4e5F6g7H8"], // secret-scan:allow
  ["github-pat", "pushed with ghp_a1B2c3D4e5F6g7H8i9J0"], // secret-scan:allow
  ["github-oauth", "oauth gho_16C7e42F292c6912E7710c838347Ae178B4a"], // secret-scan:allow
  ["bearer", "header Bearer abcDEF123456.token-value"],
  ["aws-long", "creds AKIA0123456789ABCDEF"], // secret-scan:allow
  ["aws-sts", "creds ASIA0123456789ABCDEF"], // secret-scan:allow
  ["slack-bot", "webhook failed for xoxb-2841729384-JkLmNoPqRsTu"], // secret-scan:allow
  ["jwt", "cookie jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.h8Kq2Zx1vTmA"], // secret-scan:allow
];

describe("the owner redacts the whole union", () => {
  it.each(SECRETS)("%s", (_name, input) => {
    const out = redactCredentials(input);
    expect(out).toContain("[REDACTED]");
    // The secret token itself must be gone (check its distinctive tail).
    const tail = input.split(/\s+/).pop()!;
    expect(out).not.toContain(tail);
  });

  it("leaves ordinary text alone", () => {
    for (const s of [
      "Parcel 14 — 40 acres, tillable. Skip trace complete.",
      "The buyer asked about pk parking spaces", // pk_ shapes need the underscore+body
      "Note terms: 8.5% interest, 360-month amortization.",
    ]) {
      expect(redactCredentials(s)).toBe(s);
    }
  });

  it("detectCredentialPatterns names what it found", () => {
    expect(detectCredentialPatterns("xoxb-2841729384-JkLmNoPqRsTu here")).toContain("slack-token"); // secret-scan:allow
    expect(detectCredentialPatterns("clean text")).toEqual([]);
  });
});

describe("all delegates agree with the owner (the divergence is dead)", () => {
  // The three inputs the audit proved DIVERGED across copies. Every surviving
  // sanitizer must now catch all three.
  const DIVERGENT: string[] = [
    "slack webhook failed for xoxb-2841729384-JkLmNoPqRsTu", // secret-scan:allow
    "session cookie jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.h8Kq2Zx1vTmA", // secret-scan:allow
    "github oauth gho_16C7e42F292c6912E7710c838347Ae178B4a", // secret-scan:allow
  ];

  const sanitizers: Array<[string, (s: string) => string]> = [
    ["krieger.sanitizeEvidence", kriegerSanitize],
    ["solene.sanitizeEvidence", soleneSanitize],
    ["pax.sanitizeCredentials", paxSanitize],
    ["voyage.sanitizeForVoyage", sanitizeForVoyage],
  ];

  for (const [name, fn] of sanitizers) {
    it(`${name} catches all three formerly-divergent shapes`, () => {
      for (const input of DIVERGENT) {
        const out = fn(input);
        expect(
          out,
          `${name} passed a secret the owner catches — it has grown its own list again`,
        ).not.toBe(input);
        expect(out).toMatch(/\[REDACTED\]|\[redacted-credential\]/);
      }
    });
  }

  it("voyage keeps its distinct marker (its consumers pin it)", () => {
    expect(sanitizeForVoyage("key sk_live_a1B2c3D4e5F6g7H8")).toContain("[redacted-credential]"); // secret-scan:allow
  });
});

describe("there is exactly one pattern list", () => {
  it("no module outside the owner declares CREDENTIAL_PATTERNS", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir)) {
        if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
        const full = path.join(dir, e);
        if (fs.statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e) || /\.(test|spec)\.tsx?$/.test(e)) continue;
        const rel = path.relative(ROOT, full);
        if (rel === "server/utils/redactCredentials.ts") continue;
        const src = stripComments(fs
          .readFileSync(full, "utf8"));
        if (/const\s+CREDENTIAL_PATTERNS/.test(src)) offenders.push(rel);
      }
    };
    for (const tree of ["server", "shared"]) walk(path.join(ROOT, tree));
    expect(
      offenders,
      "a seventh credential-pattern list appeared. server/utils/redactCredentials.ts " +
        "is the owner — add the pattern THERE and add the secret shape to the union " +
        "corpus in this file. Six independent lists is how a Slack token ended up " +
        "verbatim in five kinds of audit row.",
    ).toEqual([]);
  });

  it("the detector would notice one (vacuity guard)", () => {
    expect(/const\s+CREDENTIAL_PATTERNS/.test("const CREDENTIAL_PATTERNS: RegExp[] = [")).toBe(true);
  });
});
