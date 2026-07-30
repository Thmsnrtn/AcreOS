/**
 * Wave D2 — "Assemble the chains": accepted offer → merged contract → e-sign.
 *
 * AcreOS already had every part of this chain, separately and all real:
 * AI-drafted offers, a state-specific document config
 * (services/stateDocumentConfig.ts), a legally rigorous native e-sign rail
 * (HMAC signing tokens + signing_consent_audit + content-hash tamper
 * evidence), and the wholesale AssignmentPanel. Nothing connected them: an
 * accepted offer never became a merged purchase agreement, and a merged
 * agreement never flowed into the signing rail.
 *
 * This module is the glue, and it is deliberately PURE — no db, no storage,
 * no logger, no express. It takes plain records the route already loaded and
 * returns either an assembled draft or a NAMED refusal. That keeps every
 * legal decision in this file unit-testable without a database, and keeps the
 * route layer thin enough to audit at a glance.
 *
 * ─── What "state-appropriate" means here (and what it does NOT mean) ───────
 *
 * We do NOT invent a second templating system. The body is assembled from the
 * same merge-variable vocabulary the system templates use, and every
 * state-varying clause is driven by the state's authored entry in
 * STATE_DOCUMENT_CONFIGS: the deed the seller must convey by, the granting
 * clause, notary + witness counts (Florida's two witnesses are load-bearing —
 * a deed without them is invalid), the recording office, the transfer tax,
 * and whether the state requires an attorney at closing.
 *
 * stateDocumentConfig.ts fills the remaining ~34 states with a GENERIC
 * placeholder entry whose own text says "Consult a local real estate attorney
 * for <State>-specific requirements." Emitting a contract off that entry
 * would be emitting a document we know nothing state-specific about while
 * implying we do. A wrong contract is worse than no contract, so those states
 * REFUSE, by name. See CONTRACT_READY_STATES.
 *
 * ─── The founder hard-stop this module must not break ─────────────────────
 *
 * "Legal signing is founder-only forever" (HARD_STOPS.legal_signing). Nothing
 * in this module or its routes signs, executes, auto-emails, or dispatches
 * anything. The chain produces a DRAFT that a human must explicitly review
 * and then explicitly send. Two code-level gates enforce that:
 *
 *   1. `authorizeContractAssembly()` — creation requires a real operator
 *      user id, an explicit `confirmReviewed`, and the sha256 of the exact
 *      content the operator was shown. A stale hash (the deal moved, the
 *      price changed) refuses rather than silently persisting something the
 *      operator never saw.
 *   2. `sealReviewedContent()` / `verifyChainReviewSeal()` — the reviewed
 *      hash is stored on the document, and the signing rail re-verifies it
 *      against the document's current content at dispatch time. If anyone
 *      edited the contract after review, dispatch refuses. "What goes out is
 *      exactly what a human reviewed" becomes checkable, not aspirational.
 *
 * Founder ruling #15 is untouched: this is documents and signatures only. No
 * payment collection, no escrow, no funds movement anywhere in the chain.
 */

import crypto from "crypto";
import { format } from "date-fns";
import {
  getStateConfig,
  getDeedTypeLabel,
  getTransferTaxAmount,
  getRecordingEstimate,
  type StateDocumentConfig,
} from "../stateDocumentConfig";
import { DISCLAIMER_DOCUMENT_TEMPLATE } from "../legalDisclaimers";
import { checkDisclosure, buildDisclosureMissingPayload } from "../disclosureRegistry";
import type { HardStop } from "../autopilot/hardStops";

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

export const CONTRACT_KINDS = ["purchase_agreement", "assignment_of_contract"] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export function isContractKind(value: unknown): value is ContractKind {
  return typeof value === "string" && (CONTRACT_KINDS as readonly string[]).includes(value);
}

const KIND_TITLE: Record<ContractKind, string> = {
  purchase_agreement: "REAL ESTATE PURCHASE AGREEMENT",
  assignment_of_contract: "ASSIGNMENT OF REAL ESTATE CONTRACT",
};

const KIND_LABEL: Record<ContractKind, string> = {
  purchase_agreement: "purchase agreement",
  assignment_of_contract: "assignment of contract",
};

/**
 * Deal statuses from which a contract may be assembled. The deal's
 * `accepted` status IS the accepted-offer event in this schema (there is no
 * separate accepted-offer row — see the comment in routes-deals.ts: "the
 * `offer_sent` status on the deal is the canonical offer-sent event").
 */
export const CONTRACT_ELIGIBLE_DEAL_STATUSES = ["accepted", "in_escrow"] as const;

