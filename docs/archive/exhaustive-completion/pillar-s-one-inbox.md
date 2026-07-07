# Pillar S — One inbox

**Goal:** collapse the seven founder surfaces into one canonical
`/founder/now` route. Everything else becomes a filtered view.

The seven inboxes today:
- `/founder/agent-queue` — codebase-monitor proposals
- `/founder/strategy` — strategic proposals
- `/founder/decisions` — autonomous decision log
- `/founder/notifications` — generic event feed
- `/founder/feed` — agent feed
- `/founder/todo` — manual todos
- `/founder/daily-digest` — automated digest

All want founder attention. Cross-checking them is the daily tax.

---

## Design

### Three sections, strictly fixed

**1. Needs you in the next hour (red)**
- Auth-revoked secrets (Clerk, GH, Stripe key 401s)
- Deploys stuck >10 min or failed
- Customer-impacting regression detected (5xx rate jumped, Pax response quality fell)
- Strategic proposal flagged P0 by the synthesis pass

**2. Needs you this week (amber)**
- Up to 3 strategic proposals (synthesized monthly slate)
- Up to 3 agent proposals graduated to "operator review" tier (per Pillar R)
- DSAR / legal hold deadlines within 7 days

**3. Running fine (gray, collapsed by default)**
- One line per pillar: status + last activity
- Scheduled jobs health (count green vs red)
- LLM budget burn vs cap

### Strict daily budget

`organizations.founder_daily_attention_cap` (new column, default 5).
Agents can write to the queue but if today's count exceeds the cap,
new items get `deferred_until: tomorrow`. The /founder/now page never
shows more than `cap` items in the action sections — overflow renders
as "X more deferred to tomorrow."

### Deprecation, not deletion

The 7 surfaces keep their URLs for backward-compat but each renders
a banner pointing at `/founder/now` as canonical. Each becomes a
filtered view of the same `/api/founder/now` endpoint with a fixed
filter.

---

## What ships in this PR

1. **`/api/founder/now` endpoint** — aggregates from existing tables
   (`decisionsInboxItems`, `strategicProposals`, `auditEvents`,
   `jobHealthLogs`) with section + priority scoring.
2. **`/founder/now` page** — three-section UI consuming the endpoint.
3. **`organizations.founder_daily_attention_cap`** column + migration.
4. **`server/services/founderInboxBudget.ts`** — pure-function module
   that applies the cap, decides which items are red/amber, and
   handles overflow deferral.
5. **Deprecation banner** added to the 7 legacy surfaces.

Queued: actual deletion of the legacy surfaces (wait 30 days post-
launch); per-item bulk actions; mobile-optimized layout.
