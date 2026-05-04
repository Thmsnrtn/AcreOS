import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { chartColor } from "@/lib/chartPalette";
import {
  Target, DollarSign, TrendingUp, Zap, Star, Clock, Award,
  Edit3, Save, ChevronRight, Info, CheckCircle, Lock,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  // Compact display for KPI cards + chart axes. M/K bands round
  // intentionally for screen real estate; sub-$1K falls through to
  // usd() so cents are preserved on note payments + small surplus
  // numbers (a $329 monthly payment shouldn't show as $329 if the
  // underlying value is $329.50).
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return usd(n, { noCents: true });
}

function fmtPct(n: number) { return `${Math.round(n)}%`; }

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotePayment {
  noteId: number;
  propertyName: string;
  monthlyPayment: number;
  remainingMonths: number;
  totalBalance: number;
  nextPaymentDate: string;
  status: "current" | "late" | "defaulted";
  interestRate: number;
  buyer?: string;
}

interface FreedomSnapshot {
  totalMonthlyNoteIncome: number;
  totalMonthlyExpenses: number;
  freedomScore: number; // 0-100+
  activeNotes: NotePayment[];
  monthsUntilFreedom: number | null;
  projectedFreedomDate: string | null;
  portfolioValue: number; // total outstanding principal
  notesAtRisk: number; // late or defaulted
  milestones: {
    label: string;
    targetMonthly: number;
    achieved: boolean;
    achievedDate?: string;
  }[];
  historicalProgress: {
    month: string;
    noteIncome: number;
    expenses: number;
    freedomScore: number;
  }[];
  dailyInsight: string; // Rotating wisdom
}

// ─── Wisdom Engine ───────────────────────────────────────────────────────────

const FREEDOM_WISDOM = [
  "\"The goal isn't to flip more properties — it's to collect enough notes that work feels optional.\"",
  "\"One deal financed at 9% for 84 months turns a $10K buy into $40K+ collected over time. That's the compounding power of the note model.\"",
  "\"Your down payment recoups your acquisition cost on day one. Every monthly payment after that is pure passive income.\"",
  "\"When your note income exceeds your fixed expenses, you've achieved financial freedom. Not when you have a million dollars in the bank — when you have cash flowing every month.\"",
  "\"The beauty of seller-financed notes is the default protection: if the buyer stops paying, you keep the down payment, the payments made, AND get the property back.\"",
  "\"Diversify across counties and states. A drought in one region doesn't affect your notes elsewhere. Geographic diversification is risk management.\"",
  "\"The most important thing a land investor can do is let the notes compound. Reinvest the cash flips into more acquisitions.\"",
  "\"Seller-financed notes are the closest thing to a subscription business in real estate: one acquisition, then monthly recurring revenue with zero tenant calls.\"",
];

// ─── Components ──────────────────────────────────────────────────────────────

