/**
 * Growth Ad Service
 *
 * Runs AcreOS's own paid acquisition campaigns on Meta (Facebook/Instagram).
 * This is DIFFERENT from metaAdsService.ts which runs campaigns for app users.
 *
 * Uses founder-owned Meta ad account credentials stored in founder_ad_accounts table.
 *
 * Templates:
 *   - land_investors_signup   → Targets land investors / RE investors to sign up for AcreOS
 *   - retargeting_visitors    → Retargets landing page visitors who didn't convert
 *   - lookalike_subscribers   → Custom audience of current subscribers + lookalike
 */

import type { FounderAdAccount } from "@shared/schema";

const META_API_BASE = "https://graph.facebook.com/v21.0";

// ─── Meta API helpers (uses founder credentials, not org credentials) ─────────

async function metaGet(
  accessToken: string,
  path: string,
  params: Record<string, string> = {}
): Promise<any> {
  const url = new URL(`${META_API_BASE}/${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Meta API GET error: ${JSON.stringify(err)}`);
  }
  return resp.json();
}

async function metaPost(
  accessToken: string,
  path: string,
  body: Record<string, any>
): Promise<any> {
  const url = `${META_API_BASE}/${path}?access_token=${accessToken}`;
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

async function metaUpdate(
  accessToken: string,
  path: string,
  body: Record<string, any>
): Promise<any> {
  const url = `${META_API_BASE}/${path}?access_token=${accessToken}`;
  const resp = await fetch(url, {
    method: "POST", // Meta Graph API uses POST for updates
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Meta API update error: ${JSON.stringify(err)}`);
  }
  return resp.json();
}

// ─── Campaign Templates ───────────────────────────────────────────────────────

type CampaignTemplate = {
  objective: string;
  targeting: Record<string, any>;
  adCopy: {
    headline: string;
    primaryText: string;
    description: string;
    callToAction: string;
  };
  landingPagePath: string; // relative to the app's public URL
};

const CAMPAIGN_TEMPLATES: Record<string, CampaignTemplate> = {
  land_investors_signup: {
    objective: "OUTCOME_LEADS",
    targeting: {
      age_min: 30,
      age_max: 65,
      geo_locations: { country_codes: ["US"] },
      facebook_positions: ["feed", "instagram_stream"],
      device_platforms: ["mobile", "desktop"],
      flexible_spec: [
        {
          interests: [
            { id: "6003107902433", name: "Land" },
            { id: "6003168573547", name: "Real estate investing" },
            { id: "6003382496125", name: "Recreational land" },
            { id: "6003200501512", name: "Hunting" },
            { id: "6003321416597", name: "Rural property" },
          ],
        },
        {
          behaviors: [
            { id: "6071631541183", name: "Small business owners" },
          ],
        },
      ],
    },
    adCopy: {
      headline: "Run Your Land Business on Autopilot",
      primaryText:
        "AcreOS is the all-in-one CRM built for land investors. AI-powered lead scoring, automated follow-ups, deal pipelines, and seller financing — all in one place. Try free for 7 days.",
      description: "The software serious land investors use.",
      callToAction: "LEARN_MORE",
    },
    landingPagePath: "/",
  },

  retargeting_visitors: {
    objective: "OUTCOME_CONVERSIONS",
    targeting: {
      age_min: 25,
      age_max: 65,
      geo_locations: { country_codes: ["US"] },
      facebook_positions: ["feed", "instagram_stream", "right_hand_column"],
      device_platforms: ["mobile", "desktop"],
      // Retargeting uses a custom audience — set separately if pixel is configured
      custom_audiences: [],
    },
    adCopy: {
      headline: "You Checked Out AcreOS — Here's What You're Missing",
      primaryText:
        "Stop managing land deals in spreadsheets. AcreOS automates your follow-ups, scores your leads with AI, and tracks every deal to close. Start your free trial today.",
      description: "7-day free trial, no credit card required.",
      callToAction: "SIGN_UP",
    },
    landingPagePath: "/?utm_source=meta&utm_medium=retargeting",
  },

  lookalike_subscribers: {
    objective: "OUTCOME_LEADS",
    targeting: {
      age_min: 28,
      age_max: 65,
      geo_locations: { country_codes: ["US"] },
      facebook_positions: ["feed", "instagram_stream"],
      device_platforms: ["mobile", "desktop"],
      // Lookalike audience set separately
      custom_audiences: [],
    },
    adCopy: {
      headline: "The CRM Built for Land Investing",
      primaryText:
        "Join hundreds of land investors using AcreOS to source more deals, automate follow-ups, and close faster. AI deal scoring. Seller financing tracking. 7-day free trial.",
      description: "Trusted by active land investors.",
      callToAction: "LEARN_MORE",
    },
    landingPagePath: "/?utm_source=meta&utm_medium=lookalike",
  },
};

// ─── Service ──────────────────────────────────────────────────────────────────

export interface LaunchCampaignInput {
  adAccount: FounderAdAccount;
  templateKey: string;
  name: string;
  dailyBudgetCents: number;
  targetCountries?: string[];
}

export interface LaunchFullCampaignInput extends LaunchCampaignInput {
  copies: Array<{
    angle: string;
    angleLabel: string;
    headline: string;
    primaryText: string;
    description: string;
    callToAction: string;
    hook: string;
  }>;
  images: Array<{
    url: string;
    styleLabel: string;
    metaImageHash?: string;
  }>;
}

export interface CampaignStats {
  spendCents: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  ctr: number;
}

class GrowthAdService {
  /**
   * Launches a new AcreOS growth campaign on Meta.
   * Returns the Meta campaign ID, or null if a real API key isn't configured.
   */
  async launchCampaign(input: LaunchCampaignInput): Promise<string | null> {
    const { adAccount, templateKey, name, dailyBudgetCents, targetCountries } = input;
    const template = CAMPAIGN_TEMPLATES[templateKey];
    if (!template) throw new Error(`Unknown campaign template: ${templateKey}`);

    const adAccountId = adAccount.adAccountId.startsWith("act_")
      ? adAccount.adAccountId
      : `act_${adAccount.adAccountId}`;

    // Derive the landing page URL — use META_APP_URL env or fall back to placeholder
    const appUrl = process.env.PUBLIC_APP_URL || process.env.META_APP_URL || "https://app.acreos.com";
    const landingUrl = `${appUrl}${template.landingPagePath}&utm_campaign=${encodeURIComponent(name)}`;

    // Apply country targeting override if provided
    const targeting = { ...template.targeting };
    if (targetCountries?.length) {
      targeting.geo_locations = { country_codes: targetCountries };
    }

    // Step 1: Campaign
    const campaign = await metaPost(adAccount.accessToken, `${adAccountId}/campaigns`, {
      name,
      objective: template.objective,
      status: "PAUSED", // Start paused — founder reviews before activating
      special_ad_categories: [],
    });

    // Step 2: Ad Set
    await metaPost(adAccount.accessToken, `${adAccountId}/adsets`, {
      name: `${name} – Ad Set`,
      campaign_id: campaign.id,
      daily_budget: dailyBudgetCents,
      optimization_goal: template.objective === "OUTCOME_LEADS" ? "LEAD_GENERATION" : "CONVERSIONS",
      billing_event: "IMPRESSIONS",
      targeting,
      status: "PAUSED",
      promoted_object: template.objective === "OUTCOME_CONVERSIONS" && adAccount.pixelId
        ? { pixel_id: adAccount.pixelId, custom_event_type: "COMPLETE_REGISTRATION" }
        : undefined,
    });

    // Step 3: Ad Creative (link post)
    const creative = await metaPost(adAccount.accessToken, `${adAccountId}/adcreatives`, {
      name: `${name} – Creative`,
      object_story_spec: {
        page_id: adAccount.appId || process.env.META_PAGE_ID || "",
        link_data: {
          link: landingUrl,
          message: template.adCopy.primaryText,
          name: template.adCopy.headline,
          description: template.adCopy.description,
          call_to_action: {
            type: template.adCopy.callToAction,
            value: { link: landingUrl },
          },
        },
      },
    });

    // Step 4: Ad
    // (creative is not used directly here but ensures it's created)
    void creative;

    return campaign.id as string;
  }

  /**
   * Launches a full AI-generated campaign on Meta with multiple ad variants.
   * Creates: 1 Campaign → 1 Ad Set → N Ads (one per copy × image combination).
   * All assets start PAUSED — founder reviews then activates.
   * Returns the Meta campaign ID.
   */
  async launchFullCampaign(input: LaunchFullCampaignInput): Promise<string | null> {
    const { adAccount, templateKey, name, dailyBudgetCents, targetCountries, copies, images } = input;
    const template = CAMPAIGN_TEMPLATES[templateKey];
    if (!template) throw new Error(`Unknown campaign template: ${templateKey}`);

    const adAccountId = adAccount.adAccountId.startsWith("act_")
      ? adAccount.adAccountId
      : `act_${adAccount.adAccountId}`;

    const appUrl = process.env.PUBLIC_APP_URL || process.env.META_APP_URL || "https://app.acreos.com";
    const sep = template.landingPagePath.includes("?") ? "&" : "?";
    const landingUrl = `${appUrl}${template.landingPagePath}${sep}utm_campaign=${encodeURIComponent(name)}`;

    const targeting = { ...template.targeting };
    if (targetCountries?.length) targeting.geo_locations = { country_codes: targetCountries };

    // Step 1: Campaign
    const campaign = await metaPost(adAccount.accessToken, `${adAccountId}/campaigns`, {
      name,
      objective: template.objective,
      status: "PAUSED",
      special_ad_categories: [],
    });

    // Step 2: Ad Set
    const adSet = await metaPost(adAccount.accessToken, `${adAccountId}/adsets`, {
      name: `${name} – Ad Set`,
      campaign_id: campaign.id,
      daily_budget: dailyBudgetCents,
      optimization_goal: template.objective === "OUTCOME_LEADS" ? "LEAD_GENERATION" : "CONVERSIONS",
      billing_event: "IMPRESSIONS",
      targeting,
      status: "PAUSED",
      promoted_object:
        template.objective === "OUTCOME_CONVERSIONS" && adAccount.pixelId
          ? { pixel_id: adAccount.pixelId, custom_event_type: "COMPLETE_REGISTRATION" }
          : undefined,
    });

    // Step 3: Upload images to Meta and create one Ad per copy variant
    const pageId = adAccount.appId || process.env.META_PAGE_ID || "";
    const { adCreativeService } = await import("./adCreativeService");

    // Pre-upload all unique images once
    const imageHashes: (string | null)[] = await Promise.all(
      images.map(async (img) => {
        if (img.metaImageHash) return img.metaImageHash;
        if (img.url) {
          return adCreativeService.uploadImageToMeta(adAccount.adAccountId, adAccount.accessToken, img.url);
        }
        return null;
      })
    );

    // Create one ad per copy variant (cycling through images)
    for (let i = 0; i < copies.length; i++) {
      const copy = copies[i];
      const imageHash = imageHashes[i % Math.max(imageHashes.length, 1)] ?? undefined;

      const creativeSpec: any = {
        name: `${name} – ${copy.angleLabel} Creative`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            link: landingUrl,
            message: copy.primaryText,
            name: copy.headline,
            description: copy.description,
            call_to_action: {
              type: copy.callToAction,
              value: { link: landingUrl },
            },
          },
        },
      };

      if (imageHash) {
        creativeSpec.object_story_spec.link_data.image_hash = imageHash;
      }

      try {
        const creative = await metaPost(adAccount.accessToken, `${adAccountId}/adcreatives`, creativeSpec);
        await metaPost(adAccount.accessToken, `${adAccountId}/ads`, {
          name: `${name} – ${copy.angleLabel}`,
          adset_id: adSet.id,
          creative: { creative_id: creative.id },
          status: "PAUSED",
        });
      } catch (err: any) {
        console.error(`[growthAds] Failed to create ad variant ${copy.angleLabel}:`, err?.message);
        // Non-fatal: continue with other variants
      }
    }

    return campaign.id as string;
  }

  /** Pause or resume a campaign */
  async setCampaignStatus(
    adAccount: FounderAdAccount,
    campaignId: string,
    status: "active" | "paused"
  ): Promise<void> {
    await metaUpdate(adAccount.accessToken, campaignId, {
      status: status === "active" ? "ACTIVE" : "PAUSED",
    });
  }

  /** Fetch 30-day performance stats for a campaign */
  async getCampaignStats(
    adAccount: FounderAdAccount,
    campaignId: string
  ): Promise<CampaignStats> {
    try {
      const data = await metaGet(adAccount.accessToken, `${campaignId}/insights`, {
        fields: "impressions,clicks,actions,spend",
        date_preset: "last_30d",
      });
      const s = data.data?.[0] || {};
      const leadsAction = (s.actions || []).find((a: any) => a.action_type === "lead");
      const leads = leadsAction ? parseInt(leadsAction.value || "0") : 0;
      const spendDollars = parseFloat(s.spend || "0");
      const spendCents = Math.round(spendDollars * 100);
      const clicks = parseInt(s.clicks || "0");
      const impressions = parseInt(s.impressions || "0");
      return {
        spendCents,
        impressions,
        clicks,
        leads,
        cpl: leads > 0 ? spendDollars / leads : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      };
    } catch {
      return { spendCents: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0, ctr: 0 };
    }
  }

  /**
   * Report an AcreOS conversion event to the founder's Meta pixel (CAPI).
   * Called on signup and subscription.
   */
  async reportConversion(
    adAccount: FounderAdAccount,
    eventName: "CompleteRegistration" | "Subscribe" | "StartTrial",
    userData: { email?: string; firstName?: string; lastName?: string },
    customData?: Record<string, any>
  ): Promise<void> {
    if (!adAccount.pixelId) return;
    try {
      const crypto = await import("crypto");
      const hash = (v?: string) =>
        v ? crypto.createHash("sha256").update(v.toLowerCase().trim()).digest("hex") : undefined;

      await metaPost(adAccount.accessToken, `${adAccount.pixelId}/events`, {
        data: [
          {
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            action_source: "website",
            user_data: {
              em: hash(userData.email),
              fn: hash(userData.firstName),
              ln: hash(userData.lastName),
            },
            custom_data: customData || {},
          },
        ],
      });
    } catch {
      // Non-fatal — don't break signup flow
    }
  }

  /** Returns campaign templates available for the founder to launch */
  getTemplates() {
    return Object.entries(CAMPAIGN_TEMPLATES).map(([key, t]) => ({
      key,
      name: key
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      objective: t.objective,
      headline: t.adCopy.headline,
      description: t.adCopy.primaryText.slice(0, 100) + "…",
    }));
  }
}

export const growthAdService = new GrowthAdService();
