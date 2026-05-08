# Post-2026-05-01 Re-Sweep (Phase 3 output)

**As of 2026-05-08.**

`_MASTER-FINDINGS.md` is dated 2026-05-01. The 53 vertical PRs (NI / TD / W /
SD / FF / BH) + 18 follow-up PRs (founder-dashboard extractions, FW-1..FW-10)
shipped after that date. Phase 3 audits the post-2026-05-01 surfaces against
the personas whose deal-killers they implement, surfacing residual gaps that
the master-findings synthesis predates.

Three parallel audits ran:
- **FF-3 1099-NEC generator** vs Olympia's 1099-INT critique class
- **BH-1 / BH-2 tenant + screening** vs Cordelia / Caspian / Imelda FCRA
  stance
- **Recovery console + sidebar P1-50** vs Asher-takeover / Coriander / Cleo /
  Martin specs

Top-line: the shipped vertical work covers persona deal-killers ✅, but
several Phase 4 residuals surface — none rise to P0, three rise to "blocks
real customer launch" P1.

---

## §1. FF-3 1099-NEC vs Olympia's critique class

### Verdict: ✅ Ready for Devon's January mailing workflow. 🟡 Phase 4: 1096 + FIRE.

**Devon's stated ask** (`devon-fix-flipper.md` §4): "1099-NEC for every sub I
paid >$600 — Fail. […] No contractor entity, no W-9 storage, no YTD
totals, no form generator." All four delivered in FF-1 / FF-3.

| Olympia critique | Status | Notes |
|---|---|---|
| Form-shape mismatch (1099-INT structure under wrong name) | ✅ N/A | Box 1/4/5/6/7 match IRS Form 1099-NEC 2025 |
| Hardcoded payer/recipient TIN | ✅ Shipped | EIN from `organizations.ein` (encrypted), TIN from `contractors.taxIdEncrypted`. Both masked in PDF. Validates non-placeholder per `bookkeeping.ts` `TaxIdentityError` pattern |
| Missing 1096 transmittal | 🟡 Deferred | Copy B mailing doesn't require 1096; only paper Copy A filing does |
| No FIRE format / IRIS support | 🟥 Open | FF-3 returns base64 PDFs only. `form1099Batch.ts` has FIRE machinery for 1099-INT — needs extension to NEC for IRS e-filing |
| Missing IRS-expected fields | ✅ Shipped | Boxes 2, 3, 8-14 modeled as optional (future-use) |
| Tax-year + excludedFrom1099 bucketing | ✅ Shipped | Route filters by `tax_year + excludedFrom1099 = false` on aggregation |
| Aggregation correctness | ✅ Shipped | `SUM(amount_cents) GROUP BY contractor_id` |
| Output clarity (Copy B vs A) | ✅ Shipped | Header + footer disclaimers explicit |

**Phase 4 follow-up** when IRS e-filing becomes a customer ask:
- `buildFireFromNecForms()` mirroring the existing 1099-INT FIRE pipeline
- `render1096NecTransmittal()` PDF generator
- Route param `?format=fire` for batch output
- Estimated effort: 4d (the patterns already exist in `form1099Batch.ts`)

---

## §2. BH-1 / BH-2 tenant + screening vs Cordelia / Caspian / Imelda

### Verdict: 🟥 Permissible-purpose attestation gap blocks real customer launch.

The vertical foundation (tenant entity + lease + screening fields + 50-state
late-fee engine + adverse-action timestamp) is sound — but **two
launch-blocking compliance gaps** sit between the shipped schema and a
real Imelda-tier customer paying for tenant screening.

