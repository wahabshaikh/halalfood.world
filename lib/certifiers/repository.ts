/**
 * D1 reads and writes for the certifier directory. Pages, the JSON API, the admin queue and the check
 * runner all go through here; the rules themselves are pure (diff.ts, display.ts, names.ts).
 */
import { sql, type SQL } from "drizzle-orm";
import { database } from "@/lib/db";
import { runBatch } from "@/lib/checks-repository";
import type { SourceRow } from "./bpjph";
import { parseJsonObject } from "./display";
import type { ChangeKind, RecognitionStatus, ReviewState } from "./diff";
import { normaliseName, uniqueSlug } from "./names";
import { SCOPE_CODES, isScopeCode, type ScopeCode } from "./scopes";

type DatabaseClient = Awaited<ReturnType<typeof database>>;
export type Client = DatabaseClient | Promise<DatabaseClient>;

export type Authority = { id: string; name: string; shortName: string; countryCodes: string[]; website: string | null };

export type Source = {
  id: string;
  authorityId: string;
  url: string;
  lastCheckedAt: number | null;
  lastOkAt: number | null;
  needsLook: boolean;
  /** For moderators only: why the last check failed or needs a look. */
  lastError: string | null;
};

export type RecognitionRow = {
  recognitionId: string;
  certifierId: string;
  slug: string;
  name: string;
  countryCode: string | null;
  city: string | null;
  address: string | null;
  authorityId: string;
  status: RecognitionStatus;
  scopes: ScopeCode[];
  scopesRaw: string | null;
  sourceRef: string | null;
  sourceStatus: string | null;
  validUntil: string | null;
  lastCheckedAt: number;
  updatedAt: number;
};

export type ChangeRow = {
  id: string;
  kind: ChangeKind;
  certifierId: string;
  certifierSlug: string;
  certifierName: string;
  authorityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detectedAt: number;
  publishedAt: number | null;
  reviewState: ReviewState;
  snapshotFetchedAt: number | null;
  sourceUrl: string | null;
};

function parseScopes(text: unknown): ScopeCode[] {
  try {
    const value = JSON.parse(String(text ?? "[]")) as unknown;
    return Array.isArray(value) ? SCOPE_CODES.filter((code) => value.includes(code)) : [];
  } catch {
    return [];
  }
}

const nullable = (value: unknown) => (value === null || value === undefined ? null : String(value));
const numberOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

const RECOGNITION_COLUMNS = sql`
  r.id AS recognition_id, c.id AS certifier_id, c.slug, c.name, c.country_code, c.city, c.address,
  r.authority_id, r.status, r.scopes, r.scopes_raw, r.source_ref, r.source_status, r.valid_until,
  r.last_checked_at, max(r.updated_at, c.updated_at) AS updated_at
`;

function toRecognition(row: Record<string, unknown>): RecognitionRow {
  return {
    recognitionId: String(row.recognition_id),
    certifierId: String(row.certifier_id),
    slug: String(row.slug),
    name: String(row.name),
    countryCode: nullable(row.country_code),
    city: nullable(row.city),
    address: nullable(row.address),
    authorityId: String(row.authority_id),
    status: row.status as RecognitionStatus,
    scopes: parseScopes(row.scopes),
    scopesRaw: nullable(row.scopes_raw),
    sourceRef: nullable(row.source_ref),
    sourceStatus: nullable(row.source_status),
    validUntil: nullable(row.valid_until),
    lastCheckedAt: Number(row.last_checked_at),
    updatedAt: Number(row.updated_at),
  };
}

function toChange(row: Record<string, unknown>): ChangeRow {
  return {
    id: String(row.id),
    kind: row.kind as ChangeKind,
    certifierId: String(row.certifier_id),
    certifierSlug: String(row.slug),
    certifierName: String(row.name),
    authorityId: String(row.authority_id),
    before: parseJsonObject(nullable(row.before_json)),
    after: parseJsonObject(nullable(row.after_json)),
    detectedAt: Number(row.detected_at),
    publishedAt: numberOrNull(row.published_at),
    reviewState: row.review_state as ReviewState,
    snapshotFetchedAt: numberOrNull(row.fetched_at),
    sourceUrl: nullable(row.url),
  };
}

/* ------------------------------------------------------------------------ */
/* Reads                                                                     */
/* ------------------------------------------------------------------------ */

