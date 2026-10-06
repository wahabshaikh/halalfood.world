-- The email sink: on non-production hosts (localhost and Worker Previews, lib/environment.ts) mail is
-- written here instead of being sent, and read back by tests at GET /api/test/emails?to=.
-- Production never writes to it. Rows older than a day are pruned on each write.

CREATE TABLE "email_sink" (
  "id" text PRIMARY KEY NOT NULL,
  "to_address" text NOT NULL,
  "subject" text NOT NULL,
  "text" text NOT NULL,
  "html" text,
  "host" text NOT NULL,
  "created_at" integer NOT NULL
);

CREATE INDEX "email_sink_to_created_idx" ON "email_sink" ("to_address", "created_at");
