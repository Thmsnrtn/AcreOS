-- ============================================================================
-- KB stubs for error -> docs linking.
-- ============================================================================
--
-- Phase 3 of the mutation-hygiene / KB surface work. Errors.* helpers now
-- accept a `docsSlug` option that surfaces a `/help/article/<slug>` deep-link
-- in the failure toast. These rows are TODO stubs for the first 11 docsSlug
-- values assigned in route handlers (server/routes-*.ts).
--
-- Article bodies are intentionally a 1-line TODO — content is owned by the
-- support team and edited via the admin KB tool (server/routes-admin.ts).
-- ============================================================================

INSERT INTO knowledge_base_articles (
  title, slug, content, summary, category, tags, keywords, is_published
) VALUES
  (
    'AI injection rate limit triggered',
    'ai-injection-rate-limit',
    '# AI injection rate limit triggered

TODO: explain prompt-injection guardrail, why we throttle, how to clear it.',
    'Suspicious AI inputs were detected and the user was throttled for an hour.',
    'ai',
    '["ai","rate-limit","security"]'::jsonb,
    '["prompt injection","ai limit","blocked"]'::jsonb,
    true
  ),
  (
    'AI request limit reached',
    'limit-ai-requests',
    '# AI request limit reached

TODO: explain plan AI quotas, what counts, and how upgrading lifts the cap.',
    'You have used your monthly AI request quota for this plan.',
    'billing',
    '["billing","ai","limits"]'::jsonb,
    '["ai limit","quota","upgrade"]'::jsonb,
    true
  ),
  (
    'Out of email credits',
    'limit-email-credits',
    '# Out of email credits

TODO: explain credit math, how to top up, what happens to queued sends.',
    'Your organization does not have enough credits to send the planned email batch.',
    'campaigns',
    '["campaigns","credits","email"]'::jsonb,
    '["email credits","top up","insufficient"]'::jsonb,
    true
  ),
  (
    'Out of SMS credits',
    'limit-sms-credits',
    '# Out of SMS credits

TODO: explain SMS credit cost, how to top up, what happens to queued sends.',
    'Your organization does not have enough credits to send the planned SMS batch.',
    'campaigns',
    '["campaigns","credits","sms"]'::jsonb,
    '["sms credits","top up","insufficient"]'::jsonb,
    true
  ),
  (
    'Refund already issued',
    'refund-already-issued',
    '# Refund already issued

TODO: explain the 30-day refund window and how to escalate edge cases.',
    'A refund was already processed for this account within the last 30 days.',
    'billing',
    '["billing","refunds"]'::jsonb,
    '["refund","already processed","duplicate"]'::jsonb,
    true
  ),
  (
    'Team messaging requires a team plan',
    'feature-requires-team-plan',
    '# Team messaging requires a team plan

TODO: explain that team messaging needs >=2 seats and link to upgrade flow.',
    'Team messaging is only available on Starter and higher plans.',
    'billing',
    '["billing","team","plans"]'::jsonb,
    '["team plan","starter","upgrade"]'::jsonb,
    true
  ),
  (
    'Founder-only feature',
    'feature-founder-only',
    '# Founder-only feature

TODO: explain why some surfaces (executive dashboard, etc.) are founder-only.',
    'This surface is restricted to the founder account.',
    'getting_started',
    '["permissions","founder"]'::jsonb,
    '["restricted","founder only","admin"]'::jsonb,
    true
  ),
  (
    'Too many invites in 24 hours',
    'limit-invites-per-day',
    '# Too many invites in 24 hours

TODO: document per-org invite cap and how to request a temporary lift.',
    'You hit the daily invitation cap for this organization.',
    'integrations',
    '["team","invites","limits"]'::jsonb,
    '["invite limit","daily cap"]'::jsonb,
    true
  ),
  (
    'Too many invite-accept attempts',
    'limit-invite-accept-attempts',
    '# Too many invite-accept attempts

TODO: document per-user accept-attempt cap and when it resets.',
    'You exceeded the hourly invite-accept attempt cap.',
    'integrations',
    '["team","invites","limits"]'::jsonb,
    '["invite accept","brute force","retry"]'::jsonb,
    true
  ),
  (
    'Invitation email does not match',
    'invite-email-mismatch',
    '# Invitation email does not match

TODO: explain why the signed-in account must match the invited email exactly.',
    'The signed-in account email differs from the invited email.',
    'integrations',
    '["team","invites"]'::jsonb,
    '["wrong email","invite mismatch"]'::jsonb,
    true
  ),
  (
    'Public API rate limit',
    'limit-public-api-rate',
    '# Public API rate limit

TODO: document tier-based rate caps and the Retry-After contract.',
    'Your public API key hit its per-minute rate cap.',
    'integrations',
    '["api","limits"]'::jsonb,
    '["rate limit","api","429"]'::jsonb,
    true
  )
ON CONFLICT (slug) DO NOTHING;
