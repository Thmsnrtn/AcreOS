/**
 * Listing Syndication Service
 *
 * Generates formatted listing descriptions for different syndication platforms
 * based on property data and business type. Supports residential, commercial,
 * and land listings across platform-specific formats.
 *
 * Platform mapping:
 *   - Residential: Zillow, Redfin, Facebook Marketplace
 *   - Commercial:  LoopNet, Crexi, Facebook Marketplace
 *   - Land:        Facebook Marketplace
 */

import logger from "../utils/logger";
import type { BusinessType } from "./onboarding";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SyndicationPlatform =
  | "zillow"
  | "redfin"
  | "loopnet"
  | "crexi"
  | "facebook_marketplace";

export type ListingCategory = "residential" | "commercial" | "land";

export interface ResidentialDetails {
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  yearBuilt?: number;
  upgrades?: string[];
  lotSizeSqft?: number;
  garageSpaces?: number;
  hoa?: number;
}

export interface CommercialDetails {
  noi: number;
  capRate: number;
  tenants?: string[];
  leaseType?: string;
  occupancyRate?: number;
  buildingSqft: number;
  zoning?: string;
  parkingSpaces?: number;
}

export interface LandDetails {
  acreage: number;
  zoning?: string;
  access?: string;
  utilities?: string[];
  topography?: string;
  floodZone?: string;
  mineralRights?: boolean;
}

export interface PropertyData {
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  description?: string;
  category: ListingCategory;
  residential?: ResidentialDetails;
  commercial?: CommercialDetails;
  land?: LandDetails;
  photos?: string[];
}

export interface SyndicationResult {
  platform: SyndicationPlatform;
  title: string;
  body: string;
  category: ListingCategory;
  generatedAt: string;
}

// ─── Platform availability by listing category ──────────────────────────────

