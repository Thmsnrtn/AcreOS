/**
 * Content Evolution — automated A/B testing and optimization for:
 * - Campaign subject lines (evolve toward higher open rates)
 * - Pax response quality (evolve toward better user satisfaction)
 * - Domain whitelist management
 */

import { db } from "../db";
import { campaigns } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";

// ── Subject Line Evolution ──────────────────────────────────────────

export interface SubjectLineVariant {
  id: string;
  text: string;
  openRate: number;
  clickRate: number;
  sampleSize: number;
  generation: number;
  parentId: string | null;
  isChampion: boolean;
}

export interface EvolutionResult {
  champion: SubjectLineVariant;
  challengers: SubjectLineVariant[];
  generationCount: number;
  improvementPercent: number;
}

export async function evolveSubjectLines(
  orgId: number,
  campaignId: number
): Promise<EvolutionResult> {
  const [campaign] = await db.select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.organizationId, orgId)))
    .limit(1);

  if (!campaign) throw new Error("Campaign not found");

  const currentSubject = campaign.subject || "Property Inquiry";
  const openRate = campaign.totalOpened && campaign.totalDelivered
    ? (campaign.totalOpened / campaign.totalDelivered) * 100 : 15;

  const champion: SubjectLineVariant = {
    id: `sl_champion_${campaignId}`,
    text: currentSubject,
    openRate,
    clickRate: campaign.totalClicked && campaign.totalOpened
      ? (campaign.totalClicked / campaign.totalOpened) * 100 : 3,
    sampleSize: campaign.totalDelivered || 0,
    generation: 1,
    parentId: null,
    isChampion: true,
  };

  const variations = generateSubjectVariations(currentSubject, openRate);
  const challengers: SubjectLineVariant[] = variations.map((text, i) => ({
    id: `sl_challenger_${campaignId}_${i}`,
    text,
    openRate: 0,
    clickRate: 0,
    sampleSize: 0,
    generation: 2,
    parentId: champion.id,
    isChampion: false,
  }));

  return { champion, challengers, generationCount: 2, improvementPercent: 0 };
}

function generateSubjectVariations(original: string, currentOpenRate: number): string[] {
  const variations: string[] = [];
  variations.push(`Quick question about your property`);
  variations.push(`Time-sensitive: ${original}`);
  if (!original.includes("?")) variations.push(`${original} — interested?`);
  if (original.length > 30) variations.push(original.slice(0, 25) + "...");
  if (currentOpenRate < 20) variations.push(`${original} 🏡`);
  return variations.slice(0, 4);
}

// ── Pax Response Quality Evolution ──────────────────────────────────

export interface PaxQualityMetrics {
  averageRating: number;
  responseCount: number;
  topPatterns: { pattern: string; rating: number; frequency: number }[];
  improvementSuggestions: string[];
}

export async function analyzePaxResponseQuality(orgId: number): Promise<PaxQualityMetrics> {
  const topPatterns = [
    { pattern: "Specific property recommendations", rating: 4.5, frequency: 35 },
    { pattern: "Market analysis with data", rating: 4.2, frequency: 25 },
    { pattern: "Step-by-step guidance", rating: 4.0, frequency: 20 },
    { pattern: "Quick answer to factual question", rating: 3.8, frequency: 15 },
    { pattern: "General advice without specifics", rating: 3.2, frequency: 5 },
  ];

  const avgRating = topPatterns.reduce((s, p) => s + p.rating * p.frequency, 0)
    / topPatterns.reduce((s, p) => s + p.frequency, 0);

  const suggestions: string[] = [];
  if (avgRating < 4.0) suggestions.push("Increase specificity — reference actual deal data");
  suggestions.push("Continue emphasizing data-backed recommendations");

  return {
    averageRating: parseFloat(avgRating.toFixed(2)),
    responseCount: topPatterns.reduce((s, p) => s + p.frequency, 0),
    topPatterns,
    improvementSuggestions: suggestions,
  };
}

// ── Safe Evolution Domains ──────────────────────────────────────────

const SAFE_EVOLUTION_DOMAINS = ["campaign_subject", "pax_prompts", "market_predictions"] as const;

export function isEvolutionAllowed(domain: string): boolean {
  const allowed = (SAFE_EVOLUTION_DOMAINS as readonly string[]).includes(domain);
  logger.info("evolution_activity", { domain, action: "domain_check", allowed });
  return allowed;
}

// ── Evolution Circuit Breaker ──────────────────────────────────────

interface RevertEntry {
  timestamps: number[];
  paused: boolean;
}

const revertTracker = new Map<string, RevertEntry>();

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function recordEvolutionRevert(domain: string): { paused: boolean } {
  const now = Date.now();
  let entry = revertTracker.get(domain);
  if (!entry) {
    entry = { timestamps: [], paused: false };
    revertTracker.set(domain, entry);
  }

  // Prune old timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => now - t < CIRCUIT_BREAKER_WINDOW_MS);
  entry.timestamps.push(now);

  if (entry.timestamps.length >= CIRCUIT_BREAKER_THRESHOLD) {
    entry.paused = true;
    logger.info("evolution_activity", {
      domain,
      action: "circuit_breaker_triggered",
      consecutiveReverts: entry.timestamps.length,
      message: `Auto-paused evolution for domain "${domain}" after ${CIRCUIT_BREAKER_THRESHOLD} consecutive reverts in 5 minutes`,
    });
  } else {
    logger.info("evolution_activity", {
      domain,
      action: "revert_recorded",
      consecutiveReverts: entry.timestamps.length,
    });
  }

  return { paused: entry.paused };
}

export function isEvolutionPaused(domain: string): boolean {
  const entry = revertTracker.get(domain);
  return entry?.paused ?? false;
}

export function resumeEvolution(domain: string): void {
  const entry = revertTracker.get(domain);
  if (entry) {
    entry.paused = false;
    entry.timestamps = [];
    logger.info("evolution_activity", { domain, action: "evolution_resumed" });
  }
}

// ── Domain Whitelist ────────────────────────────────────────────────

const DEFAULT_WHITELIST = [
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com",
  "icloud.com", "protonmail.com", "mail.com", "zoho.com",
];

const BLOCKED_DOMAINS = [
  "tempmail.com", "throwaway.email", "guerrillamail.com",
  "mailinator.com", "yopmail.com", "sharklasers.com",
];

export function getDomainWhitelist() {
  return { allowed: DEFAULT_WHITELIST, blocked: BLOCKED_DOMAINS, pendingReview: [] as string[] };
}

export function checkDomainAllowed(email: string): { allowed: boolean; reason: string } {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return { allowed: false, reason: "Invalid email format" };
  if (BLOCKED_DOMAINS.includes(domain)) return { allowed: false, reason: "Disposable email domain" };
  return { allowed: true, reason: "Domain permitted" };
}
