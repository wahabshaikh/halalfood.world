-- City sponsorships, paid through Whop. Additive only.
--
-- One sponsor at a time per city shows a labelled "Sponsor" card on that city's Explore page. A sponsorship
-- never touches a place's status or ranking (docs/spec/simplified-community-spec.md §1 rule 9): it is not a
-- place and is shown apart from the place list.
--
-- Lifecycle (lib/core/sponsorship.ts):
--   pending   a checkout was started; holds the city for an hour so two buyers can't pay for the same month
--   active    Whop confirmed a payment; shown while starts_at <= now < active_until
--   refunded  Whop refunded the payment; hidden at once
--   removed   a moderator took it down
-- A Whop membership that stops renewing sets renews = 0; the card stays up until active_until.
-- status has no CHECK so a state can be added later without rebuilding the table.

CREATE TABLE "city_sponsorships" (
  "id" text PRIMARY KEY NOT NULL,
  "city_slug" text NOT NULL,
  -- The account that bought it. Kept (as NULL) when the account is deleted: the sponsorship was paid for.
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "sponsor_name" text NOT NULL CHECK (length("sponsor_name") <= 60),
  "tagline" text CHECK ("tagline" IS NULL OR length("tagline") <= 120),
  "link_url" text NOT NULL CHECK (length("link_url") <= 300),
  "status" text NOT NULL,
  "renews" integer NOT NULL DEFAULT 1,
  "whop_checkout_id" text,
  "whop_membership_id" text,
  "whop_payment_id" text,
  "starts_at" integer,
  "active_until" integer,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "city_sponsorships_city_idx" ON "city_sponsorships" ("city_slug", "status", "active_until");
CREATE INDEX "city_sponsorships_user_idx" ON "city_sponsorships" ("user_id", "created_at" DESC);
CREATE INDEX "city_sponsorships_membership_idx" ON "city_sponsorships" ("whop_membership_id");

-- Whop webhook deliveries already handled, by their webhook-id, so a retried delivery is a no-op.
CREATE TABLE "whop_webhook_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "received_at" integer NOT NULL
);
