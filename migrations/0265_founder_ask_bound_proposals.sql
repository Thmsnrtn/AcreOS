-- 0265 — An ask whose approval ACTS is bound to the exact proposal and the
-- exact version the founder saw.
--
-- solene_founder_asks:
--   acts_key        identity of the proposal (move kind + domain + rationale);
--                   a repeat folds only into the same proposal.
--   acts_payload    the proposal that runs on approval.
--   body_hash       the card's version; approval must name it.
--   chat_approvable set only by server code for a server-authored catalog
--                   move on the allow-list; the chat answers nothing else.
--
-- Purely additive.
ALTER TABLE "solene_founder_asks" ADD COLUMN IF NOT EXISTS "acts_key" text;
ALTER TABLE "solene_founder_asks" ADD COLUMN IF NOT EXISTS "acts_payload" jsonb;
ALTER TABLE "solene_founder_asks" ADD COLUMN IF NOT EXISTS "body_hash" text;
ALTER TABLE "solene_founder_asks" ADD COLUMN IF NOT EXISTS "chat_approvable" boolean NOT NULL DEFAULT false;
