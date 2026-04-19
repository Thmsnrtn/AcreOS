# Journey 07: Settings and Billing Flow

## Goal

Configure the organization profile, invite a teammate, upgrade the billing tier, and verify the invoice is accessible.

## Starting State

- Logged in to AcreOS with an active account on the free tier.
- User is the organization owner/founder with full admin permissions.
- Has a colleague's email address ready to invite.
- Has a test payment method available (or Stripe test mode is active).

## Steps

1. Navigate to the settings area.
2. Review and update organization profile (name, contact info).
3. Save organization changes and verify they persist.
4. Navigate to team or member management.
5. Invite a teammate by email.
6. Verify the invitation is sent (confirmation message, pending invite visible).
7. Navigate to billing or subscription settings.
8. Review current tier and understand what the upgrade offers.
9. Select a higher tier and proceed through the upgrade flow.
10. Complete payment (via Stripe test mode or real checkout).
11. Verify the tier change is reflected in the UI.
12. Locate and download/view the invoice for the upgrade.
13. Verify the invoice contains correct details (amount, date, org name).

## Acceptance Criteria

| # | Condition | Measurement |
|---|-----------|-------------|
| A1 | Settings are discoverable | User finds org settings within 30 seconds |
| A2 | Organization profile saves correctly | Updated fields persist after page refresh |
| A3 | Teammate invitation succeeds | Invitation sent confirmation displayed; pending invite visible in member list |
| A4 | Tier comparison is clear | User can compare current vs. upgrade tier features and pricing before committing |
| A5 | Upgrade completes without error | Payment processes, tier updates, and user sees confirmation |
| A6 | Tier change is reflected immediately | Dashboard, feature gates, and billing page all show the new tier |
| A7 | Invoice is accessible | User can find, view, and download an invoice with correct line items |

## Abandonment Criteria

The persona should realistically give up if any of the following occur:

- **Cannot find settings:** After 1 minute of navigation, the user cannot locate organization or billing settings.
- **Billing is confusing:** Tier names, pricing, or feature differences are unclear; the user cannot determine which tier they need.
- **Invitation flow is broken:** The invite form does not submit, does not provide confirmation, or the invited user never appears in the pending list.
- **Payment flow is frightening:** The checkout process looks unprofessional, lacks HTTPS indicators, or does not clearly show what will be charged.
- **Invoice is missing:** After upgrading, the user cannot find any billing history or invoice.

## Failure Conditions

These are unrecoverable errors that terminate the journey immediately:

- **Settings page crashes:** Navigating to settings returns a 500 or blank page.
- **Payment fails silently:** The user completes checkout but the tier does not change and no error is shown.
- **Double charge:** The system charges the user twice for a single upgrade.
- **Invitation exposes user data:** The invitation flow reveals other organization members' email addresses or personal information to the invitee prematurely.
- **Tier downgrade instead of upgrade:** The system applies the wrong tier after payment.
- **Account locked after billing change:** The user cannot access their account or features after modifying billing.
- **Stripe integration error exposed raw:** A Stripe API error is displayed directly to the user with API keys, request IDs, or internal endpoints visible.
