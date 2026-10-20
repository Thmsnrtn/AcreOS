# The best-in-class bar, by vertical and by job — 2026-10-20

*What every AcreOS customer type is trying to get done, what the best tool in
the market does for that job, where AcreOS stands against it today, and the
ordered path to the bar.*

**Codebase assessed:** `origin/main` at `7f00a750` (2026-10-20). Every verdict
below was traced UI → mounted route → service → schema → external dependency,
not graded from page names or docs. Eight domain audits ran in parallel, plus
one audit of unmerged work on this branch. The highest-severity claims were
then re-checked by hand (§10). Paths are relative to the repo root.

**Verdict scale.**
- **PASSES**: at or above the market bar today.
- **NEAR**: passes after one bounded fix.
- **PARTIAL**: a real foundation with material gaps.
- **FAILS**: exists, but below a credible bar, or misleading.
- **ABSENT**: not built.
- **BLOCKED**: built, but waiting on an owner action or credential.

**Standing rules respected.** Every "path to the bar" below fits the
CLAUDE.md DO-NOT-DO list:
- BYO send rails.
- Customer money never moves on AcreOS's account.
- E-sign is orchestrated, not built.
- No marketplace before ~25 customers and no public API before ~50.
- No residential-comps data plane before its revenue trigger.
- Refuse, never fabricate.

Where the market bar collides with one of these rules, the compliant path is
named instead: orchestrate the customer's own account.

---

## 1. The answer in one page

**AcreOS has an unusually honest, well-engineered spine. In almost every
vertical it stops one layer short of the customer.** The parts that carry
legal or financial consequence are often better than the incumbents':
- the serviced-note engine;
- the Pax approval kernel;
- the mail lane's fail-closed interlocks;
- the federal due-diligence layer stack;
- the deterministic underwriting engines;
- the withdrawal ledger for listings.

What a customer touches day to day is a different story. In most verticals the
everyday job is either:

1. **Built but unwired.** Server code with no screen, a job with no handler, a
   button that can never succeed. This is the dominant pattern. The audits
   found 60+ instances.
2. **Running on the platform's account instead of the customer's.** Listing
   syndication, zoning and title lookups, and the "connected" Google
   integrations all do this.
3. **Ahead of the code in what it claims.** Roughly 30 surfaces state an
   effect, a number or a capability the code does not have (§3). This is the
   most urgent class, because it breaks the one rule the founder calls never
   acceptable.

**By lifecycle stage** (the job every investor does, in order):

| Stage | Overall verdict | One-line reason |
|---|---|---|
| 1. Find opportunities (lists, data) | **FAILS** | No list builder. CSV is the only on-ramp, and import drops acreage, value and delinquency. No distress feeds. |
| 2. Reach sellers (mail, SMS, calls, CRM) | **PARTIAL → FAILS for land/wholesale** | The compliance spine is best-in-class. But blind-offer mail can't carry the offer, there is no calling, and drips don't stop on reply. |
| 3. Underwrite and diligence | **PARTIAL** | Federal DD layers and calculators are strong. The land AVM falls back to an LLM guess. Road access is a proximity proxy outside Tennessee. Title pre-screen is broken. |
| 4. Contract and close | **PARTIAL, with three dangerous FAILS** | A real contract chain and closing checklist. But transfer tax is off by up to 20×, the Dodd-Frank screen is wrong on balloons, and the 1031 tracker fakes success. |
| 5. Market and dispose of inventory | **FAILS** | No live outbound channel on any portal. No public listing page. The buyer-blast screen is unreachable. |
| 6. Operate the asset | **FAILS (rentals/STR/CRE) · NEAR (rehab, subdivision)** | The rental UI can create records but not run them: leases stay draft forever and no rent charges post. |
| 7. Money (notes, books, tax, capital) | **NEAR for serviced notes · ABSENT for books/capital** | Seller-finance servicing is the best thing in the product. There is no customer ledger, QuickBooks sync cannot succeed, and there is no LP portal. |
| 8. Run the business (Pax, automation, team, trust) | **NEAR** | The approval kernel, data export and audit log are strong. Only 1 of 13 webhooks fires, Google integrations go green with no credentials, and trust pages claim backups that don't exist yet. |

**Bottom line:** subdivider, fix-and-flip and land-with-owner-finance are the
three verticals where a serious operator would find genuine depth today. For
short-term rental, commercial, multifamily and agent-investor, AcreOS cannot
yet replace the incumbent tool for any single daily job.

---

## 2. The founder's example: marketing a customer's inventory

### Where can a user have their properties listed today?

**Nowhere automatically.** Channel by channel:

| Channel | Status today | Evidence |
|---|---|---|
| LandWatch / Lands of America / Land.com network | **No working path.** LandWatch has **no adapter**, yet `/syndication` pre-selects it. The Land.com adapter posts to a guessed REST endpoint using **platform** env keys. | `server/services/listingSyndication.ts:735-745`, `:481`; `client/src/pages/syndication.tsx:60` |
| Facebook Marketplace | **Violates a founder ruling.** It creates a catalog product with the **founder's own `META_ACCESS_TOKEN`**, the token behind AcreOS's ad account, from a customer route. The "Marketplace" link it builds is not a Marketplace URL. | `listingSyndication.ts:599,643,796`; `server/routes-elite-features.ts:425` |
| Craigslist | **Manual and honestly labeled.** Generates paste-ready text, with area mapping for 15 states only; everything else falls back to `sfbay`. | `listingSyndication.ts:650-700` |
| LandFlip | Adapter exists on platform keys; the endpoint is unverified. | `listingSyndication.ts:540-596` |
| Zillow / Redfin / Realtor.com / MLS | **ABSENT.** A copy generator exists with zero callers. | `listingSyndication.ts:20-340` |
| LoopNet / Crexi (commercial) | **ABSENT.** No offering-memorandum generator. | — |
| Airbnb / VRBO (STR) | **ABSENT.** The OTA name is only a label on a stay. | `shared/schema/rental.ts:1588` |
| Zillow Rentals / Apartments.com (vacancy) | **ABSENT.** | `shared/schema/rental.ts:213` |
| Wholesale buyer list (InvestorLift-style) | **Unreachable.** Matching and email-blast code is real. But `/buyer-blasts` redirects to `/campaigns?channel=…`, and `campaigns.tsx` never reads `?channel=`. No customer screen creates buyer profiles. | `client/src/App.tsx:1056-1061`; `server/services/buyerMatchingAI.ts` |
| Operator's own branded listing site / custom domain | **ABSENT.** There is no public listing route. `customDomainRouter.ts` (336 lines) has zero importers. Portal back-links point to the logged-in app. | `client/src/App.tsx:700-790`; `listingSyndication.ts:848` |
| Paid promotion | Correctly founder-only. Customers have no path to their **own** ad account. | `metaAdsFounderOnly.test.ts` |

**Content quality:**
- A listing takes **one pasted photo URL**.
- The customer's own title, description and photos **never reach the
  portals**. Syndication reads `properties.description` instead.
- Every syndicated listing claims **"Seller financing available with low down
  payment"** by default. `sellerFinancingAvailable: true` is hard-coded, and the
  schema default is `true`
  (`listingSyndication.ts:830,844`; `shared/schema/deal-lifecycle.ts:432`).
- The monthly payment is typed by hand, not amortized.
- The listings page shows Views and Inquiries counters that nothing ever
  writes.
- The empty state promises "Pax syndicates it to your active channels within
  90 seconds and threads every inquiry back to the parcel"
  (`client/src/pages/listings.tsx:642,662`).

**What is good:** the withdrawal ledger. It records take-down requests, checks
that the provider actually removed the listing, refuses to re-list sold land,
and labels manual channels honestly. That **PASSES**, but there are no live
channels for it to withdraw from.

### What the highest bar looks like

The bar is a composite of LandWatch Pro / Land.id for land, InvestorLift for
wholesale, AppFolio for vacancies, Hospitable for STR, and Crexi for CRE:

1. **One canonical public listing page per property** on the operator's own
   domain. It is SEO-indexed and mobile-first, with:
   - an ordered gallery (15–40 photos plus an aerial tile);
   - an interactive parcel map with flood, topo and soils overlays;
   - **sourced** parcel facts (acreage, access, utilities, zoning, flood);
   - an owner-finance calculator ("$X down / $Y/mo", amortized);
   - inquiry, offer and "apply to buy on terms" forms.

   Withdrawn or sold listings return "no longer available".
