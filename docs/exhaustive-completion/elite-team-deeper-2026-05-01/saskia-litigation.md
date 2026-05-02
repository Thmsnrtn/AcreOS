# Saskia Okonkwo — litigation review

I'm 50, Charlotte. I've been buying and seller-financing land in the Carolinas and east Tennessee for nineteen years. Two years ago I sold a 38-acre cutover tract in Anson County to a man who told me he wanted to build a house on it. Sixteen months later he sued me, alleging I told him the parcel had a buildable septic perc, that I knew it didn't, and that the seller-disclosure form he signed was "doctored" between his draft and the version I countersigned. His complaint demands rescission, return of his $94K cash, and punitive damages. My attorneys ask me one question every three days: **"Saskia, can AcreOS produce every email, every note, every version of every document that touched this deal — preserved, timestamped, and exportable in a form a North Carolina court will accept?"**

I'm not auditing AcreOS as a Land Investor today. I'm auditing it as a **defendant**. My system of record is on trial.

---

## 1. Legal hold — can I freeze a deal's data?

The first thing my attorneys did when the complaint was served was send me a *litigation hold letter*: from this date forward, **do not delete, modify, archive, or auto-purge** any record touching the Greene Street parcel, the buyer Marcus Tatum, or the seller-financing note tied to it. Spoliation is its own cause of action in North Carolina. If I can't prove I preserved everything, I lose before we get to whether I lied.

So I went looking for "legal hold" in AcreOS. **There is none.** I checked:

- No `legal_hold` or `litigation_hold` table in `shared/schema.ts`. I grepped. Zero hits.
- No legal-hold flag on `deals`, `properties`, `leads`, `documents`, `signatures`, `seller_communications`, `messages`, or `dealRooms`.
- No UI surface for "this deal is under hold." No banner. No lock icon. No way to mark a deal "frozen — discovery in progress."
- No exemption mechanism in `server/jobs/dataRetention.ts`, which runs nightly at 3 AM UTC and DELETEs from `activity_log` after 90 days, `agent_events` after 60 days, `notification_history` after 60 days, `ai_telemetry_events` after 30 days. Those are exactly the tables I need.

**This is a five-alarm gap.** Every night while my lawsuit is pending, AcreOS is silently deleting evidence I'm legally obligated to preserve. The retention job runs blind — it has no concept of "this row belongs to a deal that's under hold." If Marcus's lawyers depose me and ask "what was the activity log for the Tatum deal on March 14, 2024," and the answer is "purged 90 days after creation by an automated job," I have committed spoliation. Not maliciously — by neglect. The court does not care about the difference.

I went deeper into `bulkDeleteDeals` (`server/storage.ts:1801`) and at least confirmed it does soft-delete (sets `status='deleted'`) rather than hard-delete. Good. But `deleteDocumentTemplate` (`routes-doc-system.ts:281`), `deleteDocumentPackage` (`routes-doc-system.ts:1115`), and `deleteDueDiligenceItem` (`routes-deals.ts:578`) all appear to be hard-deletes. Marcus's deal had a custom due-diligence template I built specifically for cutover land with septic concerns. If anyone on my team or my future-self deletes that template six months from now to clean up the workspace, the artifact that *defines what "due diligence" meant for this deal* is gone. That's prejudicial.

