import { json, notFound, unavailable } from "@/lib/api";
import { changeSentence, isoToday } from "@/lib/certifiers/display";
import { importingCountryForAuthority } from "@/lib/certifiers/importing";
import { certifierSlugParam } from "@/lib/certifiers/names";
import { getCertifierBySlug, listSources } from "@/lib/certifiers/repository";
import { certifierJson } from "@/lib/certifiers/views";

/** One certifier with its recognitions and published change history. A renamed body's old slug 308s. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const slug = certifierSlugParam((await params).slug);
  if (!slug) return notFound("That certifier could not be found.");
  try {
    const [page, sources] = await Promise.all([getCertifierBySlug(slug), listSources()]);
    if (page.kind === "moved") return Response.redirect(new URL(`/api/certifiers/${page.slug}`, request.url), 308);
    if (page.kind === "missing") return notFound("That certifier could not be found.");
    const { certifier } = page;
    return json({
      ...certifierJson(certifier, certifier.recognitions, sources, isoToday()),
      address: certifier.address,
      changes: certifier.changes.map((change) => ({
        kind: change.kind,
        authority: change.authorityId,
        summary: changeSentence(change.kind, change.before, change.after, importingCountryForAuthority(change.authorityId)?.authorityShort ?? change.authorityId),
        before: change.before,
        after: change.after,
        publishedAt: change.publishedAt ? new Date(change.publishedAt).toISOString() : null,
        snapshotAt: change.snapshotFetchedAt ? new Date(change.snapshotFetchedAt).toISOString() : null,
        officialList: change.sourceUrl,
      })),
    });
  } catch {
    return unavailable();
  }
}
