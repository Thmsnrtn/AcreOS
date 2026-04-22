/**
 * TeamInviteCard — invite a seat, see pending invites, revoke pending invites.
 * Added in cycle 12 to unblock Maya T01/T02/T04 and Dolores E01 (bulk seat).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, X, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CopyButton } from "@/components/ui/copy-button";
import { shortDate } from "@/lib/format";

interface Invitation {
  id: number;
  email: string;
  role: string;
  token: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  link?: string;
}

export function TeamInviteCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const { data: invitationsData } = useQuery<{ invitations: Invitation[] }>({
    queryKey: ["/api/organization/invitations"],
  });
  const pending = (invitationsData?.invitations ?? []).filter(
    (i) => i.status === "pending"
  );

  const createMutation = useMutation({
    mutationFn: async (body: unknown) => {
      const res = await apiRequest("POST", "/api/organization/invitations", body);
      return res.json();
    },
    onSuccess: (data: { created: number; invitations: Invitation[] }) => {
      toast({
        title: `Invited ${data.created} member${data.created === 1 ? "" : "s"}`,
        description:
          data.invitations[0]?.link
            ? "Copy the invite link from the pending list below."
            : undefined,
      });
      setEmail("");
      setBulkText("");
      setBulkOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/organization/invitations"] });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not send invitation",
        description: err.message,
        variant: "destructive",
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/organization/invitations/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Invitation revoked" });
      qc.invalidateQueries({ queryKey: ["/api/organization/invitations"] });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not revoke",
        description: err.message,
        variant: "destructive",
      }),
  });

  const roleOptions: Array<{ value: string; label: string }> = [
    { value: "admin", label: "Admin" },
    { value: "member", label: "Member" },
    { value: "viewer", label: "Viewer" },
    { value: "acquisitions", label: "Acquisitions" },
    { value: "marketing", label: "Marketing" },
    { value: "finance", label: "Finance" },
  ];

  function onInvite() {
    if (!email) return;
    createMutation.mutate({ email: email.trim(), role });
  }

  function onBulkInvite() {
    const lines = bulkText
      .split(/\r?\n|,/)
      .map((l) => l.trim())
      .filter(Boolean);
    const invites = lines.map((line) => {
      // Accept "email" or "email,role" on each line.
      const [rawEmail, rawRole] = line.split(":").length === 2
        ? line.split(":")
        : [line, role];
      return { email: rawEmail.trim(), role: (rawRole || role).trim() };
    });
    if (invites.length === 0) return;
    createMutation.mutate({ invites });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          Invite Team Members
        </CardTitle>
        <CardDescription>
          Send an invitation by email. Admins can paste a CSV for bulk invites.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email" className="text-xs">
              Email
            </Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="input-invite-email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role" className="text-xs">
              Role
            </Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="invite-role" data-testid="select-invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={onInvite}
              disabled={!email || createMutation.isPending}
              data-testid="button-send-invite"
            >
              Send invite
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBulkOpen((v) => !v)}
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            <Upload className="w-3 h-3 inline mr-1" />
            {bulkOpen ? "Hide bulk invite" : "Bulk invite (CSV)"}
          </button>
        </div>

        {bulkOpen && (
          <div className="space-y-2 rounded-md border p-3">
            <Label className="text-xs">
              One email per line, or <code>email:role</code> to override the
              default role.
            </Label>
            <textarea
              className="w-full min-h-[120px] rounded-md border bg-background p-2 text-sm font-mono"
              placeholder={"alice@example.com\nbob@example.com:admin\ncharlie@example.com:viewer"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              data-testid="textarea-bulk-invites"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={onBulkInvite}
                disabled={!bulkText.trim() || createMutation.isPending}
                data-testid="button-bulk-invite"
              >
                Send {bulkText.split(/\r?\n|,/).filter((l) => l.trim()).length} invites
              </Button>
              <p className="text-xs text-muted-foreground">
                Limit 200 per batch.
              </p>
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Pending invitations</Label>
            <div className="rounded-md border divide-y">
              {pending.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 p-3 text-sm"
                  data-testid={`row-invite-${inv.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited {shortDate(inv.createdAt)} · Expires {shortDate(inv.expiresAt)}
                    </p>
                  </div>
                  <Badge variant="outline" className="uppercase text-[10px]">
                    {inv.role}
                  </Badge>
                  {inv.link && (
                    <CopyButton
                      value={inv.link}
                      successMessage="Invite link copied"
                      label="Copy link"
                      className="h-8"
                    />
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => revokeMutation.mutate(inv.id)}
                    disabled={revokeMutation.isPending}
                    data-testid={`button-revoke-${inv.id}`}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
