# 16. Domain Experts — Real Estate (slots 226–240)

**Core tension each persona navigates:** data-feed integration vs liability. Title agents need title-search completeness. Recorders need deed-language compliance. Appraisers need comp-set defensibility. These 15 personas answer: *What AcreOS surface would make my workflow more efficient, and what would I require to trust it with regulatory attestation?*

---

## 226. Linnea Holstein — Title agent

**Lens:** Title-search-completeness; integration chain clarity. Owns title operations at a 2-state agency. Obsessed with "does AcreOS catch every lien before we issue?"

**State read:** Lien-searcher surface exists. No auto-pull from title-company feeds. Lien data is manual-upload-only. No integration with LPS (title-data vendor).

**Highest-leverage move:** Title-feed integration: AcreOS pulls pre-closing title reports from LPS or Stewart (major title vendors) → flags liens, judgments, easements automatically → surfaces exceptions to title agent 10 days pre-close. Wire `titleSearchResults` table to verify 100% of liens are documented before closing. Effort: 3 weeks.

**Biggest risk:** Lien missed in manual entry; AcreOS didn't flag it; title policy excludes it; buyer sues 18 months post-close; title company pays claim.

---

## 227. Cosima Bianchi — Escrow officer

**Lens:** Disbursement reconciliation; trust-account accuracy. Manages escrow accounts; obsessed with "does every penny balance to the cent?"

**State read:** AcreOS tracks deal-level cash (deposit, earnest money, closing costs). No escrow-account reconciliation against title-company trust statements. No automated 1099 reporting for interest earned.

**Highest-leverage move:** Escrow-reconciliation dashboard: pull monthly trust-account statement from title company, match against AcreOS closing ledger, flag discrepancies. Auto-generate Form 1099-INT for interest earned. Cosima can attest monthly without manual spreadsheet work.

**Biggest risk:** $5K discrepancy between AcreOS ledger and trust statement discovered during audit; Cosima can't reconcile 6 months post-fact.

---

## 228. Bartholomew Reeves — County assessor

**Lens:** Parcel-data accuracy; deed-language compliance. Public-records professional. Obsessed with "are recorded deeds using correct legal descriptions?"

**State read:** AcreOS stores parcel ID + legal description (text field). No validation against county assessor's deed records. No API to county assessor database.

**Highest-leverage move:** County-assessor integration pilot (top 10 counties): AcreOS queries county API (if available) or ingests assessor feed monthly, flags deeds where legal description doesn't match recorded deed in county system. Raises exception: "legal description mismatch—verify deed before recording." Effort: 4 weeks (1 county at a time).

**Biggest risk:** AcreOS deed has wrong legal description; investor records it; county rejects later transfer application; deal halts.

---

## 229. Phaedra Andros — Recorder of deeds

**Lens:** Deed-language compliance; statutory-form enforcement. County recorder; obsessed with "every deed filed in my county follows the 2025 statutory form."

**State read:** AcreOS deed-template exists. No state-versioned form. No auto-check against county statutory requirements (e.g. TX §5.006 grantor/grantee notice format).

**Highest-leverage move:** Statutory-form registry by county: AcreOS stores 2025 deed templates for all 50 states + territories, flags deviations when investor generates deed. Template includes TX notice, NY indexing clauses, CA transfer tax, etc. Pre-fill based on county + property type. Effort: 3 weeks (template curating + flagging logic).

**Biggest risk:** Deed format doesn't match county rules; recorder rejects filing; transaction delays 2 weeks.

---

## 230. Ferdinand Vargas — Real estate attorney (transactional)

**Lens:** Template-state-stewardship; contract-evolution tracking. Transactional lawyer advising 6 investor clients. Obsessed with "are all my contract templates current with 2025 statutes?"

**State read:** Contract-template library exists in AcreOS. No version-history for templates. No state-statute versioning. Investors use 2023 contract language in 2025 deals.

**Highest-leverage move:** Template-version registry: each contract template stores `updated_date`, `statute_references` (TX §5.069, NY §307), `legal_review_by` (attorney name + bar number), `expires_at` (force re-review every 2 years). Auto-flag investor-generated contracts using expired templates. Ferdinand reviews quarterly + re-signs. Effort: 2 weeks.

**Biggest risk:** Ferdinand updates one template but investor uses old version; deal closes under wrong statute; buyer sues for non-compliance.

---

## 231. Margolis Stein — 1031 exchange intermediary

**Lens:** Timeline-discipline (45/180 day rules). Qualified intermediary (QI); obsessed with "did the investor meet the 45-day identification deadline?"

**State read:** AcreOS has deal-date + close-date. No 1031-exchange timeline tracker. No auto-alert 40 days post-sale (5 days before 45-day ID deadline).

