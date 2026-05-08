# Harlowe Stone — M&A / exit-readiness diligence

**Reading list (what I read before writing):**
- `docs/exhaustive-completion/MASTER-FINDINGS-RECONCILIATION.md` (21/24 P0s shipped; Dropbox webhook idempotency and LAR overlay the only real gaps)
- `docs/exhaustive-completion/post-may1-resweep.md` (RS-1..RS-7 closed; tenant-screening permissible-purpose + adverse-action-notice still Phase 4; no new legal exposure)
- Harlowe-acquisition.md — original memo from 2026-05-01 (do-not-recommend at $40M; recommend $14M–$18M acqui-hire on cleaned books)
- `shared/schema.ts` (Drizzle schema, audit_events table, legal_holds shipped per P0-23), `server/routes-admin-recovery.ts` (recovery console exemplary), `server/services/dunning.ts` (Marisol called "best-built piece of stack")
- `git shortlog` (2,089 human commits from founder = 82% of codebase; 435 from Claude AI assistant)

---

## State read

Five weeks ago I said: books are unauditable, ESIGN has integrity holes, privacy posture is 30% GDPR-ready, sub-processor DPAs are all unsigned, and the founder is 99% of the codebase. The exit-readiness score was F. Today: P0-1 shipped (tier-pricing unified, audit trail is cleaner), recovery console is exemplary (shows the founder can execute at product-quality level), and RS-1..RS-7 show disciplined execution against known gaps. The fundamental liabilities (ESIGN content hash, GDPR sub-processor DPA chain, founder bus-factor, per-customer COGS visibility) have **not been addressed**. They are still deal-destroyers at $40M; they are manageable at $14M–$18M with 24-month founder retention + earnout gating.

---

## Push forward — my 5 moves (ranked)

1. **ESIGN integrity layer (content hash + immutability + completion certificate) before any note-servicing customer** — Harlowe's §5.4 called this personal-liability land-mine. Today `routes-doc-system.ts:725` accepts content updates post-signature with zero guard. Marisol's Phase 4 says this is 5 days of engineering. **Do it now, before you close any deal.** Build: (a) `signatureContentHash` column on `signatures` table (SHA256 of document content at sign-time), (b) post-completion: immutability guard (BEFORE trigger prevents UPDATE on signed docs), (c) completion-certificate PDF generation (audit trail, signature hashes, timestamp), (d) archive the signed PDF (S3 + metadata link). This is the difference between "I signed something in AcreOS and it was changed" and "here is the cryptographic proof it wasn't." Two weeks of focused work. **Every acquirer's lawyer will ask for this; every state real-estate regulator will ask for this; every contract-for-deed operator will depend on this.** Do it today.

2. **Subscription event ledger + deferred-revenue recognition (ASC 606 clean books)** — Harlowe's §3 flagged: tier changes mutate `organizations.subscription_tier` in place (yesterday's MRR unrecoverable), annual subs are revenue-on-day-1 (ASC 606 violation), no nightly Stripe↔DB reconciliation. This is **Marisol + Hassiba's 10-day sprint.** It is a hard blocker for any acquirer diligence or Series-A raise. Build: (a) immutable `subscription_events` table (type: created/upgraded/downgraded/churned, with amount + date), (b) `deferred_revenue` ledger (annual subs create a liability row, recognized monthly), (c) nightly Stripe-reconciliation job (detects drift, alerts), (d) quarterly audit-log export showing the MRR timeline is reproducible. This moves diligence from "rebuild the books from Stripe" to "spot-check our books against Stripe." Harlowe's §7.2 said books are currently CONDITIONAL FAIL; this fixes it to defensible B+. Three weeks. **Non-negotiable.**

3. **Customer-concentration alert + COGS-per-customer view on a `/founder/diligence` dashboard** — Harlowe's §3.4 said "nobody at AcreOS can tell me which customer is the largest." Ashok's §2 (Series-A memo) said the same. Build a `/founder/diligence` page (internal-only, founder-visible) showing: (a) top 5 customers by MRR + % of total, (b) monthly alert if single customer > 20% of ARR (red flag for acquirer), (c) per-customer COGS rollup (AI calls + data + hosting + ops), (d) per-tier gross-margin distribution. Wired to Stripe API + `autonomousHealthMonitor` for costs. This is the single most-asked metric in acquisition diligence; having it ready moves the deal timeline from "we need 4 weeks for QofE" to "we already have audited numbers." Two weeks. High-leverage for both Series-A (Ashok's move 2) and exit (Harlowe's move 2).

