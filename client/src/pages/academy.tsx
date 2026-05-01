import { useId, useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookOpen, CheckCircle, Clock, PlayCircle, Zap, Flame, Target, Download, Brain, ChevronRight } from 'lucide-react';
import { useDocumentTitle } from "@/hooks/use-document-title";

// ─── Course Data ──────────────────────────────────────────────────────────────

interface Course {
  id: string;
  title: string;
  description: string;
  estimatedTime: string; // e.g. "25 min"
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  section: 'getting-started' | 'intermediate' | 'advanced';
  outline: string[]; // 3-5 bullet points
}

const COURSES: Course[] = [
  // Getting Started
  {
    id: 'mao-basics',
    title: 'Understanding MAO (Maximum Allowable Offer)',
    description: 'Learn how to calculate the most you can pay for raw land and still profit.',
    estimatedTime: '20 min',
    difficulty: 'Beginner',
    section: 'getting-started',
    outline: [
      'What MAO means and why it protects your margins',
      'The land-specific MAO formula: ARV minus rehab, holding costs, and profit',
      'How to estimate ARV for vacant land without comparable sales',
      'Common MAO mistakes that kill deals',
      'Hands-on: calculating MAO on a real sample parcel',
    ],
  },
  {
    id: 'mail-campaign',
    title: 'Building Your First Mail Campaign',
    description: 'Step-by-step guide to sending your first direct mail piece to motivated land sellers.',
    estimatedTime: '30 min',
    difficulty: 'Beginner',
    section: 'getting-started',
    outline: [
      'Choosing a target county: population trends, tax delinquency rates, and demand signals',
      'Sourcing your first list from the county assessor or a data provider',
      'Writing a simple, effective offer letter (template included)',
      'Print vs. postcard: cost breakdown and response rate comparison',
      'Tracking inbound calls and managing response chaos',
    ],
  },
  {
    id: 'due-diligence',
    title: 'Due Diligence Checklist for Raw Land',
    description: 'Everything you need to verify before closing on a vacant land parcel.',
    estimatedTime: '35 min',
    difficulty: 'Beginner',
    section: 'getting-started',
    outline: [
      'Title search basics: liens, back taxes, and encumbrances',
      'Zoning and land use: what you can and cannot build',
      'Access: deeded road access vs. prescriptive easements',
      'Utilities and soil: perc tests, well permits, and utility hookups',
      'Environmental red flags: wetlands, flood zones, and superfund sites',
    ],
  },
  // Intermediate
  {
    id: 'owner-financing',
    title: 'Owner Financing Basics',
    description: 'How to sell land on terms, collect monthly payments, and create passive income.',
    estimatedTime: '40 min',
    difficulty: 'Intermediate',
    section: 'intermediate',
    outline: [
      'Why owner financing beats cash sales for long-term wealth',
      'Setting the right price, down payment, interest rate, and term length',
      'Drafting a simple land contract or deed of trust',
      'Servicing payments: manual vs. loan servicing companies',
      'What happens when a buyer defaults — and how to handle it',
    ],
  },
  {
    id: 'gis-maps',
    title: 'Reading County GIS Maps',
    description: 'Use free government mapping tools to evaluate any parcel like a pro.',
    estimatedTime: '25 min',
    difficulty: 'Intermediate',
    section: 'intermediate',
    outline: [
      'Finding your county GIS portal and navigating the interface',
      'Identifying parcel boundaries, acreage, and ownership history',
      'Overlaying flood zone, wetland, and zoning layers',
      'Measuring road frontage and checking access points',
      'Exporting parcel data to build a targeted mail list',
    ],
  },
  {
    id: 'tax-delinquent',
    title: 'Tax Delinquent List Strategy',
    description: 'Tap into county tax delinquent records to find highly motivated sellers.',
    estimatedTime: '30 min',
    difficulty: 'Intermediate',
    section: 'intermediate',
    outline: [
      'How to request the delinquent tax list from the county treasurer',
      'Filtering the list: years delinquent, parcel size, and location',
      'Skip tracing owners who have moved or are hard to reach',
      'Crafting a letter that speaks to the seller\'s urgency',
      'Timing your outreach around tax sale deadlines for maximum response',
    ],
  },
  // Advanced
  {
    id: 'negotiation',
    title: 'Negotiating with Motivated Sellers',
    description: 'Scripts, psychology, and tactics to close more deals at lower prices.',
    estimatedTime: '45 min',
    difficulty: 'Advanced',
    section: 'advanced',
    outline: [
      'The motivated seller profile: who sells cheap and why',
      'Inbound call script: building rapport before quoting a price',
      'Price anchoring and bracketing to land below your MAO',
      'Handling common objections: "I need more," "My neighbor got $X," and "Let me think about it"',
      'When to walk away — and how to leave the door open for follow-up',
    ],
  },
  {
    id: 'buyers-list',
    title: 'Building a Buyers List',
    description: 'Create a reliable pool of cash buyers so you can flip land fast.',
    estimatedTime: '35 min',
    difficulty: 'Advanced',
    section: 'advanced',
    outline: [
      'Why your buyers list is your most valuable business asset',
      'Where to find land buyers: Facebook groups, Craigslist, land forums, and local investors',
      'Qualifying buyers: cash-only, geography, lot size preferences',
      'Your first deal blast: how to present a property to your list',
      'Automating follow-up and keeping your list warm between deals',
    ],
  },
];

