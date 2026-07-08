# Jane Margolis — AcreOS, the court-restricted Land Investor

I'm Jane. Forty-six, Phoenix. I've been a Land Investor for nine years — small portfolio, mostly Maricopa and Pinal counties, infill lots and a few rural deserts. Three weeks ago, opposing counsel in a partnership-dissolution dispute walked into Maricopa County Superior Court and walked out with a temporary restraining order. The TRO doesn't say I'm guilty of anything. It says: **pending the May 22 hearing, I cannot transact, encumber, dispose of, or initiate new contracts on properties subject to the dissolution.** My lawyer says it'll lift in three weeks if I behave. My CPA says document everything. My judge, hypothetically, may want to read my records during the hearing.

What I need from AcreOS is something it doesn't have: **read-only mode that holds.** Not a dunning suspension, not a billing pause, not a cancellation. A *legal hold* — frozen for transactions, readable for records, with a court-grade audit trail and zero outbound communications until the order lifts.

---

## 1. Thirty-second verdict

AcreOS has the *primitives* to deliver court-ordered read-only mode and doesn't compose them. The audit log exists (`shared/schema.ts:4149`). The org-status enum exists (`subscriptionStatus`, `dunningStage` — `server/storage.ts:3338`). The simulated-actions pattern (`shared/schema.ts:4172`) already demonstrates how to short-circuit outbound side effects (Stripe, Lob, Twilio, SendGrid, paid AI) into a logged-but-unsent state. What's missing is a **`legalHold` org state** that wires those pieces together and is operated by a *different* control plane than billing — because a customer under a court order is not a delinquent customer, and conflating them is how products end up on the wrong side of a contempt hearing.

Three weeks of TRO has shown me three real failures: (1) I can still draft contracts and the system will happily prep them for sending; (2) my campaigns kept mailing for four days after the order because I forgot one toggle in `/campaigns`; (3) when my attorney asked for a read-only export of every action my account took during the restricted window, there is no such export — only the developer-facing audit log, which is not a document a judge will accept as-is.

---

## 2. The exact failure mode — Day 1 of the TRO

**Tuesday, 9:14 AM.** Order is signed. My attorney emails me the PDF at 11:02 AM. By the time I read it at 11:30, AcreOS has already:
- Sent two scheduled outbound mailers from a saved sequence (Lob postcards, $0.94 each, both to subject parcels)
- Auto-dialed a seller through the Twilio click-to-call I had queued
- Drafted and queued an offer in `/offer-wizard` that auto-sends at 1:00 PM
- Pushed a status update to my buyers' list via `/communications`

None of these were *me.* They were sequences and automations Pax was running on my behalf — exactly the agent-autonomy story AcreOS sells. And every one of them is a potential TRO violation. Not because the system did anything wrong; because the system has no concept of *"the human in charge has lost authority to act"* as distinct from *"the human in charge has stopped paying."*

The closest existing primitive is `dunningStage = 'restricted'` (org row state, `shared/schema.ts:26`), which limits some surfaces but doesn't kill outbound automations and doesn't write a court-grade trail. It's a billing tool dressed as a compliance tool. I need a compliance tool.

---

## 3. What "legal hold" should mean as a first-class state

Add `organizations.legalHold` as a structured field — not a boolean, a record:

```ts
legalHold: jsonb("legal_hold").$type<{
  active: boolean;
  reason: "court_order" | "regulatory" | "investigation" | "self_imposed";
  orderType?: "tro" | "preliminary_injunction" | "permanent" | "subpoena" | "freeze_order";
  orderingBody?: string;            // "Maricopa County Superior Court, AZ"
  caseNumber?: string;              // "CV2026-001234"
  scopeRestrictions: {
    transactionsBlocked: boolean;       // contracts, offers, dispositions
    communicationsBlocked: boolean;     // outbound mail, sms, email, calls
    encumbrancesBlocked: boolean;       // notes, liens, assignments
    newAcquisitionsBlocked: boolean;
    affectedParcelIds?: number[];       // partial-scope orders (most TROs)
    fullAccountFreeze?: boolean;        // when judge says "everything"
  };
  effectiveAt: string;
  expiresAt?: string;                   // hearing date or expiry
  documentUrl?: string;                 // signed-PDF storage of the order
  attorneyOfRecord?: { name; email; phone; barNumber };
  judgeReadOnlyToken?: string;          // narrow-scoped review token
  createdBy: "user" | "support" | "founder";
  liftedAt?: string;
  liftedBy?: string;
}>()
```

