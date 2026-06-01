import { EmptyState } from "@/components/empty-state";
import { Users, Map, Handshake, CheckSquare, Megaphone, Banknote, FileSpreadsheet, Target } from "lucide-react";
import { useBrandName } from "@/hooks/use-white-label";

// ---------------------------------------------------------------------------
// Archetype re-exports
// ---------------------------------------------------------------------------
// The three reusable empty-state archetypes — prefer these over the
// surface-specific components below for new code:
//   - FirstHelloEmpty: new orgs with no data yet
//   - ClearedEmpty:    inbox-zero / queue-cleared affirming state
//   - EmptyFilter:     filters returned nothing, data exists overall
export {
  FirstHelloEmpty,
  ClearedEmpty,
  EmptyFilter,
  type FirstHelloSurface,
} from "@/components/empty-states/index";

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
