/**
 * ParcelInspector — Wave 2.3 click-to-identify.
 *
 * Tap a parcel on the Map door; this sheet says what AcreOS ALREADY holds for
 * it — owner, APN, acres, assessed value — with the slice-11 provenance
 * grammar (source + vintage + licence posture), a "Track this parcel" toggle,
 * and quick actions into flows that already exist.
 *
 * ─── What this component refuses to do ──────────────────────────────────────
 *
 *  • It never renders an empty shell. Every miss the resolver can return has
 *    its OWN copy, because they are genuinely different facts about the world.
 *
 *    Which of them a MAP TAP can actually produce is worth stating, because
 *    the first version of this comment implied all four and the wave's audit
 *    found only two were reachable. A tap sends `{lat, lng, apn}` and no
 *    county; the resolver establishes the county server-side from the nearest
 *    parcel we hold. So from a tap: `county-covered-no-parcel`,
 *    `location-unidentified` and `lookup-failed` all occur.
 *    `county-not-covered` does NOT — if we hold nothing near the point we
 *    cannot honestly name the county, and if we do hold something the county
 *    is by definition covered. It is reachable only from a caller that names
 *    a state and county explicitly, which the endpoint accepts. The branch is
 *    kept, correct and tested for that caller rather than deleted.
 *      county-not-covered      → "we do not have parcel data for this county
 *                                 yet" + the existing RequestCountyCTA
 *      county-covered-no-parcel→ we cover it, we just haven't pulled this one
 *      location-unidentified   → we could not tell which parcel was tapped,
 *                                 and we do NOT name a county we never
 *                                 established
 *      lookup-failed           → the read broke; QueryErrorState with retry,
 *                                 never "no data"
 *
 *  • It never shows a blank where a value is missing. An empty column renders
 *    as an explicit "not recorded" line, so a gap in the data reads as a gap
 *    in the data rather than as a gap in the page.
 *
 *  • It never labels a proximity match as containment. When the server matched
 *    by nearest centroid, the sheet says so, with the distance.
 *
 * The track toggle is optimistic (house pattern) with rollback, because the
 * tap must feel instant; the server side is idempotent by unique index, so the
 * optimistic promise is one the database can actually keep.
 */

import { useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { RequestCountyCTA } from "@/components/maps/RequestCountyCTA";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Star, MapPin, FileText, Briefcase, Loader2 } from "lucide-react";

// ─── Wire types (mirror server/services/parcelIdentify.ts) ─────────────────

export type ParcelIdentifyStatus =
  | "identified"
  | "county-covered-no-parcel"
  | "county-not-covered"
  | "location-unidentified"
  | "lookup-failed";

interface ParcelFact {
  key: string;
  label: string;
  value: string | null;
  absence: "not-recorded" | "withheld" | null;
  absenceLabel: string;
}

interface ParcelProvenance {
  source: string;
  retrievedAt: string | null;
  vintageYear: number | null;
  posture: string;
  postureReason: string;
  attribution: string | null;
  mayRedistribute: boolean;
}

export interface ParcelIdentifyResult {
  status: ParcelIdentifyStatus;
  state: string | null;
  county: string | null;
  apn: string | null;
  snapshotId: number | null;
  centroid: { lat: number; lng: number } | null;
  match: {
    by: "apn" | "boundary-contains" | "nearest-centroid";
    distanceMeters?: number;
    approximate: boolean;
  } | null;
  facts: ParcelFact[];
  provenance: ParcelProvenance | null;
  tracked: boolean;
  inspected: string[];
  requestCoverage: { state: string | null; county: string | null } | null;
  message: string;
}

/** The point the customer tapped. */
export interface ParcelIdentifyTarget {
  lat: number;
  lng: number;
  /** Only set when the map already KNEW the parcel's identity. Never guessed. */
  state?: string;
  county?: string;
  apn?: string;
}

const IDENTIFY_ENDPOINT = "/api/parcel-identify";

/**
 * Quick actions. Every `href` is an EXISTING mounted route — the handoff is
 * explicit that the offer flow stays unchanged, so nothing here creates a
 * parallel path. `carriesParcel` records, truthfully, whether the destination
 * actually receives this parcel's context; the sheet says so in the copy
 * rather than implying all three do.
 */
