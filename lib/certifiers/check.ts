/**
 * The source check: fetch an official list, keep the raw pages in R2, record a snapshot, and turn what
 * changed into `cert_change` rows (docs/spec/certifiers.md).
 *
 * Runs from the Worker's scheduled() handler (worker/index.ts) and from POST /api/certifiers/check.
 * One run per active source; only the BPJPH parser exists so far.
 */
import { sql, type SQL } from "drizzle-orm";
import { database } from "@/lib/db";
import { runBatch } from "@/lib/checks-repository";
import { getEvidenceBucket, type R2BucketLike } from "@/lib/r2";
import {
  BPJPH_AUTHORITY_ID,
  bpjphPageUrl,
  canonicalRowsJson,
  parseBpjphPage,
  sha256Hex,
  toSourceRow,
  type BpjphRawRow,
  type SourceRow,
} from "./bpjph";
import { diffRecognitions, removalsAllowed, reviewStateFor, type CurrentRecognition, type DetectedChange, type RecognitionStatus } from "./diff";
import { normaliseName, uniqueSlug } from "./names";
import { applyChangeStatements, type Client } from "./repository";
import { mapBpjphScopes, SCOPE_CODES, type ScopeCode } from "./scopes";

export const CHECK_USER_AGENT = "halalfood.world certifier check (+https://halalfood.world/certifiers/methodology)";
/** Pause between pages of one list, so a check is never a burst against a government site. */
export const PAGE_DELAY_MS = 1000;
/** BPJPH lists ~20 rows a page; more pages than this means the page has changed shape. */
export const MAX_PAGES = 40;

type DatabaseClient = Awaited<ReturnType<typeof database>>;