2. **Every channel feeds from that page**, on the **operator's own accounts**:
   - a Land.com-network broker XML feed (one feed covers LandWatch, LOA and
     Land.com);
   - the operator's own Facebook Page shop and catalog;
   - Craigslist paste-and-renew reminders;
   - an MLS hand-off for agent-listed residential;
   - Zillow Rentals / Apartments.com feeds for vacancies;
   - a channel-manager partner for STR;
   - a LoopNet/Crexi listing plus an NDA-gated offering memorandum for CRE.

   A price change or a sale propagates everywhere within hours.
3. **Every inquiry lands in the CRM** linked to the listing:
   - an instant auto-reply from the operator's own email or SMS identity;
   - showing self-booking;
   - an offer intake ranked by terms.
4. **Buyer network:**
   - buyer list import with buy-box criteria;
   - auto-match on acquisition;
   - a property-card email (and SMS where consented);
   - open, click and reply tracking.
5. **Owner-finance close:** the buyer applies online, and the deposit is taken
   through Stripe Connect on the **operator's own account**. A draft note is
   created automatically, and Close & Carry already handles the rest.
6. **Measurement:** views, inquiries, cost per lead and days-on-market per
   channel, plus price-drop history and the inquiry → offer → close funnel.
7. **Content quality:**
   - Pax drafts per-channel copy from **verified** parcel facts. It omits
     unknowns and never guesses them.
   - Pricing comes from comps with a price-drop cadence.

### How we get there

**Step 0 — stop the false claims (S, this week):**
1. Delete the platform env reads in `listingSyndication.ts`, and with them the
   founder-token path.
2. Mark the land-portal channels `availability: "planned"` until an adapter is
   proven against a real account.
3. Remove the hard-coded seller-financing claim.
4. Rewrite the listings empty state.
5. Hide the never-written counters.
6. Put the `marketplace_syndication` tier check on all three publish entry
   points. Today it is on one.
7. Extend `metaAdsFounderOnly`/`adSpendAuthority` to read
   `listingSyndication.ts`. This is a population gap: today those gates never
   open the file.

**Step 1 — the public listing page (M):** add
`/l/:orgSlug/:listingSlug` rendered from `property_listings` (the customer's
title, copy and photos) plus parcel facts.
- Inquiry form → buyer lead, with an auto-reply from the BYO identity.
- Mount `customDomainRouter` for listing pages only.
- Add listing pages to the sitemap.
- This URL becomes the hub every other channel needs.

**Step 2 — content (M):**
- Multi-photo upload into the existing ordered `listing.photos`, reusing
  field-scout's upload.
- An auto satellite tile, labeled as such.
- An amortized monthly payment.
- Pax copy grounded in sourced facts.

**Step 3 — reach the buyer network (S → M):**
1. Fix the `?channel=` redirect.
2. Add a Buyers section behind the **Deals** door: CSV import plus a buy-box
   form.
3. Fire `matchPropertyToBuyers` on acquisition.
4. Add a property-card template.
5. Add delivery/open webhooks.
6. Remove the "email + SMS" header claim until SMS ships.

**Step 4 — real channels, on the customer's accounts (M):**
- A per-org signed XML broker feed for the Land.com network. One build
  replaces three adapters.
- A per-org Meta Page connection, reusing the founder OAuth plumbing scoped to
  the org's own Page.
- Per-org encrypted connector rows.

**Step 5 — owner-finance checkout (M):** "apply to buy on terms" → a deposit
through `customerMoneyRouting` on the org's own Connect account → a draft
note.

**Step 6 — vertical channels (M–L, demand-ordered):**
- Rental vacancy feeds plus an online application.
- STR iCal, then a channel-manager partner (Hospitable/Hostaway API).
- CRE offering memorandum plus Crexi.
- MLS data hand-off for agent-investors.

**Step 7 — the customer's own ad account (M):** an org-connected Meta/Google
ad account to boost a listing, with lead forms flowing into the CRM. This is
the mirror image of the founder-only ads ruling, not an exception to it.

**What it unlocks:** the founder's headline promise ("list it once, it's
everywhere, every inquiry threads back"), stated truthfully. It is also the
first measurable dispo funnel.

---

## 3. Fix first: claims ahead of code, and correctness hazards

Each item below is a refuse-not-fabricate breach, or a wrong legal or
financial number shown to a customer. All are **S** unless marked. Each item
is a deletion, a reword or a correction, so they fit the roadmap's stop rule:
truth and debt work is allowed while G0 owner actions are pending.

### P0: wrong numbers with legal or financial consequence

1. **Transfer tax off by up to 20× is printed into purchase agreements** in
   "contract-ready" states (`server/services/stateDocumentConfig.ts:132-312`).
   Examples:
   - FL is 0.07% where its own note says $0.70/$100, which is 0.7%.
   - NV is 0.0195% vs 0.39%.
   - NC is 0.02% vs 0.2%.
   - MI is 0.075% vs ~0.86%.
   - CA is 0.055% vs 0.11%.

   A second, independent fee table disagrees with this one
   (`server/services/countyRecordingFees.ts`). The guarding tests test inline
   copies of the logic, not the production module.

   **Fix:** one table with a citation per row. Refuse to print a dollar
   estimate for any unverified row. Rewrite the tests to import production
   code.
2. **The Dodd-Frank screen grants the 3-property exemption to balloon notes**
   and inverts the 1-property rule (`server/services/doddFrankChecker.ts:129-190`).
   Its test reimplements the bug. Separately, the auto closing checklist hard
   codes `isSellerFinanced=false` (`server/storage/dealRepo.ts:241`), so the
   Dodd-Frank, note and deed-of-trust items never appear.
3. **The 1031 tracker returns 201 and persists nothing.** All five persistence
   methods are stubs (`server/services/exchange1031.ts:268-273`), on a feature
   with hard IRS deadlines. **Fix:** refuse (501) until it is built.
4. **The borrower-portal "Form 1098" shows Box 2 as today's balance**, not the
   principal outstanding on January 1 (`server/routes-borrower.ts:1936`). It
   also diverges from the rigorous lender-side generator, which is built but
   never delivered (`server/routes-accounting.ts:336-370`). The landing page
   says the agent "Files 1098s" (`client/src/pages/landing/Agents.tsx:75`).
5. **Main's HEAD is a debug commit on an unauthenticated borrower endpoint.**
   It returns raw `err.message` and uses `console.error`
   (`server/routes-borrower.ts:643-646`, commit `7f00a750`). Revert it before
   the next deploy dispatch.
6. **The land AVM's number comes from an LLM** when no comps exist, which is
   nearly always: the county ingest job is never registered
   (`server/services/acreOSValuation.ts:710-735`;
   `server/jobs/countyAssessorIngest.ts:725` has zero callers).
   - Even the comps path folds in a hidden GPT-4o ±20% adjustment that is left
     out of the returned adjustments (`:480,1098-1150`).
   - Subdivision lot pricing inherits this value.
   - **Fix:** refuse ("enter comps / run blind-offer comps"), or show the
     narrative text with no number.
7. **Road access is shown as a boolean from proximity.** It is computed as
   "highway within 1 mile" (`server/services/landProfile.ts:411-417`; labeled
   "estimate", confidence 60). The DD engine also says "Road access confirmed"
   for any OSM way within 500 m (`server/services/dueDiligenceEngine.ts:605-650`).
   The rigorous landlocked check exists only for Tennessee. This is the most
   expensive mistake in land investing. **Fix:** show "Nearest road: X mi",
   never a yes/no from distance.
8. **The title pre-screen asserts "clear" from silence.** It queries ATTOM with
   the APN as an `attomId`, and hard-codes `hasHoa:false`
   (`server/services/titleSearchService.ts:205,257-258`). The page also crashes
   on every response, because the client reads `issues[]` and the server
   returns `liens`/`redFlags` (`client/src/pages/title-search.tsx:81`).
9. **The tax optimizer uses 2024 single-filer brackets with flat 15%/24%
   rates** (`server/services/taxOptimizer.ts:31-45`). The 1099-NEC batch prints
   "(payer address not configured)" on a tax form, and its $600 threshold is
   hard-coded (`server/routes-contractors.ts:39,190`). Route both to the K13
   tax reviewer.

