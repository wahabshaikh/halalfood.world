import { cityName } from "../lib/seo";
import { eatingCityOptions } from "../lib/eating-city";
import { Button } from "@halalfood/ui/components/button";

/** One submit chooses the city used for cards, suggestions, events, and the map. */
export function EatingCityForm({
  cities,
  selected,
  networkLabel,
  next = "/",
}: {
  cities: readonly { city_slug: string }[];
  selected: string | null;
  /** Approximate network label, shown as a hint and never applied on its own. */
  networkLabel: string | null;
  next?: string;
}) {
  const options = eatingCityOptions(cities);
  return (
    <form
      id="where-eating"
      action="/eating"
      method="get"
      className="mb-8 grid gap-2.5 rounded-2xl border bg-card p-4"
    >
      <label htmlFor="eating-city" className="text-base font-extrabold">
        Where are you eating?
      </label>
      <p className="text-sm text-muted-foreground">
        {networkLabel
          ? `A network location looks like ${networkLabel}. That can be denied, stale, or wrong, so it does not choose this list.`
          : "No network location is available. Choose a city to set the list, the map, events, and suggestions."}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          id="eating-city"
          name="city"
          defaultValue={selected ?? ""}
          className="h-11 w-full rounded-full border bg-background px-4 text-sm font-semibold sm:w-auto sm:min-w-48 sm:flex-1"
        >
          <option value="">Choose a city</option>
          {options.map((city) => (
            <option key={city.city_slug} value={city.city_slug}>
              {cityName(city.city_slug)}
            </option>
          ))}
        </select>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Use this city
        </Button>
        {selected ? (
          <Button asChild type="button" size="lg" variant="outline" className="w-full sm:w-auto">
            <a href={`/eating?clear=1&next=${encodeURIComponent(next)}`}>Clear city</a>
          </Button>
        ) : null}
      </div>
      {selected ? (
        <p className="text-sm">
          Showing <strong>{cityName(selected)}</strong>. This choice is saved on this browser.
        </p>
      ) : null}
    </form>
  );
}
