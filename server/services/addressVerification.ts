/**
 * Address Verification Service
 * Uses USPS Web Tools Address Information API (free, requires account)
 * Falls back to basic format normalization if USPS key not configured.
 */

interface VerifiedAddress {
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  zip4?: string;
  deliverable: boolean;
  corrected: boolean;
  raw: string;
}

interface AddressInput {
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip?: string;
}

/**
 * Verify and normalize a US address.
 * Returns the USPS-standardized address if the API key is available,
 * or a lightly-normalized version otherwise.
 */
export async function verifyAddress(input: AddressInput): Promise<VerifiedAddress> {
  const uspsKey = process.env.USPS_USER_ID;

  if (uspsKey) {
    return verifyViaUSPS(input, uspsKey);
  }

  // Fallback: normalize capitalization and return as-is
  return {
    address1: input.address1.toUpperCase(),
    address2: input.address2?.toUpperCase(),
    city: toTitleCase(input.city),
    state: input.state.toUpperCase(),
    zip: input.zip || "",
    deliverable: true,
    corrected: false,
    raw: [input.address1, input.city, input.state, input.zip].filter(Boolean).join(", "),
  };
}

async function verifyViaUSPS(input: AddressInput, userId: string): Promise<VerifiedAddress> {
  const xml = `<AddressValidateRequest USERID="${userId}"><Revision>1</Revision><Address ID="0"><Address1>${input.address2 || ""}</Address1><Address2>${input.address1}</Address2><City>${input.city}</City><State>${input.state}</State><Zip5>${input.zip || ""}</Zip5><Zip4></Zip4></Address></AddressValidateRequest>`;

  const url = `https://secure.shippingapis.com/ShippingAPI.dll?API=Verify&XML=${encodeURIComponent(xml)}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`USPS API ${response.status}`);
    const text = await response.text();

    // Parse XML response (simple regex-based extraction)
    const get = (tag: string) => {
      const m = text.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
      return m ? m[1] : "";
    };

    const error = get("Error") || get("Description");
    if (error && error.toLowerCase().includes("not found")) {
      return {
        address1: input.address1,
        city: input.city,
        state: input.state,
        zip: input.zip || "",
        deliverable: false,
        corrected: false,
        raw: [input.address1, input.city, input.state, input.zip].filter(Boolean).join(", "),
      };
    }

    const verified = {
      address1: get("Address2") || input.address1,
      address2: get("Address1") || input.address2,
      city: get("City") || input.city,
      state: get("State") || input.state,
      zip: get("Zip5") || input.zip || "",
      zip4: get("Zip4") || undefined,
      deliverable: true,
      corrected: true,
      raw: "",
    };
    verified.raw = [verified.address1, verified.city, verified.state, `${verified.zip}${verified.zip4 ? "-" + verified.zip4 : ""}`].join(", ");
    return verified;
  } catch (err) {
    console.warn("[AddressVerification] USPS API failed:", err);
    return {
      address1: input.address1,
      city: input.city,
      state: input.state,
      zip: input.zip || "",
      deliverable: true,
      corrected: false,
      raw: [input.address1, input.city, input.state, input.zip].filter(Boolean).join(", "),
    };
  }
}

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}
