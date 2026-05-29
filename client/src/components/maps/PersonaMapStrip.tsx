import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { usePersona, useTerm } from "@/hooks/use-persona";
import { usd } from "@/lib/format";
import {
  AlertTriangle,
  Send,
  ExternalLink,
  Navigation,
  Hammer,
  Wallet,
  MapPin,
} from "lucide-react";
import type { Note, Lead, Property } from "@shared/schema";

interface Props {
  /**
   * Properties already loaded by the maps page — passed in so the
   * strip can render owned/listed counts without re-fetching. The
   * strip otherwise owns its own queries for notes + leads + deals.
   */
  properties: Property[];
  /**
   * Total mappable property count from the page (used in the empty-state
   * decision: "no data" vs "data but persona has no entries yet").
   */
  hasAnyProperties: boolean;
}

/**
 * PersonaMapStrip — a single horizontal strip above the existing map
 * canvas that re-flavors the same MapLibre map for who's using it.
 *
 * The strip does NOT change the map canvas or remove existing modes
 * (per the customer-nav contract: five fixed doors, persona changes
 * content not chrome). It surfaces persona-relevant quick stats +
 * one prominent CTA so the door feels like "their kind of map" at
 * first glance.
 *
 *   note_investor / note_servicer → Collateral geography:
 *     pins are loans; right rail teases the worst-late entry with
 *     direct send-reminder / pull-payoff actions.
 *   wholesaler → Curb capture: motivated-seller pin counts +
 *     prominent DriveMode launch button.
 *   fix_flipper / subdivider → Inventory + projects: owned-property
 *     counts by status + top active project.
 *   land_investor (default) → null (existing parcel discovery is
 *     already the right home page for them).
 */
export function PersonaMapStrip({ properties, hasAnyProperties }: Props) {
  const persona = usePersona();
  const collateralLabel = useTerm("entity.property");
  const motivatedSellerLabel = useTerm("entity.lead");

  const isCollateral = persona === "note_investor" || persona === "note_servicer";
  const isCurbCapture = persona === "wholesaler";
  const isInventory = persona === "fix_flipper" || persona === "subdivider";

  if (!isCollateral && !isCurbCapture && !isInventory) return null;

  if (isCollateral) {
    return <CollateralStrip propertyLabel={collateralLabel} />;
  }
  if (isCurbCapture) {
    return (
      <CurbCaptureStrip
        leadLabel={motivatedSellerLabel}
        hasAnyProperties={hasAnyProperties}
      />
    );
  }
  return <InventoryStrip properties={properties} />;
}

// ── Collateral geography (note investors / servicers) ────────────────────────

