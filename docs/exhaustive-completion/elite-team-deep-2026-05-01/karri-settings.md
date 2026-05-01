# Karri Voutilainen — Settings Architecture Deep Audit
**AcreOS, 2026-05-01.** Settings IA lens: depth balance, mis-placement, mobile UX, discoverability, undo. Ex-Apple Settings.app, ex-1Password.

---

## 0 · One-line verdict

The "six clusters / 17 tabs" regroup (commit 05bd418) is **organizational lipstick on a kitchen-sink** — the cluster labels are correct but tab depth is wildly uneven (Profile has 4, Notifications has 2, half the tabs host one component while `general` hosts seven), the Profile cluster confuses *user* / *org* / *plan* into one tab, and three of the 17 tabs are not settings at all. **Cut to 7 tabs, split user-vs-org, and stop using Settings as a parking lot for surfaces nobody else wanted to host.**

---

## 1 · Per-section depth map — current vs recommended

The 17 tabs and their current weights (`client/src/pages/settings.tsx:97-110`, content blocks `:948-1726`):

| Cluster | Tab | Components mounted | Sections inside | Depth verdict |
|---|---|---|---|---|
| **Profile** | general (`:948`) | Org card, `<SeatManagement/>`, Usage, `<UsageDashboard/>`, `<PricingGuide/>`, Help & Tips, Plan grid | **7** | **Bloat** — half of these are billing, not "general" |
| Profile | security (`:1706`) | `<TwoFactorAuthSettings/>`, `<PasswordChangeSettings/>` | 2 | OK |
| Profile | privacy (`:1712`) | `<PrivacyDataSettings/>` | 1 | Shallow |
| Profile | referral (`:1716`) | `<ReferralSettings/>` | 1 | **Wrong tab — wrong surface entirely** (see §3) |
| **Workspace** | appearance (`:1616`) | `<AppearancePanel/>`, `<PreferencesCard/>`, `<PersonaPanel/>` | 3 | OK — three things that genuinely shape "how it feels" |
| Workspace | autonomy (`:1638`, flagged) | `<AutonomyPanel/>` | 1 | Founder-only — fine flagged |
| Workspace | goals (`:1701`) | `<GoalsSettings/>` | 1 | **Not a setting** — see §3 |
| **Notifications** | notifications (`:1564`) | `<NotificationQuietHours/>`, `<NotificationPreferences/>` | 2 | OK |
| Notifications | communications (`:1512`) | Email, Mail, Phone, IntegrationsSettings, EmailDomains | **5** | **Bloat** — this is its own product surface |
| **Team & Billing** | team (`:1388`) | `<TeamInviteCard/>`, members table | 2 | OK |
| Team & Billing | payments (`:1508`) | `<StripeConnectSettings/>` only | 1 | Shallow + **misnamed** — this is "Stripe Connect," not "Payments" (your subscription billing lives in `general`!) |
| **Data** | data (`:1578`) | CustomFields, ImportExport, Compliance | 3 | OK |
| Data | integrations (`:1601`) | `<ByokSettings/>` only | 1 | Shallow + **misleading** — communications integrations live in `communications` tab; this is BYOK only |
| Data | automations (`:1720`) | `<WorkflowsSettingsTab/>` | 1 | **Not a setting** — see §3 |
| Data | developer (`:1643`) | Demo seed/clear, `<ApiKeyManager/>`, `<ActivityLogPanel/>` | 3 | **Three unrelated things** wearing one hat |
| **AI** | ai (`:1569`) | `<AICostDashboard/>`, `<AISettings/>`, `<ProviderSettings/>` | 3 | OK |
| AI | ai-tasks (`:1724`) | `<PaxTasksSettingsTab/>` | 1 | **Not a setting** (Pax automations) — see §3 |

**Depth distribution:** 1 tab has 7 sections (`general`), 1 has 5 (`communications`), 4 have 3 sections, 5 have 2 sections, **7 tabs have only 1 section each**. **41% of tabs are single-component shells.** A tab that hosts one panel is a panel pretending to be navigation.

