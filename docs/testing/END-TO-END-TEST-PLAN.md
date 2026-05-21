# AcreOS End-to-End Test Plan

The version of the original Playwright pass that actually catches everything.

The previous "ruthless testing" approach was sampling-based: open the public landing,
click around, find a few bugs, fix, repeat. This plan is systematic, automated where
possible, and structured around the four axes that matter: coverage breadth,
viewport parity, navigation symmetry, and outbound safety.

---

## Principles

1. **Cover everything, not a sample.** Every route. Every viewport. Every founder
   nav item. Every public CTA. If it exists, it gets walked.

2. **Forward and backward.** Every navigation must be reversible — the browser
   back button, in-app back links, breadcrumbs, deep-link entry all work.

3. **Both viewports first-class.** Mobile (390×844) and desktop (1440×900) tested
   per route, side-by-side. Never assume "mobile-only" or "desktop-only".

4. **Zero outbound side effects during testing.** No real emails, no real SMS,
   no real ad-platform broadcasts, no real OpenAI spend on test prompts. The
   engine has approval gates and dry-run modes — use them.

5. **Structured findings.** Every bug captured with `{ route, viewport, action,
   expected, actual, severity, file:line if known }`. Severity = critical /
   major / minor.

6. **Fix in batches, deploy between, reverify.** Don't fix-then-move-on — the
   next batch's tests can regress earlier fixes.

---

## Layers

The test runs in five layers, fastest-cheapest first:

### Layer 1: HTTP probe (10 seconds)

Curl every route in `client/src/App.tsx`. Capture status code, redirect count,
final URL. Catches:
- 5xx server errors
- Redirect loops (max-redirs exceeded)
- Broken `<Route path="/x">` registrations
- Deploy regressions where a server route was removed but client links remain

Script:
```bash
grep -oE 'path="(/[^"]*)"' client/src/App.tsx | sed 's/path="//;s/"$//' | grep -v ":" > /tmp/routes.txt
cat /tmp/routes.txt | xargs -I{} -P 20 sh -c '
  result=$(curl -s -o /dev/null -w "%{http_code}:%{num_redirects}" --max-time 8 --max-redirs 5 "https://acreos.io{}")
  echo "{}|$result"
' > /tmp/probe.log
awk -F'[|:]' '{print $2}' /tmp/probe.log | sort | uniq -c | sort -rn
```

Pass criterion: 100% of routes return 200 with 0 redirects (or a single 301 to
a canonical destination).

### Layer 2: Static analysis (1 minute)

Catches issues a probe can't:
- `Redirect` targets that don't resolve to a registered route
- `<Link href="...">` references to deleted routes
- Founder-codename leaks in customer-facing AI prompts
- Console.log usage in production server code
- Hardcoded localhost / staging URLs
- Duplicate exports in `shared/schema.ts`
- Components imported but not exported anywhere

Scripts:
```bash
# Redirects → registered routes
grep -oE 'Redirect to="(/[^"]*)"' client/src/App.tsx | sed 's/Redirect to="//;s/"$//' | grep -v "#"
# Cross-reference with grep over the route list above

# Founder-codename leaks
npm test tests/unit/aiPromptLeakage.test.ts

# Duplicate exports
npm run check
```

Pass criterion: type-check clean, ESLint zero new warnings, all leakage tests
green.

### Layer 3: Vitest suite (45 seconds)

Runs the 4,988-test vitest suite. Catches regressions in:
- API route handlers (auth, org middleware, rate limiters, security)
- Service-layer logic (cohort analysis, lifecycle programs, etc.)
- Schema parsing (whole suite fails to load if shared/schema.ts is broken)
- UI snapshot drift

Script:
```bash
npm test 2>&1 | grep -E "^      Tests"
```

Pass criterion: same pass/fail count as the last clean baseline. Today's
baseline: 4972 pass / 15 fail (15 are documented pre-existing failures
in cohort date formatting, animation config shape, tax-delinquent date math).

### Layer 4: Browser-driven walkthrough (Playwright MCP — 15-30 minutes)

This is where the actual UI verification happens. Two viewports, four flows.

#### Flow A: Stranger Sign-Up End-to-End

Mobile (390×844) then desktop (1440×900):

1. Open `/` — verify console clean, hero renders, hamburger visible on mobile, desktop nav visible on desktop
2. Tap "Start free trial" → confirm `/auth?mode=register` loads and SignUp widget renders
3. Open hamburger / scroll to footer → tap each major nav link, verify destination loads
4. Tap "Pricing" → confirm `/pricing` renders, the 4 tiers visible
5. Tap "Security" / "Glossary" / "Changelog" → each loads cleanly
6. Browser back button after each — returns to landing intact
7. Verify cookie consent banner persists across navigations (Accept once, never again)

