/**
 * Evidence besides checks (docs/spec/halal-model.md): people send a photo
 * of a halal certificate or a menu, a moderator reviews it, and once approved
 * it counts toward the place's halal status. Map listings are imported by
 * `scripts/import-listing-signals.ts` and land here already approved.
 */
import { sql } from "drizzle-orm";
import {
  SOURCE_FACTS,
  listingFacts,
  type Definite,
  type DocumentSource,
  type Fact,
  type ListingClaim,
} from "@/lib/core/halal";
import { database } from "@/lib/db";
import { recomputePlaceStatus, runBatch, type Recompute } from "./checks-repository";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
type Client = DatabaseClient | Promise<DatabaseClient>;

export type EvidenceInput = {
  kind: DocumentSource;
  photoId: string;
  /** What the document shows. Only the facts its kind can answer are kept. */
  answers: Partial<Record<Fact, Definite>>;
  certifier: string | null;
  expiresAt: number | null;
};

export type EvidenceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const DAY = 24 * 60 * 60 * 1000;

/** Parse a submission body leniently, or say what is wrong with it. */
export function validateEvidence(body: unknown, now = Date.now()): EvidenceResult<EvidenceInput> {
  if (!body || typeof body !== "object") return { ok: false, status: 400, error: "Send a valid JSON object." };
  const input = body as Record<string, unknown>;
  const kind = input.kind;
  if (kind !== "certificate" && kind !== "menu") return { ok: false, status: 400, error: "Choose a certificate or a menu." };
  if (typeof input.photoId !== "string" || !input.photoId.trim())
    return { ok: false, status: 400, error: "Upload a photo of it first." };

  const answers: Partial<Record<Fact, Definite>> = {};
  if (kind === "certificate") answers.certified = "yes";
  else
    for (const fact of SOURCE_FACTS.menu)
      if (input[fact] === "yes" || input[fact] === "no") answers[fact] = input[fact];
  if (!Object.keys(answers).length)
    return { ok: false, status: 400, error: "Say whether the menu shows pork or alcohol." };

  let certifier: string | null = null;
  if (kind === "certificate" && typeof input.certifier === "string") {
    const text = input.certifier.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
    certifier = text ? text.slice(0, 120) : null;
  }
  let expiresAt: number | null = null;
  if (kind === "certificate" && input.expiresOn !== undefined && input.expiresOn !== null && input.expiresOn !== "") {
    const parsed = typeof input.expiresOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)
      ? Date.parse(`${input.expiresOn}T00:00:00Z`)
      : NaN;
    if (!Number.isFinite(parsed)) return { ok: false, status: 400, error: "Write the expiry date as YYYY-MM-DD." };
    // The certificate is good through its expiry day.
    expiresAt = parsed + DAY;
    if (expiresAt <= now) return { ok: false, status: 400, error: "That certificate has already expired." };
  }
  return { ok: true, value: { kind, photoId: input.photoId.trim(), answers, certifier, expiresAt } };
}

/** Store a certificate or menu for review. The photo must be the sender's own, at this place. */
export async function submitEvidence(
  userId: string,
  placeId: string,
  input: EvidenceInput,
  client: Client = database(),
  now = Date.now(),
): Promise<EvidenceResult<{ id: string }>> {
  const db = await client;
  const [photo] = await db.all<{ id: string }>(sql`
    SELECT ph.id FROM place_photos ph JOIN places p ON p.id = ph.place_id
    WHERE ph.id = ${input.photoId} AND ph.place_id = ${placeId} AND ph.user_id = ${userId} AND p.listing_status = 'listed'
  `);
  if (!photo) return { ok: false, status: 404, error: "That photo could not be found at this place." };
  const [existing] = await db.all<{ id: string }>(sql`
    SELECT id FROM place_signals WHERE photo_id = ${input.photoId} AND review_status = 'pending'
  `);
  if (existing) return { ok: true, value: { id: existing.id } };
  const id = crypto.randomUUID();
  const { answers } = input;
  await runBatch(db, [
    sql`INSERT INTO place_signals (id, place_id, source, owned, certified, pork, alcohol, photo_id, submitted_by_user_id,
        certifier, expires_at, review_status, created_at, updated_at)
      VALUES (${id}, ${placeId}, ${input.kind}, ${answers.owned ?? null}, ${answers.certified ?? null},
        ${answers.pork ?? null}, ${answers.alcohol ?? null}, ${input.photoId}, ${userId}, ${input.certifier},
        ${input.expiresAt}, 'pending', ${now}, ${now})`,
  ]);
  return { ok: true, value: { id } };
}

export type EvidenceView = {
  id: string;
  placeId: string;
  placeName: string;
  kind: DocumentSource;
  answers: Partial<Record<Fact, Definite>>;
  certifier: string | null;
  expiresAt: number | null;
  photoKey: string | null;
  submittedBy: string | null;
  createdAt: number;
};

