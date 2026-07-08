# 1.1.B Auth Surface Inventory

29 AUTH-REQUIRED surfaces from MASTER-GAP-REPORT.md. First-pass capture
depth: 1440 (desktop) + 375 (mobile), default state — matches Gap 1.0
Phase A prototype reference depth.

Bypass mode: cookie (single ?dev_bypass=$SECRET prime, then automatic).

| Slug | URL | Tier | Prototype 1440 | Prototype 375 | Notes |
|------|-----|------|----------------|---------------|-------|
| home | /today | 1 | yes | yes | Tier 1 daily-driver |
| pipeline | /pipeline | 1 | yes | yes | |
| parcels | /parcels/81 | 1 | yes | yes | sample lead id 81 |
| inbox | /inbox | 1 | yes | yes | thread API errors — capture index only |
| contacts | /contacts | 1 | yes | yes | |
| calendar | /calendar | 1 | yes | yes | |
| buybox | /buyboxes | 2 | yes | yes | |
| lists | /lists | 2 | yes | yes | |
| campaigns | /campaigns | 2 | yes | yes | |
| perf | /campaigns/performance | 2 | yes | yes | |
| offers | /offers | 3 | yes | yes | |
| documents | /documents | 3 | yes | yes | |
| finance | /finance | 3 | yes | yes | |
| dispos | /dispositions | 3 | yes | yes | |
| agents | /agents | 4 | yes | yes | |
| automation | /automations | 4 | yes | yes | |
| audit | /audit | 4 | yes | yes | |
| settings | /settings | 4 | yes | yes | |
| team | /team | 4 | yes | yes | |
| billing | /billing | 4 | yes | yes | |
| integrations | /integrations | 4 | yes | yes | |
| pax | /ai | 4 | yes | yes | |
| founder | /founder | 5 | yes | yes | founder gate |
| atlas-run | /founder/atlas-run | 5 | yes | yes | founder gate |
| founder-rev | /founder/revenue | 5 | yes | yes | founder gate |
| founder-tenants | /founder/tenants | 5 | yes | yes | founder gate |
| founder-cost | /founder/cost | 5 | yes | yes | founder gate |
| founder-ops | /founder/ops | 5 | yes | yes | founder gate |
| onboarding | /onboarding | (skipped) | no | no | no prototype reference |

Total to capture: 28 surfaces × 2 breakpoints = 56 screenshots.

## Naming convention

`docs/exhaustive-completion/auth-screenshots/<slug>-<breakpoint>.png`

e.g. `home-1440.png`, `pipeline-375.png`.

## Capture process

1. Resize browser to 1440×900
2. Navigate `https://acreos.io/today?dev_bypass=$SECRET` (mints cookie)
3. For each surface:
   - Navigate `https://acreos.io<path>`
   - Wait for network idle / hero element
   - browser_take_screenshot (fullPage: true)
4. Resize browser to 375×812
5. Repeat captures
