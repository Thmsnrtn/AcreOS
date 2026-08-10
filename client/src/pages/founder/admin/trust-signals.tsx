/**
 * Trust & abuse signals — a tab of the /founder/admin/telemetry instrument hub.
 *
 * X-A slice 2. This panel SHOWS; it does not DO. Read this before editing:
 *
 *   • Every cap it renders is a PROPOSAL awaiting a founder ruling
 *     (docs/proposals/x-a-send-chokepoint-caps.md). The sentence saying so is
 *     served by the API (`enforcementStatus`) and rendered verbatim, so the
 *     surface cannot soften it independently of the server.
 *   • Nothing here changes an org's trust tier. There is no control that
 *     could: no mutation exists, and a tier change is a founder act.
 *   • A signal with no substrate behind it renders as "not measured" with the
 *     reason. It NEVER renders as 0. A zero on this page means a real table
 *     was queried and had no matching rows.
 *
 * It lives as a TAB, not a route: the founder surface is four doors plus the
 * /founder/admin/* instrument namespace, and the route count only shrinks.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ChevronDown, ChevronRight, ScrollText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

type SignalAvailability = "available" | "unavailable" | "read_failed";

interface TrustSignal {
  key: string;
  label: string;
  sourceTable: string | null;
  availability: SignalAvailability;
  count: number | null;
  windowDays: number | null;
  note: string;
  capKey?: string;
}

interface ProposedCap {
  key: string;
  value: number;
  status: "consumed" | "proposed";
}

interface TrustEvidence {
  reviewRecommended: boolean;
  exceeded: string[];
  awaitingThreshold: string[];
  notMeasured: string[];
}

interface TrustOrgRow {
  organizationId: number;
  name: string;
  isFounderOrg: boolean;
  trustTier: string;
  trustTierStored: string | null;
  signals: TrustSignal[];
  proposedCaps: ProposedCap[];
  evidence: TrustEvidence;
}

interface TrustSignalsResponse {
  asOf: string;
  windowDays: number;
  orgCount: number;
  orgLimit: number;
  enforcementStatus: string;
  proposalPath: string;
  orgs: TrustOrgRow[];
}

/** Columns surfaced inline; the rest of the catalog opens in the detail row. */
const SUMMARY_KEYS = [
  { key: "abuse_reports_open", head: "Open reports" },
  { key: "spam_complaints_window", head: "Complaints" },
  { key: "bounce_suppressions_window", head: "Bounces" },
  { key: "active_portal_links", head: "Live links" },
] as const;

/**
 * The single rule this file exists to hold: an unmeasured signal is words, a
 * measured one is a number. They must never be able to look like each other.
 */
