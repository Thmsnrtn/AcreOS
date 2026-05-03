import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Calendar, CreditCard, CheckCircle, Clock, AlertTriangle, Building, Phone, Mail, Shield, Loader2, FileText, Download, MapPin, CalendarDays, RefreshCw, Calculator, ChevronDown, MessageSquare, Send, X, Info } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { format, differenceInDays } from "date-fns";
import { jsPDF } from "jspdf";
import type { Note, Payment, Property, BorrowerMessage } from "@shared/schema";
import { LegalDocReadAloud } from "@/components/LegalDocReadAloud";

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

  useDocumentTitle("Borrower portal");

  const handleVerify = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter the email address your lender has on file for you.");
      return;
    }
    setIsVerifying(true);
    setError("");

    try {
      const res = await fetch(`/api/borrower/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, email: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "We couldn't match that email to this loan. Check the address from your payment reminder email and try again.");
      }

      const data = await res.json();
      setLoanData(data);
      setIsVerified(true);
      setVerifiedEmail(trimmed);
    } catch (err: any) {
      setError(err.message || "We couldn't verify your access right now. Check your connection and try again.");
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
        <h1 className="sr-only">Borrower portal sign-in</h1>
        <Card className="w-full max-w-md floating-window">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
              <Shield className="w-8 h-8 text-primary" aria-hidden="true" />
            </div>
            <CardTitle>Borrower portal</CardTitle>
            <CardDescription>
              Enter the email address your lender has on file to view your loan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!isVerifying && email.trim()) {
                  void handleVerify();
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="borrower-email">Email address</Label>
                <Input
                  id="borrower-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "borrower-email-error" : undefined}
                  data-testid="input-borrower-email"
                />
              </div>

              {error && (
                <div
                  id="borrower-email-error"
                  role="alert"
                  className="p-3 rounded-lg bg-acr-neg-soft dark:bg-acr-neg-soft/30 text-acr-neg dark:text-acr-neg text-sm"
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full min-h-11"
                disabled={isVerifying || !email.trim()}
                data-testid="button-verify-email"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    Verifying…
                  </>
                ) : (
                  "Access my loan"
                )}
              </Button>
            </form>

            <p className="text-xs text-center text-muted-foreground">
              Your information is encrypted in transit and at rest.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!loanData) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="w-5 h-5 mr-2 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-muted-foreground">Loading your loan…</p>
      </div>
    );
  }

  return <BorrowerDashboard data={loanData} accessToken={accessToken} verifiedEmail={verifiedEmail} />;
}

// Sigfried §1 — borrower-portal sunset banner.
// Dismissible (per-browser via localStorage). Shown for users on the
// legacy /portal/:accessToken route while the deprecated payment
// endpoints are in their 90-day sunset window. Successor surface is
// /portal/v2; we link there once it's live, but the banner alone
// gives borrowers a heads-up so the URL change isn't a surprise.
const PORTAL_SUNSET_DISMISS_KEY = "acreos:portal-sunset-banner-dismissed";

function PortalSunsetBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(PORTAL_SUNSET_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(PORTAL_SUNSET_DISMISS_KEY, "1");
    } catch {
      // localStorage may be blocked (private mode, quota) — fall back to
      // in-memory dismissal so the banner at least disappears for this
      // session.
    }
    setDismissed(true);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 pt-4">
      <Alert className="relative pr-10 border-acr-warn/40 bg-acr-warn-soft/60 dark:bg-acr-warn-soft/20" role="status" data-testid="banner-portal-sunset">
        <Info className="h-4 w-4 text-acr-warn" aria-hidden="true" />
        <AlertTitle className="text-acr-warn dark:text-acr-warn">
          This portal is being upgraded
        </AlertTitle>
        <AlertDescription className="text-acr-warn/80 dark:text-acr-warn/80">
          New URL coming soon. Your existing access link will keep working
          during the transition — we'll email you the new address before the
          old one retires.
        </AlertDescription>
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-2 right-2 p-1 rounded-md text-acr-warn/60 hover:bg-acr-warn/10 hover:text-acr-warn transition-colors focus:outline-none focus:ring-2 focus:ring-acr-warn/40"
          aria-label="Dismiss portal upgrade notice"
          data-testid="button-dismiss-portal-sunset"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </Alert>
    </div>
  );
}

function BorrowerLandingPage() {
  useDocumentTitle("Borrower portal — AcreOS");
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E6D3] to-[#E8D4C4] dark:from-[#2D2118] dark:to-[#1A130D] flex items-center justify-center p-4">
      <h1 className="sr-only">AcreOS borrower portal</h1>
      <Card className="w-full max-w-lg floating-window text-center">
        <CardHeader>
          <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
            <Building className="w-10 h-10 text-primary" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">AcreOS borrower portal</CardTitle>
          <CardDescription className="text-base">
            Access your loan information and make payments securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ul className="grid gap-4 text-left">
            <li className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-acr-pos-soft dark:bg-acr-pos-soft/30 shrink-0">
                <FileText className="w-4 h-4 text-acr-pos" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">View loan details</p>
                <p className="text-sm text-muted-foreground">See your balance, payment schedule, and loan terms.</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-acr-accent dark:bg-acr-accent/30 shrink-0">
                <CreditCard className="w-4 h-4 text-acr-accent" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">Make payments</p>
                <p className="text-sm text-muted-foreground">Pay online with ACH or credit card.</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-acr-warn-soft dark:bg-acr-warn-soft/30 shrink-0">
                <Download className="w-4 h-4 text-acr-warn" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">Download documents</p>
                <p className="text-sm text-muted-foreground">Access your contract and payment history.</p>
              </div>
            </li>
          </ul>

          <div className="p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
            To open your portal, use the link in your payment reminder email — or contact your lender.
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
  const portalDocRef = useRef<HTMLElement>(null);
  
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
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [sendMessageError, setSendMessageError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    setMessagesError(null);
    try {
      const res = await fetch("/api/borrower/messages", { credentials: "include" });
      if (!res.ok) {
        throw new Error("Couldn't load messages. Please try again.");
      }
      const data = await res.json();
      setMessages(data);
      setUnreadCount(0); // Messages are marked read on fetch
    } catch (err: any) {
      setMessagesError(err?.message || "Couldn't load messages. Check your connection and try again.");
    } finally {
      setMessagesLoaded(true);
    }
  }, []);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || isSendingMessage) return;
    setIsSendingMessage(true);
    setSendMessageError(null);
    try {
      const res = await fetch("/api/borrower/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: newMessage.trim() }),
      });
      if (!res.ok) {
        throw new Error("Your message didn't send. Please try again in a moment.");
      }
      const msg = await res.json();
      setMessages(prev => [...prev, msg]);
      setNewMessage("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) {
      setSendMessageError(err?.message || "Your message didn't send. Check your connection and try again.");
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
      setPaymentStatusMessage({ type: 'error', message: 'Payment was cancelled — no charge was made.' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);
  
  const verifyPayment = async (sessionId: string) => {
    try {
      // Session-based. /api/borrower/verify established the cookie;
      // no need to put the access token in every URL.
      const res = await fetch(`/api/borrower/verify-payment`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      
      if (res.ok) {
        setPaymentStatusMessage({ type: 'success', message: 'Payment successful! Your payment has been recorded.' });
        setTimeout(() => window.location.reload(), 2000);
      } else {
        const data = await res.json();
        setPaymentStatusMessage({
          type: 'error',
          message: (data.message || "We couldn't verify your payment yet.") + " If you were charged, your lender will reconcile it within 24 hours — you don't need to pay again.",
        });
      }
    } catch (err) {
      setPaymentStatusMessage({
        type: 'error',
        message: "We couldn't verify your payment right now. If you were charged, your lender will reconcile it within 24 hours — you don't need to pay again.",
      });
    } finally {
      setIsVerifyingPayment(false);
    }
  };
  
  const handleMakePayment = async () => {
    setIsProcessingPayment(true);
    try {
      const res = await fetch(`/api/borrower/payment`, {
        method: 'POST',
        credentials: 'include',
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
        setPaymentStatusMessage({
          type: 'error',
          message: (data.message || "We couldn't start your payment right now.") + " No card was charged — please try again.",
        });
      }
    } catch (err) {
      setPaymentStatusMessage({
        type: 'error',
        message: "We couldn't start your payment right now. Check your connection and try again — no card was charged.",
      });
    } finally {
      setIsProcessingPayment(false);
    }
  };
  
  const handleToggleAutopay = async () => {
    setIsTogglingAutopay(true);
    try {
      const res = await fetch(`/api/borrower/autopay`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autopayEnabled }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setAutopayEnabled(data.autopayEnabled);
        setPaymentStatusMessage({
          type: 'success',
          message: data.autopayEnabled ? 'Autopay has been enabled' : 'Autopay has been disabled',
        });
      } else {
        const data = await res.json();
        setPaymentStatusMessage({
          type: 'error',
          message: (data.message || "We couldn't update autopay.") + " Your current autopay setting hasn't changed.",
        });
      }
    } catch (err) {
      setPaymentStatusMessage({
        type: 'error',
        message: "We couldn't update autopay right now. Your current autopay setting hasn't changed.",
      });
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
        ['Original Principal:', usd(data.originalPrincipal)],
        ['Current Balance:', usd(data.currentBalance)],
        ['Interest Rate:', `${data.interestRate}% APR`],
        ['Monthly Payment:', usd(data.monthlyPayment)],
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
      doc.text(usd(data.summary.totalPaid), 80, y);
      y += 6;
      doc.text('Principal Paid:', 14, y);
      doc.text(usd(data.summary.totalPrincipal), 80, y);
      y += 6;
      doc.text('Interest Paid:', 14, y);
      doc.text(usd(data.summary.totalInterest), 80, y);
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
          doc.text(usd(p.amount), 50, y);
          doc.text(usd(p.principal), 80, y);
          doc.text(usd(p.interest), 110, y);
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
    if (!note.nextPaymentDate) return { status: 'current', label: 'Current', color: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos' };
    const daysUntilDue = differenceInDays(new Date(note.nextPaymentDate), new Date());
    if (daysUntilDue < 0) return { status: 'late', label: `${Math.abs(daysUntilDue)} days past due`, color: 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg' };
    if (daysUntilDue <= 5) return { status: 'due', label: `Due in ${daysUntilDue} days`, color: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn' };
    return { status: 'current', label: 'Current', color: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos' };
  };

  const paymentStatusBadge = getPaymentStatusBadge();
  const borrowerName = borrower ? `${borrower.firstName} ${borrower.lastName}` : 'Borrower';

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E6D3] to-[#E8D4C4] dark:from-[#2D2118] dark:to-[#1A130D]">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <Building className="w-5 h-5 sm:w-6 sm:h-6 text-primary" aria-hidden="true" />
            <div>
              <span className="font-bold text-base sm:text-lg">AcreOS portal</span>
              <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
                Welcome, <span className="font-medium text-foreground">{borrowerName}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LegalDocReadAloud
              docRef={portalDocRef}
              startLabel="Read this portal aloud"
              stopLabel="Stop reading portal"
              data-testid="borrower-portal-read-aloud"
            />
            <Badge className={paymentStatusBadge.color} data-testid="badge-payment-status" aria-label={`Payment status: ${paymentStatusBadge.label}`}>
              <span className="tabular-nums">{paymentStatusBadge.label}</span>
            </Badge>
          </div>
        </div>
      </header>

      <PortalSunsetBanner />

      {isVerifyingPayment && (
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div
            role="status"
            aria-live="polite"
            className="p-4 rounded-lg bg-acr-accent dark:bg-acr-accent/30 text-acr-accent dark:text-acr-accent flex items-center gap-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Verifying your payment…
          </div>
        </div>
      )}

      {paymentStatusState.type && (
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div
            role={paymentStatusState.type === "success" ? "status" : "alert"}
            aria-live={paymentStatusState.type === "success" ? "polite" : "assertive"}
            className={`p-4 rounded-lg flex items-center gap-2 ${
              paymentStatusState.type === 'success'
                ? 'bg-acr-pos-soft dark:bg-acr-pos-soft/30 text-acr-pos dark:text-acr-pos'
                : 'bg-acr-neg-soft dark:bg-acr-neg-soft/30 text-acr-neg dark:text-acr-neg'
            }`}
          >
            {paymentStatusState.type === 'success' ? (
              <CheckCircle className="w-4 h-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            )}
            {paymentStatusState.message}
          </div>
        </div>
      )}

      <main ref={portalDocRef} className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-4 sm:space-y-6">
        <Card className={`glass-panel border-2 ${paymentStatusBadge.status === 'late' ? 'border-acr-neg/60' : 'border-primary/20'}`} data-testid="card-payment-due">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wide">Amount due</p>
                <p className="text-4xl sm:text-5xl font-bold font-mono tabular-nums text-primary" data-testid="text-payment-amount">
                  ${Number(note.monthlyPayment || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {note.nextPaymentDate && (
                  <p className={`text-sm mt-1 tabular-nums ${paymentStatusBadge.status === 'late' ? 'text-acr-neg dark:text-acr-neg font-semibold' : 'text-muted-foreground'}`}>
                    Due {format(new Date(note.nextPaymentDate), 'MMMM d, yyyy')}
                  </p>
                )}
                {autopayEnabled && (
                  <p className="text-xs text-acr-pos dark:text-acr-pos mt-1 flex items-center gap-1 justify-center sm:justify-start">
                    <CheckCircle className="w-3 h-3" aria-hidden="true" /> Autopay is on — we'll collect this payment automatically.
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
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <CreditCard className="w-5 h-5 mr-2" aria-hidden="true" />
                  )}
                  {autopayEnabled ? "Pay early" : "Pay now"}
                </Button>
                {!autopayEnabled && (
                  <p className="text-xs text-center text-muted-foreground">
                    Enable autopay below to pay automatically each month.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4" role="group" aria-label="Quick actions">
          <Button
            variant="outline"
            className="flex flex-col items-center gap-1 h-auto py-4 min-h-16"
            onClick={() => {
              const element = document.getElementById('schedule-tab');
              if (element) element.click();
            }}
            data-testid="button-view-schedule"
          >
            <Calendar className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs sm:text-sm">Schedule</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col items-center gap-1 h-auto py-4 min-h-16"
            onClick={() => setShowStatementDialog(true)}
            data-testid="button-download-statement"
          >
            <Download className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs sm:text-sm">Statements</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col items-center gap-1 h-auto py-4 min-h-16"
            onClick={handleRequestPayoffQuote}
            data-testid="button-payoff-quote"
          >
            <Calculator className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs sm:text-sm">Payoff quote</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col items-center gap-1 h-auto py-4 min-h-16 relative"
            onClick={() => {
              const tab = document.querySelector('[data-testid="tab-messages"]') as HTMLElement | null;
              if (tab) tab.click();
              if (!messagesLoaded) loadMessages();
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }}
            data-testid="button-contact"
            aria-label={unreadCount > 0 ? `Messages (${unreadCount} unread)` : "Messages"}
          >
            <MessageSquare className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs sm:text-sm">Message</span>
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center tabular-nums"
              >
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
                  <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Balance</p>
                  <p className="text-lg sm:text-2xl font-bold font-mono tabular-nums" data-testid="text-balance">
                    ${Number(note.currentBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 sm:p-3 rounded-xl bg-acr-pos/10">
                  <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-acr-pos" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Total paid</p>
                  <p className="text-lg sm:text-2xl font-bold font-mono tabular-nums" data-testid="text-total-paid">
                    ${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 sm:p-3 rounded-xl bg-acr-accent/10">
                    <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 text-acr-accent" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground" id="autopay-label">Autopay</p>
                    <p className="text-sm font-medium" data-testid="text-autopay-status">
                      {autopayEnabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={autopayEnabled}
                  onCheckedChange={handleToggleAutopay}
                  disabled={isTogglingAutopay}
                  aria-labelledby="autopay-label"
                  aria-label={`Autopay ${autopayEnabled ? 'enabled' : 'disabled'}. Toggle to ${autopayEnabled ? 'disable' : 'enable'}.`}
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
                <h3 className="font-semibold">Loan progress</h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  <span className="tabular-nums">{paidPayments}</span> of{" "}
                  <span className="tabular-nums">{totalPayments}</span> payments completed
                </p>
              </div>
              <span className="text-base sm:text-lg font-bold tabular-nums">{progress.toFixed(0)}%</span>
            </div>
            <Progress
              value={progress}
              className="h-2 sm:h-3"
              aria-label={`Loan progress: ${progress.toFixed(0)} percent complete, ${paidPayments} of ${totalPayments} payments made`}
            />
          </CardContent>
        </Card>

        <Card className="floating-window">
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg">Loan details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid sm:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b">
                  <dt className="text-sm text-muted-foreground">Original amount</dt>
                  <dd className="font-mono font-medium tabular-nums">
                    ${Number(note.originalPrincipal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </dd>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <dt className="text-sm text-muted-foreground">Interest rate</dt>
                  <dd className="font-medium tabular-nums">{note.interestRate}% APR</dd>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <dt className="text-sm text-muted-foreground">Term length</dt>
                  <dd className="font-medium tabular-nums">{note.termMonths} months</dd>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b">
                  <dt className="text-sm text-muted-foreground">Start date</dt>
                  <dd className="font-medium tabular-nums">{format(new Date(note.startDate), 'MMM d, yyyy')}</dd>
                </div>
                {note.maturityDate && (
                  <div className="flex justify-between py-2 border-b">
                    <dt className="text-sm text-muted-foreground">Maturity date</dt>
                    <dd className="font-medium tabular-nums">{format(new Date(note.maturityDate), 'MMM d, yyyy')}</dd>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b">
                  <dt className="text-sm text-muted-foreground">Grace period</dt>
                  <dd className="font-medium tabular-nums">{note.gracePeriodDays} days</dd>
                </div>
              </div>
            </dl>
          </CardContent>
        </Card>

        {note.property && (
          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <MapPin className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" /> Property information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid sm:grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs sm:text-sm text-muted-foreground">Location</dt>
                  <dd className="font-medium">{note.property.county}, {note.property.state}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm text-muted-foreground">APN</dt>
                  <dd className="font-mono text-sm tabular-nums">{note.property.apn}</dd>
                </div>
                <div>
                  <dt className="text-xs sm:text-sm text-muted-foreground">Size</dt>
                  <dd className="font-medium tabular-nums">{note.property.sizeAcres} acres</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="history">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="history" data-testid="tab-history">Payment history</TabsTrigger>
            <TabsTrigger value="schedule" id="schedule-tab" data-testid="tab-schedule">Payment schedule</TabsTrigger>
            <TabsTrigger
              value="messages"
              data-testid="tab-messages"
              onClick={() => { if (!messagesLoaded) loadMessages(); }}
              className="relative"
              aria-label={unreadCount > 0 ? `Messages (${unreadCount} unread)` : "Messages"}
            >
              Messages
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center tabular-nums"
                >
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
                  tabIndex={0}
                  role="region"
                  aria-label="Payment history"
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
                            No payments recorded yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {payments.slice(0, visiblePayments).map((payment) => (
                            <TableRow key={payment.id} data-testid={`payment-row-${payment.id}`}>
                              <TableCell className="text-xs sm:text-sm tabular-nums">{format(new Date(payment.paymentDate), 'MMM d, yyyy')}</TableCell>
                              <TableCell className="text-right font-mono font-medium text-xs sm:text-sm tabular-nums">
                                ${Number(payment.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground hidden sm:table-cell tabular-nums">
                                ${Number(payment.principalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground hidden sm:table-cell tabular-nums">
                                ${Number(payment.interestAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="capitalize hidden md:table-cell">{payment.paymentMethod || '—'}</TableCell>
                              <TableCell>
                                <Badge variant={payment.status === 'completed' ? 'default' : 'secondary'} className="text-xs capitalize">
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
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4 mr-2" aria-hidden="true" />
                                  )}
                                  Load more (<span className="tabular-nums">{payments.length - visiblePayments}</span> remaining)
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
                  <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" /> Messages
                </CardTitle>
                <CardDescription>
                  Have a question or need to discuss your payment? Send us a message.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {!messagesLoaded ? (
                  <div className="flex items-center justify-center py-8">
                    <Button variant="outline" onClick={loadMessages} data-testid="button-load-messages">
                      <MessageSquare className="w-4 h-4 mr-2" aria-hidden="true" />
                      Load messages
                    </Button>
                  </div>
                ) : (
                  <>
                    {messagesError && (
                      <div
                        role="alert"
                        className="p-3 rounded-md border border-destructive/50 bg-destructive/5 text-sm flex items-start gap-2"
                        data-testid="alert-messages-error"
                      >
                        <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-1">
                          <p className="text-foreground">{messagesError}</p>
                          <Button size="sm" variant="outline" className="mt-2" onClick={loadMessages}>
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                            Try again
                          </Button>
                        </div>
                      </div>
                    )}
                    <div
                      className="space-y-3 max-h-80 overflow-y-auto"
                      data-testid="message-thread"
                      role="log"
                      aria-live="polite"
                      aria-label="Conversation with your lender"
                      tabIndex={0}
                    >
                      {messages.length === 0 && !messagesError ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" aria-hidden="true" />
                          <p className="text-sm">No messages yet. Send your lender a message below.</p>
                        </div>
                      ) : (
                        messages.map((msg) => {
                          const isBorrower = msg.senderType === "borrower";
                          return (
                            <div
                              key={msg.id}
                              className={`flex ${isBorrower ? "justify-end" : "justify-start"}`}
                              data-testid={`message-${msg.id}`}
                            >
                              <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                                isBorrower
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-foreground"
                              }`}>
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                                <p className={`text-xs mt-1 opacity-70 tabular-nums ${isBorrower ? "text-right" : ""}`}>
                                  <span className="sr-only">{isBorrower ? "Sent" : "Received"} — </span>
                                  {isBorrower ? "You" : "Your lender"} · {format(new Date(msg.createdAt!), "MMM d, h:mm a")}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                    {sendMessageError && (
                      <div
                        role="alert"
                        className="p-3 rounded-md border border-destructive/50 bg-destructive/5 text-sm flex items-start gap-2"
                        data-testid="alert-send-message-error"
                      >
                        <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                        <p className="text-foreground">{sendMessageError}</p>
                      </div>
                    )}
                    <div className="flex gap-2 pt-2 border-t">
                      <Label htmlFor="borrower-new-message" className="sr-only">Message to your lender</Label>
                      <Textarea
                        id="borrower-new-message"
                        placeholder="Type your message here…"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        rows={2}
                        className="resize-none"
                        data-testid="input-message"
                        aria-describedby={sendMessageError ? "alert-send-message-error" : undefined}
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
                        aria-label={isSendingMessage ? "Sending message" : "Send message"}
                      >
                        {isSendingMessage ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="w-4 h-4" aria-hidden="true" />
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
              <CardContent className="p-0">
                <div
                  className="max-h-96 overflow-y-auto"
                  tabIndex={0}
                  role="region"
                  aria-label="Payment schedule"
                >
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead scope="col" className="text-xs sm:text-sm">#</TableHead>
                        <TableHead scope="col" className="text-xs sm:text-sm">Due date</TableHead>
                        <TableHead scope="col" className="text-right text-xs sm:text-sm">Payment</TableHead>
                        <TableHead scope="col" className="text-right hidden sm:table-cell">Principal</TableHead>
                        <TableHead scope="col" className="text-right hidden sm:table-cell">Interest</TableHead>
                        <TableHead scope="col" className="text-right hidden md:table-cell">Balance</TableHead>
                        <TableHead scope="col">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schedule.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                            No payment schedule available.
                          </TableCell>
                        </TableRow>
                      ) : (
                        schedule.map((row) => (
                          <TableRow key={row.paymentNumber} data-testid={`schedule-row-${row.paymentNumber}`}>
                            <TableCell className="font-medium text-xs sm:text-sm tabular-nums">{row.paymentNumber}</TableCell>
                            <TableCell className="text-xs sm:text-sm tabular-nums">
                              <time dateTime={new Date(row.dueDate).toISOString()}>{format(new Date(row.dueDate), 'MMM d, yyyy')}</time>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs sm:text-sm tabular-nums">${row.payment.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground hidden sm:table-cell tabular-nums">
                              ${row.principal.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground hidden sm:table-cell tabular-nums">
                              ${row.interest.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono hidden md:table-cell tabular-nums">${row.balance.toFixed(2)}</TableCell>
                            <TableCell>
                              <Badge
                                variant={row.status === 'paid' ? 'default' : row.status === 'late' ? 'destructive' : 'secondary'}
                                className="text-xs capitalize"
                                aria-label={`Payment status: ${row.status}`}
                              >
                                {row.status}
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
        </Tabs>
      </main>

      <Dialog open={showPayoffQuote} onOpenChange={setShowPayoffQuote}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-payoff-quote">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" aria-hidden="true" />
              Payoff quote
            </DialogTitle>
            <DialogDescription>
              The amount needed to pay your loan in full on the quote date below.
            </DialogDescription>
          </DialogHeader>
          {isLoadingPayoff ? (
            <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
              <Loader2 className="w-8 h-8 animate-spin text-primary" aria-hidden="true" />
              <span className="sr-only">Calculating your payoff quote…</span>
            </div>
          ) : payoffQuote ? (
            <div className="space-y-4">
              <dl className="space-y-2">
                <div className="flex justify-between py-2 border-b">
                  <dt className="text-muted-foreground">Principal balance</dt>
                  <dd className="font-mono font-medium tabular-nums">
                    ${payoffQuote.principalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </dd>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <dt className="text-muted-foreground">Accrued interest</dt>
                  <dd className="font-mono font-medium tabular-nums">
                    ${payoffQuote.accruedInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </dd>
                </div>
                {payoffQuote.payoffFee > 0 && (
                  <div className="flex justify-between py-2 border-b">
                    <dt className="text-muted-foreground">Payoff fee</dt>
                    <dd className="font-mono font-medium tabular-nums">
                      ${payoffQuote.payoffFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between py-3 bg-primary/10 rounded-lg px-3 mt-4">
                  <dt className="font-semibold">Total payoff amount</dt>
                  <dd className="font-mono font-bold text-lg text-primary tabular-nums" data-testid="text-payoff-total">
                    ${payoffQuote.totalPayoff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </dd>
                </div>
              </dl>
              <div className="text-sm text-muted-foreground text-center">
                <p className="tabular-nums">Quote valid through: {format(new Date(payoffQuote.goodThroughDate), 'MMMM d, yyyy')}</p>
                <p className="text-xs mt-1 tabular-nums">({payoffQuote.daysValid} days from quote date)</p>
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
              <FileText className="w-5 h-5" aria-hidden="true" />
              Download statement
            </DialogTitle>
            <DialogDescription>
              Generate and download your loan documents as a PDF.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="select-statement-type">Statement type</Label>
              <Select value={statementType} onValueChange={(v) => setStatementType(v as 'statement' | '1098')}>
                <SelectTrigger id="select-statement-type" data-testid="select-statement-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="statement">Account statement</SelectItem>
                  <SelectItem value="1098">Form 1098 (mortgage interest — tax)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {statementType === '1098' && (
              <div className="space-y-2">
                <Label htmlFor="select-tax-year">Tax year</Label>
                <Select value={statementYear.toString()} onValueChange={(v) => setStatementYear(Number(v))}>
                  <SelectTrigger id="select-tax-year" data-testid="select-tax-year">
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
                <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />
              ) : (
                <Download className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <nav
        className="fixed bottom-0 left-0 right-0 sm:hidden border-t bg-background/95 backdrop-blur"
        aria-label="Primary actions"
      >
        <div className="grid grid-cols-3 gap-1 p-2">
          <Button
            variant="ghost"
            className="flex flex-col items-center gap-1 h-auto py-2 min-h-14"
            onClick={handleMakePayment}
            disabled={isProcessingPayment}
            data-testid="mobile-button-pay"
          >
            <CreditCard className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs">{autopayEnabled ? "Pay early" : "Pay now"}</span>
          </Button>
          <Button
            variant="ghost"
            className="flex flex-col items-center gap-1 h-auto py-2 min-h-14"
            onClick={() => {
              const element = document.getElementById('schedule-tab');
              if (element) element.click();
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }}
            data-testid="mobile-button-schedule"
          >
            <Calendar className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs">Schedule</span>
          </Button>
          <Button
            variant="ghost"
            className="flex flex-col items-center gap-1 h-auto py-2 min-h-14 relative"
            onClick={() => {
              const tab = document.querySelector('[data-testid="tab-messages"]') as HTMLElement | null;
              if (tab) tab.click();
              if (!messagesLoaded) loadMessages();
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            }}
            data-testid="mobile-button-contact"
            aria-label={unreadCount > 0 ? `Messages (${unreadCount} unread)` : "Messages"}
          >
            <MessageSquare className="w-5 h-5" aria-hidden="true" />
            <span className="text-xs">Message</span>
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-0 right-1 min-w-[16px] h-4 px-1 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center tabular-nums"
              >
                {unreadCount}
              </span>
            )}
          </Button>
        </div>
      </nav>

      <div className="h-16 sm:hidden" />
    </div>
  );
}