### P0: founder-ruling breaches

10. **Customer listing syndication uses the founder's Meta token** (see §2).
11. **Pax can trigger Zapier/Make without a tap.** Those tools are classed
    `changes_records`, not sends, so a model-composed payload with lead PII can
    post to a Zap that emails or texts (`shared/pax-controls.ts:261-263`;
    `server/services/connectors/executor.ts:313-334`). **Fix:** add both to
    `APPROVAL_REQUIRED_TOOLS`, and gate any executor that does an outbound POST.
12. **The support agent can void the customer's own AcreOS invoice.**
    `stripe.invoices.voidInvoice(invoice_id)` takes a model-supplied id, with
    no check that the invoice belongs to the customer
    (`server/ai/supportAgent.ts:4142-4157`). That makes it a pricing
    concession, and pricing is a hard-stop. **Fix:** make it model-unreachable,
    like `apply_credit`.

### P1: surfaces that claim effects they don't have

| # | Surface | What it says | What happens | Evidence |
|---|---|---|---|---|
| 13 | Today persona brief | "N sellers wrote back overnight", "rents hadn't landed by 6am", "you almost lost yesterday, saved" | Unrelated counts relabeled: Pax-sourced queue items, active alerts, and **note** lateness shown to landlords | `server/routes-today.ts:988-1020` |
| 14 | Mail composer | "Handwritten: Premium touch" at a 350¢ premium; "Next day, 1-day ETA"; "Batch (cheapest)"; "EDDM" | Plain printed letter; no mail class is passed to Lob; presort and EDDM are disabled stubs | `server/services/mail/providers/lob.ts:35,82,133` |
| 15 | Offer batches | "Pax hands the merge to the print vendor" | The `process-offer-batch` job has **no handler**; batches stay "processing" forever | `server/services/offerBatchService.ts:225`; `server/jobs/runScheduledJobs.ts:399-443` |
| 16 | Pax connectors (Gmail/Drive/Calendar) | "Connected · Pax can now use this integration" | No OAuth flow exists; empty `{}` credentials are stored as connected; every tool then returns "not connected" | `server/routes-ai.ts:1309-1317` |
| 17 | QuickBooks "Sync" (Finance door) | Sync button shown to every customer | The callback stores the raw auth code and never exchanges it for a token; the redirect URI targets a non-existent route | `server/routes-platform-features.ts:203`; `server/services/bookkeeping.ts:670` |
| 18 | `/tax-delinquent` | "Import started" / "Lead added to outreach sequence" | The import is a no-op returning 0; "contact" only sets a status | `server/services/taxDelinquentPipeline.ts:684-690`; `client/src/pages/tax-delinquent.tsx:80` |
| 19 | `/security` and landing CTA | Encrypted 30-day backups in a region-isolated bucket; "SOC 2 Type 1 … 2026-Q3 target" | K3 (S3) is not done; the Q3 date has passed; no auditor evidence | `client/src/pages/security.tsx:186-193`; `client/src/pages/landing/FinalCTA.tsx:86` |
| 20 | Rent roll | "No open balances: every recorded charge is paid in full" | Shown over an **empty** ledger, because no screen or job ever posts rent charges | `client/src/pages/rent-roll.tsx:383-390` |
| 21 | Landing meta description | "Pull lists, run comps…" | There is no list builder on `main` | `client/src/pages/landing.tsx:64` |
| 22 | Customer changelog | P&L "by county, vintage, and acquisition channel", "realized and unrealized" | None of those dimensions exist in the P&L code | `client/src/data/customer-changelog.ts:175` |
| 23 | Bulk AVM | "Bulk AI valuations via CSV upload" | The CSV is ignored and the progress bar is simulated | `server/routes-avm.ts:344-352` |
| 24 | Map layer "Zoning Districts" | Zoning | It is USGS NLCD land cover | `client/src/components/property-map.tsx:105,1137` |
| 25 | County timelines | p50/p90 county approval days | Seeded from "Brigid historicals" and a "Brigid expansion estimate". Brigid is an AI review persona | `scripts/migrate.mjs:1070,1086` |
| 26 | Rehab templates | Line-item costs | Atlanta costs ("Devon's typical project") applied in every market; the "10% contingency" line is a flat $6/sqft | `server/routes-rehabs.ts:60-112` |
| 27 | STR onboarding and bookings | "Record a stay, or import your Airbnb/VRBO CSV" | The panel has two GETs; no screen records or imports a stay | `client/src/pages/onboarding-v2.tsx:161`; `client/src/components/rentals/bookings-panel.tsx:289` |
| 28 | Vertical registry | commercial, STR and mobile_home are "core" | The capabilities it cites are API-only. The Today copy itself says "No CAM / percentage-rent modeling yet" | `shared/business-types.ts:316-351`; `client/src/lib/today-vertical-surfaces.ts:161` |
| 29 | Org email identity | DKIM/SPF for your domain | Provisioned for SendGrid (`include:sendgrid.net`, local DKIM key), but mail actually sends via SES and is never signed with that key | `server/services/orgEmailIdentity.ts:98`; `server/services/emailService.ts:1284` |
| 30 | Wholesaler state rules | Assignment legality gate | The template path gates on `type === "assignment_of_contract"`; the seeded template is `type: "assignment"`, so it bypasses the gate. No seeded state row is attorney-reviewed | `server/routes-doc-system.ts:790`; `server/storage/documentsRepo.ts:204` |

**The gate lesson (CLAUDE.md law 3).** Most of these passed every gate, for
two reasons.

- **The reachability lint treats a *mounted* route as reached**
  (`scripts/lint-reachability.mjs`). "Mounted endpoint with zero client
  callers" is not one of its families, which is how ~20 "core" rental
  endpoints passed. **Add that family, with a register for routes that are
  intentionally API-only.**
- **`lint:no-fabrication` reads no template copy**, so the Today brief and the
  mail-speed labels sail through.

---

## 4. Vertical scorecard

The cells are the lifecycle stages from §1.

| Vertical | Find | Reach | Underwrite | Close | Market / dispose | Operate | Money | Best-in-class bar it must beat |
|---|---|---|---|---|---|---|---|---|
| **Land flipper** | FAILS | FAILS | PARTIAL | FAILS¹ | FAILS | FAILS² | NEAR | LandPortal + Launch Control + LandWatch + GeekPay |
| **Note investor** | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL³ | — | PARTIAL⁴ | Paper Source/Notes Direct + FCI + LoanPro |
| **Hybrid (land+notes)** | FAILS | FAILS | PARTIAL | FAILS¹ | FAILS | FAILS² | NEAR | composite of the above |
| **Residential wholesaler** | ABSENT | FAILS | BLOCKED⁵ | NEAR | FAILS | — | — | PropStream + Launch Control + BatchDialer + InvestorLift |
| **Fix-and-flip** | ABSENT | FAILS | NEAR (MAO) / BLOCKED⁵ | PARTIAL | ABSENT | NEAR | PARTIAL | DealMachine + DealCheck + FlipperForce + CompanyCam |
| **Buy-and-hold** | ABSENT | PARTIAL | PARTIAL | FAILS⁶ | ABSENT | FAILS | FAILS | AppFolio/Buildium/RentRedi + Stessa + DealCheck |
| **Short-term rental** | ABSENT | — | ABSENT | PARTIAL | ABSENT | FAILS | PARTIAL | AirDNA + Hospitable/Guesty + PriceLabs |
| **Commercial** | ABSENT | PARTIAL | ABSENT (acquisition) | FAILS⁶ | ABSENT | FAILS | ABSENT | CoStar/Crexi + ARGUS + VTS/Yardi |
| **Creative finance** | ABSENT | FAILS | PARTIAL | FAILS⁷ | FAILS | — | PARTIAL⁸ | Subto-style deal packs + GeekPay + LoanPro |
| **Developer / entitlements** | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | ABSENT⁹ | Land.id + Zoneomics + Juniper Square |
| **Subdivider** | PARTIAL | FAILS | NEAR | PARTIAL¹⁰ | PARTIAL | NEAR | NEAR | Land.id + spreadsheets (the bar is low) |
| **Tax lien / deed** | PARTIAL | PARTIAL | PARTIAL | PARTIAL¹¹ | FAILS | PARTIAL | — | Tax Sale Resources + Bid4Assets |
| **Multifamily** | ABSENT | PARTIAL | PARTIAL / ABSENT | FAILS⁶ | ABSENT | PARTIAL | ABSENT⁹ | Reonomy + ARGUS + Yardi/Entrata + Juniper Square |
| **Mobile home / park** | ABSENT | PARTIAL | PARTIAL | FAILS⁷ | FAILS | PARTIAL | PARTIAL | Rent Manager / ParkPro + GeekPay |
| **Agent-investor** | ABSENT | FAILS | BLOCKED⁵ | NEAR (commissions) | ABSENT (MLS hand-off) | — | — | Follow Up Boss + kvCORE/Lofty + dotloop |

