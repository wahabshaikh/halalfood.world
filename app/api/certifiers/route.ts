import { json, unavailable } from "@/lib/api";
import { isoToday } from "@/lib/certifiers/display";
import { listCurrentRecognitions, listSources } from "@/lib/certifiers/repository";
import { certifierJson, groupByCertifier } from "@/lib/certifiers/views";

/**
 * Read-only directory: every certifier currently on an official list, with each recognition's status,
 * scopes, official date and last check. `?country=AU` narrows to bodies based in one country.
 */
export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("country");
  const countryCode = raw && /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : undefined;
  if (raw && !countryCode) return json({ error: "country must be a two-letter ISO code." }, { status: 400 });
  try {
    const [rows, sources] = await Promise.all([listCurrentRecognitions({ countryCode }), listSources()]);
    const today = isoToday();
    return json({
      certifiers: groupByCertifier(rows).map((entry) => certifierJson(entry, Object.values(entry.recognitions), sources, today)),
      sources: sources.map((source) => ({
        id: source.id,
        authority: source.authorityId,
        url: source.url,
        lastCheckedAt: source.lastOkAt ? new Date(source.lastOkAt).toISOString() : null,
      })),
    });
  } catch {
    return unavailable();
  }
}
