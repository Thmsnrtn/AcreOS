/**
 * LeadRoutingCard — "who gets a new lead?", answered in Settings →
 * Organization, next to the roster it routes to.
 *
 * The rules (lead_assignment_rules) have run on every lead added from the
 * Leads list since Phase 5 (POST /api/leads → services/leadAssigner), but the
 * page that edits them (/settings/lead-assignment) was linked from nowhere, so
 * no organization could set one up. This card is the way in: it shows the
 * org's real rules, in the order they apply, and links to the editor.
 *
 * Shown only to people who may assign leads (owner/admin — the server gates
 * the rules endpoint the same way) and only once there is a team to route to.
 * Every line is a stored rule; nothing is summarised or inferred.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Route } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  LEAD_ASSIGNMENT_RULES_API,
  LEAD_ROUTING_PATH,
  LEAD_ROUTING_SCOPE,
  RULE_TYPE_LABEL,
  fetchLeadRoutingRules,
  type LeadRoutingRule,
} from "@/lib/lead-routing";

export function LeadRoutingCard() {
  const { data: rules, isLoading, isError, error, refetch, isRefetching } = useQuery<LeadRoutingRule[]>({
    queryKey: [LEAD_ASSIGNMENT_RULES_API],
    queryFn: fetchLeadRoutingRules,
  });

  return (
    <Card data-testid="card-lead-routing">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
          <Route className="w-5 h-5" aria-hidden="true" />
          Lead routing
        </CardTitle>
        <CardDescription>Which teammate gets a new lead, decided by your rules in order. {LEAD_ROUTING_SCOPE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <ul className="space-y-3" aria-label="Loading lead routing rules">
            {[0, 1].map((i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-1/2" announce={i === 0} announceText="Loading lead routing rules" />
                <Skeleton className="h-3 w-24" announce={false} />
              </li>
            ))}
          </ul>
        ) : isError ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => void refetch()}
            isRetrying={isRefetching}
            compact
            title="Couldn't load lead routing"
            description="Your rules are unchanged — this is a loading problem. Try again."
            testId="error-lead-routing"
          />
        ) : !rules || rules.length === 0 ? (
          <EmptyState
            icon={Route}
            headline="No routing rules yet"
            subtitle="Leads added from the Leads list stay unassigned until you add a rule: take turns, by location, or weighted random."
            cta={{ label: "Set up lead routing", href: LEAD_ROUTING_PATH, "data-testid": "empty-lead-routing-setup" }}
            actionIcon={null}
            className="py-6"
            testId="empty-lead-routing"
          />
        ) : (
          <>
            <ol className="divide-y" aria-label="Lead routing rules, in the order they apply" data-testid="list-lead-routing-rules">
              {rules.map((rule) => {
                const people = (rule.weightedAssignees ?? []).length;
                return (
                  <li key={rule.id} className="flex items-center justify-between gap-3 py-2" data-testid={`row-lead-routing-rule-${rule.id}`}>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{rule.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {RULE_TYPE_LABEL[rule.ruleType]} · {people} teammate{people === 1 ? "" : "s"}
                      </p>
                    </div>
                    {!rule.isActive && <Badge variant="secondary">Off</Badge>}
                  </li>
                );
              })}
            </ol>
            <Button asChild variant="outline" className="min-h-11 pointer-fine:sm:min-h-9">
              <Link href={LEAD_ROUTING_PATH} data-testid="link-lead-routing-manage">
                Manage routing rules
              </Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
