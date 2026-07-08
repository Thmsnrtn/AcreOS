# Ramona Sutherland — The Divorce Lens

**Persona:** Ramona Sutherland, 49, Sacramento CA. Mid-divorce. CA community-property state. ~40 parcels across 3 LLCs (one her separate-property pre-marital, two formed during marriage). Forensic accountant subpoenaed AcreOS records. Restraining order pending. Spouse currently has her login. Wave 3 audit, "the edge case I never thought I'd be" lens.

**Date:** 2026-05-01
**Audit type:** Exhaustive — legal-discovery / access-control / partition-readiness
**Verdict:** AcreOS is good for daily ops, **dangerous for divorce**. The platform was built assuming one trusting org. It does not assume the org is the battlefield.

---

## Context: what changes when "the user" becomes "the parties"

Every B2B SaaS assumes the org is a single principal. Divorce shatters that assumption. Ramona is no longer "the user" — she is **one of two parties** sharing one tenant. Her data is now legal evidence. The other principal is hostile. Three things must hold:

1. Records produced for discovery must be **defensible** (provenance, immutability, completeness).
2. The hostile co-principal must be **revocable** without destroying shared history.
3. The org must be **partitionable** along entity-ownership lines (her LLCs vs. shared LLCs vs. his) so each side can leave with what's theirs.

AcreOS today does **#1 partially**, **#2 weakly**, **#3 not at all**.

---

## Findings

### 1. Audit log exists but is operationally invisible to Ramona

`shared/schema.ts:4149` — `audit_log` table records action / entityType / entityId / before+after JSON / ipAddress / userAgent / userId / createdAt. Action vocabulary in `AUDIT_ACTIONS` (`schema.ts:4193`) covers create, update, delete, login, logout, export, import, consent_granted, consent_revoked, data_purge.

`client/src/components/compliance-settings.tsx:120` — there is a UI: `/api/audit-log` with filters, rendered in compliance settings.

**Good:** the data is there. before/after diff is captured.
**Bad for Ramona:**
- The audit log lives behind compliance settings, framed as TCPA / retention. Nothing in the product says "if you are being investigated, start here."
- There is **no signed export** of the audit log. CSV download, no hash chain, no tamper-evident manifest. Forensic accountant will ask "how do I know this wasn't edited?" Answer today: trust us.
- `audit_log.id` is `serial` — gaps would be detectable, but reorder/edit on a row is not. No hash-of-previous-row chain.
- **Login events are recorded but spouse logins look identical to Ramona's** — same userId if they're sharing credentials. IP + userAgent help, but there is no "this session was from a new device, confirm it was you" challenge that would create a clean break.

**Ask:** signed audit-log export (PDF + JSON + sha256 manifest), accessible from a top-level "Legal & Discovery" page, not buried in compliance.

### 2. Activity log duplicates audit log, with different shape

`schema.ts:1487` — `activity_log` table also exists (entityType / entityId / changes / metadata). Overlaps with `audit_log` but covers business-domain events (status transitions, assignments) rather than security events.

For Ramona's forensic accountant this is **two sources of truth she has to reconcile**. Which one is canonical for "when did this property's owningEntity change from `Sutherland Holdings LLC` to `Sutherland Family Trust`?" Today: unclear. Probably activity_log. Probably.

**Ask:** documented split — audit_log = security/compliance, activity_log = domain events. Cross-reference IDs. Discovery export should bundle both.

### 3. Ownership-change audit trail does not exist as a first-class concept

This is the heart of the divorce case and AcreOS's biggest gap.

`shared/schema.ts:689` and `:897` — `properties.owningEntity` is a free-text field: `"Smith Land LLC"`, `"Smith IRA LLC"`. That's it. It's a string column on the property row.

When ownership transfers between entities (her separate-property LLC → joint-marital LLC, which is the entire forensic question), the change is captured only as:
- An `update` row in `audit_log` with `before: { owningEntity: "X" }, after: { owningEntity: "Y" }`.
- An `update` row in `activity_log`.

There is **no** `entity_ownership_history` table. No effective-dated record of "this parcel was held by LLC A from 2019-03 to 2022-11, then LLC B from 2022-11 to present." The forensic accountant has to reconstruct timelines by replaying audit-log diffs in chronological order — which works only if **every** change was made through AcreOS, no edits ran via raw SQL, and the audit log was never gapped during a migration.

The `titleChainService.ts` exists (search hit at `:553` on "ownership change") but it concerns **county-recorded** title chain, not internal entity-to-entity transfers Ramona cares about.

**Ask:** dedicated `property_ownership_history` table — propertyId, owningEntity, transferDate, transferType (contribution / distribution / sale / quitclaim), supportingDocId, recordedBy, recordedAt. Append-only. Surface as "Ownership History" tab on every property.

### 4. No separation of personal vs business

There is one organization. Ramona's personal-pre-marital LLC, two marital LLCs, and (potentially) her spouse's pet projects all share `organizationId`. Filtering is by `owningEntity` text field — fine for a chart, **legally meaningless** for "produce only my separate-property records."

**Practical impact:** to satisfy a discovery request limited to one entity, Ramona has to filter and export per-entity manually. There is no audit trail proving the export was complete and unfiltered for that entity. Opposing counsel can argue the filter hid records.

**Ask:** "entity scope" as a first-class filter on every export endpoint, with a manifest line that says "exported scope: entity = X. Total rows in that scope: N. Matches exported: N. No filter reduction occurred."

### 5. Spouse has Ramona's login. Today's options are bad.

She cannot revoke his access cleanly. Her options:

