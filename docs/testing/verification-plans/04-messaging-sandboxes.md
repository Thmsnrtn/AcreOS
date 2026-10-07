# Plan 4 — Twilio, SES and Lob sandboxes (SMS, email, direct mail)

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Exercise each outbound channel against its provider's sandbox or test mode,
including the inbound callbacks each provider sends back, and confirm that
counterparty mail goes out only on the sending organization's **own**
connected identity.

## The rule this plan must respect

**No re-fronting platform send rails** (founder decision 2026-07-17,
CLAUDE.md DO-NOT-DO list). Counterparty mail — anything addressed to a lead,
seller, borrower or other party the customer deals with — requires the
organization's own connected identity (BYO). The platform sender is for
**system mail only** (AcreOS talking to its own users). In code:

- Email: the `system` / `counterparty` send lanes in
  `server/services/emailService.ts`; org identity in
  `server/services/orgEmailIdentity.ts`; pinned by
  `tests/unit/outboundEmailChokepoint.test.ts`.
- SMS: `server/services/smsService.ts` sends counterparty SMS with
  `requireByoIdentity: true` and checks for the org's own Twilio
  (`orgHasByoTwilio`).
- Direct mail: `server/services/lobService.ts` resolves the client through
  `getLobClient` in `server/services/directMailService.ts` (BYOK vault →
  legacy org integration → platform key under the live-send interlock in
  `server/services/mail/liveSendInterlock.ts`). The lobService header records
  that removing the Lob platform fallback was explicitly **deferred** by the
  founder (`tests/unit/lobCredentialAuthority.test.ts`); this plan records
  the current behaviour and does not decide that question.

## Why the campaign could not cover it

No live provider was configured. The campaign checked signature rejection of
forged Twilio and inbound-email callbacks and the SMS STOP path locally, but
no message left the machine, no provider callback was real, and no
provider-side record was compared with the app's.

## Environment and prerequisites

Staging (or a local build behind a public tunnel so providers can reach the
callbacks). Secrets by name only:

| Channel           | Platform (system lane)                                                                                                  | Organization BYO (counterparty lane)                                            | Callbacks                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| SMS — Twilio      | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`                                                        | The test org's own Twilio credentials, entered through the app's connector flow | `POST /api/webhooks/twilio/sms`, `/sms-status`, `/recording-status` (`server/routes-misc.ts`, `verifyTwilioSignature`)         |
| Email — SES       | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SES_REGION`, `AWS_SES_FROM_EMAIL`, `AWS_SES_FROM_NAME`, `SES_DOMAIN` | The test org's own sending identity, connected through the app                  | `POST /api/webhooks/ses/events` (`server/routes-ses-events.ts`, SNS signature check in `server/middleware/snsVerification.ts`) |
| Direct mail — Lob | `LOB_TEST_API_KEY` (test), with `LOB_LIVE_API_KEY` and `LOB_LIVE_SEND_ENABLED` **unset**                                | The test org's own Lob **test** key in the BYOK vault                           | `POST /api/webhooks/lob` (`server/routes/lob-webhooks.ts`, `LOB_WEBHOOK_SECRET`)                                               |

Provider sandbox notes (reconfirm against each provider's current docs at run
time):

- **Twilio:** test credentials do not deliver to handsets and do not fire
  status callbacks; use them for request-shape and error-path checks, and a
  trial or dedicated test subaccount sending only to tester-owned handsets for
  delivery and callbacks. US A2P 10DLC registration status of the sending
  number must be recorded, because it affects delivery.
- **SES:** an account in the SES sandbox can send only to identities it has
  confirmed; the SES mailbox simulator addresses produce delivery, bounce,
  complaint and suppression-list outcomes without touching a real mailbox.
- **Lob:** test-mode keys create letters and postcards that are never printed
  or mailed, and still produce previews and events.

Use only tester-owned phone numbers and mailboxes. Never a customer contact.
Do not set `MAIL_MOCK=1` for this plan — it short-circuits the provider call
(`server/services/mailProvider.ts`).

## Procedure

For each channel, run both lanes and both identity states:

1. **System lane.** Trigger a system message (e.g. an account notification to
   the tester's own user). Expect it to send from the platform identity.
2. **Counterparty lane, BYO connected.** As a test org with its own identity
   connected, send to a test lead whose contact is tester-owned. Expect the
   provider record to show the **org's** account / sender / Lob account, not
   the platform's.
3. **Counterparty lane, BYO absent.** Disconnect the org's identity and repeat
   step 2. For email and SMS, expect a refusal with a message that tells the
   customer to connect their own identity — and expect **no** provider call on
   the platform account. For Lob, record which account the letter is created
   on and compare it with the deferred-decision note above.
4. **Callbacks.** For each message from step 2, confirm the provider callback
   arrives, its signature is accepted, and the app's status for that message
   matches the provider's (delivered / failed / bounced / returned).
5. **Opt-out and suppression.** SMS: reply STOP from the test handset;
   confirm the lead is marked do-not-contact and the next send on **every**
   channel excludes it. Email: send to the SES bounce and complaint simulator
   addresses; confirm each lands in `email_suppressions`
   (`server/services/emailSuppressions.ts`) and is excluded next time.
6. **Failure honesty.** Force a provider error (invalid number, unverified
   recipient, undeliverable address). Confirm the app records a failure, does
   not report the message as sent, and does not charge credits for it.
7. **Idempotency.** Retry a send with the same idempotency key and confirm one
   provider object, not two (`tests/unit/directMailIdempotency.test.ts` pins
   this for direct mail in unit form).

## Pass criteria

- Every counterparty message in step 2 appears on the organization's own
  provider account; zero counterparty messages appear on a platform account
  for email and SMS.
- Step 3 refuses (email, SMS) without any provider call; Lob behaviour is
  recorded.
- Provider status and app status agree for every message.
- Opt-outs and suppressions are honoured across channels; failed sends are
  recorded as failed and not charged.
- **Fail:** any counterparty email or SMS on a platform identity; any message
  reported sent that the provider rejected; any send to a suppressed or
  do-not-contact recipient.

## Results

Not yet run.

## Still owed

- An owner and a date.
- Tester-owned handsets, mailboxes and a test org with BYO credentials on
  each provider.
- A public callback URL for staging (or a tunnel for local).
- The founder's eventual ruling on the Lob platform fallback, after which
  step 3's expected result for Lob can be written down.

## Run log

_(empty — append entries per the format in [README](README.md))_
