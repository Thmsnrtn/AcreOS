import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Calendar, FileText, CreditCard, CheckCircle, Clock, AlertTriangle, User, MapPin, Building, Phone, Mail, Shield, Download } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import type { Note, Payment, Property } from "@shared/schema";

type BorrowerLoanData = {
  note: Note & { property?: Property };
  payments: Payment[];
};

export default function BorrowerPortal() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const [email, setEmail] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [loanData, setLoanData] = useState<BorrowerLoanData | null>(null);
  const [error, setError] = useState("");

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

  return <BorrowerDashboard data={loanData} />;
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

function BorrowerDashboard({ data }: { data: BorrowerLoanData }) {
  const { note, payments } = data;
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  
  const schedule = note.amortizationSchedule || [];
  const paidPayments = schedule.filter(s => s.status === 'paid').length;
  const totalPayments = schedule.length;
  const progress = totalPayments > 0 ? (paidPayments / totalPayments) * 100 : 0;
  
  const totalPaid = payments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const getPaymentStatus = () => {
    if (!note.nextPaymentDate) return { status: 'current', label: 'Current', color: 'bg-emerald-100 text-emerald-800' };
    const daysUntilDue = differenceInDays(new Date(note.nextPaymentDate), new Date());
    if (daysUntilDue < 0) return { status: 'late', label: `${Math.abs(daysUntilDue)} days past due`, color: 'bg-red-100 text-red-800' };
    if (daysUntilDue <= 5) return { status: 'due', label: `Due in ${daysUntilDue} days`, color: 'bg-amber-100 text-amber-800' };
    return { status: 'current', label: 'Current', color: 'bg-emerald-100 text-emerald-800' };
  };

  const paymentStatus = getPaymentStatus();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5E6D3] to-[#E8D4C4] dark:from-[#2D2118] dark:to-[#1A130D]">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building className="w-6 h-6 text-primary" />
            <span className="font-bold text-lg">AcreOS Borrower Portal</span>
          </div>
          <Badge className={paymentStatus.color}>
            {paymentStatus.label}
          </Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="grid md:grid-cols-3 gap-4">
          <Card className="glass-panel">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary/10">
                  <DollarSign className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Current Balance</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-balance">
                    ${Number(note.currentBalance || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-emerald-500/10">
                  <Calendar className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Next Payment</p>
                  <p className="text-2xl font-bold font-mono text-emerald-600" data-testid="text-next-payment">
                    ${Number(note.monthlyPayment || 0).toLocaleString()}
                  </p>
                  {note.nextPaymentDate && (
                    <p className="text-xs text-muted-foreground">
                      Due {format(new Date(note.nextPaymentDate), 'MMM d, yyyy')}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-blue-500/10">
                  <CheckCircle className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Paid</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-total-paid">
                    ${totalPaid.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="floating-window">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">Loan Progress</h3>
                <p className="text-sm text-muted-foreground">
                  {paidPayments} of {totalPayments} payments completed
                </p>
              </div>
              <span className="text-lg font-bold">{progress.toFixed(0)}%</span>
            </div>
            <Progress value={progress} className="h-3" />
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button 
            size="lg" 
            className="flex-1" 
            onClick={() => setShowPaymentForm(true)}
            data-testid="button-make-payment"
          >
            <CreditCard className="w-5 h-5 mr-2" /> Make a Payment
          </Button>
          <Button size="lg" variant="outline" className="flex-1">
            <Download className="w-5 h-5 mr-2" /> Download Statement
          </Button>
        </div>

        <Card className="floating-window">
          <CardHeader>
            <CardTitle>Loan Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Original Amount</span>
                  <span className="font-mono font-medium">${Number(note.originalPrincipal || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Interest Rate</span>
                  <span className="font-medium">{note.interestRate}% APR</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Term Length</span>
                  <span className="font-medium">{note.termMonths} months</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Monthly Payment</span>
                  <span className="font-mono font-medium text-emerald-600">${Number(note.monthlyPayment || 0).toLocaleString()}</span>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Start Date</span>
                  <span className="font-medium">{format(new Date(note.startDate), 'MMM d, yyyy')}</span>
                </div>
                {note.maturityDate && (
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">Maturity Date</span>
                    <span className="font-medium">{format(new Date(note.maturityDate), 'MMM d, yyyy')}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Grace Period</span>
                  <span className="font-medium">{note.gracePeriodDays} days</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Late Fee</span>
                  <span className="font-mono font-medium">${Number(note.lateFee || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {note.property && (
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5" /> Property Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-medium">{note.property.county}, {note.property.state}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">APN</p>
                  <p className="font-mono">{note.property.apn}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Size</p>
                  <p className="font-medium">{note.property.sizeAcres} acres</p>
                </div>
                {note.property.legalDescription && (
                  <div className="md:col-span-2">
                    <p className="text-sm text-muted-foreground">Legal Description</p>
                    <p className="text-sm">{note.property.legalDescription}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="history">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="history" data-testid="tab-history">Payment History</TabsTrigger>
            <TabsTrigger value="schedule" data-testid="tab-schedule">Payment Schedule</TabsTrigger>
          </TabsList>

          <TabsContent value="history">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Interest</TableHead>
                      <TableHead>Method</TableHead>
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
                      payments.map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell>{format(new Date(payment.paymentDate), 'MMM d, yyyy')}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            ${Number(payment.amount).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            ${Number(payment.principalAmount).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            ${Number(payment.interestAmount).toLocaleString()}
                          </TableCell>
                          <TableCell className="capitalize">{payment.paymentMethod || 'N/A'}</TableCell>
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule">
            <Card>
              <CardContent className="p-0 max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Payment</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Interest</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
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
                        <TableRow key={row.paymentNumber}>
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
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="glass-panel">
          <CardHeader>
            <CardTitle>Need Help?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Phone Support</p>
                  <p className="font-medium">Contact your lender</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">support@example.com</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {showPaymentForm && (
        <PaymentFormModal 
          note={note} 
          onClose={() => setShowPaymentForm(false)} 
        />
      )}
    </div>
  );
}

function PaymentFormModal({ note, onClose }: { note: Note; onClose: () => void }) {
  const [amount, setAmount] = useState(note.monthlyPayment?.toString() || '');
  const [method, setMethod] = useState('ach');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async () => {
    setIsProcessing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      alert("Payment submitted successfully! You will receive a confirmation email.");
      onClose();
    } catch (err) {
      alert("Payment failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-md floating-window" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>Make a Payment</CardTitle>
          <CardDescription>Pay securely online</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Payment Amount ($)</label>
            <Input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={note.monthlyPayment?.toString()}
              data-testid="input-portal-payment-amount"
            />
            <p className="text-xs text-muted-foreground">
              Regular payment: ${Number(note.monthlyPayment || 0).toLocaleString()}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Payment Method</label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger data-testid="select-portal-payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ach">ACH Bank Transfer (Free)</SelectItem>
                <SelectItem value="card">Credit/Debit Card (+3% fee)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {method === 'ach' && (
            <div className="space-y-4 p-4 rounded-lg bg-muted/50">
              <div className="space-y-2">
                <label className="text-sm font-medium">Routing Number</label>
                <Input placeholder="123456789" data-testid="input-routing" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Account Number</label>
                <Input placeholder="1234567890" data-testid="input-account" />
              </div>
            </div>
          )}

          {method === 'card' && (
            <div className="space-y-4 p-4 rounded-lg bg-muted/50">
              <div className="space-y-2">
                <label className="text-sm font-medium">Card Number</label>
                <Input placeholder="4242 4242 4242 4242" data-testid="input-card-number" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Expiry</label>
                  <Input placeholder="MM/YY" data-testid="input-expiry" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">CVC</label>
                  <Input placeholder="123" data-testid="input-cvc" />
                </div>
              </div>
              <p className="text-xs text-amber-600">
                A 3% processing fee will be added for card payments.
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={isProcessing} 
              className="flex-1"
              data-testid="button-submit-portal-payment"
            >
              {isProcessing ? "Processing..." : `Pay $${Number(amount || 0).toLocaleString()}`}
            </Button>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Shield className="w-3 h-3" />
            <span>Payments are secure and encrypted</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
