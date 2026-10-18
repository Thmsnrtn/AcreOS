# Next moves

The running hand-off between sessions. Update it at the end of every session:
what shipped, what it measured, and the top next moves. Newest first.

## 2026-10-18

### Built, on branches, waiting for review and merge

| Branch | What it does |
|---|---|
| `claude/billing-entitlement-truth` | Seats: plans include their seats without support; add-on billing counts only seats past the included ones. One plan table. Included Pax turns charge no credits; past the allowance, purchased credits or an own key fund turns; background AI jobs follow the same rule. |
| `claude/lead-to-deal` | "Make this a deal" on a seller lead: creates or links the property and the deal in one transaction; idempotent; honest refusal when parcel facts are missing. |
| `claude/persona-vocabulary` | Deals and Finance use each persona's vocabulary; route hiding matches by path in every nav surface. |
| `claude/route-load-performance` | Map code loads only on Map; quick-add sheet loads on tap; build-graph gate. Mobile door pages download about 1–1.7 MB less JavaScript. |
| `claude/isolation-sweep-in-ci` | By-id isolation sweep runs in CI; the public log carries counts only; empty runs fail. |
| `claude/sim-followups` | Statement portal answers 503 when unconfigured; `phone_normalized` declared as the generated column it is in production. |
| `claude/declared-uniques-enforced` | Migration 0281 creates the 17 declared unique constraints idempotently (warn and skip, never fail a deploy); founder-org diagnostics on `/founder/readiness`. |
| `claude/house-mail-option` | Physical mail via AcreOS house mail (purchased credits only, priced above cost + card fees + margin) or the org's own Lob key. |

Each needs: an independent review, a merge of current `main`, then a PR.

### Remember

- Production deploys are manual now (Actions → "Deploy to Fly.io"). Merging
  to `main` does not change production.
- The 2026-10-17 repricing needs new Stripe prices and updated Fly secrets
  before checkout charges the new amounts.

### Top next moves

1. **Land the branches above** (review → merge main → PR → founder merges →
   manual deploy).
2. **Time to first deal.** Re-run `tests/simulation/campaign/lifecycle-90-days.ts`
   and remove each stall: new parcels start with `land_status` "unknown",
   which blocks offer letters; double-submitting "Add lead" in the browser can
   create duplicates; `/api/trial/status` reads wrong for a fresh org.
3. **Every paid action covers its cost.** Apply the house-mail rule (price ≥
   cost × card fees × margin, purchased credits, refuse unknown cost) to skip
   tracing and paid data lookups; add a founder view of margin by action.
4. **Close the remaining simulation findings:** the team list returns more
   than viewer roles need; 137 by-id routes the isolation sweep cannot probe
   yet; real (non-simulated) send credit charges are not exercised end to end.
5. **The unverified ground** (`docs/testing/verification-plans/`): real Safari
   on iPhone, Stripe test mode end to end, Twilio/SES/Lob sandboxes,
   backup-and-restore drill, load at 1,000 organizations.

### Waiting on the founder

- Current Lob prices for every mail spec (to confirm the house-mail cost table).
- Whether to unify the two house-mail price lists, once real Lob prices are in.
