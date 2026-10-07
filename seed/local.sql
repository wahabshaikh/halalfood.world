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