### Recommended depth (7 tabs)

| New tab | Hosts | From |
|---|---|---|
| **Account** (you) | profile basics, password, 2FA, privacy, sessions | `general` (user-side only) + `security` + `privacy` |
| **Workspace** (org) | org name, brand/white-label, persona, locale, density | `appearance` + `general` (org-side) + `<PersonaPanel/>` + `<PreferencesCard/>` |
| **Team** | members, roles, invites, seats | `team` + seat-management card from `general` |
| **Billing** | subscription, plan, usage, credits, Stripe Connect, referrals (collapsed), trial | `payments` + most of `general` + `referral` collapsed in |
| **Notifications** | quiet hours, prefs, channels (email/SMS sender identities, mail return) | `notifications` + comms-channel-config from `communications` |
| **Integrations** | BYOK keys, third-party connectors, webhooks, API keys | `integrations` + integrations from `communications` + ApiKeyManager from `developer` |
| **Data & compliance** | custom fields, import/export, compliance, audit log, data retention | `data` + ActivityLog from `developer` |

**That's 7. Goals + Automations + AI Tasks leave Settings entirely (§3). AI provider config folds into Integrations. Developer demo-data toggles move behind a founder flag.** Each tab now has 2–4 sub-sections with H2 anchors — sub-sections, not sub-tabs.

---

## 2 · Settings that should leave (and where)

The cardinal rule of Settings: **a one-time choice you make at signup and never revisit is clutter; a frequent action is mis-placed.** AcreOS violates both directions.

### 2a · One-time-and-done (choice should live in onboarding, not Settings)

| Currently in Settings | Where it should live | Why |
|---|---|---|
| `<PersonaPanel/>` ( `:1633`) | **Onboarding step 2.** Then surface only as "Change persona" link inside Workspace > Profile. | Persona drives vocabulary/onboarding path (`project_persona_architecture.md`). Users pick once. Today it's a peer of "Appearance" — false equivalence. |
| Goals tab (`:1701`) | **Onboarding** + a **`/goals` operational surface** (already exists per holm-ia.md). | "Sell 12 parcels this year" is operational, weekly-touched, not configuration. Holm correctly flagged this — Settings is the wrong home. |
| Help & Tips toggle + "Restart Tour" (`:1196-1279`) | **Help menu** (top-right `?` icon) + a one-liner inside `Account`. | "Restart tour" is something you do once when you're stuck. It does not deserve a dedicated card on the General tab, surrounded by org details. |
| Trial-available banner (`:1037`) | **Top-of-app banner** for the 7-day window. Settings is where the "decline trial" link should be hidden, not where the offer lives. | Promotional. Time-sensitive. Settings is where rare things hide. |
| `<PricingGuide/>` (`:1193`) | **`/help/pricing`** or marketing site. | This is reference documentation. It is not configuring your account. Currently it makes the General tab scroll forever. |

### 2b · Frequent action (operational, not configuration)

| Currently in Settings | Where it should live | Why |
|---|---|---|
| `automations` tab (`<WorkflowsSettingsTab/>`, `:1720`) | **`/automations` or inside `/pax`.** | Workflows are a product surface. Users edit them weekly. They have their own list, detail, run-history. Burying them in Settings is the same mistake Salesforce made with Process Builder for 8 years. |
| `ai-tasks` tab (`<PaxTasksSettingsTab/>`, `:1724`) | **Inside `/pax`** (per holm-ia.md §7 — Pax should not be a destination at all, but if Pax tasks exist, they live with Pax). | Holm is right: AI Tasks is automation, not configuration. |
| `referral` tab (`:1716`) | **`/refer` route + nav link.** | This is a promotional surface, not a setting. Putting "earn credits" inside Settings, then naming the tab "Refer & earn," tells users referrals are admin chores. They are revenue. |
| `<UsageDashboard/>` + `<AICostDashboard/>` (`:1183`, `:1570`) | Keep the *summary* in Billing, but link out to a **`/usage` operational page** for daily tracking. | Power users open this multiple times a week. Three clicks (Settings → General → scroll) is too far. |
| Demo seed/clear data buttons (`:1655-1690`) | **Founder mode only.** Hide entirely from real customer accounts. | This is a developer affordance leaking into production settings. Real Land Investors should not see "Add Demo Data" as a button next to their actual data. |