export async function listAuthorities(client: Client = database()): Promise<Authority[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`SELECT id, name, short_name, country_codes, website FROM cert_authority ORDER BY id`);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    shortName: String(row.short_name),
    countryCodes: (() => {
      try {
        const codes = JSON.parse(String(row.country_codes)) as unknown;
        return Array.isArray(codes) ? codes.map(String) : [];
      } catch {
        return [];
      }
    })(),
    website: nullable(row.website),
  }));
}

export async function listSources(client: Client = database()): Promise<Source[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT id, authority_id, url, last_checked_at, last_ok_at, needs_look, last_error FROM cert_source WHERE active = 1 ORDER BY id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    authorityId: String(row.authority_id),
    url: String(row.url),
    lastCheckedAt: numberOrNull(row.last_checked_at),
    lastOkAt: numberOrNull(row.last_ok_at),
    needsLook: Number(row.needs_look) === 1,
    lastError: nullable(row.last_error),
  }));
}

/** Every body currently on any authority's list (removed and pending rows excluded). */
export async function listCurrentRecognitions(
  options: { authorityId?: string; countryCode?: string } = {},
  client: Client = database(),
): Promise<RecognitionRow[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${RECOGNITION_COLUMNS}
    FROM recognition r JOIN certifier c ON c.id = r.certifier_id
    WHERE r.status NOT IN ('removed', 'pending')
      ${options.authorityId ? sql`AND r.authority_id = ${options.authorityId}` : sql``}
      ${options.countryCode ? sql`AND c.country_code = ${options.countryCode}` : sql``}
    ORDER BY c.name COLLATE NOCASE, r.authority_id
  `);
  return rows.map(toRecognition);
}

/** Normalised aliases per certifier, for the hub's name search. */
export async function aliasesByCertifier(client: Client = database()): Promise<Map<string, string[]>> {
  const db = await client;
  const rows = await db.all<{ certifier_id: string; alias_norm: string }>(sql`SELECT certifier_id, alias_norm FROM certifier_alias`);
  const out = new Map<string, string[]>();
  for (const row of rows) out.set(row.certifier_id, [...(out.get(row.certifier_id) ?? []), row.alias_norm]);
  return out;
}

export type CertifierPage =
  | { kind: "found"; certifier: CertifierDetail }
  | { kind: "moved"; slug: string }
  | { kind: "missing" };

export type CertifierDetail = {
  id: string;
  slug: string;
  name: string;
  countryCode: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  aliases: string[];
  recognitions: RecognitionRow[];
  changes: ChangeRow[];
  updatedAt: number;
};

/** A certifier by slug, a redirect for an old slug, or missing. A body with no recognition yet is missing. */
export async function getCertifierBySlug(slug: string, client: Client = database()): Promise<CertifierPage> {
  const db = await client;
  const [row] = await db.all<Record<string, unknown>>(sql`
    SELECT id, slug, name, country_code, city, address, website, updated_at FROM certifier WHERE slug = ${slug}
  `);
  if (!row) {
    const [moved] = await db.all<{ slug: string }>(sql`
      SELECT c.slug FROM certifier_slug_history h JOIN certifier c ON c.id = h.certifier_id WHERE h.old_slug = ${slug}
    `);
    return moved ? { kind: "moved", slug: moved.slug } : { kind: "missing" };
  }
  const id = String(row.id);
  const [recognitions, aliases, changes] = await Promise.all([
    db.all<Record<string, unknown>>(sql`
      SELECT ${RECOGNITION_COLUMNS}
      FROM recognition r JOIN certifier c ON c.id = r.certifier_id
      WHERE r.certifier_id = ${id} AND r.status != 'pending'
      ORDER BY r.authority_id
    `),
    db.all<{ alias_norm: string }>(sql`SELECT alias_norm FROM certifier_alias WHERE certifier_id = ${id} ORDER BY alias_norm`),
    listPublishedChanges({ certifierId: id, limit: 50 }, db),
  ]);
  if (!recognitions.length) return { kind: "missing" };
  const recs = recognitions.map(toRecognition);
  return {
    kind: "found",
    certifier: {
      id,
      slug: String(row.slug),
      name: String(row.name),
      countryCode: nullable(row.country_code),
      city: nullable(row.city),
      address: nullable(row.address),
      website: nullable(row.website),
      aliases: aliases.map((alias) => alias.alias_norm),
      recognitions: recs,
      changes,
      updatedAt: Math.max(Number(row.updated_at), ...recs.map((rec) => rec.updatedAt)),
    },
  };
}

const CHANGE_COLUMNS = sql`
  ch.id, ch.kind, ch.certifier_id, c.slug, c.name, ch.authority_id, ch.before_json, ch.after_json,
  ch.detected_at, ch.published_at, ch.review_state, s.fetched_at, src.url
`;

/** Published changes, newest first. */
export async function listPublishedChanges(
  options: { certifierId?: string; authorityId?: string; limit?: number } = {},
  client: Client = database(),
): Promise<ChangeRow[]> {
  const db = await client;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${CHANGE_COLUMNS}
    FROM cert_change ch
      JOIN certifier c ON c.id = ch.certifier_id
      LEFT JOIN cert_snapshot s ON s.id = ch.snapshot_id
      LEFT JOIN cert_source src ON src.id = s.source_id
    WHERE ch.review_state = 'published'
      ${options.certifierId ? sql`AND ch.certifier_id = ${options.certifierId}` : sql``}
      ${options.authorityId ? sql`AND ch.authority_id = ${options.authorityId}` : sql``}
    ORDER BY ch.published_at DESC, ch.detected_at DESC, ch.id
    LIMIT ${limit}
  `);
  return rows.map(toChange);
}

