import { countryName } from "@/lib/certifiers/countries";
import { displayStatus, isoToday } from "@/lib/certifiers/display";
import { toCsv } from "@/lib/certifiers/export";
import { importingCountry } from "@/lib/certifiers/importing";
import { listCurrentRecognitions, listSources } from "@/lib/certifiers/repository";
import { scopeLabel } from "@/lib/certifiers/scopes";
import { canonical } from "@/lib/seo";

/** BPJPH's list as CSV: the same rows as /certifiers/country/indonesia, with the official wording kept. */
export async function GET(): Promise<Response> {
  const country = importingCountry("indonesia")!;
  try {
    const [recs, sources] = await Promise.all([listCurrentRecognitions({ authorityId: country.authorityId }), listSources()]);
    const source = sources.find((each) => each.id === country.sourceId);
    const today = isoToday();
    const csv = toCsv(
      [
        "name",
        "based_in_city",
        "based_in_country",
        "based_in_country_code",
        "address",
        "scopes",
        "scopes_official_wording",
        "valid_until",
        "status",
        "bpjph_registration_number",
        "bpjph_status",
        "profile_url",
        "official_list",
        "last_checked",
      ],
      recs.map((rec) => [
        rec.name,
        rec.city,
        countryName(rec.countryCode),
        rec.countryCode,
        rec.address,
        rec.scopes.map(scopeLabel).join("; "),
        rec.scopesRaw?.split("|").join("; ") ?? null,
        rec.validUntil,
        displayStatus(rec.status, rec.validUntil, today),
        rec.sourceRef,
        rec.sourceStatus,
        canonical(`/certifiers/${rec.slug}`),
        source?.url ?? null,
        new Date(rec.lastCheckedAt).toISOString(),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bpjph-recognised-halal-certifiers-${today}.csv"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("This is temporarily unavailable. Please try again.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
