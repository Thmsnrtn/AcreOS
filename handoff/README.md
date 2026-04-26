# AcreOS — Prototype → Production Handoff

This folder is the bridge between the **prototype** (`acreos/`, single-page Babel/JSX) and the **real codebase** (`client/`, Vite + React + TS + Tailwind + shadcn + wouter + Tanstack Query).

It exists so an engineer can pick up any prototype surface and know:
1. Which production route it maps to.
2. Which real components to use instead of the prototype primitives.
3. What data it needs and where to fetch it.
4. What state and behaviors are required (empty/loading/error, focus, a11y).
5. Which prototype-only fictions to drop on the floor.

## How to read this folder

| File | Purpose |
|---|---|
| `ROUTE_MAP.md` | Every prototype `case 'foo'` → production wouter route + page component path. |
| `COMPONENT_MAP.md` | Prototype primitive (`Button`, `KPI`, `Toast`, …) → shadcn/real equivalent. |
| `TOKENS.md` | Color, spacing, type, radius, shadow tokens — single source of truth. |
| `GLOBALS_AUDIT.md` | Every `window.*` global in the prototype, with replacement (context, query, route param). |
| `DATA_SHAPES.md` | Fake data → production schema for every entity (Deal, Parcel, Contact, …). |
| `STATES_CHECKLIST.md` | Per-page empty/loading/error/skeleton requirements. |
| `ONBOARDING_API.md` | Tour & first-run contract — replace localStorage flags with server-tracked progress. |
| `TWEAKS_DECISIONS.md` | Each Tweaks toggle: ship, drop, or convert to a setting. |
| `RESPONSIVE.md` | Breakpoint behavior for canonical pages (the prototype is desktop-only). |
| `A11Y_CHECKLIST.md` | Focus order, ARIA, keyboard, contrast — what the prototype is missing. |
| `DEMO_SCRIPT.md` | The walk-through script for the prototype: which Tweaks to flip, in what order. |
| `walkthrough.html` | Click-through guide that opens each prototype surface in sequence with notes. |

## The big rules

1. **The prototype is reference, not source.** Engineers should read it for behavior and copy, not copy-paste it into production. Inline-Babel + `window.*` + global CSS injection do not survive the migration.
2. **Real types live in `client/src/types/` and `shared/schema.ts`** — start there, not from the prototype's `data.jsx`.
3. **Real components live in `client/src/components/ui/` (shadcn)** — wrap them in app-specific primitives if you need our visual treatment, don't fork them.
4. **One canonical version per page.** The prototype has A/B/C variants gated by `window.*` checks (see `GLOBALS_AUDIT.md`). Pick one. The "C" variant is usually the latest/intended.

## Provenance

The prototype file structure (`pages-tier1.jsx`, `tier-a.jsx`, `tier-b.jsx`, `tier-c.jsx`, `round3-*.jsx`, etc.) reflects how the design was built up across review rounds, not how it should be organized in production. **Don't replicate this structure.** Production pages live one-per-file under `client/src/pages/`.
