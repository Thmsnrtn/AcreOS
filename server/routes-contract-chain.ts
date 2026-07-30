/**
 * Wave D2 — the accepted-offer → contract → e-sign chain, as HTTP.
 *
 * Two endpoints, both inside the Deals door (no new nav; the client surface is
 * a section in the deal's Documents tab):
 *
 *   GET  /api/deals/:id/contract-preview   — assemble + return for REVIEW.
 *                                            Writes nothing. Refusals here are
 *                                            the honest-gap surface.
 *   POST /api/deals/:id/contract           — the operator's explicit
 *                                            "create this draft" action.
 *                                            Persists a generated_documents
 *                                            row with status "draft" and the
 *                                            reviewed-content seal. Sends
 *                                            NOTHING.
 *
 * Sending stays on the pre-existing rail
 * (POST /api/generated-documents/:id/request-signature), which is
 * operator-initiated, mints per-signer HMAC links, does not email anyone, and
 * records consent in signing_consent_audit when the signer actually signs.
 * That rail now additionally re-verifies this chain's review seal, so a
 * contract edited after review cannot be dispatched.
 *
 * Legal signing is a permanent founder-only hard-stop. There is deliberately
 * no endpoint here that signs, executes, emails, schedules, or auto-dispatches
 * anything, and no server-side caller of the signing rail.
 *
 * Founder ruling #15: documents and signatures only. This file collects no
 * payment, touches no processor, and moves no funds.
 */

import type { Express, Response } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { and, desc, eq, sql } from "drizzle-orm";
import { contractAssignments } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { type AuthenticatedRequest, getOrganization, getUserId } from "./types/request";
import {
  assembleContract,
  authorizeContractAssembly,
  sealReviewedContent,
  isContractKind,
  CONTRACT_HARD_STOP,
  type AssembledContract,
  type ContractKind,
  type ContractRefusal,
} from "./services/contracts/contractAssembly";

/**
 * Every refusal leaves as HTTP 422 with the machine code in `details` so the
 * client can render the specific gap (state named, fields named) instead of a
 * generic error. 422 rather than 400 because the request is well-formed — the
 * DATA is not yet contract-ready.
 */
function refuse(res: Response, refusal: ContractRefusal): void {
  Errors.validationFailed(res, refusal);
}

interface GatherResult {
  ok: true;
  draft: AssembledContract;
  dealId: number;
  propertyId: number;
  assignmentId: number | null;
}

/**
 * Load the real records for a deal and hand them to the pure assembler.
 * Returns either an assembled draft or the refusal to surface.
 */
async function gatherAndAssemble(
  orgId: number,
  dealId: number,
  kind: ContractKind,
  requestedAssignmentId: number | null,
): Promise<
  | GatherResult
  | { ok: false; notFound: string }
  | { ok: false; refusal: ContractRefusal }