/**
 * The hard-stop class this chain lives next to. Typed as `HardStop` so the
 * compiler — not a comment — proves the citation names a real permanent
 * hard-stop from server/services/autopilot/hardStops.ts.
 */
export const CONTRACT_HARD_STOP: HardStop = "legal_signing";

// ---------------------------------------------------------------------------
// State readiness
// ---------------------------------------------------------------------------

/**
 * Marker text that stateDocumentConfig.ts writes into every GENERIC filler
 * entry. Detecting it is how we tell an authored state config from a
 * placeholder without duplicating the state list.
 */
const GENERIC_CONFIG_MARKER = "Consult a local real estate attorney for";

export function isGenericStateConfig(config: StateDocumentConfig): boolean {
  return config.deedNotesForInvestors.startsWith(GENERIC_CONFIG_MARKER);
}

/**
 * States whose contract language has been reviewed for CONTRACT assembly.
 *
 * This is an explicit allowlist, not a derivation, on purpose: adding a state
 * to STATE_DOCUMENT_CONFIGS should not silently make AcreOS willing to emit a
 * contract there. `contractAssembly.test.ts` pins the list against the set of
 * non-generic state configs in BOTH directions, so a newly authored state
 * fails the test until a human adds it here deliberately.
 */
export const CONTRACT_READY_STATES: readonly string[] = [
  "AL", "AZ", "CA", "CO", "FL", "GA", "ID", "MI",
  "MO", "NM", "NV", "NC", "OH", "OR", "TX", "WA",
];

export interface StateTemplateResolution {
  state: string;
  stateName: string;
  config: StateDocumentConfig;
}

export type StateRefusal = {
  code: "STATE_NOT_CONFIGURED";
  state: string;
  stateName: string | null;
  message: string;
  hardStop: null;
};

/**
 * Resolve the state-specific clause set for a contract, or refuse by name.
 *
 * Three refusal shapes, all naming the state:
 *   - blank state on the property        → "no state on file"
 *   - unknown USPS code (DC, PR, "ZZ")  → named code, no config
 *   - authored-but-generic filler entry → named state, template not reviewed
 */
export function resolveStateContractTemplate(
  state: string | null | undefined,
  kind: ContractKind,
): { ok: true; resolved: StateTemplateResolution } | { ok: false; refusal: StateRefusal } {
  const code = (state ?? "").trim().toUpperCase();
  const label = KIND_LABEL[kind];

  if (!code) {
    return {
      ok: false,
      refusal: {
        code: "STATE_NOT_CONFIGURED",
        state: "",
        stateName: null,
        hardStop: null,
        message:
          `This property has no state on file, so AcreOS cannot tell which ${label} ` +
          `applies. Set the property's state, then assemble the contract again.`,
      },
    };
  }

  const config = getStateConfig(code);
  if (!config) {
    return {
      ok: false,
      refusal: {
        code: "STATE_NOT_CONFIGURED",
        state: code,
        stateName: null,
        hardStop: null,
        message:
          `AcreOS has no document configuration for ${code}, so it will not generate a ${label} ` +
          `there. A generic contract in the wrong jurisdiction is worse than no contract — ` +
          `have your attorney draft this one.`,
      },
    };
  }

  if (isGenericStateConfig(config) || !CONTRACT_READY_STATES.includes(code)) {
    return {
      ok: false,
      refusal: {
        code: "STATE_NOT_CONFIGURED",
        state: code,
        stateName: config.stateName,
        hardStop: null,
        message:
          `AcreOS has no reviewed ${label} template for ${config.stateName} (${code}) — only a ` +
          `generic placeholder. It will not emit a contract it cannot make state-specific. ` +
          `Have your ${config.stateName} attorney supply the contract for this deal.`,
      },
    };
  }

  return { ok: true, resolved: { state: code, stateName: config.stateName, config } };
}