This is its own surface, not a dunning sub-state, and it is the **first thing every middleware, every job runner, and every outbound integration must check** before performing a write.

---

## 4. Read-only mode that actually holds

Today, AcreOS read-only is partial. Several routes still mutate when they shouldn't if `legalHold.active` is true. The fix is a thin guard at the route layer — call it `legalHoldGate(action: 'read'|'write'|'communicate'|'transact')` — sibling to `complianceGate.ts` (`server/middleware/complianceGate.ts`).

```ts
// server/middleware/legalHoldGate.ts (new)
export function legalHoldGate(action: "write" | "communicate" | "transact") {
  return async (req: AuthenticatedRequest, res, next) => {
    const org = getOrganization(req);
    const hold = org.legalHold;
    if (!hold?.active) return next();
    const blocked = (
      (action === "transact"   && hold.scopeRestrictions.transactionsBlocked) ||
      (action === "communicate" && hold.scopeRestrictions.communicationsBlocked) ||
      (action === "write"       && hold.scopeRestrictions.fullAccountFreeze)
    );
    if (!blocked) return next();
    await storage.createAuditLogEntry({
      organizationId: org.id,
      userId: getUserId(req),
      action: "legal_hold_block",
      entityType: action,
      entityId: 0,
      changes: { after: { route: req.path, method: req.method, hold } } as any,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return Errors.forbidden(res, `Account under ${hold.orderType?.toUpperCase()} — ${action} blocked. Case ${hold.caseNumber}.`);
  };
}
```

Wire it into the obvious routes: `routes-deals.ts` (POST/PUT/DELETE), `routes-communications.ts` (any send), `routes-public-sign.ts` (any signature send), `routes-deal-rooms.ts`, `routes-misc.ts` offers, `routes-import-export.ts` *imports* (exports must remain), every `/campaigns` and `/sequences` write. Reads pass through untouched — that's the whole point.

The shadcn `Banner` component should fire from `client/src/lib/legalHold.tsx` whenever `org.legalHold.active`, with red-amber tone (token-correct, no hardcoded colors per `CLAUDE.md`), action verbs disabled, and tooltip text quoting `caseNumber`. Every disabled button gets `aria-label="Disabled — account under court-ordered hold (case CV2026-001234)"` so screen readers can explain it.

---

## 5. Communication blocking — the part the system gets wrong

Outbound channels in AcreOS today: Lob (postcards, letters), Twilio (SMS, voice), SendGrid/Resend (email), Stripe (any charge), webhooks. Each has its own send path. Today only Stripe respects dunning state; Lob and Twilio do not respect anything except their own queues.

The fix is the existing `simulatedActions` table (`shared/schema.ts:4172`) repurposed as the **legal-hold sink**: when `legalHold.active && communicationsBlocked`, every outbound integration writes to `simulatedActions` with category `legal_hold_blocked` instead of dispatching. The producer code already has the branching logic — it just needs a second condition next to `isOrgSimulated(org)`:

```ts
if (isGlobalSimulationMode() || isOrgSimulated(org) || isOrgUnderCommHold(org)) {
  return recordSimulatedAction({ category: "lob", action: "postcards.create", payload, organizationId: org.id });
}
```

This must hit:
- `services/lobService.ts` — postcards, letters
- `services/twilioService.ts` (if exists) and the voice routes — SMS, voicemail drops, click-to-call
- `services/emailService.ts` — every transactional email *except* org-internal (security alerts, billing receipts, court-order confirmation emails to the user themselves)
- `routes-deal-rooms.ts` invites
- `routes-public-sign.ts` signature-request sends
- All Pax agent autonomy paths (`server/agents/*`) — this is the highest-risk surface; agents act *between* user sessions and an agent firing off a postcard during a TRO is the failure mode that ends careers

