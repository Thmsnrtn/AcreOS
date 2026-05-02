# Lazlo Brockwell — opposing counsel discovery review

I'm 49. Twenty-three years at Brockwell & Hines, Charlotte. I'm the litigation partner my plaintiffs' firms call when the defendant is a sophisticated land seller and the theory is fraud, negligent misrepresentation, or RESPA violation. I read Saskia Okonkwo's self-audit. She's wrong about one thing — she thinks of AcreOS as a system she has to *defend in* discovery. I'm the one issuing the discovery requests, and from where I sit, AcreOS is an absolute target-rich environment. Every gap she catalogued is a gap I exploit. Every primitive she trusts is a primitive I impeach.

This memo is what my discovery plan looks like the moment I learn the defendant runs AcreOS.

---

## 1. My Rule 34 request — what I subpoena, line by line

Federal Rule of Civil Procedure 34 lets me demand documents and ESI in their native form. North Carolina Rule 26 and 34 mirror it. Here's my draft request to defendant Okonkwo:

1. **Every row of the `audit_log` table** (`shared/schema.ts:4149`) where `entityId` references the Tatum deal, the Greene Street property, the lead record for Marcus Tatum, or any document, signature, communication, or note tied to those entities. Native JSON export plus a contemporaneous schema dump. **I want the raw rows** — not a CSV summary the defendant generated, because per §2 of Saskia's own audit there is no hash chain and the rows are mutable.
2. **Every row of `activity_log`** for the same scope. Saskia's panicked because retention purges this after 90 days. Good. I serve my preservation letter on day one and any post-letter purge becomes spoliation. I'd also subpoena the *retention-job logs* (`server/utils/logger.ts` output, the `[data-retention]` lines) to prove which rows were purged and when.
3. **Every version of every document** from `document_versions` (`schema:4848`) tied to the deal — full `content`, full `variables`, every `createdBy` and `createdAt`. Plus the *current* `generated_documents` row, so I can compare against the latest version and identify silent edits.
4. **Every signature record** (`signatures`, `schema:4811`) for the deal, with `signatureData` (the base64 PNG), `ipAddress`, `userAgent`, `signedAt`. Note that `signatures.documentId` references `generated_documents.id` — mutable. **This is the smoking gun for my fraud theory** (see §4).
5. **Every communication row** across the seven tables Saskia listed — `seller_communications`, `messages`, `team_messages`, `borrower_messages`, `inbox_messages`, `deal_room_messages`, `aiMessages`. The fact that AcreOS scatters comms across seven tables is *my* gift, not the defendant's defense. Some defense lawyer will miss one. When my forensics expert finds the missed table, the spoliation inference applies.
6. **Every AI conversation** (`aiMessages`, `aiConversations`) where the agent name, prompt, or context referenced "Tatum," "Greene Street," "perc," "septic," "disclosure," or any nearby term. **Including the agent's responses.** Especially the agent's responses.
7. **Every `agent_llm_traces` row** (`schema:14949`) where `decisionId` ties to a deal action on the Tatum file. The trace stores the full prompt + model + completion. That's a litigation grenade for the defendant.
8. **Every `notes` row, every `tasks` row, every `agent_tasks` row** referencing the deal, the buyer, or the property.
9. **The `provider_cache` table** for any third-party data lookup (perc data, soil data, county GIS) AcreOS performed on the parcel. If Saskia's platform pulled a USDA soil-survey result that said "septic suitability: severe limitation," and she sold the parcel anyway, that cached row ends her case.
10. **Soft-deleted rows.** `deletedAt IS NOT NULL` on `properties`, `leads`, `deals`. Saskia thinks soft delete is protection. To me it's a 100%-recoverable evidence pool the defendant *thought* was gone.

I get all of it via a forensic image of the database, taken under court-supervised protocol. Defense will try to filter; I'll insist on the raw image with attorney-eyes-only review for non-relevant rows.

---

## 2. The discovery gaps I exploit — what AcreOS does NOT export

