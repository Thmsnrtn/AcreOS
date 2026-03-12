/**
 * Ad Creative Service
 *
 * Generates top-tier ad creatives for AcreOS growth campaigns using AI:
 *   - 4 copy variants across distinct persuasion angles (GPT-4o)
 *   - 3 high-quality images (DALL-E 3 HD)
 *   - Meta image upload (fetches DALL-E URL → uploads as base64 → returns hash)
 *
 * Designed for fully autonomous one-click campaign deployment.
 * Images are stored as temporary DALL-E URLs during preview,
 * then uploaded to Meta at deploy time.
 */

import { getOpenAIClient } from "../utils/openaiClient";

export type CopyAngle = "pain_point" | "aspiration" | "social_proof" | "curiosity";

export interface AdCopyVariant {
  angle: CopyAngle;
  angleLabel: string;
  headline: string;     // ≤40 chars
  primaryText: string;  // ≤125 chars
  description: string;  // ≤30 chars
  callToAction: string; // Meta CTA type: SIGN_UP | LEARN_MORE | GET_OFFER
  hook: string;         // Opening hook line only
}

export type ImageStyle = "lifestyle" | "product_concept" | "aspirational";

export interface GeneratedAdImage {
  style: ImageStyle;
  styleLabel: string;
  prompt: string;
  url: string;              // DALL-E URL (valid ~1h) or permanent after upload
  metaImageHash?: string;   // Set after uploading to Meta
  aspectRatio: "1:1" | "4:5" | "16:9";
}

export interface AdCreativeBundleData {
  copies: AdCopyVariant[];
  images: GeneratedAdImage[];
}

// ─── Template context for the AI ─────────────────────────────────────────────

const TEMPLATE_CONTEXT: Record<string, {
  audience: string;
  product: string;
  benefits: string[];
  painPoints: string[];
}> = {
  land_investors_signup: {
    audience: "land investors, rural real estate investors, and recreational property buyers aged 30–65 in the US",
    product: "AcreOS — an all-in-one CRM built exclusively for land investors with AI-powered lead scoring, automated follow-up sequences, visual deal pipelines, seller financing note tracking, and county parcel data integration",
    benefits: [
      "AI lead scoring that predicts which motivated sellers will close",
      "Automated follow-up sequences so no lead ever goes cold",
      "Visual Kanban pipeline for every acquisition stage",
      "Seller financing note and amortization tracking",
      "County parcel data and GIS integration",
      "7-day free trial, no credit card required, setup in minutes",
    ],
    painPoints: [
      "losing motivated sellers because of disorganized spreadsheet follow-ups",
      "spending hours on manual calls and emails instead of closing deals",
      "missing deals while competitors use better automation tools",
      "juggling fragmented tools with no single source of truth for their land business",
    ],
  },
  retargeting_visitors: {
    audience: "land investors who have already visited the AcreOS website but haven't signed up yet",
    product: "AcreOS — the CRM built for land investors that automates your pipeline and closes more deals",
    benefits: [
      "AI predicts your most likely-to-close leads before you even call them",
      "Automated sequences mean zero leads fall through the cracks",
      "Start your free 7-day trial in under 5 minutes",
      "Built by investors for investors — not a generic CRM",
    ],
    painPoints: [
      "still losing deals to spreadsheet chaos",
      "missing motivated sellers because follow-ups fell through",
      "faster competitors are outworking you with better tools",
    ],
  },
  lookalike_subscribers: {
    audience: "people who look like current AcreOS subscribers — land investors, rural property buyers, small real estate investors",
    product: "AcreOS — the operating system serious land investors use to systematize and scale their acquisitions",
    benefits: [
      "Join hundreds of land investors already closing more deals with AI automation",
      "AI-scored leads, automated follow-ups, deal tracking — all in one platform",
      "Seller financing tracking built in — no spreadsheets needed",
      "Free 7-day trial, cancel anytime",
    ],
    painPoints: [
      "running a land business on spreadsheets and sticky notes",
      "leaving money on the table because of poor lead management",
    ],
  },
};

