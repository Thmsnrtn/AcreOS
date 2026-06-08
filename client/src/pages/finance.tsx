import { PageShell } from "@/components/page-shell";
import { useNotes, useCreateNote, useDeleteNote } from "@/hooks/use-notes";
import { usePayments, useRecordPayment } from "@/hooks/use-payments";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useState, useEffect } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertNoteSchema, type Note, type Lead, type Property } from "@shared/schema";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link, useSearch } from "wouter";
import { clientLogger } from "@/lib/clientLogger";

// Client-side form schema that omits organizationId (added by server)
const noteFormSchema = insertNoteSchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Plus, DollarSign, Calendar, TrendingUp, AlertTriangle, CheckCircle, Clock, User, MapPin, FileText, CreditCard, X, Eye, Receipt, Calculator, Trash2, Loader2, Download, RefreshCw, Send, ArrowUpRight, Phone, Mail, Link2, Copy, ExternalLink, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, addMonths } from "date-fns";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { usd } from "@/lib/format";
import "./today.css";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { QueryErrorState } from "@/components/query-error-state";
import { PersonaFinanceHero } from "@/components/finance/PersonaFinanceHero";
import { FinanceBook } from "@/components/finance/FinanceBook";
import { usePersona, useTerm } from "@/hooks/use-persona";
import { AtrGate } from "@/components/AtrGate";
import { useAuth } from "@/hooks/use-auth";

