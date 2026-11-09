# Wholesale §6.2 seller follow-up drafts: Step 0 inventory

**Date:** 2026-11-09 (Step 0 only. No build code was written.)
**Branch:** `claude/wholesale-62-drafts-api`, stacked on #477's tip (`60fed37e4`, which merges origin/main into `claude/wholesale-leg4-disposition`).
**Slice:** the completeness debt on Wholesale Leg 4 that audit-pr477-2026-11-07 item 4 records: "§6.2's seller-side follow-up *drafts* do not appear anywhere in this PR."
**Governing text:** package §6.2 ("drafts only … follow-up drafts prepared in the operator's voice on the deal record … prepared-not-sent"), §7.2 (provenance), §7.3 (copy honesty), §7.4 ("§6.2's seller follow-ups are drafts on a record"), §7.6 (created, never edited), §8.4.17 ("creating seller follow-up drafts writes only the draft records; the email/SMS send surfaces' call counts are zero"), §9 (no gap-15 engine; "Drafts ship (§6.2); sending does not"). The "§5.3 Pax loop" that §6.2 cites is deepening-doc §5.3: "follow-up drafts in the user's voice, prepared, not sent, until the user approves."

Everything below was verified by reading code at this HEAD unless it says otherwise. Nothing was built, run or measured.

---

## 1. The deal record and its surfaces

### 1a. Server routes and mount (#477)

- `server/routes-wholesale-disposition.ts` (73 lines) is a default-export `Router`:
  - `GET /properties/:propertyId/disposition-packet` (l.35–45) returns `buildDispositionPacket(...)`. It writes nothing and sends nothing (header l.5–8).
  - `POST /decisions/:decisionId/outcome` (l.59–71), validated by a `.strict()` zod schema (l.47–57).
  - Refusals go through `refuse()` (l.29–33): 404 → `Errors.notFound`, 422 → `Errors.unprocessable`, 409 → `sendError(res, 409, "CONFLICT", …)`. There is no raw `res.status`.
- Mounted in `server/routes.ts:1476`: `app.use('/api/wholesale', isAuthenticated, getOrCreateOrg, wholesaleDispositionRouter);`. It sits next to the Leg 1 underwriting router at l.1475, which owns only `POST /underwrite` (`routes-wholesale-underwriting.ts:77`), so a new `/deals/:dealId/...` path does not shadow anything.
- Manifest entry: `server/routeManifest.ts:296` `{ file: "routes-wholesale-disposition.ts", mountPath: "/api/wholesale", kind: "router", export: "default" }`. The snapshot is at `tests/unit/__snapshots__/routeManifest.test.ts.snap:297`.
- The service is `server/services/wholesale/disposition.ts` (268 lines). It persists nothing. It reads the deal with `eq(deals.organizationId, …)`, `eq(deals.type, "acquisition")`, `isNull(deals.deletedAt)` and `isNotNull(deals.acceptedAmount)`, newest first (l.114–127). Refusals are a typed `DispositionRefusal(message, status)` (l.40–44). The "NOTHING IS INVENTED" rule is at l.21–23.
- Generic deal routes are in `server/routes-deals.ts`. Among them is `GET /api/deals/:id/track` (l.256–286), which returns the deal timeline (see 1c).

### 1b. Client: where the operator works a wholesale deal, and where #477's UI lives

- The deal page is `/deals/:id` (`client/src/App.tsx:952–954`, lazy `DealDetailPage` at l.111). `client/src/pages/deal-detail.tsx:135` renders `<DealDetailContent>`. The same component also renders in the `/deals` side sheet (`client/src/pages/deals.tsx:80`).
- The tabs are in `client/src/components/deal-detail-content.tsx` (1,088 lines): timeline / details / documents / checklist / analysis (l.341–360).
- **The Documents tab is where the wholesaler's deal tools already live.** `deal-detail-content.tsx:711–715`:
  `<TabsContent value="documents" …>{/* W6.1 — the wholesaler's assignment-of-contract flow … the panel self-gates. */}<AssignmentPanel dealId={deal.id} propertyId={deal.propertyId} />`
  `AssignmentPanel` (`client/src/components/deals/AssignmentPanel.tsx`, 766 lines) self-gates: `businessType === "residential_wholesaler"` (l.174–175), `if (!isWholesaler && !hasRecords) return null;` (l.346). Its header says it renders "behind an existing door, per the five-door rule" (l.32–35).