/** The admin review queue, oldest first. */
export async function listPendingChanges(client: Client = database()): Promise<ChangeRow[]> {
  const db = await client;
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT ${CHANGE_COLUMNS}
    FROM cert_change ch
      JOIN certifier c ON c.id = ch.certifier_id
      LEFT JOIN cert_snapshot s ON s.id = ch.snapshot_id
      LEFT JOIN cert_source src ON src.id = s.source_id
    WHERE ch.review_state = 'pending'
    ORDER BY ch.detected_at, ch.id
    LIMIT 200
  `);
  return rows.map(toChange);
}

export type SitemapEntry = { path: string; lastModified: number };

/** Directory pages with their last real data change (never the last check). */
export async function certifierSitemapEntries(client: Client = database()): Promise<{
  certifiers: SitemapEntry[];
  authorities: { authorityId: string; lastModified: number }[];
  fromCountries: { countryCode: string; lastModified: number }[];
}> {
  const db = await client;
  const [certifiers, authorities, countries] = await Promise.all([
    db.all<{ slug: string; updated_at: number }>(sql`
      SELECT c.slug, max(c.updated_at, max(r.updated_at)) AS updated_at
      FROM certifier c JOIN recognition r ON r.certifier_id = c.id
      WHERE r.status != 'pending'
      GROUP BY c.id ORDER BY c.slug LIMIT 5000
    `),
    db.all<{ authority_id: string; updated_at: number }>(sql`
      SELECT authority_id, max(updated_at) AS updated_at FROM recognition WHERE status != 'pending' GROUP BY authority_id
    `),
    db.all<{ country_code: string; updated_at: number }>(sql`
      SELECT c.country_code, max(max(c.updated_at, r.updated_at)) AS updated_at
      FROM certifier c JOIN recognition r ON r.certifier_id = c.id
      WHERE r.status NOT IN ('removed', 'pending') AND c.country_code IS NOT NULL
      GROUP BY c.country_code
    `),
  ]);
  return {
    certifiers: certifiers.map((row) => ({ path: `/certifiers/${row.slug}`, lastModified: Number(row.updated_at) })),
    authorities: authorities.map((row) => ({ authorityId: row.authority_id, lastModified: Number(row.updated_at) })),
    fromCountries: countries.map((row) => ({ countryCode: row.country_code, lastModified: Number(row.updated_at) })),
  };
}

/* ------------------------------------------------------------------------ */
/* Applying a change                                                         */
/* ------------------------------------------------------------------------ */

export type StoredChange = {
  id: string;
  kind: ChangeKind;
  recognitionId: string | null;
  certifierId: string;
  authorityId: string;
  sourceId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

function codes(value: unknown): ScopeCode[] {
  return Array.isArray(value) ? value.filter(isScopeCode) : [];
}

function orderedUnion(...lists: ScopeCode[][]): ScopeCode[] {
  const set = new Set(lists.flat());
  return SCOPE_CODES.filter((code) => set.has(code));
}

/**
 * The statements that make a published change true in `recognition` and `certifier`. Scope changes add
 * or remove only their own codes, so an auto-published addition never sneaks through a pending removal.
 */
export async function applyChangeStatements(db: DatabaseClient, change: StoredChange, reviewer: string, now: number): Promise<SQL[]> {
  const after = change.after ?? {};
  const out: SQL[] = [];
  const touchCertifier = sql`UPDATE certifier SET updated_at = ${now} WHERE id = ${change.certifierId}`;

  if (change.kind === "added") {
    const row = after as Partial<SourceRow>;
    const recognitionId = change.recognitionId ?? crypto.randomUUID();
    const values = {
      scopes: JSON.stringify(codes(row.scopes)),
      scopesRaw: row.scopesRaw ?? null,
      sourceRef: row.sourceRef ?? null,
      sourceKey: row.sourceKey ?? null,
      sourceStatus: row.sourceStatus ?? null,
      validUntil: row.validUntil ?? null,
    };
    out.push(sql`
      INSERT INTO recognition (id, certifier_id, authority_id, status, scopes, scopes_raw, source_ref, source_key, source_status,
        valid_until, first_seen_at, last_seen_at, last_checked_at, updated_at, source_id)
      VALUES (${recognitionId}, ${change.certifierId}, ${change.authorityId}, 'recognised', ${values.scopes}, ${values.scopesRaw},
        ${values.sourceRef}, ${values.sourceKey}, ${values.sourceStatus}, ${values.validUntil}, ${now}, ${now}, ${now}, ${now}, ${change.sourceId})
      ON CONFLICT (certifier_id, authority_id) DO UPDATE SET
        status = 'recognised', scopes = excluded.scopes, scopes_raw = excluded.scopes_raw, source_ref = excluded.source_ref,
        source_key = excluded.source_key, source_status = excluded.source_status, valid_until = excluded.valid_until,
        last_seen_at = excluded.last_seen_at, last_checked_at = excluded.last_checked_at, updated_at = excluded.updated_at
    `);
    out.push(sql`
      UPDATE cert_change SET recognition_id = (SELECT id FROM recognition WHERE certifier_id = ${change.certifierId} AND authority_id = ${change.authorityId})
      WHERE id = ${change.id}
    `);
    out.push(touchCertifier);
  } else if (change.kind === "removed" && change.recognitionId) {
    out.push(sql`UPDATE recognition SET status = 'removed', updated_at = ${now} WHERE id = ${change.recognitionId}`);
    out.push(touchCertifier);
  } else if ((change.kind === "scope_added" || change.kind === "scope_removed") && change.recognitionId) {
    const [current] = await db.all<{ scopes: string }>(sql`SELECT scopes FROM recognition WHERE id = ${change.recognitionId}`);
    const held = parseScopes(current?.scopes);
    const added = codes(after.added);
    const removed = codes(after.removed);
    const next = change.kind === "scope_added" ? orderedUnion(held, added) : held.filter((code) => !removed.includes(code));
    // The raw text matches the codes once nothing is still waiting on review.
    const rawSettled = change.kind === "scope_removed" || !removed.some((code) => next.includes(code));
    out.push(sql`
      UPDATE recognition SET scopes = ${JSON.stringify(next)},
        scopes_raw = ${rawSettled ? sql`${(after.scopesRaw as string | null) ?? null}` : sql`scopes_raw`},
        updated_at = ${now}
      WHERE id = ${change.recognitionId}
    `);
    out.push(touchCertifier);
  } else if (change.kind === "date_changed" && change.recognitionId) {
    out.push(sql`UPDATE recognition SET valid_until = ${(after.validUntil as string | null) ?? null}, updated_at = ${now} WHERE id = ${change.recognitionId}`);
    out.push(touchCertifier);
  } else if (change.kind === "renamed") {
    const name = typeof after.name === "string" ? after.name.trim() : "";
    if (name) {
      const [current] = await db.all<{ slug: string }>(sql`SELECT slug FROM certifier WHERE id = ${change.certifierId}`);
      const taken = await db.all<{ slug: string }>(sql`
        SELECT slug FROM certifier WHERE id != ${change.certifierId} UNION SELECT old_slug FROM certifier_slug_history WHERE certifier_id != ${change.certifierId}
      `);
      const slug = uniqueSlug(name, new Set(taken.map((row) => row.slug)));
      out.push(sql`UPDATE certifier SET name = ${name}, slug = ${slug}, updated_at = ${now} WHERE id = ${change.certifierId}`);
      if (current && current.slug !== slug) {
        out.push(sql`
          INSERT INTO certifier_slug_history (old_slug, certifier_id, created_at) VALUES (${current.slug}, ${change.certifierId}, ${now})
          ON CONFLICT (old_slug) DO UPDATE SET certifier_id = excluded.certifier_id
        `);
        // The new slug must not keep redirecting to itself.
        out.push(sql`DELETE FROM certifier_slug_history WHERE old_slug = ${slug}`);
      }
      out.push(sql`
        INSERT OR IGNORE INTO certifier_alias (certifier_id, alias_norm, authority_id) VALUES (${change.certifierId}, ${normaliseName(name)}, ${change.authorityId})
      `);
    }
  }
  out.push(sql`UPDATE cert_change SET review_state = 'published', reviewed_by = ${reviewer}, published_at = ${now} WHERE id = ${change.id}`);
  return out;
}

async function loadStoredChange(db: DatabaseClient, id: string): Promise<(StoredChange & { reviewState: ReviewState }) | null> {
  const [row] = await db.all<Record<string, unknown>>(sql`
    SELECT ch.id, ch.kind, ch.recognition_id, ch.certifier_id, ch.authority_id, ch.before_json, ch.after_json, ch.review_state, s.source_id
    FROM cert_change ch JOIN cert_snapshot s ON s.id = ch.snapshot_id WHERE ch.id = ${id}
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    kind: row.kind as ChangeKind,
    recognitionId: nullable(row.recognition_id),
    certifierId: String(row.certifier_id),
    authorityId: String(row.authority_id),
    sourceId: String(row.source_id),
    before: parseJsonObject(nullable(row.before_json)),
    after: parseJsonObject(nullable(row.after_json)),
    reviewState: row.review_state as ReviewState,
  };
}

