/**
 * EmptyState — canonical primitive for all empty surfaces.
 *
 * Constitution: every empty state is an agency moment, not an absence moment.
 * The required `cta` prop enforces this structurally: TypeScript rejects any
 * consumer that fails to provide a purposeful next action.
 *
 * If a CTA genuinely cannot exist (read-only view, system-generated state),
 * add a `// TODO(cta): <reason>` comment at the call site and use the
 * `cta` "no-op" escape hatch: `cta={{ label: "", _noOp: true }}`.
 *
 * Variant wrappers (FirstHelloEmpty, ClearedEmpty, EmptyFilter, surface-specific
 * states) in `empty-states/` compose this primitive — they are the right import
 * for known surfaces. Use this primitive directly only for novel or ad-hoc surfaces.
 */

import { type LucideIcon, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// CTA shape
// ---------------------------------------------------------------------------

export interface EmptyStateCta {
  /** Button label text. Required. */
  label: string;
  /** Click handler. Mutually exclusive with `href`. */
  onClick?: () => void;
  /** Navigate to URL. Mutually exclusive with `onClick`. */
  href?: string;
  /** Test selector. */
  "data-testid"?: string;
  /**
   * Escape hatch for genuinely CTA-less states (read-only panels, system-generated
   * states where no user action is available). Setting this suppresses the button.
   * ALWAYS accompany with a `// TODO(cta):` comment explaining the absence.
   *
   * @example
   * // TODO(cta): founder-only trace view — no user action available
   * cta={{ label: "", _noOp: true }}
   */
  _noOp?: boolean;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  /** Lucide icon component (preferred) or any React node. */
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
  /** Primary headline — required, keep to one clause. */
  headline: string;
  /** Supporting sentence. */
  subtitle?: string;
  /**
   * Primary CTA — REQUIRED.
   * This is structural enforcement of the "purposeful CTA" constitution.
   * Every empty state must answer: "what should the user do right now?"
   */
  cta: EmptyStateCta;
  /** Optional secondary CTA rendered as an outline button. */
  secondaryCta?: EmptyStateCta;
  /**
   * Tone modifies the icon container color and overall mood.
   * - `default`     — neutral muted (most empty states)
   * - `celebratory` — positive/success (cleared queues, milestones)
   * - `warning`     — caution (overdue, at-risk)
   */
  tone?: "default" | "celebratory" | "warning";
  /** Bullet tips rendered below the subtitle. */
  tips?: string[];
  /** External learn-more link. */
  learnMoreUrl?: string;
  /** Label for the learn-more link. Defaults to "Learn more". */
  learnMoreLabel?: string;
  /**
   * Icon rendered inside the primary CTA button.
   * Defaults to `Plus` when `cta.onClick` is set and no icon is provided.
   * Pass `null` to suppress the icon (for non-create actions like "Connect").
   */
  actionIcon?: LucideIcon | null;
  className?: string;
  /** Root element data-testid. Defaults to "empty-state". */
  testId?: string;
}

// ---------------------------------------------------------------------------
// Tone styles
// ---------------------------------------------------------------------------

const toneIconContainer: Record<NonNullable<EmptyStateProps["tone"]>, string> = {
  default: "bg-muted/60",
  celebratory: "bg-acr-pos-soft/60",
  warning: "bg-acr-warn-soft/60",
};

const toneIconColor: Record<NonNullable<EmptyStateProps["tone"]>, string> = {
  default: "text-muted-foreground",
  celebratory: "text-acr-pos",
  warning: "text-acr-warn",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon,
  headline,
  subtitle,
  cta,
  secondaryCta,
  tone = "default",
  tips,
  learnMoreUrl,
  learnMoreLabel = "Learn more",
  actionIcon,
  className = "",
  testId = "empty-state",
}: EmptyStateProps) {
  // Resolve the action button icon. Default: Plus for create flows.
  // Caller passes `actionIcon={null}` to suppress.
  const ActionIcon = actionIcon === null ? null : (actionIcon ?? (cta.onClick ? Plus : null));

  const renderCtaButton = (ctaProp: EmptyStateCta, variant: "default" | "outline", testIdSuffix: string) => {
    if (ctaProp._noOp || !ctaProp.label) return null;
    if (ctaProp.href) {
      return (
        <a
          href={ctaProp.href}
          aria-label={ctaProp.label}
          data-testid={ctaProp["data-testid"] ?? testIdSuffix}
          className="inline-flex items-center gap-2"
        >
          <Button asChild variant={variant} type="button">
            <span>
              {variant === "default" && ActionIcon && (
                <ActionIcon className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              {ctaProp.label}
            </span>
          </Button>
        </a>
      );
    }
    return (
      <Button
        type="button"
        variant={variant}
        onClick={ctaProp.onClick}
        aria-label={ctaProp.label}
        data-testid={ctaProp["data-testid"] ?? testIdSuffix}
      >
        {variant === "default" && ActionIcon && (
          <ActionIcon className="w-4 h-4 mr-2" aria-hidden="true" />
        )}
        {ctaProp.label}
      </Button>
    );
  };

  const containerColor = toneIconContainer[tone];
  const iconColor = toneIconColor[tone];

  return (
    <div
      className={`flex flex-col items-center justify-center py-16 px-4 ${className}`}
      data-testid={testId}
    >
      <div
        className={`p-4 rounded-full ${containerColor} mb-4`}
        aria-hidden="true"
      >
        <Icon className={`w-10 h-10 ${iconColor}`} />
      </div>

      <h3
        className="text-lg font-medium mb-2"
        data-testid={`${testId}-title`}
      >
        {headline}
      </h3>

      {subtitle && (
        <p
          className="text-muted-foreground text-center max-w-sm mb-2"
          data-testid={`${testId}-description`}
        >
          {subtitle}
        </p>
      )}

      {tips && tips.length > 0 && (
        <ul
          className="text-sm text-muted-foreground/90 text-left max-w-sm mb-4 space-y-1.5 list-disc pl-5"
          data-testid={`${testId}-tips`}
        >
          {tips.map((tip, i) => (
            <li key={i} className="marker:text-primary/60">
              {tip}
            </li>
          ))}
        </ul>
      )}

      {learnMoreUrl && (
        <a
          href={learnMoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${learnMoreLabel} (opens in new tab)`}
          className="text-sm text-primary/90 hover:text-primary inline-flex items-center gap-1 mb-4 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          data-testid={`${testId}-learn-more`}
        >
          {learnMoreLabel}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      )}

      {(!cta._noOp || secondaryCta) && (
        <div className="flex flex-col sm:flex-row items-center gap-2 mt-2">
          {renderCtaButton(cta, "default", `${testId}-action`)}
          {secondaryCta && renderCtaButton(secondaryCta, "outline", `${testId}-action-secondary`)}
        </div>
      )}
    </div>
  );
}
