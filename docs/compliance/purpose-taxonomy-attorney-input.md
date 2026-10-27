# Purpose-code taxonomy: input for attorney review

> **NOT A COMPLIANCE DECLARATION.** This document describes what the software does and asks
> questions. It states no legal conclusion. Nothing here says that AcreOS, or any customer, is
> or is not subject to the FCRA, the GLBA, the DPPA or any state law, or that any purpose code is
> sufficient. Citations to statutes are pointers for counsel to confirm, not readings of the
> law. Written by an engineering agent (D2e, 2026-10-24) for review at LLC formation or first
> customer, whichever comes first.

## What the mechanism is

Every person-adjacent lookup that AcreOS ledgers writes one append-only `purpose_ledger` row
before the data is returned. The row holds:

- organization and acting user;
- surface;
- purpose code;
- the free-text justification (at least 10 characters);
- the attestation version;
- lead, skip-trace and parcel context;
- the metering event.

If there is no valid code, there is no row, and with no row the data is not returned. Today
three surfaces are ledgered (`skip_trace_call`, `skip_trace_result_read` and
`owner_contact_lookup`). Another 214 surfaces that hand out lead or owner contact data are **not**
ledgered yet; `purpose-ledger-census.md` lists them. The mechanism is built. **The taxonomy it
enforces is the question for counsel.**

## The codes as they exist today

The four codes come from `SKIP_TRACE_PURPOSES` (`server/services/fcraAttestation.ts`), mirrored in
`PURPOSE_CODES` (`server/services/purposeLedger.ts`; a test pins the two as equal). The skip-tracing
page shows each one to the user with this label (`client/src/pages/skip-tracing.tsx`). Separately,
each user also clicks through an annual org-level attestation (`fcra_attestations`, version
`2026-05-08-v1`).

