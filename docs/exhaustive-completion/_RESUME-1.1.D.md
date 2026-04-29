# Resume — Gap 1.1.D Picker Completion

**Status when this doc was written:** D.1 + D.6.1 + D.6.2 + D.6.3 complete and live; D.6.4 + D.6.5 + D.6.6 + D.6.7 + D.6.8 + D.6.9 not started; verification not started; founder-ready signal not given.

**Last commit:** `96a8d2c` — `docs(picker): D.6.2 + D.6.3 verified end-to-end`

**Why this handoff exists:** the previous session ran 1.1.A → 1.1.B → 1.1.C → 1.1.D D.1–D.6.3 in one stretch (a lot of deploys + iterations + Playwright runs). Founder directive (below verbatim) requires D.6.4–D.6.9 *fully working* with end-to-end verification — explicitly "Don't hand off with partial deliverables." Previous-session Claude judged that pushing into D.6.4 mid-context would risk exactly that. Stopping cleanly here is the right call.

---

## Resume sequence (paste in this order into a fresh session)

1. The exhaustive completion prompt (the original "ACREOS EXHAUSTIVE COMPLETION" prompt).
2. The V2 workflow prompt (the "ACREOS EXHAUSTIVE COMPLETION — GAP 1 WORKFLOW UPDATE V2" prompt).
3. **The full contents of this file (`docs/exhaustive-completion/_RESUME-1.1.D.md`).**

That gives the fresh session: the project context, the V2 sub-phase plan, the founder amendments (cookie + signin-ticket bypass; cleanup at 1.1.G; etc.), the current state, and the directive.

---

## Current state — what's committed, what's deployed, what's NOT done

### Committed and live on https://acreos.io

**Bypass infrastructure (1.1.A):**
- `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts` — three modes:
  - HEADER `X-Dev-Founder-Bypass: <secret>` — per-request server-side founder identity (API testing).
  - QUERY `?dev_bypass=<secret>` — mints HttpOnly signed cookie (legacy backend-only).
  - QUERY `?dev_signin=<secret>` — calls Clerk Backend API for sign-in token, redirects to `/auth?__clerk_ticket=<token>&redirect_url=<original>` so Clerk's `<SignIn>` component redeems the ticket.
  - JSON endpoint `GET /api/__dev/signin-token` (header-gated) — returns `{ token, userId }` for programmatic redemption via `window.Clerk.client.signIn.create({strategy:'ticket', ticket})`. This is what the Playwright capture script uses.
- Audit log at `/tmp/dev-bypass-audit.log` (per-machine, ephemeral).
- Fly secrets set on `acreos`: `DEV_FOUNDER_BYPASS=true`, `DEV_FOUNDER_BYPASS_SECRET`, `DEV_FOUNDER_USER_ID=user_3CK2u6pGH7EYHgFyMS99fwhLSM7`.
- Local: `.env.local` + `.dev-bypass-secret` (gitignored + dockerignored).
- FATAL tripwire: process.exit if `NODE_ENV=production` AND `.launched` exists.

**Tooling (1.1.B/C):**
- `tests/e2e/capture-auth-surfaces.ts` — Playwright capture, single-page-per-breakpoint with prime + `SURFACE_FILTER` env var support.
- `tests/e2e/build-auth-comparisons.ts` — generates per-surface comparison reports.
- `tests/e2e/verify-mechanical-fixes.ts` — checks touch targets / overflow on unauth surfaces.

**1.1.B captures:**
- 56 production screenshots in `docs/exhaustive-completion/auth-screenshots/`.
- 28 per-surface comparison reports in `docs/exhaustive-completion/visual-comparisons/<slug>-AUTH-REQUIRED.md`.
- `MASTER-GAP-REPORT.md` updated.

