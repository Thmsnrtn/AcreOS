/**
 * @deprecated shim — W2-3 consumer sweep will migrate imports to
 * empty-state.tsx, then this file is deleted.
 *
 * Every export here is a thin wrapper over the canonical `EmptyState`
 * primitive (`@/components/empty-state`) — one visual idiom, with
 * persona/surface variants changing copy and icon only, never layout.
 *
 * Export names and prop signatures are frozen for back-compat; do not add
 * new wrappers here. New surfaces compose the primitive directly (or a
 * `PersonaContentMap` + `resolveEmptyStateContent` when copy varies by
 * persona).
 *
 * Note: the `empty-states/` DIRECTORY (legacy second visual system) is now
 * unreferenced — this file shadows it at the `@/components/empty-states`
 * import path. The sweep deletes the directory along with this shim.
 */

import {
  EmptyState,
  type EmptyStateContent,
} from "@/components/empty-state";
import {
  Users,
  Map,
  Handshake,
  CheckSquare,
  Megaphone,
  Banknote,
  FileSpreadsheet,
  Target,
  Inbox,
  Archive,
  CheckCircle2,
  Filter,
  X,
} from "lucide-react";
import { useBrandName } from "@/hooks/use-white-label";

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
      "You haven't told Pax which counties to watch yet. Paste a county list or upload a CSV — Pax scores every new record within 90 seconds and surfaces the top three on Today by 6am.",
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

