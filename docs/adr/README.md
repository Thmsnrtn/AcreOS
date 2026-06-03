# Architecture Decision Records (ADR)

This directory holds the canonical written record of architectural decisions
Iris (or any contributor) has made on AcreOS's behalf. The goal is *no
decision lost to tribal memory* — when an engineer in 2027 asks "why did we
build it this way," the answer is in the ADR, with the reasoning Iris had
at the time of the call.

## What gets an ADR

Write an ADR for any decision that:

1. **Constrains future code.** A choice of ORM, deployment target, data
   model discriminator, or auth shape that downstream surfaces will assume.
2. **Trades off two genuinely viable options.** "Polymorphic note_table
   discriminator vs separate audit ledgers per note type" — both work; the
   ADR records *why* one was picked.
3. **Touches a regulated surface.** Reg Z / RESPA / TCPA / CCPA decisions
   need the reg-section cite + the adversarial scrutiny Beatrice applied,
   so the next examiner-style audit doesn't re-litigate the same ground.
4. **Will be invisible from code alone.** Implementation that looks
   arbitrary unless you read the ADR — naming conventions, edge-case
   handling, idempotency-key design.

What does NOT need an ADR: bug fixes, refactors with no semantic change,
copy edits, schema additions that only add columns (those go in the
commit message + the schema-file header comment).

## File naming

`NNN-kebab-case-headline.md` where `NNN` is a 3-digit sequence number,
starting from `001` and rising monotonically. Never re-use a number; if
an ADR is superseded, write a new one and link back to the original with
a `Supersedes ADR-NNN` line.

## Status values

- **Proposed** — written but not yet approved. Iris drafts; Solene
  (or Tom for strategic ones) approves before status flips to Accepted.
- **Accepted** — the decision is in force. New code follows it.
- **Deprecated** — the decision still describes how the system works but
  shouldn't be applied to new code. A successor ADR usually exists.
- **Superseded by ADR-NNN** — replaced. The old file stays for history;
  the link points forward.

## Template

Copy [`_template.md`](_template.md) for new ADRs. The template enforces
the four sections every ADR must have: Context, Decision, Rationale,
Consequences. Skipping any section means the decision wasn't actually
made — re-think before merging.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| 001 | [Session Auth over JWT](001-session-auth-over-jwt.md) | Accepted | 2025-01-06 |
| 002 | [Drizzle ORM over Prisma](002-drizzle-orm-over-prisma.md) | Accepted | 2025-01-06 |
| 003 | [BullMQ Job Queue](003-bullmq-job-queue.md) | Accepted | 2025-01-06 |
| 004 | [Multi-tenant Row Isolation](004-multi-tenant-row-isolation.md) | Accepted | 2025-01-06 |
| 005 | [Fly.io Deployment](005-fly-io-deployment.md) | Accepted | 2025-01-06 |
| 006 | [AES-256-GCM Field Encryption](006-aes-256-gcm-field-encryption.md) | Accepted | 2025-01-06 |
| 007 | [React + Vite Frontend](007-react-vite-frontend.md) | Accepted | 2025-01-06 |
| 008 | [OpenAI as AI Provider](008-openai-as-ai-provider.md) | Accepted | 2025-01-06 |
| 009 | [Stripe for Billing](009-stripe-for-billing.md) | Accepted | 2025-01-06 |
| 010 | [PostgreSQL Multi-tenant Schema](010-postgresql-multi-tenant-schema.md) | Accepted | 2025-01-06 |
| 011 | [Polymorphic note_table Discriminator on periodic_statement_skips](011-polymorphic-note-table.md) | Accepted | 2026-06-02 |

When adding a new ADR, update this table in the same commit.

## Discipline

Iris reviews this index quarterly. Decisions that have visibly drifted
from their original ADR (the code no longer matches what the ADR says)
trigger one of two follow-ups: (a) the code is brought back into compliance,
or (b) a new ADR documents the drift and supersedes the original. *Silent
drift is the failure mode this directory exists to prevent.*
