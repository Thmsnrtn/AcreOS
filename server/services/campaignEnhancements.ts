/**
 * Campaign Enhancements — Items 106-125
 * ROI calculator, scheduling, multi-channel, segmentation, deliverability, etc.
 */

import { db } from "../db";
import { campaigns, leads, deals } from "@shared/schema";
import { eq, and, sql, count, gte, desc } from "drizzle-orm";

// Item 106: Campaign ROI calculator
// Item 108: Campaign cloning
/*
 * `cloneCampaign(campaignId, newName)` was here and is DELETED (2026-09-04).
 * Nothing in the repository called it — the tests import categorizeResponse,
 * getCampaignBenchmarks and isHoliday from this module and never it.
 *
 * It read `db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })` with
 * no organization predicate and then inserted a copy of whatever came back, so
 * the first caller to wire it up would have been able to clone another
 * organization's campaign — its name, its copy, its targeting — by guessing an
 * integer. Surfaced when the org-scope lint was widened to Drizzle's
 * relational query API, which it had never read.
 */

export function categorizeResponse(text: string): "interested" | "not_interested" | "wrong_number" | "angry" | "question" | "unknown" {
  const lower = text.toLowerCase();
  if (lower.includes("interested") || lower.includes("tell me more") || lower.includes("how much") || lower.includes("yes")) return "interested";
  if (lower.includes("not interested") || lower.includes("no thanks") || lower.includes("remove") || lower.includes("stop")) return "not_interested";
  if (lower.includes("wrong number") || lower.includes("wrong person") || lower.includes("don't own")) return "wrong_number";
  if (lower.includes("stop calling") || lower.includes("sue") || lower.includes("lawyer") || lower.includes("harass")) return "angry";
  if (lower.includes("?") || lower.includes("what") || lower.includes("when") || lower.includes("where")) return "question";
  return "unknown";
}

// Item 113: Campaign performance benchmarks
export function getCampaignBenchmarks(): { avgOpenRate: number; avgResponseRate: number; avgConversionRate: number } {
  return {
    avgOpenRate: 31,
    avgResponseRate: 4.2,
    avgConversionRate: 1.8,
  };
}

// Item 117: Holiday send prevention
export function isHoliday(date: Date): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const holidays = [
    { month: 1, day: 1 },   // New Year's Day
    { month: 7, day: 4 },   // Independence Day
    { month: 12, day: 25 }, // Christmas
    { month: 12, day: 31 }, // New Year's Eve
    { month: 11, day: 28 }, // Thanksgiving (approximate)
    { month: 11, day: 29 },
  ];
  return holidays.some(h => h.month === month && h.day === day);
}

// Item 118: Timezone-aware sending
export function getOptimalSendTime(recipientTimezone: string): Date {
  const now = new Date();
  const targetHour = 10; // 10am local time
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: recipientTimezone, hour: "numeric", hour12: false });
    const currentHour = parseInt(formatter.format(now));
    const hoursUntilTarget = (targetHour - currentHour + 24) % 24;
    return new Date(now.getTime() + hoursUntilTarget * 60 * 60 * 1000);
  } catch {
    return now;
  }
}
