import { logger } from "../utils/logger";
import {
  getCachedOrFetch,
  normalizeQuery,
  defaultFreshnessHours,
} from "./data-cache/lookup-cache";
/**
 * T26 — Skip Tracing Real Integration
 *
 * Integrates with BatchSkipTracing API to find contact information for
 * property owners given their name and address.
 *
 * Primary: BatchSkipTracing (https://batchskiptracing.com)
 * Fallback: REISkip (https://reiskip.com) if REISKIP_API_KEY is set
 *
 * Required env:
 *   BATCH_SKIP_TRACING_API_KEY  — BatchSkipTracing.com API key
 *   REISKIP_API_KEY             — (optional) REISkip fallback
 *
 * Usage:
 *   import { skipTracingService } from "./skipTracingService";
 *
 *   const result = await skipTracingService.trace({
 *     firstName: "John", lastName: "Smith",
 *     address: "123 Main St", city: "Austin", state: "TX", zip: "78701",
 *   });
 *
 *   // Returns phones, emails, relatives — ready to store on lead
 */

export interface SkipTraceInput {
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  apn?: string;
}

export interface SkipTraceContact {
  type: "phone" | "email" | "relative";
  value: string;
  confidence: number; // 0-1
  isPrimary: boolean;
  doNotCall?: boolean;
  carrier?: string;
  lineType?: "mobile" | "landline" | "voip";
}

export interface SkipTraceResult {
  success: boolean;
  source: "batch_skip_tracing" | "reiskip" | "none";
  contacts: SkipTraceContact[];
  owner?: {
    fullName?: string;
    age?: number;
    address?: string;
    mailingAddress?: string;
  };
  error?: string;
  creditsUsed?: number;
}

async function traceViaBatchSkipTracing(input: SkipTraceInput, organizationId?: number): Promise<SkipTraceResult> {
  // Universal BYOK (2026-05-22): prefer customer-supplied key. Falls
  // back to platform env. Customer keys are billed directly by
  // BatchSkipTracing so postSkipTraceCostToLedger short-circuits when
  // BYOK is active.
  let apiKey: string | null = process.env.BATCH_SKIP_TRACING_API_KEY ?? null;
  if (organizationId != null) {
    try {
      const { getEffectiveCredential } = await import("./byok/toggle");
      const eff = await getEffectiveCredential(organizationId, "batch_skiptracing");
      if (eff.credential) apiKey = eff.credential;
    } catch {
      /* best-effort */
    }
  }
  if (!apiKey) throw new Error("BATCH_SKIP_TRACING_API_KEY not configured");

  // BatchSkipTracing expects a CSV upload or single-record API call
  const payload = {
    first_name: input.firstName || "",
    last_name: input.lastName || "",
    property_address: input.address || "",
    property_city: input.city || "",
    property_state: input.state || "",
    property_zip: input.zip || "",
  };

  const response = await fetch("https://api.batchskiptracing.com/api/v2/lookup", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`BatchSkipTracing API error: ${response.status} — ${err}`);
  }

  const data = await response.json() as any;

  // Map response to our unified format
  const contacts: SkipTraceContact[] = [];

  // Phones
  for (const phone of data.phones || []) {
    contacts.push({
      type: "phone",
      value: phone.number || phone.phone,
      confidence: phone.confidence || 0.7,
      isPrimary: phone.is_primary || contacts.filter((c) => c.type === "phone").length === 0,
      lineType: phone.line_type,
      carrier: phone.carrier,
      doNotCall: phone.dnc || false,
    });
  }

  // Emails
  for (const email of data.emails || []) {
    contacts.push({
      type: "email",
      value: email.address || email.email,
      confidence: email.confidence || 0.7,
      isPrimary: contacts.filter((c) => c.type === "email").length === 0,
    });
  }

  return {
    success: true,
    source: "batch_skip_tracing",
    contacts,
    owner: data.owner
      ? {
          fullName: data.owner.name,
          age: data.owner.age,
          address: data.owner.property_address,
          mailingAddress: data.owner.mailing_address,
        }
      : undefined,
    creditsUsed: data.credits_used || 1,
  };
}