- **#477's packet composer is NOT on the deal page.** It is inside the buyer-blast `ComposerDialog` in `client/src/pages/buyer-blasts.tsx`: the `// allow-no-invalidation: drafting writes nothing` mutation (l.346–361) GETs `/api/wholesale/properties/${propertyId}/disposition-packet` (l.349), and the button is at l.459 (`data-testid="fill-disposition-packet"`). That composer is reached through `BuyerBlastsPanel` (l.120), mounted on `/campaigns?channel=buyer-blasts` (`client/src/pages/campaigns.tsx:10,111`). The packet is buyer-facing, so it belongs in the buyer lane.
- **The exact mount point for a seller follow-up drafts panel:** `deal-detail-content.tsx`, Documents tab, directly after `<AssignmentPanel … />` at l.715, self-gated the same way. This is a section behind the Deals door, so it adds no nav entry. Seller follow-ups are deal-record work, not buyer-lane work.

### 1c. How the record identifies THE SELLER

- **The deal has no seller field.** `deals` (`shared/schema.ts:877–1002`) has `propertyId`, `type`, `status`, `offerAmount`/`offerDate`/`counterAmount`/`acceptedAmount`, `closingDate`, `titleCompany`, `notes` and the dual-agency tracker. It has no lead id and no counterparty name. `contract_assignments` (`shared/schema/wholesale.ts:315ff`) has the end buyer (`endBuyerProfileId`, `endBuyerName`) and no seller.
- **The seller is `properties.sellerId` → `leads.id`** (`shared/schema.ts:750–751`, "Seller info (if applicable)"). The codebase uses this bridge everywhere. `routes-deals.ts:258–259`: "the seller lead (bridged via property.sellerId — deals carry no leadId)". It is written by `server/services/leads/convertLeadToDeal.ts:175,192` and by the onboarding sample seeder (`server/services/onboarding/sampleSeeder.ts:758`). It is nullable, so a deal can have no linked seller.
- **Seller facts on the record** (`leads`, `shared/schema.ts:552ff`): `firstName`/`lastName` (both `notNull`), `email`, `phone`, mailing `address`/`city`/`state`/`zip`, `status` (seller statuses: new, mailed, responded, negotiating, accepted, closed, dead), `notes`, `lastContactedAt`, `nextFollowUpAt`, plus the opt-out flags that `server/services/leadContactability.ts:27–36` reads (`doNotContact`, `optOutDate`; canonical predicate `leadHasOptedOut()`). Provider/platform-sourced fields also exist (`estimatedValue`, `assessedValue`, `score`, `properties.parcelData.owner`). §7.2 rules those out of a draft (see §3).

---

## 2. Draft storage census (the critical question)

What a home must carry: org scoping; a link to deal + property + seller; subject + body text; created-never-edited (§7.6); and no entanglement with any send, dispatch or contact-counting path, and no appearance as history that did not happen (§7.4, fabrication ban). No new table is allowed (`table-count` baseline 748, `scripts/ratchets/table-count.json`; package Stop conditions: "a new table without §10.1's approval → STOP").