**Notes:**
1. Transfer-tax error printed into the contract; deeds not recordable (no
   witness lines, prepared-by/return-to, or margins).
2. No property-tax calendar or insurance tracking for owned land. "Portfolio
   health" is CRM hygiene.
3. Assignments and allonge exist. The servicer-for-others remittance API has
   no UI.
4. The acquired-note book has no portal or autopay, and is **invisible to P&L,
   bookkeeping and cash-flow**: a note investor's interest income reads $0.
5. Residential comps are ATTOM-only through the registry, which is the
   compliant seam. The ATTOM key was a 30-day trial recorded as lapsing around
   2026-08-28 (`docs/company/live-operation-keys.md:44-47`). Conversion is
   unverified.
6. The 1031 tracker fakes success.
7. The Dodd-Frank screen is wrong on balloons and dwellings. There are no
   sub-to, wrap or lease-option documents.
8. Serviced notes cannot carry a balloon, interest-only or ARM terms, which
   typical land contracts and wraps need.
9. No capital raise, waterfall or LP portal.
10. Deeds aren't recordable, and there is no JV split.
11. Redemption periods contradict each other: NV is "0 — no redemption" in
    `stateDocumentConfig.ts:512`, while Pax's corpus says 2 years.

**Public posture vs code.** `shared/business-types.ts` marks all 15 verticals
`core`, while `shared/business-types/publicClaims.ts` demotes 13 of them to
BETA on the landing page (OD-5). The scorecard above supports the demotions,
and argues for going further on commercial, STR and mobile_home: those three
should drop from `core` in the registry until their screens exist.

**Where AcreOS is genuinely at or above the bar today:**
- Serviced-note creation, payment application, late fees, payoff and periodic
  statements.
- The Pax approval kernel and autonomy controls.
- Mail-lane interlocks and refunds.
- The federal land DD layer stack (FEMA, NWI, SSURGO, 3DEP, NLCD, FCC, PLSS)
  with per-field provenance.
- Flip MAO math.
- The listing withdrawal ledger.
- EMD records.
- Full data export.
- Fail-closed DNC.
- Honest funnel metrics ("not measured" rather than invented).

---

## 5. Domain findings, condensed

Each subsection gives the jobs, the bar, today's state and the verdict, then
the path. Full agent reports were checked against code. Only the verified
substance is carried here.

### 5.1 Find opportunities: **FAILS**

| Job | Bar | Today | Verdict |
|---|---|---|---|
| County list builder (filter → live count → cost → save) | PropStream / LandPortal / DealMachine | None on `main`. The `marketing_lists.filters` model has the right fields, but its CRUD has no client and no executor (`server/routes-va-engine.ts:24-81`). | ABSENT |
| Parcel coverage | DataTree / ATTOM / Regrid national | 52 seeded county endpoints with APN+owner only: mailing address in 0 of 52, acreage in 2 of 52. Regrid is coded but its licence is unbought (K10). ATTOM status is unknown. | BLOCKED |
| Absentee / out-of-state | One-click filter | Score factor only, and it geocodes the *mailing* address, so it is inverted for exactly the owners it targets (`server/services/leadScoring.ts:185-195`). | FAILS |
| Tax-delinquent lists | Tax Sale Resources | CSV only. The importer puts fields in plaintext notes and never sets `leads.taxDelinquent`. Mail-to prefers the situs address, which vacant land never receives mail at (`server/routes-leads.ts:1970-1990`). | PARTIAL |
| Distress (probate, pre-foreclosure, vacancy, code violations, expireds, equity) | PropStream / BatchLeads | No feeds. "Inheritance" is an owner-name substring test (it counts "trust"). | ABSENT |
| List stacking | REISift | A duplicate APN on re-import is **discarded**: no hit count, no source tag. | ABSENT |
| CSV import | Auto-map, all fields | Good mapper with dedupe and undo, but it drops acreage, value, taxes owed and delinquency. | NEAR |
| Skip trace | BatchData | FCRA-gated and credit-metered, but two defects (below). | PARTIAL |
| Driving for dollars | DealMachine | GPS + photo capture, but the address is stored as "APN xyz" and the city as the county. No owner name, no trace. | PARTIAL |
| Acquisition radar / watchlist | Daily buy-box matches; county alerts | Radar: built, no surface. Watchlist alerts: `triggerAlert` has zero production callers. | FAILS |
| Inbound capture (seller sites, PPC, call tracking) | Carrot / CallRail | No form intake. Tracking numbers are honestly flagged "not printed". | ABSENT |
| MF/CRE (LLC piercing, units), STR (AirDNA), note tapes | Reonomy, AirDNA, note exchanges | None. | ABSENT |

**The two skip-trace defects:**
- The lead-detail panel can never succeed: it sends no FCRA purpose
  (`client/src/components/skip-trace-panel.tsx:57`).
- A BYOK-only org is told "not configured" (`server/services/skipTracingService.ts:415-417`).

**Path:**
1. **(S)** Fix the import targets (acreage, value, taxDelinquent,
   propertyAddress), mail-to semantics, absentee computed from mailing ≠
   situs, stacking on duplicates, server-side lead filters, both skip-trace
   defects, and the Drive Mode address.
2. **(M) List builder v0 on the customer's own data accounts.** Add a
   `parcel_search` provider category for Regrid and BatchData using the
   customer's BYO key, through the existing `resolveProviderCredential`. It
   returns count and cost first, then saves into `marketing_lists` and leads
   with provenance. The customer holds the licence, which sidesteps both the
   redistribution problem and the >$500 K10 spend.

   The stranded W10.3 builder (§8) is a starting point, but it is itself
   blocked on a licence review.
3. **(M)** Owned-county filters over `parcel_snapshots`, for counties the
   pipeline legitimately stores.
4. **(M)** BYO connectors for distress data (BatchData/ATTOM customer keys),
   AirDNA, and OpenCorporates/SOS.
5. **(S)** A note-tape CSV parser feeding `note_acquisitions`.
6. **(K10, founder)** A platform Regrid licence, only after design partners
   prove time-to-first-mail.

### 5.2 Reach sellers and run the CRM: **PARTIAL**, failing land and wholesale's core motion

| Job | Bar | Today | Verdict |
|---|---|---|---|
| Blind-offer mail with per-parcel `{offer}` `{apn}` `{acres}` | Launch Control / LandPortal + Lob | Merge supports only name, city and state (`shared/parcel/ownerName.ts:104-115`). The wizard records a decision only. Offer batches never process. | **FAILS** |
| Postcards and letters with tracking | Lob / PostGrid | Real end-to-end chain: idempotent, audience digest, ethical-copy check, credit debit, refund on failure, HMAC webhook. | BLOCKED (K7), then NEAR |
| Handwritten / yellow letter | Ballpoint / YLHQ | Mislabeled (see §3). | FAILS |
| Cold SMS | Launch Control / Smarter Contact | Refused without express consent. A defensible compliance posture, but **record it as a founder decision** and say so in the product. | ABSENT by design |
| Reply to an inbound SMS | Two-way threads | The route-level gate requires `tcpaConsent` before the purpose-aware "reply" rule is ever consulted, so a seller who texts in can't be answered (`server/routes-misc.ts:309-313`). | PARTIAL |
| Email to imported leads | CAN-SPAM opt-out model | Blocked for any lead without `tcpaConsent`. That conflates email with TCPA (`server/services/tcpaCompliance.ts:579-588`). | PARTIAL |
| Dialer / recording / voicemail drop / inbound calls | BatchDialer / Mojo / Smrtphone | `tel:` links plus a manual log. `initiateCall` has zero callers. There is no inbound voice webhook. | ABSENT |
| Multi-channel cadences | REI Reply | A real worker, but **no auto-stop on reply**: `pauseEnrollmentOnResponse` has zero callers, and the `responded` condition is inverted (`server/services/sequenceProcessor.ts:272-282,738`). | PARTIAL |
| Unified inbox | FUB / REsimpli | Email and SMS feed plus Pax drafts. No calls or voicemail. | NEAR |
| Lead CRM | Podio / REsimpli / FUB | Filters, saved views, bulk actions, tasks, consent capture, dedupe. Stages are fixed. | NEAR |
| Attribution | Cost per lead and per deal | Honest counts; deal attribution flagged "not tracked". | PARTIAL (honest) |
| 10DLC | Guided filing | Read-only status plus a send gate. | PARTIAL |
| DNC / litigator | Real-time scrub | Searchbug adapter, fail-closed; SMS only. | BLOCKED (K6) |

