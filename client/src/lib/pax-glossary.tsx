/**
 * Loader — the Pax glossary's long copy, served as a static asset.
 *
 * BD-6 (the #524 learn-content pattern): the glossary's data ships as
 * /pax-glossary.json (shared/pax-glossary.json, copied verbatim into the
 * build output by the acreos-pax-glossary vite plugin) instead of riding
 * inside the JS bundle. The synchronous core — labels, standing line,
 * receipt words, settings/rules copy, formatPaxTime — stays bundled in
 * @shared/pax-glossary-core, because shell surfaces print it in their
 * first render. This loader serves the ONE fetch-tolerant consumer, the
 * Settings → Pax page: the page renders its shell (skeleton) first and
 * the copy arrives with the fetch, alongside the controls data the page
 * already waits on.
 *
 * The JSON carries data only. The copy objects whose members are
 * functions (pause lines, page lines, site toasts…) are rebuilt here
 * from that data, body-for-body the functions in shared/pax-glossary.ts;
 * tests/unit/paxGlossaryServedAsData.test.ts pins the rebuilt functions
 * against the module's over a battery of inputs, and pins the JSON
 * deep-equal to the module's data, so neither can drift silently.
 *
 * A failed fetch REJECTS (never resolves empty): the page shows its
 * load-error state with retry, never a half-labelled controls page.
 */

import React from "react";
import { formatPaxTime, PAX_CONTROLS_LABEL, PAX_LABELS } from "@shared/pax-glossary-core";
import type {
  PAX_FIXED_RULES as FixedRulesType,
  PAX_GROUP_COPY as GroupCopyType,
  PAX_LIMIT_COPY as LimitCopyType,
  PAX_MY_SITES_COPY as MySitesCopyType,
  PAX_NEVER_LIST as NeverListType,
  PAX_PAGE_COPY as PageCopyType,
  PAX_PAUSE_COPY as PauseCopyType,
  PAX_PAUSE_OPTIONS as PauseOptionsType,
  PAX_RAIL_COPY as RailCopyType,
  PAX_STANCE_COPY as StanceCopyType,
  PaxPauseOption as PaxPauseOptionType,
} from "@shared/pax-glossary";

export const PAX_GLOSSARY_URL = "/pax-glossary.json";

export type PaxPauseOption = PaxPauseOptionType;

/** The heavy glossary copy, rebuilt from the served JSON. */
export interface PaxGlossaryData {
  PAX_STANCE_COPY: typeof StanceCopyType;
  PAX_PAUSE_COPY: typeof PauseCopyType;
  PAX_GROUP_COPY: typeof GroupCopyType;
  PAX_RAIL_COPY: typeof RailCopyType;
  PAX_LIMIT_COPY: typeof LimitCopyType;
  PAX_MY_SITES_COPY: typeof MySitesCopyType;
  PAX_NEVER_LIST: typeof NeverListType;
  PAX_PAGE_COPY: typeof PageCopyType;
  PAX_PAUSE_OPTIONS: typeof PauseOptionsType;
  PAX_FIXED_RULES: typeof FixedRulesType;
}

type Raw = Record<string, unknown>;
const raw = (v: unknown): Raw => v as Raw;

/** "4 workflows" / "1 workflow" — the page's only grammar helper. */
function nOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Rebuild the function-bearing copy objects from the served data. Every
 * function body below is the body in shared/pax-glossary.ts, with the
 * module's cross-references (PAX_LABELS, PAX_CONTROLS_LABEL, the fixed
 * rules) read from the same served data / the sync core.
 */
