/**
 * Per-vertical onboarding config — founder ruling #12(b).
 *
 * Single data-driven config that gives every one of the 15 registry
 * verticals (shared/business-types.ts) a TAILORED onboarding: the
 * wizard's data-step copy, the vertical's pipeline vocabulary, and the
 * finishing destination all come from ONE map, no 15-way component
 * fork. The DATA lives in client/src/data/onboarding-verticals-data.ts
 * (the source of truth) and reaches the browser as the served asset
 * /onboarding-verticals.json via the shared static-data loader — the
 * BD-6 / diet pattern, so the copy no longer rides inside the bundle.
 * The selectors below are the old module's pure functions, unchanged
 * in semantics, taking the loaded data as their first argument (the
 * selectCampaignTemplates discipline); tests/unit/
 * onboardingVerticals.test.ts pins them against the source module
 * (all 15 ids covered, every finish path is a real registered route,
 * prefill never silently flips a vertical back to the land_flipper
 * default), and tests/unit/staticDataServedAsData.test.ts pins the
 * served asset deep-equal to the module.
 */
import {
  BUSINESS_TYPES,
  isBusinessType,
  type BusinessType,
  type NoteRole,
} from "@shared/models/persona-mapping";
import type {
  NoteRoleDataOverride,
  OnboardingVerticalsData,
  VerticalFinish,
  VerticalOnboardingCopy,
} from "@/data/onboarding-verticals-data";

export type {
  NoteRoleDataOverride,
  OnboardingVerticalsData,
  VerticalFinish,
  VerticalOnboardingCopy,
};

// ---------------------------------------------------------------------------
// Pure selectors over the served data
// ---------------------------------------------------------------------------

/** Config for a (possibly unknown) businessType; falls back to land_flipper. */
export function getVerticalOnboarding(
  data: OnboardingVerticalsData,
  businessType: string | null | undefined,
): VerticalOnboardingCopy {
  if (isBusinessType(businessType)) {
    return data.verticals[businessType];
  }
  return data.verticals.land_flipper;
}

/**
 * Data-step copy for the current selection: the vertical's own copy, with the
 * note-role override applied for the note vertical. `jobLabel`/`jobHref` are
 * null when the vertical has no dedicated first-job link.
 */
export function getDataStepCopy(
  data: OnboardingVerticalsData,
  businessType: string | null | undefined,
  noteRole: NoteRole,
): {
  dataTitle: [string, string];
  dataSub: string;
  jobLabel: string | null;
  jobHref: string | null;
} {
  if (businessType === "note_investor") {
    const o = data.noteRoleOverrides[noteRole] ?? data.noteRoleOverrides.invest;
    return {
      dataTitle: o.dataTitle,
      dataSub: o.dataSub,
      jobLabel: o.jobLabel,
      jobHref: o.jobHref,
    };
  }
  const v = getVerticalOnboarding(data, businessType);
  return { dataTitle: v.dataTitle, dataSub: v.dataSub, jobLabel: null, jobHref: null };
}

const NOTE_ROLES: readonly NoteRole[] = ["invest", "originate", "service"];

// ---------------------------------------------------------------------------
// Loaded-shape guard (D-2)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isStr = (value: unknown): value is string => typeof value === "string";

function isStringPair(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every(isStr);
}

function isVerticalCopy(value: unknown): value is VerticalOnboardingCopy {
  if (!isRecord(value) || !isRecord(value.finish)) return false;
  const finish = value.finish;
  return (
    isStr(value.noun) &&
    isStringPair(value.dataTitle) &&
    isStr(value.dataSub) &&
    isStr(finish.path) &&
    isStr(finish.cta) &&
    isStr(finish.blurb)
  );
}

function isNoteRoleOverride(value: unknown): value is NoteRoleDataOverride {
  return (
    isRecord(value) &&
    isStringPair(value.dataTitle) &&
    isStr(value.dataSub) &&
    isStr(value.jobLabel) &&
    isStr(value.jobHref)
  );
}

/**
 * Shape guard for the SERVED onboarding data, checked at the loader
 * boundary before any selector runs. The asset is fetched at runtime,
 * so a 200 response is not proof of shape: a mis-served fallback body
 * (`{}`, an error page parsed as JSON, a truncated or edited asset)
 * must be treated as a LOAD FAILURE — the wizard renders its visible
 * load-error — never handed to the selectors above, which dereference
 * `data.verticals[…]` / `data.noteRoleOverrides[…]` and would crash
 * the render (white screen) on a wrong-shape payload. Valid means:
 * both registries are plain objects, EVERY registered business type
 * has a well-formed copy entry, and every note role has a well-formed
 * override (the selectors fall back to `noteRoleOverrides.invest`).
 */
export function isOnboardingVerticalsData(
  value: unknown,
): value is OnboardingVerticalsData {
  if (!isRecord(value)) return false;
  const { verticals, noteRoleOverrides } = value;
  if (!isRecord(verticals) || !isRecord(noteRoleOverrides)) return false;
  return (
    BUSINESS_TYPES.every((t) => isVerticalCopy(verticals[t])) &&
    NOTE_ROLES.every((r) => isNoteRoleOverride(noteRoleOverrides[r]))
  );
}

export interface WizardPrefill {
  /** Valid stored businessType, or null (= no prefill; wizard keeps its default). */
  businessType: BusinessType | null;
  /** Valid stored noteRole, or null. */
  noteRole: NoteRole | null;
}

/**
 * Prefill for a re-run: reads the org's stored onboardingData (as returned by
 * GET /api/onboarding/status → data). After POST /api/onboarding/reset the
 * server PRESERVES businessType/noteRole, so a re-run starts from the org's
 * CURRENT type. Anything missing or unrecognized yields null — the wizard
 * only applies non-null values, so a re-run can never silently flip the org
 * back to the land_flipper default.
 */
export function resolveWizardPrefill(data: unknown): WizardPrefill {
  const d = (data ?? {}) as Record<string, unknown>;
  const bt = typeof d.businessType === "string" ? d.businessType : null;
  const role = typeof d.noteRole === "string" ? d.noteRole : null;
  return {
    businessType: isBusinessType(bt) ? bt : null,
    noteRole: role && (NOTE_ROLES as readonly string[]).includes(role) ? (role as NoteRole) : null,
  };
}
