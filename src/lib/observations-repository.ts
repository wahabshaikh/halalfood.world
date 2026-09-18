/**
 * D1 access for source records, observations and official inspections.
 *
 * Writes here are append-only by construction: there is no update path for an
 * observation's value. A correction is a new row, which is what keeps the
 * history readable.
 */

import { sql } from "drizzle-orm";
import { database } from "../db";
import {
  isSourceClass,
  projectFacts,
  type Observation,
  type ObservationConfidence,
  type ObservedFact,
  type SourceClass,
} from "./observations";

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function mapObservation(row: Record<string, unknown>): Observation | null {
  const observedAt = num(row.observed_at);
  if (typeof row.id !== "string" || observedAt === null) return null;
  return {
    id: row.id,
    predicate: String(row.predicate ?? ""),
    value: String(row.value ?? ""),
    source: String(row.source ?? ""),
    sourceClass: isSourceClass(row.source_class) ? row.source_class : "community",
    sourceUrl: text(row.source_url),
    observedAt,
    validUntil: num(row.valid_until),
    confidence:
      row.confidence === "high" || row.confidence === "low"
        ? (row.confidence as ObservationConfidence)
        : "medium",
    submittedByUserId: text(row.submitted_by_user_id),
  };
}

export async function listObservations(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<Observation[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, predicate, value, source, source_class, source_url, observed_at,
      valid_until, confidence, submitted_by_user_id
    FROM place_observations
    WHERE place_id = ${placeId} AND superseded_by_id IS NULL
    ORDER BY observed_at DESC
    LIMIT 1000
  `);
  return rows.flatMap((row) => {
    const observation = mapObservation(row);
    return observation ? [observation] : [];
  });
}

/** The currently published facts for one place, each with its provenance. */
export async function getObservedFacts(
  placeId: string,
  now: number = Date.now(),
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<Map<string, ObservedFact>> {
  return projectFacts(await listObservations(placeId, client), now);
}

export type AppendObservationInput = {
  placeId: string;
  predicate: string;
  value: string;
  source: string;
  sourceClass: SourceClass;
  sourceUrl?: string | null;
  observedAt: number;
  validUntil?: number | null;
  confidence?: ObservationConfidence;
  submittedByUserId?: string | null;
  sourceRecordId?: string | null;
};

/**
 * Append one observation. There is deliberately no "update" counterpart: a
 * changed value is a new row, and the previous reading stays in the history.
 */
export async function appendObservation(
  input: AppendObservationInput,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<string> {
  const db = await client;
  const id = crypto.randomUUID();
  await db.run(sql`
    INSERT INTO place_observations (
      id, place_id, predicate, value, source, source_class, source_record_id,
      source_url, submitted_by_user_id, observed_at, valid_until, confidence,
      superseded_by_id, created_at
    ) VALUES (
      ${id}, ${input.placeId}, ${input.predicate}, ${input.value}, ${input.source},
      ${input.sourceClass}, ${input.sourceRecordId ?? null}, ${input.sourceUrl ?? null},
      ${input.submittedByUserId ?? null}, ${input.observedAt},
      ${input.validUntil ?? null}, ${input.confidence ?? "medium"}, NULL, ${Date.now()}
    )
  `);
  return id;
}

/** Record that a provider was consulted, with its licence and attribution. */
export async function recordSource(
  input: {
    placeId: string;
    source: string;
    sourceClass: SourceClass;
    externalId?: string | null;
    url?: string | null;
    observedAt: number;
    licence?: string | null;
    attribution?: string | null;
    payloadHash?: string | null;
  },
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<string> {
  const db = await client;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.run(sql`
    INSERT INTO place_source_records (
      id, place_id, source, source_class, external_id, url, observed_at,
      licence, attribution, payload_hash, created_at
    ) VALUES (
      ${id}, ${input.placeId}, ${input.source}, ${input.sourceClass},
      ${input.externalId ?? null}, ${input.url ?? null}, ${input.observedAt},
      ${input.licence ?? null}, ${input.attribution ?? null},
      ${input.payloadHash ?? null}, ${now}
    )
    ON CONFLICT(place_id, source, external_id) DO UPDATE SET
      observed_at = excluded.observed_at,
      url = excluded.url,
      payload_hash = excluded.payload_hash
  `);
  return id;
}

/* ----------------------------------------------------------- inspections -- */

export type PlaceInspection = {
  id: string;
  authority: string;
  kind: "hygiene" | "licence" | "inspection";
  grade: string | null;
  score: number | null;
  licenceStatus: "active" | "expired" | "suspended" | "not-found" | null;
  licenceNumber: string | null;
  inspectedAt: number | null;
  validUntil: number | null;
  sourceUrl: string | null;
  retrievedAt: number;
  matchConfidence: "high" | "medium" | "low";
};

/**
 * Official records for one place. These are returned separately from every
 * diner-derived aggregate and are never mixed into one.
 */
export async function listInspections(
  placeId: string,
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): Promise<PlaceInspection[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, authority, kind, grade, score, licence_status, licence_number,
      inspected_at, valid_until, source_url, retrieved_at, match_confidence
    FROM place_inspections
    WHERE place_id = ${placeId}
    ORDER BY COALESCE(inspected_at, retrieved_at) DESC
    LIMIT 50
  `);
  return rows.map((row) => ({
    id: String(row.id),
    authority: String(row.authority ?? ""),
    kind:
      row.kind === "licence" || row.kind === "inspection"
        ? row.kind
        : "hygiene",
    grade: text(row.grade),
    score: num(row.score),
    licenceStatus:
      row.licence_status === "active" ||
      row.licence_status === "expired" ||
      row.licence_status === "suspended" ||
      row.licence_status === "not-found"
        ? row.licence_status
        : null,
    licenceNumber: text(row.licence_number),
    inspectedAt: num(row.inspected_at),
    validUntil: num(row.valid_until),
    sourceUrl: text(row.source_url),
    retrievedAt: num(row.retrieved_at) ?? 0,
    matchConfidence:
      row.match_confidence === "high" || row.match_confidence === "low"
        ? row.match_confidence
        : "medium",
  }));
}
