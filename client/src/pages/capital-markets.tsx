import { useId, useState, type FormEvent } from "react";
import { RequiredDisclaimer } from "@/components/required-disclaimer";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Building, Users, DollarSign, BarChart2, ArrowRight, SlidersHorizontal, CheckCircle } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

function RatingBadge({ rating }: { rating: string }) {
  const colors: Record<string, string> = { AAA: "bg-acr-pos-soft text-acr-pos", AA: "bg-acr-accent text-acr-accent", A: "bg-acr-accent text-acr-accent", BBB: "bg-acr-warn-soft text-acr-warn" };
  return <Badge className={colors[rating] ?? "bg-muted text-muted-foreground"} aria-label={`Credit rating: ${rating}`}>{rating}</Badge>;
}

function fmt(n: number) {
  // Compact display for KPI cards. Always uses usd() for the fallback so
  // sub-$1K amounts preserve cents — only the K/M abbreviated bands round.
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return usd(n, { noCents: true });
}

const reassurance = "Your inputs are still on this device — try again.";

const WIZARD_STEPS = [
  { title: "Pool selection", description: "Choose seller-financed notes to include in the pool" },
  { title: "Structure", description: "Define tranche structure and waterfall" },
  { title: "Rating", description: "Internal credit rating and risk assessment" },
  { title: "Launch", description: "Review and launch the securitization offering" },
];

