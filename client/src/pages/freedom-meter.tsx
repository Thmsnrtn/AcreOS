import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Target, DollarSign, TrendingUp, Zap, Star, Clock, Award,
  Edit3, Save, ChevronRight, Info, CheckCircle, Lock,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
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
  podolskyInsight: string; // Rotating wisdom
}

// ─── Wisdom Engine ───────────────────────────────────────────────────────────

const LAND_GEEK_WISDOM = [
  "\"The goal isn't to flip more land — it's to collect enough notes that work feels optional.\" — Land Geek philosophy",
  "\"One deal financed at 9% for 84 months turns a $10K buy into $40K+ collected over time. That's the compounding power of the land note model.\"",
  "\"Your down payment recoups your acquisition cost on day one. Every monthly payment after that is pure passive income.\"",
  "\"When your note income exceeds your fixed expenses, you've achieved financial freedom. Not when you have a million dollars in the bank — when you have cash flowing every month.\"",
  "\"The beauty of land notes is the default: if the buyer stops paying, you keep the down payment, the payments made, AND get the land back. Defaults are almost painless.\"",
  "\"Diversify across counties and states. A drought in Texas doesn't affect your Arizona notes. Geographic diversification is risk management.\"",
  "\"The most dangerous thing a land investor can do is sell everything for cash and spend it. Let the notes compound. Reinvest the cash flips into more acquisitions.\"",
  "\"Land notes are the closest thing to a subscription business in real estate: one acquisition, then monthly recurring revenue for 84 months with zero tenant calls.\"",
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
      <div className="relative" style={{ width: radius * 2, height: radius * 2 }}>
        <svg height={radius * 2} width={radius * 2}>
          {/* Background ring */}
          <circle
            stroke="#e5e7eb"
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
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black" style={{ color }}>{fmtPct(score)}</span>
          <span className="text-xs font-bold tracking-widest" style={{ color }}>{label}</span>
        </div>
      </div>
      <div className="text-center text-sm text-muted-foreground">
        <div>{fmt(monthlyIncome)}/mo income ÷ {fmt(monthlyExpenses)}/mo expenses</div>
      </div>
    </div>
  );
}

