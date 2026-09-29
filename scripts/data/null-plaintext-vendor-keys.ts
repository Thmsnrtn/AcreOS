#!/usr/bin/env tsx
/**
 * Founder ruling 2026-09-29 #9b: null the plain-text vendor secrets left in
 * `system_api_keys.api_key`.
 *
 * The founder "System API keys" page once stored pasted vendor secrets
 * (OpenAI, Stripe, Twilio …) in plain text. Nothing reads them since the fix
 * (the save route answers 410, and verifyApiKey refuses a legacy match on any
 * vendor provider), but the plaintext is still at rest. This nulls `api_key`
 * on rows whose provider is a platform vendor, keeping `key_last4` so the
 * page still shows which key it was. Secrets are never printed or exported —
 * rotate each listed key at its vendor.
 *
 * Data-API partner rows (non-vendor providers) are NOT touched: they upgrade
 * to key_hash on their next verified use.
 *
 *   DATABASE_URL=... npx tsx scripts/data/null-plaintext-vendor-keys.ts          # dry run
 *   DATABASE_URL=... npx tsx scripts/data/null-plaintext-vendor-keys.ts --apply  # null them
 */
import { PLATFORM_VENDOR_KEY_PROVIDERS } from "../../shared/platformVendorKeyProviders";
import { connect, isMain, parseFlags, type Queryable } from "./_client";

const VENDOR_SLUGS = PLATFORM_VENDOR_KEY_PROVIDERS.map((p) => p.provider);

export async function nullPlaintextVendorKeys(
  client: Queryable,
  apply: boolean,
): Promise<{ affected: Array<{ id: number; provider: string; keyLast4: string | null }>; applied: boolean }> {
  const { rows } = await client.query<{ id: number; provider: string; key_last4: string | null }>(
    `SELECT id, provider, key_last4 FROM system_api_keys
      WHERE api_key IS NOT NULL AND provider = ANY($1::text[]) ORDER BY provider`,
    [VENDOR_SLUGS],
  );
  const affected = rows.map((r) => ({ id: r.id, provider: r.provider, keyLast4: r.key_last4 }));
  if (apply && affected.length > 0) {
    await client.query(
      `UPDATE system_api_keys SET api_key = NULL
        WHERE id = ANY($1::int[]) AND provider = ANY($2::text[])`,
      [affected.map((a) => a.id), VENDOR_SLUGS],
    );
  }
  return { affected, applied: apply && affected.length > 0 };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const r = await nullPlaintextVendorKeys(client, flags.apply);
  await end();
  console.log(`${r.affected.length} vendor row(s) hold a plain-text secret:`);
  for (const a of r.affected) console.log(`  ${a.provider} (…${a.keyLast4 ?? "????"}) — rotate this key at the vendor`);
  console.log(r.applied ? "api_key nulled on these rows." : "Dry run: nothing changed. Re-run with --apply to null them.");
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