Pass criterion: zero console errors, no horizontal scroll on mobile, every link
either loads its destination or fails loudly (no silent dead links).

#### Flow B: Authenticated First-Run (/today)

Sign in via Clerk widget → land on `/today`:

1. `/today` renders without infinite splash
2. Sidebar expands; founder section visible if founder, hidden if not
3. Click each top-level customer nav item: Deals, Leads, Properties, Notes,
   Finance, AI, Settings — every page loads
4. From each page, browser back to `/today` works
5. From each page, click a subnav item → that subpage loads, back works
6. Sign out → land cleanly on `/auth` (no loop, no stuck state)

Pass criterion: every page renders content (not just a spinner); navigation
forward and back symmetric; sign-out completes.

#### Flow C: Founder Surface Deep-Dive

After founder sign-in:

1. `/founder` (canonical Now) — pending decisions list, autonomous-handled
   rollup, no stale loader
2. `/founder/steering` — monthly cockpit data, no missing sections
3. `/founder/studio` — every seeded dial renders with type-appropriate editor;
   edit one (e.g. `autonomy.default_gate` from "auto" to "review"), save, refresh,
   confirm persists; reset, confirm returns to default
4. `/founder/inspector/audit` — recent founder mutations show up (the studio
   edit above should appear)
5. `/founder/inspector/agent/sophie` (or any active agent) — trust curve,
   recent decisions, prompt history all render
6. `/founder/cmo` — pending bundles list (empty is fine), no console errors
7. From each, browser back works; sidebar entries reachable

Pass criterion: every founder canonical surface renders; the dial-edit round-
trip works end-to-end; audit captures the change.

#### Flow D: Mobile Parity Sweep

On 390×844 only, walk:

1. Public landing — hamburger opens menu, sections reachable, footer not cut off
2. `/founder` — single-column layout, no horizontal scroll
3. `/founder/studio` — dial cards stack, edit modal full-screen friendly
4. `/founder/inspector/agent/:codename` — stat cards stack, trust curve readable
5. `/founder/cmo` — bundle preview plays inline, approve/reject buttons full-width

Pass criterion: every founder surface usable single-handed on a phone; no
horizontal scroll anywhere; touch targets ≥44px.

### Layer 5: Outbound-safety verification

Before any Layer 4 run, confirm no real outbound:

```bash
# Set test-only env vars during the walkthrough session:
export SIMULATION_MODE_AI_PAID=true       # short-circuits OpenRouter calls
export CMO_DRY_RUN=true                    # skips ElevenLabs + Pexels + Remotion
export META_PAGE_ID=""                     # blocks Meta broadcast
unset TIKTOK_DEFAULT_ADGROUP_ID            # blocks TikTok broadcast
# Disable email transport: AWS_SES is configured by env — clear creds temporarily
```

Then verify in Layer 4 that any "broadcast" or "send" button:
- Either shows a confirmation dialog (founder review gate)
- Or fails loudly with a "no outbound configured" message

Never reaches a real customer / ad-platform / mailbox.

---

## Findings template

```
{
  "id": "F-001",
  "route": "/founder/studio",
  "viewport": "390x844",
  "action": "tap 'Save' on trust.tier_breakpoints dial",
  "expected": "toast 'Saved'; dial card flips to 'customized' badge; reload preserves value",
  "actual": "toast appears but card still shows 'default' badge; reload reverts value",
  "severity": "major",
  "file_hint": "client/src/pages/founder/studio.tsx — likely missing query invalidation on save",
  "discovered_layer": 4,
  "discovered_at": "2026-05-20T22:14:00Z",
  "status": "open"
}
```

---

## Run cadence

- **Layers 1–3**: every commit, gated in CI ideally.
- **Layer 4**: weekly while iterating on UI; nightly during high-velocity
  feature work; before every prod release.
- **Layer 5**: setup once per testing session; teardown when done.

---

## What's automated today vs deferred

| Layer | Today | Coverage |
|---|---|---|
| 1 — HTTP probe | ✅ Scripted | 100% of static routes |
| 2 — Static analysis | ✅ vitest + tsc + ESLint | All ts/tsx + critical leakage tests |
| 3 — Vitest suite | ✅ `npm test` | 4988 tests across 330 files |
| 4 — Browser walkthrough | ⚠️ Manual (Playwright MCP) | 4 flows × 2 viewports = 8 walks |
| 5 — Outbound safety | ✅ Env-var driven | Effective once Layer 4 env is set |

Layer 4 today requires a human + Playwright MCP. A future investment:
script Layers 1–3 into a single `npm run test:e2e:full` that emits a
pass/fail report, plus a `tests/e2e/critical-flows.spec.ts` Playwright
file that automates Flows A–C with screenshots at each step.
