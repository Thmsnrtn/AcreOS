# Beatrice — Regulatory-Watch Discipline

**Owner**: Beatrice (CRO)
**Activated**: 2026-06-02
**Cadence**: Daily ingest cron (02:00 UTC); manual 72h triage SLA

## Purpose

The `beatrice_reg_events` table is the AcreOS regulatory wire. Every
matched item from CFPB, FTC, and the state-AG feeds that touches one of
our active compliance surfaces (Reg Z / RESPA / TCPA / CCPA / GLBA /
fair-housing / ECOA) lands there. The wire is detection-only — turning
a matched event into a product change, a policy update, or a customer
disclosure is Beatrice's job. *This document is the operating discipline
for that conversion.*

## The 72-hour review SLA

Every event with `beatrice_reviewed = false` and `published_at` older
than 72 hours is an SLA breach. Beatrice's weekly retro reports a count
of breaches; > 0 triggers a discipline retro the following session.

For each unreviewed event, Beatrice:

1. **Reads the underlying source.** RSS summary is not enough — open
   `source_url` and read the full press release, enforcement action,
   or rule.
2. **Decides one of four outcomes**, recorded in `review_notes`:
   - **Not applicable** — keyword match was a false positive (e.g.,
     "note" in a non-mortgage context). Mark reviewed; no further
     action.
   - **Tracking, no action** — applicable but doesn't change AcreOS's
     posture (e.g., enforcement against a competitor for behaviour we
     already don't engage in). Note the rationale; flag for the
     monthly state-matrix update if the geography matters.
   - **Product change required** — the event implies an AcreOS code or
     policy change. Open a corresponding task in the founder inbox
     with the §-citation and the proposed remediation. Solene routes
     to Iris (engineering) or Soren (copy) per scope.
   - **Urgent — escalate via Solene's page channel.** Reserve for:
     direct enforcement against AcreOS, a new federal rule with a
     <90-day compliance deadline, a state-AG action against the
     specific business model AcreOS operates (land contracts /
     note investing / tax-deed flipping). Trigger
     `POST /api/internal/solene/page` with `severity = 'urgent'`.

## Source quality + provenance

The `source` column distinguishes ingest origin so Beatrice can apply
domain-specific review heuristics:

- **`cfpb`** — Bureau press releases. Highest signal density; assume
  the keyword match is genuine unless wording is clearly oblique.
- **`ftc`** — Press releases. CAN-SPAM, TCPA, and unfair-practices
  actions are direct hits; broader consumer-protection releases require
  Beatrice to read for AcreOS-relevance before flipping reviewed.
- **`state_ag_tx`** and **`state_ag_ca`** — TX and CA AGs publish stable
  RSS. Additional state AGs are added quarterly per the matrix in
  `docs/legal/state-matrix-2026-06.md`. Many states publish HTML-only
  press releases — Beatrice opens an issue when she identifies a state
  AG that meaningfully changes posture but has no RSS, so Iris can
  scope a scraper.

## Keyword filter governance

`BEATRICE_RELEVANCE_KEYWORDS` in `shared/schema/beatrice-regwatch.ts` is
the ingest filter. Adding a keyword requires:

1. A surfaced false negative — Beatrice found a relevant event by other
   means (industry newsletter, NACA brief, FRB alert) that the filter
   missed.
2. A test fixture added to `server/services/beatrice/regWatch.test.ts`
   demonstrating the new keyword catches the false-negative item.
3. A note in this document's changelog naming the keyword and the
   triggering event.

**Removing** a keyword is harder than adding one — the discipline floor
is *false negatives cost more than false positives.* A keyword that's
generating noise (too many false positives for Beatrice's 72h budget)
is rewritten to be more specific (e.g., "note" → "promissory note"),
not removed.

## Founder visibility

The endpoint `GET /api/founder/beatrice-regwatch/recent` returns the rolling
30-day window grouped by source with an `unreviewedCount`. Solene reads
this on each session-start; an `unreviewedCount > 5` warrants a
mention in the morning brief.

## Out-of-scope (today)

- **International regulators** (FCA, EU AI Act, ICO). Deferred until
  AcreOS serves a customer in those jurisdictions.
- **Trade publications** (American Banker, Housing Wire). Soren reads
  these for narrative; they don't feed `beatrice_reg_events`.
- **Court dockets** (PACER, state court filings). Deferred — the
  signal/cost ratio doesn't justify scraping at AcreOS's scale.
- **The CFPB enforcement actions database** (separate API). Phase 1
  follow-on; the RSS feed catches the headline announcement.

## Changelog

| Date | Change | Trigger |
|------|--------|---------|
| 2026-06-02 | Initial 23-keyword filter + CFPB / FTC / TX-AG / CA-AG ingest | Foundation tranche 1 |
