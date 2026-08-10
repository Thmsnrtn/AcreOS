/**
 * G1.2 — Public read-only demo workspace.
 *
 * A composition of EXISTING machinery, not a new auth path:
 *
 *   - The demo organization is DESIGNATED, never invented: `DEMO_ORG_ID`
 *     names an org row that founder/ops created in the target environment.
 *     When the env var is unset or the row is missing, every endpoint
 *     reports an honest `{ provisioned: false, reason }` — the client
 *     renders "demo not provisioned"; a fake org is never fabricated.
 *   - Fixtures come from the ONE sample-data path (sampleSeeder.ts), so
 *     every demo row carries the sample markers (lead.source "sample_data",
 *     "SAMPLE-" apns). That makes the G1.1 activation recorder guard hold
 *     automatically: demo entities can never light the founder funnel.
 *   - `org.settings.simulationMode` is enforced on entry, so anything that
 *     ever fires against the demo org (jobs, workflows) lands in
 *     `simulated_actions`, never a provider (server/utils/simulationMode.ts).
 *     The org must already be on the free tier — provisioning REFUSES
 *     (never silently edits billing) when it isn't.
 *   - The demo session is a short-lived httpOnly cookie granting the
 *     semantics of the `viewer` team role (read-only across the CRM,
 *     shared/schema.ts team_members): the only data surface is the GET
 *     workspace snapshot below, and `demoSessionReadOnlyGuard` (mounted
 *     app-wide in routes.ts) refuses EVERY mutating /api request from a
 *     demo session with 403 — the session never enters the authed
 *     permission stack at all. The cookie carries no secret because it
 *     grants nothing beyond public sample fixtures.
 *
 * Endpoints:
 *   GET  /api/demo/status     — provisioned? (pure read, no side effects)
 *   POST /api/demo/session    — enter: ensure org ready (idempotent seed +
 *                               simulationMode), set the session cookie
 *   GET  /api/demo/workspace  — sample-marked snapshot (demo session only)
 *   POST /api/demo/exit       — clear the session cookie (so a demo visitor
 *                               can sign up without tripping the guard)
 *
 * Production seeding/rotation of the demo org ROW is a founder/ops action
 * (needs the prod DB); this module is the mechanism that makes a designated
 * row safe and self-seeding.
 */

import type { Express, NextFunction, Request, Response } from "express";

import { storage } from "./storage";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { isOrgSimulated } from "./utils/simulationMode";
import {
  seedSampleDataForOrg,
  SAMPLE_APN_PREFIX,
  SAMPLE_LEAD_SOURCE,
} from "./services/onboarding/sampleSeeder";
import { BUSINESS_TYPES } from "@shared/business-types";
import { isBusinessType } from "@shared/models/persona-mapping";
import type { Organization } from "@shared/schema";

export const DEMO_SESSION_COOKIE = "acreos_demo_session";
export const DEMO_ORG_ENV = "DEMO_ORG_ID";

/**
 * Demo-session lifecycle endpoints the read-only guard must not block, plus
 * the anonymous marketing-touch beacon: it is append-only, unauthenticated,
 * rate-limited ingest — and blocking it would silence page_view/CTA touches
 * from EVERY page the visitor opens for the cookie's 2h life, darkening the
 * acquisition funnel for exactly the visitors the demo exists to convert.
 */
export const DEMO_GUARD_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  "/api/demo/session",
  "/api/demo/exit",
  "/api/marketing/touch",
]);

const DEMO_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h — short-lived on purpose
const WORKSPACE_ROW_CAP = 50;

// ───────────────────────────────────────────────────────────────────────────
// Session helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * True when the request carries the demo-session cookie. Reads req.cookies
 * (cookie-parser is mounted globally in server/index.ts) with a raw-header
 * fallback so the guard cannot be disarmed by middleware-order drift.
 */
export function isDemoSession(req: Request): boolean {
  const parsed = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (parsed && typeof parsed === "object") {
    if (parsed[DEMO_SESSION_COOKIE]) return true;
  }
  const raw = req.headers?.cookie;
  return typeof raw === "string" && raw.includes(`${DEMO_SESSION_COOKIE}=`);
}

