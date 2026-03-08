/**
 * Listing Syndication Service
 *
 * Syndicates land property listings to major platforms:
 * - Land.com / Lands of America (CoStar Group) — via Land.com API
 * - LandFlip.com — via LandFlip Partner API
 * - LandSearch.com — via REST API
 * - Facebook Marketplace — via Meta Classified Listings API (partner program)
 * - Craigslist — deep-link URL generation (manual posting, no public API)
 *
 * Each platform has its own API contract. Where APIs require partner agreements,
 * we generate formatted listing data and provide deep links / CSV exports.
 */

import { db } from "../db";
import { properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";

// ============================================
// PLATFORM DEFINITIONS
// ============================================

export type SyndicationPlatform =
  | "land_com"
  | "landflip"
  | "landsearch"
  | "facebook_marketplace"
  | "craigslist"
  | "landwatch"
  | "lands_of_america";

export interface PlatformConfig {
  id: SyndicationPlatform;
  name: string;
  apiAvailable: boolean;
  requiresPartnerAccount: boolean;
  partnerSignupUrl: string;
  envKeys: string[];
}

export const PLATFORMS: Record<SyndicationPlatform, PlatformConfig> = {
  land_com: {
    id: "land_com",
    name: "Land.com",
    apiAvailable: true,
    requiresPartnerAccount: true,
    partnerSignupUrl: "https://www.land.com/data-feed/",
    envKeys: ["LANDCOM_API_KEY", "LANDCOM_BROKER_ID"],
  },
  landflip: {
    id: "landflip",
    name: "LandFlip",
    apiAvailable: true,
    requiresPartnerAccount: true,
    partnerSignupUrl: "https://www.landflip.com/list-land/",
    envKeys: ["LANDFLIP_API_KEY", "LANDFLIP_MEMBER_ID"],
  },
  landsearch: {
    id: "landsearch",
    name: "LandSearch",
    apiAvailable: true,
    requiresPartnerAccount: true,
    partnerSignupUrl: "https://landsearch.com/partners",
    envKeys: ["LANDSEARCH_API_KEY"],
  },
  facebook_marketplace: {
    id: "facebook_marketplace",
    name: "Facebook Marketplace",
    apiAvailable: true,
    requiresPartnerAccount: true,
    partnerSignupUrl: "https://www.facebook.com/business/help/1351675628644884",
    envKeys: ["META_ACCESS_TOKEN", "META_PAGE_ID", "META_CATALOG_ID"],
  },
  craigslist: {
    id: "craigslist",
    name: "Craigslist",
    apiAvailable: false,
    requiresPartnerAccount: false,
    partnerSignupUrl: "https://craigslist.org/post",
    envKeys: [],
  },
  landwatch: {
    id: "landwatch",
    name: "LandWatch",
    apiAvailable: true,
    requiresPartnerAccount: true,
    partnerSignupUrl: "https://www.landwatch.com/advertise",
    envKeys: ["LANDWATCH_API_KEY"],
  },
  lands_of_america: {
    id: "lands_of_america",
    name: "Lands of America",
    apiAvailable: true,
    requiresPartnerAccount: true,
    partnerSignupUrl: "https://www.landsofamerica.com/advertise/",
    envKeys: ["LANDCOM_API_KEY", "LANDCOM_BROKER_ID"], // Same CoStar group API as land.com
  },
};

// ============================================
// NORMALIZED LISTING DATA (platform-agnostic)
// ============================================

export interface NormalizedListing {
  propertyId: number;
  organizationId: number;
  title: string;
  description: string;
  askingPrice: number;
  pricePerAcre: number;
  acreage: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  latitude: number;
  longitude: number;
  propertyType: string;
  zoning?: string;
  photos: string[];
  sellerFinancingAvailable: boolean;
  downPaymentMin?: number;
  monthlyPaymentMin?: number;
  interestRate?: number;
  termYears?: number;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  listingUrl: string;
  apn?: string;
}

// ============================================
// SYNDICATION RESULT
// ============================================

export interface SyndicationResult {
  platform: SyndicationPlatform;
  success: boolean;
  listingId?: string;
  listingUrl?: string;
  deepLinkUrl?: string; // For platforms without API (Craigslist)
  preformattedText?: string; // For manual posting
  error?: string;
  requiresManualAction?: boolean;
  manualInstructions?: string;
}

// ============================================
// PLATFORM ADAPTERS
// ============================================

async function syndicateToLandCom(listing: NormalizedListing): Promise<SyndicationResult> {
  const apiKey = process.env.LANDCOM_API_KEY;
  const brokerId = process.env.LANDCOM_BROKER_ID;

  if (!apiKey || !brokerId) {
    return {
      platform: "land_com",
      success: false,
      error: "Land.com API credentials not configured",
      requiresManualAction: true,
      manualInstructions: "Go to land.com/settings to connect your Land.com account",
    };
  }

  try {
    const resp = await fetch("https://api.land.com/v2/listings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Broker-ID": brokerId,
      },
      body: JSON.stringify({
        listingType: "for_sale",
        propertyType: "land",
        title: listing.title,
        description: listing.description,
        price: listing.askingPrice,
        acres: listing.acreage,
        address: {
          street: listing.address,
          city: listing.city,
          state: listing.state,
          zip: listing.zip,
          county: listing.county,
        },
        coordinates: { lat: listing.latitude, lng: listing.longitude },
        photos: listing.photos.map((url, i) => ({ url, order: i + 1 })),
        financing: listing.sellerFinancingAvailable
          ? {
              available: true,
              downPaymentMin: listing.downPaymentMin,
              monthlyPaymentMin: listing.monthlyPaymentMin,
              interestRate: listing.interestRate,
              termYears: listing.termYears,
            }
          : { available: false },
        contact: {
          name: listing.contactName,
          phone: listing.contactPhone,
          email: listing.contactEmail,
        },
        sourceId: `acreos_${listing.propertyId}`,
        sourceUrl: listing.listingUrl,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { platform: "land_com", success: false, error: err.message || `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    return {
      platform: "land_com",
      success: true,
      listingId: data.id || data.listing_id,
      listingUrl: data.url || `https://www.land.com/land/for-sale/${data.id}/`,
    };
  } catch (err: any) {
    return { platform: "land_com", success: false, error: err.message };
  }
}

async function syndicateToLandFlip(listing: NormalizedListing): Promise<SyndicationResult> {
  const apiKey = process.env.LANDFLIP_API_KEY;
  const memberId = process.env.LANDFLIP_MEMBER_ID;

  if (!apiKey || !memberId) {
    return {
      platform: "landflip",
      success: false,
      error: "LandFlip credentials not configured",
      requiresManualAction: true,
      deepLinkUrl: `https://www.landflip.com/list-land/?prefill_price=${listing.askingPrice}&prefill_acres=${listing.acreage}&prefill_state=${listing.state}&prefill_county=${listing.county}`,
      manualInstructions: "Add your LandFlip API key in Settings → Integrations to enable automatic syndication.",
    };
  }

  try {
    const resp = await fetch(`https://www.landflip.com/api/v2/listings`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "X-Member-ID": memberId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: listing.title,
        description: listing.description,
        price: listing.askingPrice,
        acreage: listing.acreage,
        state: listing.state,
        county: listing.county,
        city: listing.city,
        zip: listing.zip,
        latitude: listing.latitude,
        longitude: listing.longitude,
        property_type: listing.propertyType,
        zoning: listing.zoning,
        photos: listing.photos,
        seller_financing: listing.sellerFinancingAvailable,
        down_payment: listing.downPaymentMin,
        monthly_payment: listing.monthlyPaymentMin,
        external_id: `acreos_${listing.propertyId}`,
      }),
    });

    if (!resp.ok) throw new Error(`LandFlip API error ${resp.status}`);

    const data = await resp.json();
    return {
      platform: "landflip",
      success: true,
      listingId: String(data.id),
      listingUrl: `https://www.landflip.com/listing/${data.id}`,
    };
  } catch (err: any) {
    return { platform: "landflip", success: false, error: err.message };
  }
}

