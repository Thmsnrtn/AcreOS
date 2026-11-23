#!/usr/bin/env tsx
/**
 * Audit public landing-page claims against named sources — with the claim
 * list POPULATION-ENFORCED against the real landing surface.
 *
 * REWORKED 2026-09-01. The original version had the exact gate defect this
 * repo's third law describes: it verified a hand-copied claim list against
 * hand-written source paragraphs, scanned no actual public surface, and one
 * of its sources ("AcreOS job queue latency targets") described a lead-ingest
 * job with a 90-second p95 that NEVER EXISTED — the audit was certifying a
 * fabricated claim against a fabricated source, in CI, green. The 2026-09-01
 * truth-sweep removed the 90-second claims from the landing; this rework
 * removes the mechanism that let them pass.
 *
 * Three passes now run, and all three gate CI (ci.yml truth-engine:audit):
 *
 *   1. LIVENESS — every audited claim carries an `anchor` that must appear
 *      verbatim in the real landing sources. An entry whose sentence was
 *      edited or retired fails here, so the claim list cannot audit ghosts.
 *   2. COMPLETENESS — the real landing files are comment-stripped and
 *      scanned for number-bearing marketing claims (N seconds/minutes/days,
 *      $N, N%, N–N score ranges). Every match must be covered by a claim
 *      anchor or an EXEMPT entry with a dated reason. A new number on the
 *      landing that nobody sourced fails here.
 *   3. VERIFICATION — the original truth-engine pass: each claim's tokens
 *      must match a named backing source. Sources describe ENFORCED reality
 *      (registry files, live query paths, recorded founder retentions) —
 *      never aspirations. Adding a source paragraph for a mechanism that
 *      does not exist is the defect this header records; don't repeat it.
 *
 * Exit code: 0 = all three passes clean; 1 = any failure.
 * Scripts are CLI tools — console.log is the intended interface.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyClaims, type Source } from "../server/services/truth-engine";
import { stripCommentsPreservingLines as stripComments } from "./lib/strip-comments.mjs";
import { TIER_PRICES_CENTS } from "../shared/billing/tier-pricing";
import { BUSINESS_TYPES, BUSINESS_TYPE_IDS, type PublicMaturity } from "../shared/business-types";
import { publicMaturityOf } from "../shared/business-types/publicClaims";

/**
 * The business-types SOURCE paragraph is DERIVED from the registry's public
 * projection, never hand-written — the same rule the pricing source follows.
 * Until 2026-11-15 it was prose naming "beta (residential wholesaler,
 * buy-and-hold rentals, subdivider, tax lien / deed)" and "roadmap
 * (fix-and-flip, short-term rentals, …)" — a tiering the registry had not
 * held since 2026-08, so the audit was verifying landing claims against a
 * source that described no shipped state. Now the lists below are what
 * `publicMaturityOf` says a stranger is told, per type (FD1, 2026-11-12), so a
 * registry change moves the source and a stale claim stops verifying.
 */
const publicTierLabels = (tier: PublicMaturity): string =>
  BUSINESS_TYPE_IDS.filter((id) => publicMaturityOf(BUSINESS_TYPES[id]) === tier)
    .map((id) => BUSINESS_TYPES[id].label.toLowerCase())
    .join(", ");

/**
 * The pricing SOURCE paragraph is DERIVED from the canonical tier registry,
 * never hand-written. Until 2026-11-03 it was prose saying "Pro is $49/mo …
 * displayed as $41/mo billed annually" and the claim said "Pro at $41/mo" —
 * the claim verified against a source that agreed with it while the registry
 * had moved to $49 / $99 / $199. A literal claim checked against a
 * registry-derived source cannot do that: change a price and the claim's
 * tokens stop matching until someone updates the claim to the truth.
 *
 * Known floor, not ceiling: the engine substring-matches, so "$99" also
 * matches inside "$990" — a Pro MONTHLY drift alone trips only the derived
 * "Save 17%" claim here. The rendered surfaces are pinned exactly by
 * tests/unit/publicPricingMatchesCanonical.test.tsx.
 */
const proPrice = TIER_PRICES_CENTS.pro;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
const annualSavePct = Math.round(
  (1 - proPrice.priceYearlyCents / (12 * proPrice.priceMonthlyCents)) * 100,
);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The real public surface the claim list is enforced against.
 *
 * 2026-09-02 (customer autonomy clarity program, wave 1 F): FAQ, Agents,
 * DayInLife and ProductShots were added. They were a known blind spot — the
 * FAQ advertised an "autonomy slider … Auto-send" that no code implemented
 * and DayInLife printed "37 servicing receipts sent overnight" from no row,
 * and neither sentence was in this population, so the audit was green over
 * exactly the fabrications it exists to catch (third law). Every landing
 * section that renders prose is now listed; a new section must be added here
 * or the vacuity floor below is the only thing that notices.
 */
const LANDING_FILES = [
  "client/src/pages/landing/copy.ts",
  "client/src/pages/landing/Features.tsx",
  "client/src/pages/landing/Quotes.tsx",
  "client/src/pages/landing/Pricing.tsx",
  "client/src/pages/landing/Positioning.tsx",
  "client/src/pages/landing/FinalCTA.tsx",
  "client/src/pages/landing/Hero.tsx",
  "client/src/pages/landing/FAQ.tsx",
  "client/src/pages/landing/Agents.tsx",
  "client/src/pages/landing/DayInLife.tsx",
  "client/src/pages/landing/ProductShots.tsx",
];

/**
 * The W3 public land surfaces (2026-10-11 independent audit). The parcel
 * report, the landlocked checker, the county guides and the founding-member
 * page are public and crawlable — the report and guides are server-rendered
 * from the server-side files below, so the HTML a crawler indexes is written
 * there, not in the .tsx. The wave shipped them outside this population; a
 * number added to any of them was free to go unsourced (third law). Each
 * member is asserted read and non-trivial below (per-member vacuity), so a
 * renamed file fails here instead of silently leaving the scan.
 */
const PUBLIC_LAND_FILES = [
  "client/src/pages/public-parcel-report.tsx",
  "client/src/components/public-land/LandFactsSection.tsx",
  "client/src/pages/tools/landlocked.tsx",
  "client/src/pages/public-county-guide.tsx",
  "client/src/pages/founding-member.tsx",
  "server/services/publicLandPages.ts",
  "server/services/publicCountyGuide.ts",
  "server/services/landlockedCheck.ts",
  "server/routes-public-land.ts",
  "server/routes-public-parcel-report.ts",
  "shared/landData/publicFactText.ts",
  "shared/billing/foundingMemberOffer.ts",
];

