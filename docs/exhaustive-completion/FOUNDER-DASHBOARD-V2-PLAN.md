# Founder Dashboard v2 — Plan

**Date:** 2026-05-04
**Workstream:** C.1 (per Comprehensive Pre-Vertical Stabilization Directive)
**Status:** **PLAN ONLY — awaiting founder approval before implementation.**

---

## ⚠ Important finding before reading this plan

The directive authorized "full replace against prototype `FounderHomeC`." After reading the prototype, I want to flag something before any implementation work starts:

**The prototype `FounderHomeC` is not a full new dashboard. It is a 12-line wrapper** (`acreos/round3-integrations-2.jsx:26-37`) that:

```jsx
const FounderHomeC = ({ onNav }) => {
  const Inner = window.FounderHomeB || window.FounderHome;
  return (
    <div className="founder-c">
      <div className="founder-c-feed-wrap">
        <LiveFeed />          // ← the new thing
      </div>
      {Inner && <Inner onNav={onNav} />}   // ← the existing dashboard, unchanged
    </div>
  );
};
```

It puts a `<LiveFeed />` at the top of the existing `FounderHomeB` page. That's the entire prototype design. It's not a full reimagining.

This matters for two reasons:

1. **Wave 11 already shipped a full CEO-daily-window rebuild at `/founder-home`** with hero, 4-tile metrics, pulse charts, recent activity, system health, tracking notes. That work is closer to a "founder dashboard v2" than `FounderHomeC` is.

2. **`founder-dashboard.tsx` (7,379 lines) is the OPERATIONS CONSOLE**, not the daily-window dashboard. It contains feature flags, A/B tests, data-source admin, endpoint manager, agent traces, LLM-cost dashboard, etc. — surfaces that legitimately read together as ops controls. The action plan §6 explicitly says: *"After all 5 extractions: founder-dashboard.tsx becomes ~2,500 lines (down from 7,400). The remaining content is the operational cluster... it's the operations control room."*

So the goal isn't to replace `founder-dashboard.tsx` with a thin `FounderHomeC` wrapper. The goal is to **finish the extraction queue** (5 extractions, ~2-3 done) so the residue becomes the legitimate operations console it wants to be — and let `/founder-home` (already rebuilt) be the CEO daily window.

---

## My recommended approach (option A — adjusted)

**Reframe C.1 as "Finish the extraction queue + apply mechanical polish to the residue."**

This is closer to JUDGMENT-CALL #2's "S effort — codemod-only mechanical token migration" alternative than the L-effort full replace, AND it's already partially in flight from Wave G work pre-session. It's also the only option that the prototype's actual content supports.

### Phase A — extraction queue completion (3-5 days)

Per `docs/exhaustive-completion/founder-dashboard-extraction-queue.md`, five extractions were planned:

| # | Extraction | Target route | Status |
|---|---|---|---|
| 1 | API keys + system keys → `/founder/keys` | new | _verify_ |
| 2 | LaunchReadiness checklist → `/founder/readiness` | new | _verify_ |
| 3 | ActionQueuePanel → merge into `/founder/todo` | merge | _verify_ |
| 4 | OrgHealth + ChurnRisk + MRRTrajectory → `/founder/customers/health` | new | _verify_ |
| 5 | GrowthSection (~2,000 lines) → `/founder/growth/campaigns` | new | _verify_ |

**Step A.1 — verify which have shipped.** Read `founder-dashboard.tsx` and grep for the panel names. Mark each as:
- ✅ Already extracted (route exists, dashboard shows link card)
- ⚠ Partially extracted (route exists, dashboard still has duplicate)
- ❌ Not extracted

**Step A.2 — execute remaining extractions** in priority order from the queue. Each ships as one PR, one route, one dashboard → link-card swap.

**Step A.3 — token codemod sweep** on whatever residue remains in `founder-dashboard.tsx`. Wave 9's `acr-*` codemod hit color literals across 312 files, but a 7,379-line file may have edge cases (inline `style={{...}}` blocks, conditional class names) the codemod missed.

### Phase B — operations-console design treatment (2 days)