> {
  const deal = await storage.getDeal(orgId, dealId);
  if (!deal) return { ok: false, notFound: "Deal" };
  if (!deal.propertyId) return { ok: false, notFound: "Property for this deal" };

  const property = await storage.getProperty(orgId, deal.propertyId);
  if (!property) return { ok: false, notFound: "Property" };

  const org = await storage.getOrganization(orgId);
  if (!org) return { ok: false, notFound: "Organization" };

  const seller = property.sellerId ? await storage.getLead(orgId, property.sellerId) : undefined;

  let assignment: {
    id: number;
    endBuyerName: string | null;
    assignmentFeeCents: number;
    // Drizzle's `date` column yields a string, not a Date — widened to match
    // reality rather than casting at the read site. `AssignmentInput` already
    // accepts both, so the assembler needs no change.
    originalContractDate: Date | string | null;
  } | null = null;

  if (kind === "assignment_of_contract") {
    const rows = await db
      .select()
      .from(contractAssignments)
      .where(
        and(
          eq(contractAssignments.organizationId, orgId),
          eq(contractAssignments.dealId, dealId),
          requestedAssignmentId
            ? eq(contractAssignments.id, requestedAssignmentId)
            : sql`${contractAssignments.status} != 'cancelled'`,
        ),
      )
      .orderBy(desc(contractAssignments.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: false, notFound: "Assignment record for this deal" };
    assignment = {
      id: row.id,
      endBuyerName: row.endBuyerName,
      assignmentFeeCents: row.assignmentFeeCents,
      originalContractDate: row.originalContractDate,
    };
  }

  const result = assembleContract({
    kind,
    organizationName: org.name,
    deal: {
      id: deal.id,
      status: deal.status,
      type: deal.type,
      acceptedAmount: deal.acceptedAmount,
      closingDate: deal.closingDate,
    },
    property: {
      id: property.id,
      apn: property.apn,
      address: property.address,
      city: property.city,
      state: property.state,
      county: property.county,
      zip: property.zip,
      sizeAcres: property.sizeAcres,
      legalDescription: property.legalDescription,
    },
    seller: seller
      ? {
          legalName: [seller.firstName, seller.lastName].filter(Boolean).join(" "),
          email: seller.email,
          address: seller.address,
        }
      : { legalName: null },
    // The buying party on a purchase agreement (and the assignor on an
    // assignment) is the org itself. Its LEGAL entity name is required —
    // the display name is not a legal party name, and inventing one would
    // be exactly the fabrication this chain refuses to do.
    buyer: {
      legalName: org.legalEntityName,
      email: org.settings?.companyEmail ?? null,
      address: org.settings?.companyAddress ?? null,
    },
    assignment,
  });

  if (!result.ok) return { ok: false, refusal: result.refusal };

  return {
    ok: true,
    draft: result.draft,
    dealId: deal.id,
    propertyId: property.id,
    assignmentId: assignment?.id ?? null,
  };
}

/** Assignment-legality gate, reusing the existing wholesaler rules service. */
async function assignmentComplianceRefusal(
  state: string,
  acknowledged: boolean,
): Promise<{ code: string; message: string; recommendation: string; citation: string | null; attorneyReviewed: boolean } | null> {
  const { checkAssignmentCompliance } = await import("./routes-wholesaler-rules");
  const result = await checkAssignmentCompliance(state);
  if (result.blocked) {
    return {
      code: "WHOLESALER_COMPLIANCE_BLOCKED",
      message: result.summary,
      recommendation: result.recommendation,
      citation: result.citation,
      attorneyReviewed: result.attorneyReviewed,
    };
  }
  if (result.warn && !acknowledged) {
    return {
      code: "WHOLESALER_COMPLIANCE_WARN",
      message: result.summary,
      recommendation: result.recommendation,
      citation: result.citation,
      attorneyReviewed: result.attorneyReviewed,
    };
  }
  return null;
}

export function registerContractChainRoutes(app: Express): void {
  const api = app;

  // ---------------------------------------------------------------------
  // GET /api/deals/:id/contract-preview
  //
  // The review step. Returns the EXACT content that would be persisted,
  // plus its sha256 — the operator must echo that hash back to create the
  // draft, so a deal edited between review and create cannot slip through.
  // ---------------------------------------------------------------------
  api.get(
    "/api/deals/:id/contract-preview",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res) => {
      try {
        const org = getOrganization(req);
        const dealId = Number(req.params.id);
        if (!Number.isInteger(dealId) || dealId <= 0) {
          return Errors.badRequest(res, "Invalid deal ID");
        }

        const kind = req.query.kind;
        if (!isContractKind(kind)) {
          return Errors.badRequest(
            res,
            "Specify kind=purchase_agreement or kind=assignment_of_contract",
          );
        }

        const assignmentIdRaw = req.query.assignmentId;
        const assignmentId =
          typeof assignmentIdRaw === "string" && assignmentIdRaw.length > 0
            ? Number(assignmentIdRaw)
            : null;
        if (assignmentId !== null && !Number.isInteger(assignmentId)) {
          return Errors.badRequest(res, "Invalid assignment ID");
        }

        const gathered = await gatherAndAssemble(org.id, dealId, kind, assignmentId);
        if ("notFound" in gathered) return Errors.notFound(res, gathered.notFound);
        if (!gathered.ok) return refuse(res, gathered.refusal);

        const { draft } = gathered;
        res.json({
          kind: draft.kind,
          title: draft.title,
          name: draft.name,
          state: draft.state,
          stateName: draft.stateName,
          content: draft.content,
          contentHash: draft.contentHash,
          variables: draft.variables,
          stateRequirements: draft.stateRequirements,
          signerRoles: draft.signerRoles,
          advisories: draft.advisories,
          disclaimer: draft.disclaimer,
          assignmentId: gathered.assignmentId,
          // Stated explicitly so no client (or agent) can read this as a send.
          sent: false,
          hardStop: CONTRACT_HARD_STOP,
        });
      } catch (error) {
        logger.error(
          "Contract preview failed",
          error instanceof Error ? error : new Error(String(error)),
        );
        Errors.internal(res, error);
      }
    },
  );

  // ---------------------------------------------------------------------
  // POST /api/deals/:id/contract
  //
  // The one write. Requires: authenticated operator, confirmReviewed === true,
  // and reviewedContentHash matching the freshly re-assembled content. Creates
  // a DRAFT document carrying the review seal. Nothing is sent.
  // ---------------------------------------------------------------------
  api.post(
    "/api/deals/:id/contract",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res) => {
      try {
        const org = getOrganization(req);
        const userId = getUserId(req);
        const dealId = Number(req.params.id);
        if (!Number.isInteger(dealId) || dealId <= 0) {
          return Errors.badRequest(res, "Invalid deal ID");
        }

        const body = (req.body ?? {}) as {
          kind?: unknown;
          assignmentId?: unknown;
          reviewedContentHash?: unknown;
          confirmReviewed?: unknown;
          ackComplianceWarning?: unknown;
        };

        if (!isContractKind(body.kind)) {
          return Errors.badRequest(
            res,
            "Specify kind: purchase_agreement or assignment_of_contract",
          );
        }
        const kind = body.kind;
        const assignmentId =
          typeof body.assignmentId === "number" && Number.isInteger(body.assignmentId)
            ? body.assignmentId
            : null;

        const gathered = await gatherAndAssemble(org.id, dealId, kind, assignmentId);
        if ("notFound" in gathered) return Errors.notFound(res, gathered.notFound);
        if (!gathered.ok) return refuse(res, gathered.refusal);
        const { draft } = gathered;

        // ── The human-action gate. Nothing gets persisted without a person
        //    confirming THIS content. ────────────────────────────────────
        const gate = authorizeContractAssembly(draft, {
          userId,
          confirmReviewed: body.confirmReviewed === true,
          reviewedContentHash:
            typeof body.reviewedContentHash === "string" ? body.reviewedContentHash : null,
        });
        if (!gate.ok) return refuse(res, gate.refusal);

        // ── Assignment legality (existing wholesaler_state_rules service) ──
        if (kind === "assignment_of_contract") {
          const compliance = await assignmentComplianceRefusal(
            draft.state,
            body.ackComplianceWarning === true,
          );
          if (compliance) {
            logger.warn("Assignment contract blocked by state compliance gate", {
              organizationId: org.id,
              dealId,
              state: draft.state,
              code: compliance.code,
            });
            return Errors.validationFailed(res, compliance);
          }
        }

        const document = await storage.createGeneratedDocument({
          organizationId: org.id,
          templateId: null,
          dealId: gathered.dealId,
          propertyId: gathered.propertyId,
          name: draft.name,
          type: draft.documentType,
          content: draft.content,
          variables: sealReviewedContent(draft.variables, {
            hash: draft.contentHash,
            userId,
          }),
          status: "draft",
          generatedBy: userId,
        });

        if (kind === "assignment_of_contract" && gathered.assignmentId) {
          await db
            .update(contractAssignments)
            .set({
              generatedDocumentId: document.id,
              status: "doc_generated",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(contractAssignments.id, gathered.assignmentId),
                eq(contractAssignments.organizationId, org.id),
              ),
            );
        }

        logger.info("Contract draft assembled from accepted offer", {
          organizationId: org.id,
          dealId: gathered.dealId,
          documentId: document.id,
          kind,
          state: draft.state,
          reviewedBy: userId,
        });

        res.status(201).json({
          document,
          sent: false,
          signerRoles: draft.signerRoles,
          advisories: draft.advisories,
          nextStep: {
            action: "request-signature",
            endpoint: `/api/generated-documents/${document.id}/request-signature`,
            note:
              "Nothing has been sent. Sending for signature is a separate, explicit action — " +
              "legal signing is a founder-only hard-stop and never happens automatically.",
          },
          hardStop: CONTRACT_HARD_STOP,
        });
      } catch (error) {
        logger.error(
          "Contract assembly failed",
          error instanceof Error ? error : new Error(String(error)),
        );
        Errors.internal(res, error);
      }
    },
  );
}
