/**
 * Signup trim (W1.4), server side: the flag read, the refusal every
 * business-type writer calls, and the waitlist capture.
 *
 * The rule itself is pure and lives in shared/business-types/signupTrim.ts so
 * the client picker and these writers cannot disagree.
 *
 * WAITLIST HOME: the founder's existing feedback inbox (`feedback_submissions`,
 * read at /founder/feedback). No new table. A capture is a `feature_request`
 * row whose `source` is `signup_waitlist:<type>`, written with the signed-in
 * user's id and email, so the founder can see who asked for what and reply.
 * Nothing here notifies the customer automatically: telling them a type has
 * opened is a founder action on that inbox.
 */

import type { Response } from "express";
import { and, eq } from "drizzle-orm";
import { feedbackSubmissions } from "@shared/schema";
import {
  SIGNUP_TRIM_FLAG_KEY,
  SIGNUP_OPEN_BUSINESS_TYPES,
  decideSignupBusinessType,
  signupTrimFlagVerdict,
  signupWaitlistSource,
  type SignupTrimDecision,
} from "@shared/business-types/signupTrim";
import { BUSINESS_TYPES as BUSINESS_TYPE_REGISTRY } from "@shared/business-types";
import type { BusinessType } from "@shared/models/persona-mapping";
import { db } from "../db";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";
import type { AuthenticatedRequest } from "../types/request";
import { featureFlagService } from "./featureFlags";

/** Trim ON? A missing flag row is ON (the default); only an explicit non-`on` state turns it off. */
export async function isSignupTrimOn(): Promise<boolean> {
  const flag = await featureFlagService.getByKey(SIGNUP_TRIM_FLAG_KEY);
  return signupTrimFlagVerdict(flag ? flag.state : null);
}

function labelOf(type: BusinessType): string {
  return BUSINESS_TYPE_REGISTRY[type]?.label ?? type;
}

/**
 * Every writer of an org's business type calls this before writing.
 * Returns true after answering 422 (the caller must `return`); false to proceed.
 *
 *   if (await refuseClosedSignupType(req, res, requested, "complete")) return;
 */
export async function refuseClosedSignupType(
  req: AuthenticatedRequest,
  res: Response,
  requested: unknown,
  via: string,
): Promise<boolean> {
  const org = req.organization;
  const stored = (org?.onboardingData as Record<string, unknown> | null | undefined)?.businessType;
  const base = {
    requested: typeof requested === "string" ? requested : null,
    stored: typeof stored === "string" ? stored : null,
    orgOnboarded: org?.onboardingCompleted === true,
    isFounder: req.isFounder === true,
  };
  // Decide with the trim assumed ON first: the common cases (an open type, a
  // founder, an onboarded org) never need the flag read.
  const provisional: SignupTrimDecision = decideSignupBusinessType({ ...base, flagOn: true });
  if (provisional.allowed) return false;
  if (!(await isSignupTrimOn())) return false;

  const label = labelOf(provisional.requested);
  logger.info("[signup-trim] refused a business type that is not open to new signups", {
    metadata: { organizationId: org?.id, businessType: provisional.requested, via },
  });
  Errors.unprocessable(
    res,
    `${label} isn't open for new signups yet. Pick ${SIGNUP_OPEN_BUSINESS_TYPES.map(labelOf).join(", ")}, or join the waitlist and we'll tell you when ${label} opens.`,
    {
      reason: "business_type_not_open",
      requested: provisional.requested,
      open: provisional.open,
      waitlistPath: "/api/onboarding/waitlist",
    },
  );
  return true;
}

export interface SignupWaitlistCapture {
  userId: string;
  email: string | null;
  name: string | null;
  organizationId: number;
  type: BusinessType;
}

/**
 * Record interest in a not-yet-open type. Idempotent per (user, type): asking
 * twice returns the first row. Throws on a database failure so the route can
 * answer honestly instead of claiming a capture that did not happen.
 */
export async function recordSignupWaitlist(
  c: SignupWaitlistCapture,
): Promise<{ status: "recorded" | "already_recorded"; id: number }> {
  const source = signupWaitlistSource(c.type);
  const [existing] = await db
    .select({ id: feedbackSubmissions.id })
    .from(feedbackSubmissions)
    .where(and(eq(feedbackSubmissions.userId, c.userId), eq(feedbackSubmissions.source, source)))
    .limit(1);
  if (existing) return { status: "already_recorded", id: existing.id };

  const [row] = await db
    .insert(feedbackSubmissions)
    .values({
      category: "feature_request",
      userId: c.userId,
      userEmail: c.email,
      email: c.email,
      name: c.name,
      source,
      allowFollowUp: true,
      message: `Signup waitlist: asked to be told when ${labelOf(c.type)} (${c.type}) opens. Workspace #${c.organizationId}.`,
    })
    .returning({ id: feedbackSubmissions.id });
  return { status: "recorded", id: row.id };
}