function NoteCard({ note }: { note: NotePayment }) {
  const statusColor = note.status === "current"
    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
    : note.status === "late"
    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";

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
          <Badge className={statusColor}>{note.status}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
          <div>
            <p className="text-muted-foreground text-xs">Monthly Payment</p>
            <p className="font-bold text-green-600">{fmt(note.monthlyPayment)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Balance Remaining</p>
            <p className="font-semibold">{fmt(note.totalBalance)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Months Left</p>
            <p className="font-semibold">{note.remainingMonths}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Interest Rate</p>
            <p className="font-semibold">{note.interestRate}%</p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Note progress</span>
            <span>{progressPct}% paid</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>
      </CardContent>
    </Card>
  );
}

function MilestoneCard({ milestone }: {
  milestone: FreedomSnapshot["milestones"][0];
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${milestone.achieved ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/10" : "border-border bg-muted/30"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${milestone.achieved ? "bg-green-100 text-green-600 dark:bg-green-900/30" : "bg-muted text-muted-foreground"}`}>
        {milestone.achieved ? <CheckCircle className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${milestone.achieved ? "text-green-700 dark:text-green-400" : "text-foreground"}`}>
          {milestone.label}
        </p>
        <p className="text-xs text-muted-foreground">{fmt(milestone.targetMonthly)}/month</p>
      </div>
      {milestone.achieved && milestone.achievedDate && (
        <p className="text-xs text-green-600 dark:text-green-400 flex-shrink-0">
          ✓ {new Date(milestone.achievedDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
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

  const wisdom = LAND_GEEK_WISDOM[Math.floor(Date.now() / 86400000) % LAND_GEEK_WISDOM.length];

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
    podolskyInsight: wisdom,
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FreedomMeterPage() {
  const { toast } = useToast();
  const [monthlyExpenses, setMonthlyExpenses] = useState(4500);
  const [editingExpenses, setEditingExpenses] = useState(false);
  const [expenseInput, setExpenseInput] = useState("4500");
  const [activeTab, setActiveTab] = useState<"overview" | "notes" | "milestones" | "projection">("overview");

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
    if (isNaN(val) || val < 0) return;
    setMonthlyExpenses(val);
    setEditingExpenses(false);
    toast({ title: "Monthly expenses updated" });
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
    <PageShell>
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Freedom Meter</h1>
        <p className="text-muted-foreground text-sm md:text-base">Track your journey from trading time for money to true passive income freedom through your land note portfolio</p>
      </div>

      {/* Top wisdom bar */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10 p-4 mb-6">
        <div className="flex gap-3 items-start">
          <Star className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300 italic">{data.podolskyInsight}</p>
        </div>
      </div>

      {/* Expenses editor */}
      <div className="mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">Your Monthly Fixed Expenses</p>
                <p className="text-xs text-muted-foreground">Rent, food, utilities, car, insurance — your baseline to achieve freedom</p>
              </div>
              {editingExpenses ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    value={expenseInput}
                    onChange={e => setExpenseInput(e.target.value)}
                    className="w-28 text-right"
                    autoFocus
                    onKeyDown={e => e.key === "Enter" && saveExpenses()}
                  />
                  <Button size="sm" onClick={saveExpenses}><Save className="w-3 h-3" /></Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold">{fmt(monthlyExpenses)}/mo</span>
                  <Button variant="ghost" size="icon" onClick={() => { setEditingExpenses(true); setExpenseInput(String(monthlyExpenses)); }}>
                    <Edit3 className="w-4 h-4" />
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

        <div className="md:col-span-2 grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Monthly Note Income</p>
              </div>
              <p className="text-3xl font-black text-green-600 dark:text-green-400">{fmt(data.totalMonthlyNoteIncome)}</p>
              <p className="text-xs text-muted-foreground mt-1">{data.activeNotes.filter(n => n.status === "current").length} active notes</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Target className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Portfolio Value</p>
              </div>
              <p className="text-3xl font-black">{fmt(data.portfolioValue)}</p>
              <p className="text-xs text-muted-foreground mt-1">Outstanding principal across all notes</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Freedom Date</p>
              </div>
              {data.projectedFreedomDate ? (
                <>
                  <p className="text-xl font-black text-purple-600 dark:text-purple-400">{data.projectedFreedomDate}</p>
                  <p className="text-xs text-muted-foreground mt-1">{data.monthsUntilFreedom} months away</p>
                </>
              ) : (
                <p className="text-xl font-black text-green-600">Already Free!</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Monthly Surplus / Gap</p>
              </div>
              {data.totalMonthlyNoteIncome >= data.totalMonthlyExpenses ? (
                <>
                  <p className="text-3xl font-black text-green-600">+{fmt(data.totalMonthlyNoteIncome - data.totalMonthlyExpenses)}</p>
                  <p className="text-xs text-green-600 mt-1">Passive surplus each month</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-black text-orange-500">-{fmt(data.totalMonthlyExpenses - data.totalMonthlyNoteIncome)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Still needed to reach freedom</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {([
          ["overview", "Progress Chart"],
          ["notes", "Active Notes"],
          ["milestones", "Milestones"],
          ["projection", "Freedom Projection"],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Note Income vs. Monthly Expenses — 12 Month History</CardTitle>
            <CardDescription>Track your progress toward the day note income exceeds your fixed expenses</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.historicalProgress}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v/1000).toFixed(1)}K`} />
                <Tooltip formatter={(v: number) => [`$${Math.round(v).toLocaleString()}`, ""]} />
                <ReferenceLine y={data.totalMonthlyExpenses} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Freedom Line", position: "right", fontSize: 11, fill: "#ef4444" }} />
                <Area type="monotone" dataKey="noteIncome" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name="Note Income" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {activeTab === "notes" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Active Seller-Financed Notes</h3>
            {data.notesAtRisk > 0 && (
              <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                {data.notesAtRisk} at risk
              </Badge>
            )}
          </div>
          {data.activeNotes.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-semibold mb-1">No active notes yet</p>
                <p className="text-sm">Close your first owner-financed deal and it will appear here. That first monthly payment is the start of your passive income portfolio.</p>
                <Button className="mt-4" onClick={() => window.location.href = "/blind-offer-wizard"}>
                  Find Your First Deal <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.activeNotes.map(note => (
                <NoteCard key={note.noteId} note={note} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "milestones" && (
        <div>
          <div className="mb-4">
            <h3 className="font-semibold">Freedom Milestones</h3>
            <p className="text-sm text-muted-foreground">Progress through each milestone as you add notes to your portfolio</p>
          </div>
          <div className="space-y-3">
            {data.milestones.map((m, i) => (
              <MilestoneCard key={i} milestone={m} />
            ))}
          </div>
          <div className="mt-6 p-4 rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/10">
            <div className="flex gap-3">
              <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-800 dark:text-blue-300">
                <p className="font-semibold mb-1">The Milestone Strategy</p>
                <p>Each milestone represents a real life expense covered by passive note income. When your notes cover groceries, you're partially free. When they cover rent, you're mostly free. When they exceed all expenses, work becomes optional — you do it because you want to, not because you have to.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "projection" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">36-Month Freedom Projection</CardTitle>
            <CardDescription>
              Based on adding ~1 owner-financed note every 2 months at $329/month average
              {freedomMonth && ` — projected freedom in ${freedomMonth.month}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={projectionData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={5} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v/1000).toFixed(1)}K`} />
                <Tooltip formatter={(v: number) => [`$${Math.round(v).toLocaleString()}`, ""]} />
                <ReferenceLine y={data.totalMonthlyExpenses} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Freedom Line", position: "right", fontSize: 11, fill: "#ef4444" }} />
                {freedomMonth && (
                  <ReferenceLine x={freedomMonth.month} stroke="#10b981" strokeDasharray="4 4" label={{ value: "Freedom!", position: "top", fontSize: 11, fill: "#10b981" }} />
                )}
                <Area type="monotone" dataKey="noteIncome" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} name="Projected Note Income" strokeWidth={2} />
                <Area type="monotone" dataKey="expenses" stroke="#ef4444" fill="none" name="Fixed Expenses" strokeWidth={2} strokeDasharray="4 4" />
              </AreaChart>
            </ResponsiveContainer>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-1">At 1 note/2 months</p>
                <p className="font-bold">{data.projectedFreedomDate || "Already free"}</p>
                <p className="text-xs text-muted-foreground">Freedom date</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-1">At 1 note/month</p>
                <p className="font-bold">
                  {(() => {
                    const d = new Date();
                    const moNeeded = Math.max(0, data.monthsUntilFreedom ? Math.ceil(data.monthsUntilFreedom / 2) : 0);
                    d.setMonth(d.getMonth() + moNeeded);
                    return moNeeded > 0 ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "Already free";
                  })()}
                </p>
                <p className="text-xs text-muted-foreground">Freedom date (faster)</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-1">Notes still needed</p>
                <p className="font-bold">
                  {data.totalMonthlyNoteIncome >= data.totalMonthlyExpenses ? "0" :
                    Math.ceil((data.totalMonthlyExpenses - data.totalMonthlyNoteIncome) / 329)}
                </p>
                <p className="text-xs text-muted-foreground">At $329/month avg</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CTA */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border border-primary/20 bg-primary/5">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Add Your Next Note</p>
              <p className="text-xs text-muted-foreground">Use the Blind Offer Wizard to find and price your next deal</p>
            </div>
            <Button size="sm" onClick={() => window.location.href = "/blind-offer-wizard"}>
              Start <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </CardContent>
        </Card>
        <Card className="border border-border">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <Award className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Manage Late Payments</p>
              <p className="text-xs text-muted-foreground">Automate dunning sequences and default protocols</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.location.href = "/dunning"}>
              View <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
