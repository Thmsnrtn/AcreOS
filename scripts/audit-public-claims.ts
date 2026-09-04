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

/** Strip comments so truth-notes and design notes don't read as claims. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function landingSurface(): { file: string; text: string }[] {
  return LANDING_FILES.map((f) => {
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
const CLAIMS: { claim: string; anchor: string }[] = [
  {
    // hero wedge — pinned verbatim by landingReposition.test.ts.
    claim:
      "One platform that finds the deals, sends the mail, drafts the replies, closes the deal, and services the note after.",
    anchor:
      "One platform that finds the deals, sends the mail, drafts the replies, closes the deal, and services the note after.",
  },
  {
    // hero.ctaSub / Features "Pulled lists" card — founder-retained
    // setup-time target (truth-note 2026-05-31), NOT a processing SLA.
    claim: "Pax pulls your first county list inside 10 minutes.",
    anchor: "first county list inside 10 minutes",
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
    // Prices render from the tier registry at runtime (displayMonthlyPrice),
    // so no "$41" literal exists on the surface; the anchor is the billing
    // line and the SOURCE verifies the registry arithmetic.
    claim: "Pro at $41/mo (billed annually) unlocks the full Pax assistant, unlimited counties, and bring-your-own-key",
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
    claim: "Pax never sends a message to anyone until you tap Approve.",
    anchor: "Pax never sends a message to anyone until you tap Approve.",
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
    claim:
      "After you cancel, your account and lead data are deleted within 90 days; financial records are kept for seven years because lending regulation requires it.",
    anchor: "deleted within 90 days",
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
};

/** Number-bearing marketing-claim shapes. */
const NUMBER_CLAIM = /\b\d+(?:\.\d+)?\s?(?:seconds?|minutes?|hours?|days?|federal data sources)\b|\$\d+|\b\d+%|\b\d{3}–\d{3}\b/g;

function buildSources(): Source[] {
  return [
    {
      name: "Data retention on cancellation (binding privacy policy + the deletion routine)",
      ref: "client/src/pages/privacy.tsx retention table + server/services/orgDeletion.ts + server/routes-admin.ts (POST /api/admin/organizations/:id/delete)",
      content: `
        The published privacy policy's retention table is the binding
        statement of what happens after you cancel. Account and organization
        data, and lead and contact data, are retained for the duration of the
        active subscription plus 90 days, so that data is deleted within 90
        days of cancellation. Note and financial records are kept for the
        duration of the subscription plus seven years, because lending
        regulation requires that financial records be kept for seven years.
        The deletion routine agrees rather than exceeding the promise:
        deleteOrganization reports residual tables instead of claiming
        completeness, retains audit_events under GDPR Art. 17(3)(b), and
        detaches the financial ledger (org id nulled) rather than deleting it.
        Export is real and unconditional: GET /api/export/:entity serves
        leads, properties, deals and notes as CSV and /api/export/backup
        serves a full backup, so nothing is held hostage. AcreOS therefore
        does NOT retain "nothing" after cancellation, and no public surface
        may say that it does.
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
      name: "Founder-retained landing targets (truth-note record)",
      ref: "client/src/pages/landing/copy.ts truth-engine notes (2026-05-31, corrected 2026-09-01)",
      content: `
        Pax pulls your first county list inside 10 minutes — retained
        2026-05-31 as a SETUP-TIME target (time from signup to first county
        list pulled), explicitly not a processing SLA. The 90-second and
        Monday-6am processing claims were removed 2026-09-01 because no
        mechanism enforced them; the 10 minutes figure is the one retained
        number, recorded in the copy.ts truth-note with its basis.
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
      content: `
        Tiers render from shared/billing/tier-pricing.ts at runtime:
        Pro is $49/mo monthly or $490/yr — $40.83/mo, displayed as
        $41/mo billed annually. $490 vs $588 (12 x $49) = save ~17%,
        displayed as Annual Save 17%. Pro tier unlocks: full Pax
        assistant, unlimited counties, BYOK for parcel and skip-trace
        data costs. Monthly/annual toggle on the page.
      `,
    },
    {
      name: "AcreOS business types registry",
      ref: "shared/business-types.ts",
      content: `
        Tiering registry — since ruling #11 wave V1 the landing chips DERIVE
        from this registry's maturity at build time, so every investor type
        the platform serves is labeled by what's true today: core (land
        flipper, note investor — full workflow templates), beta (residential
        wholesaler, buy-and-hold rentals, subdivider, tax lien / deed), and
        roadmap (fix-and-flip, short-term rentals, commercial, creative
        finance, developer, multifamily, mobile home, agent-investor —
        promised, not sold). Land flipper is the founding wedge — the
        deepest workflows live there (deepest in land is a
        self-referential depth fact backed by this registry's core
        maturity, not a claim about competitors).
      `,
    },
    {
      name: "Witnessed send + the one Pause (Pax controls kernel)",
      ref: "server/services/approvalKernel.ts (APPROVAL_REQUIRED_TOOLS) + server/ai/tools.ts (executeTool) + shared/pax-controls.ts (OFFERED_STANCES) + server/routes-pax-controls.ts (POST /api/pax/pause) + tests/unit/paxWitnessedSend.test.ts + tests/unit/paxPauseCoverage.test.ts",
      content: `
        Pax never sends a message to anyone until you tap Approve: every
        send tool (send_sms, send_email, send_direct_mail, payment link)
        is in APPROVAL_REQUIRED_TOOLS and executeTool freezes it as a
        pending ask until a signed-in human approves it, at every offered
        stance — paxWitnessedSend.test.ts drives the real kernel and the
        set may only grow. Pause everything with one tap: POST
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
  if (surface.filter((s) => s.text.length > 200).length < 9) {
    failures += 1;
    console.error("[VACUOUS] fewer than 9 landing files read — the scan went blind.");
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