function SignalValue({ signal }: { signal: TrustSignal }) {
  if (signal.availability === "available" && signal.count !== null) {
    return (
      <span className={signal.count > 0 ? "font-medium text-foreground" : "text-muted-foreground"}>
        {signal.count}
      </span>
    );
  }
  return (
    <span className="text-xs italic text-muted-foreground">
      {signal.availability === "read_failed" ? "read failed" : "not measured"}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const tone =
    tier === "trusted" ? "text-acr-pos" : tier === "established" ? "text-primary" : "text-muted-foreground";
  return (
    <Badge variant="outline" className={`text-xs capitalize ${tone}`}>
      {tier}
    </Badge>
  );
}

function OrgDetail({ org }: { org: TrustOrgRow }) {
  return (
    <div className="grid gap-6 border-l-2 border-border bg-muted/30 p-4 md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-sm font-semibold">Signals</h4>
        <ul className="space-y-3">
          {org.signals.map((signal) => (
            <li key={signal.key} className="text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-foreground">{signal.label}</span>
                <SignalValue signal={signal} />
              </div>
              <p className="mt-0.5 text-muted-foreground">
                {signal.sourceTable ? (
                  <>
                    Source: <code className="text-[11px]">{signal.sourceTable}</code>
                    {signal.windowDays !== null ? ` · last ${signal.windowDays} days` : " · current"}
                  </>
                ) : (
                  "No source table — this signal is not recorded anywhere at HEAD."
                )}
              </p>
              <p className="mt-0.5 text-muted-foreground">{signal.note}</p>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">
          Caps this tier <em>would</em> get
        </h4>
        <ul className="space-y-1.5">
          {org.proposedCaps.map((cap) => (
            <li key={cap.key} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{cap.key}</span>
              <span className="flex items-center gap-2">
                <span className="font-medium text-foreground">{cap.value.toLocaleString()}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${cap.status === "consumed" ? "text-primary" : "text-muted-foreground"}`}
                >
                  {cap.status === "consumed" ? "read by live code" : "proposed only"}
                </Badge>
              </span>
            </li>
          ))}
        </ul>

        <h4 className="mb-2 mt-5 text-sm font-semibold">What the evidence supports</h4>
        {org.evidence.exceeded.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-acr-warn">Over a threshold that exists in code:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {org.evidence.exceeded.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {org.evidence.awaitingThreshold.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-foreground">
              Recorded, but no threshold exists to judge it against:
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {org.evidence.awaitingThreshold.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              The proposal leaves complaint, bounce and report thresholds explicitly unset — setting
              them is part of the ruling being asked for.
            </p>
          </div>
        )}
        {org.evidence.notMeasured.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground">Not measured at all:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {org.evidence.notMeasured.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {org.evidence.exceeded.length === 0 &&
          org.evidence.awaitingThreshold.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No measured signal for this org is above a threshold that exists in code. That is the
              whole claim — it is not a statement that every count is zero, and it is not a
              clearance.
            </p>
          )}
      </div>
    </div>
  );
}

export function TrustSignalsContent() {
  const [expanded, setExpanded] = React.useState<number | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<TrustSignalsResponse>({
    queryKey: ["/api/founder/trust-signals"],
    queryFn: async () => {
      const r = await fetch("/api/founder/trust-signals", { credentials: "include" });
      if (!r.ok) throw new Error(`Failed to load trust signals (${r.status})`);
      return r.json();
    },
  });

  // stale-while-error: an existing table stays on screen and the error rides
  // above it, rather than the page blanking out on a refetch failure.
  if (error && !data) {
    return (
      <QueryErrorState
        title="Couldn't load trust signals"
        error={error as Error}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const orgs = data?.orgs ?? [];
  const flagged = orgs.filter((o) => o.evidence.reviewRecommended);

  return (
    <div className="space-y-4">
      {error && data && (
        <QueryErrorState
          title="Showing the last loaded signals — refresh failed"
          error={error as Error}
          onRetry={() => void refetch()}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-acr-warn" aria-hidden="true" />
            Trust tiers and abuse signals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {/* Served by the API so this claim cannot drift from the code. */}
          <p className="rounded-md border border-acr-warn/40 bg-acr-warn/10 p-3 text-xs font-medium">
            {data?.enforcementStatus}
          </p>
          <p className="text-xs text-muted-foreground">
            Each organization&apos;s stored trust tier and the abuse evidence that genuinely exists
            in the database. The signal SET comes from{" "}
            <code className="text-[11px]">{data?.proposalPath}</code>; the numbers come from the
            tables named against each signal. Signals the proposal wants but nothing records yet say
            so by name instead of showing a zero. Flow signals cover the last {data?.windowDays}{" "}
            days; stock signals (open reports, live links) are as of now.
          </p>
          <p className="text-xs text-muted-foreground">
            Showing {data?.orgCount ?? 0} organization{(data?.orgCount ?? 0) === 1 ? "" : "s"},
            highest org id first, capped at {data?.orgLimit ?? 0}. &ldquo;Organization&rdquo; means
            tenant — trials and unpaid orgs are included, so this is not a customer count.
          </p>
          {flagged.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-semibold">
                {flagged.length} organization{flagged.length === 1 ? "" : "s"} worth a look
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                A measured signal is above a number that exists in code. This is a recommendation to
                review, not a demotion: nothing on this page changes a tier, and no automatic path
                to change one exists. Expand a row to see exactly which comparison fired.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {orgs.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          headline="No organizations to show"
          subtitle="The panel reads the organizations table directly. An empty list means there are no org rows, not that signals are missing."
          cta={{ label: "Re-read signals", onClick: () => void refetch() }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <span className="sr-only">Expand signal detail</span>
                    </TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Tier</TableHead>
                    {SUMMARY_KEYS.map((c) => (
                      <TableHead key={c.key} className="text-right">
                        {c.head}
                      </TableHead>
                    ))}
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgs.map((org) => {
                    const isOpen = expanded === org.organizationId;
                    return (
                      <React.Fragment key={org.organizationId}>
                        <TableRow>
                          <TableCell className="align-top">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={
                                isOpen
                                  ? `Hide signal detail for ${org.name}`
                                  : `Show signal detail for ${org.name}`
                              }
                              aria-expanded={isOpen}
                              onClick={() => setExpanded(isOpen ? null : org.organizationId)}
                            >
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="align-top">
                            <span className="text-sm font-medium">{org.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              #{org.organizationId}
                            </span>
                            {org.isFounderOrg && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                founder org
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <TierBadge tier={org.trustTier} />
                            {org.trustTierStored !== null &&
                              org.trustTierStored !== org.trustTier && (
                                <p className="mt-1 text-[10px] text-acr-warn">
                                  stored value &ldquo;{org.trustTierStored}&rdquo; is not a known
                                  tier — read as {org.trustTier}
                                </p>
                              )}
                          </TableCell>
                          {SUMMARY_KEYS.map((c) => {
                            const signal = org.signals.find((s) => s.key === c.key);
                            return (
                              <TableCell key={c.key} className="text-right align-top text-sm">
                                {signal ? <SignalValue signal={signal} /> : <span>—</span>}
                              </TableCell>
                            );
                          })}
                          <TableCell className="align-top">
                            {org.evidence.reviewRecommended ? (
                              <Badge variant="outline" className="text-xs text-acr-warn">
                                Review recommended
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={3 + SUMMARY_KEYS.length + 1} className="p-0">
                              <OrgDetail org={org} />
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        {isFetching ? "Refreshing…" : data?.asOf ? `Read at ${new Date(data.asOf).toLocaleString()}` : null}
      </p>
    </div>
  );
}
