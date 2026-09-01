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
 * The three multi-consumer ARCHETYPES (FirstHelloEmpty, ClearedEmpty,
 * EmptyFilter — defined at the bottom of this file) compose this primitive and
 * are the right import for the states they name: first-run zero-data,
 * cleared-queue, and filters-returned-nothing. Use the primitive directly for
 * everything else, inlining copy at the call site. (The W2-3 consumer sweep
 * retired the `empty-states.tsx` shim and the legacy `empty-states/` directory;
 * single-consumer surface wrappers were inlined at their call sites.)
 *
 * PERSONA VARIANTS layer ON TOP of this primitive: persona/surface changes
 * COPY and ICON only — never layout. Build a `PersonaContentMap` and resolve
 * it with `resolveEmptyStateContent`, then spread the result into the
 * primitive. There is exactly one visual idiom (icon circle, type scale, CTA
 * row, spacing); forking layout per persona is a regression, not a variant.
 */

import {
  type LucideIcon,
  ExternalLink,
  Plus,
  Users,
  Map,
  Handshake,
  Megaphone,
  Inbox,
  CheckCircle2,
  Archive,
  Filter,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Persona } from "@shared/models/auth";

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
  /**
   * Wrap the empty state in a dashed-border container. Use when the empty
   * state stands in for a content region (table body, list, board) so the
   * surface keeps its visual footprint. The internal idiom — icon treatment,
   * type scale, CTA placement, spacing — is identical framed or not.
   */
  framed?: boolean;
  className?: string;
  /** Root element data-testid. Defaults to "empty-state". */
  testId?: string;
}

// ---------------------------------------------------------------------------
// Persona-variant layer
// ---------------------------------------------------------------------------

/**
 * The content slice a persona/surface variant is allowed to change.
 * Deliberately excludes layout-affecting props (`framed`, `className`) and
 * the CTA (the call site owns the action wiring).
 */
export type EmptyStateContent = Pick<
  EmptyStateProps,
  "icon" | "headline" | "subtitle" | "tips"
>;

/**
 * Persona → content map. `default` is required and serves both as the
 * land_investor baseline and the fallback for personas without an override.
 */
export type PersonaContentMap = {
  default: EmptyStateContent;
} & Partial<Record<Persona, EmptyStateContent>>;

