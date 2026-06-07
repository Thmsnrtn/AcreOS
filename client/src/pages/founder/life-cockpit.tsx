/**
 * /founder/life-cockpit — Founder Life-Cockpit (FOUNDER-SIDE ONLY).
 *
 * Tom's personal-ops surface that runs ALONGSIDE AcreOS to reduce overwhelm:
 *   - Taxes      — intake: upload W2s/1099s/prior returns + capture tax profile
 *   - Income     — blended W2 (self/spouse) + AcreOS draw + side income
 *   - Estimates  — quarterly-estimate radar (lights up when AcreOS pays him)
 *   - Vault      — encrypted document store (upload / download / delete)
 *   - Deadlines  — obligation CRUD (tax / legal / financial)
 *   - Advisor    — Lena/Solene check-in stub
 *
 * This is a FOUNDER route (not a customer door). Sensitive values are encrypted
 * at rest server-side; the draft-return ENGINE is the next wave (a clear seam is
 * left under Taxes → "Lena will prepare your draft return here").
 *
 * Data: /api/founder/life-cockpit/* (routes-founder-life-cockpit.ts).
 */

import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Receipt,
  Wallet,
  Gauge,
  FolderLock,
  CalendarClock,
  MessageCircleHeart,
  Upload,
  Download,
  Trash2,
  Plus,
  ShieldCheck,
  FileText,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ─── Types (mirror routes-founder-life-cockpit.ts) ───────────────────────────

interface TaxProfile {
  id: number;
  taxYear: number;
  filingStatus: string;
  state: string;
  hasSpouse: boolean;
  notes: string | null;
}
interface VaultDocument {
  id: number;
  docType: string;
  label: string;
  taxYear: number | null;
  fileName: string | null;
  mimeType: string | null;
  byteSize: number;
  createdAt: string;
}
interface Obligation {
  id: number;
  title: string;
  obligationType: string;
  dueDate: string | null;
  status: string;
  notes: string | null;
}
interface IncomeSource {
  id: number;
  taxYear: number;
  sourceType: string;
  label: string;
  amount: number | null;
  withholdingAtSource: boolean;
  notes: string | null;
}
interface OverviewResponse {
  taxYear: number;
  profile: TaxProfile | null;
  documents: VaultDocument[];
  obligations: Obligation[];
  income: IncomeSource[];
}

const BASE = "/api/founder/life-cockpit";
const CURRENT_YEAR = new Date().getUTCFullYear();

const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married — filing jointly",
  married_separate: "Married — filing separately",
  head_of_household: "Head of household",
  qualifying_widow: "Qualifying surviving spouse",
};
const DOC_TYPE_LABELS: Record<string, string> = {
  w2: "W-2",
  "1099": "1099",
  prior_return: "Prior return",
  receipt: "Receipt",
  statement: "Statement",
  other: "Other",
};
const INCOME_LABELS: Record<string, string> = {
  w2_self: "W-2 — you",
  w2_spouse: "W-2 — spouse",
  acreos_draw: "AcreOS draw",
  side_income: "Side income",
  other: "Other",
};

