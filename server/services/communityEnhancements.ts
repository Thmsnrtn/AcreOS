/**
 * Community & Education Enhancements — Items 281-300
 * Knowledge base, tutorials, changelog, roadmap, feedback, tips, etc.
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";

import { CLOSED_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
// Item 281: In-app knowledge base articles
export const KNOWLEDGE_BASE = [
  { id: "getting-started", title: "Getting Started with AcreOS", category: "Basics", content: "Welcome to AcreOS! Start by adding your first leads, then explore the Deal Feed for opportunities.", keywords: ["start", "begin", "new", "onboarding"] },
  { id: "import-leads", title: "Importing Leads from CSV", category: "CRM", content: "Go to Leads > Import. Upload your CSV file. AcreOS will auto-detect columns and map them to fields.", keywords: ["import", "csv", "upload", "leads", "spreadsheet"] },
  { id: "deal-feed", title: "Using the Deal Feed", category: "Discovery", content: "The Deal Feed surfaces opportunities scored by AI. Save opportunities you like, pass on ones you dont.", keywords: ["feed", "opportunities", "deals", "discovery"] },
  { id: "seller-financing", title: "Setting Up Seller Financing", category: "Finance", content: "Go to Money > Notes > New Note. Enter the buyer, property, terms, and payment schedule.", keywords: ["financing", "notes", "payments", "seller", "buyer"] },
  { id: "campaigns", title: "Creating Your First Campaign", category: "Marketing", content: "Navigate to Campaigns > New. Choose your audience, write your message, and schedule the send.", keywords: ["campaign", "mail", "email", "sms", "marketing"] },
  { id: "pax-ai", title: "Using Pax AI Assistant", category: "AI", content: "Click the Pax icon or press Cmd+K. Ask anything about your business, properties, or AcreOS features.", keywords: ["pax", "ai", "assistant", "help", "question"] },
  { id: "due-diligence", title: "Running Due Diligence Reports", category: "Intelligence", content: "From any property, click Run DD Report. AcreOS checks environmental, legal, and market factors.", keywords: ["due diligence", "dd", "report", "environmental", "legal"] },
  { id: "marketplace", title: "Listing Properties for Sale", category: "Marketplace", content: "Go to Marketplace > New Listing. Add photos, description, and pricing.", keywords: ["marketplace", "listing", "sell", "buy"] },
];

export function searchKnowledgeBase(query: string) {
  const lower = query.toLowerCase();
  return KNOWLEDGE_BASE.filter(article =>
    article.title.toLowerCase().includes(lower) ||
    article.content.toLowerCase().includes(lower) ||
    article.keywords.some(k => lower.includes(k))
  );
}

// Item 289: Weekly tips
export const WEEKLY_TIPS = [
  "Did you know you can bulk-import leads from a CSV? Go to Leads > Import.",
  "Use the Deal Feed daily to find scored opportunities in your target counties.",
  "Set up seller financing with automatic payment tracking in Money > Notes.",
  "Ask Pax 'Hows my portfolio doing?' for an instant business summary.",
  "The Campaign tool can send personalized mail to your lead list automatically.",
  "Run a Due Diligence report on any property to check environmental and legal risks.",
  "Use the Freedom Meter to track your progress toward financial independence.",
  "Set target counties in Settings to get better Deal Feed recommendations.",
  "The Negotiation Copilot can suggest optimal offer amounts based on data.",
  "Export any table as CSV with the export button in the top-right corner.",
];

export function getWeeklyTip(): string {
  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_TIPS[weekNumber % WEEKLY_TIPS.length];
}

// Item 290: Feature announcements
export function getRecentAnnouncements(): Array<{ id: string; title: string; description: string; date: string; category: string }> {
  return [
    { id: "agent-executors", title: "Agent Execution Capabilities", description: "AI agents can now take real actions: extend trials, send emails, create issues.", date: "2026-03-29", category: "feature" },
    { id: "reaction-chains", title: "Automated Reaction Chains", description: "15 pre-built reaction chains handle user lifecycle, deal events, and platform health.", date: "2026-03-29", category: "feature" },
    { id: "leading-indicators", title: "Leading Business Indicators", description: "Track activation velocity, feature stickiness, and expansion signals.", date: "2026-03-29", category: "feature" },
    { id: "300-improvements", title: "300 Elite Improvements", description: "Comprehensive improvements across onboarding, deals, CRM, finance, campaigns, AI, mobile, and more.", date: "2026-03-29", category: "feature" },
  ];
}

// Item 293: Changelog
export function getChangelog(): Array<{ week: string; entries: Array<{ title: string; type: string }> }> {
  return [
    {
      week: "March 24-29, 2026",
      entries: [
        { title: "Agent execution capabilities for all 10 agents", type: "feature" },
        { title: "15 automated reaction chains", type: "feature" },
        { title: "Memory-first confidence cascade", type: "improvement" },
        { title: "Decision outcome tracking with check-in dates", type: "feature" },
        { title: "Company stage detection and adaptive briefing", type: "feature" },
        { title: "300 elite improvements across 16 domains", type: "feature" },
      ],
    },
  ];
}

// getPublicRoadmap deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

// Item 291: Page feedback
export async function submitPageFeedback(orgId: number, page: string, helpful: boolean, suggestion?: string) {
  const { userFeedback } = await import("@shared/schema");
  await db.insert(userFeedback).values({ userId: String(orgId), orgId, page, feedback: helpful ? (suggestion || "helpful") : (suggestion || "not helpful") });
}

// Item 298: Case study data
export async function gatherCaseStudyData(dealId: number, orgId: number) {
  const { deals, properties } = await import("@shared/schema");
  const deal = await db.query.deals.findFirst({ where: and(eq(deals.id, dealId), eq(deals.organizationId, orgId)) });
  if (!deal) return null;
  // deals carries no location/acreage columns; those live on the linked property.
  const property = deal.propertyId
    ? await db.query.properties.findFirst({ where: eq(properties.id, deal.propertyId) })
    : null;
  return {
    county: property?.county ?? null,
    state: property?.state ?? null,
    acreage: property?.sizeAcres ?? null,
    // WAS `=== "closed_won"` — not a deal status, so every deal read as
    // "in progress" regardless of outcome.
    strategy: (CLOSED_DEAL_STATUSES as readonly string[]).includes(deal.status ?? "")
      ? "successful acquisition"
      : "in progress",
  };
}
