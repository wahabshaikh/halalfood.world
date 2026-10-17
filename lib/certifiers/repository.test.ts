import { test } from "vitest";
import assert from "node:assert/strict";
import { createTestDatabase } from "@/lib/testing/sqlite-d1";
import {
  aliasesByCertifier,
  certifierSitemapEntries,
  getCertifierBySlug,
  listAuthorities,
  listCurrentRecognitions,
  listPublishedChanges,
  listSources,
  saveAlertSubscription,
} from "./repository";
import { SEED_CHECKED_AT } from "./seed-sql";

test("the seeded BPJPH list reads back whole", async () => {
  const { db } = createTestDatabase();
  const all = await listCurrentRecognitions({ authorityId: "bpjph" }, db);
  assert.equal(all.length, 124);
  const anic = all.find((rec) => rec.slug === "anic-halal-authority")!;
  assert.equal(anic.validUntil, "2030-06-30");
  assert.equal(anic.countryCode, "AU");
  assert.equal(anic.sourceStatus, "MRA");
  assert.equal(all.filter((rec) => rec.validUntil === null).length, 1);
  assert.equal((await listCurrentRecognitions({ countryCode: "AU" }, db)).length, 14);
});

test("authorities and sources carry the official site and the last check", async () => {
  const { db } = createTestDatabase();
  assert.deepEqual(await listAuthorities(db), [
    { id: "bpjph", name: "Badan Penyelenggara Jaminan Produk Halal", shortName: "BPJPH", countryCodes: ["ID"], website: "https://bpjph.halal.go.id" },
  ]);
  const [source] = await listSources(db);
  assert.equal(source.url, "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri");
  assert.equal(source.lastOkAt, SEED_CHECKED_AT);
  assert.equal(source.needsLook, false);
});

test("a certifier page has its recognitions; unknown slugs are missing", async () => {
  const { db } = createTestDatabase();
  const page = await getCertifierBySlug("anic-halal-authority", db);
  assert.equal(page.kind, "found");
  if (page.kind !== "found") return;
  assert.equal(page.certifier.name, "ANIC Halal Authority");
  assert.equal(page.certifier.recognitions[0].validUntil, "2030-06-30");
  assert.deepEqual(page.certifier.aliases, ["anic halal authority"]);
  assert.deepEqual(page.certifier.changes, []);
  assert.equal(page.certifier.updatedAt, SEED_CHECKED_AT);
  assert.deepEqual(await getCertifierBySlug("no-such-body", db), { kind: "missing" });
});

test("aliases and sitemap entries use the last data change", async () => {
  const { db } = createTestDatabase();
  const aliases = await aliasesByCertifier(db);
  assert.equal(aliases.size, 124);
  const entries = await certifierSitemapEntries(db);
  assert.equal(entries.certifiers.length, 124);
  assert.ok(entries.certifiers.every((entry) => entry.lastModified === SEED_CHECKED_AT));
  assert.deepEqual(entries.authorities, [{ authorityId: "bpjph", lastModified: SEED_CHECKED_AT }]);
  assert.ok(entries.fromCountries.some((entry) => entry.countryCode === "AU"));
  assert.deepEqual(await listPublishedChanges({}, db), []);
});

test("an alert sign-up is stored once per address and filter, unconfirmed and weekly", async () => {
  const { sqlite, db } = createTestDatabase();
  const filter = { authorities: ["bpjph"], certifiers: ["anic-halal-authority"], scopes: [] };
  await saveAlertSubscription("a@example.com", filter, null, db, 1);
  await saveAlertSubscription("a@example.com", filter, null, db, 2);
  await saveAlertSubscription("a@example.com", { ...filter, certifiers: [] }, null, db, 3);
  const rows = sqlite.prepare(`SELECT email, frequency, confirmed_at, filter_json FROM cert_alert_sub ORDER BY created_at`).all() as Record<string, unknown>[];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].frequency, "weekly");
  assert.equal(rows[0].confirmed_at, null);
  assert.deepEqual(JSON.parse(String(rows[0].filter_json)), filter);
});
