# Fieldstone redesign — real-app evidence (2026-10-18)

These are screenshots of the **real AcreOS application**, not mockups or an
isolated showcase:

- the production build (`npm run build && npm run start`) of branch
  `claude/fieldstone-redesign-q48nuj`, driven by Playwright/Chromium;
- signed in through the repository's E2E test auth (`E2E_TEST_AUTH=1`,
  `__session=e2e`) against a local Postgres seeded by
  `tests/e2e-mobile/global-setup.ts`;
- each colorway + mode was set **through the real preferences API**
  (`PATCH /api/me/preferences`), and each capture's `<html data-theme>` and
  `.dark` were checked to match it.

**The names, leads, deals and counts on screen ("E2E", "15 decisions",
"$32,000 pipeline", "Priya Vanterpool") are controlled E2E fixture data in a
non-production database** — not customer data, and not the illustrative
figures from the design concepts.

Environment limits visible in the captures: no Stripe keys (Settings shows the
honest "Plan catalog is unavailable" 503 and its toast), no map key (Map shows
its empty state, not imagery). The logged-out landing and sign-in pages could
not be rendered here (no real Clerk; test auth has no logged-out identity), so
the public mark is shown on `/pricing` instead.

| File | What |
|---|---|
| `desktop-{fieldstone,bedrock,meridian}-{light,dark}_today.jpg` | Today, all six colorway × mode combinations, 1440px |
| `iphone-*_today.jpg` | Today at 390px (iPhone) |
| `desktop-fieldstone-light_settings_appearance-panel.jpg` | Settings → Appearance (Colorway + Display) |
| `iphone-fieldstone-light_today_button-quick-appearance.jpg` | The quick appearance dialog — same controls |
| `iphone-fieldstone-light_settings_accessibility-comfort-toggle.jpg` | Accessibility & comfort, expanded |
| `iphone-fieldstone-light_maps.jpg`, `_finance.jpg` | Map toolbar + Finance header order on a phone |
| `desktop-fieldstone-dark_deals.jpg`, `_pricing.jpg` | Deals (tabular Inter figures); public page with the mark |
| `se-meridian-light_*.jpg` | 320px spot checks |
| `tablet-bedrock-dark_today.jpg` | 820px spot check |

Full set (36 captures, all with zero horizontal overflow): regenerate with the
harness described in the PR.
