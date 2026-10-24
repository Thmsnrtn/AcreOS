# INTEGRATION-D2e: proposals for files this lane does not own

Lane D2e (purpose ledger: census, transaction memo, taxonomy input). The integrator applies these
patches in order. **No shared file was edited by this lane.** Every patch below is a proposal.

Status of each patch:

| # | Patch | Files | Gate |
|---|---|---|---|
| P0 | **Neutral data-handling fix:** strip secret columns from the `get_lead_details` model context | `server/ai/tools.ts` | none. Ship alone and first (CLAUDE.md: security fixes ship alone, worded neutrally) |
| P1 | Lead-contact release helper + new surface codes | `server/services/purposeLedger.ts` (lane-owned, **held** until P2 lands so the export is not unwired) | taxonomy: attorney input (codes are provisional) |
| P2 | Ledger `GET /api/leads/:id` (gap a) | `server/routes-leads.ts` | P1 |
| P3 | Ledger the Pax tools `get_lead_details` / `get_leads` (gap a) | `server/ai/tools.ts` | P1 |
| P4 | Census bookkeeping for P2/P3 | `tests/unit/purposeLedgerCensus.test.ts`, `tests/unit/purposeLedger.test.ts` | with P2/P3 |
| P5 | One transaction for debit + purpose row (gap b) | `server/routes-skip-tracing.ts` | **COO (metering path)**: see `purpose-ledger-metering-transaction.md`, Option B |
| P6 | Census `job` unit kind (async export jobs) | `tests/unit/purposeLedgerCensus.test.ts` | none (next lane) |

No DDL or migrations are proposed. P1–P4 fit the existing `purpose_ledger` columns: `lead_id`,
`skip_trace_id` and `surface` already exist.

---

## P0: `get_lead_details` puts secret columns into the model context

**Finding (from reading the code).** `case "get_lead_details"` in `server/ai/tools.ts` returns
`{ ...lead, … }`, which is the whole row. The HTTP response guard
(`server/middleware/secretColumnGuard.ts`) only strips JSON *responses*. A tool result goes to
the model through `serializeToolResultForModel` (`server/ai/untrustedEnvelope.ts:208`), which
strips nothing. So the registered secret columns `leads.taxId` (ciphertext, "anywhere") and
`leads.taxIdType` reach the model provider. `GET /api/leads/:id` already applies
`omitSecretColumns(leads, lead)`. This patch does the same on the tool path.

```diff
--- a/server/ai/tools.ts
+++ b/server/ai/tools.ts
@@ case "get_lead_details": {
         const { leadReachabilityForPax } = await import("../services/paxLeadReachability");
+        const { omitSecretColumns } = await import("../utils/secretColumns");
+        const { leads: leadsTable } = await import("@shared/schema");
         const lead = await storage.getLead(org.id, args.lead_id);
         if (!lead) return toolRefusal({ … unchanged … });
         return { success: true, data: {
-          ...lead,
+          ...omitSecretColumns(leadsTable, lead),
           name: `${lead.firstName} ${lead.lastName}`,
           reachability: leadReachabilityForPax(lead),
         }};
```

Test: add a case to an existing Pax tool test asserting `"taxId" in result.data === false` for a
lead fixture that has `taxId` set. Falsify it by reverting the spread and watching the test fail.
A wider follow-up is worth a separate ticket: run every tool result through `stripSecretColumns`
inside `serializeToolResultForModel`, which would make it a backstop for the whole population,
the same role the response guard plays for HTTP.

---

## P1: `releaseLeadContact` + provisional surface codes (`server/services/purposeLedger.ts`)

This lane owns the file, but the change is **held**. Adding an export with no production caller
trips the reachability ratchet, so it lands in the same commit as P2/P3.

Design: a lead's phone and email may have been **copied from a skip trace**
(`persistTraceResult` → `storage.updateLead`, `server/routes-skip-tracing.ts:322`). For each lead
being returned, the helper checks whether its current phone or email appears in one of that
lead's stored trace results:

