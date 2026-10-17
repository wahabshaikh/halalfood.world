/**
 * Parser for BPJPH's list of recognised foreign halal certification bodies (Lembaga Halal Luar Negeri,
 * LHLN) at https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri.
 *
 * The page is a Next.js app: the table rows are not in the HTML markup but in the React Server Components
 * flight data, a series of `self.__next_f.push([1,"…"])` script chunks. The rows are the JSON array after
 * `"data":[{"lph_id"`, followed by `currentPage`, `totalItems`, `pageSize` and `totalPages`. Pages are
 * `?page=N`. Fixtures: tests/fixtures/certifiers/p1.html and p7.html (saved 17 Oct 2026).
 */
import { bpjphCountryCode } from "./countries";
import { mapBpjphScopes, type ScopeCode } from "./scopes";

export const BPJPH_AUTHORITY_ID = "bpjph";
export const BPJPH_SOURCE_ID = "bpjph-lhln";
export const BPJPH_LIST_URL = "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri";

/** One row exactly as BPJPH publishes it. */
export type BpjphRawRow = {
  lph_id: string;
  nama_lhln: string;
  alamat: string | null;
  kota: string | null;
  negara: string | null;
  lokasi: string | null;
  jenis: string | null;
  no_reg: string | null;
  tgl_berlaku: string | null;
  status: string | null;
};

const RAW_FIELDS = ["lph_id", "nama_lhln", "alamat", "kota", "negara", "lokasi", "jenis", "no_reg", "tgl_berlaku", "status"] as const;

export type BpjphPageMeta = { currentPage: number; totalItems: number; pageSize: number; totalPages: number };

export type BpjphPage = { ok: true; rows: BpjphRawRow[]; meta: BpjphPageMeta } | { ok: false; error: string };

/** One recognition as we store it, cleaned from a raw row. Nothing is added that the source does not say. */
export type SourceRow = {
  /** BPJPH's own id for the body (`lph_id`): stable across renames. */
  sourceKey: string;
  name: string;
  countryRaw: string | null;
  countryCode: string | null;
  city: string | null;
  address: string | null;
  scopesRaw: string | null;
  scopes: ScopeCode[];
  sourceRef: string | null;
  validUntil: string | null;
  sourceStatus: string | null;
};

export function bpjphPageUrl(page: number): string {
  return page <= 1 ? BPJPH_LIST_URL : `${BPJPH_LIST_URL}?page=${page}`;
}

/** The concatenated flight data of every `self.__next_f.push([1, "…"])` chunk. */
export function flightText(html: string): string {
  const chunks: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      chunks.push(JSON.parse(match[1]) as string);
    } catch {
      // A chunk that is not a plain string literal carries no table data.
    }
  }
  return chunks.join("");
}

/** The JSON array that starts at `start` (a `[`), respecting strings; null if it never closes. */
function balancedArray(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/** RSC escapes a literal leading `$` as `$$`; `$undefined` is a missing value. */
function flightString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value === "$undefined") return null;
  return value.startsWith("$$") ? value.slice(1) : value;
}

function metaNumber(text: string, key: string): number | null {
  const match = text.match(new RegExp(`"${key}":(\\d+)`));
  return match ? Number(match[1]) : null;
}

/** Parse one saved or fetched BPJPH page. Any change in the page's shape is an error, never an empty list. */
export function parseBpjphPage(html: string): BpjphPage {
  const flight = flightText(html);
  if (!flight) return { ok: false, error: "No flight data on the page." };
  const marker = flight.indexOf('"data":[{"lph_id"');
  if (marker < 0) {
    if (/"data":\[\]/.test(flight) && /"totalItems":0\b/.test(flight)) return { ok: false, error: "The list is empty." };
    return { ok: false, error: "The table data was not found." };
  }
  const arrayStart = marker + '"data":'.length;
  const arrayText = balancedArray(flight, arrayStart);
  if (!arrayText) return { ok: false, error: "The table data is cut off." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return { ok: false, error: "The table data is not valid JSON." };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "The table data is not a list." };

  const rows: BpjphRawRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return { ok: false, error: "A table row is not an object." };
    const record = item as Record<string, unknown>;
    const row = Object.fromEntries(RAW_FIELDS.map((field) => [field, flightString(record[field])])) as Record<string, string | null>;
    if (!row.lph_id || !row.nama_lhln?.trim()) return { ok: false, error: "A table row has no id or name." };
    rows.push(row as BpjphRawRow);
  }

  const tail = flight.slice(arrayStart + arrayText.length, arrayStart + arrayText.length + 400);
  const currentPage = metaNumber(tail, "currentPage");
  const totalItems = metaNumber(tail, "totalItems");
  const pageSize = metaNumber(tail, "pageSize");
  const totalPages = metaNumber(tail, "totalPages");
  if (currentPage === null || totalItems === null || pageSize === null || totalPages === null)
    return { ok: false, error: "The page counts were not found." };
  return { ok: true, rows, meta: { currentPage, totalItems, pageSize, totalPages } };
}

function clean(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** `tgl_berlaku` as an ISO date, or null when the list gives none. */
function isoDate(value: string | null): string | null {
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ])/);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1] ? null : match[1];
}

/** A raw row as we store it: name trimmed, country mapped, scopes mapped, nothing invented. */
export function toSourceRow(raw: BpjphRawRow): SourceRow {
  return {
    sourceKey: raw.lph_id.trim(),
    name: raw.nama_lhln.trim(),
    countryRaw: clean(raw.negara),
    countryCode: bpjphCountryCode(raw.negara),
    city: clean(raw.kota),
    address: clean(raw.alamat),
    scopesRaw: raw.jenis,
    scopes: mapBpjphScopes(raw.jenis).scopes,
    sourceRef: clean(raw.no_reg),
    validUntil: isoDate(raw.tgl_berlaku),
    sourceStatus: clean(raw.status),
  };
}

/**
 * A stable JSON form of the whole list (rows sorted by id, fields in a fixed order). Its hash is the
 * snapshot's `content_hash`, so a check stops early when the list is unchanged even if the page's
 * markup, build id or nonces differ.
 */
export function canonicalRowsJson(rows: readonly BpjphRawRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.lph_id < b.lph_id ? -1 : a.lph_id > b.lph_id ? 1 : 0));
  return JSON.stringify(sorted.map((row) => RAW_FIELDS.map((field) => row[field] ?? null)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
