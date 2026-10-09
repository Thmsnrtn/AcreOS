-- 0268 — a mail-credit recharge checkout grants its credits exactly once.
--
-- /api/outreach/mail/credits/recharge sold Stripe checkouts that the webhook
-- never granted (metadata type 'mail_credit_recharge' had no handler). The
-- grant now runs from the webhook; its credit_transactions row is the claim,
-- unique per checkout session, so a replay or a duplicate event is a no-op.
-- No existing rows carry this type, so the index cannot conflict on creation.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_txn_mail_recharge_session_uniq" ON "credit_transactions" ("stripe_checkout_session_id") WHERE type = 'mail_credit_recharge';