interface StripeConnectStatus {
  isConnected: boolean;
  accountId?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

type NoteWithDetails = Note & {
  borrower?: Lead;
  property?: Property;
};

export default function FinancePage() {
  useDocumentTitle("Finance");
  // Persona controls hero variant + which chart shows. The default
  // land_investor view keeps the existing 12-month area chart (now
  // de-chartjunked); note-investor and project personas get a
  // persona-shaped hero in front and the area chart suppressed in
  // favor of the small-multiple or P&L tile, which speaks to them.
  const persona = usePersona();
  const propertyPluralLabel = useTerm("entity.property.plural");
  const isLandInvestorPersona = persona === "land_investor" || persona === "tax_delinquent";
  void propertyPluralLabel; // reserved for future per-persona vocabulary swaps in this page
  const { data: notes, isLoading, error: notesError, refetch: refetchNotes } = useNotes();
  const { data: leads } = useLeads();
  const { data: properties } = useProperties();
  // /finance?action=new opens the new-note dialog — wires the global FAB /
  // new-item-menu's "New Note" entry to a real action.
  const financeSearch = useSearch();
  const financeAction = new URLSearchParams(financeSearch).get("action");
  const [isCreateOpen, setIsCreateOpen] = useState(financeAction === "new");
  useEffect(() => {
    if (financeAction === "new") {
      const params = new URLSearchParams(financeSearch);
      params.delete("action");
      const next = params.toString();
      window.history.replaceState(null, "", next ? `/finance?${next}` : "/finance");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedNote, setSelectedNote] = useState<NoteWithDetails | null>(null);
  const [deletingNote, setDeletingNote] = useState<NoteWithDetails | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isQboSyncing, setIsQboSyncing] = useState(false);
  const { mutate: deleteNote, isPending: isDeleting } = useDeleteNote();
  const { toast } = useToast();
  const { data: portfolioSummary } = useQuery<{
    totalNotes: number;
    activeNotes: number;
    totalPortfolioValue: number;
    totalMonthlyPayment: number;
    monthlyCashFlow: { month: string; amount: number }[];
  }>({ queryKey: ["/api/finance/portfolio-summary"] });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch('/api/notes/export', { credentials: 'include' });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'notes.csv';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      clientLogger.error('Export error:', error);
      // Invisible export failures were the #1 user complaint pre-audit.
      // Surface a destructive toast so the user knows the file wasn't
      // downloaded and can retry.
      toast({
        title: "Couldn't export notes",
        description: error?.message || "Check your connection and try again — no file was downloaded.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };


  const handleQboSync = async () => {
    setIsQboSyncing(true);
    try {
      const res = await fetch('/api/bookkeeping/quickbooks/sync', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Sync failed');
      toast({ title: "QuickBooks sync complete", description: `Synced ${data.synced} payment(s)${data.errors > 0 ? `, ${data.errors} error(s)` : ''}.` });
    } catch (err: any) {
      toast({
        title: "Couldn't sync to QuickBooks",
        description: `${err?.message || "Sync couldn't complete"} — no records were changed.`,
        variant: "destructive",
      });
    } finally {
      setIsQboSyncing(false);
    }
  };

  const enrichedNotes: NoteWithDetails[] = (notes || []).map(note => ({
    ...note,
    borrower: leads?.find((l: any) => l.id === note.borrowerId),
    property: properties?.find((p: any) => p.id === note.propertyId),
  }));

  const activeNotes = enrichedNotes.filter(n => n.status === 'active');
  const totalPortfolio = activeNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);
  const monthlyIncome = activeNotes.reduce((sum, n) => sum + Number(n.monthlyPayment || 0), 0);
  const totalPrincipal = activeNotes.reduce((sum, n) => sum + Number(n.originalPrincipal || 0), 0);

  // Status / loan-health → semantic --acr-* tone (Tier 1 pattern).
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-acr-pos-soft text-acr-pos border-transparent';
      case 'paid_off': return 'bg-acr-brand-soft text-acr-brand border-transparent';
      case 'defaulted': return 'bg-acr-neg-soft text-acr-neg border-transparent';
      case 'pending': return 'bg-acr-warn-soft text-acr-warn border-transparent';
      default: return 'bg-acr-surface-2 text-acr-ink-3 border-transparent';
    }
  };

  const getLoanHealth = (note: NoteWithDetails) => {
    if (!note.nextPaymentDate) return { status: 'good', label: 'Current', color: 'text-acr-pos' };
    const daysUntilDue = Math.floor((new Date(note.nextPaymentDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilDue < 0) return { status: 'late', label: `${Math.abs(daysUntilDue)} days late`, color: 'text-acr-neg' };
    if (daysUntilDue <= 5) return { status: 'due', label: `Due in ${daysUntilDue} days`, color: 'text-acr-warn' };
    return { status: 'good', label: 'Current', color: 'text-acr-pos' };
  };

  const handleDelete = () => {
    if (deletingNote) {
      deleteNote(deletingNote.id, {
        onSuccess: () => {
          setDeletingNote(null);
          setSelectedNote(null);
        },
      });
    }
  };

  // Tufte de-chartjunk: when the existing area chart renders, use it
  // to mark the prior-year mean as a horizontal reference line so the
  // chart actually answers "is this month above or below the run-rate"
  // instead of inviting eyeball-integration of an opaque gradient.
  const cashFlowPriorYearMean =
    portfolioSummary?.monthlyCashFlow && portfolioSummary.monthlyCashFlow.length > 0
      ? portfolioSummary.monthlyCashFlow.reduce((s, m) => s + Number(m.amount || 0), 0) /
        portfolioSummary.monthlyCashFlow.length
      : 0;

  return (
    <PageShell label="Finance">
          {/* Persona-shaped hero — renders nothing for default
              land_investor persona, so the existing chart below stays
              the entry point. For note_investor / wholesaler / flipper
              the hero is the entry point and the area chart is
              suppressed in favor of the persona-shaped representation. */}
          <PersonaFinanceHero />

          {/* Portfolio Cash Flow Chart — kept for the default
              land_investor persona only. Note-investor sees the
              twelve small-multiple panels in the hero above, which
              is the Tufte-recommended substitute for an area chart
              when you want per-month decomposition. */}
          {isLandInvestorPersona && portfolioSummary?.monthlyCashFlow && portfolioSummary.monthlyCashFlow.some(m => m.amount > 0) && (
            <Card className="mb-6">
              <CardHeader className="pb-2">
                {/* §1.3: section-level head — dual class + utility. */}
                <CardTitle className="acr-section-h2 text-section-h2 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" aria-hidden="true" />
                  Monthly Cash Flow (Last 12 Months)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="h-48"
                  role="img"
                  aria-label={`Monthly cash flow over ${portfolioSummary.monthlyCashFlow.length} months: ${portfolioSummary.monthlyCashFlow.map(m => `${m.month} ${usd(m.amount, { noCents: true })}`).join(", ")}`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    {/*
                      Tufte de-chartjunk (Beautiful Evidence, ch.4): the
                      original gradient fading-to-zero shaded a region
                      whose visual weight varied inversely with the
                      quantity it depicted. Replaced with a 1px solid
                      brand stroke + zero-axis tick + prior-year-mean
                      reference line so the chart answers a question
                      ("above run-rate?") rather than illustrating one.
                    */}
                    <AreaChart data={portfolioSummary.monthlyCashFlow}>
                      <XAxis dataKey="month" fontSize={10} tickLine={true} axisLine={true} />
                      <YAxis fontSize={10} tickLine={true} axisLine={true} tickFormatter={(v: number) => usd(v, { noCents: true })} />
                      <Tooltip formatter={((value: number) => [usd(value), "Cash flow"]) as any} />
                      {cashFlowPriorYearMean > 0 && (
                        <ReferenceLine
                          y={cashFlowPriorYearMean}
                          stroke="currentColor"
                          strokeDasharray="3 3"
                          strokeOpacity={0.3}
                          label={{
                            value: `Mean ${usd(cashFlowPriorYearMean, { noCents: true })}`,
                            position: "right",
                            fontSize: 10,
                            opacity: 0.6,
                          }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="var(--acr-brand)"
                        fill="transparent"
                        strokeWidth={1}
                        dot={{ r: 2, fill: "var(--acr-brand)", strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="acr-cc-hero" style={{ marginTop: 0 }}>
              <div>
                <div className="acr-eyebrow">Finance</div>
                {/* §1.3: dual class + Tailwind utility. */}
                <h1 className="acr-cc-greeting text-hero" data-testid="text-page-title">
                  The paper side.
                  <span className="acr-cc-greeting-soft">
                    {" "}Notes, payments, and statements — kept straight.
                  </span>
                </h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* r8 James: the borrower portal at /portal was advertised
                  in the product model but had no discoverable nav
                  entry. Surface a direct link from /finance. */}
              <Button
                variant="outline"
                asChild
                data-testid="button-open-borrower-portal"
                title="Preview the borrower-facing portal where buyers view balances and make payments"
              >
                <a href="/portal" target="_blank" rel="noopener noreferrer" aria-label="Open borrower portal (opens in new tab)">
                  Borrower Portal
                </a>
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={isExporting}
                data-testid="button-export-notes"
              >
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4 mr-2" aria-hidden="true" />}
                Export CSV
              </Button>
              <Button
                variant="outline"
                onClick={handleQboSync}
                disabled={isQboSyncing}
                data-testid="button-qbo-sync"
              >
                {isQboSyncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />}
                Sync to QuickBooks
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-note">
                    <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Create Note
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px] floating-window">
                  <DialogHeader>
                    <DialogTitle>Create Promissory Note</DialogTitle>
                    <DialogDescription>
                      Enter the details for a new promissory note including borrower, property, and payment terms.
                    </DialogDescription>
                  </DialogHeader>
                  <NoteForm onSuccess={() => setIsCreateOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <DisclaimerBanner type="finance" />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-primary/10">
                    <FileText className="w-5 h-5 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Active Notes</p>
                    <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-active-notes">{activeNotes.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-acr-pos/10">
                    <DollarSign className="w-5 h-5 text-acr-pos" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Portfolio value</p>
                    <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-portfolio-value">
                      {usd(totalPortfolio)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-acr-accent/10">
                    <TrendingUp className="w-5 h-5 text-acr-accent" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Monthly income</p>
                    <p className="text-2xl font-bold font-mono tabular-nums text-acr-pos" data-testid="text-monthly-income">
                      {usd(monthlyIncome)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-accent/10">
                    <Calculator className="w-5 h-5 text-accent-foreground" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total originated</p>
                    <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-total-principal">
                      {usd(totalPrincipal)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {notesError && (
            <QueryErrorState
              error={notesError}
              onRetry={() => refetchNotes()}
              title="Failed to load notes"
              compact
            />
          )}

          {/* Finance sub-tabs WITHIN the fixed Finance door. "Portfolio" keeps
              the existing loan list; "Book" is the read-only running register
              (FinanceBook). This is a section within the Finance door — not a
              new top-level nav entry. */}
          <Tabs defaultValue="portfolio" className="mt-2">
            <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid">
              <TabsTrigger value="portfolio" data-testid="tab-finance-portfolio">Portfolio</TabsTrigger>
              <TabsTrigger value="book" data-testid="tab-finance-book">Book</TabsTrigger>
            </TabsList>

            <TabsContent value="portfolio" className="mt-4">
          <Card className="floating-window overflow-hidden">
            <CardHeader className="pb-4">
              {/* §1.3: section h2 uses dual CSS class + Tailwind utility. */}
              <CardTitle className="acr-section-h2 text-section-h2">Loan Portfolio</CardTitle>
              <CardDescription>Tap a note to view details, payment history, and amortization schedule</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {/* Loading + empty states render outside the scrolling table
                  container so their content doesn't get clipped by the
                  horizontal-overflow behavior used for the desktop table. */}
              {isLoading ? (
                <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading notes">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" announce={i === 0} announceText="Loading your notes" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-40" announce={false} />
                        <Skeleton className="h-3 w-24" announce={false} />
                      </div>
                      <Skeleton className="h-5 w-20" announce={false} />
                    </div>
                  ))}
                </div>
              ) : !enrichedNotes || enrichedNotes.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  headline="No notes serviced yet"
                  subtitle="Originate or import a note — Pax generates the amortization schedule the moment you wire the terms, then pings on day 11 and prepares your 1099-NEC at year-end."
                  cta={{
                    label: "Create Your First Note",
                    onClick: () => setIsCreateOpen(true),
                    "data-testid": "finance-create-note",
                  }}
                  actionIcon={null}
                />
              ) : (
                <>
                  {/* Mobile: card list. The 8-column table is unreadable in a
                      375px viewport; a stacked card per note keeps every value
                      visible without horizontal scrolling. md+ uses the full
                      table below. */}
                  <ul className="md:hidden divide-y divide-border" data-testid="list-notes-mobile">
                    {enrichedNotes.map((note) => {
                      const health = getLoanHealth(note);
                      const borrowerLabel = note.borrower
                        ? `${note.borrower.firstName} ${note.borrower.lastName}`
                        : note.borrowerId
                          ? `Borrower #${note.borrowerId}`
                          : "Unassigned borrower";
                      const propertyLabel = note.property
                        ? `${note.property.county}, ${note.property.state}`
                        : note.propertyId
                          ? `Property #${note.propertyId}`
                          : "Unassigned property";
                      return (
                        <li key={note.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedNote(note)}
                            className="w-full text-left px-4 py-3 hover-elevate active:bg-muted/30"
                            data-testid={`card-note-${note.id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <User className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                                  <span className="font-medium truncate">{borrowerLabel}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                  <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{propertyLabel}</span>
                                </div>
                                {note.originatingDealId != null && (
                                  // Note→deal lineage. The card is a <button>, so
                                  // we can't nest an anchor here — render a
                                  // non-interactive lineage chip; the linked
                                  // version lives on the desktop table row.
                                  <div className="mt-1">
                                    <Badge
                                      variant="outline"
                                      className="gap-1 text-[11px] font-normal"
                                      data-testid={`chip-note-deal-${note.id}`}
                                    >
                                      <Link2 className="w-3 h-3" aria-hidden="true" />
                                      from Deal #{note.originatingDealId}
                                    </Badge>
                                  </div>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-mono font-semibold tabular-nums">{usd(note.currentBalance)}</div>
                                <div className="font-mono text-sm text-acr-pos tabular-nums">
                                  {usd(note.monthlyPayment)}<span className="text-muted-foreground">/mo</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-2 text-xs">
                              <div className="flex items-center gap-2">
                                <Badge className={getStatusColor(note.status)}>{note.status}</Badge>
                                <span className={`font-medium ${health.color}`}>{health.label}</span>
                              </div>
                              <span className="text-muted-foreground">
                                {note.nextPaymentDate
                                  ? `Next ${format(new Date(note.nextPaymentDate), 'MMM d')}`
                                  : 'No next due'}
                              </span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Desktop: full 8-column table. Hidden on mobile. */}
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="min-w-[140px]">Borrower</TableHead>
                          <TableHead className="min-w-[140px]">Property</TableHead>
                          <TableHead className="text-right min-w-[90px]">Balance</TableHead>
                          <TableHead className="text-right min-w-[80px]">Monthly</TableHead>
                          <TableHead className="min-w-[100px]">Next Due</TableHead>
                          <TableHead className="min-w-[80px]">Health</TableHead>
                          <TableHead className="min-w-[80px]">Status</TableHead>
                          <TableHead className="min-w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {enrichedNotes.map((note) => {
                          const health = getLoanHealth(note);
                          return (
                            <TableRow
                              key={note.id}
                              className="cursor-pointer hover-elevate"
                              onClick={() => setSelectedNote(note)}
                              data-testid={`row-note-${note.id}`}
                            >
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <User className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                  <span className="font-medium">
                                    {note.borrower ? `${note.borrower.firstName} ${note.borrower.lastName}` : (note.borrowerId ? `Borrower #${note.borrowerId}` : "Unassigned borrower")}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                  <span className="text-sm">
                                    {note.property ? `${note.property.county}, ${note.property.state}` : (note.propertyId ? `Property #${note.propertyId}` : "Unassigned property")}
                                  </span>
                                </div>
                                {note.originatingDealId != null && (
                                  // Note→deal lineage chip — links back to the
                                  // originating deal. stopPropagation so the
                                  // chip navigates without also opening the
                                  // note drawer (the row's onClick).
                                  <Link href={`/deals/${note.originatingDealId}`}>
                                    <Badge
                                      variant="outline"
                                      className="mt-1 ml-6 gap-1 cursor-pointer hover-elevate text-[11px] font-normal"
                                      onClick={(e) => e.stopPropagation()}
                                      data-testid={`chip-note-deal-${note.id}`}
                                    >
                                      <Link2 className="w-3 h-3" aria-hidden="true" />
                                      from Deal #{note.originatingDealId}
                                    </Badge>
                                  </Link>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium tabular-nums">
                                {usd(note.currentBalance)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold tabular-nums text-acr-pos">
                                {usd(note.monthlyPayment)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {note.nextPaymentDate ? format(new Date(note.nextPaymentDate), 'MMM d, yyyy') : '-'}
                              </TableCell>
                              <TableCell>
                                <span className={`text-sm font-medium ${health.color}`}>
                                  {health.label}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge className={getStatusColor(note.status)}>
                                  {note.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Button size="icon" variant="ghost" aria-label="View note details" data-testid={`button-view-note-${note.id}`}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="book" className="mt-4">
              <FinanceBook notes={enrichedNotes} />
            </TabsContent>
          </Tabs>

      {selectedNote && (
        <NoteDetailDrawer
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
          onDelete={() => setDeletingNote(selectedNote)}
        />
      )}

      <ConfirmDialog
        open={!!deletingNote}
        onOpenChange={(open) => !open && setDeletingNote(null)}
        title="Delete Note"
        description={`Are you sure you want to delete this promissory note for ${deletingNote?.borrower ? `${deletingNote.borrower.firstName} ${deletingNote.borrower.lastName}` : (deletingNote?.borrowerId ? `Borrower #${deletingNote.borrowerId}` : "Unassigned borrower")}? This action cannot be undone and will permanently remove the note and its payment history.`}
        confirmLabel="Delete Note"
        onConfirm={handleDelete}
        isLoading={isDeleting}
        variant="destructive"
      />
    </PageShell>
  );
}

function NoteDetailDrawer({ note, onClose, onDelete }: {
  note: NoteWithDetails;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { user: authedUser } = useAuth();
  // Build the attestor payload for the ATR gate (Reg-Z §1026.43). Only the
  // current authenticated user can attest — we drop a render of AtrGate
  // entirely if useAuth hasn't resolved.
  const atrAttestor =
    authedUser && (authedUser as { id?: string }).id
      ? {
          id: String((authedUser as { id: string }).id),
          name: [
            (authedUser as { firstName?: string }).firstName,
            (authedUser as { lastName?: string }).lastName,
          ]
            .filter(Boolean)
            .join(" ")
            .trim() ||
            (authedUser as { email?: string }).email ||
            "Authorized signer",
        }
      : null;
  const { data: payments, isLoading: paymentsLoading } = usePayments(note.id);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showAcceptPayment, setShowAcceptPayment] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingSchedule, setIsDownloadingSchedule] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [dunningData, setDunningData] = useState<any>(null);
  const [isDunningLoading, setIsDunningLoading] = useState(false);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: stripeConnectStatus, isLoading: isStripeStatusLoading } = useQuery<StripeConnectStatus>({
    queryKey: ['/api/stripe/connect/status'],
    staleTime: 1000 * 60 * 5,
  });

  const handleGeneratePaymentLink = async () => {
    setIsGeneratingLink(true);
    try {
      const res = await fetch(`/api/stripe/connect/payment-link/${note.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setPaymentLink(data.paymentLink);
      toast({ title: "Payment link generated", description: "You can now share this link with the borrower." });
    } catch (err: any) {
      toast({
        title: "Couldn't generate payment link",
        description: err?.message || "Check your connection and try again — no link was created or charged.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleCopyPaymentLink = async () => {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(paymentLink);
      toast({ title: "Payment link copied to clipboard" });
    } catch (err: any) {
      // Clipboard API can reject in non-secure contexts or when the
      // permission is blocked — surface this so the user knows to
      // copy manually instead of silently doing nothing.
      toast({
        title: "Couldn't copy link",
        description: "Select the link and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const fetchDunningData = async () => {
    setIsDunningLoading(true);
    try {
      const res = await fetch(`/api/notes/${note.id}/dunning`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setDunningData(data);
    } catch (err: any) {
      toast({
        title: "Couldn't load dunning data",
        description: err?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsDunningLoading(false);
    }
  };

  const handleRegenerateSchedule = async () => {
    setIsRegenerating(true);
    try {
      const res = await fetch(`/api/notes/${note.id}/schedule/generate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      window.location.reload();
    } catch (err: any) {
      toast({
        title: "Couldn't regenerate schedule",
        description: err?.message || "Check your connection and try again — the existing schedule is unchanged.",
        variant: "destructive",
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSendReminder = async (type: string) => {
    setIsSendingReminder(true);
    try {
      const res = await fetch(`/api/notes/${note.id}/dunning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'send_reminder', stage: type }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      fetchDunningData();
      toast({ title: "Reminder sent", description: "Your borrower has been notified." });
    } catch (err: any) {
      toast({
        title: "Couldn't send reminder",
        description: err?.message || "Check your connection and try again — no reminder was sent.",
        variant: "destructive",
      });
    } finally {
      setIsSendingReminder(false);
    }
  };

  // Amortization schedule PDF download (separate from the note doc PDF).
  // Endpoint exists at /api/notes/:id/schedule/pdf — the button was
  // unwired pre-audit (no onClick handler).
  const handleDownloadSchedulePdf = async () => {
    setIsDownloadingSchedule(true);
    try {
      const response = await fetch(`/api/notes/${note.id}/schedule/pdf`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `amortization-schedule-${note.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      toast({
        title: "Couldn't export schedule PDF",
        description: error?.message || "Check your connection and try again — no file was downloaded.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingSchedule(false);
    }
  };

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/notes/${note.id}/document`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `promissory-note-${note.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      toast({
        title: "Couldn't download note PDF",
        description: error?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const schedule = note.amortizationSchedule || [];
  const paidPayments = schedule.filter(s => s.status === 'paid').length;
  const totalPayments = schedule.length;
  const progress = totalPayments > 0 ? (paidPayments / totalPayments) * 100 : 0;

  const totalPaid = (payments || [])
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const drawerTitleId = "note-detail-title";
  const borrowerName = note.borrower
    ? `${note.borrower.firstName} ${note.borrower.lastName}`
    : (note.borrowerId ? `Borrower #${note.borrowerId}` : "Unassigned borrower");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={drawerTitleId}
    >
      <div
        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 id={drawerTitleId} className="text-xl font-bold" data-testid="text-note-title">
                Note #<span className="tabular-nums">{note.id}</span>
              </h2>
              <p className="text-muted-foreground truncate">
                {borrowerName}
              </p>
              {note.originatingDealId != null && (
                // This note was carried from a closed seller-financed deal.
                // Surface the lineage inline + link back across the Deals door.
                <Link href={`/deals/${note.originatingDealId}`}>
                  <Badge
                    variant="outline"
                    className="mt-1.5 gap-1 cursor-pointer hover-elevate text-[11px] font-normal"
                    data-testid="chip-drawer-originating-deal"
                  >
                    <Link2 className="w-3 h-3" aria-hidden="true" />
                    from Deal #{note.originatingDealId}
                  </Badge>
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col items-center gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 sm:h-9 sm:w-9"
                  onClick={handleDownloadPdf}
                  disabled={isDownloading}
                  aria-label={`Download note PDF for ${borrowerName}`}
                  data-testid="button-download-note-pdf"
                >
                  {isDownloading ? (
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="w-5 h-5" aria-hidden="true" />
                  )}
                </Button>
                <span className="text-micro text-muted-foreground tabular-nums" data-testid="text-cost-pdf">$0.05</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 sm:h-9 sm:w-9"
                onClick={onDelete}
                aria-label={`Delete note for ${borrowerName}`}
                data-testid="button-delete-note"
              >
                <Trash2 className="w-5 h-5 text-destructive" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 sm:h-9 sm:w-9"
                onClick={onClose}
                aria-label="Close note details"
                data-testid="button-close-drawer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Reg-Z §1026.43 origination gate (Workstream A). Renders only
              when the note hasn't been originated yet — operator must either
              record an ATR determination or claim a statutory exemption
              before the note transitions to 'active'. */}
          {note.status === "pending" && atrAttestor ? (
            <AtrGate
              noteId={note.id}
              attestor={atrAttestor}
              onActivated={onClose}
            />
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <Card className="glass-panel">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Current balance</p>
                <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-current-balance">
                  {usd(note.currentBalance)}
                </p>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Monthly payment</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-acr-pos" data-testid="text-monthly-payment">
                  {usd(note.monthlyPayment)}
                </p>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Interest rate</p>
                <p className="text-2xl font-bold tabular-nums">{note.interestRate}%</p>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Term</p>
                <p className="text-2xl font-bold tabular-nums">{note.termMonths} months</p>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-panel">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">Loan progress</p>
                <p className="text-sm font-medium">
                  <span className="tabular-nums">{paidPayments}</span> of{" "}
                  <span className="tabular-nums">{totalPayments}</span> payments
                </p>
              </div>
              <Progress
                value={progress}
                className="h-2"
                aria-label={`Loan progress: ${progress.toFixed(0)} percent complete, ${paidPayments} of ${totalPayments} payments made`}
              />
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>Total paid: <span className="tabular-nums">{usd(totalPaid)}</span></span>
                <span>Remaining: <span className="tabular-nums">{usd(note.currentBalance)}</span></span>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="w-4 h-4" aria-hidden="true" />
                Payment collection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isStripeStatusLoading ? (
                <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">Checking Stripe connection…</span>
                </div>
              ) : !stripeConnectStatus?.isConnected || !stripeConnectStatus?.chargesEnabled ? (
                <div className="text-center py-4">
                  <div className="p-3 rounded-full bg-muted/50 w-fit mx-auto mb-3">
                    <Settings className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Connect Stripe to accept payments.
                  </p>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/settings?tab=payments">
                      <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                      Settings &rsaquo; Payments
                    </Link>
                  </Button>
                </div>
              ) : (
                <>
                  <div className="bg-muted/50 rounded-card p-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Monthly payment</span>
                      <span className="font-bold font-mono tabular-nums text-acr-pos">
                        {usd(note.monthlyPayment)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      onClick={handleGeneratePaymentLink}
                      disabled={isGeneratingLink}
                      className="flex-1 min-h-11 sm:min-h-9"
                      data-testid="button-generate-payment-link"
                    >
                      {isGeneratingLink ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                      ) : (
                        <Link2 className="w-4 h-4 mr-2" aria-hidden="true" />
                      )}
                      Generate payment link
                    </Button>
                    <Button
                      onClick={() => setShowAcceptPayment(true)}
                      variant="outline"
                      className="min-h-11 sm:min-h-9"
                      data-testid="button-accept-payment"
                    >
                      <DollarSign className="w-4 h-4 mr-2" aria-hidden="true" />
                      Accept payment
                    </Button>
                  </div>

                  {paymentLink && (
                    <div className="space-y-2">
                      <Label htmlFor="text-payment-link" className="text-sm font-medium">Payment link</Label>
                      <div className="flex gap-2">
                        <Input
                          id="text-payment-link"
                          value={paymentLink}
                          readOnly
                          className="font-mono text-xs"
                          onFocus={(e) => e.currentTarget.select()}
                          data-testid="text-payment-link"
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-11 w-11 sm:h-9 sm:w-9 shrink-0"
                          onClick={handleCopyPaymentLink}
                          aria-label="Copy payment link to clipboard"
                          data-testid="button-copy-payment-link"
                        >
                          <Copy className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Share this link with the borrower to collect payment.
                      </p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={() => setShowRecordPayment(true)} className="flex-1 min-h-11 sm:min-h-9" data-testid="button-record-payment">
              <Receipt className="w-4 h-4 mr-2" aria-hidden="true" /> Record payment
            </Button>
            <Button variant="outline" className="flex-1 min-h-11 sm:min-h-9" disabled title="Coming soon — use Generate payment link above">
              <CreditCard className="w-4 h-4 mr-2" aria-hidden="true" /> Send payment link
            </Button>
          </div>

          <Tabs defaultValue="payments" onValueChange={(v) => v === 'dunning' && !dunningData && fetchDunningData()}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="payments" data-testid="tab-payments">Payments</TabsTrigger>
              <TabsTrigger value="schedule" data-testid="tab-schedule">Schedule</TabsTrigger>
              <TabsTrigger value="dunning" data-testid="tab-dunning">Dunning</TabsTrigger>
            </TabsList>

            <TabsContent value="payments" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[90px]">Date</TableHead>
                          <TableHead className="text-right min-w-[80px]">Amount</TableHead>
                          <TableHead className="text-right min-w-[80px]">Principal</TableHead>
                          <TableHead className="text-right min-w-[70px]">Interest</TableHead>
                          <TableHead className="min-w-[70px]">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentsLoading ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center h-16">
                            <div className="flex items-center justify-center gap-2" role="status" aria-live="polite">
                              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              Loading payments…
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : payments?.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center h-16 text-muted-foreground">
                            No payments recorded yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        payments?.map((payment) => (
                          <TableRow key={payment.id} data-testid={`row-payment-${payment.id}`}>
                            <TableCell className="tabular-nums">
                              {format(new Date(payment.paymentDate), 'MMM d, yyyy')}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium tabular-nums">
                              {usd(payment.amount)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                              {usd(payment.principalAmount)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                              {usd(payment.interestAmount)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={payment.status === 'completed' ? 'default' : 'secondary'} className="capitalize">
                                {payment.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="schedule" className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-muted/50 rounded-card p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total interest</p>
                  <p className="font-bold font-mono tabular-nums text-acr-warn" data-testid="text-total-interest">
                    {usd(schedule.reduce((sum, s) => sum + (s.interest || 0), 0))}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-card p-3 text-center">
                  <p className="text-xs text-muted-foreground">Payoff date</p>
                  <p className="font-bold tabular-nums" data-testid="text-payoff-date">
                    {schedule.length > 0 ? format(new Date(schedule[schedule.length - 1].dueDate), 'MMM yyyy') : '—'}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-card p-3 text-center">
                  <p className="text-xs text-muted-foreground">Remaining</p>
                  <p className="font-bold" data-testid="text-remaining-payments">
                    <span className="tabular-nums">{schedule.filter(s => s.status !== 'paid').length}</span> payments
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-9"
                  onClick={handleRegenerateSchedule}
                  disabled={isRegenerating}
                  data-testid="button-regenerate-schedule"
                >
                  {isRegenerating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" />}
                  Regenerate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-9"
                  onClick={handleDownloadSchedulePdf}
                  disabled={isDownloadingSchedule || schedule.length === 0}
                  data-testid="button-export-schedule"
                >
                  {isDownloadingSchedule ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="w-4 h-4 mr-1" aria-hidden="true" />
                  )}
                  Export PDF
                </Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  <div
                    className="max-h-64 overflow-y-auto overflow-x-auto"
                    tabIndex={0}
                    role="region"
                    aria-label="Amortization schedule"
                  >
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead className="min-w-[30px]">#</TableHead>
                          <TableHead className="min-w-[90px]">Due date</TableHead>
                          <TableHead className="text-right min-w-[70px]">Payment</TableHead>
                          <TableHead className="text-right min-w-[70px]">Principal</TableHead>
                          <TableHead className="text-right min-w-[70px]">Interest</TableHead>
                          <TableHead className="text-right min-w-[70px]">Balance</TableHead>
                          <TableHead className="min-w-[50px]">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {schedule.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center h-16 text-muted-foreground">
                            No amortization schedule available.
                          </TableCell>
                        </TableRow>
                      ) : (
                        schedule.map((row) => {
                          const statusLabel =
                            row.status === 'paid' ? 'Paid' :
                            row.status === 'late' ? 'Late' :
                            'Pending';
                          return (
                            <TableRow key={row.paymentNumber} data-testid={`row-amort-${row.paymentNumber}`}>
                              <TableCell className="font-medium tabular-nums">{row.paymentNumber}</TableCell>
                              <TableCell className="tabular-nums">{format(new Date(row.dueDate), 'MMM d, yyyy')}</TableCell>
                              <TableCell className="text-right font-mono tabular-nums">{usd(row.payment)}</TableCell>
                              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                                {usd(row.principal)}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                                {usd(row.interest)}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">{usd(row.balance)}</TableCell>
                              <TableCell>
                                {row.status === 'paid' ? (
                                  <CheckCircle className="w-4 h-4 text-acr-pos" aria-label="Paid" role="img" />
                                ) : row.status === 'late' ? (
                                  <AlertTriangle className="w-4 h-4 text-acr-neg" aria-label="Late" role="img" />
                                ) : (
                                  <Clock className="w-4 h-4 text-muted-foreground" aria-label="Pending" role="img" />
                                )}
                                <span className="sr-only">{statusLabel}</span>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="dunning" className="mt-4 space-y-4">
              {isDunningLoading ? (
                <div className="flex items-center justify-center h-32" role="status" aria-live="polite">
                  <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
                  <span className="sr-only">Loading dunning data…</span>
                </div>
              ) : dunningData ? (
                <>
                  <dl className="grid grid-cols-2 gap-3">
                    <Card className="glass-panel">
                      <CardContent className="p-4">
                        <dt className="text-xs text-muted-foreground mb-1">Delinquency status</dt>
                        <dd className="flex items-center gap-2">
                          {dunningData.daysDelinquent > 0 ? (
                            <AlertTriangle className="w-5 h-5 text-acr-neg" aria-hidden="true" />
                          ) : (
                            <CheckCircle className="w-5 h-5 text-acr-pos" aria-hidden="true" />
                          )}
                          <span className="font-bold tabular-nums" data-testid="text-dunning-status">
                            {dunningData.daysDelinquent > 0 ? `${dunningData.daysDelinquent} days past due` : 'Current'}
                          </span>
                        </dd>
                      </CardContent>
                    </Card>
                    <Card className="glass-panel">
                      <CardContent className="p-4">
                        <dt className="text-xs text-muted-foreground mb-1">Dunning stage</dt>
                        <dd>
                          <Badge
                            className={
                              dunningData.dunningStage === 'current' ? 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft dark:text-acr-pos capitalize' :
                              dunningData.dunningStage === 'friendly_reminder' ? 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn capitalize' :
                              dunningData.dunningStage === 'formal_notice' ? 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn capitalize' :
                              dunningData.dunningStage === 'final_warning' ? 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft dark:text-acr-neg capitalize' :
                              'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/50 dark:text-acr-neg capitalize'
                            }
                            data-testid="badge-dunning-stage"
                          >
                            {dunningData.dunningStage.replace(/_/g, ' ')}
                          </Badge>
                        </dd>
                      </CardContent>
                    </Card>
                    <Card className="glass-panel">
                      <CardContent className="p-4">
                        <dt className="text-xs text-muted-foreground mb-1">Past due amount</dt>
                        <dd className="font-bold font-mono tabular-nums text-acr-neg" data-testid="text-past-due-amount">
                          {usd(dunningData.pastDueAmount ?? 0)}
                        </dd>
                      </CardContent>
                    </Card>
                    <Card className="glass-panel">
                      <CardContent className="p-4">
                        <dt className="text-xs text-muted-foreground mb-1">Missed payments</dt>
                        <dd className="font-bold tabular-nums" data-testid="text-missed-payments">
                          {dunningData.missedPayments || 0}
                        </dd>
                      </CardContent>
                    </Card>
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      onClick={() => handleSendReminder('due')}
                      disabled={isSendingReminder}
                      data-testid="button-send-reminder"
                    >
                      {isSendingReminder ? <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4 mr-1" aria-hidden="true" />}
                      Send reminder
                    </Button>
                    <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => handleSendReminder('final_warning')} disabled={isSendingReminder} data-testid="button-escalate">
                      <ArrowUpRight className="w-4 h-4 mr-1" aria-hidden="true" /> Escalate
                    </Button>
                    {/* Log call: backend endpoint not yet shipped. Disable
                        with a tooltip so users don't tap an inert button. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 sm:min-h-9"
                      disabled
                      title="Coming soon — call logging will appear here"
                      data-testid="button-record-contact"
                    >
                      <Phone className="w-4 h-4 mr-1" aria-hidden="true" /> Log call
                    </Button>
                  </div>

                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">Dunning history</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div
                        className="max-h-48 overflow-y-auto"
                        tabIndex={0}
                        role="region"
                        aria-label="Dunning history"
                      >
                        {dunningData.history?.length > 0 ? (
                          <ul className="divide-y">
                            {dunningData.history.map((h: any, idx: number) => (
                              <li key={h.id || idx} className="px-4 py-3 flex items-start gap-3" data-testid={`row-dunning-${h.id || idx}`}>
                                <div className="p-1.5 rounded-full bg-muted">
                                  {h.channel === 'email' ? <Mail className="w-3 h-3" aria-hidden="true" /> :
                                   h.channel === 'sms' ? <Phone className="w-3 h-3" aria-hidden="true" /> :
                                   <Send className="w-3 h-3" aria-hidden="true" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium capitalize">{h.type?.replace(/_/g, ' ') || 'Action'}</p>
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    {h.date ? format(new Date(h.date), 'MMM d, yyyy h:mm a') : 'Unknown date'}
                                  </p>
                                </div>
                                <Badge variant="outline" className="text-xs capitalize">
                                  {h.status}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="p-4 text-sm text-muted-foreground text-center">No dunning history yet.</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Click to load dunning information.</p>
                  <Button variant="outline" size="sm" className="mt-2 min-h-11 sm:min-h-9" onClick={fetchDunningData}>
                    Load dunning data
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Property details</CardTitle>
            </CardHeader>
            <CardContent>
              {note.property ? (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground inline">Location:</dt>
                    <dd className="ml-2 font-medium inline">{note.property.county}, {note.property.state}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">APN:</dt>
                    <dd className="ml-2 font-mono tabular-nums inline">{note.property.apn}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Size:</dt>
                    <dd className="ml-2 inline tabular-nums">{note.property.sizeAcres} acres</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Status:</dt>
                    <dd className="ml-2 inline capitalize">{note.property.status}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-muted-foreground">No property linked.</p>
              )}
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Borrower details</CardTitle>
            </CardHeader>
            <CardContent>
              {note.borrower ? (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground inline">Name:</dt>
                    <dd className="ml-2 font-medium inline">{note.borrower.firstName} {note.borrower.lastName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Email:</dt>
                    <dd className="ml-2 inline">
                      {note.borrower.email ? (
                        <a href={`mailto:${note.borrower.email}`} className="hover:underline">{note.borrower.email}</a>
                      ) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Phone:</dt>
                    <dd className="ml-2 inline tabular-nums">
                      {note.borrower.phone ? (
                        <a href={`tel:${note.borrower.phone}`} className="hover:underline">{note.borrower.phone}</a>
                      ) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Status:</dt>
                    <dd className="ml-2 inline capitalize">{note.borrower.status}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-muted-foreground">No borrower linked.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {showRecordPayment && (
          <RecordPaymentModal
            note={note}
            onClose={() => setShowRecordPayment(false)}
          />
        )}

        {showAcceptPayment && (
          <AcceptPaymentModal
            note={note}
            onClose={() => setShowAcceptPayment(false)}
          />
        )}
      </div>
    </div>
  );
}

function AcceptPaymentModal({ note, onClose }: { note: NoteWithDetails; onClose: () => void }) {
  const [amount, setAmount] = useState(note.monthlyPayment?.toString() || '');
  const [paymentType, setPaymentType] = useState<string>('monthly_payment');
  const [isCreating, setIsCreating] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCreatePaymentIntent = async () => {
    setIsCreating(true);
    try {
      const res = await fetch('/api/stripe/connect/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          noteId: note.id,
          amount: Math.round(Number(amount) * 100),
          paymentType: paymentType === 'monthly_payment' ? 'note_payment' : 
                       paymentType === 'down_payment' ? 'down_payment' : 'note_payment',
          description: `${paymentType.replace(/_/g, ' ')} for Note #${note.id}`,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to create payment intent');
      }

      const data = await res.json();
      setClientSecret(data.clientSecret);
      toast({ title: "Payment ready", description: "You can now enter card details to complete the payment." });
    } catch (err: any) {
      toast({
        title: "Couldn't set up payment",
        description: err?.message || "Check your connection and try again — no card was charged.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const titleId = "accept-payment-title";
  const descId = "accept-payment-desc";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <Card className="w-full max-w-md floating-window" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle id={titleId}>Accept payment</CardTitle>
          <CardDescription id={descId}>
            Create a payment intent for Note #<span className="tabular-nums">{note.id}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!amount || isCreating || clientSecret) return;
              handleCreatePaymentIntent();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="input-accept-payment-amount">
                Payment amount <span className="text-destructive" aria-label="required">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                <Input
                  id="input-accept-payment-amount"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder={String(Number(note.monthlyPayment || 0))}
                  className="pl-7 text-right tabular-nums"
                  disabled={!!clientSecret}
                  data-testid="input-payment-amount"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="select-payment-type">Payment type</Label>
              <Select value={paymentType} onValueChange={setPaymentType} disabled={!!clientSecret}>
                <SelectTrigger id="select-payment-type" data-testid="select-payment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly_payment">Monthly payment</SelectItem>
                  <SelectItem value="down_payment">Down payment</SelectItem>
                  <SelectItem value="extra_payment">Extra payment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {clientSecret ? (
              <div className="space-y-3">
                <div
                  className="bg-acr-pos-soft dark:bg-acr-pos-soft rounded-card p-4 border border-acr-pos/30 dark:border-acr-pos/30"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-5 h-5 text-acr-pos" aria-hidden="true" />
                    <span className="font-medium text-acr-pos dark:text-acr-pos">Payment intent created</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Amount: <span className="font-mono font-bold tabular-nums">{usd(Number(amount) || 0)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Use the client secret below with Stripe.js to complete the payment.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="text-client-secret" className="text-xs text-muted-foreground">Client secret</Label>
                  <div
                    id="text-client-secret"
                    className="font-mono text-xs bg-muted p-2 rounded break-all select-all tabular-nums"
                    tabIndex={0}
                  >
                    {clientSecret}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-muted/50 rounded-card p-4">
                <p className="text-sm text-muted-foreground">
                  This will create a Stripe payment intent that can be used to process the payment via Stripe.js or the Stripe dashboard.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1 min-h-11 sm:min-h-9">
                {clientSecret ? 'Close' : 'Cancel'}
              </Button>
              {!clientSecret && (
                <Button
                  type="submit"
                  disabled={isCreating || !amount}
                  className="flex-1 min-h-11 sm:min-h-9"
                  data-testid="button-create-payment-intent"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                      Creating…
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4 mr-2" aria-hidden="true" />
                      Create payment intent
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function RecordPaymentModal({ note, onClose }: { note: NoteWithDetails; onClose: () => void }) {
  const { mutate, isPending } = useRecordPayment();
  const [amount, setAmount] = useState(note.monthlyPayment?.toString() || '');
  const [method, setMethod] = useState('ach');

  const interestRate = Number(note.interestRate || 0) / 100 / 12;
  const balance = Number(note.currentBalance || 0);
  
  const interestAmount = balance * interestRate;
  const principalAmount = Math.max(0, Number(amount) - interestAmount);

  const handleSubmit = () => {
    mutate({
      organizationId: note.organizationId,
      noteId: note.id,
      amount: amount,
      principalAmount: principalAmount.toFixed(2),
      interestAmount: interestAmount.toFixed(2),
      paymentDate: new Date(),
      dueDate: note.nextPaymentDate || new Date(),
      paymentMethod: method,
      status: 'completed',
    }, {
      onSuccess: onClose,
    });
  };

  const titleId = "record-payment-title";
  const descId = "record-payment-desc";

  // Close on Escape — hand-rolled overlay has no Radix Dialog backing,
  // so wire the key handler here per the slice-5l Dialog Esc key rule.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <Card className="w-full max-w-md floating-window" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle id={titleId}>Record payment</CardTitle>
          <CardDescription id={descId}>
            Record a payment for Note #<span className="tabular-nums">{note.id}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!amount || isPending) return;
              handleSubmit();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="input-payment-amount">
                Payment amount <span className="text-destructive" aria-label="required">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                <Input
                  id="input-payment-amount"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder={String(Number(note.monthlyPayment || 0))}
                  className="pl-7 text-right tabular-nums"
                  data-testid="input-payment-amount"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="select-payment-method">Payment method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="select-payment-method" data-testid="select-payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ach">ACH transfer</SelectItem>
                  <SelectItem value="card">Credit card</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <dl className="bg-muted/50 rounded-card p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Principal</dt>
                <dd className="font-mono tabular-nums">{usd(principalAmount)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Interest</dt>
                <dd className="font-mono tabular-nums">{usd(interestAmount)}</dd>
              </div>
              <div className="flex justify-between font-medium pt-2 border-t">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums">{usd(Number(amount) || 0)}</dd>
              </div>
            </dl>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1 min-h-11 sm:min-h-9" disabled={isPending}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending || !amount}
                className="flex-1 min-h-11 sm:min-h-9"
                data-testid="button-submit-payment"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    Recording…
                  </>
                ) : (
                  "Record payment"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function NoteForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateNote();
  const { data: leads } = useLeads();
  const { data: properties } = useProperties();
  const { toast } = useToast();

  // Tax-identity lazy prompt (2026-05-11). The IRS requires a legal entity
  // name + EIN/SSN/ITIN before we can issue 1099-INTs to a borrower. Rather
  // than block signup with this (the old onboarding step 4 behavior), we
  // surface it the moment it becomes load-bearing: the first seller-financed
  // note. If the user skips, we still create the note but with status
  // "pending" so they can't accept payments — and the dashboard checklist
  // surfaces the unresolved tax-identity gap.
  const { data: taxIdentity } = useQuery<{ captured: boolean; skipped: boolean }>({
    queryKey: ["/api/organization/tax-identity"],
    queryFn: async () => {
      const res = await fetch("/api/organization/tax-identity", { credentials: "include" });
      if (!res.ok) return { captured: false, skipped: false };
      return res.json();
    },
  });
  // Tax-identity flow: previously gated on a mid-save modal that
  // interrupted the user (2026-05-26 refactor removed it). The note
  // form now always saves; missing tax info downgrades the save to
  // status="pending" and the toast in onSubmit nudges the user to
  // /settings → Tax Identity. The pendingFormData / taxPromptOpen
  // state vars are no longer needed.

  const availableProperties = properties?.filter((p: any) => p.status !== 'sold') || [];
  // Show buyers first, but fall back to all leads if no buyer-type leads exist
  const buyerLeads = leads?.filter((l: any) => l.type === 'buyer') || [];
  const buyers = buyerLeads.length > 0 ? buyerLeads : (leads || []);

  const form = useForm<z.input<typeof noteFormSchema>, unknown, z.output<typeof noteFormSchema>>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: {
      status: "active",
      startDate: new Date(),
      gracePeriodDays: 10,
      serviceFee: "0",
      lateFee: "25",
    }
  });

  const principal = form.watch("originalPrincipal");
  const rate = form.watch("interestRate");
  const term = form.watch("termMonths");

  const calculatePayment = () => {
    const p = Number(principal) || 0;
    const r = (Number(rate) || 0) / 100 / 12;
    const n = Number(term) || 0;
    if (p <= 0 || r <= 0 || n <= 0) return 0;
    return p * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  };

  const suggestedPayment = calculatePayment();

  // Actually submit the note. Optionally force "pending" if the user
  // skipped tax-identity capture — that keeps the 1099-INT generator
  // safely blocked until they come back and provide an EIN.
  const submitNote = (
    data: z.infer<typeof noteFormSchema>,
    opts: { saveAsPending?: boolean } = {},
  ) => {
    const payment = data.monthlyPayment || suggestedPayment.toFixed(2);
    mutate({
      ...data,
      status: opts.saveAsPending ? "pending" : data.status,
      monthlyPayment: payment,
      currentBalance: data.originalPrincipal,
      firstPaymentDate: addMonths(new Date(data.startDate), 1),
      nextPaymentDate: addMonths(new Date(data.startDate), 1),
    }, { onSuccess });
  };

  const onSubmit = (data: z.infer<typeof noteFormSchema>) => {
    // 2026-05-26 UX fix: the previous flow popped a tax-identity modal
    // mid-save, interrupting the user. Now the note always saves; if
    // tax identity hasn't been captured the note saves as "pending"
    // and a toast nudges the user to Settings. The TaxBannerCard
    // rendered at the top of /finance + /money keeps the reminder
    // visible so it can be resolved at the user's pace.
    const taxMissing = !!(taxIdentity && !taxIdentity.captured);
    if (taxMissing) {
      submitNote(data, { saveAsPending: true });
      toast({
        title: "Saved as pending",
        description: "Add your tax identity in Settings to publish this note and enable 1099-INT issuance.",
      });
      return;
    }
    submitNote(data);
  };

  return (
    <>
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="borrowerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Borrower <span className="text-destructive" aria-label="required">*</span>
                </FormLabel>
                <Select onValueChange={(val) => field.onChange(parseInt(val))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-borrower">
                      <SelectValue placeholder={buyers.length === 0 ? "No buyers yet — add a buyer lead first" : "Select buyer"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {buyers.length === 0 ? (
                      <SelectItem value="none" disabled>No buyers available</SelectItem>
                    ) : (
                      buyers.map((lead: any) => (
                        <SelectItem key={lead.id} value={lead.id.toString()}>
                          {lead.firstName} {lead.lastName}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="propertyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Property <span className="text-destructive" aria-label="required">*</span>
                </FormLabel>
                <Select onValueChange={(val) => field.onChange(parseInt(val))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-property">
                      <SelectValue placeholder={availableProperties.length === 0 ? "No unsold properties yet" : "Select property"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {availableProperties.length === 0 ? (
                      <SelectItem value="none" disabled>No properties available</SelectItem>
                    ) : (
                      availableProperties.map((prop: any) => (
                        <SelectItem key={prop.id} value={prop.id.toString()}>
                          {prop.county}, {prop.state} ({prop.sizeAcres} ac)
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="originalPrincipal"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Principal <span className="text-destructive" aria-label="required">*</span>
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                    <Input
                      {...field}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="10000"
                      className="pl-7 text-right tabular-nums"
                      data-testid="input-principal"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="interestRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Interest rate <span className="text-destructive" aria-label="required">*</span>
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      {...field}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="9"
                      className="pr-7 text-right tabular-nums"
                      data-testid="input-interest-rate"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="termMonths"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Term (months) <span className="text-destructive" aria-label="required">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    min="1"
                    inputMode="numeric"
                    placeholder="60"
                    className="text-right tabular-nums"
                    data-testid="input-term"
                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {suggestedPayment > 0 && (
          <div
            className="bg-muted/50 rounded-card p-4"
            role="status"
            aria-live="polite"
          >
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Calculated monthly payment</span>
              <span className="text-lg font-bold font-mono tabular-nums text-acr-pos">
                {usd(suggestedPayment)}
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="downPayment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Down payment</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="1000"
                      className="pl-7 text-right tabular-nums"
                      data-testid="input-down-payment"
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Start date <span className="text-destructive" aria-label="required">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    onChange={(e) => field.onChange(new Date(e.target.value))}
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="tabular-nums"
                    data-testid="input-start-date"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="pt-2">
          <Button type="submit" className="w-full min-h-11" disabled={isPending} data-testid="button-submit-note">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Creating note…
              </>
            ) : (
              "Create note"
            )}
          </Button>
        </div>
      </form>
    </Form>
    </>
  );
}
