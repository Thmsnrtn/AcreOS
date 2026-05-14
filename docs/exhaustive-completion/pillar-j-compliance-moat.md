# Pillar J — Compliance moat

Productize what AcreOS already has under the hood and turn it into a
"regulated by design" claim PropStream/DealMachine cannot match. The
moat is real because each piece is genuinely load-bearing for a
regulated operator (note investor with RMLO exposure, multi-state
landlord, tax-delinquent operator across foreclosure regimes).

---

## What already exists

| Surface | Where it lives | What it does |
|---|---|---|
| Statutory Forms registry | `shared/schema.ts` `statutory_forms` + seed | Per-state forms each vertical needs |
| DSAR lifecycle | `dsar_requests_lifecycle` + workflow cron | Tracks data-subject-access requests SLA |
| Disclosure-timing dispatcher | `routes-founder-intelligence.ts` + cron | Enforces TILA timing on land contracts |
| Fair-lending audit | `services/fairLendingAudit.ts` (monthly cron) | Computes disparate-impact across borrower demographics |
| Audit events | `audit_events` table | Every decision attributable to operator vs agent |
| Legal hold | `routes-founder-legal-holds.ts` | Pauses retention on legal-hold-flagged data |
| RMLO advisor | `shared/regulatory/rmloAdvisor.ts` (Pillar K) | Compliance posture per note |
| State usury rules | `shared/regulatory/rmloAdvisor.ts` | 51-jurisdiction rate cap reference |
| Tax-lien state rules | `shared/regulatory/taxLienStateRules.ts` (Pillar L) | 51-jurisdiction redemption/foreclosure reference |

Most of this runs server-side and the customer never sees it.

---

## What's missing (the moat)

### 1. `/compliance` customer-visible surface — single page

A single customer-facing route that surfaces:
- Audit-trail event count for the org with a "download evidence pack"
  button.
- Open DSAR count + days-to-SLA-breach.
- Disclosure-timing windows active right now (X letters in 7-day wait).
- Fair-lending score for the org's most recent audit.
- Per-state regulatory posture summary (driven by rmloAdvisor +
  taxLienStateRules).
- Legal-hold status (if any).

Sells itself the first time a customer's attorney asks for evidence
of compliance.

### 2. Evidence Pack PDF generator — one-click forensic export

For any deal (lead → property → contract → close), generate a PDF
that includes:
- Every event in the audit log with timestamp + actor.
- Every disclosure delivered with timestamp + recipient + return-receipt.
- Every signature with timestamp + IP + signer name.
- Every workflow action with rationale.
- Every Pax decision attributed with the data it used.

This is the artifact a customer hands their attorney when a lawyer
letter arrives. PropStream cannot generate it.

### 3. TILA Timeline customer widget

The disclosure-timing dispatcher exists on the server. Make it a
customer-visible widget per deal showing:
- "Loan estimate delivered Mar 1. Mandatory 7-day window closes Mar 8.
  Contract may execute Mar 9."
- Auto-flag at-risk timelines before they violate.

### 4. Fair-lending customer scorecard

Surface the monthly fair-lending audit's output to the customer's
`/compliance` page. Their own auditor reads it. Real differentiator.

### 5. Reg-Z auto-letter library

SCRA notices, payoff statements, year-end 1098-MAs, escrow analysis
statements — all auto-generated with the right legal language. Hooks
into the workflow templates from Pillar K (note investors).

### 6. State-specific regulatory engine consolidation

Today we have `rmloAdvisor.ts` and `taxLienStateRules.ts`. As more
verticals add state rules, consolidate into a `shared/regulatory/`
folder structure with consistent shape. The 4 state-rule modules
become the foundation of a "what the operator needs to know in each
state for each vertical" reference engine.

---

## What ships in this PR

The single highest-leverage deliverable is the Evidence Pack
generator scaffold — even as a server-only endpoint that returns a
JSON dump (PDF rendering is queued), the data plumbing is the hard
part.

### A. `/api/founder/compliance/evidence-pack/:dealId` endpoint

Pulls every audit event, every disclosure event, every signature,
every workflow action, every Pax decision tied to the deal. Returns
a structured JSON blob ready for PDF rendering.

### B. `/compliance` customer route

A surface that:
- Counts the org's audit events (last 30d).
- Counts open DSARs.
- Counts active disclosure-timing windows.
- Shows the latest fair-lending audit score.
- Per-state regulatory posture digest.
- "Download Evidence Pack for any deal" link.

### C. Plan doc itself

This file. Other 4 follow-up items (TILA widget, fair-lending
scorecard, Reg-Z letter library, consolidated regulatory engine)
documented as queued.

---

## Action queue (for follow-up PRs)

1. Evidence Pack PDF rendering (the JSON-from-this-PR pumped through
   the e-sign PDF stack).
2. TILA Timeline customer-visible widget.
3. Fair-lending scorecard customer surface.
4. Reg-Z auto-letter library (SCRA, payoff, 1098-MA, escrow).
5. `shared/regulatory/` consolidation.
6. "Compliance posture" tile on the customer dashboard.