4. **Delete competitor references and initiate trademark filing (preempt IP counsel scrutiny)** — Harlowe's §5.2 flagged: `docs/research-land-investing-intelligence.md` has 15+ Land Geek / Mark Podolsky references; the "100-Step Checklist (condensed)" is likely derivative work. An outside IP counsel scanning the data room will flag these as trademark/copyright risk. Clean-up is one hour (delete the docs, scrub references). Trademark filing (AcreOS in IC 042 + IC 036, USPTO) is ~$750 + 2 weeks. **Do both before any acquisition conversation.** Saves $X in deal contingency reserve and speeds close.

5. **Run a Snyk/FOSSA license audit (confirm no GPL/AGPL contamination)** — Harlowe's §5.1 said 600 transitive dependencies; AcreOS is closed-source. If a copyleft dependency sneaks into `package-lock.json`, an acquirer could inherit an obligation to open-source the codebase. This is a half-day scan (Snyk API integration, report). **If found: negotiate with the acquirer upfront (license risk = valuation reduction).** If clean: it's a clean artifact for the data room. Half a day. Do it before the first LOI conversation.

---

## What I'd defer (and why)

- **Full Type-safe cleanup (reduce 1,215 `as any` to <100).** Harlowe's §4 said this is 200+ hours of remediation. High-signal for infrastructure quality; not a deal-killer. Defer to post-close earnout milestone (SOC 2 completion, test coverage to 60%, Type cleanup).
- **Test coverage to 60% (critical paths only).** Real work (600+ hours estimated). But if ESIGN + books + COGS are clean, acquirers are more forgiving on test ratio. Defer to post-close integration.

---

## What scares me most (one named risk + mitigation)

**A material customer signs a contract on the native e-sign stack before the content-hash fix ships, and the signature is later contested.** You're pre-revenue / very-early-stage right now, so the risk is small. But if a Land Investor's seller claims the deed-of-trust was altered post-signature, and AcreOS has no cryptographic proof it wasn't, AcreOS is discoverable in the lawsuit. The founder has personal liability. An acquirer will assume that liability and will ask for insurance. **Mitigation: don't let any customer use native e-sign for contracts >$10k until the integrity layer ships.** This is a hard gate, not a nice-to-have. Gate the signing route: check document amount, if > $10k and no contentHash, return 403 "Contact support for high-value document signing." The two-week integrity sprint is non-negotiable before you scale Notes Investor (which is all high-value docs).

---

## Exit-readiness score by axis

| Axis | Today | After moves 1–5 | Exit-ready? |
|------|-------|---|---|
| Books (ASC 606 clean, NRR visible, COGS attributed) | D | B+ | Defensible |
| Legal (ESIGN integrity, privacy DPAs, state config) | D | B- | Acceptable with caveats |
| Founder bus-factor | F | D (earnout gate mitigates) | Manageable via retention |
| IP (no copyleft, no competitor-ref liability) | C | A | Clean |
| Product quality (Stripe plumbing, dunning, recovery console) | B+ | A- | Strong |
| **Overall exit readiness** | **D+ → E** | **B-** | **Acqui-hire fundable at $14M–$18M** |

---

**Bottom line for the founder:** You have a choice: raise Series-A and aim for a $150M+ exit in 5 years, or clean the books/legal/IP now and sell to Buildium/Yardi/AppFolio at $15M–$25M in 12–18 months. The Series-A path is higher-ceiling (10–15× return if the multi-vertical thesis works); the exit path is lower-friction (no VC board, no dilution, clean exit 24 months from now). **If you choose exit: do moves 1, 2, 4, 5 (ESIGN integrity, books, IP cleanup, trademark). Takes 6 weeks. Then you're LOI-ready at $14M–$18M.** If you choose Series-A: do moves 2, 3 (books, founder-diligence dashboard) plus the Ashok moves above. The ESIGN integrity layer (move 1) is non-negotiable for either path. Ship it first.
