import { db } from "../db";
import { eq } from "drizzle-orm";
import { organizations, campaigns, type Organization } from "@shared/schema";
import { storage } from "../storage";
import type { InsertLead, InsertProperty, InsertDeal } from "@shared/schema";
import OpenAI from "openai";

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type BusinessType =
  | "land_flipper"
  | "note_investor"
  | "hybrid"
  | "residential_wholesaler"
  | "fix_and_flip"
  | "buy_and_hold"
  | "commercial";

export type OnboardingData = {
  businessType?: BusinessType;
  dataImported?: boolean;
  stripeConnected?: boolean;
  campaignCreated?: boolean;
  completedSteps?: number[];
  skippedSteps?: number[];
  aiTips?: string[];
};

export type OnboardingStatus = {
  completed: boolean;
  currentStep: number;
  data: OnboardingData;
  totalSteps: number;
};

const ONBOARDING_STEPS = [
  { id: 0, name: "welcome", title: "Welcome & Business Type" },
  { id: 1, name: "import", title: "Import Data" },
  { id: 2, name: "connect", title: "Connect Services" },
  { id: 3, name: "campaign", title: "Set Up Campaign" },
  { id: 4, name: "review", title: "Review & Launch" },
];

const LAND_FLIPPER_TEMPLATES = {
  campaigns: [
    {
      name: "Acquisition Mailer Campaign",
      type: "direct_mail",
      status: "draft",
      subject: "Interested in Selling Your Land?",
      content: "Dear Property Owner,\n\nI noticed you own property in [COUNTY] and wanted to reach out. We're actively purchasing land in your area and would love to make you a fair cash offer.\n\nOur process is simple:\n- No realtor fees\n- We handle all closing costs\n- Close in as little as 14 days\n\nIf you're interested in exploring a sale, please reply to this letter or give us a call.\n\nBest regards,\n[YOUR NAME]",
      targetCriteria: {
        states: [],
        counties: [],
        leadStatus: ["new"],
        leadType: ["seller"],
      },
    },
    {
      name: "Follow-Up Sequence",
      type: "email",
      status: "draft",
      subject: "Following Up on Your Property",
      content: "Hi {{firstName}},\n\nI wanted to follow up on my previous message about your property. We're still very interested in making you an offer.\n\nWould you have a few minutes to chat this week?\n\nBest,\n[YOUR NAME]",
      targetCriteria: {
        leadStatus: ["mailed"],
        leadType: ["seller"],
      },
    },
  ],
  defaultTags: ["hot market", "rural", "subdivision", "owner financed", "quick close"],
  propertyStatuses: ["prospect", "due_diligence", "offer_sent", "under_contract", "owned", "listed", "sold"],
};

const NOTE_INVESTOR_TEMPLATES = {
  campaigns: [
    {
      name: "Payment Reminder Sequence",
      type: "email",
      status: "draft",
      subject: "Payment Reminder - {{propertyAddress}}",
      content: "Dear {{borrowerName}},\n\nThis is a friendly reminder that your payment of {{paymentAmount}} is due on {{dueDate}}.\n\nYou can make your payment through our secure borrower portal:\n{{portalLink}}\n\nThank you for your prompt attention to this matter.\n\nBest regards,\n[YOUR NAME]",
      targetCriteria: {
        leadType: ["buyer"],
      },
    },
  ],
  defaultTags: ["performing note", "sub-performing", "non-performing", "first position", "second position"],
  noteSettings: {
    defaultInterestRate: 9.5,
    defaultTermMonths: 60,
    gracePeriodDays: 10,
    lateFeePercent: 5,
  },
};