const COPY_ANGLE_INSTRUCTIONS: Record<CopyAngle, string> = {
  pain_point: `Lead with a visceral, specific pain that this land investor feels TODAY. Name the problem like you've lived it. Let it sting for one beat. Then present AcreOS as the direct relief. Do NOT lead with the product — lead with the pain. Be specific and concrete, not vague.`,

  aspiration: `Paint a vivid, tangible picture of what this investor's business looks like when it runs on AcreOS. Tap into the dream of systematized, scalable deal flow. Use aspirational but grounded language — freedom, growth, focus on the deals that matter. Make them see the version of themselves they want to become.`,

  social_proof: `Open with credibility — make the reader feel they're late to something proven. Use numbers, community, and implied results to lower the risk of trying AcreOS. The reader should feel that smart land investors have already figured this out. Social pressure is the lever.`,

  curiosity: `Open with a bold provocative claim, surprising insight, or sharp question that creates an information gap. Make the reader NEED to know more. Don't reveal everything — just enough to make them click. Use counterintuitive or contrarian angles to stop the scroll.`,
};

const ANGLE_LABELS: Record<CopyAngle, string> = {
  pain_point: "Pain Point",
  aspiration: "Aspiration",
  social_proof: "Social Proof",
  curiosity: "Curiosity Hook",
};

// ─── Image specs for DALL-E generation ───────────────────────────────────────

const IMAGE_SPECS: Array<{
  style: ImageStyle;
  styleLabel: string;
  aspectRatio: "1:1" | "4:5" | "16:9";
  prompt: string;
}> = [
  {
    style: "lifestyle",
    styleLabel: "Lifestyle",
    aspectRatio: "1:1",
    prompt:
      "Professional lifestyle photograph of a confident, successful man in his late 40s sitting at a clean modern home office desk with a MacBook Pro showing a sleek CRM dashboard. Large windows behind him reveal rolling green farmland and rural hills in golden hour light. Warm, aspirational, high-end real estate investment feel. Shot on Sony A7IV, shallow depth of field, photorealistic, professional commercial photography quality.",
  },
  {
    style: "product_concept",
    styleLabel: "Product UI",
    aspectRatio: "1:1",
    prompt:
      "Photorealistic mockup of a modern dark-themed SaaS dashboard displayed on an Apple MacBook Pro 16-inch screen, floating on a clean white desk. The dashboard shows a land investment CRM with a Kanban deal pipeline: columns labeled 'New Leads', 'Contacted', 'Offer Sent', 'Under Contract', 'Closed'. Property cards show parcel details ($47K, $82K, $115K) with AI lead score badges in green, yellow, and red. Left sidebar shows icons for Leads, Pipeline, Properties, Notes, Analytics. UI is clean, minimalist, Tailwind CSS aesthetic. Professional product photography, studio lighting.",
  },
  {
    style: "aspirational",
    styleLabel: "Aerial Land",
    aspectRatio: "1:1",
    prompt:
      "Stunning aerial drone photograph taken at 400 feet of a beautiful large rural land parcel in the American midwest at golden hour. Patchwork of lush green fields, golden wheat, a meandering creek, and a small farmhouse. The sense of scale is massive — this is a significant investment-grade property. Sky is dramatic with warm orange and pink clouds. Shot on DJI Mavic 3 Pro, ultra-wide, photorealistic, investment real estate photography style.",
  },
];

// ─── Service ──────────────────────────────────────────────────────────────────