**Path:**
1. **(S)** Fix the §3 mail labels.
2. **(S)** Auto-pause on reply, plus the `responded` fix. The test must drive a
   real inbound message.
3. **(M)** Per-recipient offer merge, a `process-offer-batch` handler routed
   into the *existing* `/api/outreach/mail/queue` (keeping one send path), a
   "mail these offers" step on the wizard, and a non-responder follow-up
   mailer. **This is the single highest-leverage build in the product: it
   completes the land vertical's revenue loop.**
4. **(S, founder sign-off)** Separate email consent from TCPA consent, and let
   `sendOrgSMS`'s purpose rules decide replies.
5. **(S)** Run the ethical-copy check on every send surface, with an
   enumerated population test. Today it covers 2 of at least 5 surfaces.
6. **(M)** Align the email identity with the real sender: SES BYODKIM / custom
   MAIL FROM, or a real SendGrid lane. Configure Clerk Gmail/Outlook scopes.
7. **(M)** Inbound voice and a click-to-call bridge on the org's own Twilio.
   Print the tracking number and count calls.
8. **(L)** Partner with a dialer rather than build one.
9. Get counsel review of the wholesaler and tax-deed outreach rules.

### 5.3 Underwrite and diligence: **PARTIAL**

| Job | Bar | Today | Verdict |
|---|---|---|---|
| Flood, wetlands, soils/septic, slope, land cover, broadband, PLSS | Land.id | Real, sourced, per-field provenance and gaps (`server/services/landProfile.ts`). | **PASSES** |
| Land comps | LandPortal / Land.id sold comps | Regrid radius with nominal-sale screens (needs K10); strict blind-offer comp rules. | BLOCKED |
| Land AVM / bulk AVM | Comp-based, confidence shown | LLM fallback, hidden adjustment, fake bulk (§3). `feature_avm` is seeded OFF. | FAILS |
| Road access | Frontage geometry | TN only; a proxy elsewhere (§3). At least five DD producers disagree. | FAILS |
| Residential ARV | PropStream / DealCheck | Compliant ATTOM seam plus an operator comp grid. | BLOCKED (ATTOM) |
| MAO / flip | DealCheck / FlipperForce | Strong: org rules, cents math, labeled defaults, scenario recorded. No financing cost or sensitivity table. | NEAR |
| Rehab estimating | Rehab Valuator | Line items wired; Atlanta templates (§3). | PARTIAL |
| Rental (cap, DSCR, BRRRR) | DealCheck | Cap rate and cash flow, but no loan model. The DSCR page is **unrouted** while three nav entries point at its redirect (`client/src/App.tsx:906-908`). | PARTIAL |
| STR projection | AirDNA / Mashvisor | Actuals only. | ABSENT |
| MF/CRE acquisition (T12, rent roll, DCF, debt) | ARGUS | Strong **ops** engines. The pre-purchase rent-roll preview has no caller. No DCF, debt sizing or waterfall. | ABSENT (acquisition) |
| Note pricing | Yield → price, ITV | Post-book yield panel is real; nothing before purchase. | PARTIAL |
| Tax lien yield and redemption | Tax Sale Resources | Clock for 10 states, disclosed as unreviewed; no bid-down yield calculator. | PARTIAL |
| Subdivision feasibility | Spreadsheet pro-forma | Pure engines. Lot pricing and basis are wired; **the pro-forma endpoint has no caller**, though the registry says it is "behind the Subdivision tab". | PARTIAL |
| Zoning | Zoneomics / Regrid | A direct vendor call that **bypasses the provider registry** (no credits, cache, breaker or BYOK) and returns `source:"mock"` without keys (`server/services/zoningService.ts:45-139`). | BLOCKED, and a rule breach |
| Title pre-screen | DataTree / TitlePro | Broken (§3). | FAILS |
| Back taxes, HOA lookup, permit history | Treasurer data, Shovels | — | ABSENT |
| Environmental | EDR screen | EPA proximity, species and the NRI hazard profile. | NEAR (label it a screen and add a Phase-I referral) |

**Path:**
1. **(S)** The §3 refusals: AVM, access, title, the NLCD label, bulk AVM, and
   the desirability score that awards points for unknown inputs.
2. **(S)** Route `investor-analytics.tsx` behind the Finance door, and wire the
   pro-forma and rent-roll preview.
3. **(M)** Move zoning and title behind `providerRegistry.lookup` with BYOK.
   Delete the PropStream path unless a real API contract exists.
4. **(M)** Compute frontage for any parcel with geometry, and collapse the DD
   producers onto one LandProfile, gated by an enumerated producer list.
5. **(M)** Add a loan block to the rental engine (DSCR, cash-on-cash, BRRRR),
   a note yield → price calculator and a lien bid-down yield calculator.
6. **(M)** Register or retire the county ingest. Feed `transaction_training`
   from accepted comps, with provenance.
7. **(L)** MF/CRE acquisition underwriting with debt sizing and a waterfall.
8. **(M)** A BYO AirDNA/PriceLabs connector for STR.

The stranded V0–V2 vertical program (§8) supplies a deterministic engine and
desk for 12 of these verticals. Landing it is the fastest route from PARTIAL
to NEAR across this whole row.

### 5.4 Contract and close: **PARTIAL**

| Job | Bar | Today | Verdict |
|---|---|---|---|
| Pipeline and stage gates | REsimpli / Podio | 7 statuses, kanban, stage gate. No contract-deadline engine. | NEAR |
| Offers and approvals | Versioned counters | Team approvals are real; a deal holds one counter amount. | PARTIAL |
| State purchase agreement | Attorney-drafted state forms | Gated to 16 states; about 5 clauses (no contingencies, DD period, default remedies, prorations or assignability). Transfer-tax error. AZ/MI get a Texas vendor's-lien deed type. | **FAILS** |
| Assignment plus legality | State disclosures | Chain path gated; template path bypasses the gate (§3). | PARTIAL |
| Land contract, note, deed of trust, option, sub-to, wrap | State-specific creative-finance packs | Promissory note wired. Land-contract and DOT generators are mounted with no caller. Option, sub-to and wrap documents don't exist. | PARTIAL / ABSENT |
| E-sign | DocuSign / Dropbox Sign | The native rail has strong evidence (HMAC, consent, hash, sealed PDF). Links are pasted by hand; signing order is not enforced; no decline or reminders. | BLOCKED (K14) |
| Title / escrow ordering | Qualia | API and partner webhook are real, with **zero client callers** and no partners. | PARTIAL |
| Closing checklist plus wire-fraud gate | SkySlope | State-aware and auto-generated; the wire-fraud tick needs evidence. Seller-finance flag hard-coded false. | NEAR |
| EMD, double close | — | Real records in nav. | PASSES / NEAR |
| Deed and recording | Recordable deeds + Simplifile/CSC | No witness lines, prepared-by/return-to or margins; org-branded header. No e-recording. | FAILS / ABSENT |
| 1031 | QI coordination | Fake persistence (§3). | **FAILS** |
| JV splits | — | — | ABSENT |
| Deal file cabinet | Executed PSA, commitment, HUD, recorded deed | The store is dormant on K3, and even armed, **no deal-document upload path exists**. The checklist "Upload" button leads to nothing. | ABSENT |
| Post-close handoff | Into servicing, rentals, rehab | Close & Carry into notes is wired; no rentals or inventory handoff. On `main`, closing by advance-stage, bulk move or Pax writes no commission, sale or training row (DEFECT-0244; fixed on the stranded branch). | PARTIAL |

