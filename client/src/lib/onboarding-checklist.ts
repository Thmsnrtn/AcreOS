/**
 * Vertical-aware getting-started checklist — factory + pure helpers.
 *
 * Onboarding rebuild (2026-07-29 audit): the old checklist keyed on the
 * 3-value `organizations.investorType` fork ("land" | "notes" | "both"),
 * which collapsed all 15 declared business types into three generic lists —
 * a tax-lien operator saw "send your first mailer", a landlord saw nothing
 * about properties. This module re-keys the checklist on
 * `organizations.onboardingData.businessType` (the 15-value taxonomy from
 * shared/business-types.ts + shared/models/persona-mapping.ts) so each
 * vertical sees ITS first wins in ITS vocabulary — from ONE config, no
 * 15-way component fork.
 *
 * HONESTY RULE (constitution: refuse-not-fabricate): every item names a
 * `signal` — a real completion flag computed server-side by
 * GET /api/onboarding/checklist-status from actual org rows (leads,
 * imports, campaigns/mail shipments, deals, payments, enriched parcels,
 * BYOK credentials). An item may NEVER show complete unless its signal is
 * true, and steps with no cheap real signal are DROPPED, not faked:
 *   - land_flipper "set your buy-box"          — no buy-box signal → dropped
 *   - tax_lien_deed "set county auction watch" — no watch signal   → dropped
 *   - buy_and_hold "add a tenant"              — tenants live in the rental
 *     schema with no checklist signal          → dropped
 *   - note_investor "connect your servicer"    — folded into the optional
 *     connect-services item (hasConnectedService / BYOK), never blocking.
 *
 * DIET (bundle diet Candidate 1): the COPY — every vertical's step rows
 * (title/description pairs + optional href/icon overrides) and the
 * connect-services nudge copy — lives in
 * client/src/data/onboarding-checklist-data.ts (the source of truth) and
 * reaches the browser as the served asset /onboarding-checklist.json via
 * the shared static-data loader, so it no longer rides inside the bundle.
 * What stays HERE, in code, is everything the copy is bound to: STEP_BASE
 * (id → signal + Lucide icon + default door), the step() factory that
 * rehydrates data rows into ChecklistItemDefs, and the pure progress /
 * visibility helpers. Signals and icons never travel in the data.
 * tests/unit/onboardingChecklist.test.ts pins the builders against the
 * source module; tests/unit/staticDataServedAsData.test.ts pins the
 * served asset deep-equal to the module.
 */
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Building2,
  Handshake,
  MapPin,
  Megaphone,
  Plug,
  Upload,
  Users,
} from "lucide-react";
import { BUSINESS_TYPE_IDS, type BusinessTypeId } from "@shared/business-types";
import type {
  ChecklistStepBaseId,
  ChecklistStepRow,
  OnboardingChecklistData,
} from "@/data/onboarding-checklist-data";

export type {
  ChecklistStepBaseId,
  ChecklistStepRow,
  OnboardingChecklistData,
};

/** Shape of GET /api/onboarding/checklist-status — the ONLY completion sources. */
export interface ChecklistStatus {
  hasLead: boolean;
  hasImport: boolean;
  hasCampaign: boolean;
  hasDeal: boolean;
  hasNotePayment: boolean;
  hasPropertyLookup: boolean;
  hasConnectedService: boolean;
}

export type ChecklistSignal = keyof ChecklistStatus;

/** Canonical signal list (kept in sync with server/routes-onboarding.ts). */
export const CHECKLIST_SIGNALS: readonly ChecklistSignal[] = [
  "hasLead",
  "hasImport",
  "hasCampaign",
  "hasDeal",
  "hasNotePayment",
  "hasPropertyLookup",
  "hasConnectedService",
];

export interface ChecklistItemDef {
  id: string;
  /** Real completion source on /api/onboarding/checklist-status. */
  signal: ChecklistSignal;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  /**
   * Optional items (the connect-services nudge) render like any item but
   * never count toward progress or block auto-dismiss — value before
   * friction (R5 reshape, preserved).
   */
  optional?: boolean;
}