/**
 * App-wide guard: every mutating /api request from a demo session is refused.
 * Mounted in routes.ts BEFORE any router so no route can precede it. GETs
 * pass through untouched — the demo session holds no auth, so authed GETs
 * still 401 on their own middleware; this guard only guarantees the
 * read-only half of the viewer contract can never be bypassed.
 */
export function demoSessionReadOnlyGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  // Lowercase before matching: Express routes match case-insensitively by
  // default, so /API/leads would otherwise slip past a case-sensitive guard
  // while still reaching the route.
  const path = req.path.toLowerCase();
  if (!path.startsWith("/api")) return next();
  if (!isDemoSession(req)) return next();
  if (DEMO_GUARD_EXEMPT_PATHS.has(path)) return next();
  logger.info("[demo] blocked mutating request from demo session", {
    source: "routes-demo",
    metadata: { method: req.method, path: req.path },
  });
  Errors.forbidden(
    res,
    "The demo is read-only. Exit the demo and start a free workspace to make changes.",
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Demo-org resolution + readiness
// ───────────────────────────────────────────────────────────────────────────

export type DemoOrgResolution =
  | { provisioned: false; reason: "not_configured" | "org_not_found" | "demo_org_not_free_tier" }
  | { provisioned: true; org: Organization };

function demoOrgIdFromEnv(): number | null {
  const raw = (process.env[DEMO_ORG_ENV] || "").trim();
  if (!raw) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Resolve the designated demo org. Pure read — never creates anything. */
export async function resolveDemoOrg(): Promise<DemoOrgResolution> {
  const id = demoOrgIdFromEnv();
  if (id == null) return { provisioned: false, reason: "not_configured" };
  const org = await storage.getOrganization(id);
  if (!org) {
    logger.warn("[demo] DEMO_ORG_ID set but org row not found — demo stays unprovisioned", {
      source: "routes-demo",
      metadata: { demoOrgId: id },
    });
    return { provisioned: false, reason: "org_not_found" };
  }
  return { provisioned: true, org };
}

function demoVertical(org: Organization): { vertical: string; verticalLabel: string } {
  const bt = (org.onboardingData as { businessType?: string } | null)?.businessType;
  const vertical = isBusinessType(bt) ? bt : "land_flipper";
  return { vertical, verticalLabel: BUSINESS_TYPES[vertical].label };
}

/**
 * Make the designated demo org safe + populated. Idempotent:
 *   1. REFUSE (don't silently edit billing) unless the org is free-tier.
 *   2. Enforce settings.simulationMode = true so nothing real can ever send.
 *   3. Seed the org's vertical fixtures via the one sample-data path
 *      (seedSampleDataForOrg no-ops when markers already exist).
 */
export async function ensureDemoOrgReady(org: Organization): Promise<DemoOrgResolution> {
  if (org.subscriptionTier !== "free") {
    logger.warn("[demo] designated demo org is not free-tier — refusing to provision", {
      source: "routes-demo",
      metadata: { orgId: org.id, subscriptionTier: org.subscriptionTier },
    });
    return { provisioned: false, reason: "demo_org_not_free_tier" };
  }

  let current = org;
  if (!isOrgSimulated(current)) {
    // simulationMode is the org-level kill-switch simulationMode.ts reads
    // (org.settings.simulationMode). It isn't in the settings $type union
    // yet, so widen locally — same shape isOrgSimulated consumes.
    const settings = {
      ...((current.settings as Record<string, unknown> | null) ?? {}),
      simulationMode: true,
    };
    current = await storage.updateOrganization(current.id, {
      settings: settings as Organization["settings"],
    });
    logger.info("[demo] enforced simulationMode on demo org", {
      source: "routes-demo",
      metadata: { orgId: current.id },
    });
  }

  const { vertical } = demoVertical(current);
  await seedSampleDataForOrg(String(current.id), vertical);
  return { provisioned: true, org: current };
}

// ───────────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────────

export function registerDemoRoutes(app: Express): void {
  // Provision state — pure read, cacheable, safe for the public page.
  app.get("/api/demo/status", async (_req, res) => {
    try {
      const resolved = await resolveDemoOrg();
      if (!resolved.provisioned) {
        return res.json({ provisioned: false, reason: resolved.reason });
      }
      const { vertical, verticalLabel } = demoVertical(resolved.org);
      return res.json({ provisioned: true, vertical, verticalLabel });
    } catch (err) {
      logger.error("[demo] status failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  // Enter the demo: ensure the designated org is ready, mint the cookie.
  app.post("/api/demo/session", async (_req, res) => {
    try {
      const resolved = await resolveDemoOrg();
      if (!resolved.provisioned) {
        return res.json({ provisioned: false, reason: resolved.reason });
      }
      const ready = await ensureDemoOrgReady(resolved.org);
      if (!ready.provisioned) {
        return res.json({ provisioned: false, reason: ready.reason });
      }
      const { vertical, verticalLabel } = demoVertical(ready.org);
      // No secret in the cookie: it unlocks only the sample-fixture snapshot
      // below and additionally RESTRICTS the bearer (read-only guard).
      res.cookie(DEMO_SESSION_COOKIE, "viewer", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: DEMO_SESSION_MAX_AGE_MS,
        path: "/",
      });
      return res.json({ provisioned: true, role: "viewer", readOnly: true, vertical, verticalLabel });
    } catch (err) {
      logger.error("[demo] session create failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  // Read-only snapshot. Serves ONLY sample-marked rows — even a
  // misconfigured DEMO_ORG_ID pointing at a real org can never leak real
  // customer rows through this surface.
  app.get("/api/demo/workspace", async (req, res) => {
    try {
      if (!isDemoSession(req)) {
        return Errors.forbidden(res, "Open the demo from /demo first.");
      }
      const resolved = await resolveDemoOrg();
      if (!resolved.provisioned) {
        return Errors.notFound(res, "Demo workspace");
      }
      const org = resolved.org;
      const { vertical, verticalLabel } = demoVertical(org);

      const [allLeads, allProperties, allDeals, allNotes] = await Promise.all([
        storage.getLeads(org.id),
        storage.getProperties(org.id),
        storage.getDeals(org.id),
        storage.getNotes(org.id),
      ]);

      const leads = allLeads.filter((l) => l.source === SAMPLE_LEAD_SOURCE);
      const properties = allProperties.filter(
        (p) => typeof p.apn === "string" && p.apn.startsWith(SAMPLE_APN_PREFIX),
      );
      // Deals/notes carry no marker column — by the seeder's contract they
      // attach to sample properties (or carry "Sample" free-text). Filter on
      // exactly that convention.
      const samplePropertyIds = new Set(properties.map((p) => p.id));
      const deals = allDeals.filter(
        (d) =>
          (d.propertyId != null && samplePropertyIds.has(d.propertyId)) ||
          (typeof d.notes === "string" && d.notes.startsWith("Sample")),
      );
      const notes = allNotes.filter(
        (n) => n.propertyId != null && samplePropertyIds.has(n.propertyId),
      );

      return res.json({
        org: {
          name: org.name,
          vertical,
          verticalLabel,
          simulated: isOrgSimulated(org),
        },
        role: "viewer" as const,
        readOnly: true as const,
        counts: {
          leads: leads.length,
          properties: properties.length,
          deals: deals.length,
          notes: notes.length,
        },
        leads: leads.slice(0, WORKSPACE_ROW_CAP).map((l) => ({
          id: l.id,
          name: `${l.firstName} ${l.lastName}`.trim(),
          status: l.status,
          city: l.city ?? "",
          state: l.state ?? "",
        })),
        properties: properties.slice(0, WORKSPACE_ROW_CAP).map((p) => ({
          id: p.id,
          apn: p.apn,
          county: p.county ?? "",
          state: p.state ?? "",
          status: p.status ?? "",
          sizeAcres: p.sizeAcres ?? "",
        })),
        deals: deals.slice(0, WORKSPACE_ROW_CAP).map((d) => ({
          id: d.id,
          type: d.type ?? "",
          status: d.status ?? "",
          offerAmount: d.offerAmount ?? "",
        })),
        notes: notes.slice(0, WORKSPACE_ROW_CAP).map((n) => ({
          id: n.id,
          status: n.status ?? "",
          currentBalance: n.currentBalance ?? "",
          monthlyPayment: n.monthlyPayment ?? "",
        })),
      });
    } catch (err) {
      logger.error("[demo] workspace failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  // Leave the demo — clears the cookie so signup mutations aren't guarded.
  app.post("/api/demo/exit", (_req, res) => {
    res.clearCookie(DEMO_SESSION_COOKIE, { path: "/" });
    return res.json({ ok: true });
  });
}
