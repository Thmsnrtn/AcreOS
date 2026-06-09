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
  Search,
  Users,
  TrendingUp,
  FileSignature,
  ClipboardCheck,
  PiggyBank,
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
 * The four investor personas each get a genuinely distinct job here —
 * the map is central for land, secondary or de-emphasized for the note
 * roles:
 *
 *   land_investor → Parcel & owner tools: sourcing is the job. Parcel/owner
 *     lookup + comps are front-and-center; the map IS their home page.
 *   note_investor → Portfolio yield: notes don't live on a map. The strip
 *     de-emphasizes geography and surfaces portfolio yield + the notes book.
 *   note_originator → Origination pipeline: their job is CREATING paper.
 *     Surfaces the deals→notes origination entrypoint, not parcel discovery.
 *   note_servicer → Servicing book: they don't own collateral, they service
 *     it. Surfaces the most-delinquent + the servicing book; the map is a
 *     locator, not the workspace.
 *
 *   wholesaler → Curb capture: motivated-seller pin counts + DriveMode.
 *   fix_flipper / subdivider → Inventory + projects: owned-property
 *     counts by status + top active project.
 */
export function PersonaMapStrip({ properties, hasAnyProperties }: Props) {
  const persona = usePersona();
  const collateralLabel = useTerm("entity.property");
  const motivatedSellerLabel = useTerm("entity.lead");

  switch (persona) {
    case "land_investor":
      return (
        <ParcelToolsStrip
          properties={properties}
          hasAnyProperties={hasAnyProperties}
        />
      );
    case "note_investor":
      return <PortfolioYieldStrip />;
    case "note_originator":
      return <OriginationStrip />;
    case "note_servicer":
      return <ServicingStrip propertyLabel={collateralLabel} />;
    case "wholesaler":
      return (
        <CurbCaptureStrip
          leadLabel={motivatedSellerLabel}
          hasAnyProperties={hasAnyProperties}
        />
      );
    case "fix_flipper":
    case "subdivider":
      return <InventoryStrip properties={properties} />;
    default:
      return null;
  }
}

// ── Shared strip chrome ──────────────────────────────────────────────────────

