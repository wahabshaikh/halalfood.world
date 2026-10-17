/**
 * Countries for the certifier directory.
 *
 * Official lists name countries in their own language and spelling (BPJPH writes "Polandia" and "Kolombia"),
 * so every source's wording is mapped to an ISO 3166-1 alpha-2 code here. Pages use the code's English name
 * and a slug built from it. A source country that is not mapped stays unknown rather than guessed.
 */

/** ISO code -> English name. Add a country here before mapping a source's wording to it. */
export const COUNTRY_NAMES: Record<string, string> = {
  AE: "United Arab Emirates",
  AR: "Argentina",
  AT: "Austria",
  AU: "Australia",
  BE: "Belgium",
  BR: "Brazil",
  BY: "Belarus",
  CA: "Canada",
  CH: "Switzerland",
  CL: "Chile",
  CN: "China",
  CO: "Colombia",
  DE: "Germany",
  DK: "Denmark",
  ES: "Spain",
  FR: "France",
  GB: "United Kingdom",
  ID: "Indonesia",
  IE: "Ireland",
  IN: "India",
  IT: "Italy",
  JP: "Japan",
  KR: "South Korea",
  LK: "Sri Lanka",
  LT: "Lithuania",
  MX: "Mexico",
  MY: "Malaysia",
  NL: "Netherlands",
  NZ: "New Zealand",
  PH: "Philippines",
  PK: "Pakistan",
  PL: "Poland",
  PT: "Portugal",
  RU: "Russia",
  SA: "Saudi Arabia",
  SE: "Sweden",
  SG: "Singapore",
  TH: "Thailand",
  TN: "Tunisia",
  TR: "Turkey",
  TW: "Taiwan",
  US: "United States",
  UY: "Uruguay",
  VN: "Vietnam",
  ZA: "South Africa",
};

/** BPJPH's `negara` values, exactly as the official list writes them. */
export const BPJPH_COUNTRY_CODES: Record<string, string> = {
  Argentina: "AR",
  Australia: "AU",
  Austria: "AT",
  Belarus: "BY",
  Belgium: "BE",
  Brazil: "BR",
  Canada: "CA",
  Chile: "CL",
  China: "CN",
  Denmark: "DK",
  France: "FR",
  Germany: "DE",
  India: "IN",
  Ireland: "IE",
  Italy: "IT",
  Japan: "JP",
  Kolombia: "CO",
  Lithuania: "LT",
  Malaysia: "MY",
  Mexico: "MX",
  Netherlands: "NL",
  "New Zealand": "NZ",
  Pakistan: "PK",
  Philippines: "PH",
  Polandia: "PL",
  Portugal: "PT",
  Russia: "RU",
  "Saudi Arabia": "SA",
  Singapore: "SG",
  "South Africa": "ZA",
  "South Korea": "KR",
  Spain: "ES",
  "Sri Lanka": "LK",
  Sweden: "SE",
  Switzerland: "CH",
  Taiwan: "TW",
  Thailand: "TH",
  Tunisia: "TN",
  Turkey: "TR",
  "United Arab Emirates": "AE",
  "United Kingdom": "GB",
  "United States of America": "US",
  Uruguay: "UY",
  Vietnam: "VN",
};

/** The ISO code for a BPJPH country name, or null when it is not mapped yet. */
export function bpjphCountryCode(negara: string | null | undefined): string | null {
  if (typeof negara !== "string") return null;
  const name = negara.trim();
  if (BPJPH_COUNTRY_CODES[name]) return BPJPH_COUNTRY_CODES[name];
  const folded = name.toLowerCase();
  const match = Object.entries(BPJPH_COUNTRY_CODES).find(([key]) => key.toLowerCase() === folded);
  return match ? match[1] : null;
}

export function countryName(code: string | null | undefined): string | null {
  return code ? (COUNTRY_NAMES[code] ?? null) : null;
}

/** "United States" -> "united-states". */
export function countrySlug(code: string): string | null {
  const name = countryName(code);
  return name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : null;
}

/** The ISO code for a `/certifiers/from/[slug]` segment, or null. */
export function countryCodeFromSlug(slug: string | null | undefined): string | null {
  if (typeof slug !== "string") return null;
  const wanted = slug.trim().toLowerCase();
  return Object.keys(COUNTRY_NAMES).find((code) => countrySlug(code) === wanted) ?? null;
}