| # | Store | Shape (verified) | Org-scoped | Deal/property/seller + subject/body | Posture | Verdict |
|---|---|---|---|---|---|---|
| 1 | **`generated_documents`**: the contract chain's reviewed-draft store | `shared/schema.ts:5129–5169`: `organizationId` notNull; `dealId`, `propertyId`, `leadId` FKs; `name`, `type` (free text, no CHECK in any migration), `content`, `variables` jsonb `Record<string,string\|number>`, `status` default `"draft"`, `generatedBy`, `sentAt`/`signers`/`esign*` (nullable) | ✓ | ✓ all three links; subject → `name`/`variables`, body → `content` | The contract chain writes `status:"draft"` with a review seal and **sends nothing** (`routes-contract-chain.ts:1–29` header; write at l.361–374; seal `sealReviewedContent` at `services/contracts/contractAssembly.ts:445–455`). **No delete path exists anywhere** (no `delete(generatedDocuments)` in server). **Two gaps:** (i) `PUT /api/generated-documents/:id` (`routes-doc-system.ts:950ff`) edits content while status is `draft`; only signed/final statuses are immutable (`IMMUTABLE_DOCUMENT_STATUSES`, l.142). (ii) Both signing routes accept any `status === "draft"` doc of any type: `request-signature` (l.1268, draft check l.1282) and legacy `send-for-signature` (l.1413, draft check l.1427 → `pending_signature`). Neither emails; both mint signer links. Other readers: `routes-deals.ts:74–78` counts only *signed* docs; the documents library lists all (`routes-doc-system.ts:800,847`), so a typed draft is visible there under its own name. | **FITS, with two type-scoped refusals** (see verdict) |
| 2 | `pax_drafts` | `shared/schema.ts:1994–2011`: `leadId` notNull, `channel` email\|sms, **`toAddress` notNull**, `status` pending→**sent**, `sentMessageId` | org int (no FK) | lead only; no deal/property | A send-bound row by design (approve-and-send idempotency). **Retired lane:** "The witnessed first-follow-up lane (paxDraftService + pax_drafts) … had zero client callers; it is gone … one kernel only" (`server/routes-pax-insights.ts:451–453`). It has no reader or writer in server. | **Fails.** It would revive a retired send lane, and its shape *is* a send (recipient required, `sent` status). |
| 3 | `pending_actions` (approval kernel) | `shared/schema.ts:2022–2059`: frozen `toolName` + `args`, approve → execute | ✓ | n/a | Its approve path *executes the tool* (`routes-pax-insights.ts:442–449`). | **Fails.** This is the send queue itself. |
| 4 | `seller_communications` | `shared/schema.ts:2620–2649`: `leadId` notNull, `propertyId`, `channel`, `direction`, `subject`, `content`, `deliveryStatus` | ✓ | lead+property, subject+body | A **ledger of communications that happened**. Read by `services/attributionService.ts:15`, `services/voiceLearning.ts:23`, and `services/dealTrack.ts:251–256` (inbound rows feed the deal timeline). | **Fails.** A draft row would assert an outbound communication that never occurred (fabricated activity, wrong attribution). |
| 5 | `lead_activities` | `shared/schema.ts:682–691`: `leadId` notNull, `type`, `description`, `metadata` | ✓ | lead only; no subject column | An activity log. **Contact-frequency compliance counts its `communication_*` rows as touches** (`services/compliance/contactFrequency.ts:48–53,312–324`). | **Fails.** It records what happened, not what is prepared, and a mis-typed row would throttle real outreach. |
| 6 | `activity_events` | `shared/schema/comms-email.ts:554–588`: polymorphic `entityType/entityId`, `eventType`, `description`, `metadata.subject` | ✓ | deal/property/lead via polymorphic id | **Unioned into the deal's own timeline** by `GET /api/deals/:id/track` (`routes-deals.ts:270–281`). | **Fails.** A draft would render as an event on the deal's history. |
| 7 | `entity_comments` | `shared/schema.ts:10947–10959`: `entityType` lead\|deal\|property\|note, `content`, `userId` notNull | ✓ | deal, but no subject and no seller link | `routes-comments.ts`: POST **parses @mentions and inserts notifications** (l.~116–158; an `@` in a draft, e.g. an email address, notifies team members); `DELETE /:id` hard-deletes own comments (l.85–107). | **Fails.** It is a team discussion thread, it has a side effect on create, and it is hard-deletable. |
| 8 | `lead_emails` | `shared/schema.ts:11080–11095`: `fromEmail`/`toEmail` notNull, `messageId` | ✓ | lead only | A ledger of real emails. | **Fails** (same reason as #4). |
| 9 | `messages` (conversations) | `shared/schema.ts:1739–1776`: `conversationId` notNull, `direction`, `status` pending\|sent… | ✓ | conversation, not deal | An outbound `pending` row is an outbox entry. | **Fails.** It is a send queue. |
| 10 | `decision_snapshots` / `scenarios` / `outcomes` (decision kit) | `shared/schema/decision-snapshots.ts:60`, `scenarios.ts:58`, `outcomes.ts:52` | ✓ | property subject | Immutable, but semantically decisions, frozen engine runs, and graded actuals. | **Fails.** It would corrupt the outcome loop that Leg 4 grades against. |
| 11 | `note_events` (Notes V2 evidence) | `shared/schema/note-events.ts:41` | ✓ | keyed to a note | Notes-only. | **Fails.** Wrong subject. |
| 12 | `deals.notes` | `shared/schema.ts:967`, single text column | ✓ (row) | deal | Mutable by every deal PATCH; one blob. | **Fails** §7.6 and cannot hold more than one draft. |
| 13 | `organizations.settings` jsonb | `shared/schema.ts:137ff` | ✓ | org-level, not deal | Mutable config. | **Fails.** Wrong grain. |
| 14 | `offer_templates` | `shared/schema/deal-lifecycle.ts:345–356`: `type` blind_offer\|**follow_up**\|final_offer, `subject`, `content`, `variables` | ✓ | template, not a per-deal record | Operator CRUD (`routes-team-messaging.ts:845–907`) | **Not a draft home. It is the voice SOURCE** (see §3). |
| 15 | `va_templates`, `document_templates`, `writing_style_profiles` | `schema.ts:2450`, `5100`; `schema/autonomy-ops.ts:260` | ✓ / nullable / ✓ | templates/profiles | Mutable templates; style profiles are model-analysed. | **Fail** as draft homes. |
| 16 | `content_drafts`, `founder_drafts`, `market_report_drafts` | `schema.ts:13666`, `11812`; `schema/parcel-data.ts:472` | `content_drafts` has **no org column** | n/a | Founder/marketing stores. | **Fail.** Wrong tenant model. |
| 17 | Pax drafting (`draft_outreach_message`, `/api/ai/draft-reply`) | `server/ai/tools.ts:3107ff`; `server/routes-ai-draft.ts:1–25` | n/a | n/a | Model-generated text, **persisted nowhere**. | **Not a store**, and it fails §7.2: model-written text is neither operator-entered nor a record fact. |

**Verdict.** The one home is **`generated_documents`**, with `type = "seller_follow_up_draft"` and `status = "draft"`, written exactly the way the contract chain writes its reviewed drafts (`storage.createGeneratedDocument` plus `sealReviewedContent`). It is the only existing store that is org-scoped, links deal, property and seller lead (`leadId`), holds a subject and a body, has no delete path, and already means "a reviewed draft that sends nothing."

**It fits only if two narrowing guards ship in the same PR.** Without them, `generated_documents` fails §7.6 and enrolls the draft on the signing rail:

1. `PUT /api/generated-documents/:id` refuses any `content`/`name`/`signers` change on a `seller_follow_up_draft` row. A correction is a new draft that cites the old one (`variables.supersedes`).
2. `POST …/request-signature` and `POST …/send-for-signature` refuse that type with a 422 ("a follow-up draft is not a signable document").

Both guards only narrow `server/routes-doc-system.ts`. Neither loosens anything, and the contract chain's no-send discipline (ruling #15) is untouched. Because they modify the signing rail's file, the auditor should see them called out explicitly. **If the auditor will not accept touching `routes-doc-system.ts`, then no existing home fits honestly.** The only no-table fallback is #477's own pattern: drafts derived on GET and never persisted. That meets "send nothing" but departs from the letter of §7.4/§8.4.17 ("drafts on a record", "writes only the draft records"), so it would need Muse's explicit acceptance. A new table is not an option without §10.1.

---

## 3. Operator voice and composition inputs

### Where operator-entered text lives

- **`offer_templates` with `type = "follow_up"` is the operator's own follow-up voice.** Its only writer is `POST /api/offer-templates` (`server/routes-team-messaging.ts:857–877`), which takes `organizationId` from `req.organization` (l.866–869). The only other insert is the repo's own `storage/acquisitionRepo.ts:119`. Nothing seeds it (`onboarding.ts` seeds campaigns, not offer templates). Reads are org-scoped (`acquisitionRepo.ts:107–114`). The operator writes these on the Offers page: type select includes `follow_up` (`client/src/pages/offers.tsx:1591`), subject (l.~1597) and "Letter content" (l.~1608). The advertised merge fields are exactly `{{owner_name}}, {{address}}, {{offer_amount}}, {{expiration_date}}, {{company_name}}` (`offers.tsx:1619`).
- **No server code merges offer templates anywhere today.** A grep for those tokens finds only the CSV importer's `row.owner_name` (`routes-leads.ts:2001`) and unrelated platform copy. This slice would be the first consumer. (Observation, out of scope: the Offers empty state says "Pax merges parcel data, owner name, and offer amount into it on every send" (`offers.tsx:1648`), and no such merge exists. That claim should be checked by whoever owns the Offers page.)
- **Rejected as voice sources:**
  - `tpl_*` workflow templates (`server/services/workflow-engine.ts:212–1846`) are platform-authored. No wholesale seller follow-up template exists. `tpl_wholesaler_*` are buyer-broadcast and assignment tasks (l.1466–1545), and cash-for-keys is de-advertised (package §0) and stays so.
  - The onboarding wholesaler *campaign* seeds (`server/services/onboarding.ts:113–133`) are platform copy carrying exactly the §7.3 patterns: "This one moves fast", "Below Market", "We close on your timeline". They must never feed a draft. (Observation for the copy-honesty lane.)
  - `negotiationEnhancements.ts:16,26` templates are platform claims ("reflects fair market value").
  - `writing_style_profiles` holds model-analysed tone, not operator-entered text.
  - Pax drafting is model-generated (§2 #17).

### Facts a draft may cite (§7.2: operator-entered or read from the deal's own records)

| Token | Source | Rule |
|---|---|---|
| `{{owner_name}}` | `leads.firstName + " " + leads.lastName` via `properties.sellerId` (both `notNull`, operator/import-entered) | Refuse if the property has no `sellerId` ("Link the seller to this property first"). |
| `{{address}}` | `properties.address, city, state`; falls back to `county + " County", state` (the disposition.ts l.143 rule) | Always available. |
| `{{offer_amount}}` | `deals.offerAmount` (operator-entered on the deal) | Refuse-not-fabricate if null, naming the field. Never substitute `acceptedAmount`, `estimatedValue`, `assessedValue`, or any AVM/ATTOM figure. Snapshot with an as-of; flag stale on read if the deal's figure has since moved (the §6.1 / §5.3 stale-price rule). |
| `{{company_name}}` | `organizations.name` (`shared/schema.ts:69`, notNull, operator-entered) | Always available. |
| `{{expiration_date}}` | **No record field exists** (deals has `offerDate`, no expiry). | **Always refuse**, naming that the record carries no expiration. Never auto-filled. This is also the urgency vector that §7.3 forbids. |
| any other `{{token}}` | n/a | Refuse, naming the unknown token(s). |

### Composition design

- **Generated from record facts:** only the token substitutions above, character for character into the operator's own template. The draft body is the template with tokens replaced and nothing else. No platform sentence, disclaimer, CTA, deadline or emoji is added, so no platform text can enter.
- **What the operator does:** writes and edits the *template* on the Offers page (operator text); picks which `follow_up` template to use; previews; and explicitly creates the draft. A draft is never edited after creation. To change it, the operator creates a new one that supersedes the old by reference (§7.6). The operator copies the text out to their own consented surface to send it.
- **Never auto-filled:** recipient address or channel (the draft has no "to"); any figure not in the table above; provider or platform fields (`estimatedValue`, `assessedValue`, `parcelData.owner`, lead `score`); dates not on the record; model-generated text; urgency or scarcity words.
- **Consent posture:** drafting sends nothing, so it consumes no consent. But a follow-up prepared for an opted-out seller invites a contact the seller refused. Recommendation: refuse to draft when `leadHasOptedOut(seller)` is true (canonical predicate, `leadContactability.ts:27–29`), naming it, and test it in both directions (§7.5).

---

## 4. Send surfaces (for the no-sends proof)

- **Email:** `server/services/emailService.ts`: `class EmailService` (l.612) with `sendEmail` (l.645), `sendBulkEmails` (l.1375), `sendTransactionalEmail` (l.1418); `export const emailService = new EmailService()` (l.1774); and **`export const sendEmail = emailService.sendEmail.bind(emailService)` (l.1777), a pre-bound alias**. The blast lane imports the alias (`routes-buyer-blasts.ts:49,244`).
- **SMS:** `server/services/smsService.ts`: `class SmsService` (l.120) with `sendSMS` (l.129), `sendBulkSMS` (l.144); `export const smsService` (l.181); `sendOrgSMS` (l.358); `sendSMSToLead` (l.454).
- **The Notes V2 no-sends proof shape (§8.4.17's reference)** is `tests/unit/delinquencyLadder.realdb.test.ts` from commit `a83a39819` ("Notes V2 Leg 1"). **It is NOT in this branch's history** (`git merge-base --is-ancestor a83a39819 HEAD` → not an ancestor). It lives on `origin/claude/notes-v2-leg3-api`. How it works:
  - A `vi.hoisted` `spyAll(module, importOriginal)` wraps every exported, lower-case function of a module in a pass-through call recorder (l.30–50).
  - `vi.mock(path, (io) => spyAll(name, io))` for `borrowerDunningLadder`, `borrowerNotices`, `emailService`, `smsService` (l.52–55).
  - `beforeAll` imports each send module so the spies exist: "a fence over modules that were never loaded would be green by construction" (l.79–83).
  - The assertion is `expect(sendSpies.filter(s => s.spy.mock.calls.length > 0).map(...)).toEqual([])` (l.230–232).
  - Its static sibling `tests/unit/delinquencyLadder.test.ts:75–86` checks, over the comment-stripped (`tests/helpers/stripComments.ts`) imports of the service and route files, that none match `/emailService|smsService|smsProvider|\/email\/|\/sms\/|workflowOutbox|workflow-engine|emitDurable|pendingHands|lob|postgrid|twilio|sendgrid|resend/i`, with a vacuity assertion that imports were parsed.
  - **Population gap to close when porting it:** `spyAll` wraps only module-level functions. It skips `EmailService`/`SmsService` (capitalised) and the `emailService`/`smsService` *instances*, so a call through `emailService.sendEmail(...)` or `smsService.sendSMS(...)` is not counted. Conversely, a prototype spy installed later would miss the pre-bound `sendEmail` alias. The new test needs **both**: `spyAll` on the module exports, **and** `vi.spyOn(EmailService.prototype, "sendEmail" | "sendBulkEmails" | "sendTransactionalEmail")` / `vi.spyOn(SmsService.prototype, "sendSMS" | "sendBulkSMS")` installed before first import. Add a vacuity assertion that each named spy exists.
- **#477's composer zero-POST proof:** `tests/unit/dispositionPacketComposer.test.tsx` (jsdom). It replaces `globalThis.fetch` with a recorder of `{url, method}` (l.59–70), renders `BuyerBlastsPanel`, clicks the button, and asserts the packet call list equals exactly one GET (l.97–98) and `calls.filter(c => c.method !== "GET")` equals `[]` (l.99). A 409 refusal fills nothing (l.112–122).
- **#477's real-DB no-write proof:** `tests/unit/wholesaleDisposition.realdb.test.ts` uses an express app with `req.organization` injected and both wholesale routers mounted (l.58–73), plus a `counts()` helper over `scenarios`/`decision_snapshots`/`outcomes`/blasts (l.76ff), byte-pinned before and after drafting (test "1+3", l.148).

---

## 5. Test and lint posture

- **Existing Leg 4 tests:** `tests/unit/wholesaleDisposition.realdb.test.ts` (real DB, `useRealDb` from `tests/helpers/realDb.ts`; 9 `it`s at l.148–259) and `tests/unit/dispositionPacketComposer.test.tsx` (jsdom, 4 `it`s). Leg 1 adjacent: `tests/unit/wholesaleDeskWiring.test.tsx`.
- **Where new tests go:** `tests/unit/` with the same naming: `<name>.test.ts` (pure/static), `<name>.realdb.test.ts` (real DB), `<name>.test.tsx` (jsdom).
- **routeManifest:** `tests/unit/routeManifest.test.ts` fails on any on-disk `server/routes-*.ts` that is neither in `ROUTE_MANIFEST` nor `KNOWN_NON_MOUNTED`, and snapshots the sorted file list. **Adding routes to the existing `routes-wholesale-disposition.ts` needs no manifest or snapshot change.** A new routes file would need a manifest entry, a snapshot update and a `routes.ts` mount.
- **Reachability** (`scripts/lint-reachability.mjs`; baselines in `scripts/ratchets/reachability.json`, all down-only): `unreachedExports` 414 counts any `export` in `server/services|jobs` whose only consumer is a test. `internalOnlyExports` 1226 counts any export used only inside its own module. `*Shared` variants cover `shared/`. `unregisteredRoutes` 4, `tablesNoWriter` 53, `tablesNoReader` 59. **So every new service export must be called by the route, and helpers must stay unexported.** Raising a baseline needs founder/CTO sign-off.
- **res-status-raw** (`scripts/ratchets/res-status-raw.json`): pattern `res\.status\(` over `server/**/*.ts`, baseline 333, down-only. New code must use `Errors.*` (`notFound`, `badRequest`, `unprocessable`, `validationFailed`, `forbidden`, …; `server/utils/errors.ts:232ff`), or `sendError(res, 409, "CONFLICT", …)` for 409 as #477 does. `res.json(...)` for 200 is fine.
- **colon-any** (`scripts/ratchets/colon-any.json`): pattern `:\s*any\b` over `server/**`, baseline 2638, down-only. Any `: any` in new server code fails CI (including `catch (err: any)`; use untyped `catch (err)` as #477 does). `as-any.json` and `req-as-any.json` are the sibling ratchets; use `AuthenticatedRequest`.
- **Others that bite new code:** `tests-typecheck` (baseline 151, down-only; new tests must typecheck under `tsconfig.tests.json`); `table-count` 748 (unchanged, no table); `lint:clock-reads` (use `clock.now()`); `lint:org-fetch` (every query org-filtered); `lint:unchecked-mutation` (the client create mutation must invalidate the drafts list query, or carry an `allow-no-invalidation:` reason); `lint:route-shadowing`.

---

## 6. Bundle posture

- **Ceiling:** `scripts/bundle-budget.json` `ceilings.totalKB: 9823` (down-only; checked by `scripts/check-bundle-size.js` after `npm run build`, on PRs into main).
- **Known state (from the audit, not re-measured):** #477's tree measured 9,823 KB against 9,823 KB, about 40 bytes spare. All four wholesale legs measure about 9,830 KB, about 7 KB over, and that decision is parked on the Leg 5 PR. This branch has since merged origin/main (`60fed37e4`: FF Legs 1–2, Notes V2 Leg 2, W2-MHP), so **the current tree is unmeasured.** There is no `dist/` here, and no build was run, per instructions.
- **Where the panel would land:** `deal-detail-content.tsx` (57,401 bytes of source), imported by both the lazy `DealDetailPage` chunk and the lazy `/deals` page, so it ships in whatever shared chunk Vite makes for that module. `React.lazy` on the panel changes the per-chunk figure but not total JS. **Any client addition has zero headroom against the total**, so it must be offset by a same-PR trim, measured on the merged tree.

---

## BUILD PLAN

### Chosen home and record shape

`generated_documents`, one row per draft, written by the drafts service:

| Column | Value |
|---|---|
| `organizationId` | `getOrganizationId(req)` |
| `dealId` / `propertyId` / `leadId` | the deal (org-pinned, `type = "acquisition"`, not deleted) / its property / `properties.sellerId` |
| `templateId` | `null` (that FK is `document_templates`; the offer template id goes in `variables`) |
| `name` | the merged subject line |
| `type` | `"seller_follow_up_draft"` (one exported constant, imported by the doc-system guards) |
| `content` | the merged body (plain text) |
| `status` | `"draft"`, permanently |
| `generatedBy` | `getUserId(req)` |
| `variables` | `{ kind: "seller_follow_up", subject, offerTemplateId, offerTemplateName, factsAsOf (ISO), fact_owner_name, fact_address, fact_company_name, fact_offer_amount?, supersedes? }` + `sealReviewedContent(…, { hash: sha256(subject + "\n" + body), userId })` |
| `sentAt` / `signers` / `esign*` | left null; never set by this slice |

### Server

- **ADD `server/services/wholesale/sellerFollowUps.ts`**, mirroring `disposition.ts`: a typed refusal class, an org-pinned deal + property + seller read, a `follow_up` template read through `storage.getOfferTemplate(orgId, id)`, a pure token merge (the table in §3), `leadHasOptedOut` refusal, staleness computed on read, and an insert through `storage.createGeneratedDocument`. Export only what the route calls.
- **MODIFY `server/routes-wholesale-disposition.ts`** (no manifest change), adding:
  - `GET /deals/:dealId/seller-follow-ups/preview?templateId=`: merge for review; writes nothing.
  - `POST /deals/:dealId/seller-follow-ups` `{ offerTemplateId, supersedes? }` (`.strict()` zod): writes exactly one row.
  - `GET /deals/:dealId/seller-follow-ups`: lists drafts, each with a stale flag and the moved figure(s).
  - Refusals use `Errors.*` / `sendError`.
- **MODIFY `server/routes-doc-system.ts`** with the two narrowing guards: a type-scoped content/name/signers refusal on `PUT /api/generated-documents/:id`, and a 422 on `request-signature` and `send-for-signature` for `seller_follow_up_draft`.

### Client

- **ADD `client/src/components/deals/SellerFollowUpsPanel.tsx`.** It self-gates like `AssignmentPanel` (wholesaler org, or drafts already exist). It offers a `follow_up` template select reading `/api/offer-templates`, then preview, create, and a draft list with Copy (clipboard), a provenance label per cited fact, and a stale flag. Empty states: no follow-up template ("Write one in Offers → Templates, type Follow-up") and no seller linked. It has **no send control**. Skeletons for loading, `QueryErrorState` for errors, design tokens only, and an `aria-label` on icon buttons.
- **MODIFY `client/src/components/deal-detail-content.tsx`:** add the import and mount `<SellerFollowUpsPanel dealId propertyId />` after l.715. Lazy-load it if the chunk figure needs it, and offset total-JS growth in the same PR.

### Tests (each mapped)

1. **`tests/unit/sellerFollowUps.test.ts`** (pure + static):
   - (a) The merged body equals the template with tokens substituted, character for character, and contains no other text (§7.2, §7.3).
   - (b) Unknown token refuses; null `offerAmount` with `{{offer_amount}}` refuses naming the field; `{{expiration_date}}` always refuses (§7.2 refuse-not-fabricate).
   - (c) Static import fence over the service and the route file, the Notes V2 `FORBIDDEN` regex extended with `pendingActions|paxAskExecutors|mailLane|routes-buyer-blasts`, with comment-stripping and a vacuity floor (§7.4, §8.4.17 static half).
2. **`tests/unit/sellerFollowUps.realdb.test.ts`** (express app with org injection, as `wholesaleDisposition.realdb` does):
   - (a) **§8.4.17:** create writes exactly one `generated_documents` row of the type, status `draft`, with correct deal/property/lead links and a seal. Row counts are unchanged in `seller_communications`, `lead_activities`, `activity_events`, `lead_emails`, `messages`, `pending_actions`, `pax_sends`, `pax_drafts`, `notifications`, `buyer_blasts`, `buyer_blast_recipients`, `scenarios`, `decision_snapshots`, `outcomes`. The send-spy harness (ported `spyAll` + prototype spies, §4) records zero calls, with each spy asserted to exist.
   - (b) **§7.1 / §8.18:** another org's deal, or another org's template id, returns 404 with nothing written.
   - (c) **§7.6:** a PUT with content on the draft is refused and the content is byte-identical afterwards; a supersede creates a new row citing the old one, and the old row is unchanged.
   - (d) **The signing rail refuses the type:** `request-signature` and `send-for-signature` return 422, the status stays `draft`, and no signer rows are written.
   - (e) **§6.1 / §5.3 stale-price rule:** change `deals.offerAmount`; the list flags the draft stale with the old and new figures, and the draft content is unchanged.
   - (f) **§7.5, both directions:** an opted-out seller is refused with nothing written; an opted-in seller drafts; no linked seller is refused.
   - (g) **Falsify:** delete each guard and confirm the matching test goes red, then restore it.
3. **`tests/unit/sellerFollowUpsPanel.test.tsx`** (jsdom, the `dispositionPacketComposer` shape): preview issues one GET; create issues exactly one POST, to the drafts route. No request touches `/blast-buyers`, `/request-signature`, `/send-for-signature`, `/pending-actions`, or any `/send`/`/sms`/`/email` path. No send control renders. The empty state teaches the operator. A refusal creates nothing.
4. **Ratchets (§8.19/§8.20):** `routeManifest` unchanged; `res-status-raw`, `colon-any`, `as-any`, `reachability` and `table-count` not raised; `tests-typecheck` ≤ 151; `moneyCustodyHardStop` untouched; `npm run check`, `npm test` and `npm run build` read from files, not through a pipe; bundle ≤ 9,823 KB on the merged tree.

### Stop conditions and flags

1. **Draft home is conditional.** `generated_documents` fits only with the two `routes-doc-system.ts` guards. If they are not acceptable, then **no existing home fits honestly**, and the choice is the persist-nothing fallback (Muse must accept the departure from §8.4.17's letter) or §10.1. No table was designed here.
2. **Bundle: zero headroom, and the current tree is unmeasured.** The client half cannot land without a same-PR offsetting trim if the merged build exceeds 9,823 KB. The ceiling is never raised. The stack-level ~7 KB overage is still open on the Leg 5 PR.
3. **The Notes V2 no-sends harness is not in this branch.** It must be ported (from `a83a39819`), and its instance-method blind spot closed as described in §4.
4. **Observations, not this slice:** the Offers empty state claims a merge that does not exist (`offers.tsx:1648`); the onboarding wholesaler campaign seeds carry §7.3 urgency copy (`onboarding.ts:113–133`).
5. **Process note:** CLAUDE.md asks every session to update `docs/company/next-moves.md`. This Step 0 session was told to change nothing but this document, so next-moves was **not** updated. The build session should record this slice there.
