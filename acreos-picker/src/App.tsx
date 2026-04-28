import { useMemo, useState, useEffect } from 'react';
import { CATEGORIES, DECISIONS, type Decision, type CategoryId } from './inventory';

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

export default function App() {
  const [selections, setSelections] = useState<Selections>(loadSelections);
  const [activeId, setActiveId] = useState<string>(DECISIONS[0]?.id ?? '');

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

  const decided = Object.keys(selections).length;
  const total = DECISIONS.length;

  const activeDecision = DECISIONS.find((d) => d.id === activeId);
  const activeIndex = DECISIONS.findIndex((d) => d.id === activeId);
  const canPrev = activeIndex > 0;
  const canNext = activeIndex < DECISIONS.length - 1;

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
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-2 tabular-nums">
            {decided} of {total} decided
          </span>
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
          {CATEGORIES.map((cat) => (
            <section key={cat.id} className="border-b border-line last:border-b-0">
              <div className="px-4 py-3 sticky top-0 bg-bg-raised z-10">
                <div className="text-xs font-semibold uppercase tracking-widest text-ink-3">
                  {cat.title}
                </div>
                <div className="text-xs text-ink-3 mt-0.5">{cat.description}</div>
              </div>
              <ul>
                {groupedByCategory[cat.id].map((d) => {
                  const isActive = d.id === activeId;
                  const isDecided = Boolean(selections[d.id]?.optionId);
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
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            isDecided ? 'bg-brand' : 'bg-ink-3/30'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{d.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
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
          onClick={() => canPrev && setActiveId(DECISIONS[activeIndex - 1].id)}
          className="px-3 py-1.5 rounded-lg disabled:opacity-30 hover:bg-surface"
        >
          ← Previous
        </button>
        <span className="text-ink-3 tabular-nums">
          {activeIndex + 1} / {total}
        </span>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => canNext && setActiveId(DECISIONS[activeIndex + 1].id)}
          className="px-3 py-1.5 rounded-lg disabled:opacity-30 hover:bg-surface"
        >
          Next →
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

      {/* Three-panel placeholder — D.6.3 will fill this in with iframes */}
      {decision.surface && (
        <div className="border border-line rounded-lg overflow-hidden mb-6 bg-bg">
          <div className="grid grid-cols-3 divide-x divide-line text-xs uppercase tracking-widest text-ink-3">
            <div className="px-3 py-2 text-center">Prototype</div>
            <div className="px-3 py-2 text-center">Production (acreos.io)</div>
            <div className="px-3 py-2 text-center">Preview</div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-line h-96">
            <PanelPlaceholder label="Prototype iframe — D.6.3 wires Babel-rendered prototype" />
            <PanelPlaceholder
              label={`Production iframe — D.6.3 wires <iframe src="${decision.surface}"> (same-origin via /__dev/picker/ hosting)`}
            />
            <PanelPlaceholder label="Preview iframe — applies pending selection state" />
          </div>
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

function PanelPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center p-4 text-xs text-ink-3 text-center">
      {label}
    </div>
  );
}