**1.1.C fixes (all deployed and verified):**
- `client/src/pages/pipeline.tsx`, `inbox.tsx`, `offers.tsx` — `fetchJsonArray<T>` for envelope endpoints.
- `client/src/pages/founder-home.tsx` — useQuery `select` transform for schema mismatch.
- `client/src/pages/landing/landing.css`, `pricing.tsx`, `changelog.tsx`, `cookie-consent-banner.tsx` — touch targets + overflow.
- `server/routes-communications.ts` — `/api/inbox/:id` NaN guard.
- All four formerly-CONFIDENT-FAIL auth surfaces re-captured at full size:
  - `pipeline-1440.png` 1.2MB (was 52KB error)
  - `inbox-1440.png` 136KB (was 52KB error)
  - `offers-1440.png` 390KB (was 53KB error)
  - `founder-1440.png` 474KB (was 35KB rate-limited)
- /landing 10 → 2 small targets, /pricing 12 → 2, /changelog ALL CLEAR.

**1.1.D D.1 (variant inventory):**
- `docs/exhaustive-completion/variant-inventory.md` — 36 decisions across 3 categories:
  - 28 visual-review (per-surface fidelity vs prototype, options: accept/fix-needed/rebuild)
  - 4 platform-tweak (density, primary-color, font-size-base, dark-default)
  - 4 build-vs-defer (`/founder/revenue`, `/cost`, `/ops`, `/tenants` — unimplemented routes from 1.1.C findings)

**1.1.D D.6.1 + D.6.2 + D.6.3 (picker):**
- `acreos-picker/` — Vite + React + TS + Tailwind app.
- `acreos-picker/dist/` — committed bundle (negated in `.gitignore` to allow); served from Fly with no extra build step.
- `acreos-picker/src/inventory.ts` — the 36 decisions encoded as TypeScript.
- `acreos-picker/src/App.tsx` — full picker UI.
- Hosted same-origin at **https://acreos.io/__dev/picker/** (gated on `DEV_FOUNDER_BYPASS=true`).
- Prototype hosted at `https://acreos.io/__dev/prototype/acreos.html` for the comparison view.
- Working capabilities:
  - Top bar: progress bar + decided/total + filter chips (all/undecided/decided) + Export button (currently downloads JSON via browser).
  - Sidebar: 3 categories with per-category progress, decision rows show option label inline when decided.
  - Main panel: decision card with title + description + prototype reference + three-panel comparison (visual-review only) + option chooser + free-form notes textarea.
  - Three-panel: prototype iframe (Babel-compiles 26 JSX files in browser, then `iframe.contentWindow.__nav(slug)` switches to the right surface) + production iframe (`/<surface>` same-origin, carries Clerk session cookies) + preview iframe (currently same as production).
  - Breakpoint selector: 320 / 375 / 414 / 768 / 1024 / 1440. Zoom slider 25%–100%.
  - Keyboard: j/↓ next, k/↑ prev, 1/2/3 choose option, a/u/d filter.
  - Selections persist to `localStorage`; export downloads as JSON.