- **If so,** the read releases skip-trace-derived data. It writes one row per lead on the given
  surface, carrying the purpose recorded when the trace was run, **before** anything is returned.
- **If the trace recorded no purpose,** the copied fields are withheld. This mirrors
  `releaseSkipTraceResults`.
- **If the contact data matches no trace,** it is the customer's own data (typed or imported),
  and no row is written. Whether that also needs a purpose is attorney question 11
  (`purpose-taxonomy-attorney-input.md`). This patch does not decide it.

```diff
--- a/server/services/purposeLedger.ts
+++ b/server/services/purposeLedger.ts
@@
-export const PURPOSE_SURFACES = ["skip_trace_call", "skip_trace_result_read", "owner_contact_lookup"] as const;
+export const PURPOSE_SURFACES = [
+  "skip_trace_call",
+  "skip_trace_result_read",
+  "owner_contact_lookup",
+  // Provisional (census proposals; attorney-review input): skip-trace-derived
+  // contact data released through a lead read.
+  "lead_contact_read",
+  "lead_contact_model",
+] as const;
@@ (after releaseSkipTraceResults)
+/** The contact part of a lead, and the stored traces that may have supplied it. */
+interface LeadContact {
+  id: number;
+  phone?: string | null;
+  email?: string | null;
+}
+interface TraceForLead extends StoredTrace {
+  results?: { phones?: Array<{ number: string }>; emails?: Array<{ email: string }> } | null;
+}
+const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
+const WITHHELD_CONTACT = "Contact withheld: it came from a skip trace run without a recorded permissible purpose.";
+
+/**
+ * lead_contact_read / lead_contact_model. A lead whose phone or email came
+ * from a stored skip trace releases it only with that trace's recorded
+ * purpose, one ledger row per lead, all written BEFORE anything is returned;
+ * a trace with no purpose has the copied fields withheld. Contact data that
+ * matches no trace is the customer's own and writes nothing.
+ */
+export async function releaseLeadContact<T extends LeadContact>(
+  organizationId: number,
+  actorUserId: string,
+  surface: "lead_contact_read" | "lead_contact_model",
+  leads: T[],
+  tracesFor: (leadIds: number[]) => Promise<TraceForLead[]>,
+  insertMany: (rows: PurposeEntry[]) => Promise<number> = insertPurposeRows,
+): Promise<Array<T & { contactWithheld?: string }>> {
+  if (leads.length === 0) return leads;
+  const traces = await tracesFor(leads.map((l) => l.id));
+  const toRecord: PurposeEntry[] = [];
+  const out = leads.map((l) => {
+    const mine = traces.filter((t) => t.leadId === l.id && t.results);
+    const phoneFrom = mine.find((t) => l.phone && t.results?.phones?.some((p) => digits(p.number) === digits(l.phone)));
+    const emailFrom = mine.find((t) => l.email && t.results?.emails?.some((e) => e.email.toLowerCase() === l.email?.toLowerCase()));
+    const source = phoneFrom ?? emailFrom;
+    if (!source) return l;
+    if (!source.purposeOfUse || !PURPOSE_CODES.includes(source.purposeOfUse)) {
+      return { ...l, phone: phoneFrom ? null : l.phone, email: emailFrom ? null : l.email, contactWithheld: WITHHELD_CONTACT };
+    }
+    toRecord.push({
+      organizationId, actorUserId, surface, purposeCode: source.purposeOfUse,
+      justification: source.justification ?? null, attestationVersion: source.attestationVersion ?? null,
+      leadId: l.id, skipTraceId: source.id,
+    });
+    return l;
+  });
+  if (toRecord.length === 0) return out;
+  for (const e of toRecord) assertPurpose(e);
+  const written = await insertMany(toRecord);
+  if (written !== toRecord.length) throw new PurposeRequiredError(`the purpose ledger confirmed ${written} of ${toRecord.length} rows — the read is refused`);
+  return out;
+}
```

Tests to add in `tests/unit/purposeLedger.test.ts`, with an injected `tracesFor` and `insertMany`:

