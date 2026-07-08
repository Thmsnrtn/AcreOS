# Cleo Hartley — locked out of AcreOS, $500K of deals on the other side of the door

I'm Cleo. Forty-seven. Lexington, Kentucky. Eleven years buying tax-deed acreage in eastern Kentucky and western West Virginia, the last four with a small notes book — twenty-three borrowers, average UPB about $22K, total exposure right at half a million. AcreOS has been my system since November. I moved from a Notion tracker and a shoebox of payment coupons because Thomas's product looked serious enough to actually run my book on. It is. That's the problem. **When it breaks for you, it breaks for everything.**

This is what happened to me three weeks ago, written down so it doesn't happen to somebody else's grandmother.

---

## 1. The thirty-second version

My phone took a swim in the Kentucky River. Replaced it the next morning. My Authy seed didn't transfer because I never set up multi-device sync. The eight backup codes AcreOS gave me at 2FA setup are in a drawer in my office in Lexington — except I'm in Pikeville for a closing. Email password manager works, so I can read mail. I cannot log in to AcreOS. I cannot reset 2FA. I cannot prove to support I am who I say I am. I have **four borrowers due on the first**, two of whom pay through the borrower portal, and a contract-for-deed signing scheduled for Wednesday.

It took **nine days** to get my account back. During those nine days, two borrowers' autopay attempts failed because they couldn't reach the portal page that AcreOS generates per-loan, my Wednesday signing slipped to the following Monday, and one borrower — a retired coal miner named Earl who pays cash on a $185 monthly note — drove ninety minutes to my office to hand me a money order because "the website said the link expired." I lost a week of operations and a thin slice of trust I'm not sure I get back. Fix this. It is the single worst experience I have had with any software product, full stop, and the rest of AcreOS is the best CRM I've ever owned.

---

## 2. What actually exists today, by file

I know what's in the box because I read the code while I was waiting for support to answer:

- `server/services/twoFactorAuth.ts:111` — generates **eight** backup codes at setup, single-use, stored as scrypt hashes in `users.twoFactorBackupCodes`. Shown **once**.
- `server/routes-2fa.ts:111` — `/api/auth/2fa/verify` accepts either TOTP or backup code; consumes the backup code on success.
- `server/routes-2fa.ts:151` — `/api/auth/2fa/disable` requires either a current TOTP **or** a backup code. **There is no path through this endpoint that does not require possession of one or the other.**
- `client/src/pages/forgot-password.tsx` — sends a reset link to the email on file. The reset link resets the *password.* It does not reset 2FA, and after I set a new password the very next screen asked me for my authenticator code.
- `client/src/components/help/HelpPanel.tsx:567` — support tickets exist via `/api/support/tickets`. **You have to be logged in to file one.**

That last bullet is the trap. The mechanism for asking for help requires the thing I cannot do. I sent four emails to `support@acreos.io` (the address pulled from `client/src/pages/pricing.tsx:260`) before I got a human reply. Three days. The first reply was a templated request that I "log into my account and submit a ticket through the Help Panel." I had to write back and explain in twelve sentences why that was impossible.

---

## 3. The hour-by-hour, day-by-day

**Day 1, 6:42 PM (Tuesday).** Phone in the river. River wins.

**Day 1, 8:30 PM.** New phone. Restore from iCloud. Authy app reinstalls, asks for the backup password. I enter it. Authy says: *"No backups found. This account did not have backups enabled."* I learn for the first time that Authy multi-device + cloud backup is opt-in and I never opted in. My TOTP seed for AcreOS, my bank, my email host, and my title software is gone.

**Day 1, 9:15 PM.** I try to log into AcreOS from my laptop. Email and password work. The next screen asks for my six-digit code. I don't have it. I click "Use a backup code." I don't have those either — they're in a manila folder in a filing cabinet at my office in Lexington and I'm in a Hampton Inn in Pikeville for tomorrow's closing.

**Day 1, 10:00 PM.** I email `support@acreos.io`. No reply tonight.

**Day 2, 7:00 AM.** Closing in three hours. Kentucky general warranty deed, $34,000 cash, a 71-year-old seller named Mrs. Brashears. **I cannot pull the closing checklist out of AcreOS because I cannot log in.** I had everything in `/parcels/:id` for that property. I drive to a Kinko's, log into my Gmail, and reconstruct the closing packet from the email confirmations the platform sent me when I generated each document. The deed itself is in DocuSign because we signed it last week — that's fine. But my title chain notes, my survey markup, my §382 disclosure annotations — those are inside AcreOS. **None of it shows up in email.** I close the deal on memory and a printed county records search. Mrs. Brashears does not notice. I notice.

