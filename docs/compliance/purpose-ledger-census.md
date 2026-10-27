# Purpose-ledger census: every surface that hands out person-adjacent contact data

**D2e, 2026-10-24. Mechanics only. This is not a compliance declaration.** The purpose codes are
an input for attorney review (see `purpose-taxonomy-attorney-input.md`).

This document lists every place in the server that hands person-adjacent contact data to a
caller or to a model. Each entry says whether that hand-off writes the purpose ledger. The list is
not maintained by hand. It is **derived from source** by `tests/unit/purposeLedgerCensus.test.ts`,
and the test fails whenever the code and the registers in that file disagree. The tables below
are the registers as of commit `8d949e85` plus this lane, generated from that census. **If this
document and the test disagree, the test is right.**

## Summary

| | Count |
|---|---|
| Surfaces that read person-adjacent data (candidates) | **221** |
| Ledgered: they write `purpose_ledger` before returning anything | **6** |
| Covered by the provider-registry chokepoint (`owner_contact_lookup`) | **1** |
| **Debt: unledgered, held in `DEBT`, which may only shrink** | **214** |
| of which hand-read Tier A (known to return contact fields) | 42 |
| of which `review` (they read person-adjacent rows, but no human read has yet established that a contact field is returned) | 172 |

Tier A by proposed surface code: `lead_contact_model` 15 · `lead_contact_read` 12 ·
`lead_contact_bulk` 6 · `lead_contact_api` 5 · `lead_contact_webhook` 2 · `owner_mailing_read` 2.

The two known gaps from the D2e brief are confirmed and quantified:

- **(a) GET reads of a lead and AI tools that expose a lead's phone or email are not ledgered.**
  - `GET /api/leads/:id` (`server/routes-leads.ts:381`) returns the whole lead row, minus tax
    identity.
  - `GET /api/leads`, `/paginated`, `/focus` and `/deleted` return lists of leads.
  - The Pax tools `get_leads`, `get_lead_details`, `get_stale_leads` and `draft_outreach_message`
    (`server/ai/tools.ts`) put `phone`/`email` into the model's context.
  - Skip-trace results are copied onto the lead (`persistTraceResult` → `storage.updateLead`,
    `server/routes-skip-tracing.ts:322`). So every one of these hands out skip-trace-derived
    contact data without a purpose row, even though `GET /api/skip-traces*` is ledgered.
- **(b) Paid doors use compensation, not one transaction.** See
  `purpose-ledger-metering-transaction.md`.

## What counts, and how the population is derived

**A person-adjacent read** is one of the following (`DIRECT_READ` in the test):

- a Drizzle read of `leads`, `skipTraces` or `parcelSnapshots`: `.from(…)` or `db.query.….`;
- a `storage.get|find|search|list…Lead(s)|SkipTrace(s)…(` call;
- the field `ownerAddress`, `mailingAddress` or `ownerMailingAddress`;
- `skipTracingService.trace(`;
- upper-case raw SQL `FROM`/`JOIN` on `leads`, `skip_traces` or `parcel_snapshots`.

Two things are *not* reads:

- a brace-free `.select({ … })` projection that names no contact column, such as
  `select({ count: count() }).from(leads)`;
- seven storage readers whose rows hold no contact field (`NON_CONTACT_READERS`, each with a
  reason; the test checks that every one is still a real call).

**Indirect reads** are followed through the caller's own imports:

- a named function is a reader if it reads directly, calls a reader **in its own file**, or calls
  an imported reader from the **data-access layer** (`server/storage/**`, `server/storage.ts`);
- a surface is a candidate if it reads directly or calls any reader that its file defines or
  imports.

So a chain such as `GET /api/leads/export` → `exportLeadsToCSV` → `wholeBookReads.readAllLeads`
is followed end to end. Each step had to be justified by measurement:

- an unbounded cross-file closure pulled in usage-limit gates, the email sender and the
  credit-pool debit (they read a lead *count*) and grew to 669 readers;
- following only one hop missed the export.

**A surface** is a unit that hands data to a caller or a model. Units are AST spans from the
TypeScript parser, taken after comments are stripped with `tests/helpers/stripComments.ts`:

| Kind | Shape |
|---|---|
| `route` | `<x>.get/post/put/patch/delete/all("/…", …)`: the whole registration, including wrappers and nested callbacks |
| `tool` | MCP `tool("snake", …)`, plus tool-registry objects `{ name, …, handler/execute }`. The name may be a same-file constant; a shorthand `handler,` pulls in the referenced function's body. This covers founder-chat `registerTool` and autopilot `registerHand`. |
| `case` | every clause of a switch with ≥3 snake_case labels. Fall-through labels share the next body. |
| `webhook` | `dispatchWebhookEvent(…, "lead.*", …)`. The payload *is* a lead row. |
| `model` | the nearest named function around an LLM call (`chat.completions.create`, `messages.create/stream`, `tracedLlmCall`, `routeAITask`) that no route, tool or case already holds |

**Registers.** Every candidate is in exactly one register:

- `LEDGERED` (it writes the ledger);
- `COVERED` (provider internals reached only through `providerRegistry.lookup`, which refuses
  without an `owner_contact_lookup` receipt; restricted by regex to `server/services/providers/`);
- `DEBT`.

