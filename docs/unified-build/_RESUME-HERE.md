# RESUME HERE — Unified Build, Session 2

Operator just confirmed "Founder ID set" — they ran `fly secrets set FOUNDER_USER_IDS=user_3CK2u6pGH7EYHgFyMS99fwhLSM7 -a acreos`.

## Step 1: Verify the secret took effect

`fly secrets set` triggers a rolling deploy automatically. Either:

- **Quick check:** `fly secrets list -a acreos | grep FOUNDER_USER_IDS` — should show the secret name and a digest, no value (Fly hides secret values).
- **Functional check:** wait ~30s for the deploy to complete, then probe the endpoint. The operator's auth cookie isn't available to the session, so use the deploy log:
  ```
  fly logs -a acreos | grep -E "(deploy|started|FOUNDER)" | head -20
  ```

If the secret isn't visible or the deploy didn't complete, ask the operator to confirm.

## Step 2: Phase 1.5 — Feature flag infrastructure

Per mega prompt 1.5: "Build feature flag system for gating verticals and rollout (used in vertical expansion handoff later, set up now). Database table for flags, server middleware for evaluation, client provider/hooks, admin interface (founder-only)."

**Important:** `client/src/hooks/use-feature-flags.ts` already exists in production. Audit before duplicating. The pattern should be: extend the existing hook surface rather than create parallel infrastructure. Source inventory §0 flagged this.

Sub-steps:
1. Read `client/src/hooks/use-feature-flags.ts` and trace its server-side counterpart. Determine if there's already a flag DB table.
2. If the existing system supports per-user, per-cohort, percentage rollout — done; skip schema work and just wire any missing admin UI.
3. If the existing system is simpler (e.g., env-driven only), add Drizzle migration for a `feature_flags` table with proper columns (name, enabled, audience criteria, percentage, etc.). Use existing migration patterns.
4. Build founder-only admin route (`/__internal/founder/feature-flags` or extend the existing founder routes) for toggling flags. Gate behind `requireFounder` server-side and `useIsFounder()` client-side.
5. Commit: `feat(flags): feature flag infrastructure [unified-build]`

## Step 3: Phase 1.6 — Phase 1 completion

Update `_progress.md` with Phase 1 fully checked. Output the closing summary:
```
✅ Phase 1 Foundation complete.
Tokens extracted to Tailwind. Globals architecture in place. Founder
mode authorization secured. Feature flags ready.
Phase 2 next: Tier 0 Shell.
```
Commit: `chore(unified-build): phase 1 complete [unified-build]`

## Step 4: Begin Phase 2 — Tier 0 Shell

The shell is large (sidebar, top bar, toast host, command palette, keyboard shortcuts). Will span 2–3 sessions. Read mega prompt §Phase 2 for full requirements before starting. Key handles:

- Sidebar must check `useIsFounder()` internally for founder section — don't trust parent gating.
- Tour anchors per `data-tour-nav="..."` selectors from source inventory §5.
- Mobile drawer pattern <768px, persistent ≥768px.
- Use shadcn primitives (Sheet, Command) where applicable.
- Verify with Playwright MCP at production after deploy.

## Hard reminders
- `[unified-build]` tag on every commit
- Co-Authored-By trailer on every commit
- Don't introduce sonner — `client/src/lib/toast.ts` already wraps the existing toast
- Don't undo any existing `[elite-refinement]` slice work
- Run typecheck after any server-side change
- End session at ~85% context per the resume protocol
