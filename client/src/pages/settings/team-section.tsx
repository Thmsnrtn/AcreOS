/**
 * Settings → Team & roles — routed section (Wave 1.5, P2 §1).
 *
 * Content moved intact from the settings.tsx monolith's Organization tab:
 * invite card, team-members table with role management, and the co-owners
 * section (Blanco §1 — owner-only management; the co-owner relation unlocks
 * dual-billing-card and dual-tax-contact UX downstream).
 */
import {
  useTeamMembers,
  useUpdateTeamMemberRole,
  useUserPermissions,
  useOrgCoOwners,
  useAddOrgCoOwner,
  useRemoveOrgCoOwner,
  getRoleLabel,
  getRoleBadgeStyle,
  type Role,
} from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Crown, Users, Shield, Plus, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { TeamInviteCard } from "@/components/settings/TeamInviteCard";
import { useState } from "react";
import { formatDate } from "@/lib/format";

export default function TeamSection() {
  const { toast } = useToast();
  const { data: teamMembers, isLoading: teamLoading, isError: teamError, error: teamErrorObj, refetch: refetchTeam, isRefetching: teamRefetching } = useTeamMembers();
  const { data: userPermissions } = useUserPermissions();
  const { data: coOwners, isLoading: coOwnersLoading, isError: coOwnersError, error: coOwnersErrorObj, refetch: refetchCoOwners, isRefetching: coOwnersRefetching } = useOrgCoOwners();

  const updateRoleMutation = useUpdateTeamMemberRole();
  const addCoOwnerMutation = useAddOrgCoOwner();
  const removeCoOwnerMutation = useRemoveOrgCoOwner();
  const [coOwnerCandidate, setCoOwnerCandidate] = useState<string>("");

  return (
    <div className="space-y-8" data-testid="settings-section-team">
      <TeamInviteCard />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Team Members
          </CardTitle>
          <CardDescription>Manage team roles and permissions</CardDescription>
        </CardHeader>
        <CardContent>
          {teamLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" announce={i === 1} announceText="Loading team members" />
                  <Skeleton className="h-4 w-32" announce={false} />
                  <Skeleton className="h-6 w-16" announce={false} />
                </div>
              ))}
            </div>
          ) : teamError ? (
            <QueryErrorState
              error={teamErrorObj as Error}
              onRetry={() => refetchTeam()}
              isRetrying={teamRefetching}
              compact
              title="Couldn't load your team"
              description="Your team and their roles are intact — this is just a display issue."
              testId="error-team-members"
            />
          ) : teamMembers && teamMembers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  {userPermissions?.permissions.canManageTeam && (
                    <TableHead className="w-32">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamMembers.map((member) => (
                  <TableRow key={member.id} data-testid={`row-team-member-${member.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Users className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium" data-testid={`text-member-name-${member.id}`}>
                            {member.displayName || member.email || member.userId}
                          </p>
                          {member.email && member.displayName && (
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`border-0 ${getRoleBadgeStyle(member.role)}`}
                        data-testid={`badge-role-${member.id}`}
                      >
                        {member.role === "owner" && <Crown className="w-3 h-3 mr-1" />}
                        {member.role === "admin" && <Shield className="w-3 h-3 mr-1" />}
                        {getRoleLabel(member.role)}
                      </Badge>
                    </TableCell>
                    {userPermissions?.permissions.canManageTeam && (
                      <TableCell>
                        {member.role !== "owner" || userPermissions.role === "owner" ? (
                          <Select
                            value={member.role}
                            onValueChange={(newRole: Role) => {
                              updateRoleMutation.mutate(
                                { memberId: member.id, role: newRole },
                                {
                                  onSuccess: () => {
                                    toast({
                                      title: "Role updated",
                                      description: `${member.displayName || member.userId}'s role has been changed to ${getRoleLabel(newRole)}.`,
                                    });
                                  },
                                  onError: (error) => {
                                    toast({
                                      title: "Couldn't update role",
                                      description: `${error.message || "Try again"} — the member's existing role is unchanged.`,
                                      variant: "destructive",
                                    });
                                  },
                                }
                              );
                            }}
                            disabled={updateRoleMutation.isPending}
                          >
                            <SelectTrigger
                              className="w-44 sm:w-56"
                              aria-label={`Role for team member`}
                              data-testid={`select-role-${member.id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {userPermissions.role === "owner" && (
                                <SelectItem value="owner">Owner — full access and billing</SelectItem>
                              )}
                              {/*
                                Liana §1: only owner can grant `admin`.
                                Admins see member↔va↔viewer in the
                                dropdown but the server still rejects
                                admin→admin escalation.
                              */}
                              {userPermissions.role === "owner" && (
                                <SelectItem value="admin">Admin — manage team and data</SelectItem>
                              )}
                              <SelectItem value="member">Member — create and edit records</SelectItem>
                              <SelectItem value="va">VA — assigned-leads-only by default</SelectItem>
                              <SelectItem value="viewer">Viewer — read-only access</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={Users}
              headline="It's just you so far"
              subtitle="Invite a teammate or VA above — they get their own login and a role that controls what they can see and do."
              cta={{
                label: "Invite someone",
                onClick: () => {
                  const input = document.querySelector<HTMLInputElement>('[data-testid="input-invite-email"]');
                  input?.scrollIntoView({ behavior: "smooth", block: "center" });
                  input?.focus({ preventScroll: true });
                },
                "data-testid": "empty-invite-team-member",
              }}
              actionIcon={null}
              className="py-6"
              testId="empty-team-members"
            />
          )}
        </CardContent>
      </Card>

      {/*
        Blanco §1: Co-Owners section. Owner-only management. The
        presence of a co-owner row is what unlocks dual-billing-card
        and dual-tax-contact UX downstream (those surfaces ship in
        a billing follow-up; this section just establishes the
        relation so the data exists when the UI catches up).
      */}
      {userPermissions?.role === "owner" && (
        <Card data-testid="card-co-owners">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="w-5 h-5" />
              Co-Owners
            </CardTitle>
            <CardDescription>
              Co-owners share billing and tax-contact responsibility for this
              organization. Only the primary owner can add or remove them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {coOwnersLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" announceText="Loading co-owners" />
                <Skeleton className="h-8 w-full" announce={false} />
              </div>
            ) : coOwnersError ? (
              <QueryErrorState
                error={coOwnersErrorObj as Error}
                onRetry={() => refetchCoOwners()}
                isRetrying={coOwnersRefetching}
                compact
                title="Couldn't load co-owners"
                description="Co-owner records are intact — this is just a display issue."
                testId="error-co-owners"
              />
            ) : coOwners && coOwners.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coOwners.map((co) => {
                    const member = teamMembers?.find((m) => m.userId === co.userId);
                    return (
                      <TableRow key={co.id} data-testid={`row-co-owner-${co.id}`}>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {member?.displayName || member?.email || co.userId}
                            </p>
                            {member?.email && member.displayName && (
                              <p className="text-xs text-muted-foreground">
                                {member.email}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(co.addedAt)}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-11 w-11 pointer-fine:sm:h-8 pointer-fine:sm:w-8"
                            onClick={() =>
                              removeCoOwnerMutation.mutate(
                                { userId: co.userId },
                                {
                                  onSuccess: () => {
                                    toast({
                                      title: "Co-owner removed",
                                      description: `${
                                        member?.displayName || co.userId
                                      } is no longer a co-owner.`,
                                    });
                                  },
                                  onError: (err) => {
                                    toast({
                                      title: "Couldn't remove co-owner",
                                      description: err.message || "Try again.",
                                      variant: "destructive",
                                    });
                                  },
                                },
                              )
                            }
                            disabled={removeCoOwnerMutation.isPending}
                            aria-label={`Remove ${
                              member?.displayName || co.userId
                            } as co-owner`}
                            data-testid={`button-remove-co-owner-${co.id}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm">
                No co-owners yet. Co-owners must already be team members.
              </p>
            )}

            {teamMembers && teamMembers.length > 1 && (
              <div className="flex items-end gap-2 pt-2 border-t">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="co-owner-candidate" className="text-sm">
                    Add a team member as co-owner
                  </Label>
                  <Select
                    value={coOwnerCandidate}
                    onValueChange={setCoOwnerCandidate}
                  >
                    <SelectTrigger
                      id="co-owner-candidate"
                      data-testid="select-co-owner-candidate"
                    >
                      <SelectValue placeholder="Select a team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamMembers
                        .filter(
                          (m) =>
                            m.role !== "owner" &&
                            !coOwners?.some((co) => co.userId === m.userId),
                        )
                        .map((m) => (
                          <SelectItem key={m.id} value={m.userId}>
                            {m.displayName || m.email || m.userId}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => {
                    if (!coOwnerCandidate) return;
                    addCoOwnerMutation.mutate(
                      { userId: coOwnerCandidate },
                      {
                        onSuccess: () => {
                          setCoOwnerCandidate("");
                          toast({
                            title: "Co-owner added",
                            description:
                              "They now share billing and tax-contact responsibility.",
                          });
                        },
                        onError: (err) => {
                          toast({
                            title: "Couldn't add co-owner",
                            description: err.message || "Try again.",
                            variant: "destructive",
                          });
                        },
                      },
                    );
                  }}
                  disabled={!coOwnerCandidate || addCoOwnerMutation.isPending}
                  className="min-h-11 pointer-fine:sm:min-h-9"
                  data-testid="button-add-co-owner"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
