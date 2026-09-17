import { sql } from "drizzle-orm";
import { database } from "../db";
import type {
  HalalVerificationStatus,
  ValidatedHalalVerification,
} from "./halal-verification";

export type PublicHalalEvidence =
  | { kind: "link"; url: string }
  | {
      kind: "upload";
      url: string;
      contentType: string;
      fileName: string;
    };

export type PublicHalalVerification = {
  id: string;
  status: Extract<HalalVerificationStatus, "pending" | "approved">;
  note: string | null;
  createdAt: string;
  evidence: PublicHalalEvidence[];
};

export type UploadAccess = {
  status: Extract<HalalVerificationStatus, "pending" | "approved">;
  contentType: string;
  fileName: string;
};

export type HalalVerificationCreateResult = {
  id: string;
  status: "pending";
};

export interface HalalVerificationRepository {
  hasPlace(placeId: string): Promise<boolean>;
  list(
    placeId: string,
    userId: string | null,
  ): Promise<PublicHalalVerification[]>;
  create(
    userId: string,
    placeId: string,
    input: ValidatedHalalVerification,
  ): Promise<HalalVerificationCreateResult>;
  getUploadAccess(key: string, userId: string | null): Promise<UploadAccess | null>;
}

type DatabaseClient = Awaited<ReturnType<typeof database>>;

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function visibleStatus(value: unknown): Extract<HalalVerificationStatus, "pending" | "approved"> {
  return value === "approved" ? "approved" : "pending";
}

function uploadUrl(key: string): string {
  return `/api/uploads/r2?key=${encodeURIComponent(key)}`;
}

function mapEvidence(value: unknown): PublicHalalEvidence[] {
  let entries = value;
  if (typeof value === "string") {
    try {
      entries = JSON.parse(value);
    } catch {
      entries = [];
    }
  }
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((raw): PublicHalalEvidence[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (item.kind === "link" && typeof item.url === "string")
      return [{ kind: "link", url: item.url }];
    if (
      item.kind === "upload" &&
      typeof item.r2_key === "string" &&
      typeof item.content_type === "string" &&
      typeof item.file_name === "string"
    )
      return [
        {
          kind: "upload",
          url: uploadUrl(item.r2_key),
          contentType: item.content_type,
          fileName: item.file_name,
        },
      ];
    return [];
  });
}

export function d1HalalVerificationRepository(
  client: DatabaseClient | Promise<DatabaseClient> = database(),
): HalalVerificationRepository {
  return {
    async hasPlace(placeId) {
      const db = await client;
      const rows = await db.all(sql`
        SELECT 1
        FROM places
        WHERE id = ${placeId} AND halal_confirmed = 1
        LIMIT 1
      `);
      return rows.length > 0;
    },

    async list(placeId, userId) {
      const db = await client;
      const visibility = userId
        ? sql`(v.status = 'approved' OR (v.status = 'pending' AND v.submitted_by_user_id = ${userId}))`
        : sql`v.status = 'approved'`;
      const rows = await db.all<Record<string, unknown>>(sql`
        SELECT
          v.id AS id,
          v.status,
          v.note,
          v.created_at,
          COALESCE(
            (
              SELECT json_group_array(json_object(
                'kind', e.kind, 'url', e.url, 'r2_key', e.r2_key,
                'content_type', e.content_type, 'file_name', e.file_name
              ))
              FROM (
                SELECT * FROM place_halal_verification_evidence
                WHERE verification_id = v.id
                ORDER BY created_at, id
              ) AS e
            ),
            '[]'
          ) AS evidence
        FROM place_halal_verifications AS v
        INNER JOIN places AS p ON p.id = v.place_id
        WHERE v.place_id = ${placeId}
          AND p.halal_confirmed = 1
          AND ${visibility}
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT 25
      `);
      return rows.map((row) => ({
        id: String(row.id),
        status: visibleStatus(row.status),
        note: typeof row.note === "string" ? row.note : null,
        createdAt: isoDate(row.created_at),
        evidence: mapEvidence(row.evidence),
      }));
    },

    async create(userId, placeId, input) {
      const db = await client;
      const verificationId = crypto.randomUUID();
      const now = Date.now();
      await db.transaction(async (tx) => {
        await tx.run(sql`
          INSERT INTO place_halal_verifications (
            id, place_id, submitted_by_user_id, status, note, created_at, updated_at
          ) VALUES (
            ${verificationId},
            ${placeId},
            ${userId},
            'pending',
            ${input.note},
            ${now},
            ${now}
          )
        `);
        for (const item of input.evidence) {
          const evidenceId = crypto.randomUUID();
          if (item.kind === "link") {
            await tx.run(sql`
              INSERT INTO place_halal_verification_evidence (
                id, verification_id, kind, url, r2_key, content_type, file_name,
                size_bytes, created_at
              ) VALUES (
                ${evidenceId}, ${verificationId}, 'link', ${item.url},
                NULL, NULL, NULL, NULL, ${now}
              )
            `);
          } else {
            await tx.run(sql`
              INSERT INTO place_halal_verification_evidence (
                id, verification_id, kind, url, r2_key, content_type, file_name,
                size_bytes, created_at
              ) VALUES (
                ${evidenceId}, ${verificationId}, 'upload', NULL,
                ${item.key}, ${item.contentType}, ${item.fileName}, ${item.sizeBytes}, ${now}
              )
            `);
          }
        }
      });
      return { id: verificationId, status: "pending" };
    },

    async getUploadAccess(key, userId) {
      const db = await client;
      const visibility = userId
        ? sql`(v.status = 'approved' OR (v.status = 'pending' AND v.submitted_by_user_id = ${userId}))`
        : sql`v.status = 'approved'`;
      const rows = await db.all<{ status?: unknown; content_type?: unknown; file_name?: unknown }>(sql`
        SELECT v.status, e.content_type, e.file_name
        FROM place_halal_verification_evidence AS e
        INNER JOIN place_halal_verifications AS v
          ON v.id = e.verification_id
        INNER JOIN places AS p ON p.id = v.place_id
        WHERE e.kind = 'upload'
          AND e.r2_key = ${key}
          AND p.halal_confirmed = 1
          AND ${visibility}
        LIMIT 1
      `);
      const row = rows[0];
      if (
        !row ||
        typeof row.content_type !== "string" ||
        typeof row.file_name !== "string"
      )
        return null;
      return {
        status: visibleStatus(row.status),
        contentType: row.content_type,
        fileName: row.file_name,
      };
    },
  };
}

export type HalalVerificationMutationResult =
  | { ok: true; verification: HalalVerificationCreateResult }
  | { ok: false; reason: "not-found" };

export async function submitHalalVerification(
  repository: HalalVerificationRepository,
  userId: string,
  placeId: string,
  input: ValidatedHalalVerification,
): Promise<HalalVerificationMutationResult> {
  if (!(await repository.hasPlace(placeId)))
    return { ok: false, reason: "not-found" };
  return {
    ok: true,
    verification: await repository.create(userId, placeId, input),
  };
}