function CollateralStrip({ propertyLabel }: { propertyLabel: string }) {
  // Pull notes — leads are joined to render the borrower name. The
  // strip's "worst-late" row is the single most-late borrower because
  // that's the only collateral-health datum the persona looks at first.
  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["/api/notes"],
  });
  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const activeNotes = useMemo(
    () => notes.filter((n) => n.status === "active"),
    [notes],
  );
  const totalOutstanding = useMemo(
    () => activeNotes.reduce((s, n) => s + Number(n.currentBalance || 0), 0),
    [activeNotes],
  );
  const worstLate = useMemo((): { note: Note; daysLate: number } | null => {
    const now = Date.now();
    let candidate: { note: Note; daysLate: number } | null = null;
    activeNotes.forEach((n) => {
      if (!n.nextPaymentDate) return;
      const days = Math.floor(
        (now - new Date(n.nextPaymentDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days <= 0) return;
      if (!candidate || days > candidate.daysLate) {
        candidate = { note: n, daysLate: days };
      }
    });
    return candidate;
  }, [activeNotes]);
  const borrowerName = worstLate
    ? leads.find((l) => l.id === worstLate.note.borrowerId)
    : null;

  if (activeNotes.length === 0) {
    return (
      <div className="px-4 md:px-6 py-3 border-b bg-acr-brand-soft/30">
        <EmptyState
          icon={MapPin}
          title="No serviced notes yet"
          description={`Collateral geography appears here once you have active notes. Add a note to see your ${propertyLabel.toLowerCase()} on the map color-coded by days late.`}
          actionLabel="Start servicing notes"
          onAction={() => {
            window.location.href = "/finance?action=new";
          }}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 md:px-6 py-2.5 border-b bg-acr-brand-soft/15">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Badge variant="secondary" className="text-micro shrink-0">
          Collateral geography
        </Badge>
        <span className="text-sm text-muted-foreground hidden md:inline">
          {activeNotes.length} active · outstanding{" "}
          <span className="font-mono tabular-nums text-foreground font-medium">
            {usd(totalOutstanding, { noCents: true })}
          </span>
        </span>
        {worstLate && (
          <>
            <span className="hidden md:inline text-muted-foreground">·</span>
            <span className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle
                className="w-3.5 h-3.5 text-acr-neg shrink-0"
                aria-hidden="true"
              />
              <span className="text-sm truncate">
                Worst late:{" "}
                <span className="font-medium">
                  {borrowerName
                    ? `${borrowerName.firstName} ${borrowerName.lastName}`
                    : `Note #${worstLate.note.id}`}
                </span>{" "}
                <span className="text-acr-neg font-mono tabular-nums">
                  {worstLate.daysLate}d
                </span>
              </span>
            </span>
          </>
        )}
      </div>
      {worstLate && (
        <div className="flex items-center gap-1.5 shrink-0">
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href={`/finance?note=${worstLate.note.id}&action=remind`}>
              <Send className="w-3 h-3 mr-1" aria-hidden="true" />
              <span className="hidden sm:inline">Send reminder</span>
              <span className="sm:hidden">Remind</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href={`/finance?note=${worstLate.note.id}&action=payoff`}>
              <Wallet className="w-3 h-3 mr-1" aria-hidden="true" />
              <span className="hidden md:inline">Pull payoff</span>
              <span className="md:hidden">Payoff</span>
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Curb capture (wholesaler) ────────────────────────────────────────────────

function CurbCaptureStrip({
  leadLabel,
  hasAnyProperties,
}: {
  leadLabel: string;
  hasAnyProperties: boolean;
}) {
  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const motivated = leads.filter((l) => l.type === "seller" || !l.type);

  if (!hasAnyProperties && motivated.length === 0) {
    return (
      <div className="px-4 md:px-6 py-3 border-b bg-acr-brand-soft/30">
        <EmptyState
          icon={Navigation}
          title={`No ${leadLabel.toLowerCase()}s captured yet`}
          description={`Curb-capture pins appear here as you drive your route. Launch DriveMode to start tagging.`}
          actionLabel="Launch DriveMode"
          actionIcon={Navigation}
          onAction={() => {
            window.location.href = "/drivemode";
          }}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 md:px-6 py-2.5 border-b bg-acr-brand-soft/15">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Badge variant="secondary" className="text-micro shrink-0">
          Curb capture
        </Badge>
        <span className="text-sm text-muted-foreground">
          {motivated.length} {leadLabel.toLowerCase()}
          {motivated.length === 1 ? "" : "s"} pinned
        </span>
      </div>
      <Button asChild size="sm" className="h-7 text-xs shrink-0">
        <Link href="/drivemode">
          <Navigation className="w-3 h-3 mr-1" aria-hidden="true" />
          <span className="hidden sm:inline">Launch DriveMode</span>
          <span className="sm:hidden">DriveMode</span>
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline" className="h-7 text-xs shrink-0 hidden md:inline-flex">
        <Link href="/leads?type=seller">
          <ExternalLink className="w-3 h-3 mr-1" aria-hidden="true" />
          {leadLabel}s
        </Link>
      </Button>
    </div>
  );
}

// ── Inventory + projects (fix_flipper / subdivider) ──────────────────────────

function InventoryStrip({ properties }: { properties: Property[] }) {
  const projectLabel = useTerm("entity.property");
  const projectPluralLabel = useTerm("entity.property.plural");

  const counts = useMemo(() => {
    const acquisition = properties.filter((p) =>
      ["prospect", "due_diligence", "offer_sent", "under_contract"].includes(
        p.status || "",
      ),
    ).length;
    const reno = properties.filter((p) => p.status === "owned").length;
    const list = properties.filter((p) => p.status === "listed").length;
    const sold = properties.filter((p) => p.status === "sold").length;
    return { acquisition, reno, list, sold };
  }, [properties]);

  const topProject = useMemo((): { p: Property; net: number } | null => {
    const active = properties.filter((p) => p.status !== "sold");
    let best: { p: Property; net: number } | null = null;
    active.forEach((p) => {
      const buy = Number(p.purchasePrice || 0);
      const sell = Number(p.listPrice || 0);
      const net = sell - buy;
      if (!best || net > best.net) best = { p, net };
    });
    return best;
  }, [properties]);

  if (properties.length === 0) {
    return (
      <div className="px-4 md:px-6 py-3 border-b bg-acr-brand-soft/30">
        <EmptyState
          icon={Hammer}
          title={`No ${projectPluralLabel.toLowerCase()} yet`}
          description={`Add a ${projectLabel.toLowerCase()} to see acquisitions, renovations, and listings on the same map.`}
          actionLabel={`Add ${projectLabel.toLowerCase()}`}
          onAction={() => {
            window.location.href = "/properties?action=new";
          }}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 md:px-6 py-2.5 border-b bg-acr-brand-soft/15">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Badge variant="secondary" className="text-micro shrink-0">
          Inventory + projects
        </Badge>
        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
          <StatusPip label="Acquisition" count={counts.acquisition} color="text-acr-warn" />
          <StatusPip label="Reno" count={counts.reno} color="text-acr-brand" />
          <StatusPip label="Listed" count={counts.list} color="text-acr-accent" />
          <StatusPip label="Sold" count={counts.sold} color="text-acr-pos" />
        </span>
        {topProject && (
          <>
            <span className="hidden md:inline text-muted-foreground">·</span>
            <span className="hidden md:inline text-sm">
              Top: <span className="font-medium">{topProject.p.county}, {topProject.p.state}</span>{" "}
              <span className={`font-mono tabular-nums ${topProject.net < 0 ? "text-acr-neg" : "text-acr-pos"}`}>
                {usd(topProject.net, { noCents: true })}
              </span>
            </span>
          </>
        )}
      </div>
      <Button asChild size="sm" variant="outline" className="h-7 text-xs shrink-0">
        <Link href="/properties">
          <Hammer className="w-3 h-3 mr-1" aria-hidden="true" />
          <span className="hidden sm:inline">{projectPluralLabel}</span>
          <span className="sm:hidden">List</span>
        </Link>
      </Button>
    </div>
  );
}

function StatusPip({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${color}`} aria-hidden="true" />
      <span className="tabular-nums">{count}</span>
      <span className="text-muted-foreground hidden md:inline">{label}</span>
    </span>
  );
}
