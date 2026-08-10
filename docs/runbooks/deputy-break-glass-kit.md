# Deputy break-glass kit — keeping the company alive without the founder

> **KEEP A COPY OF THIS OUTSIDE THE APP.** This is the document a trusted
> deputy reads when the founder cannot be reached. If it only exists inside
> AcreOS, it does not exist. Print it, or keep the emailed copy of its
> companion card (Controls → "Email me the break-glass card").

**What this is.** AcreOS is run by one person. This kit is the answer to the
question a customer, an investor, and a spouse all eventually ask: *what
happens if you are unreachable?* It names what a deputy would need, what a
deputy may do, what a deputy may **never** do, and who to call.

**What this is NOT.** It is not a claim that a deputy is in place. Most of
this kit is deliberately, visibly **incomplete** today — naming a deputy,
executing their written authority, and handing them credential custody are
founder acts, not code. The gaps below are *counted*, not hidden.

**Companions.**

- `docs/runbooks/break-glass-card.md` — the outage card ("is AcreOS dark?").
  Read that first if the symptom is *the site is down*.
- `docs/runbooks/08-founder-out-of-office.md` — who handles which severity
  while the founder is away.
- `docs/runbooks/founder-account-recovery.md` — getting back into the founder
  account.
- `docs/runbooks/break-glass-log.md` — the append-only log of every
  outside-the-normal-path action. **A deputy writes here.**

**Where the real copy lives.** The deployed application **cannot read this
file** — `docs/` is excluded from the production image to keep the build small,
which is also why the "email me the break-glass card" button cannot find its
card in production. The copies that count are: the repository, the printed
page, and whatever the deputy has in their own hands. Assume the app is no
help here; that is the situation this kit is for.

**Machine-read.** `server/services/continuityKit.ts` parses this file and
derives which pieces are actually in place; the Controls door renders that
read, and `tests/unit/continuityKit.test.ts` fails the build if a piece is
claimed without evidence or if this kit ages past its review interval. Nothing
in this document is trusted because it is written down — only because it
resolves.

---

## Kit declarations (machine-read)

The parser reads the block below. A value in parentheses — `(none named)`,
`(none executed)`, `(none provisioned)` — is a **placeholder** and derives as
**absent**. Replacing a placeholder with a real value is what puts a piece in
place; there is no other way to make one show up as present.

<!-- continuity-kit:declarations -->

```
kit-version: 1
deputy-name: (none named)
deputy-contact: (none named)
deputy-authority-doc: (none executed)
credential-custody: (none provisioned)
founder-emergency-contact: (none named)
```

Each of those five is a **founder act with a real-world cost**: choosing a
person, paying a lawyer to write a limited authority, and provisioning
emergency access in the password manager. They are listed as placeholders on
purpose — an invented name here would be worse than an empty one.

---

## 1. What a deputy may do

The permitted list lives in code (`server/services/continuityKit.ts`), not in
prose, so the Controls door and this document can never disagree about it.
In plain words, a deputy may:

- **Prove whether it is really down** and, if it is, follow the outage card:
  restart a stopped machine at the hosting provider, read the watchdog runs,
  and check the vendors' own status pages.
- **Trip the panic stop** (see §3) — stopping the machine is always allowed.
  Stopping is safe; starting is not.
- **Answer customers** using the message in §4 — acknowledge, never improvise,
  never promise a date.
- **Escalate to vendors** (hosting, payments, paging) using the contacts in the
  outage card.
- **Follow any numbered runbook** in `docs/runbooks/_index.md` — those are
  written for an on-call reader, not for the founder specifically.
- **Write every action down** in `docs/runbooks/break-glass-log.md`, before and
  after. An action nobody logged did not happen.

The default when a deputy is unsure is in runbook 08 and it is the right one:
**delay beats damage.** A 24-hour wait rarely kills a deal; an irreversible bad
call often does.

---

## 2. What a deputy may NEVER do — the non-delegable hard stops

These are constitutional. They are recorded in `shared/governance/constitution.ts`,
enforced in code, and they are **founder-only forever**. They cannot be
delegated to a deputy, to staff, to the autopilot, or to anyone else — not
during an absence, not during an emergency, not to save an account. There is
no emergency exception, because an emergency is exactly when someone would want
one.

| Hard stop | Constitution id |
|---|---|
| Pricing, tier, or allowance changes | `hard-stop.pricing-changes` |
| Signing or executing anything legally binding | `hard-stop.legal-signing` |
| Any spend over $500 | `hard-stop.spend-over-500` |
| Destructive deletion of customer data | `hard-stop.customer-data-deletion` |
| Moving customer money on an AcreOS account | `hard-stop.no-platform-money-custody` |
| Merging an autonomous self-patch | `hard-stop.self-patch-never-merges` |