| Concern | Status | Severity |
|---|---|---|
| **Permissible-purpose attestation per lookup** (Cordelia §3) | 🟥 Open | E&O blocker — $25K sublimit on privacy claims until shipped |
| **Adverse-action notice send (not just timestamp)** (Imelda §3.5) | 🟥 Open | $100-$1K statutory damages per violation, class-action exposure |
| Caspian §1 termination warning (skip-trace patterns) | ✅ N/A | BH doesn't call skip-trace today. Future risk if integrated. |
| Free-form prejudicial notes vs structured outcomes (Imelda §2.6) | ✅ Shipped | Schema enforces structured fields |
| Tenant records covered by legal-hold scope (P0-23 interaction) | 🟡 Partial | Scope-resolution function needs explicit `tenants` + `rental_leases` enumeration check |
| Screening fields encryption (P0-5 interaction) | 🟡 Partial | Manually-entered today (no vendor data); future risk if vendor screening integrated |

**Phase 4 critical path before launching tenant screening** (~5-6 engineer-days total):

1. **Permissible-purpose gate** (3-4d):
   - New `tenant_screenings` table: `purposeOfUse` enum, `requestingUserId`, `attestationVersion`, `tenantId`, `propertyId`, `timestamp`
   - Annual click-through attestation on `users.fcraAttestationAt`
   - Route guard rejects screening POST if attestation stale (>365d) or missing
   - "Attestation pending — permissible purpose required" banner per Cordelia §3
2. **Adverse-action notice send** (2-3d):
   - Replace flag-stamping with real email + SMS notice template
   - CRA reference (when integrated), right to dispute, right to free copy, statutory timeline
   - Audit-log row with notice template hash + delivery confirmation
3. **Legal-hold tenant scope** (1-2d):
   - Audit `legalHoldScopeExpansion` to confirm `tenants` + `rental_leases` rows are enumerated
   - Test-drive a hold against a property with active leases
4. **Customer-facing FCRA disclaimer footer** (1d):
   - Render in tenant-screening result UI: "permissible purpose attested at use time; not for employment/credit decisions outside this property-screening context"

---

## §3. Recovery console (P0-22) + sidebar twin (P1-50)

### Verdict: ✅ Founder console 100% shipped. 🟥 P1-50 user-facing twin still open.

The founder-side recovery console (`server/routes-admin-recovery.ts`, 862
lines) implements all 7 endpoints from Asher-takeover §4 step-7 +
Coriander §1 spec. Backend audit is clean:

| Endpoint | Status | Line |
|---|---|---|
| `/api/admin/users/:id/2fa/reset` (with identity-proof) | ✅ | 236-329 |
| `/api/admin/users/:id/sessions` (list) | ✅ | 331-400 |
| `/api/admin/users/:id/sessions/:sid/revoke` | ✅ | 402-469 |
| `/api/admin/users/:id/sessions/revoke-all-others` | ✅ | 471-567 |
| `/api/admin/orgs/:id/freeze-autopay` | ✅ | 569-653 |
| `/api/admin/orgs/:id/transfer-ownership` (court-doc reference) | 🟡 Partial | 655-774 — accepts S3 key but no review queue |
| `/api/admin/users/:id/password-reset-link` | ✅ | 776-861 |
| Founder UI at `/founder/recovery-console` | ✅ | wired with full error handling |

**P1-50 user-facing twin** — the preventative surface that would stop the
attack at hour 1 instead of requiring escalation at hour 6:

| Surface | Status | Notes |
|---|---|---|
| `/account/security` page (sessions list + revoke) | 🟥 Open | Customer self-service equivalent of admin endpoints |
| Email-on-new-location detection | 🟥 Open | GeoIP + risk-score on login |
| Email-change confirmation step to original address | 🟥 Open | Attacker changed org email at 12:10 with zero friction in Asher's incident |
| Rate-limit on `/api/leads/export` per-org | 🟥 Open | 1,800 borrower export at 09:04 with no friction |
| Anomaly-detect bulk download bursts | 🟥 Open | No "Bulgaria login on Arizona user" alert |
| Estate-executor review queue (Martin §1-3) | 🟡 Partial | Backend accepts court-doc reference; no review queue / dual-control approval / `estate_executor` role |
| Audit log `support_case_ticket_id` correlation column (Coriander §3) | 🟥 Minor | Audit logs by actor email, not by ticket id |