**What I need, minimum:**
1. A `legal_holds` table: `id`, `organizationId`, `caseName` ("Tatum v. Okonkwo"), `caseNumber`, `attorneyName`, `attorneyEmail`, `enteredAt`, `enteredBy`, `releasedAt`, `releaseReason`, `scope` (jsonb: which deals/leads/properties/notes/documents).
2. A scope-resolution function that expands a hold into the set of row IDs across **every** affected table — deals, properties, leads, offers, documents, document_versions, signatures, seller_communications, messages, conversations, deal_room_messages, deal_room_documents, activity_log, audit_log, notes, payments, campaigns that touched the lead, AI conversations involving the deal, agent_tasks, agent_events.
3. A `dataRetention.ts` exclusion: every DELETE must `LEFT JOIN legal_holds_scope` and skip held rows.
4. A delete-blocker at every storage method: `bulkDeleteDeals`, `deleteDocumentTemplate`, `deleteDocumentPackage`, `deleteDueDiligenceItem`, `deleteLead`, every soft-delete that sets `deleted_at`, every hard-delete in retention. If a row is held, the delete fails with a clear error: **"Blocked by legal hold: Tatum v. Okonkwo (entered 2026-03-12). Contact your administrator."**
5. A UI lock on the affected deal/lead/property pages: red banner across the top — *"This record is under legal hold (Tatum v. Okonkwo). Edits are recorded; deletes are blocked. Hold entered 2026-03-12 by saskia@okonkwoland.com. Cannot be released without owner authorization."*
6. An audit-log entry every time a held row is touched — read, edited, attempted-delete — with full who/when/from-IP context, *and* an alert email to my attorney when an attempted delete fires.

This is not optional. This is the difference between AcreOS being usable by anyone with seven-figure deal volume in any litigious state, and AcreOS being a liability the moment a buyer's lawyer files.

---

## 2. The audit log exists. It's not enough.

`shared/schema.ts:4149` defines `audit_log` with `userId`, `action`, `entityType`, `entityId`, `changes` (before/after/fields), `ipAddress`, `userAgent`, `metadata`, `createdAt`. That's the right shape. There's a UI at `client/src/pages/audit-log.tsx` that filters and displays it. Good.

**But here's what fails under deposition:**

- **It's purged.** Wait, no — `auditLog` itself isn't in `dataRetention.ts`'s rule list. `activity_log` is (90 days), but `audit_log` survives. I had to read the file twice to confirm. That ambiguity *itself* is a problem: the two tables have nearly identical names and overlapping purposes, and only one is forensic-grade. **Rename `audit_log` to `forensic_audit_log` or `compliance_audit_log` so no future engineer accidentally adds it to a retention rule.** And add a code comment + lint check: this table is append-only, never deleted, never updated. Ever.
- **`changes` is jsonb without a hash chain.** Each row could be modified after the fact by anyone with database access. For a court-defensible audit log I need a **hash chain**: each row's hash includes the previous row's hash, so any tampering invalidates every subsequent row. Postgres can do this with a trigger. Without it, my audit log proves nothing — opposing counsel will argue I (or AcreOS) edited the rows after the fact.
- **No "verified by AcreOS" attestation.** When I export the audit log for discovery, the PDF should be signed by an AcreOS-controlled key (or a notary-style timestamping service like Surety) with a chain back to a public timestamp. Right now I'd export a CSV that any 12-year-old could edit in Excel. A judge will not accept that without expert testimony — which I'd have to pay for.
- **`auditableEntities` enum (line 4208) is incomplete.** It lists `lead, property, deal, note, payment, campaign, user, organization, settings`. Missing: `document`, `document_version`, `signature`, `communication`, `message`, `offer`, `task`, `deal_room_message`, `deal_room_document`. Half the things in my discovery scope are not first-class audited entities.
- **No reads in the audit log.** `AUDIT_ACTIONS` (line 4193) covers create/update/delete/login/logout/export/import/consent_granted/consent_revoked/data_purge. **It does not cover read.** Marcus's lawyers will subpoena: "show every time saskia@okonkwoland.com viewed the perc-test PDF between offer and closing." I can't answer that. AcreOS doesn't log reads. For litigation purposes — and for HIPAA-style sensitive-document tracking that a Land Investor with seller-financed notes inevitably needs — **read events on documents must be auditable**, at minimum for documents tagged sensitive or for any document tied to a held deal.

---

## 3. Document versions — close, but missing the load-bearing piece

`document_versions` (`shared/schema.ts:4848`) stores `documentId`, `version`, `content`, `variables`, `changes`, `createdBy`, `createdAt`. There's a UI at `client/src/pages/document-versions.tsx` that lists versions with a `restoreMutation`. This is genuinely good — most platforms don't even snapshot.

