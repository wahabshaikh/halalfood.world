import { MENU_SOURCE_LABEL, previewMenu } from "@/lib/core/menus";
import type { PlaceMenu, PlaceMenuItem } from "@/lib/menus";
import { SectionTitle } from "./kit";

function Items({ section, items, heading = true }: { section: string | null; items: PlaceMenuItem[]; heading?: boolean }) {
  return (
    <div className="grid gap-1">
      {heading && section && <h3 className="pt-2 text-[13px] font-black tracking-wide text-muted-foreground uppercase">{section}</h3>}
      <ul className="grid">
        {items.map((item) => (
          <li key={item.position} className="grid gap-0.5 border-b border-border/70 py-2 last:border-b-0">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-[15px] font-bold">{item.name}</span>
              <span className="shrink-0 text-[15px] font-extrabold tabular-nums">{item.price}</span>
            </span>
            {item.description && <span className="text-[13px] font-semibold text-muted-foreground">{item.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The menu the place publishes, by section with prices, its sources and the
 * date Halal Food Scout read it. Long menus show their first items and fold
 * the rest behind "Show all".
 */
export function PlaceMenuSection({ menu, className }: { menu: PlaceMenu; className?: string }) {
  const { shown, rest } = previewMenu(menu.sections);
  const read = new Date(menu.capturedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <section aria-labelledby="menu" className={className}>
      <div className="grid gap-3">
        <SectionTitle id="menu">Menu</SectionTitle>
        <div className="grid md:max-w-xl">
          {shown.map((section, index) => (
            <Items key={`shown-${index}`} section={section.section} items={section.items} />
          ))}
          {rest.length > 0 && (
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-extrabold text-primary group-open:hidden [&::-webkit-details-marker]:hidden">
                Show all {menu.itemCount} items
              </summary>
              {rest.map((section, index) => (
                <Items key={`rest-${index}`} section={section.section} items={section.items} heading={!section.continued} />
              ))}
            </details>
          )}
        </div>
        <p className="text-[13px] leading-relaxed font-semibold text-muted-foreground">
          As published by the restaurant, read by Halal Food Scout on {read}
          {menu.sources.length > 0 && (
            <>
              {" from "}
              {menu.sources.map((source, index) => (
                <span key={source.url}>
                  {index > 0 && ", "}
                  <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 hover:text-foreground">
                    {MENU_SOURCE_LABEL[source.type]}
                  </a>
                </span>
              ))}
            </>
          )}
          . Prices may have changed. A menu isn’t a halal check.
        </p>
      </div>
    </section>
  );
}
