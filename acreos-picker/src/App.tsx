import { useMemo, useState, useEffect, useRef, forwardRef } from 'react';
import type { ReactNode } from 'react';
import { CATEGORIES, DECISIONS, type Decision, type CategoryId } from './inventory';

// Slugs in our inventory match the prototype's window.__nav(id) — see acreos/app.jsx
function slugFromDecisionId(id: string): string {
  return id.replace(/^vr-/, '');
}

const BREAKPOINTS = [320, 375, 414, 768, 1024, 1440] as const;
type Breakpoint = (typeof BREAKPOINTS)[number];

const STORAGE_KEY = 'acreos-picker-selections-v1';

interface SelectionRecord {
  decisionId: string;
  optionId: string;
  notes?: string;
  decidedAt: string;
}

type Selections = Record<string, SelectionRecord>;

function loadSelections(): Selections {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Selections) : {};
  } catch {
    return {};
  }
}

function saveSelections(s: Selections) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

type Filter = 'all' | 'undecided' | 'decided';

export default function App() {
  const [selections, setSelections] = useState<Selections>(loadSelections);
  const [activeId, setActiveId] = useState<string>(DECISIONS[0]?.id ?? '');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    saveSelections(selections);
  }, [selections]);

  const groupedByCategory = useMemo(() => {
    const groups: Record<CategoryId, Decision[]> = {
      'visual-review': [],
      'platform-tweak': [],
      'build-defer': [],
    };
    for (const d of DECISIONS) groups[d.category].push(d);
    return groups;
  }, []);

  const decided = Object.keys(selections).filter((id) => selections[id]?.optionId).length;
  const total = DECISIONS.length;

  const visibleDecisions = useMemo(() => {
    return DECISIONS.filter((d) => {
      const isDecided = Boolean(selections[d.id]?.optionId);
      if (filter === 'undecided') return !isDecided;
      if (filter === 'decided') return isDecided;
      return true;
    });
  }, [filter, selections]);

  const activeDecision = DECISIONS.find((d) => d.id === activeId);
  const activeVisibleIndex = visibleDecisions.findIndex((d) => d.id === activeId);
  const canPrev = activeVisibleIndex > 0;
  const canNext = activeVisibleIndex < visibleDecisions.length - 1 && activeVisibleIndex >= 0;

  const goPrev = () => {
    if (canPrev) setActiveId(visibleDecisions[activeVisibleIndex - 1].id);
  };
  const goNext = () => {
    if (canNext) setActiveId(visibleDecisions[activeVisibleIndex + 1].id);
  };

  // Keyboard nav: j/↓ next, k/↑ prev, 1/2/3 choose option, [/]/d/u change filter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip if user is typing in textarea/input
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); goNext(); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
      else if (['1', '2', '3'].includes(e.key) && activeDecision?.options) {
        const idx = Number(e.key) - 1;
        const opt = activeDecision.options[idx];
        if (opt) chooseOption(opt.id);
      }
      else if (e.key === 'a') setFilter('all');
      else if (e.key === 'u') setFilter('undecided');
      else if (e.key === 'd') setFilter('decided');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, visibleDecisions]);

  function chooseOption(optionId: string) {
    if (!activeDecision) return;
    setSelections((prev) => ({
      ...prev,
      [activeDecision.id]: {
        decisionId: activeDecision.id,
        optionId,
        notes: prev[activeDecision.id]?.notes,
        decidedAt: new Date().toISOString(),
      },
    }));
  }

  function setNotes(notes: string) {
    if (!activeDecision) return;
    setSelections((prev) => ({
      ...prev,
      [activeDecision.id]: {
        decisionId: activeDecision.id,
        optionId: prev[activeDecision.id]?.optionId ?? '',
        notes,
        decidedAt: new Date().toISOString(),
      },
    }));
  }

  function exportSelections() {
    const payload = {
      version: 2,
      completed_at: decided === total ? new Date().toISOString() : null,
      selections,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'founder-selections.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-screen bg-bg text-ink">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-line bg-bg-raised">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight">AcreOS Picker</span>
          <span className="text-xs text-ink-3 uppercase tracking-widest">Gap 1.1.D</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${total === 0 ? 0 : (decided / total) * 100}%` }}
              />
            </div>
            <span className="text-sm text-ink-2 tabular-nums">{decided}/{total}</span>
          </div>
          {/* Filter chips */}
          <div className="flex items-center gap-1 px-1 py-1 rounded-lg bg-surface border border-line">
            {(['all', 'undecided', 'decided'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                  filter === f ? 'bg-bg-raised text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportSelections}
            className="px-3 py-1.5 rounded-lg bg-ink text-bg-raised text-sm font-medium hover:opacity-90"
          >
            Export selections
          </button>
        </div>
      </header>

      {/* Main: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 border-r border-line bg-bg-raised overflow-y-auto">
          {CATEGORIES.map((cat) => {
            const catDecisions = groupedByCategory[cat.id];
            const catVisible = catDecisions.filter((d) => visibleDecisions.includes(d));
            const catDecided = catDecisions.filter((d) => selections[d.id]?.optionId).length;
            if (catVisible.length === 0) return null;
            return (
            <section key={cat.id} className="border-b border-line last:border-b-0">
              <div className="px-4 py-3 sticky top-0 bg-bg-raised z-10">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-widest text-ink-3">
                    {cat.title}
                  </div>
                  <div className="text-xs text-ink-3 tabular-nums">
                    {catDecided}/{catDecisions.length}
                  </div>
                </div>
                <div className="text-xs text-ink-3 mt-0.5">{cat.description}</div>
              </div>
              <ul>
                {catVisible.map((d) => {
                  const isActive = d.id === activeId;
                  const isDecided = Boolean(selections[d.id]?.optionId);
                  const optionLabel = isDecided
                    ? d.options?.find((o) => o.id === selections[d.id].optionId)?.label
                    : null;
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(d.id)}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                          isActive
                            ? 'bg-brand/10 border-l-2 border-brand'
                            : 'border-l-2 border-transparent hover:bg-surface'
                        }`}
                      >
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            isDecided ? 'bg-brand' : 'bg-ink-3/30'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate flex-1">{d.title}</span>
                        {optionLabel && (
                          <span className="text-[10px] text-ink-3 uppercase tracking-wider flex-shrink-0">
                            {optionLabel}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
          })}
        </aside>

        {/* Main panel */}
        <main className="flex-1 overflow-y-auto p-8">
          {activeDecision ? (
            <DecisionCard
              decision={activeDecision}
              selection={selections[activeDecision.id]}
              onChoose={chooseOption}
              onNotes={setNotes}
            />
          ) : (
            <div className="text-ink-3">No decisions yet.</div>
          )}
        </main>
      </div>

      {/* Bottom bar */}
      <footer className="flex items-center justify-between px-6 py-3 border-t border-line bg-bg-raised text-sm">
        <button
          type="button"
          disabled={!canPrev}
          onClick={goPrev}
          className="px-3 py-1.5 rounded-lg disabled:opacity-30 hover:bg-surface"
        >
          ← Previous <kbd className="ml-1 text-[10px] text-ink-3">k</kbd>
        </button>
        <div className="flex items-center gap-4 text-ink-3">
          <span className="tabular-nums">
            {activeVisibleIndex >= 0 ? activeVisibleIndex + 1 : 0} / {visibleDecisions.length}
          </span>
          <span className="text-[11px] hidden md:inline">
            <kbd>1/2/3</kbd> choose · <kbd>j/k</kbd> nav · <kbd>a/u/d</kbd> filter
          </span>
        </div>
        <button
          type="button"
          disabled={!canNext}
          onClick={goNext}
          className="px-3 py-1.5 rounded-lg disabled:opacity-30 hover:bg-surface"
        >
          Next <kbd className="ml-1 text-[10px] text-ink-3">j</kbd> →
        </button>
      </footer>
    </div>
  );
}

