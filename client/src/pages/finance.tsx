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
import { Link } from "wouter";

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
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, addMonths } from "date-fns";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { usd } from "@/lib/format";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { QueryErrorState } from "@/components/query-error-state";

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
  const { data: notes, isLoading, error: notesError, refetch: refetchNotes } = useNotes();
  const { data: leads } = useLeads();
  const { data: properties } = useProperties();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
      if (!response.ok) throw new Error('Failed to export');
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
    } catch (error) {
      console.error('Export error:', error);
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
        title: "QuickBooks sync failed",
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'paid_off': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'defaulted': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'pending': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getLoanHealth = (note: NoteWithDetails) => {
    if (!note.nextPaymentDate) return { status: 'good', label: 'Current', color: 'text-emerald-600' };
    const daysUntilDue = Math.floor((new Date(note.nextPaymentDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilDue < 0) return { status: 'late', label: `${Math.abs(daysUntilDue)} days late`, color: 'text-red-600' };
    if (daysUntilDue <= 5) return { status: 'due', label: `Due in ${daysUntilDue} days`, color: 'text-amber-600' };
    return { status: 'good', label: 'Current', color: 'text-emerald-600' };
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

  return (
    <PageShell>
          
          {/* Portfolio Cash Flow Chart */}
          {portfolioSummary?.monthlyCashFlow && portfolioSummary.monthlyCashFlow.some(m => m.amount > 0) && (
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Monthly Cash Flow (Last 12 Months)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={portfolioSummary.monthlyCashFlow}>
                      <defs>
                        <linearGradient id="cashFlowGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => usd(v, { noCents: true })} />
                      <Tooltip formatter={((value: number) => [usd(value), "Cash flow"]) as any} />
                      <Area type="monotone" dataKey="amount" stroke="hsl(var(--primary))" fill="url(#cashFlowGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Finance</h1>
              <p className="text-muted-foreground">Manage promissory notes and track payments.</p>
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
                <a href="/portal" target="_blank" rel="noopener noreferrer">
                  Borrower Portal
                </a>
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={isExporting}
                data-testid="button-export-notes"
              >
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export CSV
              </Button>
              <Button
                variant="outline"
                onClick={handleQboSync}
                disabled={isQboSyncing}
                data-testid="button-qbo-sync"
              >
                {isQboSyncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Sync to QuickBooks
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-note">
                    <Plus className="w-4 h-4 mr-2" /> Create Note
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
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Active Notes</p>
                    <p className="text-2xl font-bold" data-testid="text-active-notes">{activeNotes.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-emerald-500/10">
                    <DollarSign className="w-5 h-5 text-emerald-600" />
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
                  <div className="p-3 rounded-xl bg-blue-500/10">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Monthly income</p>
                    <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600" data-testid="text-monthly-income">
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
                    <Calculator className="w-5 h-5 text-accent-foreground" />
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

          <Card className="floating-window overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle>Loan Portfolio</CardTitle>
              <CardDescription>Click a note to view details, payment history, and amortization schedule</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
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
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center h-24">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          Loading notes...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : enrichedNotes?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="p-0">
                        <EmptyState
                          icon={FileText}
                          title="No promissory notes yet"
                          description="Create a note to track financing. Manage seller financing, track payments, and generate amortization schedules."
                          actionLabel="Create Your First Note"
                          onAction={() => setIsCreateOpen(true)}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    enrichedNotes?.map((note) => {
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
                              <User className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium">
                                {note.borrower ? `${note.borrower.firstName} ${note.borrower.lastName}` : (note.borrowerId ? `Borrower #${note.borrowerId}` : "Unassigned borrower")}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm">
                                {note.property ? `${note.property.county}, ${note.property.state}` : (note.propertyId ? `Property #${note.propertyId}` : "Unassigned property")}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium tabular-nums">
                            {usd(note.currentBalance)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold tabular-nums text-emerald-600">
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
                    })
                  )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

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
  const { data: payments, isLoading: paymentsLoading } = usePayments(note.id);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showAcceptPayment, setShowAcceptPayment] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
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
    if (paymentLink) {
      await navigator.clipboard.writeText(paymentLink);
      toast({ title: "Payment link copied to clipboard" });
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
                <span className="text-[10px] text-muted-foreground tabular-nums" data-testid="text-cost-pdf">$0.05</span>
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
                <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600" data-testid="text-monthly-payment">
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
                  <Link href="/settings?tab=payments">
                    <Button variant="outline" size="sm">
                      <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                      Settings &rsaquo; Payments
                    </Button>
                  </Link>
                </div>
              ) : (
                <>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Monthly payment</span>
                      <span className="font-bold font-mono tabular-nums text-emerald-600">
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
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total interest</p>
                  <p className="font-bold font-mono tabular-nums text-amber-600" data-testid="text-total-interest">
                    {usd(schedule.reduce((sum, s) => sum + (s.interest || 0), 0))}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Payoff date</p>
                  <p className="font-bold tabular-nums" data-testid="text-payoff-date">
                    {schedule.length > 0 ? format(new Date(schedule[schedule.length - 1].dueDate), 'MMM yyyy') : '—'}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
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
                <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" data-testid="button-export-schedule">
                  <Download className="w-4 h-4 mr-1" aria-hidden="true" /> Export PDF
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
                                  <CheckCircle className="w-4 h-4 text-emerald-600" aria-label="Paid" role="img" />
                                ) : row.status === 'late' ? (
                                  <AlertTriangle className="w-4 h-4 text-red-600" aria-label="Late" role="img" />
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
                            <AlertTriangle className="w-5 h-5 text-red-500" aria-hidden="true" />
                          ) : (
                            <CheckCircle className="w-5 h-5 text-emerald-500" aria-hidden="true" />
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
                              dunningData.dunningStage === 'current' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 capitalize' :
                              dunningData.dunningStage === 'friendly_reminder' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 capitalize' :
                              dunningData.dunningStage === 'formal_notice' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 capitalize' :
                              dunningData.dunningStage === 'final_warning' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 capitalize' :
                              'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-300 capitalize'
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
                        <dd className="font-bold font-mono tabular-nums text-red-600" data-testid="text-past-due-amount">
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
                    <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-9" data-testid="button-record-contact">
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
                  className="bg-emerald-50 dark:bg-emerald-900/30 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                    <span className="font-medium text-emerald-800 dark:text-emerald-200">Payment intent created</span>
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
              <div className="bg-muted/50 rounded-lg p-4">
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

            <dl className="bg-muted/50 rounded-lg p-4 space-y-2">
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

  const availableProperties = properties?.filter((p: any) => p.status !== 'sold') || [];
  // Show buyers first, but fall back to all leads if no buyer-type leads exist
  const buyerLeads = leads?.filter((l: any) => l.type === 'buyer') || [];
  const buyers = buyerLeads.length > 0 ? buyerLeads : (leads || []);

  const form = useForm<z.infer<typeof noteFormSchema>>({
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

  const onSubmit = (data: z.infer<typeof noteFormSchema>) => {
    const payment = data.monthlyPayment || suggestedPayment.toFixed(2);
    mutate({
      ...data,
      monthlyPayment: payment,
      currentBalance: data.originalPrincipal,
      firstPaymentDate: addMonths(new Date(data.startDate), 1),
      nextPaymentDate: addMonths(new Date(data.startDate), 1),
    }, { onSuccess });
  };

  return (
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
            className="bg-muted/50 rounded-lg p-4"
            role="status"
            aria-live="polite"
          >
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Calculated monthly payment</span>
              <span className="text-lg font-bold font-mono tabular-nums text-emerald-600">
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
  );
}
