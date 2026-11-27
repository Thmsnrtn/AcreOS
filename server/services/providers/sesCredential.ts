/**
 * SES credential packing — the `aws_ses` ↔ `ses` name map and the JSON-bag
 * convention for the byok vault (P9-2e, Stage 2/3 of
 * docs/company/credential-consolidation-plan.md, SES portion).
 *
 * The legacy store names this provider `aws_ses` (organizationIntegrations
 * provider key); the canonical vault names its channel `ses`
 * (BYOK_CHANNELS). Every SES touchpoint maps the names explicitly through
 * this module — a grep for one name must never be the only thing standing
 * between the two stores.
 *
 * The vault holds ONE opaque string per (org, channel), so the five-field
 * SES bag is packed as a JSON string inside the `ses` channel:
 *
 *   {"accessKeyId": "...", "secretAccessKey": "...",
 *    "region": "...", "fromEmail": "...", "fromName": "..."}
 *
 * (optional fields omitted when absent). resolveProviderCredential's header
 * anticipates exactly this convention: it returns the raw string and "the
 * caller keeps its own platform/env fallback and interprets the secret (a
 * single key, or a JSON tuple it parses)".
 *
 * Field classification (named in the P9-2e PR body): `secretAccessKey` is
 * the only true secret; `accessKeyId` is an identifier; `region`,
 * `fromEmail` and `fromName` are config / sender identity. All five ride
 * inside the bag for read-parity with the legacy single-bag reader
 * (emailService.getOrgCredentials returns all five from one read, and its
 * verified-domain sender fallback runs downstream of that read unchanged).
 */

export interface SesCredentialBag {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  fromEmail?: string;
  fromName?: string;
}

/** The BYOK hub's plaintext ceiling for a stored credential (routes-byok). */
export const SES_VAULT_PLAINTEXT_MAX = 8192;

/**
 * Parse a raw vault `ses` string into a credential bag. Returns null for
 * anything that is not a JSON object carrying BOTH secret-bearing fields —
 * the same both-fields gate emailService's legacy reader applies, so a
 * partial vault value can never read as "connected".
 */
export function parseSesVaultCredential(raw: string | null | undefined): SesCredentialBag | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const bag = parsed as Record<string, unknown>;
  if (typeof bag.accessKeyId !== "string" || !bag.accessKeyId) return null;
  if (typeof bag.secretAccessKey !== "string" || !bag.secretAccessKey) return null;
  const out: SesCredentialBag = {
    accessKeyId: bag.accessKeyId,
    secretAccessKey: bag.secretAccessKey,
  };
  if (typeof bag.region === "string" && bag.region) out.region = bag.region;
  if (typeof bag.fromEmail === "string" && bag.fromEmail) out.fromEmail = bag.fromEmail;
  if (typeof bag.fromName === "string" && bag.fromName) out.fromName = bag.fromName;
  return out;
}

/**
 * Build the vault plaintext for an SES save through the generic
 * POST /api/integrations/:provider route, from that route's historical
 * merge shape: the handler seals `{apiKey, ...settings}`, so an aws_ses
 * save arrives as apiKey = the access key id (the simulation probe in
 * tests/simulation/campaign/market/deliverability.ts posts exactly this)
 * with the remaining fields inside `settings`. An explicit
 * settings.accessKeyId wins over apiKey, mirroring the spread order of
 * the historical seal. Returns null when either secret-bearing field is
 * missing — a partial bag is never vaulted.
 */
export function buildSesVaultPlaintext(
  apiKey: string | undefined,
  settings: Record<string, unknown> | undefined,
): string | null {
  const s = settings ?? {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined;
  const bag: SesCredentialBag = {
    accessKeyId: str(s.accessKeyId) ?? str(apiKey) ?? "",
    secretAccessKey: str(s.secretAccessKey) ?? "",
  };
  if (!bag.accessKeyId || !bag.secretAccessKey) return null;
  const region = str(s.region);
  const fromEmail = str(s.fromEmail);
  const fromName = str(s.fromName);
  if (region) bag.region = region;
  if (fromEmail) bag.fromEmail = fromEmail;
  if (fromName) bag.fromName = fromName;
  return JSON.stringify(bag);
}

/**
 * Read an org's vault SES bag (channel `ses` — the vault name for the
 * legacy `aws_ses` provider). Fail-soft: any vault error or unparseable /
 * incomplete value returns null so callers fall through to their legacy
 * leg, exactly as the vault-first resolver treats its vault leg.
 */
export async function readSesVaultBag(organizationId: number): Promise<SesCredentialBag | null> {
  try {
    const { getByokCredential } = await import("../byok/key-vault");
    const raw = await getByokCredential({ organizationId, channel: "ses" });
    return parseSesVaultCredential(raw);
  } catch {
    return null;
  }
}
