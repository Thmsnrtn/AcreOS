/**
 * Founder UI — Hartwell title-partner registry.
 *
 * Lists registered title partners and lets the founder add new ones.
 * Surfaces tier (pilot/standard/volume/enterprise) + per-file price + the
 * partner's territory. Mirrors the pattern of /founder/integrations.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Loader2, MapPin } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

// ─── Types ──────────────────────────────────────────────────────────────────

type Tier = "pilot" | "standard" | "volume" | "enterprise";

interface TitlePartnerRow {
  id: number;
  organizationId: number | null;
  partnerName: string;
  contactEmail: string;
  contactPhone: string;
  territoryStates: string[];
  territoryCounties: string[];
  webhookUrl: string;
  volumePricingTier: Tier;
  perFilePrice: number;
  isActive: boolean;
  createdAt: string;
}

interface ListResponse {
  partners: TitlePartnerRow[];
}

// ─── Tier metadata ──────────────────────────────────────────────────────────

const TIER_LABELS: Record<Tier, string> = {
  pilot: "Pilot",
  standard: "Standard",
  volume: "Volume",
  enterprise: "Enterprise",
};

const TIER_TONE: Record<Tier, "default" | "secondary" | "outline"> = {
  pilot: "outline",
  standard: "secondary",
  volume: "default",
  enterprise: "default",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function FounderTitlePartnersPage() {
  useDocumentTitle("Title Partners");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<ListResponse>({
    queryKey: ["/api/founder/title-partners"],
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    partnerName: "",
    contactEmail: "",
    contactPhone: "",
    territoryStates: "",
    territoryCounties: "",
    apiKey: "",
    hmacSecret: "",
    webhookUrl: "",
    volumePricingTier: "pilot" as Tier,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        partnerName: form.partnerName.trim(),
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone.trim(),
        territoryStates: form.territoryStates
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
        territoryCounties: form.territoryCounties
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        apiKey: form.apiKey,
        hmacSecret: form.hmacSecret,
        webhookUrl: form.webhookUrl.trim(),
        volumePricingTier: form.volumePricingTier,
      };
      const res = await apiRequest("POST", "/api/founder/title-partners", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Partner registered",
        description: "Title partner is now active and will receive routed orders.",
      });
      setShowAdd(false);
      setForm({
        partnerName: "",
        contactEmail: "",
        contactPhone: "",
        territoryStates: "",
        territoryCounties: "",
        apiKey: "",
        hmacSecret: "",
        webhookUrl: "",
        volumePricingTier: "pilot",
      });
      qc.invalidateQueries({ queryKey: ["/api/founder/title-partners"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to register partner",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <PageShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Building2 className="w-7 h-7" aria-hidden="true" />
              Title Partners
            </h1>
            <p className="text-muted-foreground mt-1">
              Registered title companies that receive routed title-order
              requests. Volume tier drives per-file pricing.
            </p>
          </div>
          <Button
            onClick={() => setShowAdd((s) => !s)}
            aria-label={showAdd ? "Cancel adding partner" : "Add a new title partner"}
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            {showAdd ? "Cancel" : "Add Partner"}
          </Button>
        </div>

        {showAdd && (
          <Card>
            <CardHeader>
              <CardTitle>Register new partner</CardTitle>
              <CardDescription>
                The API key is hashed before storage; the HMAC secret is
                encrypted at rest. You can only retrieve them once — copy
                them to a secure vault before saving.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  addMutation.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="partnerName">Partner name</Label>
                  <Input
                    id="partnerName"
                    value={form.partnerName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, partnerName: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Contact email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, contactEmail: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Contact phone</Label>
                  <Input
                    id="contactPhone"
                    value={form.contactPhone}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, contactPhone: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="webhookUrl">Webhook URL</Label>
                  <Input
                    id="webhookUrl"
                    type="url"
                    value={form.webhookUrl}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, webhookUrl: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="territoryStates">
                    Territory states (comma-sep, 2-letter)
                  </Label>
                  <Input
                    id="territoryStates"
                    placeholder="TX, NM, AZ"
                    value={form.territoryStates}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, territoryStates: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="territoryCounties">
                    Territory counties (comma-sep)
                  </Label>
                  <Input
                    id="territoryCounties"
                    placeholder="Travis, Bexar"
                    value={form.territoryCounties}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        territoryCounties: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiKey">Inbound API key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    value={form.apiKey}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, apiKey: e.target.value }))
                    }
                    minLength={16}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hmacSecret">HMAC shared secret</Label>
                  <Input
                    id="hmacSecret"
                    type="password"
                    value={form.hmacSecret}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, hmacSecret: e.target.value }))
                    }
                    minLength={16}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="volumePricingTier">Volume pricing tier</Label>
                  <Select
                    value={form.volumePricingTier}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, volumePricingTier: v as Tier }))
                    }
                  >
                    <SelectTrigger id="volumePricingTier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pilot">Pilot — $895 / file</SelectItem>
                      <SelectItem value="standard">
                        Standard — $795 / file
                      </SelectItem>
                      <SelectItem value="volume">Volume — $695 / file</SelectItem>
                      <SelectItem value="enterprise">
                        Enterprise — negotiated
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button
                    type="submit"
                    disabled={addMutation.isPending}
                    aria-label="Register title partner"
                  >
                    {addMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    ) : null}
                    Register partner
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error ? (
          <Card className="border-destructive">
            <CardContent className="py-4">
              <p className="text-destructive text-sm">
                Failed to load title partners. Please try again.
              </p>
            </CardContent>
          </Card>
        ) : !data || data.partners.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No title partners registered yet. Click <strong>Add Partner</strong>{" "}
              to register the first one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.partners.map((p) => (
              <Card key={p.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="flex items-center gap-2">
                      {p.partnerName}
                      {!p.isActive && (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </CardTitle>
                    <Badge variant={TIER_TONE[p.volumePricingTier]}>
                      {TIER_LABELS[p.volumePricingTier]}
                      {p.perFilePrice > 0 ? ` — $${p.perFilePrice}` : ""}
                    </Badge>
                  </div>
                  <CardDescription>
                    {p.contactEmail} · {p.contactPhone}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <MapPin
                      className="w-4 h-4 mt-0.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div>
                      <div className="text-muted-foreground">Territory</div>
                      <div>
                        States:{" "}
                        {p.territoryStates.length > 0
                          ? p.territoryStates.join(", ")
                          : "any"}
                      </div>
                      <div>
                        Counties:{" "}
                        {p.territoryCounties.length > 0
                          ? p.territoryCounties.join(", ")
                          : "any"}
                      </div>
                    </div>
                  </div>
                  <div className="text-muted-foreground text-xs break-all">
                    Webhook: {p.webhookUrl}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    Scope:{" "}
                    {p.organizationId === null
                      ? "Platform-default"
                      : `Org ${p.organizationId}`}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
