import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Mail, Plus, Send, Users, DollarSign, BarChart3, Loader2 } from "lucide-react";
import { GlossaryTerm } from "@/components/Glossary";

interface DirectMailCampaign {
  id: number;
  name: string;
  mailType: "postcard" | "letter" | "yellow_letter";
  targetSegment: string;
  recipientCount: number;
  sentCount: number;
  responseCount: number;
  costPerPieceCents: number;
  totalCostCents: number;
  responseRate?: number;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledAt?: string;
  createdAt: string;
}

// Status → semantic --acr-* tone (Tier 1 pattern).
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-acr-surface-2 text-acr-ink-3 border-transparent",
  scheduled: "bg-acr-brand-soft text-acr-brand border-transparent",
  sending: "bg-acr-warn-soft text-acr-warn border-transparent",
  sent: "bg-acr-pos-soft text-acr-pos border-transparent",
  cancelled: "bg-acr-neg-soft text-acr-neg border-transparent",
};

export default function DirectMailCampaignsPage() {
  useDocumentTitle("Direct mail campaigns");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [mailType, setMailType] = useState("postcard");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [targetSegment, setTargetSegment] = useState("all_leads");
  const nameId = useId();
  const mailTypeId = useId();
  const segmentId = useId();
  const templateId = useId();

  const { data, isLoading } = useQuery<{ campaigns: DirectMailCampaign[] }>({
    queryKey: ["/api/direct-mail"],
    queryFn: () => fetch("/api/direct-mail").then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/direct-mail/campaigns", {
      name, mailType, messageTemplate, targetSegment,
    }),
    onSuccess: () => {
      toast({ title: `Campaign "${name}" created.` });
      qc.invalidateQueries({ queryKey: ["/api/direct-mail"] });
      setShowCreate(false);
      setName(""); setMessageTemplate("");
    },
    onError: () =>
      toast({
        title: "Couldn't create campaign",
        description: "No campaign was created — your input is preserved. Check your fields and try again.",
        variant: "destructive",
      }),
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/direct-mail/campaigns/${id}/send`, undefined, { idempotent: true }),
    onSuccess: () => {
      toast({ title: "Campaign queued for sending." });
      qc.invalidateQueries({ queryKey: ["/api/direct-mail"] });
    },
    onError: () =>
      toast({
        title: "Couldn't send campaign",
        description: "No mail pieces were sent. The campaign is still in draft — try again in a moment.",
        variant: "destructive",
      }),
  });

  const campaigns = data?.campaigns ?? [];
  const totalSent = campaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalResponses = campaigns.reduce((s, c) => s + c.responseCount, 0);
  const totalSpend = campaigns.reduce((s, c) => s + c.totalCostCents, 0);

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-direct-mail-title">
            Direct mail campaigns
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Send postcards, letters, and <GlossaryTerm slug="yellow_letter">yellow letters</GlossaryTerm> to targeted land-owner lists.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(!showCreate)}
          className="min-h-11"
          aria-expanded={showCreate}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> New campaign
        </Button>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <Send className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Total sent</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{totalSent.toLocaleString()}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Responses</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{totalResponses.toLocaleString()}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Total spend</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{usd(totalSpend / 100)}</dd>
          </CardContent>
        </Card>
      </dl>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create campaign</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim() || createMutation.isPending) return;
                createMutation.mutate();
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={nameId} className="text-xs">
                    Campaign name <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <Input
                    id={nameId}
                    placeholder="Q1 Texas outreach"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    autoCapitalize="sentences"
                  />
                </div>
                <div>
                  <Label htmlFor={mailTypeId} className="text-xs">Mail type</Label>
                  <Select value={mailType} onValueChange={setMailType}>
                    <SelectTrigger id={mailTypeId}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="postcard">Postcard — fastest, lowest cost per piece</SelectItem>
                      <SelectItem value="letter">Letter — higher open rate, more cost</SelectItem>
                      <SelectItem value="yellow_letter">Yellow letter — handwritten-style, highest response rate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor={segmentId} className="text-xs">Target segment</Label>
                <Select value={targetSegment} onValueChange={setTargetSegment}>
                  <SelectTrigger id={segmentId}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_leads">All leads</SelectItem>
                    <SelectItem value="hot_leads">Hot leads</SelectItem>
                    <SelectItem value="long_ownership">Long-term owners (10+ years)</SelectItem>
                    <SelectItem value="absentee">Absentee owners</SelectItem>
                    <SelectItem value="tax_delinquent">Tax-delinquent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={templateId} className="text-xs">Message template</Label>
                <Textarea
                  id={templateId}
                  placeholder="Hi [OWNER_NAME], I'm interested in buying your land at [PROPERTY_ADDRESS]…"
                  value={messageTemplate}
                  onChange={e => setMessageTemplate(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={!name || createMutation.isPending}
                  className="min-h-11"
                >
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : "Create draft"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowCreate(false)} className="min-h-11">Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading campaigns…
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">No direct mail campaigns yet.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label="Direct mail campaigns">
          {campaigns.map(c => (
            <li key={c.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">{c.mailType.replace(/_/g, " ")}</Badge>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[c.status]}`}
                          aria-label={`Status: ${c.status}`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span><Users className="w-3 h-3 inline mr-1" aria-hidden="true" /><span className="tabular-nums">{c.sentCount.toLocaleString()}</span> sent</span>
                        <span><BarChart3 className="w-3 h-3 inline mr-1" aria-hidden="true" /><span className="tabular-nums">{c.responseCount.toLocaleString()}</span> response{c.responseCount === 1 ? "" : "s"}</span>
                        {c.responseRate !== undefined && <span className="tabular-nums">{c.responseRate.toFixed(1)}% response rate</span>}
                        <span><DollarSign className="w-3 h-3 inline mr-0.5" aria-hidden="true" /><span className="tabular-nums">{usd(c.totalCostCents / 100)}</span> total</span>
                      </div>
                    </div>
                    {c.status === "draft" && (
                      <Button
                        size="sm"
                        onClick={() => sendMutation.mutate(c.id)}
                        disabled={sendMutation.isPending}
                        className="min-h-9"
                        aria-label={`Send campaign: ${c.name}`}
                      >
                        <Send className="w-3 h-3 mr-1" aria-hidden="true" /> Send
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
