# Plan 7 — Email deliverability

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Establish that mail AcreOS sends is authenticated and lands in the inbox, for
both kinds of mail the product sends:

- **System mail** from AcreOS's own domain to AcreOS users (sign-up,
  notifications, billing). This is the only mail the platform sender may send.
- **Counterparty mail** sent by a customer organization to its own contacts,
  which must go out on that **organization's own** connected identity
  (founder decision 2026-07-17; see plan 4). Its deliverability depends on the
  customer's domain, so the product's job is to make correct setup possible,
  checkable and honest.

## Why the campaign could not cover it

The campaign sent no real mail and resolved no public DNS for a sending
domain. Its own gap list names SPF/DKIM/DMARC on BYO identities, one-click
unsubscribe, and the bounce → suppression → do-not-contact loop as
unexercised.

## Existing tooling and records

- `scripts/audit-email-deliverability.mjs` — resolves SPF, DKIM, DMARC and MX
  for a domain and reviews welcome-email content. **By default it writes a
  dated report into `docs/internal/`**; pass `--out=<scratch path>` so a run
  does not create a repository file by accident. Exit codes: 0 clean,
  1 warnings, 2 critical.
- `scripts/ses-setup.mjs` and `.github/workflows/ses-dkim-fix.yml` — SES
  domain and Easy DKIM set-up / remediation.
- Runbooks: `docs/runbooks/ses-dkim-failure.md`,
  `docs/runbooks/ses-bounce-spike.md`,
  `docs/runbooks/05-mass-email-bounces-spike.md`.
- Code: `server/routes-ses-events.ts` (bounce/complaint events via SNS),
  `server/services/emailSuppressions.ts`, `server/services/unsubscribeTokens.ts`,
  `server/routes-deliverability.ts`, `server/services/orgEmailIdentity.ts`,
  and the `List-Unsubscribe` handling in `server/services/emailService.ts`.

## Environment and prerequisites

- Public DNS read access (no credentials) for the system-mail domain.
- Staging with SES configured (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_SES_REGION`, `AWS_SES_FROM_EMAIL`, `SES_DOMAIN`) and **out of the SES
  sandbox**, or production for system-mail placement only (system mail to
  tester-owned seed addresses is the one production send this plan allows).
- A test customer domain owned by the tester, connected as a BYO sending
  identity on a staging test organization.
- A seed list of tester-owned mailboxes across major providers: Gmail
  (consumer), a Google Workspace tenant, Outlook.com, a Microsoft 365 tenant,
  Yahoo, iCloud. A commercial seed-list placement service may substitute or
  add to this; record which one was used.
- Access to Google Postmaster Tools and Microsoft SNDS for the system-mail
  domain, if registered.

## Procedure

### Part A — authentication records

1. Run the audit against the system domain, writing outside the repository,
   and record the exit code and every warning:

   ```bash
   node scripts/audit-email-deliverability.mjs audit --domain=<system-domain> \
     --out=<scratch>/deliverability-system.md; echo EXIT=$?
   ```

2. For the system domain and the test BYO domain, record: SPF record and
   lookup count (must stay within the 10-DNS-lookup limit); each DKIM selector
   resolves and SES reports DKIM success; DMARC record present with policy
   and reporting address; MX present.
3. Send one message of each kind and inspect the received headers at a seed
   mailbox: `spf=pass`, `dkim=pass` with a `d=` domain aligned to the visible
   From, `dmarc=pass`.

### Part B — mailbox-provider bulk-sender requirements

Reconfirm the current published requirements of Gmail and Yahoo for bulk
senders at run time, then check each against real headers: aligned
authentication, a DMARC record, one-click unsubscribe (`List-Unsubscribe` and
`List-Unsubscribe-Post`, RFC 8058) on marketing and campaign mail, prompt
honouring of unsubscribe, and a low reported spam rate in Postmaster Tools.

4. Send a campaign message from the test org to a seed mailbox; use the
   mailbox's own unsubscribe control; confirm the recipient is suppressed in
   the app and the next campaign excludes them.
5. Confirm transactional system mail (e.g. sign-in or billing) does or does
   not carry an unsubscribe header per the founder's chosen policy.

### Part C — placement

6. Send the representative message set (welcome, notification, billing
   receipt, one counterparty campaign message from the BYO domain) to the seed
   list. Record, per provider and message: inbox / promotions or other tab /
   spam / missing.
7. Repeat after any DNS or content change, never compared across different
   message sets.

### Part D — the feedback loop

8. Send to SES bounce and complaint simulator addresses from the staging org;
   confirm `POST /api/webhooks/ses/events` receives the SNS notification, the
   address lands in `email_suppressions`, and the next send to it is skipped
   and not charged.
9. Confirm whether a hard bounce or complaint also sets the lead's
   do-not-contact state across channels, and record the behaviour for the
   founder; the campaign's gap list names this loop.

## Pass criteria

- Part A: SPF, DKIM and DMARC all pass and align for both domains;
  `audit-email-deliverability.mjs` exits 0, or every warning is explained.
- Part B: each current provider requirement is met for the mail it applies to.
- Part C: inbox placement at or above **[TARGET — founder to confirm]** per
  provider for system mail; no message type lands in spam at any provider
  without a filed follow-up.
- Part D: every simulated bounce and complaint is suppressed and not re-sent.
- **Fail:** any authentication failure or misalignment; missing one-click
  unsubscribe on campaign mail; any send to a suppressed address.

## Results

Not yet run.

## Still owed

- An owner and a date.
- The seed list (mailboxes or a placement service) and Postmaster / SNDS
  registration.
- Founder decisions: inbox-placement target; DMARC policy for the system
  domain (`none` / `quarantine` / `reject`); unsubscribe policy for
  transactional mail; whether a bounce or complaint should set do-not-contact.

## Run log

_(empty — append entries per the format in [README](README.md))_