async function traceViaREISkip(input: SkipTraceInput): Promise<SkipTraceResult> {
  const apiKey = process.env.REISKIP_API_KEY;
  if (!apiKey) throw new Error("REISKIP_API_KEY not configured");

  const response = await fetch("https://api.reiskip.com/v1/trace", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `${input.firstName || ""} ${input.lastName || ""}`.trim(),
      address: `${input.address || ""}, ${input.city || ""}, ${input.state || ""} ${input.zip || ""}`.trim(),
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`REISkip API error: ${response.status}`);

  const data = await response.json() as any;
  const contacts: SkipTraceContact[] = [];

  for (const phone of data.phones || []) {
    contacts.push({
      type: "phone",
      value: phone,
      confidence: 0.6,
      isPrimary: contacts.length === 0,
    });
  }

  for (const email of data.emails || []) {
    contacts.push({
      type: "email",
      value: email,
      confidence: 0.6,
      isPrimary: contacts.filter((c) => c.type === "email").length === 0,
    });
  }

  return { success: true, source: "reiskip", contacts };
}

// Pillar 1.6 — per-credit skip-trace cost in cents. BatchSkipTracing bills
// ~$0.20 per traced record by default; override via env. Idempotent on the
// caller-supplied external id (org+input hash if no native id available).
const SKIP_TRACE_CREDIT_CENTS = Number(process.env.SKIP_TRACE_CREDIT_CENTS ?? 20);

