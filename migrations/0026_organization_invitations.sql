-- 0026_organization_invitations.sql
-- Pending seat invitations for org membership. Created by owners/admins;
-- consumed on first sign-in via /auth?invite=<token>.

CREATE TABLE IF NOT EXISTS "organization_invitations" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "email" text NOT NULL,
    "role" text NOT NULL DEFAULT 'member',
    "token" text NOT NULL UNIQUE,
    "invited_by_user_id" text,
    "status" text NOT NULL DEFAULT 'pending',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "expires_at" timestamp NOT NULL,
    "accepted_at" timestamp,
    "accepted_by_user_id" text
);

CREATE INDEX IF NOT EXISTS "idx_org_invitations_org_id"
    ON "organization_invitations" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_org_invitations_email_status"
    ON "organization_invitations" ("email", "status");
CREATE INDEX IF NOT EXISTS "idx_org_invitations_token"
    ON "organization_invitations" ("token");
