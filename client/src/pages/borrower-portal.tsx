import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Calendar, CreditCard, CheckCircle, Clock, AlertTriangle, Building, Phone, Mail, Shield, Loader2, FileText, Download, MapPin, CalendarDays, RefreshCw, Calculator, ChevronDown, MessageSquare, Send } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { jsPDF } from "jspdf";
import type { Note, Payment, Property, BorrowerMessage } from "@shared/schema";

type BorrowerLoanData = {
  note: Note & { property?: Property };
  payments: Payment[];
  borrower?: { firstName: string; lastName: string } | null;
};

type PayoffQuote = {
  principalBalance: number;
  accruedInterest: number;
  payoffFee: number;
  totalPayoff: number;
  goodThroughDate: string;
  quoteDate: string;
  daysValid: number;
};

export default function BorrowerPortal() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const [email, setEmail] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [loanData, setLoanData] = useState<BorrowerLoanData | null>(null);
  const [error, setError] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");

  const handleVerify = async () => {
    setIsVerifying(true);
    setError("");
    
    try {
      const res = await fetch(`/api/borrower/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, email }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Verification failed");
      }
      
      const data = await res.json();
      setLoanData(data);
      setIsVerified(true);
      setVerifiedEmail(email);
    } catch (err: any) {
      setError(err.message || "Unable to verify. Please check your email address.");
    } finally {
      setIsVerifying(false);
    }
  };

  if (!accessToken) {
    return <BorrowerLandingPage />;
  }

  if (!isVerified) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F5E6D3] to-[#E8D4C4] dark:from-[#2D2118] dark:to-[#1A130D] flex items-center justify-center p-4">
        <Card className="w-full max-w-md floating-window">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <CardTitle>Borrower Portal</CardTitle>
            <CardDescription>
              Enter your email address to access your loan information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email Address</label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                data-testid="input-borrower-email"
              />
            </div>
            
            {error && (
              <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 text-sm">
                {error}
              </div>
            )}
            
            <Button 
              className="w-full" 
              onClick={handleVerify}
              disabled={isVerifying || !email}
              data-testid="button-verify-email"
            >
              {isVerifying ? "Verifying..." : "Access My Loan"}
            </Button>
            
            <p className="text-xs text-center text-muted-foreground">
              Your information is secure and encrypted
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!loanData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading loan information...</p>
      </div>
    );
  }

  return <BorrowerDashboard data={loanData} accessToken={accessToken} verifiedEmail={verifiedEmail} />;
}

function BorrowerLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E6D3] to-[#E8D4C4] dark:from-[#2D2118] dark:to-[#1A130D] flex items-center justify-center p-4">
      <Card className="w-full max-w-lg floating-window text-center">
        <CardHeader>
          <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
            <Building className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-2xl">AcreOS Borrower Portal</CardTitle>
          <CardDescription className="text-base">
            Access your loan information and make payments securely
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 text-left">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <FileText className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium">View Loan Details</p>
                <p className="text-sm text-muted-foreground">See your balance, payment schedule, and loan terms</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <CreditCard className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="font-medium">Make Payments</p>
                <p className="text-sm text-muted-foreground">Pay online with ACH or credit card</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Download className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="font-medium">Download Documents</p>
                <p className="text-sm text-muted-foreground">Access your contract and payment history</p>
              </div>
            </div>
          </div>
          
          <div className="p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
            To access your loan portal, use the link provided in your payment reminder email or contact your lender.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BorrowerDashboard({ data, accessToken, verifiedEmail }: { data: BorrowerLoanData; accessToken: string; verifiedEmail: string }) {
  const { note, payments, borrower } = data;
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentStatusState, setPaymentStatusMessage] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  
  const [autopayEnabled, setAutopayEnabled] = useState(note.autoPayEnabled || false);
  const [isTogglingAutopay, setIsTogglingAutopay] = useState(false);
  
  const [showPayoffQuote, setShowPayoffQuote] = useState(false);
  const [payoffQuote, setPayoffQuote] = useState<PayoffQuote | null>(null);
  const [isLoadingPayoff, setIsLoadingPayoff] = useState(false);
  
  const [showStatementDialog, setShowStatementDialog] = useState(false);
  const [statementType, setStatementType] = useState<'statement' | '1098'>('statement');
  const [statementYear, setStatementYear] = useState(new Date().getFullYear() - 1);
  const [isGeneratingStatement, setIsGeneratingStatement] = useState(false);
  
  const [visiblePayments, setVisiblePayments] = useState(10);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const paymentListRef = useRef<HTMLDivElement>(null);

  // Messaging state
  const [messages, setMessages] = useState<BorrowerMessage[]>([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/borrower/messages", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
        setUnreadCount(0); // Messages are marked read on fetch
      }
    } catch {
      // silently ignore
    } finally {
      setMessagesLoaded(true);
    }
  }, []);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isSendingMessage) return;
    setIsSendingMessage(true);
    try {
      const res = await fetch("/api/borrower/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: newMessage.trim() }),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => [...prev, msg]);
        setNewMessage("");
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } catch {
      // silently ignore
    } finally {
      setIsSendingMessage(false);
    }
  };
  
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentResult = urlParams.get('payment');
    const sessionId = urlParams.get('session_id');
    
    if (paymentResult === 'success' && sessionId) {
      setIsVerifyingPayment(true);
      verifyPayment(sessionId);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentResult === 'cancelled') {
      setPaymentStatusMessage({ type: 'error', message: 'Payment was cancelled' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
  
  const verifyPayment = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/portal/${accessToken}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      
      if (res.ok) {
        setPaymentStatusMessage({ type: 'success', message: 'Payment successful! Your payment has been recorded.' });
        setTimeout(() => window.location.reload(), 2000);
      } else {
        const data = await res.json();
        setPaymentStatusMessage({ type: 'error', message: data.message || 'Payment verification failed' });
      }
    } catch (err) {
      setPaymentStatusMessage({ type: 'error', message: 'Failed to verify payment' });
    } finally {
      setIsVerifyingPayment(false);
    }
  };
  
  const handleMakePayment = async () => {
    setIsProcessingPayment(true);
    try {
      const res = await fetch(`/api/portal/${accessToken}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(note.monthlyPayment) }),
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        }
      } else {
        const data = await res.json();
        setPaymentStatusMessage({ type: 'error', message: data.message || 'Failed to create payment session' });
      }
    } catch (err) {
      setPaymentStatusMessage({ type: 'error', message: 'Failed to initiate payment' });
    } finally {
      setIsProcessingPayment(false);
    }
  };
  
  const handleToggleAutopay = async () => {
    setIsTogglingAutopay(true);
    try {
      const res = await fetch(`/api/portal/${accessToken}/autopay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autopayEnabled, email: verifiedEmail }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setAutopayEnabled(data.autopayEnabled);
        setPaymentStatusMessage({ 
          type: 'success', 
          message: data.autopayEnabled ? 'Autopay has been enabled' : 'Autopay has been disabled' 
        });
      } else {
        const data = await res.json();
        setPaymentStatusMessage({ type: 'error', message: data.message || 'Failed to update autopay' });
      }
    } catch (err) {
      setPaymentStatusMessage({ type: 'error', message: 'Failed to update autopay settings' });
    } finally {
      setIsTogglingAutopay(false);
    }
  };
  
  const handleRequestPayoffQuote = async () => {
    setIsLoadingPayoff(true);
    setShowPayoffQuote(true);
    try {
      const res = await fetch(`/api/borrower/payoff-quote?accessToken=${accessToken}&email=${encodeURIComponent(verifiedEmail)}`);
      
      if (res.ok) {
        const data = await res.json();
        setPayoffQuote(data);
      } else {
        const data = await res.json();
        setPaymentStatusMessage({ type: 'error', message: data.message || 'Failed to get payoff quote' });
        setShowPayoffQuote(false);
      }
    } catch (err) {
      setPaymentStatusMessage({ type: 'error', message: 'Failed to request payoff quote' });
      setShowPayoffQuote(false);
    } finally {
      setIsLoadingPayoff(false);
    }
  };
  
  const handleGenerateStatement = async () => {
    setIsGeneratingStatement(true);
    try {
      const params = new URLSearchParams({
        accessToken,
        email: verifiedEmail,
        type: statementType,
      });
      
      if (statementType === '1098') {
        params.set('year', statementYear.toString());
      }
      
      const res = await fetch(`/api/borrower/statements/generate?${params}`);
      
      if (res.ok) {
        const data = await res.json();
        generatePDF(data);
        setShowStatementDialog(false);
      } else {
        const errData = await res.json();
        setPaymentStatusMessage({ type: 'error', message: errData.message || 'Failed to generate statement' });
      }
    } catch (err) {
      setPaymentStatusMessage({ type: 'error', message: 'Failed to generate statement' });
    } finally {
      setIsGeneratingStatement(false);
    }
  };
  
  const generatePDF = (data: any) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;
    
    if (data.type === '1098') {
      doc.setFontSize(18);
      doc.text('Form 1098 - Mortgage Interest Statement', pageWidth / 2, y, { align: 'center' });
      y += 10;
      
      doc.setFontSize(12);
      doc.text(`Tax Year: ${data.taxYear}`, pageWidth / 2, y, { align: 'center' });
      y += 20;
      
      doc.setFontSize(10);
      doc.text('LENDER INFORMATION:', 14, y);
      y += 6;
      doc.text(data.lenderName, 14, y);
      y += 5;
      if (data.lenderAddress) {
        doc.text(data.lenderAddress, 14, y);
        y += 5;
      }
      y += 10;
      
      doc.text('BORROWER INFORMATION:', 14, y);
      y += 6;
      doc.text(data.borrowerName, 14, y);
      y += 5;
      if (data.borrowerAddress) {
        doc.text(`${data.borrowerAddress}`, 14, y);
        y += 5;
        doc.text(`${data.borrowerCity || ''}, ${data.borrowerState || ''} ${data.borrowerZip || ''}`, 14, y);
        y += 5;
      }
      y += 15;
      
      doc.setFontSize(12);
      doc.text('Box 1 - Mortgage Interest Received:', 14, y);
      doc.setFontSize(14);
      doc.text(`$${data.interestPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 100, y);
      y += 10;
      
      doc.setFontSize(12);
      doc.text('Box 2 - Outstanding Mortgage Principal:', 14, y);
      doc.setFontSize(14);
      doc.text(`$${data.principalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 100, y);
      y += 10;
      
      doc.setFontSize(12);
      doc.text('Loan Origination Date:', 14, y);
      doc.text(format(new Date(data.loanOriginationDate), 'MMM d, yyyy'), 100, y);
      y += 20;
      
      doc.setFontSize(8);
      doc.text('This is for informational purposes. Please consult your tax advisor.', 14, y);
      
      doc.save(`1098_${data.taxYear}.pdf`);
    } else {
      doc.setFontSize(18);
      doc.text('Account Statement', pageWidth / 2, y, { align: 'center' });
      y += 10;
      
      doc.setFontSize(10);
      doc.text(`Generated: ${format(new Date(data.generatedDate), 'MMMM d, yyyy')}`, pageWidth / 2, y, { align: 'center' });
      y += 15;
      
      doc.line(14, y, pageWidth - 14, y);
      y += 10;
      
      doc.setFontSize(12);
      doc.text('ACCOUNT SUMMARY', 14, y);
      y += 8;
      
      doc.setFontSize(10);
      const summaryData = [
        ['Borrower:', data.borrowerName],
        ['Loan Number:', `#${data.noteId}`],
        ['Original Principal:', `$${data.originalPrincipal.toLocaleString()}`],
        ['Current Balance:', `$${data.currentBalance.toLocaleString()}`],
        ['Interest Rate:', `${data.interestRate}% APR`],
        ['Monthly Payment:', `$${data.monthlyPayment.toLocaleString()}`],
        ['Next Payment Due:', data.nextPaymentDate ? format(new Date(data.nextPaymentDate), 'MMM d, yyyy') : 'N/A'],
        ['Autopay Status:', data.autopayEnabled ? 'Enabled' : 'Disabled'],
      ];
      
      summaryData.forEach(([label, value]) => {
        doc.text(label, 14, y);
        doc.text(value, 80, y);
        y += 6;
      });
      
      y += 10;
      doc.line(14, y, pageWidth - 14, y);
      y += 10;
      
      doc.setFontSize(12);
      doc.text('PAYMENT SUMMARY', 14, y);
      y += 8;
      
      doc.setFontSize(10);
      doc.text('Total Payments:', 14, y);
      doc.text(data.summary.paymentsCount.toString(), 80, y);
      y += 6;
      doc.text('Total Paid:', 14, y);
      doc.text(`$${data.summary.totalPaid.toLocaleString()}`, 80, y);
      y += 6;
      doc.text('Principal Paid:', 14, y);
      doc.text(`$${data.summary.totalPrincipal.toLocaleString()}`, 80, y);
      y += 6;
      doc.text('Interest Paid:', 14, y);
      doc.text(`$${data.summary.totalInterest.toLocaleString()}`, 80, y);
      y += 15;
      
      if (data.payments && data.payments.length > 0) {
        doc.setFontSize(12);
        doc.text('PAYMENT HISTORY', 14, y);
        y += 8;
        
        doc.setFontSize(9);
        doc.text('Date', 14, y);
        doc.text('Amount', 50, y);
        doc.text('Principal', 80, y);
        doc.text('Interest', 110, y);
        doc.text('Method', 140, y);
        y += 6;
        
        doc.line(14, y, pageWidth - 14, y);
        y += 4;
        
        data.payments.slice(0, 20).forEach((p: any) => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(format(new Date(p.date), 'MM/dd/yy'), 14, y);
          doc.text(`$${p.amount.toLocaleString()}`, 50, y);
          doc.text(`$${p.principal.toLocaleString()}`, 80, y);
          doc.text(`$${p.interest.toLocaleString()}`, 110, y);
          doc.text(p.method || 'N/A', 140, y);
          y += 5;
        });
      }
      
      doc.save(`statement_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    }
  };
  
  const handleLoadMorePayments = useCallback(() => {
    if (isLoadingMore || visiblePayments >= payments.length) return;
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisiblePayments(prev => Math.min(prev + 10, payments.length));
      setIsLoadingMore(false);
    }, 300);
  }, [isLoadingMore, visiblePayments, payments.length]);
  
  useEffect(() => {
    const handleScroll = () => {
      if (!paymentListRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = paymentListRef.current;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        handleLoadMorePayments();
      }
    };
    
    const container = paymentListRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleLoadMorePayments]);
  
  const schedule = note.amortizationSchedule || [];
  const paidPayments = schedule.filter(s => s.status === 'paid').length;
  const totalPayments = schedule.length;
  const progress = totalPayments > 0 ? (paidPayments / totalPayments) * 100 : 0;
  
  const totalPaid = payments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const getPaymentStatusBadge = () => {
    if (!note.nextPaymentDate) return { status: 'current', label: 'Current', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' };
    const daysUntilDue = differenceInDays(new Date(note.nextPaymentDate), new Date());
    if (daysUntilDue < 0) return { status: 'late', label: `${Math.abs(daysUntilDue)} days past due`, color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };
    if (daysUntilDue <= 5) return { status: 'due', label: `Due in ${daysUntilDue} days`, color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' };
    return { status: 'current', label: 'Current', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' };
  };

  const paymentStatusBadge = getPaymentStatusBadge();
  const borrowerName = borrower ? `${borrower.firstName} ${borrower.lastName}` : 'Borrower';

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E6D3] to-[#E8D4C4] dark:from-[#2D2118] dark:to-[#1A130D]">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <Building className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            <div>
              <span className="font-bold text-base sm:text-lg">AcreOS Portal</span>
              <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Welcome, {borrowerName}</p>
            </div>
          </div>
          <Badge className={paymentStatusBadge.color} data-testid="badge-payment-status">
            {paymentStatusBadge.label}
          </Badge>
        </div>
      </header>
      
      {isVerifyingPayment && (
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="p-4 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Verifying your payment...
          </div>
        </div>
      )}
      
      {paymentStatusState.type && (
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className={`p-4 rounded-lg flex items-center gap-2 ${
            paymentStatusState.type === 'success' 
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400' 
              : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
          }`}>
            {paymentStatusState.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {paymentStatusState.message}
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-4 sm:space-y-6">
        <Card className={`glass-panel border-2 ${paymentStatusBadge.status === 'late' ? 'border-red-400/60' : 'border-primary/20'}`} data-testid="card-payment-due">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wide">Amount Due</p>
                <p className="text-4xl sm:text-5xl font-bold font-mono text-primary" data-testid="text-payment-amount">
                  ${Number(note.monthlyPayment || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                {note.nextPaymentDate && (
                  <p className={`text-sm mt-1 ${paymentStatusBadge.status === 'late' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}`}>
                    Due {format(new Date(note.nextPaymentDate), 'MMMM d, yyyy')}
                  </p>
                )}
                {autopayEnabled && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1 justify-center sm:justify-start">
                    <CheckCircle className="w-3 h-3" /> Autopay is on — payment will be collected automatically
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto text-lg px-8 py-6"
                  onClick={handleMakePayment}
                  disabled={isProcessingPayment}
                  data-testid="button-make-payment"
                  variant={autopayEnabled ? "outline" : "default"}
                >
                  {isProcessingPayment ? (
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  ) : (
                    <CreditCard className="w-5 h-5 mr-2" />
                  )}
                  {autopayEnabled ? "Pay Early" : "Pay Now"}
                </Button>
                {!autopayEnabled && (
                  <p className="text-xs text-center text-muted-foreground">
                    Enable autopay below to pay automatically each month
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          <Button 
            variant="outline" 
            className="flex flex-col items-center gap-1 h-auto py-4"
            onClick={() => {
              const element = document.getElementById('schedule-tab');
              if (element) element.click();
            }}
            data-testid="button-view-schedule"
          >
            <Calendar className="w-5 h-5" />
            <span className="text-xs sm:text-sm">Schedule</span>
          </Button>
          <Button 
            variant="outline" 
            className="flex flex-col items-center gap-1 h-auto py-4"
            onClick={() => setShowStatementDialog(true)}
            data-testid="button-download-statement"
          >
            <Download className="w-5 h-5" />
            <span className="text-xs sm:text-sm">Statements</span>
          </Button>
          <Button 
            variant="outline" 
            className="flex flex-col items-center gap-1 h-auto py-4"
            onClick={handleRequestPayoffQuote}
            data-testid="button-payoff-quote"
          >
            <Calculator className="w-5 h-5" />
            <span className="text-xs sm:text-sm">Payoff Quote</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col items-center gap-1 h-auto py-4 relative"
            onClick={() => {
              const tab = document.querySelector('[data-testid="tab-messages"]') as HTMLElement | null;
              if (tab) tab.click();
              if (!messagesLoaded) loadMessages();
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }}
            data-testid="button-contact"
          >
            <MessageSquare className="w-5 h-5" />
            <span className="text-xs sm:text-sm">Message</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Button>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Card className="glass-panel">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 sm:p-3 rounded-xl bg-primary/10">
                  <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Balance</p>
                  <p className="text-lg sm:text-2xl font-bold font-mono" data-testid="text-balance">
                    ${Number(note.currentBalance || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 sm:p-3 rounded-xl bg-emerald-500/10">
                  <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Total Paid</p>
                  <p className="text-lg sm:text-2xl font-bold font-mono" data-testid="text-total-paid">
                    ${totalPaid.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 sm:p-3 rounded-xl bg-blue-500/10">
                    <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">Autopay</p>
                    <p className="text-sm font-medium" data-testid="text-autopay-status">
                      {autopayEnabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={autopayEnabled}
                  onCheckedChange={handleToggleAutopay}
                  disabled={isTogglingAutopay}
                  data-testid="switch-autopay"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="floating-window">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">Loan Progress</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {paidPayments} of {totalPayments} payments completed
                </p>
              </div>
              <span className="text-base sm:text-lg font-bold">{progress.toFixed(0)}%</span>
            </div>
            <Progress value={progress} className="h-2 sm:h-3" />
          </CardContent>
        </Card>

        <Card className="floating-window">
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg">Loan Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Original Amount</span>
                  <span className="font-mono font-medium">${Number(note.originalPrincipal || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Interest Rate</span>
                  <span className="font-medium">{note.interestRate}% APR</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Term Length</span>
                  <span className="font-medium">{note.termMonths} months</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Start Date</span>
                  <span className="font-medium">{format(new Date(note.startDate), 'MMM d, yyyy')}</span>
                </div>
                {note.maturityDate && (
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Maturity Date</span>
                    <span className="font-medium">{format(new Date(note.maturityDate), 'MMM d, yyyy')}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Grace Period</span>
                  <span className="font-medium">{note.gracePeriodDays} days</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {note.property && (
          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <MapPin className="w-4 h-4 sm:w-5 sm:h-5" /> Property Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Location</p>
                  <p className="font-medium">{note.property.county}, {note.property.state}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">APN</p>
                  <p className="font-mono text-sm">{note.property.apn}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Size</p>
                  <p className="font-medium">{note.property.sizeAcres} acres</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="history">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="history" data-testid="tab-history">Payment History</TabsTrigger>
            <TabsTrigger value="schedule" id="schedule-tab" data-testid="tab-schedule">Payment Schedule</TabsTrigger>
            <TabsTrigger value="messages" data-testid="tab-messages" onClick={() => { if (!messagesLoaded) loadMessages(); }} className="relative">
              Messages
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="history">
            <Card>
              <CardContent className="p-0">
                <div 
                  ref={paymentListRef}
                  className="max-h-96 overflow-y-auto"
                  data-testid="payment-history-list"
                >
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="text-xs sm:text-sm">Date</TableHead>
                        <TableHead className="text-right text-xs sm:text-sm">Amount</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Principal</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Interest</TableHead>
                        <TableHead className="hidden md:table-cell">Method</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                            No payments recorded yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {payments.slice(0, visiblePayments).map((payment) => (
                            <TableRow key={payment.id} data-testid={`payment-row-${payment.id}`}>
                              <TableCell className="text-xs sm:text-sm">{format(new Date(payment.paymentDate), 'MMM d, yyyy')}</TableCell>
                              <TableCell className="text-right font-mono font-medium text-xs sm:text-sm">
                                ${Number(payment.amount).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground hidden sm:table-cell">
                                ${Number(payment.principalAmount).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground hidden sm:table-cell">
                                ${Number(payment.interestAmount).toLocaleString()}
                              </TableCell>
                              <TableCell className="capitalize hidden md:table-cell">{payment.paymentMethod || 'N/A'}</TableCell>
                              <TableCell>
                                <Badge variant={payment.status === 'completed' ? 'default' : 'secondary'} className="text-xs">
                                  {payment.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          {visiblePayments < payments.length && (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-4">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleLoadMorePayments}
                                  disabled={isLoadingMore}
                                  data-testid="button-load-more"
                                >
                                  {isLoadingMore ? (
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4 mr-2" />
                                  )}
                                  Load More ({payments.length - visiblePayments} remaining)
                                </Button>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="messages">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" /> Messages
                </CardTitle>
                <CardDescription>
                  Have a question or need to discuss your payment? Send us a message.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {!messagesLoaded ? (
                  <div className="flex items-center justify-center py-8">
                    <Button variant="outline" onClick={loadMessages} data-testid="button-load-messages">
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Load Messages
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3 max-h-80 overflow-y-auto" data-testid="message-thread">
                      {messages.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
                          <p className="text-sm">No messages yet. Send us a message below.</p>
                        </div>
                      ) : (
                        messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.senderType === "borrower" ? "justify-end" : "justify-start"}`}
                            data-testid={`message-${msg.id}`}
                          >
                            <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                              msg.senderType === "borrower"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground"
                            }`}>
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                              <p className={`text-xs mt-1 opacity-70 ${msg.senderType === "borrower" ? "text-right" : ""}`}>
                                {msg.senderType === "borrower" ? "You" : "Your Lender"} · {format(new Date(msg.createdAt!), "MMM d, h:mm a")}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                    <div className="flex gap-2 pt-2 border-t">
                      <Textarea
                        placeholder="Type your message here..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        rows={2}
                        className="resize-none"
                        data-testid="input-message"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                      />
                      <Button
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || isSendingMessage}
                        className="self-end"
                        data-testid="button-send-message"
                      >
                        {isSendingMessage ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule">
            <Card>
              <CardContent className="p-0 max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="text-xs sm:text-sm">#</TableHead>
                      <TableHead className="text-xs sm:text-sm">Due Date</TableHead>
                      <TableHead className="text-right text-xs sm:text-sm">Payment</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Principal</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Interest</TableHead>
                      <TableHead className="text-right hidden md:table-cell">Balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedule.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                          No payment schedule available
                        </TableCell>
                      </TableRow>
                    ) : (
                      schedule.map((row) => (
                        <TableRow key={row.paymentNumber} data-testid={`schedule-row-${row.paymentNumber}`}>
                          <TableCell className="font-medium text-xs sm:text-sm">{row.paymentNumber}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{format(new Date(row.dueDate), 'MMM d, yyyy')}</TableCell>
                          <TableCell className="text-right font-mono text-xs sm:text-sm">${row.payment.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground hidden sm:table-cell">
                            ${row.principal.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground hidden sm:table-cell">
                            ${row.interest.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono hidden md:table-cell">${row.balance.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge 
                              variant={row.status === 'paid' ? 'default' : row.status === 'late' ? 'destructive' : 'secondary'}
                              className="text-xs"
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={showPayoffQuote} onOpenChange={setShowPayoffQuote}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-payoff-quote">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Payoff Quote
            </DialogTitle>
            <DialogDescription>
              Your estimated payoff amount to pay off the loan in full
            </DialogDescription>
          </DialogHeader>
          {isLoadingPayoff ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : payoffQuote ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Principal Balance</span>
                  <span className="font-mono font-medium">${payoffQuote.principalBalance.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Accrued Interest</span>
                  <span className="font-mono font-medium">${payoffQuote.accruedInterest.toLocaleString()}</span>
                </div>
                {payoffQuote.payoffFee > 0 && (
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Payoff Fee</span>
                    <span className="font-mono font-medium">${payoffQuote.payoffFee.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between py-3 bg-primary/10 rounded-lg px-3 mt-4">
                  <span className="font-semibold">Total Payoff Amount</span>
                  <span className="font-mono font-bold text-lg text-primary" data-testid="text-payoff-total">
                    ${payoffQuote.totalPayoff.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="text-sm text-muted-foreground text-center">
                <p>Quote valid through: {format(new Date(payoffQuote.goodThroughDate), 'MMMM d, yyyy')}</p>
                <p className="text-xs mt-1">({payoffQuote.daysValid} days from quote date)</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayoffQuote(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showStatementDialog} onOpenChange={setShowStatementDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-statement">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Download Statement
            </DialogTitle>
            <DialogDescription>
              Generate and download your loan documents
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Statement Type</label>
              <Select value={statementType} onValueChange={(v) => setStatementType(v as 'statement' | '1098')}>
                <SelectTrigger data-testid="select-statement-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="statement">Account Statement</SelectItem>
                  <SelectItem value="1098">1098 Interest Statement (Tax)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {statementType === '1098' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Tax Year</label>
                <Select value={statementYear.toString()} onValueChange={(v) => setStatementYear(Number(v))}>
                  <SelectTrigger data-testid="select-tax-year">
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4].map(offset => {
                      const year = new Date().getFullYear() - offset;
                      return <SelectItem key={year} value={year.toString()}>{year}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatementDialog(false)}>Cancel</Button>
            <Button onClick={handleGenerateStatement} disabled={isGeneratingStatement} data-testid="button-generate-pdf">
              {isGeneratingStatement ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="fixed bottom-0 left-0 right-0 sm:hidden border-t bg-background/95 backdrop-blur">
        <div className="grid grid-cols-3 gap-1 p-2">
          <Button 
            variant="ghost" 
            className="flex flex-col items-center gap-1 h-auto py-2"
            onClick={handleMakePayment}
            disabled={isProcessingPayment}
            data-testid="mobile-button-pay"
          >
            <CreditCard className="w-5 h-5" />
            <span className="text-xs">Pay Now</span>
          </Button>
          <Button 
            variant="ghost" 
            className="flex flex-col items-center gap-1 h-auto py-2"
            onClick={() => {
              const element = document.getElementById('schedule-tab');
              if (element) element.click();
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }}
            data-testid="mobile-button-schedule"
          >
            <Calendar className="w-5 h-5" />
            <span className="text-xs">Schedule</span>
          </Button>
          <Button
            variant="ghost"
            className="flex flex-col items-center gap-1 h-auto py-2 relative"
            onClick={() => {
              const tab = document.querySelector('[data-testid="tab-messages"]') as HTMLElement | null;
              if (tab) tab.click();
              if (!messagesLoaded) loadMessages();
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }}
            data-testid="mobile-button-contact"
          >
            <MessageSquare className="w-5 h-5" />
            <span className="text-xs">Message</span>
            {unreadCount > 0 && (
              <span className="absolute top-0 right-1 w-4 h-4 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>
      
      <div className="h-16 sm:hidden" />
    </div>
  );
}
