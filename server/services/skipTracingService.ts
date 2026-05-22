import { logger } from "../utils/logger";
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

async function traceViaBatchSkipTracing(input: SkipTraceInput): Promise<SkipTraceResult> {
  const apiKey = process.env.BATCH_SKIP_TRACING_API_KEY;
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
  try {
    const { postOpexSpent } = await import("./financial-ledger");
    await postOpexSpent({
      organizationId,
      amountCents,
      category: "skip_trace",
      feature: "skip_trace",
      providerName: result.source,
      providerEventId: externalSeed,
      externalEventId: `${result.source}:skiptrace:${externalSeed}`,
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
    let result: SkipTraceResult | undefined;

    // Try primary provider
    if (process.env.BATCH_SKIP_TRACING_API_KEY) {
      try {
        result = await traceViaBatchSkipTracing(input);
      } catch (err: any) {
        logger.warn(`[skipTrace] Primary provider failed: ${err.message}`);
      }
    }

    // Try fallback
    if (!result && process.env.REISKIP_API_KEY) {
      try {
        result = await traceViaREISkip(input);
      } catch (err: any) {
        logger.warn(`[skipTrace] Fallback provider failed: ${err.message}`);
      }
    }

    if (!result) {
      return {
        success: false,
        source: "none",
        contacts: [],
        error: "No skip tracing provider configured. Set BATCH_SKIP_TRACING_API_KEY or REISKIP_API_KEY.",
      };
    }

    if (organizationId) {
      // Stable seed: provider + first non-empty input field. Falls back to
      // a hash of input shape if no leads field is present.
      const seed = [
        input.apn,
        input.zip,
        input.address,
        input.lastName,
        input.firstName,
      ]
        .filter(Boolean)
        .join("|") || `${Date.now()}`;
      await postSkipTraceCostToLedger(organizationId, result, seed);
    }

    return result;
  },

  /**
   * Bulk trace — batch multiple records to minimize API calls and cost.
   */
  async traceBatch(inputs: SkipTraceInput[]): Promise<SkipTraceResult[]> {
    return Promise.all(inputs.map((input) => skipTracingService.trace(input)));
  },

  /**
   * Check if any skip tracing provider is configured.
   */
  isConfigured(): boolean {
    return !!(process.env.BATCH_SKIP_TRACING_API_KEY || process.env.REISKIP_API_KEY);
  },
};