/**
 * W5a trust and giving (2026-10-11): the public owner opt-out page and the
 * member-facing giving panel. Both carry wording a reader relies on — what
 * AcreOS stops, what it keeps, what it gives — so both are read here, with a
 * per-member vacuity floor below.
 */
const W5A_TRUST_FILES = [
  "client/src/pages/owner-request.tsx",
  "client/src/components/settings/MembershipGivingPanel.tsx",
];

/**
 * P2-6 S1 (2026-11-15): the dated /trust page. Every sentence on it is a
 * public promise about money, data, records or disputes, so the whole page is
 * in the population, with a per-member vacuity floor below. Its claims are the
 * "P2-6 /trust" entries in CLAIMS, each backed by a source paragraph that
 * names the shipped code making it true.
 */
const TRUST_PAGE_FILES = [
  "client/src/pages/trust.tsx",
  // Diet micro-slice #3: the sentences moved out of the page into the source
  // module the served /trust-content.json is generated from (and pinned to by
  // tests/unit/staticDataServedAsData.test.ts). Same anchors, same verbatim
  // sentences; the page file stays in the population (vacuity floor intact).
  "client/src/data/trust-content-data.ts",
];

/** Strip comments so truth-notes and design notes don't read as claims. */

function landingSurface(): { file: string; text: string }[] {
  return [...LANDING_FILES, ...PUBLIC_LAND_FILES, ...W5A_TRUST_FILES, ...TRUST_PAGE_FILES].map((f) => {
    let raw = "";
    try {
      raw = readFileSync(join(ROOT, f), "utf8");
    } catch {
      /* a retired file simply contributes nothing */
    }
    return { file: f, text: stripComments(raw) };
  });
}

/**
 * Claims under audit. `claim` is what the truth engine verifies against the
 * backing sources; `anchor` is an exact substring that must exist in the
 * live landing surface (liveness), and whose number-tokens count as covered
 * for the completeness scan.
 */
/**
 * P2-6 S1 — the /trust page's claims. Each entry's claim AND anchor are the
 * page sentence verbatim, so editing a sentence on the page fails liveness
 * (checked against the /trust page itself, below) until this list and the
 * matching source move to the same truth. The figures on the page (30 days,
 * $50, $10,000) are covered by these anchors for the completeness pass.
 */
const TRUST_LINES: readonly string[] = [
  // INV-1 no custody (architecture tense only).
  "Your borrowers pay your Stripe account directly. AcreOS is built so it can never touch, hold, or move your money.",
  "Borrower payments are set up on your own Stripe Standard account, with no AcreOS fee taken from them and no AcreOS account to fall back to.",
  // INV-2 licensed-data gate.
  "We only show you parcel data we're licensed to show you — and we'd rather show you nothing than data we can't stand behind.",
  "A parcel source must be cleared in writing before it answers a lookup, and until it is, the gate stays shut.",
  // INV-3 field-level encryption, exactly scoped.
  "Your own EIN or SSN for tax forms, and a borrower's tax ID on a purchased note, are encrypted field by field with AES-256-GCM and never sent back to the browser.",
  "We never store full card or bank numbers. Your payment processor holds them; AcreOS keeps a reference and the last four digits.",
  // INV-4 tenant isolation.
  "One organization can never read another's book. That is tested, not just designed: automated tests check it on every change.",
  // INV-5 money-back guarantee.
  "Ask within 30 days of your first charge and we refund that charge in full, no questions asked.",
  "Eligible refunds are automated at any amount, so a refund above $50 doesn't wait on a person to approve it.",
  // INV-6 fail-closed fences as record integrity.
  "We protect your loan records' integrity. When a record can't support a request, AcreOS refuses and says why rather than guess:",
  "A 1099-INT is not generated until the payer and recipient tax details it needs are on file.",
  "A request to erase a borrower is refused, naming the notes involved, while their loan and tax records must keep that identity.",
  "Skip tracing runs only after you state a permissible purpose under the FCRA and sign the attestation.",
  // INV-7 consent discipline.
  "No cold texting without written consent. A verbal yes is not enough.",
  "Email consent is separate from texting consent; one never stands in for the other.",
  "Every grant and revocation goes into an append-only consent record, and it comes with a person's data export.",
  // INV-8 auditability.
  "Your audit log is append-only and hash-chained: each entry seals the one before it, so an altered or removed entry shows when the chain is checked.",
  "The data-retention job won't purge an account that is under a legal hold.",
  // INV-9 / D3 portability + succession.
  "Your book is exportable in full, any time — and for 30 days after your subscription ends.",
  "If AcreOS moves into its own company (a Massachusetts LLC is being formed) or changes hands, the Terms pass to the new owner and your subscription continues under them.",
  // D1 AI data-flow floor.
  "When you ask Pax for help, the records it needs to answer — which can include a borrower's or seller's name, address and loan details — are sent to OpenRouter, which passes the request to the model that answers it.",
  "AcreOS's backup route for those requests is OpenAI. If you connect your own AI key, the request runs on your key with that provider instead.",
  // D2 arbitration account.
  "Our Terms send disputes to binding individual arbitration with JAMS instead of court, and neither side can bring a class action.",
  "In plain words: if something goes wrong, you and AcreOS settle it one-on-one before a neutral arbitrator, in Massachusetts or by phone or video.",
  "AcreOS pays the JAMS fees on claims under $10,000, and you can opt out of arbitration by emailing legal@acreos.io within 30 days of first agreeing to the Terms.",
  // INV-10 honesty posture.
  "AcreOS is new and in active development, run by one person: Thomas Norton, a sole proprietor in Massachusetts.",
  "It's in beta, and what early users tell us shapes what gets built next. Wherever AcreOS shows example data, it's labelled as example data.",
];

