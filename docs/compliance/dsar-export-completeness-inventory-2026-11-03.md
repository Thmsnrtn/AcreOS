# DSAR export completeness — ground-truth category inventory (read-only)

**Legal-run Leg 2, sub-leg 2.4, decision-independent part (2026-11-03).**
DRAFT — PREPARED FOR ATTORNEY REVIEW. This inventory builds nothing and decides nothing. It lists
where a data subject's rows live, per category, so that the export can be completed once the
canonical pipeline (Q-C1), the populations and controller/processor split (Q-D1) and the clock
(Q-C2) are decided. Every controller/processor tag is **PENDING Q-D1**.

**How it was produced.** Read from a database built from this repository
(`scripts/ci/build-schema-from-repo.sh` at `f7f2e3f`), by column and table name: tables with a
`lead_id` column, tables keyed to a user, and tables whose names match each category. That is a
schema reading, not a per-handler reading. A table named here is a place to look. Whether it holds
the subject's personal data, and under which key, has to be confirmed table by table when the
export is built. The registry the finding asks for (2.4: "new tables join by registration") is
the build step, and this list is its starting population.

## What the current export returns

`gdprService.exportUserData(userId)` returns the `users` row (minus password), plus:

- `leads`, `deals` and `tasks` where `assignedTo` is one of the user's `team_members` ids;
- `team_messages` the user sent;
- `support_tickets`.

`properties` is hard-coded `[]`. The code comment says `properties` has no per-user column. That is
Finding E1, and it is unchanged here. Nothing else below is in the export today.

## Categories the finding names

| Category | Where the rows live (schema reading) | Subject key | In today's export? |
|---|---|---|---|
| Properties | `properties` (org-scoped; no per-user column) | org; no per-user linkage | **No** (hard-coded `[]`) |
| Notes | `notes` (legacy), `lead_activities` (note-type activity), `agent_memory_notes` | `lead_id` / org | No |
| Consent events | `lead_consent_events`, `signing_consent_audit` | `lead_id` / signer | No |
| Comms: email | `lead_emails`, `outbound_email_log`, `inbox_messages`, `unattached_inbound_messages`, `seller_communications` | `lead_id` / address | No |
| Comms: SMS / chat | `lead_activities` (`communication_sms`), `borrower_messages`, `conversations`, `messages`, `negotiation_threads` | `lead_id` / borrower | No |
| Call recordings / transcripts | `call_transcripts`, `ai_call_log` | `lead_id` | No |
| Skip-trace artefacts | `skip_traces`, `purpose_ledger` (append-only, retained under Art. 17(3)(b)) | `lead_id` | No |
| Document-store objects | `generated_documents`, `deal_room_documents`, `document_versions`, `lead_photos`, `field_scout_photos`, and bytes under S3 `org/<orgId>/` (store dormant unless `DOCUMENTS_S3_BUCKET` is set) | `lead_id` / org | No |

## Lead-keyed tables (every `lead_id` column in the built schema, 34)

`borrower_payment_profiles`, `buyer_prequalifications`, `buyer_profiles`, `call_transcripts`,
`campaign_delivery_events`, `campaign_leads`, `campaign_responses`, `conversations`,
`escalation_alerts`, `field_scout_photos`, `field_scout_visits`, `generated_documents`,
`inbox_messages`, `lead_activities`, `lead_consent_events`, `lead_conversions`, `lead_emails`,
`lead_photos`, `lead_qualification_signals`, `lead_score_history`, `mail_shipment_pieces`,
`mailing_order_pieces`, `negotiation_threads`, `offer_letters`, `offers`, `outreach_ab_outcomes`,
`parcel_alerts`, `pax_drafts`, `purpose_ledger`, `seller_communications`,
`seller_intent_predictions`, `sequence_enrollments`, `skip_traces`, `va_tasks`.

For a lead data subject, which is the customers'-leads population in Q-D1, these are the first
population a complete export must read. The current export reads none of them.

## User-keyed tables

There are 93 user-keyed columns in the built schema (`user_id`, `actor_user_id`, `sender_id`,
`created_by`, `placed_by`, `uploaded_by` and similar). The export reads two of them
(`team_messages.sender_id`, `support_tickets.user_id`). The full column list comes from the query
in this file's history:

```sql
SELECT c.table_name || '.' || c.column_name
FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  AND c.column_name IN ('user_id','actor_user_id','sender_id','created_by','placed_by',
                        'uploaded_by','owner_user_id','requester_user_id')
ORDER BY 1;
```

## Not decided here (Tom-blockers B-1 to B-3)

- Which pipeline's export becomes canonical (Q-C1).
- Which populations a request can come from, and the controller/processor tag per category
  (Q-D1).
- Whether `properties` gets a per-user linkage or counsel approves a stated alternative basis.
  That is the decision record's call (2.1).