**Day 2, 11:00 AM.** I email support again. Subject line: "URGENT — locked out, active deals."

**Day 2, 4:00 PM.** Auto-reply. "Thank you for contacting AcreOS support. We aim to respond within 24 business hours." It is twenty hours since my first email.

**Day 3, 9:00 AM.** Earl drives up. Two days early. I tell him to come back Friday because his payment isn't due till the first. He drives ninety minutes home.

**Day 3, 11:30 AM.** First human reply from support. A person named Marcus. He asks me to log in and file a ticket through the Help Panel. I write back twelve sentences. Subject: "I cannot log in. That is the problem."

**Day 3, 5:00 PM.** Marcus replies. He needs to "verify my identity." He asks for: my email on file (easy), the last four of the credit card on file (I can get this from my Capital One app), and a **"selfie photo holding a government-issued ID."** No instructions on format, resolution, or what counts as government-issued. No mention of whether the photo is encrypted in transit. No mention of how long they retain it. I send a passport photo and a selfie. I do not love this. I have no choice.

**Day 4-5 (weekend).** Silence. The auto-reply does not mention business-hours-only support. The pricing page says "priority support" is included on my $79/mo Scale plan. **It is not priority. There is no priority.** There is one human with a queue.

**Day 6, Monday 10:00 AM.** Marcus asks for **a second piece of ID** — a utility bill or bank statement matching the address on the account. I send a Kentucky Utilities bill. PDF, two pages, my address.

**Day 6, 2:00 PM.** Marcus asks me to confirm "two recent transactions" on my account. I assume he means deals or borrower payments. I list three: two borrower autopays from last week and a cash close. He confirms. He says he will "escalate to engineering for the 2FA reset." Engineering. My account reset requires a human engineer to run a database query. There is no admin tool.

**Day 7, 11:00 AM.** Tuesday. I'm now four days from the first of the month. Two borrowers are autopay. The borrower portal is at `/borrower-portal/:loanId` from what I can see in the URL of the email confirmations they got — `client/src/pages/borrower-portal.tsx`. The portal verifies via a per-loan email link. I cannot regenerate the link because **link regeneration is in the lender's settings panel, which I cannot reach.** If their stored ACH on Stripe goes through, fine. If it fails — Earl's daughter Tasha bounced once in March — there is no way for them to retry from their side.

**Day 7, 4:00 PM.** Engineering reply. They have "queued a 2FA reset" and will email me a one-time link to disable 2FA. The link will expire in one hour.

**Day 7, 5:30 PM.** The link arrives. I'm driving back from a parcel inspection in Floyd County. I cannot click an expiring link from the road. I lose the window. I email back. **I get an automated reply telling me to file a ticket through the Help Panel.**

**Day 8, 9:00 AM.** I beg. I send a new email with the subject "Please re-issue the reset link, I missed the window." Marcus replies at 1:00 PM. New link, two-hour window this time. I click it from my truck in a McDonald's parking lot in Prestonsburg. It works. I'm in.

**Day 8, 1:30 PM.** I generate new backup codes. I print them. I tape them to the inside of three different filing cabinets in three different cities. I enroll in Authy with cloud backup turned on. I add a hardware key — except AcreOS doesn't support hardware keys, only TOTP. (`server/services/twoFactorAuth.ts` is TOTP-only. No WebAuthn. No FIDO2. I'd pay extra for a YubiKey path.)

**Day 9.** I call every borrower. Two of them say "the link in my email said it expired, I figured you knew." One says he tried to call my office and got voicemail. **AcreOS sent me zero notifications during the lockout** — no "your account has had repeated failed 2FA attempts," no "your borrowers attempted to access their portal and could not," no "your scheduled autopay run failed." The system did not page me about my own emergency.

**Day 9, evening.** I sit on my back porch in Lexington with a notebook and write down what I just lived through, hour by hour, so I can hand this to Thomas. Half of what's in this document was reconstructed from inbox archaeology and the timestamps on Marcus's emails. I want it on the record.

---