const CLAIMS: { claim: string; anchor: string; surface?: "trust" }[] = [
  ...TRUST_LINES.map((line) => ({ claim: line, anchor: line, surface: "trust" as const })),
  {
    // W5a giving panel (Settings → Billing). Founder decision 2026-10-09; the
    // panel itself shows only receipted amounts (shared/trust/giving.ts).
    claim: "For every paying member, AcreOS commits $1 a month of its own money to a food bank serving that member's area.",
    anchor: "AcreOS commits $1 a month of its own money",
  },
  {
    // hero wedge — pinned verbatim by landingReposition.test.ts.
    claim:
      "One platform that finds the deals, sends the mail, drafts the replies, closes the deal, and services the note after.",
    anchor:
      "One platform that finds the deals, sends the mail, drafts the replies, closes the deal, and services the note after.",
  },
  {
    // hero.ctaSub — replaced the withdrawn "first county list inside 10
    // minutes" (readiness plan 2026-09-29 item 0.7); CSV import is real
    // (POST /api/leads/csv-import).
    claim: "Bring your county list as a CSV — AcreOS reads the columns and skips owners you already have.",
    anchor: "Bring your county list as a CSV",
  },
  {
    // hero.ctaSub — the Land Credit Score scale, real in landCredit.ts.
    claim: "every parcel gets a Land Credit Score — a 300–850 read on the parcel itself",
    anchor: "a 300–850 read on the parcel itself",
  },
  {
    claim: "Deepest in land — the founding wedge.",
    anchor: "deepest in land",
  },
  {
    claim: "The land toolkit — every parcel checked against five federal data sources, free",
    anchor: "five federal data sources",
  },
  {
    // Features buy-box card — the enforced ingest mechanic (emitLeadCreated
    // fires customer workflow conditions when a lead is stored).
    claim: "Every new lead is checked against them the moment it's stored",
    anchor: "checked against them the moment it's stored",
  },
  {
    // Features offer-composer card — on-demand generation, no latency claim
    // (the unbacked "30 seconds" was removed 2026-09-01 by this rework).
    // "Pax defends the price" is positioning, not a numeric claim, so the
    // audited mechanic is the generation itself.
    claim: "Generate a written offer in one tap",
    anchor: "Generate a written offer in one tap",
  },
  {
    // hero cta1 + Pricing + FinalCTA — the trial length, enforced at 14
    // days in routes-billing.ts / trialService.ts.
    claim: "Start free — 14 days, no card",
    anchor: "14 days, no card",
  },
  {
    // Prices render from the tier registry at runtime (pricing-copy.ts →
    // displayMonthlyPrice), so no price literal exists on the surface; the
    // anchor is the billing line and the SOURCE is derived from the registry.
    // CORRECTED 2026-11-03: this record said "Pro at $41/mo" — the pre-repricing
    // Pro annual figure ($490 / 12). Canonical Pro is $99/mo or $990/yr.
    claim: "Pro at $99/mo, or $990/yr billed annually, unlocks the full Pax assistant, unlimited counties, and bring-your-own-key",
    anchor: "Billed $",
  },
  {
    claim: "Annual Save 17%",
    anchor: "17%",
  },
  {
    claim:
      "Deepest in land — the founding wedge — with every investor type the platform serves labeled by what's true today",
    anchor: "labeled by what's true today",
  },
  {
    claim: "Connect your own Twilio, SendGrid, Lob, and property-data accounts, or run on ours.",
    anchor: "Connect your own Twilio, SendGrid, Lob",
  },
  {
    // FAQ "Can the AI assistant be turned off?" — the witnessed-send rule
    // (founder decision 2026-09-02 #1), enforced by the approval kernel and
    // ratcheted by paxWitnessedSend.test.ts at every offered stance.
    // RE-ANCHORED 2026-11-16 (PR #566 fix round): E-36(a) replaced the
    // blanket sentence with the shipped distinction — Pax's own drafts wait
    // for the tap; automations the customer switched on (drips, campaigns)
    // send on their schedule (sequenceProcessorService). The blanket
    // sentence is retired; do not resurrect it.
    claim:
      "Pax's own drafts never send until you tap Approve — and anything you automate (drips, campaigns) sends only on the schedule you switched on.",
    anchor: "Pax's own drafts never send until you tap Approve",
  },
  {
    // FAQ, same answer — the one Pause and the two stances
    // (POST /api/pax/pause, PATCH /api/pax/controls, OFFERED_STANCES).
    claim: "Pause everything with one tap, or set Pax to ask before it changes anything.",
    anchor: "Pause everything with one tap, or set Pax to ask before it changes anything.",
  },
  {
    // FAQ "What happens on cancel?" — the retention terms, which must match
    // the binding privacy policy exactly. The previous sentence claimed
    // "AcreOS retains nothing after cancellation", which both the policy's
    // retention table and the deletion routine contradict (corrected
    // 2026-09-04).
    // RE-ANCHORED 2026-11-16 (PR #566 fix round): E-37 (claims register
    // CR-037) replaced the 90-day sentence with the verified-request
    // wording. The promise is kept with margin by the layers beneath it:
    // the policy's deletion-request paragraph commits to delete or
    // anonymize within 7 days of verification, and every DSAR intake is
    // stamped with the 24h operational clock (shared/privacy/dsarClock.ts)
    // — the published 30 days is the outer bound, not the target.
    claim:
      "After you cancel, we complete deletion of your account and lead data within 30 days of a verified request, except records the law requires us to keep or that sit under a legal hold — tax and loan records are kept on the retention schedule our Privacy Policy states.",
    anchor: "within 30 days of a verified request",
  },
  {
    // FAQ "Can existing lists be imported?" — the mechanism, after the four
    // named vendors were removed (2026-09-04). REISift and Pebble appeared
    // nowhere else in the repository and the import has no preset for ANY
    // vendor; "dedupes against owners already mailed" overstated
    // findDuplicateLeads, which reads leads and never mail history.
    claim:
      "AcreOS recognizes the common column headers, lets you map the rest as you import, and skips contacts already in your pipeline.",
    anchor: "skips contacts already in your pipeline",
  },
  {
    // FAQ "What about existing notes and loans?" — replaces a sentence naming
    // Beanstalk and Note Servicing Center, neither of which exists anywhere
    // in this repository, plus an unbounded 30-minute migration call.
    claim:
      "Originated and purchased notes each have their own import, and from there AcreOS carries the loan: balances, posted payments, and the borrower record.",
    anchor: "originated and purchased notes each have their own import",
  },
  {
    // FAQ "How fast can a new operator get started?" — replaces "Define the
    // buy-box, and the first list pulls overnight", an engine that does not
    // exist (no buy-box scan; countyAssessorIngestJob has no caller).
    claim:
      "The rules you switched on work your list without you — scoring and staging happen on their own, drips you turn on send on their own schedule, and every message Pax writes still waits for your tap.",
    anchor: "scoring and staging happen without you",
  },
];

/**
 * Number-bearing matches the completeness scan may skip, each with a dated
 * reason. Keys are the exact matched token; entries are checked for
 * continued existence so a resolved exemption must be removed.
 */