The residual `founder-dashboard.tsx` (post-extractions) is the operations console. Apply:
- Brief §14's "founder mode = subtle accent + denser layout" treatment — `--acr-bg-sunken` background, tighter line-height, smaller font scale
- Group remaining sections under explicit `<Section>` blocks with clear typography
- Move heavy charts to lazy-imports (cuts dashboard chunk weight)
- Make sure the page composes properly with the new `/founder-home` for the CEO/ops navigational distinction

### Phase C — cutover (½ day)

Move the legacy `/founder-dashboard` route behind a feature flag `founder_dashboard_legacy` (default ON for the founder, OFF for everyone else, since the founder is currently the only user reaching that route anyway). After the residue is polished and split-viewed-OK, flip the flag to "kept on the sidebar but route still works." No deletion — the route is the operations console.

### Phase D — verify (½ day)

- Headless screenshot of `/founder-dashboard` post-extraction across all 5 themes
- Check `/founder-home` and `/founder-dashboard` together — clear functional distinction visible
- Verify all extraction-target routes (`/founder/keys`, `/founder/readiness`, etc.) work standalone

### Estimated total: 6-8 days

Closer to L than M, BUT:
- Most surfaces don't need new design — they're getting moved, not rebuilt
- The extractions are mostly mechanical
- The polish layer is small and bounded

---

## Alternative B — full rewrite (if you reject A)

If you want a literal "full v2 replace against `FounderHomeC`":

1. Build a new `founder-dashboard-v2.tsx` as a thin wrapper that mounts `<LiveFeed />` + the existing `founder-dashboard.tsx` content.
2. The new wrapper is ~50 lines.
3. The old 7,379-line file remains, just with a `<LiveFeed />` on top.

**This is what `FounderHomeC` literally is** — a 12-line wrapper. Implementing it as "v2" is a one-day job, but it doesn't solve the underlying problem (the 7,379-line monolith). It just adds a feed component.

I do not recommend this option. The prototype's value isn't its structure (a wrapper); it's the `<LiveFeed />` widget itself, which can be added to either `/founder-home` or to the operations console without a rewrite.

---

## Alternative C — defer entirely (if you reject A and B)

Take JUDGMENT-CALL #2's "S effort — codemod-only mechanical token migration" path:
- Run color-token codemod (already done in Wave 9)
- Apply manual verb-canon migrations to button labels (lib/labels.ts already exists from Wave 9)
- Apply persona-leak ESLint rule (already active from Wave 1)
- Stop. Don't try to re-skin.

**Effort: zero days. The mechanical work has already shipped.** This is the "ship velocity over design care" call.

---

## What this plan needs from you

**Pick one:**

- **(A) Recommended:** Finish the extraction queue + polish residue as operations console. ~6-8 days. The work is mechanical, the design treatment is bounded, and the result actually solves the underlying 7,379-line monolith.

- **(B) Literal directive:** Build founder-dashboard-v2 as a thin `LiveFeed` wrapper around the existing 7,379-line page. ~1 day. Adds the prototype's only new widget but doesn't reduce the monolith.

- **(C) Codemod-only:** Acknowledge mechanical work has shipped; stop trying to re-skin. Operations console stays as-is. 0 days.

If you authorize (A), I can begin Phase A.1 (extraction-status verification) immediately.

If you authorize (B), I can ship in 1 day.

If you authorize (C), I'll mark JUDGMENT-CALL #2 resolved and move on.

---

## My recommendation rationale

**(A) is the right answer because:**
- `/founder-home` already IS the CEO daily window (Wave 11 — verified by reading the new file)
- `/founder-dashboard` is conceptually the operations console; the action plan §6 says so explicitly
- The 7,379-line monolith is the actual debt; finishing the extractions is the actual fix
- The "FounderHomeC" prototype is too thin to drive a full rewrite

**(B) is the literal directive but doesn't fix the underlying problem.** I'd rather flag this honestly than execute the literal instruction and pretend the monolith is solved.

**(C) is also defensible** if you trust the brief's existing position that founder-dashboard is the ops cluster and shouldn't be re-skinned for design's own sake.

**Awaiting your call.**