A candidate in no register fails the test. A register entry with no matching candidate also
fails (it is stale). `DEBT` must equal `DEBT_BASELINE`.

**Vacuity floors:**

- 17 dispatch files, each with its own unit floor. This includes `executeSupportTool`'s 74
  top-level labels, `tools.ts`'s 67 and `mcp/index.ts`'s 29 tools.
- 2 tool-registry directories: 80 founder-chat tools and 8 autopilot hands.
- 5 route files.
- Whole-population floors: ≥160 files, ≥1,500 units, ≥220 candidates.
- A tripwire fails when any file with ≥10 snake_case case labels is not an enumerated member.

## How the gate was falsified

Each mutation was applied, the census test was run, the result read and the change reverted
(`git status` was clean afterwards). Every one went red:

| Mutation | Result |
|---|---|
| M1: append an unledgered route reading `storage.getLead` to a real file (`server/routes-tax-delinquent.ts`) | red: "UNLEDGERED, NOT IN DEBT" |
| M2: remove `releaseSkipTraceResults(` from `GET /api/skip-traces` (`server/routes-leads.ts`) | red: the real-tree verdict |
| M3: the route extractor forgets `post` | red: canary, floors, verdict (7 tests) |
| M4: drop the data-access-layer step from the closure | red: export canary and real verdict (7) |
| M5: switch off projection neutralisation | red: count-only canary and verdict (5) |
| M6: the prefilter loses `ownerMailingAddress` (capital M; the first draft really had this bug and silently dropped `POST /search`) | red: prefilter-superset canary and verdict (4) |
| M7: fall-through case labels dropped | red: canary and per-member floor (3) |
| M8: shorthand `handler,` reference ignored | red: hand canary, verdict and floor (6) |
| M9: comments not stripped | red: the comment-decoy canary (2) |

## Limits: what would have to exist for the census to be green while the defect is present

These are the population's known edges. None of them is a claim that no such surface exists.

1. **Async export jobs.**
   - `POST /api/export/everything` (`server/routes-import-export.ts:882`) enqueues a job.
   - `runExportJob` (`server/services/migrationJobs.ts:1002`) builds the archive.
   - `GET /api/export/jobs/:id/download` streams it.

   None of these units reads leads itself, so none is a candidate. This is a real bulk egress of
   lead contact data, and it is **outside the census**. Proposed code: `lead_contact_bulk`. The
   next widening should add a `job` unit kind.
2. **Cross-file chains of two or more hops that never pass through the data-access layer**
   (surface → service A → service B → `db.select().from(leads)`).
3. **Reads the predicate cannot see:**
   - `storage` reached through an alias;
   - a `db.execute` string built dynamically;
   - lower-case raw SQL;
   - a table reached through a join on a different table.
4. **Egress kinds not modelled:**
   - email or Slack digests built by jobs (for example morning briefs);
   - client-side caches;
   - data a model reads back from its own earlier tool results.
5. **Over-inclusion, the safe direction.**
   - String literals are not stripped, so code-like text inside a prompt can make a unit look
     like a read.
   - A switch with ≥3 snake_case labels counts as a dispatch switch even when it is a state
     machine.

   These cases inflate `review`. They do not hide anything.
6. **`review` is not "exempt".** It means "reads person-adjacent rows; egress of a contact field
   not established". Each one either gets ledgered or is removed by narrowing the predicate with
   evidence. Both lower the baseline.

## Notable results the census establishes

- **`executeSupportTool`** (`server/ai/supportAgent.ts`, 74 top-level cases plus 17 nested), the
  switch a model drives while talking to a paying customer, reads `leads` **only as counts or
  existence checks**. Its candidates are all `review` (counts, integrity checks, usage
  summaries). None is Tier A.
- **The provider registry** is the only path to the `owner_info` vendor case. No production file
  outside `server/services/providers/` calls a `…Provider.lookup(` directly; the test pins this.
- **A receipt is now proof that a row was written** (this lane, `server/services/purposeLedger.ts`).
  `isReceipt` accepts only receipts that `recordPurpose` issued in this process. A hand-typed or
  copied `{ ledgerId, surface }` is refused by `skipTracingService.trace()` and
  `providerRegistry.lookup()`. Before this change, any caller could build a literal receipt and
  reach the vendor without writing a row.

## Tier A: unledgered surfaces known to return contact data, plus the ledgered and covered ones

"What it returns" is from a human read of the handler (2026-10-24).