function DecisionCard({
  decision,
  selection,
  onChoose,
  onNotes,
}: {
  decision: Decision;
  selection?: SelectionRecord;
  onChoose: (id: string) => void;
  onNotes: (s: string) => void;
}) {
  return (
    <div className="max-w-3xl">
      <div className="text-xs uppercase tracking-widest text-ink-3 mb-2">
        {CATEGORIES.find((c) => c.id === decision.category)?.title}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight mb-2">{decision.title}</h1>
      {decision.description && (
        <p className="text-ink-2 mb-4">{decision.description}</p>
      )}
      {decision.prototypeRef && (
        <div className="text-xs text-ink-3 mb-6">
          Prototype: <code className="bg-surface px-1.5 py-0.5 rounded">{decision.prototypeRef}</code>
        </div>
      )}

      {/* Three-panel comparison */}
      {decision.surface && decision.category === 'visual-review' && (
        <ThreePanelComparison decision={decision} />
      )}
      {decision.surface && decision.category !== 'visual-review' && (
        <div className="text-xs text-ink-3 mb-6">
          (Three-panel comparison available for visual-review decisions only.)
        </div>
      )}

      {/* Options */}
      {decision.options && (
        <div className="space-y-2 mb-6">
          {decision.options.map((opt) => {
            const isSelected = selection?.optionId === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChoose(opt.id)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  isSelected
                    ? 'border-brand bg-brand/5'
                    : 'border-line hover:border-ink-3 bg-bg-raised'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <span
                    className={`inline-block w-3 h-3 rounded-full border-2 ${
                      isSelected ? 'bg-brand border-brand' : 'border-ink-3/40'
                    }`}
                    aria-hidden="true"
                  />
                  {opt.label}
                </div>
                {opt.description && (
                  <div className="text-sm text-ink-2 mt-1 ml-5">{opt.description}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Notes */}
      <label className="block">
        <span className="text-xs uppercase tracking-widest text-ink-3">Notes (optional)</span>
        <textarea
          className="mt-1 w-full min-h-[80px] px-3 py-2 border border-line rounded-lg bg-bg-raised text-sm focus:outline-none focus:border-ink-3"
          placeholder="Specific gaps, reasoning, or anything Claude should know when applying this selection..."
          value={selection?.notes ?? ''}
          onChange={(e) => onNotes(e.target.value)}
        />
      </label>
    </div>
  );
}

function ThreePanelComparison({ decision }: { decision: Decision }) {
  const slug = slugFromDecisionId(decision.id);
  const [bp, setBp] = useState<Breakpoint>(1440);
  const [zoom, setZoom] = useState<number>(0.5);
  const protoRef = useRef<HTMLIFrameElement>(null);
  const protoWindowReady = useRef(false);

  // After prototype iframe loads, call its window.__nav(slug) to switch surface
  useEffect(() => {
    const iframe = protoRef.current;
    if (!iframe) return;
    const tryNav = () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = iframe.contentWindow as any;
        if (w && typeof w.__nav === 'function') {
          w.__nav(slug);
          protoWindowReady.current = true;
        }
      } catch {
        // Cross-origin or not yet ready — retry
      }
    };
    const onLoad = () => {
      // Prototype boots Babel-in-browser, so wait briefly for window.__nav to attach
      setTimeout(tryNav, 500);
      setTimeout(tryNav, 1500);
      setTimeout(tryNav, 3000);
    };
    iframe.addEventListener('load', onLoad);
    if (protoWindowReady.current) tryNav();
    return () => iframe.removeEventListener('load', onLoad);
  }, [slug]);

  const productionUrl = decision.surface ?? '/';
  // Iframe size = breakpoint × zoom. The iframe itself is at full bp width;
  // the visible scaled box uses CSS transform to render smaller.
  const visibleHeight = 600;
  const scaledWidth = bp * zoom;
  const scaledHeight = visibleHeight;
  const innerHeight = visibleHeight / zoom;

  return (
    <div className="mb-6">
      {/* Controls */}
      <div className="flex items-center justify-between mb-2 text-xs">
        <div className="flex items-center gap-1 px-1 py-1 rounded-lg bg-surface border border-line">
          {BREAKPOINTS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBp(b)}
              className={`px-2 py-0.5 rounded-md font-medium ${
                bp === b ? 'bg-bg-raised text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-ink-2">
          <span>Zoom</span>
          <input
            type="range"
            min={25}
            max={100}
            step={5}
            value={zoom * 100}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
            className="w-24"
          />
          <span className="tabular-nums w-10">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* Three-panel grid */}
      <div className="grid grid-cols-3 gap-3">
        <Panel title="Prototype" subtitle={decision.prototypeRef ?? ''}>
          <ScaledIframe
            ref={protoRef}
            src={`/__dev/prototype/acreos.html`}
            width={bp}
            innerHeight={innerHeight}
            scaledWidth={scaledWidth}
            scaledHeight={scaledHeight}
          />
        </Panel>
        <Panel title="Production" subtitle={`acreos.io${productionUrl}`}>
          <ScaledIframe
            src={productionUrl}
            width={bp}
            innerHeight={innerHeight}
            scaledWidth={scaledWidth}
            scaledHeight={scaledHeight}
          />
        </Panel>
        <Panel title="Preview" subtitle="Same as production until D.6.6/7 wire overrides">
          <ScaledIframe
            src={productionUrl}
            width={bp}
            innerHeight={innerHeight}
            scaledWidth={scaledWidth}
            scaledHeight={scaledHeight}
          />
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-line rounded-lg overflow-hidden bg-bg-raised">
      <div className="px-3 py-2 border-b border-line">
        <div className="text-xs font-semibold uppercase tracking-widest text-ink-3">{title}</div>
        <div className="text-[10px] text-ink-3 truncate" title={subtitle}>{subtitle}</div>
      </div>
      <div className="bg-bg overflow-hidden">{children}</div>
    </div>
  );
}

interface ScaledIframeProps {
  src: string;
  width: number;
  innerHeight: number;
  scaledWidth: number;
  scaledHeight: number;
}

const ScaledIframe = forwardRef<HTMLIFrameElement, ScaledIframeProps>(
  ({ src, width, innerHeight, scaledWidth, scaledHeight }, ref) => {
    const scale = scaledWidth / width;
    return (
      <div style={{ width: scaledWidth, height: scaledHeight, position: 'relative' }}>
        <iframe
          ref={ref}
          src={src}
          width={width}
          height={innerHeight}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            border: 0,
            display: 'block',
          }}
          // sandbox keeps iframes from breaking out; allow-scripts so React
          // mounts; allow-same-origin so we can call window.__nav on the
          // prototype + carry Clerk cookies on production
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    );
  }
);
ScaledIframe.displayName = 'ScaledIframe';
