import { exploreLists } from "../lib/lists";
import { photoUrl } from "../lib/place-view";
import { PlaceArt, SectionTitle } from "./kit";

/**
 * The rows above the place list on Explore: events this week and guides &
 * lists for the city. Each row hides itself when empty.
 */
export async function ExploreExtras({ citySlug }: { citySlug: string; cityLabel: string; viewerId: string | null }) {
  const lists = await exploreLists(citySlug).catch(() => []);
  return (
    <>
      {lists.length > 0 && (
        <section aria-labelledby="guides-title" className="grid gap-2.5">
          <div className="px-5">
            <SectionTitle id="guides-title">Guides & lists</SectionTitle>
          </div>
          <div className="flex gap-3 overflow-x-auto px-5 [scrollbar-width:none]">
            {lists.map((list) => (
              <a key={list.id} href={`/list/${list.id}`} className="grid w-44 shrink-0 gap-1.5 text-foreground">
                <span className="relative">
                  <PlaceArt name={list.coverName ?? list.title} seed={list.coverPlaceId ?? list.id} src={photoUrl(list.coverKey)} className="h-28 w-full" rounded="rounded-2xl" />
                  {list.kind === "guide" && <span className="absolute top-2 left-2 rounded-full bg-background px-2 py-0.5 text-[11px] font-black">Guide</span>}
                </span>
                <strong className="line-clamp-2 text-[15px] leading-snug font-extrabold">{list.title}</strong>
                <span className="text-xs font-bold text-muted-foreground">
                  {list.items} places{list.kind !== "guide" && list.ownerName ? ` · ${list.ownerName}` : ""}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