/** Every state this chain will currently assemble a contract for. */
export function contractReadyStates(): string[] {
  return CONTRACT_READY_STATES.filter((code) => {
    const config = getStateConfig(code);
    return !!config && !isGenericStateConfig(config);
  });
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A party to the contract. Names are never synthesized — see MissingField. */
export interface ContractParty {
  legalName: string | null | undefined;
  address?: string | null;
  email?: string | null;
}

export interface ContractDealInput {
  id: number;
  status: string;
  type?: string | null;
  /** The accepted number. Falls back to nothing — an offer amount is not an accepted amount. */
  acceptedAmount: string | number | null | undefined;
  closingDate: Date | string | null | undefined;
  earnestMoney?: string | number | null;
}

export interface ContractPropertyInput {
  id: number;
  apn: string | null | undefined;
  address: string | null | undefined;
  city?: string | null;
  state: string | null | undefined;
  county: string | null | undefined;
  zip?: string | null;
  sizeAcres?: string | number | null;
  legalDescription?: string | null;
}

export interface AssignmentInput {
  id: number;
  endBuyerName: string | null | undefined;
  assignmentFeeCents: number | null | undefined;
  originalContractDate: Date | string | null | undefined;
}

export interface ContractAssemblyInput {
  kind: ContractKind;
  organizationName: string;
  deal: ContractDealInput;
  property: ContractPropertyInput;
  /** Seller of record (the property's seller lead). Required on both kinds. */
  seller: ContractParty;
  /**
   * Buying party. For a purchase agreement this is the org itself and MUST be
   * the org's `legalEntityName` — the display name is not a legal party name.
   */
  buyer: ContractParty;
  /** Only for kind === "assignment_of_contract". */
  assignment?: AssignmentInput | null;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export interface MissingField {
  /** The merge variable that would have been blank. */
  field: string;
  /** Human label for the operator. */
  label: string;
  /** Exactly where to go fix it — never a guess at the value itself. */
  fixAt: string;
}

export type ContractRefusal =
  | StateRefusal
  | {
      code: "OFFER_NOT_ACCEPTED";
      dealStatus: string;
      message: string;
      hardStop: null;
    }
  | {
      code: "MISSING_REQUIRED_FIELDS";
      missing: MissingField[];
      message: string;
      hardStop: null;
    }
  | {
      code: "DISCLOSURE_MISSING";
      details: ReturnType<typeof buildDisclosureMissingPayload> | { statute: string; friendlyName: string };
      message: string;
      hardStop: null;
    }
  | {
      code: "OPERATOR_REVIEW_REQUIRED";
      message: string;
      hardStop: HardStop;
    }
  | {
      code: "REVIEW_STALE";
      message: string;
      hardStop: HardStop;
      expectedContentHash: string;
    };

export type ContractAssemblyResult =
  | { ok: true; draft: AssembledContract }
  | { ok: false; refusal: ContractRefusal };

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ContractSignerRole {
  role: string;
  /** Who this is, as it will print on the document. */
  name: string;
  /** Whether AcreOS has an email for them (the operator supplies missing ones at send time). */
  email: string | null;
}

export interface AssembledContract {
  kind: ContractKind;
  /** Value written to generated_documents.type. */
  documentType: ContractKind;
  title: string;
  name: string;
  state: string;
  stateName: string;
  /** Merged HTML body. This exact string is what the operator reviews. */
  content: string;
  /** sha256 of `content`. The review seal is taken over this. */
  contentHash: string;
  /** Real merged values, persisted on the document for audit. */
  variables: Record<string, string>;
  /** The state-varying execution requirements, surfaced to the review UI. */
  stateRequirements: {
    deedType: string;
    notaryRequired: boolean;
    witnessCount: number;
    recordingOffice: string;
    transferTaxPercent: number;
    transferTaxNotes: string;
    attorneyStateForClosing: boolean;
    practiceNotes: string;
  };
  signerRoles: ContractSignerRole[];
  /** Named gaps that do NOT block assembly but the operator must resolve. */
  advisories: string[];
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Small formatters (no fabrication: blank in → blank out, never a placeholder)
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function money(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(num);
}

function longDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMMM d, yyyy");
}

function trimmed(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

function fullAddress(property: ContractPropertyInput): string | null {
  const street = trimmed(property.address);
  if (!street) return null;
  const tail = [trimmed(property.city), trimmed(property.state), trimmed(property.zip)]
    .filter((p): p is string => !!p)
    .join(", ");
  return tail ? `${street}, ${tail}` : street;
}

// ---------------------------------------------------------------------------
// sha256 helpers + the review seal
// ---------------------------------------------------------------------------

export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** Variable keys carrying the review seal on the generated document. */
export const REVIEW_SEAL_KEY = "contract_chain_reviewed_sha256";
export const REVIEW_SEAL_BY_KEY = "contract_chain_reviewed_by";
export const REVIEW_SEAL_AT_KEY = "contract_chain_reviewed_at";

/**
 * Stamp the reviewed-content seal onto the variables that get persisted with
 * the document. `hash` is the sha256 of the content the operator confirmed.
 */
export function sealReviewedContent(
  variables: Record<string, string>,
  seal: { hash: string; userId: string; at?: Date },
): Record<string, string> {
  return {
    ...variables,
    [REVIEW_SEAL_KEY]: seal.hash,
    [REVIEW_SEAL_BY_KEY]: seal.userId,
    [REVIEW_SEAL_AT_KEY]: (seal.at ?? new Date()).toISOString(),
  };
}

export type ReviewSealVerdict =
  | { sealed: false }
  | { sealed: true; ok: true }
  | {
      sealed: true;
      ok: false;
      payload: {
        code: "REVIEW_SEAL_BROKEN";
        message: string;
        hardStop: HardStop;
        reviewedHash: string;
        currentHash: string;
      };
    };

/**
 * Re-verify at DISPATCH time that the document's current content is byte-for-byte
 * what the operator reviewed. Documents without a seal are not chain contracts
 * and pass through untouched (`sealed: false`) — this gate is additive and can
 * never block the pre-existing template flow.
 */
export function verifyChainReviewSeal(
  variables: unknown,
  content: string | null | undefined,
): ReviewSealVerdict {
  if (!variables || typeof variables !== "object") return { sealed: false };
  const bag = variables as Record<string, unknown>;
  const reviewedHash = bag[REVIEW_SEAL_KEY];
  if (typeof reviewedHash !== "string" || reviewedHash.length === 0) return { sealed: false };

  const currentHash = contentHash(content ?? "");
  if (currentHash === reviewedHash) return { sealed: true, ok: true };

  return {
    sealed: true,
    ok: false,
    payload: {
      code: "REVIEW_SEAL_BROKEN",
      hardStop: CONTRACT_HARD_STOP,
      reviewedHash,
      currentHash,
      message:
        "This contract changed after it was reviewed, so AcreOS will not send it for signature. " +
        "Re-assemble the contract from the deal, review it again, and send the fresh draft.",
    },
  };
}

// ---------------------------------------------------------------------------
// The human-action gate
// ---------------------------------------------------------------------------

export interface OperatorAction {
  /** Authenticated user id. An empty/absent id is never an operator. */
  userId: string | null | undefined;
  /** The operator ticked the review box. Absent/false refuses. */
  confirmReviewed: boolean | undefined;
  /** sha256 of the content the operator was actually shown. */
  reviewedContentHash: string | null | undefined;
}

/**
 * Gate the ONE step that persists a legally operative draft. Refuses unless a
 * real human explicitly confirmed review of this exact content.
 *
 * This is what keeps the chain compatible with the permanent `legal_signing`
 * hard-stop: an autonomous caller has no user id and no reviewed hash, so it
 * cannot get past this function, and no code path in the chain sends anything.
 */
export function authorizeContractAssembly(
  draft: AssembledContract,
  action: OperatorAction,
): { ok: true } | { ok: false; refusal: ContractRefusal } {
  const userId = trimmed(action.userId ?? null);
  if (!userId || action.confirmReviewed !== true) {
    return {
      ok: false,
      refusal: {
        code: "OPERATOR_REVIEW_REQUIRED",
        hardStop: CONTRACT_HARD_STOP,
        message:
          "A person has to review this contract before AcreOS will create it. Open the review " +
          "step, read the document that will go out, and confirm it. Legal signing is a " +
          "founder-only hard-stop — nothing here is ever automatic.",
      },
    };
  }

  const reviewed = trimmed(action.reviewedContentHash ?? null);
  if (!reviewed || reviewed !== draft.contentHash) {
    return {
      ok: false,
      refusal: {
        code: "REVIEW_STALE",
        hardStop: CONTRACT_HARD_STOP,
        expectedContentHash: draft.contentHash,
        message:
          "The contract changed since you reviewed it — the deal, property, or parties were " +
          "edited. Review the current version before creating it.",
      },
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Required-field collection
// ---------------------------------------------------------------------------

interface FieldSpec {
  field: string;
  label: string;
  fixAt: string;
  value: string | null;
}

function collectMissing(specs: FieldSpec[]): MissingField[] {
  return specs
    .filter((s) => s.value === null)
    .map(({ field, label, fixAt }) => ({ field, label, fixAt }));
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the state-appropriate contract for an accepted deal, or refuse
 * with the specific reason named.
 *
 * Order of refusals is deliberate: eligibility → state → required fields →
 * statutory disclosure. The operator sees the first thing that is actually
 * blocking them, and never a document with a hole in it.
 */
export function assembleContract(input: ContractAssemblyInput): ContractAssemblyResult {
  const { kind, deal, property } = input;

  // 1. The offer must actually be accepted. No contract off a live negotiation.
  if (!(CONTRACT_ELIGIBLE_DEAL_STATUSES as readonly string[]).includes(deal.status)) {
    return {
      ok: false,
      refusal: {
        code: "OFFER_NOT_ACCEPTED",
        dealStatus: deal.status,
        hardStop: null,
        message:
          `This deal is "${deal.status}". A ${KIND_LABEL[kind]} is assembled from an ACCEPTED ` +
          `offer — mark the offer accepted (with the accepted amount and closing date) first.`,
      },
    };
  }

  // 2. State template.
  const stateResolution = resolveStateContractTemplate(property.state, kind);
  if (!stateResolution.ok) return { ok: false, refusal: stateResolution.refusal };
  const { state, stateName, config } = stateResolution.resolved;

  // 3. Required fields — named, never filled in.
  const sellerName = trimmed(input.seller.legalName ?? null);
  const buyerName = trimmed(input.buyer.legalName ?? null);
  const address = fullAddress(property);
  const apn = trimmed(property.apn);
  const county = trimmed(property.county);
  const price = money(deal.acceptedAmount);
  const closingDate = longDate(deal.closingDate);

  const specs: FieldSpec[] = [
    {
      field: "seller_name",
      label: "Seller's full legal name",
      fixAt: `Property #${property.id} → Seller contact`,
      value: sellerName,
    },
    {
      field: kind === "assignment_of_contract" ? "assignor_name" : "buyer_name",
      label:
        kind === "assignment_of_contract"
          ? "Assignor's legal entity name"
          : "Buyer's legal entity name",
      fixAt: "Settings → Organization → legal entity name",
      value: buyerName,
    },
    {
      field: "property_address",
      label: "Property street address",
      fixAt: `Property #${property.id} → Address`,
      value: address,
    },
    {
      field: "parcel_number",
      label: "Parcel number (APN)",
      fixAt: `Property #${property.id} → APN`,
      value: apn,
    },
    {
      field: "county",
      label: "County",
      fixAt: `Property #${property.id} → County`,
      value: county,
    },
    {
      field: "purchase_price",
      label: "Accepted purchase price",
      fixAt: `Deal #${deal.id} → Accepted amount`,
      value: price,
    },
    {
      field: "closing_date",
      label: "Closing date",
      fixAt: `Deal #${deal.id} → Closing date`,
      value: closingDate,
    },
  ];

  const assignment = input.assignment ?? null;
  let assignmentFee: string | null = null;
  let originalContractDate: string | null = null;
  let assigneeName: string | null = null;

  if (kind === "assignment_of_contract") {
    assigneeName = trimmed(assignment?.endBuyerName ?? null);
    assignmentFee =
      assignment && typeof assignment.assignmentFeeCents === "number"
        ? money(assignment.assignmentFeeCents / 100)
        : null;
    originalContractDate = longDate(assignment?.originalContractDate ?? null);

    specs.push(
      {
        field: "assignee_name",
        label: "End buyer (assignee) name",
        fixAt: `Deal #${deal.id} → Assignment → End buyer`,
        value: assigneeName,
      },
      {
        field: "assignment_fee",
        label: "Assignment fee",
        fixAt: `Deal #${deal.id} → Assignment → Fee`,
        value: assignmentFee,
      },
      {
        field: "original_contract_date",
        label: "Original contract date",
        fixAt: `Deal #${deal.id} → Assignment → Original contract date`,
        value: originalContractDate,
      },
    );
  }

  const missing = collectMissing(specs);
  if (missing.length > 0) {
    const names = missing.map((m) => m.label).join(", ");
    return {
      ok: false,
      refusal: {
        code: "MISSING_REQUIRED_FIELDS",
        missing,
        hardStop: null,
        message:
          `AcreOS won't guess contract terms. Missing: ${names}. Fill these in and assemble ` +
          `the ${KIND_LABEL[kind]} again.`,
      },
    };
  }

  // Non-blocking, honestly named gaps.
  const advisories: string[] = [];
  const legalDescription = trimmed(property.legalDescription ?? null);
  if (!legalDescription) {
    advisories.push(
      `No recorded legal description is on file for parcel ${apn}. The contract references the ` +
        `parcel number and address only — attach the recorded legal description before execution.`,
    );
  }
  if (config.attorneyStateForClosing) {
    advisories.push(
      `${stateName} requires an attorney (not just a title company) at closing. Engage one before signing.`,
    );
  }
  if (config.witnessCount > 0) {
    advisories.push(
      `${stateName} requires ${config.witnessCount} witness${config.witnessCount === 1 ? "" : "es"} ` +
        `at execution. The signature page includes ${config.witnessCount} witness block${config.witnessCount === 1 ? "" : "s"}.`,
    );
  }

  // 4. Build the merged body.
  const variables: Record<string, string> = {
    state,
    state_name: stateName,
    // `collectMissing` above has already refused if any of these is absent, so
    // the non-null assertions here are load-bearing on that check, not hope.
    county: county as string,
    property_address: address as string,
    parcel_number: apn as string,
    seller_name: sellerName as string,
    purchase_price: price as string,
    closing_date: closingDate as string,
    deed_type: getDeedTypeLabel(config.primaryDeedType),
    recording_office: config.recordingOffice,
    today: format(new Date(), "MMMM d, yyyy"),
  };
  if (property.sizeAcres !== null && property.sizeAcres !== undefined && property.sizeAcres !== "") {
    variables.property_acres = String(property.sizeAcres);
  }
  if (legalDescription) variables.legal_description = legalDescription;
  const earnest = money(deal.earnestMoney ?? null);
  if (earnest) variables.earnest_money = earnest;

  if (kind === "assignment_of_contract") {
    variables.assignor_name = buyerName as string;
    variables.assignee_name = assigneeName as string;
    variables.assignment_fee = assignmentFee as string;
    variables.original_contract_date = originalContractDate as string;
    variables.buyer_name = assigneeName as string;
  } else {
    variables.buyer_name = buyerName as string;
  }

  const content =
    kind === "purchase_agreement"
      ? renderPurchaseAgreement(variables, config, { legalDescription, advisories })
      : renderAssignmentOfContract(variables, config, { advisories });

  // 5. Statutory disclosure: never hand the signing rail a document it will
  //    (correctly) refuse to dispatch. Same registry the rail uses.
  try {
    const check = checkDisclosure(state, kind, content);
    if (!check.ok) {
      const payload = buildDisclosureMissingPayload(check);
      return {
        ok: false,
        refusal: {
          code: "DISCLOSURE_MISSING",
          details: payload,
          hardStop: null,
          message:
            `${stateName} requires the ${payload.friendlyName} inside this document ` +
            `(${payload.statute}) and AcreOS cannot generate that language itself. Your attorney ` +
            `must supply this contract.`,
        },
      };
    }
  } catch (err) {
    return {
      ok: false,
      refusal: {
        code: "DISCLOSURE_MISSING",
        details: {
          statute: "registry-incomplete",
          friendlyName: err instanceof Error ? err.message : "Disclosure registry incomplete",
        },
        hardStop: null,
        message:
          `AcreOS has an unverified statutory-disclosure entry for ${stateName} ${KIND_LABEL[kind]}s, ` +
          `so it refuses to generate one. This fails closed on purpose.`,
      },
    };
  }

  const signerRoles: ContractSignerRole[] =
    kind === "purchase_agreement"
      ? [
          { role: "seller", name: sellerName as string, email: trimmed(input.seller.email ?? null) },
          { role: "buyer", name: buyerName as string, email: trimmed(input.buyer.email ?? null) },
        ]
      : [
          { role: "assignor", name: buyerName as string, email: trimmed(input.buyer.email ?? null) },
          { role: "assignee", name: assigneeName as string, email: null },
        ];
  for (let i = 0; i < config.witnessCount; i += 1) {
    signerRoles.push({ role: "witness", name: `Witness ${i + 1}`, email: null });
  }

  return {
    ok: true,
    draft: {
      kind,
      documentType: kind,
      title: KIND_TITLE[kind],
      name: `${kind === "purchase_agreement" ? "Purchase Agreement" : "Assignment of Contract"} — ${apn} (${state})`,
      state,
      stateName,
      content,
      contentHash: contentHash(content),
      variables,
      stateRequirements: {
        deedType: getDeedTypeLabel(config.primaryDeedType),
        notaryRequired: config.notaryRequired,
        witnessCount: config.witnessCount,
        recordingOffice: config.recordingOffice,
        transferTaxPercent: config.transferTaxPercent,
        transferTaxNotes: config.transferTaxNotes,
        attorneyStateForClosing: config.attorneyStateForClosing,
        practiceNotes: config.practiceNotes,
      },
      signerRoles,
      advisories,
      disclaimer: DISCLAIMER_DOCUMENT_TEMPLATE,
    },
  };
}

// ---------------------------------------------------------------------------
// Renderers — one merged HTML body per kind
// ---------------------------------------------------------------------------

function signatureBlock(label: string, name: string): string {
  return (
    `<p>____________________________<br/>${esc(label)}: ${esc(name)}<br/>Date: _____________</p>`
  );
}

function witnessBlocks(count: number): string {
  if (count <= 0) return "";
  const blocks: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    blocks.push(
      `<p>____________________________<br/>Witness ${i}<br/>Printed name: _____________</p>`,
    );
  }
  return blocks.join("\n");
}

function notaryBlock(config: StateDocumentConfig, stateName: string, county: string): string {
  if (!config.notaryRequired) return "";
  return `<h2>NOTARIZATION</h2>
<p><strong>STATE OF ${esc(stateName.toUpperCase())}</strong><br/>
<strong>COUNTY OF ${esc(county.toUpperCase())}</strong></p>
<p>Subscribed and sworn before me, a Notary Public in and for said county and state, by the parties named above.</p>
<p>____________________________<br/>Notary Public<br/>My commission expires: _____________</p>`;
}

function advisoryBlock(advisories: string[]): string {
  if (advisories.length === 0) return "";
  return `<h2>ITEMS TO RESOLVE BEFORE EXECUTION</h2>
<ul>${advisories.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`;
}

function disclaimerBlock(): string {
  return `<hr/><p><em>${esc(DISCLAIMER_DOCUMENT_TEMPLATE)}</em></p>`;
}

function stateClosingBlock(
  config: StateDocumentConfig,
  stateName: string,
  purchasePriceRaw: number | null,
): string {
  const transferTax =
    config.transferTaxPercent > 0 && purchasePriceRaw !== null
      ? money(getTransferTaxAmount(config.state, purchasePriceRaw))
      : null;
  const rows: string[] = [
    `<li><strong>Recording:</strong> the instrument of conveyance shall be recorded with the ${esc(config.recordingOffice)} of ${esc(config.state)} (estimated recording fee ${esc(money(getRecordingEstimate(config.state)) ?? "as quoted by the recording office")}).</li>`,
  ];
  if (config.transferTaxPercent > 0) {
    rows.push(
      `<li><strong>Transfer tax:</strong> ${esc(config.transferTaxNotes)}${transferTax ? ` — estimated ${esc(transferTax)} at the price stated above` : ""}.</li>`,
    );
  } else {
    rows.push(`<li><strong>Transfer tax:</strong> ${esc(config.transferTaxNotes)}</li>`);
  }
  if (config.attorneyStateForClosing) {
    rows.push(
      `<li><strong>Attorney:</strong> ${esc(stateName)} requires a licensed attorney to conduct the closing.</li>`,
    );
  }
  rows.push(`<li><strong>${esc(stateName)} practice:</strong> ${esc(config.practiceNotes)}</li>`);
  return `<h2>${esc(stateName.toUpperCase())} CLOSING REQUIREMENTS</h2><ul>${rows.join("")}</ul>`;
}

function priceNumber(formatted: string): number | null {
  const n = Number.parseFloat(formatted.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function renderPurchaseAgreement(
  v: Record<string, string>,
  config: StateDocumentConfig,
  extra: { legalDescription: string | null; advisories: string[] },
): string {
  const legalDescSection = extra.legalDescription
    ? `<p><strong>Legal Description:</strong><br/>${esc(extra.legalDescription)}</p>`
    : `<p><strong>Legal Description:</strong> not on file — the recorded legal description must be attached as Exhibit A before execution.</p>`;

  return `<h1>${esc(KIND_TITLE.purchase_agreement)}</h1>
<p>This Purchase Agreement ("Agreement") is made as of <strong>${esc(v.today)}</strong> between:</p>
<p><strong>SELLER:</strong> ${esc(v.seller_name)}<br/>
<strong>BUYER:</strong> ${esc(v.buyer_name)}</p>

<h2>1. PROPERTY</h2>
<p>Seller agrees to sell and Buyer agrees to purchase the following real property situated in <strong>${esc(v.county)}</strong> County, State of <strong>${esc(v.state_name)}</strong>:</p>
<p><strong>Property Address:</strong> ${esc(v.property_address)}<br/>
<strong>Parcel Number (APN):</strong> ${esc(v.parcel_number)}${v.property_acres ? `<br/><strong>Size:</strong> ${esc(v.property_acres)} acres` : ""}</p>
${legalDescSection}

<h2>2. PURCHASE PRICE</h2>
<p>The purchase price is <strong>${esc(v.purchase_price)}</strong>, being the amount accepted by Seller for this parcel.${v.earnest_money ? ` Earnest money of ${esc(v.earnest_money)} shall be deposited with the closing agent named at closing.` : ""}</p>
<p>All funds shall be delivered through the closing or escrow agent selected by the parties. AcreOS is not a party to this transaction, holds no funds, and is not an escrow agent.</p>

<h2>3. CONVEYANCE</h2>
<p>At closing Seller shall convey title by <strong>${esc(getDeedTypeLabel(config.primaryDeedType))}</strong>, the customary instrument in ${esc(v.state_name)}, using the granting language "<em>${esc(config.grantingClause)}</em>" and the covenant that ${esc(config.warrantyClause)}</p>
<p>${esc(config.haberendumClause)}</p>

<h2>4. CLOSING</h2>
<p>Closing shall occur on or before <strong>${esc(v.closing_date)}</strong>.</p>
${stateClosingBlock(config, v.state_name, priceNumber(v.purchase_price))}

<h2>5. CONDITION AND DUE DILIGENCE</h2>
<p>Buyer has inspected or has had the opportunity to inspect the Property. Seller shall disclose all matters affecting title, access, and use known to Seller.</p>

${advisoryBlock(extra.advisories)}

<h2>SIGNATURES</h2>
<p>IN WITNESS WHEREOF, the parties execute this Agreement as of the dates written below.</p>
${signatureBlock("Seller", v.seller_name)}
${signatureBlock("Buyer", v.buyer_name)}
${witnessBlocks(config.witnessCount)}
${notaryBlock(config, v.state_name, v.county)}
${disclaimerBlock()}`;
}

function renderAssignmentOfContract(
  v: Record<string, string>,
  config: StateDocumentConfig,
  extra: { advisories: string[] },
): string {
  return `<h1>${esc(KIND_TITLE.assignment_of_contract)}</h1>
<p>This Assignment of Real Estate Contract ("Assignment") is made as of <strong>${esc(v.today)}</strong> between:</p>
<p><strong>ASSIGNOR:</strong> ${esc(v.assignor_name)}<br/>
<strong>ASSIGNEE:</strong> ${esc(v.assignee_name)}</p>

<h2>RECITALS</h2>
<p>WHEREAS, Assignor holds the buyer's interest under a Real Estate Purchase Agreement dated <strong>${esc(v.original_contract_date)}</strong> ("Original Contract") with <strong>${esc(v.seller_name)}</strong> as seller, for the purchase of real property situated in <strong>${esc(v.county)}</strong> County, State of <strong>${esc(v.state_name)}</strong>:</p>
<p><strong>Property Address:</strong> ${esc(v.property_address)}<br/>
<strong>Parcel Number (APN):</strong> ${esc(v.parcel_number)}${v.property_acres ? `<br/><strong>Size:</strong> ${esc(v.property_acres)} acres` : ""}</p>
<p>WHEREAS, the Original Contract states a purchase price of <strong>${esc(v.purchase_price)}</strong> with closing on or before <strong>${esc(v.closing_date)}</strong>.</p>

<h2>1. ASSIGNMENT</h2>
<p>Assignor assigns and transfers to Assignee all of Assignor's right, title, and interest in the Original Contract, and Assignee assumes all of Assignor's obligations under it.</p>

<h2>2. ASSIGNMENT FEE</h2>
<p>Assignee shall pay Assignor an assignment fee of <strong>${esc(v.assignment_fee)}</strong>. The fee is payable at closing through the closing or escrow agent. AcreOS is not a party to this Assignment, collects no fee under it, and holds no funds.</p>

<h2>3. NO CHANGE TO THE ORIGINAL CONTRACT</h2>
<p>Nothing in this Assignment modifies the Original Contract's price, closing date, or conveyance terms. At closing Seller shall convey title by <strong>${esc(getDeedTypeLabel(config.primaryDeedType))}</strong>, the customary instrument in ${esc(v.state_name)}.</p>

<h2>4. ASSIGNEE ACKNOWLEDGEMENT</h2>
<p>Assignee acknowledges receipt of a copy of the Original Contract and accepts the Property in the condition described in it.</p>
${stateClosingBlock(config, v.state_name, priceNumber(v.purchase_price))}

${advisoryBlock(extra.advisories)}

<h2>SIGNATURES</h2>
<p>IN WITNESS WHEREOF, the parties execute this Assignment as of the dates written below.</p>
${signatureBlock("Assignor", v.assignor_name)}
${signatureBlock("Assignee", v.assignee_name)}
${witnessBlocks(config.witnessCount)}
${notaryBlock(config, v.state_name, v.county)}
${disclaimerBlock()}`;
}
