/**
 * Shapes shared by the certifier pages and the read-only JSON API. Pure: callers pass today's date.
 */
import { canonical } from "@/lib/seo";
import { countryName } from "./countries";
import { displayStatus, validUntilText, type DisplayStatus } from "./display";
import { IMPORTING_COUNTRIES, importingCountryForAuthority } from "./importing";
import type { RecognitionRow, Source } from "./repository";
import type { ScopeCode } from "./scopes";

export type CertifierSummary = {
  certifierId: string;
  slug: string;
  name: string;
  countryCode: string | null;
  city: string | null;
  /** One recognition per authority id. */
  recognitions: Record<string, RecognitionRow>;
};

/** Rows from `listCurrentRecognitions` grouped into one entry per certifier, in name order. */
export function groupByCertifier(rows: readonly RecognitionRow[]): CertifierSummary[] {
  const out = new Map<string, CertifierSummary>();
  for (const row of rows) {
    const entry = out.get(row.certifierId) ?? {
      certifierId: row.certifierId,
      slug: row.slug,
      name: row.name,
      countryCode: row.countryCode,
      city: row.city,
      recognitions: {},
    };
    entry.recognitions[row.authorityId] = row;
    out.set(row.certifierId, entry);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export type RecognitionJson = {
  authority: string;
  importingCountry: string | null;
  status: DisplayStatus;
  sourceStatus: string | null;
  scopes: ScopeCode[];
  scopesRaw: string | null;
  validUntil: string | null;
  registrationNumber: string | null;
  officialList: string | null;
  lastCheckedAt: string;
};

export function recognitionJson(rec: RecognitionRow, sources: readonly Source[], today: string): RecognitionJson {
  const source = sources.find((each) => each.authorityId === rec.authorityId);
  return {
    authority: rec.authorityId,
    importingCountry: importingCountryForAuthority(rec.authorityId)?.code ?? null,
    status: displayStatus(rec.status, rec.validUntil, today),
    sourceStatus: rec.sourceStatus,
    scopes: rec.scopes,
    scopesRaw: rec.scopesRaw,
    validUntil: rec.validUntil,
    registrationNumber: rec.sourceRef,
    officialList: source?.url ?? null,
    lastCheckedAt: new Date(rec.lastCheckedAt).toISOString(),
  };
}

export function certifierJson(
  certifier: { slug: string; name: string; countryCode: string | null; city: string | null },
  recognitions: readonly RecognitionRow[],
  sources: readonly Source[],
  today: string,
) {
  return {
    slug: certifier.slug,
    name: certifier.name,
    url: canonical(`/certifiers/${certifier.slug}`),
    basedIn: { country: certifier.countryCode, countryName: countryName(certifier.countryCode), city: certifier.city },
    recognitions: recognitions.map((rec) => recognitionJson(rec, sources, today)),
  };
}

/** "Chullora 2190, Australia" — city as the source writes it, then the country. */
export function basedIn(city: string | null, countryCode: string | null): string {
  return [city, countryName(countryCode)].filter(Boolean).join(", ") || "Not given";
}

/** Rows for one authority's table (components/hf/certifier-table.tsx). */
export function tableRows(recs: readonly RecognitionRow[], today: string) {
  return recs.map((rec) => ({
    slug: rec.slug,
    name: rec.name,
    countryCode: rec.countryCode,
    countryName: countryName(rec.countryCode),
    city: rec.city,
    scopes: rec.scopes,
    scopesRaw: rec.scopesRaw,
    validUntil: rec.validUntil,
    validText: validUntilText(rec.validUntil, today),
    status: displayStatus(rec.status, rec.validUntil, today),
    sourceRef: rec.sourceRef,
  }));
}

/** Rows for the hub's cross-country table (components/hf/certifier-directory.tsx). */
export function directoryEntries(groups: readonly CertifierSummary[], aliases: ReadonlyMap<string, string[]>, today: string) {
  return groups.map((group) => ({
    slug: group.slug,
    name: group.name,
    aliases: aliases.get(group.certifierId) ?? [],
    countryCode: group.countryCode,
    basedIn: basedIn(group.city, group.countryCode),
    cells: Object.fromEntries(
      IMPORTING_COUNTRIES.map((country) => {
        const rec = group.recognitions[country.authorityId];
        return [
          country.slug,
          rec ? { status: displayStatus(rec.status, rec.validUntil, today), validText: validUntilText(rec.validUntil, today), scopes: rec.scopes } : null,
        ];
      }),
    ),
  }));
}

/** Countries certifiers are based in, with how many, for filters and /certifiers/from links. */
export function basedInCountries(groups: readonly CertifierSummary[]) {
  const counts = new Map<string, number>();
  for (const group of groups) if (group.countryCode) counts.set(group.countryCode, (counts.get(group.countryCode) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, count]) => ({ code, name: countryName(code) ?? code, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