### 2c · Tabs that should not exist as tabs (stub/single-component)

`payments`, `integrations`, `goals`, `automations`, `ai-tasks`, `privacy`, `referral` — **seven tabs each host exactly one component**. These are not navigation; they are routes pretending to be navigation. Fold each into a parent tab as a sub-section.

---

## 3 · Things that should arrive in Settings (currently elsewhere)

Holm's IA audit (`elite-team-2026-05-01/holm-ia.md` §5) listed these — I concur and add the settings-hygiene cases:

| Currently elsewhere | Move to Settings | Why |
|---|---|---|
| `/tools` (calculators) | **Workspace > Tools toggle** OR delete from Settings entirely (Holm prefers `/finance/tools`). Either way, *not* a top-level. | "Show advanced calculators in toolbar" is a setting. The calculators themselves are a surface. |
| `/data-export` route | **Data & compliance > Export.** | One-click duplication of `<ImportExportManager/>` already in `data` tab. |
| `/usage` route | **Billing > Usage.** Already partially mounted in `general`. | Don't have two places to check usage. |
| `/webhooks` | **Integrations > Webhooks.** | Webhooks are integrations. |
| `/audit-log` | **Account > Activity** (your audit log) + **Data & compliance > Audit** (org-wide). | One audit log per audience. |
| `/dodd-frank`, `/state-documents`, `/compliance` | **Data & compliance.** | These configure legal posture, they're not surfaces. |
| White-label / brand name (`useBrandName`, no current settings tab) | **Workspace > Brand.** | This setting exists in code with no UI to set it. |
| ⌘K keyboard shortcuts list | **Account > Shortcuts.** | Users want to customize and review shortcuts. Nowhere to do it today. |
| Theme quick-picker dialog (`ThemeSettings`, comment at `:50-51` says "intended for top-bar mount") | **Top-bar AND Workspace > Appearance** — but the top-bar version must deep-link to settings. | Currently the comment says the dialog is "intended for top-bar mount in Phase E" — meanwhile the full panel is inside Settings. Both need to exist; the quick-picker for fast-toggle, the full panel for accessibility/density. |
| Founder-only autonomy matrix (`autonomyFlag`, `:620`) | Stay in Settings, but **gate behind `isFounder` not feature flag**. | Persona architecture says founder vs customer is permanent, not a flag. |
| Notification preferences scattered across email/SMS/push provider configs | **Notifications > Channels.** | Today you set "do I get notified about X" in one tab and "what's the SMS sender ID" in another. They're the same conversation. |

---

## 4 · Mobile UX critique — the SelectGroup pattern

Code: `:812-855`. The `<Select>` with six `<SelectGroup>`s and group `<SelectLabel>`s is clever — it's the *correct* Radix idiom — and **it is still a band-aid.**

### What works
- Group labels (`:819, :826, :832, :837, :842, :848`) are scannable. Without them, 17 items in a flat dropdown would be unusable.
- Native sheet on iOS Safari + tap targets = >44pt by default with shadcn defaults.
- Hidden `md:hidden` desktop / `md:block` tabs split is correct for the two viewport classes.

