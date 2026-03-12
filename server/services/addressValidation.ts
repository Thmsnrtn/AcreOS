/**
 * USPS Address Validation via Lob's US Verification API
 * Validates and standardizes mailing addresses before mail orders or lead imports.
 * Free-tier usage via Lob test key; production uses LOB_LIVE_API_KEY.
 *
 * Deliverability outcomes:
 *   deliverable          — valid, deliverable address
 *   deliverable_unnecessary_unit — valid but has unnecessary unit info
 *   deliverable_incorrect_unit   — valid street, unit may be wrong
 *   deliverable_missing_unit     — valid street, needs unit
 *   undeliverable        — USPS cannot deliver here
 */

export interface AddressInput {
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface AddressValidationResult {
  valid: boolean;
  deliverability: string;
  standardized?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string; // zip+4 when available
  };
  message?: string;
  components?: {
    primaryNumber?: string;
    streetName?: string;
    streetSuffix?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    zipCodePlus4?: string;
  };
}

function getLobApiKey(): string | null {
  return process.env.LOB_LIVE_API_KEY || process.env.LOB_TEST_API_KEY || null;
}

/**
 * Validate a single address via Lob's US Verification endpoint.
 * Falls back gracefully when no Lob key is configured.
 */
export async function validateAddress(address: AddressInput): Promise<AddressValidationResult> {
  const apiKey = getLobApiKey();

  if (!apiKey) {
    console.warn('[AddressValidation] No Lob API key configured — skipping validation');
    return {
      valid: true,
      deliverability: 'unchecked',
      message: 'Address validation not configured (LOB_LIVE_API_KEY missing)',
    };
  }

  try {
    const auth = Buffer.from(`${apiKey}:`).toString('base64');
    const body: Record<string, string> = {
      primary_line: address.line1,
    };
    if (address.line2) body.secondary_line = address.line2;
    if (address.city) body.city = address.city;
    if (address.state) body.state = address.state;
    if (address.zip) body.zip_code = address.zip;

    const response = await fetch('https://api.lob.com/v1/us_verifications', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AddressValidation] Lob API error:', errorText);
      // Don't fail hard — let address through with warning
      return {
        valid: true,
        deliverability: 'unchecked',
        message: `Lob verification failed: ${response.status}`,
      };
    }

    const data = await response.json();
    const deliverability: string = data.deliverability || 'undeliverable';
    const isDeliverable = deliverability.startsWith('deliverable');
    const components = data.components || {};
    const zipCode = components.zip_code || '';
    const zipPlus4 = components.zip_code_plus_4 || '';

    return {
      valid: isDeliverable,
      deliverability,
      message: isDeliverable
        ? (deliverability !== 'deliverable' ? `Address valid but note: ${deliverability.replace(/_/g, ' ')}` : undefined)
        : 'USPS cannot deliver to this address',
      standardized: isDeliverable
        ? {
            line1: data.primary_line || address.line1,
            line2: data.secondary_line || address.line2,
            city: components.city || address.city || '',
            state: components.state || address.state || '',
            zip: zipPlus4 ? `${zipCode}-${zipPlus4}` : zipCode || address.zip || '',
          }
        : undefined,
      components: {
        primaryNumber: components.primary_number,
        streetName: components.street_name,
        streetSuffix: components.street_suffix,
        city: components.city,
        state: components.state,
        zipCode,
        zipCodePlus4: zipPlus4,
      },
    };
  } catch (err: any) {
    console.error('[AddressValidation] Request failed:', err.message);
    return {
      valid: true,
      deliverability: 'unchecked',
      message: `Address validation unavailable: ${err.message}`,
    };
  }
}

/**
 * Validate and standardize addresses for a batch of leads.
 * Returns { validated, undeliverable } split for easy filtering.
 */
export async function validateAddressBatch(
  addresses: Array<AddressInput & { id?: number }>
): Promise<{
  validated: Array<AddressInput & { id?: number; validation: AddressValidationResult }>;
  undeliverable: Array<AddressInput & { id?: number; reason: string }>;
}> {
  const validated: Array<AddressInput & { id?: number; validation: AddressValidationResult }> = [];
  const undeliverable: Array<AddressInput & { id?: number; reason: string }> = [];

  // Process sequentially to respect Lob rate limits (150 req/s live, 5 req/s test)
  for (const addr of addresses) {
    const result = await validateAddress(addr);
    if (result.valid) {
      validated.push({ ...addr, validation: result });
    } else {
      undeliverable.push({ ...addr, reason: result.message || 'Undeliverable' });
    }
    // Small delay to stay well under rate limit
    await new Promise(r => setTimeout(r, 20));
  }

  return { validated, undeliverable };
}

/**
 * Quick check: does this address look minimally valid before hitting the API?
 * Saves API calls for obviously bad inputs.
 */
export function isAddressMinimallyValid(address: AddressInput): boolean {
  const { line1, city, state, zip } = address;
  if (!line1 || line1.trim().length < 5) return false;
  // Need at least city+state OR zip
  if (!zip && (!city || !state)) return false;
  return true;
}
