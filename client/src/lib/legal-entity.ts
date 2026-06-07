/**
 * Single source of truth for AcreOS's legal entity status.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * AcreOS's public legal documents (Terms of Service, Privacy Policy,
 * sub-processor list, footers) must state who, legally, operates the
 * Service. As of this writing AcreOS is operated by an individual as a
 * sole proprietorship in Massachusetts — there is no incorporated entity
 * yet. A Massachusetts LLC formation is planned and will be filed just
 * before the first paying customer.
 *
 * Stating an entity that does not exist (e.g. "AcreOS, Inc., a Delaware
 * corporation") is materially false and weakens — rather than
 * strengthens — any liability shield. These constants keep the truthful
 * current status in one place so that, the moment the MA LLC is formed,
 * flipping the entire app to "AcreOS LLC" is a single edit here.
 *
 * THE FUTURE SWAP (one edit, when the MA LLC is formed)
 * ----------------------------------------------------
 * When Tom completes the Certificate of Organization filing (see
 * docs/founder/ma-llc-formation-checklist.md), change `ENTITY_STATUS`
 * to "llc" below. Everything downstream updates automatically. No other
 * code change is required for the entity language itself.
 */

type EntityStatus = "sole-proprietor" | "llc";

// Flip this to "llc" once the MA Certificate of Organization is filed.
const ENTITY_STATUS: EntityStatus = "sole-proprietor";

const ENTITY_DEFINITIONS = {
  "sole-proprietor": {
    /** The legal operator name used in running prose. */
    legalName: "AcreOS",
    /** Full descriptor for the "operated by" sentence. */
    operatedBy:
      "The Service is operated by AcreOS (\"AcreOS,\" \"we,\" \"us,\" or \"our\"), a sole proprietorship of Thomas Norton based in Massachusetts. A Massachusetts limited liability company is being formed; these Terms will be updated to name it once it is formed.",
    /** Compact descriptor for footers / signature blocks. */
    footerDescriptor: "AcreOS · operated by Thomas Norton (sole proprietor, Massachusetts) · acreos.io",
    /** Governing-law jurisdiction. Sole proprietor is domiciled in MA. */
    governingState: "Massachusetts",
    /** DPA / contract signature-block entity name. */
    contractEntity: "AcreOS (a sole proprietorship of Thomas Norton, Massachusetts)",
  },
  llc: {
    legalName: "AcreOS LLC",
    operatedBy:
      "The Service is operated by AcreOS LLC (\"AcreOS,\" \"we,\" \"us,\" or \"our\"), a Massachusetts limited liability company.",
    footerDescriptor: "AcreOS LLC · a Massachusetts limited liability company · acreos.io",
    governingState: "Massachusetts",
    contractEntity: "AcreOS LLC, a Massachusetts limited liability company",
  },
} as const;

const ACTIVE = ENTITY_DEFINITIONS[ENTITY_STATUS];

/** "AcreOS" today; "AcreOS LLC" once formed. Use in running prose. */
export const LEGAL_ENTITY_NAME = ACTIVE.legalName;

/** Full, truthful "operated by" sentence for ToS / Privacy intros. */
export const LEGAL_ENTITY_OPERATED_BY = ACTIVE.operatedBy;

/** Compact descriptor for footers and signature blocks. */
export const LEGAL_ENTITY_FOOTER = ACTIVE.footerDescriptor;

/** The state whose law governs the agreement and where venue sits. */
export const LEGAL_GOVERNING_STATE = ACTIVE.governingState;

/** Entity name for contract/DPA signature blocks. */
export const LEGAL_CONTRACT_ENTITY = ACTIVE.contractEntity;

/** True while no incorporated/registered entity exists yet. */
export const IS_PRE_ENTITY = ENTITY_STATUS === "sole-proprietor";