export type CheckDeps = {
  client?: Client;
  fetcher?: typeof fetch;
  /** The evidence bucket; `null` skips storing pages (tests). Defaults to HALAL_EVIDENCE_R2. */
  bucket?: R2BucketLike | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type CheckSummary = {
  sourceId: string;
  ok: boolean;
  unchanged: boolean;
  rows: number;
  changes: number;
  published: number;
  pending: number;
  suppressedRemovals: number;
  needsLook: boolean;
  unmappedScopes: string[];
  error: string | null;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchPage(url: string, fetcher: typeof fetch, sleep: (ms: number) => Promise<void>): Promise<{ status: number; html: string }> {
  let lastError = "The list could not be fetched.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await sleep(PAGE_DELAY_MS * 2 * attempt);
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { "User-Agent": CHECK_USER_AGENT, Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      lastError = "The list could not be reached.";
      continue;
    }
    if (response.ok) return { status: response.status, html: await response.text() };
    lastError = `The list answered HTTP ${response.status}.`;
    // Only a busy or failing server is worth asking again.
    if (response.status !== 429 && response.status < 500) break;
  }
  throw new Error(lastError);
}

function isoDay(at: number) {
  return new Date(at).toISOString().slice(0, 10);
}

/** All pages of the BPJPH list, stored as fetched. Any page that fails to parse fails the whole run. */
async function fetchBpjphList(
  sourceId: string,
  at: number,
  fetcher: typeof fetch,
  bucket: R2BucketLike | null,
  sleep: (ms: number) => Promise<void>,
): Promise<{ rows: BpjphRawRow[]; status: number; r2Prefix: string; error: string | null }> {
  const r2Prefix = `certifier-sources/bpjph/${isoDay(at)}/`;
  const rows: BpjphRawRow[] = [];
  let totalPages = 1;
  let totalItems = 0;
  let status = 0;
  for (let page = 1; page <= totalPages; page += 1) {
    if (page > 1) await sleep(PAGE_DELAY_MS);
    const fetched = await fetchPage(bpjphPageUrl(page), fetcher, sleep);
    status = fetched.status;
    if (bucket) {
      await bucket.put(`${r2Prefix}page-${page}.html`, new TextEncoder().encode(fetched.html).buffer as ArrayBuffer, {
        httpMetadata: { contentType: "text/html; charset=utf-8" },
        customMetadata: { source: sourceId, url: bpjphPageUrl(page), fetchedAt: String(at) },
      });
    }
    const parsed = parseBpjphPage(fetched.html);
    if (!parsed.ok) return { rows, status, r2Prefix, error: `Page ${page}: ${parsed.error}` };
    if (page === 1) {
      totalPages = parsed.meta.totalPages;
      totalItems = parsed.meta.totalItems;
      if (totalPages < 1 || totalPages > MAX_PAGES) return { rows, status, r2Prefix, error: `The list says it has ${totalPages} pages.` };
    }
    rows.push(...parsed.rows);
  }
  const ids = new Set(rows.map((row) => row.lph_id));
  if (ids.size !== rows.length) return { rows, status, r2Prefix, error: "The same body appeared on two pages; the list moved while we read it." };
  if (rows.length !== totalItems) return { rows, status, r2Prefix, error: `The list says ${totalItems} bodies but its pages hold ${rows.length}.` };
  return { rows, status, r2Prefix, error: null };
}

async function loadCurrent(db: DatabaseClient, authorityId: string) {
  const rows = await db.all<Record<string, unknown>>(sql`
    SELECT r.id, r.certifier_id, c.name, c.country_code, c.city, c.address, r.source_key, r.status, r.scopes, r.scopes_raw,
      r.valid_until, r.source_ref, r.source_status
    FROM recognition r JOIN certifier c ON c.id = r.certifier_id
    WHERE r.authority_id = ${authorityId}
  `);
  return rows.map((row) => {
    let scopes: ScopeCode[] = [];
    try {
      const parsed = JSON.parse(String(row.scopes)) as unknown;
      if (Array.isArray(parsed)) scopes = SCOPE_CODES.filter((code) => parsed.includes(code));
    } catch {
      // A malformed scopes cell diffs as empty, which surfaces as scope_added for review.
    }
    return {
      recognitionId: String(row.id),
      certifierId: String(row.certifier_id),
      name: String(row.name),
      sourceKey: row.source_key === null ? null : String(row.source_key),
      status: row.status as RecognitionStatus,
      scopes,
      scopesRaw: row.scopes_raw === null ? null : String(row.scopes_raw),
      validUntil: row.valid_until === null ? null : String(row.valid_until),
      details: {
        countryCode: row.country_code as string | null,
        city: row.city as string | null,
        address: row.address as string | null,
        sourceRef: row.source_ref as string | null,
        sourceStatus: row.source_status as string | null,
      },
    } satisfies CurrentRecognition & { details: Record<string, string | null> };
  });
}

/** Statements for a body we have never seen: the certifier row and its alias. */
async function newCertifier(db: DatabaseClient, row: SourceRow, authorityId: string, now: number): Promise<{ id: string; statements: SQL[] }> {
  const taken = await db.all<{ slug: string }>(sql`SELECT slug FROM certifier UNION SELECT old_slug FROM certifier_slug_history`);
  const id = crypto.randomUUID();
  const slug = uniqueSlug(row.name, new Set(taken.map((each) => each.slug)));
  return {
    id,
    statements: [
      sql`INSERT INTO certifier (id, slug, name, country_code, city, address, created_at, updated_at)
        VALUES (${id}, ${slug}, ${row.name}, ${row.countryCode}, ${row.city}, ${row.address}, ${now}, ${now})`,
      sql`INSERT OR IGNORE INTO certifier_alias (certifier_id, alias_norm, authority_id) VALUES (${id}, ${normaliseName(row.name)}, ${authorityId})`,
    ],
  };
}

function summary(sourceId: string, partial: Partial<CheckSummary>): CheckSummary {
  return {
    sourceId,
    ok: false,
    unchanged: false,
    rows: 0,
    changes: 0,
    published: 0,
    pending: 0,
    suppressedRemovals: 0,
    needsLook: false,
    unmappedScopes: [],
    error: null,
    ...partial,
  };
}

/** Check BPJPH's list once. Never throws for a site problem: the summary and `cert_source` say what happened. */
export async function runBpjphCheck(sourceId: string, deps: CheckDeps = {}): Promise<CheckSummary> {
  const db = await (deps.client ?? database());
  const fetcher = deps.fetcher ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = (deps.now ?? Date.now)();
  const bucket = deps.bucket === undefined ? await getEvidenceBucket() : deps.bucket;
  const authorityId = BPJPH_AUTHORITY_ID;

  let fetched: Awaited<ReturnType<typeof fetchBpjphList>>;
  try {
    fetched = await fetchBpjphList(sourceId, now, fetcher, bucket, sleep);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The list could not be fetched.";
    await db.run(sql`UPDATE cert_source SET last_error = ${message}, needs_look = 1 WHERE id = ${sourceId}`);
    return summary(sourceId, { error: message, needsLook: true });
  }

  const snapshotId = crypto.randomUUID();
  const hash = await sha256Hex(canonicalRowsJson(fetched.rows));
  if (fetched.error) {
    await runBatch(db, [
      sql`INSERT INTO cert_snapshot (id, source_id, fetched_at, http_status, content_hash, r2_key, row_count, parse_ok, error)
        VALUES (${snapshotId}, ${sourceId}, ${now}, ${fetched.status}, ${hash}, ${fetched.r2Prefix}, ${fetched.rows.length}, 0, ${fetched.error})`,
      sql`UPDATE cert_source SET last_checked_at = ${now}, last_error = ${fetched.error}, needs_look = 1 WHERE id = ${sourceId}`,
    ]);
    return summary(sourceId, { rows: fetched.rows.length, error: fetched.error, needsLook: true });
  }

  const rows = fetched.rows.map(toSourceRow);
  const unmappedScopes = [...new Set(fetched.rows.flatMap((row) => mapBpjphScopes(row.jenis).unmapped))];
  const snapshotRow = sql`INSERT INTO cert_snapshot (id, source_id, fetched_at, http_status, content_hash, r2_key, row_count, parse_ok, error)
    VALUES (${snapshotId}, ${sourceId}, ${now}, ${fetched.status}, ${hash}, ${fetched.r2Prefix}, ${rows.length}, 1, NULL)`;
  const [previous] = await db.all<{ content_hash: string }>(sql`
    SELECT content_hash FROM cert_snapshot WHERE source_id = ${sourceId} AND parse_ok = 1 ORDER BY fetched_at DESC LIMIT 1
  `);

  if (previous?.content_hash === hash) {
    await runBatch(db, [
      snapshotRow,
      sql`UPDATE recognition SET last_checked_at = ${now}, last_seen_at = ${now} WHERE source_id = ${sourceId} AND status NOT IN ('removed', 'pending')`,
      sql`UPDATE recognition SET last_checked_at = ${now} WHERE source_id = ${sourceId}`,
      sql`UPDATE cert_source SET last_checked_at = ${now}, last_ok_at = ${now}, last_error = NULL, needs_look = 0 WHERE id = ${sourceId}`,
    ]);
    return summary(sourceId, { ok: true, unchanged: true, rows: rows.length, unmappedScopes });
  }

  const current = await loadCurrent(db, authorityId);
  const aliasRows = await db.all<{ certifier_id: string; alias_norm: string }>(sql`SELECT certifier_id, alias_norm FROM certifier_alias`);
  const aliases = new Map(aliasRows.map((row) => [row.alias_norm, row.certifier_id]));
  const listed = current.filter((rec) => rec.status !== "removed" && rec.status !== "pending").length;
  const allowRemovals = removalsAllowed(listed, rows.length);
  const diff = diffRecognitions(current, rows, aliases, { allowRemovals });

  const statements: SQL[] = [snapshotRow];
  let published = 0;
  let pending = 0;
  const byId = new Map(current.map((rec) => [rec.recognitionId, rec]));

  for (const change of diff.changes) {
    let certifierId = change.certifierId;
    if (!certifierId && change.row) {
      const created = await newCertifier(db, change.row, authorityId, now);
      certifierId = created.id;
      statements.push(...created.statements);
      // Later rows in the same run match this new body by name rather than creating it twice.
      aliases.set(normaliseName(change.row.name), certifierId);
    }
    if (!certifierId) continue;
    const id = crypto.randomUUID();
    const state = reviewStateFor(change);
    statements.push(sql`
      INSERT INTO cert_change (id, recognition_id, certifier_id, authority_id, kind, before_json, after_json, snapshot_id, detected_at, review_state)
      VALUES (${id}, ${change.recognitionId}, ${certifierId}, ${authorityId}, ${change.kind},
        ${change.before ? JSON.stringify(change.before) : null}, ${change.after ? JSON.stringify(change.after) : null}, ${snapshotId}, ${now}, 'pending')
    `);
    if (state === "published") {
      published += 1;
      statements.push(
        ...(await applyChangeStatements(db, { ...(change as DetectedChange), id, certifierId, authorityId, sourceId }, "auto", now)),
      );
    } else pending += 1;
  }

  for (const { recognitionId, row } of diff.seen) {
    const held = byId.get(recognitionId);
    statements.push(sql`
      UPDATE recognition SET last_seen_at = ${now}, source_key = ${row.sourceKey},
        source_ref = ${row.sourceRef}, source_status = ${row.sourceStatus}
        ${held && (held.details.sourceRef !== row.sourceRef || held.details.sourceStatus !== row.sourceStatus) ? sql`, updated_at = ${now}` : sql``}
      WHERE id = ${recognitionId}
    `);
    // Where the body is based is a detail of the official row, refreshed without a change event.
    if (held && (held.details.countryCode !== row.countryCode || held.details.city !== row.city || held.details.address !== row.address))
      statements.push(sql`
        UPDATE certifier SET country_code = ${row.countryCode}, city = ${row.city}, address = ${row.address}, updated_at = ${now}
        WHERE id = ${held.certifierId}
      `);
  }

  const needsLook = !allowRemovals && diff.suppressedRemovals > 0;
  const note = needsLook ? `The list shrank from ${listed} to ${rows.length} bodies, so ${diff.suppressedRemovals} removals were held back.` : null;
  statements.push(
    sql`UPDATE recognition SET last_checked_at = ${now} WHERE source_id = ${sourceId}`,
    sql`UPDATE cert_source SET last_checked_at = ${now}, last_ok_at = ${now}, last_error = ${note}, needs_look = ${needsLook ? 1 : 0} WHERE id = ${sourceId}`,
  );
  await runBatch(db, statements);
  return summary(sourceId, {
    ok: true,
    rows: rows.length,
    changes: published + pending,
    published,
    pending,
    suppressedRemovals: diff.suppressedRemovals,
    needsLook,
    unmappedScopes,
    error: note,
  });
}

/** Every active source with a parser we have. Unknown parsers are skipped, not failed. */
export async function runCertifierChecks(deps: CheckDeps = {}): Promise<CheckSummary[]> {
  const db = await (deps.client ?? database());
  const sources = await db.all<{ id: string; parser: string }>(sql`SELECT id, parser FROM cert_source WHERE active = 1 ORDER BY id`);
  const out: CheckSummary[] = [];
  for (const source of sources) {
    if (source.parser === "bpjph_lhln") out.push(await runBpjphCheck(source.id, { ...deps, client: db }));
  }
  return out;
}