### What doesn't work — five things
1. **No active-section breadcrumb after selection.** Once the sheet closes, the user sees the tab content but the trigger button only shows the *current value* (e.g. "Communications") with no parent ("Notifications cluster"). On a 320-line scroll inside `communications`, you forget which tab you're on. **Fix:** show "Notifications · Communications" in the trigger.
2. **The mobile picker has six clusters; the desktop tabs do not actually have visible cluster labels** — they use `mr-3` spacers (`:880, :896, :906, :916, :934`). So mobile users see six groups, desktop users see one undifferentiated row of 17 chips and have to *infer* clusters from spacing. **The two viewports teach different mental models of the same product.** Pick one.
3. **Search would beat both.** With 17 items, even with grouping, the user is hunting. A 1-line input above the SelectContent that filters items would cut find-time in half. Apple does this in macOS System Settings.
4. **The dropdown closes on every change** — no preview, no commit/cancel. If you mis-tap and land on `developer`, you've now triggered a tab-content render (sometimes a query) and have to navigate back. Wrap the navigation in a peek pattern (longer tap = preview, release = commit) or accept that this is a list, not a setting toggle.
5. **No deep-link awareness on mobile.** `getTabFromHash()` reads `#general` etc. but the mobile picker doesn't expose hash anchors for sub-sections. So `/settings#general-billing` (which would land on the billing block within General) cannot be addressed. This will bite you when support says "go to Settings and scroll to Seats" — there's no shareable link.

### Verdict
The SelectGroup pattern is the *best* mobile UX possible *given 17 tabs*. It is also evidence that you have too many tabs. Cut to 7 (per §1) and you can return to a single horizontal scrolling tab strip on mobile (every modern iOS app does this, including Settings.app). The current Select-as-nav pattern is what you build when you've given up on the desktop tabs scaling down.

**Apple's rule of thumb:** if the mobile pattern requires a structural element the desktop doesn't have, you have a desktop information-architecture problem, not a mobile UI problem.

---

## 5 · The "find this preference in 30 seconds" test

I imagined ten common Land Investor preference changes and counted clicks from `/today`:

| # | "I want to..." | Current path (clicks) | Suggested path | Clicks saved |
|---|---|---|---|---|
| 1 | Change my password | Settings → Security → Password card | 3 | Account > Password (3) | 0 |
| 2 | Add a teammate | Settings → Team → Invite | 3 | same (3) | 0 |
| 3 | Upgrade plan | Settings → General → scroll past 4 cards → Plan grid | 3 + scroll | Billing > Plan (2) | scroll eliminated |
| 4 | Connect Stripe | Settings → Payments | 3 | Billing > Stripe (3) | 0, but rename "Payments" → "Stripe Connect" so the label matches |
| 5 | Change theme | top-bar quick-picker (1) **OR** Settings → Appearance (3) | 1 | same | 0 — but consolidate the two surfaces |
| 6 | Mute notifications during a closing | Settings → Notifications → Quiet hours | 3 | same | 0 |
| 7 | Export all my data | Settings → Data → Import/Export → "Export" | 4 | Data & compliance > Export (3) | 1 |
| 8 | Change return mailing address for direct mail | Settings → Communications → Mail Settings | 4 | Notifications > Channels > Mail (4) — **or better: kept on Campaigns surface where you'd actually be when you noticed it** | 0 in nav, ~5 in real-life context |
| 9 | Bring my own OpenAI key | Settings → Integrations → BYOK | 4 | Integrations > AI keys (4) | 0 — but tab name "Integrations" today only contains BYOK, deeply confusing |
| 10 | Stop seeing the onboarding tips | Settings → General → scroll past Org / Seats / Usage / Credits / Pricing → "Show Tips" toggle | 3 + heavy scroll | Account > Help (3) | major scroll eliminated |

**Headline:** *most of the 30s test passes click-count-wise but fails scroll-wise* on the General tab. The Profile/General tab is **the worst** — it's six unrelated cards stacked vertically. Cutting `general` into Account / Workspace / Billing solves 3, 5, and 10 in one stroke.