`server/services/continuityKit.ts` derives this list from the constitution
rather than repeating it, and **refuses** any proposed deputy permission that
names one of these ids. A permission for a hard stop is not a policy question;
it is unrepresentable.

If a decision genuinely requires one of the above and the founder cannot be
reached, the answer is **wait**. Write the request in
`docs/runbooks/break-glass-log.md` with the date and the reason it could not
wait; the founder dispositions it on return.

---

## 3. The panic stop

The panic stop halts the autopilot: no outbound sends, no autonomous
dispatches, nothing reaches a customer. It is the one destructive-looking
control that is always safe to use, because coming back online is a separate,
staged, founder-gated act (guided resume never restores trust levels — the
founder re-grants them one at a time).

**How to reach it.**

1. **From inside the app** — the Controls door (`/founder/autopilot/control`)
   carries the stop button, which calls `POST /api/founder/autopilot/panic-stop`
   (implemented in `server/services/autopilot/panicStop.ts`).
2. **Honest limitation:** that route is founder-gated. **A deputy can only use
   it if credential custody has been provisioned** — and today
   `credential-custody` is a placeholder above, so *a deputy cannot currently
   trip the in-app panic stop*. This is a real gap, stated rather than papered
   over.
3. **The gap's workaround, until custody exists:** stopping the application
   machines at the hosting provider stops all outbound work too. It is blunter
   (the product goes dark for customers, including their portals) and it is a
   worse outcome than the in-app stop — which is precisely why credential
   custody is worth provisioning before an absence that matters.

Whoever trips it writes the reason in `docs/runbooks/break-glass-log.md`
immediately. The founder resumes; the deputy does not.

---

## 4. What to tell customers

Say the true thing, briefly, and never invent a timeline. The message below is
the whole script; a deputy does not need to improvise, and should not.

> "Thanks for reaching out — I'm covering for AcreOS while the founder is
> unreachable. I've logged your message and it's in the queue. I'm not able to
> make pricing, contract, or account-deletion decisions, so anything of that
> kind waits for the founder rather than getting a wrong answer from me.
> Your data is untouched, and your own connected accounts — your mail, your
> phone number, your payment processor — keep working independently of us."

Rules that go with it:

- **Never** commit to a return date the deputy does not know.
- **Never** answer a press or legal question on substance. Acknowledge receipt,
  forward, stop.
- **Never** claim the founder is fine or unwell. "Unreachable" is the only
  status a deputy actually knows.
- Anything money-shaped, contract-shaped, or deletion-shaped is §2. Wait.

---

## 5. Where everything is

| What | Where | Notes |
|---|---|---|
| Outage triage (hosting, code, payments, paging) | `docs/runbooks/break-glass-card.md` | Login URLs and vendor escalation paths |
| Severity routing while the founder is away | `docs/runbooks/08-founder-out-of-office.md` | P0/P1/P2 and who takes what |
| Locked out of the founder account | `docs/runbooks/founder-account-recovery.md` | |
| Database restore | `docs/runbooks/07-database-restore-from-snapshot.md` | Drill history: `docs/runbooks/dr-drill-history.md` |
| Every other runbook | `docs/runbooks/_index.md` | |
| Action log (write here) | `docs/runbooks/break-glass-log.md` | Pre-action note, then post-action note |
| Dated obligations that fall due | `server/services/datedObligations.ts` | Rendered on the Controls door |
| The readiness read for this kit | Controls door → "If you cannot be reached" | Derived from this file |

**Last vacation-test drill: NONE — never run.** The 7-day hands-off drill
(P5 §6.3) is a founder act and has not happened. Nothing in the product claims
otherwise, and this line is what the founder surface reads as unproven.

---

## 6. Review ledger (append-only)

This kit is only as good as its last read-through. It **expires after 100
days**; past that the Controls door shows it stale and the build fails. One
block per review, newest at top.

Format:

```
YYYY-MM-DD  reviewed-by=<github-login>
            pieces-present=<n>/<total>  changed: <what changed>
```

CI parses each block's leading `YYYY-MM-DD  reviewed-by=` line
(`tests/unit/continuityKit.test.ts`), exactly as the DR ledger's freshness
ratchet does. Zero blocks is honest-dormant — this file must keep saying so
below — but once the first block lands, the newest block must stay within the
100-day interval or the build fails.

A review means: walk §1–§5, confirm every declaration above is still true
(people move, phone numbers change, password-manager access lapses), correct
what drifted, then append a block.

---

(no reviews recorded yet — the first review lands the first block)
