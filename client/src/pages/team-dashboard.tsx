import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Phone, FileText, DollarSign, Users, Loader2, MessageSquare } from "lucide-react";
import { startOfWeek, startOfMonth, isAfter } from "date-fns";

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

function presenceDot(status?: string) {
  const colors: Record<string, string> = {
    online: "bg-green-500",
    away: "bg-yellow-400",
    offline: "bg-gray-300",
  };
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status ?? "offline"] ?? "bg-gray-300"}`}
      title={status ?? "offline"}
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
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);

  const { data: members = [], isLoading: membersLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/organization/members"],
    queryFn: () => fetch("/api/organization/members").then(r => r.json()),
  });

  const { data: presenceData = [], isLoading: presenceLoading } = useQuery<Presence[]>({
    queryKey: ["/api/team-messaging/presence"],
    queryFn: () => fetch("/api/team-messaging/presence").then(r => r.json()),
    refetchInterval: 30_000,
  });

  const { data: activityData, isLoading: activityLoading } = useQuery<ActivityResponse>({
    queryKey: ["/api/activity", "team-dashboard"],
    queryFn: () => fetch("/api/activity?limit=500").then(r => r.json()),
  });

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => fetch("/api/deals").then(r => r.json()),
  });

  const events = activityData?.events ?? [];
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
          <h1 className="text-2xl font-semibold">Team Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeMembers.length} member{activeMembers.length !== 1 ? "s" : ""} · {onlineCount} online now
          </p>
        </div>

        {/* Org-wide stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Contacts this week",
              icon: <Phone className="w-4 h-4" />,
              value: events.filter(e =>
                ["call_made", "note_added", "sms_sent", "email_sent"].includes(e.eventType) &&
                isAfter(new Date(e.eventDate), weekStart)
              ).length,
            },
            {
              label: "Offers this week",
              icon: <FileText className="w-4 h-4" />,
              value: events.filter(e =>
                e.eventType === "offer_sent" && isAfter(new Date(e.eventDate), weekStart)
              ).length,
            },
            {
              label: "Deals closed this month",
              icon: <DollarSign className="w-4 h-4" />,
              value: deals.filter(d =>
                d.status === "closed" && d.closingDate && isAfter(new Date(d.closingDate), monthStart)
              ).length,
            },
            {
              label: "Team members",
              icon: <Users className="w-4 h-4" />,
              value: activeMembers.length,
            },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  {stat.icon}
                  <span className="text-xs">{stat.label}</span>
                </div>
                <p className="text-2xl font-bold">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : stat.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Team member table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
              </div>
            ) : activeMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground px-6 py-4">No team members yet.</p>
            ) : (
              <div className="divide-y">
                {activeMembers.map(member => {
                  const presence = presenceByUserId.get(member.userId);
                  const stats = statForMember(member.userId);
                  return (
                    <div key={member.id} className="flex items-center gap-4 px-6 py-3">
                      <div className="relative shrink-0">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="text-xs">
                            {initials(member.displayName, member.email)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5">
                          {presenceDot(presence?.status)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {member.displayName ?? member.email ?? `Member #${member.id}`}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">{member.role ?? "member"}</p>
                      </div>
                      <div className="hidden sm:flex items-center gap-6 text-center">
                        <div>
                          <p className="text-sm font-semibold">{stats.contactsThisWeek}</p>
                          <p className="text-xs text-muted-foreground">Contacts</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{stats.offersThisWeek}</p>
                          <p className="text-xs text-muted-foreground">Offers</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{stats.dealsClosedThisMonth}</p>
                          <p className="text-xs text-muted-foreground">Closed</p>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="shrink-0" asChild>
                        <a href="/team">
                          <MessageSquare className="w-3.5 h-3.5 mr-1" />
                          Message
                        </a>
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