**Path:**
1. **(S)** The §3 items: transfer tax, Dodd-Frank, 1031, the wholesaler gate
   bypass, the seller-finance checklist flag, the NV redemption conflict,
   deleting the dead fabricating "deal closed" modal, and the
   `closing-package` swapped-argument route.
2. **(K3 + M)** Deal-document upload linked to checklist items, plus a stored
   reference to the sealed PDF.
3. **(S)** An "Order title" action that emails the title company from the BYO
   identity first; partner webhooks later.
4. **(M)** State-aware recordable deeds.
5. **(M)** Land W10.4 so there is one close writer.
6. **(L, partner)** License attorney-drafted state forms as the contract body.
   AcreOS keeps the merge, gating, seal and orchestration, which is "orchestrate,
   not build" applied to legal content.
7. **(K14 + M)** A DocuSign adapter on the customer's own account. In the
   meantime, enforce signing order and add decline on the native rail.
8. **(L, partner)** Simplifile/CSC e-recording on a customer-connected account.
9. **(M)** Option, sub-to and wrap documents behind a correct Dodd-Frank/RMLO
   refusal.

### 5.5 Market and dispose: **FAILS**

See §2.

### 5.6 Operate the asset: **FAILS** for landlords, STR and CRE; **NEAR** for rehab and subdivision

| Job | Bar | Today | Verdict |
|---|---|---|---|
| Lease lifecycle | AppFolio / Buildium | UI creates `status:"draft"` with no tenants. PATCH, renew and attach-tenant have **zero client callers**. Expiry and renewal only read `active`. | **FAILS** |
| Recurring rent charges | Buildium | `generateScheduledCharges` exists; uncalled endpoint, no job. | **FAILS** |
| Payment allocation, deposit clock, late fees | Buildium + state rules | Excellent engines, computing over an empty ledger. | PARTIAL |
| Online rent collection | RentRedi | Absent. The compliant rail (`customerMoneyRouting`) already exists. | ABSENT |
| Screening and applications | TurboTenant + SmartMove | No provider; the attestation route has no caller. | ABSENT |
| Lease e-sign | — | `leaseSigningPacket.ts` has zero callers, and would run AcreOS's own ceremony, against the e-sign ruling. | ABSENT |
| Maintenance | AppFolio | Ticket CRUD. "Dispatch" notifies no one; no tenant intake or photos. | PARTIAL |
| Inspections | zInspector | The detail page works, but nothing can **create** one. | FAILS |
| MF unit mix, occupancy, T-12 | Yardi | Wired, but occupancy depends on leases that never activate. | PARTIAL |
| STR operations | Hospitable / Guesty | Read-only bookings table. Record, import, P&L, pricing and turnovers are API-only. | **FAILS** |
| CRE (CAM, escalations, % rent, abstraction) | VTS / Yardi CRE | ~20 tested endpoints with **no screen**. | **FAILS** |
| MHP (lot/home split, submeter billback) | Rent Manager | Pad inventory and chattel title wired; billing API-only. | PARTIAL |
| Rehab budget, bids, draws | FlipperForce / Buildertrend | Wired end to end; no schedule, change orders or lender draw packet. | **NEAR** |
| Rehab photos | CompanyCam | Wired; refuses until S3 is configured. | BLOCKED (K3) |
| Contractor payments and 1099 | — | The only payment writer has no caller, so the 1099 batch is structurally empty. | FAILS |
| Permits and entitlements | Permit trackers | Gate checklist and stall alerts wired; timelines seeded from a persona (§3). | PARTIAL |
| Subdivision plat, lots, basis, pricing | Bespoke GIS + Excel | Plan editor with lot polygons, basis allocation, pricing grid. `realize-cogs` unwired. | **NEAR** |
| Land holding (taxes due, insurance, health) | Land.id tax status + calendar | `/property-tax` covers note escrow only; no insurance tracking; "portfolio health" is CRM hygiene; P&L has no rent or expense side. | FAILS |
| Mobile and offline field capture | CompanyCam | The Capacitor shell loads the remote URL, so a cold start offline shows nothing. Push posts to a route that doesn't exist. | PARTIAL |

**Path:**
1. **(S, one wave) Make the rental loop run:**
   - a lease status control and tenant picker;
   - a "post scheduled charges" button plus a monthly job (ledger-only, so
     custody-safe);
   - a truthful empty state;
   - a Renew action;
   - inspection create and link;
   - contractor payment UI.

   This unlocks every existing landlord engine and the three landlord "live"
   workflow triggers.
2. **(S)** Demote commercial, STR and mobile_home to `beta` until their screens
   exist.
3. **(M each)** Commercial tab (terms, rent steps, CAM recon preview); STR tab
   (record or import a stay, P&L, turnovers); MHP billing tab.
4. **(M)** Rent collection through payment links on the **org's own** Connect
   account. Applicant-paid screening orchestrated through a vendor. Lease
   e-sign through the org's connected rail.
5. **(M)** A `property_tax_bills` table with a migration, an insurance policy
   record, and portfolio-health rules rewritten around tax, insurance and
   vacancy.
6. **(M/L)** STR iCal import, then a channel-manager partner. Lease
   abstraction from PDF. A tenant portal.
7. **(S/M)** Ship the bundled web assets in the native shell, add the push
   device-token route, and use the offline queue for photos and notes.

### 5.7 Money: **NEAR** for serviced notes, **ABSENT** for books and capital

| Job | Bar | Today | Verdict |
|---|---|---|---|
| Note from a sale (Close & Carry), ATR and usury gates | GeekPay / LoanPro | Real and idempotent. | **PASSES** |
| Payment application, late fees, payoff, periodic statements | FCI / NSC | Real, with non-pyramiding fees and one payoff engine. | **PASSES** |
| Borrower portal and online pay | GeekPay | Card and ACH on the **lender's own** Connect account. | NEAR (keys) |
| Autopay (ACH) | NACHA-correct | Hourly job; returns found by polling. | BLOCKED (`STRIPE_SECRET_KEY`) |
| Loan terms | Balloon / IO / ARM | Fixed and fully amortizing only. | PARTIAL |
| Delinquency notices | FDCPA-correct ladder | Email ladder with mini-Miranda; physical mail honestly unwired. | NEAR |
| State default and forfeiture | FCI default services | An alert at 31 days, then nothing. | ABSENT |
| Escrow (tax and insurance) | RESPA | Analysis wired; annual statement unwired; insurance tracked on the acquired book only. | PARTIAL |
| 1098 | Copy B + e-file | Generator built, never delivered; the portal copy is wrong (§3). | FAILS |
| 1099-INT | — | Honest refusal pending a tax reviewer (K13). | Correct refusal |
| Metro 2 credit reporting | FCI / LoanPro | — | ABSENT |
| Acquired-note book | Shadow ledger from the sub-servicer | Manual entry; invisible to every money roll-up. | PARTIAL |
| Customer GL / bookkeeping | Stessa / Baselane / QBO | The double-entry GL is **AcreOS's own** subscription books, founder-only. Customer "bookkeeping" is a note-interest report. | ABSENT |
| QuickBooks | Two-way OAuth | Fake button (§3). | FAILS |
| Per-property P&L | Stessa | No expense side, not per-property, orphan route. | FAILS |
| Tax planning | CPA-grade | Stale brackets (§3). | FAILS |
| Capital raise, LP portal, distributions | Juniper Square / InvestNext | `capital-markets` is frozen with TODOs. | ABSENT |
| Finance door per persona | Shaped per vertical | Identical tabs for every persona; it opens on seller-finance notes for STR and flippers too. | PARTIAL |

**Path:**
1. **(S)** The §3 money items. Hide the QuickBooks button unless a real token
   exists. Give the bookkeeping year a time zone.
2. **(S)** Deliver the 1098 batch (PDFs plus file), add a 1098s panel on
   notes-tax-readiness, and make the portal render the same output.
