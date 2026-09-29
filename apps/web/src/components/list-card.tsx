import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@halalfood/ui/components/item";
import { PlacePhoto } from "./place-photo";
import type { ListCard } from "../lib/lists-repository";

/**
 * A list as a row: the cover place's art, the title, the caption and who made
 * it. Saves are shown as a count of diners, never as a rank or a verdict.
 */
export function ListCards({
  lists,
  showOwner = true,
  meta,
}: {
  lists: readonly ListCard[];
  showOwner?: boolean;
  /** Extra text after the counts, such as a list's visibility. */
  meta?: (list: ListCard) => React.ReactNode;
}) {
  return (
    <ItemGroup className="gap-2">
      {lists.map((list) => (
        <Item key={list.id} asChild variant="outline" className="items-start gap-3.5 rounded-xl">
          <a href={`/list/${list.id}`}>
            <ItemMedia className="w-16 shrink-0 self-start">
              <PlacePhoto
                seed={list.displayCoverPlaceId ?? list.id}
                name={list.coverPlaceName ?? list.title}
                className="aspect-square rounded-lg"
              />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="font-bold">{list.title}</ItemTitle>
              {list.caption && <ItemDescription>{list.caption}</ItemDescription>}
              <ItemDescription className="text-xs">
                {showOwner && <>by @{list.owner.handle} · </>}
                {list.itemCount} {list.itemCount === 1 ? "place" : "places"}
                {list.saveCount > 0 && (
                  <>
                    {" "}
                    · {list.saveCount} {list.saveCount === 1 ? "save" : "saves"}
                  </>
                )}
                {meta && <> · {meta(list)}</>}
              </ItemDescription>
            </ItemContent>
          </a>
        </Item>
      ))}
    </ItemGroup>
  );
}
