/**
 * LeadDetailContent — shared body for the lead-detail surface.
 *
 * Used by both:
 *   - <LeadDetailDrawer /> (modal surface on the leads list page)
 *   - /leads/:id route (full-page detail view)
 *
 * Extracted from client/src/pages/leads.tsx as part of P1-28 (URL routes
 * for lead-detail). Keeps the inner content identical between the
 * sheet and the page so we don't drift.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Edit,
  User,
  Clock,
  Mail,
  Phone,
  MapPin,
  Calendar,
  StickyNote,
  Shield,
  Users,
  History,
} from "lucide-react";
import { format } from "date-fns";
import { ActivityTimeline } from "@/components/activity-timeline";
import { CustomFieldValuesEditor } from "@/components/custom-fields";
import { SkipTracePanel } from "@/components/skip-trace-panel";
import { useTeamMembers, useUserPermissions } from "@/hooks/use-organization";
import { useUpdateLead } from "@/hooks/use-leads";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { ScoreBreakdownCard, TcpaConsentBadge, TcpaConsentToggle } from "@/pages/leads";
import { StatusBadge, type StatusKind } from "@/components/StatusBadge";
import type { Lead } from "@shared/schema";

const LEAD_STATUS_KIND: Record<string, StatusKind> = {
  new: "active",
  contacting: "pending",
  negotiation: "warning",
  closed: "success",
  dead: "inactive",
};

interface LeadDetailContentProps {
  lead: Lead;
  /** Optional renderer for the right-side header actions (edit/close/etc). */
  headerActions?: React.ReactNode;
  /** Optional click handler for the in-body "Edit lead" CTA. */
  onEdit?: () => void;
  /**
   * If true (default), wrap content in a sticky header. The page
   * variant disables the sticky header because PageShell provides one.
   */
  withHeader?: boolean;
}

/**
 * The visual body shared between sheet + page. Includes the sticky
 * header by default (drawer mode); pass `withHeader={false}` for the
 * /leads/:id full-page rendering, where the page provides its own.
 */
