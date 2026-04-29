import { useMemo, useState, useEffect, useRef, forwardRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { CATEGORIES, DECISIONS, type Decision, type CategoryId } from './inventory';
import { COPY_EDIT_INJECTOR_URL } from './copy-edit-injector';
import { DENSITY_INJECTOR_URL } from './density-injector';
import { TOKEN_INJECTOR_URL } from './token-injector';

// Slugs in our inventory match the prototype's window.__nav(id) — see acreos/app.jsx
function slugFromDecisionId(id: string): string {
  return id.replace(/^vr-/, '');
}

const BREAKPOINTS = [320, 375, 414, 768, 1024, 1440] as const;
type Breakpoint = (typeof BREAKPOINTS)[number];

const STORAGE_KEY = 'acreos-picker-selections-v1';

interface CopyOverride {
  original: string;
  edited: string;
}

interface DensityOverrides {
  fs: number;   // font-size scale (0.85 - 1.15)
  lh: number;   // line-height (1.2 - 1.8)
  pad: number;  // section padding scale (0.6 - 1.5)
  gap: number;  // gap/spacing scale (0.6 - 1.5)
}

interface TokenOverrides {
  // map of CSS custom property name (e.g. '--acr-brand') to color value
  [tokenName: string]: string;
}

interface SelectionRecord {
  decisionId: string;
  optionId: string;
  notes?: string;
  decidedAt: string;
  copyOverrides?: Record<string, CopyOverride>;
  densityOverrides?: DensityOverrides;
  tokenOverrides?: TokenOverrides;
}

const DENSITY_PRESETS: Record<string, DensityOverrides> = {
  compact:     { fs: 0.88, lh: 1.35, pad: 0.7, gap: 0.7 },
  comfortable: { fs: 1.00, lh: 1.50, pad: 1.0, gap: 1.0 },
  spacious:    { fs: 1.10, lh: 1.65, pad: 1.3, gap: 1.3 },
};

function densityForOption(optionId?: string, custom?: DensityOverrides): DensityOverrides {
  if (optionId === 'custom' && custom) return custom;
  return DENSITY_PRESETS[optionId ?? 'comfortable'] ?? DENSITY_PRESETS.comfortable;
}

// Constrained palette for --acr-brand. No arbitrary hex; all values are
// design-system-approved alternatives within the terracotta family.
const BRAND_OPTION_HEX: Record<string, string> = {
  'brand-default': '#C2531C', // current production value (light theme)
  'brand-deeper':  '#A04316', // grounded, more saturated
  'brand-warmer':  '#E07749', // softer, warmer feel
};

function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function tokensForBrandOption(optionId: string): TokenOverrides {
  const hex = BRAND_OPTION_HEX[optionId];
  if (!hex) return {};
  return {
    '--acr-brand': hex,
    '--acr-brand-soft': hexToRgba(hex, 0.14),
    '--acr-glow': hexToRgba(hex, 0.35),
    '--acr-ring': `0 0 0 3px ${hexToRgba(hex, 0.28)}`,
    '--acr-chart-a': hex,
  };
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
        copyOverrides: prev[activeDecision.id]?.copyOverrides,
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
        copyOverrides: prev[activeDecision.id]?.copyOverrides,
      },
    }));
  }

  const setCopyOverride = useCallback(
    (decisionId: string, copyId: string, original: string, edited: string) => {
      setSelections((prev) => {
        const existing = prev[decisionId];
        const prevOverrides = existing?.copyOverrides ?? {};
        // If edited matches original, drop the override entirely.
        let nextOverrides: Record<string, CopyOverride> | undefined;
        if (edited === original) {
          const { [copyId]: _drop, ...rest } = prevOverrides;
          nextOverrides = Object.keys(rest).length ? rest : undefined;
        } else {
          nextOverrides = { ...prevOverrides, [copyId]: { original, edited } };
        }
        return {
          ...prev,
          [decisionId]: {
            decisionId,
            optionId: existing?.optionId ?? '',
            notes: existing?.notes,
            decidedAt: new Date().toISOString(),
            copyOverrides: nextOverrides,
          },
        };
      });
    },
    []
  );

  const setDensityOverrides = useCallback(
    (decisionId: string, density: DensityOverrides) => {
      setSelections((prev) => {
        const existing = prev[decisionId];
        return {
          ...prev,
          [decisionId]: {
            decisionId,
            optionId: existing?.optionId ?? '',
            notes: existing?.notes,
            decidedAt: new Date().toISOString(),
            copyOverrides: existing?.copyOverrides,
            densityOverrides: density,
            tokenOverrides: existing?.tokenOverrides,
          },
        };
      });
    },
    []
  );

  const setTokenOverrides = useCallback(
    (decisionId: string, tokens: TokenOverrides) => {
      setSelections((prev) => {
        const existing = prev[decisionId];
        return {
          ...prev,
          [decisionId]: {
            decisionId,
            optionId: existing?.optionId ?? '',
            notes: existing?.notes,
            decidedAt: new Date().toISOString(),
            copyOverrides: existing?.copyOverrides,
            densityOverrides: existing?.densityOverrides,
            tokenOverrides: Object.keys(tokens).length ? tokens : undefined,
          },
        };
      });
    },
    []
  );

  const clearCopyOverride = useCallback((decisionId: string, copyId: string) => {
    setSelections((prev) => {
      const existing = prev[decisionId];
      if (!existing?.copyOverrides) return prev;
      const { [copyId]: _drop, ...rest } = existing.copyOverrides;
      const nextOverrides = Object.keys(rest).length ? rest : undefined;
      return {
        ...prev,
        [decisionId]: {
          ...existing,
          decidedAt: new Date().toISOString(),
          copyOverrides: nextOverrides,
        },
      };
    });
  }, []);

  const [exportStatus, setExportStatus] = useState<{
    state: 'idle' | 'sending' | 'ok' | 'error';
    message?: string;
  }>({ state: 'idle' });

  async function exportSelections() {
    const payload = {
      version: 2,
      completed_at: decided === total ? new Date().toISOString() : null,
      generated_at: new Date().toISOString(),
      selections,
    };
    setExportStatus({ state: 'sending' });
    // Try server-side write first (uses authenticated Clerk session same-origin)
    try {
      const resp = await fetch('/api/__dev/founder-selections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          target?: string;
          retrieval?: { command?: string };
        };
        setExportStatus({
          state: 'ok',
          message: `Saved → ${data.target ?? 'server'}${
            data.retrieval?.command ? ` · retrieve: ${data.retrieval.command}` : ''
          }`,
        });
        // Also trigger a download for immediate access — server file is on
        // Fly tmp, so download is the founder's local backup copy.
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'founder-selections.json';
        a.click();
        URL.revokeObjectURL(url);
        setTimeout(() => setExportStatus({ state: 'idle' }), 8000);
        return;
      }
      // Server endpoint refused — fall back to browser download
      setExportStatus({
        state: 'error',
        message: `Server returned ${resp.status} — falling back to download`,
      });
    } catch (err) {
      setExportStatus({
        state: 'error',
        message: 'Network error — falling back to download',
      });
    }
    // Fallback: download via browser
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'founder-selections.json';
    a.click();
    URL.revokeObjectURL(url);
    setTimeout(() => setExportStatus({ state: 'idle' }), 4000);
  }

  return (
    <div className="flex flex-col h-screen bg-bg text-ink">
      {/* Top bar */}
      <header className="flex items-center justify-between px-7 py-4 border-b border-line bg-bg-raised">
        <div className="flex items-center gap-4">
          <span className="font-editorial text-[20px] leading-none text-ink">AcreOS Picker</span>
          <span className="text-[10px] text-ink-3 uppercase tracking-[0.18em] mt-1">
            Gap 1.1.D · Variant Decisions
          </span>
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
          <div className="flex items-center gap-2">
            {exportStatus.state !== 'idle' && (
              <span
                className={`text-[11px] tabular-nums max-w-[280px] truncate ${
                  exportStatus.state === 'ok'
                    ? 'text-green-700'
                    : exportStatus.state === 'error'
                    ? 'text-red-700'
                    : 'text-ink-3'
                }`}
                title={exportStatus.message}
              >
                {exportStatus.state === 'sending' ? 'Saving…' : exportStatus.message}
              </span>
            )}
            <button
              type="button"
              onClick={exportSelections}
              disabled={exportStatus.state === 'sending'}
              className="px-3 py-1.5 rounded-lg bg-ink text-bg-raised text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              Export selections
            </button>
          </div>
        </div>
      </header>

      {/* Main: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 border-r border-line bg-sidebar overflow-y-auto">
          {CATEGORIES.map((cat) => {
            const catDecisions = groupedByCategory[cat.id];
            const catVisible = catDecisions.filter((d) => visibleDecisions.includes(d));
            const catDecided = catDecisions.filter((d) => selections[d.id]?.optionId).length;
            if (catVisible.length === 0) return null;
            return (
            <section key={cat.id} className="border-b border-line last:border-b-0">
              <div className="px-5 py-4 sticky top-0 bg-sidebar z-10">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
                    {cat.title}
                  </div>
                  <div className="text-[10px] text-ink-3 tabular-nums">
                    {catDecided} of {catDecisions.length}
                  </div>
                </div>
                <div className="text-[11px] text-ink-3 mt-1 leading-snug">{cat.description}</div>
              </div>
              <ul className="pb-2">
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
                        data-decision-id={d.id}
                        data-category={d.category}
                        onClick={() => setActiveId(d.id)}
                        className={`w-full text-left px-5 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                          isActive
                            ? 'bg-brand-soft/60 border-l-2 border-brand text-ink'
                            : 'border-l-2 border-transparent hover:bg-bg-raised text-ink-2 hover:text-ink'
                        }`}
                      >
                        {d.tier && (
                          <span
                            className={`inline-flex items-center justify-center text-[9px] font-semibold uppercase tracking-wider rounded px-1.5 h-4 flex-shrink-0 tier-${d.tier}`}
                          >
                            T{d.tier}
                          </span>
                        )}
                        <span className="truncate flex-1 font-medium">{d.title}</span>
                        {isDecided ? (
                          <span
                            className="inline-flex items-center text-[9px] font-medium uppercase tracking-wider rounded-full px-1.5 h-4 chip-decided flex-shrink-0"
                            title={optionLabel ?? ''}
                          >
                            ✓
                          </span>
                        ) : (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-ink-3/25 flex-shrink-0"
                            aria-hidden="true"
                          />
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
        <main className="flex-1 overflow-y-auto px-10 py-8 bg-bg">
          {activeDecision ? (
            <DecisionCard
              decision={activeDecision}
              selection={selections[activeDecision.id]}
              onChoose={chooseOption}
              onNotes={setNotes}
              onSetCopyOverride={setCopyOverride}
              onClearCopyOverride={clearCopyOverride}
              onSetDensityOverrides={setDensityOverrides}
              onSetTokenOverrides={setTokenOverrides}
            />
          ) : (
            <div className="text-ink-3">No decisions yet.</div>
          )}
        </main>
      </div>

      {/* Bottom bar */}
      <footer className="flex items-center justify-between px-7 py-3 border-t border-line bg-bg-raised text-sm">
        <button
          type="button"
          disabled={!canPrev}
          onClick={goPrev}
          className="px-3 py-1.5 rounded-lg text-ink-2 disabled:opacity-30 hover:bg-surface-2 hover:text-ink"
        >
          ← Previous{' '}
          <kbd className="ml-1 text-[10px] text-ink-3 font-mono">k</kbd>
        </button>
        <div className="flex items-center gap-5 text-ink-3">
          <span className="tabular-nums text-ink-2">
            {activeVisibleIndex >= 0 ? activeVisibleIndex + 1 : 0} / {visibleDecisions.length}
          </span>
          <span className="text-[11px] hidden md:inline tracking-wide">
            <kbd className="font-mono">1/2/3</kbd> choose
            <span className="mx-2 text-ink-3/50">·</span>
            <kbd className="font-mono">j/k</kbd> nav
            <span className="mx-2 text-ink-3/50">·</span>
            <kbd className="font-mono">a/u/d</kbd> filter
          </span>
        </div>
        <button
          type="button"
          disabled={!canNext}
          onClick={goNext}
          className="px-3 py-1.5 rounded-lg text-ink-2 disabled:opacity-30 hover:bg-surface-2 hover:text-ink"
        >
          Next <kbd className="ml-1 text-[10px] text-ink-3 font-mono">j</kbd> →
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
  onSetCopyOverride,
  onClearCopyOverride,
  onSetDensityOverrides,
  onSetTokenOverrides,
}: {
  decision: Decision;
  selection?: SelectionRecord;
  onChoose: (id: string) => void;
  onNotes: (s: string) => void;
  onSetCopyOverride: (decisionId: string, copyId: string, original: string, edited: string) => void;
  onClearCopyOverride: (decisionId: string, copyId: string) => void;
  onSetDensityOverrides: (decisionId: string, density: DensityOverrides) => void;
  onSetTokenOverrides: (decisionId: string, tokens: TokenOverrides) => void;
}) {
  const copyOverrides = selection?.copyOverrides ?? {};
  const overrideEntries = Object.entries(copyOverrides);
  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
          {CATEGORIES.find((c) => c.id === decision.category)?.title}
        </span>
        {decision.tier && (
          <span
            className={`inline-flex items-center justify-center text-[10px] font-semibold uppercase tracking-wider rounded px-2 h-5 tier-${decision.tier}`}
          >
            Tier {decision.tier}
          </span>
        )}
      </div>
      <h1 className="font-editorial text-[34px] leading-[1.1] text-ink mb-3">
        {decision.title}
      </h1>
      {decision.description && (
        <p className="text-ink-2 mb-4 leading-relaxed max-w-2xl">{decision.description}</p>
      )}
      {decision.prototypeRef && (
        <div className="text-xs text-ink-3 mb-6 flex items-center gap-1.5">
          <span className="uppercase tracking-widest">Prototype</span>
          <span className="text-ink-3/60">·</span>
          <code className="bg-bg-raised border border-line px-1.5 py-0.5 rounded text-ink-2">
            {decision.prototypeRef}
          </code>
        </div>
      )}

      {/* Three-panel comparison */}
      {decision.surface && decision.category === 'visual-review' && (
        <ThreePanelComparison
          decision={decision}
          copyOverrides={copyOverrides}
          onCopyEdit={(copyId, original, edited) =>
            onSetCopyOverride(decision.id, copyId, original, edited)
          }
        />
      )}

      {/* Copy overrides list (only if any exist) */}
      {decision.category === 'visual-review' && overrideEntries.length > 0 && (
        <div className="mb-6 border border-line rounded-lg bg-bg-raised">
          <div className="px-4 py-2 border-b border-line flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-ink-3">
              Copy edits ({overrideEntries.length})
            </span>
          </div>
          <ul className="divide-y divide-line">
            {overrideEntries.map(([copyId, ov]) => (
              <li key={copyId} className="px-4 py-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-ink-3 line-through truncate">{ov.original}</div>
                    <div className="text-ink truncate">{ov.edited}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onClearCopyOverride(decision.id, copyId)}
                    className="text-xs text-ink-3 hover:text-ink flex-shrink-0"
                    title="Discard this edit"
                  >
                    Reset
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {decision.category === 'platform-tweak' && (
        <TweakPanel
          decision={decision}
          selection={selection}
          onSetDensityOverrides={(d) => onSetDensityOverrides(decision.id, d)}
          onSetTokenOverrides={(t) => onSetTokenOverrides(decision.id, t)}
          onChoose={onChoose}
        />
      )}
      {decision.surface && decision.category === 'build-defer' && (
        <div className="text-xs text-ink-3 mb-6">
          Production route is unimplemented — preview not available until built. Choose below.
        </div>
      )}

      {/* Options — rendered only for visual-review and build-defer.
          Platform-tweak decisions render their own controls inside TweakPanel. */}
      {decision.options && decision.category !== 'platform-tweak' && (
        <div className="space-y-2 mb-6">
          {decision.options.map((opt) => {
            const isSelected = selection?.optionId === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChoose(opt.id)}
                className={`w-full text-left px-5 py-3 rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'border-brand bg-brand-soft text-ink shadow-acr-1'
                    : 'border-line hover:border-ink-3/50 bg-bg-raised text-ink-2 hover:text-ink'
                }`}
              >
                <div className="flex items-center gap-3 font-medium">
                  <span
                    className={`inline-flex items-center justify-center w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      isSelected ? 'bg-brand border-brand' : 'border-ink-3/40'
                    }`}
                    aria-hidden="true"
                  >
                    {isSelected && (
                      <span className="block w-1.5 h-1.5 rounded-full bg-brand-ink" />
                    )}
                  </span>
                  <span>{opt.label}</span>
                </div>
                {opt.description && (
                  <div className="text-sm text-ink-3 mt-1 ml-7 leading-relaxed">
                    {opt.description}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Notes */}
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
          Notes
        </span>
        <textarea
          className="mt-2 w-full min-h-[88px] px-4 py-3 border border-line rounded-xl bg-bg-raised text-sm leading-relaxed text-ink-2 placeholder:text-ink-3/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
          placeholder="Specific gaps, reasoning, or anything Claude should know when applying this selection…"
          value={selection?.notes ?? ''}
          onChange={(e) => onNotes(e.target.value)}
        />
      </label>
    </div>
  );
}

function ThreePanelComparison({
  decision,
  copyOverrides,
  onCopyEdit,
}: {
  decision: Decision;
  copyOverrides: Record<string, CopyOverride>;
  onCopyEdit: (copyId: string, original: string, edited: string) => void;
}) {
  const slug = slugFromDecisionId(decision.id);
  const [bpPrimary, setBpPrimary] = useState<Breakpoint>(1440);
  const [bpSecondary, setBpSecondary] = useState<Breakpoint>(375);
  const [splitView, setSplitView] = useState(false);
  // 1.0 = fit-to-column. Higher values zoom in (with horizontal scroll).
  const [zoom, setZoom] = useState<number>(1);
  const [editMode, setEditMode] = useState(false);
  const [editorStatus, setEditorStatus] = useState<'idle' | 'injecting' | 'ready'>('idle');
  const previewRef = useRef<HTMLIFrameElement | null>(null);

  // Stable refs for copyOverrides + onCopyEdit so message handler doesn't tear down on every change
  const overridesRef = useRef(copyOverrides);
  overridesRef.current = copyOverrides;
  const onCopyEditRef = useRef(onCopyEdit);
  onCopyEditRef.current = onCopyEdit;

  // Inject copy-edit script into the preview iframe. Loaded via same-origin
  // URL (not inline) so the production iframe's strict CSP (script-src 'self')
  // accepts it. If the script already exists (e.g. iframe didn't reload), the
  // injector's IIFE guard skips re-running.
  function injectIntoPreview() {
    const iframe = previewRef.current;
    if (!iframe) return false;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return false;
      if (doc.querySelector('script[data-acreos-copy-edit]')) return true;
      const s = doc.createElement('script');
      s.dataset.acreosCopyEdit = 'true';
      s.src = COPY_EDIT_INJECTOR_URL;
      s.async = false;
      (doc.head || doc.documentElement).appendChild(s);
      return true;
    } catch {
      return false;
    }
  }

  function postToPreview(message: unknown) {
    const w = previewRef.current?.contentWindow;
    try {
      w?.postMessage(message, '*');
    } catch {
      /* ignore */
    }
  }

  // Listen for messages from preview iframe
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      const t = (e.data as { type?: string }).type;
      // Only accept messages from the preview iframe's window
      if (e.source !== previewRef.current?.contentWindow) return;
      if (t === 'acreos:copy-edit-injected') {
        // Script attached. If editMode is on, activate.
        if (editMode) {
          setEditorStatus('injecting');
          postToPreview({ type: 'acreos:copy-edit-activate' });
          // Re-apply existing overrides
          const ov: Record<string, string> = {};
          for (const [id, v] of Object.entries(overridesRef.current)) ov[id] = v.edited;
          if (Object.keys(ov).length) {
            postToPreview({ type: 'acreos:copy-edit-apply', overrides: ov });
          }
        }
      } else if (t === 'acreos:copy-edit-ready') {
        setEditorStatus('ready');
      } else if (t === 'acreos:copy-edit') {
        const { id, original, edited } = e.data as {
          id: string;
          original: string;
          edited: string;
        };
        if (id && typeof original === 'string' && typeof edited === 'string') {
          onCopyEditRef.current(id, original, edited);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [editMode]);

  // When editMode flips on, ensure injection + activation. When off, deactivate.
  useEffect(() => {
    if (editMode) {
      setEditorStatus('injecting');
      const injected = injectIntoPreview();
      if (injected) {
        // If the script was already there, prompt activation directly
        postToPreview({ type: 'acreos:copy-edit-activate' });
        // Re-apply overrides
        const ov: Record<string, string> = {};
        for (const [id, v] of Object.entries(overridesRef.current)) ov[id] = v.edited;
        if (Object.keys(ov).length) {
          postToPreview({ type: 'acreos:copy-edit-apply', overrides: ov });
        }
      }
    } else {
      postToPreview({ type: 'acreos:copy-edit-deactivate' });
      setEditorStatus('idle');
    }
  }, [editMode, decision.id, bpPrimary]);

  const productionUrl = decision.surface ?? '/';

  // Set previewRef when the primary preview iframe mounts
  const registerPrimaryPreview = useCallback(
    (el: HTMLIFrameElement | null) => {
      previewRef.current = el;
      if (!el) return;
      const onLoad = () => {
        if (editMode) setTimeout(() => injectIntoPreview(), 800);
      };
      el.addEventListener('load', onLoad);
      // No cleanup return — iframe is GC'd with row unmount
    },
    [editMode]
  );

  function handleBpClick(b: Breakpoint) {
    if (splitView) {
      // In split view: clicking primary's bp also drives bpPrimary; secondary controlled below
      setBpPrimary(b);
    } else {
      setBpPrimary(b);
    }
  }

  return (
    <div className="mb-6">
      {/* Controls row */}
      <div className="flex items-center justify-between mb-2 text-xs flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-ink-3 mr-1">
            {splitView ? 'Top' : 'Breakpoint'}
          </span>
          <div className="flex items-center gap-1 px-1 py-1 rounded-lg bg-surface border border-line">
            {BREAKPOINTS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => handleBpClick(b)}
                className={`px-2 py-0.5 rounded-md font-medium ${
                  bpPrimary === b ? 'bg-bg-raised text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSplitView((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
              splitView
                ? 'bg-ink text-bg-raised border-ink'
                : 'bg-bg-raised border-line text-ink-2 hover:border-ink-3 hover:text-ink'
            }`}
            title="Show two breakpoints simultaneously (e.g. 375 + 1440)"
          >
            {splitView ? 'Split view on' : 'Split view'}
          </button>
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
              editMode
                ? 'bg-brand text-white border-brand'
                : 'bg-bg-raised border-line text-ink-2 hover:border-ink-3 hover:text-ink'
            }`}
            title="Click any text in the Preview panel to edit it"
          >
            {editMode ? 'Editing copy' : 'Edit copy'}
          </button>
          {editMode && (
            <span className="text-[10px] text-ink-3 tabular-nums">
              {editorStatus === 'ready' ? 'ready · click any text' : 'injecting…'}
            </span>
          )}
          <div className="flex items-center gap-2 text-ink-2">
            <span title="100% fits the column; higher values zoom in with horizontal scroll">
              Zoom
            </span>
            <input
              type="range"
              min={100}
              max={400}
              step={25}
              value={zoom * 100}
              onChange={(e) => setZoom(Number(e.target.value) / 100)}
              className="w-24"
            />
            <span className="tabular-nums w-10">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Secondary breakpoint selector (split view only) */}
      {splitView && (
        <div className="flex items-center gap-2 mb-2 text-xs">
          <span className="text-[10px] uppercase tracking-widest text-ink-3 mr-1">Bottom</span>
          <div className="flex items-center gap-1 px-1 py-1 rounded-lg bg-surface border border-line">
            {BREAKPOINTS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBpSecondary(b)}
                className={`px-2 py-0.5 rounded-md font-medium ${
                  bpSecondary === b ? 'bg-bg-raised text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Primary row */}
      <PanelRow
        slug={slug}
        decision={decision}
        breakpoint={bpPrimary}
        zoom={zoom}
        productionUrl={productionUrl}
        editMode={editMode}
        registerPreview={registerPrimaryPreview}
        rowLabel={splitView ? `Top · ${bpPrimary}px` : undefined}
      />

      {/* Secondary row (split view only) */}
      {splitView && (
        <div className="mt-3">
          <PanelRow
            slug={slug}
            decision={decision}
            breakpoint={bpSecondary}
            zoom={zoom}
            productionUrl={productionUrl}
            editMode={false /* edit only targets primary */}
            registerPreview={null}
            rowLabel={`Bottom · ${bpSecondary}px`}
          />
        </div>
      )}
    </div>
  );
}

function PanelRow({
  slug,
  decision,
  breakpoint,
  zoom,
  productionUrl,
  editMode,
  registerPreview,
  rowLabel,
}: {
  slug: string;
  decision: Decision;
  breakpoint: Breakpoint;
  zoom: number;
  productionUrl: string;
  editMode: boolean;
  registerPreview: ((el: HTMLIFrameElement | null) => void) | null;
  rowLabel?: string;
}) {
  const protoRef = useRef<HTMLIFrameElement | null>(null);
  const protoWindowReady = useRef(false);

  // After prototype iframe loads, poll for window.__nav and call it as soon
  // as it appears. Babel-in-browser + React from unpkg can take 4-8s on a
  // cold load; fixed timeouts miss it.
  useEffect(() => {
    const iframe = protoRef.current;
    if (!iframe) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const tryNav = (): boolean => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = iframe.contentWindow as any;
        if (w && typeof w.__nav === 'function') {
          w.__nav(slug);
          protoWindowReady.current = true;
          return true;
        }
      } catch {
        /* not yet ready */
      }
      return false;
    };
    const startPolling = () => {
      if (intervalId) clearInterval(intervalId);
      let attempts = 0;
      intervalId = setInterval(() => {
        attempts++;
        if (tryNav() || attempts > 75) {
          if (intervalId) clearInterval(intervalId);
          intervalId = null;
        }
      }, 200);
    };
    const onLoad = () => startPolling();
    iframe.addEventListener('load', onLoad);
    if (protoWindowReady.current) tryNav();
    else startPolling();
    return () => {
      iframe.removeEventListener('load', onLoad);
      if (intervalId) clearInterval(intervalId);
    };
  }, [slug]);

  const visibleHeight = 600;

  return (
    <div>
      {rowLabel && (
        <div className="text-[10px] uppercase tracking-widest text-ink-3 mb-1">{rowLabel}</div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Panel title="Prototype" subtitle={decision.prototypeRef ?? ''}>
          <ScaledIframe
            ref={protoRef}
            src={`/__dev/prototype/acreos.html`}
            width={breakpoint}
            visibleHeight={visibleHeight}
            zoom={zoom}
          />
        </Panel>
        <Panel title="Production" subtitle={`acreos.io${productionUrl}`}>
          <ScaledIframe
            src={productionUrl}
            width={breakpoint}
            visibleHeight={visibleHeight}
            zoom={zoom}
          />
        </Panel>
        <Panel
          title="Preview"
          subtitle={editMode ? 'Edit mode — click any text to change it' : 'Production + your overrides'}
          accent={editMode}
        >
          <ScaledIframe
            ref={registerPreview ?? undefined}
            src={productionUrl}
            width={breakpoint}
            visibleHeight={visibleHeight}
            zoom={zoom}
          />
        </Panel>
      </div>
    </div>
  );
}

function TweakPanel({
  decision,
  selection,
  onSetDensityOverrides,
  onSetTokenOverrides,
  onChoose,
}: {
  decision: Decision;
  selection?: SelectionRecord;
  onSetDensityOverrides: (d: DensityOverrides) => void;
  onSetTokenOverrides: (t: TokenOverrides) => void;
  onChoose: (id: string) => void;
}) {
  const previewSurface = decision.surface ?? '/today';
  const [bp, setBp] = useState<Breakpoint>(1440);
  // 1.0 = fit-to-column. Higher values zoom in (with horizontal scroll).
  const [zoom, setZoom] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [densityReady, setDensityReady] = useState(false);
  const [tokensReady, setTokensReady] = useState(false);

  const isDensity = decision.id === 'platform-density';
  const isBrandColor = decision.id === 'platform-primary-color';
  const optionId = selection?.optionId;
  const customDensity = selection?.densityOverrides;
  const tokenOverrides = selection?.tokenOverrides ?? {};
  const effectiveDensity: DensityOverrides = densityForOption(optionId, customDensity);

  // Inject one or both injector scripts depending on decision type
  function injectScripts() {
    const iframe = iframeRef.current;
    if (!iframe) return false;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return false;
      if (isDensity && !doc.querySelector('script[data-acreos-density]')) {
        const s = doc.createElement('script');
        s.dataset.acreosDensity = 'true';
        s.src = DENSITY_INJECTOR_URL;
        s.async = false;
        (doc.head || doc.documentElement).appendChild(s);
      } else if (isDensity) {
        setDensityReady(true);
      }
      if (isBrandColor && !doc.querySelector('script[data-acreos-tokens]')) {
        const s = doc.createElement('script');
        s.dataset.acreosTokens = 'true';
        s.src = TOKEN_INJECTOR_URL;
        s.async = false;
        (doc.head || doc.documentElement).appendChild(s);
      } else if (isBrandColor) {
        setTokensReady(true);
      }
      return true;
    } catch {
      return false;
    }
  }

  function postToIframe(message: unknown) {
    const w = iframeRef.current?.contentWindow;
    try {
      w?.postMessage(message, '*');
    } catch {
      /* ignore */
    }
  }

  // Listen for injector-ready messages from the iframe
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      const t = (e.data as { type?: string }).type;
      if (t === 'acreos:density-injected') setDensityReady(true);
      else if (t === 'acreos:tokens-injected') setTokensReady(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Re-inject after iframe load (decision change reloads iframe via src change)
  useEffect(() => {
    setDensityReady(false);
    setTokensReady(false);
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      setTimeout(() => injectScripts(), 600);
    };
    iframe.addEventListener('load', onLoad);
    setTimeout(() => injectScripts(), 600);
    return () => iframe.removeEventListener('load', onLoad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision.id]);

  // Apply density overrides
  useEffect(() => {
    if (!isDensity || !densityReady) return;
    postToIframe({ type: 'acreos:density-apply', vars: effectiveDensity });
  }, [
    isDensity,
    densityReady,
    effectiveDensity.fs,
    effectiveDensity.lh,
    effectiveDensity.pad,
    effectiveDensity.gap,
  ]);

  // Apply token overrides
  useEffect(() => {
    if (!isBrandColor || !tokensReady) return;
    if (Object.keys(tokenOverrides).length === 0) {
      postToIframe({ type: 'acreos:tokens-clear' });
    } else {
      postToIframe({ type: 'acreos:tokens-apply', tokens: tokenOverrides });
    }
  }, [isBrandColor, tokensReady, tokenOverrides]);

  function handleDensityPresetClick(presetId: string) {
    onChoose(presetId);
    if (presetId === 'custom') {
      const seed: DensityOverrides = customDensity ?? { ...DENSITY_PRESETS.comfortable };
      onSetDensityOverrides(seed);
    } else {
      onSetDensityOverrides(DENSITY_PRESETS[presetId] ?? DENSITY_PRESETS.comfortable);
    }
  }

  function handleBrandColorClick(presetId: string) {
    onChoose(presetId);
    onSetTokenOverrides(tokensForBrandOption(presetId));
  }

  function handleResetTokens() {
    onSetTokenOverrides({});
  }

  function updateCustom(key: keyof DensityOverrides, value: number) {
    const next: DensityOverrides = { ...effectiveDensity, [key]: value };
    onSetDensityOverrides(next);
  }

  const visibleHeight = 600;

  return (
    <div className="mb-6">
      {/* Brand color swatches (only for platform-primary-color) */}
      {isBrandColor && (
        <div className="mb-3">
          <div className="grid grid-cols-3 gap-2">
            {decision.options?.map((opt) => {
              const isSelected = optionId === opt.id;
              const hex = BRAND_OPTION_HEX[opt.id] ?? '#888888';
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleBrandColorClick(opt.id)}
                  className={`relative px-3 py-3 rounded-lg border text-sm font-medium text-left transition-colors ${
                    isSelected
                      ? 'border-brand bg-brand/5 text-ink ring-1 ring-brand'
                      : 'border-line bg-bg-raised text-ink-2 hover:border-ink-3 hover:text-ink'
                  }`}
                >
                  <span
                    className="inline-block w-5 h-5 rounded-full mr-2 align-middle border border-line"
                    style={{ backgroundColor: hex }}
                    aria-hidden
                  />
                  <span className="align-middle">{opt.label}</span>
                  <div className="text-[10px] tabular-nums text-ink-3 mt-0.5 ml-7">{hex}</div>
                </button>
              );
            })}
          </div>
          {Object.keys(tokenOverrides).length > 0 && (
            <button
              type="button"
              onClick={handleResetTokens}
              className="mt-2 text-xs text-ink-3 hover:text-ink underline"
            >
              Reset to default
            </button>
          )}
          {Object.keys(tokenOverrides).length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-ink-3 cursor-pointer">
                Active overrides ({Object.keys(tokenOverrides).length})
              </summary>
              <ul className="mt-1 text-xs text-ink-2">
                {Object.entries(tokenOverrides).map(([name, value]) => (
                  <li key={name} className="flex justify-between gap-2">
                    <code className="text-ink-3">{name}</code>
                    <span className="tabular-nums">{value}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Density preset buttons (only for platform-density) */}
      {isDensity && (
        <div className="mb-3">
          <div className="grid grid-cols-4 gap-2">
            {decision.options?.map((opt) => {
              const isSelected = optionId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleDensityPresetClick(opt.id)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    isSelected
                      ? 'border-brand bg-brand/5 text-ink'
                      : 'border-line bg-bg-raised text-ink-2 hover:border-ink-3 hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* Custom sliders */}
          {optionId === 'custom' && (
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 p-4 border border-line rounded-lg bg-bg-raised">
              <DensitySlider
                label="Font size scale"
                min={0.85}
                max={1.15}
                step={0.01}
                value={effectiveDensity.fs}
                fmt={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => updateCustom('fs', v)}
              />
              <DensitySlider
                label="Line height"
                min={1.2}
                max={1.8}
                step={0.05}
                value={effectiveDensity.lh}
                fmt={(v) => v.toFixed(2)}
                onChange={(v) => updateCustom('lh', v)}
              />
              <DensitySlider
                label="Section padding scale"
                min={0.6}
                max={1.5}
                step={0.05}
                value={effectiveDensity.pad}
                fmt={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => updateCustom('pad', v)}
              />
              <DensitySlider
                label="Item spacing scale"
                min={0.6}
                max={1.5}
                step={0.05}
                value={effectiveDensity.gap}
                fmt={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => updateCustom('gap', v)}
              />
            </div>
          )}
        </div>
      )}

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

      {/* Single preview iframe with density applied */}
      <Panel
        title="Preview"
        subtitle={`acreos.io${previewSurface}${isDensity && optionId ? ` · ${optionId}` : ''}`}
        accent={Boolean(optionId)}
      >
        <ScaledIframe
          ref={iframeRef}
          src={previewSurface}
          width={bp}
          visibleHeight={visibleHeight}
          zoom={zoom}
        />
      </Panel>
    </div>
  );
}

function DensitySlider({
  label,
  min,
  max,
  step,
  value,
  fmt,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-ink-2">{label}</span>
        <span className="tabular-nums text-ink-3">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

function Panel({
  title,
  subtitle,
  children,
  accent = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`border rounded-xl overflow-hidden bg-bg-raised shadow-acr-1 transition-colors ${
        accent ? 'border-brand ring-2 ring-brand-soft' : 'border-line'
      }`}
    >
      <div className={`px-3.5 py-2 border-b ${accent ? 'border-brand/30 bg-brand-soft' : 'border-line'}`}>
        <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${accent ? 'text-brand' : 'text-ink-3'}`}>
          {title}
        </div>
        <div className="text-[10px] text-ink-3 truncate mt-0.5" title={subtitle}>{subtitle}</div>
      </div>
      <div className="bg-bg-sunken overflow-hidden">{children}</div>
    </div>
  );
}

interface ScaledIframeProps {
  src: string;
  /** Logical breakpoint width the iframe renders at (e.g., 1440). */
  width: number;
  /** Height of the visible viewport (after scaling). */
  visibleHeight: number;
  /** User zoom multiplier on top of fit-to-container. 1 = fits exactly. */
  zoom: number;
}

/**
 * Renders an iframe at its native breakpoint width (e.g., 1440px) but scales
 * it via CSS transform so it fits the actual container width. The user's zoom
 * slider is a multiplier on top of the fit scale, so zoom=1 always fits the
 * column exactly and zoom>1 reveals more detail with horizontal scroll.
 *
 * Without this, a 1440px iframe inside a ~400px column with `overflow:hidden`
 * shows only the leftmost ~28% of the page (which is exactly what the founder
 * saw — the prototype's left sidebar with the right side clipped).
 */
const ScaledIframe = forwardRef<HTMLIFrameElement, ScaledIframeProps>(
  ({ src, width, visibleHeight, zoom }, ref) => {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (w > 0) setContainerWidth(w);
        }
      });
      observer.observe(wrapper);
      // Initial measurement
      setContainerWidth(wrapper.getBoundingClientRect().width);
      return () => observer.disconnect();
    }, []);

    // Fit scale makes the iframe render at exactly the container width.
    // Effective scale applies user zoom on top.
    const fitScale = containerWidth > 0 ? containerWidth / width : 1;
    const effectiveScale = fitScale * zoom;
    // The transform-scaled iframe occupies (width × effectiveScale) horizontally.
    // When zoom > 1 this exceeds container width → horizontal scroll appears.
    const scaledTotalWidth = width * effectiveScale;
    const scaledTotalHeight = visibleHeight; // visible viewport height, fixed

    // Inner iframe height is set so visibleHeight / effectiveScale yields
    // enough native pixels to fill the visible viewport vertically too.
    const innerHeight = effectiveScale > 0 ? Math.ceil(visibleHeight / effectiveScale) : visibleHeight;

    return (
      <div
        ref={wrapperRef}
        style={{
          width: '100%',
          height: scaledTotalHeight,
          overflowX: zoom > 1 ? 'auto' : 'hidden',
          overflowY: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: scaledTotalWidth,
            height: scaledTotalHeight,
            position: 'relative',
          }}
        >
          <iframe
            ref={ref}
            src={src}
            width={width}
            height={innerHeight}
            style={{
              transform: `scale(${effectiveScale})`,
              transformOrigin: 'top left',
              border: 0,
              display: 'block',
            }}
            // No sandbox — same-origin needed for window.__nav() on prototype
            // and Clerk session cookies on production. Dev-only / gated.
          />
        </div>
      </div>
    );
  }
);
ScaledIframe.displayName = 'ScaledIframe';
