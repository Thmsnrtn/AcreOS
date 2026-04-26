## Phase 2.4 — Command palette: audit + programmatic open

### Per-Surface Fidelity reference
Prototype: `acreos/command-palette.jsx` (132 lines) — already documented in the file header of `client/src/components/command-palette.tsx`.

### Production palette already meets §2.4 structural requirements

| Mega prompt §2.4 requirement | Status |
|---|---|
| ⌘K / Ctrl+K toggle | ✅ `command-palette.tsx:244` |
| Search across nav, actions, deals, parcels, contacts, docs | ✅ Pages, Quick actions, Search results (leads/deals/properties), Founder/admin, Ask your team |
| Keyboard navigation (arrows, Enter, Escape) | ✅ shadcn `Command` primitive |
| Categorized results | ✅ `CommandGroup heading="…"` |
| Fuzzy search | ✅ shadcn Command default |
| Recent items shown when empty | ✅ `useQuery(["/api/recent-items"])` |
| Focus management | ✅ shadcn Command + `inputRef.current.focus()` |
| ARIA combobox / proper announcements | ✅ Radix primitive |
| `role="dialog"` + `aria-modal` | ✅ `command-palette.tsx:388-390` |
| Mobile usable | Partial — see gap below |

### What this commit added (Phase 2.2 structural plumbing)

Added a `acreos:open-command-palette` CustomEvent listener so non-keyboard surfaces (mobile drawer, sidebar search button) can open the palette without dispatching synthetic keyboard events.

### Mobile gap closed

Before Phase 2.2: mobile users had no way to open the palette (no ⌘K on touch devices, no visible trigger anywhere).

After Phase 2.2: mobile drawer header includes a full-tap-target "Search or jump to…" button that closes the drawer and opens the palette via the new custom event.

### Fidelity gaps deferred to Phase 9

The production palette is pre-existing elite-refinement work. Per the principle ("don't redo work for surfaces already implemented"), the following gaps are logged but not fixed mid-flight:

1. **Placeholder copy.** Production: "Search pages, actions, or type a question..." Prototype: "Search or ask AcreOS…". Prototype is shorter, brand-led, more confident.
2. **Bottom keyboard-hint footer.** Prototype shows `↑↓ navigate · ↵ open · ⌘J ask` at the bottom for discoverability. Production has no footer.
3. **Per-item chord shortcuts.** Prototype shows `G H` (go-home), `N D` (new-deal), `G P` (pipeline) etc. on the right of each item. Production omits these.
4. **Width.** Production `max-w-[640px]` vs prototype `max-width: 560px`. Marginal.
5. **Empty state copy.** Prototype's "Ask AcreOS '<query>' — Press ↵ to send as a question to AcreOS Intelligence" is a stronger fallback than the production behavior.

The reference header in `command-palette.tsx` enumerates all of these so the Phase 9 Final Coherence Pass can pick them up systematically.