const SECTIONS: { key: Course['section']; label: string; description: string }[] = [
  {
    key: 'getting-started',
    label: 'Getting started',
    description: 'Core concepts every land investor needs before making their first offer.',
  },
  {
    key: 'intermediate',
    label: 'Intermediate strategies',
    description: 'Level up your deal flow, financing, and market research skills.',
  },
  {
    key: 'advanced',
    label: 'Advanced tactics',
    description: 'High-leverage tactics used by full-time land investors.',
  },
];

const DIFFICULTY_COLORS: Record<Course['difficulty'], string> = {
  Beginner: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Advanced: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

// ─── localStorage Progress Tracking ──────────────────────────────────────────

const STORAGE_KEY = 'acreos_academy_completed';

function getCompleted(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function toggleCompleted(courseId: string): Set<string> {
  const current = getCompleted();
  if (current.has(courseId)) {
    current.delete(courseId);
  } else {
    current.add(courseId);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...current]));
  } catch {
    // localStorage full — ignore
  }
  return new Set(current);
}

// ─── Gamification Panel ───────────────────────────────────────────────────────

const ACHIEVEMENT_BADGES = [
  { id: 'first_complete', label: 'First step', icon: '🎯', description: 'Complete your first course', threshold: 1 },
  { id: 'halfway', label: 'Halfway there', icon: '⚡', description: 'Complete 50% of courses', threshold: COURSES.length / 2 },
  { id: 'all_beginner', label: 'Land basics', icon: '🌱', description: 'Complete all beginner courses', threshold: COURSES.filter(c => c.section === 'getting-started').length },
  { id: 'all_courses', label: 'Land master', icon: '🏆', description: 'Complete all courses', threshold: COURSES.length },
];

