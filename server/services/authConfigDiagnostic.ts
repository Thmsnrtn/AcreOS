/**
 * Auth-config self-diagnostic — turns a silent "every /api/founder/* call
 * 401s" outage into an actionable one-line cause, WITHOUT ever exposing a
 * secret.
 *
 * Background: the server verifies a Clerk session two ways.
 *   1. `clerkMiddleware` (global) verifies inline using CLERK_SECRET_KEY.
 *   2. When that can't populate `req.auth` (our proxy/Cloudflare path),
 *      `hydrateUser` falls back to verifying the `__session` cookie JWT
 *      against CLERK_JWT_KEY.
 * CLERK_JWT_KEY is NOT a boot-required key (validateEnv never checked it),
 * so it can be silently missing or malformed in prod. When it is, and the
 * inline path is also failing, EVERY authenticated request 401s — the SPA
 * still renders (client Clerk is fine) but every data call is rejected. The
 * symptom is blank/failed founder doors with no clue why.
 *
 * This module computes a report from ENV PRESENCE + SHAPE only. It never
 * reads, logs, or returns key material — only "live | test | missing",
 * "present", and "looks like a PEM". That is safe to surface to a
 * signed-in operator so they can fix the right Fly secret and redeploy.
 */

export type KeyMode = "live" | "test" | "missing" | "unknown";

export type AuthConfigCause =
  | "none"
  | "secret_key_missing"
  | "mode_mismatch"
  | "jwt_key_missing"
  | "jwt_key_malformed";

export interface AuthConfigReport {
  /** sk_live_… → "live", sk_test_… → "test", unset → "missing". */
  clerkSecretKeyMode: KeyMode;
  /** pk_live_… → "live", pk_test_… → "test", unset → "missing". */
  clerkPublishableKeyMode: KeyMode;
  /** Whether CLERK_JWT_KEY is set at all. */
  clerkJwtKeyPresent: boolean;
  /** Whether a present CLERK_JWT_KEY is shaped like a usable PEM public key. */
  clerkJwtKeyLooksLikePem: boolean;
  /** secret and publishable disagree on live-vs-test (both known). */
  modeMismatch: boolean;
  /** The single most likely cause of an all-requests-401 outage. */
  likelyCause: AuthConfigCause;
  /** Operator-facing, secret-free next step. */
  hint: string;
}

function modeOf(key: string | undefined, prefix: "sk_" | "pk_"): KeyMode {
  if (!key) return "missing";
  if (key.startsWith(`${prefix}live_`)) return "live";
  if (key.startsWith(`${prefix}test_`)) return "test";
  return "unknown";
}

/**
 * `crypto.createVerify(...).verify(pem, ...)` in hydrateUser needs a real PEM
 * public key. A common misconfig is pasting the bare base64 body from the
 * Clerk dashboard WITHOUT the `-----BEGIN PUBLIC KEY-----` envelope — verify
 * then throws and the fallback silently fails. Detect that shape here.
 */
function looksLikePublicKeyPem(key: string | undefined): boolean {
  if (!key) return false;
  return /-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(key) &&
    /-----END (?:RSA )?PUBLIC KEY-----/.test(key);
}

export function computeAuthConfigReport(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfigReport {
  const clerkSecretKeyMode = modeOf(env.CLERK_SECRET_KEY, "sk_");
  // The publishable key is normally a client build-time var (VITE_…); it may
  // or may not also be present in the server env. We read it opportunistically
  // — when present it lets us catch the live-vs-test mismatch class.
  const publishable = env.VITE_CLERK_PUBLISHABLE_KEY || env.CLERK_PUBLISHABLE_KEY;
  const clerkPublishableKeyMode = modeOf(publishable, "pk_");

  const clerkJwtKeyPresent = Boolean(env.CLERK_JWT_KEY);
  const clerkJwtKeyLooksLikePem = looksLikePublicKeyPem(env.CLERK_JWT_KEY);

  const bothModesKnown =
    (clerkSecretKeyMode === "live" || clerkSecretKeyMode === "test") &&
    (clerkPublishableKeyMode === "live" || clerkPublishableKeyMode === "test");
  const modeMismatch = bothModesKnown && clerkSecretKeyMode !== clerkPublishableKeyMode;

  // Order matters: report the most fundamental misconfig first.
  let likelyCause: AuthConfigCause = "none";
  let hint =
    "Clerk keys look consistent. If sessions still fail, sign out and back in to refresh the session cookie — a stale cookie from a previous deploy is the usual remaining cause.";

  if (clerkSecretKeyMode === "missing") {
    likelyCause = "secret_key_missing";
    hint =
      "CLERK_SECRET_KEY is not set on the server. The API cannot verify any session. Set it (Clerk dashboard → API Keys → Secret key) as a Fly secret and redeploy.";
  } else if (modeMismatch) {
    likelyCause = "mode_mismatch";
    hint =
      `Clerk keys are from different environments — the secret key is ${clerkSecretKeyMode} but the publishable key is ${clerkPublishableKeyMode}. ` +
      "Sessions minted by one instance are rejected by the other, so every request 401s. Make both keys come from the SAME Clerk instance (both live, or both test) and redeploy.";
  } else if (!clerkJwtKeyPresent) {
    likelyCause = "jwt_key_missing";
    hint =
      "CLERK_JWT_KEY is not set. When a request can't be verified inline (our proxy/Cloudflare path), the server falls back to verifying the session cookie with CLERK_JWT_KEY — without it, that fallback is skipped and every request 401s. " +
      "Add CLERK_JWT_KEY (Clerk dashboard → API Keys → Show JWT public key → the PEM) as a Fly secret and redeploy.";
  } else if (!clerkJwtKeyLooksLikePem) {
    likelyCause = "jwt_key_malformed";
    hint =
      "CLERK_JWT_KEY is set but doesn't look like a PEM public key. It must include the full envelope, including the `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC KEY-----` lines. " +
      "Re-copy the JWT public key from the Clerk dashboard (API Keys → Show JWT public key), set it as a Fly secret, and redeploy.";
  }

  return {
    clerkSecretKeyMode,
    clerkPublishableKeyMode,
    clerkJwtKeyPresent,
    clerkJwtKeyLooksLikePem,
    modeMismatch,
    likelyCause,
    hint,
  };
}
