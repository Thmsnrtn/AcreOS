import { db } from "../db";
import { eq } from "drizzle-orm";
import { organizations, campaigns, type Organization } from "@shared/schema";
import { storage } from "../storage";
import OpenAI from "openai";

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type BusinessType = "land_flipper" | "note_investor" | "hybrid";

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
            content: `You are an AI assistant helping land investors get started with their business. 
The user is a ${businessType === "land_flipper" ? "land flipper" : businessType === "note_investor" ? "note investor" : "hybrid land flipper and note investor"}.
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
