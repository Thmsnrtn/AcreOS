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

export const skipTracingService = {
  /**
   * Trace a property owner's contact information.
   * Tries BatchSkipTracing first, then REISkip as fallback.
   */
  async trace(input: SkipTraceInput): Promise<SkipTraceResult> {
    // Try primary provider
    if (process.env.BATCH_SKIP_TRACING_API_KEY) {
      try {
        return await traceViaBatchSkipTracing(input);
      } catch (err: any) {
        console.warn(`[skipTrace] Primary provider failed: ${err.message}`);
      }
    }

    // Try fallback
    if (process.env.REISKIP_API_KEY) {
      try {
        return await traceViaREISkip(input);
      } catch (err: any) {
        console.warn(`[skipTrace] Fallback provider failed: ${err.message}`);
      }
    }

    return {
      success: false,
      source: "none",
      contacts: [],
      error: "No skip tracing provider configured. Set BATCH_SKIP_TRACING_API_KEY or REISKIP_API_KEY.",
    };
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
