# Calla Whitfield — Cross-Surface Consistency Audit
**AcreOS, 2026-05-01.** Notion design-systems lens: granular consistency. Iconography, verbs, dates, numbers, status, spacing, typography. Holm fixed the IA. Vesna found the polish. My job is the joints between them — the hundred small places where the same word does two things.

## 1 · One-line verdict

The primitives exist (`@/lib/format`, `StatusDot`, `PageHeader`, `EmptyState`, `acr-*` semantic tokens) — adoption is below 25% across the surfaces that need them, so AcreOS reads as eight slightly different products glued together.

---

## 2 · Icon inventory + collision report

**Method.** I tallied every `lucide-react` import across `client/src/pages/*.tsx` and `client/src/components/**/*.tsx`. Both directions of collision happen here: same icon used for two concepts, and same concept rendered with three icons.

### 2a · Same concept → multiple icons (the user has to re-learn)

| Concept | Icons in use | Counts (imports) | Canonical |
|---|---|---|---|
| **Create new** | `Plus`, `PlusCircle`, `PlusSquare`, `FolderPlus`, `UserPlus` | Plus 35; rest sprinkled | **`Plus`** for noun-creation, `UserPlus` only when adding a *person* (it's recognized by the user as that). Kill `PlusCircle` and `PlusSquare`. |
| **Edit** | `Edit`, `Edit2`, `Pencil`, `SquarePen` | Edit ~8 files; Edit2 ~3; Pencil ~2 | **`Pencil`** (Notion + Linear standard). `Edit` reads as a verb, not an icon shape. Codemod the rest. |
| **Delete / destroy** | `Trash2`, `XCircle`, `X`, `Trash` | Trash2 60; XCircle 48; X 30 | **`Trash2`** for permanent destruction; **`X`** for *dismiss/close* only (modals, chips, tags). `XCircle` is currently doing both — collision. See 2b. |
| **Refresh / reload** | `RefreshCw`, `RotateCcw`, `RotateCw`, `Repeat` | RefreshCw 115; RotateCcw 12 | **`RefreshCw`** for "fetch latest data"; **`RotateCcw`** for *undo* only. Currently RotateCcw is used for both. |
| **AI / Pax** | `Sparkles`, `Bot`, `Brain`, `Wand2` | Sparkles 28; Bot 10; Brain ~5 | **`Sparkles`** = Pax/AI (per Vesna §P2-15). **`Bot`** for autonomous-agent pages only. **`Brain`** is decoration — kill it everywhere customer-facing. |
| **Person row** | `User`, `Users`, `UserRound`, `Contact`, `ContactRound`, `UserCircle2` | Users 114; User 41; Contact 16 | **`User`** = singular person; **`Users`** = group/team; **`Contact`** = a lead/seller (i.e. a *relationship*, not a workspace member). Today `Users` and `Contact` both appear next to "Leads," which is wrong. |
| **Calendar / date** | `Calendar`, `CalendarDays`, `CalendarClock`, `CalendarCheck` | Calendar 37; CalendarDays 5 | **`Calendar`** everywhere. The variants add zero meaning at 16px. |
| **Money / currency** | `DollarSign`, `Banknote`, `Wallet`, `Coins`, `CreditCard` | DollarSign 147; Banknote 10; Wallet 7; Coins 3 | **`DollarSign`** = an amount; **`CreditCard`** = payment/billing; **`Wallet`** = account/funds. Banknote and Coins should be deleted from the codebase — they only appear as decoration. |
| **Settings / config** | `Settings`, `Settings2`, `Wrench` | Settings 52; Settings2 4; Wrench 12 | **`Settings`** = page/route; **`Wrench`** = tools/calculators. `Settings2` is ambiguous — kill. |
| **Overflow menu** | `MoreHorizontal`, `MoreVertical`, `Ellipsis` | 9 / 6 / 7 | **`MoreHorizontal`** in cards/rows; **`MoreVertical`** in tight toolbars. `Ellipsis` is the same glyph differently named — codemod to MoreHorizontal. |
| **Send** | `Send`, `SendHorizontal`, `Mail`, `MessageSquare` | Send 88; MessageSquare 67; Mail 61 | **`Send`** for the *action* of sending; **`Mail`** for *email as a noun*; **`MessageSquare`** for SMS/chat threads. Currently `Send` shows on save buttons and submit buttons that aren't sending anything — see verb section. |
| **Filter** | `Filter`, `SlidersHorizontal`, `ListFilter` | Filter 60; SlidersHorizontal 6 | **`Filter`** for the filter-pill bar; **`SlidersHorizontal`** for *settings/density* only (it's in `picker-verification` screenshots as density toggle — keep that meaning). |
| **Trend up** | `TrendingUp`, `ArrowUp`, `ArrowUpRight`, `ChevronUp` | TrendingUp 176; ChevronUp 22; ArrowUpRight 12; ArrowUp 6 | **`TrendingUp`** = metric over time (deltas, sparklines); **`ArrowUpRight`** = an outbound link or "go to detail"; **`ChevronUp`** = collapse a section. They are *not* interchangeable but are currently substituted for each other in metric tiles. |

### 2b · Same icon → multiple concepts (the user can't predict what it does)

| Icon | Concepts it currently signals | Risk |
|---|---|---|
| **`X`** (32 buttons) | Close modal · dismiss chip · delete row · cancel filter · clear search | A user clears a search and deletes a lead with the same gesture. P0 cognitive collision. |
| **`XCircle`** (48 imports) | Failed status · destructive-confirmation · "no" verdict on a check · close button | Destruction overlap with status. The same red `XCircle` means "you failed" *and* "click to delete." |
| **`CheckCircle`** vs **`CheckCircle2`** (both used, 27 + 38) | The same "success" concept rendered two ways. `command-center.tsx` and `onboarding-v2.tsx` import *both* in the same file. | Pure dead weight. Codemod CheckCircle → CheckCircle2 (the filled glyph; reads as success-state at 14px). |
| **`Sparkles`** | AI/Pax · "highlight metric" · onboarding celebration · empty-state decoration | Vesna already flagged. The "highlight metric" use should become `Star` or a dot. |
| **`Eye`** | View detail (drilldown) · password-show · "watching/observed" status · public visibility | Four meanings. The "watching" use should be `Bookmark` or a status dot; "public" should be `Globe`. |
| **`Settings`** (52) | Configure feature · navigate to /settings · "advanced options" disclosure | Use `ChevronDown` for disclosure; reserve `Settings` for nav + true config dialogs only. |
| **`Loader2`** (64) | Skeleton-equivalent inline loader · button busy state · entire-page Suspense fallback | Vesna §P1-4 already noted; same icon shouldn't be the loader for a 30ms button click and a 2s page load. |

**Recommendation:** Add a `client/src/lib/icons.ts` *icon vocabulary* — a single export point that re-exports lucide icons under intention names. `import { CreateIcon, EditIcon, DeleteIcon, AIIcon } from "@/lib/icons"`. Lint rule: customer-facing TSX may not import directly from `lucide-react` (excepting the icon vocabulary file).

---

## 3 · Verb collision report

**Method.** Counted every `>Word<` and `"Word noun"` button label in pages + components. The full action-verb matrix:

| Verb | Times found | Currently used for | Should mean |
|---|---|---|---|
| **Save** (12 phrasings: "Save changes", "Save Changes", "Save Notes", "Save settings", "Save schedule", "Save credentials", "Save expenses", "Save branding", "Save analysis", "Save Workspace", "Save configuration", "Save failed") | ~14 | Persisting a form; bookmark a search; commit a draft | **Persist edits to an existing record.** The button label should always be `Save changes` — sentence case, plural "changes." Never bare "Save." Never "Save Settings" (Title Case). |
| **Update** (8 phrasings: "Update template", "Update sequence", "Update rule", "Update info", "Update county", "Update Workflow", "Update Stages", "Update Record") | ~10 | Same thing as Save | **Reserve for status mutation** (e.g., "Update status to Sent"). Otherwise codemod to "Save changes." Right now Save and Update are interchangeable across forms — the user has to read the verb instead of recognizing the button. |
| **Apply** | rare (mostly filters) | Filter chips · workflow rules | **Filter / preset application only.** "Apply filters" is right. Never use Apply for Save. |
| **Submit** ("Submit feedback", "Submit Rating") | 2 | Send a form for review | **Use only when the form goes to a queue** (feedback, rating, intake). Never for normal CRUD save. |
| **Confirm** ("Confirm deletion", "Confirm cancellation") | 4 | Modal destructive confirmations | **Reserve for destructive/irreversible.** Never "Confirm save." |
| **Done** | 2 | Closing a wizard/sheet | **Wizard finalization only.** Not the same as Save. |
| **OK** | 1 | One stray dialog | **Kill.** OK is a Windows artifact — use a verb that names the action. |
| **Cancel** | 32 | Modal dismiss | **Universal modal dismiss.** Keep. Never "Discard" — it has a different meaning. |
| **Discard** | rare | Throw away unsaved edits | **Use when there are unsaved edits being lost.** Distinct from Cancel. Not currently used where it should be (e.g., closing an edit drawer with dirty fields). |
| **Add** vs **Create** vs **New** | "Add Property" 2; "Add domain" 2; "Add county" 2 / "Create template" 5; "Create Workflow" 2 / "New Lead" 2; "New Property" 2; "New Deal" 2; "New value" 1 | All three mean "make a new noun" | **Pick by context:** `New X` for top-of-page primary CTAs (matches sidebar). `Add X` for inline insertion into a list (Add domain, Add county). `Create X` only inside flows that *generate* a thing from inputs (Create template from this lead). Right now the top-of-page CTA on `/leads` says "New Lead," on `/properties` says "Add Property," on `/campaigns` says "Create campaign" — three patterns, three pages. |
| **Edit** vs **Update** | mostly Edit | Open an edit drawer | **Edit** = open editable view; **Update** = the save button inside it. Currently both buttons say "Edit." |
| **Delete** vs **Remove** | "Delete Property" / "Remove tag" / "Remove listing" / "Remove variant" | Both mean unmake | **Delete** = permanent destruction (data lost). **Remove** = unlink/detach (data retained, relation severed). "Remove tag" is right (tag still exists). "Remove listing" is wrong if the listing is destroyed — should be "Delete listing." |

**Canonical verb table — the one-page rule:**

| Concept | Verb | Example |
|---|---|---|
| Persist form edits | **Save changes** | bottom-right of any drawer/sheet |
| Mutate a status | **Update status** | dropdown actions on rows |
| Filter a list | **Apply filters** | filter pill bar |
| Send a form to be reviewed | **Submit** | feedback, rating, beta intake |
| Confirm destructive | **Delete** / **Discard** | modal primary action, never "Confirm" |
| Close a non-destructive modal | **Cancel** | every modal secondary |
| Finish a wizard | **Done** | only the last step |
| Make a new top-level entity | **New X** | page header CTA |
| Insert into a list | **Add X** | row insertion |
| Generate from inputs | **Create X from Y** | flows that derive |
| Permanently destroy | **Delete** | with reassurance toast |
| Detach a relation | **Remove** | tag, member, link |

Codemod target: ~120 button labels. Estimated 1 day with grep + glance.

---

## 4 · Date / number / currency formatting audit

There is a canonical formatter at `client/src/lib/format.ts` — it's the most under-loved file in the repo. **Adoption: 126 files import it; 287 calls to `usd()`. Versus 199 ad-hoc `toLocaleString()`, 110 ad-hoc `toLocaleDateString()`, 158 calls to a parallel `formatCurrency` somewhere outside `lib/format.ts`.** Two parallel systems. Pick one and codemod.

### 4a · Date formatting — proposed three-tier rule

The codebase currently runs **at least 8 different date formats** for the same concept ("when did this happen?"):

- `toLocaleDateString()` (81× — locale-default, looks like `5/1/2026`)
- `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` (`May 1`)
- `toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })` (`May 1, 2026`)
- `format(d, "MMM d, yyyy")` (`May 1, 2026`)
- `format(d, "EEEE, MMMM d")` (`Wednesday, May 1`)
- `format(d, "PPpp")` (`May 1, 2026 at 9:47 PM`)
- `formatDistanceToNow` (`3 days ago`)
- bare `new Date(x).toString()` (in 5+ files)

**Proposed canonical three-tier rule (already half-implemented in `format.ts`):**

| Tier | Use when | Format | Helper |
|---|---|---|---|
| **Relative** | Activity feeds, timestamps within ~7 days, ambient "freshness" | `3d ago`, `2h ago`, `just now` | `relative()` |
| **Short absolute** | Lists, tables, anywhere relative becomes ambiguous (>7 days) | `May 1, 2026` | `shortDate()` |
| **Full datetime** | Audit logs, signed documents, anywhere precision matters | `May 1, 2026 · 9:47 PM` | `shortDateTime()` |

**Rule of thumb:** if the cell is in a table column, it gets `shortDate`. If it's in a feed item, `relative`. If a notary would read it, `shortDateTime`. The `EEEE, MMMM d` (`Wednesday, May 1`) format should *only* appear in the editorial greeting on `/today` — that's its purpose; banish it from data.

### 4b · Number formatting — three rules

| Concept | Format | Where | Currently |
|---|---|---|---|
| Currency, exact | `$1,234.56` | financial detail surfaces, P&L, payment rows | `usd(amount)` (287 calls — good); but 158 calls go through a parallel `formatCurrency` and 12 calls to bare `.toLocaleString(undefined, { minimumFractionDigits: 2 })` exist as well |
| Currency, compact | `$1.2M`, `$45K` | metric tiles, headlines, sparkline labels | `dollarsCompact()` exists in `format.ts` — used in roughly 0 places. Meanwhile inline `${(n / 1_000_000).toFixed(1)}M` patterns exist in ~20 places |
| Counts | `1,234` (always with comma); compact `1.2K` for tiles ≥ 1000 | `count()` in `format.ts` | Used 2× total. Most tiles render `{n}` with no separator — `15234 leads` shipped. |
| Percent | `85%` (no decimal under 100); `85.3%` (one decimal when comparing) | `percent()` | Used 2× total. Inline `${(x*100).toFixed(2)}%` and `${x}%` everywhere else. |
| Acres | `12.5 acres` / `1 acre` | parcel detail, deal feed | `acres()` exists, used 1×. |

**`tabular-nums` enforcement.** `tabular-nums` appears 1,785 times in the codebase but only 49% of files that render currency use it. Every monetary, count, and percent value should be in `tabular-nums` so columns align — currently a parcel list with `$ 1,200,000` and `$ 85,000` jitters between rows because the numbers aren't tabular.

### 4c · Currency formatting — pick one path

Three currency code paths exist:
1. `usd()` from `@/lib/format` — 287 calls — canonical, formats cents-stored values, returns `—` on null
2. `formatCurrency` (location varies by file — see `phone-numbers-settings.tsx`, etc.) — 158 calls — parallel implementation
3. Inline `toLocaleString` with `style: 'currency'` — sprinkled

**Pick `usd()`. Delete `formatCurrency`.** Codemod the inline path. One day of work, eliminates a class of "the total on the dashboard is $0.99 less than the total on the detail page" bug forever.

---

## 5 · Status badge audit

**The findings:** four files define their own `getStatusColor` / `getStatusBadge` function, returning **different visual treatments for the same status word**.

### Same status word → 4 different visual treatments:

| Status | `command-center.tsx` | `founder-ai-observatory.tsx` | `finance.tsx` | (Notion-spec proposal) |
|---|---|---|---|---|
| `active` | `bg-green-500` (solid green dot) | `bg-green-500/10 text-green-700 border-green-500/20` (pale green chip) | `bg-acr-pos-soft text-acr-pos border-transparent` (themed token) | **Themed token everywhere** |
| `pending` | not handled | (default branch) | `bg-acr-warn-soft text-acr-warn border-transparent` | `bg-acr-warn-soft text-acr-warn` |
| `failed` / `rejected` | — | `bg-red-500/10 text-red-700 border-red-500/20` | `bg-acr-neg-soft text-acr-neg border-transparent` | `bg-acr-neg-soft text-acr-neg` |
| `completed` / `approved` | — | `bg-green-500/10 text-green-700 border-green-500/20` | `bg-acr-pos/10 text-acr-pos border-green-500/20` (mixes themed + raw!) | `bg-acr-pos-soft text-acr-pos` |

Three of those rows ship in production. A user navigating from `/finance` (themed `acr-pos`) to `/command-center` (raw `bg-green-500` dot) sees "active" as two visually distinct concepts and has to re-learn.

**Compounding:** the existing `<StatusDot>` primitive (`client/src/components/ui/status-dot.tsx`) defines a clean six-tone system. **Adoption: 5 files.** 178 pages do not use it.

### The fix — one badge, one source of truth

Build `<StatusBadge status="active" />` (it doesn't exist yet — only `StatusDot` does) that:
1. Maps a known set of status words → tone via a single `STATUS_MAP` object.
2. Uses only `acr-*` semantic tokens (no `bg-green-500/10` literals, ever).
3. Auto-capitalizes for display (`status="active"` → "Active").
4. Falls back to `gray` tone for unknown statuses (logged for monitoring).

Once shipped, codemod the four local `getStatusColor` functions and the 34 `<Badge className="bg-green-100 ...">` overrides. Net code reduction: ~400 lines. Net consistency: every `Active` badge across 178 pages renders identically.

---

## 6 · Spacing / typography drift

### 6a · Spacing — *which* numbers are canonical?

Tailwind tokens used across pages:

- `gap-2` (1,324) — dominant
- `gap-3` (519), `gap-4` (327)
- `gap-1` (449)
- `space-y-4` (346), `space-y-2` (331), `space-y-3` (277), `space-y-6` (161), `space-y-1` (229)
- `p-4` (422), `p-3` (221), `p-6` (134), `p-2` (188)

**The pattern.** There are seven spacing scales in use. Notion ships with three. The only honest pattern I can extract from the code is:

- **Item gap inside a row:** `gap-2` (8px) — winner by 3×
- **Section spacing:** mixed `space-y-3`, `space-y-4`, `space-y-6` with no rule
- **Card padding:** mixed `p-3`, `p-4`, `p-6`

**Recommendation.** Codify: `gap-2` for inline, `space-y-4` between blocks within a card, `space-y-6` between cards, `p-4` interior, `p-6` only on hero/empty-state cards. Add a `--acr-space-*` token system to mirror the `--acr-dur-*` system already shipping in CSS.

### 6b · Typography — heading sizes are ad-libbed

`<h1>` patterns found:

| Pattern | Count | Files |
|---|---|---|
| `text-2xl font-bold` | 25 | many |
| `text-2xl font-bold flex items-center gap-2` | 18 | many |
| `text-3xl font-bold flex items-center gap-2` | 9 | larger pages |
| `text-2xl font-semibold flex items-center gap-2` | 7 | newer code |
| `text-2xl font-semibold` | 5 | newer code |
| `acr-cc-greeting` (utility class) | 5 | `today`, `inbox`, `pipeline` |
| `text-3xl font-bold` | 4 | older pages |
| `text-2xl md:text-3xl font-bold` | 4 | responsive attempts |

**Eight different page-title treatments.** Three meaningful clusters: editorial (`acr-cc-greeting`), modern (`text-2xl font-semibold`), legacy (`text-2xl font-bold`).

**Eyebrow patterns** — same problem, micro:
- `text-[10px] text-muted-foreground uppercase tracking-wide` (×6)
- `text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2` (×6)
- `text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2` (×3)
- `text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3` (×3)
- `text-[10px] uppercase tracking-wide text-muted-foreground mb-1` (×3)

The same eyebrow exists in five subtly different sizes.

**Recommendation.** Add four utility classes to `index.css`: `.acr-h1`, `.acr-h2`, `.acr-eyebrow`, `.acr-label`. Make them the *only* legal way to apply page-level type. Replace via codemod. `<PageHeader>` already exists at `components/ui/page-header.tsx` — adoption is 12 of 178 pages (7%). Most pages re-implement the title block by hand.

### 6c · `min-h-screen` vs `min-h-dvh`

Vesna flagged auth-page (3 instances). The full count: **45 instances of `min-h-screen` vs 1 of `min-h-dvh`**. Every one of those 45 wobbles 56px on iOS Safari. Replace-all.

### 6d · Motion drift

`transition-all` appears 105 times. `--acr-dur-normal` and `--acr-ease-spring` tokens exist; `transition-all` uses neither. `duration-200` (33), `duration-150` (21), `duration-300` (7), `duration-500` (5), `duration-700` (5) — five hardcoded durations alongside a defined token scale.

---

## 7 · Top 10 design-system primitives that need stricter enforcement

Each of these exists. Adoption is the problem. Add a lint rule or a codemod for each.

| # | Primitive | Adoption | Action |
|---|---|---|---|
| **1** | **`@/lib/format` — `usd`, `relative`, `shortDate`, `count`, `percent`** | 287 / 87 / 3 / 2 / 2 calls vs hundreds of inline equivalents | Lint: any `toLocaleDateString`, `toLocaleString` on a number, `style: 'currency'`, or `formatDistanceToNow` outside `lib/format.ts` is a CI fail. |
| **2** | **`<StatusBadge>` (build it; consume `<StatusDot>`)** | StatusDot used in 5 files; ad-hoc status badges in ~30 | Build the component. Codemod the 4 local `getStatusColor` functions. Lint: `<Badge className="bg-(green\|red\|amber\|yellow)-..."` is a CI fail in customer-facing TSX. |
| **3** | **`<PageHeader>`** | 12 / 178 pages | Codemod the 41 `text-2xl font-bold` h1s into `<PageHeader title=…>`. Lint: a top-level `<h1>` outside `<PageHeader>` requires a `data-cc-greeting` opt-in. |
| **4** | **`<EmptyState>`** | 33 / ~50 surfaces that need it | Lint: a route file with no `<EmptyState>`, `<QueryErrorState>`, or `<XxxEmptyState>` import in a list-rendering page is flagged. Vesna's empty-state audit (§5) gave the inventory. |
| **5** | **Skeleton primitives (`SkeletonList`, `SkeletonTable`, `SkeletonCard`)** | 0 / 0 / 0 actual usages — 204 ad-hoc `<Skeleton>` instances | Either kill the primitives or adopt them. Currently they exist and nobody knows. |
| **6** | **Icon vocabulary `@/lib/icons`** | doesn't exist yet | Build it. Re-export lucide icons under intention names (`CreateIcon`, `EditIcon`, `DeleteIcon`, `AIIcon`, `RefreshIcon`). Lint: `from "lucide-react"` is forbidden in customer-facing routes. |
| **7** | **`acr-*` semantic tokens** (`text-acr-pos`, `bg-acr-warn-soft`, etc.) | 222 + 164 + 120 *positive uses* — but 116 `text-red-600`, 103 `text-green-600`, 81 `text-red-500` etc. still ship | Codemod hardcoded Tailwind color classes → `acr-*` equivalents. Lint: `text-(green\|red\|amber\|yellow\|emerald\|rose)-[0-9]+` and `bg-(...)-[0-9]+` are CI fails outside `components/ui/`. |
| **8** | **Verb canon — Save changes, Update, Apply, Submit, Confirm, Discard, New, Add, Create** | ad-hoc | Build a `client/src/lib/labels.ts` of canonical button labels (`LABELS.saveChanges`, `LABELS.cancel`, etc.). Codemod the existing 120+ buttons. Lint: button text-children matching the irregular set ("Save", "OK", "Save Settings") flagged. |
| **9** | **Spacing scale** | 7+ Tailwind values | Add `--acr-space-*` tokens; convert page-level `space-y-*` and `gap-*` to a 4-step scale (`space-block`, `space-section`, `space-page`, `space-inline`). |
| **10** | **`min-h-dvh` over `min-h-screen`** | 1 / 45 | Replace-all (5 min). Add `no-restricted-syntax` ESLint rule against `min-h-screen`. |

---

## Closing read

AcreOS doesn't have a primitives problem. It has a **distribution problem**. `format.ts` exists. `StatusDot` exists. `PageHeader` exists. `EmptyState` exists. The `--acr-*` token system exists and is well-thought-out. **Every single primitive in this report exists and is well-built. None of them are at majority adoption.**

A new feature ships and the engineer reaches for the closest pattern they remember — which, statistically, is whatever the *previous* engineer reached for, which was an inline `toLocaleDateString`, a hardcoded `bg-green-500/10`, and an h1 with `text-2xl font-bold`. The legacy is teaching itself.

**The two-week intervention.** Pick three of the ten primitives above. Codemod the codebase to majority adoption (>80%). Add the lint rule that prevents regression. Then the next three. Then the next three. By the end of the quarter, AcreOS reads as one product instead of eight. The work is mechanical, not creative — which is exactly the kind of work that compounds.

Inconsistency is a tax on the user's attention, and AcreOS is currently paying it eight times per surface. The receipts are above.

---

*Calla Whitfield · 2026-05-01*
