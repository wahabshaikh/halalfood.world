/**
 * Product scopes. Each authority words its scopes differently, so the raw text is always kept
 * (`recognition.scopes_raw`) and mapped to our codes for filtering. The table mirrors `scope` and
 * `scope_map` in migrations/0005; codes are stable strings: add, never repurpose.
 */

export const SCOPE_LABELS = {
  food: "Food",
  beverages: "Beverages",
  meat_slaughter: "Slaughtering",
  drugs_pharma: "Drugs and pharmaceuticals",
  cosmetics: "Cosmetics",
  chemicals: "Chemical products",
  biological: "Biological products",
  consumer_goods: "Consumer goods",
  gmo: "GMO products",
  storage: "Storage",
  packaging: "Packaging",
  distribution: "Distribution",
  processing: "Processing",
  sales: "Sales",
  serving: "Serving",
} as const;

export type ScopeCode = keyof typeof SCOPE_LABELS;

export const SCOPE_CODES = Object.keys(SCOPE_LABELS) as ScopeCode[];

/** BPJPH's `jenis` values, exactly as the official list writes them (case variants included). */
export const BPJPH_SCOPE_MAP: Record<string, ScopeCode> = {
  Food: "food",
  Beverages: "beverages",
  Cosmetics: "cosmetics",
  "Chemical products": "chemicals",
  "Chemical Products": "chemicals",
  "Slaughtering services": "meat_slaughter",
  "Slaughtering Services": "meat_slaughter",
  "Drugs/Pharmaceuticals": "drugs_pharma",
  Drugs: "drugs_pharma",
  "Consumer Goods": "consumer_goods",
  "Biological products": "biological",
  "Genetically modified organism (GMO) products": "gmo",
  "Storage services": "storage",
  "Packaging services": "packaging",
  "Distribution services": "distribution",
  "Processing services": "processing",
  "Sales services": "sales",
  "Serving services": "serving",
};

export function isScopeCode(value: unknown): value is ScopeCode {
  return typeof value === "string" && Object.hasOwn(SCOPE_LABELS, value);
}

export function scopeLabel(code: string): string {
  return isScopeCode(code) ? SCOPE_LABELS[code] : code;
}

/** "Food|Beverages" -> ["Food", "Beverages"], trimmed, empty parts dropped. */
export function splitBpjphScopes(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Our codes for a raw BPJPH scope string, in vocabulary order without duplicates, plus any parts we
 * could not map (shown raw, and a reason to extend the map).
 */
export function mapBpjphScopes(raw: string | null | undefined): { scopes: ScopeCode[]; unmapped: string[] } {
  const found = new Set<ScopeCode>();
  const unmapped: string[] = [];
  for (const part of splitBpjphScopes(raw)) {
    const code =
      BPJPH_SCOPE_MAP[part] ??
      Object.entries(BPJPH_SCOPE_MAP).find(([key]) => key.toLowerCase() === part.toLowerCase())?.[1];
    if (code) found.add(code);
    else unmapped.push(part);
  }
  return { scopes: SCOPE_CODES.filter((code) => found.has(code)), unmapped };
}
