import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Mail, Plus, Send, Users, DollarSign, BarChart3, Loader2, FileText } from "lucide-react";

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

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  scheduled: "bg-blue-100 text-blue-700",
  sending: "bg-yellow-100 text-yellow-700",
  sent: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function DirectMailCampaignsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [mailType, setMailType] = useState("postcard");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [targetSegment, setTargetSegment] = useState("all_leads");

  const { data, isLoading } = useQuery<{ campaigns: DirectMailCampaign[] }>({
    queryKey: ["/api/direct-mail"],
    queryFn: () => fetch("/api/direct-mail").then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/direct-mail/campaigns", {
      name, mailType, messageTemplate, targetSegment,
    }),
    onSuccess: () => {
      toast({ title: `Campaign "${name}" created` });
      qc.invalidateQueries({ queryKey: ["/api/direct-mail"] });
      setShowCreate(false);
      setName(""); setMessageTemplate("");
    },
    onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/direct-mail/campaigns/${id}/send`),
    onSuccess: () => {
      toast({ title: "Campaign queued for sending" });
      qc.invalidateQueries({ queryKey: ["/api/direct-mail"] });
    },
    onError: () => toast({ title: "Send failed", variant: "destructive" }),
  });

  const campaigns = data?.campaigns ?? [];
  const totalSent = campaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalResponses = campaigns.reduce((s, c) => s + c.responseCount, 0);
  const totalSpend = campaigns.reduce((s, c) => s + c.totalCostCents, 0);

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-direct-mail-title">
            Direct Mail Campaigns
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Send postcards, letters, and yellow letters to targeted land owner lists.
          </p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 mr-2" /> New Campaign
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Send className="w-4 h-4" />
              <span className="text-xs">Total Sent</span>
            </div>
            <p className="text-2xl font-bold">{totalSent.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="w-4 h-4" />
              <span className="text-xs">Responses</span>
            </div>
            <p className="text-2xl font-bold">{totalResponses.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs">Total Spend</span>
            </div>
            <p className="text-2xl font-bold">${(totalSpend / 100).toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create Campaign</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Campaign Name</Label>
                <Input placeholder="Q1 Texas Outreach" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Mail Type</Label>
                <Select value={mailType} onValueChange={setMailType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postcard">Postcard</SelectItem>
                    <SelectItem value="letter">Letter</SelectItem>
                    <SelectItem value="yellow_letter">Yellow Letter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Target Segment</Label>
              <Select value={targetSegment} onValueChange={setTargetSegment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_leads">All Leads</SelectItem>
                  <SelectItem value="hot_leads">Hot Leads</SelectItem>
                  <SelectItem value="long_ownership">Long-term Owners (10+ years)</SelectItem>
                  <SelectItem value="absentee">Absentee Owners</SelectItem>
                  <SelectItem value="tax_delinquent">Tax Delinquent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Message Template</Label>
              <Textarea
                placeholder="Hi [OWNER_NAME], I'm interested in buying your land at [PROPERTY_ADDRESS]..."
                value={messageTemplate}
                onChange={e => setMessageTemplate(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button disabled={!name || createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Draft"}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading campaigns...
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No direct mail campaigns yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {campaigns.map(c => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{c.name}</span>
                      <Badge variant="outline" className="text-xs capitalize">{c.mailType.replace("_", " ")}</Badge>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status]}`}>
                        {c.status}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span><Users className="w-3 h-3 inline mr-1" />{c.sentCount.toLocaleString()} sent</span>
                      <span><BarChart3 className="w-3 h-3 inline mr-1" />{c.responseCount} responses</span>
                      {c.responseRate !== undefined && <span>{c.responseRate.toFixed(1)}% response rate</span>}
                      <span><DollarSign className="w-3 h-3 inline mr-0.5" />{(c.totalCostCents / 100).toLocaleString()} total</span>
                    </div>
                  </div>
                  {c.status === "draft" && (
                    <Button size="sm" onClick={() => sendMutation.mutate(c.id)}>
                      <Send className="w-3 h-3 mr-1" /> Send
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
