"use client";

import { useState } from "react";
import { Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { PlaceStatus } from "@/lib/core/halal";
import { MAX_VIDEO_PLACES } from "@/lib/core/videos";
import { Avatar, FormCard, Icon, StatusPill, buttonClass } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";

export type PastedVideo = {
  id: string;
  url: string;
  status: string;
  meta: { title: string | null; authorName: string | null; thumbnailUrl: string | null };
  creator: { handle: string; name: string | null; avatarUrl: string | null } | null;
  suggestions: Pick<Option, "id" | "name" | "address" | "status">[];
};
type Option = { id: string; name: string; address: string; status: PlaceStatus };
type Result = { status: "published" | "needs_review"; published: string[]; points: number };
type SearchPlace = { id: string; name: string; area: string; status: PlaceStatus };

/** YouTube paste (spec §5.1): the member picks the places the video shows. */
export function VideoPlaces({ video }: { video: PastedVideo }) {
  const [options, setOptions] = useState<Option[]>(video.suggestions);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(video.suggestions.slice(0, 1).map((place) => place.id)));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_VIDEO_PLACES) next.add(id);
      return next;
    });

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    try {
      const found = await api<{ places: SearchPlace[] }>(`/api/search?q=${encodeURIComponent(query.trim())}`);
      setResults(found.places);
    } catch (caught) {
      toast(errorText(caught));
    }
  };

  const add = (place: SearchPlace) => {
    if (!options.some((option) => option.id === place.id)) setOptions([...options, { id: place.id, name: place.name, address: place.area, status: place.status }]);
    if (!picked.has(place.id)) toggle(place.id);
    setResults([]);
    setQuery("");
  };

  const submit = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    try {
      setDone(await api<Result>(`/api/videos/${video.id}/places`, { method: "POST", json: { placeIds: [...picked] } }));
    } catch (caught) {
      toast(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const queued = done.status === "needs_review";
    return (
      <FormCard className="items-center gap-3.5 text-center max-md:pt-12">
        <span className="flex size-[76px] items-center justify-center rounded-full bg-success text-success-foreground">
          <Icon icon={Tick02Icon} size={38} strokeWidth={2.8} />
        </span>
        <h1 className="text-[28px] leading-tight font-black tracking-tight">{queued ? "Sent for review" : "Thanks for the video"}</h1>
        <p className="text-[15px] font-semibold text-subtle-foreground">
          {queued
            ? "A moderator checks videos from new members, usually within 3 days. Points arrive once it’s published."
            : done.published.length
              ? `${done.published.length === 1 ? "1 place now shows" : `${done.published.length} places now show`} Creator verified. You earned ${done.points} points.`
              : "Those places already had this video, so nothing changed."}
        </p>
        <div className="mt-6 grid w-full gap-2.5">
          {video.creator && (
            <a href={`/u/${video.creator.handle}`} className={buttonClass("dark", "lg")}>
              See @{video.creator.handle}
            </a>
          )}
          <a href="/add/video" className={buttonClass("outline", "lg")}>
            Paste another video
          </a>
        </div>
      </FormCard>
    );
  }

  return (
    <section className="grid gap-5">
      <div className="flex items-center gap-3 rounded-2xl border border-border p-3">
        {video.meta.thumbnailUrl ? (
          <img src={video.meta.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="size-16 shrink-0 rounded-xl bg-foreground/85" />
        )}
        <span className="grid min-w-0 gap-1">
          {video.meta.title && <strong className="line-clamp-2 text-[15px] font-extrabold">{video.meta.title}</strong>}
          {video.creator ? (
            <a href={`/u/${video.creator.handle}`} className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
              <Avatar name={video.creator.name ?? video.creator.handle} src={video.creator.avatarUrl} size={20} />
              <span className="truncate">@{video.creator.handle}</span>
            </a>
          ) : (
            <span className="text-[13px] font-semibold text-muted-foreground">{video.meta.authorName ?? "YouTube"}</span>
          )}
        </span>
      </div>

      {!video.creator ? (
        <p className="rounded-[20px] bg-muted p-[18px] text-sm font-semibold text-subtle-foreground">
          We couldn’t tell whose channel this is yet, so it can’t verify places. Try another video.
        </p>
      ) : (
        <>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-[17px] font-black">Which places are in it?</legend>
            {options.length === 0 && <p className="text-sm font-semibold text-muted-foreground">Search for the places it shows.</p>}
            {options.map((place) => (
              <label key={place.id} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-border px-3 py-2">
                <input type="checkbox" checked={picked.has(place.id)} onChange={() => toggle(place.id)} className="size-5 accent-primary" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <strong className="truncate text-[15px] font-extrabold">{place.name}</strong>
                  {place.address && <span className="truncate text-[13px] font-semibold text-muted-foreground">{place.address}</span>}
                </span>
                <StatusPill status={place.status} short />
              </label>
            ))}
          </fieldset>

          <form onSubmit={search} className="flex gap-2">
            <label className="flex h-[50px] min-w-0 flex-1 items-center gap-2 rounded-full bg-secondary px-[18px]">
              <Icon icon={Search01Icon} size={18} />
              <span className="sr-only">Search for a place</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Add another place"
                className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-muted-foreground"
              />
            </label>
            <button type="submit" disabled={!query.trim()} className={buttonClass("outline", "md", "h-[50px] px-5")}>
              Search
            </button>
          </form>
          {results.length > 0 && (
            <ul className="grid gap-1.5">
              {results.map((place) => (
                <li key={place.id}>
                  <button type="button" onClick={() => add(place)} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left hover:bg-muted">
                    <strong className="truncate text-[15px] font-extrabold">{place.name}</strong>
                    <span className="truncate text-[13px] font-semibold text-muted-foreground">{place.area}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] font-semibold text-muted-foreground">
            Not listed yet? <a href="/add" className="font-extrabold text-foreground underline-offset-4 hover:underline">Add the place</a> first.
          </p>
          <button type="button" onClick={submit} disabled={busy || !picked.size} className={buttonClass("primary", "lg")}>
            {busy ? "Sending…" : picked.size > 1 ? `Verify ${picked.size} places` : "Verify this place"}
          </button>
        </>
      )}
    </section>
  );
}
