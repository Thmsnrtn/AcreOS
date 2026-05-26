/**
 * MobilePropertyDetail — phone-shaped /parcels/:id.
 *
 * Compresses the desktop parcel page (overview / due-diligence /
 * financial / map / docs) into a single mobile scroll:
 *
 *   1) Hero — APN, address, status pill, acres
 *   2) Action row — Maps · Comps · Owner (call seller) · Listing
 *   3) Financial card — assessed / market / list price
 *   4) Land status row — utilities + road access pill grid
 *   5) Status changer — single-tap pipeline advance
 *
 * Maps button deep-links into Apple Maps with the parcel address (or
 * lat/lng when present). Comps button navigates to the existing
 * /properties/:id/comps surface — the comp pull itself is server-side.
 */

import { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Map as MapIcon,
  Building2,
  Phone,
  ExternalLink,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PropertyDetail {
  id: number;
  apn?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  sizeAcres?: string | number | null;
  status?: string | null;
  zoning?: string | null;
  terrain?: string | null;
  roadAccess?: string | null;
  utilities?: {
    electric?: boolean;
    water?: boolean;
    sewer?: boolean;
    gas?: boolean;
  } | null;
  assessedValue?: string | number | null;
  marketValue?: string | number | null;
  purchasePrice?: string | number | null;
  listPrice?: string | number | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  sellerId?: number | null;
}

const PROPERTY_STATUSES = [
  "prospect",
  "due_diligence",
  "offer_sent",
  "under_contract",
  "owned",
  "listed",
  "sold",
] as const;

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function StatusPill({ status }: { status?: string | null }) {
  const s = (status ?? "prospect").toLowerCase();
  const tone =
    s === "sold" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    : s === "owned" || s === "listed" ? "bg-primary/15 text-primary"
    : s === "under_contract" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    : "bg-muted text-foreground";
  return (
    <Badge variant="secondary" className={`uppercase tracking-wide text-[10px] ${tone}`}>
      {s.replace(/_/g, " ")}
    </Badge>
  );
}

interface Props {
  propertyId: number;
}

export function MobilePropertyDetail({ propertyId }: Props) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery<PropertyDetail | null>({
    queryKey: [`/api/properties/${propertyId}`],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch property");
      const json = await res.json();
      // Endpoint may return { data } envelope or raw object.
      return (json?.data ?? json) as PropertyDetail;
    },
  });

  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const statusMut = useMutation({
    mutationFn: async (next: string) => {
      const res = await apiRequest("PUT", `/api/properties/${propertyId}`, {
        status: next,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/properties/${propertyId}`] });
      qc.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Status updated" });
      setPendingStatus(null);
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't update status",
        description: err?.message ?? "Try again later.",
        variant: "destructive",
      });
      setPendingStatus(null);
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background px-4 pt-16 pb-24 space-y-4" aria-busy="true">
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    // data === null specifically means the server returned 404 — the
    // parcel was deleted or the URL is wrong. error means the request
    // itself failed (network, auth, 500). Different remedies.
    const isNotFound = !error && data === null;
    return (
      <div className="min-h-[100dvh] bg-background px-4 pt-16 flex flex-col items-center justify-center text-center">
        <h2 className="text-lg font-semibold">
          {isNotFound ? "Parcel not found" : "Couldn't load parcel"}
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {isNotFound
            ? "This parcel was removed or the link is wrong."
            : "Network or session issue. Try again, or pick another parcel."}
        </p>
        {!isNotFound && (
          <Button variant="outline" className="mt-4" onClick={() => refetch()}>
            Try again
          </Button>
        )}
        <Link href="/properties" className="text-sm text-primary mt-3">
          ← All properties
        </Link>
      </div>
    );
  }

  const addressLine = [data.address, data.city, data.state, data.zip]
    .filter(Boolean)
    .join(", ");
  const mapsHref = data.latitude && data.longitude
    ? `https://maps.apple.com/?q=${data.latitude},${data.longitude}`
    : addressLine
      ? `https://maps.apple.com/?q=${encodeURIComponent(addressLine)}`
      : data.apn && data.county && data.state
        ? `https://maps.apple.com/?q=${encodeURIComponent(`APN ${data.apn} ${data.county} County, ${data.state}`)}`
        : null;
  const acres = typeof data.sizeAcres === "string" ? Number(data.sizeAcres) : data.sizeAcres ?? 0;

  return (
    <div className="min-h-[100dvh] bg-background pb-24" data-testid="mobile-property-detail">
      <header
        className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border px-2 py-2 flex items-center"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      >
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else setLocation("/properties");
          }}
          aria-label="Back"
          className="h-10 w-10 flex items-center justify-center rounded-full active:bg-muted/60"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 text-center font-medium truncate px-2">
          {data.apn ?? `Property #${data.id}`}
        </div>
        <Link
          href={`/parcels/${data.id}?desktop=1`}
          className="h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground active:bg-muted/60"
          aria-label="Open full desktop view"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      </header>

      <div className="px-4 pt-4 space-y-4">
        {/* Hero */}
        <section>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            {data.apn ?? `Property #${data.id}`}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <StatusPill status={data.status} />
            {Number.isFinite(acres) && acres > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {acres.toFixed(2)} ac
              </Badge>
            )}
            {data.zoning && <Badge variant="outline">{data.zoning}</Badge>}
          </div>
          {addressLine && (
            <div className="text-sm text-muted-foreground mt-2">
              {addressLine}
            </div>
          )}
          {data.county && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {data.county} County
            </div>
          )}
        </section>

        {/* Actions */}
        <section className="grid grid-cols-3 gap-2" aria-label="Property actions">
          <ActionTile
            label="Map"
            icon={<MapIcon className="h-5 w-5" />}
            href={mapsHref ?? undefined}
            disabled={!mapsHref}
            external
            testId="mobile-property-map"
          />
          <ActionTile
            label="Comps"
            icon={<Building2 className="h-5 w-5" />}
            onClick={() => setLocation(`/parcels/${data.id}?desktop=1#comps`)}
            testId="mobile-property-comps"
          />
          <ActionTile
            label="Seller"
            icon={<Phone className="h-5 w-5" />}
            onClick={() =>
              data.sellerId
                ? setLocation(`/leads/${data.sellerId}`)
                : toast({ title: "No seller linked to this parcel" })
            }
            disabled={!data.sellerId}
            testId="mobile-property-seller"
          />
        </section>

        {/* Financial */}
        <Card className="p-3">
          <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1">
            Financial
          </h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Assessed" value={fmtMoney(data.assessedValue)} />
            <Stat label="Market" value={fmtMoney(data.marketValue)} />
            <Stat label="List" value={fmtMoney(data.listPrice)} />
          </div>
          {data.purchasePrice && (
            <div className="text-[11px] text-muted-foreground mt-2 text-center">
              Purchased at {fmtMoney(data.purchasePrice)}
            </div>
          )}
        </Card>

        {/* Land status */}
        {(data.utilities || data.roadAccess || data.terrain) && (
          <Card className="p-3">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1">
              Land status
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {data.roadAccess && (
                <Badge variant="outline" className="text-[11px]">
                  {data.roadAccess} access
                </Badge>
              )}
              {data.terrain && (
                <Badge variant="outline" className="text-[11px]">
                  {data.terrain}
                </Badge>
              )}
              {data.utilities &&
                (
                  ["electric", "water", "sewer", "gas"] as const
                ).map((u) =>
                  data.utilities?.[u] ? (
                    <Badge key={u} variant="secondary" className="text-[11px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 mr-0.5" />
                      {u}
                    </Badge>
                  ) : null,
                )}
            </div>
          </Card>
        )}

        {/* Status changer */}
        <Card className="p-3">
          <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1">
            Pipeline status
          </h2>
          <Select
            value={pendingStatus ?? data.status ?? "prospect"}
            onValueChange={(v) => {
              setPendingStatus(v);
              statusMut.mutate(v);
            }}
            disabled={statusMut.isPending}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROPERTY_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {statusMut.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Updating…
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums mt-0.5">
        {value}
      </div>
    </div>
  );
}

function ActionTile({
  label,
  icon,
  href,
  onClick,
  disabled,
  external,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  external?: boolean;
  testId?: string;
}) {
  const base =
    "flex flex-col items-center justify-center gap-1 h-16 rounded-xl text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (disabled) {
    return (
      <div
        className={`${base} bg-muted/40 text-muted-foreground/60 cursor-not-allowed`}
        aria-disabled
        data-testid={testId}
      >
        {icon}
        {label}
      </div>
    );
  }
  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className={`${base} bg-primary/10 text-primary active:bg-primary/20`}
        data-testid={testId}
      >
        {icon}
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} bg-primary/10 text-primary active:bg-primary/20`}
      data-testid={testId}
    >
      {icon}
      {label}
    </button>
  );
}

export default MobilePropertyDetail;

export function MobilePropertyDetailRoute() {
  const [, params] = useRoute<{ id: string }>("/parcels/:id");
  const id = params?.id ? parseInt(params.id, 10) : NaN;
  if (!id || Number.isNaN(id)) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 text-center gap-3">
        <h2 className="text-base font-semibold">Bad parcel URL</h2>
        <p className="text-sm text-muted-foreground">
          That link doesn't point to a valid parcel. Open the properties
          list to pick one.
        </p>
        <Link href="/properties" className="text-sm text-primary">
          ← All properties
        </Link>
      </div>
    );
  }
  return <MobilePropertyDetail propertyId={id} />;
}
