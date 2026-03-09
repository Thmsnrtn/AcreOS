/**
 * T94 — Beta Program Service
 *
 * Manages the AcreOS beta waitlist and beta user cohorts.
 * Features:
 *   - Waitlist signup with referral tracking
 *   - Beta user activation with cohort assignment
 *   - Feature flag management per cohort
 *   - Beta feedback collection
 *   - Waitlist position tracking
 *
 * Exposed via:
 *   POST /api/beta/waitlist          — public signup
 *   GET  /api/beta/waitlist          — admin list
 *   POST /api/beta/activate/:email   — activate a waitlist entry
 *   GET  /api/beta/cohorts           — list cohorts
 *   POST /api/beta/feedback          — submit feedback
 */

import { db } from "../db";
import { eq, and, desc, count, sql } from "drizzle-orm";

// ─── In-memory store (replace with DB tables in production) ────────────────

interface WaitlistEntry {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  useCase?: string;
  referralCode?: string;
  referredBy?: string;
  position: number;
  status: "waiting" | "invited" | "active" | "declined";
  cohort?: string;
  activatedAt?: Date;
  createdAt: Date;
  score: number; // priority score based on use case + referrals
}

interface BetaCohort {
  id: string;
  name: string;
  description: string;
  features: string[]; // feature flags enabled for this cohort
  maxSize: number;
  currentSize: number;
  createdAt: Date;
}

interface BetaFeedback {
  id: number;
  email: string;
  type: "bug" | "feature_request" | "general" | "nps";
  rating?: number; // 1-10 for NPS
  message: string;
  feature?: string;
  createdAt: Date;
}

// In-memory stores (would be DB tables in full production)
let waitlistEntries: WaitlistEntry[] = [];
let betaCohorts: BetaCohort[] = [
  {
    id: "early_adopters",
    name: "Early Adopters",
    description: "First 100 beta users with full feature access",
    features: ["marketplace", "ai_negotiation", "portfolio_optimizer", "deal_hunter", "vision_ai"],
    maxSize: 100,
    currentSize: 0,
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "power_users",
    name: "Power Users",
    description: "Active investors testing advanced AI features",
    features: ["marketplace", "ai_negotiation", "portfolio_optimizer", "deal_hunter", "vision_ai", "regulatory_intel", "voice_ai"],
    maxSize: 50,
    currentSize: 0,
    createdAt: new Date("2026-01-15"),
  },
  {
    id: "standard",
    name: "Standard Beta",
    description: "General beta access with core features",
    features: ["marketplace", "deal_hunter"],
    maxSize: 500,
    currentSize: 0,
    createdAt: new Date("2026-02-01"),
  },
];
let betaFeedback: BetaFeedback[] = [];
let nextWaitlistId = 1;
let nextFeedbackId = 1;

function scoreEntry(entry: Partial<WaitlistEntry>): number {
  let score = 0;
  if (entry.useCase?.toLowerCase().includes("invest")) score += 20;
  if (entry.company) score += 10;
  if (entry.referredBy) score += 15;
  if (entry.useCase && entry.useCase.length > 50) score += 5;
  return score;
}

