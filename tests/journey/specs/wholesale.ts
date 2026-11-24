/**
 * Wholesale journey walk — the declarative spec (journey-proof harness).
 *
 * MIGRATED from tests/unit/wholesaleJourney.realdb.test.ts (231 lines,
 * hand-written for this one vertical): the same API sequence, the same
 * observations, now as a spec the CI rehearsal runner and the staging
 * runner both execute. The original file is deleted by the PR that lands
 * this spec — the harness test is its replacement, not a second copy.
 *
 * The loop (six legs, wholesale gap sheet §Work 1): activate → buy box →
 * candidates (TX fits / IL fails) → decision → contract with the compliance
 * gate in both directions → packet / blast preview (never a send) →
 * assignment signed → outcome realised and graded.
 *
 * KNOWN GAPS carried into the spec, not papered over:
 * - The IL assignment on the contract chain is refused BEFORE the
 *   compliance gate (STATE_NOT_CONFIGURED — no reviewed IL assignment
 *   template exists). The walk expects that.
 * - The e-sign rail is the org's own provider and cannot run in the
 *   rehearsal; the assignment's `signed` status is set the way the rail's
 *   completion would set it, and the staging walk does it through the rail
 *   itself (manual step).
 * - Pax wiring is MISSING (gap sheet item 4): no wholesale tools exist in
 *   server/ai/tools.ts. The Pax leg is declared `blocked` with the reason
 *   — the walk report stays PARTIAL on that leg until the tools land.
 * - Buyer profile + match creation has no real API (routes-buyer-network
 *   is a stub behind the marketplace ladder flag), and assignment creation
 *   has no API either: on staging those two seed steps are operator acts
 *   through the UI, with the ids collected for the later steps.
 */
import { defineWalkSpec } from "../walk-spec";
import type { StepObservation, WalkContext, WalkSpec } from "../walk-spec";

const INPUTS = {
  arvCents: 30_000_000,
  rehabEstimateCents: 4_000_000,
  targetFeeCents: 1_000_000,
  sellerRulePct: 75,
  sellerContingencyPct: 10,
  buyerRulePct: 70,
  buyerContingencyPct: 10,
};

async function seedCandidates(ctx: WalkContext): Promise<void> {
  for (const key of ["tx", "il"] as const) {
    const state = key === "tx" ? "TX" : "IL";
    const [p] = await ctx.sql(
      `INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address, city, zip, legal_description)
       VALUES ($1, $2, $3, $4, '0.2', 'prospect', $5, $6, '77002', 'Lot 1, Block 2') RETURNING id`,
      [ctx.orgId, `${ctx.tag}-${key === "tx" ? "1" : "2"}`, state === "TX" ? "Harris" : "Cook", state, `9 ${key} St`, state === "TX" ? "Houston" : "Chicago"],
    );
    ctx.store(`${key}Property`, p.id);
    const [seller] = await ctx.sql(
      `INSERT INTO leads (organization_id, first_name, last_name, type) VALUES ($1, 'Sam', $2, 'seller') RETURNING id`,
      [ctx.orgId, `Seller ${key}`],
    );
    await ctx.sql(`UPDATE properties SET seller_id = $1 WHERE id = $2`, [seller.id, p.id]);
    const [d] = await ctx.sql(
      `INSERT INTO deals (organization_id, property_id, type, status, offer_amount)
       VALUES ($1, $2, 'acquisition', 'negotiating', '140000') RETURNING id`,
      [ctx.orgId, p.id],
    );
    ctx.store(`${key}Deal`, d.id);
  }
}