**But a "restore" button is exactly the wrong primitive for litigation.** Restore implies: take this old version and *make it current*. The current version is now editable. The restored version replaces today's reality. From a forensics standpoint that's worse than no restore at all, because it lets me (or an attacker, or a careless admin) make today's record look like an old one. Marcus's lawyers will ask: "Were any document versions restored after the lawsuit was filed?" If the answer is yes, I'm explaining myself for an hour.

**What I need instead:**
- **Restore should be blocked** on documents tied to held deals.
- **Every version must be immutable post-creation.** Once `documentVersions.id = N` is written, that row is never updated. Currently nothing in the schema enforces this — `createInsertSchema` only omits `id` and `createdAt`. A row UPDATE would silently succeed.
- **A diff view.** I need to show the court "version 2 vs version 4 of the seller-disclosure: here are the four words that changed, who changed them, when, from what IP." `document_versions` stores full content; the UI should compute and display word-level diffs and let me export a side-by-side PDF.
- **A signed-version pin.** When a `signature` is created against a document (`signatures` table), it should reference the *exact `document_versions.id`* the signer saw. Right now I'd bet $1,000 it references the document by `documentId` only, meaning if the document is later edited, there's no immutable record of what the signer actually saw. This is the central allegation in my case. **I need to grep this.** (See §6.)
- **Variable snapshots.** `documentVersions.variables` already stores the merge variables at version time — good. But the *resolved* variables, after they were merged into the template, should be reproducible from this row alone, without needing today's lead/property data. Otherwise "what did the contract say on March 14" depends on what the lead record looks like now.

---

## 4. Communication discovery — emails, SMS, calls, notes

My attorneys need every email, SMS, call note, and platform message that mentioned Marcus, the parcel, or the deal. I went looking. AcreOS has the data, scattered across at least seven tables:

- `seller_communications` (`schema:2141`) — channel, direction, subject, content, call notes, sentiment, AI-generated flag. **This is the gold mine** for direct seller comms.
- `messages` (`schema:1462`) — conversation messages, direction, sender, content, generatedByAgent.
- `team_messages` (`schema:4249`) — internal team chat.
- `borrower_messages` (`schema:5432`) — post-close borrower portal messages.
- `inbox_messages` (`schema:5165`) — unified inbox.
- `deal_room_messages` (`schema:10746`) — deal-room chat (Marcus had access to the deal room — every word in there is discoverable).
- `aiMessages` (`schema:1787`) — AI-conversation messages, including any time I asked an agent "draft a response to Marcus."

**The gaps:**

