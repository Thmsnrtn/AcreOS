import { EmptyState } from "@/components/empty-state";
import { Users, Map, Handshake, CheckSquare, Megaphone, Banknote, FileSpreadsheet, Target, TrendingUp } from "lucide-react";
import { useBrandName } from "@/hooks/use-white-label";

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
        title="No leads yet"
        description={`Import your first leads to start building your pipeline. ${brandName} scores and prioritizes every lead automatically.`}
        actionLabel="Add a Lead"
        onAction={onAddLead}
        tips={[
          "Import a CSV of county tax-delinquent records",
          "Manually add leads you've sourced yourself",
          "The Deal Hunter can find leads for you automatically",
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
        title="No properties yet"
        description="Add properties to track your inventory — from prospect parcels to owned land and active listings."
        actionLabel="Add a Property"
        onAction={onAddProperty}
        tips={[
          "Track parcels through your entire pipeline",
          "Import from a CSV or add individually",
          `${brandName} auto-values every property with comps`,
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
      title="No deals yet"
      description="Create your first deal to start tracking acquisitions and dispositions through your pipeline."
      actionLabel="Create a Deal"
      onAction={onAddDeal}
      tips={[
        "Deals connect leads, properties, and finances in one view",
        "Track offer price, closing date, and profit projections",
        "Move deals through stages with drag-and-drop on the Pipeline board",
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
      title="No tasks yet"
      description="Create tasks to track your to-dos, follow-ups, and deadlines across all your deals."
      actionLabel="Add a Task"
      onAction={onAddTask}
      tips={[
        "Tasks can be linked to leads, deals, or properties",
        "Set due dates to get reminders before deadlines",
        "Pax suggests follow-up tasks automatically",
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
      title="No campaigns yet"
      description="Launch your first outreach campaign to connect with motivated sellers via mail, email, or SMS."
      actionLabel="Create a Campaign"
      onAction={onCreateCampaign}
      tips={[
        "Send direct mail, email, or SMS to targeted lead lists",
        "Use drip sequences for automated multi-touch follow-ups",
        "Track response rates and ROI per campaign",
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
      title="No promissory notes yet"
      description="Create your first seller-financed note to start tracking payments, amortization, and portfolio value."
      actionLabel="Create a Note"
      onAction={onAddNote}
      tips={[
        "Automatically generate amortization schedules",
        "Track payments, delinquencies, and payoff balances",
        "Send payment reminders via the Borrower Portal",
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
      title="Your pipeline is empty"
      description="Add leads and deals to see them flow through your pipeline stages."
      tips={[
        "Start by adding leads — they become deals as you negotiate",
        "Drag and drop deals between stages on the board view",
      ]}
      testId="empty-state-pipeline"
    />
  );
}
