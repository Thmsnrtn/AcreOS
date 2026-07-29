import { db } from "../db";
import { eq } from "drizzle-orm";
import { organizations, campaigns, type Organization } from "@shared/schema";
import { storage } from "../storage";
import type { InsertLead, InsertProperty, InsertDeal } from "@shared/schema";
import { getOpenAIClient } from "../utils/openaiClient";
import { logger } from "../utils/logger";
import {
  seedSampleDataForOrg,
  clearSampleDataForOrg,
} from "./onboarding/sampleSeeder";

// Re-exported for existing consumers/tests (the fixture builders now live
// in the consolidated sample seeder — see onboarding/sampleSeeder.ts).
export { buildSampleFixtures } from "./onboarding/sampleSeeder";

// The server-side BusinessType is the SHARED 15-value registry — previously a
// hand-maintained 14-value copy here that omitted "subdivider", so subdivider
// orgs were orphaned by every server codepath typed against this union.
// Import + re-export from the shared source of truth so it can never drift.
import {
  BUSINESS_TYPES as SHARED_BUSINESS_TYPES,
  type BusinessType,
} from "@shared/models/persona-mapping";

export type { BusinessType };
export { SHARED_BUSINESS_TYPES as BUSINESS_TYPES };

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

// NOTE: this list MUST stay index-aligned with WIZARD_STEPS in
// client/src/components/onboarding/OnboardingWizard.tsx — updateOnboardingStep()
// rejects any stepId outside 0..length-1, so adding a wizard step without a row
// here makes that step's completion throw.
const ONBOARDING_STEPS = [
  { id: 0, name: "welcome", title: "Welcome & Business Type" },
  { id: 1, name: "import", title: "Import Data" },
  { id: 2, name: "first_follow_up", title: "Let Pax Take an Action" },
  { id: 3, name: "connect", title: "Connect Services" },
  { id: 4, name: "campaign", title: "Set Up Campaign" },
  { id: 5, name: "review", title: "Review & Launch" },
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

    // subdivider shares the developer template set: persona-mapping collapses
    // developer → subdivider and both run the lots/permits/plats surface.
    if (businessType === "developer" || businessType === "subdivider") {
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

    // Sample-data seeding no longer happens inline here. The old inline block
    // (sources direct_mail/cold_call, no sample labeling, not idempotent —
    // every completion re-run duplicated rows and clearSampleData could not
    // remove them) was removed. Seeding is now opt-in at the route layer via
    // server/services/onboarding/sampleSeeder.ts (idempotent, persona-aware,
    // labels every row as sample data). completeOnboarding only marks the
    // org complete.

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

    // Reset clears COMPLETION state only. It must NOT wipe onboardingData —
    // the old `onboardingData: {}` wipe lost businessType (and noteRole), so a
    // re-run silently restarted at the land_flipper default and could
    // overwrite the org's persona on completion. Preserve everything except
    // the completion-progress keys so the wizard re-runs prefilled with the
    // org's existing businessType / noteRole / persona-relevant selections.
    const currentData = (org.onboardingData as Record<string, unknown>) || {};
    const {
      completedSteps: _completedSteps,
      skippedSteps: _skippedSteps,
      skipped: _skipped,
      skippedAt: _skippedAt,
      ...preservedData
    } = currentData;

    await storage.updateOrganization(orgId, {
      onboardingCompleted: false,
      onboardingStep: 0,
      onboardingData: preservedData as any,
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

    // Delegates to the consolidated sample seeder (onboarding/sampleSeeder) —
    // the single sample-data path. Idempotent: if the org already carries
    // sample marker rows, nothing is duplicated and the existing counts are
    // reported back.
    const businessType =
      (org.onboardingData as OnboardingData)?.businessType ?? "land_flipper";
    const { counts } = await seedSampleDataForOrg(String(orgId), businessType);

    return {
      success: true,
      counts: {
        leads: counts.leads ?? 0,
        properties: counts.properties ?? 0,
        notes: counts.notes ?? 0,
        deals: counts.deals ?? 0,
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
    // Delegates to the consolidated sample seeder's clear path, which removes
    // exactly what seeding created (marker-based; see onboarding/sampleSeeder).
    const { cleared } = await clearSampleDataForOrg(String(orgId));

    return {
      success: true,
      counts: {
        leads: cleared.leads ?? 0,
        properties: cleared.properties ?? 0,
        notes: cleared.notes ?? 0,
        deals: cleared.deals ?? 0,
      },
    };
  }
}

export const onboardingService = new OnboardingService();
