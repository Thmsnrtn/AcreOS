# Schema Refactor — Timing Decision

**Date:** 2026-05-04
**Workstream:** D (per Comprehensive Pre-Vertical Stabilization Directive)
**Decision delegated to:** autonomous run (per founder directive — "Make the call based on what the performance diagnostic surfaces in Workstream A")

---

## The decision

**Defer the schema-file refactor until after Note Investor ships.**

Rationale below. This document records the reasoning so a future review can second-guess it cleanly.

---

## What the perf diagnostic surfaced

`PERFORMANCE-DIAGNOSTIC.md` identified the cold-load symptom as:
1. **HTTP/2 + compression@1.8 negotiation bug** — primary cause (2.28 MB raw assets per cold load)
2. `sw.js` cache-control set to immutable for 1 year — secondary
3. `vendor-pdf` + `vendor-charts` preloaded on critical path — tertiary

**None of these are caused by `shared/schema.ts` size.** The 17,468-line schema is a developer-experience problem (slow IDE tsc, painful navigation, conflict-prone merges), not a runtime-performance problem.

The diagnostic explicitly notes: *"Server is not the bottleneck. Worker process saturation is not visible in logs."* The schema doesn't ship to the client; it lives entirely server-side and gets resolved at build time. Schema size won't make pages load slower for end users.

---

## The three options recapped

From `PLATFORM-STATE-REPORT.md §10`:

| Option | When | Cost | Pros | Cons |
|---|---|---|---|---|
| **A** | NOW (before Note Investor) | 1-2 days | Cleanest path; no compounding cost | Eats 1-2 days of stabilization budget that could go to founder-dashboard |
| **B** | After Note Investor ships | 2-3 days | Validates pain through one real vertical first | One more vertical's tables added before split |
| **C** | After Tax-Delinquent (3rd vertical) | 3-5 days | Wait for acute pain | Schema sprawl compounds; refactor touches more code paths |

---

## Why I'm picking B (after Note Investor)

### Argument for A (refactor now)

- `shared/schema.ts` is already at 17,468 lines and 500 tables — the IDE responsiveness story is genuinely bad
- Adding Note Investor will add 5-15 more tables (full BPO + tape diligence + Sophie agent expansion)
- Doing the split now before adding more tables is mechanically easier than after

### Argument against A (and for B)

- The pre-vertical stabilization directive's hard floor is 1.5-4 days. Schema refactor on top of B.1-B.6 + C.1 + C.2 + F verification compresses everything. Founder-dashboard re-skin (which IS a customer-facing surface) is a higher-priority use of those days.
- Note Investor's foundation already shipped Wave 12 — `acquired_notes`, `note_payments` already in `shared/schema.ts`. Most of the schema additions are done. The remaining vertical work is BPO + tape diligence + Sophie expansion + 1098-INT, which is mostly *application logic* (not new tables) and where new tables are added, they're 3-5 more, not 15.
- Refactoring now means refactoring while Note Investor's 1099-INT integration, Sophie agent expansion, and tape-diligence workflow are still in active development (per the founder directive, Note Investor is the next vertical). Refactor + active development on the same files is the worst-case timing.
- Waiting until after Note Investor gives one real vertical's worth of validation: which tables co-locate naturally (notes + note_payments → `shared/schema/notes.ts`), which are cross-vertical (organizations, audit_events, leads).

### Argument against C (refactor after Tax-Delinquent)

- By third-vertical mark, schema would be ~22-25K lines. Each refactor of this nature is harder per added KLOC. Three verticals deep, the split touches every domain.
- The mechanical work doesn't get cheaper; the surrounding work (find-and-replace across services) gets noisier.

### B is the goldilocks call

- Stabilization-window pressure: A makes stabilization compete with itself; B doesn't.
- Vertical-pressure: refactoring during active Note Investor development = bad timing; refactoring after Note Investor lands = clean break.
- Marginal cost: 2-3 days at "after Note Investor" vs. 1-2 days "now" — the 1-day premium buys real validation.

---

## What this means for the rest of stabilization

- **Workstream D ships with this document only.** No code change.
- **The decision is recorded.** A future engineer (including future-me) can second-guess by reading the rationale.
- **Trigger for actual refactor:** Note Investor's full vertical (BPO + tape diligence + Sophie + 1098-INT) merges to main and the founder is ready to start Tax-Delinquent. Run the refactor in the Tax-Delinquent prep window.

---

## Pre-work that should happen NOW (regardless of timing)

These help future-me regardless of when the refactor happens:

1. **Add a per-domain comment header** at every major table cluster in `shared/schema.ts`. The file already has section headers like `// ━━━ NOTE INVESTOR ━━━`. Auditing and tightening these makes the eventual file split a glorified `sed`.

2. **Commit a structural inventory** at `shared/schema-inventory.md` listing each table → which domain bucket it would land in. This is a 30-min task; it makes the eventual split a referencable plan rather than a re-discovery exercise.

I'll ship #2 below (#1 is already partially done — most major sections have headers).

---

## What I'll commit alongside this decision doc

- `shared/schema-inventory.md` — table → domain bucket mapping (the eventual file split's table-of-contents)

These are pre-work for the refactor, NOT the refactor itself. ~30 min total.