- a traced phone with a purpose writes exactly one row with `skipTraceId`;
- a traced phone without a purpose comes back `phone: null` with `contactWithheld`;
- a customer-typed phone writes nothing;
- the ledger confirming fewer rows than expected throws;
- update the `PURPOSE_SURFACES` pin to the five entries.

---

## P2: ledger `GET /api/leads/:id` (`server/routes-leads.ts:381`)

```diff
--- a/server/routes-leads.ts
+++ b/server/routes-leads.ts
@@
-import { recordPurpose, releaseSkipTraceResults, type PurposeReceipt } from "./services/purposeLedger";
+import { recordPurpose, releaseLeadContact, releaseSkipTraceResults, type PurposeReceipt } from "./services/purposeLedger";
@@ api.get("/api/leads/:id", …
     const lead = await storage.getLead(org.id, leadId);
     if (!lead) return Errors.notFound(res, "Lead");
-    // Lead responses omit tax identity (ciphertext TIN and its type); the
-    // 1099/1098 paths read them server-side.
-    res.json(omitSecretColumns(leads, lead));
+    // Lead responses omit tax identity (ciphertext TIN and its type); the
+    // 1099/1098 paths read them server-side. D2e: skip-trace-derived contact
+    // data is released only with its recorded purpose (lead_contact_read).
+    try {
+      const [released] = await releaseLeadContact(org.id, getUserId(req), "lead_contact_read", [lead], async () => storage.getSkipTraceByLead(org.id, leadId).then((t) => (t ? [t] : [])));
+      res.json(omitSecretColumns(leads, released));
+    } catch (err) {
+      logger.warn("Lead read refused: purpose ledger write failed", { metadata: { organizationId: org.id, leadId, error: err instanceof Error ? err.message : String(err) } });
+      return Errors.serviceUnavailable(res, "This lead's traced contact details could not be recorded, so they were not shown.");
+    }
   });
```

Before applying, check the signature of `storage.getSkipTraceByLead(orgId, leadId)` (it is used
once today, in `GET /api/skip-traces/lead/:leadId`). If a lead can have several traces, use
`storage.getSkipTraces(org.id)` filtered by `leadId`. The handler does not currently use
`getUserId(req)`. Its request type is `AuthenticatedRequest`, through the existing `api.get`
typing in this file.

---

## P3: ledger the Pax tools (`server/ai/tools.ts`)

The actor is `options?.userId`. Without a signed-in actor, `assertPurpose` refuses (fail closed),
so a `userId`-less automated caller gets a refusal and no contact data. `get_lead_details` keeps
P0's `omitSecretColumns`.

```diff
@@ case "get_leads": {
-        return { success: true, data: filtered.map(l => ({
+        const { releaseLeadContact } = await import("../services/purposeLedger");
+        const actor = options?.userId;
+        if (!actor) return toolRefusal({ what: "Lead contact details were not read", why: "No signed-in person is attached to this request, and every read of traced contact data records who read it", unlock: "Ask again from a signed-in session" });
+        const traces = await storage.getSkipTraces(org.id);
+        filtered = await releaseLeadContact(org.id, actor, "lead_contact_model", filtered, async (ids) => traces.filter((t) => t.leadId != null && ids.includes(t.leadId)));
+        return { success: true, data: filtered.map(l => ({
@@ case "get_lead_details": {
         const lead = await storage.getLead(org.id, args.lead_id);
         if (!lead) return toolRefusal({ … });
+        const { releaseLeadContact } = await import("../services/purposeLedger");
+        const actor = options?.userId;
+        if (!actor) return toolRefusal({ what: "Lead contact details were not read", why: "No signed-in person is attached to this request, and every read of traced contact data records who read it", unlock: "Ask again from a signed-in session" });
+        const [released] = await releaseLeadContact(org.id, actor, "lead_contact_model", [lead], async () => (await storage.getSkipTraces(org.id)).filter((t) => t.leadId === lead.id));
         return { success: true, data: {
-          ...omitSecretColumns(leadsTable, lead),
+          ...omitSecretColumns(leadsTable, released),
```

