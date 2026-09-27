/**
 * The vendor providers the founder "System API keys" page offered a key field
 * for (DEFECT-0054, 2026-09-27).
 *
 * That page saved whatever was pasted — an OpenAI, Stripe or Twilio SECRET —
 * in plain text into `system_api_keys.api_key`. Nothing ever read those values
 * for an outbound call; the platform reads its vendor keys from the server
 * environment. But `system_api_keys` is also the Data-API credential table, and
 * its legacy plain-text fallback accepted any active row. So each pasted vendor
 * secret was, in addition, a working bearer key for AcreOS's partner Data API.
 *
 * The page no longer accepts keys, and the Data-API verifier refuses a legacy
 * plain-text match on any of these providers. This list is the one both read,
 * so the page cannot offer a provider the verifier does not exclude.
 */
export const PLATFORM_VENDOR_KEY_PROVIDERS = [
  { provider: "openai", displayName: "OpenAI", description: "GPT models for AI features" },
  { provider: "openrouter", displayName: "OpenRouter", description: "Multi-model routing" },
  { provider: "anthropic", displayName: "Anthropic", description: "Claude models" },
  { provider: "stripe", displayName: "Stripe", description: "Payment processing" },
  { provider: "sendgrid", displayName: "SendGrid", description: "Email delivery" },
  { provider: "twilio", displayName: "Twilio", description: "SMS & voice" },
  { provider: "lob", displayName: "Lob", description: "Direct mail campaigns" },
  { provider: "regrid", displayName: "Regrid", description: "Parcel & property data" },
  { provider: "mapbox", displayName: "Mapbox", description: "Maps & geocoding" },
] as const;

const SLUGS: ReadonlySet<string> = new Set(PLATFORM_VENDOR_KEY_PROVIDERS.map((p) => p.provider));

/** True when a system_api_keys row names a platform vendor, not a Data-API partner. */
export function isPlatformVendorProvider(provider: string): boolean {
  return SLUGS.has(provider.trim().toLowerCase());
}
