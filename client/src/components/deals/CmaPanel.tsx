/**
 * CmaPanel — the agent_investor Comparative Market Analysis, behind the Deals door.
 *
 * A licensed agent's subject is residential real estate, so the CMA (sold house
 * comps + an AVM) rides the EXISTING ATTOM residential seam via
 * GET /api/deals/:id/cma (server/routes-deals.ts → server/services/
 * residentialComps.ts). No new data plane, vendor, or nav entry — this is a
 * section inside an existing door (2026-08 founder decision reclassifying
 * agent_investor as residential-routed).
 *
 * HONESTY (refuse-not-fabricate): when the org has no ATTOM connection the
 * endpoint returns { status: "unavailable", reason: "attom_not_connected" }.
 * This panel renders that as an honest EmptyState pointing at the real settings
 * surface — it NEVER shows an invented comp, AVM, or CMA number. The lookup is
 * a paid/BYO call, so it is button-triggered rather than firing on mount.
 *
 * Self-gates: renders only for agent_investor orgs; returns null otherwise.
 */
import { useState } from "react";
import { RequiredDisclaimer } from "@/components/required-disclaimer";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Home, MapPin, PlugZap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useOrganization } from "@/hooks/use-organization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { usd } from "@/lib/format";

interface CmaComp {
  address: string | null;
  city: string | null;
  state: string | null;
  salePrice: number | null;
  saleDate: string | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  lotAcres: number | null;
  distanceMiles: number | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string | null;
}

interface CmaValuation {
  value: number;
  low: number | null;
  high: number | null;
  score: number | null;
  asOf: string | null;
}

interface CmaSubject {
  propertyId: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
}

type CmaResponse =
  | {
      status: "ok";
      comps: CmaComp[];
      valuation: CmaValuation | null;
      subject: CmaSubject;
      credentialSource: "organization" | "platform";
      provenance: string;
    }
  | {
      status: "unavailable" | "no_data";
      reason: string;
      message: string;
      comps: [];
      valuation: null;
      subject: CmaSubject | null;
    };

export function CmaPanel({ dealId }: { dealId: number }) {
  const { data: org } = useOrganization();
  const businessType = org?.onboardingData?.businessType;
  const [ran, setRan] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<CmaResponse>({
    queryKey: [`/api/deals/${dealId}/cma`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/deals/${dealId}/cma`);
      return res.json() as Promise<CmaResponse>;
    },
    enabled: ran,
    retry: false,
  });

  // Persona gate LAST (after hooks): CMA is the agent_investor surface.
  if (businessType !== "agent_investor") return null;

  return (
    <Card data-testid="cma-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
          Comparative Market Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!ran ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pull sold comparables and an AVM for this deal&apos;s subject property from your
              connected ATTOM / MLS data. Comps and valuation lookups draw on your credits, or run
              free on your own connected ATTOM key.
            </p>
            <Button onClick={() => setRan(true)} data-testid="button-run-cma">
              <BarChart3 className="mr-2 h-4 w-4" aria-hidden="true" />
              Run CMA
            </Button>
          </div>
        ) : isLoading || isFetching ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Running comparative market analysis…</span>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        ) : isError ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            title="Couldn't run the CMA"
            testId="error-state-cma"
          />
        ) : data && data.status === "ok" ? (
          <CmaResult data={data} />
        ) : data ? (
          // Honest degradation: ATTOM not connected, no coverage, or no subject.
          <EmptyState
            icon={PlugZap}
            headline="Connect your ATTOM / MLS data source to run a CMA"
            subtitle={data.message}
            actionIcon={null}
            cta={{
              label: "Open provider keys",
              href: "/settings/byok",
              "data-testid": "cma-connect-cta",
            }}
            testId="cma-unavailable"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function CmaResult({
  data,
}: {
  data: Extract<CmaResponse, { status: "ok" }>;
}) {
  const { comps, valuation, subject, credentialSource, provenance } = data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <MapPin className="h-3 w-3" aria-hidden="true" />
          {subject.address
            ? `${subject.address}${subject.city ? `, ${subject.city}` : ""}${subject.state ? `, ${subject.state}` : ""}`
            : "Subject property"}
        </Badge>
        <Badge variant="secondary">
          {credentialSource === "organization" ? "Your ATTOM key" : "Platform credits"}
        </Badge>
      </div>

      {/* AVM — the CMA headline. Null when ATTOM returned no usable value. */}
      {valuation ? (
        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">Estimated value (ATTOM AVM)</p>
          <p className="mt-1 text-2xl font-bold font-mono tabular-nums" data-testid="cma-avm-value">
            {usd(valuation.value, { noCents: true })}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {valuation.low !== null && valuation.high !== null && (
              <span className="tabular-nums">
                Range {usd(valuation.low, { noCents: true })} – {usd(valuation.high, { noCents: true })}
              </span>
            )}
            {valuation.score !== null && <span>Confidence {valuation.score}/100</span>}
            {valuation.asOf && <span>As of {valuation.asOf}</span>}
          </div>
        </div>
      ) : (
        <div
          className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground"
          role="status"
        >
          ATTOM returned no AVM for this property. The comps below stand on their own — no value
          is estimated.
        </div>
      )}

      {/* Sold comparables. Empty is stated honestly, never zero-filled. */}
      {comps.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground"
          role="status"
        >
          ATTOM returned no comparable sales for this subject. Nothing is fabricated to fill the
          gap.
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {comps.length} comparable {comps.length === 1 ? "sale" : "sales"}
          </p>
          <ul className="space-y-2">
            {comps.map((comp, i) => (
              <li
                key={`${comp.address ?? "comp"}-${i}`}
                className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                data-testid={`cma-comp-${i}`}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <Home className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {comp.address ?? "Address withheld"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {comp.sqft !== null && <span>{comp.sqft.toLocaleString()} sqft</span>}
                    {comp.bedrooms !== null && <span>{comp.bedrooms} bd</span>}
                    {comp.bathrooms !== null && <span>{comp.bathrooms} ba</span>}
                    {comp.distanceMiles !== null && <span>{comp.distanceMiles.toFixed(1)} mi</span>}
                    {comp.saleDate && <span>Sold {comp.saleDate}</span>}
                  </div>
                </div>
                <p className="shrink-0 font-mono tabular-nums text-sm font-semibold">
                  {comp.salePrice !== null ? usd(comp.salePrice, { noCents: true }) : "—"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{provenance}</p>
      <RequiredDisclaimer type="valuation" className="mt-3" />
    </div>
  );
}
