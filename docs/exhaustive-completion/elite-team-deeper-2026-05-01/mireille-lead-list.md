# Mireille Darroch — AcreOS audit (lead-list provider lens)

I'm 48. I run **Darroch & Co.**, a lead-list shop out of Baton Rouge. We sell two things: targeted Land Investor pull-lists (assessor + GIS + absentee + acreage filters) and tax-delinquent lists pulled county-by-county. About 14,000 lists a year, average ticket $480, repeat rate 61%. My buyers are exactly the buyers AcreOS is courting.

I came in to answer one question: **could a customer of mine push a list directly into AcreOS in one click, and could I plug into the back end as a paid provider with rev share?** That's the integration that pays for itself for both sides. Today the customer pays me, exports CSV, fights AcreOS's importer. I want them buying from inside AcreOS and I want a piece of the LTV bump that comes from a list arriving pre-scrubbed and pre-attributed.

What follows is what I found, what's missing, and what a workable program looks like.

---

## 1. Thirty-second verdict

**Customer-facing import**: works for what it is — a manual CSV uploader with a 500-row cap, basic dedup, no source attribution beyond a free-text `source` column. Not a partner integration. A spreadsheet ingestor.

**Provider-facing API**: doesn't exist. There is no `/api/partners/lists/push` endpoint, no API-key auth surface for list vendors, no signed-list manifest, no list-quality echo back, no rev-share rail. The `marketing_lists` table is in the schema and the VA-engine route group exposes basic CRUD, but nothing reaches outside the org boundary.

**TCPA / DNC**: the schema has the columns (`tcpaConsent`, `consentSource`, `optOutDate`, `doNotContact`) and there are compliance endpoints. There is **no scrub on import**. A list with 12% DNC numbers gets ingested at 100% and the org owner's first sign that they're calling DNC is a complaint. That is a regulatory time bomb and it is also my single biggest commercial wedge — I scrub before I sell, and AcreOS has no way to recognize that or charge for it.

**Rev share**: the commission service exists for in-org agents. There is no external-partner commission rail. Building one is a meaningful lift but not a moonshot — maybe four weeks if scoped tight.

If AcreOS wants list-vendor distribution, the gap is roughly **six weeks of platform work** and one signed reseller agreement template. Below is the specifics.

---

## 2. What's in the codebase today

I read the implementation. Five files matter:

- `/Users/user/AcreOS/AcreOS/server/routes-import-export.ts` — the customer-facing CSV uploader
- `/Users/user/AcreOS/AcreOS/server/services/importExport.ts` — `importLeads()`, dup detection, batch insert
- `/Users/user/AcreOS/AcreOS/server/routes-va-engine.ts` — `marketing_lists` CRUD (org-internal only)
- `/Users/user/AcreOS/AcreOS/shared/schema.ts:328` — `leads` table with TCPA + attribution columns
- `/Users/user/AcreOS/AcreOS/shared/schema.ts:2015` — `marketing_lists` table with `source`, scrub settings, filter facets

Customer flow today:

1. Buyer of one of my lists logs into AcreOS.
2. Goes to import, picks "leads", uploads CSV (max 500 rows — see §3).
3. `parseCSV()` runs, `previewImport()` shows a column-mapped preview.
4. `importLeads()` validates each row with `leadImportSchema`, calls `storage.findDuplicateLeads()` per row against email/phone/(firstName+lastName), then batch-inserts the survivors in chunks of 100.
5. Audit log entry gets written. `source` column on each lead is whatever the CSV said, defaulted to the literal string `"import"` if blank.

That's the whole flow. No vendor identity, no list ID linking back to a `marketing_lists` row, no DNC scrub, no TCPA scrub, no quality scoring on what came in.

---

## 3. Eight things that are wrong (and three of them are bugs)

**3.1. The 500-row cap is the wrong primitive.** `routes-import-export.ts:18` hardcodes `MAX_CSV_IMPORT_ROWS = 500`. My median list is 1,200 records. My P75 is 4,000. Telling the buyer to split into eight files is the kind of thing that makes them ask for a refund. Either raise the cap with chunked async ingestion (see §4) or accept that the partner channel will route around CSV entirely — which is what I'd prefer anyway, but the cap also blocks the manual fallback.

