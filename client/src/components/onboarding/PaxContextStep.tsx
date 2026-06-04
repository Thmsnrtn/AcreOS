/**
 * PAX CONTEXT STEP — Phase D1 customer-surface onboarding step.
 *
 * Captures the five fields the server-side userContext service stores:
 *   1. vertical             (single-select, 6 options + skip)
 *   2. experience level     (single-select, 3 levels)
 *   3. investment goals     (multi-select, 1-3 of 6)
 *   4. geographic focus     (free text, optional)
 *   5. displayed name       (free text, optional)
 *
 * Visual + interaction patterns MIRROR the existing onboarding wizard
 * (client/src/components/onboarding/OnboardingWizard.tsx) — same
 * `ob-field`, `ob-label`, `ob-cards`, `ob-card`, `ob-input`, `ob-hint`
 * class tokens, same RadioGroup ↔ label-as-card pattern. We do NOT modify
 * the wizard in this dispatch; mirroring keeps insertion straightforward.
 *
 * ── INTEGRATION POINT (deferred — wizard is read-only this wave) ────────
 *
 * Solene wires this into OnboardingWizard.tsx in a follow-up commit. The
 * suggested insertion is AFTER the business-type step and BEFORE the
 * lead-import step. Pattern from the existing wizard:
 *
 *   case <stepIndex>:
 *     return <PaxContextStep
 *       defaultDisplayedName={clerkUser?.firstName ?? ""}
 *       onSubmit={(payload) => handlePaxContextSubmit(payload)}
 *       onSkip={() => goToNextStep()}
 *     />;
 *
 * The POST endpoint at /api/onboarding/pax-context does NOT exist yet —
 * server/routes.ts is frozen this wave. Solene adds the route in a
 * follow-up that calls `captureUserContext({...})` from
 * server/services/pax/userContext.ts.
 *
 * ── A11Y ─────────────────────────────────────────────────────────────────
 *  - Each group is a <fieldset> + <legend>.
 *  - Radio + checkbox groups support arrow-key navigation (RadioGroup
 *    does this natively; the checkbox group uses native semantics).
 *  - Submit / loading / error states announce via aria-live="polite".
 *  - Every touch target is ≥ 44×44 (the .ob-card minimum height plus our
 *    explicit min-height on field controls).
 *  - Light + dark theme handled by the design-token CSS classes.
 */

