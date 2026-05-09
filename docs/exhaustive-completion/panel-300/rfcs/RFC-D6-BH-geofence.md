# RFC-D6: BH Tenant Screening Geofence — TX/OK Only vs Nationwide Compliance-by-State

**Status:** Draft (open for comment until first BH non-TX/OK signup)
**Author:** Engineering leadership panel (panel-300 H7 recommendation)
**Decision-owner:** Founder
**Forcing date:** First BH non-TX/OK signup (could be tomorrow)
**Decision-after:** Substantive attestation form (G4) live; state-specific disclosure registry seeded for CA, NY, FL

## Background

BH (Buy-and-Hold tenant screening) ships permissible-purpose attestation (RS-1), adverse-action notices (RS-2), and audit trails (RS-3). But each state has its own FCRA disclosure templates (CA Civ §1786, NY Gen Bus §527, TX §5.069, FL §784.105). Wynne's recommendation: geofence TX/OK at launch to defer the $5M+ class-action exposure window. Sam's implicit position: the shipped compliance stack is "good enough" to launch nationwide; remaining gaps are paperwork, not core logic.

The forcing moment: the first non-TX/OK customer signup will force this decision. Wynne recommends shipping the geofence *before* that customer to avoid awkward retroactive geofence-and-refund. This is a 1-day code change (`enabled_states` enum on `tenant_screenings` table) done today, not tomorrow.

## Options

### Option A — TX/OK Geofence (Wynne's choice)
Add `enabled_states = ['TX', 'OK']` enum to `tenant_screenings`. Route gates block BH actions on non-enabled states. Stripe checkout shows "BH pack: Coming Q4 2026" wait-list for CA/NY/MA/IL/NJ/FL. Banner on `/bh-customers/how-to-screen`: "State-specific disclosures under attorney review; CA/NY support expected Q4." 30 days: geofence live. 60 days: reflected in Stripe checkout. 90 days: 2-3 TX/OK customers prove the wedge; CA/NY pipeline waits. Defers: class-action exposure window stays closed until counsel sign-off.
**Cited by:** wynne-ohaegbu (FCRA class-action exposure math), security-compliance (adversarial-stress panel consensus), domain-real-estate (state-specific forms = real compliance, not theater)
**Trade-off:** Limits BH TAM to ~$2B (TX/OK population) vs $10B+ (nationwide). Misses early CA land-investor customers who might be 6-figure ACV. Series-A narrative requires explanation: "we intentionally geofenced to mitigate regulatory risk."

### Option B — All States; Substantive Forms Retrofit (Sam's implicit position)
30 days: hardening on what's already shipped (better operator-facing copy, in-app legal disclaimers per state, "consult your attorney" prompts). 60 days: external legal review of existing BH flow (cost: $10-20K). 90 days: 5-7 BH customers across states, but at non-trivial liability exposure. Risk: one CA tenant who feels their adverse-action was wrong files a §1786 claim → class-cert proceeding → $5M defense cost.
**Cited by:** sam-reyes (implicit: permissible-purpose + adverse-action = sufficient), customers-verticals (BH cohort wants to launch nationwide), sales-gtm (don't limit TAM early)
**Trade-off:** Operator liability if state-specific disclosures are inadequate. Regulator-pattern discovery in a class action (CA AG's office or NY AG's office pinging AcreOS for practice discovery) disrupts fundraising. Series-A diligence: investor counsel will flag this as a latent liability bucket.

## Five questions reviewers must engage

1. **Attorney-review timeline for CA/NY/FL (Padraig's lens):** What's the realistic timeline to get CA §1786, NY §307, and FL §784.105 disclosure templates attorney-reviewed by external counsel? (Estimate: $15K + 4 weeks. If accurate, Q4 2026 is realistic.) If Q4 timeline slips to Q1 2027, do we stay geofenced through Series-A (sub-optimal narrative) or do we launch nationwide and accept the legal risk?

2. **Class-action exposure math for a single CA case:** Wynne cites "$5M+ class-action exposure." Break that down: attorney fees ($2-3M), settlement reserve ($1-2M), operational disruption (CEO time lost, discovery burden). If a single customer files a CA §1786 complaint and the case survives motion to dismiss, what's the expected defense cost *before* settlement? Is $100K-$500K defense spend a deal-killer?

3. **Customer signal interpretation:** If we launch nationwide (Option B) and get 0 CA customers in 30 days, was the geofence necessary? Or if we geofence and get 3 TX customers asking "when is CA coming?", does that signal market demand and justify the de-geofence effort?

4. **Geofence reversibility:** If we geofence TX/OK, and the attorney review is done by 2026-09-01, can we safely de-geofence and launch CA/NY as "new states" without customer confusion? Or does the geofence signal lock AcreOS into a "Texas-focused" category (bad for Series-A narrative)?

5. **Operator compliance responsibility:** If we launch nationwide without attorney-reviewed disclosures, and a customer-operator screens a tenant in CA without understanding CA-specific adverse-action requirements, is the operator liable (they're the "user" making the screening decision) or is AcreOS liable (we provided the tool)? FCRA assigns liability to the "user of the report," but AcreOS provided the screening form. Who bears the risk?

## What needs to be true to decide

- **Substantive 3-screen attestation form live (G4, 2026-06-08):** The form must be in production, not a jsonb checkbox. Wynne's "theater that works in depositions" standard: the form should capture permissible purpose, data-retention policy, and adverse-action-notice specific case (timestamp, screening reason, applicant dispute right).
- **State-specific disclosure registry seeded (2026-06-08):** CA, NY, FL disclosure templates (templates, not final attorney-reviewed versions) should exist in the codebase as `statutory_forms/ca_civil_1786.md`, `statutory_forms/ny_bus_527.md`, etc. Incomplete is fine; drafted is the gate.
- **Padraig's legal-review queue live (2026-06-08):** GC Padraig Macdonald (VP Legal) should have a tracked queue of "pending attorney reviews" with estimated external-counsel cost + priority. Geofence decision flows from that queue's priority (is CA/NY review in the top-3, or is it deferred?).
- **First BH non-TX/OK signup (unknown date, probably 2026-05-15 to 2026-06-30):** This is the true forcing function. Wynne says: ship the geofence *before* this happens. If we're 3 weeks away from the first CA signup and the geofence isn't live, the decision is retroactive.

## Recommendation

**Wynne's TX/OK geofence.** The class-action math is brutal. A single CA tenant filing a §1786 claim opens a class-cert proceeding where the discovery burden alone (document productions, depositions, expert opinions on AcreOS's "permissible-purpose" practices) could exceed $500K. The geofence is a 1-day code change that defers an existential risk window for ~$200/year/customer of CA market we're not yet equipped to serve.

The narrative cost is real ("we're only in TX/OK until Q4"), but the risk cost is existential. Pick the geofence now, hire external counsel to attorney-review CA/NY/FL templates by 2026-09-01, and launch those states in Q4 with ironclad disclosure forms. This sequence lets AcreOS raise Series-A in Q3-Q4 2026 without the geofence being a due-diligence red flag ("you're limiting TAM because you're not compliant").

If we launch nationwide without the geofence and a single CA customer's adverse-action complaint becomes a class case, the Series-A process halts immediately for 6+ months while we litigate or settle.

## Comment thread

(Reviewers add comments below this line. Founder owns the resolve.)

---
