/**
 * The S-1 borrower letter says only what the code does (P2-6 S2, A-5).
 *
 * The letter in shared/privacy/borrowerErasureLetter.ts is prose, and prose
 * drifts: the refusal could be flipped, the export registry could gain a
 * domain, the identity posture could loosen, and the letter would go on
 * promising yesterday's behaviour to a borrower who never chose AcreOS. Each
 * case below pins one factual claim to the production code it describes, so
 * that changing the behaviour turns the letter red in the same run.
 *
 *   claim                               pinned against
 *   ─────────────────────────────────── ──────────────────────────────────────
 *   "a copy includes …" (the list)      DSAR_DOMAINS lead-subject export set
 *   the grounds (1098, 1099-INT, Art.)  DSAR_DOMAINS loan_notes retain reason
 *   the refusal code                    gdprService.ts eraseLeadSubject (source)
 *                                       + the founder UI that maps the same code
 *   exact-email, person-recorded check  DSAR_IDENTITY_POSTURE switches
 *   where to write                      the privacy page's served body
 *                                       (client/src/legal/privacy-policy.html,
 *                                       the asset pages/privacy.tsx renders
 *                                       since the 2026-11-21 bundle diet)
 *
 * The refusal's BEHAVIOUR (a borrower lead mutates nothing, 422 by name) is
 * already pinned by dsarErasureRegistryEquivalence.test.ts and the realdb
 * drill; this file does not re-mock the database to prove it a third time.
 *
 * Sources are read with comments stripped, because the module's own docblock
 * quotes the strings this file forbids.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import {
  buildBorrowerErasureLetter,
  PRIVACY_REQUEST_EMAIL,
  type BorrowerErasureLetter,
  type BorrowerLetterContext,
} from "../../shared/privacy/borrowerErasureLetter";
import { DSAR_DOMAINS } from "../../shared/privacy/dsarDomains";
import { DSAR_IDENTITY_POSTURE } from "../../shared/privacy/dsarIdentityPosture";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const CTX: BorrowerLetterContext = {
  borrowerFirstName: "Ana",
  lenderName: "Mesa Land Co",
  loanNumber: 42,
  emailOnFile: "ana@example.test",
};

/** Every rendered string in the letter, in order, as one text. */
function textOf(letter: BorrowerErasureLetter): string {
  const parts: string[] = [letter.title, letter.greeting];
  for (const s of letter.sections) {
    parts.push(s.heading, ...s.paragraphs, ...(s.list ?? []).map((i) => i.plain));
  }
  parts.push(...letter.closing, letter.signoff);
  return parts.join("\n");
}

function recordDomains(letter: BorrowerErasureLetter): string[] {
  const lists = letter.sections.filter((s) => s.list);
  expect(lists, "the letter has exactly one record-contents list").toHaveLength(1);
  return lists[0].list!.map((i) => i.domain).sort();
}

describe("S-1 borrower letter — the copy it offers is the registry's lead export, exactly", () => {
  it("names one plain-English entry per lead-subject export domain, and no other", () => {
    const registry = DSAR_DOMAINS.filter((d) => d.decision === "export" && d.subjectKind === "lead")
      .map((d) => d.domain)
      .sort();
    expect(registry.length, "vacuity: the registry declares lead export domains").toBeGreaterThanOrEqual(5);
    expect(recordDomains(buildBorrowerErasureLetter(CTX))).toEqual(registry);
  });

  it("every entry is a sentence a borrower can read, not a table name", () => {
    const letter = buildBorrowerErasureLetter(CTX);
    // The leak this guards against is a registry/domain NAME reaching the
    // borrower: a snake_case identifier (lead_profile, loan_notes,
    // borrower_portal_sessions) or a domain string verbatim. It is NOT the
    // plain-English words those names happen to be built from — "notes" in
    // "messages and notes exchanged with your lender" is a word a borrower
    // reads as English, and banning it (the old regex allowed "notes" only
    // when followed by "and") would push the copy toward jargon to satisfy
    // the test, which is the wrong direction for a borrower-facing letter.
    const registryNames = DSAR_DOMAINS.map((d) => d.domain);
    for (const item of letter.sections.find((s) => s.list)!.list!) {
      expect(item.plain.length).toBeGreaterThan(15);
      expect(item.plain, `entry for ${item.domain} leaks a snake_case registry name`).not.toMatch(/_/);
      for (const name of registryNames) {
        expect(item.plain, `entry for ${item.domain} names the registry domain ${name}`).not.toContain(name);
      }
    }
  });
});

