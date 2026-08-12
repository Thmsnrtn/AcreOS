/**
 * The outward-action boundary — the safety property, exhaustively.
 *
 * Canonical law 8 and BI148's operational SLO: "No duplicate consequential
 * action after retry." The decision that delivers it is
 * `classifyExisting(existingClaim, incomingHash)` — execute, replay, or refuse.
 *
 * It is deliberately a PURE function, because a safety property that can only
 * be tested against a live database is a property that will not be tested, and
 * the branches that matter most are the ones hardest to produce for real: a
 * concurrent in-flight claim, a provider timeout of unknown outcome, a key
 * reused with different content. All three are one-liners here.
 *
 * The scenario the whole file exists for:
 *
 *   directMailService.sendLetter() deducts credits, posts the Lob piece cost to
 *   the ledger, then calls Lob. The process dies after Lob accepted the letter
 *   but before the result was recorded. The job retries. Without this boundary
 *   that retry deducts credits again, posts cost again, and prints a SECOND
 *   physical letter to a real seller.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ActionAmbiguousError,
  ActionInFlightError,
  ActionKeyReusedError,
  classifyExisting,
  requestHash,
} from "../../server/services/actions/outwardAction";
import type { OutwardActionStatus } from "@shared/schema/outward-actions";

const ROOT = path.resolve(__dirname, "../..");

const PAYLOAD = {
  recipientName: "Jane Seller",
  recipientAddress: { line1: "12 Oak Rd", city: "Bastrop", state: "TX", zip: "78602" },
  htmlContent: "<p>Offer enclosed</p>",
};
const HASH = requestHash(PAYLOAD);

function existing(over: Partial<{
  status: OutwardActionStatus;
  requestHash: string;
  externalId: string | null;
}> = {}) {
  return {
    actionKind: "physical_mail.letter",
    idempotencyKey: "campaign-piece-8814",
    requestHash: HASH,
    status: "succeeded" as OutwardActionStatus,
    externalId: "ltr_abc123",
    ...over,
  };
}

describe("requestHash", () => {
  it("is stable across key ordering — a reorder is not a content change", () => {
    // Otherwise a harmless object-construction difference would look like key
    // reuse and refuse a legitimate retry.
    const a = requestHash({ x: 1, y: { b: 2, a: 3 } });
    const b = requestHash({ y: { a: 3, b: 2 }, x: 1 });
    expect(a).toBe(b);
  });

  it("changes when content changes", () => {
    expect(requestHash({ ...PAYLOAD, htmlContent: "<p>Different offer</p>" })).not.toBe(HASH);
  });

  it("ignores undefined fields so an optional-arg change is not a content change", () => {
    expect(requestHash({ a: 1, b: undefined })).toBe(requestHash({ a: 1 }));
  });

  it("distinguishes null from undefined — an explicit null IS content", () => {
    expect(requestHash({ a: 1, b: null })).not.toBe(requestHash({ a: 1 }));
  });
});

describe("the retry that would double-send", () => {
  it("REPLAYS a succeeded action instead of performing it again", () => {
    const d = classifyExisting(existing({ status: "succeeded" }), HASH);
    expect(d.verdict).toBe("replay");
    if (d.verdict === "replay") {
      // The real provider id comes back, so the caller can record the send
      // rather than repeat it.
      expect(d.externalId).toBe("ltr_abc123");
    }
  });

  it("REFUSES when the prior outcome is ambiguous — never guesses with money", () => {
    // AU28: a timeout AFTER the request left is neither success nor failure.
    // Treating it as failure and retrying is exactly how a second letter gets
    // printed.
    const d = classifyExisting(existing({ status: "ambiguous", externalId: null }), HASH);
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") {
      expect(d.error).toBeInstanceOf(ActionAmbiguousError);
      expect(d.error.message).toMatch(/may already have performed/i);
    }
  });

  it("REFUSES a concurrent in-flight claim", () => {
    const d = classifyExisting(existing({ status: "in_flight" }), HASH);
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") {
      expect(d.error).toBeInstanceOf(ActionInFlightError);
    }
  });

  it("EXECUTES after a clean failure — the provider rejected it before any side effect", () => {
    // This is the one case where retrying is not just safe but required;
    // refusing everything would make the boundary useless.
    const d = classifyExisting(existing({ status: "failed" }), HASH);
    expect(d.verdict).toBe("execute");
  });
});

describe("key reuse is caught before status is even considered", () => {
  it("refuses a succeeded claim whose payload no longer matches", () => {
    // Without this, replaying a stale success would SUPPRESS a send the caller
    // genuinely wanted — a silent failure, which is worse than a loud one.
    const d = classifyExisting(existing({ status: "succeeded" }), requestHash({ different: true }));
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") {
      expect(d.error).toBeInstanceOf(ActionKeyReusedError);
    }
  });

  it("refuses a FAILED claim whose payload no longer matches, rather than executing", () => {
    // The precedence matters: a mismatched payload is a caller bug in EVERY
    // status, so it must be checked before the status switch.
    const d = classifyExisting(existing({ status: "failed" }), requestHash({ different: true }));
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") {
      expect(d.error).toBeInstanceOf(ActionKeyReusedError);
    }
  });
});

describe("the default branch fails closed", () => {
  it("refuses an unrecognised status rather than falling through to execute", () => {
    // A status this build does not know about (an older/newer deploy, a manual
    // DB edit) must not be read as permission to send.
    const d = classifyExisting(
      existing({ status: "reconciling" as unknown as OutwardActionStatus }),
      HASH,
    );
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") {
      expect(d.error.message).toMatch(/refusing rather than guessing/i);
    }
  });

  it("every declared status has an explicit verdict", () => {
    const statuses: OutwardActionStatus[] = [
      "in_flight",
      "succeeded",
      "failed",
      "ambiguous",
    ];
    const verdicts = statuses.map((s) => classifyExisting(existing({ status: s }), HASH).verdict);
    // Exactly one status may execute, exactly one may replay, the rest refuse.
    expect(verdicts.filter((v) => v === "execute")).toHaveLength(1);
    expect(verdicts.filter((v) => v === "replay")).toHaveLength(1);
    expect(verdicts.filter((v) => v === "refuse")).toHaveLength(2);
  });

  it("every verdict carries a reason a human can act on", () => {
    const statuses: OutwardActionStatus[] = ["in_flight", "succeeded", "failed", "ambiguous"];
    for (const s of statuses) {
      expect(classifyExisting(existing({ status: s }), HASH).reason.length).toBeGreaterThan(20);
    }
  });
});

describe("the boundary is wired into the money path", () => {
  const dms = fs.readFileSync(
    path.join(ROOT, "server/services/directMailService.ts"),
    "utf8",
  );

  it("directMailService.sendLetter routes through withOutwardAction", () => {
    // This repo's most common defect is a service with zero call sites. The
    // primitive is worthless unwired, and physical mail is the path where a
    // duplicate costs real money and a real counterparty relationship.
    expect(dms).toContain("withOutwardAction");
    expect(dms).toContain('actionKind: "physical_mail.letter"');
  });

  it("the whole consequential body is inside the boundary, not just the Lob call", () => {
    // Credit deduction and the ledger posting must be protected too — a retry
    // that skipped only the Lob call would still double-charge the customer.
    const wrapper = dms.slice(
      dms.indexOf("export async function sendLetter"),
      dms.indexOf("async function performLetterSend"),
    );
    expect(wrapper).toContain("performLetterSend(options)");
  });

  it("replay throws rather than fabricating a SendResult", () => {
    // We do not know the original expected-delivery date at replay time, and
    // inventing one is exactly what check-no-fabrication.mjs exists to prevent.
    expect(dms).toContain("LetterAlreadySentError");
    const replay = dms.slice(dms.indexOf("(externalId) =>"), dms.indexOf("(externalId) =>") + 200);
    expect(replay).toContain("throw new LetterAlreadySentError");
  });

  it("the unique index that makes the claim atomic exists in schema AND migration", () => {
    const schema = fs.readFileSync(
      path.join(ROOT, "shared/schema/outward-actions.ts"),
      "utf8",
    );
    expect(schema).toContain("uniqueIndex");
    expect(schema).toContain("outward_actions_org_kind_key_uk");

    // Without the DDL the ON CONFLICT clause silently never conflicts, and the
    // whole mechanism becomes a no-op that looks like it is working.
    const migrate = fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");
    expect(migrate).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "outward_actions_org_kind_key_uk"');
    expect(
      fs.existsSync(path.join(ROOT, "migrations/0229_outward_actions.sql")),
    ).toBe(true);
  });

  it("an unclassified throw is recorded ambiguous, never failed", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/actions/outwardAction.ts"),
      "utf8",
    );
    const catchBlock = src.slice(src.indexOf("outcome = await exec()"));
    // The conservative reading of "we don't know what happened" is the one that
    // does not double-send.
    expect(catchBlock.slice(0, 900)).toContain('markClaim(claimId, "ambiguous"');
  });
});
