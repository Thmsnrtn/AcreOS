/**
 * T95 — Beta Program Dashboard (Admin)
 *
 * Founder-only view for managing the AcreOS beta program:
 *   - Waitlist stats and user list
 *   - Cohort management
 *   - Inviting and activating users
 *   - Feedback triage (bugs, feature requests, NPS)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  UserCheck,
  UserPlus,
  Star,
  MessageSquare,
  Layers,
  Mail,
  Loader2,
  ThumbsUp,
  Bug,
  Lightbulb,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

interface WaitlistEntry {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  position: number;
  status: "waiting" | "invited" | "active" | "declined";
  cohort?: string;
  score: number;
  createdAt: string;
}

interface BetaStats {
  total: number;
  waiting: number;
  invited: number;
  active: number;
  avgNPS: number | null;
  feedbackCount: number;
}

interface BetaCohort {
  id: string;
  name: string;
  description: string;
  features: string[];
  maxSize: number;
  currentSize: number;
}

interface BetaFeedback {
  id: number;
  email: string;
  type: "bug" | "feature_request" | "general" | "nps";
  rating?: number;
  message: string;
  feature?: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  waiting: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  invited: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  declined: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
};

const FEEDBACK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bug: Bug,
  feature_request: Lightbulb,
  general: MessageSquare,
  nps: Star,
};

export default function BetaDashboardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCohort, setInviteCohort] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: stats } = useQuery<BetaStats>({
    queryKey: ["/api/beta/admin/stats"],
  });

  const { data: waitlistData, isLoading: waitlistLoading } = useQuery<{
    entries: WaitlistEntry[];
    total: number;
  }>({
    queryKey: ["/api/beta/admin/waitlist", statusFilter],
    queryFn: () =>
      apiRequest("GET", `/api/beta/admin/waitlist${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`).then(r => r.json()),
  });

  const { data: cohorts } = useQuery<BetaCohort[]>({
    queryKey: ["/api/beta/admin/cohorts"],
  });

  const { data: feedbackList } = useQuery<BetaFeedback[]>({
    queryKey: ["/api/beta/admin/feedback"],
  });

  const inviteMutation = useMutation({
    mutationFn: (data: { email: string; cohortId?: string }) =>
      apiRequest("POST", "/api/beta/admin/invite", data).then(r => r.json()),
    onSuccess: (res: any) => {
      toast({ title: res.message || "User invited" });
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/beta/admin/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/beta/admin/stats"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: (email: string) =>
      apiRequest("POST", "/api/beta/admin/activate", { email }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "User activated" });
      queryClient.invalidateQueries({ queryKey: ["/api/beta/admin/waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/beta/admin/stats"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Beta Program</h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Manage the AcreOS waitlist, cohorts, and beta user feedback.
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Waitlist", value: stats?.total ?? 0, icon: Users, color: "text-blue-600" },
          { label: "Waiting", value: stats?.waiting ?? 0, icon: UserPlus, color: "text-yellow-600" },
          { label: "Active Beta", value: stats?.active ?? 0, icon: UserCheck, color: "text-green-600" },
          { label: "Avg NPS", value: stats?.avgNPS != null ? stats.avgNPS.toFixed(1) : "—", icon: Star, color: "text-amber-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-muted ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-xl font-bold">{value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="waitlist">
        <TabsList>
          <TabsTrigger value="waitlist" className="gap-2">
            <Users className="w-4 h-4" /> Waitlist
          </TabsTrigger>
          <TabsTrigger value="cohorts" className="gap-2">
            <Layers className="w-4 h-4" /> Cohorts
          </TabsTrigger>
          <TabsTrigger value="feedback" className="gap-2">
            <MessageSquare className="w-4 h-4" /> Feedback
            {stats && stats.feedbackCount > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">{stats.feedbackCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Waitlist Tab */}
        <TabsContent value="waitlist" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="w-4 h-4" /> Invite User
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 flex-wrap">
                <Input
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="max-w-xs"
                />
                <Select value={inviteCohort} onValueChange={setInviteCohort}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Cohort (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {cohorts?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => inviteMutation.mutate({ email: inviteEmail, cohortId: inviteCohort || undefined })}
                  disabled={!inviteEmail || inviteMutation.isPending}
                >
                  {inviteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Invite"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-base">Waitlist Entries</CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="waiting">Waiting</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              {waitlistLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
              ) : !waitlistData?.entries.length ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No waitlist entries yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {waitlistData.entries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-muted-foreground text-sm">{entry.position}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{entry.email}</div>
                            {entry.firstName && (
                              <div className="text-xs text-muted-foreground">{entry.firstName} {entry.lastName}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{entry.company || "—"}</TableCell>
                          <TableCell>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[entry.status]}`}>
                              {entry.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm font-mono">{entry.score}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                          </TableCell>
                          <TableCell>
                            {entry.status === "waiting" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => inviteMutation.mutate({ email: entry.email })}
                                disabled={inviteMutation.isPending}
                              >
                                Invite
                              </Button>
                            )}
                            {entry.status === "invited" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => activateMutation.mutate(entry.email)}
                                disabled={activateMutation.isPending}
                              >
                                Activate
                              </Button>
                            )}
                            {entry.status === "active" && (
                              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                <ThumbsUp className="w-3 h-3" /> Live
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cohorts Tab */}
        <TabsContent value="cohorts" className="space-y-4">
          {!cohorts?.length ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No cohorts defined.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {cohorts.map((cohort) => (
                <Card key={cohort.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{cohort.name}</CardTitle>
                    <CardDescription className="text-xs">{cohort.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Capacity</span>
                      <span className="font-medium">{cohort.currentSize} / {cohort.maxSize}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div
                        className="bg-primary h-1.5 rounded-full"
                        style={{ width: `${Math.min(100, (cohort.currentSize / cohort.maxSize) * 100)}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {cohort.features.map((f) => (
                        <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Feedback Tab */}
        <TabsContent value="feedback" className="space-y-3">
          {!feedbackList?.length ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No feedback submitted yet.
              </CardContent>
            </Card>
          ) : (
            feedbackList.map((fb) => {
              const Icon = FEEDBACK_ICONS[fb.type] ?? MessageSquare;
              return (
                <Card key={fb.id}>
                  <CardContent className="pt-4 flex gap-3">
                    <div className="p-2 rounded-lg bg-muted shrink-0 h-fit">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{fb.email}</span>
                        <Badge variant="outline" className="text-xs">{fb.type.replace("_", " ")}</Badge>
                        {fb.feature && <Badge variant="secondary" className="text-xs">{fb.feature}</Badge>}
                        {fb.rating != null && (
                          <span className="text-xs font-medium text-amber-600 flex items-center gap-0.5">
                            <Star className="w-3 h-3" /> {fb.rating}/10
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(fb.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{fb.message}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
