/**
 * Loan servicing does not end because a CRM lead was soft-deleted (W10.2a).
 *
 * When the live-lead census made `storage.getLead` exclude soft-deleted leads
 * (DEFECT-0273), every servicing path that found the borrower through it —
 * periodic statements, payment-posting notices, servicing texts, the borrower
 * portal, the finance agent, servicing documents — would have gone silent for
 * a borrower whose lead had been deleted while the loan was still being
 * serviced. Those are obligations to the borrower, not CRM features.
 *
 * The rule: a note's borrower is resolved with `getBorrowerLead`, which
 * deliberately includes a soft-deleted lead. `getLead` stays live for
 * everything else — including ASSIGNING a borrower to a new note, where a
 * deleted lead must be refused.
 *
 * Population: every production file under server/, comment-stripped.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

/** `getLead(org, note.borrowerId)` / `getLead(org, note[0].borrowerId)` — a note's borrower through the live-only read. */
// `[^()]*` spans newlines; `,?` tolerates a trailing comma before the paren
// (the audit found the portal login written that way, and the first draft of
// this pattern blind to it).
const LIVE_ONLY_BORROWER = /\bgetLead\(\s*[^()]*,\s*\w*note\w*(?:\[\d+\])?\.borrowerId\s*,?\s*\)/gi;
const BORROWER_READ = /\bgetBorrowerLead\(\s*[^()]*,\s*\w*note\w*(?:\[\d+\])?\.borrowerId\s*,?\s*\)/i;

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) out.push(child);
    }
  };
  walk("server");
  return out;
}

const sources = serverFiles().map((file) => ({ file, src: stripComments(fs.readFileSync(path.join(ROOT, file), "utf8")) }));

describe("a note's borrower is resolved through the servicing read", () => {
  it("vacuity: the servicing read is adopted across the servicing paths", () => {
    const adopters = sources.filter((s) => BORROWER_READ.test(s.src)).map((s) => s.file);
    for (const f of [
      "server/routes-borrower.ts",
      "server/services/periodicStatements/delivery.ts",
      "server/services/borrower/portalPaymentPosting.ts",
      "server/services/smsService.ts",
    ]) {
      expect(adopters, f).toContain(f);
    }
  });

  it("no production file resolves a note's borrower through the live-only getLead", () => {
    const offenders = sources.flatMap((s) => [...s.src.matchAll(LIVE_ONLY_BORROWER)].map((m) => `${s.file}: ${m[0]}`));
    expect(
      offenders,
      "a servicing path finds the borrower with getLead, which hides a soft-deleted lead — the borrower " +
        "would stop receiving statements and notices on a loan still being serviced. Use getBorrowerLead.",
    ).toEqual([]);
  });

  it("a servicing SEND resolves the borrower through the note, including a deleted lead", () => {
    // The finance agent prepared the borrower with getBorrowerLead, but the
    // send itself (communications.sendToLead) looked the lead up live and
    // answered "Lead not found" (audit of W10.2a).
    const comms = sources.find((s) => s.file === "server/services/communications.ts")!.src;
    const at = comms.indexOf("async sendToLead(");
    const head = comms.slice(at, comms.indexOf("checkTcpaConsentFromLead", at));
    expect(head).toMatch(/purpose === 'servicing'/);
    expect(head).toMatch(/note\.borrowerId !== options\.leadId/);
    expect(head).toMatch(/getBorrowerLead\(options\.organizationId, options\.leadId\)/);
  });

  it("getBorrowerLead includes deleted leads; getLead does not", () => {
    const repo = sources.find((s) => s.file === "server/storage/leadRepo.ts")!.src;
    const body = (name: string) => {
      const at = repo.indexOf(`async ${name}(`);
      expect(at, name).toBeGreaterThan(-1);
      return repo.slice(at, repo.indexOf("\n  },", at));
    };
    expect(body("getBorrowerLead")).toMatch(/\.from\(leadsIncludingDeleted\)/);
    expect(body("getBorrowerLead")).not.toMatch(/liveLead\(|deletedAt/);
    expect(body("getBorrowerLead")).toMatch(/organizationId, orgId/);
    expect(body("getLead")).toMatch(/liveLead\(\)/);
  });

  it("canary: the pattern sees both spellings", () => {
    expect("await storage.getLead(note.organizationId, note.borrowerId)".match(LIVE_ONLY_BORROWER)).toHaveLength(1);
    LIVE_ONLY_BORROWER.lastIndex = 0;
    expect("await storage.getLead(session.organizationId, note[0].borrowerId)".match(LIVE_ONLY_BORROWER)).toHaveLength(1);
    LIVE_ONLY_BORROWER.lastIndex = 0;
    expect("await storage.getLead(orgId, overrides.borrowerId)".match(LIVE_ONLY_BORROWER)).toBeNull();
    LIVE_ONLY_BORROWER.lastIndex = 0;
    expect("await storage.getLead(\n  note.organizationId,\n  note.borrowerId,\n);".match(LIVE_ONLY_BORROWER)).toHaveLength(1);
  });
});