const RESIDENTIAL_WHOLESALER_TEMPLATES = {
  campaigns: [
    {
      name: "Motivated Seller Outreach",
      type: "email",
      status: "draft",
      subject: "Quick Question About Your Home at {{address}}",
      content: "Hi {{firstName}},\n\nMy name is [YOUR NAME] and I invest in homes in your area. I noticed your property and wanted to reach out directly — are you open to a fair cash offer?\n\nNo agents, no fees, no repairs needed. We close on your timeline.\n\nReply to this email or call/text me at [PHONE]. Takes 5 minutes to find out what your home is worth to us.\n\nBest,\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Cash Buyer Campaign",
      type: "email",
      status: "draft",
      subject: "New Deal Alert — {{city}} — {{beds}}bd/{{baths}}ba Below Market",
      content: "Hey {{firstName}},\n\nI have a new deal that might be a fit for you:\n\n📍 [ADDRESS]\n💰 Asking: $[PRICE]\n🏠 [BEDS]bd / [BATHS]ba | [SQFT] sqft\n🔨 Estimated Repairs: $[REPAIR_COST]\n📈 ARV: $[ARV]\n\nThis one moves fast — reply or call [PHONE] if you want first look.\n\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["buyer"] },
    },
  ],
  defaultTags: ["cash buyer", "motivated seller", "distressed", "vacant", "pre-foreclosure", "probate", "absentee owner"],
};