export function LeadDetailContent({
  lead,
  headerActions,
  onEdit,
  withHeader = true,
}: LeadDetailContentProps) {
  const { data: teamMembers } = useTeamMembers();
  const { data: userPermissions } = useUserPermissions();
  const { mutate: updateLead } = useUpdateLead();
  const { toast } = useToast();
  const [isAssigning, setIsAssigning] = useState(false);

  const leadName = `${lead.firstName} ${lead.lastName}`.trim();

  const currentAssigneeName = (() => {
    if (!lead.assignedTo) return "Unassigned";
    const userIdStr = String(lead.assignedTo);
    const member = teamMembers?.find((m) => m.userId === userIdStr);
    return member?.displayName || member?.email || userIdStr;
  })();

  const handleAssignmentChange = (userId: string) => {
    setIsAssigning(true);
    updateLead(
      { id: lead.id, assignedTo: userId === "unassigned" ? null : userId } as any,
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
          setIsAssigning(false);
        },
        onError: () => {
          setIsAssigning(false);
          toast({
            variant: "destructive",
            title: "Couldn't update assignment",
            description: `${leadName} is still assigned to ${currentAssigneeName}. Check your connection and try again.`,
          });
        },
      },
    );
  };

  const getAssigneeName = (userId: string | number | null | undefined) => {
    if (!userId) return "Unassigned";
    const userIdStr = String(userId);
    const member = teamMembers?.find((m) => m.userId === userIdStr);
    return member?.displayName || member?.email || userIdStr;
  };

  return (
    <>
      {withHeader && (
        <div className="sticky top-0 z-10 bg-surface-chrome backdrop-blur border-b p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge
                  status={LEAD_STATUS_KIND[lead.status] || "active"}
                  label={lead.status ? lead.status.charAt(0).toUpperCase() + lead.status.slice(1) : "New"}
                />
              </div>
              <h2 className="text-xl font-bold mt-2" data-testid="text-lead-name">
                {leadName}
              </h2>
            </div>
            {headerActions ? (
              <div className="flex items-center gap-2">{headerActions}</div>
            ) : null}
          </div>
        </div>
      )}

      <div className={withHeader ? "p-6" : ""}>
        <Tabs defaultValue="details" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details" data-testid="tab-lead-details">
              <User className="w-4 h-4 mr-2" aria-hidden="true" />
              Details
            </TabsTrigger>
            <TabsTrigger value="timeline" data-testid="tab-lead-timeline">
              <Clock className="w-4 h-4 mr-2" aria-hidden="true" />
              Timeline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-6">
            <Card className="glass-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="w-4 h-4" aria-hidden="true" /> Contact information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="font-medium">{leadName}</dd>
                  </div>
                  {lead.email && (
                    <div>
                      <dt className="text-muted-foreground">Email</dt>
                      <dd className="font-medium flex items-center gap-2">
                        <Mail className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                        <a
                          href={`mailto:${lead.email}`}
                          className="underline-offset-2 hover:underline truncate"
                        >
                          {lead.email}
                        </a>
                      </dd>
                    </div>
                  )}
                  {lead.phone && (
                    <div>
                      <dt className="text-muted-foreground">Phone</dt>
                      <dd className="font-medium flex items-center gap-2">
                        <Phone className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                        <a
                          href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}
                          className="tabular-nums underline-offset-2 hover:underline"
                        >
                          {lead.phone}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>

            {(lead.address || lead.city || lead.state || lead.zip) && (
              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="w-4 h-4" aria-hidden="true" /> Address
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-sm">
                    {lead.address && <p className="font-medium">{lead.address}</p>}
                    <p className="text-muted-foreground">
                      {[lead.city, lead.state, lead.zip].filter(Boolean).join(", ")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <SkipTracePanel lead={lead} />

            <Card className="glass-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4" aria-hidden="true" /> Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="tabular-nums">
                      {lead.createdAt ? format(new Date(lead.createdAt), "MMM d, yyyy") : "—"}
                    </dd>
                  </div>
                  {lead.lastContactedAt && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Last contacted</dt>
                      <dd className="tabular-nums">
                        {format(new Date(lead.lastContactedAt), "MMM d, yyyy")}
                      </dd>
                    </div>
                  )}
                  {lead.lastAIMessageAt && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Last nurtured (AI)</dt>
                      <dd className="text-right tabular-nums">
                        {format(new Date(lead.lastAIMessageAt), "MMM d, yyyy")}
                      </dd>
                    </div>
                  )}
                  {lead.nextFollowUpAt && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Next follow-up</dt>
                      <dd className="text-right tabular-nums">
                        {format(new Date(lead.nextFollowUpAt), "MMM d, yyyy")}
                      </dd>
                    </div>
                  )}
                  {lead.source && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Source</dt>
                      <dd className="capitalize">{String(lead.source).replace(/_/g, " ")}</dd>
                    </div>
                  )}
                  {lead.type && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Type</dt>
                      <dd className="capitalize">{String(lead.type).replace(/_/g, " ")}</dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>

            <ScoreBreakdownCard leadId={lead.id} />

            <Card className="glass-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4" aria-hidden="true" /> TCPA compliance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      <TcpaConsentBadge lead={lead} />
                    </dd>
                  </div>
                  {lead.consentDate && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Consent date</dt>
                      <dd className="tabular-nums">
                        {format(new Date(lead.consentDate), "MMM d, yyyy")}
                      </dd>
                    </div>
                  )}
                  {lead.consentSource && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Consent source</dt>
                      <dd className="capitalize">{String(lead.consentSource).replace(/_/g, " ")}</dd>
                    </div>
                  )}
                  {lead.optOutDate && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Opt-out date</dt>
                      <dd className="tabular-nums">
                        {format(new Date(lead.optOutDate), "MMM d, yyyy")}
                      </dd>
                    </div>
                  )}
                  {lead.optOutReason && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Opt-out reason</dt>
                      <dd>{lead.optOutReason}</dd>
                    </div>
                  )}
                </dl>
                <div className="pt-3 mt-3 border-t flex gap-2">
                  <TcpaConsentToggle lead={lead} />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4" aria-hidden="true" /> Assignment
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Assigned to</span>
                    {userPermissions?.permissions.canManageTeam ? (
                      <Select
                        value={lead.assignedTo ? String(lead.assignedTo) : "unassigned"}
                        onValueChange={handleAssignmentChange}
                        disabled={isAssigning}
                      >
                        <SelectTrigger
                          className="w-[180px]"
                          aria-label={`Assignee for ${leadName}`}
                          data-testid="select-lead-assignee"
                        >
                          <SelectValue placeholder="Select assignee" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {teamMembers?.map((member) => (
                            <SelectItem key={member.userId} value={member.userId}>
                              {member.displayName || member.email || member.userId}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm font-medium" data-testid="text-lead-assignee">
                        {getAssigneeName(lead.assignedTo)}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {lead.notes && (
              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <StickyNote className="w-4 h-4" aria-hidden="true" /> Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
                </CardContent>
              </Card>
            )}

            <Card className="glass-panel">
              <CardContent className="pt-6">
                <CustomFieldValuesEditor entityType="lead" entityId={lead.id} />
              </CardContent>
            </Card>

            {onEdit && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 min-h-11" onClick={onEdit}>
                  <Edit className="w-4 h-4 mr-2" aria-hidden="true" />
                  Edit lead
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="timeline" className="space-y-6">
            <Card className="glass-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4" aria-hidden="true" /> Contact interactions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="w-3 h-3" aria-hidden="true" />
                    <span>Calls</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="w-3 h-3" aria-hidden="true" />
                    <span>Emails</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <StickyNote className="w-3 h-3" aria-hidden="true" />
                    <span>Notes</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    <span className="tabular-nums">
                      {lead.lastContactedAt
                        ? `Last: ${format(new Date(lead.lastContactedAt), "MMM d")}`
                        : "No contact yet"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <ActivityTimeline entityType="lead" entityId={lead.id} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