**Highest-leverage move:** 1031-timeline module: investor marks property as "1031 exchange triggering event," AcreOS stores sale-date, auto-alerts at 40d ("identify replacement properties by DATE"), 175d ("close replacement by DATE"). Margolis can audit 1031s in bulk to verify compliance. Wire to tax-return export (defer capital gains if in compliance). Effort: 2 weeks.

**Biggest risk:** Investor misses 45-day deadline; 1031 disqualified; owes capital-gains tax immediately; Margolis pays malpractice claim.

---

## 232. Hilarie Fontaine — Land surveyor

**Lens:** Metes-and-bounds digitization; easement mapping. Boundary surveys; obsessed with "can I store survey results + easements in AcreOS without PDF junk?"

**State read:** AcreOS has parcel-geometry (Regrid polygon). No dedicated easement table. No metes-and-bounds string storage. Survey PDFs are attached, not parsed.

**Highest-leverage move:** Survey + easement module: Hilarie uploads survey PDF → AcreOS extracts metes-and-bounds text, stores in `property_surveys.metes_and_bounds_text`. Auto-parses easements (utility, access, conservation) → populates `easements` table with type, grantor, termination-date. Hilarie can reuse surveys across investor clients (sanitized). Effort: 3 weeks (PDF parsing + easement OCR).

**Biggest risk:** Investor unknowingly subdivides easement land; utility company stops work mid-project.

---

## 233. Reid Halverson — Appraiser

**Lens:** Comp-set defensibility; appraisal-accuracy anchoring. Residential + land appraisals; obsessed with "my comps are comparable and I can defend them."

**State read:** AcreOS stores comp data from Regrid + MLS. No appraiser-specific comp-defense UI. No audit trail of "why I chose this comp."

**Highest-leverage move:** Appraiser comp-build UI: Reid pulls comps from AcreOS database (or MLS via Plaid integration), annotates each ("why this comp: same county, similar acreage, within 2 years"). Stores in `appraisalComps` table with `defenseNotes`. Appraisal PDF auto-includes comp-selection rationale. Lender or court can audit Reid's judgment.

**Biggest risk:** Lender challenges comp-set; Reid has no documented rationale; appraisal is thrown out; loan doesn't close.

---

## 234. Abebi Adeyemi — Environmental consultant

**Lens:** Phase I/II ESA documentation; disclosure-quality anchoring. Phase I/II environmental site assessments; obsessed with "does the ESA meet ASTM standards for title insurance exclusions?"

**State read:** AcreOS stores environmental disclosures (text field). No ASTM-standard reporting template. No integration with environmental-database feeds (tank history, brownfield status).

**Highest-leverage move:** ESA module: Abebi uploads Phase I/II report → AcreOS extracts findings (recognized environmental condition, business environmental compliance audit), stores as structured data. Auto-checks against EPA database for tank status, Brownfield database. Flags issues that might void title insurance. Generates environmental-disclosure certificate for closing.

**Biggest risk:** Phase I finds underground tank; investor doesn't disclose; buyer sues 2 years later for $500K remediation cost.

---

## 235. Yann Petit — MLS data analyst

**Lens:** Data-license terms; feed-update clarity. Owns MLS feeds for 3 regions. Obsessed with "can I legally share MLS comps with AcreOS's investor users?"

**State read:** AcreOS imports MLS data via Regrid (aggregator). No license-terms tracking. No audit trail of "who accessed MLS data and when."

**Highest-leverage move:** MLS-licensing audit table: for each MLS feed, AcreOS stores license-terms (e.g. "investor can view, not export"). Route-level guards: `/api/property/export-comps` checks license and returns error if investor tries to download MLS data. Yann gets monthly audit report: "X investors viewed MLS, Y accessed comps." Effort: 2 weeks.

**Biggest risk:** Investor exports MLS comps, sells them to real-estate agent; NAR sues investor + AcreOS for DMCA violation.

---

## 236. Solveig Berntsen — Public records researcher

**Lens:** Record-currency; courthouse-data freshness. Pulls courthouse records; obsessed with "are the parcel records I'm seeing 60 days stale or current?"

**State read:** AcreOS pulls county-assessor data monthly (batch). No real-time refresh. Deeds stored in AcreOS are 30-60 days old.

**Highest-leverage move:** Real-time courthouse feed: partner with county (Texas example: appraisal-district feed, Travis County recorder) to pull deed data daily. Flag: "recorded 2 days ago," "assessed 15 days ago." Solveig can pull research results with freshness timestamp. Investor sees "purchase date: Jan 15, last assessed: May 3 (current)" instead of guessing.

**Biggest risk:** Investor offers on property without knowing about recorded lien filed 3 weeks ago.

---

## 237. Henrik Christensen — GIS specialist