async function syndicateToFacebookMarketplace(listing: NormalizedListing): Promise<SyndicationResult> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  const catalogId = process.env.META_CATALOG_ID;

  if (!accessToken || !pageId || !catalogId) {
    return {
      platform: "facebook_marketplace",
      success: false,
      error: "Meta/Facebook credentials not configured",
      requiresManualAction: true,
      manualInstructions: "Add META_ACCESS_TOKEN, META_PAGE_ID, and META_CATALOG_ID in Settings → Integrations.",
    };
  }

  try {
    // Add property to Meta catalog (powers Marketplace listings via catalog)
    const resp = await fetch(`https://graph.facebook.com/v21.0/${catalogId}/products?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        retailer_id: `acreos_${listing.propertyId}`,
        name: listing.title,
        description: listing.description,
        price: `${listing.askingPrice} USD`,
        currency: "USD",
        availability: "in stock",
        condition: "new",
        link: listing.listingUrl,
        image_link: listing.photos[0] || "",
        additional_image_link: listing.photos.slice(1, 10).join(","),
        google_product_category: "216", // Real Estate
        custom_label_0: listing.state,
        custom_label_1: listing.county,
        custom_label_2: `${listing.acreage} acres`,
        custom_label_3: listing.sellerFinancingAvailable ? "Seller Financing" : "Cash Only",
      }),
    });

    if (!resp.ok) throw new Error(`Meta API error ${resp.status}`);

    const data = await resp.json();
    return {
      platform: "facebook_marketplace",
      success: true,
      listingId: data.id,
      listingUrl: `https://www.facebook.com/marketplace/item/${data.id}`,
    };
  } catch (err: any) {
    return { platform: "facebook_marketplace", success: false, error: err.message };
  }
}

