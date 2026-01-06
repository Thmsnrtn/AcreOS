import { Sidebar } from "@/components/layout-sidebar";
import { useNotes, useCreateNote, useDeleteNote } from "@/hooks/use-notes";
import { usePayments, useRecordPayment } from "@/hooks/use-payments";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertNoteSchema, type Note, type Lead, type Property } from "@shared/schema";
import { z } from "zod";

// Client-side form schema that omits organizationId (added by server)
const noteFormSchema = insertNoteSchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Plus, DollarSign, Calendar, TrendingUp, AlertTriangle, CheckCircle, Clock, User, MapPin, FileText, CreditCard, X, Eye, Receipt, Calculator, Trash2, Loader2, Download, RefreshCw, Send, ArrowUpRight, Phone, Mail } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, addMonths } from "date-fns";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DisclaimerBanner } from "@/components/disclaimer-banner";

type NoteWithDetails = Note & {
  borrower?: Lead;
  property?: Property;
};

export default function FinancePage() {
  const { data: notes, isLoading } = useNotes();
  const { data: leads } = useLeads();
  const { data: properties } = useProperties();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<NoteWithDetails | null>(null);
  const [deletingNote, setDeletingNote] = useState<NoteWithDetails | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const { mutate: deleteNote, isPending: isDeleting } = useDeleteNote();

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

  const enrichedNotes: NoteWithDetails[] = (notes || []).map(note => ({
    ...note,
    borrower: leads?.find(l => l.id === note.borrowerId),
    property: properties?.find(p => p.id === note.propertyId),
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
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Finance</h1>
              <p className="text-muted-foreground">Manage promissory notes and track payments.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button 
                variant="outline" 
                onClick={handleExport} 
                disabled={isExporting}
                data-testid="button-export-notes"
              >
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export CSV
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
                    <p className="text-sm text-muted-foreground">Portfolio Value</p>
                    <p className="text-2xl font-bold font-mono" data-testid="text-portfolio-value">
                      ${totalPortfolio.toLocaleString()}
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
                    <p className="text-sm text-muted-foreground">Monthly Income</p>
                    <p className="text-2xl font-bold font-mono text-emerald-600" data-testid="text-monthly-income">
                      ${monthlyIncome.toLocaleString()}
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
                    <p className="text-sm text-muted-foreground">Total Originated</p>
                    <p className="text-2xl font-bold font-mono" data-testid="text-total-principal">
                      ${totalPrincipal.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

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
                                {note.borrower ? `${note.borrower.firstName} ${note.borrower.lastName}` : `Borrower #${note.borrowerId}`}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm">
                                {note.property ? `${note.property.county}, ${note.property.state}` : `Property #${note.propertyId}`}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            ${Number(note.currentBalance || 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-emerald-600">
                            ${Number(note.monthlyPayment || 0).toLocaleString()}
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
                            <Button size="icon" variant="ghost" data-testid={`button-view-note-${note.id}`}>
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
        </div>
      </main>

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
        description={`Are you sure you want to delete this promissory note for ${deletingNote?.borrower ? `${deletingNote.borrower.firstName} ${deletingNote.borrower.lastName}` : `Borrower #${deletingNote?.borrowerId}`}? This action cannot be undone and will permanently remove the note and its payment history.`}
        confirmLabel="Delete Note"
        onConfirm={handleDelete}
        isLoading={isDeleting}
        variant="destructive"
      />
    </div>
  );
}

function NoteDetailDrawer({ note, onClose, onDelete }: { note: NoteWithDetails; onClose: () => void; onDelete: () => void }) {
  const { data: payments, isLoading: paymentsLoading } = usePayments(note.id);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [dunningData, setDunningData] = useState<any>(null);
  const [isDunningLoading, setIsDunningLoading] = useState(false);
  const [isSendingReminder, setIsSendingReminder] = useState(false);

  const fetchDunningData = async () => {
    setIsDunningLoading(true);
    try {
      const res = await fetch(`/api/notes/${note.id}/dunning`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDunningData(data);
      }
    } catch (err) {
      console.error('Failed to fetch dunning data:', err);
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
      if (res.ok) {
        window.location.reload();
      }
    } catch (err) {
      console.error('Failed to regenerate schedule:', err);
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
      if (res.ok) {
        fetchDunningData();
      }
    } catch (err) {
      console.error('Failed to send reminder:', err);
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
      if (!response.ok) throw new Error('Failed to generate PDF');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `promissory-note-${note.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
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

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold" data-testid="text-note-title">
                Note #{note.id}
              </h2>
              <p className="text-muted-foreground">
                {note.borrower ? `${note.borrower.firstName} ${note.borrower.lastName}` : `Borrower #${note.borrowerId}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-0.5">
                <Button 
                  size="icon" 
                  variant="ghost" 
                  onClick={handleDownloadPdf} 
                  disabled={isDownloading}
                  data-testid="button-download-note-pdf"
                >
                  {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                </Button>
                <span className="text-[10px] text-muted-foreground" data-testid="text-cost-pdf">$0.05</span>
              </div>
              <Button size="icon" variant="ghost" onClick={onDelete} data-testid="button-delete-note">
                <Trash2 className="w-5 h-5 text-destructive" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-drawer">
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Card className="glass-panel">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Current Balance</p>
                <p className="text-2xl font-bold font-mono" data-testid="text-current-balance">
                  ${Number(note.currentBalance || 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Monthly Payment</p>
                <p className="text-2xl font-bold font-mono text-emerald-600" data-testid="text-monthly-payment">
                  ${Number(note.monthlyPayment || 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Interest Rate</p>
                <p className="text-2xl font-bold">{note.interestRate}%</p>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Term</p>
                <p className="text-2xl font-bold">{note.termMonths} months</p>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-panel">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">Loan Progress</p>
                <p className="text-sm font-medium">{paidPayments} of {totalPayments} payments</p>
              </div>
              <Progress value={progress} className="h-2" />
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>Total Paid: ${totalPaid.toLocaleString()}</span>
                <span>Remaining: ${Number(note.currentBalance || 0).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button onClick={() => setShowRecordPayment(true)} className="flex-1" data-testid="button-record-payment">
              <Receipt className="w-4 h-4 mr-2" /> Record Payment
            </Button>
            <Button variant="outline" className="flex-1">
              <CreditCard className="w-4 h-4 mr-2" /> Send Payment Link
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
                            <div className="flex items-center justify-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading...
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : payments?.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center h-16 text-muted-foreground">
                            No payments recorded yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        payments?.map((payment) => (
                          <TableRow key={payment.id} data-testid={`row-payment-${payment.id}`}>
                            <TableCell>
                              {format(new Date(payment.paymentDate), 'MMM d, yyyy')}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              ${Number(payment.amount).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              ${Number(payment.principalAmount).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              ${Number(payment.interestAmount).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant={payment.status === 'completed' ? 'default' : 'secondary'}>
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
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Interest</p>
                  <p className="font-bold font-mono text-amber-600" data-testid="text-total-interest">
                    ${schedule.reduce((sum, s) => sum + (s.interest || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Payoff Date</p>
                  <p className="font-bold" data-testid="text-payoff-date">
                    {schedule.length > 0 ? format(new Date(schedule[schedule.length - 1].dueDate), 'MMM yyyy') : 'N/A'}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Remaining</p>
                  <p className="font-bold" data-testid="text-remaining-payments">
                    {schedule.filter(s => s.status !== 'paid').length} payments
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleRegenerateSchedule}
                  disabled={isRegenerating}
                  data-testid="button-regenerate-schedule"
                >
                  {isRegenerating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                  Regenerate
                </Button>
                <Button variant="outline" size="sm" data-testid="button-export-schedule">
                  <Download className="w-4 h-4 mr-1" /> Export PDF
                </Button>
              </div>
              <Card>
                <CardContent className="p-0 max-h-64 overflow-y-auto">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead className="min-w-[30px]">#</TableHead>
                          <TableHead className="min-w-[90px]">Due Date</TableHead>
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
                            No amortization schedule available
                          </TableCell>
                        </TableRow>
                      ) : (
                        schedule.map((row) => (
                          <TableRow key={row.paymentNumber} data-testid={`row-amort-${row.paymentNumber}`}>
                            <TableCell className="font-medium">{row.paymentNumber}</TableCell>
                            <TableCell>{format(new Date(row.dueDate), 'MMM d, yyyy')}</TableCell>
                            <TableCell className="text-right font-mono">${row.payment.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              ${row.principal.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              ${row.interest.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono">${row.balance.toFixed(2)}</TableCell>
                            <TableCell>
                              {row.status === 'paid' ? (
                                <CheckCircle className="w-4 h-4 text-emerald-600" />
                              ) : row.status === 'late' ? (
                                <AlertTriangle className="w-4 h-4 text-red-600" />
                              ) : (
                                <Clock className="w-4 h-4 text-muted-foreground" />
                              )}
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

            <TabsContent value="dunning" className="mt-4 space-y-4">
              {isDunningLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : dunningData ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Card className="glass-panel">
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">Delinquency Status</p>
                        <div className="flex items-center gap-2">
                          {dunningData.daysDelinquent > 0 ? (
                            <AlertTriangle className="w-5 h-5 text-red-500" />
                          ) : (
                            <CheckCircle className="w-5 h-5 text-emerald-500" />
                          )}
                          <span className="font-bold" data-testid="text-dunning-status">
                            {dunningData.daysDelinquent > 0 ? `${dunningData.daysDelinquent} days past due` : 'Current'}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="glass-panel">
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">Dunning Stage</p>
                        <Badge 
                          className={
                            dunningData.dunningStage === 'current' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            dunningData.dunningStage === 'friendly_reminder' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' :
                            dunningData.dunningStage === 'formal_notice' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' :
                            dunningData.dunningStage === 'final_warning' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                            'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-300'
                          }
                          data-testid="badge-dunning-stage"
                        >
                          {dunningData.dunningStage.replace(/_/g, ' ')}
                        </Badge>
                      </CardContent>
                    </Card>
                    <Card className="glass-panel">
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">Past Due Amount</p>
                        <p className="font-bold font-mono text-red-600" data-testid="text-past-due-amount">
                          ${dunningData.pastDueAmount?.toLocaleString() || '0'}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="glass-panel">
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">Missed Payments</p>
                        <p className="font-bold" data-testid="text-missed-payments">
                          {dunningData.missedPayments || 0}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button 
                      size="sm" 
                      onClick={() => handleSendReminder('due')} 
                      disabled={isSendingReminder}
                      data-testid="button-send-reminder"
                    >
                      {isSendingReminder ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                      Send Reminder
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleSendReminder('final_warning')} disabled={isSendingReminder} data-testid="button-escalate">
                      <ArrowUpRight className="w-4 h-4 mr-1" /> Escalate
                    </Button>
                    <Button size="sm" variant="ghost" data-testid="button-record-contact">
                      <Phone className="w-4 h-4 mr-1" /> Log Call
                    </Button>
                  </div>

                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">Dunning History</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 max-h-48 overflow-y-auto">
                      {dunningData.history?.length > 0 ? (
                        <div className="divide-y">
                          {dunningData.history.map((h: any, idx: number) => (
                            <div key={h.id || idx} className="px-4 py-3 flex items-start gap-3" data-testid={`row-dunning-${h.id || idx}`}>
                              <div className="p-1.5 rounded-full bg-muted">
                                {h.channel === 'email' ? <Mail className="w-3 h-3" /> : 
                                 h.channel === 'sms' ? <Phone className="w-3 h-3" /> : 
                                 <Send className="w-3 h-3" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium capitalize">{h.type?.replace(/_/g, ' ') || 'Action'}</p>
                                <p className="text-xs text-muted-foreground">
                                  {h.date ? format(new Date(h.date), 'MMM d, yyyy h:mm a') : 'Unknown date'}
                                </p>
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {h.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="p-4 text-sm text-muted-foreground text-center">No dunning history yet</p>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Click to load dunning information</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={fetchDunningData}>
                    Load Dunning Data
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Property Details</CardTitle>
            </CardHeader>
            <CardContent>
              {note.property ? (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Location:</span>
                    <span className="ml-2 font-medium">{note.property.county}, {note.property.state}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">APN:</span>
                    <span className="ml-2 font-mono">{note.property.apn}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Size:</span>
                    <span className="ml-2">{note.property.sizeAcres} acres</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <span className="ml-2">{note.property.status}</span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No property linked</p>
              )}
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Borrower Details</CardTitle>
            </CardHeader>
            <CardContent>
              {note.borrower ? (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <span className="ml-2 font-medium">{note.borrower.firstName} {note.borrower.lastName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>
                    <span className="ml-2">{note.borrower.email || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>
                    <span className="ml-2">{note.borrower.phone || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <span className="ml-2">{note.borrower.status}</span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No borrower linked</p>
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
      </div>
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

  return (
    <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <Card className="w-full max-w-md floating-window" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>Record Payment</CardTitle>
          <CardDescription>Record a payment for Note #{note.id}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Payment Amount ($)</label>
            <Input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={String(Number(note.monthlyPayment || 0))}
              data-testid="input-payment-amount"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Payment Method</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger data-testid="select-payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ach">ACH Transfer</SelectItem>
                <SelectItem value="card">Credit Card</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Principal</span>
              <span className="font-mono">${principalAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Interest</span>
              <span className="font-mono">${interestAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-medium pt-2 border-t">
              <span>Total</span>
              <span className="font-mono">${Number(amount || 0).toFixed(2)}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} className="flex-1" data-testid="button-submit-payment">
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Recording...
                </>
              ) : (
                "Record Payment"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NoteForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateNote();
  const { data: leads } = useLeads();
  const { data: properties } = useProperties();

  const availableProperties = properties?.filter(p => p.status !== 'sold') || [];
  const buyers = leads?.filter(l => l.type === 'buyer') || leads || [];

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

  const onSubmit = (data: z.infer<typeof insertNoteSchema>) => {
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
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="borrowerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Borrower</FormLabel>
                <Select onValueChange={(val) => field.onChange(parseInt(val))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-borrower">
                      <SelectValue placeholder="Select buyer" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {buyers.length === 0 ? (
                      <SelectItem value="none" disabled>No buyers available</SelectItem>
                    ) : (
                      buyers.map(lead => (
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
                <FormLabel>Property</FormLabel>
                <Select onValueChange={(val) => field.onChange(parseInt(val))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-property">
                      <SelectValue placeholder="Select property" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {availableProperties.length === 0 ? (
                      <SelectItem value="none" disabled>No properties available</SelectItem>
                    ) : (
                      availableProperties.map(prop => (
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

        <div className="grid grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="originalPrincipal"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Principal ($)</FormLabel>
                <FormControl>
                  <Input {...field} type="number" placeholder="10000" data-testid="input-principal" />
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
                <FormLabel>Interest Rate (%)</FormLabel>
                <FormControl>
                  <Input {...field} type="number" placeholder="9" data-testid="input-interest-rate" />
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
                <FormLabel>Term (months)</FormLabel>
                <FormControl>
                  <Input {...field} type="number" placeholder="60" data-testid="input-term" onChange={(e) => field.onChange(parseInt(e.target.value))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {suggestedPayment > 0 && (
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Calculated Monthly Payment</span>
              <span className="text-lg font-bold font-mono text-emerald-600">${suggestedPayment.toFixed(2)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="downPayment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Down Payment ($)</FormLabel>
                <FormControl>
                  <Input {...field} type="number" placeholder="1000" data-testid="input-down-payment" />
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
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input 
                    type="date" 
                    onChange={(e) => field.onChange(new Date(e.target.value))} 
                    defaultValue={new Date().toISOString().split('T')[0]}
                    data-testid="input-start-date"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="pt-2">
          <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit-note">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating Note...
              </>
            ) : (
              "Create Note"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