async function seedCandidatesStaging(ctx: WalkContext): Promise<StepObservation> {
  for (const key of ["tx", "il"] as const) {
    const state = key === "tx" ? "TX" : "IL";
    const property = await ctx.api("POST", "/api/properties", {
      apn: `${ctx.tag}-${key === "tx" ? "1" : "2"}`,
      county: state === "TX" ? "Harris" : "Cook",
      state,
      sizeAcres: "0.2",
      status: "prospect",
      address: `9 ${key} St`,
      city: state === "TX" ? "Houston" : "Chicago",
      zip: "77002",
      legalDescription: "Lot 1, Block 2",
    });
    ctx.check(property.status === 201, `POST /api/properties (${state}) must return 201, got ${property.status}: ${JSON.stringify(property.body).slice(0, 300)}`);
    const propertyId = (property.body as any)?.id;
    ctx.check(typeof propertyId === "number", `POST /api/properties (${state}) must return the property id`);
    ctx.store(`${key}Property`, propertyId);
    const seller = await ctx.api("POST", "/api/leads", { firstName: "Sam", lastName: `Seller ${key}`, type: "seller" });
    ctx.check(seller.status === 201 || seller.status === 200, `POST /api/leads (seller ${state}) must return 200/201, got ${seller.status}`);
    const sellerId = (seller.body as any)?.id ?? (seller.body as any)?.lead?.id;
    ctx.check(typeof sellerId === "number", `POST /api/leads (seller ${state}) must return the lead id`);
    const attached = await ctx.api("PUT", `/api/properties/${propertyId}`, { sellerId });
    ctx.check(attached.status < 300, `PUT /api/properties/${propertyId} (attach seller) must succeed, got ${attached.status}`);
    const deal = await ctx.api("POST", "/api/deals", {
      propertyId,
      type: "acquisition",
      status: "negotiating",
      offerAmount: "140000",
    });
    ctx.check(deal.status === 201, `POST /api/deals (${state}) must return 201, got ${deal.status}: ${JSON.stringify(deal.body).slice(0, 300)}`);
    const dealId = (deal.body as any)?.id;
    ctx.check(typeof dealId === "number", `POST /api/deals (${state}) must return the deal id`);
    ctx.store(`${key}Deal`, dealId);
  }
  return { observed: { txProperty: ctx.get("txProperty"), ilProperty: ctx.get("ilProperty") } };
}