- **Change password.** No active-session revocation surfaced. `routes-organization.ts` shows no `revokeSession` / `forceLogout` endpoint. He stays logged in until a token expires.
- **Remove him as a team member.** He's not a separate team member — he's *her*. Same login.
- **Create a new account.** Then she has no access to the org she built. The remaining account (now controlled by spouse) holds all her records.

`server/auth.ts` has no MFA / 2FA enrollment surfaced (grep for `twoFactor|mfa` returned empty). Replit-Auth-style external IdP — fine, but enrollment of a second factor that **she controls and he doesn't** is the only thing that protects her tonight.

**Ask, in priority order:**
1. **Force-logout-all-sessions** button on Profile → Security. Single click, kills every refresh token org-wide for this user.
2. **2FA enrollment**, with recovery codes printed once and never re-shown. Trusted-device list with revoke-each.
3. **Login-from-new-device email** (and SMS, if phone is on file) with a "this wasn't me" link that auto-rotates the password.
4. **Account-takeover wizard** — "I no longer trust the other party on this account" flow that does all of the above plus snapshots the current audit log and emails it to a verified address.

### 6. Org partition: the platform has no answer

Ramona's question: **can AcreOS split our shared org into two orgs along entity lines, preserving history on both sides?**

Answer: no. Not in routes-organization.ts. Not in any service. There is no `splitOrganization`, no `forkOrg`, no entity-level export-and-rehydrate.

Workarounds:
- **Full backup zip** (`createBackupZip`, `services/importExport.ts:933`) — leads.csv, properties.csv, deals.csv, notes.csv, metadata.json. Each side gets a copy of everything, then deletes the other side's rows manually. Loses audit log entirely (it is **not** in the backup zip — confirmed by reading `:939-966`). Loses activity log. Loses cross-references.
- **Per-entity CSV export filtered by owningEntity.** Clean rows, zero history, zero attachments.

Either way the receiving side starts with **a snapshot, not a chain of custody**. Forensic accountant is unhappy.

**Ask (this is a real engineering project, not a quick fix):**
- "Partition org" tool — admin-only, irreversible, multi-step.
- Step 1: tag each entity (LLC) as "stays with org A" / "moves to new org B" / "shared (must be resolved)".
- Step 2: dry-run report showing every property, lead, deal, note, document, audit-log row, activity-log row, and how it will be partitioned (or flagged as shared).
- Step 3: shared-row resolution — each shared row gets assigned, copied to both, or held in escrow.
- Step 4: produce two new orgs, each with a complete audit-log slice + a manifest signed by AcreOS attesting the partition was deterministic.

Until this exists, AcreOS is asking divorcing co-owners to either share an org forever or accept a snapshot-and-reset.

### 7. Soft-delete without forensic context is a footgun

`schema.ts:382, 692, 798, 903` — `deletedAt` + `deletedBy` on properties, leads, deals, notes. Good for ops, **terrible for discovery** if the spouse soft-deletes Ramona's records the night before he loses access.

The audit log captures the delete (action: "delete"), and `deletedBy` records who did it, but there is no **deletion review** UI showing "all rows deleted in the last 90 days, by whom, restorable." The compliance settings audit-log table is filterable but not framed as recovery.

**Ask:** "Trash" / "Recently Deleted" view, filterable by user, with bulk-restore and a "freeze deletes" toggle that requires two-party confirmation when the org is flagged as "in dispute."

### 8. Discovery-mode is the missing concept

There is no way to put the org into a state that says "we are in litigation, behave accordingly." That mode would:

- Disable hard deletes platform-wide.
- Require two-party confirmation for owningEntity transfers.
- Auto-snapshot the audit log nightly and stash it in immutable storage with the date and a sha256.
- Show a banner: "Discovery hold active since YYYY-MM-DD."
- Log every export with a discovery-export marker so opposing counsel can see what each party pulled.

This is the single most valuable feature for Ramona, and it is **one boolean flag plus three middlewares away** from existing.

---

## What works in Ramona's favor

- **Audit log captures before/after JSON** — `schema.ts:4156`. Replayable.
- **`deletedBy` is recorded** — soft deletes are attributable.
- **Soft-delete is the default** for properties / leads / deals / notes — hard delete requires elevated path. So spouse cannot trivially erase her records.
- **Backup zip exists** — she can produce a complete CSV bundle today, just without history.
- **Compliance UI shows audit log** — `compliance-settings.tsx`, fields visible, filterable. She can hand opposing counsel a screen recording of the audit log with filters applied.

---

## Severity-ranked asks

| # | Ask | Severity | Effort |
|---|-----|----------|--------|
| 1 | Force-logout-all-sessions + 2FA enrollment | Critical (her safety today) | S |
| 2 | Discovery-mode boolean + freeze-deletes middleware | Critical | M |
| 3 | property_ownership_history table + UI | Critical for forensics | M |
| 4 | Signed audit-log export (PDF + JSON + sha256 manifest) | High | M |
| 5 | "Recently Deleted" review + bulk-restore | High | S |
| 6 | Entity-scoped exports with manifest | High | S |
| 7 | Account-takeover wizard | High | M |
| 8 | Org partition tool | High but project-sized | L |
| 9 | Audit-log + activity-log unified discovery export | Medium | S |
| 10 | Hash-chain on audit_log rows for tamper-evidence | Medium | M |

---

## The line that matters

AcreOS treats the org as a single trusting entity. Most days that is right. The day Ramona retains a divorce attorney, that assumption becomes the product's biggest liability — and the platform has no mode that recognizes the change. Until "discovery mode" exists, Ramona's choice is to share her entire history with a hostile co-principal or to start over with a snapshot. Land Investors who go through divorce, partnership dissolution, estate disputes, or IRS audits all need the same feature. Build it once.