3. **(M)** Balloon, IO and ARM terms on serviced notes. Without them a typical
   land contract can't be boarded truthfully.
4. **(M)** A real per-property P&L: expenses, rent, and both note books,
   exposed as a Finance-door tab. Shape the Finance door per persona.
5. **(M)** A customer-scoped ledger reusing the existing chart-of-accounts
   machinery, with IIF export unlocked for org owners. That is an honest
   QuickBooks path before OAuth.
6. **(M)** A state default-rules table with counsel review, and dated
   default/loss-mitigation clocks on both books.
7. **(M)** A shadow ledger import from FCI/NSC remittance files for note
   investors.
8. **(L)** Intuit OAuth on the customer's own QuickBooks company; Plaid-type
   bank feeds on the customer's own credentials.
9. **(M/L, partner)** Metro 2 file generation for lenders who hold their own
   furnisher agreement. AcreOS never furnishes as itself ("be the rail").
10. **(L)** An entity, cap table and waterfall engine that *computes*
    distributions, which the sponsor pays on its own rails, plus a read-only
    LP portal. Cross-org investor matching waits for the marketplace ladder.
11. **Review:** Connect accounts are created as `express`
    (`server/services/stripeConnect.ts:147`). With Express, the platform
    typically carries negative-balance and dispute liability. Standard
    accounts, or OAuth to the lender's existing Stripe account, align more
    tightly with "be the rail". Confirm against current Stripe terms before
    changing anything.

### 5.8 Run the business: **NEAR**

