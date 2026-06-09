import { db } from "../db";
import { eq } from "drizzle-orm";
import { organizations, campaigns, type Organization } from "@shared/schema";
import { storage } from "../storage";
import type { InsertLead, InsertProperty, InsertDeal } from "@shared/schema";
import { getOpenAIClient } from "../utils/openaiClient";
import { logger } from "../utils/logger";
import { addMonths } from "../utils/dateUtils";

export type BusinessType =
  | "land_flipper"
  | "note_investor"
  | "hybrid"
  | "residential_wholesaler"
  | "fix_and_flip"
  | "buy_and_hold"
  | "commercial"
  | "short_term_rental"
  | "creative_finance"
  | "developer"
  | "tax_lien_deed"
  | "multifamily"
  | "mobile_home"
  | "agent_investor";

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

const SHORT_TERM_RENTAL_TEMPLATES = {
  campaigns: [
    {
      name: "Off-Market STR Acquisition",
      type: "direct_mail",
      status: "draft",
      subject: "Interested in Selling Your Vacation Home?",
      content: "Dear Property Owner,\n\nI'm actively acquiring vacation and short-term rental properties in [MARKET]. If you've been thinking about selling — whether your property is currently on Airbnb, VRBO, or simply sitting unused — I'd love to make you a fair offer.\n\nNo realtor commissions. No staging. Quick, flexible closing.\n\nReply to this letter or call [PHONE].\n\nBest regards,\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Tired Host Outreach",
      type: "email",
      status: "draft",
      subject: "Ready to Hand Off Your Rental? Let's Talk",
      content: "Hi {{firstName}},\n\nManaging a short-term rental can be exhausting — guest turnover, cleaning, maintenance, reviews. If you're considering selling, I specialize in acquiring STR properties and can make the process simple.\n\nWould you be open to a quick call this week?\n\nBest,\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
  ],
  defaultTags: ["STR", "Airbnb", "VRBO", "vacation rental", "beach", "mountain", "lake", "high occupancy"],
  noteSettings: {
    defaultInterestRate: 7.5,
    defaultTermMonths: 360,
    gracePeriodDays: 15,
    lateFeePercent: 5,
  },
};

const CREATIVE_FINANCE_TEMPLATES = {
  campaigns: [
    {
      name: "Subject-To Seller Outreach",
      type: "direct_mail",
      status: "draft",
      subject: "A Creative Solution for Your Home — No Repairs, No Hassle",
      content: "Dear Property Owner,\n\nAre you behind on payments or just need to move quickly? I specialize in creative solutions that can help you avoid foreclosure, protect your credit, and walk away with peace of mind.\n\nI take over your existing mortgage payments — you get relief, I get the property. It's a win-win.\n\nCall or text [PHONE] for a confidential conversation.\n\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Lease Option Outreach",
      type: "email",
      status: "draft",
      subject: "Would You Consider a Lease-Purchase on Your Property?",
      content: "Hi {{firstName}},\n\nI noticed your property at {{address}} and wanted to propose something different: a lease-purchase agreement. You'd receive monthly income above market rent, plus a premium purchase price when I exercise the option.\n\nThis works especially well if your home has been sitting on the market. Interested?\n\nReply or call [PHONE].\n\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
  ],
  defaultTags: ["subject-to", "wrap", "lease option", "seller financing", "pre-foreclosure", "creative deal", "owner carry"],
  noteSettings: {
    defaultInterestRate: 8.0,
    defaultTermMonths: 360,
    gracePeriodDays: 10,
    lateFeePercent: 5,
  },
};

const DEVELOPER_TEMPLATES = {
  campaigns: [
    {
      name: "Land Acquisition for Development",
      type: "direct_mail",
      status: "draft",
      subject: "We Buy Land for Development — Top Dollar for the Right Parcel",
      content: "Dear Property Owner,\n\nWe're a development company actively acquiring parcels for residential and mixed-use projects in [COUNTY/MARKET].\n\nIf your land is 5+ acres with road access and utilities nearby, we may be able to offer above-market pricing.\n\nNo broker fees. Flexible terms. Quick due diligence.\n\nCall [PHONE] or reply to discuss.\n\n[YOUR NAME]\n[COMPANY NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Lot Buyer Outreach",
      type: "email",
      status: "draft",
      subject: "New Lots Available — {{subdivision}} — Starting at $[PRICE]",
      content: "Hi {{firstName}},\n\nWe have new lots available in [SUBDIVISION NAME]:\n\n📍 Location: [CITY, STATE]\n📐 Lot sizes: [SIZE RANGE]\n💰 Starting at: $[PRICE]\n🏗️ Builder-ready with utilities\n\nThese won't last. Reply or call [PHONE] for a plat map and pricing sheet.\n\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["buyer"] },
    },
  ],
  defaultTags: ["subdividable", "entitled", "zoned residential", "utilities available", "road access", "infill", "raw land", "plat approved"],
};

const TAX_LIEN_DEED_TEMPLATES = {
  campaigns: [
    {
      name: "Post-Auction Owner Outreach",
      type: "direct_mail",
      status: "draft",
      subject: "Important Notice About Your Property — Tax Sale",
      content: "Dear Property Owner,\n\nI recently acquired the tax lien / tax deed on your property at [ADDRESS]. I understand this may be stressful, and I want to work with you.\n\nYou may still have the right to redeem your property. I'm open to discussing options that work for both of us.\n\nPlease contact me at [PHONE] or reply to this letter.\n\nSincerely,\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Pre-Delinquency Outreach",
      type: "email",
      status: "draft",
      subject: "Can I Help With Your Property Taxes?",
      content: "Hi {{firstName}},\n\nI noticed your property at {{address}} may have outstanding tax obligations. Before it goes to auction, I'd like to explore whether a private sale might make more sense for you.\n\nI buy properties directly — no agents, no fees, quick closing. If that interests you, let's talk.\n\nBest,\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
  ],
  defaultTags: ["tax delinquent", "auction", "redeemable", "deed sale", "lien sale", "surplus", "quiet title needed"],
};

const MULTIFAMILY_TEMPLATES = {
  campaigns: [
    {
      name: "Off-Market Multifamily Acquisition",
      type: "direct_mail",
      status: "draft",
      subject: "Interested in Selling Your Apartment Building?",
      content: "Dear Property Owner,\n\nI represent a private investment group actively acquiring multifamily properties (5-100+ units) in [MARKET].\n\nIf you've considered selling, we offer:\n- Competitive pricing based on actual income\n- No broker commissions\n- Flexible closing timelines\n- Assumption of existing management if desired\n\nThis is a confidential inquiry. Please call [PHONE] or reply.\n\n[YOUR NAME]\n[COMPANY NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Value-Add Opportunity Outreach",
      type: "email",
      status: "draft",
      subject: "Quick Question About Your Property at {{address}}",
      content: "Hi {{firstName}},\n\nI noticed your multifamily property and wanted to reach out. We specialize in acquiring value-add apartment buildings where we can improve operations and renovate units.\n\nWould you be open to an off-market conversation? Even if you're not ready to sell now, I'd love to build a relationship.\n\nBest,\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
  ],
  defaultTags: ["value-add", "stabilized", "Class A", "Class B", "Class C", "5-20 units", "20-50 units", "50+ units", "heavy rehab"],
  noteSettings: {
    defaultInterestRate: 6.0,
    defaultTermMonths: 360,
    gracePeriodDays: 10,
    lateFeePercent: 5,
  },
};

const MOBILE_HOME_TEMPLATES = {
  campaigns: [
    {
      name: "Mobile Home Park Acquisition",
      type: "direct_mail",
      status: "draft",
      subject: "Interested in Selling Your Mobile Home Park?",
      content: "Dear Park Owner,\n\nI'm actively acquiring mobile home parks and manufactured housing communities. If you're considering retirement, simplifying your portfolio, or just exploring options, I'd love to have a confidential conversation.\n\nWe offer fair valuations, flexible terms, and can close quickly.\n\nCall [PHONE] or reply to this letter.\n\n[YOUR NAME]\n[COMPANY NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Mobile Home Owner Outreach",
      type: "email",
      status: "draft",
      subject: "Cash Offer for Your Mobile Home",
      content: "Hi {{firstName}},\n\nI buy mobile homes in [AREA] — any condition, any age. If you're looking to sell, I can make a fair cash offer and close on your timeline.\n\nNo repairs needed. No agent fees. Simple process.\n\nInterested? Reply or call [PHONE].\n\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
  ],
  defaultTags: ["MHP", "park-owned home", "tenant-owned home", "vacant lot", "55+", "all-ages", "city water", "well/septic"],
  noteSettings: {
    defaultInterestRate: 10.0,
    defaultTermMonths: 84,
    gracePeriodDays: 10,
    lateFeePercent: 5,
  },
};

const AGENT_INVESTOR_TEMPLATES = {
  campaigns: [
    {
      name: "Buyer Lead Nurture",
      type: "email",
      status: "draft",
      subject: "New Listings Matching Your Criteria — {{city}}",
      content: "Hi {{firstName}},\n\nI have new listings that match what you're looking for:\n\n📍 [PROPERTY 1]\n📍 [PROPERTY 2]\n📍 [PROPERTY 3]\n\nWant to schedule a showing? Reply or call [PHONE].\n\nBest,\n[YOUR NAME]\n[BROKERAGE]",
      targetCriteria: { leadStatus: ["new"], leadType: ["buyer"] },
    },
    {
      name: "Expired Listing Outreach",
      type: "direct_mail",
      status: "draft",
      subject: "Your Listing Expired — Let's Get It Sold",
      content: "Dear {{firstName}},\n\nI noticed your home at {{address}} recently came off the market. That can be frustrating, but it doesn't mean your home won't sell — it may just need a different approach.\n\nI'd love to share my marketing plan and show you what I'd do differently. No pressure, just a conversation.\n\nCall or text [PHONE].\n\n[YOUR NAME]\nLicensed Real Estate Agent\n[BROKERAGE]",
      targetCriteria: { leadStatus: ["new"], leadType: ["seller"] },
    },
    {
      name: "Investment Property Acquisition",
      type: "email",
      status: "draft",
      subject: "Off-Market Opportunity — {{city}}",
      content: "Hi {{firstName}},\n\nI came across a property that might be a fit for your investment criteria:\n\n📍 {{address}}\n💰 Price: $[PRICE]\n📊 Cap Rate: [CAP_RATE]%\n\nThis is off-market and won't last. Want details?\n\nBest,\n[YOUR NAME]",
      targetCriteria: { leadStatus: ["new"], leadType: ["buyer"] },
    },
  ],
  defaultTags: ["buyer lead", "seller lead", "listing", "expired", "FSBO", "investment property", "referral", "sphere"],
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
    if (step < 0 || step >= ONBOARDING_STEPS.length) {
      throw new Error(`Invalid onboarding step: ${step}. Must be 0-${ONBOARDING_STEPS.length - 1}.`);
    }

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

    if (businessType === "short_term_rental") {
      for (const campaignTemplate of SHORT_TERM_RENTAL_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...SHORT_TERM_RENTAL_TEMPLATES.defaultTags];
      const settings = (org.settings as any) || {};
      await storage.updateOrganization(orgId, {
        settings: { ...settings, ...SHORT_TERM_RENTAL_TEMPLATES.noteSettings },
      });
    }

    if (businessType === "creative_finance") {
      for (const campaignTemplate of CREATIVE_FINANCE_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...CREATIVE_FINANCE_TEMPLATES.defaultTags];
      const settings = (org.settings as any) || {};
      await storage.updateOrganization(orgId, {
        settings: { ...settings, ...CREATIVE_FINANCE_TEMPLATES.noteSettings },
      });
    }

    if (businessType === "developer") {
      for (const campaignTemplate of DEVELOPER_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...DEVELOPER_TEMPLATES.defaultTags];
    }

    if (businessType === "tax_lien_deed") {
      for (const campaignTemplate of TAX_LIEN_DEED_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...TAX_LIEN_DEED_TEMPLATES.defaultTags];
    }

    if (businessType === "multifamily") {
      for (const campaignTemplate of MULTIFAMILY_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...MULTIFAMILY_TEMPLATES.defaultTags];
      const settings = (org.settings as any) || {};
      await storage.updateOrganization(orgId, {
        settings: { ...settings, ...MULTIFAMILY_TEMPLATES.noteSettings },
      });
    }

    if (businessType === "mobile_home") {
      for (const campaignTemplate of MOBILE_HOME_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...MOBILE_HOME_TEMPLATES.defaultTags];
      const settings = (org.settings as any) || {};
      await storage.updateOrganization(orgId, {
        settings: { ...settings, ...MOBILE_HOME_TEMPLATES.noteSettings },
      });
    }

    if (businessType === "agent_investor") {
      for (const campaignTemplate of AGENT_INVESTOR_TEMPLATES.campaigns) {
        await storage.createCampaign({ organizationId: orgId, ...campaignTemplate });
        campaignsCreated++;
      }
      allTags = [...allTags, ...AGENT_INVESTOR_TEMPLATES.defaultTags];
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
      short_term_rental: "short-term rental / Airbnb investor",
      creative_finance: "creative finance investor (subject-to, wraps, lease options)",
      developer: "real estate developer / subdivider",
      tax_lien_deed: "tax lien and tax deed investor",
      multifamily: "multifamily / apartment building investor",
      mobile_home: "mobile home and manufactured housing investor",
      agent_investor: "licensed real estate agent who also invests",
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
      logger.error("Error generating AI tips", error);
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
        "Congratulations on setting up your real estate business!",
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
      } else if (businessType === "short_term_rental") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Heather", lastName: "Brooks",
          email: "h.brooks@example.com", phone: "555-0701", address: "42 Lakefront Dr",
          city: "Gatlinburg", state: "TN", zip: "37738", status: "new", source: "direct_mail",
          tags: ["STR", "tired host"], notes: "Airbnb superhost burning out, 4.8 rating, 85% occupancy",
        } as any);
        const strProperty = await storage.createProperty({
          organizationId: orgId, county: "Sevier", state: "TN", address: "42 Lakefront Dr",
          city: "Gatlinburg", zip: "37738", status: "prospect", marketValue: "425000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: strProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "380000",
          notes: "STR acquisition — est. $65k/yr gross revenue, 85% occupancy",
        } as any);
      } else if (businessType === "creative_finance") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Derek", lastName: "Nguyen",
          email: "d.nguyen@example.com", phone: "555-0801", address: "1515 Sunset Blvd",
          city: "Orlando", state: "FL", zip: "32801", status: "new", source: "direct_mail",
          tags: ["pre-foreclosure", "subject-to candidate"], notes: "2 months behind on mortgage, wants to avoid foreclosure",
        } as any);
        const cfProperty = await storage.createProperty({
          organizationId: orgId, county: "Orange", state: "FL", address: "1515 Sunset Blvd",
          city: "Orlando", zip: "32801", status: "prospect", marketValue: "310000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: cfProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "0",
          notes: "Subject-to — existing mortgage $245k at 3.5%, equity $65k, monthly PITI $1,450",
        } as any);
      } else if (businessType === "developer") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Margaret", lastName: "Ellis",
          email: "m.ellis@example.com", phone: "555-0901", address: "Hwy 290 Tract",
          city: "Dripping Springs", state: "TX", zip: "78620", status: "new", source: "cold_call",
          tags: ["subdividable", "utilities available"], notes: "20-acre tract, zoned residential, city water at road",
        } as any);
        const devProperty = await storage.createProperty({
          organizationId: orgId, county: "Hays", state: "TX", address: "Hwy 290 Tract",
          city: "Dripping Springs", zip: "78620", sizeAcres: "20.0", status: "prospect", marketValue: "800000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: devProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "650000",
          notes: "Development — 20 acres into 40 half-acre lots, est. $45k/lot retail, $1.8M total revenue",
        } as any);
      } else if (businessType === "tax_lien_deed") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Roy", lastName: "Watkins",
          email: "r.watkins@example.com", phone: "555-1001", address: "8800 County Rd 12",
          city: "Ocala", state: "FL", zip: "34470", status: "new", source: "direct_mail",
          tags: ["tax delinquent", "3+ years"], notes: "Property taxes delinquent 3 years, owner unreachable",
        } as any);
        const tlProperty = await storage.createProperty({
          organizationId: orgId, county: "Marion", state: "FL", address: "8800 County Rd 12",
          city: "Ocala", zip: "34470", sizeAcres: "1.5", status: "prospect", marketValue: "55000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: tlProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "4200",
          notes: "Tax deed — purchased at auction for $4,200, market value $55k, needs quiet title",
        } as any);
      } else if (businessType === "multifamily") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Gloria", lastName: "Reeves",
          email: "g.reeves@example.com", phone: "555-1101", address: "2200 Park Ave",
          city: "Kansas City", state: "MO", zip: "64108", status: "new", source: "referral",
          tags: ["value-add", "12 units"], notes: "Owner retiring, 12-unit building, below-market rents",
        } as any);
        const mfProperty = await storage.createProperty({
          organizationId: orgId, county: "Jackson", state: "MO", address: "2200 Park Ave",
          city: "Kansas City", zip: "64108", status: "prospect", marketValue: "960000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: mfProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "820000",
          notes: "Multifamily value-add — 12 units, current NOI $62k, target NOI $96k after reno, 7.2% cap",
        } as any);
      } else if (businessType === "mobile_home") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Earl", lastName: "Dixon",
          email: "e.dixon@example.com", phone: "555-1201", address: "Pine Ridge MHP",
          city: "Fayetteville", state: "NC", zip: "28301", status: "new", source: "direct_mail",
          tags: ["MHP", "25 lots"], notes: "Retiring park owner, 25 lots, 20 occupied, city water/sewer",
        } as any);
        const mhProperty = await storage.createProperty({
          organizationId: orgId, county: "Cumberland", state: "NC", address: "Pine Ridge MHP",
          city: "Fayetteville", zip: "28301", status: "prospect", marketValue: "625000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: mhProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "500000",
          notes: "MHP — 25 lots, 20 occupied at $350/lot rent, $7k/mo gross, 80% occupancy target 96%",
        } as any);
      } else if (businessType === "agent_investor") {
        await storage.createLead({
          organizationId: orgId, type: "seller", firstName: "Tamara", lastName: "Wells",
          email: "t.wells@example.com", phone: "555-1301", address: "900 Cherry Ln",
          city: "Raleigh", state: "NC", zip: "27601", status: "new", source: "expired_listing",
          tags: ["expired", "FSBO"], notes: "Listing expired after 90 days, motivated to sell",
        } as any);
        await storage.createLead({
          organizationId: orgId, type: "buyer", firstName: "Jason", lastName: "Park",
          email: "j.park@example.com", phone: "555-1302", address: "220 Investor Way",
          city: "Raleigh", state: "NC", zip: "27602", status: "new", source: "referral",
          tags: ["buyer lead", "investment property"], notes: "Looking for SFR under $250k, cash buyer",
        } as any);
        const aiProperty = await storage.createProperty({
          organizationId: orgId, county: "Wake", state: "NC", address: "900 Cherry Ln",
          city: "Raleigh", zip: "27601", status: "prospect", marketValue: "285000",
          purchasePrice: null,
        } as any);
        await storage.createDeal({
          organizationId: orgId, propertyId: aiProperty.id, type: "acquisition",
          status: "negotiating", offerAmount: "255000",
          notes: "Expired listing — owner motivated, ARV $310k, could list or wholesale",
        } as any);
      }
    } catch (sampleDataError) {
      // Sample data creation failure must not break onboarding completion
      logger.error("[onboarding] Failed to create sample data (non-fatal)", undefined, { metadata: { detail: sampleDataError } });
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

    // RAFE — persona-aware sample data. Until now this shipped ONE hardcoded
    // land-flipper fixture set to everyone, so a note investor / servicer who
    // clicked "Try with sample data" landed in raw-land-acquisition mock — the
    // exact mismatch the persona work removed everywhere else. We now branch on
    // the org's businessType (set by the onboarding wizard and resolved here)
    // and ship a fixture set SHAPED for that persona, using the same vocabulary
    // the Today/Finance persona forks encode. All fixtures stay honest, realistic,
    // and clearly marked as sample. Cleanup contract preserved: every lead keeps
    // source="sample_data" and every property keeps an apn that starts with
    // "SAMPLE-", so clearSampleData() removes them regardless of persona.
    const businessType =
      (org.onboardingData as OnboardingData)?.businessType ?? "land_flipper";

    const fixtures = buildSampleFixtures(orgId, businessType);

    let leadsCreated = 0;
    let propertiesCreated = 0;
    let notesCreated = 0;
    let dealsCreated = 0;

    // Create leads
    const createdLeads: any[] = [];
    for (const leadData of fixtures.leads) {
      const lead = await storage.createLead(leadData as any);
      createdLeads.push(lead);
      leadsCreated++;
    }

    // Create properties (each fixture names which sample lead is its seller by
    // index, resolved against the just-created leads so FKs are valid).
    const createdProperties: any[] = [];
    for (const propSpec of fixtures.properties) {
      const { sellerLeadIndex, ...propData } = propSpec;
      const property = await storage.createProperty({
        ...propData,
        sellerId:
          sellerLeadIndex != null ? createdLeads[sellerLeadIndex]?.id : undefined,
      } as any);
      createdProperties.push(property);
      propertiesCreated++;
    }

    // Create deals (each fixture names its property by index).
    for (const dealSpec of fixtures.deals) {
      const { propertyIndex, ...dealData } = dealSpec;
      const propertyId =
        propertyIndex != null ? createdProperties[propertyIndex]?.id : undefined;
      if (propertyIndex != null && propertyId == null) continue;
      await storage.createDeal({ ...dealData, propertyId } as any);
      dealsCreated++;
    }

    // Create notes (each fixture names its property + borrower lead by index).
    for (const noteSpec of fixtures.notes) {
      const { propertyIndex, borrowerLeadIndex, ...noteData } = noteSpec;
      const propertyId =
        propertyIndex != null ? createdProperties[propertyIndex]?.id : undefined;
      const borrowerId =
        borrowerLeadIndex != null ? createdLeads[borrowerLeadIndex]?.id : undefined;
      if (propertyIndex != null && propertyId == null) continue;
      await storage.createNote({ ...noteData, propertyId, borrowerId } as any);
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
      await storage.deleteLead(lead.id, orgId);
      leadsDeleted++;
    }

    // Delete sample properties (cascade should handle deals and notes)
    for (const prop of sampleProperties) {
      await storage.deleteProperty(prop.id, orgId);
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

// ===========================================================================
// Persona-shaped sample fixtures (Rafe).
//
// Each builder returns a self-contained fixture set for one persona. Properties
// and notes reference their related leads/properties by INDEX (resolved against
// the just-created rows in generateSampleData) so we never hand-wire ids. The
// cleanup contract is enforced here, not by the caller:
//   - every lead carries source="sample_data" + a "sample" tag;
//   - every property's apn starts with "SAMPLE-";
// so clearSampleData() removes the whole set for any persona.
//
// NO Math.random() anywhere — every value is a fixed, realistic, honest figure
// (the no-fabrication CI ratchet blocks random in customer-fact paths).
// ===========================================================================

interface SampleLeadFixture {
  organizationId: number;
  type: "seller" | "buyer";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  status: string;
  source: "sample_data";
  tags: string[];
}

interface SamplePropertyFixture {
  organizationId: number;
  apn: string; // MUST start with "SAMPLE-" so clearSampleData removes it.
  legalDescription: string;
  county: string;
  state: string;
  address: string;
  city: string;
  zip: string;
  sizeAcres: string;
  zoning: string;
  terrain: string;
  roadAccess: string;
  status: string;
  assessedValue: string;
  marketValue: string;
  purchasePrice: string;
  listPrice: string;
  description: string;
  highlights: string[];
  /** Index into the fixture leads array that owns/sells this property. */
  sellerLeadIndex?: number;
}

interface SampleDealFixture {
  organizationId: number;
  type: string;
  status: string;
  offerAmount: string;
  acceptedAmount?: string;
  notes: string;
  /** Index into the fixture properties array this deal is on. */
  propertyIndex?: number;
}

interface SampleNoteFixture {
  organizationId: number;
  originalPrincipal: string;
  currentBalance: string;
  interestRate: string;
  termMonths: number;
  monthlyPayment: string;
  serviceFee: string;
  lateFee: string;
  gracePeriodDays: number;
  startDate: Date;
  firstPaymentDate: Date;
  nextPaymentDate: Date;
  maturityDate: Date;
  status: string;
  downPayment: string;
  downPaymentReceived: boolean;
  notes_text: string;
  // Reg-Z §1026.43 hard gate (Workstream A). Sample onboarding data is
  // synthetic / non-consumer — flagged exempt so the gate constraint doesn't
  // reject the seed insert. Real consumer originations must go through
  // POST /api/notes/:id/originate with a full ATR.
  atrExemptionCode: "business_purpose";
  /** Index into the fixture properties array secured by this note. */
  propertyIndex?: number;
  /** Index into the fixture leads array that is the borrower. */
  borrowerLeadIndex?: number;
}

interface SampleFixtureSet {
  leads: SampleLeadFixture[];
  properties: SamplePropertyFixture[];
  deals: SampleDealFixture[];
  notes: SampleNoteFixture[];
}

function noteDates(monthsPaid: number): {
  startDate: Date;
  firstPaymentDate: Date;
  nextPaymentDate: Date;
  maturityDate: Date;
} {
  // Anchor on "now" but back-date the start so a seasoned book reads honestly.
  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - monthsPaid);
  const firstPaymentDate = addMonths(new Date(startDate), 1);
  const nextPaymentDate = addMonths(new Date(now), 1);
  const maturityDate = new Date(startDate);
  maturityDate.setFullYear(maturityDate.getFullYear() + 5);
  return { startDate, firstPaymentDate, nextPaymentDate, maturityDate };
}

/**
 * Land flipper / default — vacant-parcel acquisition + seller-financed exit.
 * This preserves the original hardcoded fixture set verbatim so existing land
 * customers see exactly what they did before.
 */
function buildLandFlipperFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "John", lastName: "Anderson", email: "john.anderson@example.com", phone: "(555) 123-4567", address: "123 Oak Street", city: "Austin", state: "TX", zip: "78701", status: "new", source: "sample_data", tags: ["sample", "hot lead"] },
    { organizationId: orgId, type: "seller", firstName: "Maria", lastName: "Garcia", email: "maria.garcia@example.com", phone: "(555) 234-5678", address: "456 Pine Avenue", city: "Phoenix", state: "AZ", zip: "85001", status: "contacted", source: "sample_data", tags: ["sample", "motivated seller"] },
    { organizationId: orgId, type: "buyer", firstName: "Robert", lastName: "Smith", email: "robert.smith@example.com", phone: "(555) 345-6789", address: "789 Maple Drive", city: "Denver", state: "CO", zip: "80202", status: "qualified", source: "sample_data", tags: ["sample", "cash buyer"] },
    { organizationId: orgId, type: "seller", firstName: "Linda", lastName: "Williams", email: "linda.williams@example.com", phone: "(555) 456-7890", address: "321 Cedar Lane", city: "Tampa", state: "FL", zip: "33601", status: "negotiating", source: "sample_data", tags: ["sample", "inherited property"] },
    { organizationId: orgId, type: "buyer", firstName: "Michael", lastName: "Johnson", email: "michael.johnson@example.com", phone: "(555) 567-8901", address: "654 Birch Road", city: "Nashville", state: "TN", zip: "37201", status: "new", source: "sample_data", tags: ["sample", "terms buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-001-234", legalDescription: "Lot 5, Block A, Sunset Acres", county: "Travis", state: "TX", address: "Tract 5 FM 2222", city: "Austin", zip: "78730", sizeAcres: "5.25", zoning: "Agricultural", terrain: "rolling", roadAccess: "paved", status: "owned", assessedValue: "15000", marketValue: "25000", purchasePrice: "12000", listPrice: "29900", description: "Beautiful 5+ acre parcel with mature trees and rolling terrain. Great for homesite or recreational use.", highlights: ["Road frontage", "Mature trees", "Electric available"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-002-567", legalDescription: "Lot 12, Desert Vista Estates", county: "Maricopa", state: "AZ", address: "N Desert Vista Road", city: "Surprise", zip: "85374", sizeAcres: "2.5", zoning: "Residential", terrain: "flat", roadAccess: "gravel", status: "listed", assessedValue: "8000", marketValue: "18000", purchasePrice: "6500", listPrice: "19900", description: "Level 2.5 acre lot perfect for manufactured or stick-built home. Mountain views!", highlights: ["Mountain views", "Level lot", "Near town"], sellerLeadIndex: 1 },
    { organizationId: orgId, apn: "SAMPLE-003-890", legalDescription: "Parcel B, Mountain Creek Ranch", county: "El Paso", state: "CO", address: "County Road 47", city: "Peyton", zip: "80831", sizeAcres: "10.0", zoning: "Agricultural", terrain: "mountainous", roadAccess: "dirt", status: "under_contract", assessedValue: "22000", marketValue: "45000", purchasePrice: "18000", listPrice: "49900", description: "Stunning 10 acre mountain property with Pikes Peak views. Perfect for off-grid living.", highlights: ["Pikes Peak views", "Creek frontage", "Wildlife"] },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "10000", acceptedAmount: "12000", notes: "Sample acquisition deal - good margin on this one", propertyIndex: 0 },
    { organizationId: orgId, type: "disposition", status: "in_escrow", offerAmount: "45000", notes: "Sample disposition - cash buyer, closing next week", propertyIndex: 2 },
  ];

  const d = noteDates(0);
  const notes: SampleNoteFixture[] = [
    { organizationId: orgId, originalPrincipal: "19900", currentBalance: "18500", interestRate: "9.9", termMonths: 60, monthlyPayment: "419.52", serviceFee: "0", lateFee: "25", gracePeriodDays: 10, ...d, status: "active", downPayment: "1990", downPaymentReceived: true, notes_text: "Sample seller-financed note. Buyer is paying on time.", atrExemptionCode: "business_purpose", propertyIndex: 1, borrowerLeadIndex: 2 },
  ];

  return { leads, properties, deals, notes };
}