Equally important: **scheduled jobs must check on execution, not only on enqueue.** A campaign queued before the TRO that fires after must see `legalHold.active` and route to the simulated sink. Today, scheduledTasks (`shared/schema.ts:5787`) do not consult org-level holds at execution.

---

## 6. Audit trail of read-vs-write — court-grade export

The existing `auditLog` table records `create | update | delete | login | export | import` (`shared/schema.ts:4193`) but does not record *reads*. For most products this is correct (read traffic is too volumetric). For an account under court order, it is exactly wrong: my attorney needs to be able to say "between April 30 and May 22, the account was accessed for review purposes 47 times and performed zero writes."

When `legalHold.active`, the audit log enters **enhanced mode**:
- Every authenticated `GET` is logged with `action: 'view'`, `entityType`, `entityId`, ipAddress, userAgent, and timestamp.
- Every blocked write is logged with `action: 'legal_hold_block'` *and* the attempted payload (so the trail shows what would have happened).
- Every successful write that *was* permitted under the hold (e.g., uploading the order PDF, paying my own invoice) is logged with `action: 'permitted_during_hold'` and a reason.
- A daily summary row lands at midnight: counts of views, blocks, and permitted writes, signed with a hash of the prior day's row (Merkle-style, so any tampering is detectable).

Then build the **court-ready export**: `GET /api/legal-hold/export?caseNumber=…` returns a signed PDF with cover page (account name, hold metadata, case number, date range), per-day summary, full event ledger, hash chain, and a notarization-ready signature block. This is the document the judge gets. It is not the JSON audit log dump — it is a polished, paginated, header-and-footer artifact.

---

## 7. Court-ordered access — the judge / receiver / monitor token

A TRO sometimes appoints a special master, monitor, or receiver who needs to read the records but is not the account holder. AcreOS has no provision for this. Today the only way is to share my password, which is a different felony.

Add **scoped read-only tokens**:
- `POST /api/legal-hold/access-token` (legal-hold owner only) — issues a JWT with `org_id`, `scope: "read"`, `expires_at`, `purpose`, optional IP allowlist, optional parcel-id allowlist.
- The token surfaces a *separate* UI shell (`/legal-review/:token`) that's a stripped read-only view: dashboard, parcels, deals, communications history, audit trail. No sidebar, no Pax, no upgrade prompts, no founder personas (per the persona-architecture memory — judges absolutely do not see Sophie/Forge/Atlas).
- Every action under the token is logged with `userId: 'legal_review_token:<token-id>'` so the audit trail distinguishes account-holder reads from third-party reads.
- Tokens auto-expire on the hold's `expiresAt` and can be revoked by the account holder, the issuing attorney, or AcreOS support.

This is also useful outside court orders — investors with bookkeepers, attorneys, lenders doing diligence — but the court case is the forcing function.

---

## 8. Automated lift when the order resolves

The hold lifts when one of three things happens:
1. `expiresAt` passes (TROs have statutory limits — 14 days under FRCP 65(b), longer under state rules)
2. Account holder uploads a court order lifting or dissolving the hold
3. Founder/support manually lifts (with reason + audit row)

The lift is not silent. It is a state transition that:
- Sets `legalHold.active = false`, populates `liftedAt` / `liftedBy`, and *retains the entire prior `legalHold` record* in a history JSONB array (multiple TROs over a career is normal for active investors — this matters)
- Emails the account holder, attorney of record, and any active scoped-token holders
- Re-enables outbound integrations with a 24-hour quarantine: every queued outbound action that was blocked during the hold goes into a review queue, not auto-fired. The investor reviews and approves each one. (Auto-firing 47 postcards the moment a TRO lifts is a great way to look like you were acting in bad faith.)
- Generates a closing audit summary PDF — the bookend to the export from §6.

The TRO's statutory 14-day expiry should auto-warn at 48 hours: "Your court hold expires May 14 unless extended. Upload a renewal order to maintain the hold, or it will lift automatically."

---