function SecuritizationWizard() {
  const [step, setStep] = useState(0);
  const [poolNotes, setPoolNotes] = useState("");
  const [tranche, setTranche] = useState("senior");
  const [rating, setRating] = useState("A");
  const { toast } = useToast();
  const poolId = useId();
  const trancheId = useId();
  const ratingId = useId();

  function handleLaunch() {
    toast({ title: "Securitization launched", description: "Your offering has been submitted for review." });
    setStep(0);
    setPoolNotes("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-primary" aria-hidden="true" /> Note securitization wizard
        </CardTitle>
        <CardDescription>4-step process to pool and securitize seller-financed notes</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ol className="flex items-center gap-2 list-none p-0 m-0" aria-label="Securitization wizard steps">
          {WIZARD_STEPS.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                aria-label={`Step ${i + 1} of ${WIZARD_STEPS.length}: ${s.title}${i === step ? " (current)" : i < step ? " (completed)" : ""}`}
                className={`flex items-center gap-2 text-sm ${i === step ? "font-semibold text-primary" : i < step ? "text-acr-pos" : "text-muted-foreground"}`}
              >
                {i < step ? (
                  <CheckCircle className="w-5 h-5" aria-hidden="true" />
                ) : (
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold ${i === step ? "border-primary text-primary" : "border-muted-foreground"}`} aria-hidden="true">
                    {i + 1}
                  </div>
                )}
                <span className="hidden md:inline">{s.title}</span>
              </button>
              {i < WIZARD_STEPS.length - 1 && (
                <div className={`h-0.5 w-8 ${i < step ? "bg-acr-pos" : "bg-muted"}`} aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>

        <div className="p-4 bg-muted/30 rounded-card" role="group" aria-label={WIZARD_STEPS[step].title}>
          <p className="text-sm font-medium mb-1">{WIZARD_STEPS[step].title}</p>
          <p className="text-xs text-muted-foreground mb-3">{WIZARD_STEPS[step].description}</p>

          {step === 0 && (
            <div className="space-y-2">
              <Label htmlFor={poolId}>Note IDs to pool (comma-separated)</Label>
              <Input
                id={poolId}
                placeholder="note-001, note-002, note-003"
                value={poolNotes}
                onChange={e => setPoolNotes(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">Enter the IDs of seller-financed notes to include in this pool.</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-2">
              <Label htmlFor={trancheId}>Tranche type</Label>
              <Select value={tranche} onValueChange={setTranche}>
                <SelectTrigger id={trancheId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="senior">Senior — first-lien priority in waterfall</SelectItem>
                  <SelectItem value="mezzanine">Mezzanine — middle priority, higher yield</SelectItem>
                  <SelectItem value="equity">Equity residual — last paid, highest upside</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Senior tranches receive priority in waterfall distributions.</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-2">
              <Label htmlFor={ratingId}>Internal credit rating</Label>
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger id={ratingId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AAA">AAA — highest quality (lowest yield)</SelectItem>
                  <SelectItem value="AA">AA — high quality</SelectItem>
                  <SelectItem value="A">A — upper medium</SelectItem>
                  <SelectItem value="BBB">BBB — medium grade (highest yield)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Rating affects investor interest rate expectations.</p>
            </div>
          )}

          {step === 3 && (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground inline">Pool notes:</dt>{" "}
                <dd className="font-medium inline">{poolNotes || "None selected"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground inline">Tranche:</dt>{" "}
                <dd className="font-medium capitalize inline">{tranche}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground inline">Rating:</dt>{" "}
                <dd className="font-medium inline">{rating}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>
          {step < WIZARD_STEPS.length - 1 ? (
            <Button onClick={() => setStep(s => s + 1)}>
              Next <ArrowRight className="w-4 h-4 ml-1" aria-hidden="true" />
            </Button>
          ) : (
            <Button onClick={handleLaunch} className="bg-acr-pos hover:bg-acr-pos">
              <CheckCircle className="w-4 h-4 mr-1" aria-hidden="true" /> Launch offering
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CapitalMarketsPage() {
  useDocumentTitle("Capital markets");
  const { toast } = useToast();

  const [lenderFilters, setLenderFilters] = useState({
    loanType: "any",
    maxLtv: "",
    state: "",
    propertyType: "any",
  });

  const filterLoanTypeId = useId();
  const filterLtvId = useId();
  const filterStateId = useId();
  const filterPropTypeId = useId();
  const matchAmountId = useId();
  const matchStateId = useId();
  const matchLtvId = useId();

  const { data: securitiesData } = useQuery({
    queryKey: ["/api/capital-markets/securities"],
    queryFn: async () => {
      const res = await fetch("/api/capital-markets/securities", { credentials: "include" });
      return res.json();
    },
  });

  const { data: lendersData } = useQuery({
    queryKey: ["/api/capital-markets/lenders"],
    queryFn: async () => {
      const res = await fetch("/api/capital-markets/lenders", { credentials: "include" });
      return res.json();
    },
  });

  const { data: raisesData } = useQuery({
    queryKey: ["/api/capital-markets/raises"],
    queryFn: async () => {
      const res = await fetch("/api/capital-markets/raises", { credentials: "include" });
      return res.json();
    },
  });

  const { data: efficiencyData } = useQuery({
    queryKey: ["/api/capital-markets/efficiency"],
    queryFn: async () => {
      const res = await fetch("/api/capital-markets/efficiency", { credentials: "include" });
      return res.json();
    },
  });

  const securities = securitiesData?.securities ?? [];
  const lenders = lendersData?.lenders ?? [];
  const raises = raisesData?.raises ?? [];
  const metrics = efficiencyData?.metrics;

  const [matchForm, setMatchForm] = useState({ dealAmount: "", state: "", ltv: "" });
  const [matchResults, setMatchResults] = useState<any[]>([]);
  const matchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/capital-markets/match-lenders", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealAmount: parseFloat(matchForm.dealAmount), state: matchForm.state, ltv: parseFloat(matchForm.ltv) }),
      });
      return res.json();
    },
    onSuccess: (data) => setMatchResults(data.matches ?? []),
    onError: (e: any) => toast({ title: "Couldn't match lenders", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  function handleMatchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (matchMutation.isPending || !matchForm.dealAmount || !matchForm.state || !matchForm.ltv) return;
    matchMutation.mutate();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <RequiredDisclaimer type="financial" />
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="w-7 h-7 text-primary" aria-hidden="true" /> Capital markets
        </h1>
        <p className="text-muted-foreground mt-1">
          Note securitization, lender matching, and capital-raise management
        </p>
      </div>

      {metrics && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <dt className="text-xs text-muted-foreground">Total capital deployed</dt>
            <dd className="text-xl font-bold tabular-nums">{fmt(metrics.totalCapitalDeployed ?? 0)}</dd>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <dt className="text-xs text-muted-foreground">Active securities</dt>
            <dd className="text-xl font-bold text-acr-accent tabular-nums">{metrics.activeSecurities ?? securities.length}</dd>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <dt className="text-xs text-muted-foreground">Average yield</dt>
            <dd className="text-xl font-bold text-acr-pos tabular-nums">{metrics.avgYield ? `${metrics.avgYield.toFixed(1)}%` : "—"}</dd>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <dt className="text-xs text-muted-foreground">Capital efficiency</dt>
            <dd className="text-xl font-bold tabular-nums">{metrics.capitalEfficiencyRatio ? `${(metrics.capitalEfficiencyRatio * 100).toFixed(0)}%` : "—"}</dd>
          </CardContent></Card>
        </dl>
      )}

      <Tabs defaultValue="securities">
        <TabsList>
          <TabsTrigger value="securities">Securities</TabsTrigger>
          <TabsTrigger value="lenders">Lender network</TabsTrigger>
          <TabsTrigger value="raises">Capital raises</TabsTrigger>
          <TabsTrigger value="match">Match lenders</TabsTrigger>
          <TabsTrigger value="securitization">Securitize notes</TabsTrigger>
        </TabsList>

        {/* Securities */}
        <TabsContent value="securities" className="mt-4">
          {securities.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <BarChart2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
              <p className="text-muted-foreground">No securitization offerings yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Pool your seller-financed notes to create offerings for institutional investors.</p>
            </CardContent></Card>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 list-none p-0 m-0" aria-label="Active securitization offerings">
              {securities.map((sec: any) => (
                <li key={sec.id}>
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{sec.name ?? `Security #${sec.id}`}</span>
                        <RatingBadge rating={sec.rating ?? "A"} />
                      </div>
                      <dl className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <dt className="text-muted-foreground">Total principal</dt>
                          <dd className="font-semibold tabular-nums">{fmt(sec.totalPrincipal ?? 0)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Yield</dt>
                          <dd className="font-semibold text-acr-pos tabular-nums">{sec.expectedYield?.toFixed(1) ?? "—"}%</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Min investment</dt>
                          <dd className="font-semibold tabular-nums">{fmt(sec.minimumInvestment ?? 0)}</dd>
                        </div>
                      </dl>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Notes in pool</span>
                          <span className="tabular-nums">{sec.noteCount ?? "—"}</span>
                        </div>
                        <Progress
                          value={Math.min((sec.soldPercentage ?? 0), 100)}
                          className="h-1.5"
                          role="progressbar"
                          aria-valuenow={Math.min(sec.soldPercentage ?? 0, 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Subscription progress for ${sec.name ?? `security #${sec.id}`}`}
                        />
                        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{sec.soldPercentage ?? 0}% subscribed</p>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* Lenders */}
        <TabsContent value="lenders" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" /> Filter lenders
              </CardTitle>
            </CardHeader>
            <CardContent>
              <fieldset>
                <legend className="sr-only">Lender filters</legend>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label htmlFor={filterLoanTypeId} className="text-xs">Loan type</Label>
                    <Select value={lenderFilters.loanType} onValueChange={v => setLenderFilters(f => ({ ...f, loanType: v }))}>
                      <SelectTrigger id={filterLoanTypeId} className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="conventional">Conventional</SelectItem>
                        <SelectItem value="hard_money">Hard money</SelectItem>
                        <SelectItem value="bridge">Bridge</SelectItem>
                        <SelectItem value="seller_finance">Seller finance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={filterLtvId} className="text-xs">Max LTV (%)</Label>
                    <Input
                      id={filterLtvId}
                      className="h-8 text-xs"
                      type="number"
                      inputMode="numeric"
                      placeholder="e.g. 75"
                      value={lenderFilters.maxLtv}
                      onChange={e => setLenderFilters(f => ({ ...f, maxLtv: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor={filterStateId} className="text-xs">State</Label>
                    <Input
                      id={filterStateId}
                      className="h-8 text-xs"
                      placeholder="TX"
                      maxLength={2}
                      value={lenderFilters.state}
                      onChange={e => setLenderFilters(f => ({ ...f, state: e.target.value.toUpperCase() }))}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <Label htmlFor={filterPropTypeId} className="text-xs">Property type</Label>
                    <Select value={lenderFilters.propertyType} onValueChange={v => setLenderFilters(f => ({ ...f, propertyType: v }))}>
                      <SelectTrigger id={filterPropTypeId} className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="land">Raw land</SelectItem>
                        <SelectItem value="agricultural">Agricultural</SelectItem>
                        <SelectItem value="residential">Residential</SelectItem>
                        <SelectItem value="commercial">Commercial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </fieldset>
            </CardContent>
          </Card>

          {lenders.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
              <p className="text-muted-foreground">No lenders in your network yet.</p>
            </CardContent></Card>
          ) : (
            <ul className="space-y-3 list-none p-0 m-0" aria-label="Filtered lender network">
              {lenders
                .filter((lender: any) => {
                  if (lenderFilters.state && lender.state !== lenderFilters.state) return false;
                  if (lenderFilters.maxLtv && lender.maxLtv && parseFloat(lenderFilters.maxLtv) < lender.maxLtv) return false;
                  if (lenderFilters.propertyType && lenderFilters.propertyType !== "any" && lender.propertyTypes && !lender.propertyTypes.includes(lenderFilters.propertyType)) return false;
                  return true;
                })
                .map((lender: any) => {
                  // Match score 0-100; deterministic per lender (id-based hash) so
                  // the displayed score stays stable across re-renders. The previous
                  // Math.random() implementation flickered on every state change.
                  const idStr = String(lender.id ?? lender.name ?? "");
                  let h = 0;
                  for (let i = 0; i < idStr.length; i++) h = (h * 31 + idStr.charCodeAt(i)) | 0;
                  const matchScore = 60 + Math.abs(h) % 41;
                  return (
                    <li key={lender.id}>
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold">{lender.name}</p>
                                <span
                                  className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${matchScore >= 80 ? 'bg-acr-pos-soft text-acr-pos' : matchScore >= 60 ? 'bg-acr-warn-soft text-acr-warn' : 'bg-muted text-muted-foreground'}`}
                                  aria-label={`Match score ${matchScore} of 100`}
                                >
                                  {matchScore} match
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{lender.lenderType?.replace(/_/g, " ")} · {lender.state ?? "National"}</p>
                              <dl className="flex gap-3 mt-2 text-xs">
                                <div className="flex gap-1">
                                  <dt className="text-muted-foreground">Min:</dt>
                                  <dd className="tabular-nums">{fmt(lender.minLoanAmount ?? 0)}</dd>
                                </div>
                                <div className="flex gap-1">
                                  <dt className="text-muted-foreground">Max:</dt>
                                  <dd className="tabular-nums">{fmt(lender.maxLoanAmount ?? 0)}</dd>
                                </div>
                                <div className="flex gap-1">
                                  <dt className="text-muted-foreground">Rate:</dt>
                                  <dd className="tabular-nums">{lender.minRate ?? "—"}–{lender.maxRate ?? "—"}%</dd>
                                </div>
                              </dl>
                            </div>
                            <Badge variant="outline" aria-label={`Property types: ${lender.propertyTypes?.join(", ") ?? "all"}`}>{lender.propertyTypes?.join(", ") ?? "All"}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
            </ul>
          )}
        </TabsContent>

        {/* Capital Raises */}
        <TabsContent value="raises" className="mt-4">
          {raises.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <DollarSign className="w-12 h-12 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
              <p className="text-muted-foreground">No capital-raise campaigns active.</p>
            </CardContent></Card>
          ) : (
            <ul className="space-y-4 list-none p-0 m-0" aria-label="Active capital-raise campaigns">
              {raises.map((raise: any) => {
                const fundedPct = raise.targetAmount ? Math.min((raise.raisedAmount / raise.targetAmount) * 100, 100) : 0;
                return (
                  <li key={raise.id}>
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold">{raise.name}</p>
                          <Badge variant={raise.status === "active" ? "default" : "secondary"} aria-label={`Status: ${raise.status}`}>{raise.status}</Badge>
                        </div>
                        <dl className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <dt className="text-muted-foreground">Target</dt>
                            <dd className="font-bold tabular-nums">{fmt(raise.targetAmount ?? 0)}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Raised</dt>
                            <dd className="font-bold text-acr-pos tabular-nums">{fmt(raise.raisedAmount ?? 0)}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Investors</dt>
                            <dd className="font-bold tabular-nums">{raise.investorCount ?? 0}</dd>
                          </div>
                        </dl>
                        <div>
                          <Progress
                            value={fundedPct}
                            className="h-2"
                            role="progressbar"
                            aria-valuenow={Math.round(fundedPct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Funding progress for ${raise.name}`}
                          />
                          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                            {raise.targetAmount ? `${fundedPct.toFixed(0)}% funded` : "—"}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        {/* Match Lenders */}
        <TabsContent value="match" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-sm">Find matching lenders</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleMatchSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor={matchAmountId}>Deal amount ($)</Label>
                    <Input
                      id={matchAmountId}
                      type="number"
                      inputMode="numeric"
                      placeholder="500000"
                      value={matchForm.dealAmount}
                      onChange={e => setMatchForm(f => ({ ...f, dealAmount: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor={matchStateId}>State</Label>
                    <Input
                      id={matchStateId}
                      placeholder="TX"
                      maxLength={2}
                      value={matchForm.state}
                      onChange={e => setMatchForm(f => ({ ...f, state: e.target.value.toUpperCase() }))}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <Label htmlFor={matchLtvId}>LTV (%)</Label>
                    <Input
                      id={matchLtvId}
                      type="number"
                      inputMode="numeric"
                      placeholder="65"
                      value={matchForm.ltv}
                      onChange={e => setMatchForm(f => ({ ...f, ltv: e.target.value }))}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={matchMutation.isPending || !matchForm.dealAmount || !matchForm.state || !matchForm.ltv}>
                    <ArrowRight className="w-4 h-4 mr-1" aria-hidden="true" />
                    {matchMutation.isPending ? "Matching…" : "Find lenders"}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <div className="space-y-3">
              {matchResults.length === 0 ? (
                <Card><CardContent className="py-10 text-center">
                  <Building className="w-8 h-8 mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">Enter deal details to find matching lenders.</p>
                </CardContent></Card>
              ) : (
                <ul className="space-y-3 list-none p-0 m-0" aria-label={`${matchResults.length} matching lenders`}>
                  {matchResults.map((l: any, i: number) => (
                    <li key={i}>
                      <Card>
                        <CardContent className="p-4">
                          <p className="font-semibold">{l.name}</p>
                          <div className="flex gap-3 mt-1 text-xs text-muted-foreground tabular-nums">
                            <span>{l.lenderType}</span>
                            <span>{l.minRate}–{l.maxRate}% rate</span>
                            <span>Max {fmt(l.maxLoanAmount ?? 0)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="securitization" className="mt-4">
          <SecuritizationWizard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