1. **No deal-scoped communication search.** I cannot type "Tatum" or the parcel APN into one box and get every message across all seven tables, sorted by timestamp. I'd have to query each table separately and merge by hand. For discovery, I need a single union view: `comms_view` (cross-table union with a normalized shape) and a UI at `/legal/discovery/:dealId` that surfaces it.
2. **AI messages are a litigation grenade.** `aiMessages` includes every time I asked Sophie or any agent for advice on the Tatum deal. *Those messages are discoverable.* Some of them might be: "Sophie, the perc test was iffy — what should I disclose?" Whether or not I asked that, opposing counsel will ask if I did, and they will subpoena `aiMessages`. **AcreOS needs an "attorney-client privilege" tag** on AI conversations (or at minimum a way to mark a conversation as "consult, not admission") so I can flag conversations for review before turning them over. And the UI should warn me, when I'm chatting with an agent about an active deal, that the conversation is being logged and is discoverable.
3. **No outbound-email full-fidelity capture.** I send emails through Gmail/Outlook, often with AcreOS in the loop via `routes-communications.ts`. Are the *raw emails as sent* — full headers, full HTML body, attachments — preserved? Or only a summarized record? In federal court I need the raw RFC 822 message with all headers (DKIM, Received, etc.) to authenticate. If AcreOS is summarizing emails into `seller_communications.content` and not storing the raw, I can't authenticate them in court.
4. **Phone-call recordings.** `seller_communications.callDuration` and `callOutcome` exist. No `recordingUrl` or `transcriptId` field that I can see. If the platform records calls (it does, via Twilio integration somewhere), the recording must be linkable from the comms row, immutably stored, retrievable for years.
5. **Mailers (Lob).** Same problem. `seller_communications.trackingNumber` exists, but the actual *image* of what Marcus received in the mail — the PDF Lob rendered — needs to be retained for the life of the deal plus statute-of-limitations. Postcards I sent in 2023 are now central to whether I "induced" Marcus into the deal.
6. **Deal-room messages have a separate table from regular messages.** `deal_room_messages` (`schema:10746`) and `deal_room_documents` (`schema:10766`) are storing communications that — depending on whether Marcus had access to the deal room while we negotiated — are some of the most directly relevant evidence in the case. They are indexed by `dealRoomId`, not by `dealId`. So my discovery query is: deal → dealRoom → dealRoomMessages. A break in any of those joins (deal-room renamed, deleted, archived) and the messages become orphaned but undiscoverable. **Need a deal-room "archive but never delete" mode**, and the discovery view in §4.1 must walk through deal-room IDs even if the deal-room itself is hidden in the UI.
7. **Soft-delete is half-protection.** I see `deletedAt` columns on properties (`schema:382`), some leads, some other tables — *but inconsistently*. Soft-delete with `deletedAt` is the right pattern; the inconsistency is the problem. A standardized soft-delete contract across every litigation-relevant table (with a default WHERE filter that excludes `deletedAt IS NOT NULL` from app queries but preserves the row for forensic export) would be the right shape. The legal-hold layer would then refuse to set `deletedAt` on held rows.

---

## 5. Litigation export package — the deliverable my attorneys actually want

`client/src/pages/data-export.tsx` exports leads, properties, deals, campaigns, notes, activities — by category, as CSV/JSON, with a "Full account archive ZIP" option. Useful for moving accounts. **Useless for litigation.**

What I need is a different shape: **export everything related to one deal**, in a forensically defensible bundle. Specifically, a `/api/legal/export/deal/:dealId` endpoint that produces a ZIP containing:

- `manifest.json` — what's in the bundle, generated-at timestamp, signed by AcreOS, with SHA-256 of every file.
- `deal.json` — the deal record with full history.
- `lead.json`, `property.json`, `offers.json`.
- `documents/` — every document version as a separate PDF, named `{document-name}__v{N}__{createdAt}.pdf`, plus a `versions.csv` with hash + creator + timestamp per file.
- `signatures/` — signature records with IP, user-agent, timestamp, and a hash of the exact document version signed.
- `communications/` — every email (as `.eml` with full headers), every SMS, every call recording, every mailer PDF, every deal-room message, ordered chronologically into one `timeline.csv`.
- `audit-log.csv` — every audit-log row touching this deal, with hash chain.
- `activity-log.csv` — every activity row.
- `ai-conversations/` — every AI conversation that mentioned the deal, with a redaction-review flag.
- `chain-of-custody.pdf` — the cover page my attorneys can hand the court: who exported, when, from what IP, the bundle's SHA-256, and an attestation.

This export must itself be logged in `audit_log` as `action: "litigation_export"`. The exported bundle should also automatically place the deal under a default 30-day legal hold, prompting me to confirm or extend.

**This single feature would be the most concrete legal-defensibility differentiator AcreOS could ship in Q2.** No competitor has it. Every Land Investor over $2M in seller-financed paper needs it and doesn't know they need it until the day they get sued.

---

## 5b. The export package has to satisfy Federal Rule of Evidence 902(14)

I keep going back to the export bundle because my attorneys actually wrote down the standard: FRE 902(14) self-authenticates digital records if they're produced with a certification by a qualified person describing the process used to identify them and confirming their integrity (typically via hash). This is *exactly* what AcreOS could ship as a default attestation. Right now, even if I export every CSV in `data-export.tsx`, I'd need to hire a forensics expert to authenticate them in court — at $400/hour. A built-in 902(14) attestation page in the export bundle, signed by an AcreOS-controlled key, with a per-file SHA-256 manifest and a paragraph describing the process, eliminates that line item. **It also becomes a sales feature for any Land Investor whose attorney has ever heard the words "rules of evidence."**

