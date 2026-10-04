import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveHalalAssessment } from "@halalfood/core/halal-taxonomy";
import { listApprovedEvidenceRecords } from "../src/lib/halal-verifications";
import {
  createAppeal,
  createReport,
  resolveReport,
  reviewEvidence,
} from "../src/lib/moderation-repository";
import { addUser, createTestDatabase } from "./support/sqlite-d1";

const PLACE = "11111111-1111-4111-8111-111111111111";
const NOW = Date.UTC(2026, 9, 4);

/**
 * Seeded trust lifecycle on a fixture place. The live QA review, photo and dish
 * are not inserted and are not approved here.
 */
test("certificate evidence is reviewed, can expire, stays public-only, and a report can be appealed", async () => {
  const { sqlite, db } = createTestDatabase();
  addUser(sqlite, "submitter");
  addUser(sqlite, "moderator");
  sqlite
    .prepare(
      `INSERT INTO places (id, name, city_slug, city_url, street_address, serves_cuisine, source, source_url, scraped_at, created_at, halal_confirmed)
       VALUES (?, 'Fixture Kitchen', 'delhi', 'u', '1 Fixture Road', '[]', 's', 'u', 1, 1, 1)`,
    )
    .run(PLACE);

  const insert = sqlite.prepare(
    `INSERT INTO place_halal_verifications (
      id, place_id, submitted_by_user_id, status, evidence_kind, claimed_status, scope,
      certification_body, captured_at, expires_at, visibility, created_at, updated_at
    ) VALUES (?, ?, 'submitter', 'pending', ?, ?, 'venue', ?, ?, NULL, ?, ?, ?)`,
  );
  insert.run("cert-1", PLACE, "certification", "verified", "Example Halal Board", NOW, "public", NOW, NOW);
  insert.run("link-1", PLACE, "official-website", "self-declared", null, NOW, "public", NOW, NOW);
  insert.run("file-1", PLACE, "menu-photo", "verified", null, NOW, "private", NOW, NOW);

  assert.equal((await listApprovedEvidenceRecords(PLACE, db)).length, 0);
  assert.equal(deriveHalalAssessment([]).status, "unverified");

  const reviewed = await reviewEvidence("cert-1", "moderator", "approved", "Certificate names a body.", db);
  assert.equal(reviewed.ok, true);
  const approved = await listApprovedEvidenceRecords(PLACE, db);
  assert.deepEqual(
    approved.map((item) => item.id),
    ["cert-1"],
  );
  assert.equal(deriveHalalAssessment(approved, NOW).status, "verified");

  const history = sqlite
    .prepare(`SELECT next_status FROM place_halal_status_history WHERE place_id = ?`)
    .all(PLACE) as { next_status: string }[];
  assert.equal(history.some((row) => row.next_status === "verified"), true);

  await reviewEvidence("file-1", "moderator", "approved", "Private file.", db);
  assert.deepEqual(
    (await listApprovedEvidenceRecords(PLACE, db)).map((item) => item.id),
    ["cert-1"],
  );

  sqlite.prepare(`UPDATE place_halal_verifications SET expires_at = ? WHERE id = 'cert-1'`).run(NOW - 86_400_000);
  const expired = await listApprovedEvidenceRecords(PLACE, db);
  const afterExpiry = deriveHalalAssessment(expired, NOW);
  assert.equal(afterExpiry.status, "unverified");
  assert.equal(afterExpiry.needsReverification, true);

  sqlite
    .prepare(
      `INSERT INTO place_halal_verifications (
        id, place_id, submitted_by_user_id, status, evidence_kind, claimed_status, scope,
        captured_at, visibility, created_at, updated_at
      ) VALUES ('neg-1', ?, 'moderator', 'approved', 'menu-photo', 'not-halal', 'venue', ?, 'public', ?, ?)`,
    )
    .run(PLACE, NOW, NOW, NOW);
  sqlite.prepare(`UPDATE place_halal_verifications SET expires_at = NULL WHERE id = 'cert-1'`).run();
  const conflicted = deriveHalalAssessment(await listApprovedEvidenceRecords(PLACE, db), NOW);
  assert.equal(conflicted.status, "unverified");
  assert.notEqual(conflicted.status, "not-halal");
  assert.ok(conflicted.conflict);

  const reportId = await createReport(
    {
      targetType: "verification",
      targetId: "cert-1",
      reason: "factual-error",
      detail: "The certificate date needs another look.",
    },
    "submitter",
    db,
  );
  assert.deepEqual(await createAppeal(reportId, "submitter", "Please look again.", db), {
    ok: false,
    reason: "not-appealable",
  });
  assert.equal(
    await resolveReport(reportId, "moderator", "dismissed", "The certificate still stands.", db),
    true,
  );
  const appeal = await createAppeal(reportId, "submitter", "The date on the certificate is wrong.", db);
  assert.equal(appeal.ok, true);

  const qa = sqlite
    .prepare(`SELECT id FROM place_dishes WHERE id = '2c75d665-aac7-4ba1-bb8e-e0ab68319d3f'`)
    .get();
  assert.equal(qa, undefined);
});