export const betaProgramService = {
  /**
   * Add someone to the waitlist.
   */
  async joinWaitlist(data: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    useCase?: string;
    referralCode?: string;
    referredBy?: string;
  }): Promise<{ position: number; referralCode: string; message: string }> {
    // Check if already on waitlist
    const existing = waitlistEntries.find(e => e.email.toLowerCase() === data.email.toLowerCase());
    if (existing) {
      return {
        position: existing.position,
        referralCode: `ACRE-${existing.id.toString().padStart(5, "0")}`,
        message: "You're already on the waitlist!",
      };
    }

    const entry: WaitlistEntry = {
      id: nextWaitlistId++,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      company: data.company,
      useCase: data.useCase,
      referralCode: data.referralCode,
      referredBy: data.referredBy,
      position: waitlistEntries.filter(e => e.status === "waiting").length + 1,
      status: "waiting",
      createdAt: new Date(),
      score: scoreEntry(data),
    };

    waitlistEntries.push(entry);

    return {
      position: entry.position,
      referralCode: `ACRE-${entry.id.toString().padStart(5, "0")}`,
      message: `You're #${entry.position} on the waitlist. Share your referral code to move up!`,
    };
  },

  /**
   * Get paginated waitlist (admin only).
   */
  async getWaitlist(opts: { page?: number; limit?: number; status?: string } = {}): Promise<{
    entries: WaitlistEntry[];
    total: number;
    waiting: number;
    invited: number;
    active: number;
  }> {
    const { page = 1, limit = 50, status } = opts;
    let filtered = status ? waitlistEntries.filter(e => e.status === status) : waitlistEntries;
    filtered = [...filtered].sort((a, b) => b.score - a.score || a.position - b.position);

    return {
      entries: filtered.slice((page - 1) * limit, page * limit),
      total: waitlistEntries.length,
      waiting: waitlistEntries.filter(e => e.status === "waiting").length,
      invited: waitlistEntries.filter(e => e.status === "invited").length,
      active: waitlistEntries.filter(e => e.status === "active").length,
    };
  },

  /**
   * Invite a waitlist entry to beta.
   */
  async inviteUser(email: string, cohortId?: string): Promise<{ success: boolean; message: string }> {
    const entry = waitlistEntries.find(e => e.email.toLowerCase() === email.toLowerCase());
    if (!entry) {
      return { success: false, message: "Email not found on waitlist" };
    }

    const cohort = cohortId
      ? betaCohorts.find(c => c.id === cohortId)
      : betaCohorts.find(c => c.currentSize < c.maxSize);

    if (!cohort) {
      return { success: false, message: "No available cohort with capacity" };
    }

    entry.status = "invited";
    entry.cohort = cohort.id;
    cohort.currentSize++;

    return {
      success: true,
      message: `${email} has been invited to the ${cohort.name} cohort`,
    };
  },

  /**
   * Activate a beta user (after they accept their invite).
   */
  async activateUser(email: string): Promise<{ success: boolean; features: string[] }> {
    const entry = waitlistEntries.find(e => e.email.toLowerCase() === email.toLowerCase());
    if (!entry || entry.status !== "invited") {
      return { success: false, features: [] };
    }

    entry.status = "active";
    entry.activatedAt = new Date();

    const cohort = betaCohorts.find(c => c.id === entry.cohort);
    return {
      success: true,
      features: cohort?.features ?? [],
    };
  },

  /**
   * Get all cohorts and their stats.
   */
  getCohorts(): BetaCohort[] {
    return betaCohorts.map(c => ({
      ...c,
      currentSize: waitlistEntries.filter(e => e.cohort === c.id && e.status === "active").length,
    }));
  },

  /**
   * Submit beta feedback.
   */
  async submitFeedback(data: {
    email: string;
    type: BetaFeedback["type"];
    rating?: number;
    message: string;
    feature?: string;
  }): Promise<{ id: number }> {
    const feedback: BetaFeedback = {
      id: nextFeedbackId++,
      email: data.email,
      type: data.type,
      rating: data.rating,
      message: data.message,
      feature: data.feature,
      createdAt: new Date(),
    };
    betaFeedback.push(feedback);
    return { id: feedback.id };
  },

  /**
   * Get all beta feedback (admin only).
   */
  getFeedback(opts: { type?: string } = {}): BetaFeedback[] {
    const { type } = opts;
    return type ? betaFeedback.filter(f => f.type === type) : betaFeedback;
  },

  /**
   * Get waitlist stats summary.
   */
  getStats() {
    const total = waitlistEntries.length;
    const waiting = waitlistEntries.filter(e => e.status === "waiting").length;
    const invited = waitlistEntries.filter(e => e.status === "invited").length;
    const active = waitlistEntries.filter(e => e.status === "active").length;
    const avgScore = total > 0 ? waitlistEntries.reduce((s, e) => s + e.score, 0) / total : 0;
    const npsScores = betaFeedback.filter(f => f.type === "nps" && f.rating != null);
    const avgNPS = npsScores.length > 0
      ? npsScores.reduce((s, f) => s + (f.rating ?? 0), 0) / npsScores.length
      : null;

    return { total, waiting, invited, active, avgScore, avgNPS, feedbackCount: betaFeedback.length };
  },

  /**
   * Check if a referral code is valid and get referring user.
   */
  validateReferralCode(code: string): { valid: boolean; referrer?: string } {
    const id = parseInt(code.replace("ACRE-", ""), 10);
    const entry = waitlistEntries.find(e => e.id === id);
    if (!entry) return { valid: false };
    return { valid: true, referrer: entry.email };
  },
};
