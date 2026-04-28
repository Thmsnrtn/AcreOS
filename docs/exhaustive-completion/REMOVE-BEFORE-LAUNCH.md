# Pre-Launch Removal Checklist — Dev Founder Bypass

This document tracks the development-mode founder authentication bypass added
in Gap 1.1.A. It MUST be removed at Gap 1.1.G (immediately after
audit-after-fix is approved by founder), or at the absolute latest before
public launch.

## Founder amendment (V2 workflow)

The original V2 spec said "remove before public launch." The founder amended
this on 2026-04-27 to require automatic removal at Gap 1.1.G, immediately
after the audit-after-fix loop is approved. Reason: the bypass exists for
Gap 1 only. Once founder approves the audit, the platform should return to
normal authenticated-only state. Picker and screenshots/artifacts in
`docs/exhaustive-completion/` remain for reference; bypass infrastructure
is fully removed.

This means Gap 1 is **not** marked complete until the cleanup checklist
below is fully verified.

## Files to delete

- [ ] `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts`
- [ ] `dev-bypass-audit.log` (in `os.tmpdir()` — `/tmp/dev-bypass-audit.log` on Linux/macOS; ephemeral, but inspect via `fly ssh console -a acreos -C 'cat /tmp/dev-bypass-audit.log'`)
- [ ] `.dev-bypass-secret` (gitignored — local artifact)

## Code to remove

- [ ] Import of `devFounderBypass` in `server/routes.ts`
- [ ] `app.use(devFounderBypass)` middleware registration in `server/routes.ts`
- [ ] Any other reference to the bypass module (search verifies)

## Environment variables to unset

- [ ] `DEV_FOUNDER_BYPASS` — Fly secrets (`-a acreos`) and `.env.local`
- [ ] `DEV_FOUNDER_BYPASS_SECRET` — Fly secrets and `.env.local`
- [ ] `DEV_FOUNDER_USER_ID` — Fly secrets and `.env.local`

Fly: `fly secrets unset DEV_FOUNDER_BYPASS DEV_FOUNDER_BYPASS_SECRET DEV_FOUNDER_USER_ID -a acreos`

## .gitignore cleanup (optional — entries can stay as a tripwire)

The `.gitignore` entries for `.dev-bypass-secret` can remain (they are
harmless if no such file exists, and serve as documentation that those
filenames are not to be committed).

## Verification

- [ ] `grep -r "DEV_FOUNDER_BYPASS" .` returns 0 references (excluding
      this checklist file and any commit-message search hits)
- [ ] `grep -r "REMOVE_BEFORE_LAUNCH" --include="*.ts" --include="*.tsx" .`
      returns 0 references
- [ ] `grep -r "devFounderBypass" --include="*.ts" .` returns 0 references
- [ ] `grep -r "__DEV_BYPASS" .` returns 0 references
- [ ] `fly secrets list -a acreos | grep -i bypass` returns nothing

## Functional verification (after clean deploy)

- [ ] Request with `X-Dev-Founder-Bypass: <any-value>` header to
      `https://acreos.fly.dev/api/auth/user` returns 401 (Clerk catches
      the unauthenticated request normally)
- [ ] `https://acreos.fly.dev/today?dev_bypass=anything` returns the
      normal redirect-to-sign-in flow (no Set-Cookie for `__dev_founder_bypass`)
- [ ] `__dev_founder_bypass` cookie has no effect on auth (server doesn't
      read it anymore)
- [ ] Founder routes return 404 to non-founders (existing security intact)
- [ ] Founder can sign in normally via Clerk on acreos.fly.dev

## Launch-marker tripwire

The bypass module performs a startup check: if `NODE_ENV=production` AND
the file `.launched` exists at repo root AND `DEV_FOUNDER_BYPASS=true`,
the process aborts with FATAL.

Therefore, **before any launched-production deploy**, touch `.launched` at
repo root and commit it:

```bash
touch .launched
git add .launched
git commit -m "chore: mark launched"
```

If the bypass code is somehow still present at that point, the next deploy
will refuse to start, forcing the cleanup. This is a defense-in-depth
safety net, not a substitute for the explicit cleanup above.

## Cleanup commit

After all checkboxes pass:

```
git add -A
git commit -m "chore(cleanup): remove dev founder bypass [exhaustive] [post-gap-1]"
fly deploy -a acreos
```

Then verify deploy is clean (process starts, no [DEV BYPASS] startup warning
in logs).

## Gap 1 completion gate

Gap 1 is only marked complete in `_progress.md` and `_gap-status.md` AFTER
this checklist is fully verified. Until then, Gap 1 stays at `[/]` even if
1.1.A through 1.1.F are all `[x]`.