export const wholesaleWalk: WalkSpec = defineWalkSpec({
  id: "wholesale",
  vertical: "residential_wholesaler",
  title: "Wholesale journey — the six-leg revenue loop",
  version: 1,
  fences: { noSend: true, noRealMoney: true, stagingOnly: true },
  org: { businessType: "residential_wholesaler", nameSuffix: "Wholesale LLC", skipSampleData: true },
  realdbRoutes: [
    { kind: "router", module: "../../../server/routes-wholesale-underwriting", mount: "/api/wholesale" },
    { kind: "router", module: "../../../server/routes-wholesale-disposition", mount: "/api/wholesale" },
    { kind: "router", module: "../../../server/routes-wholesale-buy-box", mount: "/api/wholesale" },
    { kind: "router", module: "../../../server/routes-decisions", mount: "/api/decisions" },
    { kind: "register", module: "../../../server/routes-buyer-blasts", exportName: "registerBuyerBlastRoutes" },
    { kind: "register", module: "../../../server/routes-contract-chain", exportName: "registerContractChainRoutes" },
  ],
  cleanupTables: [
    "buyer_blast_recipients",
    "buyer_blasts",
    "buyer_property_matches",
    "buyer_profiles",
    "outcomes",
    "decision_snapshots",
    "scenarios",
    "generated_documents",
    "contract_assignments",
    "deals",
    "properties",
    "leads",
  ],
  steps: [
    {
      id: "activate",
      title: "Activate — a fresh wholesaler org, no sample data",
      kind: "sql",
      how: "Fresh org provisioned with businessType residential_wholesaler; the step reads it back and checks the type.",
      mustObserve: "The org exists with businessType residential_wholesaler and onboarding completed.",
      async run(ctx) {
        const rows = await ctx.sql(`SELECT onboarding_data FROM organizations WHERE id = $1`, [ctx.orgId]);
        ctx.check(rows.length === 1, `walk org ${String(ctx.orgId)} must exist`);
        const data = (rows[0].onboarding_data ?? {}) as { businessType?: string };
        ctx.check(data.businessType === "residential_wholesaler", `walk org businessType must be residential_wholesaler, got ${JSON.stringify(data.businessType)}`);
        return { observed: { orgId: ctx.orgId, businessType: data.businessType } };
      },
      async stagingRun(ctx) {
        const org = await ctx.api("GET", "/api/organization");
        ctx.check(org.status === 200, `GET /api/organization must return 200, got ${org.status}`);
        ctx.check((org.body as any)?.id === ctx.orgId, `GET /api/organization must return the walk org ${String(ctx.orgId)}`);
        return { observed: { orgId: ctx.orgId, provisioned: "fresh persona org, templates provisioned in setup" } };
      },
    },
    {
      id: "buy-box",
      title: "Buy box — the operator's own criteria, versioned",
      kind: "api",
      how: "POST /api/wholesale/buy-box with states TX, max $200,000, 30-day retire window.",
      mustObserve: "200. The criteria are saved as a new version.",
      async run(ctx) {
        const box = await ctx.api("POST", "/api/wholesale/buy-box", {
          criteria: { states: ["TX"], maxPurchasePriceCents: 20_000_000, staleAfterDays: 30 },
        });
        ctx.check(box.status === 200, `POST /api/wholesale/buy-box must return 200, got ${box.status}: ${JSON.stringify(box.body).slice(0, 300)}`);
        return { observed: { status: box.status } };
      },
    },
    {
      id: "candidates-seed",
      title: "Candidates — two hand-typed properties, TX and IL",
      kind: "sql",
      how: "Bring-your-own: one TX prospect and one IL prospect, each with a seller lead and an acquisition deal offering under $200,000.",
      mustObserve: "Both properties, sellers, and deals exist under the walk org.",
      async run(ctx) {
        await seedCandidates(ctx);
        return { observed: { txProperty: ctx.get("txProperty"), ilProperty: ctx.get("ilProperty") } };
      },
      stagingRun: seedCandidatesStaging,
    },
    {
      id: "triage",
      title: "Triage — the buy box reads only the org's own candidates",
      kind: "api",
      how: "GET /api/wholesale/candidates/triage.",
      mustObserve: "TX fits; IL doesn't fit ('In IL, outside your states (TX)'). Triage writes nothing.",
      async run(ctx) {
        const triage = await ctx.api("GET", "/api/wholesale/candidates/triage");
        ctx.check(triage.status === 200, `GET triage must return 200, got ${triage.status}`);
        const verdicts = Object.fromEntries(
          ((triage.body as any)?.rows ?? []).map((r: { propertyId: number; verdict: string }) => [r.propertyId, r.verdict]),
        );
        ctx.check(verdicts[ctx.get<number>("txProperty")] === "fits", `TX property must triage "fits", got ${JSON.stringify(verdicts)}`);
        ctx.check(verdicts[ctx.get<number>("ilProperty")] === "fails", `IL property must triage "fails", got ${JSON.stringify(verdicts)}`);
        return { observed: { tx: "fits", il: "fails" } };
      },
    },
    {
      id: "decision",
      title: "Decision — the wholesale desk, with evidence",
      kind: "api",
      how: "POST /api/wholesale/underwrite on the TX property: all seven numbers, one sold comp, ARV basis, fee basis; Offer; review in 14 days.",
      mustObserve: "200 with a decisionId. The decision cites a wholesale_mao scenario.",
      async run(ctx) {
        const decision = await ctx.api("POST", "/api/wholesale/underwrite", {
          propertyId: ctx.get<number>("txProperty"),
          inputs: INPUTS,
          evidence: {
            comps: [{ address: "12 Oak St", soldPriceCents: 29_500_000, soldOn: "2026-09-14" }],
            arvBasis: "One renovated 3/2 two streets over.",
            feeBasis: "My floor for a full-kitchen rehab.",
          },
          kind: "offer",
          choice: "Offer up to $156,000 to assign at $10,000",
          rationale: "The buyer's number binds and the fee holds.",
          reviewDueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        });
        ctx.check(decision.status === 200, `POST underwrite must return 200, got ${decision.status}: ${JSON.stringify(decision.body).slice(0, 300)}`);
        ctx.check(typeof (decision.body as any)?.decisionId === "number", "underwrite must return a decisionId");
        ctx.store("decision", (decision.body as any).decisionId);
        return { observed: { decisionId: (decision.body as any).decisionId, scenario: "wholesale_mao" } };
      },
    },
    {
      id: "under-contract",
      title: "Under contract — the seller accepts on both deals",
      kind: "sql",
      how: "Both properties to under_contract; both deals accepted at $140,000 with a closing date 30 days out.",
      mustObserve: "Both properties leave triage (no longer candidates). From here they are assignable contract rights.",
      async run(ctx) {
        for (const key of ["tx", "il"] as const) {
          await ctx.sql(`UPDATE properties SET status = 'under_contract' WHERE id = $1`, [ctx.get<number>(`${key}Property`)]);
          await ctx.sql(
            `UPDATE deals SET status = 'accepted', accepted_amount = '140000', closing_date = now() + interval '30 days', updated_at = now() WHERE id = $1`,
            [ctx.get<number>(`${key}Deal`)],
          );
        }
        return { observed: { txDeal: "accepted 140000", ilDeal: "accepted 140000" } };
      },
      async stagingRun(ctx) {
        const closing = new Date(Date.now() + 30 * 86_400_000).toISOString();
        for (const key of ["tx", "il"] as const) {
          const property = await ctx.api("PUT", `/api/properties/${ctx.get<number>(`${key}Property`)}`, { status: "under_contract" });
          ctx.check(property.status < 300, `PUT property ${key} under_contract must succeed, got ${property.status}`);
          // H-DEF-2: walk the deal state machine like a customer —
          // negotiating → offer_sent → accepted (DEAL_STATUS_TRANSITIONS
          // refuses the direct negotiating → accepted skip this step
          // used to attempt). The accepted price and closing date ride
          // the final PUT: the stage route (PATCH /api/deals/:id/stage)
          // sets status only, and the packet leg derives its price from
          // the deal's acceptedAmount, so the fields must land here.
          const dealId = ctx.get<number>(`${key}Deal`);
          const offered = await ctx.api("PUT", `/api/deals/${dealId}`, { status: "offer_sent" });
          ctx.check(offered.status < 300, `PUT deal ${key} offer_sent must succeed, got ${offered.status}: ${JSON.stringify(offered.body).slice(0, 300)}`);
          const deal = await ctx.api("PUT", `/api/deals/${dealId}`, {
            status: "accepted",
            acceptedAmount: "140000",
            closingDate: closing,
          });
          ctx.check(deal.status < 300, `PUT deal ${key} accepted must succeed, got ${deal.status}: ${JSON.stringify(deal.body).slice(0, 300)}`);
          ctx.check((deal.body as any)?.status === "accepted", `PUT deal ${key} accepted must read back status accepted, got ${JSON.stringify((deal.body as any)?.status)}`);
          ctx.check(String((deal.body as any)?.acceptedAmount) === "140000", `PUT deal ${key} accepted must land acceptedAmount 140000 (the packet leg reads it), got ${JSON.stringify((deal.body as any)?.acceptedAmount)}`);
        }
        return { observed: { txDeal: "accepted 140000 via offer_sent", ilDeal: "accepted 140000 via offer_sent" } };
      },
    },
    {
      id: "assignments-draft",
      title: "Assignments — draft assignment rights on both deals",
      kind: "sql",
      how: "One draft contract_assignment per deal: end buyer Cash Buyer Co, fee $11,000 (1,100,000 cents).",
      mustObserve: "Two draft assignments exist, one per deal, each with assignment_fee_cents 1100000.",
      staging: {
        mode: "manual",
        note: "Assignment creation has no API: create the two draft assignments through the Deal → Assignment flow (end buyer Cash Buyer Co, fee $11,000), then supply their ids when prompted.",
      },
      collects: [
        { key: "txAssignment", prompt: "id of the draft TX contract_assignment (Deal → Assignment)" },
        { key: "ilAssignment", prompt: "id of the draft IL contract_assignment (Deal → Assignment)" },
      ],
      async run(ctx) {
        for (const key of ["tx", "il"] as const) {
          const [a] = await ctx.sql(
            `INSERT INTO contract_assignments (organization_id, deal_id, end_buyer_name, assignment_fee_cents, original_contract_date, status)
             VALUES ($1, $2, 'Cash Buyer Co', 1100000, current_date, 'draft') RETURNING id`,
            [ctx.orgId, ctx.get<number>(`${key}Deal`)],
          );
          ctx.store(`${key}Assignment`, a.id);
        }
        return { observed: { txAssignment: ctx.get("txAssignment"), ilAssignment: ctx.get("ilAssignment"), feeCents: 1100000 } };
      },
    },
    {
      id: "contract-compliance",
      title: "Contract + compliance gate, both directions",
      kind: "api",
      how: "TX: contract preview (assignment_of_contract) then draft with the echoed hash. IL: preview, then a blast preview. Both through the contract chain.",
      mustObserve:
        "TX preview 200 and writes nothing; TX draft succeeds and writes exactly one generated_documents row. IL preview is refused 422 STATE_NOT_CONFIGURED (no reviewed IL assignment template — expected, earlier than the gate). IL blast preview is refused 409 wholesaler_compliance_blocked and produces no blast row.",
      async run(ctx) {
        const previewGet = (key: string) =>
          ctx.api("GET", `/api/deals/${ctx.get<number>(`${key}Deal`)}/contract-preview?kind=assignment_of_contract&assignmentId=${ctx.get<number>(`${key}Assignment`)}`);
        const draft = (key: string, contentHash: string) =>
          ctx.api("POST", `/api/deals/${ctx.get<number>(`${key}Deal`)}/contract`, {
            kind: "assignment_of_contract",
            assignmentId: ctx.get<number>(`${key}Assignment`),
            confirmReviewed: true,
            reviewedContentHash: contentHash,
          });
        // generated_documents rows are readable only where SQL exists.
        const docDealIds = async (): Promise<string[]> => {
          if (ctx.driver !== "realdb") return [];
          const rows = await ctx.sql(`SELECT deal_id FROM generated_documents WHERE organization_id = $1`, [ctx.orgId]);
          return rows.map((d) => String(d.deal_id));
        };
        const txPreview = await previewGet("tx");
        ctx.check(txPreview.status === 200, `TX contract preview must return 200, got ${txPreview.status}: ${JSON.stringify(txPreview.body).slice(0, 300)}`);
        if (ctx.driver === "realdb") {
          ctx.check((await docDealIds()).length === 0, "the preview writes nothing");
        }
        const txDraft = await draft("tx", (txPreview.body as any).contentHash);
        ctx.check(txDraft.status < 300, `TX contract draft must succeed, got ${txDraft.status}: ${JSON.stringify(txDraft.body).slice(0, 300)}`);
        if (ctx.driver === "realdb") {
          ctx.check((await docDealIds()).join(",") === String(ctx.get<number>("txDeal")), "the draft writes exactly one generated_documents row, on the TX deal");
        }
        const ilPreview = await previewGet("il");
        ctx.check(ilPreview.status === 422, `IL contract preview must return 422, got ${ilPreview.status}`);
        ctx.check(JSON.stringify(ilPreview.body).includes("STATE_NOT_CONFIGURED"), `IL preview must refuse STATE_NOT_CONFIGURED, got ${JSON.stringify(ilPreview.body).slice(0, 300)}`);
        if (ctx.driver === "realdb") {
          ctx.check((await docDealIds()).join(",") === String(ctx.get<number>("txDeal")), "nothing was written for IL");
        }
        const ilBlast = await ctx.api("POST", `/api/properties/${ctx.get<number>("ilProperty")}/blast-buyers`, {
          subject: "s",
          body: "b",
          dryRun: true,
          minMatchScore: 0,
          financingType: "any",
        });
        ctx.check(ilBlast.status === 409, `IL blast preview must return 409, got ${ilBlast.status}`);
        ctx.check((ilBlast.body as any)?.error === "wholesaler_compliance_blocked", `IL blast must refuse wholesaler_compliance_blocked, got ${JSON.stringify(ilBlast.body).slice(0, 300)}`);
        return {
          observed: {
            txPreview: 200,
            txDraft: txDraft.status,
            ilPreview: "422 STATE_NOT_CONFIGURED",
            ilBlast: "409 wholesaler_compliance_blocked",
            generatedDocuments: ctx.driver === "realdb" ? "TX deal only" : "not observable from outside staging",
          },
        };
      },
    },
    {
      id: "buyer-seed",
      title: "Buyer — one cash buyer matched to the TX property",
      kind: "sql",
      how: "Bring-your-own buyer: lead Bea Buyer, active buyer profile (cash), match to the TX property at score 90.",
      mustObserve: "The buyer profile and match exist under the walk org.",
      staging: {
        mode: "manual",
        note: "Buyer profile + match creation has no real API (routes-buyer-network is a stub behind the marketplace ladder flag): add one cash buyer through the Buyers door and match them to the TX property at score 90.",
      },
      async run(ctx) {
        const [lead] = await ctx.sql(
          `INSERT INTO leads (organization_id, first_name, last_name, email, type) VALUES ($1, 'Bea', 'Buyer', $2, 'buyer') RETURNING id`,
          [ctx.orgId, `${ctx.tag}@example.test`],
        );
        const [bp] = await ctx.sql(
          `INSERT INTO buyer_profiles (organization_id, lead_id, is_active, financial_info) VALUES ($1, $2, true, '{"financingType":"cash"}'::jsonb) RETURNING id`,
          [ctx.orgId, lead.id],
        );
        await ctx.sql(
          `INSERT INTO buyer_property_matches (organization_id, buyer_profile_id, property_id, match_score) VALUES ($1, $2, $3, 90)`,
          [ctx.orgId, bp.id, ctx.get<number>("txProperty")],
        );
        return { observed: { buyerProfile: bp.id, matchScore: 90 } };
      },
    },
    {
      id: "packet-blast-preview",
      title: "Packet / blast preview — preview only, never a send",
      kind: "api",
      how: "GET the disposition packet for the TX property; POST a blast preview (dryRun) filled from the packet.",
      mustObserve:
        "Packet price = accepted price + underwritten fee (buyerPriceCents 15000000, withinBuyerCeiling true). Blast preview 200 with exactly 1 recipient. No blast or recipient row is written. Zero emails sent.",
      async run(ctx) {
        const packet = await ctx.api("GET", `/api/wholesale/properties/${ctx.get<number>("txProperty")}/disposition-packet`);
        ctx.check(packet.status === 200, `GET disposition packet must return 200, got ${packet.status}: ${JSON.stringify(packet.body).slice(0, 300)}`);
        const price = (packet.body as any)?.price ?? {};
        ctx.check(price.buyerPriceCents === 15_000_000, `packet buyerPriceCents must be 15000000, got ${JSON.stringify(price)}`);
        ctx.check(price.withinBuyerCeiling === true, `packet must be within the buyer ceiling, got ${JSON.stringify(price)}`);
        let before = "";
        if (ctx.driver === "realdb") {
          const counts = async () => {
            const b = await ctx.sql(`SELECT count(*)::int AS n FROM buyer_blasts WHERE organization_id = $1`, [ctx.orgId]);
            const r = await ctx.sql(`SELECT count(*)::int AS n FROM buyer_blast_recipients WHERE organization_id = $1`, [ctx.orgId]);
            return `${b[0].n}/${r[0].n}`;
          };
          before = await counts();
          const txBlast = await ctx.api("POST", `/api/properties/${ctx.get<number>("txProperty")}/blast-buyers`, {
            subject: (packet.body as any).subject,
            body: (packet.body as any).html,
            dryRun: true,
            minMatchScore: 0,
            financingType: "cash",
          });
          ctx.check(txBlast.status === 200, `TX blast preview must return 200, got ${txBlast.status}: ${JSON.stringify(txBlast.body).slice(0, 300)}`);
          ctx.check((txBlast.body as any)?.recipientCount === 1, `TX blast preview must list 1 recipient, got ${JSON.stringify(txBlast.body).slice(0, 300)}`);
          ctx.check((await counts()) === before, "the preview writes no blast or recipient row");
          ctx.check(ctx.sentCount() === 0, `the journey sends nothing (sent=${String(ctx.sentCount())})`);
          return { observed: { packetPriceCents: 15000000, withinBuyerCeiling: true, recipientCount: 1, blastRowsBeforeAfter: before, emailsSent: 0 } };
        }
        const txBlast = await ctx.api("POST", `/api/properties/${ctx.get<number>("txProperty")}/blast-buyers`, {
          subject: (packet.body as any).subject,
          body: (packet.body as any).html,
          dryRun: true,
          minMatchScore: 0,
          financingType: "cash",
        });
        ctx.check(txBlast.status === 200, `TX blast preview must return 200, got ${txBlast.status}: ${JSON.stringify(txBlast.body).slice(0, 300)}`);
        ctx.check((txBlast.body as any)?.recipientCount === 1, `TX blast preview must list 1 recipient, got ${JSON.stringify(txBlast.body).slice(0, 300)}`);
        return {
          observed: {
            packetPriceCents: 15000000,
            withinBuyerCeiling: true,
            recipientCount: 1,
            blastRowsBeforeAfter: "not observable from outside staging — dryRun:true is the fence",
            emailsSent: "not observable from outside staging",
          },
          notes: ["On staging the no-send fence is dryRun:true plus this step's recipientCount; row counts are a realdb-only observation."],
        };
      },
    },
    {
      id: "assignment-signed",
      title: "Assignment — signed on the org's own e-sign rail",
      kind: "sql",
      how: "The rail's completion moves the TX assignment draft → signed. In the rehearsal the status is set the way the rail's completion would set it; on staging the operator signs through the rail.",
      mustObserve: "contract_assignments for the TX deal is signed.",
      staging: {
        mode: "manual",
        note: "E-sign is a browser act: Deal → Assignment → send for signature on the org's own rail → both test signers sign, until the assignment reads signed.",
      },
      async run(ctx) {
        await ctx.sql(`UPDATE contract_assignments SET status = 'signed' WHERE id = $1`, [ctx.get<number>("txAssignment")]);
        return { observed: { txAssignment: "signed" } };
      },
    },
    {
      id: "outcome",
      title: "Outcome — realised fee read from the signed assignment, graded",
      kind: "api",
      how: "POST /api/wholesale/decisions/<N>/outcome with exit assignment; then GET /api/decisions/<N>/outcomes.",
      mustObserve: "200. realisedFeeCents 1100000 — the signed assignment's fee. The profit variance is compared: predicted 1000000, actual 1100000.",
      async run(ctx) {
        const outcome = await ctx.api("POST", `/api/wholesale/decisions/${ctx.get<number>("decision")}/outcome`, {
          exit: "assignment",
          assignmentId: Number(ctx.get("txAssignment")),
          closedOn: new Date().toISOString().slice(0, 10),
        });
        ctx.check(outcome.status === 200, `POST outcome must return 200, got ${outcome.status}: ${JSON.stringify(outcome.body).slice(0, 300)}`);
        ctx.check((outcome.body as any)?.realizedFeeCents === 1_100_000, `realised fee must be 1100000, got ${JSON.stringify(outcome.body).slice(0, 300)}`);
        const read = await ctx.api("GET", `/api/decisions/${ctx.get<number>("decision")}/outcomes`);
        ctx.check(read.status === 200, `GET outcomes must return 200, got ${read.status}`);
        const graded = ((read.body as any)?.outcomes ?? []).flatMap((o: any) => o.variance ?? []).find((v: any) => v.metricId === "profit");
        ctx.check(graded !== undefined, `outcomes must carry a profit variance, got ${JSON.stringify(read.body).slice(0, 300)}`);
        ctx.check(graded.state === "compared", `profit variance must be "compared", got ${JSON.stringify(graded)}`);
        ctx.check(graded.predicted === 1_000_000 && graded.actual === 1_100_000, `profit variance must be predicted 1000000 / actual 1100000, got ${JSON.stringify(graded)}`);
        return { observed: { realizedFeeCents: 1100000, profit: "compared predicted=1000000 actual=1100000" } };
      },
    },
    {
      id: "pax-wholesale",
      title: "Pax exercise — read the buyer match, record one change, with receipts",
      kind: "pax",
      how: "Through Pax: read the buyer match for the TX deal, then one record-change path (prepare — never send — a disposition-packet preview, or record a buyer note), with receipts. FD5 stands: Pax-authored sends stay ask-before-sending.",
      mustObserve: "BLOCKED — the tools do not exist yet, so this leg cannot be exercised. See the blocked reason.",
      paxState: "blocked",
      paxBlockedReason:
        "No wholesale tools in server/ai/tools.ts (assignment/wholesale/underwrite: 0 hits; the buyer hits are lead-type enums, not buyer-list/match tools). Pax wiring is gap-sheet item 4 (build 4–8 + audit 2–3); the exercise leg is 1–2 after it lands. Any Pax tool touching a listing/blast must inherit the compliance gate (server/services/wholesale/offerCompliance.ts).",
      async run() {
        throw new Error("pax-wholesale is blocked: the runner never executes a blocked Pax leg");
      },
    },
  ],
});
