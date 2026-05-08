# Founder-Dashboard GrowthSection Extraction — Phase A Scope

Per `docs/exhaustive-completion/founder-dashboard-extraction-queue.md`
Extraction #5. Phase A only — scope mapping, no code changes. Phases
B/C/D ship in their own PRs.

---

## What's in scope

`function GrowthSection()` in `client/src/pages/founder-dashboard.tsx`,
**lines 5167–5859** (693 lines as of commit f2d2c886). It's the entire
"Growth" tab content excluding the dashboard's tab plumbing.

The growth tab also currently includes:
- `<MRRTrajectory />` — already extracted to `/founder/customers/health` in F-D #4 (now a link card)
- `<ForecastPanel />` — financial forecast, **stays in dashboard** (separate workstream)
- `<ChurnIntelligence />` and `<GrowthEngine />` — imported from `@/components/dashboard`, **stay**

So the extraction targets `GrowthSection` only — its 11 hooks (5 useQuery + 6 useMutation), 6 type interfaces, and a four-step internal wizard (`setup` → `generating` → `preview` → `deploy`).

---

## API endpoints consumed

All under `/api/founder/growth/*`, all defined in `server/routes-admin.ts`:

| Method | Path | Purpose |
|---|---|---|
| GET    | `/api/founder/growth/attribution`               | Signup attribution rollup |
| GET    | `/api/founder/growth/ad-account`                | Current Meta ad account config |
| PUT    | `/api/founder/growth/ad-account`                | Save Meta ad account credentials |
| GET    | `/api/founder/growth/templates`                 | Campaign templates available |
| GET    | `/api/founder/growth/campaigns`                 | Campaign list |
| POST   | `/api/founder/growth/campaigns`                 | Create campaign (legacy path; wizard uses deploy below) |
| PUT    | `/api/founder/growth/campaigns/:id/status`      | Pause / activate / archive |
| POST   | `/api/founder/growth/campaigns/:id/sync`        | Re-sync from Meta |
| POST   | `/api/founder/growth/generate-creative`         | Kick off LLM creative bundle generation |
| GET    | `/api/founder/growth/creative-bundles/:id`      | Poll bundle status (queued → ready) |
| POST   | `/api/founder/growth/creative-bundles/:id/regenerate-copy` | Per-angle copy regen |
| POST   | `/api/founder/growth/creative-bundles/:id/deploy` | Push bundle live as a campaign |

All gated by `isAuthenticated + isFounderAdmin`. **No org-scoping needed** — these are platform-wide founder-only.

---

## TypeScript interfaces (all defined inline in the monolith)

Lines 5087–5165 in `founder-dashboard.tsx`:

- `interface GrowthCampaignItem` (5087–5099)
- `interface AdAccount` (5101–5106)
- `interface CampaignTemplate` (5108–5114)
- `interface SignupAttribution` (5116–5124)
- `interface AdCopyVariant` (5126–5142)
- `interface CreativeBundle` (5144–5165)

These move to the new page (or to a shared `@/components/founder/growth/types.ts` so reusable).

---

## Internal state (~14 useState hooks)

**Ad-account form state** (4 setters):
- `showAdAccountForm`, `adForm` — { adAccountId, accessToken, pixelId, appId }

**Wizard state** (10 setters):
- `wizardOpen` — bool, drives modal visibility
- `wizardStep` — `"setup" | "generating" | "preview" | "deploy"` four-step state machine
- `wizardTemplate` — selected template key
- `wizardName` — campaign name
- `wizardBudget` — budget USD as string
- `bundleId` — string | null, returned by /generate-creative, used to poll
- `bundle` — `CreativeBundle | null`, latest snapshot from polling
- `editingCopy` — string | null, angle name being edited
- `editDraft` — `Partial<AdCopyVariant>`, the in-progress edit
- `selectedImageIdx` — int, which generated image variant is shown
- `regeneratingAngle` — string | null, which angle is regenerating

**State machine summary** (the four wizard steps):
1. `setup` — pick template, name, budget
2. `generating` — POST /generate-creative, poll /creative-bundles/:id every ~3s until status='ready' or 'failed'
3. `preview` — view generated copy + images per angle, edit copy inline, regen per angle, swap images
4. `deploy` — POST /creative-bundles/:id/deploy, returns campaign_id, redirects to campaign detail

---

## React-Query keys to preserve

- `["/api/founder/growth/ad-account"]`
- `["/api/founder/growth/campaigns"]`
- `["/api/founder/growth/templates"]`
- `["/api/founder/growth/attribution"]`
- `["/api/founder/growth/creative-bundles/${bundleId}"]` — dynamic, polled with refetchInterval

The extraction must not rename or re-namespace these. (Per the queue
doc: "Keep the existing query keys + mutation paths.")