**The truly missing prefs (failed the test entirely — there is no path):**
- "Set my time zone" — there's no UI for this. Users can't.
- "Make ⌘K open with this default scope" — no surface.
- "White-label my org name in customer portals" — `useBrandName` exists, no settings UI exists.
- "Reset all my settings to defaults" — see §6.

---

## 6 · Reset / undo — the missing 8th principle

Apple Settings.app has had **"Reset"** at the bottom of every General settings panel since iOS 1.0 (2007). 1Password has "Restore Defaults" on every preferences pane. AcreOS has **zero reset affordance anywhere in `/settings`**.

### What's missing
1. **No "reset preferences" button** anywhere. If a user customizes density, theme, persona, notification prefs, etc. and wants to go back to default, they must remember what default was and reverse each toggle by hand. This is a 30-minute chore.
2. **No undo for destructive settings actions.** "Disconnect Stripe" has a confirm dialog (`:412` good); "Clear All Data" (`:1737`) has a confirm; but disabling notifications, changing persona, switching theme — all silent, all permanent until manually reversed.
3. **No settings-level audit.** "When did I change my notification quiet hours?" There's an `<ActivityLogPanel/>` (`:1697`) but it's buried in the developer tab and tracks API/data activity, not settings changes.
4. **No "what changed since last week"** — Apple's iOS 17 added a "Recently changed" list at the top of Settings. Should exist.

### Recommended affordances

```
Account > Reset
  [ Reset preferences to defaults ] — clears density, theme, language, etc. Org settings untouched.
  [ Reset workspace appearance ]    — admin-only, resets brand, persona, locale.
  [ View settings change log ]      — last 30 days of who changed what setting.
```

Add a **single-line undo toast** for every settings change. If I flip `showTips` off (`:1212`), I should see "Tips disabled. **Undo**" for 8s. Today I get a confirmation toast (`:1223`) with no undo action. This is the cheapest UX fix in the audit.

---

## 7 · Recommended Settings refactor — 7 steps over 1 week

**Constraint:** ship behind `feature.settings-v2` flag for a week, then remove old surface. Keep all `#hash` deep links resolving via redirect map.

### Day 1 — Tab cut (1 day, P0)
Reduce `VALID_TABS` (`:97-110`) from 17 to 7: `account, workspace, team, billing, notifications, integrations, data`. Add hash-redirect map: `#general → #billing`, `#security → #account`, `#privacy → #account#privacy`, `#referral → #billing#referrals`, `#payments → #billing#stripe`, `#communications → #notifications#channels`, `#automations → /automations` (route, not hash), `#ai-tasks → /pax`, `#goals → /goals`, `#developer → #integrations` (founder-only sub-section).

### Day 2 — Split user vs org (1 day, P0)
Today the General tab fuses **user identity** + **org membership** + **org subscription** + **org usage**. These have **three different audiences** (user, admin, billing-owner) and three different permission profiles. Split:
- `Account` (user-scope, every member sees their own)
- `Workspace` (org-scope, only owner/admin can edit)
- `Billing` (org-scope, only billing-owner can edit; others see read-only summary)

This requires `useUserPermissions()` (already exists, `:665`) gating sub-sections, not whole tabs.

### Day 3 — Remove non-settings (1 day, P0)
Delete tabs: `automations`, `ai-tasks`, `goals`, `referral`. Move their contents to:
- `automations` → `/automations` route (Holm IA refactor coordinates this).
- `ai-tasks` → `/pax/tasks` (or fold into Pax rail).
- `goals` → `/goals` operational surface + onboarding.
- `referral` → `/refer` + small sub-section in `Billing` for "view your earnings."

Add 4 redirects. Update sidebar.

### Day 4 — Mobile picker simplification (0.5 day, P1)
With 7 tabs, replace the SelectGroup mobile pattern (`:812-855`) with a **single horizontal scrolling tab strip** matching desktop. Add inline search input *only* if any user research suggests it's needed for the 7-tab world (likely not). Update breadcrumb in `PageShell` to show "Settings · Account" so the active tab is always visible during scroll.

