# Liana Moreau — Org-Internal RBAC Deep Audit

> Audit window: 2026-05-01. Wave 2, persona-RBAC focus.
> Files reviewed: `shared/schema.ts:118-145`, `server/middleware/roleGuard.ts`, `server/utils/permissions.ts`, `server/middleware/getOrCreateOrg.ts`, `server/routes-organization.ts`, `server/routes-leads.ts`, `server/routes-deals.ts`, `server/routes-billing.ts`, `server/routes-admin.ts:642-672`, `server/routes-campaigns.ts`, `server/storage.ts:1168-1295`.
> Followed Sam's R1 thread (`docs/exhaustive-completion/elite-team-2026-05-01/sam-security.md`).

---

## 1. Verdict

**There are two RBAC systems in this codebase, only one is wired up, neither matches the schema, and the production gating surface is "are you in the org? then yes."** Sam's R1 is the loud version of a quiet pattern — when the team needed a guard, they wrote one inline instead of reusing `requirePermission`. Today, "everyone is owner" is not a misconfiguration; it is the **default code path** for the vast majority of mutating endpoints.

---

## 2. Role Inventory

The schema, the active permission matrix, the unused middleware, and the invitation validator each disagree about what roles exist. Catalog:

| Role           | Declared in schema (`teamMembers.role` comment, line 124) | In active `utils/permissions.ts ROLES` | In dormant `middleware/roleGuard.ts OrgRole` | In invitation enum (`createInvitationSchema`, line 1126) | What it actually grants today |
|----------------|-----------------------------------------------------------|----------------------------------------|----------------------------------------------|-----------------------------------------------------------|-------------------------------|
| `owner`        | yes                                                       | yes                                    | yes                                          | **no** (cannot invite as owner — sane)                    | Full `RolePermissions` matrix; passes every `requireOwner`/`requireAdminOrAbove`/`requirePermission`. |
| `admin`        | yes                                                       | yes                                    | yes                                          | yes                                                       | Same as owner minus `canManageBilling` and `canDeleteOrg`. Passes every guard customers actually hit. |
| `acquisitions` | yes                                                       | **no — falls through to `member`**     | yes                                          | yes                                                       | Treated as `member` by `getPermissionsForRole` (line 154 `validRole = ROLES.includes(role) ? role : "member"`). The role label exists on the team_members row but every `requirePermission(...)` call resolves to the `member` matrix. |
| `marketing`    | yes                                                       | **no — falls through to `member`**     | yes                                          | yes                                                       | Same as `acquisitions`. The `marketingGuard` would block delete/export — but `marketingGuard` is never imported. |
| `finance`      | yes                                                       | **no — falls through to `member`**     | yes                                          | yes                                                       | Same fall-through. The role appears in pickers but no enforcement diverges from `member`. |
| `member`       | yes                                                       | yes                                    | yes                                          | yes                                                       | Can edit/create everything. Cannot delete, cannot manage billing, cannot manage team, `viewOnlyAssignedLeads: true` flag is set but no route honors it (see §3). |
| `viewer`       | **no — schema comment omits it**                          | yes                                    | **no**                                       | yes                                                       | Listed in `ROLES` and the invite enum, so a real row can be `viewer`. `roleGuard.OrgRole` excludes it — if `roleGuard` ever gets adopted, viewer rows become un-typeable and `requireRole("member"...)` will deny them. Also a literal type mismatch with what gets persisted. |

**Schema line 124 promised a six-role taxonomy. The active enforcement code only reasons over four. Three of the six declared roles silently degrade to `member` permissions.** A founder's mental model — "I made my VA an `acquisitions` so they can't delete leads" — is wrong: VA gets the `member` matrix, which forbids delete already. But the founder's mental model "my accountant is `finance` so they have read access to bookkeeping but not deals" is also wrong: `finance` collapses to `member`, which has full deal create/edit. A `finance`-roled bookkeeper can edit deals. They cannot manage billing (the matrix says `canManageBilling: false` for `member`), which is the *opposite* of what a finance role should grant — finance is the role that *should* be able to see invoices.

