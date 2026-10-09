-- READ-ONLY. Lists mail-credit recharge payments that granted NOTHING.
--
-- Before 2026-10-09 the Stripe webhook had no handler for checkouts tagged
-- metadata.type = 'mail_credit_recharge' (POST /api/outreach/mail/credits/
-- recharge): the customer paid and no credits were granted. This query lists
-- every such PAID session the app can see, so the founder can decide how to
-- make each customer whole. It changes nothing; do NOT auto-grant from it.
--
-- Source of truth for "a recharge was paid" is Stripe, not this database: the
-- app never stored these sessions. Two ways to get the list:
--
-- (1) Stripe (authoritative). In the Stripe dashboard → Payments → filter on
--     metadata type = mail_credit_recharge, or with the CLI:
--       stripe checkout sessions list --limit 100 \
--         | jq '.data[] | select(.metadata.type=="mail_credit_recharge" and .payment_status=="paid")
--               | {id, created, amount_total, customer, org: .metadata.organizationId}'
--     Each session with NO matching credit_transactions row (query 2) was never granted.
--
-- (2) What the database DID record — grants made by the fixed webhook. Any
--     paid Stripe session from (1) whose id is NOT in this list granted nothing:
SELECT ct.stripe_checkout_session_id,
       ct.organization_id,
       ct.amount_cents AS credits_granted,
       ct.created_at
FROM credit_transactions ct
WHERE ct.type = 'mail_credit_recharge'
ORDER BY ct.created_at;

-- (3) Orgs that clicked a recharge but have no grant at all — useful when
--     Stripe access is not to hand. The recharge route writes nothing locally,
--     so this is only an approximation via Stripe customers on orgs with no
--     mail_credit_recharge row; confirm every candidate in Stripe before acting.
SELECT o.id AS organization_id, o.name, o.stripe_customer_id
FROM organizations o
WHERE o.stripe_customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM credit_transactions ct
    WHERE ct.organization_id = o.id AND ct.type = 'mail_credit_recharge'
  )
ORDER BY o.id;