async function generateCraigslistPost(listing: NormalizedListing): Promise<SyndicationResult> {
  // Craigslist has no public API — generate a pre-formatted post and deep link
  const formattedText = `
${listing.title}
$${listing.askingPrice.toLocaleString()}

${listing.acreage} acres in ${listing.county} County, ${listing.state}

${listing.description}

${listing.sellerFinancingAvailable ? `SELLER FINANCING AVAILABLE
• Down Payment: $${listing.downPaymentMin?.toLocaleString() || "Call for details"}
• Monthly Payments: $${listing.monthlyPaymentMin?.toLocaleString() || "Call for details"}/month
• Interest Rate: ${listing.interestRate || "Call"}%
` : "Cash only."}

Property Details:
• Acreage: ${listing.acreage} acres
• County: ${listing.county}, ${listing.state}
• Zoning: ${listing.zoning || "Check with county"}
• APN: ${listing.apn || "See listing"}

View more photos and details: ${listing.listingUrl}

Contact: ${listing.contactName}
${listing.contactPhone ? `Phone: ${listing.contactPhone}` : ""}
${listing.contactEmail ? `Email: ${listing.contactEmail}` : ""}
  `.trim();

  // Craigslist deep link prefills some fields
  const stateMap: Record<string, string> = {
    AZ: "phoenix", CA: "sfbay", TX: "dallas", FL: "miami", NM: "albuquerque",
    NV: "lasvegas", UT: "saltlake", CO: "denver", OR: "portland", WA: "seattle",
    ID: "boise", MT: "montana", WY: "wyoming", SD: "sd", ND: "nd",
  };
  const area = stateMap[listing.state.toUpperCase()] || "sfbay";
  const deepLinkUrl = `https://${area}.craigslist.org/d/land/search/lnd`;

  return {
    platform: "craigslist",
    success: true,
    deepLinkUrl,
    preformattedText: formattedText,
    requiresManualAction: true,
    manualInstructions: `Craigslist doesn't have a public API. Use the pre-formatted text below to quickly post your listing. Click "Open Craigslist" to go to the land listings section.`,
  };
}

// ============================================
// MAIN SYNDICATION FUNCTION
// ============================================