The three-way role-name disagreement also creates a UX bug nobody has caught yet: the `getRoleLabel` and `getRoleColor` helpers (`utils/permissions.ts:171, 186`) only have cases for `owner|admin|member|viewer`. Any `acquisitions/marketing/finance` row falls through to the default branch and renders as "Member" with a slate badge — even though the underlying `team_members.role` text column still says `acquisitions`. So the picker can write a role the UI cannot read back. A founder sets a member to `acquisitions`, refreshes the page, and sees the badge say "Member." They reasonably conclude the save failed and try again. It didn't fail; the label code just doesn't know about the role.

`teamMembers.permissions: jsonb<string[]>` (line 125) is a per-row override array. **No code reads this column.** It's storage with no consumer. The schema's `insertTeamMemberSchema` (line 2476) accepts it, so a privileged actor could write arbitrary capability strings to a row, and nothing — front-end, back-end, audit log — would react. Either give it teeth (overlay grants on top of the role matrix in `getUserPermissionContext`) or drop the column.

---

## 3. Permission-Enforcement Audit — Endpoint × Check Pattern

### Three enforcement patterns exist; only one is rigorous.

| Pattern | Provenance | Coverage | Notes |
|---|---|---|---|
| `requirePermission("canX")` | `utils/permissions.ts:233` | ~25 endpoints — billing, lead delete/export, campaign create | Maps role → boolean matrix. **Consistent and correct for owner/admin/member/viewer.** Rolls `acquisitions/marketing/finance` to `member`. |
| `requireAdminOrAbove()` / `requireOwner()` | `utils/permissions.ts:262, 289` | Team role mgmt, invitations, commissions, jobs admin, webhooks, AI settings | Binary "admin or owner only" gate. Reasonable. |
| `requireRole(...)` / `*Guard` factories | `middleware/roleGuard.ts` | **0 callers.** `grep` of every file in `server/` finds zero `import` of this module. | Six-role aware, but dead code. Documented usage example in the JSDoc was never followed. |
| Inline `if (org.ownerId !== user.id) ...` | Sam's R1, `routes-admin.ts:465, :485` | 2 known endpoints | **Bug.** Re-implements the founder check as an owner check; leaks cross-tenant. |
| **No check at all** beyond `isAuthenticated, getOrCreateOrg` | Default | Everything else | The dominant pattern. See list below. |

### Endpoints that perform a destructive or sensitive write but have NO role guard