class AdCreativeService {
  /**
   * Generate 4 copy variants (one per persuasion angle) using GPT-4o.
   */
  async generateCopyVariants(templateKey: string): Promise<AdCopyVariant[]> {
    const openai = getOpenAIClient();
    if (!openai) throw new Error("OpenAI not configured — AI_INTEGRATIONS_OPENAI_API_KEY missing");

    const ctx = TEMPLATE_CONTEXT[templateKey] || TEMPLATE_CONTEXT.land_investors_signup;

    const systemPrompt = `You are a world-class direct response copywriter. You have written high-converting Facebook and Instagram ads for SaaS, real estate, and investment products. You deeply understand land investors — their language, daily frustrations, aspirations, and decision triggers.

PRODUCT BRIEF:
- Product: ${ctx.product}
- Audience: ${ctx.audience}
- Key benefits: ${ctx.benefits.map((b, i) => `${i + 1}. ${b}`).join(" | ")}
- Pain points: ${ctx.painPoints.join(" | ")}

RULES:
- Headlines: ≤40 characters, specific and punchy — no generic SaaS speak
- Primary text: ≤125 characters, emotionally resonant + clear value + action signal
- Description: ≤30 characters, punchy one-liner
- Hook: Just the first sentence/opening line that would stop the scroll
- Use land investor language naturally: deals, closes, motivated sellers, follow-ups, parcels, pipelines
- Be concrete and specific — numbers beat vague claims
- No exclamation points unless truly warranted
- callToAction must be exactly one of: SIGN_UP, LEARN_MORE, GET_OFFER`;

    const prompt = `Generate exactly 4 Facebook ad copy variants for AcreOS, one per angle below.

Return ONLY a valid JSON object with this structure:
{
  "variants": [
    {
      "angle": "pain_point",
      "angleLabel": "Pain Point",
      "headline": "string",
      "primaryText": "string",
      "description": "string",
      "callToAction": "SIGN_UP",
      "hook": "string"
    },
    ...
  ]
}

Angles to write:
1. pain_point — ${COPY_ANGLE_INSTRUCTIONS.pain_point}
2. aspiration — ${COPY_ANGLE_INSTRUCTIONS.aspiration}
3. social_proof — ${COPY_ANGLE_INSTRUCTIONS.social_proof}
4. curiosity — ${COPY_ANGLE_INSTRUCTIONS.curiosity}

Make each variant distinctly different. These will run as A/B tests so they must each take a genuinely different angle, tone, and structure.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.82,
      max_tokens: 1200,
    });

    const raw = JSON.parse(completion.choices[0].message.content || "{}");
    const list: any[] = raw.variants || (Array.isArray(raw) ? raw : []);

    return list.map((v: any) => ({
      angle: v.angle as CopyAngle,
      angleLabel: ANGLE_LABELS[v.angle as CopyAngle] || v.angleLabel || v.angle,
      headline: String(v.headline || "").slice(0, 40),
      primaryText: String(v.primaryText || "").slice(0, 125),
      description: String(v.description || "").slice(0, 30),
      callToAction: v.callToAction || "LEARN_MORE",
      hook: String(v.hook || ""),
    }));
  }

  /**
   * Generate 3 DALL-E 3 HD images (lifestyle, product UI, aerial land).
   * Runs sequentially to avoid rate limits. Non-fatal on individual failures.
   */
  async generateImages(): Promise<GeneratedAdImage[]> {
    const openai = getOpenAIClient();
    if (!openai) throw new Error("OpenAI not configured");

    const results: GeneratedAdImage[] = [];

    for (const spec of IMAGE_SPECS) {
      try {
        const response = await openai.images.generate({
          model: "dall-e-3",
          prompt: spec.prompt,
          size: "1024x1024",
          quality: "hd",
          n: 1,
        });

        if (response.data[0]?.url) {
          results.push({
            style: spec.style,
            styleLabel: spec.styleLabel,
            prompt: spec.prompt,
            url: response.data[0].url,
            aspectRatio: spec.aspectRatio,
          });
        }
      } catch (err: any) {
        console.error(`[adCreative] Failed to generate ${spec.style} image:`, err?.message);
        // Non-fatal — continue with remaining images
      }
    }

    return results;
  }

  /**
   * Generate a full creative bundle: 4 copy variants + 3 images in parallel.
   */
  async generateBundle(templateKey: string): Promise<AdCreativeBundleData> {
    const [copies, images] = await Promise.all([
      this.generateCopyVariants(templateKey),
      this.generateImages(),
    ]);
    return { copies, images };
  }

  /**
   * Fetch a DALL-E image by URL and upload it as base64 to a Meta Ad Account.
   * Returns the Meta image hash (used in ad creatives), or null on failure.
   */
  async uploadImageToMeta(
    adAccountId: string,
    accessToken: string,
    imageUrl: string
  ): Promise<string | null> {
    try {
      const imgResponse = await fetch(imageUrl);
      if (!imgResponse.ok) throw new Error(`Image fetch failed: ${imgResponse.status}`);
      const buffer = await imgResponse.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      const uploadUrl = `https://graph.facebook.com/v21.0/${accountId}/adimages?access_token=${accessToken}`;

      const form = new FormData();
      form.append("bytes", base64);

      const uploadRes = await fetch(uploadUrl, { method: "POST", body: form });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(`Meta image upload failed: ${JSON.stringify(err)}`);
      }

      const data = await uploadRes.json();
      // Meta returns: { images: { <filename>: { hash: "...", ... } } }
      const imagesObj = data.images || {};
      const firstKey = Object.keys(imagesObj)[0];
      return imagesObj[firstKey]?.hash ?? null;
    } catch (err: any) {
      console.error("[adCreative] uploadImageToMeta error:", err?.message);
      return null;
    }
  }

  /** Return the available image spec styles for the UI */
  getImageSpecs() {
    return IMAGE_SPECS.map((s) => ({ style: s.style, styleLabel: s.styleLabel, aspectRatio: s.aspectRatio }));
  }
}

export const adCreativeService = new AdCreativeService();
