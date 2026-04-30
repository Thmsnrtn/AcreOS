# Open Architecture Questions

Items deferred during the port that need a real decision when forcing
function meets them, but don't block current work.

---

## 1. White-label override vs theme system

### The conflict

`client/src/hooks/use-white-label.ts:67` injects `--primary`, `--ring`,
`--accent` as inline styles on `<html>` for any user whose org has a
white-label tenant config:

```ts
root.style.setProperty("--primary", hsl);
root.style.setProperty("--ring", hsl);
root.style.setProperty("--accent", hsl);
```

Inline styles win CSS specificity over `[data-theme="X"]:root { --primary: ... }`,
so for white-labeled tenants:

- The 5-theme picker (Homestead / Quarry / Nocturne / Meadow / Slate) becomes
  partially inert. `--acr-*` tokens still switch (Tailwind `bg-acr-brand`
  etc. respond), but the shadcn HSL parallel (`bg-primary`, `border-primary`,
  `bg-gradient-to-br from-primary/5`) is locked to the tenant's brand color.
- Most production component code uses `bg-primary` / `text-primary` / etc.
  rather than `bg-acr-brand`, so the visible primary color is whatever
  the white-label config dictates — regardless of what theme the user picked.

This was discovered post-port when the founder's testing org (#1, "Cycle 14
Kim Demo" tenant) showed purple gradients despite Homestead being the
active theme. The port is correctly applied; white-label is correctly
applied; they conflict by design.

### Three possible resolutions

**A. Keep current behavior — white-label always wins.**
   Reseller branding takes priority over the user's personal theme choice.
   Theme picker becomes "modify the parts white-label doesn't touch."
   Pros: matches existing reseller contract; tenant brand stays consistent
   for end-users. Cons: Theme system can't fully personalize for users
   inside white-labeled tenants.

**B. Flip — theme always wins.**
   User's chosen theme overrides the tenant's brand color. White-label
   only sets brandName / logoUrl / faviconUrl, not colors.
   Pros: theme picker works uniformly. Cons: tenant brand consistency
   broken — Kim's customers might see Acme-purple on one device and
   Homestead-terracotta on another.

**C. Separate token namespaces.**
   White-label gets `--brand-*` tokens (brand-primary, brand-accent).
   Theme keeps `--primary`/`--accent` for personalization.
   Reseller logos / nav-bar accents / header strips use `--brand-*`;
   personal-workspace surfaces use `--primary`.
   Pros: both work. Cons: requires componentwise audit — every
   `bg-primary` site must decide which token applies. Substantial
   refactor.

### Decision deferred until

Either trigger fires:

- A real reseller customer (post-Kim demo) signs a contract and asks for
  end-user personalization within their white-labeled tenant.
- The founder decides theme parity matters more than reseller branding
  control — i.e. theme picker should fully work for everyone.
- A non-reseller customer complains that their theme picker doesn't take
  effect on certain surfaces.

### Trigger to revisit

- **Cycle 14 Kim Demo or another reseller signs a real contract** —
  white-label gets stress-tested with a paying customer, surfaces the
  question about end-user personalization
- **Non-reseller customer complains** that the theme picker isn't
  applying — tells us the platform-default flow has the conflict too

### Status

- **Not blocking** vertical expansion or any current launch work
- **Not blocking** the port (the port is correct; white-label override
  is the only reason the founder couldn't see it visually pre-cleanup)
- **Backup of org #1 white-label config** stored at
  `_org-1-whitelabel-backup.json` — restore via PATCH when Kim's demo
  branding needs to come back

### Implementation pointers (when a decision is made)

If choosing **A** (current): no code change.

If choosing **B** (theme wins): remove the `setProperty` calls in
`use-white-label.ts:64-77`. Keep the hook for brandName/logoUrl/favicon
only.

If choosing **C** (separate namespaces): add `--brand-primary` /
`--brand-accent` tokens to `tailwind.config.ts`. Reskin reseller-shell
elements (logo wrap, sidebar header, top bar brand strip) to consume
`--brand-*`. Personal-workspace surfaces continue using `--primary`.