export function buildPaxGlossary(data: unknown): PaxGlossaryData {
  const d = raw(data);
  const labels = raw(d.PAX_LABELS);
  const fixedRules = raw(d.PAX_FIXED_RULES);

  const pauseData = raw(d.PAX_PAUSE_COPY);
  const PAX_PAUSE_COPY = {
    ...pauseData,
    statusLine({ until, byName, timeZone }: { until: Date | null; byName: string | null; timeZone?: string }): string {
      const when = until ? ` until ${formatPaxTime(until, timeZone)}` : "";
      const who = byName ? ` by ${byName}` : "";
      return `${labels.paused as string}${when}${who}`;
    },
    sentence({ until, byName, timeZone }: { until: Date | null; byName: string | null; timeZone?: string }): string {
      const when = until ? ` until ${formatPaxTime(until, timeZone)}` : "";
      const who = byName ? ` (paused by ${byName})` : "";
      return (
        `Everything Pax and your rules do on their own is stopped${when}${who}. ` +
        "Pax still looks, drafts and asks; anything you approve still goes out."
      );
    },
    resumesByItself(until: Date, timeZone?: string): string {
      return `Pax resumes by itself on ${formatPaxTime(until, timeZone)} if you forget.`;
    },
    refusal({ until, byName, timeZone }: { until: Date | null; byName: string | null; timeZone?: string }): string {
      const when = until ? ` until ${formatPaxTime(until, timeZone)}` : "";
      const who = byName ? ` (paused by ${byName})` : "";
      return (
        `Pax is paused${when}${who}, so this wasn't done. ` +
        `Resume under ${PAX_CONTROLS_LABEL}. Looking, drafting and anything you approve still work.`
      );
    },
    skippedLine({ until, timeZone }: { until: Date | null; timeZone?: string }): string {
      const when = until ? ` until ${formatPaxTime(until, timeZone)}` : "";
      return `Skipped — Pax is paused${when}. Resume under ${PAX_CONTROLS_LABEL}.`;
    },
  };

  const groupData = raw(d.PAX_GROUP_COPY);
  const runsRules = raw(groupData.runs_rules);
  const PAX_GROUP_COPY = {
    ...groupData,
    runs_rules: {
      ...runsRules,
      ifYouNeverTouchThis(limits: { emailsPerDay: number; textsPerDay: number; textHours: string }): string {
        return (
          `Things you turned on run by themselves from your own connected accounts — texts only ${limits.textHours} recipient time, ` +
          `never to anyone who opted out, never more than ${limits.emailsPerDay} emails / ${limits.textsPerDay} texts a day. ` +
          "Each has its own switch. Pause stops all of them."
        );
      },
    },
  };

  const railData = raw(d.PAX_RAIL_COPY);
  const PAX_RAIL_COPY = {
    ...railData,
    changed(areaLabel: string, levelLabel: string): string {
      return `${areaLabel} — ${levelLabel}`;
    },
    watchRefusal(areaLabel: string): string {
      return (
        `Pax is set to Watch for ${areaLabel.toLowerCase()}, so this wasn't done. ` +
        `Change it under ${PAX_CONTROLS_LABEL}. Looking, drafting and anything you approve still work.`
      );
    },
  };

  const sitesData = raw(d.PAX_MY_SITES_COPY);
  const PAX_MY_SITES_COPY = {
    ...sitesData,
    added: (label: string) => `${label} added to your sites`,
    removed: (label: string) => `${label} removed from your sites`,
    listFull: (max: number) => `You can list up to ${max} sites. Remove one to add another.`,
  };

  const pageData = raw(d.PAX_PAGE_COPY);
  const lastRan = (when: string): string => `last ran ${when}`;
  const lastSend = (when: string): string => `last send ${when}`;
  const noRunsYet = pageData.noRunsYet as string;
  const noSendsYet = pageData.noSendsYet as string;
  const PAX_PAGE_COPY = {
    ...pageData,
    rightNow(n: {
      waiting: number;
      changedTodayOnItsOwn: number;
      rulesRunning: { workflows: number; sequences: number; scheduledPrompts: number };
    }): string {
      return (
        `${PAX_LABELS.queue}: ${n.waiting} · Changed on its own today: ${n.changedTodayOnItsOwn} · ` +
        `Rules running: ${nOf(n.rulesRunning.workflows, "workflow", "workflows")}, ` +
        `${nOf(n.rulesRunning.sequences, "sequence", "sequences")}, ` +
        `${nOf(n.rulesRunning.scheduledPrompts, "scheduled prompt", "scheduled prompts")}`
      );
    },
    switchesLiveOn(where: string): string {
      return `Switches are on ${where}`;
    },
    lastRan,
    lastSend,
    workflowsLine(w: { active: number; live: number; lastRan: string | null }): string {
      const notLive = Math.max(0, w.active - w.live);
      return (
        `${w.active} on · ${w.live} live` +
        (notLive > 0 ? ` · ${notLive} ${PAX_LABELS.notYetLive.toLowerCase()}` : "") +
        ` · ${w.lastRan ? lastRan(w.lastRan) : noRunsYet}`
      );
    },
    sequencesLine(s: { activeEnrollments: number; lastSend: string | null }): string {
      return (
        `${nOf(s.activeEnrollments, "active enrollment", "active enrollments")} · ` +
        (s.lastSend ? lastSend(s.lastSend) : noSendsYet)
      );
    },
    scheduledPromptsLine(n: { on: number; total: number }): string {
      return `${n.on} of ${n.total} on · runs the prompt you wrote, on the schedule you chose`;
    },
    promptNextRun(when: string): string {
      return `next ${when}`;
    },
    runHistoryTitle(name: string): string {
      return `Run history — ${name}`;
    },
    leadScoringLine(l: { lastRan: string | null; rescoredToday: number }): string {
      return (
        `${fixedRules.leadScoringCadence as string} · scores and stages leads · ` +
        `${l.lastRan ? lastRan(l.lastRan) : noRunsYet} · ` +
        `${l.rescoredToday} rescored today`
      );
    },
    borrowerRemindersLine(b: { waiting: number }): string {
      return `prepared ${fixedRules.borrowerRemindersCadence as string} · each one waits for your tap · ${b.waiting} waiting`;
    },
    fixedRulesLine(f: { emailsUsedToday: number; emailLimit: number; textsUsedToday: number; textLimit: number }): string {
      return (
        `Texts only ${fixedRules.textHours as string} recipient time · ` +
        `${f.emailsUsedToday} of ${f.emailLimit} emails and ${f.textsUsedToday} of ${f.textLimit} texts used today · ` +
        "never to anyone who opted out · from your own connected accounts"
      );
    },
    switchToast(label: string, on: boolean): string {
      return `${label} — ${on ? (pageData.switchOn as string) : (pageData.switchOff as string)}`;
    },
    waitingLink(n: number): string {
      return `${PAX_LABELS.queue} (${n})`;
    },
  };

  return {
    PAX_STANCE_COPY: d.PAX_STANCE_COPY,
    PAX_PAUSE_COPY,
    PAX_GROUP_COPY,
    PAX_RAIL_COPY,
    PAX_LIMIT_COPY: d.PAX_LIMIT_COPY,
    PAX_MY_SITES_COPY,
    PAX_NEVER_LIST: d.PAX_NEVER_LIST,
    PAX_PAGE_COPY,
    PAX_PAUSE_OPTIONS: d.PAX_PAUSE_OPTIONS,
    PAX_FIXED_RULES: d.PAX_FIXED_RULES,
  } as PaxGlossaryData;
}

