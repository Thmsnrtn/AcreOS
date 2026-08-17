/**
 * /counties/:id — county hub detail page (TD-5).
 *
 * Marcus: "/counties exists. […] For a tax-delinquent operator this is the
 * primary navigation. Click a county, see its auction schedule, its
 * delinquent-owner list, its redemption clock, its mailer drops."
 *
 * Renders four summary tiles (delinquent leads, active certs, upcoming
 * auctions ≤90d, worksheet items) + an editable clerk-profile section
 * (Marcus's "every operator keeps this in a Word doc" gap).
 */

import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Users as UsersIcon,
  Clock,
  Gavel,
  Target,
  Edit3,
  Save,
  Phone,
  Mail,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";

interface ClerkProfile {
  acceptedPaymentMethods?: string[];
  depositTimingHours?: number;
  opensAt?: string;
  lotListPostedAt?: string;
  proxyBiddingAllowed?: boolean;
  deedRecordationLagHours?: number;
  clerkContact?: { name?: string; phone?: string; email?: string };
  general?: string;
}

interface County {
  id: number;
  name: string;
  state: string;
  fipsCode: string | null;
  status: string;
  priority: number | null;
  notes: string | null;
  clerkProfile: ClerkProfile | null;
}

interface Summary {
  state: string;
  county: string;
  asOf: string;
  delinquentLeadsCount: number;
  activeCertsCount: number;
  overdueCertsCount: number;
  upcomingAuctions90dCount: number;
  worksheetItemsCount: number;
}