/**
 * Note investor — a small SERVICED note book. The center of gravity is the
 * note ledger (borrowers, payment cadence, delinquency), not parcel hunting,
 * so the fixtures lead with borrowers + a seasoned book at mixed performance.
 */
function buildNoteInvestorFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "buyer", firstName: "Dana", lastName: "Phillips", email: "dana.phillips@example.com", phone: "(555) 201-3300", address: "44 Sandhill Trail", city: "Ocala", state: "FL", zip: "34470", status: "active", source: "sample_data", tags: ["sample", "borrower", "current"] },
    { organizationId: orgId, type: "buyer", firstName: "Marcus", lastName: "Reed", email: "marcus.reed@example.com", phone: "(555) 202-4411", address: "1208 Mesquite Way", city: "Lubbock", state: "TX", zip: "79410", status: "active", source: "sample_data", tags: ["sample", "borrower", "watch"] },
    { organizationId: orgId, type: "buyer", firstName: "Tyra", lastName: "Coleman", email: "tyra.coleman@example.com", phone: "(555) 203-5522", address: "9 Red Rock Loop", city: "Cortez", state: "CO", zip: "81321", status: "active", source: "sample_data", tags: ["sample", "borrower", "delinquent"] },
    { organizationId: orgId, type: "seller", firstName: "Greenline", lastName: "Capital", email: "desk@greenline-notes.example.com", phone: "(555) 204-6633", address: "500 Note Exchange Blvd", city: "Dallas", state: "TX", zip: "75201", status: "qualified", source: "sample_data", tags: ["sample", "note seller", "wholesale tape"] },
  ];

  // Each note is secured by a parcel; properties carry status="owned" because
  // the note investor holds paper on land they've already conveyed.
  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-N01-118", legalDescription: "Lot 7, Block C, Sandhill Acres", county: "Marion", state: "FL", address: "44 Sandhill Trail", city: "Ocala", zip: "34470", sizeAcres: "1.25", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "owned", assessedValue: "9000", marketValue: "16000", purchasePrice: "7000", listPrice: "0", description: "Collateral parcel for a performing seller-financed note. Borrower current.", highlights: ["Performing note collateral", "Paved access"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-N02-227", legalDescription: "Tract 3, Mesquite Flats", county: "Lubbock", state: "TX", address: "1208 Mesquite Way", city: "Lubbock", zip: "79410", sizeAcres: "3.0", zoning: "Agricultural", terrain: "flat", roadAccess: "gravel", status: "owned", assessedValue: "11000", marketValue: "21000", purchasePrice: "8500", listPrice: "0", description: "Collateral parcel for a note on the watch list — borrower paid 9 days late twice this year.", highlights: ["Note collateral", "Watch-list borrower"], sellerLeadIndex: 1 },
    { organizationId: orgId, apn: "SAMPLE-N03-336", legalDescription: "Parcel A, Red Rock Mesa", county: "Montezuma", state: "CO", address: "9 Red Rock Loop", city: "Cortez", zip: "81321", sizeAcres: "5.0", zoning: "Agricultural", terrain: "rolling", roadAccess: "dirt", status: "owned", assessedValue: "14000", marketValue: "27000", purchasePrice: "10000", listPrice: "0", description: "Collateral parcel for a delinquent note — 38 days past due, loss-mitigation outreach in progress.", highlights: ["Note collateral", "Delinquent — loss mit"], sellerLeadIndex: 2 },
  ];

  // No acquisition/disposition deals — a note investor's pipeline is the book,
  // surfaced as notes below. One disposition-style "note purchase" deal shows
  // how a bought tape lands.
  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "14200", acceptedAmount: "14200", notes: "Sample note purchase - bought a single performing note off a wholesale tape at ~0.78 of UPB.", propertyIndex: 0 },
  ];

  const dCurrent = noteDates(14); // seasoned, performing
  const dWatch = noteDates(8);
  const dDelinquent = noteDates(20);
  const notes: SampleNoteFixture[] = [
    { organizationId: orgId, originalPrincipal: "15500", currentBalance: "13100", interestRate: "10.5", termMonths: 84, monthlyPayment: "258.61", serviceFee: "15", lateFee: "25", gracePeriodDays: 10, ...dCurrent, status: "active", downPayment: "1550", downPaymentReceived: true, notes_text: "Sample performing note. Borrower current, 14 payments in. Yield holding.", atrExemptionCode: "business_purpose", propertyIndex: 0, borrowerLeadIndex: 0 },
    { organizationId: orgId, originalPrincipal: "18000", currentBalance: "16400", interestRate: "9.75", termMonths: 96, monthlyPayment: "246.18", serviceFee: "15", lateFee: "25", gracePeriodDays: 10, ...dWatch, status: "active", downPayment: "1800", downPaymentReceived: true, notes_text: "Sample watch-list note. Paid 9 days late twice — inside grace but trending. Worth a check-in call.", atrExemptionCode: "business_purpose", propertyIndex: 1, borrowerLeadIndex: 1 },
    { organizationId: orgId, originalPrincipal: "22000", currentBalance: "20950", interestRate: "11.0", termMonths: 120, monthlyPayment: "303.12", serviceFee: "15", lateFee: "25", gracePeriodDays: 10, ...dDelinquent, status: "delinquent", downPayment: "2200", downPaymentReceived: true, notes_text: "Sample delinquent note. 38 days past due. Loss-mitigation outreach started; do NOT proceed to remedy without notice + cure period.", atrExemptionCode: "business_purpose", propertyIndex: 2, borrowerLeadIndex: 2 },
  ];

  return { leads, properties, deals, notes };
}