These all take effect for any team member of any role (including `viewer` per `getOrCreateOrg`'s lookup path):

- `PUT /api/leads/:id` (`routes-leads.ts:396`) — full-row update of a lead. **A `viewer` can edit any lead.** The 24-line audit-log block runs after the write, so the trail is correct, but the gate is missing. `requirePermission("canEditLeads")` should be here; that would return 403 for `viewer`.
- `POST /api/deals` (`routes-deals.ts:125`)
- `PUT /api/deals/:id` (`routes-deals.ts:199`)
- `POST /api/deals/:id/enrich` (`routes-deals.ts:351`)
- `POST /api/deals/bulk-stage-update` (`routes.ts:1156`)
- `POST /api/deals/bulk-stage-undo` (`routes.ts:1262`)
- `POST /api/deals/:id/checklist` (`routes-deals.ts:1284`)
- `PATCH /api/organization` (`routes-organization.ts:395`) — **org-settings update with no role gate.** A `viewer` can rename the org, change AI settings (the AI-specific endpoint at line 423 is also unguarded), and conceivably touch any column the schema accepts.
- `PATCH /api/organization/settings` (`routes-organization.ts:1078`)
- `POST /api/onboarding/*`, `DELETE /api/onboarding/sample-data`
- `POST /api/leads/:id/score`, `/conversion`, `/nurture`, `/enrich` — every per-lead AI mutation
- `POST /api/leads/:id/betty-score` — burns LLM credits with no role gate
- `DELETE /api/playbooks/instances/:instanceId`

The lead-delete + bulk-delete + permanent-delete trio is correctly gated with `requirePermission("canDeleteLeads")`. The lead-edit equivalent is not. **You can't delete a lead as a member — you can edit it into oblivion.** (Set `firstName=""`, `phone=""`, `email=""`, `notes="REDACTED"`. Audit log captures it; row survives.)

### `viewOnlyAssignedLeads` is enforced nowhere

The `member` matrix sets `viewOnlyAssignedLeads: true`. `routes-leads.ts:73` (`GET /api/leads`) calls `attachPermissionContext()` and then ignores the flag — `storage.getLeads(org.id, filters)` returns every lead in the org. The flag is decoration. If a founder hires a VA and gives them the default `member` role expecting "they only see leads I assigned them," the VA sees everything.

### `getOrCreateOrg` does not check `isActive`

`getOrCreateOrg` at line 60 picks the first active membership — but a route that only runs `isAuthenticated, getOrCreateOrg` (and there are hundreds) never re-checks `isActive` against the resolved org's row. Permission-aware paths use `getUserPermissionContext` (line 218: `if (!teamMember.isActive) return null`), so guarded routes correctly 403 a deactivated member. Unguarded routes — i.e. the majority listed above — let a deactivated member keep mutating data. Deactivation is a UI suggestion, not a security control.

### `req.isFounder` is a global RBAC bypass with two reachable paths

The founder bypass (`auth/clerkAuth.ts:103, 153`) sets `req.isFounder = true` for any user whose email matches `FOUNDER_EMAIL` / `FOUNDER_EMAILS`. Inside `routes-campaigns.ts`, `routes-founder-integrations.ts`, `routes-sso.ts`, `routes.ts:1430`, this flag is consulted in conditional branches that skip rate limits, tier checks, and credit deductions. None of those uses are wrong on their own — Thomas needs to be able to act as any tenant for support — but the bypass interacts poorly with the role guards: `requirePermission`, `requireAdminOrAbove`, `requireOwner` do **not** check `req.isFounder`. They check `team_members.role` for the resolved org. So the founder, when looking at *their own* org, is `owner` and breezes through. When looking at a customer's org via `?orgId=` patterns, they aren't a `team_members` row in that customer's org and the guard 403s — but only on the ~25 routes that have a guard at all. On the unguarded majority (everything in §3), the founder can act-as because `getOrCreateOrg` resolved them to a customer org. **The bypass is partial and inconsistent.** Either (a) make `requirePermission` honor `req.isFounder` and audit-log every founder-as-customer action, or (b) build a dedicated `act-as-tenant` flow that creates a real, audited session shadow rather than relying on the email-email-match shortcut.

---

## 4. Cross-Org Leak Risks

### Sam's R1 (broken founder check) is the high bid; here are the org-internal-RBAC adjacents.

**Multi-org membership is not a real concept.** `getOrganizationByOwner` at `storage.ts:1168` returns the *first* org owned by `userId`. `getOrCreateOrg` at `getOrCreateOrg.ts:47` uses that result and stops. If a user owns two orgs (e.g. they founded one, were granted ownership of another via direct DB), they will only ever see the first one returned by Postgres. There is **no `/api/organizations/switch`** endpoint, no `org_id` cookie, no header-driven org selection. The "active org" is whichever row Postgres returns first.

Implications:
1. **Two-owner-orgs scenario:** user has no UI control over which org's data they're operating on. The acceptance flow at `routes-organization.ts:1305-1320` mitigates *one* case — a fresh seat user's empty shadow org is auto-deleted after invite-accept. Outside that one path, dual-ownership is undefined behavior.
2. **Owner + member-elsewhere scenario:** user owns org A and was invited as `member` to org B. `getOrganizationByOwner(userId)` returns A immediately, line 54's `!org` short-circuits, B is never consulted. The user is forever stuck in A. They cannot switch to B even though they have a legitimate `team_members` row there.
3. **Member-only-multi-org scenario:** user is `member` of orgs B and C with no ownership. `getOrCreateOrg.ts:60` does `memberships.find((m) => m.isActive)` — `find` returns the first match, which is whichever Postgres returns first. **Indeterminate.** Same user may land in B or C across requests depending on query plan / row insertion order. No leak to a non-member, but the user has zero control over which tenant they're acting in. This becomes a leak the moment a UI shows "Today's leads (X)" and the user assumes that means org B's leads when they're actually mutating C.
4. **Email reuse:** invitations are matched by email-string equality (`routes-organization.ts:1270`). If two orgs invite the same email, the user can accept both, becoming a `team_members` row in each. The first-active-membership rule above takes over from there.

There is no "current organization" concept on the user. There needs to be — either a `users.activeOrganizationId` column, an `acreos-org` cookie, or an `X-Organization-Id` header validated against memberships.

### Why this matters for the "everyone is owner" anti-pattern

The solo-founder + 1 VA case looks safe at first glance — only 2 rows in `team_members`, both presumably trusted. But the failure mode isn't "the VA goes rogue." It is:
1. The VA's Google account gets phished. The attacker has session access to AcreOS for as long as the Clerk session is valid (Sam's CC6.1 §6 review notes session lifetime is unverified).
2. The VA's role is `member`. The attacker can't delete leads (`canDeleteLeads: false`). They can edit every lead, edit every deal, change the org's billing email via `PATCH /api/organization` (no guard), exfiltrate every record by editing `notes` to embed a webhook callback or by clicking through the UI.
3. The VA's role being `member` was supposed to be a control. In practice the only thing it stops is the explicit destructive path. Edit-to-destroy is unguarded.

