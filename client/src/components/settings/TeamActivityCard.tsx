/**
 * TeamActivityCard — "what did my VA do today?", answered in Settings →
 * Organization, next to the roster it is about.
 *
 * The persona walks (tests/simulation/walks/persona-walks.ts) found this job a
 * dead end on phone and desktop: the only per-user record, the audit log, sat
 * at the bottom of the Pax & connections tab, labelled "Activity log", with
 * the actor shown as the first eight characters of a user id. This card reads
 * the same rows (GET /api/org/activity-log, org-scoped on the server), names
 * each person from the team roster, and lets the owner narrow to one teammate.
 *
 * Every line is a recorded row; nothing is summarised or inferred. System rows
 * (no team member behind them) are left out — they are not the team's work.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, UserPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useTeamMembers } from "@/hooks/use-organization";
import { okOrThrow } from "@/lib/fetch-honesty";
import { relative } from "@/lib/format";

interface AuditRow {
  id: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  createdAt: string;
}

const ACTION_WORDS: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
  import: "imported",
  export: "exported",
  login: "signed in",
  consent_granted: "recorded consent for",
  consent_revoked: "recorded a withdrawal of consent for",
  assign: "assigned",
  send: "sent",
};

/** "mail_identity" → "mail identity"; an action we have no word for is humanised, never printed raw. */
function words(s: string): string {
  return s.replace(/[_:.]+/g, " ").trim();
}

export function describeAuditRow(row: Pick<AuditRow, "action" | "entityType" | "entityId">): string {
  const verb = ACTION_WORDS[row.action] ?? words(row.action);
  if (row.action === "login") return verb;
  const thing = words(row.entityType);
  return `${verb} ${/^[aeiou]/i.test(thing) ? "an" : "a"} ${thing}${row.entityId != null ? ` (#${row.entityId})` : ""}`;
}

const EVERYONE = "everyone";

export function TeamActivityCard() {
  const { data: members, isLoading: membersLoading } = useTeamMembers();
  const [who, setWho] = useState<string>(EVERYONE);
  const { data: rows, isLoading, isError, error, refetch, isRefetching } = useQuery<AuditRow[]>({
    queryKey: ["/api/org/activity-log", who],
    queryFn: async () => {
      const qs = who === EVERYONE ? "" : `?userId=${encodeURIComponent(who)}`;
      return (await okOrThrow(await fetch(`/api/org/activity-log${qs}`, { credentials: "include" }))).json();
    },
  });

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of members ?? []) if (t.userId) m.set(t.userId, t.displayName || t.email || "A teammate");
    return m;
  }, [members]);
  const teamRows = (rows ?? []).filter((r) => r.userId && nameOf.has(r.userId));
  const teammates = (members ?? []).filter((m) => m.userId);
  const soloOwner = !membersLoading && teammates.length <= 1;

  const focusInvite = () => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="input-invite-email"]');
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus({ preventScroll: true });
  };

  return (
    <Card data-testid="card-team-activity">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
          <History className="w-5 h-5" aria-hidden="true" />
          Team activity
        </CardTitle>
        <CardDescription>What each person on your team did, newest first. Pick a teammate to see only their work.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 max-w-sm">
          <Label htmlFor="select-team-activity-member">Show</Label>
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger id="select-team-activity-member" className="min-h-11" data-testid="select-team-activity-member">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERYONE}>Everyone</SelectItem>
              {teammates.map((m) => (
                <SelectItem key={m.userId} value={m.userId!}>
                  {m.displayName || m.email || "A teammate"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading || membersLoading ? (
          <ul className="space-y-3" aria-label="Loading team activity">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-2/3" announce={i === 0} announceText="Loading team activity" />
                <Skeleton className="h-3 w-16" announce={false} />
              </li>
            ))}
          </ul>
        ) : isError ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => void refetch()}
            isRetrying={isRefetching}
            compact
            title="Couldn't load team activity"
            description="Nothing your team did is lost — this is a loading problem. Try again."
            testId="error-team-activity"
          />
        ) : teamRows.length === 0 ? (
          soloOwner ? (
            <EmptyState
              icon={UserPlus}
              headline="No teammates yet"
              subtitle="Invite your VA or a partner above. Everything they create, change or import shows up here with their name on it."
              cta={{ label: "Invite a teammate", onClick: focusInvite, "data-testid": "empty-team-activity-invite" }}
              actionIcon={null}
              className="py-6"
              testId="empty-team-activity"
            />
          ) : (
            <EmptyState
              icon={History}
              headline={who === EVERYONE ? "Nothing recorded yet" : `Nothing recorded yet for ${nameOf.get(who) ?? "this teammate"}`}
              subtitle="Each lead, deal, campaign or import a teammate creates or changes is listed here as it happens."
              cta={{ label: "Show everyone", onClick: () => setWho(EVERYONE), "data-testid": "empty-team-activity-everyone" }}
              actionIcon={null}
              className="py-6"
              testId="empty-team-activity-member"
            />
          )
        ) : (
          <ul className="divide-y divide-border" aria-label="Team activity, newest first" data-testid="list-team-activity">
            {teamRows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <p className="min-w-0">
                  <span className="font-medium">{nameOf.get(r.userId!)}</span> {describeAuditRow(r)}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{relative(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
