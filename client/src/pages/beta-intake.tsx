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
import { useDocumentTitle } from "@/hooks/use-document-title";

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
  useDocumentTitle("Join the AcreOS beta");
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
      toast({
        title: "Couldn't join the waitlist",
        description: err?.message || "Check your connection and try again.",
        variant: "destructive",
      });
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
    if (!checkEmail.trim()) return;
    setChecking(true);
    try {
      const res = await apiRequest("GET", `/api/beta/waitlist/status?email=${encodeURIComponent(checkEmail)}`);
      const data: StatusResult = await res.json();
      setStatusResult(data);
    } catch (err: any) {
      toast({
        title: "Couldn't check status",
        description: err?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  if (joined) {
    return (
      <PageShell>
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center space-y-2" role="status" aria-live="polite">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-acr-pos-soft dark:bg-acr-pos-soft/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-acr-pos" aria-hidden="true" />
              </div>
            </div>
            <h1 className="text-2xl font-bold">You're on the list!</h1>
            <p className="text-muted-foreground">{joined.message}</p>
          </div>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center">
                <div className="text-4xl font-bold text-primary tabular-nums">#{joined.position}</div>
                <div className="text-sm text-muted-foreground mt-1">Your position in the waitlist</div>
              </div>

              <div className="border rounded-lg p-4 space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-primary" aria-hidden="true" /> Your referral code
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono">{joined.referralCode}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    aria-label={copied ? "Copied referral code to clipboard" : "Copy referral code"}
                  >
                    {copied ? (
                      <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                    ) : (
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Share this code with other Land Investors. Each person who signs up with your code moves you up the list.
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
              <Rocket className="w-7 h-7 text-primary" aria-hidden="true" />
            </div>
          </div>
          <h1 className="text-3xl font-bold">Join the AcreOS beta</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Get early access to the operating system built for Land Investors.
            Limited spots available.
          </p>
        </div>

        {/* Features */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2" aria-label="Features included in the beta">
              {FEATURE_HIGHLIGHTS.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-acr-pos shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Signup Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5" aria-hidden="true" /> Request early access
            </CardTitle>
            <CardDescription>
              Fill in your details below. We'll notify you when your spot is ready.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.email.trim() || joinMutation.isPending) return;
                joinMutation.mutate();
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="beta-first-name">First name</Label>
                  <Input
                    id="beta-first-name"
                    placeholder="John"
                    value={form.firstName}
                    autoComplete="given-name"
                    onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))}
                    data-testid="input-beta-first-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="beta-last-name">Last name</Label>
                  <Input
                    id="beta-last-name"
                    placeholder="Smith"
                    value={form.lastName}
                    autoComplete="family-name"
                    onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))}
                    data-testid="input-beta-last-name"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="beta-email">
                  Email <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id="beta-email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="input-beta-email"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="beta-company">Company or business name</Label>
                <Input
                  id="beta-company"
                  placeholder="Smith Land Holdings LLC"
                  value={form.company}
                  autoComplete="organization"
                  onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))}
                  data-testid="input-beta-company"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="beta-use-case">How do you plan to use AcreOS?</Label>
                <Textarea
                  id="beta-use-case"
                  placeholder="e.g. I buy 10–20 rural acres per month via direct mail and want to automate my seller outreach and use the AI negotiation tools…"
                  value={form.useCase}
                  onChange={(e) => setForm(f => ({ ...f, useCase: e.target.value }))}
                  rows={3}
                  aria-describedby="beta-use-case-hint"
                  data-testid="input-beta-use-case"
                />
                <p id="beta-use-case-hint" className="text-xs text-muted-foreground">More detail = higher priority score.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="beta-referral-code">Referral code (optional)</Label>
                <Input
                  id="beta-referral-code"
                  placeholder="ACRE-00001"
                  value={form.referralCode}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setForm(f => ({ ...f, referralCode: e.target.value }))}
                  data-testid="input-beta-referral"
                />
              </div>

              <Button
                type="submit"
                className="w-full min-h-11"
                disabled={!form.email.trim() || joinMutation.isPending}
                data-testid="button-beta-submit"
              >
                {joinMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />
                    Joining…
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4 mr-2" aria-hidden="true" />
                    Request early access
                  </>
                )}
              </Button>
            </form>
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
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!checkEmail.trim() || checking) return;
                void handleCheckStatus();
              }}
            >
              <Label htmlFor="beta-status-email" className="sr-only">Email to check waitlist status</Label>
              <Input
                id="beta-status-email"
                type="email"
                placeholder="you@example.com"
                value={checkEmail}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setCheckEmail(e.target.value)}
                data-testid="input-beta-status-email"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!checkEmail.trim() || checking}
                className="min-h-11"
                aria-label={checking ? "Checking status" : "Check waitlist status"}
              >
                {checking ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="w-4 h-4" aria-hidden="true" />
                )}
              </Button>
            </form>

            {statusResult && (
              <div className="rounded-lg border p-3 text-sm space-y-1" role="status" aria-live="polite">
                {statusResult.found ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground">Position:</span>
                      <span className="font-bold tabular-nums">#{statusResult.position}</span>
                      {statusResult.status && (
                        <Badge variant="outline" className="text-xs capitalize">{statusResult.status}</Badge>
                      )}
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