function StripShell({
  title,
  shortTitle,
  children,
  actions,
}: {
  title: string;
  shortTitle: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 md:px-6 py-2.5 border-b bg-acr-brand-soft/15">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-section-h2 shrink-0 hidden sm:block">{title}</span>
        <Badge variant="secondary" className="text-micro shrink-0 sm:hidden">
          {shortTitle}
        </Badge>
        {children}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}

// ── Parcel & owner tools (land_investor) ─────────────────────────────────────

/**
 * Land sourcing is the job, and the map IS the home page — so unlike the note
 * roles this strip keeps the map central and puts the parcel/owner tools
 * front-and-center: how many parcels are mapped, how many owner-targets exist,
 * and one-tap into parcel discovery + owner-lead outreach. Honest-empty when
 * there's nothing mapped yet rather than inventing a parcel count.
 */
function ParcelToolsStrip({
  properties,
  hasAnyProperties,
}: {
  properties: Property[];
  hasAnyProperties: boolean;
}) {
  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const mapped = useMemo(
    () => properties.filter((p) => p.latitude && p.longitude).length,
    [properties],
  );
  // Owner-targets = seller leads we could door-knock / mail. Untyped leads
  // default to seller (the land-sourcing motion), matching CurbCaptureStrip.
  const ownerTargets = useMemo(
    () => leads.filter((l) => l.type === "seller" || !l.type).length,
    [leads],
  );

  if (!hasAnyProperties && ownerTargets === 0) {
    return (
      <div className="px-4 md:px-6 py-3 border-b bg-acr-brand-soft/30">
        <EmptyState
          icon={Search}
          headline="Start sourcing parcels"
          subtitle="Find raw land by county, pull the owner of record, and comp it — all on this map. Add your first parcels to begin."
          cta={{
            label: "Find parcels",
            href: "/properties",
            "data-testid": "persona-map-find-parcels",
          }}
          secondaryCta={{
            label: "Import a list",
            href: "/properties?action=new",
            "data-testid": "persona-map-import-parcels",
          }}
          actionIcon={Search}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <StripShell
      title="Parcel & owner tools"
      shortTitle="Parcels"
      actions={
        <>
          <Button asChild size="sm" className="h-7 text-xs">
            <Link href="/properties">
              <Search className="w-3 h-3 mr-1" aria-hidden="true" />
              <span className="hidden sm:inline">Find parcels</span>
              <span className="sm:hidden">Parcels</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs hidden md:inline-flex">
            <Link href="/leads?type=seller">
              <Users className="w-3 h-3 mr-1" aria-hidden="true" />
              Owner targets
            </Link>
          </Button>
        </>
      }
    >
      <span className="text-sm text-muted-foreground hidden md:inline">
        <span className="tabular-nums text-foreground font-medium">{mapped}</span>{" "}
        parcel{mapped === 1 ? "" : "s"} mapped
        {ownerTargets > 0 && (
          <>
            {" · "}
            <span className="tabular-nums text-foreground font-medium">{ownerTargets}</span>{" "}
            owner target{ownerTargets === 1 ? "" : "s"}
          </>
        )}
      </span>
      <span className="text-sm text-muted-foreground md:hidden tabular-nums">
        {mapped} mapped
      </span>
    </StripShell>
  );
}

// ── Portfolio yield (note_investor) ──────────────────────────────────────────

/**
 * Notes don't live on a map — a note investor's job is yield on paper they
 * OWN. So this strip de-emphasizes geography: it leads with portfolio yield
 * and the notes book, and points off the map entirely. Honest-empty (no
 * fabricated yield) when there are no notes yet.
 */
function PortfolioYieldStrip() {
  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["/api/notes"],
  });

  const activeNotes = useMemo(
    () => notes.filter((n) => n.status === "active"),
    [notes],
  );
  const totalOutstanding = useMemo(
    () => activeNotes.reduce((s, n) => s + Number(n.currentBalance || 0), 0),
    [activeNotes],
  );
  // Balance-weighted average rate — the single yield number a note investor
  // looks at first. Only computed from notes that actually carry a rate +
  // balance; we never synthesize a yield for notes missing the field.
  const weightedRate = useMemo(() => {
    let weight = 0;
    let acc = 0;
    activeNotes.forEach((n) => {
      const bal = Number(n.currentBalance || 0);
      const rate = Number(n.interestRate || 0);
      if (bal > 0 && rate > 0) {
        weight += bal;
        acc += bal * rate;
      }
    });
    return weight > 0 ? acc / weight : null;
  }, [activeNotes]);

  if (activeNotes.length === 0) {
    return (
      <div className="px-4 md:px-6 py-3 border-b bg-acr-brand-soft/30">
        <EmptyState
          icon={TrendingUp}
          headline="Import your note portfolio"
          subtitle="Your job is yield, not geography. Import the notes you've acquired — payer, balance, rate, and payment — and AcreOS tracks the book and its yield. The map stays available, but it isn't where notes live."
          cta={{
            label: "Import notes",
            href: "/notes?action=new",
            "data-testid": "persona-map-import-notes",
          }}
          secondaryCta={{
            label: "Open the book",
            href: "/finance",
            "data-testid": "persona-map-open-book",
          }}
          actionIcon={TrendingUp}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <StripShell
      title="Portfolio yield"
      shortTitle="Yield"
      actions={
        <Button asChild size="sm" className="h-7 text-xs">
          <Link href="/finance">
            <ExternalLink className="w-3 h-3 mr-1" aria-hidden="true" />
            <span className="hidden sm:inline">Open the book</span>
            <span className="sm:hidden">Book</span>
          </Link>
        </Button>
      }
    >
      <span className="text-sm text-muted-foreground">
        <span className="tabular-nums">{activeNotes.length}</span> note
        {activeNotes.length === 1 ? "" : "s"}
        {" · outstanding "}
        <span className="font-mono tabular-nums text-foreground font-medium">
          {usd(totalOutstanding, { noCents: true })}
        </span>
        {weightedRate !== null ? (
          <span className="hidden md:inline">
            {" · "}
            <span className="font-mono tabular-nums text-acr-pos font-medium">
              {weightedRate.toFixed(2)}%
            </span>{" "}
            wtd yield
          </span>
        ) : (
          <span className="hidden md:inline text-micro">
            {" · "}yield not set
          </span>
        )}
      </span>
    </StripShell>
  );
}

// ── Origination pipeline (note_originator) ───────────────────────────────────

/**
 * A note originator CREATES paper — typically seller-financing land or
 * converting tax liens. Their map question isn't "where are my pins" but
 * "which deals are becoming notes." So we point at the origination pipeline
 * (deals → notes), not parcel discovery. Honest-empty with a real
 * entrypoint when nothing's been originated yet.
 */
function OriginationStrip() {
  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["/api/notes"],
  });

  // For an originator, the meaningful figures are the paper they've created:
  // how many active notes, and the principal they originated. The deals that
  // feed origination live on /deals — the real pipeline workspace — so we
  // route there rather than invent a funnel here.
  const originated = useMemo(
    () => notes.filter((n) => n.status === "active").length,
    [notes],
  );
  const totalFinanced = useMemo(
    () =>
      notes
        .filter((n) => n.status === "active")
        .reduce((s, n) => s + Number(n.originalPrincipal || n.currentBalance || 0), 0),
    [notes],
  );

  if (originated === 0) {
    return (
      <div className="px-4 md:px-6 py-3 border-b bg-acr-brand-soft/30">
        <EmptyState
          icon={FileSignature}
          headline="Originate your first note"
          subtitle="Your job is creating paper, not buying it. Set your default rate and term, then turn a sale into a seller-financed note. The pipeline lives on Deals — the map is just where the collateral sits."
          cta={{
            label: "Start an origination",
            href: "/deals?action=new",
            "data-testid": "persona-map-start-origination",
          }}
          secondaryCta={{
            label: "Set origination terms",
            href: "/settings?tab=tax-compliance",
            "data-testid": "persona-map-origination-terms",
          }}
          actionIcon={FileSignature}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <StripShell
      title="Origination pipeline"
      shortTitle="Originate"
      actions={
        <>
          <Button asChild size="sm" className="h-7 text-xs">
            <Link href="/deals?action=new">
              <FileSignature className="w-3 h-3 mr-1" aria-hidden="true" />
              <span className="hidden sm:inline">New origination</span>
              <span className="sm:hidden">Originate</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs hidden md:inline-flex">
            <Link href="/finance">
              <ExternalLink className="w-3 h-3 mr-1" aria-hidden="true" />
              Book
            </Link>
          </Button>
        </>
      }
    >
      <span className="text-sm text-muted-foreground">
        <span className="tabular-nums text-foreground font-medium">{originated}</span>{" "}
        originated
        {totalFinanced > 0 && (
          <span className="hidden md:inline">
            {" · "}
            <span className="font-mono tabular-nums text-foreground font-medium">
              {usd(totalFinanced, { noCents: true })}
            </span>{" "}
            financed
          </span>
        )}
      </span>
    </StripShell>
  );
}

