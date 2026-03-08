/**
 * Meta Ads Service
 *
 * Integrates with Meta (Facebook) Marketing API to:
 * 1. Create dynamic land listing ad campaigns
 * 2. Capture Facebook Lead Ads form submissions → AcreOS CRM leads
 * 3. Sync property catalog for dynamic retargeting ads
 * 4. Track ad performance per listing
 *
 * Meta Ads API v21.0
 * Requires: META_APP_ID, META_APP_SECRET, META_PIXEL_ID, META_ACCESS_TOKEN
 */

import { db } from "../db";
import { leads, properties, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const META_API_BASE = "https://graph.facebook.com/v21.0";

function getAccessToken(): string {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN not configured");
  return token;
}

function getAdAccountId(): string {
  const id = process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error("META_AD_ACCOUNT_ID not configured");
  return id.startsWith("act_") ? id : `act_${id}`;
}

function getPixelId(): string {
  return process.env.META_PIXEL_ID || "";
}

async function metaGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${META_API_BASE}/${path}`);
  url.searchParams.set("access_token", getAccessToken());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Meta API GET error: ${JSON.stringify(err)}`);
  }
  return resp.json();
}

async function metaPost(path: string, body: Record<string, any>): Promise<any> {
  const url = `${META_API_BASE}/${path}?access_token=${getAccessToken()}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Meta API POST error: ${JSON.stringify(err)}`);
  }
  return resp.json();
}

// ============================================
// LEAD ADS — Webhook Processing
// ============================================

/**
 * Process a Facebook Lead Ad form submission.
 * Called from POST /api/webhooks/meta-lead-ads
 * Converts the lead into an AcreOS lead record.
 */