A second feature my attorneys asked for: **"freeze-export"**. When I enter a legal hold, AcreOS should automatically generate a timestamped baseline snapshot of all in-scope data and write its hash to the audit log. Then, every 30 days while the hold is active, generate a new snapshot. This way, when the case is over and we go through discovery, my attorneys can compare any later export to the baseline and prove that nothing was added, removed, or modified during the litigation period. This is a defense against the platform itself being accused of tampering.

---

## 6. The thing I most need to verify but cannot

Did Marcus sign the *current* version of the seller disclosure, or a specific snapshot? I need to know whether `signatures.documentId` references a `documents.id` (mutable) or a `document_versions.id` (immutable). If the former, AcreOS has a structural defect that lets sellers (or attackers) edit a document after a buyer signed it without breaking the signature reference. That's the exact attack Marcus is alleging against me. I cannot prove it didn't happen unless I can show the schema makes it impossible.

I'd ship a fix today: add `signatures.documentVersionId` referencing `document_versions.id`, populate it on every new signature, backfill historical signatures to the version that existed at signature creation time, and surface "you signed version 4 of this document on 2024-02-11 at 3:47 PM ET" on the post-sign confirmation. That's the email Marcus's lawyers would have to reckon with. Without it, I'm in court with nothing but my word.

---

## 6b. The AI agent disclosure problem

One subtle thing my attorneys flagged: AcreOS sometimes drafts seller communications via an agent (`seller_communications.aiGenerated` boolean, `aiAgentId` reference). If Marcus's lawyers can show that *the seller-disclosure form itself* or *a representation about the perc test* was generated by an AI agent without my review, that becomes its own theory of negligence — Saskia outsourced a legally binding statement to a chatbot.

I checked the schema. `aiGenerated` is set per-message on `seller_communications`. Good. But:
- Documents (`documents`, `documentVersions`) have **no `aiGenerated` flag**. If an agent drafted the disclosure form text, there's no record of that.
- `aiAgentId` references `vaAgents.id`. If that VA agent is later deleted or its config changed, the foreign key tells me which agent generated the message but not *what version of the agent's prompt and model* produced the output. I need a `agent_version_snapshot` or a `prompt_hash` per AI-generated artifact, immutable, so I can reproduce in court exactly what AI was responsible for what text on what date.
- There's a `server/services/agentVersionControlV12.ts` and a `agentLlmTraces.ts` already in the codebase — these probably have the right primitives. The gap is that AI-generated *seller-facing artifacts* don't reference them in a forensic way.

For litigation: I need a one-page report per deal that says **"Of the 47 communications and 12 documents in this deal, 14 communications were AI-drafted (here are which agent, prompt version, and model), and 0 documents were AI-generated."** If that report doesn't exist, I'm reading 47 messages and trying to remember which ones I wrote.

---

## 7. What I'm telling Thomas

AcreOS today is an excellent operating system for Land Investors who never get sued. The day one of us does, the platform becomes a liability instead of an asset — not because the data isn't there, but because it's not preserved, not exportable in a defensible bundle, not protected from the platform's own retention jobs, and not chained against tampering.

The five things, in priority order:
1. **Legal hold table + retention-job exclusion + delete blockers.** Two-week build. Existential.
2. **`signatures.documentVersionId` + backfill.** Three-day build. Closes my case's central allegation for every customer.
3. **Litigation export bundle.** Two-week build. Becomes a marketed enterprise feature.
4. **Audit-log hash chain + read events on sensitive documents.** One-week build.
5. **Cross-table communication-discovery view scoped to a deal.** One-week build.

Five weeks of focused work converts AcreOS from "great until you're sued" to "the only platform you'd want to be on when you're sued." I'm Saskia. I'm in court next month. I would pay $5,000 for any of these. I would pay $25,000 for all of them.