/**
 * Residential wholesaler — motivated-seller lead flow + a cash buyer list +
 * assignments in flight. No notes (wholesalers flip contracts, not paper).
 */
function buildWholesalerFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Carla", lastName: "Nguyen", email: "carla.nguyen@example.com", phone: "(555) 301-1010", address: "812 Harwood St", city: "Columbus", state: "OH", zip: "43201", status: "negotiating", source: "sample_data", tags: ["sample", "motivated seller", "pre-foreclosure"] },
    { organizationId: orgId, type: "seller", firstName: "Devon", lastName: "Brooks", email: "devon.brooks@example.com", phone: "(555) 302-2020", address: "55 Lakeview Ct", city: "Memphis", state: "TN", zip: "38103", status: "contacted", source: "sample_data", tags: ["sample", "motivated seller", "tired landlord"] },
    { organizationId: orgId, type: "buyer", firstName: "Anita", lastName: "Powell", email: "anita.powell@example.com", phone: "(555) 303-3030", address: "9001 Investor Row", city: "Atlanta", state: "GA", zip: "30303", status: "qualified", source: "sample_data", tags: ["sample", "cash buyer", "buyer list"] },
    { organizationId: orgId, type: "buyer", firstName: "Hector", lastName: "Vega", email: "hector.vega@example.com", phone: "(555) 304-4040", address: "210 Rehab Ave", city: "Atlanta", state: "GA", zip: "30310", status: "qualified", source: "sample_data", tags: ["sample", "cash buyer", "buyer list"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-W01-441", legalDescription: "Lot 9, Block 2, Harwood Addition", county: "Franklin", state: "OH", address: "812 Harwood St", city: "Columbus", zip: "43201", sizeAcres: "0.18", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "under_contract", assessedValue: "78000", marketValue: "135000", purchasePrice: "92000", listPrice: "104000", description: "Sample wholesale deal. 3/1 needing cosmetic rehab. Under contract at $92k, assigning to a cash buyer.", highlights: ["Under contract", "Assignment in flight", "ARV ~$165k"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-W02-552", legalDescription: "Unit 4, Lakeview Court Condos", county: "Shelby", state: "TN", address: "55 Lakeview Ct", city: "Memphis", zip: "38103", sizeAcres: "0.05", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "lead", assessedValue: "61000", marketValue: "98000", purchasePrice: "0", listPrice: "0", description: "Sample lead. Tired-landlord condo, seller exploring a quick cash exit. Pre-offer.", highlights: ["Tired landlord", "Pre-offer"], sellerLeadIndex: 1 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "assignment", status: "in_escrow", offerAmount: "92000", acceptedAmount: "92000", notes: "Sample assignment. Locked at $92k, assigning to cash buyer at $104k — $12k assignment fee. EMD received.", propertyIndex: 0 },
    { organizationId: orgId, type: "acquisition", status: "negotiating", offerAmount: "58000", notes: "Sample offer out. Tired-landlord condo, countered at $66k. Working toward a contract-to-close.", propertyIndex: 1 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Fix-and-flipper — acquisition + rehab + resale. Properties carry rehab framing
 * (ARV, holding) and deals show an in-rehab + a listed-for-resale.
 */
function buildFixAndFlipFixtures(orgId: number): SampleFixtureSet {
  const leads: SampleLeadFixture[] = [
    { organizationId: orgId, type: "seller", firstName: "Priya", lastName: "Raman", email: "priya.raman@example.com", phone: "(555) 401-7000", address: "330 Birchwood Dr", city: "Raleigh", state: "NC", zip: "27601", status: "negotiating", source: "sample_data", tags: ["sample", "motivated seller", "estate sale"] },
    { organizationId: orgId, type: "seller", firstName: "Owen", lastName: "Fletcher", email: "owen.fletcher@example.com", phone: "(555) 402-8000", address: "77 Magnolia St", city: "Charlotte", state: "NC", zip: "28202", status: "contacted", source: "sample_data", tags: ["sample", "motivated seller"] },
    { organizationId: orgId, type: "buyer", firstName: "Sasha", lastName: "Klein", email: "sasha.klein@example.com", phone: "(555) 403-9000", address: "12 Retail Buyer Ln", city: "Raleigh", state: "NC", zip: "27604", status: "qualified", source: "sample_data", tags: ["sample", "retail buyer"] },
  ];

  const properties: SamplePropertyFixture[] = [
    { organizationId: orgId, apn: "SAMPLE-F01-771", legalDescription: "Lot 14, Birchwood Estates", county: "Wake", state: "NC", address: "330 Birchwood Dr", city: "Raleigh", zip: "27601", sizeAcres: "0.25", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "owned", assessedValue: "188000", marketValue: "245000", purchasePrice: "165000", listPrice: "0", description: "Sample flip mid-rehab. Bought at $165k, ~$38k rehab budget, ARV ~$285k. Kitchen + 2 baths in progress.", highlights: ["Mid-rehab", "ARV ~$285k", "Holding cost ~$1.4k/mo"], sellerLeadIndex: 0 },
    { organizationId: orgId, apn: "SAMPLE-F02-882", legalDescription: "Lot 6, Magnolia Court", county: "Mecklenburg", state: "NC", address: "77 Magnolia St", city: "Charlotte", zip: "28202", sizeAcres: "0.21", zoning: "Residential", terrain: "flat", roadAccess: "paved", status: "listed", assessedValue: "210000", marketValue: "299000", purchasePrice: "182000", listPrice: "299000", description: "Sample completed flip, listed for resale. Rehab done, on market 11 days, 2 showings scheduled.", highlights: ["Rehab complete", "Listed for resale", "11 days on market"], sellerLeadIndex: 1 },
  ];

  const deals: SampleDealFixture[] = [
    { organizationId: orgId, type: "acquisition", status: "closed", offerAmount: "160000", acceptedAmount: "165000", notes: "Sample acquisition. Closed at $165k. Rehab scope locked at $38k. Target exit $285k.", propertyIndex: 0 },
    { organizationId: orgId, type: "disposition", status: "listed", offerAmount: "299000", notes: "Sample resale. Listed at $299k after a $41k rehab. Watching days-on-market against the $182k basis.", propertyIndex: 1 },
  ];

  return { leads, properties, deals, notes: [] };
}

/**
 * Dispatch to the right persona fixture builder. Verticals without a bespoke
 * set fall back to the closest shaped one (hybrid → note investor, since the
 * land side is already well-covered by the land flipper default; everything
 * else → land flipper) so no persona ever lands in a blank or mismatched set.
 */
export function buildSampleFixtures(
  orgId: number,
  businessType: BusinessType | string,
): SampleFixtureSet {
  switch (businessType) {
    case "note_investor":
    case "creative_finance":
      return buildNoteInvestorFixtures(orgId);
    case "residential_wholesaler":
      return buildWholesalerFixtures(orgId);
    case "fix_and_flip":
      return buildFixAndFlipFixtures(orgId);
    case "land_flipper":
    case "hybrid":
    default:
      return buildLandFlipperFixtures(orgId);
  }
}

export const onboardingService = new OnboardingService();