const EXEMPT: Record<string, string> = {
  // Hero.tsx SVG gradient stops / geometry — not marketing claims
  // (verified 2026-09-01: <stop offset> and stroke attributes).
  "0%": "Hero SVG gradient stop offset (2026-09-01)",
  "20%": "Hero SVG gradient/geometry value (2026-09-01)",
  "50%": "Hero SVG gradient/geometry value (2026-09-01)",
  "60%": "Hero SVG gradient/geometry value (2026-09-01)",
  "100%": "Hero SVG gradient stop offset (2026-09-01)",
  // Hero.tsx illustrative fixture cards, each labeled "Example ·
  // representative output" on screen (7 such labels in the file) — sample
  // deal figures, not capability claims (verified 2026-09-01).
  "$14": 'fixture: "$14,200 cash" in the labeled example draft (2026-09-01)',
  "12%": 'fixture: "12% above the median" in the labeled example draft (2026-09-01)',
  "87%": "fixture: example confidence figure on a labeled example card (2026-09-01)",
  "$487": 'fixture: "$487.50" example payment on a labeled example card (2026-09-01)',
  "$2": "fixture: dollar figure inside a labeled example card (regex prefix match, 2026-09-01)",
  // ProductShots.tsx frames — every value is a hand-authored illustration of
  // the SHAPE of product output, each frame carries a visible "Example ·
  // representative output" chip and the band is aria-hidden (file header,
  // HOUSE RULE). Regex prefix matches of the comma-formatted figures
  // (verified 2026-09-02).
  "$31": 'fixture: "$31,900" est. value in the labeled Map example frame (2026-09-02)',
  "$15": 'fixture: "$15,400 cash" in the labeled Pax example thread (2026-09-02)',
  "$16": 'fixture: "$16,000" seller line in the labeled Pax example thread (2026-09-02)',
  // Agents.tsx sample cards — illustrative rows on the "Pax just finished /
  // Pax ledger" sample cards (same contract as the hero fixtures); $14 and
  // $2 are already covered above by prefix. (verified 2026-09-02)
  "$11": 'fixture: "$11,200 – $14,800" suggested offer band on the Analysis sample card (2026-09-02)',
  // DayInLife.tsx BEFORE column — the operator's Tuesday WITHOUT AcreOS
  // ("Borrower receipt search across Gmail threads. Found after 90
  // minutes."): a description of the pain, not a claim about the product.
  // (verified 2026-09-02)
  "90 minutes": "DayInLife BEFORE-column pain narrative, not a product capability claim (2026-09-02)",
  // shared/landData/publicFactText.ts buildable-acres wording: "the 1% flood
  // zone" is FEMA's name for the 1%-annual-chance Special Flood Hazard Area,
  // a defined term, not a performance claim (verified 2026-10-11).
  "1%": "FEMA's 1%-annual-chance flood zone, a defined term in the public fact text (2026-10-11)",
};

/** Number-bearing marketing-claim shapes. */
const NUMBER_CLAIM = /\b\d+(?:\.\d+)?\s?(?:seconds?|minutes?|hours?|days?|federal data sources)\b|\$\d+|\b\d+%|\b\d{3}–\d{3}\b/g;