**Five infrastructure fixes that made the picker work** (all gated on `DEV_FOUNDER_BYPASS=true`, auto-revert at 1.1.G):
1. `server/middleware/security.ts` — looser CSP for `/__dev/*` paths (allows unpkg + inline + eval). Skips `X-Frame-Options: DENY` for `/__dev/*`.
2. `server/middleware/security.ts` — `frame-ancestors 'self'` (was `'none'`) so picker can frame production same-origin.
3. `server/routes.ts` — `/__dev/picker` and `/__dev/prototype` static-serve middleware.
4. `acreos-picker/src/App.tsx` — picker iframes have NO `sandbox` attribute (was creating opaque cross-origin even with `allow-same-origin`).
5. `server/routes.ts` — `/__dev/prototype` uses `index: 'acreos.html'` (default `index.html` doesn't exist).

### NOT done — what the directive demands

**D.6.4 — Inline copy editing.** Currently only a free-form notes textarea. Directive: "actual click-to-edit on visible copy in the preview panel. Hover any text, click, edit inline, save to the selection record's copy_overrides map. Use stable text identifiers."

**D.6.5 — Split-view multi-breakpoint.** Currently one breakpoint at a time. Directive: "split view toggle that shows two breakpoints simultaneously (e.g., 375 + 1440)."

**D.6.6 — Density slider with real CSS variable wiring.** Not started. Directive: "Discrete steps (compact/comfortable/spacious/custom). Custom mode reveals individual sliders for section padding, item spacing, line-height multiplier, font-size scale. Drag updates the preview iframe in real time via CSS variable overrides injected into the iframe."

**D.6.7 — Color/token override picker.** Not started. Directive: "Token override panel shows current tokens used on the surface. Click a token to open color picker. Picker shows current value plus design-system-approved alternatives — no arbitrary hex values that violate the design system. 'Reset to default' per token. Preview updates in real time. Override saves as scoped CSS variable override at surface level."

**D.6.8 — Server-side export endpoint.** Currently downloads via browser. Directive: "Add a POST endpoint that writes the selection JSON to `docs/exhaustive-completion/founder-selections.json` on the server side, committed automatically."

**D.6.9 — Polish pass.** Picker chrome is utilitarian. Directive: "Picker chrome should match AcreOS design language — Fraunces editorial headers, the same density and considered detail as the platform itself. The picker's own UX shapes my decision quality."

**End-to-end verification** before signaling ready.

---

## Specific next step

Start with **D.6.4 inline copy editing** because it's the most architecturally consequential and will inform decisions about server endpoints (D.6.8) and overrides format.

### D.6.4 implementation plan (specific)

**File:** `acreos-picker/src/App.tsx` — add a new `useCopyEditor` hook + extend `ThreePanelComparison` to inject contenteditable on the production/preview iframe contents.

**Approach:**

1. **Inject post-load script into the production iframe** that:
   - Walks `document.body` for text-bearing elements (any element whose only children are text nodes, or specific tags like `h1-h6`, `p`, `span`, `button`, `label`).
   - Skips obviously-non-editable: scripts, styles, the cookie banner, Clerk's hosted UI inside iframes.
   - For each candidate, generate a stable `data-copy-id` = `${surfacePath}::${sha1(originalText).slice(0,8)}`.
   - Wrap the text in a `<span data-copy-id="..." contenteditable="true">` if not already wrapped.
   - On `input` events, postMessage `{type: 'copy-edit', id, original, edited}` to parent (picker).

2. **Picker stores edits** in `selection.copy_overrides`:
   ```ts
   {
     copy_overrides: {
       [copyId]: { original: string, edited: string, dataPath: string }
     }
   }
   ```
   The `dataPath` is the surface URL so 1.1.F knows where to apply each override.

3. **Apply at 1.1.F:** scan the surface's source files for the `original` substring; replace with `edited`. Use the original-text match because data-copy-id won't exist in source unless the production app adds them. (This is the lowest-friction path; fancier would be to add `data-copy-id` annotations to React JSX during the apply step.)

**Realization risks to watch:**

- React reconciliation may overwrite the contenteditable wrappers on re-render. Mitigation: the injection script can run a `MutationObserver` and re-wrap any new text nodes. Also: most copy is in static JSX, not dynamic — once wrapped, it tends to stay.
- Clerk's hosted UI inside the production iframe (e.g., user button popover) renders in a Shadow DOM. The injection script needs to skip shadow roots.
- The cookie banner appears on every page until accepted. Tell the picker to dismiss it (postMessage to localStorage-set `acreos_cookie_consent=accepted` in the iframe before injection).
- `<input>`/`<textarea>` elements are NOT made contenteditable (they have native value editing instead). Skip form fields entirely — they're not "copy" in the founder-decision sense.

**Acceptance test for D.6.4:**

```ts
// In a smoke script:
// 1. Navigate to picker, decision = home (/today).
// 2. Find an iframe[data-panel="preview"] (preview panel).
// 3. Inside it, find a span[data-copy-id^="/today::"].
// 4. Trigger a click + simulate text edit (e.g. "Good morning, Thomas" → "Hey Tom").
// 5. Verify postMessage fired and parent App state has selection.copy_overrides[copyId] = { original, edited }.
// 6. Reload page. Verify copy_overrides persisted (localStorage).
```

### D.6.5 split-view (after D.6.4)

`acreos-picker/src/App.tsx` — `ThreePanelComparison`:
- Add a "Split view" toggle in the controls row next to breakpoint selector.
- When ON: picker renders 6 panels in a 3 × 2 grid (3 sources × 2 breakpoints). Founder picks two breakpoints from the breakpoint selector (becomes a 2-select instead of 1-select).
- When OFF: current 3-panel layout.

### D.6.6 density slider (after D.6.5)

`acreos-picker/src/App.tsx` — new `DensityControls` component:
- Discrete radio: compact / comfortable / spacious / custom.
- Custom mode: 4 sliders (section-padding 8–32px, item-spacing 4–24px, line-height-multiplier 1.0–1.8, font-size-scale 0.85–1.15).
- Live injection: picker `postMessage`s the iframe `{type: 'apply-density', vars: {...}}`. Iframe runs an injection script (added at iframe load time, like the contenteditable injector) that listens for this and updates `<style>` content with `:root { --acr-density-section-padding: 20px; ... }` and similar overrides.
- Save: `selection.density_overrides = { 'section-padding': '20px', ... }`.

The production CSS already uses CSS custom properties (`--acr-line`, `--acr-brand`, etc. in `landing.css` and elsewhere). Need to verify which density-related CSS variables exist; may need to add them in production code as part of D.6.6 (not just in the picker). This is the riskiest of the remaining sub-phases — review production CSS first to enumerate density tokens.

### D.6.7 color/token picker (after D.6.6)

Similar pattern to D.6.6 but for colors. Constrained palette: enumerate the existing `--acr-*` color tokens and let founder remap them per-surface. Same injection mechanism.

The design-system tokens (the constrained palette) live in:
- `client/src/index.css` — search for `--acr-` definitions
- `client/src/pages/landing/landing.css` — landing-specific tokens

Pull the canonical list, build the picker's swatch UI from it, no arbitrary hex.

### D.6.8 server export endpoint

**File:** `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts` — add a `POST /api/__dev/founder-selections` route inside `devFounderBypass` middleware:

```ts
if (req.method === 'POST' && req.path === '/api/__dev/founder-selections') {
  // header-gated like /api/__dev/signin-token
  // body should be JSON { version, completed_at, selections, ... }
  // write to docs/exhaustive-completion/founder-selections.json
  // optional: also write a timestamped backup to docs/exhaustive-completion/founder-selections-history/
}
```

Picker `Export selections` button: change from `Blob` download to a `fetch('/__dev/founder-selections', { method: 'POST', headers: {'X-Dev-Founder-Bypass': SECRET}, body: JSON })`. Show toast on success.

**Caveat:** the founder loads the picker from a browser without the `X-Dev-Founder-Bypass` header. So the picker page itself needs the secret — either embedded at build time (not great) or fetched from a cookie/server endpoint. Simplest: when the picker loads, hit a same-origin endpoint that returns the secret (gated by some session check) OR rely on the founder having a Clerk session and the bypass middleware accepting Clerk-authenticated requests. Cleanest is to add a NEW mode to the bypass: if the requester has a valid Clerk session for the founder user, accept the export endpoint without the header. That way the picker just POSTs as the authenticated founder.

### D.6.9 polish

- Replace Inter for headers with **Fraunces** (already loaded by the prototype CDN; can be added to `acreos-picker/index.css`).
- Replace utilitarian button styles with the platform's button language (terracotta primary, soft-bordered secondary, generous padding).
- Sidebar: more breathing room, status pills instead of dots, surface-tier badges (T1/T2/T3/T4/T5).
- Decision card: editorial title in Fraunces, considered eyebrow, subtle dividers.
- Use the `--acr-*` tokens from production CSS so picker chrome shares the same palette.

---

## Decisions made mid-task that aren't obvious from code

1. **Picker hosting via acreos backend (not Vite dev server).** Same-origin is required for picker iframes to carry Clerk session cookies (modern browsers block cross-site iframe cookies even with SameSite=None). Hence `acreos-picker/dist/` is committed and served by the existing express app at `/__dev/picker/`. Don't move the picker to a separate Vite dev server.

2. **acreos.io is the canonical domain.** acreos.fly.dev 301-redirects to acreos.io. All Playwright captures and verification target acreos.io. The picker URL is `https://acreos.io/__dev/picker/` (not acreos.fly.dev).

3. **Variant decision space adapted from V2 spec.** The original V2 picker spec assumed parallel A/B/C variants in the prototype. There aren't any — `tier-a/b/c.jsx` are sequential refinement layers, not voice samples. The actual decision space is per-surface visual review (28) + global tweaks (4) + build-vs-defer (4). See `docs/exhaustive-completion/variant-inventory.md`. Keep this framing; don't try to reverse-engineer A/B/C variants.

4. **Picker iframes have no `sandbox` attribute.** With `sandbox="allow-scripts allow-same-origin"`, some browsers still treated iframes as opaque cross-origin, blocking `iframe.contentWindow.__nav` access. Removing sandbox entirely fixed it. The picker is dev-gated, so the lower isolation is acceptable.

5. **CSP relaxed for `/__dev/*` paths only.** The prototype loads React+Babel from unpkg.com which is blocked by production CSP. `server/middleware/security.ts` substitutes a permissive CSP for `/__dev/*` requests when `DEV_FOUNDER_BYPASS=true`. Production routes keep the strict CSP.

6. **Slugs match prototype's `__nav(id)` exactly.** The variant-inventory slugs (`home`, `pipeline`, `parcels`, etc.) intentionally match the strings in `acreos/app.jsx`'s `case` statements at lines 127–161. Cross-reference there if adding new surfaces.

7. **Prototype `acreos.html` lives at `acreos/acreos.html`.** Note the nested `acreos/acreos/` directory — the inner directory holds the JSX files referenced by relative paths in `acreos.html`. The `/__dev/prototype/` static-serve uses `index: 'acreos.html'`.

8. **The `tsconfig.tsbuildinfo` build artifact got committed in `c474411`.** Probably should be in `.gitignore` for the picker; remove and add to gitignore as a small follow-up. Not blocking.

9. **`acreos-picker/dist/` is committed via `.gitignore` negation.** Specifically `!acreos-picker/dist/` and `!acreos-picker/dist/**` after the global `dist` rule. When you rebuild, force-add: `git add -f acreos-picker/dist/`.

10. **Founder must sign into acreos.io BEFORE opening picker.** The production iframe inside the picker only shows authenticated UI when the parent browser has a Clerk session cookie (same-origin carry). Document this in the polish pass (D.6.9).

11. **Rate-limit on /founder during rapid Playwright captures.** Multiple founder API endpoints (autonomy-health, todo, agents, etc.) plus the existing rate-limit middleware tripped 429s during the 28-surface batch capture. Re-capturing /founder alone after a wait clears it. Not a product bug.

---

## Files relevant to D.6.4–9 work

- `acreos-picker/src/App.tsx` — main picker component. Most of D.6.4–9 modifications go here.
- `acreos-picker/src/inventory.ts` — decision schema. Add `density_overrides` and `token_overrides` to the SelectionRecord shape if needed.
- `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts` — add D.6.8 server export endpoint here (it's where `/api/__dev/signin-token` lives).
- `server/routes.ts` — already has the /__dev/picker and /__dev/prototype static-serves; no changes expected for D.6.4–9.
- `client/src/index.css` and `client/src/pages/landing/landing.css` — enumerate `--acr-*` tokens for D.6.7 constrained palette.
- `acreos/app.jsx` — prototype's nav function definition (line 50: `window.__nav = (id) => setPage(id)`).

## Build + deploy cadence

After picker source changes:
```bash
cd /Users/user/AcreOS/AcreOS/acreos-picker && npm run build
cd /Users/user/AcreOS/AcreOS && git add -f acreos-picker/dist/ <other changed files>
git commit -m "..."
fly deploy -a acreos
```

Deploy takes ~2-3 minutes typically. Watch for the transient `dial tcp: lookup api.machines.dev: no such host` error — if it happens, re-run `fly deploy` from project root.

After server changes (`server/*.ts`):
- `npm run check` first (TS check).
- Then commit + `fly deploy`.

## Verification approach

For end-to-end verification (the directive's step 8):
- Use Playwright via `tests/e2e/_picker-smoke.ts` (delete after — it's a temp script).
- Sign into Clerk first by redeeming a token (use the existing pattern from `tests/e2e/capture-auth-surfaces.ts`'s `primeClerkSession`).
- Navigate to picker, walk through decisions, exercise each capability (three-panel, breakpoints, copy editing, density, color, export), assert each works.
- Take screenshots at key moments — drop them in `docs/exhaustive-completion/auth-screenshots/_picker-verification-*.png` and reference them in the final summary.

## Cleanup at 1.1.G

When 1.1.F audit-after-fix is approved:
- Delete `acreos-picker/` entire directory.
- Delete `/__dev/picker` and `/__dev/prototype` static-serve routes from `server/routes.ts`.
- Revert CSP loosening in `server/middleware/security.ts` (the `process.env.DEV_FOUNDER_BYPASS === "true"` conditionals).
- Delete `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts` and its import + middleware registration.
- Unset Fly secrets: `DEV_FOUNDER_BYPASS`, `DEV_FOUNDER_BYPASS_SECRET`, `DEV_FOUNDER_USER_ID`.
- Delete `.dev-bypass-secret`, `.env.local` (DEV_FOUNDER_* lines), `dev-bypass-audit.log`.
- Delete `tests/e2e/capture-auth-surfaces.ts`, `tests/e2e/build-auth-comparisons.ts`, `tests/e2e/verify-mechanical-fixes.ts`.
- Delete this file (`docs/exhaustive-completion/_RESUME-1.1.D.md`).
- Search codebase for `REMOVE_BEFORE_LAUNCH` and `DEV_FOUNDER_BYPASS` — both should return 0 references after cleanup.
- Deploy clean version + verify launch-marker safeguard still trips if accidentally re-enabled.

Reference: `docs/exhaustive-completion/REMOVE-BEFORE-LAUNCH.md` has the full checklist.

---

## Founder directive (verbatim)

> Strong work landing D.6.2 + D.6.3 with all five infrastructure fixes. Three-panel comparison verified live is a meaningful milestone.
>
> Before I sit down with the picker, I need everything in 1.1.D fully complete and clean, plus one verification on 1.1.C. Don't hand off to me with partial deliverables.
>
> Sequence I want:
>
> 1. CONFIRM 1.1.C STATUS — show me evidence.
>    You marked 1.1.C complete with "7 of 8 confident-fails resolved" — show me:
>    - Commits that fixed /pipeline (m.filter), /inbox (j.forEach + 500), /offers (L.filter), /founder
>    - Re-captured screenshots proving the four surfaces now render correctly
>    - Confirmation the fixes deployed cleanly
>    If any of this isn't actually done, fix it now before further picker work. The picker shows me these surfaces — they need to actually work.
>
> 2. FINISH D.6.4 INLINE COPY EDITING.
>    Not just a notes textarea — actual click-to-edit on visible copy in the preview panel. Hover any text, click, edit inline, save to the selection record's copy_overrides map. Use stable text identifiers so overrides target reliably when 1.1.F applies them.
>
> 3. FINISH D.6.5 SPLIT-VIEW MULTI-BREAKPOINT.
>    Add a "split view" toggle that shows two breakpoints simultaneously (e.g., 375px and 1440px side by side). Currently only one breakpoint visible at a time across the three panels. The split should let me verify mobile and desktop coherence for the same surface without switching back and forth.
>
> 4. FINISH D.6.6 DENSITY SLIDER WITH REAL CSS VARIABLE WIRING.
>    Discrete steps (compact / comfortable / spacious / custom). Custom mode reveals individual sliders for section padding, item spacing, line-height multiplier, font-size scale. Drag updates the preview iframe in real time via CSS variable overrides injected into the iframe. Density values save as scoped CSS custom property overrides applied at surface level when 1.1.F applies selections.
>
> 5. FINISH D.6.7 COLOR/TOKEN OVERRIDE PICKER.
>    For surfaces where I want to fine-tune accent application. Token override panel shows current tokens used on the surface. Click a token to open color picker. Picker shows current value plus design-system-approved alternatives — no arbitrary hex values that violate the design system. "Reset to default" per token. Preview updates in real time. Override saves as scoped CSS variable override at surface level.
>
> 6. FINISH D.6.8 SERVER-SIDE EXPORT ENDPOINT.
>    Currently downloads via browser only. Add a POST endpoint that writes the selection JSON to docs/exhaustive-completion/founder-selections.json on the server side, committed automatically. So when I click Export, the file lands in the repo without me manually moving downloads.
>
> 7. FINISH D.6.9 POLISH PASS.
>    Picker chrome should match AcreOS design language — Fraunces editorial headers, the same density and considered detail as the platform itself. Right now the picker is utilitarian. I want it to feel like a designed tool, because I'll be making consequential decisions in it. This is not optional finish — the picker's own UX shapes my decision quality.
>
> 8. END-TO-END VERIFICATION before signaling ready.
>    Walk through the picker yourself one final pass. Open it, navigate decisions, try the three-panel view at multiple breakpoints, try inline copy editing, try density slider, try color picker, try export. If anything feels broken or half-finished, fix it. Catch the issues I would catch.
>
> 9. ONLY THEN signal ready for founder.
>    Include a checklist of confirmed-working capabilities, the live URL, and the estimated session time so I know what to expect.
>
> The bar for "Gap 1.1.D complete" is everything above, fully working — not the current partial state. I'd rather wait and have it solid than start with the picker and hit broken pieces.

---

## Step 1 (1.1.C confirmation) was completed in the prior session

Don't redo it — evidence is captured here. Start fresh-session work at **D.6.4**.

Commits that fixed the four 1.1.C confident-fails:
- `2392173` — fix(list-pages): defend against envelope-vs-array API responses → /pipeline, /inbox, /offers
- `4f342aa` — fix(visual-gaps): /founder schema mismatch + unauth touch-target/overflow → /founder
- `2392173` also included `/api/inbox/:id` NaN guard (the /inbox 500 root cause was a separate issue that turned out to be from manual probing, not the client; the NaN guard was added defensively)
- `4671c6e`, `43cc437`, `39aaa18` — touch-target rounds for /landing, /pricing
- `1d75cbf` — 1.1.C complete docs

Re-capture file sizes (post-fix, last verified at SHA `96a8d2c`):
- pipeline-1440.png 1.2MB ✓
- inbox-1440.png 136KB ✓
- offers-1440.png 390KB ✓
- founder-1440.png 474KB ✓

All deployed cleanly. 1.1.C closed.

---

## Token budget tip for fresh session

D.6.4–9 + verification is realistically 4–6 hours of focused work. If you start in a fresh session and find yourself running long, the same handoff pattern applies — write a `_RESUME-1.1.D-PART-2.md` with the same shape. The founder explicitly authorized this in the directive ("If at any point you sense context running low, stop mid-task, write a detailed handoff prompt").