### Day 5 — Reset/undo affordances (1 day, P1)
- Add `Reset to defaults` card at bottom of `Account` and `Workspace` (matches Apple/1Password pattern).
- Wrap every toggle in a settings-undo toast helper (`useSettingsToggle()`) that emits `{title, description, action: <UndoButton/>}`.
- Add `settings_change_log` table (or reuse activity log with `kind=settings`) and a "Recent changes" sub-section under `Account`.

### Day 6 — Discoverability fixes (1 day, P1)
- Add `?` icon next to every Settings sub-section header that opens contextual help.
- Ensure every settings deep-link works: `/settings#account-password`, `/settings#billing-stripe`, etc. (sub-section anchors). Required because support docs / Pax suggestions / shared URLs *will* link to specific sub-sections.
- Add "Time zone" UI (currently missing entirely; users can't set it).
- Add "Default ⌘K scope" preference under `Account > Shortcuts`.
- Surface white-label/brand under `Workspace > Brand` (UI for `useBrandName`).

### Day 7 — Audit + cleanup (0.5 day, P2)
- Move demo-seed/clear out of customer-visible Settings (founder flag).
- Move `<ApiKeyManager/>` from `developer` → `Integrations > API keys`.
- Move `<ActivityLogPanel/>` from `developer` → `Account > Activity` (per-user) + `Data & compliance > Audit log` (org-wide, owner-only).
- Run a copy-pass: rename `Payments` tab to `Stripe Connect`, rename `Integrations` tab to `Connections` so it doesn't fight `Communications integrations` for the noun.

### Net result after 1 week
- **17 tabs → 7 tabs.**
- **Three tabs that aren't settings exit Settings.** (`automations`, `ai-tasks`, `goals` become real routes.)
- **The General-tab kitchen-sink splits along audience** (user / workspace admin / billing owner).
- **Mobile picker matches desktop tab structure** — no two-mental-models problem.
- **Every preference has reset + undo** — Apple parity.
- **Settings change log + sub-section anchors** — discoverability and shareable URLs.
- **The number of nouns a Land Investor must scan to find a preference: 17 → 7.**

---

## 8 · The one Settings mistake AcreOS would deeply regret in 6 months

**Settings is silently becoming the catch-all destination for "we built this and didn't know where to put it."**

The pattern is already visible: `automations` (a product surface) lives in Settings; `goals` (operational) lives in Settings; `referral` (promotional) lives in Settings; `developer` (a founder tool) lives in Settings; `ai-tasks` (Pax internals) lives in Settings. **Five of 17 tabs are not configuration.** Each was added because Settings was the path of least resistance — it has tabs, tabs are cheap, ship it.

In six months, if this pattern continues, you will have:
- A Settings page with 25+ tabs that nobody can scan.
- Three different surfaces that overlap (`/automations` vs Settings > Automations vs Pax > Automation tab).
- Customers asking *"where do I configure X?"* with no canonical answer — because half the time the answer is "Settings," half the time the answer is "the surface you're on."
- A "Settings v3" rebuild forced because the mobile picker is unscannable.

**The fix while the cost is still cheap (now):** establish a **Settings admission policy**. Three rules, enforced in PR review:

1. **A settings tab must configure something.** If it's a list of things you act on (workflows, tasks, goals), it's a surface, not a setting.
2. **A settings sub-section must outlive the user's first session.** If you set it once during onboarding and never return, it goes in onboarding.
3. **A settings tab must have at least three distinct configurable things.** If it has one component, it's a sub-section, not a tab.

Three rules. They would have prevented every mistake in §1 and §3.

The deeper principle: **Settings is the user's trust audit of the product.** If it's tidy, the user trusts the rest of the app. If it's a junk drawer, the user assumes the rest is too. Right now AcreOS Settings is on the junk-drawer side of that line. The fix is one week of work.

---

*— Karri Voutilainen*