const PLATFORM_MAP: Record<ListingCategory, SyndicationPlatform[]> = {
  residential: ["zillow", "redfin", "facebook_marketplace"],
  commercial: ["loopnet", "crexi", "facebook_marketplace"],
  land: ["facebook_marketplace"],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function categoryFromBusinessType(businessType: BusinessType): ListingCategory {
  switch (businessType) {
    case "commercial":
      return "commercial";
    case "land_flipper":
      return "land";
    case "residential_wholesaler":
    case "fix_and_flip":
    case "buy_and_hold":
      return "residential";
    case "note_investor":
    case "hybrid":
      return "residential";
    default:
      return "residential";
  }
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ListingSyndicationService {
  /**
   * Returns the syndication platforms available for a given business type.
   */
  getAvailablePlatforms(businessType: BusinessType): SyndicationPlatform[] {
    const category = categoryFromBusinessType(businessType);
    return PLATFORM_MAP[category];
  }

  /**
   * Generates a formatted listing description for the given property,
   * business type, and target platform.
   */
  generateListingDescription(
    property: PropertyData,
    businessType: BusinessType,
    platform: SyndicationPlatform,
  ): SyndicationResult {
    const category = property.category ?? categoryFromBusinessType(businessType);
    const available = PLATFORM_MAP[category];

    if (!available.includes(platform)) {
      logger.warn(`Platform "${platform}" is not available for category "${category}"`, {
        source: "ListingSyndication",
        metadata: { platform, category, businessType },
      });
    }

    const title = this.buildTitle(property, category);
    const body = this.buildBody(property, category, platform);

    logger.info(`Generated syndication listing for ${platform}`, {
      source: "ListingSyndication",
      metadata: { platform, category, address: property.address },
    });

    return {
      platform,
      title,
      body,
      category,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Title builders ───────────────────────────────────────────────────────

  private buildTitle(property: PropertyData, category: ListingCategory): string {
    const location = `${property.city}, ${property.state}`;
    const price = formatPrice(property.price);

    switch (category) {
      case "residential": {
        const r = property.residential;
        const beds = r ? `${r.bedrooms}BD/${r.bathrooms}BA` : "";
        return `${beds} Home in ${location} - ${price}`.trim();
      }
      case "commercial": {
        const c = property.commercial;
        const sqft = c ? `${formatNumber(c.buildingSqft)} SF` : "";
        return `Commercial Property ${sqft} in ${location} - ${price}`.trim();
      }
      case "land": {
        const l = property.land;
        const acres = l ? `${l.acreage} Acres` : "Land";
        return `${acres} in ${location} - ${price}`.trim();
      }
    }
  }

  // ── Body builders ────────────────────────────────────────────────────────

  private buildBody(
    property: PropertyData,
    category: ListingCategory,
    platform: SyndicationPlatform,
  ): string {
    switch (category) {
      case "residential":
        return this.buildResidentialBody(property, platform);
      case "commercial":
        return this.buildCommercialBody(property, platform);
      case "land":
        return this.buildLandBody(property, platform);
    }
  }

  private buildResidentialBody(
    property: PropertyData,
    platform: SyndicationPlatform,
  ): string {
    const r = property.residential;
    const lines: string[] = [];

    lines.push(
      `${formatPrice(property.price)} | ${property.address}, ${property.city}, ${property.state} ${property.zip}`,
    );
    lines.push("");

    if (r) {
      lines.push(
        `${r.bedrooms} Bedrooms | ${r.bathrooms} Bathrooms | ${formatNumber(r.sqft)} Sq Ft`,
      );
      if (r.yearBuilt) lines.push(`Year Built: ${r.yearBuilt}`);
      if (r.lotSizeSqft) lines.push(`Lot Size: ${formatNumber(r.lotSizeSqft)} Sq Ft`);
      if (r.garageSpaces) lines.push(`Garage: ${r.garageSpaces}-car`);
      if (r.hoa) lines.push(`HOA: ${formatPrice(r.hoa)}/mo`);
      lines.push("");
    }

    if (property.description) {
      lines.push(property.description);
      lines.push("");
    }

    if (r?.upgrades && r.upgrades.length > 0) {
      lines.push("Recent Upgrades:");
      for (const upgrade of r.upgrades) {
        lines.push(`  - ${upgrade}`);
      }
      lines.push("");
    }

    if (platform === "zillow" || platform === "redfin") {
      lines.push("Schedule a showing today. Pre-approval recommended.");
    } else if (platform === "facebook_marketplace") {
      lines.push("Message for details or to schedule a walkthrough.");
    }

    return lines.join("\n").trim();
  }

  private buildCommercialBody(
    property: PropertyData,
    platform: SyndicationPlatform,
  ): string {
    const c = property.commercial;
    const lines: string[] = [];

    lines.push(
      `${formatPrice(property.price)} | ${property.address}, ${property.city}, ${property.state} ${property.zip}`,
    );
    lines.push("");

    if (c) {
      lines.push(`Building Size: ${formatNumber(c.buildingSqft)} SF`);
      lines.push(`NOI: ${formatPrice(c.noi)} | Cap Rate: ${c.capRate.toFixed(2)}%`);
      if (c.occupancyRate != null) lines.push(`Occupancy: ${c.occupancyRate}%`);
      if (c.leaseType) lines.push(`Lease Type: ${c.leaseType}`);
      if (c.zoning) lines.push(`Zoning: ${c.zoning}`);
      if (c.parkingSpaces) lines.push(`Parking: ${c.parkingSpaces} spaces`);
      lines.push("");

      if (c.tenants && c.tenants.length > 0) {
        lines.push("Current Tenants:");
        for (const tenant of c.tenants) {
          lines.push(`  - ${tenant}`);
        }
        lines.push("");
      }
    }

    if (property.description) {
      lines.push(property.description);
      lines.push("");
    }

    if (platform === "loopnet" || platform === "crexi") {
      lines.push("Contact listing broker for financials and due diligence materials.");
    } else if (platform === "facebook_marketplace") {
      lines.push("Investment opportunity. Message for property details and financials.");
    }

    return lines.join("\n").trim();
  }

  private buildLandBody(
    property: PropertyData,
    platform: SyndicationPlatform,
  ): string {
    const l = property.land;
    const lines: string[] = [];

    lines.push(
      `${formatPrice(property.price)} | ${property.address}, ${property.city}, ${property.state} ${property.zip}`,
    );
    lines.push("");

    if (l) {
      lines.push(`Acreage: ${l.acreage} acres`);
      if (l.zoning) lines.push(`Zoning: ${l.zoning}`);
      if (l.access) lines.push(`Access: ${l.access}`);
      if (l.topography) lines.push(`Topography: ${l.topography}`);
      if (l.floodZone) lines.push(`Flood Zone: ${l.floodZone}`);
      if (l.mineralRights != null) {
        lines.push(`Mineral Rights: ${l.mineralRights ? "Included" : "Not included"}`);
      }
      lines.push("");

      if (l.utilities && l.utilities.length > 0) {
        lines.push(`Utilities: ${l.utilities.join(", ")}`);
        lines.push("");
      }
    }

    if (property.description) {
      lines.push(property.description);
      lines.push("");
    }

    lines.push("Message for more information or to schedule a site visit.");

    return lines.join("\n").trim();
  }
}

export const listingSyndicationService = new ListingSyndicationService();

// ─── Legacy platform syndication API ─────────────────────────────────────────
// These exports are used by routes-elite-features.ts for the original
// land-focused syndication workflow (Land.com, LandFlip, Facebook, Craigslist).

export type LegacySyndicationPlatform =
  | "land_com"
  | "landflip"
  | "landsearch"
  | "facebook_marketplace"
  | "craigslist"
  | "landwatch"
  | "lands_of_america";

export interface PlatformConfig {
  id: LegacySyndicationPlatform;
  name: string;
  apiAvailable: boolean;
  requiresPartnerAccount: boolean;
  partnerSignupUrl: string;
  envKeys: string[];
}

export const PLATFORMS: Record<LegacySyndicationPlatform, PlatformConfig> = {
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
    envKeys: ["LANDCOM_API_KEY", "LANDCOM_BROKER_ID"],
  },
};

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

export interface LegacySyndicationResult {
  platform: LegacySyndicationPlatform;
  success: boolean;
  listingId?: string;
  listingUrl?: string;
  deepLinkUrl?: string;
  preformattedText?: string;
  error?: string;
  requiresManualAction?: boolean;
  manualInstructions?: string;
}

async function syndicateToLandCom(listing: NormalizedListing): Promise<LegacySyndicationResult> {
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

async function syndicateToLandFlip(listing: NormalizedListing): Promise<LegacySyndicationResult> {
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

async function syndicateToFacebookMarketplace(listing: NormalizedListing): Promise<LegacySyndicationResult> {
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
        google_product_category: "216",
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

async function generateCraigslistPost(listing: NormalizedListing): Promise<LegacySyndicationResult> {
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

export async function syndicateListing(
  listing: NormalizedListing,
  platforms: LegacySyndicationPlatform[],
): Promise<LegacySyndicationResult[]> {
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
          } as LegacySyndicationResult;
      }
    }),
  );

  return results;
}

export async function updateSyndicatedListing(
  listing: NormalizedListing,
  platformListingIds: Record<LegacySyndicationPlatform, string>,
): Promise<LegacySyndicationResult[]> {
  const results: LegacySyndicationResult[] = [];

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
          results.push({ platform: platform as LegacySyndicationPlatform, success: true, listingId });
        } catch (err: any) {
          results.push({ platform: platform as LegacySyndicationPlatform, success: false, error: err.message });
        }
      }
    }
  }

  return results;
}

export async function takeDownListing(
  platform: LegacySyndicationPlatform,
  externalListingId: string,
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

export async function buildNormalizedListing(
  property: any,
  org: any,
  overrides?: Partial<NormalizedListing>,
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
    contactName: org?.name || "Real Estate Professional",
    contactPhone: org?.phone,
    contactEmail: org?.email,
    listingUrl: `${process.env.APP_URL || "https://app.acreos.io"}/properties/${property.id}`,
    apn: property.apn,
    ...overrides,
  };
}
