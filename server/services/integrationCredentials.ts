/**
 * One way to read an organization's provider credentials.
 *
 * `organization_integrations.credentials` is written in TWO shapes by two live
 * customer-facing surfaces, and it was read in two shapes by different halves of
 * the codebase — which is not a style inconsistency, it is a correctness,
 * security and billing defect:
 *
 *   - `POST /api/integrations/:provider` writes `{ encrypted: "<envelope>" }`.
 *   - `POST /api/settings/save-api-key` — the route behind the BYOK panel in
 *     Settings, the one a customer actually uses — wrote `{ apiKey: "sk_..." }`
 *     IN THE CLEAR.
 *
 * A key set through the panel was therefore invisible to every consumer that
 * looked for `credentials.encrypted`, which was most of them:
 *
 *   - `comps.ts` and `directMail.ts` did not find it, so the org's lookups and
 *     mail ran on the PLATFORM's key — AcreOS paying a vendor bill the customer
 *     had supplied their own account for.
 *   - `routes-properties.ts` decided whether to charge credits with
 *     `credentials?.encrypted`, so the same customer was ALSO billed ten cents
 *     a comps query for lookups their own key was meant to cover. Charged for
 *     a key they gave us and we then ignored.
 *   - `financeAgent.hasConnectedSendingIdentity` reported no connected sending
 *     identity for an org that had connected one.
 *   - `POST /api/integrations/:provider/test` threw: it read `.encrypted`
 *     unguarded and handed `undefined` to `JSON.parse`.
 *
 * while `mailProvider.ts` and `parcel.ts` read the plaintext field and no other,
 * so they were the only two that DID honour it.
 *
 * WHY PLAINTEXT WINS ON A CONFLICT. A row can carry both, because
 * `upsertOrganizationIntegration` replaces `credentials` wholesale while
 * save-api-key merged onto whatever was there. So an envelope write erases any
 * plaintext sibling, and a plaintext sibling can only have been written AFTER an
 * envelope. Both present therefore means the plaintext field is the more recent
 * — which is also what save-api-key was trying to express when it wrote
 * `{ ...existing.credentials, apiKey }` and could not see inside the envelope.
 * Fields are merged, not chosen: the newer plaintext values override, and
 * anything only the envelope holds survives.
 *
 * Empty and null plaintext fields are dropped before merging, so a stray blank
 * cannot blank out a real key.
 *
 * THE GATE AND THE USE MUST READ THE SAME WAY. There is deliberately no cheaper
 * "does this org have its own key?" helper that answers without decrypting.
 * That shortcut is what the credit check used, and a gate that answers
 * differently from the code it gates is the whole defect above.
 */

import { logger } from "../utils/logger";
import { decryptJsonCredentials, encryptJsonCredentials } from "./fieldEncryption";

type CredentialBag = Record<string, unknown>;

interface IntegrationLike {
  credentials?: unknown;
}

/** Drop keys whose value is absent or blank, so they cannot override a real one. */
function meaningful(bag: CredentialBag): CredentialBag {
  const out: CredentialBag = {};
  for (const [k, v] of Object.entries(bag)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * The credentials an org has supplied for a provider, whichever shape they are
 * stored in. `null` means none are configured — or that an envelope exists and
 * could not be opened, which is logged as an error and deliberately reads the
 * same as "not configured" so a key we cannot use is never presented as usable.
 */
export function readIntegrationCredentials<T extends CredentialBag = CredentialBag>(
  integration: IntegrationLike | null | undefined,
  organizationId?: number,
  label = "integration",
): T | null {
  const raw = integration?.credentials;
  if (!raw || typeof raw !== "object") return null;

  const { encrypted, ...plain } = raw as CredentialBag & { encrypted?: unknown };

  let sealed: CredentialBag = {};
  if (typeof encrypted === "string" && encrypted.length > 0) {
    try {
      sealed = decryptJsonCredentials<CredentialBag>(encrypted, organizationId);
    } catch (err) {
      // Not fatal on its own: a row can hold readable plaintext siblings
      // alongside an envelope this process cannot open.
      logger.error(
        `[integrationCredentials] ${label}: stored credentials could not be decrypted: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  const merged = { ...sealed, ...meaningful(plain) };
  return Object.keys(merged).length > 0 ? (merged as T) : null;
}

/**
 * The shape to WRITE. Always an envelope, and always the whole bag — callers
 * merge their change onto `readIntegrationCredentials` first, so that saving one
 * field never drops the others and never leaves a plaintext sibling behind.
 */
export function sealIntegrationCredentials(
  credentials: CredentialBag,
  organizationId?: number,
): { encrypted: string } {
  return { encrypted: encryptJsonCredentials(credentials, organizationId) };
}
