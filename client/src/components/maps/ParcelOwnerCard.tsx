/**
 * ParcelOwnerCard — the click-a-parcel owner lookup, as the map's detail card.
 *
 * A map surface (PropertyMap, SinglePropertyMap / Drive Mode) hands this a
 * `pick` (the parcel the user tapped) and it runs `useParcelLookup` for it and
 * renders what the provider chain returned — owner plus parcel facts — or an
 * honest "not covered" state. It never guesses, never fills a blank owner:
 *   - 404 from /api/parcels/lookup  → "Owner lookup isn't covered here"
 *   - owner null in a found parcel  → "This source doesn't name an owner"
 *   - any other failure             → "Couldn't look it up", with a retry
 *
 * The lookup is the existing read endpoint; the server chain (BYO Regrid key,
 * free county data, the statewide lookup gate) is not touched or bypassed.
 */

import { useEffect, type ReactNode } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Verbs } from "@/lib/labels";
import {
  useParcelLookup,
  isParcelNotCovered,
  type ParcelLookupRequest,
} from "@/hooks/use-parcels";

/** The parcel the user picked on the map. */
export interface ParcelPick {
  /** Parcel identifier when the clicked feature carried one. */
  apn?: string;
  /** Where on the map the user clicked (or the parcel's centroid). */
  lat: number;
  lng: number;
  /** Region of the map's property, when known — lets an APN resolve by county. */
  state?: string;
  county?: string;
}

/**
 * The lookup request for a pick. An APN is sent only together with state AND
 * county (the endpoint builds a county path from the pair); otherwise the
 * click coordinate is the honest identifier.
 */
export function parcelLookupRequestFor(pick: ParcelPick): ParcelLookupRequest {
  if (pick.apn && pick.state && pick.county) {
    return { apn: pick.apn, state: pick.state, county: pick.county };
  }
  return { lat: pick.lat, lng: pick.lng };
}

function pickKey(pick: ParcelPick): string {
  return `${pick.apn ?? ""}|${pick.lat}|${pick.lng}|${pick.state ?? ""}|${pick.county ?? ""}`;
}

function money(v: number | string | undefined): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? `$${Math.round(v).toLocaleString()}` : null;
  return v;
}

interface ParcelOwnerCardProps {
  pick: ParcelPick;
  onClose: () => void;
  /** Called with the county/state a successful lookup resolved. */
  onResolved?: (region: { state?: string; county?: string }) => void;
  /** Smaller type and tighter padding for the Drive Mode surface. */
  compact?: boolean;
  className?: string;
}

export function ParcelOwnerCard({ pick, onClose, onResolved, compact, className }: ParcelOwnerCardProps) {
  const lookup = useParcelLookup();
  const { mutate } = lookup;
  const key = pickKey(pick);

  useEffect(() => {
    mutate(parcelLookupRequestFor(pick));
    // The key captures every field of `pick` that shapes the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mutate]);

  const parcel = lookup.data;
  useEffect(() => {
    if (parcel && onResolved) {
      onResolved({ state: parcel.data.state, county: parcel.data.county });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcel]);

  const text = "text-sm";
  const notCovered = lookup.isError && isParcelNotCovered(lookup.error);

  let body: ReactNode;
  if (lookup.isPending || lookup.isIdle) {
    body = (
      <div className="space-y-2" role="status" aria-busy="true" aria-label="Looking up parcel owner">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-3 w-32" />
        <span className="sr-only">Looking up owner…</span>
      </div>
    );
  } else if (notCovered) {
    body = (
      <div data-testid="parcel-owner-not-covered" role="status" className="space-y-1">
        <p className={`${text} font-medium`}>Owner lookup isn't covered here</p>
        <p className="text-xs text-muted-foreground">
          This spot isn't in our free county data, and no connected Regrid key has a record for it.
          Add your own Regrid key in Settings → Integrations to extend coverage. No owner is shown
          because none was found.
        </p>
      </div>
    );
  } else if (lookup.isError) {
    body = (
      <div data-testid="parcel-owner-error" role="alert" className="space-y-2">
        <p className={`${text} font-medium`}>Couldn't look up this parcel</p>
        <p className="text-xs text-muted-foreground">
          The lookup failed — this isn't the same as "no coverage". Try again.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => mutate(parcelLookupRequestFor(pick))}>
          {Verbs.RETRY}
        </Button>
      </div>
    );
  } else if (parcel) {
    const d = parcel.data;
    const owner = d.owner && d.owner.trim() ? d.owner.trim() : null;
    const facts: Array<[string, string]> = [];
    facts.push(["APN", parcel.apn]);
    if (d.acres != null) facts.push(["Acres", String(d.acres)]);
    if (d.county || d.state) facts.push(["Location", [d.county, d.state].filter(Boolean).join(", ")]);
    const assessed = money(d.assessedValue);
    if (assessed) facts.push(["Assessed", assessed]);
    const lastSale = money(d.lastSalePrice);
    if (lastSale) facts.push(["Last sale", lastSale]);
    if (d.taxAmount) facts.push(["Annual tax", d.taxAmount]);
    body = (
      <div data-testid="parcel-owner-result" className="space-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Owner of record</p>
          {owner ? (
            <p className={`${text} font-semibold`} data-testid="parcel-owner-name">{owner}</p>
          ) : (
            <p className={`${text} font-medium`} data-testid="parcel-owner-unnamed">
              This source doesn't name an owner for this parcel
            </p>
          )}
          {owner && d.ownerAddress ? (
            <p className="text-xs text-muted-foreground">{d.ownerAddress}</p>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium text-right break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  } else {
    body = <div />;
  }

  return (
    <Card className={className} data-testid="parcel-owner-card">
      <CardContent className={compact ? "p-3" : "p-4"}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {lookup.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Parcel owner
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close parcel owner"
            className="h-8 w-8 -mr-2 -mt-2 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="parcel-owner-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {body}
      </CardContent>
    </Card>
  );
}