A `releaseLeadContact` throw propagates to `executeTool`'s catch, so the tool fails closed. Check
that this catch reports a failure and not a success. `paxToolsReportRealEffects.test.ts` covers
this shape.

---

## P4: census bookkeeping (same commit as P2/P3)

In `tests/unit/purposeLedgerCensus.test.ts`:

- move `"server/routes-leads.ts route:GET /api/leads/:id"` from `DEBT` to `LEDGERED` as
  `"lead_contact_read"`, and move `"server/ai/tools.ts case:get_leads"` and
  `"server/ai/tools.ts case:get_lead_details"` to `LEDGERED` as `"lead_contact_model"`;
- lower `DEBT_BASELINE` from 214 to **211**;
- extend `LEDGER_WRITE` with `|\breleaseLeadContact\(`. Without this the census will not see the
  new doors as ledgered, and it will say so;
- update the LEDGERED-codes test's expected set to include the two new codes.

---

## P5: one transaction for debit + purpose row (COO-gated)

The decision is the COO's. This patch is ready to apply only if Option B is approved. The full
reasoning is in `purpose-ledger-metering-transaction.md`. Copy `PoolRefusal` from
`server/routes-outreach-mail.ts`, or import it if it is exported.

```diff
--- a/server/routes-skip-tracing.ts   (POST /trace/:leadId)
+++ b/server/routes-skip-tracing.ts
@@
-    const traceDebit = await poolDebit({ …unchanged args… });
-    if (!traceDebit.allowed) {
-      return Errors.limitExceeded(res, poolRefusalDetails("skip_trace", traceDebit));
-    }
-    const refundTrace = …
-    let purpose: PurposeReceipt;
-    try {
-      purpose = await recordPurpose({ …, meteringRef: `${traceKey}#${traceDebit.ledgerRowId ?? "no-debit"}` });
-    } catch (err) {
-      await refundTrace("Purpose ledger write failed — lookup refused");
-      logger.warn(…);
-      return Errors.serviceUnavailable(res, "This lookup could not be recorded, so it was not run. Nothing was charged.");
-    }
+    let traceDebit: PoolDebitResult;
+    let purpose: PurposeReceipt;
+    try {
+      ({ traceDebit, purpose } = await withTransaction(async (tx) => {
+        const d = await poolDebit({ …unchanged args…, tx });
+        if (!d.allowed) throw new PoolRefusal(d);
+        const p = await recordPurpose({ …, meteringRef: `${traceKey}#${d.ledgerRowId ?? "no-debit"}` }, tx);
+        return { traceDebit: d, purpose: p };
+      }));
+    } catch (err) {
+      if (err instanceof PoolRefusal) return Errors.limitExceeded(res, poolRefusalDetails("skip_trace", err.result));
+      logger.warn("[skip-trace] purpose ledger write failed; debit rolled back, lookup refused", { … });
+      return Errors.serviceUnavailable(res, "This lookup could not be recorded, so it was not run. Nothing was charged.");
+    }
+    if (traceDebit.fundedBy === "purchased_credits") {
+      const { creditService } = await import("./services/credits");
+      creditService.afterDebitCommitted(orgId);
+    }
+    const refundTrace = …   // unchanged; now used only for the vendor-failure legs
```

The batch door needs the per-lead-or-up-front choice (memo, item 6). Tests to add in
`tests/unit/routes-skip-tracing.test.ts`:

- a `recordPurpose` failure performs **no** `refundPoolDebit` and runs both calls on the same `tx`;
- a refused debit writes no purpose row;
- a purchased-credit debit calls `afterDebitCommitted` once, after commit.

---

## P6: census widening (`job` units), for the next lane

The census does not see async export jobs (`createExportJob` → `runExportJob` in
`server/services/migrationJobs.ts:1002` → `GET /api/export/jobs/:id/download`). Add a unit kind
for job registrations (`scheduleSelfRescheduling({ name, run })`, plus the export-job runner).
This lane deliberately left `run` out of `TOOL_HANDLER_PROPS` so that jobs are not miscounted
as tools. Add the runner's candidates to `DEBT` with `lead_contact_bulk`.
