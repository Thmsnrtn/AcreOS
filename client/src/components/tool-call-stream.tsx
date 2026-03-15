import { useState, type ElementType } from "react";
import {
  Users, UserPlus, RefreshCw, Mail, MessageSquare, MapPin, Search,
  FileText, TrendingUp, Calculator, ClipboardList, CheckSquare,
  Building, Database, Zap, ChevronDown, ChevronRight, Loader2,
  CheckCircle2, AlertCircle, Globe, BarChart2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PaxEditDiff } from "@/components/pax-edit-diff";

export type ToolStatus = "running" | "done" | "error";

export interface ToolEvent {
  id: string;
  name: string;
  args?: Record<string, any>;
  resultSummary?: string;
  status: ToolStatus;
  diffBefore?: Record<string, any>;
  diffAfter?: Record<string, any>;
}

interface ToolMeta {
  icon: ElementType;
  label: string;
  paramSummary: (args: Record<string, any>) => string;
}

const TOOL_META: Record<string, ToolMeta> = {
  get_system_context:    { icon: Database,     label: "Loading business context",   paramSummary: () => "" },
  get_leads:             { icon: Users,        label: "Looking up leads",            paramSummary: (a) => [a.status && `status: ${a.status}`, a.limit && `limit: ${a.limit}`].filter(Boolean).join(" · ") },
  get_lead_details:      { icon: Users,        label: "Loading lead details",        paramSummary: (a) => `#${a.leadId ?? a.id}` },
  create_lead:           { icon: UserPlus,     label: "Creating lead",               paramSummary: (a) => `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() },
  update_lead_status:    { icon: RefreshCw,    label: "Updating lead status",        paramSummary: (a) => `→ ${a.status ?? ""}` },
  send_email:            { icon: Mail,         label: "Sending email",               paramSummary: (a) => a.to ?? "" },
  send_sms:              { icon: MessageSquare,label: "Sending SMS",                 paramSummary: (a) => a.phone ?? "" },
  get_properties:        { icon: MapPin,       label: "Looking up properties",       paramSummary: (a) => a.county ?? "all" },
  get_property_details:  { icon: MapPin,       label: "Loading property details",    paramSummary: (a) => a.apn ?? `#${a.propertyId}` },
  create_property:       { icon: MapPin,       label: "Creating property",           paramSummary: (a) => a.address ?? a.county ?? "" },
  research_property:     { icon: Search,       label: "Researching property",        paramSummary: (a) => a.apn ?? "" },
  get_deals:             { icon: Building,     label: "Looking up deals",            paramSummary: (a) => a.status ?? "all" },
  create_deal:           { icon: Building,     label: "Creating deal",               paramSummary: (a) => a.propertyId ? `property #${a.propertyId}` : "" },
  update_deal:           { icon: RefreshCw,    label: "Updating deal",               paramSummary: (a) => `→ ${a.status ?? a.stage ?? ""}` },
  update_property:       { icon: RefreshCw,    label: "Updating property",           paramSummary: (a) => `#${a.property_id ?? ""}` },
  get_notes:             { icon: FileText,     label: "Loading notes",               paramSummary: (a) => a.status ?? "all" },
  calculate_amortization:{ icon: Calculator,   label: "Calculating amortization",    paramSummary: (a) => a.principal ? `$${Number(a.principal).toLocaleString()}` : "" },
  calculate_roi:         { icon: TrendingUp,   label: "Calculating ROI",             paramSummary: (a) => a.purchasePrice ? `$${Number(a.purchasePrice).toLocaleString()}` : "" },
  generate_offer:        { icon: FileText,     label: "Generating offer",            paramSummary: (a) => a.offerPrice ? `$${Number(a.offerPrice).toLocaleString()}` : "" },
  generate_offer_letter: { icon: FileText,     label: "Drafting offer letter",       paramSummary: () => "" },
  run_comps_analysis:    { icon: BarChart2,    label: "Running comps analysis",      paramSummary: (a) => a.county ?? "" },
  get_cashflow_summary:  { icon: TrendingUp,   label: "Loading cash flow",           paramSummary: () => "" },
  create_task:           { icon: CheckSquare,  label: "Creating task",               paramSummary: (a) => a.title ?? "" },
  schedule_followup:     { icon: ClipboardList,label: "Scheduling follow-up",        paramSummary: (a) => a.leadId ? `lead #${a.leadId}` : "" },
  get_campaigns:         { icon: Zap,          label: "Loading campaigns",           paramSummary: () => "" },
  web_search:            { icon: Globe,        label: "Searching the web",           paramSummary: (a) => a.query ?? "" },
};

const MUTATION_TOOLS = new Set([
  "update_lead_status",
  "update_deal",
  "update_property",
  "schedule_followup",
]);

function getToolMeta(name: string): ToolMeta {
  return TOOL_META[name] ?? {
    icon: Zap,
    label: name.replace(/_/g, " "),
    paramSummary: () => "",
  };
}

function resultToSummary(name: string, result: any): string {
  if (!result) return "";
  try {
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    if (Array.isArray(parsed)) return `${parsed.length} result${parsed.length !== 1 ? "s" : ""}`;
    if (parsed?.success === false) return "failed";
    if (parsed?.success) return "done";
    if (parsed?.id) return `created #${parsed.id}`;
    if (parsed?.count !== undefined) return `${parsed.count} records`;
    if (typeof parsed === "string") return parsed.slice(0, 60);
    return "done";
  } catch {
    return String(result).slice(0, 60);
  }
}

function getEntityLabel(event: ToolEvent): string {
  const args = event.args ?? {};
  if (event.name === "update_lead_status") return args.lead_id ? `Lead #${args.lead_id}` : "lead";
  if (event.name === "update_deal") return args.deal_id ? `Deal #${args.deal_id}` : "deal";
  if (event.name === "update_property") return args.property_id ? `Property #${args.property_id}` : "property";
  return "record";
}

interface ToolCardProps {
  event: ToolEvent;
}

function ToolCard({ event }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = getToolMeta(event.name);
  const Icon = meta.icon;
  const isMutation = MUTATION_TOOLS.has(event.name);

  let paramStr = "";
  try {
    paramStr = event.args ? meta.paramSummary(event.args) : "";
  } catch {}

  const showDiff =
    event.status === "done" &&
    isMutation &&
    event.diffBefore !== undefined &&
    event.diffAfter !== undefined;

  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          "rounded-md border text-xs transition-colors",
          event.status === "running" && "border-blue-500/30 bg-blue-500/5",
          event.status === "done"    && "border-green-500/30 bg-green-500/5",
          event.status === "error"   && "border-red-500/30 bg-red-500/5"
        )}
      >
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          {/* Status indicator */}
          {event.status === "running" && (
            isMutation
              ? <Loader2 className="w-3 h-3 text-blue-500 animate-spin flex-shrink-0" />
              : <Loader2 className="w-3 h-3 text-blue-500 animate-spin flex-shrink-0" />
          )}
          {event.status === "done"    && <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />}
          {event.status === "error"   && <AlertCircle  className="w-3 h-3 text-red-500 flex-shrink-0" />}

          <Icon className="w-3 h-3 text-muted-foreground flex-shrink-0" />

          <span className="font-medium text-foreground">
            {event.status === "running" && isMutation ? "Pax is editing…" : meta.label}
          </span>

          {paramStr && (
            <span className="text-muted-foreground truncate flex-1">{paramStr}</span>
          )}

          {event.resultSummary && event.status === "done" && !showDiff && (
            <span className="text-green-600 dark:text-green-400 ml-auto flex-shrink-0">
              → {event.resultSummary}
            </span>
          )}

          {expanded
            ? <ChevronDown className="w-3 h-3 text-muted-foreground ml-1 flex-shrink-0" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground ml-1 flex-shrink-0" />
          }
        </button>

        {expanded && event.args && (
          <div className="px-2.5 pb-1.5 border-t border-dashed border-border/50 mt-0.5 pt-1">
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(event.args, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {showDiff && (
        <PaxEditDiff
          toolName={event.name}
          entityLabel={getEntityLabel(event)}
          before={event.diffBefore!}
          after={event.diffAfter!}
        />
      )}
    </div>
  );
}

interface ToolCallStreamProps {
  events: ToolEvent[];
  className?: string;
}

/** Renders a list of tool-call events as visual status cards */
export function ToolCallStream({ events, className }: ToolCallStreamProps) {
  if (events.length === 0) return null;
  return (
    <div className={cn("space-y-1 my-1", className)}>
      {events.map((evt) => (
        <ToolCard key={evt.id} event={evt} />
      ))}
    </div>
  );
}

/** Parse a raw tool_result value and return a human-friendly summary string */
export function parseToolResultSummary(toolName: string, result: any): string {
  return resultToSummary(toolName, result);
}
