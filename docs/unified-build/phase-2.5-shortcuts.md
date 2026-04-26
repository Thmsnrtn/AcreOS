## Phase 2.5 — Keyboard shortcuts: audit + close

### Production already has comprehensive shortcut infrastructure

| Component | Location | Role |
|---|---|---|
| `KeyboardShortcutsProvider` context | `client/src/hooks/use-keyboard-shortcuts.tsx` | Global key listener with two-letter chord support, register/unregister API |
| `KeyboardShortcutsModal` (help dialog) | `client/src/components/keyboard-shortcuts.tsx` | Categorized reference with Navigation, Create, Actions, AI, Help groups; opens via `?` |
| `Kbd` primitive | `client/src/components/ui/kbd.tsx` | shadcn-style key cap |

### Mega prompt §2.5 standard shortcuts: status

| Shortcut | Mega prompt §2.5 | Production status |
|---|---|---|
| ⌘K / Ctrl+K — command palette | Required | ✅ wired in `command-palette.tsx:244` (separate listener from the shortcuts hook by design — palette owns its open state) |
| ⌘N / Ctrl+N — quick offer | Required | ⏳ deferred to Phase 5.5 (QuickOffer modal not yet built) |
| `?` — keyboard shortcuts help | Required | ✅ `use-keyboard-shortcuts.tsx:78` |
| Escape — close modal/drawer/palette | Required | ✅ `use-keyboard-shortcuts.tsx:93-99` + per-component handlers |
| `/` — focus search | Required | ✅ `use-keyboard-shortcuts.tsx:79` |
| `data-tour="cmd-palette-trigger"` | Required | ✅ added in Phase 2.2 (3 surfaces) |
| `data-tour="quick-offer"` | Required | ⏳ deferred to Phase 5.5 |

### Documented but not wired (fidelity gap)

The help modal at `keyboard-shortcuts.tsx:14-72` documents ~28 shortcuts, but only 9 are actually wired in `use-keyboard-shortcuts.tsx`. The unwired ones (`g c`, `g m`, `g t`, `n`, `d`, `c`, `⌘N`, `f`, `e`, `m`, `⌘E`, `⌘/`, `⌘Z`, `a`, `⌘J`, `⌘?`) describe planned bindings for features built in Phases 3-7. Each gets wired alongside its feature:

| Shortcut | Wired by phase |
|---|---|
| `n` (new lead), `d` (new deal), `c` (new campaign) | Phase 3 (pipeline core), Phase 4 (campaigns) |
| `⌘N` (quick offer) | Phase 5.5 (QuickOffer modal) |
| `f` (filter), `e` (edit), `m` (message), `⌘E` (export) | Phase 3-5 (per surface) |
| `⌘/` (toggle sidebar) | Phase 2 follow-up if not satisfied by sidebar collapse button |
| `⌘Z` (undo) | Phase 9 — needs cross-surface undo store |
| `g c` (campaigns), `g m` (maps), `g t` (team inbox) | Phase 4-6 (when those routes are canonicalized) |
| `a` (Atlas), `⌘J` (Atlas sidebar) | Phase 3 (Atlas Run on parcel detail) |
| `⌘?` (help panel) | Phase 6.4 (Settings → Help) |

The Phase 9 Final Coherence Pass audits this list — anything still documented-but-unwired at that point is either wired or removed from the help modal.

### Per-Surface Fidelity reference

The prototype has no central keyboard-shortcuts module — shortcuts in `acreos/command-palette.jsx:48-56` (Escape, arrow keys, Enter inside the palette only) and per-item chord hints (`G H`, `N D`) are illustrative, not dispatched. Production's comprehensive `useKeyboardShortcuts` provider is genuine production-original infrastructure.

### No code change for Phase 2.5

Audit-only close. Future shortcut wiring lands with its owning feature.