| # | Surface (file:line) | Kind | Unit | What it returns | Ledgered | Surface code (proposed when unledgered) |
|---|---|---|---|---|---|---|
| 1 | `server/ai/executive.ts:1741` | model | `model:processChatStream` | Executive chat stream: runs `executeTool` (the Pax tools below) and feeds results back into the model | no | `lead_contact_model` |
| 2 | `server/ai/tools.ts:3101` | case | `case:draft_outreach_message` | Pax tool: reads the lead (name, contact) into the drafting prompt and returns the draft to the model | no | `lead_contact_model` |
| 3 | `server/ai/tools.ts:1548` | case | `case:get_lead_details` | Pax tool: one lead's full record to the model (phone, email, address) | no | `lead_contact_model` |
| 4 | `server/ai/tools.ts:1503` | case | `case:get_leads` | Pax tool: lead list to the model with `email`, `phone` | no | `lead_contact_model` |
| 5 | `server/ai/tools.ts:3064` | case | `case:get_stale_leads` | Pax tool: stale-lead list (names, contact) to the model | no | `lead_contact_model` |
| 6 | `server/ai/tools.ts:2952` | case | `case:schedule_follow_up` | Pax tool: reads the lead to schedule; lead identity in the result | no | `lead_contact_model` |
| 7 | `server/ai/tools.ts:2378` | case | `case:send_email` | Pax tool: reads the lead's email to send; recipient in the result the model sees | no | `lead_contact_model` |
| 8 | `server/ai/tools.ts:2462` | case | `case:send_sms` | Pax tool: reads the lead's phone to send; recipient in the result | no | `lead_contact_model` |
| 9 | `server/ai/tools.ts:1559` | case | `case:update_lead_status` | Pax tool: reads and returns the updated lead | no | `lead_contact_model` |
| 10 | `server/api-v1/leads.ts:97` | route | `route:GET /` | Public API v1: paged leads through `serializeLead` (email, phone, address) | no | `lead_contact_api` |
| 11 | `server/api-v1/leads.ts:181` | route | `route:GET /:id` | Public API v1: one lead through `serializeLead` | no | `lead_contact_api` |
| 12 | `server/api-v1/leads.ts:166` | webhook | `webhook:lead.created` | Outbound public webhook: `serializeLead(created)`, with email, phone, address | no | `lead_contact_webhook` |
| 13 | `server/api-v1/leads.ts:230` | webhook | `webhook:lead.updated` | Outbound public webhook: `serializeLead(updated)`, with email, phone, address | no | `lead_contact_webhook` |
| 14 | `server/index.ts:494` | route | `route:POST /mcp` | MCP transport mount: serves the MCP tools (`search_leads`, …) to a third-party client | no | `lead_contact_api` |
| 15 | `server/mcp-server.ts:92` | case | `case:get_leads` | Legacy MCP server tool: leads to the client | no | `lead_contact_api` |
| 16 | `server/mcp/index.ts:539` | tool | `tool:search_leads` | MCP tool: leads with `email`, `phone` to a third-party AI client | no | `lead_contact_api` |
| 17 | `server/routes-due-diligence.ts:184` | route | `route:GET /:propertyId/owner` | Owner research: owner name from parcel data, with out-of-state inference from the owner mailing address | no | `owner_mailing_read` |
| 18 | `server/routes-enhancements.ts:53` | route | `route:GET /api/enhancements/lead-duplicates` | Duplicate clusters keyed by `email` / `phone` values (raw SQL) | no | `lead_contact_read` |
| 19 | `server/routes-import-export.ts:593` | route | `route:GET /api/compliance/tcpa/no-consent` | Full lead rows lacking consent (`res.json(leads)`) | no | `lead_contact_read` |
| 20 | `server/routes-import-export.ts:604` | route | `route:GET /api/compliance/tcpa/opted-out` | Full lead rows that opted out | no | `lead_contact_read` |
| 21 | `server/routes-import-export.ts:470` | route | `route:GET /api/export/:entityType` | Legacy CSV/JSON export of every lead (deprecated route, still served) | no | `lead_contact_bulk` |
| 22 | `server/routes-import-export.ts:416` | route | `route:GET /api/export/backup` | Backup ZIP: every lead as CSV | no | `lead_contact_bulk` |
| 23 | `server/routes-leads.ts:178` | route | `route:GET /api/leads` | Every lead row (phone, email, address) | no | `lead_contact_read` |
| 24 | `server/routes-leads.ts:381` | route | `route:GET /api/leads/:id` | One lead row minus tax identity (phone, email, address); gap (a) | no | `lead_contact_read` |
| 25 | `server/routes-leads.ts:372` | route | `route:GET /api/leads/export` | CSV: First/Last Name, Email, Phone, Address of every lead | no | `lead_contact_bulk` |
| 26 | `server/routes-leads.ts:305` | route | `route:GET /api/leads/focus` | Prioritised leads with contact fields | no | `lead_contact_read` |
| 27 | `server/routes-leads.ts:248` | route | `route:GET /api/leads/paginated` | Paged lead rows | no | `lead_contact_read` |
| 28 | `server/routes-leads.ts:2098` | route | `route:GET /api/skip-traces` | Stored trace results released through `releaseSkipTraceResults` | **yes** | `skip_trace_result_read` |
| 29 | `server/routes-leads.ts:2108` | route | `route:GET /api/skip-traces/:id` | Same, one trace | **yes** | `skip_trace_result_read` |
| 30 | `server/routes-leads.ts:2120` | route | `route:GET /api/skip-traces/lead/:leadId` | Same, by lead | **yes** | `skip_trace_result_read` |
| 31 | `server/routes-leads.ts:2132` | route | `route:POST /api/skip-traces` | Vendor trace through `recordPurpose` + `skipTracingService.trace(…, receipt)` | **yes** | `skip_trace_call` |
| 32 | `server/routes-platform-features.ts:577` | route | `route:GET /api/data/export` | Full data export (`generateFullExport`), leads included | no | `lead_contact_bulk` |
| 33 | `server/routes-platform-features.ts:545` | route | `route:POST /api/export/full` | Full data export, leads included | no | `lead_contact_bulk` |
| 34 | `server/routes-privacy-dsar.ts:151` | route | `route:POST /api/founder/dsar/:id/generate-export` | Data-subject export (founder-only). Likely its own permissible purpose; attorney question | no | `lead_contact_bulk` |
| 35 | `server/routes-skip-tracing.ts:461` | route | `route:POST /batch` | Batch vendor trace, one purpose row per lead | **yes** | `skip_trace_call` |
| 36 | `server/routes-skip-tracing.ts:352` | route | `route:POST /trace/:leadId` | Single vendor trace, purpose row with `metering_ref` | **yes** | `skip_trace_call` |
| 37 | `server/routes-tax-delinquent.ts:21` | route | `route:GET /` | Tax-delinquent pipeline: full `leads` rows (`select().from(leads)`) | no | `lead_contact_read` |
| 38 | `server/routes-tax-delinquent.ts:59` | route | `route:GET /:id` | Tax-delinquent pipeline: one full lead row | no | `lead_contact_read` |
| 39 | `server/routes-title-search.ts:17` | route | `route:POST /search` | Title search: `ownerMailingAddress` of the parcel owner | no | `owner_mailing_read` |
| 40 | `server/routes-va-engine.ts:412` | route | `route:GET /api/seller-communications/lead/:leadId` | Correspondence with the lead (addresses and numbers in the messages) | no | `lead_contact_read` |
| 41 | `server/routes.ts:1262` | route | `route:GET /api/leads/deleted` | Soft-deleted lead rows | no | `lead_contact_read` |
| 42 | `server/routes.ts:931` | route | `route:GET /api/search` | Global search: leads `firstName`, `lastName`, `email`, `phone`, `address` (raw SQL, `fullTextSearch.ts:264`) | no | `lead_contact_read` |
| 43 | `server/services/autopilot/hands/send-sms.ts:77` | tool | `tool:send_sms` | Autopilot hand: reads the lead's phone to send an SMS; model-chosen action | no | `lead_contact_model` |
| 44 | `server/services/core-agents.ts:714` | case | `case:compose_email` | Core agent: lead record into the composition prompt | no | `lead_contact_model` |
| 45 | `server/services/core-agents.ts:717` | case | `case:compose_sms` | Core agent: lead record into the composition prompt | no | `lead_contact_model` |
| 46 | `server/services/core-agents.ts:726` | case | `case:draft_response` | Core agent: lead and correspondence into the prompt | no | `lead_contact_model` |
| 47 | `server/services/core-agents.ts:554` | case | `case:generate_offer` | Core agent: seller (lead) identity into the offer prompt | no | `lead_contact_model` |
| 48 | `server/services/core-agents.ts:720` | case | `case:nurture_lead` | Core agent: lead record into the nurture prompt | no | `lead_contact_model` |
| 49 | `server/services/providers/batchdata-provider.ts:124` | case | `case:owner_info` | Vendor provider case: owner info, including mailing address; reachable only via the registry | yes (registry chokepoint) | `owner_contact_lookup` |