function buildSources(): Source[] {
  return [
    // ── P2-6 S1 /trust page sources. Each quotes the page sentences it backs
    // verbatim, then names the shipped code that makes them true. ──────────
    {
      name: "/trust INV-1 — no platform custody of customer money (constitutional hard-stop)",
      ref: "shared/governance/constitution.ts (hard-stop.no-platform-money-custody) + server/services/customerMoneyRouting.ts (prepareCustomerMoneyCall, PlatformTakeError) + server/services/stripeConnect.ts + tests/unit/moneyCustodyHardStop.test.ts + tests/unit/sellerFinanceConnectAccountsAreStandard.test.ts",
      content: `
        Your borrowers pay your Stripe account directly. AcreOS is built so it can never touch, hold, or move your money.
        Borrower payments are set up on your own Stripe Standard account, with no AcreOS fee taken from them and no AcreOS account to fall back to.
        Architecture, not operation: the constitutional hard-stop says customer money never moves on AcreOS's own account.
        prepareCustomerMoneyCall() scopes every customer-money Stripe call to the org's own connected account and throws
        PlatformTakeError on application_fee_amount / application_fee_percent / transfer_data / on_behalf_of, and
        UnscopedCustomerMoneyCallError when no org account exists — there is no platform fallback. Connected accounts
        are created as Stripe STANDARD accounts (sellerFinanceConnectAccountsAreStandard.test.ts). No payment has ever
        settled in any environment, so no surface may say payments run through AcreOS.
      `,
    },
    {
      name: "/trust INV-2 — licensed-data lookup gate (fail-closed, nothing cleared)",
      ref: "server/services/openData/statewideSourceRegistry.ts (LOOKUP_CLEARANCE, NO_LOOKUP_ENTRY) + server/services/parcel.ts + server/services/openData/fieldClearanceRegistry.ts + tests/unit/fieldLevelServing.test.ts",
      content: `
        We only show you parcel data we're licensed to show you — and we'd rather show you nothing than data we can't stand behind.
        A parcel source must be cleared in writing before it answers a lookup, and until it is, the gate stays shut.
        parcel.ts reads LOOKUP_CLEARANCE before querying any statewide row; an entry answers a live lookup only when it is
        explicitly cleared with every evidence field filled, a missing entry is gated (fail-closed), and today every state
        is gated. The field-clearance registry transcribes the written determinations but widens nothing live; enabling a
        source is a reviewed code change pinned by fieldLevelServing.test.ts. No county or state coverage is claimed live.
      `,
    },
    {
      name: "/trust INV-3 — field-level encryption of held tax IDs + processor-held card and bank numbers",
      ref: "server/services/fieldEncryption.ts (ALGORITHM aes-256-gcm, encrypt) + server/routes-organization.ts (tax identity: ein = encrypt(taxId)) + server/routes-notes.ts (payerEncryptedTin = encryptField(payerTin)) + server/utils/secretColumns.ts + server/middleware/secretColumnGuard.ts + shared/schema/ach-autopay.ts (processor handles, accountLast4)",
      content: `
        Your own EIN or SSN for tax forms, and a borrower's tax ID on a purchased note, are encrypted field by field with AES-256-GCM and never sent back to the browser.
        We never store full card or bank numbers. Your payment processor holds them; AcreOS keeps a reference and the last four digits.
        Scoped, not blanket — the page names these two and claims nothing about any other tax ID
        (contractors.taxIdEncrypted is still stored as typed, a TODO in routes-contractors.ts, and no
        encrypting writer for leads.taxId was found): the organization's tax identity (taxIdType EIN or SSN) is written to organizations.ein as
        encrypt(taxId), and an acquired note's payer TIN is written to payerEncryptedTin as encryptField(payerTin), both
        through fieldEncryption.ts (aes-256-gcm, 256-bit key). Both columns are registered ciphertext in secretColumns.ts,
        which the response guard strips from every JSON response. CONTACT_SENSITIVE_FIELDS / LAND_SENSITIVE_FIELDS
        (encryptContactRecord / encryptLandRecord) have no production caller, so no claim names them. Card and bank
        details live with the processor: ach_autopay rows hold processor handles (pm_, mandate_, seti_) plus bankName,
        accountLast4 and accountType for display, and moneyCustodyHardStop.test.ts forbids any route naming raw bank
        routing or account numbers.
      `,
    },
    {
      name: "/trust INV-4 — tenant isolation, tested on every change",
      ref: "tests/unit/orgScopedWritesRatchet.test.ts (+ orgScopedWrites.baseline.json) + scripts/check-org-scoped-fetch.mjs (npm run lint:org-fetch, in the check chain) + tests/unit/crossTenantPathsClosed2026_09_04.test.ts",
      content: `
        One organization can never read another's book. That is tested, not just designed: automated tests check it on every change.
        Every request is scoped to the caller's organization; the org-scoped-writes ratchet and the org-scoped fetch lint
        (part of npm run check) plus the cross-tenant path tests run in CI on every pull request and every push to main.
      `,
    },
    {
      name: "/trust INV-5 — the §5A money-back guarantee, automated at any amount (PR #550)",
      ref: "client/src/pages/terms.tsx §5A + server/services/refunds/refundConfig.ts (GUARANTEE_WINDOW_DAYS = 30) + server/services/refunds/guaranteeEligibility.ts (E1–E6; amount is not a predicate) + server/services/refunds/requestGuaranteeRefund.ts + server/services/refunds/executeRefund.ts + server/routes-billing.ts",
      content: `
        Ask within 30 days of your first charge and we refund that charge in full, no questions asked.
        Eligible refunds are automated at any amount, so a refund above $50 doesn't wait on a person to approve it.
        Terms §5A: a full refund of the initial paid subscription's first charge, requested within 30 days, no questions
        asked. GUARANTEE_WINDOW_DAYS = 30. evaluateGuaranteeEligibility checks E1–E6 and AMOUNT IS NOT A PREDICATE; when
        a request is eligible and no brake applies, requestGuaranteeRefund calls executeRefundRequest immediately, so the
        refund is issued without a person approving it — the older $50 ceiling of the apply_refund hand does not govern
        guarantee refunds. No refund has been issued yet (no customers), so no claim says one has.
      `,
    },
    {
      name: "/trust INV-6 — fail-closed record fences (1099-INT, borrower erasure, FCRA skip-trace gate)",
      ref: "server/services/form1099Batch.ts (TaxIdentityError PAYER_NAME_MISSING / PAYER_EIN_MISSING / RECIPIENT_TIN_MISSING) + server/services/gdprService.ts (eraseLeadSubject → DsarErasureRefusedError naming the note ids) + server/services/fcraAttestation.ts + server/routes-skip-tracing.ts + server/services/fcraDefenseFile.ts",
      content: `
        We protect your loan records' integrity. When a record can't support a request, AcreOS refuses and says why rather than guess:
        A 1099-INT is not generated until the payer and recipient tax details it needs are on file.
        A request to erase a borrower is refused, naming the notes involved, while their loan and tax records must keep that identity.
        Skip tracing runs only after you state a permissible purpose under the FCRA and sign the attestation.
        form1099Batch throws TaxIdentityError when the payer name, payer EIN or recipient TIN is missing, and the batch
        fails rather than issuing the form. eraseLeadSubject refuses before any write when the person is the borrower on
        any note, with a message naming the note numbers and the retention reason. Skip-trace lookups require the FCRA
        attestation and a stated permissible purpose, written to the append-only purpose ledger before the vendor call.
      `,
    },
    {
      name: "/trust INV-7 — consent discipline (founder decisions 2026-10-20)",
      ref: "server/services/tcpaCompliance.ts (tcpaGateForSms, checkTcpaConsentFromLead) + server/services/autonomyGuardrails.ts (checkTcpaBeforeSend(…, channel)) + tests/unit/noColdTextWithoutWrittenConsent.test.ts + server/services/consentEvents.ts (append-only lead_consent_events) + server/services/privacy/dsarExporters.ts (consent_records)",
      content: `
        No cold texting without written consent. A verbal yes is not enough.
        Email consent is separate from texting consent; one never stands in for the other.
        Every grant and revocation goes into an append-only consent record, and it comes with a person's data export.
        A prospecting text needs prior express written consent (web form, written form, texted double opt-in or IVR
        keypress); a verbal yes is not enough (tcpaGateForSms, noColdTextWithoutWrittenConsent.test.ts). TCPA consent
        governs texts and calls only; email reachability depends on opt-outs and the suppression list, never on SMS
        consent. consentEvents.ts appends one lead_consent_events row per granted or revoked channel, and the DSAR
        exporter's consent_records domain includes those rows in a person's data export.
      `,
    },
    {
      name: "/trust INV-8 — hash-chained audit log + retention that respects legal holds",
      ref: "server/utils/auditLogChain.ts (chainAndInsertAuditLog, verifyAuditLogChain; migrations 0080/0143 trigger) + server/storage/auditRepo.ts + server/services/compliance/auditChain.ts + server/jobs/dataRetention.ts (LEGAL HOLDS) + tests/unit/retentionRespectsLegalHolds.test.ts",
      content: `
        Your audit log is append-only and hash-chained: each entry seals the one before it, so an altered or removed entry shows when the chain is checked.
        The data-retention job won't purge an account that is under a legal hold.
        Every audit_log row carries prev_hash and row_hash = SHA-256(prev_hash, canonical row), written by
        chainAndInsertAuditLog from auditRepo; a Postgres trigger blocks UPDATE and DELETE of a chained row, and
        verifyAuditLogChain detects alteration — tamper-evidence, not notarized proof. dataRetention.ts reads the org ids
        with an active, unreleased legal hold and keeps their rows past the window (retentionRespectsLegalHolds.test.ts).
      `,
    },
    {
      name: "/trust INV-9 / D3 — portability and succession (Terms §7 and §19)",
      ref: "client/src/pages/terms.tsx §7 (data export upon cancellation) + §19 (assignment to a successor entity) + client/src/lib/legal-entity.ts + server/routes-import-export.ts (GET /api/export/backup, /api/export/:entityType)",
      content: `
        Your book is exportable in full, any time — and for 30 days after your subscription ends.
        If AcreOS moves into its own company (a Massachusetts LLC is being formed) or changes hands, the Terms pass to the new owner and your subscription continues under them.
        Terms §7: you may export all of your data in a portable format at any time, including for 30 days following the
        end of your subscription; GET /api/export/backup serves a full backup. Terms §19: AcreOS may assign the Terms to a
        successor entity formed to operate the Service — including the Massachusetts LLC being organized — which assumes
        all rights and obligations and your subscription continues uninterrupted, or in a merger, acquisition or sale; the
        Terms bind successors. Terms §19 states NO advance-notice period for an assignment, so no surface may promise one.
      `,
    },
    {
      name: "/trust D1 — which AI providers receive the data Pax works with",
      ref: "server/services/aiRouter.ts (selectProviderAndModel: OpenRouter first, direct OpenAI final fallback; BYOK branch) + server/services/byok/aiByok.ts (AiByokRouting) + server/ai/tools.ts (tool results go to the model provider verbatim)",
      content: `
        When you ask Pax for help, the records it needs to answer — which can include a borrower's or seller's name, address and loan details — are sent to OpenRouter, which passes the request to the model that answers it.
        AcreOS's backup route for those requests is OpenAI. If you connect your own AI key, the request runs on your key with that provider instead.
        selectProviderAndModel routes every platform AI turn to OpenRouter and falls back to direct OpenAI only when
        OpenRouter is not available; tool results (lead and loan records) go to the model provider verbatim. With an
        org's own key (BYOK: OpenRouter, Anthropic or OpenAI), the call executes on that key with that provider. No claim
        is made about any provider's retention or training terms (unverified).
      `,
    },
    {
      name: "/trust D2 — the arbitration clause explained (Terms §14)",
      ref: "client/src/pages/terms.tsx §14.1–14.6 + client/src/lib/legal-entity.ts (governingState Massachusetts)",
      content: `
        Our Terms send disputes to binding individual arbitration with JAMS instead of court, and neither side can bring a class action.
        In plain words: if something goes wrong, you and AcreOS settle it one-on-one before a neutral arbitrator, in Massachusetts or by phone or video.
        AcreOS pays the JAMS fees on claims under $10,000, and you can opt out of arbitration by emailing legal@acreos.io within 30 days of first agreeing to the Terms.
        Terms §14.1 final, binding arbitration administered by JAMS rather than in court; §14.2 class action waiver;
        §14.4 conducted in Massachusetts or, at your election, by telephone or videoconference, relief on an individual
        basis; §14.5 AcreOS will pay JAMS arbitration fees for claims under $10,000; §14.6 opt out by written notice to
        legal@acreos.io within 30 days of first agreeing. The clause itself is unchanged; this explains it.
      `,
    },
    {
      name: "/trust INV-10 — who operates AcreOS and the beta posture",
      ref: "client/src/lib/legal-entity.ts (ENTITY_STATUS sole-proprietor, Thomas Norton, Massachusetts) + client/src/pages/landing/Hero.tsx / ProductShots.tsx (\"Example · representative output\" labels)",
      content: `
        AcreOS is new and in active development, run by one person: Thomas Norton, a sole proprietor in Massachusetts.
        It's in beta, and what early users tell us shapes what gets built next. Wherever AcreOS shows example data, it's labelled as example data.
        legal-entity.ts: a sole proprietorship of Thomas Norton based in Massachusetts; an LLC is being formed. Illustrative
        landing fixtures carry a visible "Example · representative output" label.
      `,
    },
    {
      name: "Giving commitment (founder decision 2026-10-09) and its pledge computation",
      ref: "shared/trust/giving.ts (CENTS_PER_MEMBER_PER_MONTH = 100, computeGivingPledge) + server/services/trust/givingService.ts",
      content: `
        Founder decision 2026-10-09: for every paying member, AcreOS commits
        $1 a month of its own money, from its own revenue, to a food bank
        serving that member's area. The monthly job counts paying members by
        the county each member gave and pledges 100 cents per member per
        month to the food bank the founder mapped to that county; the founder
        approves each month within a cap and pays outside AcreOS, and only
        receipted payments are shown to members as given.
      `,
    },
    {
      name: "Data retention on cancellation (binding privacy policy + the DSAR clock + the deletion routines)",
      ref: "client/src/pages/privacy.tsx §6–§7 + shared/privacy/dsarClock.ts + server/services/gdprService.ts (eraseDsarSubject) + server/services/orgDeletion.ts + server/routes-admin.ts (POST /api/admin/organizations/:id/delete)",
      content: `
        The published privacy policy is the binding statement. Its
        deletion-request paragraph (§6) commits: upon a verified deletion
        request, AcreOS will delete or anonymize your personal data
        within 7 days of verification, except where retention is required
        by law (financial records, e-signature audit logs). Section 7 sets
        the response frame: respond within 30 days for routine requests,
        or the statutory deadline (45 days for CCPA, 30 days for GDPR),
        with identity verification before processing. The FAQ's published
        promise — deletion of account and lead data completed within
        30 days of a verified request — is therefore the outer bound; the
        policy's own request path commits to 7 days.

        Underneath the promise, every DSAR intake is stamped from the ONE
        shared clock (shared/privacy/dsarClock.ts, DSAR_CLOCK_HOURS = 24):
        the operational deadline is 24 hours from the message's arrival.
        The 24h clock changes no published promise — it is the stricter
        internal target the 30-day promise is kept by.

        Execution is real and gated. gdprService.eraseDsarSubject runs
        only for a subject the verification gate produced: a user's own
        data is anonymized, and an organization's erasure runs
        deleteOrganization, which sweeps every tenant table (account and
        lead data included), deletes stored document bytes, and reports
        residual tables instead of claiming completeness. The retentions
        match the FAQ's carve-outs: an org under an active legal hold is
        refused before a single row is touched (LegalHoldViolationError),
        and the only records kept are the ones the law requires us to
        keep — audit_events and purpose_ledger are retained under GDPR
        Art. 17(3)(b), and the
        financial ledger is detached (org id nulled) rather than deleted,
        so tax and loan records are kept on the retention schedule the
        policy states (note and financial records: subscription plus
        seven years). Backup snapshots are purged within 30 days of
        primary deletion. Export is real and unconditional:
        GET /api/export/:entityType serves leads, properties, deals and
        notes as CSV and /api/export/backup serves a full backup, so
        nothing is held hostage. AcreOS therefore does NOT retain
        "nothing" after cancellation, and no public surface may say
        that it does.
      `,
    },
    {
      name: "AcreOS import mechanics and the passes that run on a schedule",
      ref: "server/services/importExport.ts (LEAD_/PROPERTY_/DEAL_/NOTE_COLUMN_MAP, findDuplicateLeads, importNotesFromCSV, importAcquiredNotesFromCSV) + server/routes-import-export.ts (columnHints, userFieldMap) + server/jobs/leadCampaignJobs.ts + server/jobs/runScheduledJobs.ts (sequenceProcessorService.start)",
      content: `
        Import is generic and vendor-neutral. There is no column preset for
        any third-party product: normalizeRow applies a built-in map of common
        header spellings, the import route offers that map to the customer as
        columnHints, and a user-supplied fieldMap overrides it for whatever
        was not recognized. So AcreOS recognizes the common column headers and
        lets you map the rest as you import, from a CSV of any origin. On lead
        import, findDuplicateLeads matches name, email, phone and address
        against the leads that organization already holds and the row is
        skipped — AcreOS skips contacts already in your pipeline. It does not
        consult mail history, so no claim may say it dedupes against owners
        already mailed.

        Notes have two separate importers, not one: importNotesFromCSV for
        notes the operator originated (with a Reg-Z 1026.43 gate) and
        importAcquiredNotesFromCSV for notes bought from a prior holder, which
        requires an acquisition price. Originated and purchased notes each
        have their own import. From there AcreOS carries the loan in the
        product: balances are held on the note record (remaining balance,
        principal and interest), payments are posted through the borrower
        portal, ACH autopay, Stripe webhooks and the note routes, and there is
        a borrower record per loan.

        Two passes genuinely run on a schedule for a customer without any
        further action. Lead nurturing does the scoring and the staging on its
        own cycle behind the organization's leadScoring switch, at either Pax
        stance and skipped entirely while paused — scoring and staging happen
        without the operator doing anything; and sequenceProcessorService
        sends the drips the customer switched on. Both are rules the customer
        turned on running by themselves; every message Pax writes still waits
        for a human tap.

        Nothing else is scheduled for a customer. There is no buy-box scan
        engine and no scheduled county-list pull: countyAssessorIngestJob is
        exported and has no caller, so no public surface may claim a list
        pulls overnight.
      `,
    },
    {
      name: "AcreOS enforced landing mechanics",
      ref: "server/routes-leads.ts (emitLeadCreated) + server/services/importExport.ts + shared/workflow-live-triggers.ts",
      content: `
        One platform that finds the deals, sends the mail, drafts the
        replies, closes the deal, and services the note after. Buy-box
        criteria live as customer workflow conditions: every new lead is
        checked against them the moment it's stored — emitLeadCreated fires
        on single create and CSV import, and a match fires the automations
        the customer chose. Lead scoring computes at read time and on the
        nurturing cycle. Reply drafting is operator-initiated: generate a
        written offer in one tap, one tap and Pax drafts the reply for your
        review (POST /api/ai/draft-reply; generateOfferLetter). No
        processing-latency numbers are claimed because none are measured.
      `,
    },
    {
      name: "CSV list import",
      ref: "server/routes-leads.ts POST /api/leads/csv-import",
      content: `
        Bring your county list as a CSV — AcreOS reads the columns and skips owners you already have: column
        headers are auto-mapped, rows dedupe on state, county and APN, and
        rows with no usable owner name are refused per row. The earlier
        "first county list inside 10 minutes" target was withdrawn
        2026-09-29 (readiness plan item 0.7): no job pulls a county list.
      `,
    },
    {
      name: "Land Credit Score scale",
      ref: "server/services/landCredit.ts",
      content: `
        Every parcel gets a Land Credit Score — a 300–850 read on the parcel
        itself. The 0–100 weighted overall maps onto the 300–850 credit
        scale (landCredit.ts toCreditScale: 300 + overall/100 * 550), with
        letter grades from a single source of truth shared by the in-app
        score and the public parcel check.
      `,
    },
    {
      name: "Trial length (billing enforcement)",
      ref: "server/routes-billing.ts + server/services/trialService.ts",
      content: `
        Start free — 14 days, no card. The checkout grants trial_period_days
        of exactly 14 (routes-billing.ts trialDays; trialService.ts
        TRIAL_DURATION_DAYS = 14) for every org that has not used its trial.
      `,
    },
    {
      name: "AcreOS federal data spine (data-source-broker)",
      ref: "server/services/data-source-broker.ts",
      content: `
        The land toolkit — every parcel checked against five federal
        data sources, free: FEMA National Flood Hazard Layer
        (queryFemaFlood), USDA SSURGO soils (querySoilData), USGS 3DEP
        elevation (queryElevation), USFWS National Wetlands Inventory
        (queryNwiWetlands), U.S. Census ACS demographics
        (queryDemographics). All five wired live in
        server/services/data-source-broker.ts.
      `,
    },
    {
      name: "AcreOS pricing tiers (registry-derived)",
      ref: "shared/billing/tier-pricing.ts + client/src/pages/landing/Pricing.tsx",
      // DERIVED from TIER_PRICES_CENTS — see the note at the top of the file.
      content: `
        Tiers render from shared/billing/tier-pricing.ts at runtime:
        Pro is ${dollars(proPrice.priceMonthlyCents)}/mo monthly or
        ${dollars(proPrice.priceYearlyCents)}/yr billed annually.
        ${dollars(proPrice.priceYearlyCents)} vs
        ${dollars(12 * proPrice.priceMonthlyCents)} (12 months monthly) =
        save ~${annualSavePct}%, displayed as Annual Save ${annualSavePct}%.
        Pro tier unlocks: full Pax assistant, unlimited counties, BYOK for
        parcel and skip-trace data costs. Monthly/annual toggle on the page.
      `,
    },
    {
      name: "AcreOS business types registry (registry-derived)",
      ref: "shared/business-types.ts + shared/business-types/publicClaims.ts",
      // DERIVED from publicMaturityOf over BUSINESS_TYPES — see the note at the top.
      content: `
        Tiering registry — since ruling #11 wave V1 the landing chips DERIVE
        from this registry at build time through publicMaturityOf, so every
        investor type the platform serves is labeled by what's true today
        (FD1 launch scope, 2026-11-12): full workflows / core
        (${publicTierLabels("core")}), beta (${publicTierLabels("beta")}),
        and the not-sold tier — registry-only, kept for existing books,
        promised, not sold (${publicTierLabels("roadmap")}). Land flipper is
        the founding wedge — the deepest workflows live there (deepest in
        land is a self-referential depth fact backed by this registry's core
        maturity, not a claim about competitors).
      `,
    },
    {
      name: "Witnessed send + the one Pause (Pax controls kernel)",
      ref: "server/services/approvalKernel.ts (APPROVAL_REQUIRED_TOOLS) + server/ai/tools.ts (executeTool) + shared/pax-controls.ts (OFFERED_STANCES) + server/routes-pax-controls.ts (POST /api/pax/pause) + server/jobs/runScheduledJobs.ts (sequenceProcessorService.start) + tests/unit/paxWitnessedSend.test.ts + tests/unit/paxPauseCoverage.test.ts",
      content: `
        Pax's own drafts never send until you tap Approve: every send
        tool (send_email, send_sms, send_gmail, send_slack_message,
        create_stripe_payment_link, and the connector sends) is in
        APPROVAL_REQUIRED_TOOLS and executeTool freezes it as a
        pending ask until a signed-in human approves it, at every offered
        stance — paxWitnessedSend.test.ts drives the real kernel and the
        set may only grow. Anything you automate travels a different,
        customer-switched path: the drips and campaigns you turned on
        send only on the schedule you switched on
        (sequenceProcessorService, started in runScheduledJobs.ts) — no
        automation sends that the customer did not switch on. Pause
        everything with one tap: POST
        /api/pax/pause writes the org-wide pause that every member of
        UNATTENDED_PATHS reads before it acts (paxPauseCoverage.test.ts),
        or set Pax to ask before it changes anything: the
        ask_before_everything stance freezes every record change as an
        ask (OFFERED_STANCES, PATCH /api/pax/controls).
      `,
    },
    {
      name: "AcreOS BYOK vault + connectors hub",
      ref: "shared/schema/finance.ts (BYOK_CHANNELS) + client/src/pages/settings/byok.tsx",
      content: `
        Bring-your-own-key vault. Connect your own accounts for any
        channel, or run on ours: Twilio, Telnyx (texts and calls),
        SendGrid, SES (email), Lob, PostGrid (print and mail),
        OpenRouter, Anthropic, OpenAI (AI), BatchData, ATTOM, Regrid
        (property-data), Mapbox, S3. When a key is connected, that
        channel's spend bills to the customer directly (your keys, your
        invoices) instead of drawing AcreOS credits; AcreOS runs the
        intelligence over the top. Grouped connectors hub surface.
      `,
    },
  ];
}

