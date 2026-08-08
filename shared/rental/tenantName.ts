// ---------------------------------------------------------------------------
// Tenant display name — ONE honest source of truth (commercial beta, Wave 2
// pass B).
// ---------------------------------------------------------------------------
// The tenants table went person-shaped → person-OR-entity: firstName/lastName
// are nullable and an entity (company) tenant carries `companyName` with
// `isEntity = true`. Every surface that renders a tenant's name must therefore
// pick the right field, and — critically — must NEVER interpolate
// `${firstName} ${lastName}` blindly, which renders the literal "null null" for
// a company tenant. That is a fabrication (a made-up name shown as real), so it
// fails the honesty bar.
//
// This helper is that single decision, so it cannot drift between the workflow
// payloads (server/services/rentalEvents.ts), the deposit disposition letter
// (server/routes-rent-ledger.ts), the lease signing packet
// (server/services/rental/leaseSigningPacket.ts) and the tenants page
// (client/src/pages/tenants.tsx). Lives in shared/ (browser-safe: a pure
// function, no imports, no process.env) so client and server share it.
// ---------------------------------------------------------------------------

export interface TenantNameParts {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  isEntity?: boolean | null;
}

/**
 * A tenant's display name, HONEST across person + entity tenants:
 *   - an entity/company tenant (isEntity) with a non-empty companyName → that
 *     company name;
 *   - otherwise "First Last" from whatever person names exist (each coalesced
 *     to "" before trimming, so a bare first or last name still renders);
 *   - a row with NEITHER a company name nor any person name → `null`.
 *
 * Never a placeholder. `null` is deliberate: callers DROP a null (skip the
 * signer line, omit from a comma list) rather than emit a blank or "null null".
 */
export function tenantDisplayName(t: TenantNameParts): string | null {
  if (t.isEntity && t.companyName && t.companyName.trim() !== "") {
    return t.companyName.trim();
  }
  const personName = `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim();
  return personName !== "" ? personName : null;
}