const FIX_AND_FLIP_TEMPLATES = {
  campaigns: [
    {
      name: "Distressed Property Outreach",
      type: "direct_mail",
      status: "draft",
      subject: "We Buy Houses in Any Condition — [CITY]",
      content: "Dear Property Owner,\n\nWe buy houses in any condition — no repairs, no agents, no hassle.\n\nIf your home needs work or you just want a fast, fair cash offer, we'd love to hear from you.\n\nCall or text: [PHONE]\nOr visit: [WEBSITE]\n\n[YOUR NAME]\n[COMPANY NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Contractor Follow-Up",
      type: "email",
      status: "draft",
      subject: "Upcoming Rehab Project — Interested in Bidding?",
      content: "Hi {{firstName}},\n\nWe have a new rehab project coming up and are collecting bids. The scope includes [SCOPE].\n\nProperty address: [ADDRESS]\nExpected start date: [DATE]\n\nIf you're available and interested, please reply with your availability for a walkthrough.\n\nThanks,\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
  ],
  defaultTags: ["ARV", "cosmetic", "full rehab", "foundation issues", "bank owned", "short sale", "auction"],
  noteSettings: {
    defaultInterestRate: 12.0,
    defaultTermMonths: 12,
    gracePeriodDays: 5,
    lateFeePercent: 5,
  },
};

const BUY_AND_HOLD_TEMPLATES = {
  campaigns: [
    {
      name: "Off-Market Rental Acquisition",
      type: "direct_mail",
      status: "draft",
      subject: "Interested in a Hassle-Free Sale on Your Rental Property?",
      content: "Dear Property Owner,\n\nWe're actively looking for rental properties to add to our portfolio. If you're thinking about selling, we offer:\n\n- Fair cash offers\n- No tenant displacement required\n- Quick, flexible closings\n\nGive us a call at [PHONE] or reply to this letter.\n\n[YOUR NAME]\n[COMPANY NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Seller Finance Offer",
      type: "email",
      status: "draft",
      subject: "Alternative to a Traditional Sale — Owner Financing",
      content: "Hi {{firstName}},\n\nHave you considered seller financing your property? Instead of a lump sum, you'd receive monthly payments — often at a higher effective price with tax advantages.\n\nWe're experienced buyer-investors and can structure a deal that works for both of us.\n\nWould you be open to a short call? Reply here or call [PHONE].\n\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
  ],
  defaultTags: ["SFR", "duplex", "triplex", "multi-family", "STR potential", "cash flow", "value-add"],
  noteSettings: {
    defaultInterestRate: 6.5,
    defaultTermMonths: 360,
    gracePeriodDays: 15,
    lateFeePercent: 5,
  },
};

const COMMERCIAL_TEMPLATES = {
  campaigns: [
    {
      name: "Off-Market Commercial Outreach",
      type: "email",
      status: "draft",
      subject: "Confidential Inquiry — Your Property at {{address}}",
      content: "Dear {{firstName}},\n\nI represent a private investment group actively acquiring commercial properties in [MARKET]. We've identified your property as potentially fitting our criteria.\n\nIf you have any interest in a confidential, off-market discussion, I'd welcome a brief call at your convenience.\n\nI can be reached at [PHONE] or simply reply to this email.\n\nBest regards,\n[YOUR NAME]\n[COMPANY NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
  ],
  defaultTags: ["NNN", "mixed-use", "retail strip", "office", "industrial", "value-add", "stabilized"],
  noteSettings: {
    defaultInterestRate: 7.0,
    defaultTermMonths: 120,
    gracePeriodDays: 10,
    lateFeePercent: 5,
  },
};

export class OnboardingService {
  async getOnboardingStatus(orgId: number): Promise<OnboardingStatus> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    const data = (org.onboardingData as OnboardingData) || {};
    
    return {
      completed: org.onboardingCompleted || false,
      currentStep: org.onboardingStep || 0,
      data,
      totalSteps: ONBOARDING_STEPS.length,
    };
  }

  async updateOnboardingStep(
    orgId: number, 
    step: number, 
    data: Partial<OnboardingData>,
    skipped: boolean = false
  ): Promise<OnboardingStatus> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    const currentData = (org.onboardingData as OnboardingData) || {};
    const completedSteps = currentData.completedSteps || [];
    const skippedSteps = currentData.skippedSteps || [];

    if (skipped && !skippedSteps.includes(step)) {
      skippedSteps.push(step);
    } else if (!skipped && !completedSteps.includes(step)) {
      completedSteps.push(step);
    }

    const updatedData: OnboardingData = {
      ...currentData,
      ...data,
      completedSteps,
      skippedSteps,
    };

    const nextStep = Math.min(step + 1, ONBOARDING_STEPS.length - 1);
    
    await storage.updateOrganization(orgId, {
      onboardingStep: nextStep,
      onboardingData: updatedData as any,
    });

    return this.getOnboardingStatus(orgId);
  }

  async provisionTemplates(orgId: number, businessType: BusinessType): Promise<{
    success: boolean;
    provisioned: {
      campaigns: number;
      tags: string[];
    };
  }> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    let campaignsCreated = 0;
    let allTags: string[] = [];

    if (businessType === "land_flipper" || businessType === "hybrid") {
      for (const campaignTemplate of LAND_FLIPPER_TEMPLATES.campaigns) {
        await storage.createCampaign({
          organizationId: orgId,
          ...campaignTemplate,
        });
        campaignsCreated++;
      }
      allTags = [...allTags, ...LAND_FLIPPER_TEMPLATES.defaultTags];
    }

    if (businessType === "note_investor" || businessType === "hybrid") {
      for (const campaignTemplate of NOTE_INVESTOR_TEMPLATES.campaigns) {
        await storage.createCampaign({
          organizationId: orgId,
          ...campaignTemplate,
        });
        campaignsCreated++;
      }
      allTags = [...allTags, ...NOTE_INVESTOR_TEMPLATES.defaultTags];

      const settings = (org.settings as any) || {};
      await storage.updateOrganization(orgId, {
        settings: {
          ...settings,
          ...NOTE_INVESTOR_TEMPLATES.noteSettings,
        },
      });
    }

    if (businessType === "residential_wholesaler") {
      for (const campaignTemplate of RESIDENTIAL_WHOLESALER_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...RESIDENTIAL_WHOLESALER_TEMPLATES.defaultTags];
    }

    if (businessType === "fix_and_flip") {
      for (const campaignTemplate of FIX_AND_FLIP_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...FIX_AND_FLIP_TEMPLATES.defaultTags];
      const settings = (org.settings as any) || {};
      await storage.updateOrganization(orgId, {
        settings: { ...settings, ...FIX_AND_FLIP_TEMPLATES.noteSettings },
      });
    }

    if (businessType === "buy_and_hold") {
      for (const campaignTemplate of BUY_AND_HOLD_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...BUY_AND_HOLD_TEMPLATES.defaultTags];
      const settings = (org.settings as any) || {};
      await storage.updateOrganization(orgId, {
        settings: { ...settings, ...BUY_AND_HOLD_TEMPLATES.noteSettings },
      });
    }

    if (businessType === "commercial") {
      for (const campaignTemplate of COMMERCIAL_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...COMMERCIAL_TEMPLATES.defaultTags];
      const settings = (org.settings as any) || {};
      await storage.updateOrganization(orgId, {
        settings: { ...settings, ...COMMERCIAL_TEMPLATES.noteSettings },
      });
    }

    const currentData = (org.onboardingData as OnboardingData) || {};
    await storage.updateOrganization(orgId, {
      onboardingData: {
        ...currentData,
        businessType,
      } as any,
    });

    return {
      success: true,
      provisioned: {
        campaigns: campaignsCreated,
        tags: Array.from(new Set(allTags)),
      },
    };
  }

  async generatePersonalizedTips(orgId: number, step: number): Promise<string[]> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return this.getDefaultTips(step);
    }

    const onboardingData = (org.onboardingData as OnboardingData) || {};
    const businessType = onboardingData.businessType || "land_flipper";

    const businessTypeLabels: Record<string, string> = {
      land_flipper: "land flipper",
      note_investor: "note investor / seller financier",
      hybrid: "hybrid investor (land flipping + seller financing)",
      residential_wholesaler: "residential wholesaler",
      fix_and_flip: "fix and flip investor",
      buy_and_hold: "buy and hold / rental investor",
      commercial: "commercial real estate investor",
    };

    const stepInfo = ONBOARDING_STEPS[step];
    if (!stepInfo) {
      return this.getDefaultTips(step);
    }

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an AI assistant helping real estate investors get started with their business.
The user is a ${businessTypeLabels[businessType] ?? businessType}.
Provide 3 brief, actionable tips for the current onboarding step. Keep each tip under 50 words.
Return only the tips as a JSON array of strings.`,
          },
          {
            role: "user",
            content: `The user is on step "${stepInfo.title}" (step ${step + 1} of ${ONBOARDING_STEPS.length}).
