# Launch-readiness audit — reshaped after the adversarial red team

The original "30 First Users" audit was, by the red team's (correct) verdict, a
**navigation + persona-gating smoke test wearing a launch grade**: it walked 7
of ~100 routes, never operated the product, ran with every external integration
off, and was graded by its own author. "Functionally an A" overclaimed.

This reshape splits the audit into honest layers, each answering a *different*
question. **No single layer is a launch grade.** A layer that can't run locally
is marked so.

## Layer 1 — Shell & persona-gating smoke (`tests/e2e/customer-personas.spec.ts`)
**Question:** do the doors render without crashing, and does each persona see the
right modules/vocabulary, across 30 personas × 7 doors × 12 viewports?
**Runs locally:** yes. **Is a launch grade:** **no** — it proves the lobby
renders, not that anyone can do their job. Its letter score is navigation-only.

## Layer 2 — Cross-tenant authorization (IDOR) fuzz (`tests/security/idorFuzz.ts`)
**Question (the red team's #1 launch-killer):** can org A read org B's data by
editing a URL id?
**What it does:** seeds high-value resources (PII leads, financial notes, deals,
properties, **and the legal-document family** — sealed PDF / completion
certificate / signatures) into two orgs, then from org A fires GET at org B's
ids — with a **positive control** (A reads A's own → must be 2xx, so a cross-org
404 means "isolated", not "route broken").
**Result (run against the local stack):** ✅ 8/8 resource types isolate; the
control proves the endpoints work; **no cross-tenant read breach.**
**Honest coverage:** 8 of ~73 customer org-scoped `:id` routes. The script
prints the **uncovered tail** so it can be expanded; the crown-jewel
(PII/financial/legal) data is covered.
**Runs locally:** yes.
```
DATABASE_URL=... PLAYWRIGHT_BASE_URL=http://localhost:5050 npx tsx tests/security/idorFuzz.ts
```

Now also covers **WRITES** (the modify/delete breach): A's PUT/DELETE on B's
resources return 403 **and B's row provably survives in the DB** (the airtight
check). 8 read + write types clean; coverage report prints the ~81-route tail.

## Layer 3 — Jobs-to-be-done outcomes (`tests/e2e/jtbd-outcomes.spec.ts`)
**Question:** can a real user *do the job*, does it *persist*, does bad input get
*rejected*, is hostile input *safe*?
**What it does:** operates the real Quick-add-lead UI — creates a lead and
asserts it appears **and survives a reload** (the mutation-invalidate /
optimistic-rollback bug class), submits empty (no junk record), and injects an
`<img onerror>` payload (must be escaped, not executed).
**Result:** ✅ 3/3 pass — create-and-persist, validation, stored-XSS-safe.
**Runs locally:** yes. `npx playwright test --project=jtbd`
**Also on the real WebKit/Safari engine** (`--project=jtbd-webkit`): ✅ 3/3 —
the create-lead flow works on Safari, no engine-specific bug. (Closest proxy to
real iOS Safari without a device cloud.)

## Layer 4 — Load / concurrency / volume (`tests/perf/loadConcurrency.ts`)
**Question:** does it hold up at real data volume + many users at once?
**Result (5000 leads, 40-way concurrency × 4 rounds):** ✅ all 200, no 5xx, p95
~1.4s — the leads endpoint paginates (no render-everything hang), no pool
exhaustion. (Note: ~1.4s p95 even local/paginated is itself a perf input to the
<1.5s door goal.)
**Runs locally:** yes.

## Realism mode (the rest) → `tests/README-realism-mode.md`
Everything that needs a **staging app + real test-mode keys + a device cloud**
(real integrations with inverted scoring via `REALISM=1`, the real auth funnel,
real-device Safari, failure injection, AI eval) is specified there as a concrete
runbook. It is the actual launch gate and is **not runnable in a local sandbox**.

## What is STILL NOT covered (needs a staging env / real devices — not runnable in the local sandbox)
These are the remaining red-team items. They require infrastructure this harness
can't fabricate, and must run before a real launch is certified:

1. **Realism mode — integrations ON.** Everything above ran with Stripe/Lob/SES/
   Twilio/Regrid/AI **off**, so the product's *core value paths were never
   exercised*. Needs a staging app with real **test-mode** keys, and the scoring
   inverted (a 5xx from a *configured* core integration = hard, + assert real
   data renders).
2. **Real auth funnel.** Signup → email-verify → login → reset → session-refresh
   (the highest first-user drop-off) — bypassed here by the test-auth cookie.
3. **Real devices.** BrowserStack/Sauce real **iOS Safari + Android** — Chromium
   emulation literally can't reproduce the iOS double-tap class.
4. **Failure injection / resilience.** Provider timeouts, network-drop mid-POST,
   slow-DB, payment half-completes, idempotency under retry.
5. **Load / concurrency / volume.** 50–100 concurrent sessions; a 50k-row org.
6. **AI safety/quality eval.** Hallucination, claims-gate/fair-housing, prompt
   injection, cost caps.
7. **The full IDOR tail** (Layer 2 covers 8 of ~73 routes) and writes (PUT/DELETE
   under CSRF).
8. **A small real-human usability study** as ground truth.

## Honest verdict
- **Shell + gating:** solid (0 crashes, gating correct).
- **Cross-tenant isolation (crown jewels):** verified clean — the worst-case
  launch incident does not reproduce on the high-value data.
- **Can-the-user-do-the-job (lead create/persist/validate/XSS):** verified clean.
- **The product's actual value paths (parcels/mail/payments/AI):** **still
  unverified** — they need realism mode on staging. Until then, no letter grade
  is a launch grade.
