/**
 * The borrower statement portal's signing secret, as a configuration state.
 *
 * `POST /api/borrower/auth/exchange` mints an HMAC-signed statement cookie
 * with BORROWER_SESSION_SECRET. Without a usable secret the portal cannot
 * issue or verify that cookie, and the rest of the app is unaffected — so a
 * missing secret is reported once at boot (validateEnv) and the exchange
 * answers 503 "not configured", never a 500 and never a cookie signed with
 * anything else. This file is the single predicate both sides read.
 */

export const BORROWER_SESSION_SECRET_ENV = "BORROWER_SESSION_SECRET";
export const MIN_BORROWER_SESSION_SECRET_LENGTH = 16;

export type BorrowerSessionSecretProblem = "missing" | "too_short";

/** Why the configured secret cannot sign, or null when it can. */
export function borrowerSessionSecretProblem(
  env: Record<string, string | undefined> = process.env,
): BorrowerSessionSecretProblem | null {
  const secret = env[BORROWER_SESSION_SECRET_ENV];
  if (!secret) return "missing";
  if (secret.length < MIN_BORROWER_SESSION_SECRET_LENGTH) return "too_short";
  return null;
}

export function isStatementPortalConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return borrowerSessionSecretProblem(env) === null;
}

/** The refusal copy the exchange answers with while unconfigured. */
export const STATEMENT_PORTAL_NOT_CONFIGURED_MESSAGE =
  "The statement portal is not configured on this deployment yet. Please contact your lender.";

/** Thrown by the signer when asked to sign without a usable secret. */
export class StatementPortalNotConfiguredError extends Error {
  readonly code = "STATEMENT_PORTAL_NOT_CONFIGURED";
  constructor(readonly problem: BorrowerSessionSecretProblem) {
    super(
      `${BORROWER_SESSION_SECRET_ENV} is ${problem === "missing" ? "not set" : `shorter than ${MIN_BORROWER_SESSION_SECRET_LENGTH} characters`}; the statement portal cannot sign sessions.`,
    );
    this.name = "StatementPortalNotConfiguredError";
  }
}