import * as React from "react";
import { useState, useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Map,
  Home,
  FileText,
  Building2,
  Truck,
  Sparkles,
  HelpCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import "./onboarding.css";

// ── Local types (mirror the server-side enum surface in
//    @shared/schema/pax-verticals.ts so this file stays compilable while
//    sibling D1-B finishes). When D1-B lands we should switch to
//    `import { PAX_VERTICALS, ... } from "@shared/schema/pax-verticals"`. ─

type Vertical =
  | "land_investing"
  | "single_family_rentals"
  | "notes"
  | "multi_family"
  | "mobile_homes"
  | "wholesaling";

type ExperienceLevel = "beginner" | "intermediate" | "expert";

type InvestmentGoal =
  | "cash_flow"
  | "appreciation"
  | "passive_income"
  | "value_add"
  | "tax_advantages"
  | "learning";

// Sentinel value for the "Multiple / I'm not sure yet" option — the form
// state uses this so RadioGroup has a stable string value; we strip it
// before submit so the server stores NULL (no opinion).
const SKIP_VERTICAL = "__skip__";
type VerticalChoice = Vertical | typeof SKIP_VERTICAL;

interface VerticalOption {
  value: VerticalChoice;
  label: string;
  description: string;
  icon: LucideIcon;
}

const VERTICAL_OPTIONS: VerticalOption[] = [
  {
    value: "land_investing",
    label: "Land Investing",
    description: "Raw parcels — buy, hold, flip, or owner-finance.",
    icon: Map,
  },
  {
    value: "single_family_rentals",
    label: "Single-Family Rentals",
    description: "Buy-and-hold houses for monthly cash flow.",
    icon: Home,
  },
  {
    value: "notes",
    label: "Notes (owner-financed)",
    description: "Mortgage notes and seller-financed paper.",
    icon: FileText,
  },
  {
    value: "multi_family",
    label: "Multi-Family",
    description: "Duplexes, apartments, and value-add projects.",
    icon: Building2,
  },
  {
    value: "mobile_homes",
    label: "Mobile Homes / Parks",
    description: "Pads, parks, and infill plays.",
    icon: Truck,
  },
  {
    value: "wholesaling",
    label: "Wholesaling",
    description: "Assignments and quick-flip contracts.",
    icon: Sparkles,
  },
  {
    value: SKIP_VERTICAL,
    label: "Multiple / I'm not sure yet",
    description: "Pax will use sensible defaults.",
    icon: HelpCircle,
  },
];

interface ExperienceOption {
  value: ExperienceLevel;
  label: string;
  description: string;
}

const EXPERIENCE_OPTIONS: ExperienceOption[] = [
  {
    value: "beginner",
    label: "Beginner",
    description: "Fewer than 3 deals closed.",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    description: "3 to 20 deals closed.",
  },
  {
    value: "expert",
    label: "Expert",
    description: "More than 20 deals closed.",
  },
];

interface GoalOption {
  value: InvestmentGoal;
  label: string;
  description: string;
}

const GOAL_OPTIONS: GoalOption[] = [
  { value: "cash_flow", label: "Cash flow", description: "Monthly income now." },
  {
    value: "appreciation",
    label: "Appreciation",
    description: "Long-term value growth.",
  },
  {
    value: "passive_income",
    label: "Passive income",
    description: "Hands-off returns.",
  },
  {
    value: "value_add",
    label: "Value-add",
    description: "Improve to increase value.",
  },
  {
    value: "tax_advantages",
    label: "Tax advantages",
    description: "Depreciation, 1031, etc.",
  },
  {
    value: "learning",
    label: "Learning",
    description: "Still exploring.",
  },
];

const MAX_GOALS = 3;

// Submit payload — mirrors CaptureContextInput on the server.
export interface PaxContextSubmitPayload {
  vertical: Vertical | null;
  experienceLevel: ExperienceLevel | null;
  investmentGoals: InvestmentGoal[];
  geographicFocus: string | null;
  displayedName: string | null;
}

export interface PaxContextStepProps {
  /** Clerk first-name (or empty string) — pre-fills the displayed-name field. */
  defaultDisplayedName?: string;
  /** Called when the user submits. Returns whatever the parent wants done next. */
  onSubmit: (payload: PaxContextSubmitPayload) => void | Promise<void>;
  /** Optional skip handler — only rendered when provided. */
  onSkip?: () => void;
  /** Whether the parent considers the submit in-flight (drives loading state). */
  isSubmitting?: boolean;
  /** Error string (server-side or network) to surface to the user. */
  submitError?: string | null;
}

export function PaxContextStep({
  defaultDisplayedName = "",
  onSubmit,
  onSkip,
  isSubmitting = false,
  submitError = null,
}: PaxContextStepProps) {
  const [vertical, setVertical] = useState<VerticalChoice>("land_investing");
  const [experienceLevel, setExperienceLevel] =
    useState<ExperienceLevel | "">("");
  const [goals, setGoals] = useState<Set<InvestmentGoal>>(new Set());
  const [geographicFocus, setGeographicFocus] = useState("");
  const [displayedName, setDisplayedName] = useState(defaultDisplayedName);

  // Internal submitting flag — used when the parent doesn't pass one in.
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const effectiveSubmitting = isSubmitting || localSubmitting;

  // Stable ids for label/aria-describedby plumbing across re-renders.
  const verticalLegendId = useId();
  const experienceLegendId = useId();
  const goalsLegendId = useId();
  const goalsHintId = useId();
  const geoInputId = useId();
  const nameInputId = useId();
  const statusId = useId();

  const goalsList = Array.from(goals);
  const goalsValid = goalsList.length === 0 || goalsList.length <= MAX_GOALS;
  // experienceLevel is optional from the data-model angle (server accepts
  // null) but we encourage picking — the submit button stays enabled either
  // way; first-pass UX bias is to NOT block the user.
  const canSubmit = goalsValid && !effectiveSubmitting;

  const toggleGoal = (g: InvestmentGoal) => {
    setGoals((prev) => {
      const next = new Set(prev);
      if (next.has(g)) {
        next.delete(g);
      } else if (next.size < MAX_GOALS) {
        next.add(g);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const payload: PaxContextSubmitPayload = {
      vertical: vertical === SKIP_VERTICAL ? null : vertical,
      experienceLevel: experienceLevel === "" ? null : experienceLevel,
      investmentGoals: goalsList,
      geographicFocus: geographicFocus.trim().length > 0 ? geographicFocus.trim() : null,
      displayedName: displayedName.trim().length > 0 ? displayedName.trim() : null,
    };
    try {
      setLocalSubmitting(true);
      await onSubmit(payload);
    } finally {
      setLocalSubmitting(false);
    }
  };

  return (
    <form className="ob-step" onSubmit={handleSubmit} noValidate>
      <header className="ob-step-header">
        <h2 className="ob-step-title">Tailor Pax to you</h2>
        <p className="ob-step-subtitle">
          Pax is your AI partner inside AcreOS. A few quick questions so it
          speaks your language and frames advice against your goals.
        </p>
      </header>

      {/* ── 1. Vertical ─────────────────────────────────────────────── */}
      <fieldset className="ob-field" aria-labelledby={verticalLegendId}>
        <legend id={verticalLegendId} className="ob-label">
          Which kind of real-estate investing best describes your focus today?
        </legend>
        <RadioGroup
          value={vertical}
          onValueChange={(v) => setVertical(v as VerticalChoice)}
          className="ob-cards"
        >
          {VERTICAL_OPTIONS.map(({ value, label, description, icon: Icon }) => (
            <label
              key={value}
              htmlFor={`pax-vertical-${value}`}
              className={`ob-card ${vertical === value ? "is-on" : ""}`}
              data-testid={`option-pax-vertical-${value}`}
              style={{ minHeight: 44 }}
            >
              <RadioGroupItem
                value={value}
                id={`pax-vertical-${value}`}
                className="sr-only"
              />
              <span className="ob-card-glyph">
                <Icon className="w-4 h-4" aria-hidden="true" />
              </span>
              <span className="ob-card-title">{label}</span>
              <span className="ob-card-desc">{description}</span>
            </label>
          ))}
        </RadioGroup>
        <p className="ob-hint">
          Land Investing is what AcreOS ships best today. Other verticals
          work — we tune Pax for the ones you pick.
        </p>
      </fieldset>

      {/* ── 2. Experience level ─────────────────────────────────────── */}
      <fieldset className="ob-field" aria-labelledby={experienceLegendId}>
        <legend id={experienceLegendId} className="ob-label">
          How experienced are you?
        </legend>
        <RadioGroup
          value={experienceLevel}
          onValueChange={(v) => setExperienceLevel(v as ExperienceLevel)}
          className="ob-cards"
        >
          {EXPERIENCE_OPTIONS.map(({ value, label, description }) => (
            <label
              key={value}
              htmlFor={`pax-exp-${value}`}
              className={`ob-card ${experienceLevel === value ? "is-on" : ""}`}
              data-testid={`option-pax-experience-${value}`}
              style={{ minHeight: 44 }}
            >
              <RadioGroupItem
                value={value}
                id={`pax-exp-${value}`}
                className="sr-only"
              />
              <span className="ob-card-title">{label}</span>
              <span className="ob-card-desc">{description}</span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      {/* ── 3. Investment goals (multi-select, 1-3) ─────────────────── */}
      <fieldset
        className="ob-field"
        aria-labelledby={goalsLegendId}
        aria-describedby={goalsHintId}
      >
        <legend id={goalsLegendId} className="ob-label">
          What are you optimizing for?
        </legend>
        <p id={goalsHintId} className="ob-hint" style={{ marginTop: 0, marginBottom: 8 }}>
          Pick up to {MAX_GOALS}. Pax frames recommendations against these.
        </p>
        <div className="ob-cards" role="group">
          {GOAL_OPTIONS.map(({ value, label, description }) => {
            const checked = goals.has(value);
            const disabled = !checked && goals.size >= MAX_GOALS;
            const checkboxId = `pax-goal-${value}`;
            return (
              <label
                key={value}
                htmlFor={checkboxId}
                className={`ob-card ${checked ? "is-on" : ""}`}
                data-testid={`option-pax-goal-${value}`}
                style={{
                  minHeight: 44,
                  opacity: disabled ? 0.5 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                <Checkbox
                  id={checkboxId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => toggleGoal(value)}
                  aria-label={label}
                  className="sr-only"
                />
                <span className="ob-card-title">{label}</span>
                <span className="ob-card-desc">{description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ── 4. Geographic focus (free text, optional) ───────────────── */}
      <div className="ob-field">
        <label htmlFor={geoInputId} className="ob-label">
          Where do you focus?{" "}
          <span className="ob-hint" style={{ display: "inline" }}>
            (optional)
          </span>
        </label>
        <Input
          id={geoInputId}
          className="ob-input"
          value={geographicFocus}
          onChange={(e) => setGeographicFocus(e.target.value)}
          placeholder="e.g. Texas Hill Country, Southeast US, Florida Panhandle"
          maxLength={200}
          data-testid="input-pax-geographic-focus"
          style={{ minHeight: 44 }}
        />
      </div>

      {/* ── 5. Displayed name (free text, optional) ─────────────────── */}
      <div className="ob-field">
        <label htmlFor={nameInputId} className="ob-label">
          What should Pax call you?{" "}
          <span className="ob-hint" style={{ display: "inline" }}>
            (optional)
          </span>
        </label>
        <Input
          id={nameInputId}
          className="ob-input"
          value={displayedName}
          onChange={(e) => setDisplayedName(e.target.value)}
          placeholder={defaultDisplayedName || "Your first name"}
          maxLength={80}
          data-testid="input-pax-displayed-name"
          style={{ minHeight: 44 }}
        />
      </div>

      {/* ── Privacy footer ──────────────────────────────────────────── */}
      <p className="ob-hint" style={{ marginTop: 16, marginBottom: 16 }}>
        We use this to make Pax's answers more relevant to you. You can opt out
        in Settings anytime. Pax never shares this with other users.
      </p>

      {/* ── Status region (loading / error) ─────────────────────────── */}
      <div
        id={statusId}
        role="status"
        aria-live="polite"
        style={{ minHeight: 20, marginBottom: 8 }}
      >
        {effectiveSubmitting ? "Saving your context…" : null}
        {!effectiveSubmitting && submitError ? (
          <span style={{ color: "var(--acr-danger, #c53030)" }}>{submitError}</span>
        ) : null}
      </div>

      {/* ── Submit row ──────────────────────────────────────────────── */}
      <div
        className="ob-actions"
        style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
      >
        {onSkip ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            disabled={effectiveSubmitting}
            data-testid="button-pax-skip"
            style={{ minHeight: 44, minWidth: 44 }}
          >
            Skip for now
          </Button>
        ) : null}
        <Button
          type="submit"
          disabled={!canSubmit}
          aria-describedby={statusId}
          data-testid="button-pax-submit"
          style={{ minHeight: 44, minWidth: 44 }}
        >
          {effectiveSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            "Continue"
          )}
        </Button>
      </div>
    </form>
  );
}

export default PaxContextStep;

/**
 * ── INTEGRATION TODO (deferred — server/routes.ts FROZEN this wave) ──
 *
 *   1. Add route handler in server/routes.ts:
 *
 *      router.post(
 *        "/api/onboarding/pax-context",
 *        requireAuth,
 *        async (req: AuthenticatedRequest, res) => {
 *          const userId = getUserId(req);
 *          const organizationId = String(getOrganizationId(req));
 *          const result = await captureUserContext({
 *            userId,
 *            organizationId,
 *            vertical: req.body?.vertical ?? undefined,
 *            experienceLevel: req.body?.experienceLevel ?? undefined,
 *            investmentGoals: req.body?.investmentGoals ?? undefined,
 *            geographicFocus: req.body?.geographicFocus ?? undefined,
 *            displayedName: req.body?.displayedName ?? undefined,
 *          });
 *          if (!result) return Errors.internal(res, new Error("capture failed"));
 *          res.json({ ok: true });
 *        },
 *      );
 *
 *   2. Wire this component into client/src/components/onboarding/
 *      OnboardingWizard.tsx as a new step between the business-type and
 *      lead-import steps. The wizard's existing `apiRequest` mutation
 *      pattern handles the POST.
 *
 *   3. Add Settings → Privacy → "Personalize Pax" toggle that calls
 *      setPersonalizationOptOut(userId, !checked).
 */