export async function processLeadAdSubmission(
  orgId: number,
  leadgenId: string,
  formId: string,
  adId: string,
  campaignName: string
): Promise<{ leadId: number | null; created: boolean }> {
  // Fetch lead data from Meta API
  let leadData: any;
  try {
    leadData = await metaGet(`${leadgenId}`, {
      fields: "field_data,created_time,ad_id,ad_name,campaign_id,campaign_name,form_id",
    });
  } catch (err) {
    console.error("Failed to fetch lead from Meta API:", err);
    return { leadId: null, created: false };
  }

  const fields: Record<string, string> = {};
  for (const f of leadData.field_data || []) {
    fields[f.name?.toLowerCase()?.replace(/\s+/g, "_")] = f.values?.[0] || "";
  }

  // Map Meta form fields to AcreOS lead fields
  const firstName = fields.first_name || fields.full_name?.split(" ")[0] || "";
  const lastName = fields.last_name || fields.full_name?.split(" ").slice(1).join(" ") || "";
  const email = fields.email || fields.email_address || "";
  const phone = fields.phone_number || fields.phone || fields.mobile || "";
  const propertyInterest = fields.property_address || fields.property || fields.interest || "";
  const budget = fields.budget || fields.max_budget || "";
  const message = fields.message || fields.notes || fields.comments || "";

  // Create lead in AcreOS
  const [newLead] = await db
    .insert(leads)
    .values({
      organizationId: orgId,
      firstName: firstName || "Facebook",
      lastName: lastName || "Lead",
      email: email || null,
      phone: phone || null,
      source: "facebook_lead_ad",
      status: "new",
      notes: [
        `Source: Facebook Lead Ad`,
        `Campaign: ${leadData.campaign_name || campaignName}`,
        `Ad: ${leadData.ad_name || adId}`,
        `Form ID: ${formId}`,
        propertyInterest ? `Property Interest: ${propertyInterest}` : "",
        budget ? `Budget: ${budget}` : "",
        message ? `Message: ${message}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      leadType: "buyer", // Facebook leads are typically buyer inquiries
      customFields: {
        meta_leadgen_id: leadgenId,
        meta_form_id: formId,
        meta_ad_id: adId,
        meta_campaign_name: campaignName,
        raw_fields: fields,
      },
    })
    .returning({ id: leads.id });

  return { leadId: newLead?.id || null, created: true };
}

// ============================================
// PROPERTY CATALOG SYNC
// Syncs AcreOS listings to a Meta product catalog
// for dynamic retargeting ads
// ============================================

export interface MetaCatalogItem {
  id: string;
  name: string;
  description: string;
  url: string;
  image_url: string;
  price: string; // e.g. "15000 USD"
  availability: "in stock" | "out of stock";
  category: string;
  address: {
    addr1: string;
    city: string;
    region: string;
    country: string;
    postal_code: string;
  };
  latitude: number;
  longitude: number;
  listing_type: "for_sale_by_owner";
  property_type: "LAND";
  num_acres?: number;
  year_built?: number;
}

export async function buildPropertyCatalogItem(
  property: any,
  appBaseUrl: string
): Promise<MetaCatalogItem> {
  const price = property.askingPrice || property.listPrice || property.estimatedValue || 0;

  return {
    id: `acreos_property_${property.id}`,
    name: property.name || property.address || `${property.acreage || "?"} Acres in ${property.county || ""}, ${property.state || ""}`,
    description:
      property.description ||
      `${property.acreage || "?"} acre ${property.propertyType || "land"} parcel in ${property.county || ""} County, ${property.state || ""}. ${property.zoning ? `Zoned ${property.zoning}.` : ""} Seller financing available.`,
    url: `${appBaseUrl}/properties/${property.id}`,
    image_url: property.imageUrl || property.photos?.[0]?.url || `https://maps.googleapis.com/maps/api/staticmap?center=${property.latitude},${property.longitude}&zoom=14&size=800x600&maptype=satellite`,
    price: `${Math.round(parseFloat(price || "0"))} USD`,
    availability: property.status === "listed" ? "in stock" : "out of stock",
    category: "Land",
    address: {
      addr1: property.address || "",
      city: property.city || "",
      region: property.state || "",
      country: "US",
      postal_code: property.zip || "",
    },
    latitude: property.latitude || 0,
    longitude: property.longitude || 0,
    listing_type: "for_sale_by_owner",
    property_type: "LAND",
    num_acres: property.acreage ? parseFloat(property.acreage) : undefined,
  };
}

export async function syncPropertyCatalog(
  orgId: number,
  catalogId: string,
  appBaseUrl: string
): Promise<{ synced: number; errors: number }> {
  const orgProperties = await db
    .select()
    .from(properties)
    .where(and(eq(properties.organizationId, orgId)));

  const items = await Promise.all(
    orgProperties.map((p) => buildPropertyCatalogItem(p, appBaseUrl))
  );

  // Batch update catalog — Meta allows up to 5000 items per batch
  const BATCH_SIZE = 100;
  let synced = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const requests = batch.map((item, idx) => ({
      method: "UPDATE",
      retailer_id: item.id,
      data: item,
    }));

    try {
      await metaPost(`${catalogId}/items_batch`, {
        allow_upsert: true,
        requests,
      });
      synced += batch.length;
    } catch {
      errors += batch.length;
    }
  }

  return { synced, errors };
}

// ============================================
// CREATE LAND LISTING AD CAMPAIGN
// ============================================

export interface CreateLandAdCampaignInput {
  propertyId: number;
  orgId: number;
  campaignName: string;
  dailyBudgetCents: number; // e.g. 2000 = $20/day
  targetStates?: string[];
  targetZipCodes?: string[];
  targetRadiusMiles?: number;
  targetLat?: number;
  targetLng?: number;
  listingUrl: string;
  imageUrl: string;
  headline: string;
  primaryText: string;
  callToAction?: "LEARN_MORE" | "CONTACT_US" | "APPLY_NOW" | "GET_OFFER";
}

export async function createLandListingCampaign(
  input: CreateLandAdCampaignInput
): Promise<{ campaignId: string; adSetId: string; adId: string }> {
  const adAccountId = getAdAccountId();

  // Step 1: Create Campaign
  const campaign = await metaPost(`${adAccountId}/campaigns`, {
    name: input.campaignName,
    objective: "OUTCOME_LEADS",
    status: "PAUSED", // Start paused so user can review
    special_ad_categories: ["HOUSING"], // Required for real estate ads
    special_ad_category_country: ["US"],
  });

  // Step 2: Create Ad Set with targeting
  const targeting: Record<string, any> = {
    age_min: 25,
    age_max: 65,
    geo_locations: { country_codes: ["US"] },
    facebook_positions: ["feed", "marketplace"],
    device_platforms: ["mobile", "desktop"],
  };

  if (input.targetZipCodes?.length) {
    targeting.geo_locations = {
      ...targeting.geo_locations,
      zips: input.targetZipCodes.map((z) => ({ key: z, country: "US" })),
    };
  } else if (input.targetStates?.length) {
    targeting.geo_locations = {
      ...targeting.geo_locations,
      regions: input.targetStates.map((s) => ({ key: s })),
    };
  } else if (input.targetLat && input.targetLng && input.targetRadiusMiles) {
    targeting.geo_locations = {
      custom_locations: [
        {
          latitude: input.targetLat,
          longitude: input.targetLng,
          radius: input.targetRadiusMiles,
          distance_unit: "mile",
          country: "US",
        },
      ],
    };
  }

  // Interest targeting for land/real estate buyers
  targeting.flexible_spec = [
    {
      interests: [
        { id: "6003107902433", name: "Land" },
        { id: "6003168573547", name: "Real estate investing" },
        { id: "6003382496125", name: "Recreational land" },
        { id: "6003200501512", name: "Hunting" },
      ],
    },
  ];

  const adSet = await metaPost(`${adAccountId}/adsets`, {
    name: `${input.campaignName} - Land Buyers`,
    campaign_id: campaign.id,
    daily_budget: input.dailyBudgetCents,
    optimization_goal: "LEAD_GENERATION",
    billing_event: "IMPRESSIONS",
    targeting,
    status: "PAUSED",
  });

  // Step 3: Create Ad Creative
  const creative = await metaPost(`${adAccountId}/adcreatives`, {
    name: `${input.campaignName} Creative`,
    object_story_spec: {
      page_id: process.env.META_PAGE_ID || "",
      link_data: {
        link: input.listingUrl,
        message: input.primaryText,
        name: input.headline,
        image_url: input.imageUrl,
        call_to_action: {
          type: input.callToAction || "LEARN_MORE",
          value: { link: input.listingUrl },
        },
      },
    },
  });

  // Step 4: Create Ad
  const ad = await metaPost(`${adAccountId}/ads`, {
    name: `${input.campaignName} Ad`,
    adset_id: adSet.id,
    creative: { creative_id: creative.id },
    status: "PAUSED",
  });

  return {
    campaignId: campaign.id,
    adSetId: adSet.id,
    adId: ad.id,
  };
}

// ============================================
// AD PERFORMANCE STATS
// ============================================

export interface AdPerformanceStats {
  campaignId: string;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  spend: number;
  cpl: number; // cost per lead
  ctr: number; // click-through rate %
}

export async function getAdPerformance(campaignId: string): Promise<AdPerformanceStats> {
  try {
    const data = await metaGet(`${campaignId}/insights`, {
      fields: "impressions,reach,clicks,actions,spend",
      date_preset: "last_30d",
    });

    const stats = data.data?.[0] || {};
    const leadsAction = (stats.actions || []).find((a: any) => a.action_type === "lead");
    const leads = leadsAction ? parseInt(leadsAction.value || "0") : 0;
    const spend = parseFloat(stats.spend || "0");
    const clicks = parseInt(stats.clicks || "0");
    const impressions = parseInt(stats.impressions || "0");

    return {
      campaignId,
      impressions,
      reach: parseInt(stats.reach || "0"),
      clicks,
      leads,
      spend,
      cpl: leads > 0 ? spend / leads : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    };
  } catch {
    return { campaignId, impressions: 0, reach: 0, clicks: 0, leads: 0, spend: 0, cpl: 0, ctr: 0 };
  }
}

// ============================================
// WEBHOOK VERIFICATION
// Meta sends a verification challenge on webhook setup
// ============================================

export function verifyMetaWebhook(
  mode: string,
  token: string,
  challenge: string
): string | null {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token === verifyToken) {
    return challenge;
  }
  return null;
}

// ============================================
// CONVERSIONS API (CAPI) — Server-side event tracking
// Improves ad attribution accuracy
// ============================================

export async function sendConversionEvent(
  eventName: string,
  userData: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    state?: string;
    zipCode?: string;
  },
  customData?: Record<string, any>
): Promise<void> {
  const pixelId = getPixelId();
  if (!pixelId) return;

  try {
    // Hash PII per Meta requirements
    const crypto = await import("crypto");
    const hash = (v?: string) =>
      v ? crypto.createHash("sha256").update(v.toLowerCase().trim()).digest("hex") : undefined;

    await metaPost(`${pixelId}/events`, {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          user_data: {
            em: hash(userData.email),
            ph: hash(userData.phone?.replace(/\D/g, "")),
            fn: hash(userData.firstName),
            ln: hash(userData.lastName),
            st: hash(userData.state?.toLowerCase()),
            zp: hash(userData.zipCode),
          },
          custom_data: customData || {},
        },
      ],
    });
  } catch {
    // Non-fatal — conversion tracking should not break core flows
  }
}