async function main() {
  console.log("[truth-engine] auditing public claims…");
  console.log("");
  const surface = landingSurface();
  const allText = surface.map((s) => s.text).join("\n");
  let failures = 0;

  // ── Pass 1: liveness ──────────────────────────────────────────────────
  for (const { anchor, claim } of CLAIMS) {
    if (!allText.includes(anchor)) {
      failures += 1;
      console.error(`[STALE] claim anchor no longer on the landing: "${anchor}"`);
      console.error(`        (claim: ${claim.slice(0, 80)}…) — update or retire the entry.`);
    }
  }
  if (surface.filter((s) => LANDING_FILES.includes(s.file) && s.text.length > 200).length < 9) {
    failures += 1;
    console.error("[VACUOUS] fewer than 9 landing files read — the scan went blind.");
  }
  for (const f of PUBLIC_LAND_FILES) {
    const member = surface.find((s) => s.file === f);
    if (!member || member.text.length <= 200) {
      failures += 1;
      console.error(`[VACUOUS] public land surface ${f} was not read — it left the scan's population.`);
    }
  }
  for (const f of W5A_TRUST_FILES) {
    const member = surface.find((s) => s.file === f);
    if (!member || member.text.length <= 200) {
      failures += 1;
      console.error(`[VACUOUS] W5a trust surface ${f} was not read — it left the scan's population.`);
    }
  }
  for (const f of TRUST_PAGE_FILES) {
    const member = surface.find((s) => s.file === f);
    if (!member || member.text.length <= 200) {
      failures += 1;
      console.error(`[VACUOUS] /trust page ${f} was not read — it left the scan's population.`);
    }
  }
  // Every /trust anchor must be found IN the /trust page itself, not merely
  // somewhere on the landing — a trust claim deleted from the page must not
  // stay "live" because a landing file happens to share its words.
  const trustText = surface.filter((s) => TRUST_PAGE_FILES.includes(s.file)).map((s) => s.text).join("\n");
  for (const { anchor, claim } of CLAIMS.filter((c) => c.surface === "trust")) {
    if (!trustText.includes(anchor)) {
      failures += 1;
      console.error(`[STALE] /trust claim anchor is not on the /trust page: "${anchor}"`);
      console.error(`        (claim: ${claim.slice(0, 80)}…) — update or retire the entry.`);
    }
  }

  // ── Pass 2: completeness ──────────────────────────────────────────────
  const anchorText = CLAIMS.map((c) => c.anchor).join("\n");
  for (const { file, text } of surface) {
    for (const m of text.match(NUMBER_CLAIM) ?? []) {
      const covered = anchorText.includes(m) || EXEMPT[m];
      if (!covered) {
        failures += 1;
        console.error(`[UNCOVERED] ${file}: number-bearing claim "${m}" has no audit entry.`);
        console.error(`            Add a claim+anchor with a real backing source, or an EXEMPT entry with a dated reason.`);
      }
    }
  }
  for (const token of Object.keys(EXEMPT)) {
    if (!allText.includes(token)) {
      failures += 1;
      console.error(`[STALE-EXEMPT] "${token}" no longer appears on the landing — remove its exemption.`);
    }
  }

  // ── Pass 3: verification against backing sources ──────────────────────
  const sources = buildSources();
  const { results, verifiedCount, unverifiedCount } = await verifyClaims(
    CLAIMS.map((c) => c.claim),
    sources,
  );
  for (const r of results) {
    const mark = r.verified ? "OK" : "FAIL";
    console.log(`[${mark}] ${r.claim}`);
    if (r.verified && r.evidence.length > 0) {
      console.log(`       evidence: ${r.evidence[0]}`);
    } else if (!r.verified) {
      console.log(`       unmatched tokens: ${r.unmatchedTokens.join(", ")}`);
    }
    console.log("");
  }

  console.log(
    `[truth-engine] summary: ${verifiedCount} verified, ${unverifiedCount} unverified, ` +
      `${results.length} claims, ${failures} structural failure(s), ${sources.length} sources`,
  );
  if (unverifiedCount > 0 || failures > 0) {
    console.error("");
    console.error("[truth-engine] audit failed — fix the claims, the copy, or the coverage.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[truth-engine] FATAL:", err);
  process.exit(1);
});
