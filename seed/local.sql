-- Local development seed (never a migration, never applied remotely):
--   pnpm db:migrate:local && pnpm db:seed:local
-- Fixed ids, INSERT OR IGNORE: safe to run again. Places start as "Not checked yet".

INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_country, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Seed Grill House', 'london', '12 Whitechapel Road, London', 'GB', 51.5175, -0.064, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 1790000000000);
INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_country, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000002', 'Seed Biryani Kitchen', 'london', '40 Brick Lane, London', 'GB', 51.5215, -0.0717, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, updated_at) VALUES ('00000000-0000-4000-8000-000000000002', 1790000000000);
INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_country, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000003', 'Seed Shawarma Bar', 'london', '8 Edgware Road, London', 'GB', 51.515, -0.163, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, updated_at) VALUES ('00000000-0000-4000-8000-000000000003', 1790000000000);
INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_country, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000004', 'Seed Kebab Corner', 'mumbai', 'Mohammed Ali Road, Mumbai', 'IN', 18.958, 72.833, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, updated_at) VALUES ('00000000-0000-4000-8000-000000000004', 1790000000000);
INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_country, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000005', 'Seed Bhendi Bazaar Cafe', 'mumbai', 'Bhendi Bazaar, Mumbai', 'IN', 18.96, 72.832, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, updated_at) VALUES ('00000000-0000-4000-8000-000000000005', 1790000000000);
INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_country, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000006', 'Seed Nalli Nihari', 'mumbai', 'Minara Masjid Lane, Mumbai', 'IN', 18.957, 72.834, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, updated_at) VALUES ('00000000-0000-4000-8000-000000000006', 1790000000000);

-- An unclaimed creator profile, as Halal Food Scout (/api/mcp) makes them, who verified Seed Grill House in a video.
INSERT OR IGNORE INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000c0001', 'Seed Creator', 'creator-00000000-0000-4000-8000-0000000c0001@unclaimed.invalid', 0, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO profiles (user_id, handle, display_name, bio, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000c0001', 'seed.creator', 'Seed Creator', 'Halal food videos from London.', 1790000000000, 1790000000000);
INSERT OR IGNORE INTO creator_profiles (user_id, platform, channel_id, channel_handle, channel_url, subscriber_count, source, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000c0001', 'youtube', 'UCseedseedseedseedseed01', 'seed.creator', 'https://www.youtube.com/@seed.creator', 12500, 'scout', 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_media_links (id, place_id, platform, url, author_handle, author_name, created_at) VALUES ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-000000000001', 'youtube', 'https://www.youtube.com/watch?v=seedvideo01', 'seed.creator', 'Seed Creator', 1790000000000);
INSERT OR IGNORE INTO creator_verifications (id, creator_user_id, place_id, platform, video_id, video_url, timestamp_seconds, video_date, media_link_id, source, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-000000000001', 'youtube', 'seedvideo01', 'https://www.youtube.com/watch?v=seedvideo01', 83, '2026-09-01', '00000000-0000-4000-8000-0000000c0002', 'scout', 1790000000000, 1790000000000);

-- Places Halal Food Scout listed with sourced web claims (place_claims), and the status recomputePlaceStatus gives them:
-- the claims fill the facts, nothing is settled, and both stay "Not checked yet". Seed Scout Kitchen's alcohol is unknown.
INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_locality, address_country, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000007', 'Seed Scout Kitchen', 'london', '21 Commercial Street, London', 'London', 'GB', 51.5155, -0.073, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, owned_value, certified_value, pork_value, owned_sources, certified_sources, pork_sources, updated_at) VALUES ('00000000-0000-4000-8000-000000000007', 'yes', 'yes', 'no', 'scout', 'scout', 'scout', 1790000000000);
INSERT OR IGNORE INTO place_claims (id, place_id, source, fact, value, source_url, certifier, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-000000000007', 'scout', 'certified', 'yes', 'https://example.com/seed-scout-kitchen/halal', 'HMC', 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_claims (id, place_id, source, fact, value, source_url, certifier, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-000000000007', 'scout', 'owned', 'yes', 'https://example.com/seed-scout-kitchen/about', NULL, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_claims (id, place_id, source, fact, value, source_url, certifier, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-000000000007', 'scout', 'pork', 'no', 'https://example.com/seed-scout-kitchen/menu', NULL, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_locality, address_country, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000008', 'Seed Falafel Stop', 'london', '3 Wentworth Street, London', 'London', 'GB', 51.5168, -0.0745, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, alcohol_value, alcohol_sources, updated_at) VALUES ('00000000-0000-4000-8000-000000000008', 'no', 'scout', 1790000000000);
INSERT OR IGNORE INTO place_claims (id, place_id, source, fact, value, source_url, certifier, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000d0004', '00000000-0000-4000-8000-000000000008', 'scout', 'alcohol', 'no', 'https://example.com/seed-falafel-stop/drinks', NULL, 1790000000000, 1790000000000);

-- A place Halal Food Scout listed without coordinates (no lat/lng sent and no confident geocode): listed on its city
-- page and in search, no map pin, "Location pending" on its page.
INSERT OR IGNORE INTO places (id, name, city_slug, street_address, address_locality, address_country, maps_url, lat, lng, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000009', 'Seed Pending Pin Cafe', 'london', '5 Old Montague Street, London', 'London', 'GB', 'https://www.google.com/maps/search/?api=1&query=Seed%20Pending%20Pin%20Cafe%2C%205%20Old%20Montague%20Street%2C%20London', NULL, NULL, 1790000000000, 1790000000000);
INSERT OR IGNORE INTO place_status (place_id, updated_at) VALUES ('00000000-0000-4000-8000-000000000009', 1790000000000);

-- A paid city sponsor for Mumbai (lib/sponsorships.ts), live until 2100, so the Explore card and the "already
-- sponsored" state show locally. London stays open so the sponsor form can be tried.
INSERT OR IGNORE INTO city_sponsorships (id, city_slug, user_id, sponsor_name, tagline, link_url, status, renews, whop_checkout_id, whop_membership_id, whop_payment_id, starts_at, active_until, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000e0001', 'mumbai', NULL, 'Seed Sponsor', 'Halal catering across Mumbai', 'https://sponsor.example.com/', 'active', 1, 'ch_seed', 'mem_seed', 'pay_seed', 1790000000000, 4102444800000, 1790000000000, 1790000000000);