// ─── Step factory ──────────────────────────────────────────────────────────
// Each base step binds an id to its honest signal + icon + default door.
// Verticals re-title them in their own vocabulary; the signal never changes.

type StepBaseId = ChecklistStepBaseId;

const STEP_BASE: Record<
  StepBaseId,
  Pick<ChecklistItemDef, "id" | "signal" | "icon" | "href">
> = {
  propertyLookup: { id: "propertyLookup", signal: "hasPropertyLookup", icon: MapPin, href: "/maps" },
  lead: { id: "lead", signal: "hasLead", icon: Users, href: "/leads" },
  import: { id: "import", signal: "hasImport", icon: Upload, href: "/leads" },
  campaign: { id: "campaign", signal: "hasCampaign", icon: Megaphone, href: "/campaigns" },
  deal: { id: "deal", signal: "hasDeal", icon: Handshake, href: "/deals" },
  notePayment: { id: "notePayment", signal: "hasNotePayment", icon: Banknote, href: "/finance" },
};

function step(
  base: StepBaseId,
  title: string,
  description: string,
  overrides?: Partial<Pick<ChecklistItemDef, "href" | "icon">>,
): ChecklistItemDef {
  return { ...STEP_BASE[base], title, description, ...overrides };
}

// Row icon overrides, resolved in code: a data row names a key here, never
// a component (the landlord family's property step wears Building2 instead
// of the propertyLookup base's MapPin).
const ROW_ICONS: Record<string, LucideIcon> = {
  building2: Building2,
};

/** Rehydrate one served data row through the factory. */
function stepFromRow(row: ChecklistStepRow): ChecklistItemDef {
  const overrides: Partial<Pick<ChecklistItemDef, "href" | "icon">> = {};
  if (row.href !== undefined) overrides.href = row.href;
  if (row.iconKey !== undefined && ROW_ICONS[row.iconKey]) {
    overrides.icon = ROW_ICONS[row.iconKey];
  }
  return step(row.base, row.title, row.description, overrides);
}

// ─── Builders over the served data ─────────────────────────────────────────

/**
 * The optional connect-your-services nudge (R5 reshape) — appended after
 * every vertical's required steps. Completes via hasConnectedService (any
 * non-revoked BYOK credential); excluded from progress + auto-dismiss math.
 * Its wiring (id/signal/icon/door/optional) stays in code; only its copy
 * comes from the data.
 */
export function buildConnectServicesItem(
  data: OnboardingChecklistData,
): ChecklistItemDef {
  return {
    id: "connectServices",
    signal: "hasConnectedService",
    title: data.connectServices.title,
    description: data.connectServices.description,
    icon: Plug,
    href: "/settings/byok",
    optional: true,
  };
}

/** Every vertical's required steps, rehydrated from the served rows. */
export function buildChecklistsByBusinessType(
  data: OnboardingChecklistData,
): Record<BusinessTypeId, ChecklistItemDef[]> {
  const out = {} as Record<BusinessTypeId, ChecklistItemDef[]>;
  for (const bt of BUSINESS_TYPE_IDS) {
    out[bt] = data.checklists[bt].map(stepFromRow);
  }
  return out;
}

/** The vertical's required steps plus the optional connect-services nudge. */
export function getChecklistItems(
  data: OnboardingChecklistData,
  businessType: BusinessTypeId,
): ChecklistItemDef[] {
  return [
    ...data.checklists[businessType].map(stepFromRow),
    buildConnectServicesItem(data),
  ];
}

// ─── Loaded-shape guard ────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isStr = (value: unknown): value is string => typeof value === "string";

const STEP_BASE_IDS: ReadonlySet<string> = new Set(Object.keys(STEP_BASE));

function isStepRow(value: unknown): value is ChecklistStepRow {
  if (!isRecord(value)) return false;
  if (!isStr(value.base) || !STEP_BASE_IDS.has(value.base)) return false;
  if (!isStr(value.title) || value.title.length === 0) return false;
  if (!isStr(value.description) || value.description.length === 0) return false;
  if (value.href !== undefined && !isStr(value.href)) return false;
  // An iconKey the code cannot resolve would silently swap the step's icon
  // for the base's — treat it as a shape failure, never a quiet fallback.
  if (
    value.iconKey !== undefined &&
    (!isStr(value.iconKey) || !(value.iconKey in ROW_ICONS))
  ) {
    return false;
  }
  return true;
}