// ---------------------------------------------------------------------------
// Surface-specific wrappers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export function LeadsEmptyState({
  onAddLead,
  onImportLeads,
}: {
  onAddLead?: () => void;
  onImportLeads?: () => void;
}) {
  const brandName = useBrandName();
  return (
    <div className="space-y-2">
      <EmptyState
        icon={Users}
        headline="Tell Pax which counties to watch"
        subtitle={`You haven't told Pax which counties to watch yet. Paste a county list or upload a CSV — Pax scores every new record within 90 seconds and surfaces the top three on Today by 6am. (${brandName})`}
        cta={{
          label: "Add a Lead",
          onClick: onAddLead,
          "data-testid": "empty-state-leads-action",
        }}
        tips={[
          "Paste a CSV of county tax-delinquent records — Pax tags motivation signals overnight",
          "Add a lead manually — Pax pulls comps and owner history inside 90 seconds",
          "Point Pax at a county — it returns the first list before tomorrow morning",
        ]}
        testId="empty-state-leads"
      />
      {onImportLeads && (
        <div className="flex justify-center">
          <button
            onClick={onImportLeads}
            className="text-sm text-primary hover:underline flex items-center gap-1.5"
            data-testid="button-import-leads"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Import from CSV or spreadsheet
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export function PropertiesEmptyState({
  onAddProperty,
  onImportProperties,
}: {
  onAddProperty?: () => void;
  onImportProperties?: () => void;
}) {
  const brandName = useBrandName();
  return (
    <div className="space-y-2">
      <EmptyState
        icon={Map}
        headline="No properties in inventory"
        subtitle="Add your first parcel — Pax pulls 14 comps and a flood-zone read inside 90 seconds, and re-runs the valuation the moment a comparable sale hits."
        cta={{
          label: "Add a Property",
          onClick: onAddProperty,
          "data-testid": "empty-state-properties-action",
        }}
        tips={[
          "Add a parcel — Pax returns 14 comps and a flood-zone read in 90 seconds",
          "Paste a CSV — Pax auto-values your inventory with 14 comps per parcel",
          `${brandName} re-runs the valuation the moment a comparable sale lands`,
        ]}
        testId="empty-state-properties"
      />
      {onImportProperties && (
        <div className="flex justify-center">
          <button
            onClick={onImportProperties}
            className="text-sm text-primary hover:underline flex items-center gap-1.5"
            data-testid="button-import-properties"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Import from CSV or spreadsheet
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export function DealsEmptyState({ onAddDeal }: { onAddDeal?: () => void }) {
  return (
    <EmptyState
      icon={Handshake}
      headline="No open deals"
      subtitle="The moment you send an offer, Pax tracks the reply window and pings you on day 5 if the seller goes quiet."
      cta={{
        label: "Create a Deal",
        onClick: onAddDeal,
        "data-testid": "empty-state-deals-action",
      }}
      tips={[
        "Wire a deal to a lead and a parcel — Pax keeps the offer, counter, and reply window in one thread",
        "Track offer price, closing date, and profit projections",
        "Move deals through stages on the Pipeline board — Pax flags the ones aging past 5 days",
      ]}
      testId="empty-state-deals"
    />
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function TasksEmptyState({ onAddTask }: { onAddTask?: () => void }) {
  return (
    <EmptyState
      icon={CheckSquare}
      headline="Nothing on your list yet"
      subtitle="Add a task and link it to a lead, deal, or parcel — Pax slides follow-ups in automatically as deals age past 5 days."
      cta={{
        label: "Add a Task",
        onClick: onAddTask,
        "data-testid": "empty-state-tasks-action",
      }}
      tips={[
        "Wire a task to a lead, deal, or parcel — Pax surfaces it on Today the morning it's due",
        "Set a due date — Pax pings you the day before, not the day of",
        "Pax adds follow-up tasks on its own when a seller goes quiet past 5 days",
      ]}
      testId="empty-state-tasks"
    />
  );
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export function CampaignsEmptyState({ onCreateCampaign }: { onCreateCampaign?: () => void }) {
  return (
    <EmptyState
      icon={Megaphone}
      headline="Reach motivated sellers"
      subtitle="Pick a list and a letter — Pax handles addresses, mail merge, and tracking, and threads every reply back against the right lead."
      cta={{
        label: "Create a Campaign",
        onClick: onCreateCampaign,
        "data-testid": "empty-state-campaigns-action",
      }}
      tips={[
        "Send direct mail, email, or SMS to a targeted lead list — Pax handles the merge and the tracking pixel",
        "Wire up a drip sequence — Pax fires the next touch the moment the prior one goes 5 days silent",
        "Track response rates and ROI per campaign as replies land",
      ]}
      testId="empty-state-campaigns"
    />
  );
}

// ---------------------------------------------------------------------------
// Finance / Notes
// ---------------------------------------------------------------------------

export function FinanceEmptyState({ onAddNote }: { onAddNote?: () => void }) {
  return (
    <EmptyState
      icon={Banknote}
      headline="No notes serviced yet"
      subtitle="Originate or import a note — Pax handles the periodic statements, dunning on day 11, and the 1099-NEC at year-end."
      cta={{
        label: "Create a Note",
        onClick: onAddNote,
        "data-testid": "empty-state-finance-action",
      }}
      tips={[
        "Pax generates the amortization schedule the moment you wire the terms",
        "Track payments, delinquencies, and payoff balances — Pax dunns on day 11, you get the email first",
        "Pax sends payment reminders through the Borrower Portal three days before each due date",
      ]}
      testId="empty-state-finance"
    />
  );
}

// ---------------------------------------------------------------------------
// Pipeline (used when there are zero deals and zero leads)
// ---------------------------------------------------------------------------

export function PipelineEmptyState() {
  return (
    <EmptyState
      icon={Target}
      headline="Nothing in the pipeline"
      subtitle="Wire a lead to a deal — Pax tracks the offer, the reply window, and the cool-off, and pings you the day a deal needs a nudge."
      // TODO(cta): pipeline is an aggregate view — the right action depends on
      // whether leads or deals is the missing piece. Leaving as no-op here;
      // the caller should use FirstHelloEmpty with surface-appropriate CTAs instead.
      cta={{ label: "", _noOp: true }}
      tips={[
        "Add a lead — Pax promotes it to the pipeline the moment you send an offer",
        "Drag deals between stages on the board view — Pax flags the ones aging past 5 days",
      ]}
      testId="empty-state-pipeline"
    />
  );
}
