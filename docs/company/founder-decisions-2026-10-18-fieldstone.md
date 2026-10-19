# Founder decisions — 2026-10-18 (Fieldstone redesign)

**Date:** 2026-10-18

**Source:** the founder's implementation brief for the Fieldstone redesign,
given to the implementing session on 2026-10-18 together with three approved
reference images (Fieldstone desktop light, Fieldstone mobile, Fieldstone
desktop dark). The brief states these as approved product decisions, "not
subjects for another round of theme exploration". Only the founder can rescind
them.

## The decisions

1. **Fieldstone is the default visual identity** and the common design
   foundation: forest, limestone, sage and restrained brass.
2. **Exactly three curated colorways:** Fieldstone, Bedrock, Meridian.
3. **One structure for all three.** Layouts, typography, spacing rules,
   navigation, icons, components, interaction patterns and information
   hierarchy are shared. A colorway changes the palette, not the product's
   structure or font personality.
4. **Light, Dark and Match device** for every colorway; Match device is the
   default.
5. **Personal Appearance contains only Colorway and Display.** The font-pairing,
   spacing/density, motion and global list-style pickers are removed from it.
6. **One typography system:** Fraunces display + Inter interface/body. Tabular
   figures for operational and financial data. No serif in dense tables or form
   controls.
7. **Accessibility accommodations stay**, in a separate, clearly labelled
   Accessibility & comfort section (collapsed by default when appropriate).
   Device reduced-motion settings work automatically.
8. **Company logos and custom company colours belong under Company branding**,
   not personal Appearance, and organization branding never overrides a
   person's accessibility or reading preferences.
9. **The product is AcreOS.** Fieldstone, Bedrock and Meridian are colorway
   names, not product names.
10. **Illustrative figures and parcels from the design concepts never become
    production data.**

## Migration rules given with them

- Existing Bedrock selections stay Bedrock; Homestead → Bedrock; Quarry,
  Nocturne, Meadow, Slate → Fieldstone. The stored display mode is preserved;
  an old colorway name never implies a mode. Legacy `system` mode = Match
  device.
- Old font-pairing and density preferences no longer restore the retired
  customization; accessibility reading preferences survive.
- Do not deploy to production or merge to main without the founder's explicit
  approval.

## Where they live in the code

`shared/appearance.ts` (the contract), `client/src/index.css` (the six token
blocks), `docs/design/design-language.md` §0.1 / §1.1 / §1.2 / §1.6, and the
gates `tests/unit/appearanceContract.test.ts`, `appearanceLifecycle.test.tsx`,
`statusInkContrast.test.ts`, `installedBrandAssets.test.ts`,
`moneyIsTabularInter.test.ts`.