Saskia frames these as her problems. They're also *my opportunities to argue spoliation, gross negligence, and adverse inference*:

- **No legal-hold table.** The moment Saskia got my preservation letter, she had a duty to freeze every relevant record. AcreOS gave her no mechanism to comply. My motion: defendant's nightly retention job continued purging during litigation. *Sanctions request: adverse inference instruction — the jury may presume the purged rows were unfavorable to defendant.* In the Fourth Circuit, this is a routine sanction once I show duty + breach + prejudice.
- **No read-event audit trail.** Saskia notes correctly that `AUDIT_ACTIONS` doesn't include `read`. So I cannot prove she viewed the soil-survey PDF before listing the parcel. **But the defense cannot prove she didn't, either.** I get to argue she did, and the absence of a contemporaneous "I never opened that file" log entry helps me, not her. Asymmetric: missing read logs hurt the defendant.
- **`audit_log.changes` is mutable jsonb with no hash chain.** I depose the AcreOS DBA (Saskia's IT consultant or, if Saskia is on the SaaS, an Anthropic/AcreOS engineer under FRCP 30(b)(6)) and walk them through the schema. "Could a row in `audit_log` be UPDATEd after creation? Is there a database trigger preventing it? Is there a hash chain that would detect tampering?" The answer is no on all three. Then I argue the entire log is unreliable and ask the court to disregard it as defendant's self-serving evidence. I don't have to *prove* tampering — I have to show it was *possible* and the defendant cannot rule it out.
- **`signatures.documentId` references the mutable parent, not the immutable version.** Schema confirmed at `shared/schema.ts:4814`: `documentId: integer("document_id").references(() => generatedDocuments.id)`. There is no `documentVersionId` foreign key. This is structural. **My fraud theory writes itself**: Marcus Tatum signed *some* version of the seller-disclosure form; the version currently in the database may not be that version; AcreOS's schema makes it impossible to prove which version he saw. I file a Rule 56 partial-summary-judgment motion on the disclosure-form claim, citing the schema as undisputed evidence that the document chain of custody is broken by design.
- **Hard-deletes for templates, packages, and due-diligence items.** Saskia caught these: `deleteDocumentTemplate`, `deleteDocumentPackage`, `deleteDueDiligenceItem` are unrecoverable. If any of these were touched after my preservation letter, that's spoliation per se. I serve specific interrogatories: "Identify by name, ID, and date every document template, document package, and due-diligence item deleted from your AcreOS account between [date of contract] and today." Defense has to answer under oath. If the answer is non-zero, sanctions. If the answer is zero, I get to depose the IT vendor to confirm — and any inconsistency is perjury exposure.
- **No `aiGenerated` flag on `documents` or `document_versions`.** If I can show via metadata or stylometric analysis that the seller-disclosure form was AI-drafted, and the platform has no record acknowledging it, **that's evidence of concealment**. The absence of the field becomes the inference.

---

## 3. The "deleted" data that isn't actually deleted

This is where defendants reliably lose. They tell their lawyers "I deleted that," meaning they clicked a button. The button set `deletedAt` to a timestamp. The row is *still in the database* and *still discoverable*.

Confirmed soft-delete columns at `shared/schema.ts:382, 692, 798, 903`. Plus the standard pattern across leads, deals, properties. **Every one of those rows is fully recoverable** via:

```sql
SELECT * FROM properties WHERE deleted_at IS NOT NULL AND organization_id = ?
```

I serve a Rule 34 request specifically demanding "all rows where `deleted_at IS NOT NULL`," and I cite the schema lines so the defendant cannot pretend the data doesn't exist. Defense lawyer who lets the client claim "it's deleted" without checking gets sanctioned.

Same pattern for:
- Soft-deleted leads — early conversations Saskia had with Marcus, including the original lead source and any disqualification notes she may have toggled.
- Soft-deleted documents — earlier drafts of the disclosure form she "cleaned up."
- `bulkDeleteDeals` (`server/storage.ts:1801`) — sets `status='deleted'` rather than truly removing. The deal record is intact.

The hard-delete paths are the only data actually gone. Those are the items where I press the spoliation theory hardest, because they're *gone-gone* and the defendant has to explain why.

---

## 4. The signatures attack — my central theory

Saskia's case turns on whether the seller-disclosure form Marcus signed says what the form in the database now says. Her own audit confirms the schema cannot answer this. Mine confirms it too, more pointedly.

`signatures.documentId` → `generatedDocuments.id`. The `generatedDocuments` table is mutable. There is no immutable version pin on the signature. Therefore:

1. The signature record proves *a* signature was collected at a timestamp.
2. The signature does **not** prove *what document content existed* at that timestamp.
3. The `document_versions` table preserves prior content but is not linked to the signature.

My pleading: "The defendant's system of record cannot establish, on its own data, what representations the plaintiff actually saw and signed. Defendant has therefore failed to maintain reliable records of a transaction she now seeks to enforce. The plaintiff's account of the disclosure form's original content must be accepted as the more reliable source."

This is a structural argument the defendant cannot rebut without external evidence (witness, paper copy, third-party signing service). For native AcreOS-only signatures? **I win that subargument every time.** And it's enough to flip the burden on the disclosure claim, which is enough to push the case toward settlement.

---

## 5. AI prompts — the discovery surface defense lawyers don't see coming

Most defense attorneys still think of AI as a tool, not a witness. I think of `agent_llm_traces` and `aiMessages` as the *most useful deposition transcripts* in the file, because:

1. They are written contemporaneously, not reconstructed from memory.
2. They are unguarded — Saskia talked to Sophie the way she'd talk to her diary, not the way she'd talk to me.
3. They are admissible as party admissions under FRE 801(d)(2): anything *Saskia said to the agent* is her statement. Anything *the agent generated for Saskia and she then sent or used* is adopted by her conduct.
4. The agent's own responses are admissible to show *what advice she received and ignored* — devastating for any "I didn't know" defense.

What I subpoena:
- Every `aiConversations` row where the agent name + organizationId tie to Saskia, ordered by createdAt, joined to `aiMessages`.
- Every `agent_llm_traces` row (`schema:14949`) — full prompt, model name, completion, decision ID, organization ID. The `currentPromptHash` field (`schema:14934`) lets me prove which version of the agent's system prompt was active.
- The `vaAgents` configuration history. If the agent was reconfigured after our incident, I want the version it was on the day Saskia consulted it.
- `ai_telemetry_events` — but quickly, because retention is 30 days. I serve a *preservation TRO* on day one specifically for this table, naming AcreOS as a third-party recipient.

Defense will claim attorney-client privilege over agent conversations. That fails: an LLM is not an attorney, the relationship is not legally privileged, and there is no clergy/spousal/medical analog. Saskia's audit acknowledged she has no privilege-tagging mechanism — meaning no contemporaneous claim of privilege on these conversations — meaning the privilege was never asserted at the moment of disclosure. **Under most jurisdictions, that waives it.**

Defense will then try work-product. Same problem. The conversations weren't held in anticipation of *this* litigation; they were operational. Work-product doctrine doesn't reach them.

I get the AI logs. They are devastating.

---

## 6. The forensic accountant's wishlist

I retain a forensic accountant from Cornerstone Research for the financial pieces. Her shopping list, served as a separate Rule 34 request:

- **Every payment row** (`payments`, `borrower_payments`) tied to the deal. Compare against bank statements and the recorded note. Any mismatch goes to her expert report.
- **Every `transactions` and `ledger` entry** for Saskia's organization in the relevant period. Looking for related-party transactions, off-book transfers, "test" transactions that suggest the platform was used to launder a representation.
- **Provider cache hits with cost.** If a paid lookup (skiptrace, perc, AVM) was performed and a credit deducted, the timestamp + result are recoverable. She'll cross-reference cost data with what Saskia *should* have known.
- **`landCreditScore` history** for the parcel, if any. If the platform's own valuation flagged the parcel as low-grade and Saskia priced and represented it as buildable, the score row is impeaching.
- **Every campaign, ad spend, and outbound message** that referenced this parcel. If the marketing copy said "buildable homestead" and the disclosure form said "no warranties," she's got a fraud-in-the-inducement problem on top of the disclosure claim.
- **AcreOS's *own billing records*** for Saskia's organization. Subpoenaed from AcreOS directly. Tells me which features she used, when she upgraded, when she ran lead-list pulls. Builds the narrative of a sophisticated operator who can't credibly claim ignorance.

The forensic accountant also wants the **database backup history** — `dbBackup.ts` runs a job. Each backup is a frozen snapshot of state on a specific date. **Backup files are pure evidentiary gold** because they are immutable point-in-time captures. I subpoena every backup taken between contract date and today, and my expert restores each one in a sandbox, comparing the disclosure form, the activity log, the messages. **Any divergence between successive backups is timeline evidence the defendant cannot edit.**

---

## 7. The Anthropic / AcreOS third-party subpoena

The defendant runs AcreOS as SaaS. AcreOS, the company, holds:

- The full database (including soft-deleted and held records).
- The backup history.
- The billing records.
- The retention-job logs proving exactly which rows were purged and when.
- Possibly the AI provider's prompt logs (Anthropic), depending on AcreOS's contract — I subpoena AcreOS, AcreOS subpoenas Anthropic, the prompts come back.
- The customer-support transcripts where Saskia asked AcreOS staff for help. Those are not privileged. Some of them say things like "how do I delete this old version of the disclosure form?" — that's a confession.

I serve AcreOS directly under FRCP 45. AcreOS will move to quash citing burden and customer privacy. Court will narrow the scope but not deny the subpoena. I get the relevant records on a 45-60 day timeline. The defendant cannot stop this; she's not a party to AcreOS's response.

The leverage point: **AcreOS does not currently have a customer-facing legal-hold mechanism.** When I serve my subpoena, AcreOS staff will manually scramble to preserve. Some of that manual scramble will fail, because their internal tooling isn't built for it either. *Their own failure to preserve* under my subpoena becomes its own sanctions theater — against AcreOS, not the defendant, but the defendant gets dragged in.

---

## 8. What this case looks like at the deposition

I depose Saskia. Three days. The first day is biography. The second day is the deal narrative. The third day is the database.

Day three, I open my laptop and put the schema on the screen. I walk her through:
- "Your platform stores signatures with a reference to the document, not to a specific version. Were you aware?"
- "Your platform's audit log can be edited by anyone with database access. Who has database access at AcreOS?"
- "Your platform purges activity logs after 90 days. Did you take any step to preserve them when you received my preservation letter?"
- "Your platform records your conversations with AI agents. Can you produce every conversation you had with any AI agent that mentioned this parcel?"
- "Your platform stores soft-deleted records with a `deleted_at` timestamp. Have you reviewed your soft-deleted records since this litigation began?"

Most defendants don't know the answers. Most defense lawyers haven't reviewed the schema. The transcript becomes the centerpiece of my summary-judgment opposition or my settlement-leverage package, depending on which way it cuts.

---

## 9. Bottom line for opposing-counsel work

AcreOS today is a discovery treasure. The data is rich, the gaps are exploitable, and the platform's own engineering choices — mutable signatures, mutable audit log, no legal hold, automated retention purges, scattered comms tables, ungated AI conversation logs — favor the plaintiff in nearly every contested deal-data issue.

If AcreOS ships Saskia's five fixes (legal hold + retention exemption + delete blockers, `documentVersionId` on signatures, litigation export bundle, hash-chained audit log + read events, cross-table comms-discovery view), my job gets harder. Not impossible — backup restorations, AcreOS third-party subpoena, AI prompt depositions are still wide open — but the easy wins disappear.

Until then, the next time a Land Investor on AcreOS gets sued in North Carolina, I'm hoping it's my plaintiff. The deck is stacked in my favor and the defendant doesn't realize it until day three of her deposition.

— Lazlo Brockwell, Brockwell & Hines LLP, Charlotte