function GamificationPanel({ completed }: { completed: Set<string> }) {
  const completedCount = COURSES.filter(c => completed.has(c.id)).length;
  const xpPoints = completedCount * 150 + (COURSES.filter(c => completed.has(c.id) && c.difficulty === 'Advanced').length * 100);
  const streakDays = Math.min(completedCount * 2, 14);
  const overallPct = Math.round((completedCount / COURSES.length) * 100);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-500" aria-hidden="true" /> Progress &amp; achievements
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-2">
            <dd className="text-xl font-bold text-yellow-600 tabular-nums">{xpPoints.toLocaleString()}</dd>
            <dt className="text-xs text-muted-foreground">XP points</dt>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-2">
            <dd className="flex items-center justify-center gap-1">
              <Flame className="w-4 h-4 text-orange-500" aria-hidden="true" />
              <span className="text-xl font-bold text-orange-600 tabular-nums">{streakDays}</span>
            </dd>
            <dt className="text-xs text-muted-foreground">Day streak</dt>
          </div>
          <div className="bg-primary/10 rounded-lg p-2">
            <dd className="text-xl font-bold text-primary tabular-nums">{completedCount}/{COURSES.length}</dd>
            <dt className="text-xs text-muted-foreground">Courses done</dt>
          </div>
        </dl>

        <Progress
          value={overallPct}
          className="h-2"
          role="progressbar"
          aria-valuenow={overallPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Overall academy progress: ${overallPct} percent (${completedCount} of ${COURSES.length} courses)`}
        />

        <div>
          <p id="achievement-badges-label" className="text-xs font-medium text-muted-foreground mb-2">Achievement badges</p>
          <ul className="flex flex-wrap gap-2 list-none p-0 m-0" aria-labelledby="achievement-badges-label">
            {ACHIEVEMENT_BADGES.map(badge => {
              const earned = completedCount >= badge.threshold;
              return (
                <li
                  key={badge.id}
                  title={badge.description}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${earned ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-muted text-muted-foreground opacity-50'}`}
                  aria-label={`${earned ? "Earned" : "Locked"}: ${badge.label} — ${badge.description}`}
                >
                  <span aria-hidden="true">{badge.icon}</span>
                  <span>{badge.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Knowledge Gap Analysis ───────────────────────────────────────────────────

function KnowledgeGapPanel({ completed }: { completed: Set<string> }) {
  const gaps = SECTIONS.map(section => {
    const sectionCourses = COURSES.filter(c => c.section === section.key);
    const completedInSection = sectionCourses.filter(c => completed.has(c.id)).length;
    const pct = Math.round((completedInSection / sectionCourses.length) * 100);
    return { label: section.label, pct, total: sectionCourses.length, done: completedInSection };
  });

  const weakAreas = gaps.filter(g => g.pct < 50);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" aria-hidden="true" /> Knowledge gap analysis
        </CardTitle>
        <CardDescription className="text-xs">Based on your completion progress per track</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-3 list-none p-0 m-0" aria-label="Completion progress by track">
          {gaps.map(gap => (
            <li key={gap.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className={gap.pct < 50 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>{gap.label}</span>
                <span className="tabular-nums">{gap.done}/{gap.total} · {gap.pct}%</span>
              </div>
              <Progress
                value={gap.pct}
                className={`h-1.5 ${gap.pct < 50 ? '[&>div]:bg-red-500' : gap.pct < 80 ? '[&>div]:bg-yellow-500' : ''}`}
                role="progressbar"
                aria-valuenow={gap.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${gap.label} track: ${gap.done} of ${gap.total} courses complete${gap.pct < 50 ? ' — focus area' : ''}`}
              />
            </li>
          ))}
        </ul>
        {weakAreas.length > 0 ? (
          <div className="text-xs text-muted-foreground bg-red-50 dark:bg-red-900/20 rounded p-2" role="status">
            Focus areas: <strong>{weakAreas.map(w => w.label).join(', ')}</strong>
          </div>
        ) : (
          <div className="text-xs text-green-700 bg-green-50 dark:bg-green-900/20 rounded p-2" role="status">
            Great progress! No critical knowledge gaps detected.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Personalized Learning Path ───────────────────────────────────────────────

function LearningPathPanel({ completed, onStart }: { completed: Set<string>; onStart: (c: Course) => void }) {
  const nextCourse = COURSES.find(c => !completed.has(c.id));
  if (!nextCourse) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" aria-hidden="true" /> Your next recommended module
        </CardTitle>
        <CardDescription className="text-xs">AI-curated based on your learning progress and goals</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="flex-1">
          <p className="font-semibold text-sm">{nextCourse.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{nextCourse.description}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant="secondary"
              className={`text-xs ${DIFFICULTY_COLORS[nextCourse.difficulty]}`}
              aria-label={`Difficulty: ${nextCourse.difficulty}`}
            >
              {nextCourse.difficulty}
            </Badge>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" aria-hidden="true" />{nextCourse.estimatedTime}
            </span>
          </div>
        </div>
        <Button size="sm" onClick={() => onStart(nextCourse)} aria-label={`Start course: ${nextCourse.title}`}>
          Start <ChevronRight className="w-3.5 h-3.5 ml-1" aria-hidden="true" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── AI Tutor Profile ─────────────────────────────────────────────────────────

function AiTutorProfile() {
  const [goal, setGoal] = useState('Build passive income through owner financing');
  const [style, setStyle] = useState('visual');
  const [editing, setEditing] = useState(false);
  const goalId = useId();
  const styleLegendId = useId();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" aria-hidden="true" /> AI tutor profile
        </CardTitle>
        <CardDescription className="text-xs">Personalization settings for your learning experience</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-start justify-between">
          <dl className="space-y-1 flex-1">
            <div>
              <dt className="text-xs text-muted-foreground">Learning goal</dt>
              <dd className="font-medium">{goal}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Learning style</dt>
              <dd className="capitalize font-medium">{style}</dd>
            </div>
          </dl>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
            aria-label={editing ? "Done editing tutor profile" : "Edit tutor profile"}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        </div>
        {editing && (
          <div className="space-y-2 pt-1 border-t">
            <div>
              <Label htmlFor={goalId} className="text-xs text-muted-foreground">Goal</Label>
              <Input
                id={goalId}
                className="text-sm mt-0.5"
                value={goal}
                onChange={e => setGoal(e.target.value)}
                autoCapitalize="sentences"
              />
            </div>
            <fieldset className="space-y-1">
              <legend id={styleLegendId} className="text-xs text-muted-foreground">Learning style</legend>
              <div className="flex gap-2 flex-wrap" role="group" aria-labelledby={styleLegendId}>
                {['visual', 'reading', 'hands-on', 'mixed'].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStyle(s)}
                    aria-pressed={style === s}
                    aria-label={`Learning style: ${s}`}
                    className={`text-xs px-2 py-0.5 rounded border capitalize ${style === s ? 'bg-primary text-white border-primary' : 'border-muted'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AcademyPage() {
  useDocumentTitle("Academy");
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);

  useEffect(() => {
    setCompleted(getCompleted());
  }, []);

  function handleStart(course: Course) {
    setActiveCourse(course);
  }

  function handleMarkComplete(courseId: string) {
    setCompleted(toggleCompleted(courseId));
  }

  const completedCount = COURSES.filter((c) => completed.has(c.id)).length;

  return (
    <div className="container mx-auto p-6 space-y-10 max-w-5xl">
      {/* Page Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-primary" aria-hidden="true" />
          <h1 className="text-3xl font-bold">AcreOS Academy</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Master land investing — guided, with the platform alongside you
        </p>
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {completedCount} of {COURSES.length} courses completed
        </p>
      </div>

      {/* Gamification + Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GamificationPanel completed={completed} />
        <KnowledgeGapPanel completed={completed} />
      </div>

      <LearningPathPanel completed={completed} onStart={handleStart} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AiTutorProfile />
      </div>

      {/* Sections */}
      {SECTIONS.map((section) => {
        const sectionCourses = COURSES.filter((c) => c.section === section.key);
        const sectionHeadingId = `section-${section.key}-heading`;
        return (
          <section key={section.key} className="space-y-4" aria-labelledby={sectionHeadingId}>
            <div>
              <h2 id={sectionHeadingId} className="text-xl font-semibold">{section.label}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{section.description}</p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 list-none p-0 m-0">
              {sectionCourses.map((course) => {
                const isDone = completed.has(course.id);
                return (
                  <li key={course.id}>
                    <Card
                      className={`relative flex flex-col transition-shadow hover:shadow-md h-full ${isDone ? 'border-emerald-300 dark:border-emerald-700' : ''}`}
                    >
                      {isDone && (
                        <div className="absolute top-3 right-3" role="img" aria-label="Course completed">
                          <CheckCircle className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                        </div>
                      )}
                      <CardHeader className="pb-2 pr-10">
                        <div className="flex items-start gap-2">
                          <Badge
                            variant="secondary"
                            className={`text-xs shrink-0 ${DIFFICULTY_COLORS[course.difficulty]}`}
                            aria-label={`Difficulty: ${course.difficulty}`}
                          >
                            {course.difficulty}
                          </Badge>
                        </div>
                        <CardTitle className="text-base mt-2 leading-snug">{course.title}</CardTitle>
                        <CardDescription className="text-xs mt-1">{course.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3 pt-0 mt-auto">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          <span aria-label={`Estimated time: ${course.estimatedTime}`}>{course.estimatedTime}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="flex-1 text-xs"
                            variant={isDone ? 'outline' : 'default'}
                            onClick={() => handleStart(course)}
                            aria-label={`${isDone ? "Review" : "Start"} course: ${course.title}`}
                          >
                            <PlayCircle className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                            {isDone ? 'Review' : 'Start'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={`text-xs px-2 ${isDone ? 'text-emerald-600' : 'text-muted-foreground'}`}
                            onClick={() => handleMarkComplete(course.id)}
                            aria-pressed={isDone}
                            aria-label={`${isDone ? 'Mark incomplete' : 'Mark complete'}: ${course.title}`}
                          >
                            <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {/* Course Outline Dialog */}
      <Dialog open={!!activeCourse} onOpenChange={(open) => { if (!open) setActiveCourse(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              {activeCourse && (
                <Badge
                  variant="secondary"
                  className={`text-xs ${DIFFICULTY_COLORS[activeCourse.difficulty]}`}
                >
                  {activeCourse.difficulty}
                </Badge>
              )}
              {activeCourse && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {activeCourse.estimatedTime}
                </span>
              )}
            </div>
            <DialogTitle className="text-lg leading-snug">
              {activeCourse?.title}
            </DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">{activeCourse?.description}</p>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <p id="course-outline-label" className="text-sm font-medium">What you&apos;ll learn:</p>
            <ol className="space-y-2 list-none p-0 m-0" aria-labelledby="course-outline-label">
              {activeCourse?.outline.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 font-medium tabular-nums"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{point}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex gap-2 mt-4 flex-wrap">
            <Button
              className="flex-1"
              onClick={() => {
                if (activeCourse) handleMarkComplete(activeCourse.id);
                setActiveCourse(null);
              }}
              aria-label={
                activeCourse && completed.has(activeCourse.id)
                  ? `Mark incomplete: ${activeCourse.title}`
                  : activeCourse
                  ? `Mark as complete: ${activeCourse.title}`
                  : undefined
              }
            >
              {activeCourse && completed.has(activeCourse.id)
                ? 'Mark incomplete'
                : 'Mark as complete'}
            </Button>
            {activeCourse && completed.has(activeCourse.id) && (
              <Button
                variant="outline"
                onClick={() => {
                  const certText = `AcreOS Academy Certificate of Completion\n\nThis certifies that you have completed:\n${activeCourse?.title}\n\nDifficulty: ${activeCourse?.difficulty}\nDate: ${new Date().toLocaleDateString()}`;
                  const blob = new Blob([certText], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `certificate-${activeCourse?.id}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                aria-label={`Download certificate of completion for ${activeCourse.title}`}
              >
                <Download className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Certificate
              </Button>
            )}
            <Button variant="outline" onClick={() => setActiveCourse(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