Business type: ${businessType}
${onboardingData.dataImported ? "They have imported existing data." : "They haven't imported data yet."}
${onboardingData.stripeConnected ? "Stripe is connected." : "Stripe is not connected yet."}

Generate 3 helpful tips for this step.`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        const tips = parsed.tips || parsed.data || [];
        if (Array.isArray(tips) && tips.length > 0) {
          return tips.slice(0, 3);
        }
      }
    } catch (error) {
      console.error("Error generating AI tips:", error);
    }

    return this.getDefaultTips(step);
  }

  private getDefaultTips(step: number): string[] {
    const defaultTips: Record<number, string[]> = {
      0: [
        "Choose the business type that best matches your investment strategy. You can always adjust later.",
        "Land flipping focuses on quick acquisitions and resales. Note investing focuses on seller financing.",
        "The hybrid option gives you templates for both strategies.",
      ],
      1: [
        "Import your existing leads from a CSV file to get started quickly.",
        "You can skip this step and add leads manually later.",
        "Make sure your CSV has columns for name, email, phone, and address.",
      ],
      2: [
        "Connect Stripe to process payments for seller-financed notes.",
        "This step is optional but recommended for note investors.",
        "You can always connect services later from the Settings page.",
      ],
      3: [
        "Your first campaign will help you reach potential sellers.",
        "We've pre-created template campaigns based on your business type.",
        "Customize the campaign content to match your brand and market.",
      ],
      4: [
        "Review your setup before launching.",
        "You can always come back and make changes later.",
        "Congratulations on setting up your land investment business!",
      ],
    };

    return defaultTips[step] || defaultTips[0];
  }

  async completeOnboarding(orgId: number): Promise<void> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    const onboardingData = (org.onboardingData as OnboardingData) || {};
    const businessType = onboardingData.businessType || "land_flipper";

    // Create sample data before marking onboarding complete
    try {
      if (businessType === "land_flipper" || businessType === "hybrid") {
        // Sample leads for land flipper
        const lead1 = await storage.createLead({
          organizationId: orgId,
          type: "seller",
          firstName: "Sarah",
          lastName: "Martinez",
          email: "sarah.m@example.com",
          phone: "555-0101",
          address: "456 Ranch Rd",
          city: "Sedona",
          state: "AZ",
          zip: "86336",
          status: "new",
          source: "direct_mail",
          tags: ["motivated"],
          notes: "Inherited property, wants to sell quickly",
        } as any);

        await storage.createLead({
          organizationId: orgId,
          type: "seller",
          firstName: "Bill",
          lastName: "Thompson",
          email: "b.thompson@example.com",
          phone: "555-0102",
          address: "789 Meadow Ln",
          city: "Prescott",
          state: "AZ",
          zip: "86301",
          status: "contacted",
          source: "cold_call",
        } as any);

        // Sample property
        const sampleProperty = await storage.createProperty({
          organizationId: orgId,
          apn: "ONBOARD-SAMPLE-001",
          county: "Yavapai",
          state: "AZ",
          address: "123 Sample Parcel Rd",
          city: "Sedona",
          zip: "86336",
          sizeAcres: "5.2",
          status: "prospect",
          marketValue: "45000",
          purchasePrice: null,
          sellerId: lead1.id,
        } as any);

        // Sample deal linked to property
        await storage.createDeal({
          organizationId: orgId,
          propertyId: sampleProperty.id,
          type: "acquisition",
          status: "negotiating",
          offerAmount: "45000",
          notes: "Sedona Parcel - Martinez Deal",
        } as any);
      } else if (businessType === "residential_wholesaler") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Mike", lastName: "Torres",
          email: "m.torres@example.com", phone: "555-0301", address: "1842 Elm St",
          city: "Houston", state: "TX", zip: "77001", status: "new", source: "direct_mail",
          tags: ["distressed", "absentee owner"], notes: "Vacant property, taxes behind 2 years",
        } as any);
        await storage.createLead({
          organizationId: orgId, type: "buyer", firstName: "Dana", lastName: "Koch",
          email: "d.koch@example.com", phone: "555-0302", address: "500 Investor Ave",
          city: "Houston", state: "TX", zip: "77002", status: "new", source: "referral",
          tags: ["cash buyer"], notes: "Buys 2-4 SFH per month in Houston metro",
        } as any);
        const wsProperty = await storage.createProperty({
          organizationId: orgId, county: "Harris", state: "TX", address: "1842 Elm St",
          city: "Houston", zip: "77001", status: "prospect", marketValue: "185000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: wsProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "140000", notes: "Wholesale — targeting $15k assignment fee",
        } as any);
      } else if (businessType === "fix_and_flip") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Gary", lastName: "Holt",
          email: "g.holt@example.com", phone: "555-0401", address: "309 Birch Dr",
          city: "Atlanta", state: "GA", zip: "30301", status: "new", source: "direct_mail",
          tags: ["distressed", "full rehab"], notes: "Inherited property, needs full renovation",
        } as any);
        const ffProperty = await storage.createProperty({
          organizationId: orgId, county: "Fulton", state: "GA", address: "309 Birch Dr",
          city: "Atlanta", zip: "30301", status: "prospect", marketValue: "320000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: ffProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "165000",
          notes: "Fix & flip — ARV $320k, est. rehab $85k, target profit $45k",
        } as any);
      } else if (businessType === "buy_and_hold") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Pat", lastName: "Sullivan",
          email: "p.sullivan@example.com", phone: "555-0501", address: "77 Maple Blvd",
          city: "Columbus", state: "OH", zip: "43201", status: "new", source: "direct_mail",
          tags: ["SFR", "value-add"], notes: "Landlord tired of managing, ready to sell",
        } as any);
        const bhProperty = await storage.createProperty({
          organizationId: orgId, county: "Franklin", state: "OH", address: "77 Maple Blvd",
          city: "Columbus", zip: "43201", status: "prospect", marketValue: "145000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: bhProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "118000",
          notes: "Buy & hold — current rent $1,100/mo, target cap rate 6.5%",
        } as any);
      } else if (businessType === "commercial") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Lynn", lastName: "Park",
          email: "l.park@example.com", phone: "555-0601", address: "1200 Commerce Pkwy",
          city: "Dallas", state: "TX", zip: "75201", status: "new", source: "referral",
          tags: ["NNN", "retail strip"], notes: "Owner retiring, open to seller financing",
        } as any);
        const commProperty = await storage.createProperty({
          organizationId: orgId, county: "Dallas", state: "TX", address: "1200 Commerce Pkwy",
          city: "Dallas", zip: "75201", status: "prospect", marketValue: "2100000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: commProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "1850000",
          notes: "Commercial NNN — 3 tenants, 8% cap rate target",
        } as any);
      } else if (businessType === "note_investor") {
        // Sample leads for note investor
        await storage.createLead({
          organizationId: orgId,
          type: "buyer",
          firstName: "James",
          lastName: "Rivera",
          email: "j.rivera@example.com",
          phone: "555-0201",
          address: "100 Buyer Blvd",
          city: "Phoenix",
          state: "AZ",
          zip: "85001",
          status: "new",
          source: "direct_mail",
          tags: ["owner_finance"],
          notes: "Interested in seller financing on rural land",
        } as any);

        await storage.createLead({
          organizationId: orgId,
          type: "seller",
          firstName: "Carol",
          lastName: "Jensen",
          email: "c.jensen@example.com",
          phone: "555-0202",
          address: "200 Note Ln",
          city: "Flagstaff",
          state: "AZ",
          zip: "86001",
          status: "contacted",
          source: "referral",
          tags: ["performing_note"],
        } as any);

        // Sample property for note
        await storage.createProperty({
          organizationId: orgId,
          apn: "ONBOARD-NOTE-001",
          county: "Coconino",
          state: "AZ",
          address: "300 Finance Rd",
          city: "Flagstaff",
          zip: "86001",
          sizeAcres: "2.5",
          status: "owned",
          marketValue: "35000",
          purchasePrice: "28000",
        } as any);
      }
    } catch (sampleDataError) {
      // Sample data creation failure must not break onboarding completion
      console.error("[onboarding] Failed to create sample data (non-fatal):", sampleDataError);
    }

    const settings = (org.settings as any) || {};

    await storage.updateOrganization(orgId, {
      onboardingCompleted: true,
      settings: {
        ...settings,
        onboardingCompleted: true,
        showTips: true,
      },
    });
  }

  async resetOnboarding(orgId: number): Promise<void> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    const settings = (org.settings as any) || {};
    
    await storage.updateOrganization(orgId, {
      onboardingCompleted: false,
      onboardingStep: 0,
      onboardingData: {} as any,
      settings: {
        ...settings,
        onboardingCompleted: false,
        checklistDismissed: false,
        showTips: true,
      },
    });
  }

  async generateSampleData(orgId: number): Promise<{
    success: boolean;
    counts: {
      leads: number;
      properties: number;
      notes: number;
      deals: number;
    };
  }> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    let leadsCreated = 0;
    let propertiesCreated = 0;
    let notesCreated = 0;
    let dealsCreated = 0;

    // Sample leads data
    const sampleLeads = [
      {
        organizationId: orgId,
        type: "seller" as const,
        firstName: "John",
        lastName: "Anderson",
        email: "john.anderson@example.com",
        phone: "(555) 123-4567",
        address: "123 Oak Street",
        city: "Austin",
        state: "TX",
        zip: "78701",
        status: "new",
        source: "sample_data",
        tags: ["sample", "hot lead"],
      },
      {
        organizationId: orgId,
        type: "seller" as const,
        firstName: "Maria",
        lastName: "Garcia",
        email: "maria.garcia@example.com",
        phone: "(555) 234-5678",
        address: "456 Pine Avenue",
        city: "Phoenix",
        state: "AZ",
        zip: "85001",
        status: "contacted",
        source: "sample_data",
        tags: ["sample", "motivated seller"],
      },
      {
        organizationId: orgId,
        type: "buyer" as const,
        firstName: "Robert",
        lastName: "Smith",
        email: "robert.smith@example.com",
        phone: "(555) 345-6789",
        address: "789 Maple Drive",
        city: "Denver",
        state: "CO",
        zip: "80202",
        status: "qualified",
        source: "sample_data",
        tags: ["sample", "cash buyer"],
      },
      {
        organizationId: orgId,
        type: "seller" as const,
        firstName: "Linda",
        lastName: "Williams",
        email: "linda.williams@example.com",
        phone: "(555) 456-7890",
        address: "321 Cedar Lane",
        city: "Tampa",
        state: "FL",
        zip: "33601",
        status: "negotiating",
        source: "sample_data",
        tags: ["sample", "inherited property"],
      },
      {
        organizationId: orgId,
        type: "buyer" as const,
        firstName: "Michael",
        lastName: "Johnson",
        email: "michael.johnson@example.com",
        phone: "(555) 567-8901",
        address: "654 Birch Road",
        city: "Nashville",
        state: "TN",
        zip: "37201",
        status: "new",
        source: "sample_data",
        tags: ["sample", "terms buyer"],
      },
    ];

    // Create leads
    const createdLeads: any[] = [];
    for (const leadData of sampleLeads) {
      const lead = await storage.createLead(leadData);
      createdLeads.push(lead);
      leadsCreated++;
    }

    // Sample properties data
    const sampleProperties = [
      {
        organizationId: orgId,
        apn: "SAMPLE-001-234",
        legalDescription: "Lot 5, Block A, Sunset Acres",
        county: "Travis",
        state: "TX",
        address: "Tract 5 FM 2222",
        city: "Austin",
        zip: "78730",
        sizeAcres: "5.25",
        zoning: "Agricultural",
        terrain: "rolling",
        roadAccess: "paved",
        status: "owned",
        assessedValue: "15000",
        marketValue: "25000",
        purchasePrice: "12000",
        listPrice: "29900",
        sellerId: createdLeads[0]?.id,
        description: "Beautiful 5+ acre parcel with mature trees and rolling terrain. Great for homesite or recreational use.",
        highlights: ["Road frontage", "Mature trees", "Electric available"],
      },
      {
        organizationId: orgId,
        apn: "SAMPLE-002-567",
        legalDescription: "Lot 12, Desert Vista Estates",
        county: "Maricopa",
        state: "AZ",
        address: "N Desert Vista Road",
        city: "Surprise",
        zip: "85374",
        sizeAcres: "2.5",
        zoning: "Residential",
        terrain: "flat",
        roadAccess: "gravel",
        status: "listed",
        assessedValue: "8000",
        marketValue: "18000",
        purchasePrice: "6500",
        listPrice: "19900",
        sellerId: createdLeads[1]?.id,
        description: "Level 2.5 acre lot perfect for manufactured or stick-built home. Mountain views!",
        highlights: ["Mountain views", "Level lot", "Near town"],
      },
      {
        organizationId: orgId,
        apn: "SAMPLE-003-890",
        legalDescription: "Parcel B, Mountain Creek Ranch",
        county: "El Paso",
        state: "CO",
        address: "County Road 47",
        city: "Peyton",
        zip: "80831",
        sizeAcres: "10.0",
        zoning: "Agricultural",
        terrain: "mountainous",
        roadAccess: "dirt",
        status: "under_contract",
        assessedValue: "22000",
        marketValue: "45000",
        purchasePrice: "18000",
        listPrice: "49900",
        description: "Stunning 10 acre mountain property with Pikes Peak views. Perfect for off-grid living.",
        highlights: ["Pikes Peak views", "Creek frontage", "Wildlife"],
      },
    ];

    // Create properties
    const createdProperties: any[] = [];
    for (const propData of sampleProperties) {
      const property = await storage.createProperty(propData as any);
      createdProperties.push(property);
      propertiesCreated++;
    }

    // Create sample deals
    if (createdProperties.length > 0) {
      const sampleDeals = [
        {
          organizationId: orgId,
          propertyId: createdProperties[0]?.id,
          type: "acquisition",
          status: "closed",
          offerAmount: "10000",
          acceptedAmount: "12000",
          notes: "Sample acquisition deal - good margin on this one",
        },
        {
          organizationId: orgId,
          propertyId: createdProperties[2]?.id,
          type: "disposition",
          status: "in_escrow",
          offerAmount: "45000",
          notes: "Sample disposition - cash buyer, closing next week",
        },
      ];

      for (const dealData of sampleDeals) {
        await storage.createDeal(dealData as any);
        dealsCreated++;
      }
    }

    // Create sample notes (seller finance)
    if (createdProperties.length > 1 && createdLeads.length > 2) {
      const today = new Date();
      const nextMonth = new Date(today);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const maturityDate = new Date(today);
      maturityDate.setFullYear(maturityDate.getFullYear() + 5);

      const sampleNote = {
        organizationId: orgId,
        propertyId: createdProperties[1]?.id,
        borrowerId: createdLeads[2]?.id,
        originalPrincipal: "19900",
        currentBalance: "18500",
        interestRate: "9.9",
        termMonths: 60,
        monthlyPayment: "419.52",
        serviceFee: "0",
        lateFee: "25",
        gracePeriodDays: 10,
        startDate: today,
        firstPaymentDate: nextMonth,
        nextPaymentDate: nextMonth,
        maturityDate: maturityDate,
        status: "active",
        downPayment: "1990",
        downPaymentReceived: true,
        notes_text: "Sample seller-financed note. Buyer is paying on time.",
      };

      await storage.createNote(sampleNote as any);
      notesCreated++;
    }

    // Update onboarding data to mark sample data loaded
    const currentData = (org.onboardingData as OnboardingData) || {};
    await storage.updateOrganization(orgId, {
      onboardingData: {
        ...currentData,
        sampleDataLoaded: true,
      } as any,
    });

    return {
      success: true,
      counts: {
        leads: leadsCreated,
        properties: propertiesCreated,
        notes: notesCreated,
        deals: dealsCreated,
      },
    };
  }

  async clearSampleData(orgId: number): Promise<{
    success: boolean;
    counts: {
      leads: number;
      properties: number;
      notes: number;
      deals: number;
    };
  }> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    // Get all sample leads (by source)
    const allLeads = await storage.getLeads(orgId);
    const sampleLeads = allLeads.filter(l => l.source === "sample_data");
    
    // Get properties and notes to clean up
    const allProperties = await storage.getProperties(orgId);
    const sampleProperties = allProperties.filter(p => 
      p.apn?.startsWith("SAMPLE-")
    );
    
    let leadsDeleted = 0;
    let propertiesDeleted = 0;
    let notesDeleted = 0;
    let dealsDeleted = 0;

    // Delete sample leads
    for (const lead of sampleLeads) {
      await storage.deleteLead(lead.id);
      leadsDeleted++;
    }

    // Delete sample properties (cascade should handle deals and notes)
    for (const prop of sampleProperties) {
      await storage.deleteProperty(prop.id);
      propertiesDeleted++;
    }

    // Update onboarding data
    const currentData = (org.onboardingData as OnboardingData) || {};
    await storage.updateOrganization(orgId, {
      onboardingData: {
        ...currentData,
        sampleDataLoaded: false,
      } as any,
    });

    return {
      success: true,
      counts: {
        leads: leadsDeleted,
        properties: propertiesDeleted,
        notes: notesDeleted,
        deals: dealsDeleted,
      },
    };
  }
}

export const onboardingService = new OnboardingService();