**3.2. Dedup is N+1.** `importExport.ts:354` calls `storage.findDuplicateLeads()` once per row inside a `for` loop. 500 rows = 500 DB roundtrips before a single insert. At my real-world list sizes the import would time out before it finished. Build a single query that takes the full set of `(email, phone, firstName+lastName)` tuples and returns the matching set in one shot. Postgres can do this with a `WHERE (email, phone) IN (VALUES …)` or a temp table join. Right now the system literally cannot ingest a 4,000-row list in under a minute.

**3.3. Dedup matches on name+email+phone but not on address+APN.** This is the land-specific one. Two different buyers in the same org can buy the same delinquent list and import it three months apart. The owner's name on the assessor record may have changed (estate transfer, LLC formation), the phone may have been skip-traced fresh on the second pass, but the parcel — the actual asset — is identical. AcreOS today would happily ingest both as separate leads. Dedup needs an address-normalized + APN-fallback path. The `leads` schema doesn't even carry APN. Adding `apn` and `parcelId` columns and including them in the dup criteria is two hours of work and would prevent thousands of false-positive duplicates per AcreOS-wide.

**3.4. `source` is free-text and lossy.** `leads.source` is `text`. A buyer who bought my "Travis County 5-Acre Absentee 2026" list types whatever they want into the column. Three imports later there is no way to ask "what is the conversion rate of leads from Darroch & Co. v. PropStream v. county-direct?" The schema has `sourceCampaignId` for in-org campaign attribution, but no `sourceListId` for vendor-supplied lists, even though `marketing_lists` exists. Add `leads.sourceListId` (FK to `marketing_lists`) and `leads.sourceVendorId` (FK to a not-yet-existing `list_vendors` table). Then the conversion math becomes a one-line SQL.

**3.5. There is no DNC scrub at the point of ingest.** The TCPA columns are present, the compliance endpoints expose `getLeadsWithoutConsent()` after the fact, but nothing in `importLeads()` asks "is this phone number on the federal DNC registry?" There is no provider call. There is no `consent_source = "imported"` defaulting (it stays null). A user importing my pre-scrubbed list gets the same treatment as a user importing a Craigslist scrape, and that is the regulatory equivalent of putting fresh fish next to raw chicken in the same cooler.

**3.6. The `consentSource = "imported"` enum value is documented but not set.** `schema.ts:376` lists `imported` as a valid `consentSource`. `importLeads()` never sets it. Every imported lead has `tcpaConsent = false` (the default) and `consentSource = null`. Which means every imported lead is on the org's TCPA-no-consent dashboard the moment it lands. The `/api/compliance/tcpa/no-consent` endpoint at `routes-import-export.ts:337` would return the entire imported list. The user then has to manually flip consent — which is exactly what they shouldn't be doing if the list isn't pre-scrubbed.

**3.7. `scrubLeadList` skill exists but isn't wired to the import path.** `server/services/agent-skills.ts:712` defines a `scrubLeadList` agent skill with `removeDuplicates`, `validateAddresses`, `enrichParcelData` options. It's an *agent* skill — it can only be invoked by Sophie/Forge in an agent loop. There is no HTTP route, no UI button, no automatic invocation on `marketing_lists` status transition from `pending` to `processing`. The functionality exists; the wiring doesn't.

**3.8. `importExport.ts:354` swallows the duplicate row's metadata.** When dup is found, `result.duplicatesSkipped++` and the row is dropped on the floor. The user can't see *which* leads were dupes, *what* they matched against, or *whether* the existing lead's data should be merged. From a list-vendor's standpoint this is the worst outcome: a customer buys a 4,000-record list, sees `duplicatesSkipped: 1,847`, and concludes my list is 46% garbage when in fact those 1,847 are leads they already bought from me on a prior pull. Show the matches. Offer a merge. Offer to update only the stale fields (`lastContactedAt` is null, phone has changed, etc.).

**3.9. No idempotency on re-import.** If the customer's import fails mid-way (network blip, browser closes during the audit-log write at `routes-import-export.ts:103`), there is no idempotency key on the request. They re-upload, the dup-detector catches some of it, but any record where the dup criteria changed slightly (skip-trace appended a phone, address got USPS-normalized) lands twice. This is a `Idempotency-Key` header away from being a non-issue. Standard partner-API hygiene, missing.

**3.10. Address validation isn't done.** `agent-skills.ts:768` references `lead.address` for "validate addresses via data broker" but I can't find the actual provider call wired up. The provider registry at `server/services/providers/` is the right home for it — register a `address_validation` category with USPS or Smarty as the provider, dedupe via `provider_cache` so we don't re-validate the same address across orgs. Three days of work and it cuts mailing waste meaningfully for every customer, not just my buyers.