/** Resolve persona-specific copy/icon, falling back to the default content. */
export function resolveEmptyStateContent(
  variants: PersonaContentMap,
  persona: Persona | undefined,
): EmptyStateContent {
  return (persona && variants[persona]) || variants.default;
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
  framed = false,
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
      className={`flex flex-col items-center justify-center py-16 px-4 ${
        framed ? "rounded-lg border border-dashed border-border bg-muted/30" : ""
      } ${className}`}
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

// ---------------------------------------------------------------------------
// Archetype #1 — FirstHelloEmpty
// ---------------------------------------------------------------------------
// For *new* organizations with zero data on a given surface. Optimistic,
// onboarding-flavored, with one or two purposeful CTAs.
//
// Use this when `records.length === 0` AND the org has never had records
// (no archived items, no filters applied). For "you cleared everything"
// use `<ClearedEmpty>`. For "filters returned nothing" use `<EmptyFilter>`.

export type FirstHelloSurface =
  | "leads"
  | "properties"
  | "deals"
  | "campaigns"
  | "inbox";

interface FirstHelloCta {
  label: string;
  onClick: () => void;
}

interface FirstHelloEmptyProps {
  surface: FirstHelloSurface;
  cta: {
    primary: FirstHelloCta;
    secondary?: FirstHelloCta;
  };
  /** Optional override for the headline copy. */
  headline?: string;
  /** Optional override for the subtitle copy. */
  subtitle?: string;
  className?: string;
}

// Surface-variant content layer: copy + icon only — layout lives in the
// primitive. Agency-frame archetype copy (Joanna): name what the user
// hasn't done, name what Pax does the moment they do it, name when.
const FIRST_HELLO_CONTENT: Record<
  FirstHelloSurface,
  EmptyStateContent & { testIdSuffix: string }
> = {
  leads: {
    icon: Users,
    headline: "Tell Pax which counties to watch",
    subtitle:
      "You haven't told Pax which counties to watch yet. Paste a county list or upload a CSV — every record lands scored hot to cold, and each new lead fires the workflows you've built.",
    testIdSuffix: "leads",
  },
  properties: {
    icon: Map,
    headline: "No properties in inventory",
    subtitle:
      "Add your first parcel — Pax pulls comps and a flood-zone read inside 90 seconds.",
    testIdSuffix: "properties",
  },
  deals: {
    icon: Handshake,
    headline: "No open deals",
    subtitle:
      "The moment you send an offer, Pax tracks the reply window and pings you on day 5 if the seller goes quiet.",
    testIdSuffix: "deals",
  },
  campaigns: {
    icon: Megaphone,
    headline: "Reach motivated sellers",
    subtitle:
      "Pick a list and a letter — Pax handles addresses, mail merge, and tracking, and flags every reply against the right lead.",
    testIdSuffix: "campaigns",
  },
  inbox: {
    icon: Inbox,
    headline: "Wire up an inbox",
    subtitle:
      "Connect a mailbox or phone number — Pax threads every reply against the right lead and drafts the response by the time you read it.",
    testIdSuffix: "inbox",
  },
};

export function FirstHelloEmpty({
  surface,
  cta,
  headline,
  subtitle,
  className = "",
}: FirstHelloEmptyProps) {
  const content = FIRST_HELLO_CONTENT[surface];
  const testId = `first-hello-${content.testIdSuffix}`;

  return (
    <EmptyState
      framed
      icon={content.icon}
      headline={headline ?? content.headline}
      subtitle={subtitle ?? content.subtitle}
      cta={{
        label: cta.primary.label,
        onClick: cta.primary.onClick,
        "data-testid": `${testId}-cta-primary`,
      }}
      secondaryCta={
        cta.secondary
          ? {
              label: cta.secondary.label,
              onClick: cta.secondary.onClick,
              "data-testid": `${testId}-cta-secondary`,
            }
          : undefined
      }
      className={className}
      testId={testId}
    />
  );
}

// ---------------------------------------------------------------------------
// Archetype #2 — ClearedEmpty
// ---------------------------------------------------------------------------
// "Inbox zero" feeling. Used when the user has *cleared* their queue and
// nothing demands attention right now, but archived/older items still exist.
// Tone: affirming and quiet. Don't oversell.

interface ClearedEmptyProps {
  /** Headline copy. e.g. "All clear — nothing needs you right now". */
  headline: string;
  /** Optional subtitle. */
  subtitle?: string;
  /** When provided, renders a small "View archived" CTA with the count. */
  archiveCount?: number;
  /** Click handler for the archive CTA. */
  onShowArchive?: () => void;
  /** Custom label for the archive CTA (defaults to "View archived"). */
  archiveLabel?: string;
  className?: string;
}

export function ClearedEmpty({
  headline,
  subtitle,
  archiveCount,
  onShowArchive,
  archiveLabel = "View archived",
  className = "",
}: ClearedEmptyProps) {
  const ctaLabel =
    archiveCount !== undefined && archiveCount > 0
      ? `${archiveLabel} (${archiveCount.toLocaleString()})`
      : archiveLabel;

  return (
    <EmptyState
      icon={CheckCircle2}
      headline={headline}
      subtitle={subtitle}
      tone="celebratory"
      actionIcon={Archive}
      cta={
        onShowArchive
          ? {
              label: ctaLabel,
              onClick: onShowArchive,
              "data-testid": "cleared-empty-archive",
            }
          : {
              // TODO(cta): no archive handler — cleared queue is self-contained
              label: "",
              _noOp: true,
            }
      }
      className={className}
      testId="cleared-empty"
    />
  );
}

// ---------------------------------------------------------------------------
// Archetype #3 — EmptyFilter
// ---------------------------------------------------------------------------
// Filtered list returned zero items, but data *does* exist in the system
// overall. The fix is "clear filters", not "create new data."

interface EmptyFilterProps {
  /** Number of active filters. Used for copy ("2 filters"). */
  filterCount: number;
  /** Reset all active filters. */
  onClearFilters: () => void;
  /** Optional override for headline copy. */
  headline?: string;
  /** Optional override for subtitle copy. */
  subtitle?: string;
  /** Optional override for the CTA label. Defaults to "Clear filters". */
  clearLabel?: string;
  className?: string;
}

export function EmptyFilter({
  filterCount,
  onClearFilters,
  headline,
  subtitle,
  clearLabel = "Clear filters",
  className = "",
}: EmptyFilterProps) {
  const filterWord = filterCount === 1 ? "filter" : "filters";
  const defaultHeadline =
    filterCount > 0 ? `No matches for these ${filterWord}` : "No matches";
  const defaultSubtitle =
    filterCount > 0
      ? `${filterCount} active ${filterWord} narrowed the results to nothing. Clear them to see everything again.`
      : "Try adjusting your search terms or filters.";

  return (
    <EmptyState
      framed
      icon={Filter}
      headline={headline ?? defaultHeadline}
      subtitle={subtitle ?? defaultSubtitle}
      actionIcon={X}
      cta={{
        label: clearLabel,
        onClick: onClearFilters,
        "data-testid": "empty-filter-clear",
      }}
      className={className}
      testId="empty-filter"
    />
  );
}