---

## Mutations

1. `saveAdAccountMutation` → PUT /api/founder/growth/ad-account
2. `generateCreativeMutation` → POST /generate-creative — returns `{ bundleId }`
3. `regenerateCopyMutation` → POST /creative-bundles/:id/regenerate-copy with `{ angle }`
4. `deployBundleMutation` → POST /creative-bundles/:id/deploy
5. `updateCampaignStatusMutation` → PUT /campaigns/:id/status
6. `syncCampaignMutation` → POST /campaigns/:id/sync

Each invalidates the relevant query keys on success — preserve those invalidations.

---

## External data dependencies (no internal flows; what reads what)

- `useToast` — toast notifications (already imported at module level)
- `apiRequest, queryClient` — react-query helpers
- `usd` from `@/lib/format` — for currency display
- `Skeleton, Card, Button, Input, Badge, Dialog, Select, Textarea, Label`
- Lucide icons: ~12 (the list is mechanical — copy at extraction time)

No cross-section state. The wizard is fully self-contained; deletion
from the dashboard requires zero changes to other dashboard sections.

---

## What stays in `founder-dashboard.tsx` after extraction

Per the queue doc: "Replace the in-dashboard rendering with an inline link card."

The growth tab gets a single link card pointing at `/founder/growth/campaigns`. The existing ChurnIntelligence + GrowthEngine + ForecastPanel sections stay (they're separate components).

---

## Effort estimate (re-validated)

| Phase | Effort | What ships |
|---|---|---|
| **A (this doc)** | 0.5d (done) | Scope map + risk inventory |
| **B — pure extraction** | 1.0d | Move 693 lines + 6 interfaces + 11 hooks to `client/src/pages/founder/growth/campaigns.tsx`. Replace dashboard with link card. Test all four wizard steps end-to-end. |
| **C — wizard redesign** | 1.5d | Re-skin against the design-system §14 founder-mode density treatment. Optional — pure move (Phase B) is already an improvement. |
| **D — sidebar wiring** | 0.5d | Add /founder/growth/campaigns to layout-sidebar.tsx founder module overflow. |

Total 3-3.5d, in line with the queue doc's 3-5d estimate.

---

## Risk inventory

1. **Polling race conditions.** The bundle-polling query uses dynamic query keys with `bundleId`. When the wizard closes and reopens with a different bundle, the previous query may still be polling. Verify query cleanup on unmount during Phase B.

2. **Deploy redirect.** After deploy success, the wizard navigates to the new campaign detail. If the dashboard previously had access to the campaign list, the new route needs the same access — confirmed: same /api/founder/growth/campaigns endpoint, no scoping change.

3. **adForm credentials.** `accessToken` is stored in component state during edit, posted via `PUT /ad-account`. The new page should not introduce a re-render that exposes the value to a logging hook. **Phase B verification step**: confirm no `console.log(adForm)` paths.

4. **Dialog z-index.** The wizard renders inside a `Dialog` which is portaled. The new page must keep `Dialog` rather than inline-render the wizard, otherwise the wizard's z-stacking against PageShell breaks.

5. **Unused mutation cleanup.** The legacy `POST /api/founder/growth/campaigns` endpoint is referenced in routes-admin.ts but the wizard uses the deploy path instead. **Investigate during Phase B**: is the legacy POST still wired to anything else, or can it be deleted?

---

## Phase B starting prompt (for the next session)

```
Read docs/exhaustive-completion/founder-dashboard-growth-extraction-phase-A.md
for context. Then execute Phase B:

1. Create client/src/pages/founder/growth/campaigns.tsx that contains
   the GrowthSection function body (lines 5167–5859 in
   founder-dashboard.tsx) plus the 6 interfaces (5087–5165) and the
   internal helpers it uses. Wrap in PageShell. Default-export.
2. Add lazy route in App.tsx with FounderProtectedRoute pattern
   matching the existing /founder/* lazy registrations.
3. Replace the entire activeTab === "growth" wrapper around
   <GrowthSection /> in founder-dashboard.tsx with a link card to
   /founder/growth/campaigns. Other growth-tab content
   (ForecastPanel, ChurnIntelligence, GrowthEngine, MRRTrajectory
   link card) stays as-is.
4. Delete GrowthSection function + interfaces from the monolith.
5. Manual test all four wizard steps: setup → generating →
   preview (with copy edit + regen + image swap) → deploy.
6. npm run check; commit with message
   "feat(founder/growth): extract GrowthSection wizard into focused route".
7. Branch: founder-extract-growth-phase-B-YYYY-MM-DD.

Do not redesign. Pure move + minor PageShell wrapping.
```

---

— Phase A done. Phase B blocked on a fresh session per the queue doc's
"DO NOT attempt this in a single session" guidance.