| Job | Bar | Today | Verdict |
|---|---|---|---|
| Onboarding | Value in under 10 minutes | 3 steps, a tailored data step per vertical, labeled sample data that can be cleared. | NEAR |
| Migration from Podio / REsimpli | One-click importers | Generic mapper; `/import` has zero in-app links. | PARTIAL |
| Data export | One-click full archive | ZIP of everything. | **PASSES** |
| Pax tool honesty and approvals | Lofty / kvCORE AI | Hash-frozen approval kernel, TCPA refusals, receipts. Two holes (§3 #11–12). | NEAR |
| Pax autonomy controls | — | Org-wide stance plus pause. | **PASSES** |
| Workflow automation | Zapier / FUB action plans | 29 of 36 triggers live and honestly badged. Actions: no SMS, mail, HTTP or wait-for-reply step. | PARTIAL |
| Outbound webhooks | Every core event | 1 of 13 live. Five dispatch helpers have zero callers (`server/services/webhookDispatcher.ts:520-559`). | FAILS (S fix) |
| Google / Outlook mail and calendar | One-click OAuth | Fake "connected" (§3); dead calendar OAuth whose `state` is the org id (CSRF-prone); no Outlook. | FAILS |
| Team, roles, VA scopes | REsimpli / FUB | An 11-scope model enforced at **8 call sites** out of about 2,600 handlers. Rep-performance and offer-approval pages are orphaned. | PARTIAL |
| Analytics | REsimpli KPIs | 6 tabs, all mounted. | NEAR |
| 2FA, sessions, audit log | Stripe / Linear | Clerk MFA, session revoke (orphan route), audit log. | NEAR |
| Trust page / SOC 2 | Vanta-grade | Claims ahead of operations (§3). | FAILS |
| Billing | Stripe-grade | Canonical $49/$99/$199, but checkout charges whatever price ID is in env and never refuses on drift. | BLOCKED (new Stripe prices and secrets) |
| Reliability (G0) | 99.9% probed, Sentry, tested restores | Code present, unproven. | BLOCKED (K3, K4) |

**Path:**
1. **(S)** Wire the five webhook helpers and derive `LIVE_WEBHOOK_EVENTS` from
   real call sites.
2. **(S)** Add an outbound-webhook workflow action using the existing SSRF
   guard. That gives Zapier/Make reach without a public API.
3. **(S)** Mark Google connectors `planned`. Delete the dead calendar stack.
4. **(S)** Link the four orphan routes behind Settings and Today.
5. **(M)** A `send_sms` action on the org's own number, through the TCPA
   checks, plus a wait-until-reply step.
6. **(M)** One org-scoped Google OAuth with a nonce `state` and token refresh;
   Outlook via Graph.
7. **(M)** Adopt `requireScope` across financial and PII routes, with a
   census test that enumerates the handler population.
8. **(S)** Make checkout refuse when the env price drifts from the canonical
   price.

---

## 6. The cross-cutting patterns

1. **Built but unwired.** This was the dominant finding in every domain.
   Representative list:
   - offer batches;
   - reply auto-pause;
   - buyer blasts;
   - the custom-domain router;
   - webhook helpers;
   - lease status, tenant attach and rent charges;
   - the rental analytics page;
   - the subdivision pro-forma;
   - the rent-roll preview;
   - the county ingest job;
   - title orders;
   - land-contract and deed-of-trust PDFs;
   - contractor payments;
   - inspection create;
   - the 1098 batch;
   - servicer remittances;
   - the acquisition radar;
   - watchlist alerts;
   - native push;
   - `initiateCall`.

   **Most of the fastest wins in this report are one screen or one job
   registration away.** The gate fix is in §3: mounted-but-uncalled must
   become a reachability family.
2. **The platform's account where the customer's belongs.** Listing portals,
   the Meta catalog, zoning and title vendors, and platform-env skip-trace
   gating. This is the same shape as the BYO-send-rail ruling, applied to
   data and listings. **Recommendation for the founder:** state "BYO data and
   listing accounts" as an explicit corollary of "be the rail", and add it to
   `shared/governance/constitution.ts` with a gate that scans every
   provider/adapter for `process.env` credential reads outside the platform
   allow-list.
3. **Claims ahead of code.** About 30 surfaces (§3). They cluster on the
   highest-traffic surfaces: Today, the mail composer, the landing page, the
   listings empty state and the trust page. `lint:no-fabrication` needs to read
   UI template strings and toast copy, not just data paths.
4. **Owner actions gate a surprising amount of finished code.** In order of
   unlocked value:
   - **K7** Lob live (mail).
   - **K3** S3: documents, photos, backups, and the trust page's claim.
   - **ATTOM paid or BYOK**: residential comps, blind-offer county comps,
     zoning, title.
   - **K6** DNC.
   - **K10** Regrid: land comps, list coverage.
   - **K14** DocuSign.
   - **`STRIPE_SECRET_KEY`** plus Connect onboarding: borrower pay, autopay.
   - **K13** tax reviewer: 1099, the tax optimizer, NEC thresholds.
   - **K4**: G0 reliability.

   Engineering is not the critical path for these. The roadmap already says
   so.
5. **Tests that pin the bug.** The transfer-tax, county-fee and Dodd-Frank
   tests reimplement the production logic inline and agree with it. This is
   CLAUDE.md's "canonical function tested only against its own inputs", and
   it needs a ratchet: any test of a module under `server/services/**` whose
   file defines a same-named function instead of importing it should fail.

---

## 7. Recommended sequence

This respects the roadmap's stop rule (`docs/company/roadmap-2026-10.md`): no
H1 feature wave until the G0 owner actions are done; truth, debt, deletion and
consolidation work may run in the meantime.

**Wave T — truth (S items, allowed under the stop rule; about one wave):**
- Every §3 item.
- Demote commercial, STR and mobile_home in the registry.
- The reachability-gate family and the `lint:no-fabrication` widening, so the
  class can't come back.
- Revert the debug commit first.

**Wave W — wire what's built (S items, mostly allowed: wiring and consolidation, often net-negative LOC once dead paths are deleted):**
- Buyer-blast and sequence redirects.
- Reply auto-pause.
- Skip-trace panel plus BYOK gate.
- Webhook helpers.
- Rental loop (lease status, tenants, charges job).
- Investor-analytics route.
- Pro-forma and rent-roll preview.
- Orphan route links.
- Contractor payments and inspections.
- 1098 delivery.
- Import target fields and stacking.
- **Land the stranded branch (§8).**

**Wave L — finish the land wedge to best-in-class (M; needs the stop rule lifted or G0 crossed):**
1. Per-recipient blind-offer mail plus the batch handler (closes the land loop
   once K7 is armed).
2. List builder v0 on BYO Regrid/BatchData.
3. Public listing page, content pipeline and buyer CRM (§2 steps 1–3).
4. Sourced comps and AVM refusal; frontage-based access.
5. Balloon terms on serviced notes; recordable deeds; corrected state fee
   table.

This is the vertical the product is "deepest in", and the one where these
five builds take every lifecycle stage to NEAR or PASSES.

**Wave V — vertical depth, demand-ordered by design partners (M–L):**
- Landlord collection and screening (orchestrated).
- STR iCal and channel partner.
- CRE and MF acquisition underwriting with debt.
- Wholesale dialer partner plus inbound voice.
- Attorney contract packs.
- DocuSign and e-recording on customer accounts.
- Customer ledger plus QuickBooks.
- Capital waterfall.
- Metro 2 via partner.

**Owner-action queue that unlocks the most finished code:**
1. K7 Lob live key + webhook secret + `LOB_LIVE_SEND_ENABLED`.
2. K3 S3 bucket.
3. ATTOM: confirm paid status, or make customer BYOK the default.
4. K6 Searchbug.
5. `STRIPE_SECRET_KEY` + new price IDs.
6. K10 Regrid (>$500; founder decision).
7. K14 DocuSign sandbox.
8. K13 tax reviewer.
9. Counsel review: wholesaler and tax-deed outreach rules, state default
   rules, state contract forms.

**Founder decisions this report surfaces (not taken here):**
- (a) Record "no cold SMS without express consent" as a standing decision.
- (b) Separate email consent from TCPA consent.
- (c) "BYO data and listing accounts" as a constitution corollary.
- (d) Whether `/investor-network` (an ungated, cross-org investor directory
  with ratings, schema in `shared/schema/marketplace.ts`) falls under the
  marketplace ladder.
- (e) Express vs Standard Connect accounts.
- (f) Lifting the stop rule for Wave L.

---

## 8. Stranded work on this branch

`claude/acreos-maturity-research-findings-nhj3a1` carries **11 commits
(about 44k lines, 482 files) that never reached `main`**. They were pushed
after PR #318 merged on 2026-10-02, and no PR was opened for them. A twelfth
commit (the npm-audit gate) landed on `main` as a cherry-pick (`efafd8b5`).

A test merge against current `main` produces about 89 conflicts. This document
is committed on top of the branch unchanged. Its history was not rewritten.

| Commit | What it does | On `main`? | Readiness impact |
|---|---|---|---|
| `6f6c65f4`, `eb8f4e1b`, `9b9aa49b`: V0–V2 vertical program | A deterministic engine plus an underwriting desk behind an existing door for every vertical. "Evidence rule v2". Each vertical "decided + gradeable". `PUBLIC_CLAIM_DEMOTIONS` 13 → 0. | No. `main` still has 13 BETA demotions and `MATURITY_OVERCLAIM_BASELINE = 13`. | Moves 12 verticals' Underwrite cell from PARTIAL/ABSENT toward NEAR |
| `ef6b0d03` | The "Acquired" outcome measured against `acquisition_cost`, not `total_cost` | No. `main` biases every flip acquisition by its rehab cost. | Calibration truth |
| `7584766a` W10.2a | One live-lead predicate across ~93 files; bulk delete becomes a soft delete (opt-outs preserved) | No. DEFECT-0273 is open on `main`. | Tenancy and consent |
| `ca5a56b9` W10.2b | Newest-5,000 capped reads replaced by SQL aggregates | Partially | Figures wrong for large orgs on `main` |
| `0ee29aff` W10.3 | County list builder v0 behind Map | No | §5.1. It is itself blocked on a licence review (DEFECT-0292). |
| `59280cdc` | Popper z-index: Selects inside dialogs or sheets can't be chosen | No. `main`'s `select.tsx` is still `z-floating`, under `z-modal`. | User-visible, cheap |
| `1898309c` W10.4 | One close writer, typed 409 | Partially. The creation guard was redone on `main`; the close writer was not (DEFECT-0244 open). | Commission, sale and training rows on every close path |
| `0f4f846c` W10.5 | Late fee on every missed installment, autopay hold during card checkout, `ach_actum` retired | No. DEFECT-0185 and DEFECT-0277 are open on `main`. | Customer-money correctness |

**Landing order** (re-apply onto current `main` commit by commit, with the
gates run and redirected to a file each time, then an independent audit):
1. 59280cdc
2. ef6b0d03
3. V0
4. V1
5. V2
6. W10.5
7. W10.4
8. W10.2a
9. W10.2b
10. W10.3

**Hazards when landing:**
- **Defect IDs collide.** `main` already uses DEFECT-0284…0288 for different
  defects, so renumber the branch's IDs from 0289 upward.
- `main`'s new `shared/governance/evidenceLadder.ts` restates the 13 BETA
  caveats; it needs rewriting.
- Every ratchet JSON must be re-measured, not merged.
- The censuses (deal writers, live leads) must be re-walked against writers
  `main` added since.

**Estimate:** 2–4 focused waves. V0–V2 plus the two small fixes is one wave,
and the highest value for the effort in this whole report.

---

## 9. What this report did not verify

These need a production read, not a code read:
- Production env and key state: ATTOM paid vs lapsed, `REGRID_API_KEY`,
  `ZONEOMICS_API_KEY`, `STRIPE_SECRET_KEY`, the price IDs, `DOCUMENTS_S3_BUCKET`.
- Production feature-flag rows (`feature_avm`, `/dodd-frank`,
  `/portfolio-optimizer`, `feature_deal_rooms`).
- Whether the Land.com, LandFlip and LandSearch endpoints the code calls
  exist.
- Current wholesaler-statute status (for example, Pennsylvania's 2024
  regulation).
- The 2026 federal 1099-NEC threshold.
- The IRS FIRE → IRIS cut-over date.
- Live p95 latency.
- The knowledge-base article count.

---

## 10. Spot-check record

Each high-severity claim below was re-read in code after the agent report and
before it was included here:

- **Facebook listing on the founder token:** `META_ACCESS_TOKEN` at
  `listingSyndication.ts:599,796`; seller-finance default at `:830,844`.
- **Redirect intent dropped:** `/buyer-blasts` → `?channel=`, and no `channel`
  read anywhere in `campaigns.tsx`.
- **Custom-domain router unused:** `customDomainRouter` has zero importers.
- **LandWatch pre-selected:** `syndication.tsx:60`.
- **Webhooks:** `LIVE_WEBHOOK_EVENTS = ["lead.created"]`.
- **Fake "connected" connectors:** the connector upsert sets `connected` with
  whatever credentials arrive.
- **Expired date on the landing page:** the "2026-Q3" SOC 2 target.
- **Mislabeled Today brief:** "wrote back overnight" / "rents hadn't landed".
- **Support agent:** `voidInvoice` at `supportAgent.ts:4147`.
- **Outreach:**
  - `process-offer-batch` has no handler;
  - `pauseEnrollmentOnResponse` is defined only;
  - "handwritten" costs 350¢ on Lob;
  - org email identity on SendGrid, while sending runs on SES.
- **Money:**
  - 1098 Box 2 = `note.currentBalance`;
  - the QuickBooks callback stores the raw code;
  - "Files 1098s";
  - the debug 500 body.
- **Deals:**
  - the transfer-tax table, row by row, against its own notes;
  - the 1031 stubs;
  - the 3-property exemption branch ignores the rate type.
- **Lead generation:**
  - the skip-trace panel posts `{ leadId }` only;
  - `importFromCounty` is a no-op;
  - the "Lead added to outreach sequence" toast.
- **Underwriting:**
  - `countyAssessorIngestJob` has no external reference;
  - the road-access 1-mile rule;
  - `title-search.tsx` reads `.issues`;
  - the AVM prompt "Base your estimate…".
- **Operations:**
  - the UI lease is `status: "draft"`;
  - `generate-scheduled` has no client caller;
  - the "Brigid historicals" / "Brigid expansion estimate" seeds.
- **Branch:**
  - `MATURITY_OVERCLAIM_BASELINE = 13` on `main`;
  - "Pull lists" at `landing.tsx:64`;
  - `select.tsx` is `z-floating`.

One adjustment came out of spot-checking: road access is labeled "estimate,
confidence 60" in LandSnapshot rather than stated as fact. The finding stands,
because the field is still a boolean derived from proximity.