async function postSkipTraceCostToLedger(
  organizationId: number,
  result: SkipTraceResult,
  externalSeed: string,
): Promise<void> {
  if (!result.success || result.source === "none") return;
  const credits = result.creditsUsed ?? 1;
  const amountCents = credits * SKIP_TRACE_CREDIT_CENTS;
  if (amountCents <= 0) return;
  // Universal BYOK: customer is billed directly when their own key was
  // used. Only short-circuit on the matching channel — BatchSkipTracing
  // BYOK should NOT suppress a REISkip ledger post.
  if (result.source === "batch_skip_tracing") {
    try {
      const { isByokEnabled } = await import("./byok/toggle");
      if (await isByokEnabled(organizationId, "batch_skiptracing")) {
        return;
      }
    } catch {
      /* best-effort */
    }
  }
  try {
    const { postOpexSpent } = await import("./financial-ledger");
    await postOpexSpent({
      organizationId,
      amountCents,
      category: "skip_trace",
      feature: "skip_trace",
      providerName: result.source,
      providerEventId: externalSeed,
      // ORG-NAMESPACED, and that is a correctness fix rather than a style one.
      // `financial_ledger.external_event_id` is GLOBALLY unique, and this seed
      // is built from lead PII alone (apn|zip|address|lastName|firstName) with
      // no org component — so two organizations skip-tracing the same person or
      // parcel minted the SAME key. The second org's insert was swallowed as a
      // duplicate: they were never charged for a lookup they really paid a
      // vendor for, and the fallback read handed them the first org's ledger
      // row. Every other caller of postOpexSpent namespaces by a
      // provider-unique id (a Twilio SID, a Lob id, a Stripe charge); this was
      // the one that keyed on customer data instead.
      externalEventId: `org${organizationId}:${result.source}:skiptrace:${externalSeed}`,
    });
  } catch (err) {
    logger.warn(`[skipTrace] ledger postOpexSpent failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const skipTracingService = {
  /**
   * Trace a property owner's contact information.
   * Tries BatchSkipTracing first, then REISkip as fallback.
   *
   * Pass `organizationId` to debit opex_available on success. Without an
   * orgId the lookup still runs (e.g. internal tooling) but no ledger row
   * is written.
   */
  async trace(input: SkipTraceInput, organizationId?: number): Promise<SkipTraceResult> {
    // Pillar 6 — cross-customer cache. Normalize the query so the same
    // (name, address) typed two different ways collapses to one row.
    // We only consult the cache when we have an orgId (the analytics +
    // hit-counter both require it). Internal tooling without an org still
    // hits the provider directly — same behaviour as before this change.
    const fingerprintInput = {
      name: `${(input.firstName || "").trim().toLowerCase()} ${(input.lastName || "").trim().toLowerCase()}`.trim(),
      address: (input.address || "").trim().toLowerCase(),
      city: (input.city || "").trim().toLowerCase(),
      state: (input.state || "").trim().toLowerCase(),
      zip: (input.zip || "").trim().toLowerCase(),
      apn: (input.apn || "").trim().toLowerCase(),
    };
    const queryFingerprint = normalizeQuery(fingerprintInput);
    // Stable seed for the ledger external_event_id (idempotency key).
    const seed = [
      input.apn, input.zip, input.address, input.lastName, input.firstName,
    ].filter(Boolean).join("|") || queryFingerprint.slice(0, 16);

    const runProvider = async (): Promise<SkipTraceResult | undefined> => {
      let result: SkipTraceResult | undefined;
      // BYOK-aware: even without the platform env var, an org-scoped BYOK
      // credential makes the primary provider callable. The function
      // resolves both sources internally.
      if (process.env.BATCH_SKIP_TRACING_API_KEY || organizationId != null) {
        try {
          result = await traceViaBatchSkipTracing(input, organizationId);
        } catch (err: any) {
          logger.warn(`[skipTrace] Primary provider failed: ${err.message}`);
        }
      }
      if (!result && process.env.REISKIP_API_KEY) {
        try {
          result = await traceViaREISkip(input);
        } catch (err: any) {
          logger.warn(`[skipTrace] Fallback provider failed: ${err.message}`);
        }
      }
      return result;
    };

    // Path 1: no org → skip cache, call provider directly, no ledger row.
    if (!organizationId) {
      const result = await runProvider();
      if (!result) {
        return {
          success: false,
          source: "none",
          contacts: [],
          error: "No skip tracing provider configured. Set BATCH_SKIP_TRACING_API_KEY or REISKIP_API_KEY.",
        };
      }
      return result;
    }

    // Path 2: org present → wrap in cache. On miss we call the provider
    // AND post the ledger row exactly once (canonical post). On hit we
    // serve the cached result for $0 and write only the hit row.
    try {
      const wrapped = await getCachedOrFetch<SkipTraceResult>({
        provider: "batch_skiptrace",
        entityType: "skip_trace",
        queryFingerprint,
        freshnessHours: defaultFreshnessHours("skip_trace"),
        organizationId,
        fetchFn: async () => {
          const provided = await runProvider();
          if (!provided || !provided.success) {
            // Throw so the cache layer doesn't store a failure.
            throw new Error(provided?.error || "no_skip_tracing_provider_configured");
          }
          const credits = provided.creditsUsed ?? 1;
          const costCents = credits * SKIP_TRACE_CREDIT_CENTS;
          // Canonical ledger post — single, deduped via externalEventId.
          await postSkipTraceCostToLedger(organizationId, provided, seed);
          return { result: provided, costCents };
        },
      });
      return wrapped.result;
    } catch (err) {
      // Provider call genuinely failed — match the pre-cache behaviour.
      logger.warn(`[skipTrace] cache-wrapped provider call failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        success: false,
        source: "none",
        contacts: [],
        error: "No skip tracing provider configured. Set BATCH_SKIP_TRACING_API_KEY or REISKIP_API_KEY.",
      };
    }
  },

  /**
   * Bulk trace — batch multiple records to minimize API calls and cost.
   * Pass `organizationId` so each lookup goes through the cross-customer
   * cache and posts its ledger row — omitting it silently bypassed both
   * (the pre-2026-07 batch route did exactly that).
   */
  async traceBatch(inputs: SkipTraceInput[], organizationId?: number): Promise<SkipTraceResult[]> {
    return Promise.all(inputs.map((input) => skipTracingService.trace(input, organizationId)));
  },

  /**
   * Check if any skip tracing provider is configured.
   */
  isConfigured(): boolean {
    return !!(process.env.BATCH_SKIP_TRACING_API_KEY || process.env.REISKIP_API_KEY);
  },
};