**Lens:** Coordinate-system fidelity; parcel-boundary accuracy. Maps + parcel data; obsessed with "NAD83 vs WGS84 vs local projections—which one is correct?"

**State read:** AcreOS uses Regrid polygons (WGS84 lat/lng). No projection-system documented. No easy re-projection for investors needing local UTM or state-plane coords.

**Highest-leverage move:** Projection-support module: for each parcel, AcreOS stores both WGS84 (web-standard) + state-plane projected coordinates (for GIS users). API endpoint `/api/parcel/:id/coordinates?projection=state-plane` returns UTM-ready coords. Henrik can feed AcreOS data into ArcGIS without re-projection work. Effort: 2 weeks (proj4 library integration).

**Biggest risk:** Investor exports parcel coords from AcreOS, uses them in GIS software with wrong projection, misses easement by 200 feet.

---

## 238. Imogen Strand — Lien searcher

**Lens:** Lien-type taxonomy; search-completeness. Searches for liens pre-close; obsessed with "did I find judgment liens, tax liens, AND mechanic's liens?"

**State read:** AcreOS has lien table. No lien-type taxonomy. No checklist of "lien types searched."

**Highest-leverage move:** Lien-search registry: Imogen marks property "lien search complete" only after checking: judgment liens (civil court), tax liens (county assessor), mechanic's liens (recorded), HOA liens (if applicable). AcreOS auto-flags incomplete searches + reminds Imogen 48h before closing. Closing can't proceed until Imogen signs off. Effort: 1 week.

**Biggest risk:** Imogen forgets mechanic's lien check; $150K lien discovered post-close; title insurance covers it but subrogation claim against contractor takes 2 years.

---

## 239. Ruairidh MacLeod — BPO/CMA analyst

**Lens:** CMA-defensibility; market-support documentation. Broker price opinions; obsessed with "my CMA is defensible if challenged by lender or appraiser."

**State read:** AcreOS stores market data (comps, neighborhood trends). No CMA-template or defense-documentation surface.

**Highest-leverage move:** CMA-builder UI: Ruairidh pulls market data from AcreOS (MLS comps, tax comps, recent sales), annotates market factors (school district, flood zone, recent zoning change), generates CMA report with built-in defense rationale. Lender can audit Ruairidh's methodology. Effort: 2 weeks.

**Biggest risk:** Lender challenges CMA value; Ruairidh has no documented defense; appraisal is ordered; deal delays.

---

## 240. Lev Berkovich — Foreclosure auctioneer

**Lens:** Bid-day operations; title-clarity pre-sale. Trustee sales; obsessed with "every foreclosure I run has clean title and clear bidding rules before auction day."

**State read:** AcreOS has property detail, title status. No pre-sale checklist for trustees. No auction-day operational runbook.

**Highest-leverage move:** Auction-readiness module: Lev marks property "auction ready" after verifying: title insurable, no pending appeals, opening bid set, trustee affidavit filed. Auto-generates trustee-notice PDF (Texas required format). Links to county recorder for last-minute deed checks. Auction day: property is guaranteed-ready to sell. Effort: 3 weeks.

**Biggest risk:** Bidder purchases property, discovers mechanic's lien post-auction, sues Lev for fraud.

---

## 241. Category-level synthesis: Domain Experts — Real Estate

**Top 5 recommendations clustered from the 15 memos:**

1. **Title/courthouse data-feed integration (Linnea, Cosima, Bartholomew, Phaedra, Solveig)** — Automation of title-search completeness + deed-language compliance. Partner with LPS / Stewart / county recorders for automated feeds. Tier 1: Texas (10 counties), Tier 2: California (5 counties). Effort: 6 weeks phased.

2. **Statutory-form registry + template-version control (Ferdinand, Phaedra, Reid)** — Contract templates versioned by statute + requiring attorney re-sign every 2 years. State-specific deed forms enforced at generation-time. Effort: 3 weeks (templates + flagging logic).

3. **1031 + survey + ESA + appraisal domain-specific modules (Margolis, Hilarie, Abebi, Reid)** — Four small domain-expert modules: 1031-timeline auto-alerts, survey-metes-and-bounds parser, ESA-ASTM compliance, appraiser-comp-build UI. Effort: 8 weeks (1 week each, 4-week parallelization).

4. **MLS-licensing audit + courthouse-feed freshness (Yann, Solveig, Imogen)** — Feed-currency dashboard (record age + license-term compliance). Route guards enforce export restrictions. Courthouse feeds refreshed daily. Effort: 3 weeks.

5. **Auction-readiness + lien-search checklists + CMA-builder (Imogen, Lev, Ruairidh)** — Pre-close verification surfaces for auctioneer, lien-searcher, appraiser. One-click "ready to close / auction" sign-offs. Effort: 3 weeks.