## 4. What I needed and didn't get

### Identity-proof workflow

What I got was: email subject line, selfie + ID, second piece of mail-address proof, two-transaction confirmation. This is **passable** for a $20-a-month consumer SaaS. It is **not enough** for a system holding $500K of active loan instruments. And the inverse problem — that this same workflow would let an attacker with my Gmail (which they could get from a SIM swap) reset my account in seven business days, since the "ID" can be forged and the "transactions" can be guessed from the deal-thread emails I sent — is *worse* than the lockout problem.

What I needed:

- **Tier 1 (default, fastest):** TOTP backup code OR a one-time recovery passphrase generated at signup, twenty-four words like a crypto wallet seed, that the user is *forced* to print and confirm before 2FA enrollment completes. Right now the eight backup codes are shown once on a screen most people screenshot or skip. Force a two-step: generate, then re-enter three of them randomly to confirm they were saved.
- **Tier 2 (24-48 hour):** Notarized affidavit. I would have driven to a notary on day two and had a sworn statement of identity in hand by day three. AcreOS should publish a one-page affidavit template with the user's masked account ID and the platform's sworn-statement language. I email the notarized PDF and a scan of my driver's license. Account unlocks within one business day.
- **Tier 3 (same-day, paid):** Live video verification with a human at AcreOS, by appointment. Show the ID, answer two challenge questions about the account. $99 expedite fee, charged to the card on file. Founders, by definition, are willing to pay.
- **Tier 4 (the nuclear option):** **Read-only mode** during lockout. I cannot edit, transact, or sign — but I can *see* my book. I can pull a borrower's name and phone, generate a one-time payment link, see the closing checklist for tomorrow's deal. Read-only against a known email + known device + known IP, gated behind a recovery code that's emailed to the address on file. This single feature would have made my lockout an inconvenience instead of a disaster.

### Customer support response time

24 business hours is not a response time for a financial system. I am not asking for 24/7 — I am asking for a **lockout-specific** SLA. When the support ticket subject contains the word "locked out" or comes from an email matching an account in 2FA-failure state, the response window should be **four hours, including weekends.** AcreOS knows my plan. Scale customers ($79/mo, the page promises "priority") deserve a sub-day response on access loss. Anything else makes "priority" a marketing word.

A lockout ticket is also detectable without the user telling you. The auth layer can see N consecutive 2FA failures from the same email in 24 hours. That should auto-create a "possible lockout" ticket flagged P0 in the support queue *before* I email, with a templated reply offering Tier 1/2/3 paths and a calendar link to book a video verification. Beat me to the inbox. The platform knows. Use what it knows.

### Time-to-restored-access

Nine days is unconscionable. The target should be: **same-day for Tier 3 video verification, 48 hours for Tier 2 affidavit, and one hour for Tier 1 backup code or recovery seed.** The fact that engineering had to manually run a database update suggests there is no admin tool — `server/routes-2fa.ts` has no admin-disable endpoint. Build one. Gate it on dual-control approval (two AcreOS staff sign off) and full audit log. Ship it before the next paying customer locks themselves out, because the next one might not be patient.

### Time-to-restored-access — what "good" looks like

For comparison, here are real benchmarks I've experienced as a customer of other systems during the same nine days:

- **Capital One:** locked out of my card account after a 2FA failure on a new phone. Resolution: 11 minutes via in-app video chat with a human, ID held to camera. Done.
- **Chase business banking:** locked out, branch visit with two pieces of ID, account back same afternoon.
- **Coinbase (which holds *crypto*, the stuff that famously can't be reversed):** lockout resolved in 36 hours via their identity-verification flow. Selfie + ID + holding-a-piece-of-paper-with-a-code shot.

AcreOS came in last among the four systems I had to interact with on lockout that month. The CRM that holds my contracts and my borrowers' payment ledger took longer to restore access than the bank that holds my actual money. That ratio is upside-down and Thomas needs to know it.

### What data is at risk during lockout

This is the part Thomas needs to hear directly. During my nine days locked out:

- **Borrower payment portal links could not be regenerated.** If a borrower's link expired (the per-loan email links in `borrower-portal.tsx` have a TTL — I didn't read deeply enough to find it, but Tasha got an "expired" message), they had no path to pay online. Cash, money order, or wait.
- **Scheduled autopay runs went through anyway** because they're driven by Stripe + the cron, not by my session. *Good.* That's the one thing that worked. But if a card had declined, I had no surface to retry it.
- **Document signing requests in flight could not be re-sent.** I had a Wednesday signing where the buyer needed the contract re-emailed because his spam filter ate the first send. I could not do it. The signing slipped four days.
- **Compliance deadlines kept ticking.** A Kentucky disclosure window doesn't pause because I'm locked out. A §382 closure doesn't wait. The platform should know which of my deals have *time-sensitive deadlines inside the lockout window* and either (a) auto-extend internal SLAs, or (b) email me a flat list — *here is what is going to break if you can't get back in by Friday.* It did neither.
- **Activity log silence.** Nothing on `server/services/activityLogger.ts` told me, after I got back in, what I had missed. I had to reconstruct nine days from email confirmations and bank statements.

