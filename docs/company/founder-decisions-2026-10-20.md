# Founder decisions — 2026-10-20 (final)

Taken in response to the best-in-class audit
(`docs/audits/research-2026-10-20-best-in-class-bar-by-vertical.md`). Mirrored,
machine-checkably, in `shared/governance/constitution.ts`.

1. **No cold texting without written consent.** Standing decision. A
   prospecting text requires prior express written consent. Recorded in the
   constitution (`rails.no-cold-text-without-written-consent`) and CLAUDE.md.
2. **Email consent and texting consent are separate.** A lead's email
   reachability must not depend on SMS consent
   (`rails.email-consent-separate-from-sms`).
3. **Customers bring their own data and listing accounts.** This joins "be the
   rail, not the provider". Any integration acting on a customer's behalf uses
   the customer's own credentials and accounts
   (`rails.customer-acts-on-own-accounts`).
4. **`/investor-network` is a marketplace** under the ~25-customer rule and is
   gated accordingly (`expansion.marketplace-25-api-50`).
5. **Seller-finance payment accounts are Stripe Standard**, not Express, per
   the no-platform-money-custody hard stop
   (`hard-stop.no-platform-money-custody`).
6. **The stop rule is lifted for the LAND vertical only**, owner financing
   included. Every other vertical stays under the stop rule until land clears
   the bar (`docs/company/roadmap-2026-10.md`).

## Open questions raised while implementing (not decided here)

- **Does an inbound SMS STOP revoke email?** Today it revokes every channel,
  which is the conservative reading and was left unchanged. Making STOP
  SMS-only is a one-line change.
- **Does decision 3 cover data lookups?** As implemented, decision 3 covers
  outward actions taken as the customer: posting, deleting, messaging. Data
  lookups through AcreOS's own credit-metered provider registry (ATTOM,
  Regrid, skip trace) are AcreOS supplying data and are unchanged. Covering
  them too would change the whole registry.
- **Existing Express accounts.** Any connected account created before this
  change stays Express, because Stripe cannot convert an account type. New
  accounts are Standard. Moving a lender means a re-onboard.
