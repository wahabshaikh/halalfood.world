/**
 * Importing countries with a directory page, and the authority whose list each one shows. Only
 * Indonesia (BPJPH) is live; JAKIM, MOIAT and GAC are added here once their sources are checked.
 */
import { BPJPH_AUTHORITY_ID, BPJPH_SOURCE_ID } from "./bpjph";

export type ImportingCountry = {
  slug: string;
  name: string;
  code: string;
  authorityId: string;
  sourceId: string;
  /** How the page names the authority. */
  authorityShort: string;
  authorityLong: string;
  guide: { path: string; title: string } | null;
};

export const IMPORTING_COUNTRIES: readonly ImportingCountry[] = [
  {
    slug: "indonesia",
    name: "Indonesia",
    code: "ID",
    authorityId: BPJPH_AUTHORITY_ID,
    sourceId: BPJPH_SOURCE_ID,
    authorityShort: "BPJPH",
    authorityLong: "Badan Penyelenggara Jaminan Produk Halal (BPJPH), Indonesia's Halal Product Assurance Organizing Agency",
    guide: { path: "/certifiers/guides/indonesia-halal-import-rules-2026", title: "Indonesia halal import rules 2026: what exporters should know" },
  },
];

export function importingCountry(slug: string | null | undefined): ImportingCountry | null {
  return IMPORTING_COUNTRIES.find((country) => country.slug === slug) ?? null;
}

export function importingCountryForAuthority(authorityId: string): ImportingCountry | null {
  return IMPORTING_COUNTRIES.find((country) => country.authorityId === authorityId) ?? null;
}
