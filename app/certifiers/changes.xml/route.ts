import { CHANGE_LABEL, changeSentence } from "@/lib/certifiers/display";
import { atomFeed } from "@/lib/certifiers/export";
import { importingCountryForAuthority } from "@/lib/certifiers/importing";
import { listPublishedChanges } from "@/lib/certifiers/repository";
import { SEED_CHECKED_AT } from "@/lib/certifiers/seed-sql";
import { canonical } from "@/lib/seo";

/** Atom feed of published changes to the official certifier lists. */
export async function GET(): Promise<Response> {
  try {
    const changes = await listPublishedChanges({ limit: 100 });
    const xml = atomFeed({
      id: canonical("/certifiers/changes"),
      title: "Changes to official halal certifier lists · halalfood.world",
      selfLink: canonical("/certifiers/changes.xml"),
      htmlLink: canonical("/certifiers/changes"),
      updated: new Date(changes[0]?.publishedAt ?? SEED_CHECKED_AT),
      entries: changes.map((change) => {
        const short = importingCountryForAuthority(change.authorityId)?.authorityShort ?? change.authorityId;
        return {
          id: `urn:halalfood:cert-change:${change.id}`,
          title: `${CHANGE_LABEL[change.kind]}: ${change.certifierName} (${short})`,
          summary: changeSentence(change.kind, change.before, change.after, short),
          link: canonical(`/certifiers/${change.certifierSlug}`),
          updated: new Date(change.publishedAt ?? change.detectedAt),
        };
      }),
    });
    return new Response(xml, {
      headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new Response("This is temporarily unavailable. Please try again.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
