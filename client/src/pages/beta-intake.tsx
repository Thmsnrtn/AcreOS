/**
 * T96 — Beta Intake / Waitlist Signup
 *
 * Public-facing page where potential beta users can join the AcreOS waitlist.
 * Features:
 *   - Email + name + company + use-case form
 *   - Referral code support (move up the list)
 *   - Post-submit: shows waitlist position + referral code to share
 *   - Check existing status by email
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Rocket,
  CheckCircle2,
  Copy,
  Users,
  Share2,
  Loader2,
  Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface JoinResult {
  position: number;
  referralCode: string;
  message: string;
}

interface StatusResult {
  found: boolean;
  position?: number;
  status?: string;
  cohort?: string;
  referralCode?: string;
}

const FEATURE_HIGHLIGHTS = [
  "Autonomous deal sourcing — 24/7 opportunity scanning",
  "AI negotiation copilot with seller psychology analysis",
  "AcreOS Market Value™ — proprietary land valuation model",
  "Portfolio optimizer with Monte Carlo risk analysis",
  "Marketplace for wholesaling directly to other investors",
  "Voice AI — automated seller call handling + transcription",
];

export default function BetaIntakePage() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    company: "",
    useCase: "",
    referralCode: "",
  });
  const [joined, setJoined] = useState<JoinResult | null>(null);
  const [checkEmail, setCheckEmail] = useState("");
  const [statusResult, setStatusResult] = useState<StatusResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const joinMutation = useMutation({
    mutationFn: (): Promise<JoinResult> =>
      apiRequest("POST", "/api/beta/waitlist", form).then(r => r.json()),
    onSuccess: (res: JoinResult) => {
      setJoined(res);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to join waitlist", variant: "destructive" });
    },
  });

  const handleCopy = () => {
    if (joined?.referralCode) {
      navigator.clipboard.writeText(joined.referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCheckStatus = async () => {
    if (!checkEmail) return;
    setChecking(true);
    try {
      const res = await apiRequest("GET", `/api/beta/waitlist/status?email=${encodeURIComponent(checkEmail)}`);
      const data: StatusResult = await res.json();
      setStatusResult(data);
    } catch {
      toast({ title: "Error checking status", variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  if (joined) {
    return (
      <PageShell>
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center space-y-2">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
            </div>
            <h1 className="text-2xl font-bold">You're on the list!</h1>
            <p className="text-muted-foreground">{joined.message}</p>
          </div>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center">
                <div className="text-4xl font-bold text-primary">#{joined.position}</div>
                <div className="text-sm text-muted-foreground mt-1">Your position in the waitlist</div>
              </div>

              <div className="border rounded-lg p-4 space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-primary" /> Your referral code
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono">{joined.referralCode}</code>
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Share this code with other land investors. Each person who signs up with your code moves you up the list.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Rocket className="w-7 h-7 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-bold">Join the AcreOS Beta</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Get early access to the most powerful land investment platform ever built.
            Limited spots available.
          </p>
        </div>

        {/* Features */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FEATURE_HIGHLIGHTS.map((f) => (
                <div key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Signup Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5" /> Request Early Access
            </CardTitle>
            <CardDescription>
              Fill in your details below. We'll notify you when your spot is ready.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First Name</Label>
                <Input
                  placeholder="John"
                  value={form.firstName}
                  onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Last Name</Label>
                <Input
                  placeholder="Smith"
                  value={form.lastName}
                  onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                placeholder="john@example.com"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Company / Business Name</Label>
              <Input
                placeholder="Smith Land Holdings LLC"
                value={form.company}
                onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>How do you plan to use AcreOS?</Label>
              <Textarea
                placeholder="e.g. I buy 10–20 rural acres per month via direct mail and want to automate my seller outreach and use the AI negotiation tools..."
                value={form.useCase}
                onChange={(e) => setForm(f => ({ ...f, useCase: e.target.value }))}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">More detail = higher priority score</p>
            </div>

            <div className="space-y-1.5">
              <Label>Referral Code (optional)</Label>
              <Input
                placeholder="ACRE-00001"
                value={form.referralCode}
                onChange={(e) => setForm(f => ({ ...f, referralCode: e.target.value }))}
              />
            </div>

            <Button
              className="w-full"
              onClick={() => joinMutation.mutate()}
              disabled={!form.email || joinMutation.isPending}
            >
              {joinMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Joining...</>
              ) : (
                <><Rocket className="w-4 h-4 mr-2" /> Request Early Access</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Check Status */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Already signed up? Check your position.
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="your@email.com"
                value={checkEmail}
                onChange={(e) => setCheckEmail(e.target.value)}
              />
              <Button variant="outline" onClick={handleCheckStatus} disabled={!checkEmail || checking}>
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>

            {statusResult && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                {statusResult.found ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Position:</span>
                      <span className="font-bold">#{statusResult.position}</span>
                      <Badge variant="outline" className="text-xs">{statusResult.status}</Badge>
                      {statusResult.cohort && <Badge variant="secondary" className="text-xs">{statusResult.cohort}</Badge>}
                    </div>
                    {statusResult.referralCode && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-muted-foreground text-xs">Your code:</span>
                        <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{statusResult.referralCode}</code>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Email not found on the waitlist.</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