async function loadPaxGlossary(): Promise<PaxGlossaryData> {
  const res = await fetch(PAX_GLOSSARY_URL);
  if (!res.ok) {
    throw new Error(`pax glossary fetch failed: ${PAX_GLOSSARY_URL} responded ${res.status}`);
  }
  return buildPaxGlossary(await res.json());
}

let glossaryCache: Promise<PaxGlossaryData> | null = null;

/**
 * Fetch the glossary copy from its static URL. Successes are cached;
 * failures are evicted so a retry refetches (the learn-loader shape).
 */
export function fetchPaxGlossary(): Promise<PaxGlossaryData> {
  if (!glossaryCache) {
    glossaryCache = loadPaxGlossary().catch((err: unknown) => {
      glossaryCache = null;
      throw err;
    });
  }
  return glossaryCache;
}

export function usePaxGlossary(): {
  glossary: PaxGlossaryData | null;
  error: boolean;
  retry: () => void;
} {
  const [glossary, setGlossary] = React.useState<PaxGlossaryData | null>(null);
  const [error, setError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    setError(false);
    fetchPaxGlossary()
      .then((g) => {
        if (live) setGlossary(g);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = React.useCallback(() => setAttempt((a) => a + 1), []);
  return { glossary, error, retry };
}

const PaxGlossaryContext = React.createContext<PaxGlossaryData | null>(null);

/** Read the loaded glossary copy. Only valid under PaxGlossaryProvider. */
export function usePaxGlossaryData(): PaxGlossaryData {
  const data = React.useContext(PaxGlossaryContext);
  if (!data) {
    throw new Error("usePaxGlossaryData must be rendered under PaxGlossaryProvider");
  }
  return data;
}

/**
 * Shell-first gate: renders `fallback` while the copy is in flight and
 * `errorFallback` (with a retry) when the fetch failed; the children —
 * the copy's consumers — render only once the text has arrived, so no
 * surface ever flashes an empty label.
 */
export function PaxGlossaryProvider({
  children,
  fallback,
  errorFallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
  errorFallback: (retry: () => void) => React.ReactNode;
}) {
  const { glossary, error, retry } = usePaxGlossary();
  if (error) return <>{errorFallback(retry)}</>;
  if (!glossary) return <>{fallback}</>;
  return <PaxGlossaryContext.Provider value={glossary}>{children}</PaxGlossaryContext.Provider>;
}