function FreedomMeter({ score, monthlyIncome, monthlyExpenses }: {
  score: number;
  monthlyIncome: number;
  monthlyExpenses: number;
}) {
  const clampedScore = Math.min(score, 150);
  const radius = 100;
  const stroke = 16;
  const normalizedRadius = radius - stroke / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const progress = Math.min(clampedScore / 100, 1);
  const strokeDashoffset = circumference - progress * circumference;

  const color = score >= 100 ? "#10b981" : score >= 75 ? "#3b82f6" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 100 ? "FREE" : score >= 75 ? "CLOSE" : score >= 50 ? "GROWING" : "BUILDING";

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative"
        style={{ width: radius * 2, height: radius * 2 }}
        role="img"
        aria-label={`Freedom score: ${fmtPct(score)}, status ${label.toLowerCase()}`}
      >
        <svg height={radius * 2} width={radius * 2} aria-hidden="true">
          {/* Background ring */}
          <circle
            stroke={chartColor(0)}
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          {/* Progress ring */}
          <circle
            stroke={color}
            fill="transparent"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            style={{ strokeDashoffset, transition: "stroke-dashoffset 1s ease", transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
          <span className="text-3xl font-black tabular-nums" style={{ color }}>{fmtPct(score)}</span>
          <span className="text-xs font-bold tracking-widest" style={{ color }}>{label}</span>
        </div>
      </div>
      <div className="text-center text-sm text-muted-foreground">
        <div>
          <span className="tabular-nums">{fmt(monthlyIncome)}</span>/mo income ÷ <span className="tabular-nums">{fmt(monthlyExpenses)}</span>/mo expenses
        </div>
      </div>
    </div>
  );
}

function NoteCard({ note }: { note: NotePayment }) {
  const statusColor = note.status === "current"
    ? "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos"
    : note.status === "late"
    ? "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn"
    : "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg";

  const progressPct = note.remainingMonths > 0
    ? Math.round(((84 - note.remainingMonths) / 84) * 100)
    : 100;

  return (
    <Card className="border border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-semibold text-sm">{note.propertyName}</p>
            {note.buyer && <p className="text-xs text-muted-foreground">Buyer: {note.buyer}</p>}
          </div>
          <Badge className={`${statusColor} capitalize`}>{note.status}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm mb-3">
          <div>
            <dt className="text-muted-foreground text-xs">Monthly payment</dt>
            <dd className="font-bold text-acr-pos tabular-nums">{fmt(note.monthlyPayment)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Balance remaining</dt>
            <dd className="font-semibold tabular-nums">{fmt(note.totalBalance)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Months left</dt>
            <dd className="font-semibold tabular-nums">{note.remainingMonths}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Interest rate</dt>
            <dd className="font-semibold tabular-nums">{note.interestRate}%</dd>
          </div>
        </dl>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Note progress</span>
            <span className="tabular-nums">{progressPct}% paid</span>
          </div>
          <Progress
            value={progressPct}
            className="h-1.5"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${note.propertyName} paid ${progressPct}%`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MilestoneCard({ milestone }: {
  milestone: FreedomSnapshot["milestones"][0];
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${milestone.achieved ? "border-acr-pos-soft bg-acr-pos-soft dark:border-acr-pos-soft dark:bg-acr-pos-soft/10" : "border-border bg-muted/30"}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${milestone.achieved ? "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30" : "bg-muted text-muted-foreground"}`}
        aria-hidden="true"
      >
        {milestone.achieved ? <CheckCircle className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${milestone.achieved ? "text-acr-pos dark:text-acr-pos" : "text-foreground"}`}>
          {milestone.label}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">{fmt(milestone.targetMonthly)}/month</p>
      </div>
      {milestone.achieved && milestone.achievedDate && (
        <p className="text-xs text-acr-pos dark:text-acr-pos flex-shrink-0 tabular-nums">
          <span aria-label="achieved">✓</span> {new Date(milestone.achievedDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
        </p>
      )}
    </div>
  );
}

// ─── Mock data builder for initial display ───────────────────────────────────

function buildMockSnapshot(monthlyExpenses: number): FreedomSnapshot {
  const notes: NotePayment[] = [
    { noteId: 1, propertyName: "Pinal County, AZ — 2.5 acres", monthlyPayment: 329, remainingMonths: 72, totalBalance: 18600, nextPaymentDate: new Date(Date.now() + 15 * 86400000).toISOString(), status: "current", interestRate: 9, buyer: "John D." },
    { noteId: 2, propertyName: "Mohave County, AZ — 5 acres", monthlyPayment: 449, remainingMonths: 60, totalBalance: 22200, nextPaymentDate: new Date(Date.now() + 8 * 86400000).toISOString(), status: "current", interestRate: 9, buyer: "Sarah M." },
    { noteId: 3, propertyName: "San Juan County, NM — 10 acres", monthlyPayment: 219, remainingMonths: 84, totalBalance: 16800, nextPaymentDate: new Date(Date.now() + 22 * 86400000).toISOString(), status: "current", interestRate: 9 },
  ];

  const totalMonthlyNoteIncome = notes.filter(n => n.status === "current").reduce((sum, n) => sum + n.monthlyPayment, 0);
  const freedomScore = monthlyExpenses > 0 ? (totalMonthlyNoteIncome / monthlyExpenses) * 100 : 0;
  const monthlyShortfall = Math.max(0, monthlyExpenses - totalMonthlyNoteIncome);
  const avgNoteMonthly = notes.length > 0 ? totalMonthlyNoteIncome / notes.length : 300;
  const notesNeeded = avgNoteMonthly > 0 ? Math.ceil(monthlyShortfall / avgNoteMonthly) : 0;
  const monthsUntilFreedom = notesNeeded > 0 ? notesNeeded * 2 : null; // ~1 deal every 2 months

  const now = new Date();
  const historical = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const notesActive = Math.max(1, notes.length - Math.floor((11 - i) * 0.2));
    const income = notesActive * avgNoteMonthly * (0.7 + i * 0.03);
    return {
      month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      noteIncome: Math.round(income),
      expenses: monthlyExpenses,
      freedomScore: Math.round((income / monthlyExpenses) * 100),
    };
  });

  const wisdom = FREEDOM_WISDOM[Math.floor(Date.now() / 86400000) % FREEDOM_WISDOM.length];

  return {
    totalMonthlyNoteIncome,
    totalMonthlyExpenses: monthlyExpenses,
    freedomScore,
    activeNotes: notes,
    monthsUntilFreedom,
    projectedFreedomDate: monthsUntilFreedom
      ? new Date(now.getFullYear(), now.getMonth() + monthsUntilFreedom, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : null,
    portfolioValue: notes.reduce((s, n) => s + n.totalBalance, 0),
    notesAtRisk: notes.filter(n => n.status !== "current").length,
    milestones: [
      { label: "First Note", targetMonthly: 300, achieved: totalMonthlyNoteIncome >= 300, achievedDate: "2024-03-01" },
      { label: "Cover Phone/Internet", targetMonthly: 200, achieved: totalMonthlyNoteIncome >= 200, achievedDate: "2024-01-01" },
      { label: "Cover Groceries ($500/mo)", targetMonthly: 500, achieved: totalMonthlyNoteIncome >= 500, achievedDate: "2024-06-01" },
      { label: "Cover Car Payment", targetMonthly: 800, achieved: totalMonthlyNoteIncome >= 800 },
      { label: "Cover Rent/Mortgage", targetMonthly: 2000, achieved: totalMonthlyNoteIncome >= 2000 },
      { label: "Full Expenses Covered", targetMonthly: monthlyExpenses, achieved: totalMonthlyNoteIncome >= monthlyExpenses },
      { label: "2× Monthly Expenses", targetMonthly: monthlyExpenses * 2, achieved: totalMonthlyNoteIncome >= monthlyExpenses * 2 },
    ],
    historicalProgress: historical,
    dailyInsight: wisdom,
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FreedomMeterPage() {
  useDocumentTitle("Freedom meter");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [monthlyExpenses, setMonthlyExpenses] = useState(4500);
  const [editingExpenses, setEditingExpenses] = useState(false);
  const [expenseInput, setExpenseInput] = useState("4500");
  const [activeTab, setActiveTab] = useState<"overview" | "notes" | "milestones" | "projection">("overview");
  const expenseInputId = useId();

  const { data: snapshot } = useQuery<FreedomSnapshot>({
    queryKey: ["/api/data-intel/freedom-snapshot", monthlyExpenses],
    queryFn: () =>
      fetch(`/api/data-intel/freedom-snapshot?expenses=${monthlyExpenses}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    placeholderData: buildMockSnapshot(monthlyExpenses),
  });

  const data = snapshot || buildMockSnapshot(monthlyExpenses);

  function saveExpenses() {
    const val = parseFloat(expenseInput);
    if (isNaN(val) || val < 0) {
      toast({
        title: "Couldn't save expenses",
        description: "Enter a positive number — your previous value is unchanged.",
        variant: "destructive",
      });
      return;
    }
    setMonthlyExpenses(val);
    setEditingExpenses(false);
    toast({ title: "Monthly expenses updated." });
  }

  const projectionData = Array.from({ length: 36 }, (_, i) => {
    const notesAdded = Math.floor(i / 2); // 1 new note every 2 months
    const projectedIncome = data.totalMonthlyNoteIncome + (notesAdded * 329);
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    return {
      month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      noteIncome: Math.round(projectedIncome),
      expenses: data.totalMonthlyExpenses,
      surplus: Math.max(0, projectedIncome - data.totalMonthlyExpenses),
    };
  });

  const freedomMonth = projectionData.find(d => d.noteIncome >= d.expenses);

  return (
    <PageShell label="Freedom meter">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Freedom meter</h1>
        <p className="text-muted-foreground text-sm md:text-base">Track your journey from trading time for money to true passive income freedom through your land note portfolio.</p>
      </div>

      {/* Top wisdom bar */}
      <aside
        aria-label="Daily wisdom"
        className="rounded-xl border border-acr-warn-soft bg-acr-warn-soft dark:border-acr-warn-soft/50 dark:bg-acr-warn-soft/10 p-4 mb-6"
      >
        <div className="flex gap-3 items-start">
          <Star className="w-5 h-5 text-acr-warn mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-acr-warn dark:text-acr-warn italic">{data.dailyInsight}</p>
        </div>
      </aside>

      {/* Expenses editor */}
      <div className="mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor={expenseInputId} className="font-semibold text-sm">Your monthly fixed expenses</Label>
                <p className="text-xs text-muted-foreground">Rent, food, utilities, car, insurance — your baseline to achieve freedom.</p>
              </div>
              {editingExpenses ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => { e.preventDefault(); saveExpenses(); }}
                >
                  <span className="text-muted-foreground" aria-hidden="true">$</span>
                  <Input
                    id={expenseInputId}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={expenseInput}
                    onChange={e => setExpenseInput(e.target.value)}
                    className="w-28 text-right tabular-nums"
                    autoFocus
                    aria-label="Monthly fixed expenses in dollars"
                  />
                  <Button size="sm" type="submit" aria-label="Save expenses" className="min-h-9 min-w-9">
                    <Save className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  <span id={expenseInputId} className="text-2xl font-bold tabular-nums">{fmt(monthlyExpenses)}/mo</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit expenses"
                    onClick={() => { setEditingExpenses(true); setExpenseInput(String(monthlyExpenses)); }}
                    className="min-h-9 min-w-9"
                  >
                    <Edit3 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hero meter */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="md:col-span-1 flex items-center justify-center p-8">
          <FreedomMeter
            score={data.freedomScore}
            monthlyIncome={data.totalMonthlyNoteIncome}
            monthlyExpenses={data.totalMonthlyExpenses}
          />
        </Card>

        <dl className="md:col-span-2 grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-acr-pos-soft dark:bg-acr-pos-soft/30 flex items-center justify-center" aria-hidden="true">
                  <DollarSign className="w-4 h-4 text-acr-pos dark:text-acr-pos" />
                </div>
                <dt className="text-sm font-medium text-muted-foreground">Monthly note income</dt>
              </div>
              <dd className="text-3xl font-black text-acr-pos dark:text-acr-pos tabular-nums">{fmt(data.totalMonthlyNoteIncome)}</dd>
              <p className="text-xs text-muted-foreground mt-1"><span className="tabular-nums">{data.activeNotes.filter(n => n.status === "current").length}</span> active notes</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-acr-accent dark:bg-acr-accent/30 flex items-center justify-center" aria-hidden="true">
                  <Target className="w-4 h-4 text-acr-accent dark:text-acr-accent" />
                </div>
                <dt className="text-sm font-medium text-muted-foreground">Portfolio value</dt>
              </div>
              <dd className="text-3xl font-black tabular-nums">{fmt(data.portfolioValue)}</dd>
              <p className="text-xs text-muted-foreground mt-1">Outstanding principal across all notes</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-acr-brand-soft dark:bg-acr-brand-soft/30 flex items-center justify-center" aria-hidden="true">
                  <Clock className="w-4 h-4 text-acr-brand dark:text-acr-brand" />
                </div>
                <dt className="text-sm font-medium text-muted-foreground">Freedom date</dt>
              </div>
              {data.projectedFreedomDate ? (
                <>
                  <dd className="text-xl font-black text-acr-brand dark:text-acr-brand tabular-nums">{data.projectedFreedomDate}</dd>
                  <p className="text-xs text-muted-foreground mt-1"><span className="tabular-nums">{data.monthsUntilFreedom}</span> months away</p>
                </>
              ) : (
                <dd className="text-xl font-black text-acr-pos">Already free!</dd>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-acr-warn-soft dark:bg-acr-warn-soft/30 flex items-center justify-center" aria-hidden="true">
                  <TrendingUp className="w-4 h-4 text-acr-warn dark:text-acr-warn" />
                </div>
                <dt className="text-sm font-medium text-muted-foreground">Monthly surplus / gap</dt>
              </div>
              {data.totalMonthlyNoteIncome >= data.totalMonthlyExpenses ? (
                <>
                  <dd className="text-3xl font-black text-acr-pos tabular-nums">+{fmt(data.totalMonthlyNoteIncome - data.totalMonthlyExpenses)}</dd>
                  <p className="text-xs text-acr-pos mt-1">Passive surplus each month</p>
                </>
              ) : (
                <>
                  <dd className="text-3xl font-black text-acr-warn tabular-nums">−{fmt(data.totalMonthlyExpenses - data.totalMonthlyNoteIncome)}</dd>
                  <p className="text-xs text-muted-foreground mt-1">Still needed to reach freedom</p>
                </>
              )}
            </CardContent>
          </Card>
        </dl>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1" role="tablist" aria-label="Freedom meter sections">
        {([
          ["overview", "Progress chart"],
          ["notes", "Active notes"],
          ["milestones", "Milestones"],
          ["projection", "Freedom projection"],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Note income vs. monthly expenses — 12-month history</CardTitle>
            <CardDescription>Track your progress toward the day note income exceeds your fixed expenses.</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              role="img"
              aria-label={`12-month note income history vs. ${fmt(data.totalMonthlyExpenses)} monthly expenses freedom line; latest income ${fmt(data.historicalProgress[data.historicalProgress.length - 1]?.noteIncome ?? 0)}`}
            >
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.historicalProgress}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => fmt(v)} />
                  <Tooltip formatter={((v: number) => [usd(v, { noCents: true }), ""]) as any} />
                  <ReferenceLine y={data.totalMonthlyExpenses} stroke={chartColor(1)} strokeDasharray="4 4" label={{ value: "Freedom line", position: "right", fontSize: 11, fill: "#ef4444" }} />
                  <Area type="monotone" dataKey="noteIncome" stroke={chartColor(2)} fill={chartColor(2)} fillOpacity={0.2} name="Note income" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "notes" && (
        <div role="tabpanel">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Active seller-financed notes</h3>
            {data.notesAtRisk > 0 && (
              <Badge className="bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn">
                <span className="tabular-nums mr-1">{data.notesAtRisk}</span> at risk
              </Badge>
            )}
          </div>
          {data.activeNotes.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
                <p className="font-semibold mb-1">No active notes yet.</p>
                <p className="text-sm">Close your first owner-financed deal and it will appear here. That first monthly payment is the start of your passive income portfolio.</p>
                <Button className="mt-4 min-h-11" onClick={() => setLocation("/blind-offer-wizard")}>
                  Find your first deal <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Active seller-financed notes">
              {data.activeNotes.map(note => (
                <li key={note.noteId}>
                  <NoteCard note={note} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === "milestones" && (
        <div role="tabpanel">
          <div className="mb-4">
            <h3 className="font-semibold">Freedom milestones</h3>
            <p className="text-sm text-muted-foreground">Progress through each milestone as you add notes to your portfolio.</p>
          </div>
          <ul className="space-y-3" aria-label="Freedom milestones">
            {data.milestones.map((m, i) => (
              <li key={i}>
                <MilestoneCard milestone={m} />
              </li>
            ))}
          </ul>
          <div className="mt-6 p-4 rounded-xl border border-acr-accent bg-acr-accent dark:border-acr-accent/50 dark:bg-acr-accent/10">
            <div className="flex gap-3">
              <Info className="w-4 h-4 text-acr-accent mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div className="text-sm text-acr-accent dark:text-acr-accent">
                <p className="font-semibold mb-1">The milestone strategy</p>
                <p>Each milestone represents a real life expense covered by passive note income. When your notes cover groceries, you're partially free. When they cover rent, you're mostly free. When they exceed all expenses, work becomes optional — you do it because you want to, not because you have to.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "projection" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">36-month freedom projection</CardTitle>
            <CardDescription>
              Based on adding ~1 owner-financed note every 2 months at $329/month average
              {freedomMonth && ` — projected freedom in ${freedomMonth.month}`}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              role="img"
              aria-label={`36-month freedom projection vs. ${fmt(data.totalMonthlyExpenses)} fixed expenses${freedomMonth ? `; projected freedom in ${freedomMonth.month}` : ""}`}
            >
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={projectionData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={5} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => fmt(v)} />
                  <Tooltip formatter={((v: number) => [usd(v, { noCents: true }), ""]) as any} />
                  <ReferenceLine y={data.totalMonthlyExpenses} stroke={chartColor(1)} strokeDasharray="4 4" label={{ value: "Freedom line", position: "right", fontSize: 11, fill: "#ef4444" }} />
                  {freedomMonth && (
                    <ReferenceLine x={freedomMonth.month} stroke={chartColor(2)} strokeDasharray="4 4" label={{ value: "Freedom!", position: "top", fontSize: 11, fill: "#10b981" }} />
                  )}
                  <Area type="monotone" dataKey="noteIncome" stroke={chartColor(3)} fill={chartColor(3)} fillOpacity={0.15} name="Projected note income" strokeWidth={2} />
                  <Area type="monotone" dataKey="expenses" stroke={chartColor(1)} fill="none" name="Fixed expenses" strokeWidth={2} strokeDasharray="4 4" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <dl className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-muted/40">
                <dt className="text-xs text-muted-foreground mb-1">At 1 note/2 months</dt>
                <dd className="font-bold tabular-nums">{data.projectedFreedomDate || "Already free"}</dd>
                <p className="text-xs text-muted-foreground">Freedom date</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <dt className="text-xs text-muted-foreground mb-1">At 1 note/month</dt>
                <dd className="font-bold tabular-nums">
                  {(() => {
                    const d = new Date();
                    const moNeeded = Math.max(0, data.monthsUntilFreedom ? Math.ceil(data.monthsUntilFreedom / 2) : 0);
                    d.setMonth(d.getMonth() + moNeeded);
                    return moNeeded > 0 ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "Already free";
                  })()}
                </dd>
                <p className="text-xs text-muted-foreground">Freedom date (faster)</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <dt className="text-xs text-muted-foreground mb-1">Notes still needed</dt>
                <dd className="font-bold tabular-nums">
                  {data.totalMonthlyNoteIncome >= data.totalMonthlyExpenses ? "0" :
                    Math.ceil((data.totalMonthlyExpenses - data.totalMonthlyNoteIncome) / 329)}
                </dd>
                <p className="text-xs text-muted-foreground">At $329/month avg</p>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* CTA */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border border-primary/20 bg-primary/5">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0" aria-hidden="true">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Add your next note</p>
              <p className="text-xs text-muted-foreground">Use the Blind Offer Wizard to find and price your next deal.</p>
            </div>
            <Button
              size="sm"
              onClick={() => setLocation("/blind-offer-wizard")}
              className="min-h-9"
              aria-label="Start Blind Offer Wizard"
            >
              Start <ChevronRight className="w-3 h-3 ml-1" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
        <Card className="border border-border">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0" aria-hidden="true">
              <Award className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Manage late payments</p>
              <p className="text-xs text-muted-foreground">Automate dunning sequences and default protocols.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/dunning")}
              className="min-h-9"
              aria-label="Open dunning manager"
            >
              View <ChevronRight className="w-3 h-3 ml-1" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