const QUICK_ACTIONS: ReadonlyArray<{
  key: string;
  href: string;
  label: string;
  description: string;
  carriesParcel: boolean;
  icon: typeof MapPin;
}> = [
  {
    key: "inventory",
    href: "/properties",
    label: "Add to inventory",
    description: "Opens Add Property with this parcel's location filled in.",
    carriesParcel: true,
    icon: MapPin,
  },
  {
    key: "deal",
    href: "/deals",
    label: "Start a deal",
    description: "Opens the existing deal flow.",
    carriesParcel: false,
    icon: Briefcase,
  },
  {
    key: "offer",
    href: "/offers",
    label: "Open the offer flow",
    description: "Opens the existing offer flow, unchanged.",
    carriesParcel: false,
    icon: FileText,
  },
];

function buildHref(
  action: (typeof QUICK_ACTIONS)[number],
  result: ParcelIdentifyResult | undefined,
): string {
  if (action.key === "inventory" && result?.centroid) {
    // Real coordinates from the snapshot row — /properties reads exactly these
    // params to pre-populate Add Property. Nothing invented.
    const params = new URLSearchParams({
      addAtLat: String(result.centroid.lat),
      addAtLng: String(result.centroid.lng),
    });
    if (result.county) params.set("addCounty", result.county);
    if (result.state) params.set("addState", result.state);
    return `${action.href}?${params.toString()}`;
  }
  if (action.key === "deal") return `${action.href}?action=new`;
  return action.href;
}

/**
 * Human names for the tables the resolver reports having read. An unknown key
 * is rendered as itself rather than dropped: silently omitting a source we DID
 * check would understate the work, and inventing a friendly name for a source
 * we do not recognise would overstate it.
 */
const SOURCE_NAMES: Record<string, string> = {
  county_gis_endpoints: "our county data sources",
  parcel_snapshots: "the parcel data we already hold",
};