**Role granularity at this org size doesn't help when most endpoints don't enforce it.** It also doesn't *hurt* — the `member` matrix's deny-list is consistent for the endpoints that do check — but the marketing claim "RBAC protects you when an account is compromised" is currently false for everything in §3.

In the larger team case (5+ seats — possible at AcreOS plan-tier `scale`), role granularity is doing real work: a `viewer` accountant can't edit billing, an `admin` ops lead can't transfer ownership, a `member` cold-caller can't delete the lead they just botched. The current code mostly delivers on this, but only via the gates that exist. The §3 gap list is what teams of 5+ are going to discover the hard way.

### The `crossOrgAdminGuard` quarantine

`routes-admin.ts:664` defines `crossOrgAdminGuard` for routes that take `:orgId` in the path. Sam already noted (§2) that nothing imports it. Because `getOrCreateOrg` already pins `req.organization`, any path-level `:orgId` is allowed to disagree with the auth-resolved org and the storage layer just runs the org-scoped query against whichever the handler passes. The pattern is dangerous-as-designed; the guard exists to neutralize it but is not adopted.

---

## 5. Per-Record Permissions

**Today: none. Recommendation: skip until the org-level RBAC is rectified.**

The schema offers three affordances that *could* support per-record permissions:
- `leads.assignedTo`, `deals.assignedTo`, `tasks.assignedTo`, `properties.assignedTo`, `notes.assignedTo` — all `integer` references to `teamMembers.id`. Used today only as filters in list views and as group-by keys in the team-performance dashboard (`routes-organization.ts:937-941`).
- `teamMembers.permissions: jsonb<string[]>` — a per-member capability array, **read by no code**.
- A `visibility` text column on at least one table (`schema.ts:9069`, in a different domain — the buyer-network table). Existing precedent for `public | private | verified_only` patterns in the codebase, but not extended to the CRM core.

A valid per-record permission model would tie these together: a lead's `assignedTo` value, combined with a `member.permissions` containing `"viewOwnLeadsOnly"`, gates the read query. The `member` role's `viewOnlyAssignedLeads: true` is half of that contract — the schema half is in place; the storage half is not.

**Why skip.** A solo-founder + 1 VA org has 2 rows in `team_members`. Per-record visibility within a 2-person team is theatre. The actual RBAC failure here is "I gave my VA `member` role and they can edit every deal." Fix the role-level gating first. Per-record only earns its complexity when teams reach ~10 people with overlapping but non-equal jurisdictions (acquisitions specialists per region, sales reps with portfolio territories). AcreOS ICP today is a single Land Investor; the realistic upper bound through 12 months is ~5 seats per org. Don't ship Salesforce sharing rules for that audience.

If/when needed, the cheap version: a single `private` boolean on `leads`/`deals` that means "owner + assignedTo only." 1 column, one `WHERE` clause expansion in `getLeads`/`getDeals`, mirrors how Linear's "private issues" works. Defer until user research confirms demand. The expensive version (Salesforce-style sharing rules with role-hierarchy inheritance, manual share-grants, criteria-based shares) is a 6-month project; AcreOS is not there.

**One narrow exception worth considering now.** The `notes` table is the diary surface — founders capture deal commentary, customer relationship insights, often candid. A founder writing "John from Acme is pushing back hard, considering walking" doesn't want their VA reading it. A `private` boolean on `notes`, defaulting false, viewable only by `assignedTo` and `owner`, would address a specific real complaint. 1 column, one query change, ships in a half-day.

---