export type ReviewResult = { ok: true; state: ReviewState } | { ok: false; status: number; error: string };

/** A moderator approves (publishes) or rejects a pending change. Both write `audit_log`. */
export async function reviewChange(
  id: string,
  moderatorId: string,
  decision: "approve" | "reject",
  client: Client = database(),
  now = Date.now(),
): Promise<ReviewResult> {
  const db = await client;
  const change = await loadStoredChange(db, id);
  if (!change) return { ok: false, status: 404, error: "That change could not be found." };
  if (change.reviewState !== "pending") return { ok: false, status: 409, error: "That change has already been reviewed." };
  const audit = sql`
    INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, reason, before_value, after_value, created_at)
    VALUES (${crypto.randomUUID()}, ${moderatorId}, ${decision === "approve" ? "cert-change-approve" : "cert-change-reject"}, 'cert_change', ${id}, ${change.kind},
      ${change.before ? JSON.stringify(change.before) : null}, ${change.after ? JSON.stringify(change.after) : null}, ${now})
  `;
  if (decision === "reject") {
    await runBatch(db, [
      sql`UPDATE cert_change SET review_state = 'rejected', reviewed_by = ${moderatorId} WHERE id = ${id} AND review_state = 'pending'`,
      audit,
    ]);
    return { ok: true, state: "rejected" };
  }
  await runBatch(db, [...(await applyChangeStatements(db, change, moderatorId, now)), audit]);
  return { ok: true, state: "published" };
}

/* ------------------------------------------------------------------------ */
/* Alerts                                                                    */
/* ------------------------------------------------------------------------ */

export type AlertFilter = { authorities: string[]; certifiers: string[]; scopes: ScopeCode[] };

/**
 * Store a sign-up, unconfirmed and weekly. The same address with the same filter is stored once, so a
 * repeat sign-up is harmless and says nothing about whether the address was already there.
 */
export async function saveAlertSubscription(
  email: string,
  filter: AlertFilter,
  userId: string | null,
  client: Client = database(),
  now = Date.now(),
): Promise<void> {
  const db = await client;
  const filterJson = JSON.stringify(filter);
  await db.run(sql`
    INSERT INTO cert_alert_sub (id, email, user_id, filter_json, frequency, created_at)
    SELECT ${crypto.randomUUID()}, ${email}, ${userId}, ${filterJson}, 'weekly', ${now}
    WHERE NOT EXISTS (
      SELECT 1 FROM cert_alert_sub WHERE email = ${email} AND filter_json = ${filterJson} AND unsubscribed_at IS NULL
    )
  `);
}