---

## 4. What a real partner integration looks like

Six endpoints, one new table, one new auth surface.

**New table: `list_vendors`**
- `id`, `name`, `apiKeyHash`, `apiKeyPrefix`, `revShareBps` (basis points), `payoutMethod`, `verifiedAt`, `tcpaCertificationDoc`, `dncScrubProof`, `status` (pending/active/suspended/terminated).

**New endpoint group: `/api/partners/lists/*`** (separate from `/api/import/*`, separate auth middleware that takes `Authorization: Bearer <vendor_api_key>` instead of the org session cookie):

1. `POST /api/partners/lists/manifest` — vendor declares an outgoing list before the customer pulls it. Returns a `manifestId`. Includes filter facets, claimed record count, claimed scrub date, claimed TCPA attestation, claimed DNC scrub date.

2. `POST /api/partners/lists/:manifestId/records` — vendor streams records in NDJSON, max 50K per call, idempotent on `vendorRecordId`. AcreOS holds them in `staged_list_records` keyed by manifest, not yet attached to any org.

3. `POST /api/partners/lists/:manifestId/handoff` — customer (now logged into AcreOS) clicks "import from Darroch" in the UI, supplies the manifest ID (or it comes via OAuth-style redirect from my checkout page). AcreOS attaches the staged records to their org, runs scrub (DNC, dup, address validation), creates the `marketing_lists` row, populates `leads` with `sourceListId` and `sourceVendorId` set.

4. `GET /api/partners/lists/:manifestId/quality-echo` — after handoff completes, vendor can pull back: % DNC scrubbed, % deduped against existing leads, % invalid addresses, % already in org. This is the feedback loop that lets me improve my product. Today I get nothing back.

5. `GET /api/partners/conversions` — vendor pulls back conversion events for their attributed leads (deal won, deal lost, contract signed). Drives rev share calculation.

6. `POST /api/partners/payouts/request` — vendor requests payout against accrued conversions. AcreOS processes via Stripe Connect (already a registered provider — `schema.ts:88` shows `provider: "stripe_connect"` is a known value).

**Rev share rail.** Reuse the `commission_records` infrastructure (`server/services/commissionService.ts`) but add a partner-type beneficiary. The current commission rail assumes a `teamMember`; widen it to `beneficiaryType: 'team_member' | 'list_vendor' | 'affiliate'`. Brindley is asking for the same widening from the affiliate side — solve once.

**Rev share economics.** I'd take 6% of contract value on closed deals attributed to my list, capped at 24 months from list-handoff date. AcreOS keeps 94% plus whatever the buyer pays for the platform. A $20K average contract × 6% = $1,200 to me per closed deal. My median list converts 1.4 deals across its life. So a $480 list becomes a $1,680 effective ticket once you stack in the back end. Both sides win and the customer doesn't pay extra.

**Attribution edge cases worth nailing now, not after.** The 24-month window has to be measured from `marketing_lists.processedAt`, not from the date the lead was first contacted, because some buyers sit on a list for six months. A lead that re-enters the funnel via a separate campaign mid-attribution-window should still credit the original list — last-touch attribution destroys list-vendor economics. Multi-list attribution (same parcel showed up in two of my lists 90 days apart) needs a tiebreaker: I'd accept "first list wins" as long as the second list is credited with a "delivered duplicate" for scorecard purposes (does not pay, does count toward freshness math). And if the customer churns and resubscribes a year later, the attribution window pauses during the churn — otherwise vendors get punished for AcreOS's churn problem.

---

## 4a. TCPA-clean lists: what "clean" actually means and how AcreOS should accept proof

I want to be specific here because the platform conflates three different things into one `tcpaConsent: boolean`:

- **DNC scrub** is a registry check: phone number not on the federal Do-Not-Call list (and the relevant state lists — Texas, Pennsylvania, and a handful of others maintain their own). This is a 24-hour-old fact at best; my scrub is good for the day I ran it. AcreOS should accept a manifest field `dncScrubbedAt: timestamp` and refuse anything older than 30 days for cold outreach.

- **Wireless identification** is separate. TCPA's stricter consent requirements attach to wireless numbers (ATDS rules, prerecorded calls, etc.). My scrub identifies wireless v. landline and tags each record. AcreOS today has no `phoneType` column on `leads`; the manifest should carry `phoneType: 'wireless' | 'landline' | 'voip' | 'unknown'` and the platform should default `tcpaConsent` accordingly — landline can be cold-called, wireless cannot without express written consent.