export default function CountyDetailPage() {
  const [, params] = useRoute<{ id: string }>("/counties/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = params?.id ? parseInt(params.id, 10) : null;

  const countyQuery = useQuery<County>({
    queryKey: ["/api/target-counties", id],
    queryFn: async () => {
      const res = await fetch(`/api/target-counties/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    enabled: !!id,
  });

  const county = countyQuery.data;
  const summaryQuery = useQuery<Summary>({
    queryKey: ["/api/tax-researcher/county-summary", county?.state, county?.name],
    queryFn: async () => {
      const params = new URLSearchParams({ state: county!.state, county: county!.name });
      const res = await fetch(`/api/tax-researcher/county-summary?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    enabled: !!county,
  });

  useDocumentTitle(county ? `${county.name}, ${county.state} — AcreOS` : "County — AcreOS");

  if (!id) return null;

  if (countyQuery.isLoading) {
    return (
      <PageShell>
        <Skeleton className="h-12 w-72 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </PageShell>
    );
  }

  if (!county) {
    return (
      <PageShell>
        <Link href="/counties">
          <Button variant="ghost" size="sm" className="mb-3 -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back
          </Button>
        </Link>
        <Card><div className="p-6">County not found.</div></Card>
      </PageShell>
    );
  }

  const s = summaryQuery.data;

  return (
    <PageShell>
      <Link href="/counties">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back to counties
        </Button>
      </Link>

      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <h1 className="text-3xl font-bold">{county.name}, {county.state}</h1>
          {county.fipsCode && <p className="text-xs text-muted-foreground mt-1 font-mono">FIPS {county.fipsCode}</p>}
        </div>
        <span className="inline-block rounded-md px-2 py-1 text-xs bg-muted">{county.status}</span>
      </div>

      {/* Summary tiles */}
      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : s ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <SummaryTile
            icon={UsersIcon}
            label="Delinquent leads"
            value={s.delinquentLeadsCount}
            onClick={() => navigate(`/tax-delinquent?state=${county.state}`)}
          />
          <SummaryTile
            icon={Clock}
            label="Active certificates"
            value={s.activeCertsCount}
            sub={s.overdueCertsCount > 0 ? `${s.overdueCertsCount} overdue` : undefined}
            tone={s.overdueCertsCount > 0 ? "neg" : undefined}
            onClick={() => navigate(`/redemption-clock?state=${county.state}`)}
          />
          <SummaryTile
            icon={Gavel}
            label="Auctions ≤ 90d"
            value={s.upcomingAuctions90dCount}
            onClick={() => navigate(`/tax-researcher`)}
          />
          <SummaryTile
            icon={Target}
            label="Worksheet items"
            value={s.worksheetItemsCount}
            onClick={() => navigate(`/auction-worksheet`)}
          />
        </div>
      ) : null}

      {/* Clerk profile */}
      <ClerkProfileCard county={county} />

      {/* General notes */}
      {county.notes && (
        <Card className="mt-6">
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-2">Notes</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{county.notes}</p>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: typeof Clock;
  label: string;
  value: number | string;
  sub?: string;
  tone?: "neg";
  onClick?: () => void;
}) {
  return (
    <Card
      className={`p-3 ${onClick ? "hover:bg-accent/50 cursor-pointer transition-colors" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={`text-2xl font-semibold tracking-tight ${tone === "neg" ? "text-acr-neg" : ""}`}>
        {value}
      </div>
      {sub && <div className={`text-xs mt-0.5 ${tone === "neg" ? "text-acr-neg" : "text-muted-foreground"}`}>{sub}</div>}
    </Card>
  );
}

function ClerkProfileCard({ county }: { county: County }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<ClerkProfile>(county.clerkProfile ?? {});

  const save = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/target-counties/${county.id}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({ clerkProfile: profile }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Clerk profile saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/target-counties", county.id] });
      setEditing(false);
    },
    onError: (err: any) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });

  const display = county.clerkProfile ?? {};

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Clerk profile</h2>
          {!editing ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>
              <Edit3 className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> {Verbs.EDIT}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setProfile(display); setEditing(false); }}>{Verbs.CANCEL}</Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => save.mutate()} disabled={save.isPending}>
                <Save className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </div>
        <Separator className="mb-3" />

        {!editing ? (
          isEmpty(display) ? (
            <p className="text-sm text-muted-foreground">
              No clerk profile yet. Click <span className="font-semibold">Edit</span> to add the
              specifics — accepted payment methods, deposit timing, lot-list posting time,
              proxy bidding rules, deed recordation lag, clerk contact.
            </p>
          ) : (
            <ClerkProfileDisplay profile={display} />
          )
        ) : (
          <ClerkProfileEditor profile={profile} onChange={setProfile} />
        )}
      </div>
    </Card>
  );
}

function isEmpty(p: ClerkProfile): boolean {
  return !(
    p.acceptedPaymentMethods?.length ||
    p.depositTimingHours ||
    p.opensAt ||
    p.lotListPostedAt ||
    p.proxyBiddingAllowed != null ||
    p.deedRecordationLagHours ||
    p.clerkContact?.name ||
    p.clerkContact?.phone ||
    p.clerkContact?.email ||
    p.general
  );
}

function ClerkProfileDisplay({ profile }: { profile: ClerkProfile }) {
  return (
    <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
      {profile.acceptedPaymentMethods && profile.acceptedPaymentMethods.length > 0 && (
        <Row label="Payment methods" value={profile.acceptedPaymentMethods.join(", ")} />
      )}
      {profile.depositTimingHours != null && (
        <Row label="Deposit due" value={`${profile.depositTimingHours} hrs before sale`} />
      )}
      {profile.opensAt && <Row label="Opens at" value={profile.opensAt} />}
      {profile.lotListPostedAt && <Row label="Lot list posted at" value={profile.lotListPostedAt} />}
      {profile.proxyBiddingAllowed != null && (
        <Row label="Proxy bidding" value={profile.proxyBiddingAllowed ? "Allowed" : "Not allowed"} />
      )}
      {profile.deedRecordationLagHours != null && (
        <Row label="Deed recordation lag" value={`${profile.deedRecordationLagHours} hrs after payment`} />
      )}
      {(profile.clerkContact?.name || profile.clerkContact?.phone || profile.clerkContact?.email) && (
        <div className="md:col-span-2">
          <dt className="text-xs text-muted-foreground">Clerk contact</dt>
          <dd className="mt-0.5 text-sm flex flex-wrap items-center gap-3">
            {profile.clerkContact.name && <span className="font-medium">{profile.clerkContact.name}</span>}
            {profile.clerkContact.phone && (
              <span className="flex items-center gap-1 font-mono text-xs">
                <Phone className="w-3 h-3" aria-hidden="true" /> {profile.clerkContact.phone}
              </span>
            )}
            {profile.clerkContact.email && (
              <span className="flex items-center gap-1 text-xs">
                <Mail className="w-3 h-3" aria-hidden="true" /> {profile.clerkContact.email}
              </span>
            )}
          </dd>
        </div>
      )}
      {profile.general && (
        <div className="md:col-span-2">
          <dt className="text-xs text-muted-foreground">General notes</dt>
          <dd className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground italic">{profile.general}</dd>
        </div>
      )}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function ClerkProfileEditor({
  profile,
  onChange,
}: {
  profile: ClerkProfile;
  onChange: (p: ClerkProfile) => void;
}) {
  const set = (patch: Partial<ClerkProfile>) => onChange({ ...profile, ...patch });
  const setContact = (patch: Partial<NonNullable<ClerkProfile["clerkContact"]>>) =>
    onChange({ ...profile, clerkContact: { ...profile.clerkContact, ...patch } });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="space-y-1">
          <Label htmlFor="cp-pmt" className="text-xs">Payment methods (comma-separated)</Label>
          <Input
            id="cp-pmt"
            placeholder="wires_only, certified_check"
            value={profile.acceptedPaymentMethods?.join(", ") ?? ""}
            onChange={(e) => set({ acceptedPaymentMethods: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-deposit" className="text-xs">Deposit timing (hrs before sale)</Label>
          <Input
            id="cp-deposit"
            inputMode="numeric"
            placeholder="24"
            value={profile.depositTimingHours ?? ""}
            onChange={(e) => set({ depositTimingHours: e.target.value ? parseInt(e.target.value, 10) : undefined })}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-opens" className="text-xs">Opens at (HH:MM)</Label>
          <Input id="cp-opens" placeholder="10:00" value={profile.opensAt ?? ""} onChange={(e) => set({ opensAt: e.target.value })} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-list" className="text-xs">Lot list posted at (HH:MM)</Label>
          <Input id="cp-list" placeholder="09:30" value={profile.lotListPostedAt ?? ""} onChange={(e) => set({ lotListPostedAt: e.target.value })} className="h-8" />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="cp-proxy" className="text-xs">Proxy bidding allowed</Label>
          <Switch id="cp-proxy" checked={!!profile.proxyBiddingAllowed} onCheckedChange={(v) => set({ proxyBiddingAllowed: v })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-recordation" className="text-xs">Deed recordation lag (hrs)</Label>
          <Input
            id="cp-recordation"
            inputMode="numeric"
            placeholder="24"
            value={profile.deedRecordationLagHours ?? ""}
            onChange={(e) => set({ deedRecordationLagHours: e.target.value ? parseInt(e.target.value, 10) : undefined })}
            className="h-8"
          />
        </div>
      </div>

      <Separator />
      <p className="text-xs font-medium">Clerk contact</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Input aria-label="Clerk contact name" placeholder="Name" value={profile.clerkContact?.name ?? ""} onChange={(e) => setContact({ name: e.target.value })} className="h-8" />
        <Input aria-label="Clerk contact phone" placeholder="Phone" value={profile.clerkContact?.phone ?? ""} onChange={(e) => setContact({ phone: e.target.value })} className="h-8" />
        <Input aria-label="Clerk contact email" placeholder="Email" type="email" value={profile.clerkContact?.email ?? ""} onChange={(e) => setContact({ email: e.target.value })} className="h-8" />
      </div>

      <div className="space-y-1">
        <Label htmlFor="cp-general" className="text-xs">General notes</Label>
        <Textarea
          id="cp-general"
          rows={4}
          placeholder="Free-text overflow — every quirk this clerk has."
          value={profile.general ?? ""}
          onChange={(e) => set({ general: e.target.value })}
        />
      </div>
    </div>
  );
}
