/**
 * TeamInviteCard — invite a seat, see pending invites, revoke pending invites.
 * Added in cycle 12 to unblock Maya T01/T02/T04 and Dolores E01 (bulk seat).
 *
 * Copy rule: say only what the server reported. Creating an invitation tries
 * to email it and reports one status per invite (sent / not_configured /
 * suppressed / failed). The stored invite keeps only a hash of its token, so a
 * link can be shown just once, right after it is created or replaced; a lost
 * link is replaced with "New link", never recovered.
 */
import { useId, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, X, Upload, RefreshCw, Link2 } from "lucide-react";
import type { TeamInviteDeliveryStatus } from "@shared/teamInviteDelivery";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { CopyButton } from "@/components/ui/copy-button";
import { shortDate } from "@/lib/format";

interface Invitation {
  id: number;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

/** Response item from POST /api/organization/invitations. */
interface CreatedInvitation {
  id: number;
  email: string;
  expiresAt: string;
  link: string;
  delivery: TeamInviteDeliveryStatus;
}

/** A link the inviter can copy right now (kept in memory only). */
interface ShareEntry {
  id: number;
  email: string;
  link: string;
  delivery: TeamInviteDeliveryStatus | null;
}

/** The sentence under an invite's address, per outcome. */
function deliveryLine(delivery: TeamInviteDeliveryStatus | null): string {
  switch (delivery) {
    case "sent":
      return "Emailed.";
    case "not_configured":
      return "Not emailed: email delivery isn't set up on this server. Send them this link yourself.";
    case "suppressed":
      return "Not emailed: AcreOS can't email this address. Send them this link yourself.";
    case "failed":
      return "Not emailed: sending failed. Use Resend email, or send them this link yourself.";
    default:
      return "New link ready. Nothing was emailed; send it to them yourself.";
  }
}

export function TeamInviteCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [shared, setShared] = useState<Record<number, ShareEntry>>({});
  const inviteFormId = useId();
  const bulkTextareaId = useId();

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
    onSuccess: (data: { created: number; invitations: CreatedInvitation[] }) => {
      const sent = data.invitations.filter((i) => i.delivery === "sent").length;
      const notSent = data.invitations.length - sent;
      setShared((prev) => {
        const next = { ...prev };
        for (const i of data.invitations) {
          if (i.delivery !== "sent") next[i.id] = { id: i.id, email: i.email, link: i.link, delivery: i.delivery };
        }
        return next;
      });
      if (notSent === 0) {
        toast({
          title: sent === 1 ? "Invitation emailed" : `${sent} invitations emailed`,
        });
      } else if (sent === 0) {
        toast({
          title: data.created === 1 ? "Invitation created, not emailed" : `${data.created} invitations created, not emailed`,
          description: "Copy the link below and send it yourself.",
        });
      } else {
        toast({
          title: `${sent} emailed, ${notSent} not emailed`,
          description: "Copy the links below for the ones that weren't emailed.",
        });
      }
      setEmail("");
      setBulkText("");
      setBulkOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/organization/invitations"] });
    },
    onError: (err: Error) => {
      // A seat/plan refusal was already shown with what unlocks it (and a
      // link) by the global mutation handler; "try again" would be wrong advice.
      if (err instanceof ApiError && err.refusal) return;
      toast({
        title: "Couldn't send invitation",
        description: `${err.message} — your draft is preserved. Try again.`,
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/organization/invitations/${id}`);
    },
    onSuccess: (_d, id) => {
      setShared((prev) => {
        const { [id]: _gone, ...rest } = prev;
        return rest;
      });
      toast({ title: "Invitation revoked" });
      qc.invalidateQueries({ queryKey: ["/api/organization/invitations"] });
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't revoke invitation",
        description: `${err.message} — try again in a moment.`,
        variant: "destructive",
      }),
  });

  const regenerateMutation = useMutation({
    mutationFn: async (vars: { id: number; sendEmail: boolean }) => {
      const res = await apiRequest("POST", `/api/organization/invitations/${vars.id}/regenerate`, {
        sendEmail: vars.sendEmail,
      });
      return (await res.json()) as {
        invitation: { id: number; email: string; link: string; delivery: TeamInviteDeliveryStatus | null };
      };
    },
    onSuccess: ({ invitation }) => {
      if (invitation.delivery === "sent") {
        setShared((prev) => {
          const { [invitation.id]: _gone, ...rest } = prev;
          return rest;
        });
        toast({
          title: "Email sent with a new link",
          description: "The previous link no longer works.",
        });
      } else {
        setShared((prev) => ({
          ...prev,
          [invitation.id]: { id: invitation.id, email: invitation.email, link: invitation.link, delivery: invitation.delivery },
        }));
        toast({
          title: invitation.delivery === null ? "New link ready" : "New link ready, not emailed",
          description: "The previous link no longer works. Copy the new one below.",
        });
      }
      qc.invalidateQueries({ queryKey: ["/api/organization/invitations"] });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.refusal) return;
      toast({
        title: "Couldn't make a new link",
        description: `${err.message} — the previous link still works.`,
        variant: "destructive",
      });
    },
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
          <UserPlus className="w-5 h-5" aria-hidden="true" />
          Invite team members
        </CardTitle>
        <CardDescription>
          Invite teammates by email address. AcreOS emails each invitation when email delivery is set up; if not, you get a link to send them yourself. Admins can paste a CSV for bulk invites.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          id={inviteFormId}
          className="grid gap-3 md:grid-cols-[1fr_180px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (email && !createMutation.isPending) onInvite();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email" className="text-xs">
              Email
            </Label>
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="email"
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
              type="submit"
              disabled={!email || createMutation.isPending}
              data-testid="button-send-invite"
            >
              Send invite
            </Button>
          </div>
        </form>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBulkOpen((v) => !v)}
            aria-expanded={bulkOpen}
            className="text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            <Upload className="w-3 h-3 inline mr-1" aria-hidden="true" />
            {bulkOpen ? "Hide bulk invite" : "Bulk invite (CSV)"}
          </button>
        </div>

        {bulkOpen && (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor={bulkTextareaId} className="text-xs">
              One email per line, or <code>email:role</code> to override the
              default role.
            </Label>
            <Textarea
              id={bulkTextareaId}
              className="min-h-[120px] text-sm font-mono"
              placeholder={"alice@example.com\nbob@example.com:admin\ncharlie@example.com:viewer"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
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

        {Object.keys(shared).length > 0 && (
          <div className="space-y-2" data-testid="panel-share-links">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium">Links to send yourself</h3>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShared({})}>
                Dismiss
              </Button>
            </div>
            <div className="rounded-md border divide-y">
              {Object.values(shared).map((e) => (
                <div key={e.id} className="flex items-center gap-3 p-3 text-sm" data-testid={`row-share-${e.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{e.email}</p>
                    <p className="text-xs text-muted-foreground">{deliveryLine(e.delivery)}</p>
                  </div>
                  <CopyButton value={e.link} successMessage="Invite link copied" label="Copy link" className="h-8" />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              These links are shown now only. If you lose one, use New link on the pending invitation.
            </p>
          </div>
        )}

        {pending.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium">Pending invitations</h3>
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
                      Invited {shortDate(inv.createdAt)} ·{" "}
                      {new Date(inv.expiresAt).getTime() < Date.now() ? "Expired" : "Expires"} {shortDate(inv.expiresAt)}
                    </p>
                  </div>
                  <Badge variant="outline" className="uppercase text-micro">
                    {inv.role}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => regenerateMutation.mutate({ id: inv.id, sendEmail: true })}
                    disabled={regenerateMutation.isPending}
                    aria-label={`Resend email to ${inv.email} with a new link`}
                    data-testid={`button-resend-${inv.id}`}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" />
                    Resend email
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => regenerateMutation.mutate({ id: inv.id, sendEmail: false })}
                    disabled={regenerateMutation.isPending}
                    aria-label={`Make a new link for ${inv.email}`}
                    data-testid={`button-newlink-${inv.id}`}
                  >
                    <Link2 className="w-3 h-3 mr-1" aria-hidden="true" />
                    New link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => revokeMutation.mutate(inv.id)}
                    disabled={revokeMutation.isPending}
                    aria-label={`Revoke invitation to ${inv.email}`}
                    data-testid={`button-revoke-${inv.id}`}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
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