## `review`: 172 unledgered surfaces that read person-adjacent rows

Each surface below reads lead rows, stored traces or parcel-owner addresses, directly or through the named function. A human read has not yet established whether a contact field leaves the server. Most are aggregates, dashboards, scoring and mutations that echo the caller's own write. Each one is either ledgered, or narrowed out of the predicate with evidence. Proposed code once read: `lead_contact_read`, unless noted otherwise.

| # | Surface (file:line) | Kind | Unit | Reaches the data via | Ledgered |
|---|---|---|---|---|---|
| 1 | `server/ai/supportAgent.ts:1689` | case | `case:check_data_integrity` | direct | no |
| 2 | `server/ai/supportAgent.ts:3581` | case | `case:detect_data_integrity_issues` | detectDataIntegrityIssues | no |
| 3 | `server/ai/supportAgent.ts:3565` | case | `case:predict_user_issues` | predictUserIssues | no |
| 4 | `server/ai/tools.ts:2160` | case | `case:create_properties_batch` | lookupParcelByAPN | no |
| 5 | `server/ai/tools.ts:1874` | case | `case:create_property` | lookupParcelByAPN | no |
| 6 | `server/ai/tools.ts:1761` | case | `case:get_system_context` | getSystemContext | no |
| 7 | `server/ai/vaService.ts:576` | case | `case:create_lead` | executeTool | no |
| 8 | `server/ai/vaService.ts:569` | case | `case:update_lead_status` | executeTool | no |
| 9 | `server/ai/vaService.ts:972` | case | `case:update_lead_status#2` | executeUpdateLeadStatus | no |
| 10 | `server/mcp-server.ts:138` | case | `case:get_portfolio_summary` | direct | no |
| 11 | `server/mcp/index.ts:607` | tool | `tool:get_portfolio_summary` | direct | no |
| 12 | `server/routes-accounting.ts:336` | route | `route:POST /1098-batch` | generate1098Batch | no |
| 13 | `server/routes-admin.ts:4569` | route | `route:GET /api/admin/beta-analytics` | getUserTimelines | no |
| 14 | `server/routes-admin.ts:4672` | route | `route:GET /api/founder/leading-indicators` | computeLeadingIndicators | no |
| 15 | `server/routes-ai-draft.ts:72` | route | `route:POST /draft-reply` | direct | no |
| 16 | `server/routes-ai-operations.ts:651` | route | `route:POST /buyer-matching/match` | matchPropertyToBuyers | no |
| 17 | `server/routes-ai-operations.ts:211` | route | `route:POST /intent/predict` | predictIntent | no |
| 18 | `server/routes-ai-operations.ts:337` | route | `route:POST /patterns/analyze` | extractPattern | no |
| 19 | `server/routes-ai.ts:1736` | route | `route:POST /api/va/actions/:id/approve` | executeAgentAction | no |
| 20 | `server/routes-ai.ts:1836` | route | `route:POST /api/va/actions/:id/execute` | executeAgentAction | no |
| 21 | `server/routes-ai.ts:1879` | route | `route:POST /api/va/briefings/generate` | generateBriefing | no |
| 22 | `server/routes-analytics.ts:491` | route | `route:GET /api/analytics/cohort-dashboard` | direct | no |
| 23 | `server/routes-analytics.ts:166` | route | `route:GET /api/analytics/team-kpi` | direct | no |
| 24 | `server/routes-analytics.ts:402` | route | `route:GET /api/analytics/team-leaderboard` | direct | no |
| 25 | `server/routes-borrower.ts:1679` | route | `route:GET /api/borrower/payoff-quote` | direct | no |
| 26 | `server/routes-borrower.ts:2028` | route | `route:GET /api/borrower/periodic-statements/:statementId/pdf` | direct | no |
| 27 | `server/routes-borrower.ts:648` | route | `route:GET /api/borrower/session` | direct | no |
| 28 | `server/routes-borrower.ts:1799` | route | `route:GET /api/borrower/statements/generate` | direct | no |
| 29 | `server/routes-borrower.ts:582` | route | `route:POST /api/borrower/auth/exchange` | direct | no |
| 30 | `server/routes-borrower.ts:743` | route | `route:POST /api/borrower/payment` | direct | no |
| 31 | `server/routes-borrower.ts:474` | route | `route:POST /api/borrower/verify` | direct | no |
| 32 | `server/routes-borrower.ts:1102` | route | `route:POST /api/borrower/verify-payment` | postBorrowerPortalCheckoutPayment | no |
| 33 | `server/routes-borrower.ts:1591` | route | `route:POST /api/portal/:accessToken/autopay` | direct | no |
| 34 | `server/routes-borrower.ts:851` | route | `route:POST /api/portal/:accessToken/payment` | direct | no |
| 35 | `server/routes-buyer-qualification.ts:171` | route | `route:GET /:id/report` | generateQualificationReport | no |
| 36 | `server/routes-buyer-qualification.ts:158` | route | `route:POST /:id/assess` | generateAssessment | no |
| 37 | `server/routes-buyer-qualification.ts:132` | route | `route:POST /:id/background` | runBackgroundChecks | no |
| 38 | `server/routes-campaigns.ts:75` | route | `route:GET /api/campaigns/overlap-report` | generateOverlapReport | no |
| 39 | `server/routes-campaigns.ts:723` | route | `route:GET /api/leads/:id/enrollments` | direct | no |
| 40 | `server/routes-campaigns.ts:1340` | route | `route:POST /api/campaigns/:id/pre-send-check` | runPreMailDedupe | no |
| 41 | `server/routes-campaigns.ts:758` | route | `route:POST /api/campaigns/:id/send-direct-mail` | direct | no |
| 42 | `server/routes-campaigns.ts:2188` | route | `route:POST /api/campaigns/:id/send-email` | direct | no |
| 43 | `server/routes-campaigns.ts:2563` | route | `route:POST /api/campaigns/:id/send-sms` | direct | no |
| 44 | `server/routes-campaigns.ts:1822` | route | `route:POST /api/direct-mail/bulk-verify-addresses` | direct | no |
| 45 | `server/routes-campaigns.ts:1709` | route | `route:POST /api/direct-mail/estimate` | direct | no |
| 46 | `server/routes-campaigns.ts:627` | route | `route:POST /api/sequences/:id/enroll` | direct | no |
| 47 | `server/routes-closing.ts:138` | route | `route:POST /api/deals/:id/closing-package` | generateWarrantyDeed | no |
| 48 | `server/routes-communications.ts:1169` | route | `route:POST /api/workflows/:id/test` | testWorkflow | no |
| 49 | `server/routes-contract-chain.ts:226` | route | `route:GET /api/deals/:id/contract-preview` | gatherAndAssemble | no |
| 50 | `server/routes-contract-chain.ts:295` | route | `route:POST /api/deals/:id/contract` | gatherAndAssemble | no |
| 51 | `server/routes-core-ai.ts:399` | route | `route:POST /api/communications/send` | direct | no |
| 52 | `server/routes-customer-letter.ts:53` | route | `route:POST /generate` | generateCustomerLetter | no |
| 53 | `server/routes-dashboard.ts:125` | route | `route:GET /api/dashboard/intelligence` | direct | no |
| 54 | `server/routes-data-intelligence.ts:746` | route | `route:GET /lead-intelligence/batch` | batchScoreLeadsForOrg | no |
| 55 | `server/routes-data-intelligence.ts:1197` | route | `route:GET /prospect/:leadId` | direct | no |
| 56 | `server/routes-deal-patterns.ts:21` | route | `route:POST /extract/:dealId` | recordPatternFromClosedDeal | no |
| 57 | `server/routes-deals.ts:2525` | route | `route:GET /api/deals/:id/report` | generateDueDiligenceReport | no |
| 58 | `server/routes-deals.ts:183` | route | `route:GET /api/deals/coach` | getDealCoachForOrg | no |
| 59 | `server/routes-deals.ts:2117` | route | `route:GET /api/properties/:id/report` | generateDueDiligenceReport | no |
| 60 | `server/routes-deals.ts:2143` | route | `route:GET /api/properties/:id/report/pdf` | direct | no |
| 61 | `server/routes-deals.ts:2668` | route | `route:POST /api/deals/:id/offer-letter-pdf` | direct | no |
| 62 | `server/routes-deals.ts:1973` | route | `route:POST /api/due-diligence/:propertyId/lookup/tax` | lookupParcelByAPN | no |
| 63 | `server/routes-deals.ts:741` | route | `route:PUT /api/deals/:id` | recordPatternFromClosedDeal | no |
| 64 | `server/routes-doc-system.ts:825` | route | `route:GET /api/documents/resolve-context` | resolveContextVariables | no |
| 65 | `server/routes-doc-system.ts:1669` | route | `route:POST /api/document-packages/:id/generate-all` | resolveContextVariables | no |
| 66 | `server/routes-doc-system.ts:877` | route | `route:POST /api/generated-documents` | resolveContextVariables | no |
| 67 | `server/routes-documents.ts:63` | route | `route:GET /api/notes/:id/document` | generatePromissoryNote | no |
| 68 | `server/routes-documents.ts:98` | route | `route:GET /api/properties/:id/deed` | generateWarrantyDeed | no |
| 69 | `server/routes-documents.ts:389` | route | `route:POST /api/documents/generate` | direct | no |
| 70 | `server/routes-documents.ts:300` | route | `route:POST /api/documents/generate/promissory-note` | generatePromissoryNote | no |
| 71 | `server/routes-documents.ts:207` | route | `route:POST /api/documents/generate/settlement-statement` | generateSettlementStatement | no |
| 72 | `server/routes-documents.ts:340` | route | `route:POST /api/documents/generate/warranty-deed` | generateWarrantyDeed | no |
| 73 | `server/routes-documents.ts:140` | route | `route:POST /api/documents/offer-letter` | generateOfferLetter | no |
| 74 | `server/routes-due-diligence.ts:95` | route | `route:POST /:id/run` | runDossierPod | no |
| 75 | `server/routes-enhancements.ts:65` | route | `route:GET /api/enhancements/aging-leads` | getAgingLeads | no |
| 76 | `server/routes-enhancements.ts:78` | route | `route:GET /api/enhancements/lead-score-explanation/:id` | direct | no |
| 77 | `server/routes-enhancements.ts:272` | route | `route:GET /api/enhancements/signup-funnel` | getSignupFunnel | no |
| 78 | `server/routes-epic-services.ts:41` | route | `route:GET /seller-motivation/:leadId` | direct | no |
| 79 | `server/routes-epic-services.ts:129` | route | `route:POST /seller-motivation/rescore-org` | rescoreLeadsForOrg | no |
| 80 | `server/routes-field-scout.ts:381` | route | `route:GET /field-scout/visits` | direct | no |
| 81 | `server/routes-field-scout.ts:53` | route | `route:GET /properties/parcel-lookup` | lookupParcelByCoordinates | no |
| 82 | `server/routes-field-scout.ts:176` | route | `route:POST /leads/:id/photos` | direct | no |
| 83 | `server/routes-finance.ts:1558` | route | `route:GET /api/finance/ltv-report` | getOrgLTVReport | no |
| 84 | `server/routes-finance.ts:1653` | route | `route:GET /api/finance/ltv/:noteId` | getLTVSnapshot | no |
| 85 | `server/routes-finance.ts:1570` | route | `route:GET /api/notes/:id/schedule/pdf` | direct | no |
| 86 | `server/routes-finance.ts:960` | route | `route:POST /api/finance/process` | processOrganizationNotes | no |
| 87 | `server/routes-finance.ts:829` | route | `route:POST /api/notes/:id/dunning` | sendManualReminder | no |
| 88 | `server/routes-finance.ts:662` | route | `route:POST /api/notes/:id/send-reminder` | sendManualReminder | no |
| 89 | `server/routes-finance.ts:1383` | route | `route:POST /api/payments` | postServicedNotePayment | no |
| 90 | `server/routes-import-export.ts:800` | route | `route:GET /api/compliance/tcpa/stats` | direct | no |
| 91 | `server/routes-import-export.ts:620` | route | `route:PATCH /api/leads/:id/consent` | direct | no |
| 92 | `server/routes-import-export.ts:317` | route | `route:POST /api/import/:entityType` | importLeads | no |
| 93 | `server/routes-inbound-email.ts:53` | route | `route:POST /api/webhooks/inbound-email` | processInboundEmail | no |
| 94 | `server/routes-land-data.ts:115` | route | `route:GET /api/land-data/parcel-lookup` | findOwnedParcelRow | no |
| 95 | `server/routes-land-data.ts:101` | route | `route:GET /api/land-data/parcels/:parcelKey` | findOwnedParcelByKey | no |
| 96 | `server/routes-lead-enrichment.ts:59` | route | `route:GET /:id/completeness` | direct | no |
| 97 | `server/routes-lead-enrichment.ts:20` | route | `route:POST /:id/enrich` | enrichLead | no |
| 98 | `server/routes-lead-enrichment.ts:35` | route | `route:POST /bulk-enrich` | batchEnrichLeads | no |
| 99 | `server/routes-leads.ts:790` | route | `route:DELETE /api/leads/:id` | direct | no |
| 100 | `server/routes-leads.ts:1031` | route | `route:GET /api/leads/:id/activities` | direct | no |
| 101 | `server/routes-leads.ts:1170` | route | `route:GET /api/leads/:id/deal-state` | direct | no |
| 102 | `server/routes-leads.ts:1143` | route | `route:GET /api/leads/:id/properties` | direct | no |
| 103 | `server/routes-leads.ts:348` | route | `route:GET /api/leads/aging` | getAgingLeads | no |
| 104 | `server/routes-leads.ts:360` | route | `route:GET /api/leads/duplicate-clusters` | findDuplicateClusters | no |
| 105 | `server/routes-leads.ts:342` | route | `route:GET /api/leads/insights` | getLeadInsights | no |
| 106 | `server/routes-leads.ts:828` | route | `route:PATCH /api/leads/:id/restore` | direct | no |
| 107 | `server/routes-leads.ts:441` | route | `route:POST /api/leads` | enrichLead | no |
| 108 | `server/routes-leads.ts:1377` | route | `route:POST /api/leads/:id/betty-score` | scoreLead | no |
| 109 | `server/routes-leads.ts:1056` | route | `route:POST /api/leads/:id/contact-event` | direct | no |
| 110 | `server/routes-leads.ts:1194` | route | `route:POST /api/leads/:id/convert-to-deal` | direct | no |
| 111 | `server/routes-leads.ts:1488` | route | `route:POST /api/leads/:id/nurture` | direct | no |
| 112 | `server/routes-leads.ts:1355` | route | `route:POST /api/leads/:id/score` | direct | no |
| 113 | `server/routes-leads.ts:1397` | route | `route:POST /api/leads/batch-score` | batchScoreLeads | no |
| 114 | `server/routes-leads.ts:883` | route | `route:POST /api/leads/bulk-delete` | direct | no |
| 115 | `server/routes-leads.ts:930` | route | `route:POST /api/leads/bulk-update` | direct | no |
| 116 | `server/routes-leads.ts:394` | route | `route:POST /api/leads/check-duplicates` | direct | no |
| 117 | `server/routes-leads.ts:1674` | route | `route:POST /api/leads/csv-import` | loadOutreachSuppression | no |
| 118 | `server/routes-leads.ts:1564` | route | `route:POST /api/leads/import` | importLeads | no |
| 119 | `server/routes-leads.ts:1925` | route | `route:POST /api/leads/import/tax-delinquent` | loadOutreachSuppression | no |
| 120 | `server/routes-leads.ts:691` | route | `route:PUT /api/leads/:id` | direct | no |
| 121 | `server/routes-lifecycle.ts:237` | route | `route:POST /api/founder/pre-churn/sweep` | direct | no |
| 122 | `server/routes-micro-features.ts:254` | route | `route:GET /api/dashboard/priority` | getTopPriority | no |
| 123 | `server/routes-micro-features.ts:102` | route | `route:GET /api/properties/:id/neighbors` | direct | no |
| 124 | `server/routes-misc.ts:125` | route | `route:GET /api/leads/:id/suggested-response` | generateSuggestedResponse | no |
| 125 | `server/routes-misc.ts:142` | route | `route:POST /api/check-hot-leads` | checkForHotLeads | no |
| 126 | `server/routes-misc.ts:292` | route | `route:POST /api/leads/:leadId/sms` | direct | no |
| 127 | `server/routes-misc.ts:209` | route | `route:POST /api/sms/send` | sendOrgSMS | no |
| 128 | `server/routes-misc.ts:953` | route | `route:POST /api/webhooks/twilio/sms` | processOptKeyword | no |
| 129 | `server/routes-notes.ts:3281` | route | `route:POST /api/notes/from-deal/:dealId` | direct | no |
| 130 | `server/routes-onboarding.ts:42` | route | `route:POST /complete` | seedSampleDataForOrg | no |
| 131 | `server/routes-organization.ts:1532` | route | `route:GET /api/recent-items` | direct | no |
| 132 | `server/routes-organization.ts:1415` | route | `route:GET /api/team/performance` | getTeamLeadMetrics | no |
| 133 | `server/routes-organization.ts:1906` | route | `route:POST /api/organization/invitations/accept` | direct | no |
| 134 | `server/routes-outreach-mail.ts:614` | route | `route:POST /api/outreach/mail/preview` | resolveAudience | no |
| 135 | `server/routes-outreach-mail.ts:651` | route | `route:POST /api/outreach/mail/queue` | resolveAudience | no |
| 136 | `server/routes-outreach-mail.ts:569` | route | `route:POST /api/outreach/mail/quote` | resolveAudience | no |
| 137 | `server/routes-owner-optout.ts:41` | route | `route:POST /api/public/owner-optout` | submitOwnerOptOut | no |
| 138 | `server/routes-pax-controls.ts:388` | route | `route:GET /controls` | buildControls | no |
| 139 | `server/routes-pax-controls.ts:618` | route | `route:PATCH /controls` | buildControls | no |
| 140 | `server/routes-pax-controls.ts:468` | route | `route:POST /pause` | buildControls | no |
| 141 | `server/routes-pax-controls.ts:532` | route | `route:POST /resume` | buildControls | no |
| 142 | `server/routes-pax-insights.ts:85` | route | `route:GET /insights` | direct | no |
| 143 | `server/routes-pax-insights.ts:283` | route | `route:GET /pax-suggestions` | direct | no |
| 144 | `server/routes-platform-features.ts:533` | route | `route:GET /api/pipeline/attribution` | computeAttributionROI | no |
| 145 | `server/routes-properties.ts:130` | route | `route:GET /api/properties/:id/report.pdf` | generatePropertyReport | no |
| 146 | `server/routes-properties.ts:984` | route | `route:POST /api/parcels/lookup` | lookupParcelByAPN | no |
| 147 | `server/routes-properties.ts:1098` | route | `route:POST /api/properties/:id/fetch-parcel` | lookupParcelByAPN | no |
| 148 | `server/routes-properties.ts:1137` | route | `route:POST /api/properties/fetch-all-parcels` | lookupParcelByAPN | no |
| 149 | `server/routes-public-land.ts:152` | route | `route:GET /api/public/land/county-guide/:state/:county` | getCountyGuide | no |
| 150 | `server/routes-public-land.ts:162` | route | `route:GET /land/:state/:county` | getCountyGuide | no |
| 151 | `server/routes-seller-intent.ts:55` | route | `route:GET /:leadId` | predictIntent | no |
| 152 | `server/routes-seller-intent.ts:95` | route | `route:GET /:leadId/engagement` | analyzeEngagementSignals | no |
| 153 | `server/routes-seller-intent.ts:121` | route | `route:POST /:leadId/approach` | predictIntent | no |
| 154 | `server/routes-seller-intent.ts:141` | route | `route:POST /:leadId/offer-range` | predictIntent | no |
| 155 | `server/routes-skip-tracing.ts:597` | route | `route:GET /stats` | direct | no |
| 156 | `server/routes-support-tickets.ts:133` | route | `route:POST /api/support/tickets/:id/messages` | processSupportChat | no |
| 157 | `server/routes-tax-certificates.ts:227` | route | `route:POST /api/tax-certificates` | direct | no |
| 158 | `server/routes-tax-researcher.ts:885` | route | `route:POST /listings/:id/bid-log` | handoffWonLotToCertificate | no |
| 159 | `server/routes-tax-researcher.ts:796` | route | `route:POST /listings/:id/won-certificate` | handoffWonLotToCertificate | no |
| 160 | `server/routes-team-messaging.ts:555` | route | `route:POST /api/offer-letters/batch` | direct | no |
| 161 | `server/routes-today.ts:1273` | route | `route:GET /` | buildActiveQueue | no |
| 162 | `server/routes-today.ts:1644` | route | `route:POST /queue/clear` | buildActiveQueue | no |
| 163 | `server/routes-trust-checks.ts:21` | route | `route:GET /api/deals/:id/fraud-check` | fraudCheckForDeal | no |
| 164 | `server/routes.ts:2322` | route | `route:POST /api/import/auto-delinquent` | scrapeCountyDelinquentList | no |
| 165 | `server/routes.ts:1104` | route | `route:POST /api/leads/:id/mark-contacted` | direct | no |
| 166 | `server/routes.ts:1194` | route | `route:POST /api/leads/:id/record-contact` | direct | no |
| 167 | `server/routes.ts:1074` | route | `route:POST /api/leads/bulk-delete/preview` | direct | no |
| 168 | `server/services/core-agents.ts:894` | case | `case:run_digest` | runDigest | no |
| 169 | `server/services/outcomeVerificationLoop.ts:154` | case | `case:send_follow_up` | verifyFollowUp | no |
| 170 | `server/services/workflow-engine.ts:2548` | case | `case:conditional` | executeAction | no |
| 171 | `server/services/workflow-engine.ts:2533` | case | `case:send_email#2` | executeSendEmail | no |
| 172 | `server/services/workflow-engine.ts:2537` | case | `case:update_record#2` | executeUpdateRecord | no |

## Keeping this current

- **Ledgering a surface:** wire `recordPurpose` / `releaseSkipTraceResults` into it (see
  `INTEGRATION-D2e.md` for the exact patches). Move its key from `DEBT` to `LEDGERED` and lower
  `DEBT_BASELINE` in the same commit.
- **A new surface that reads person-adjacent data** turns the census red with the exact line to
  add. Ledger it, or add it to `DEBT` and raise the baseline. Raising the baseline is a reviewed
  exception: the register is meant to shrink.
- **Regenerating this document:** the tables are a projection of the test's registers. Run the
  test, then project `DEBT`/`LEDGERED`/`COVERED` with the unit lines. The test is the source of
  truth.