**Phase 4 work — the user-facing twin** (~2-3 weeks):

1. `/account/security` page: sessions list, revoke single, "sign me out everywhere," password change, 2FA enrollment status (~3d)
2. Email-on-new-location: GeoIP + 7-day-no-such-IP detector + email send (~3d)
3. Email-change confirmation: confirm-via-old-email step before mutating organizations.email (~2d)
4. Rate-limit on `/api/leads/export`: per-org daily cap + burst detection + audit-log row at threshold (~2d)
5. Estate-executor flow: intake form → review queue → dual-control approval → `estate_executor` role assignment (~5d)

These are P1 items — not launch-blocking — but together they're the difference between Asher's incident being a 6-hour-9-action-0-friction attack (current state) vs a 30-minute-3-action-revoke-and-alert event (target state).

---

## §4. Cross-cutting findings

### What surfaced from all three audits

1. **The shipped vertical work consistently exceeds the persona's deal-killer
   bar.** FF-3 covers Devon's January workflow; BH-1/BH-2 covers Imelda's
   tenant CRM ask; recovery-console covers Asher's revocation surface.
2. **The follow-up work is the *next* layer of compliance + UX**, not gaps in
   the deal-killer. 1096 transmittal for IRS filing, FCRA permissible-purpose
   attestation for tenant screening at scale, customer-side incident response
   for retail-tier accounts.
3. **Two items rise to "blocks real customer launch":** the tenant screening
   permissible-purpose gate (Cordelia E&O subjectivity) and the
   adverse-action notice send (Imelda statutory damages). Both are <1 week
   of focused work each.
4. **The recovery console twin (P1-50) is the largest cluster of open
   user-facing security work.** Worth a dedicated workstream when customer
   pipeline justifies; not blocking on the wedge product.

### Phase 4 backlog additions from this re-sweep

| # | Item | From | Effort | Why |
|---|---|---|---|---|
| RS-1 | Tenant screening permissible-purpose attestation | Cordelia §3 + Caspian §1 | 3-4d | Blocks tenant-screening launch + E&O subjectivity |
| RS-2 | Adverse-action notice real send | Imelda §3.5 | 2-3d | Blocks tenant-screening launch + statutory exposure |
| RS-3 | Legal-hold tenant + lease scope verification | Saskia P0-23 follow-up | 1-2d | Compliance correctness |
| RS-4 | `/account/security` user-facing twin | P1-50 | 3d | Customer-side incident response |
| RS-5 | Email-on-new-location detector | P1-50 | 3d | Customer-side incident response |
| RS-6 | Email-change confirmation step to original | P1-50 | 2d | Asher-takeover root cause |
| RS-7 | `/api/leads/export` rate-limit + burst detect | P1-50 | 2d | Asher-takeover root cause |
| RS-8 | Estate-executor review queue | Martin §1-3 + Coriander §1 | 5d | Recovery-console depth gap |
| RS-9 | 1096 transmittal + FIRE for 1099-NEC | Olympia + Devon | 4d | When customers ask for IRS e-filing |

**Total Phase 4 add: ~25-29 engineer-days from this re-sweep.**

---

## §5. Update to MASTER-FINDINGS-RECONCILIATION

The reconciliation doc accurately captured the P0 status. This re-sweep
adds a "Phase 3 follow-ups" section to the Phase 4 sequencing:

- **Pre-launch P1 (must ship before tenant-screening customers):** RS-1, RS-2, RS-3
- **Customer-side security P1 (P1-50 cluster):** RS-4, RS-5, RS-6, RS-7
- **Recovery-console depth (Coriander follow-up):** RS-8
- **IRS e-filing follow-up (when ask arrives):** RS-9

---

*Generated 2026-05-08 from 3 parallel Explore-agent audits against
post-2026-05-01 surfaces. The shipped vertical work holds up against
persona deal-killers; this doc surfaces the next-layer compliance and UX
residuals.*
