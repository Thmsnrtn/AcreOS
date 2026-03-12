CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" varchar(128) NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_prt_token" ON "password_reset_tokens" ("token");
CREATE INDEX IF NOT EXISTS "IDX_prt_user" ON "password_reset_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "IDX_prt_expires" ON "password_reset_tokens" ("expires_at");