function fmtUsd(n: number | null): string {
  if (n === null) return "Not set";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(s: string | null): string {
  if (!s) return "No date";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Section: Taxes ──────────────────────────────────────────────────────────

function TaxesSection({ profile, taxYear }: { profile: TaxProfile | null; taxYear: number }) {
  const { toast } = useToast();
  const [filingStatus, setFilingStatus] = React.useState(profile?.filingStatus ?? "married_joint");
  const [state, setState] = React.useState(profile?.state ?? "MA");
  const [hasSpouse, setHasSpouse] = React.useState(profile?.hasSpouse ?? false);
  const [notes, setNotes] = React.useState(profile?.notes ?? "");

  React.useEffect(() => {
    setFilingStatus(profile?.filingStatus ?? "married_joint");
    setState(profile?.state ?? "MA");
    setHasSpouse(profile?.hasSpouse ?? false);
    setNotes(profile?.notes ?? "");
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `${BASE}/tax/profile`, {
        taxYear,
        filingStatus,
        state,
        hasSpouse,
        notes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BASE, "overview"] });
      toast({ title: "Tax profile saved", description: `Profile for ${taxYear} captured.` });
    },
    onError: () => toast({ title: "Could not save", variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="w-4 h-4" aria-hidden /> Tax profile · {taxYear}
          </CardTitle>
          <CardDescription>
            Capture your filing basics. Massachusetts is your home state; spouse W-2 income is supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filing-status">Filing status</Label>
              <Select value={filingStatus} onValueChange={setFilingStatus}>
                <SelectTrigger id="filing-status" aria-label="Filing status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FILING_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tax-state">State</Label>
              <Input
                id="tax-state"
                value={state}
                maxLength={2}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                className="uppercase"
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/40 p-3">
            <div>
              <Label htmlFor="has-spouse" className="cursor-pointer">Spouse on this return</Label>
              <p className="text-xs text-muted-foreground">Adds a spouse W-2 income line + joint defaults.</p>
            </div>
            <Switch id="has-spouse" checked={hasSpouse} onCheckedChange={setHasSpouse} aria-label="Spouse on this return" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-notes">Notes</Label>
            <Textarea
              id="tax-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything Lena should know when preparing your draft return…"
              rows={3}
            />
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save tax profile"}
          </Button>
        </CardContent>
      </Card>

      {/* Draft-return seam — NEXT wave */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
            <FileText className="w-4 h-4" aria-hidden /> Draft return
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={MessageCircleHeart}
            headline="Lena will prepare your draft return here"
            subtitle="Upload your W-2s, 1099s, and prior return in the Vault, then capture your tax profile above. The prep + self-file package engine lands in the next wave."
            cta={{ label: "", _noOp: true }}
            tone="default"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Section: Income ─────────────────────────────────────────────────────────

function IncomeSection({ income, taxYear }: { income: IncomeSource[]; taxYear: number }) {
  const { toast } = useToast();
  const [sourceType, setSourceType] = React.useState("w2_self");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");

  const add = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${BASE}/income`, {
        taxYear,
        sourceType,
        label,
        amount: amount === "" ? null : Number(amount),
        withholdingAtSource: sourceType.startsWith("w2"),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BASE, "overview"] });
      setLabel("");
      setAmount("");
      toast({ title: "Income source added" });
    },
    onError: () => toast({ title: "Could not add income source", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `${BASE}/income/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [BASE, "overview"] }),
  });

  const total = income.reduce((sum, s) => sum + (s.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="w-4 h-4" aria-hidden /> Blended income · {taxYear}
          </CardTitle>
          <CardDescription>
            Dollar amounts are encrypted at rest. Total tracked: <span className="font-semibold text-foreground">{fmtUsd(total)}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {income.length === 0 ? (
            <EmptyState
              icon={Wallet}
              headline="No income sources yet"
              subtitle="Add your W-2 (and your spouse's), plus any side income. AcreOS draw lights up automatically once it pays you."
              cta={{ label: "", _noOp: true }}
            />
          ) : (
            <ul className="divide-y divide-border/40" role="list">
              {income.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-medium text-sm">{s.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {INCOME_LABELS[s.sourceType] ?? s.sourceType}
                      {!s.withholdingAtSource && " · needs quarterly estimates"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm tabular-nums">{fmtUsd(s.amount)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete income source ${s.label}`}
                      onClick={() => remove.mutate(s.id)}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end border-t border-border/40 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="income-type">Type</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger id="income-type" aria-label="Income source type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INCOME_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-label">Label</Label>
              <Input id="income-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Day job — Acme Corp" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="income-amount">Annual $</Label>
              <Input id="income-amount" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
            <Button onClick={() => add.mutate()} disabled={add.isPending || !label.trim()}>
              <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quarterly-estimate radar — lights up when AcreOS pays a draw */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="w-4 h-4" aria-hidden /> Quarterly-estimate radar
          </CardTitle>
        </CardHeader>
        <CardContent>
          {income.some((s) => !s.withholdingAtSource && (s.amount ?? 0) > 0) ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              You have income without withholding at source. Massachusetts + federal quarterly
              estimates will be computed here once the draft-return engine ships next wave.
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Quiet for now. This radar lights up when AcreOS starts paying you a draw, or when you
              add side income without withholding — the kinds of income that need quarterly estimates.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Section: Vault ──────────────────────────────────────────────────────────

function VaultSection({ documents }: { documents: VaultDocument[] }) {
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [docType, setDocType] = React.useState("w2");
  const [label, setLabel] = React.useState("");

  const upload = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("no file");
      const form = new FormData();
      form.append("file", file);
      form.append("docType", docType);
      form.append("label", label || file.name);
      const res = await fetch(`${BASE}/documents`, { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error("upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BASE, "overview"] });
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      toast({ title: "Document encrypted + stored" });
    },
    onError: () => toast({ title: "Upload failed", description: "Allowed: PDF, image, document, text (max 15 MB).", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `${BASE}/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [BASE, "overview"] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderLock className="w-4 h-4" aria-hidden /> Document vault
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" aria-hidden />
          Every file is encrypted at rest (AES-256-GCM). Founder-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end rounded-lg border border-border/40 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="doc-type">Type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id="doc-type" aria-label="Document type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-label">Label</Label>
            <Input id="doc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2025 W-2 — Acme Corp" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-file" className="sr-only">File</Label>
            <input ref={fileRef} id="doc-file" type="file" aria-label="Choose document to upload" className="text-sm" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.doc,.docx,.xls,.xlsx" />
          </div>
        </div>
        <Button onClick={() => upload.mutate()} disabled={upload.isPending}>
          <Upload className="w-4 h-4 mr-1.5" aria-hidden /> {upload.isPending ? "Encrypting…" : "Upload"}
        </Button>

        {documents.length === 0 ? (
          <EmptyState
            icon={FolderLock}
            headline="Your vault is empty"
            subtitle="Upload your W-2s, 1099s, and prior returns. They're encrypted before they ever touch storage."
            cta={{ label: "", _noOp: true }}
          />
        ) : (
          <ul className="divide-y divide-border/40" role="list">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{d.label}</p>
                  <p className="text-xs text-muted-foreground">
                    <Badge variant="secondary" className="mr-1.5">{DOC_TYPE_LABELS[d.docType] ?? d.docType}</Badge>
                    {fmtBytes(d.byteSize)} · {fmtDate(d.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <a href={`${BASE}/documents/${d.id}/download`} aria-label={`Download ${d.label}`}>
                    <Button variant="ghost" size="icon" aria-label={`Download ${d.label}`}>
                      <Download className="w-4 h-4" aria-hidden />
                    </Button>
                  </a>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${d.label}`} onClick={() => remove.mutate(d.id)}>
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Deadlines ──────────────────────────────────────────────────────

function DeadlinesSection({ obligations }: { obligations: Obligation[] }) {
  const { toast } = useToast();
  const [title, setTitle] = React.useState("");
  const [obligationType, setObligationType] = React.useState("tax");
  const [dueDate, setDueDate] = React.useState("");

  const add = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${BASE}/obligations`, {
        title,
        obligationType,
        dueDate: dueDate || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BASE, "overview"] });
      setTitle("");
      setDueDate("");
      toast({ title: "Deadline added" });
    },
    onError: () => toast({ title: "Could not add deadline", variant: "destructive" }),
  });

  const patch = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `${BASE}/obligations/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [BASE, "overview"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `${BASE}/obligations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [BASE, "overview"] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="w-4 h-4" aria-hidden /> Deadlines & obligations
        </CardTitle>
        <CardDescription>Tax, legal, and financial deadlines in one radar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end rounded-lg border border-border/40 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="ob-title">Title</Label>
            <Input id="ob-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="File MA + federal return" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-type">Type</Label>
            <Select value={obligationType} onValueChange={setObligationType}>
              <SelectTrigger id="ob-type" aria-label="Obligation type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tax">Tax</SelectItem>
                <SelectItem value="legal">Legal</SelectItem>
                <SelectItem value="financial">Financial</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-due">Due</Label>
            <Input id="ob-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !title.trim()}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Add
          </Button>
        </div>

        {obligations.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            headline="No deadlines tracked"
            subtitle="Add your filing dates and any legal or financial to-dos so nothing slips."
            cta={{ label: "", _noOp: true }}
          />
        ) : (
          <ul className="divide-y divide-border/40" role="list">
            {obligations.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className={`font-medium text-sm ${o.status !== "open" ? "line-through text-muted-foreground" : ""}`}>{o.title}</p>
                  <p className="text-xs text-muted-foreground capitalize">{o.obligationType} · {fmtDate(o.dueDate)}</p>
                </div>
                <div className="flex items-center gap-1">
                  {o.status === "open" ? (
                    <Button variant="outline" size="sm" onClick={() => patch.mutate({ id: o.id, status: "done" })}>Mark done</Button>
                  ) : (
                    <Badge variant="secondary" className="capitalize">{o.status}</Badge>
                  )}
                  <Button variant="ghost" size="icon" aria-label={`Delete ${o.title}`} onClick={() => remove.mutate(o.id)}>
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Advisor (stub) ─────────────────────────────────────────────────

function AdvisorSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircleHeart className="w-4 h-4" aria-hidden /> Advisor check-in
        </CardTitle>
        <CardDescription>Lena (CFO) + Solene (COO) — your personal financial corner.</CardDescription>
      </CardHeader>
      <CardContent>
        <EmptyState
          icon={MessageCircleHeart}
          headline="Lena & Solene check-in lands next wave"
          subtitle="Once your income and documents are in, Lena will surface a plain-language read on your tax picture, quarterly estimates, and reserve targets — and Solene will keep the deadlines moving. No jargon."
          cta={{ label: "", _noOp: true }}
        />
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FounderLifeCockpitPage() {
  useDocumentTitle("Life-Cockpit");
  const taxYear = CURRENT_YEAR;

  const { data, isLoading, isError, refetch } = useQuery<OverviewResponse>({
    queryKey: [BASE, "overview", taxYear],
    queryFn: async () => {
      const res = await apiRequest("GET", `${BASE}/overview?taxYear=${taxYear}`);
      return res.json();
    },
  });

  return (
    <PageShell label="Life-Cockpit">
      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-6">
        <motion.div variants={staggerItem}>
          <h1 className="text-2xl font-semibold tracking-tight">Life-Cockpit</h1>
          <p className="text-muted-foreground">
            Your personal taxes, income, and deadlines — alongside running AcreOS. Founder-only and encrypted.
          </p>
        </motion.div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <QueryErrorState onRetry={() => refetch()} />
        ) : (
          <motion.div variants={staggerItem}>
            <Tabs defaultValue="taxes">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="taxes"><Receipt className="w-4 h-4 mr-1.5" aria-hidden /> Taxes</TabsTrigger>
                <TabsTrigger value="income"><Wallet className="w-4 h-4 mr-1.5" aria-hidden /> Income</TabsTrigger>
                <TabsTrigger value="vault"><FolderLock className="w-4 h-4 mr-1.5" aria-hidden /> Vault</TabsTrigger>
                <TabsTrigger value="deadlines"><CalendarClock className="w-4 h-4 mr-1.5" aria-hidden /> Deadlines</TabsTrigger>
                <TabsTrigger value="advisor"><MessageCircleHeart className="w-4 h-4 mr-1.5" aria-hidden /> Advisor</TabsTrigger>
              </TabsList>
              <TabsContent value="taxes" className="mt-6">
                <TaxesSection profile={data?.profile ?? null} taxYear={data?.taxYear ?? taxYear} />
              </TabsContent>
              <TabsContent value="income" className="mt-6">
                <IncomeSection income={data?.income ?? []} taxYear={data?.taxYear ?? taxYear} />
              </TabsContent>
              <TabsContent value="vault" className="mt-6">
                <VaultSection documents={data?.documents ?? []} />
              </TabsContent>
              <TabsContent value="deadlines" className="mt-6">
                <DeadlinesSection obligations={data?.obligations ?? []} />
              </TabsContent>
              <TabsContent value="advisor" className="mt-6">
                <AdvisorSection />
              </TabsContent>
            </Tabs>
          </motion.div>
        )}
      </motion.div>
    </PageShell>
  );
}
