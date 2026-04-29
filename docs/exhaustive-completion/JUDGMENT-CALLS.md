# Port — Judgment Calls Log

Single consolidated record of every decision made autonomously during the
production port (Phases B.3 → H) where I would otherwise have paused to ask.
Each entry documents:

1. **Surface/component** — where the call lands
2. **Question** — what came up
3. **Default chosen** — what I shipped
4. **Reasoning** — design brief section or tradeoff that justifies it
5. **Where it lives** — file path + commit SHA so you can find it fast

Founder reviews this doc post-port. Refinements feed into picker pass /
follow-up edits. Order: chronological by phase + entry index.

Format note: entries terse — 2-3 sentences each. Never expand into prose.

---

<!-- entries appended below; newest at the bottom of the relevant phase -->

## Phase B.3 — Font self-hosting

### B.3.1 — Charter → Source Serif Pro substitution
- **Surface/component:** `classic` font pairing display face
- **Question:** Ship Charter via Butterick redistribution, or substitute?
- **Default chosen:** Substituted Source Serif 4 (Adobe, SIL OFL) for Charter.
  Pairing ID stays `classic`; user-visible name unchanged.
- **Reasoning:** Founder instruction to "bias toward swap on any license
  ambiguity." Butterick redistribution involves a third-party license chain
  (Bitstream original → Butterick redistribution); SIL OFL is unambiguous.
  Source Serif preserves the warm-editorial register Charter was bringing.
- **Where:** `client/public/fonts/SourceSerif4-VariableFont.woff2`,
  `client/src/fonts.css` (B.3 commit), design-system doc §4.1 updated inline.

### B.3.2 — White-label dynamic font picker → curated only
- **Surface/component:** `client/src/pages/reseller-dashboard.tsx` white-label panel
- **Question:** The reseller white-label panel had a runtime Google Fonts CDN
  loader (`loadGoogleFont`) for arbitrary font picks. Keep + restrict to
  free fonts, or remove entirely?
- **Default chosen:** Removed `lib/font-loader.ts` and the runtime CDN call.
  Restricted `FONT_OPTIONS` to 5 self-hosted faces matching the main app's
  pairings (Inter / Inter Tight / Fraunces / Source Serif 4 / Newsreader).
- **Reasoning:** Standing constraint §0.1 (no paid assets, no runtime CDN)
  applies to all surfaces including reseller white-label. Design brief
  §4 forbids à-la-carte font picking. Resellers get the same curated set
  as the main app rather than arbitrary Google Fonts.
- **Where:** `client/src/pages/reseller-dashboard.tsx`, `client/src/lib/font-loader.ts` (deleted), B.3 commit.

### B.3.3 — CSP allowlist removed for fonts.googleapis.com / fonts.gstatic.com
- **Surface/component:** `server/middleware/security.ts`, `server/services/securityEnhancements.ts`
- **Question:** With fonts now self-hosted, what to do with the CSP allowlist
  entries permitting Google Fonts?
- **Default chosen:** Removed `https://fonts.googleapis.com` from `style-src`
  and `https://fonts.gstatic.com` from `font-src` in both CSP definitions.
  CSP now rejects any accidental future Google Fonts CDN load — defense
  in depth on the no-CDN constraint.
- **Reasoning:** Constraint §0.1 is absolute. Tightening CSP turns the
  rule into runtime enforcement.
- **Where:** `server/middleware/security.ts:64-66`, `server/services/securityEnhancements.ts:12`, B.3 commit.

## Phase B.4 — Settings → Appearance UI

(reserved)

## Phase B.5 — Server-side preferences persistence

### B.5.1 — No-flash strategy: localStorage-first hydration, not SSR
- **Surface/component:** `client/src/contexts/theme-context.tsx`
- **Question:** Resume doc spec mentioned server-rendering `<html data-theme=...>`
  before client hydration as the primary no-flash path. Implement?
- **Default chosen:** localStorage-first hydration. Server fetch runs on mount
  and overwrites local state only if it returns valid prefs. Cross-device
  drift (one device's localStorage stale relative to server) results in a
  brief flicker on first paint of that device.
- **Reasoning:** App is a client-only SPA (`createRoot` in `main.tsx`, no
  `renderToString` / `hydrateRoot`). True SSR no-flash requires significant
  SSR scaffolding work beyond Phase B scope. localStorage hydration covers
  the common case (same device, repeat visits) cleanly. Cross-device edge
  case is acceptable per design-system §2.2 — small, brief, infrequent.
- **Where:** `client/src/contexts/theme-context.tsx` (B.5 commit). Document
  in PORT-AUDIT-PHASE-B.md if cross-device flicker is observed during B.6.

### B.5.2 — Preferences shape lives on `users` table, not `organizations.settings`
- **Surface/component:** `shared/models/auth.ts`, schema design
- **Question:** Add appearance prefs to existing `organizations.settings` JSONB
  (where other ad-hoc settings live) or a new column on `users`?
- **Default chosen:** New `appearance_preferences` JSONB column on `users`.
  Migration `0028_user_appearance_preferences.sql` adds it nullable.
- **Reasoning:** Appearance is inherently user-scoped (each person picks
  their own theme). Project memory explicitly notes onboarding state is
  org-scoped, NOT user-scoped — implication is that user preferences belong
  on the user table, not the org. Putting it on `users` keeps the
  multi-user-per-org case clean (each member sees their own theme).
- **Where:** `shared/models/auth.ts:23` (column), `migrations/0028_user_appearance_preferences.sql`.

## Phase C — Personalization infrastructure

(reserved)

## Phase D — Feature flag system

(reserved)

## Phase E — Surface-by-surface port

(reserved)

## Phase F — Capture + tier audit

(reserved)

## Phase G — Polish on extra-attention surfaces

(reserved)

## Phase H — End-to-end verification

(reserved)