function inspectedSentence(inspected: string[]): string {
  const names = inspected.map((s) => SOURCE_NAMES[s] ?? s);
  if (names.length === 0) return "nothing yet";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function matchNote(result: ParcelIdentifyResult): string | null {
  if (!result.match) return null;
  if (result.match.by === "nearest-centroid") {
    const d = result.match.distanceMeters;
    // Honest: proximity is not containment. Say which one this is.
    return `Nearest parcel we hold${d != null ? `, about ${d} m from where you tapped` : ""} — we don't hold this parcel's boundary, so this is a close match, not a confirmed hit.`;
  }
  if (result.match.by === "boundary-contains") {
    return "Your tap falls inside this parcel's recorded boundary.";
  }
  return null;
}

export interface ParcelInspectorProps {
  target: ParcelIdentifyTarget | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * The county name, for reading rather than for matching.
 *
 * The resolver returns the NORMALIZED county — lower-cased, " County" stripped
 * — because that is the form the match keys and the tracking rows use. Showing
 * it raw leaked an internal key into customer copy: "travis, TX" where the
 * customer expects "Travis County, TX". The normalized value stays the key;
 * this is only what we print.
 */
function countyLabel(county: string | null): string {
  if (!county) return "";
  const titled = county
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return /\bcounty$/i.test(titled) ? titled : `${titled} County`;
}

export function ParcelInspector({ target, onOpenChange }: ParcelInspectorProps) {
  const { toast } = useToast();
  const { isMobile } = useIsMobile();
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => [
      IDENTIFY_ENDPOINT,
      target?.lat ?? null,
      target?.lng ?? null,
      target?.apn ?? null,
      target?.state ?? null,
      target?.county ?? null,
    ],
    [target],
  );

  const identify = useQuery<ParcelIdentifyResult>({
    queryKey,
    enabled: Boolean(target),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (target?.apn) params.set("apn", target.apn);
      if (target?.state) params.set("state", target.state);
      if (target?.county) params.set("county", target.county);
      if (target) {
        params.set("lat", String(target.lat));
        params.set("lng", String(target.lng));
      }
      const res = await apiRequest("GET", `${IDENTIFY_ENDPOINT}?${params.toString()}`);
      return (await res.json()) as ParcelIdentifyResult;
    },
    staleTime: 60_000,
  });

  const result = identify.data;
  const canTrack = Boolean(result?.state && result?.county && result?.apn);

  /**
   * Optimistic track/untrack. The tap flips the badge immediately and rolls
   * back on failure; the server is idempotent by unique index, so a double-tap
   * cannot produce a second row and the optimistic state cannot diverge.
   */
  const toggleTrack = useMutation({
    mutationFn: async (next: boolean) => {
      const body = {
        state: result!.state,
        county: result!.county,
        apn: result!.apn,
        ...(next && result?.snapshotId ? { parcelSnapshotId: result.snapshotId } : {}),
      };
      const res = await apiRequest(
        "POST",
        next ? "/api/tracked-parcels" : "/api/tracked-parcels/untrack",
        body,
      );
      return res.json();
    },
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ParcelIdentifyResult>(queryKey);
      if (previous) {
        queryClient.setQueryData<ParcelIdentifyResult>(queryKey, {
          ...previous,
          tracked: next,
        });
      }
      return { previous };
    },
    onError: (_err, _next, context) => {
      // Roll back to exactly what we showed before the tap.
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast({
        title: "Couldn't update tracking",
        description: "Nothing changed. Try again in a moment.",
        variant: "destructive",
      });
    },
    onSuccess: (_data, next) => {
      toast({
        title: next ? "Tracking this parcel" : "Stopped tracking",
        // Says what the product can actually show. There is no tracked-list
        // screen yet, so promising "your tracked list" named a surface that
        // does not exist — small, but it is the same class of claim this
        // codebase keeps having to take back out.
        description: next
          ? "We'll show it as tracked whenever you open this parcel."
          : "No longer tracked.",
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const title = result?.apn ? `Parcel ${result.apn}` : "Parcel";
  const place =
    result?.county && result?.state
      ? `${countyLabel(result.county)}, ${result.state}`
      : target
        ? `${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`
        : "";

  return (
    <Sheet open={Boolean(target)} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn("overflow-y-auto", isMobile ? "h-[85vh]" : "w-full sm:max-w-md")}
        data-testid="parcel-inspector"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{place}</SheetDescription>
        </SheetHeader>

        {/* Loading — Skeleton shaped like the fact list it replaces. */}
        {identify.isLoading && (
          <div className="mt-6 space-y-3" data-testid="parcel-inspector-loading">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-9 w-full mt-6" />
          </div>
        )}

        {/* A failed read is a failure, never an absence of data. */}
        {identify.isError && (
          <div className="mt-6">
            <QueryErrorState
              error={identify.error instanceof Error ? identify.error : null}
              onRetry={() => void identify.refetch()}
              isRetrying={identify.isFetching}
              title="Couldn't read this parcel"
              description="We couldn't reach the parcel data just now, so we can't say what we hold. Your map is unaffected."
              testId="parcel-inspector-error"
            />
          </div>
        )}

        {result && !identify.isLoading && !identify.isError && (
          <div className="mt-6 space-y-6">
            {result.status === "identified" && (
              <>
                {matchNote(result) && (
                  <p
                    className="text-micro text-muted-foreground"
                    data-testid="parcel-inspector-match-note"
                  >
                    {matchNote(result)}
                  </p>
                )}

                <dl className="space-y-3" data-testid="parcel-inspector-facts">
                  {result.facts.map((fact) => (
                    <div key={fact.key} className="flex items-baseline justify-between gap-4">
                      <dt className="text-sm text-muted-foreground shrink-0">{fact.label}</dt>
                      {fact.value !== null ? (
                        <dd className="text-sm font-medium text-right">{fact.value}</dd>
                      ) : (
                        /* A gap in the data reads as a gap in the data. */
                        <dd
                          className="text-sm text-muted-foreground italic text-right"
                          data-testid={`parcel-fact-absent-${fact.key}`}
                        >
                          {fact.absenceLabel}
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>

                {result.provenance && (
                  <div className="space-y-2 border-t pt-4">
                    <DataProvenanceChip
                      source={result.provenance.source}
                      sourceAsOf={
                        result.provenance.vintageYear
                          ? String(result.provenance.vintageYear)
                          : null
                      }
                      retrievedAt={result.provenance.retrievedAt}
                    />
                    {!result.provenance.mayRedistribute && (
                      <p className="text-micro text-muted-foreground">
                        Yours to work with inside AcreOS. {result.provenance.postureReason} —
                        so it isn't included when you export or send this parcel onward.
                      </p>
                    )}
                    {result.provenance.attribution && (
                      <p className="text-micro text-muted-foreground">
                        {result.provenance.attribution}
                      </p>
                    )}
                  </div>
                )}

                <div className="border-t pt-4 space-y-3">
                  <Button
                    className="w-full"
                    variant={result.tracked ? "outline" : "default"}
                    disabled={!canTrack || toggleTrack.isPending}
                    onClick={() => toggleTrack.mutate(!result.tracked)}
                    aria-label={
                      result.tracked
                        ? "Stop tracking this parcel"
                        : "Track this parcel"
                    }
                    data-testid="button-track-parcel"
                  >
                    {toggleTrack.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                    ) : (
                      <Star
                        className={cn("h-4 w-4 mr-2", result.tracked && "fill-current")}
                        aria-hidden="true"
                      />
                    )}
                    {result.tracked ? "Tracking this parcel" : "Track this parcel"}
                  </Button>

                  {/* Each action states, on its own row, what it actually
                      does with this parcel. A column of buttons that all LOOK
                      parcel-aware would be an implied claim about two of them
                      that is not true, so the sentence is DERIVED from
                      `carriesParcel` (and from whether we hold coordinates at
                      all) rather than written once and hoped to stay right. */}
                  <ul className="grid gap-2" data-testid="parcel-inspector-actions">
                    {QUICK_ACTIONS.map((action) => {
                      const Icon = action.icon;
                      const carries = action.carriesParcel && Boolean(result.centroid);
                      return (
                        <li key={action.key} className="space-y-1">
                          <Button
                            asChild
                            variant="outline"
                            className="w-full justify-start"
                          >
                            <Link href={buildHref(action, result)}>
                              <Icon className="h-4 w-4 mr-2" aria-hidden="true" />
                              {action.label}
                            </Link>
                          </Button>
                          <p
                            className="text-micro text-muted-foreground"
                            data-testid={`parcel-action-note-${action.key}`}
                          >
                            {carries
                              ? action.description
                              : action.carriesParcel
                                ? "We don't hold coordinates for this parcel, so this opens the flow without a location."
                                : action.description}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}

            {/* County we genuinely do not cover — verified against BOTH the
                endpoint register and the snapshot cache before we say it. */}
            {result.status === "county-not-covered" && (
              <div className="space-y-4" data-testid="parcel-inspector-no-county">
                <p className="text-sm">{result.message}</p>
                {/* "We checked X" is itself a claim. It is rendered from the
                    server's `inspected` list — the reads that actually ran —
                    so it can never name a source nobody looked at. If the
                    resolver ever stops checking one of them, this sentence
                    shrinks with it instead of continuing to promise both. */}
                <p className="text-micro text-muted-foreground">
                  We checked {inspectedSentence(result.inspected)} for{" "}
                  {countyLabel(result.county)}, {result.state}.
                </p>
                <RequestCountyCTA
                  defaultState={result.requestCoverage?.state ?? ""}
                  defaultCounty={result.requestCoverage?.county ?? ""}
                  compact
                  className="w-full text-left"
                />
              </div>
            )}

            {result.status === "county-covered-no-parcel" && (
              <div className="space-y-3" data-testid="parcel-inspector-no-parcel">
                <Badge variant="outline">County covered</Badge>
                <p className="text-sm">{result.message}</p>
              </div>
            )}

            {result.status === "location-unidentified" && (
              <div className="space-y-4" data-testid="parcel-inspector-unidentified">
                <p className="text-sm">{result.message}</p>
                {/* No county was established, so the CTA opens blank rather
                    than prefilled with a guess. */}
                <RequestCountyCTA compact className="w-full text-left" />
              </div>
            )}

            {result.status === "lookup-failed" && (
              <div className="mt-2">
                <QueryErrorState
                  error={identify.error ?? null}
                  onRetry={() => void identify.refetch()}
                  isRetrying={identify.isFetching}
                  title="Couldn't read this parcel"
                  description={result.message}
                  testId="parcel-inspector-lookup-failed"
                />
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default ParcelInspector;
