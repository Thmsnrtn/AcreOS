/**
 * Fleet-14 integration pins — the three blocking findings fixed centrally.
 *
 * Each is source-derived because the behaviours need a live Express app, a Lob
 * client and a database between them. What must not regress is the SHAPE, and
 * these are written to bite on the specific mutation the audit used.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("R-2 — a live platform key is gated and never dressed as a test send", () => {
  const SRC = read("server/services/directMail.ts");

  /**
   * THE REGRESSION: the stop-loss was gated on
   * `!credential.isTestKey && effectiveMode(mode) === 'live'`. Once the
   * resolver started returning whatever `resolvePlatformLobKey()` yields — the
   * LIVE key whenever the interlock is armed — `mode: 'test'` both SKIPPED the
   * stop-loss and still got a live key. Real letters printed, postage billed
   * to AcreOS, the monthly mail budget never consulted, under a banner reading
   * "Test mode / Safe — no actual mail is sent".
   */
  it("the stop-loss is gated on the KEY IN HAND, not on the mode requested", () => {
    const block = SRC.slice(
      SRC.indexOf("if (credential.source === 'platform')"),
      SRC.indexOf("return credential;"),
    );
    expect(block.length).toBeGreaterThan(100);
    expect(block).toContain("if (!credential.isTestKey) {");
    expect(block).toContain("assertOutreachNotPaused");
    // The mode conjunct must be gone from the stop-loss CONDITION — that is
    // the mutation. Scoped to the `if` line itself rather than the surrounding
    // block, because the block's comment explains the old condition by quoting
    // it, and a block-wide check would match the explanation and fail for the
    // wrong reason. (Making exactly that mistake is how an earlier pin in this
    // codebase caught its own comment.)
    const gateLine = block
      .split("\n")
      .find((l) => l.includes("if (!credential.isTestKey)")) ?? "";
    expect(gateLine).toContain("if (!credential.isTestKey) {");
    expect(gateLine).not.toContain("effectiveMode");
  });

  it("a test-mode request REFUSES a live platform credential rather than upgrading it", () => {
    expect(SRC).toContain("this.effectiveMode(mode) === 'test' && !credential.isTestKey");
    expect(SRC).toContain("Nothing was sent");
  });
});

describe("R-2 — the mail-mode banner shows what will happen, not what was asked for", () => {
  const UI = read("client/src/components/campaigns-content.tsx");
  const ROUTE = read("server/routes-campaigns.ts");

  it("the surface renders the server's honest isTestMode, not the preference", () => {
    // `currentMode` is the org's PREFERENCE; `isTestMode` is what the send path
    // will actually do. Rendering the preference is what let the banner promise
    // a simulation over a live send.
    expect(UI).toContain("mailStatus.isTestMode ??");
    expect(UI).not.toMatch(/const isTestMode = mailStatus\.currentMode === 'test';/);
  });

  it("the activation event records what happened, not what was requested", () => {
    expect(ROUTE).toContain("isTestMode: result.isTestMode ?? isTestMode");
  });
});

describe("R-3 — the arming chokepoint cannot be walked around by editing", () => {
  const SRC = read("server/routes-va-engine.ts");

  /**
   * THE DEFECT: the gate sat only on CREATE, and `omitProtectedFields` does not
   * protect `sequenceId` / `status` / `currentStep` / `nextStepAt`. A PATCH
   * could repoint a dormant enrollment at an unarmed sequence and flip it
   * active in one call — the exact state the ruling exists to make unreachable.
   */
  it("PATCH re-checks arming before writing, and refuses before any write", () => {
    const start = SRC.indexOf('api.patch("/api/collection-enrollments/:id"');
    expect(start).toBeGreaterThan(0);
    const body = SRC.slice(start, SRC.indexOf("api.get(", start));

    expect(body).toContain("assertSequenceArmed(sequence)");
    expect(body).toContain("Errors.forbidden(res, armed.reason)");
    // Both routes into an armed state are covered: repointing and activating.
    expect(body).toContain("patch.sequenceId != null");
    expect(body).toContain("ACTIVE_STATUSES.has(patch.status)");

    // ORDER IS THE PROPERTY: the refusal must precede the update, or the write
    // has already happened by the time we say no.
    expect(body.indexOf("assertSequenceArmed")).toBeLessThan(
      body.indexOf("storage.updateCollectionEnrollment"),
    );
  });
});

describe("R-3 — the off switch stops what it says it stops", () => {
  const SVC = read("server/services/collectionArming.ts");
  const UI = read("client/src/components/finance/CollectionArming.tsx");

  /**
   * THE DEFECT: `disarmSequence` only updated the sequence row. `autoStart` is
   * consulted in exactly one place — `assertSequenceArmed`, on enrollment
   * CREATE — and nothing re-checks it at dispatch time. So a customer with 40
   * notes mid-ladder tapped "Stop this sequence", was told "No further messages
   * will be sent", and all 40 kept sending.
   */
  it("disarming cancels the ladders already walking", () => {
    const fn = SVC.slice(SVC.indexOf("export async function disarmSequence("));
    expect(fn).toContain("update(collectionEnrollments)");
    expect(fn).toContain('status: "cancelled"');
    // Org-scoped at the query, not filtered in the caller.
    expect(fn).toContain("eq(collectionEnrollments.organizationId, organizationId)");
    expect(fn).toContain("eq(collectionEnrollments.sequenceId, sequenceId)");
    // Only what can still send — a completed enrollment is left alone so the
    // returned count means "what this actually stopped".
    expect(fn).toContain('inArray(collectionEnrollments.status, ["active", "paused"])');
    expect(fn).toContain("cancelledEnrollments");
  });

  it("the toast reports the count instead of asserting a blanket silence", () => {
    expect(UI).toContain("result?.cancelledEnrollments ?? 0");
    expect(UI).toContain("already in this ladder");
  });
});