### Backup recovery codes UX

The current flow at `client/src/pages/settings.tsx` shows the eight codes in a code block on the screen, says "save these in a safe place," and has a Copy button. **That is the entire UX.** No print stylesheet. No "I have saved these" attestation checkbox. No re-enter-three-of-them confirmation step. No reminder email a week later asking me to confirm I still have them. No "your backup codes are X months old, regenerate?" nudge. No way to *test* a backup code without consuming it.

Specific fixes I'd ship Monday:

1. Force a re-entry confirmation: after showing the codes, blank the screen and ask the user to enter three of them in random order. If they can't, they didn't save them, and the 2FA enrollment doesn't complete.
2. Print stylesheet that lays out the codes in a fold-and-store wallet card format with the account email and the date.
3. A "test a backup code" button on the security page that consumes one code and immediately regenerates it, confirming the user can find them.
4. Annual reminder: "Your 2FA backup codes were generated 12 months ago. Confirm you can access them." Click-through to the test-a-code flow.
5. **Recovery seed phrase as an alternative to backup codes.** Twenty-four words, BIP-39 style, generated at signup, *required* for 2FA enrollment to complete. It works for crypto wallets holding millions of dollars. It will work for a CRM holding deal records.

### The "I'm locked out and my borrowers can't pay" emergency

This is the part where AcreOS is held to a higher standard than Slack or Notion, because money flows through it. The borrower portal at `client/src/pages/borrower-portal.tsx` should be **fully decoupled from the lender's session.** A borrower's ability to pay should never depend on whether I can log in. From what I could tell during my lockout, this is *mostly* true — autopay ran — but the link regeneration, payment retry, and "my link expired" recovery paths all routed through me. They shouldn't.

Concrete: ship a borrower-side "my link expired, send me a new one" button that bypasses the lender entirely and emails the borrower a new portal link signed by the platform, not by me. Log it. Notify me. But do not block the borrower on my session.

---

## 5. Severity, ranked

1. **Nine-day time-to-restored-access** — existential risk to customer trust. Fix in 30 days.
2. **Support requires login to file ticket** — breaks the primary recovery path. Add a `/help/locked-out` public page that takes an email + a free-text description and routes to the support queue with priority flag. Two days of work.
3. **Borrower payment paths coupled to lender session** — money flow disruption. Audit and decouple.
4. **No read-only mode during lockout** — would have removed 80% of my pain. Ship it.
5. **Backup-code UX is unforced and unverifiable** — the root cause of my specific lockout. Force re-entry confirmation, add print stylesheet, add annual test reminder.
6. **No WebAuthn / hardware key support** — for a financial system in 2026, this is a gap. TOTP-only is yesterday's standard.
7. **Identity-proof workflow is ad-hoc** — define tiers, publish them, don't make Marcus invent them per ticket.

---

## 6. The thing I want Thomas to know

I am not leaving AcreOS. The product is good enough that I came back after nine days of hell, generated new codes, and kept building my book here. That should be terrifying, not flattering. I came back because the alternative is worse — I am not going back to Notion and a shoebox. But the next Cleo, three months from now, with a smaller book and less patience, will close her account and write a Reddit post. And the one after her will be the one whose borrower's payment didn't go through and who blames the platform publicly.

The lockout path is the *single most important* code path in the application that nobody uses on a good day. Build it like the smoke alarm in your house. Test it the way you'd test the brakes on the truck you take to a closing. And for the love of God, let me file a ticket without logging in.

— Cleo Hartley, Lexington
