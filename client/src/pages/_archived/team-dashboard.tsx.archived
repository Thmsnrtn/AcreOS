import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchJsonArray } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Phone, FileText, DollarSign, Users, Loader2, MessageSquare } from "lucide-react";
import { startOfWeek, startOfMonth, isAfter } from "date-fns";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface TeamMember {
  id: number;
  displayName?: string;
  email?: string;
  role?: string;
  isActive: boolean;
  userId: string;
}

interface Presence {
  userId: string;
  status: "online" | "away" | "offline";
  lastSeenAt?: string;
}

interface ActivityEvent {
  id: number;
  eventType: string;
  userId?: string;
  eventDate: string;
  entityType: string;
}

interface Deal {
  id: number;
  status: string;
  closingDate?: string;
}

interface ActivityResponse {
  events: ActivityEvent[];
}

function PresenceDot({ status }: { status?: string }) {
  const colors: Record<string, string> = {
    online: "bg-acr-pos",
    away: "bg-acr-warn",
    offline: "bg-muted",
  };
  const label = status ?? "offline";
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${colors[label] ?? "bg-muted"}`}
      aria-label={`Presence: ${label}`}
    />
  );
}

function initials(name?: string, email?: string): string {
  if (name) {
    const parts = name.trim().split(" ");
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export default function TeamDashboardPage() {
  useDocumentTitle("Team dashboard");
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);

  const { data: members = [], isLoading: membersLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/organization/members"],
    queryFn: () => fetchJsonArray<TeamMember>("/api/organization/members"),
  });

  const { data: presenceData = [], isLoading: presenceLoading } = useQuery<Presence[]>({
    queryKey: ["/api/team-messaging/presence"],
    queryFn: () => fetchJsonArray<Presence>("/api/team-messaging/presence"),
    refetchInterval: 30_000,
  });

  const { data: activityData, isLoading: activityLoading } = useQuery<ActivityResponse>({
    queryKey: ["/api/activity", "team-dashboard"],
    queryFn: async () => {
      // limit=200 is plenty for the team-week panel below (we only
      // bucket events by "since startOfWeek" / "since startOfMonth").
      // limit=500 was the single heaviest request on this dashboard.
      const res = await fetch("/api/activity?limit=200", { credentials: "include" });
      if (!res.ok) return { events: [] } as ActivityResponse;
      const j = await res.json().catch(() => null);
      if (Array.isArray(j)) return { events: j } as ActivityResponse;
      if (Array.isArray(j?.events)) return j as ActivityResponse;
      if (Array.isArray(j?.data)) return { events: j.data } as ActivityResponse;
      return { events: [] } as ActivityResponse;
    },
  });

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetchJsonArray<Deal>("/api/deals"),
  });

  const events = Array.isArray(activityData?.events) ? activityData.events : [];
  const presenceByUserId = new Map(presenceData.map(p => [p.userId, p]));

  function statForMember(memberId: string) {
    const weekEvents = events.filter(e =>
      e.userId === memberId && isAfter(new Date(e.eventDate), weekStart)
    );
    const contactsThisWeek = weekEvents.filter(e =>
      ["call_made", "note_added", "sms_sent", "email_sent"].includes(e.eventType)
    ).length;
    const offersThisWeek = weekEvents.filter(e => e.eventType === "offer_sent").length;
    const dealsClosedThisMonth = deals.filter(d =>
      d.status === "closed" && d.closingDate && isAfter(new Date(d.closingDate), monthStart)
    ).length;
    return { contactsThisWeek, offersThisWeek, dealsClosedThisMonth };
  }

  const activeMembers = members.filter(m => m.isActive);
  const onlineCount = presenceData.filter(p => p.status === "online").length;
  const isLoading = membersLoading || presenceLoading || activityLoading || dealsLoading;

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Team dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="tabular-nums">{activeMembers.length}</span> member{activeMembers.length !== 1 ? "s" : ""}
            {" · "}
            <span className="tabular-nums">{onlineCount}</span> online now
          </p>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Contacts this week",
              icon: <Phone className="w-4 h-4" aria-hidden="true" />,
              value: events.filter(e =>
                ["call_made", "note_added", "sms_sent", "email_sent"].includes(e.eventType) &&
                isAfter(new Date(e.eventDate), weekStart)
              ).length,
            },
            {
              label: "Offers this week",
              icon: <FileText className="w-4 h-4" aria-hidden="true" />,
              value: events.filter(e =>
                e.eventType === "offer_sent" && isAfter(new Date(e.eventDate), weekStart)
              ).length,
            },
            {
              label: "Deals closed this month",
              icon: <DollarSign className="w-4 h-4" aria-hidden="true" />,
              value: deals.filter(d =>
                d.status === "closed" && d.closingDate && isAfter(new Date(d.closingDate), monthStart)
              ).length,
            },
            {
              label: "Team members",
              icon: <Users className="w-4 h-4" aria-hidden="true" />,
              value: activeMembers.length,
            },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="pt-4 pb-3">
                <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                  {stat.icon}
                  <span className="text-xs">{stat.label}</span>
                </dt>
                <dd className="text-2xl font-bold tabular-nums">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : stat.value}
                </dd>
              </CardContent>
            </Card>
          ))}
        </dl>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground" role="status" aria-live="polite">
                <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> Loading…
              </div>
            ) : activeMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground px-6 py-4">No team members yet.</p>
            ) : (
              <ul className="divide-y" aria-label="Team members">
                {activeMembers.map(member => {
                  const presence = presenceByUserId.get(member.userId);
                  const stats = statForMember(member.userId);
                  const displayName = member.displayName ?? member.email ?? `Member #${member.id}`;
                  return (
                    <li key={member.id} className="flex items-center gap-4 px-6 py-3">
                      <div className="relative shrink-0">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="text-xs" aria-hidden="true">
                            {initials(member.displayName, member.email)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5">
                          <PresenceDot status={presence?.status} />
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{displayName}</p>
                        <p className="text-xs text-muted-foreground capitalize">{member.role ?? "member"}</p>
                      </div>
                      <dl className="hidden sm:flex items-center gap-6 text-center">
                        <div>
                          <dd className="text-sm font-semibold tabular-nums">{stats.contactsThisWeek}</dd>
                          <dt className="text-xs text-muted-foreground">Contacts</dt>
                        </div>
                        <div>
                          <dd className="text-sm font-semibold tabular-nums">{stats.offersThisWeek}</dd>
                          <dt className="text-xs text-muted-foreground">Offers</dt>
                        </div>
                        <div>
                          <dd className="text-sm font-semibold tabular-nums">{stats.dealsClosedThisMonth}</dd>
                          <dt className="text-xs text-muted-foreground">Closed</dt>
                        </div>
                      </dl>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        asChild
                        aria-label={`Message ${displayName}`}
                      >
                        <Link href="/team">
                          <MessageSquare className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                          Message
                        </Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