export async function syndicateListing(
  listing: NormalizedListing,
  platforms: SyndicationPlatform[]
): Promise<SyndicationResult[]> {
  const results = await Promise.all(
    platforms.map(async (platform) => {
      switch (platform) {
        case "land_com":
        case "lands_of_america":
          return syndicateToLandCom(listing);
        case "landflip":
          return syndicateToLandFlip(listing);
        case "facebook_marketplace":
          return syndicateToFacebookMarketplace(listing);
        case "craigslist":
          return generateCraigslistPost(listing);
        default:
          return {
            platform,
            success: false,
            error: `Platform "${platform}" not yet implemented`,
            requiresManualAction: true,
          };
      }
    })
  );

  return results;
}

// ============================================
// UPDATE LISTING ACROSS PLATFORMS
// ============================================

export async function updateSyndicatedListing(
  listing: NormalizedListing,
  platformListingIds: Record<SyndicationPlatform, string>
): Promise<SyndicationResult[]> {
  const results: SyndicationResult[] = [];

  for (const [platform, listingId] of Object.entries(platformListingIds)) {
    if (platform === "land_com" || platform === "lands_of_america") {
      const apiKey = process.env.LANDCOM_API_KEY;
      if (apiKey) {
        try {
          await fetch(`https://api.land.com/v2/listings/${listingId}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ price: listing.askingPrice, description: listing.description }),
          });
          results.push({ platform: platform as SyndicationPlatform, success: true, listingId });
        } catch (err: any) {
          results.push({ platform: platform as SyndicationPlatform, success: false, error: err.message });
        }
      }
    }
  }

  return results;
}

// ============================================
// TAKE DOWN LISTING
// ============================================

export async function takeDownListing(
  platform: SyndicationPlatform,
  externalListingId: string
): Promise<{ success: boolean; error?: string }> {
  if (platform === "land_com") {
    const apiKey = process.env.LANDCOM_API_KEY;
    if (!apiKey) return { success: false, error: "Land.com not configured" };

    try {
      await fetch(`https://api.land.com/v2/listings/${externalListingId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  if (platform === "facebook_marketplace") {
    const token = process.env.META_ACCESS_TOKEN;
    const catalogId = process.env.META_CATALOG_ID;
    if (!token || !catalogId) return { success: false, error: "Meta not configured" };

    try {
      await fetch(`https://graph.facebook.com/v21.0/${catalogId}/products/${externalListingId}?access_token=${token}`, {
        method: "DELETE",
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: `Take-down not supported for ${platform}` };
}

// ============================================
// GENERATE NORMALIZED LISTING from AcreOS property
// ============================================

export async function buildNormalizedListing(
  property: any,
  org: any,
  overrides?: Partial<NormalizedListing>
): Promise<NormalizedListing> {
  const acreage = parseFloat(property.sizeAcres || property.acreage || "0");
  const askingPrice = parseFloat(property.listPrice || property.askingPrice || property.marketValue || "0");

  return {
    propertyId: property.id,
    organizationId: property.organizationId,
    title: property.name || `${acreage} Acres — ${property.county || ""} County, ${property.state || ""}`,
    description: property.description || `${acreage} acre parcel in ${property.county || ""} County, ${property.state || ""}. ${property.zoning ? `Zoned ${property.zoning}.` : ""} Seller financing available with low down payment.`,
    askingPrice,
    pricePerAcre: acreage > 0 ? askingPrice / acreage : 0,
    acreage,
    address: property.address || "",
    city: property.city || "",
    state: property.state || "",
    zip: property.zip || "",
    county: property.county || "",
    latitude: property.latitude || 0,
    longitude: property.longitude || 0,
    propertyType: property.propertyType || "vacant land",
    zoning: property.zoning,
    photos: property.photos?.map((p: any) => p.url || p) || [],
    sellerFinancingAvailable: true,
    contactName: org?.name || "Land Investor",
    contactPhone: org?.phone,
    contactEmail: org?.email,
    listingUrl: `${process.env.APP_URL || "https://app.acreos.io"}/properties/${property.id}`,
    apn: property.apn,
    ...overrides,
  };
}