| Code | Label shown to the user | What engineering assumed it covers in this product | Statutory pointer (for counsel to confirm or replace) |
|---|---|---|---|
| `collection` | "Collection of a debt owed by this person" | A seller-financing operator locating a **borrower of record** on a note the org holds and services (AcreOS's finance door), for example a borrower who has stopped paying and moved. | FCRA §604(a)(3)(A), 15 U.S.C. §1681b(a)(3)(A) ("collection of an account") |
| `legitimate_business_need` | "Legitimate business need — transaction initiated by this person" | A counterparty who **contacted the org first**: an owner who answered a mailer or a web form and wants to sell, where the org needs a working phone or address to finish the transaction. | FCRA §604(a)(3)(F)(i) |
| `written_consent` | "Written consent from this person" | The person signed something authorising the lookup, for example a contact-update clause in a purchase agreement or note. | FCRA §604(a)(2) ("written instructions of the consumer") |
| `account_review` | "Review of an existing account" | Reviewing an **existing** account relationship, such as an active note, lease or contract, to confirm contact details are current. | FCRA §604(a)(3)(F)(ii) |

### The gap engineering can see, which counsel should examine first

The product's most common use is not on that list. A land investor buys a county tax-delinquent
list and wants a working phone number for an owner **who has never contacted them**, so they can
make an unsolicited offer. Read literally, none of the four labels describes that:

- `legitimate_business_need` says "initiated by this person";
- `collection` and `account_review` need an existing debt or account;
- `written_consent` needs a signature.

So either an honest user cannot pick a code, and the gate blocks the core workflow, or a user
picks a code that does not fit. That second outcome is the failure the ledger exists to prevent,
and the ledger will faithfully record a mis-declared purpose. This is the single most important
input to the taxonomy.

## Questions counsel must answer

### Threshold: which regime applies to the data at all

1. **Is the data a skip-trace vendor returns a "consumer report"** under FCRA §603(d)? The vendors
   used today are BatchData / BatchSkipTracing through `skipTracingService` and the provider
   registry's `owner_info` category. Many vendors contract that their data is *not* a consumer
   report and *must not* be used for FCRA purposes. If that is true, does presenting FCRA
   purposes to the user put AcreOS and the customer in breach of the vendor terms, or does it
   just create a misleading record? We have not read the vendor contracts. Counsel should.
2. If it **is** a consumer report: is AcreOS a "user", a "reseller" (§607(e)) or a consumer
   reporting agency for purposes of passing results to its customers? What certifications and
   notices (§607, §615) does each role require that the software does not produce today?
3. **GLBA.** Does vendor data include credit-header or other data from financial institutions
   (nonpublic personal information)? If so, which §6802(e) exception must the end user
   certify? Should the taxonomy carry a separate GLBA purpose next to the FCRA one?
4. **DPPA.** Does vendor data include motor-vehicle-record data (addresses or phones from state
   DMV records)? If so, which 18 U.S.C. §2721(b) permissible use applies to each lookup, and
   must it be recorded per lookup? Most land-investor uses do not obviously match a listed use.
5. **State law.** Do state privacy laws reach this processing: CCPA/CPRA, Virginia, Colorado,
   Texas and others, plus state data-broker registration statutes? This covers sensitive-data
   categories, notice at collection for people who are not customers, and deletion rights for
   people looked up.

### The taxonomy itself

6. Given the answers to 1–5, **what is the right set of codes?** Is it one regime-neutral list
   with a mapping to each regime, or one code per regime per lookup?
7. Is there **any** permissible code for the cold-prospecting use described above? If not, the
   product answer is to block it. Engineering will build that refusal; it is not ours to
   reclassify.
8. Should one purpose declaration be allowed to cover a **batch** (today `POST /api/skip-tracing/batch`
   stamps one declared purpose on up to 100 lookups)? Or must each lookup carry its own?
9. Is a **free-text justification of at least 10 characters** meaningful evidence, or should it be
   structured (for example the note id for `collection`, or the inbound message id for
   `legitimate_business_need`)? The ledger can store a reference. It does not today.
10. **Re-reading stored results.** `GET /api/skip-traces*` reuses the purpose declared when the
    trace was run and writes a fresh `skip_trace_result_read` row. Is a purpose declared once
    valid for later reads, or does each read need its own?
11. **Lead records** carry contact data copied from traces, and are read on about 40 surfaces
    (lead lists, AI tools, exports, the public API, webhooks). Does a purpose obligation travel
    with the data once it sits in the customer's own CRM? If it does, which reads count as a
    "use" that needs a ledgered purpose? The census proposes codes such as `lead_contact_read`,
    `lead_contact_model`, `lead_contact_bulk`, `lead_contact_api` and `lead_contact_webhook`.
12. **AI context.** When a lead's contact data is placed in a model's context (Pax tools, agent
    prompts) and so sent to a model provider, is that a disclosure that needs a purpose, a
    processor agreement, or both?
13. **Public-record owner data.** County assessor owner names and mailing addresses
    (`owner_mailing_read`) are public records. Do they need any purpose control, and does that
    change once they are combined with vendor data?
14. **Data-subject exports** (`POST /api/founder/dsar/:id/generate-export`). Is that its own
    purpose (fulfilling a legal request), and should it be ledgered under a distinct code?

### Retention, access and audit

15. **Retention.** The ledger is append-only, enforced by database triggers. A DBA-only session
    setting permits pruning. What retention period is required, and is a prune itself an
    auditable event?
16. **Who may read the ledger?** Today it is the customer org's own data. Must the person looked
    up be able to obtain it (FCRA §609, state access rights)? Should AcreOS keep a copy if an org
    is deleted? The table's organization foreign key deliberately does not cascade.
17. **The annual org attestation** (`fcra_attestations`, a click-through). Is its text adequate,
    and does it need to change when the taxonomy changes? A version bump forces every user to
    re-attest.

## What engineering will do with the answers

- Change `PURPOSE_CODES` / `SKIP_TRACE_PURPOSES` and the labels to counsel's list. The test
  pinning them equal keeps the gate and the UI in step.
- Add a structured reference column or field if question 9 calls for one. That needs a migration
  and COO approval.
- Wire the surfaces counsel says need a purpose, following the census and
  `INTEGRATION-D2e.md`, and lower the census `DEBT_BASELINE` as each one lands.
- Build refusals for any use counsel says has no permissible purpose. Never relabel.

Until then the four codes stay as a **conservative default**. They are not a statement that any
of them is correct for any customer's use.