## 6. Audit-Trail Completeness for Role Events

Tracing every event class that should be in `audit_log`:

| Event | Captured? | Where |
|---|---|---|
| Member role change | **Yes** | `routes-organization.ts:888-901` writes a before/after audit row on `PATCH /api/team/:id/role`. Includes IP, UA. |
| Invitation create | **Yes** | `routes-organization.ts:1194-1208` writes a row per invite, includes the token in metadata. |
| Invitation revoke | **No** | `DELETE /api/organization/invitations/:id` (line 1230) updates `status='revoked'` with no audit row. |
| Invitation accept | **No** | `POST /api/organization/invitations/accept` (line 1251) inserts the team_members row and updates the invitation, no audit row on either. **A new team member appears with no recorded "join" event.** |
| Member deactivation (`isActive=false`) | **No endpoint exists.** | There is no `DELETE /api/team/:id` and no `PATCH /api/team/:id/active`. To deactivate a member today, you run SQL. SQL writes do not hit `audit_log`. |
| Member permission-array edit | **No endpoint, no audit.** | `teamMembers.permissions` jsonb field has no API surface. |
| Owner transfer | **No explicit endpoint.** | Done by patching one member's role to `owner` then demoting the previous owner. The two-step is auditable per-step but there is no atomic "transfer ownership" event with both rows in one record. |
| Permission-denied (403) | **No.** | None of `requirePermission`/`requireAdminOrAbove`/`requireOwner` write audit rows when they reject. Sam called this out at the org level; same gap here. RBAC denials are valuable telemetry — repeated 403s on `requirePermission("canDeleteLeads")` from a `member` role are either a UI bug (we showed them a delete button we shouldn't have) or a probe. Both worth knowing about. |
| Role-guard absence (the silent case) | **N/A** | Most mutating endpoints have no guard, so there's nothing to deny, so there's nothing to log. The audit row written *after* the mutation captures the event but not the absence of authorization. |

**Net:** the role-change audit is the model. Every other team-lifecycle event should follow it.

### Specific demote-to-member trace

Walking the audit trail today for "admin demotes a member from `admin` to `member`":
1. UI calls `PATCH /api/team/:id/role` with `{ role: "member" }`.
2. `requireAdminOrAbove()` runs — caller is admin/owner, passes.
3. `routes-organization.ts:881` validates owner-uniqueness — irrelevant here.
4. `storage.updateTeamMember(memberId, { role })` writes the row.
5. `storage.createAuditLogEntry` is called inside a try/catch with `/* non-fatal */` — line 901. **The audit row is best-effort.** If the audit write throws, the role change persists silently. Compare with the lead-edit audit at `routes-leads.ts:409` which is *not* try/wrapped — a failure there propagates. Audit semantics are inconsistent: some routes fail-closed, this one fails-open.
6. The audit row contains `{ before: { role: "admin" }, after: { role: "member" }, fields: ["role"] }`, IP, UA, action `"update"`, entityType `"team_member"`. Good — that's the right shape.

The single-line fix is to remove the swallow: let the audit-log write surface its error and roll back via the existing handler error path. SOC2 CC6.8 evidence requires an unforgeable trail; "best effort" trails fail real audits. (Sam's R5 separately argues the table should be append-only at the DB layer. Both fixes ship together.)

### One audit footgun

`changes.before` in the role-change audit (line 896) only captures `role`, not `permissions` or `isActive`. If a future patch starts updating multiple columns through the same endpoint, the diff will silently drop fields. Recommend writing the full row before/after (mirrors the lead update at `routes-leads.ts:415`) and computing the field-list from `Object.keys(validated)`.

---

## 7. The 1-2 Week RBAC Hardening Sprint

Order is dependency-first; each item is the smallest thing that closes a real gap. Total ≈ 9 dev-days, fits one sprint.

1. **Reconcile the role taxonomy.** Pick one of two paths and delete the other:
   (a) **Adopt the 6-role schema.** Extend `ROLE_PERMISSIONS` in `utils/permissions.ts` to include real matrices for `acquisitions`, `marketing`, `finance`. Drop `viewer` (or define it). Update `ROLES` to match. Delete `middleware/roleGuard.ts` (its model is fine but its exports are unused — fold the 6-role intent into the live module).
   (b) **Adopt the 4-role pragmatic model.** Update `shared/schema.ts:124` comment to `owner | admin | member | viewer`. Update the invitation enum at `routes-organization.ts:1126` to match. Add a one-shot migration that maps existing rows: `acquisitions → member`, `marketing → member`, `finance → admin` (judgment call). Document that role granularity is deferred until 5+ seat orgs are common.
   **Recommendation: (b).** AcreOS ICP doesn't need 6 roles. 4 covers the founder + VA + bookkeeper + read-only-investor case. 0.5 day for (b), 2 days for (a).

2. **Gate `PUT /api/leads/:id` with `requirePermission("canEditLeads")`.** And `POST /api/deals`, `PUT /api/deals/:id`, `POST /api/deals/:id/enrich`, the bulk endpoints, the per-lead AI scoring/conversion/nurture endpoints. Audit every route file; the rule is: any verb that is not `GET` should have *some* `requirePermission` or `requireAdminOrAbove` call. 1 day.

3. **Gate org settings.** `PATCH /api/organization`, `PATCH /api/organization/ai-settings`, `PATCH /api/organization/settings` should be `requireAdminOrAbove()`. Currently any team member can rename the org. 1 hr.

4. **Build `DELETE /api/team/:id` (deactivate, not hard-delete).** Soft-deactivate by `isActive=false`. Gate with `requireAdminOrAbove()`. Forbid deactivating the last `owner`. Write an audit row (mirror the role-change audit). 0.5 day.

5. **Switch `getOrCreateOrg` to recheck `isActive` on the resolved org.** If the user's `team_members` row in the resolved org has `isActive=false`, treat them as not-a-member: 403 (or fall through to the next active org). Currently a deactivated owner of their primary org keeps full access because `getOrCreateOrg` doesn't consult `team_members.isActive` for owner-resolved orgs. 0.5 day.

6. **Honor `viewOnlyAssignedLeads`.** In `storage.getLeads` and `getLeadsPaginated`, accept an `onlyAssignedTo?: number` filter; in `routes-leads.ts:73`, when `permissionContext.permissions.viewOnlyAssignedLeads === true`, pass the caller's `teamMemberId`. Same for `getDeals`. Today this flag is decoration. 0.5 day.

7. **Add the missing role-event audit hooks.** Audit row on invite-accept (creates a team_members row), invite-revoke, member-deactivate, owner-transfer (special two-step transaction with one combined audit row). 0.5 day.

8. **Audit permission denials.** In `requirePermission`, `requireAdminOrAbove`, `requireOwner`, write a row to `audit_log` (or a new lighter `permission_denials` table) before sending 403. Capture path, role, requiredPermission, IP. 0.5 day.

9. **Build `PUT /api/users/active-organization`** (or equivalent cookie/header). Persist `users.activeOrganizationId` (new column) or set a signed cookie. `getOrCreateOrg` reads it preferentially over the first-owner-then-first-member scan. Membership is verified on every request. Without this, multi-org users can't reliably operate in either org. 1 day.

10. **Adopt `crossOrgAdminGuard` everywhere `:orgId` appears in a route path.** Sam already specced this; from an RBAC angle, the same logic should apply to any `:teamMemberId` URL path: assert the team member's `organizationId` matches the auth-resolved org before any storage call. 0.5 day.

11. **Delete `teamMembers.permissions` (jsonb) until it has consumers.** Or wire it: extend `getUserPermissionContext` to overlay the array on top of the role matrix (e.g. row-level grants like `"canExportData"` for one specific member). Schema fields with no readers rot — either give it teeth or drop it before it ships in someone's data export. 0.5 day either direction.

12. **Regression tests.** For each of the new gates: a non-admin member calling the endpoint must 403; an admin must 200. Sam asked for a regression test on R1; this sprint adds ~12 more in the same shape. 1 day.

**Reviewer rotation.** Items 1, 5, 9 reviewed by whoever owns auth/session (these change identity resolution). Items 2, 3, 6 reviewed by whoever owns the API surface. Items 4, 7, 8, 10, 12 reviewed by Liana. Item 11 is a product call — Thomas decides.

### What ships on day 1, day 7, day 14

- **Day 1**: items 1 (taxonomy reconciliation, path b) + 3 (org-settings gating). The smallest set that fixes the most-public lies. The role picker stops listing options that don't enforce. Org rename stops being a `member` capability.
- **Day 7**: items 2, 4, 5, 6, 7, 8 land. This is the substantive sprint output: every mutating endpoint has a guard, deactivate works, deactivation is a real control, the `viewOnlyAssignedLeads` flag earns its name, role-event audit is comprehensive, denials are logged. After day 7, the marketing claim "your VA can only do what you let them do" is technically true.
- **Day 14**: items 9, 10, 11, 12. The structural cleanup — multi-org switcher, cross-org guard adoption, jsonb permissions resolution, regression tests. This is where the work moves from "fixed today's bugs" to "won't introduce tomorrow's."

### What's explicitly NOT in this sprint

- Per-record permissions beyond the optional `notes.private` flag (§5).
- Owner transfer atomicity (the two-step approach is fine for now; one annotation tying both rows together via `metadata.transferEventId` is a 1-line follow-up).
- Real-time invalidation when a role changes mid-session. Today a demoted user keeps their cached frontend role until they refresh. Acceptable; their next API call 403s.
- Replacing the email-based founder check with a database role. Sam's R1 fix is sufficient; a deeper redesign of `req.isFounder` is a separate audit.
- Salesforce-style sharing rules. Defer until you have a customer with 10+ seats asking for them.

---

## 8. Quick-Reference: What Each Role Can Actually Do Today

For Thomas's reference, the *operational* truth — not the schema's promise:

| Action | owner | admin | member | viewer | acquisitions* | marketing* | finance* |
|---|---|---|---|---|---|---|---|
| View leads | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create lead | ✓ | ✓ | ✓ | ✗ (matrix) / ✓ (no PUT guard) | ≡ member | ≡ member | ≡ member |
| Edit lead via `PUT /api/leads/:id` | ✓ | ✓ | ✓ | **✓ (UNGATED — bug)** | ✓ | ✓ | ✓ |
| Delete lead | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Edit deal | ✓ | ✓ | ✓ | **✓ (UNGATED — bug)** | ✓ | ✓ | ✓ |
| Rename org | ✓ | ✓ | **✓ (UNGATED — bug)** | **✓ (UNGATED — bug)** | ✓ | ✓ | ✓ |
| Manage billing | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Invite team | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Change roles | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Delete team member | **✗ — no endpoint exists** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Transfer ownership | ✓ (2-step) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Export data | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Configure AI settings | ✓ | ✓ | **✓ (UNGATED)** | **✓ (UNGATED)** | ✓ | ✓ | ✓ |

*The starred roles silently behave as `member` because `getPermissionsForRole` falls them through.

The four entries in **bold** are the real RBAC bugs at the in-tenant layer. Items 2 and 3 of the sprint plan close them. After this sprint, the table above becomes the spec rather than the audit finding.

---

## Closing Note

The honest read on AcreOS RBAC is that it was scaffolded twice — once with the six-role intent in `roleGuard.ts`, once with the four-role pragmatic matrix in `utils/permissions.ts` — and then production shipped on whichever was easiest to import at the moment. That left the schema documenting one taxonomy, the runtime enforcing another, and the invitation form offering a third. Customers don't notice today because the typical org has 1 team member (the founder). The bug surfaces the first time a customer adds their VA and assigns them a role that feels protective ("marketing — they shouldn't see deal financials") and then watches the VA edit a deal anyway.

Sam's R1 is the headline because it crosses tenants. The findings here don't cross tenants — they erode the in-tenant separation customers expected when they invited someone in. For a product that wants to graduate from "founder tool" to "small team tool," that erosion is the next R1. Fix the role taxonomy and the `PUT`-without-a-guard pattern in this sprint, before the first 3-person customer hits onboarding and wonders why the role picker has six options that all do the same thing.

A working principle for the remediation: **the role on the row should fully describe what that user can do, with no other context required.** Today, "what a user can do" is a function of (their role) × (which endpoints have a guard) × (whether their org is theirs or one they were invited to) × (whether the founder bypass triggers). That's four variables for what should be one. Collapse to one. Every endpoint runs `requirePermission(...)`. Every role's matrix is real. Every membership is single-tenant explicit. Every founder action is logged. After that, RBAC is a feature you can ship to customers; until then, it's a defaults document with mostly-honored conventions.
