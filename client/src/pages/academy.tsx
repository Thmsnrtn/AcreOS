import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, CheckCircle, Clock, PlayCircle, Zap, Trophy, Flame, Target, Download, Brain, ChevronRight } from 'lucide-react';

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
    label: 'Getting Started',
    description: 'Core concepts every land investor needs before making their first offer.',
  },
  {
    key: 'intermediate',
    label: 'Intermediate Strategies',
    description: 'Level up your deal flow, financing, and market research skills.',
  },
  {
    key: 'advanced',
    label: 'Advanced Tactics',
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
  { id: 'first_complete', label: 'First Step', icon: '🎯', description: 'Complete your first course', threshold: 1 },
  { id: 'halfway', label: 'Halfway There', icon: '⚡', description: 'Complete 50% of courses', threshold: COURSES.length / 2 },
  { id: 'all_beginner', label: 'Land Basics', icon: '🌱', description: 'Complete all beginner courses', threshold: COURSES.filter(c => c.section === 'getting-started').length },
  { id: 'all_courses', label: 'Land Master', icon: '🏆', description: 'Complete all courses', threshold: COURSES.length },
];

function GamificationPanel({ completed }: { completed: Set<string> }) {
  const completedCount = COURSES.filter(c => completed.has(c.id)).length;
  const xpPoints = completedCount * 150 + (COURSES.filter(c => completed.has(c.id) && c.difficulty === 'Advanced').length * 100);
  const streakDays = Math.min(completedCount * 2, 14); // synthetic streak

  const earnedBadges = ACHIEVEMENT_BADGES.filter(b => completedCount >= b.threshold);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-500" /> Progress & Achievements
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-2">
            <p className="text-xl font-bold text-yellow-600">{xpPoints.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">XP Points</p>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-2">
            <div className="flex items-center justify-center gap-1">
              <Flame className="w-4 h-4 text-orange-500" />
              <p className="text-xl font-bold text-orange-600">{streakDays}</p>
            </div>
            <p className="text-xs text-muted-foreground">Day Streak</p>
          </div>
          <div className="bg-primary/10 rounded-lg p-2">
            <p className="text-xl font-bold text-primary">{completedCount}/{COURSES.length}</p>
            <p className="text-xs text-muted-foreground">Courses Done</p>
          </div>
        </div>

        <Progress value={(completedCount / COURSES.length) * 100} className="h-2" />

        {/* Badges */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Achievement Badges</p>
          <div className="flex flex-wrap gap-2">
            {ACHIEVEMENT_BADGES.map(badge => {
              const earned = completedCount >= badge.threshold;
              return (
                <div
                  key={badge.id}
                  title={badge.description}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${earned ? 'border-primary bg-primary/5 text-primary font-medium' : 'border-muted text-muted-foreground opacity-50'}`}
                >
                  <span>{badge.icon}</span>
                  <span>{badge.label}</span>
                </div>
              );
            })}
          </div>
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
          <Target className="w-4 h-4 text-primary" /> Knowledge Gap Analysis
        </CardTitle>
        <CardDescription className="text-xs">Based on your completion progress per track</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {gaps.map(gap => (
          <div key={gap.label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className={gap.pct < 50 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>{gap.label}</span>
              <span>{gap.done}/{gap.total} · {gap.pct}%</span>
            </div>
            <Progress
              value={gap.pct}
              className={`h-1.5 ${gap.pct < 50 ? '[&>div]:bg-red-500' : gap.pct < 80 ? '[&>div]:bg-yellow-500' : ''}`}
            />
          </div>
        ))}
        {weakAreas.length > 0 ? (
          <div className="text-xs text-muted-foreground bg-red-50 dark:bg-red-900/20 rounded p-2">
            Focus areas: <strong>{weakAreas.map(w => w.label).join(', ')}</strong>
          </div>
        ) : (
          <div className="text-xs text-green-700 bg-green-50 dark:bg-green-900/20 rounded p-2">
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
          <Brain className="w-4 h-4 text-primary" /> Your Next Recommended Module
        </CardTitle>
        <CardDescription className="text-xs">AI-curated based on your learning progress and goals</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="flex-1">
          <p className="font-semibold text-sm">{nextCourse.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{nextCourse.description}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary" className={`text-xs ${DIFFICULTY_COLORS[nextCourse.difficulty]}`}>
              {nextCourse.difficulty}
            </Badge>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />{nextCourse.estimatedTime}
            </span>
          </div>
        </div>
        <Button size="sm" onClick={() => onStart(nextCourse)}>
          Start <ChevronRight className="w-3.5 h-3.5 ml-1" />
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" /> AI Tutor Profile
        </CardTitle>
        <CardDescription className="text-xs">Personalization settings for your learning experience</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <div>
              <span className="text-xs text-muted-foreground">Learning Goal</span>
              <p className="font-medium">{goal}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Learning Style</span>
              <p className="capitalize font-medium">{style}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </Button>
        </div>
        {editing && (
          <div className="space-y-2 pt-1 border-t">
            <div>
              <label className="text-xs text-muted-foreground">Goal</label>
              <input
                className="w-full text-sm border rounded px-2 py-1 mt-0.5 bg-background"
                value={goal}
                onChange={e => setGoal(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {['visual', 'reading', 'hands-on', 'mixed'].map(s => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`text-xs px-2 py-0.5 rounded border capitalize ${style === s ? 'bg-primary text-white border-primary' : 'border-muted'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AcademyPage() {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);

  // Hydrate from localStorage on mount
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
          <BookOpen className="w-7 h-7 text-primary" />
          <h1 className="text-3xl font-bold">AcreOS Academy</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Master land investing with AI-powered learning
        </p>
        <p className="text-xs text-muted-foreground">
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
        return (
          <section key={section.key} className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">{section.label}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{section.description}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sectionCourses.map((course) => {
                const isDone = completed.has(course.id);
                return (
                  <Card
                    key={course.id}
                    className={`relative flex flex-col transition-shadow hover:shadow-md ${isDone ? 'border-emerald-300 dark:border-emerald-700' : ''}`}
                  >
                    {isDone && (
                      <div className="absolute top-3 right-3">
                        <CheckCircle className="w-5 h-5 text-emerald-500" />
                      </div>
                    )}
                    <CardHeader className="pb-2 pr-10">
                      <div className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className={`text-xs shrink-0 ${DIFFICULTY_COLORS[course.difficulty]}`}
                        >
                          {course.difficulty}
                        </Badge>
                      </div>
                      <CardTitle className="text-base mt-2 leading-snug">{course.title}</CardTitle>
                      <CardDescription className="text-xs mt-1">{course.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 pt-0 mt-auto">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {course.estimatedTime}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 text-xs"
                          variant={isDone ? 'outline' : 'default'}
                          onClick={() => handleStart(course)}
                        >
                          <PlayCircle className="w-3.5 h-3.5 mr-1.5" />
                          {isDone ? 'Review' : 'Start'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`text-xs px-2 ${isDone ? 'text-emerald-600' : 'text-muted-foreground'}`}
                          onClick={() => handleMarkComplete(course.id)}
                          title={isDone ? 'Mark incomplete' : 'Mark complete'}
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
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
            <p className="text-sm font-medium">What you'll learn:</p>
            <ul className="space-y-2">
              {activeCourse?.outline.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 font-medium">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{point}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-2 mt-4 flex-wrap">
            <Button
              className="flex-1"
              onClick={() => {
                if (activeCourse) handleMarkComplete(activeCourse.id);
                setActiveCourse(null);
              }}
            >
              {activeCourse && completed.has(activeCourse.id)
                ? 'Mark Incomplete'
                : 'Mark as Complete'}
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
              >
                <Download className="w-3.5 h-3.5 mr-1.5" /> Certificate
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