- **Consent capture** is what `tcpaConsent: true` actually means in the schema. Setting that flag for an imported lead is a *lie* unless I've captured signed consent — which I haven't, because I'm a list provider, not a lead-gen form. The right model: `consentSource: 'imported'` carries the connotation "vendor attests this number is DNC-clean and lawfully callable for B2C cold outreach under TCPA's existing-business-relationship and identified-purpose carve-outs," not "this person consented." AcreOS should distinguish the two and surface the distinction in the dialer UI: cold-outreach-permitted v. consented. Today it doesn't, and that's a lawsuit waiting to happen.

A vendor manifest should carry: `dncScrubbedAt`, `dncScrubProvider` (who scrubbed — me, or my downstream like CompliancePoint), `phoneTypePerRecord`, `litigatorScrubbed: boolean` (TCPA serial-litigator list — this is the one that bankrupts you, twenty plaintiffs sharing 6,000 phone numbers each filing $1,500 claims), and `tcpaAttestationDocUrl`. Every one of those is a column I'd happily fill on every list. None of them have a home in the current schema.

---

## 5. List-quality metrics AcreOS should expose (and grade me on)

Once `sourceListId` is wired through, the platform can compute and surface per-vendor:

- **Deliverability** — % of phone numbers that connected, % of emails that didn't bounce, % of addresses USPS-validated.
- **Freshness** — median age between vendor's claimed scrub date and first contact attempt.
- **Conversion** — % of records that hit `responded`, `negotiating`, `closed`. The four-stage ladder is already in `leads.status`.
- **Compliance hygiene** — % of records that triggered a DNC hit at scrub time, % that opted out within 30 days of contact, % flagged as `doNotContact`.
- **Dedup overlap** — % of records that already existed in the org (this is the single number that makes a list buyer mad if it's high — but it's also a fantastic signal of how saturated a county is).

Show this on a `/admin/list-vendors/:id/scorecard` page. Show it to me, the vendor. Show a sanitized version to prospective buyers ("Darroch & Co. — 91% deliverability, 4.2% conversion, 0.8% DNC, last 90 days"). That scorecard is my marketing asset and it's also AcreOS's quality control.

---

## 6. What I'd do in week one if I were the founder

Three items, biggest impact first:

1. **Fix the N+1 dedup query** (§3.2). Two hours of work. Unblocks any list bigger than ~800 rows.
2. **Add `apn` + `sourceListId` to `leads` and include APN in dedup criteria** (§3.3, §3.4). Half a day. Prevents the parcel-collision dup miss that is structural to land lists.
3. **Run DNC scrub on phone numbers at ingest, set `consentSource = 'imported'` when a vendor manifest carries a TCPA attestation** (§3.5, §3.6). Two days. Removes the TCPA time bomb. Even without a partner integration, every existing customer benefits the next time they upload a CSV.

Nothing in this list requires the partner API to ship first. They're improvements to the existing customer-facing path that also become load-bearing for the partner path. Do them in that order, then build §4 on top.

---

## 7. The ask

I'll be the design partner for the partner API. I'll commit to pushing my next 90 days of customers through it the moment it's live. I'll sign a reseller agreement at 6% rev share, 24-month attribution window, monthly Stripe Connect payouts. I'll provide TCPA attestation docs and DNC scrub proofs on every manifest. I want the quality-echo endpoint as a hard requirement — I won't ship a list into a black box.

I do not want exclusivity. I do not want to be the only list vendor. I want to be the first one in, with a documented integration and a public scorecard, on the assumption that my numbers are better than the next vendor's. That's how I bet on my own product.

Email me when it's built. I'll have customers waiting.

---

## 8. Postscript — what the second-best vendor looks like

If AcreOS ships this and I'm not the only one in the door, the right second vendor is a tax-delinquent specialist who pulls direct from county tax assessor offices, not a reseller of PropStream-style aggregator data. Reason: aggregator data is already in most operators' workflows, and routing it through AcreOS adds nothing. Direct-from-county is the differentiated supply that operators can't easily get themselves at scale, and the rev-share model only works when the platform is sourcing supply that operators can't replicate by other means. Two or three vendors covering complementary geographies and verticals (delinquent, absentee, probate, divorce, code-violation) is the right shape — not ten me-toos competing on price. The scorecard at §5 enforces that naturally.