// ── Servicing book (note_servicer) ───────────────────────────────────────────

/**
 * A servicer doesn't OWN the collateral — they service notes for others. The
 * map is a locator, not their workspace, so we de-emphasize it and lead with
 * the operational signal that matters: how many notes are in the serviced
 * book and which is most delinquent. Direct remind / payoff actions on the
 * most-delinquent entry. Honest-empty with a serviced-book import entrypoint.
 */
function ServicingStrip({ propertyLabel }: { propertyLabel: string }) {
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
          icon={ClipboardCheck}
          headline="Import the book you service"
          subtitle="You service notes for others — start by importing the serviced book, then set your servicing fee and escrow handling. Collateral appears on the map color-coded by days late, but the book is where you work."
          cta={{
            label: "Import serviced book",
            href: "/notes?action=new",
            "data-testid": "persona-map-import-serviced",
          }}
          secondaryCta={{
            label: "Fee & escrow setup",
            href: "/settings?tab=tax-compliance",
            "data-testid": "persona-map-fee-escrow",
          }}
          actionIcon={ClipboardCheck}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <StripShell
      title="Servicing book"
      shortTitle="Servicing"
      actions={
        worstLate ? (
          <>
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <Link href="/finance">
                <Send className="w-3 h-3 mr-1" aria-hidden="true" />
                <span className="hidden sm:inline">Send reminder</span>
                <span className="sm:hidden">Remind</span>
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <Link href="/finance">
                <Wallet className="w-3 h-3 mr-1" aria-hidden="true" />
                <span className="hidden md:inline">Pull payoff</span>
                <span className="md:hidden">Payoff</span>
              </Link>
            </Button>
          </>
        ) : (
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href="/finance">
              <ExternalLink className="w-3 h-3 mr-1" aria-hidden="true" />
              <span className="hidden sm:inline">Open book</span>
              <span className="sm:hidden">Book</span>
            </Link>
          </Button>
        )
      }
    >
      <span className="text-sm text-muted-foreground hidden md:inline">
        <span className="tabular-nums text-foreground font-medium">{activeNotes.length}</span>{" "}
        {propertyLabel.toLowerCase()} serviced
      </span>
      {worstLate ? (
        <span className="flex items-center gap-1.5 min-w-0">
          <AlertTriangle
            className="w-3.5 h-3.5 text-acr-neg shrink-0"
            aria-hidden="true"
          />
          <span className="text-sm truncate">
            Most delinquent:{" "}
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
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-acr-pos">
          <PiggyBank className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="md:hidden tabular-nums">{activeNotes.length} serviced ·</span>
          All current
        </span>
      )}
    </StripShell>
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
          headline={`No ${leadLabel.toLowerCase()}s captured yet`}
          subtitle={`Curb-capture pins appear here as you drive your route. Launch DriveMode to start tagging.`}
          cta={{
            label: "Launch DriveMode",
            onClick: () => { window.location.href = "/drivemode"; },
            "data-testid": "persona-map-launch-drivemode",
          }}
          actionIcon={Navigation}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <StripShell
      title="Curb capture"
      shortTitle="Curb"
      actions={
        <>
          <Button asChild size="sm" className="h-7 text-xs">
            <Link href="/drivemode">
              <Navigation className="w-3 h-3 mr-1" aria-hidden="true" />
              <span className="hidden sm:inline">Launch DriveMode</span>
              <span className="sm:hidden">DriveMode</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs hidden md:inline-flex">
            <Link href="/leads?type=seller">
              <ExternalLink className="w-3 h-3 mr-1" aria-hidden="true" />
              {leadLabel}s
            </Link>
          </Button>
        </>
      }
    >
      <span className="text-sm text-muted-foreground">
        <span className="tabular-nums">{motivated.length}</span>{" "}
        {leadLabel.toLowerCase()}{motivated.length === 1 ? "" : "s"} pinned
      </span>
    </StripShell>
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
          headline={`No ${projectPluralLabel.toLowerCase()} yet`}
          subtitle={`Add a ${projectLabel.toLowerCase()} to see acquisitions, renovations, and listings on the same map.`}
          cta={{
            label: `Add ${projectLabel.toLowerCase()}`,
            onClick: () => { window.location.href = "/properties?action=new"; },
            "data-testid": "persona-map-add-property",
          }}
          actionIcon={null}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <StripShell
      title="Inventory + projects"
      shortTitle="Inventory"
      actions={
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <Link href="/properties">
            <Hammer className="w-3 h-3 mr-1" aria-hidden="true" />
            <span className="hidden sm:inline">{projectPluralLabel}</span>
            <span className="sm:hidden">List</span>
          </Link>
        </Button>
      }
    >
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
    </StripShell>
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
