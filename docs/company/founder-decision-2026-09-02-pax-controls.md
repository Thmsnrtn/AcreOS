# Pax controls — decision record (2026-09-02)

Program: customer autonomy clarity (founder directive 2026-09-02). Spec:
`docs/autonomous/AUTONOMY_SPEC.md` §9 posed ten questions. Disposition
rule applied: the master-directive amendment says "do not ask the founder
to approve routine fixes", and the founder's standing posture is already
recorded for the one strategic question — so every question's RECOMMENDED
option is adopted below as an institutional decision, each with the
authority it rests on. The founder may rescind any line explicitly.

| # | Question | Adopted | Authority |
|---|---|---|---|
| 1 | Pax-written messages ever unattended? | **No** — every message Pax writes waits for a tap at every stance. `OFFERED_STANCES` + `STANCE_RULINGS` is the single lever; widening requires a dated founder ruling. | Standing posture: `docs/internal/roadmap/founder-autopilot-2026-06-16.md` §5 "Customer-facing Pax keeps witnessed-send regardless" (unchanged). **The one strategic lever the founder may pull later.** |
| 2 | Two-way seller conversations | **Draft-and-wait** (wave 2): inbound SMS/email → Pax drafts → queue → one tap from the customer's own number. | Inside the posture; Carrot's shipped default. |
| 3 | Borrower payment reminders | **Prepare only**; each rung waits for a tap; preparation switchable off. | Today's real behaviour made visible; collection notices are consequential sends. |
| 4 | "Ask before everything" covers the customer's own chat commands | **Yes, uniformly** — one sentence, inline card, one tap. | Product judgment (simplicity judge 9/10). |
| 5 | Default stance for new orgs | **Ask before sending** — today's behaviour; nothing changes silently on deploy. | No-silent-change rule. |
| 6 | Pause durations | Tomorrow 8am / 3 days / until I resume (30-day safety lift). | UX judgment; Friday pause survives the weekend. |
| 7 | Customer "Tasks / Deploy Agent" tab + no-UI autonomy APIs | **Delete** the tab and processor; founder-gate `PUT /api/autonomous/agents/:type/config`, VA PATCH, `POST /api/scheduled-tasks`; delete `process-autonomous`; founder readers of `agent_tasks` stay (table has other live users). | Consolidate→delete doctrine; deletion dossier shows the lane is a dead-letter queue with an invented price. |
| 8 | Support billing fixes | Retry / update-method / resync / reset become kernel asks; **`apply_credit` is model-unreachable and routes to the founder** (pricing hard-stop). | Hard-stops founder-only (constitution). |
| 9 | Where the page lives | `/settings/pax` nested; first card in the Settings bucket renamed "Pax & connections"; **no 8th tab**. | Five-doors rule; Robert's tab-count evidence. |
| 10 | Voice | Remove the "Voice — Ready" badge and every voice mention. | No-fabrication. |

## Binding vocabulary (from the spec)

Two stances — **Ask before sending** (default) · **Ask before everything** —
one state above them (**Paused**), one queue (**Waiting for your tap**), one
receipt (**What Pax did**), one fixed **Never** list. All customer-visible
strings in `shared/pax-glossary.ts`; banned words are ratcheted.