/**
 * Shape guard for the SERVED checklist data, checked at the loader
 * boundary before any builder runs. The asset is fetched at runtime, so
 * a 200 response is not proof of shape: a mis-served fallback body
 * (`{}`, an error page parsed as JSON, a truncated or edited asset)
 * must be treated as a LOAD FAILURE — the component renders its shell
 * with a visible failure line — never handed to the builders above,
 * which dereference `data.checklists[…]` and would crash the render
 * (white screen) or mis-title a step on a wrong-shape payload. Valid
 * means: the connect-services copy is well-formed and EVERY registered
 * business type has a non-empty list of well-formed rows whose base
 * names a real step and whose icon override (if any) resolves in code.
 */
export function isOnboardingChecklistData(
  value: unknown,
): value is OnboardingChecklistData {
  if (!isRecord(value)) return false;
  const { connectServices, checklists } = value;
  if (
    !isRecord(connectServices) ||
    !isStr(connectServices.title) ||
    !isStr(connectServices.description)
  ) {
    return false;
  }
  if (!isRecord(checklists)) return false;
  return BUSINESS_TYPE_IDS.every((bt) => {
    const rows = checklists[bt];
    return Array.isArray(rows) && rows.length > 0 && rows.every(isStepRow);
  });
}

// ─── Resolution + progress helpers (pure) ──────────────────────────────────

const VALID_BUSINESS_TYPES: ReadonlySet<string> = new Set(BUSINESS_TYPE_IDS);

/**
 * Resolve which vertical's checklist to show. Prefers the org's declared
 * `onboardingData.businessType`; orgs that predate the 15-type taxonomy (or
 * skipped the wizard before picking one) fall back through the coarse
 * investorType fork to a representative type — never to an empty list.
 */
export function resolveChecklistBusinessType(
  businessType: string | null | undefined,
  investorType: string | null | undefined,
): BusinessTypeId {
  if (businessType && VALID_BUSINESS_TYPES.has(businessType)) {
    return businessType as BusinessTypeId;
  }
  if (investorType === "notes") return "note_investor";
  if (investorType === "both") return "hybrid";
  return "land_flipper";
}

/**
 * An item is complete ONLY when its real signal is true. No status yet
 * (query loading / failed) → nothing is complete. Never fabricate progress.
 */
export function isItemComplete(
  item: ChecklistItemDef,
  status: ChecklistStatus | undefined,
): boolean {
  return status ? status[item.signal] === true : false;
}

export interface ChecklistProgress {
  completedCount: number;
  requiredCount: number;
  progressPct: number;
  /** All REQUIRED items complete — optional items never block this. */
  allComplete: boolean;
}

export function computeChecklistProgress(
  items: ChecklistItemDef[],
  status: ChecklistStatus | undefined,
): ChecklistProgress {
  const required = items.filter((item) => !item.optional);
  const completedCount = required.filter((item) => isItemComplete(item, status)).length;
  const requiredCount = required.length;
  return {
    completedCount,
    requiredCount,
    progressPct: requiredCount > 0 ? (completedCount / requiredCount) * 100 : 0,
    allComplete: requiredCount > 0 && completedCount === requiredCount,
  };
}

/**
 * Checklist visibility — DELIBERATELY independent of empty-state, hasAnyData,
 * onboardingCompleted, and onboardingData.skipped (2026-07-29 audit fixes #1
 * and #4): a user with data still sees their remaining steps, and a user who
 * skipped the wizard gets the checklist as their gentle path in. It hides
 * only when the org dismissed it, when every required step is genuinely
 * done, or while real completion state hasn't loaded yet (never render
 * unverified checkboxes).
 */
export function shouldShowChecklist(input: {
  dismissed: boolean;
  statusLoaded: boolean;
  allComplete: boolean;
}): boolean {
  return !input.dismissed && input.statusLoaded && !input.allComplete;
}