describe("S-1 borrower letter — grounds and refusal code trace to the erasure path", () => {
  const text = textOf(buildBorrowerErasureLetter(CTX));

  it("states the same grounds the registry records for retaining the loan record", () => {
    const loanNotes = DSAR_DOMAINS.find((d) => d.domain === "loan_notes");
    expect(loanNotes?.decision).toBe("export");
    const reason = loanNotes && loanNotes.decision === "export" ? loanNotes.erasure.reason ?? "" : "";
    expect(loanNotes && loanNotes.decision === "export" ? loanNotes.erasure.action : null).toBe("retain");
    for (const token of ["1099-INT", "1098", "17(3)(b)"]) {
      expect(reason, `the registry reason no longer cites ${token}; re-read the letter`).toContain(token);
      expect(text, `the letter no longer cites ${token}`).toContain(token);
    }
    // The registry says the ruling is pending; the letter must not present it as settled.
    expect(reason).toMatch(/pending/i);
    expect(text).toMatch(/position AcreOS takes today/);
  });

  it("names the refusal code the erasure path throws for a borrower, and that path still throws it", () => {
    const code = "RETENTION_REQUIRED_LOAN_RECORDS";
    const occurrences = text.split(code).length - 1;
    expect(occurrences, "the letter names the code exactly once").toBe(1);

    const svc = read("server/services/gdprService.ts");
    const start = svc.indexOf("async function eraseLeadSubject(");
    expect(start, "eraseLeadSubject is gone — the letter describes a refusal that no longer exists").toBeGreaterThan(0);
    const body = svc.slice(start, svc.indexOf("\n}\n", start));
    expect(body.length, "vacuity: the function body was located").toBeGreaterThan(400);
    // A read of the borrower's notes, then the refusal by name, then nothing written: the
    // throw must come before the function's first write. That write is DELEGATED —
    // eraseLeadSubject performs no literal db.update/insert/delete itself; after its
    // refusals it calls anonymizeLeadContactFields, the helper that updates the lead
    // row. The old guard searched only for a literal db.* write in this body, found
    // none (firstWrite = -1) and failed its own vacuity check even though the write
    // path is right there, one call away. Follow the delegation instead: the guard
    // now orders the throw against the earliest of (a direct write, the delegated
    // call), and separately proves the helper really is a write, so the ordering
    // claim can never go vacuous in either direction.
    expect(body).toContain("notes.borrowerId");
    const throwAt = body.indexOf(`"${code}"`);
    expect(throwAt, "the borrower refusal is no longer thrown by name").toBeGreaterThan(0);
    const directWriteAt = body.search(/db\s*\.\s*(update|insert|delete)\s*\(/);
    const delegatedWriteAt = body.indexOf("anonymizeLeadContactFields(organizationId, leadId)");
    expect(delegatedWriteAt, "vacuity: eraseLeadSubject no longer delegates its write to anonymizeLeadContactFields — re-derive the write path before trusting this guard").toBeGreaterThan(0);
    const helperStart = svc.indexOf("async function anonymizeLeadContactFields(");
    expect(helperStart, "vacuity: the delegated write helper is gone").toBeGreaterThan(0);
    const helperBody = svc.slice(helperStart, svc.indexOf("\n}\n", helperStart));
    expect(helperBody, "vacuity: the delegated helper no longer writes — the ordering guard has nothing to order against").toMatch(/db\s*\.\s*update\s*\(/);
    const writePoints = [directWriteAt, delegatedWriteAt].filter((at) => at >= 0);
    const firstWrite = Math.min(...writePoints);
    expect(throwAt, "a write now precedes the borrower refusal — the letter's 'nothing is changed' is false").toBeLessThan(firstWrite);

    // The founder's DSAR panel maps the same code; two spellings would mean two stories.
    expect(read("client/src/components/founder/DsarSubjectActions.tsx")).toContain(`"${code}"`);
  });

  it("the refusal covers a loan in ANY status, as the letter says ('including one that has been paid off')", () => {
    const svc = read("server/services/gdprService.ts");
    const start = svc.indexOf("async function eraseLeadSubject(");
    const body = svc.slice(start, svc.indexOf("\n}\n", start));
    const read_ = body.slice(body.indexOf(".from(notes)"), body.indexOf(`"RETENTION_REQUIRED_LOAN_RECORDS"`));
    expect(read_.length).toBeGreaterThan(40);
    expect(read_, "the notes read now filters by status; the letter's any-status claim is false").not.toMatch(/notes\.status/);
    expect(text).toContain("including one that has been paid off");
  });
});

describe("S-1 borrower letter — the request process it describes is the one enforced", () => {
  const text = textOf(buildBorrowerErasureLetter(CTX));

  it("exact-email matching and a person-recorded identity check are the live posture switches", () => {
    expect(DSAR_IDENTITY_POSTURE.requireExactEmailMatch).toBe(true);
    expect(DSAR_IDENTITY_POSTURE.requireOperatorVerification).toBe(true);
    expect(DSAR_IDENTITY_POSTURE.leadSubjectsPerOrganization).toBe(true);
    expect(text).toContain("made on that email address exactly");
    expect(text).toContain("records an identity check");
    expect(text).toContain("handled separately");
    // The posture's own statement rules out these matches; the letter repeats the rule.
    expect(DSAR_IDENTITY_POSTURE.statement).toMatch(/phone, name or address match never qualifies/);
    expect(text).toMatch(/a name, a phone number or a street address alone is never enough/);
  });

  it("sends the borrower to the address the published privacy page gives", () => {
    // The published page's body is the served asset pages/privacy.tsx
    // renders (bundle diet, 2026-11-21); the mailto lives there now.
    expect(read("client/src/legal/privacy-policy.html")).toContain(`mailto:${PRIVACY_REQUEST_EMAIL}`);
    expect(text).toContain(PRIVACY_REQUEST_EMAIL);
  });

  it("describes the copy's redactions as the exporter performs them", () => {
    const exporters = read("server/services/privacy/dsarExporters.ts");
    expect(exporters).toContain("taxIdOnFile");
    expect(exporters).toContain(`"accessToken"`);
    expect(exporters).toContain("exclusions");
    expect(text).toContain("only whether one is on file");
    expect(text).toContain("portal sign-in link");
    expect(text).toContain("named in the copy, with the reason");
  });
});

describe("S-1 borrower letter — renders the borrower's own context and invents nothing", () => {
  it("uses the name, lender, loan number and email the portal already holds", () => {
    const text = textOf(buildBorrowerErasureLetter(CTX));
    expect(text).toContain("Hello Ana,");
    expect(text).toContain("Mesa Land Co is your lender");
    expect(text).toContain("loan #42");
    expect(text).toContain(`from ana@example.test, the address Mesa Land Co has on file`);
  });

  it("degrades to 'your lender' and a plain greeting when context is missing — never a placeholder", () => {
    const letter = buildBorrowerErasureLetter({ borrowerFirstName: null, lenderName: "  ", loanNumber: null, emailOnFile: null });
    const text = textOf(letter);
    expect(letter.greeting).toBe("Hello,");
    expect(text).toContain("Your lender is your lender and holds the record of your loan.");
    expect(text).not.toMatch(/#/);
    expect(text).not.toMatch(/\b(null|undefined|NaN)\b/);
    expect(text).toContain(`Email ${PRIVACY_REQUEST_EMAIL} from the address your lender has on file`);
  });

  it("promises no deadline and claims no outcome the code does not produce", () => {
    const text = textOf(buildBorrowerErasureLetter(CTX));
    // Q-C2 (24h clock vs 30-day promise) is open: the letter states no clock at all.
    expect(text).not.toMatch(/\b\d+\s*(?:business\s+)?(?:day|hour|week)s?\b/i);
    expect(text).not.toMatch(/\bwithin\b/i);
    // Erasure is refused outright; the letter may describe that, never a completed or future erasure.
    expect(text).not.toMatch(/(?:has|have|will) be(?:en)? (?:erased|deleted|anonymi[sz]ed)/i);
    expect(text).not.toMatch(/we (?:deleted|erased|removed)/i);
    expect(text).toContain("nothing is deleted, nothing is anonymized, and nothing is partly removed");
  });
});