## 9. Things AcreOS today gets *almost* right

- **Audit log foundation** (`shared/schema.ts:4149`) is the right shape — org-scoped, action-typed, before/after JSONB, IP and UA captured. The pieces missing are read-logging, hash chaining, and the export artifact.
- **Simulated actions pattern** (`shared/schema.ts:4172`) is exactly the abstraction needed for comms-blocking. It already short-circuits Stripe, Lob, Twilio, SendGrid, paid AI, webhooks. Adding `legal_hold_blocked` as a category is one row in the enum.
- **Compliance gate** (`server/middleware/complianceGate.ts`) demonstrates the route-middleware pattern for blocking writes with audit fallback. `legalHoldGate` should follow the same shape but be *strict-by-default* — there is no "warning mode" for a court order.
- **Dunning state machine** (`server/storage.ts:3338`, `routes-admin.ts:3297`) shows the right operator-side surfaces: filter orgs by state, generate alerts, prioritize attention. A court-hold dashboard should mirror it but live under support/legal, not billing.
- **Founder bypass** (`organizations.isFounder`, `shared/schema.ts:36`) is correct — a founder must be able to do everything, including in test scenarios, including read across orgs to help an investor in court trouble.

---

## 10. Things AcreOS today gets wrong for this case

- **Pax autonomy** (`paxAutonomyLevel`, `shared/schema.ts:96`) defaults to `assisted` and can run as `autonomous`. There is no logic that downgrades autonomy under hold. An autonomous Pax during a TRO is a litigation grenade.
- **Scheduled tasks** (`shared/schema.ts:5787`) do not check legal-hold state at fire time, only at enqueue.
- **Campaign sequences** (`/campaigns`, `/sequences`) live in their own scheduling layer and need the same fire-time check.
- **No read-logging.** Today the audit log is mute about reads. Court compliance needs the opposite default.
- **No structured legal-hold field.** The `dunningStage = 'restricted'` overload is a billing concept being asked to do a legal job, and it will fail in court.
- **No third-party read tokens.** The product has API tokens for integrations and shareable-link tokens for deal rooms; no narrow-scoped *read-only-everything-this-account-can-see* token for legal review.
- **No quarantine queue on lift.** When a hold ends, the queued outbound actions need human review, not auto-resume.
- **Persona surfaces** (Sophie, Forge, Atlas, etc., per persona-architecture memory) must be invisible to legal-review tokens. A judge reading "Forge recommends aggressive disposition" will not improve my hearing outcome. The persona-gate already exists for customers; it needs to extend to scoped tokens.

---

## 11. Pricing and access

Court-restricted is not a tier; it's a state any tier can enter. Read-only mode under hold should bill at **50% of the active tier rate** (it's a real product still serving the customer, but the customer cannot use the value-creation features). The court-ready export should be free — charging an investor for the document their judge requires is the worst possible billing optic. Scoped review tokens included unlimited.

When the hold lifts, billing returns to full. If the hold lasts past a billing cycle and the customer wants to cancel rather than resume, the cancel flow must produce the same court-grade export automatically — because the records are the most valuable thing the customer has at that moment, and losing them to a cancellation is the failure that ends the relationship.

---

## 12. Bottom line

A Land Investor under a temporary restraining order is a customer AcreOS will encounter — partnership disputes, divorce orders, regulatory inquiries, lis pendens, IRS levies, and ordinary creditor freeze orders all produce the same operational shape. The product has every primitive needed (audit log, simulated-actions sink, dunning state machine, compliance gate, scoped tokens elsewhere) and has not composed them into the one feature that matters: a structured, auditable, court-defensible read-only mode with outbound communications hard-blocked, scoped third-party read access, hash-chained audit trail, court-ready export, and a controlled lift with quarantine review.

Build `organizations.legalHold` as a first-class state, ship `legalHoldGate` middleware, extend `simulatedActions` to absorb all outbound during hold, add read-logging in enhanced mode, ship the export PDF, ship scoped review tokens, and gate the lift behind a quarantine queue. Three sprints, large defensibility win, and the only feature in this category any Land-Investor product currently offers.