/** Certificates and menus waiting on a moderator, oldest first. */
export async function listPendingEvidence(client: Client = database()): Promise<EvidenceView[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT s.id, s.place_id, p.name AS place_name, s.source, s.owned, s.certified, s.pork, s.alcohol,
      s.certifier, s.expires_at, s.created_at, ph.r2_key, pr.handle
    FROM place_signals s
    JOIN places p ON p.id = s.place_id
    LEFT JOIN place_photos ph ON ph.id = s.photo_id
    LEFT JOIN profiles pr ON pr.user_id = s.submitted_by_user_id
    WHERE s.review_status = 'pending' AND s.source IN ('certificate', 'menu')
    ORDER BY s.created_at ASC
    LIMIT 100
  `);
  return rows.map((row) => {
    const answers: Partial<Record<Fact, Definite>> = {};
    for (const fact of ["owned", "certified", "pork", "alcohol"] as const)
      if (row[fact] === "yes" || row[fact] === "no") answers[fact] = row[fact];
    return {
      id: String(row.id),
      placeId: String(row.place_id),
      placeName: String(row.place_name),
      kind: row.source as DocumentSource,
      answers,
      certifier: (row.certifier as string | null) ?? null,
      expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
      photoKey: (row.r2_key as string | null) ?? null,
      submittedBy: (row.handle as string | null) ?? null,
      createdAt: Number(row.created_at),
    };
  });
}

export type ReviewDecision = "approve" | "reject";

/** Approve or reject one pending document, audit it, and recompute the place. */
export async function reviewEvidence(
  signalId: string,
  moderatorId: string,
  decision: ReviewDecision,
  reason: string | null,
  client: Client = database(),
  now = Date.now(),
): Promise<EvidenceResult<{ recompute: Recompute }>> {
  const db = await client;
  const [signal] = await db.all<{ place_id: string; source: string; review_status: string }>(sql`
    SELECT place_id, source, review_status FROM place_signals WHERE id = ${signalId}
  `);
  if (!signal || signal.source === "listing") return { ok: false, status: 404, error: "That evidence could not be found." };
  if (signal.review_status !== "pending") return { ok: false, status: 409, error: "That evidence was already reviewed." };
  const next = decision === "approve" ? "approved" : "rejected";
  await runBatch(db, [
    sql`UPDATE place_signals SET review_status = ${next}, reviewed_by_user_id = ${moderatorId}, reviewed_at = ${now},
        updated_at = ${now} WHERE id = ${signalId} AND review_status = 'pending'`,
    sql`INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
      VALUES (${crypto.randomUUID()}, ${moderatorId}, ${`${decision}-evidence`}, 'place_signal', ${signalId}, ${reason},
        ${JSON.stringify({ review_status: "pending" })}, ${JSON.stringify({ review_status: next })}, ${now})`,
  ]);
  const recompute = await recomputePlaceStatus(signal.place_id, db, now);
  return { ok: true, value: { recompute } };
}

export type ListingSignalInput = {
  placeId: string;
  provider: "osm" | "geoapify";
  externalId: string;
  claim: ListingClaim;
};

/**
 * Insert or refresh a map listing's halal claim and recompute the place when
 * the claim changed. Listings need no review: they never settle a fact.
 */
export async function upsertListingSignal(
  input: ListingSignalInput,
  client: Client = database(),
  now = Date.now(),
): Promise<{ changed: boolean }> {
  const db = await client;
  const [current] = await db.all<{ listing_claim: string }>(sql`
    SELECT listing_claim FROM place_signals
    WHERE place_id = ${input.placeId} AND provider = ${input.provider} AND external_id = ${input.externalId} AND source = 'listing'
  `);
  if (current?.listing_claim === input.claim) return { changed: false };
  const facts = listingFacts(input.claim);
  await runBatch(db, [
    sql`INSERT INTO place_signals (id, place_id, source, provider, external_id, owned, certified, pork, alcohol, listing_claim,
        review_status, reviewed_at, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${input.placeId}, 'listing', ${input.provider}, ${input.externalId},
        ${facts.owned ?? null}, ${facts.certified ?? null}, ${facts.pork ?? null}, ${facts.alcohol ?? null}, ${input.claim},
        'approved', ${now}, ${now}, ${now})
      ON CONFLICT (place_id, provider, external_id) WHERE source = 'listing' DO UPDATE SET
        owned = excluded.owned, certified = excluded.certified, pork = excluded.pork, alcohol = excluded.alcohol,
        listing_claim = excluded.listing_claim, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at`,
  ]);
  await recomputePlaceStatus(input.placeId, db, now);
  return { changed: true };
}
