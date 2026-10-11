/**
 * Owner opt-out and deletion requests (W5a).
 *
 * PUBLIC (no sign-in; mounted with the public routes, ahead of the /api auth
 * gate, rate-limited per IP):
 *   POST /api/public/owner-optout          — submit a request
 *   POST /api/public/owner-optout/verify   — confirm with the emailed token / mailed code
 *   GET  /api/public/owner-optout/:ref     — status by reference (no personal data)
 *
 * The founder half (Decisions door → Owner requests, including the erasure
 * hard stop) is server/routes-founder-owner-optout.ts, mounted below the
 * founder MFA gate.
 */
import type { Express, Response, Request } from "express";
import { z } from "zod";
import { Errors } from "./utils/errors";
import { createRateLimiter } from "./middleware/rateLimit";
import { publicOwnerOptOutStatus, publicStatusOf, submitOwnerOptOut, verifyOwnerOptOut } from "./services/trust/ownerOptOut";

const submitLimiter = createRateLimiter({ maxRequests: 5, windowMs: 60 * 60 * 1000 });
const verifyLimiter = createRateLimiter({ maxRequests: 20, windowMs: 60 * 60 * 1000 });
const statusLimiter = createRateLimiter({ maxRequests: 60, windowMs: 60 * 1000 });

const optional = (max: number) => z.string().trim().max(max).optional().nullable();

export const ownerOptOutSubmitSchema = z
  .object({
    email: optional(254),
    phone: optional(32),
    addressLine1: optional(200),
    city: optional(100),
    state: optional(2),
    zip: optional(10),
    residenceState: optional(2),
    wantsDeletion: z.boolean().default(true),
    verification: z.enum(["email", "mail_code"]),
  })
  .strict();

export function registerPublicOwnerOptOutRoutes(app: Express): void {
  app.post("/api/public/owner-optout", submitLimiter, async (req: Request, res: Response) => {
    const parsed = ownerOptOutSubmitSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const result = await submitOwnerOptOut(parsed.data);
      if (!result.ok) return Errors.badRequest(res, result.reason);
      return res.json({
        ref: result.ref,
        dueAt: result.dueAt.toISOString(),
        verification: result.verification,
        emailed: result.emailed,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/public/owner-optout/verify", verifyLimiter, async (req: Request, res: Response) => {
    const parsed = z
      .object({ ref: z.string().trim().min(8).max(64), secret: z.string().trim().min(4).max(128) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const result = await verifyOwnerOptOut(parsed.data.ref, parsed.data.secret);
      if (!result.ok) return Errors.badRequest(res, result.reason);
      // Never the internal status: "completed" vs "verified" says whether any org held a match.
      return res.json({ status: publicOwnerOptOutStatus(result.status) });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/public/owner-optout/:ref", statusLimiter, async (req: Request, res: Response) => {
    const ref = String(req.params.ref ?? "").slice(0, 64);
    try {
      const status = await publicStatusOf(ref);
      if (!status) return Errors.notFound(res, "Request");
      return res.json(status);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
