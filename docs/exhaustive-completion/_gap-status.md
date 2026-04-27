# Gap Status — Detailed Completion Criteria

Each gap has explicit checkbox criteria. A gap is only marked complete when every box is checked.

---

## Gap 1 — Auth-Gated Visual Verification

**Status:** in progress (1.0 automated pre-pass running per process update)

### Gap 1.0 — Automated visual analysis (NEW per process update)

- [ ] Phase A — Claude Design prototype rendered locally, every canonical surface captured at 1440 + 375 → `prototype-screenshots/`
- [ ] Phase B — every unauthenticated production surface captured at 6 breakpoints + per-surface mechanical checks (overflow, touch ≥44px, console errors, contrast, font loading) → `production-screenshots/` + `mechanical-checks/`
- [ ] Phase C — per-surface structured visual comparison with calibrated confidence (CONFIDENT-PASS / CONFIDENT-FAIL / NEEDS-HUMAN-REVIEW / AUTH-REQUIRED) → `visual-comparisons/`
- [ ] Phase D — `MASTER-GAP-REPORT.md` + clickable HTML comparison bundle → `comparisons/index.html`
- [ ] Honest skip if prototype rendering fails — output skip notice, mark 1.0 SKIPPED, proceed to original Gap 1.1

### Gap 1.1 — Founder visual verification (informed by 1.0)

- [ ] All 21+ customer surfaces have desktop screenshots in `docs/exhaustive-completion/founder-screenshots/desktop/`
- [ ] All 21+ customer surfaces have mobile screenshots in `docs/exhaustive-completion/founder-screenshots/mobile/`
- [ ] Founder notes exist for every surface in `docs/exhaustive-completion/founder-notes.md`
- [ ] All NEEDS-HUMAN-REVIEW surfaces from 1.0 explicitly judged by founder
- [ ] All CONFIDENT-FAIL surfaces verified by founder before fix
- [ ] 3-5 CONFIDENT-PASS surfaces spot-checked

### Gap 1.2 — Reconciliation and gap inventory synthesis

- [ ] `docs/exhaustive-completion/RECONCILED-GAP-INVENTORY.md` produced (work list for Gaps 2-9)
- [ ] Severity classified per gap (critical / important / nice-to-have)
- [ ] `docs/exhaustive-completion/automation-calibration.md` produced (where automation aligned/missed/over-confident)

---

## Gap 2 — Tier 1 Body Deep-Pass

- [ ] /today body deep-pass commit + deploy + founder verified
- [ ] /pipeline body deep-pass commit + deploy + founder verified
- [ ] /parcels (or /properties detail) body deep-pass commit + deploy + founder verified
- [ ] /inbox body deep-pass commit + deploy + founder verified
- [ ] Per-surface state coverage verified (4 states each)

---

## Gap 3 — Mobile Sweep on Tier 1

- [ ] /today screenshots at 320 / 375 / 414 / 768 / 1024 / 1440
- [ ] /pipeline screenshots at all 6 breakpoints
- [ ] /parcels screenshots at all 6 breakpoints
- [ ] /inbox screenshots at all 6 breakpoints
- [ ] No horizontal overflow at any breakpoint (verified in console)
- [ ] All touch targets ≥44px verified at mobile breakpoints
- [ ] Founder confirms mobile experience on real iPhone for at least 2 surfaces

---

## Gap 4 — Tier 2 Body Deep-Pass

- [ ] /buyboxes body deep-pass + verified (or note no standalone surface)
- [ ] /lists body deep-pass + verified (or note no standalone surface)
- [ ] /campaigns body deep-pass + verified
- [ ] /campaigns/performance body deep-pass + verified
- [ ] Per-surface state coverage verified

---

## Gap 5 — Mobile Sweep on Tier 2

- [ ] All 4 (or applicable) Tier 2 surfaces × 6 breakpoints screenshots
- [ ] All breakpoint issues resolved

---

## Gap 6 — Tier 3 Body Deep-Pass

- [ ] /offers body deep-pass + verified
- [ ] /documents body deep-pass + verified
- [ ] /finance body deep-pass + verified (special: don't regress seller-finance strength)
- [ ] /dispositions body deep-pass + verified
- [ ] Per-surface state coverage verified

---

## Gap 7 — Mobile Sweep on Tier 3

- [ ] All 4 Tier 3 surfaces × 6 breakpoints = 24 screenshots committed

---

## Gap 8 — Tier 4 Body Deep-Pass

- [ ] /agents body deep-pass + verified (special: AI Systems + Investor specialists must pass)
- [ ] /automations body deep-pass + verified
- [ ] /audit body deep-pass + verified
- [ ] /settings (each tab) body deep-pass + verified
- [ ] /team body deep-pass + verified
- [ ] /billing body deep-pass + verified (special: Stripe checkout flow load-tested)
- [ ] /integrations body deep-pass + verified
- [ ] /contacts body deep-pass + verified
- [ ] /calendar body deep-pass + verified
- [ ] Per-surface state coverage verified

---

## Gap 9 — Mobile Sweep on Tier 4

- [ ] All Tier 4 surfaces × 6 breakpoints screenshots committed

---

## Gap 10 — Per-Surface State Matrix Audit

- [ ] Every customer surface has all 4 states present and designed
- [ ] All 4 state screenshots per surface in `docs/exhaustive-completion/states/<surface>-{loading,empty-zero,empty-filtered,error}.png`
- [ ] Voice consistent across surfaces (matches HANDOFF §8 — specific, recoverable, owns the failure)

---

## Gap 11 — Founder Mode Chassis Adoption

- [ ] All 25 founder routes inventoried in `docs/exhaustive-completion/founder-routes.md` with current chassis status
- [ ] All 25 founder routes use FounderPageShell (23 remaining; /founder + /founder/tools already done)
- [ ] Founder visual verification of all 25 routes (screenshots committed)
- [ ] Founder invisibility verified by founder testing as non-founder (404 not 403, no leaks)

---

## Gap 12 — AI Output Quality Review

- [ ] Atlas prompts reviewed under AI Systems / Real Estate Investor / Product Strategy lenses
- [ ] Pax prompts reviewed under same lenses
- [ ] Sophie prompts reviewed under same lenses
- [ ] All AI output surfaces audited for presentation (recommendation, confidence, grounding, risk, action)
- [ ] Prompt + presentation improvements committed
- [ ] Test outputs documented in `docs/exhaustive-completion/ai-quality-validation.md`
- [ ] Elite team standard met for all three personas

---

## Gap 13 — Final Coherence Verification

- [ ] Visual consistency sweep at 1440 + 375 across every customer surface
- [ ] Voice consistency sweep across every customer surface
- [ ] Interaction pattern sweep (modal / toast / loading / confirmation)
- [ ] Final founder walkthrough complete with explicit "platform ready for vertical expansion" verdict
