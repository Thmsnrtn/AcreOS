/**
 * Signer-request parsing for the native e-sign rail.
 *
 * WHY THIS IS A MODULE AND NOT AN `if` IN THE ROUTE
 * -------------------------------------------------
 * `POST /api/generated-documents/:id/request-signature` mints per-signer HMAC
 * signing links — the single most sensitive action in the document system,
 * because each link authorizes an external party to bind the org's name to a
 * contract. CodeQL flagged the handler HIGH ("user-controlled bypass of a
 * security check"): the nearest guard standing in front of that minting was a
 * condition over `req.body.signers`, i.e. a value the caller supplies.
 *
 * The finding was right about the SHAPE even though the actual boundary was
 * elsewhere. The real gates are all server-side and all sit earlier:
 * `isAuthenticated`, `getOrCreateOrg`, the org-scoped document load, the
 * `status === "draft"` check, the state-disclosure gate, and the reviewed-content
 * seal. What the body check does is *validate input* — and input validation
 * belongs in a function that cannot reach a sensitive action, not inline where
 * it reads like the authorization decision.
 *
 * So: every refusal over client-supplied fields lives here, in a pure module
 * with no express, no db, no token minting. The route calls it once, after all
 * server-side gates have already passed. `signerRequestOrdering.test.ts` pins
 * that ordering so a future refactor cannot put a client field back in front.
 *
 * SECOND REASON: it was never actually validated. `signer.name` and
 * `signer.email` were read straight off `req.body` as `any` and written to the
 * document row, so a malformed or oversized payload became part of a legal
 * record. Now they are bounded and shaped.
 */

/** An empty email is LEGITIMATE and must stay accepted. */
const MAX_SIGNERS = 20;
const MAX_NAME_LEN = 200;
const MAX_EMAIL_LEN = 320; // RFC 5321 practical maximum
const MAX_ROLE_LEN = 60;

/** Deliberately permissive: reject the obviously-not-an-address, nothing more. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedSigner {
  name: string;
  email: string;
  role: string;
}

export interface SignerRequestRefusal {
  code:
    | "SIGNERS_NOT_A_LIST"
    | "SIGNERS_EMPTY"
    | "SIGNERS_TOO_MANY"
    | "SIGNER_NOT_AN_OBJECT"
    | "SIGNER_NAME_MISSING"
    | "SIGNER_FIELD_TOO_LONG"
    | "SIGNER_EMAIL_MALFORMED";
  message: string;
  /** 0-based position of the offending signer, when the fault is one entry. */
  index?: number;
}

/**
 * Thrown by {@link parseSignerRequest}. Carries a named refusal so the route
 * can answer 400 with something the operator can act on, and so the failure is
 * distinguishable from an unexpected 500.
 */
export class SignerRequestError extends Error {
  readonly refusal: SignerRequestRefusal;
  constructor(refusal: SignerRequestRefusal) {
    super(refusal.message);
    this.name = "SignerRequestError";
    this.refusal = refusal;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export interface ParseSignerOptions {
  /**
   * The legacy `/send-for-signature` endpoint has always accepted an empty
   * list (it records intent without issuing links). Only that caller passes
   * this; the link-minting endpoint requires at least one signer.
   */
  allowEmpty?: boolean;
}

/**
 * Parse and bound a client-supplied signer list.
 *
 * Throws {@link SignerRequestError} on any malformed input. Returns normalized
 * signers — trimmed, role-defaulted — on success. Never mints anything, never
 * touches the database, never decides authorization.
 */
export function parseSignerRequest(raw: unknown, opts: ParseSignerOptions = {}): ParsedSigner[] {
  if (raw === undefined || raw === null) {
    if (opts.allowEmpty) return [];
    throw new SignerRequestError({
      code: "SIGNERS_EMPTY",
      message: "At least one signer is required.",
    });
  }

  if (!Array.isArray(raw)) {
    throw new SignerRequestError({
      code: "SIGNERS_NOT_A_LIST",
      message: "Signers must be a list.",
    });
  }

  if (raw.length === 0 && !opts.allowEmpty) {
    throw new SignerRequestError({
      code: "SIGNERS_EMPTY",
      message: "At least one signer is required.",
    });
  }

  if (raw.length > MAX_SIGNERS) {
    throw new SignerRequestError({
      code: "SIGNERS_TOO_MANY",
      message: `A document can be sent to at most ${MAX_SIGNERS} signers.`,
    });
  }

  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new SignerRequestError({
        code: "SIGNER_NOT_AN_OBJECT",
        message: `Signer ${index + 1} is not a signer record.`,
        index,
      });
    }

    const row = entry as Record<string, unknown>;
    const name = str(row.name);
    const email = str(row.email);
    const role = str(row.role) || "signer";

    if (!name) {
      throw new SignerRequestError({
        code: "SIGNER_NAME_MISSING",
        message: `Signer ${index + 1} needs a name.`,
        index,
      });
    }

    if (name.length > MAX_NAME_LEN || email.length > MAX_EMAIL_LEN || role.length > MAX_ROLE_LEN) {
      throw new SignerRequestError({
        code: "SIGNER_FIELD_TOO_LONG",
        message: `Signer ${index + 1} has a field that is too long to store.`,
        index,
      });
    }

    // An EMPTY email is allowed on purpose: the assignor in a wholesale
    // assignment is usually the operator themselves, who takes their link from
    // the response rather than by email. A NON-empty address, though, must look
    // like one — a malformed address in a signed record is a defect either way.
    if (email && !EMAIL_SHAPE.test(email)) {
      throw new SignerRequestError({
        code: "SIGNER_EMAIL_MALFORMED",
        message: `Signer ${index + 1} has an email address we can't send to.`,
        index,
      });
    }

    return { name, email, role };
  });
}

export const SIGNER_REQUEST_LIMITS = {
  MAX_SIGNERS,
  MAX_NAME_LEN,
  MAX_EMAIL_LEN,
  MAX_ROLE_LEN,
} as const;
