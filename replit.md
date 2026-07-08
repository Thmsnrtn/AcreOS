# replit.md — historical artifact (Replit era)

**This file is stale. Do not treat it as documentation.**

AcreOS began on Replit; this file described that era's stack and has not
tracked the platform since. The load-bearing claims it used to make are now
wrong:

- **Authentication is Clerk**, not Replit OAuth. See `server/auth/clerkAuth.ts`
  and `README.md`.
- **AI routes through OpenRouter with Anthropic Claude models** (plus
  DeepSeek tiers), not "OpenAI via Replit AI Integrations."
  `server/services/models.ts` is the single source of truth for model IDs;
  OpenAI `gpt-4o` survives only as the vision tier.
- Positioning is **land investors first** (other REI verticals waitlisted),
  not generic "real estate professionals." See `README.md` and
  `docs/company/mature-machine.md`.
- Development tooling is plain Vite/Node — no Replit plugins.

For current truth: `README.md` (stack, auth, commands),
`CLAUDE.md` (engineering standards, nav doctrine),
`docs/company/mature-machine.md` (strategy layer),
`docs/company/roadmap-2026-07.md` (current waves).

---

## Historical feature catalog (2025, Replit era — kept for reference)

The original file carried a detailed inventory of Pax support-agent tools
and platform features not written down elsewhere. It is preserved below
verbatim as a historical index — tool names are still largely accurate;
model references (GPT-4o) are not.

- **Finance Module**: Amortization, payment recording, borrower portal.
- **Marketing Module**: Campaign management (direct mail, email, SMS) with metrics.
- **Deal Pipeline**: Kanban-style board for acquisition and disposition.
- **Document Generation**: Automated promissory notes, warranty deeds, offer letters.
- **Usage Limits & Credits**: Tier-based feature limits and prepaid credit system.
- **AI Tools (Pax)**: offer generation (`generate_offer`, `generate_offer_letter`),
  communications (`send_email`, `send_sms` — TCPA-gated), financial analysis
  (`run_comps_analysis`, `calculate_roi`, `calculate_payment_schedule`),
  research (`research_property`), task management (`schedule_followup`).
- **Pax support agent**: investigation tools (`query_user_data`, `search_logs`,
  `get_user_activity`, `estimate_resolution_confidence`), decision trees for 10
  issue types, browser context capture, anomaly detection, automated fix
  actions (`clear_user_cache`, `reset_user_session`, `retry_failed_jobs`,
  `refresh_auth_tokens`, `resync_user_data`), multi-session memory
  (`paxMemory`), resolution tracking + A/B testing, knowledge-base search,
  predictive prevention, Stripe billing tools, smart escalation with
  diagnostic bundles, auto-generated tutorials and walkthroughs,
  self-learning from escalations, root-cause tracing, bulk issue
  detection/fix, external service status monitoring, screenshot analysis,
  sentiment detection, behavior prediction, self-healing data integrity.
- **Pax Learning Service** (`paxLearning.ts`): `learnFromHumanResolution`,
  `traceRootCause`, `detectBulkIssue`, `applyBulkFix`, `getKnownFixPatterns`,
  `applySelfHealingFix`, `detectDataIntegrityIssues`, `fixDataIntegrityIssue`,
  `predictUserIssues`.
- **VA Replacement Engine**: marketing lists, batch offers, seller comms,
  buyer prequalification, collection sequences, county research.
- **GIS/Mapping**: layer toggles, measurement, export, nearby-parcel
  discovery, comparables, auto parcel-boundary enrichment (Cache → County
  GIS free → Regrid paid fallback).
- **Data Source Broker**: tiered lookup across 6,797+ sources / 48 categories.
