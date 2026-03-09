import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Users, DollarSign, Zap, Plus, TrendingUp, CheckCircle2,
  Clock, AlertCircle, MoreHorizontal, Settings, Eye, Palette, Upload, RefreshCw,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Tenant {
  id: string | number;
  name: string;
  subdomain: string;
  status: "active" | "trial" | "suspended" | "onboarding";
  plan: string;
  userCount: number;
  monthlyRevenue: number;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  onboardingStep: number;
  onboardingTotal: number;
  createdAt: string;
  lastActiveAt?: string;
}

interface ResellerAnalytics {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  totalUsers: number;
  totalRevenue: number;
  mrr: number;
  totalAiCreditsUsed: number;
}

interface RevenueTrendPoint {
  month: string;
  revenue: number;
  newTenants: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCurrency(val: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-muted/50 rounded animate-pulse ${className}`} />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    trial: "bg-blue-100 text-blue-800",
    suspended: "bg-red-100 text-red-800",
    onboarding: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

// ─── Create Tenant Dialog ─────────────────────────────────────────────────────

function CreateTenantDialog({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    subdomain: "",
    plan: "professional",
    adminEmail: "",
    adminName: "",
    notes: "",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/white-label/tenants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create tenant");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Tenant created", description: `${form.name} is being onboarded` });
      setOpen(false);
      setForm({ name: "", subdomain: "", plan: "professional", adminEmail: "", adminName: "", notes: "" });
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Tenant</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create New Tenant</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Organization Name</Label>
              <Input placeholder="Acme Realty" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Subdomain</Label>
              <Input placeholder="acme-realty" value={form.subdomain}
                onChange={e => setForm(f => ({ ...f, subdomain: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} />
            </div>
          </div>
          <div>
            <Label>Plan</Label>
            <Select value={form.plan} onValueChange={v => setForm(f => ({ ...f, plan: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Admin Name</Label>
              <Input placeholder="Jane Smith" value={form.adminName}
                onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))} />
            </div>
            <div>
              <Label>Admin Email</Label>
              <Input type="email" placeholder="jane@acme.com" value={form.adminEmail}
                onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea placeholder="Special requirements…" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
          <Button className="w-full" onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.name || !form.subdomain || !form.adminEmail}>
            {createMutation.isPending ? "Creating…" : "Create Tenant"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Analytics Cards ──────────────────────────────────────────────────────────

function AnalyticsCards({ analytics, loading }: { analytics: ResellerAnalytics | null; loading: boolean }) {
  const cards = [
    { label: "Total Tenants", value: analytics?.totalTenants, display: "number", icon: Building2, color: "text-blue-500" },
    { label: "Active Users", value: analytics?.totalUsers, display: "number", icon: Users, color: "text-green-500" },
    { label: "Total Revenue", value: analytics?.totalRevenue, display: "currency", icon: DollarSign, color: "text-purple-500" },
    { label: "MRR", value: analytics?.mrr, display: "currency", icon: TrendingUp, color: "text-orange-500" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map(card => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <card.icon className={`w-4 h-4 ${card.color}`} />
            </div>
            {loading ? (
              <Skeleton className="h-7 w-20 mt-1" />
            ) : (
              <p className="text-2xl font-bold">
                {card.display === "currency"
                  ? fmtCurrency(card.value ?? 0)
                  : (card.value ?? 0).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Tenant Table ─────────────────────────────────────────────────────────────

function TenantTable({ tenants, loading }: { tenants: Tenant[]; loading: boolean }) {
  const [statusFilter, setStatusFilter] = useState<string>("");

  const filtered = statusFilter
    ? tenants.filter(t => t.status === statusFilter)
    : tenants;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-44">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground ml-auto">{filtered.length} tenants</p>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground">No tenants found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>AI Credits</TableHead>
                <TableHead>Onboarding</TableHead>
                <TableHead>Last Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(tenant => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <p className="font-medium text-sm">{tenant.name}</p>
                    <p className="text-xs text-muted-foreground">{tenant.subdomain}</p>
                  </TableCell>
                  <TableCell><StatusBadge status={tenant.status} /></TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">{tenant.plan}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Users className="w-3 h-3 text-muted-foreground" />
                      <span className="text-sm">{tenant.userCount}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold">{fmtCurrency(tenant.monthlyRevenue)}/mo</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>{tenant.aiCreditsUsed.toLocaleString()}</span>
                        <span className="text-muted-foreground">/ {tenant.aiCreditsLimit.toLocaleString()}</span>
                      </div>
                      <Progress value={(tenant.aiCreditsUsed / Math.max(tenant.aiCreditsLimit, 1)) * 100} className="h-1.5" />
                    </div>
                  </TableCell>
                  <TableCell>
                    {tenant.status === "onboarding" ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Step {tenant.onboardingStep} / {tenant.onboardingTotal}</span>
                        </div>
                        <Progress value={(tenant.onboardingStep / Math.max(tenant.onboardingTotal, 1)) * 100} className="h-1.5" />
                      </div>
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {tenant.lastActiveAt ? fmtDate(tenant.lastActiveAt) : "Never"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Revenue Trend Chart ──────────────────────────────────────────────────────

function RevenueTrendChart({ data, loading }: { data: RevenueTrendPoint[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> Revenue Trend
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-48" />
        ) : data.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No revenue data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="rev" tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={60} />
              <YAxis yAxisId="ten" orientation="right" tick={{ fontSize: 11 }} width={40} />
              <Tooltip formatter={(val: number, name: string) =>
                name === "Revenue" ? fmtCurrency(val) : val
              } />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="rev" type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="ten" type="monotone" dataKey="newTenants" name="New Tenants" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Usage Breakdown ──────────────────────────────────────────────────────────

function UsageBreakdown({ tenants }: { tenants: Tenant[] }) {
  const data = tenants
    .filter(t => t.aiCreditsUsed > 0)
    .sort((a, b) => b.aiCreditsUsed - a.aiCreditsUsed)
    .slice(0, 10)
    .map(t => ({ name: t.name.length > 18 ? t.name.slice(0, 16) + "…" : t.name, credits: t.aiCreditsUsed }));

  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> AI Credits Usage by Tenant
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
            <Tooltip formatter={(val: number) => [val.toLocaleString(), "Credits"]} />
            <Bar dataKey="credits" name="AI Credits" fill="#f59e0b" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─── White-Label Customization Panel ─────────────────────────────────────────

const FONT_OPTIONS = [
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Roboto", value: "Roboto, sans-serif" },
  { label: "DM Sans", value: "'DM Sans', sans-serif" },
];

function WhiteLabelPanel() {
  const { toast } = useToast();
  const [branding, setBranding] = useState({
    brandName: "My Brand",
    logoUrl: "",
    primaryColor: "#2563eb",
    accentColor: "#16a34a",
    fontFamily: "Inter, sans-serif",
    supportEmail: "",
    footerText: "Powered by AcreOS",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/white-label/branding", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(branding),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      return res.json();
    },
    onSuccess: () => toast({ title: "Branding saved", description: "Your white-label settings have been updated." }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const set = (k: keyof typeof branding) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBranding((b) => ({ ...b, [k]: e.target.value }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Controls */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" /> Branding & Appearance
            </CardTitle>
            <CardDescription>Customize your tenant-facing brand</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Brand Name</Label>
              <Input value={branding.brandName} onChange={set("brandName")} placeholder="My Real Estate Co" />
            </div>

            <div>
              <Label>Logo URL</Label>
              <div className="flex gap-2">
                <Input value={branding.logoUrl} onChange={set("logoUrl")} placeholder="https://…/logo.png" />
                <Button variant="outline" size="sm" className="shrink-0">
                  <Upload className="w-4 h-4 mr-1" /> Upload
                </Button>
              </div>
              {branding.logoUrl && (
                <img src={branding.logoUrl} alt="Logo preview" className="mt-2 h-10 object-contain rounded border p-1" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Primary Color</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={branding.primaryColor}
                    onChange={(e) => setBranding((b) => ({ ...b, primaryColor: e.target.value }))}
                    className="w-10 h-8 rounded cursor-pointer border"
                  />
                  <Input
                    value={branding.primaryColor}
                    onChange={set("primaryColor")}
                    className="font-mono text-sm"
                    maxLength={7}
                  />
                </div>
              </div>
              <div>
                <Label>Accent Color</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={branding.accentColor}
                    onChange={(e) => setBranding((b) => ({ ...b, accentColor: e.target.value }))}
                    className="w-10 h-8 rounded cursor-pointer border"
                  />
                  <Input
                    value={branding.accentColor}
                    onChange={set("accentColor")}
                    className="font-mono text-sm"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label>Font Family</Label>
              <Select value={branding.fontFamily} onValueChange={(v) => setBranding((b) => ({ ...b, fontFamily: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Support Email</Label>
              <Input type="email" value={branding.supportEmail} onChange={set("supportEmail")} placeholder="support@mybrand.com" />
            </div>

            <div>
              <Label>Footer Text</Label>
              <Input value={branding.footerText} onChange={set("footerText")} placeholder="Powered by MyBrand" />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex-1">
                {saveMutation.isPending ? "Saving…" : "Save Branding"}
              </Button>
              <Button variant="outline" onClick={() => setPreview((p) => !p)}>
                <Eye className="w-4 h-4 mr-1" /> {preview ? "Hide" : "Preview"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Preview */}
      {preview && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="rounded-lg border overflow-hidden"
                style={{ fontFamily: branding.fontFamily }}
              >
                {/* Mock navigation bar */}
                <div
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ backgroundColor: branding.primaryColor }}
                >
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} alt="Logo" className="h-7 object-contain" />
                  ) : (
                    <div className="text-white font-bold text-lg">{branding.brandName}</div>
                  )}
                  <span className="text-white/80 text-sm ml-auto">Dashboard</span>
                </div>

                {/* Mock content area */}
                <div className="p-4 bg-white space-y-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: branding.primaryColor }}
                    >
                      A
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{branding.brandName} Platform</p>
                      <p className="text-xs text-gray-500">Land Investment Suite</p>
                    </div>
                    <button
                      className="ml-auto text-xs text-white px-3 py-1.5 rounded font-medium"
                      style={{ backgroundColor: branding.accentColor }}
                    >
                      Get Started
                    </button>
                  </div>
                  <div className="h-px bg-gray-100" />
                  <p className="text-xs text-gray-400">{branding.footerText}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ResellerDashboardPage() {
  const queryClient = useQueryClient();

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ["/api/white-label/analytics"],
    queryFn: async () => {
      const res = await fetch("/api/white-label/analytics", { credentials: "include" });
      return res.json();
    },
  });

  const { data: tenantsData, isLoading: tenantsLoading } = useQuery({
    queryKey: ["/api/white-label/tenants"],
    queryFn: async () => {
      const res = await fetch("/api/white-label/tenants?limit=100", { credentials: "include" });
      return res.json();
    },
  });

  const { data: trendData, isLoading: trendLoading } = useQuery({
    queryKey: ["/api/white-label/revenue-trend"],
    queryFn: async () => {
      const res = await fetch("/api/white-label/revenue-trend", { credentials: "include" });
      return res.json();
    },
  });

  const analytics: ResellerAnalytics | null = analyticsData?.analytics ?? null;
  const tenants: Tenant[] = tenantsData?.tenants ?? [];
  const revenueTrend: RevenueTrendPoint[] = trendData?.trend ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-7 h-7 text-primary" /> Reseller Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Tenant management, usage analytics, and white-label configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/white-label/tenants"] });
            queryClient.invalidateQueries({ queryKey: ["/api/white-label/analytics"] });
          }}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <CreateTenantDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/white-label/tenants"] })} />
        </div>
      </div>

      {/* Analytics Cards */}
      <AnalyticsCards analytics={analytics} loading={analyticsLoading} />

      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants">Tenants</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="branding">White-Label</TabsTrigger>
        </TabsList>

        <TabsContent value="tenants" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" /> Tenants
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TenantTable tenants={tenants} loading={tenantsLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RevenueTrendChart data={revenueTrend} loading={trendLoading} />
            <UsageBreakdown tenants={tenants} />
          </div>
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <WhiteLabelPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
