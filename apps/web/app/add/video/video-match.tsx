"use client";

import { useState } from "react";
import { ArrowLeft01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { PlaceStatus } from "@halalfood/core/halal";
import { Icon, PageTitle, PlaceArt, StatusPill, buttonClass } from "../../../src/components/kit";
import { api, errorText, toast } from "../../../src/components/kit-client";

type Link = {
  platform: string;
  url: string;
  authorHandle: string | null;
  authorName: string | null;
  title: string | null;
  thumbnailUrl: string | null;
};
type Match = { id: string; name: string; address: string; status: PlaceStatus };
type Found = { link: Link; readable: boolean; matches: Match[] };

export function VideoMatch() {
  const [url, setUrl] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Match | null>(null);

  const find = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      setFound(await api<Found>("/api/media/match", { method: "POST", json: { url: url.trim() } }));
    } catch (caught) {
      toast(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = async (match: Match) => {
    if (!found || busy) return;
    setBusy(true);
    try {
      await api(`/api/places/${match.id}/saved`, { method: "POST" });
      await api(`/api/places/${match.id}/media`, { method: "POST", json: { url: found.link.url } }).catch(() => null);
      setSaved(match);
    } catch (caught) {
      toast(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3.5 px-6 pt-16 pb-10 text-center">
        <span className="flex size-[76px] items-center justify-center rounded-full bg-success text-success-foreground">
          <Icon icon={Tick02Icon} size={38} strokeWidth={2.8} />
        </span>
        <h1 className="text-[28px] leading-tight font-black tracking-tight">Saved {saved.name}</h1>
        <p className="text-[15px] font-semibold text-subtle-foreground">It’s in your Saved places, with the video linked.</p>
        <div className="mt-6 grid w-full gap-2.5">
          <a href={`/place/${saved.id}`} className={buttonClass("dark", "lg")}>
            See the place
          </a>
          <a href="/saved" className={buttonClass("outline", "lg")}>
            Open Saved
          </a>
        </div>
      </div>
    );
  }

  const top = found?.matches[0] ?? null;
  return (
    <div className="mx-auto grid max-w-xl gap-5 px-5 pt-4 pb-10">
      <a href="/add" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-extrabold text-foreground">
        <Icon icon={ArrowLeft01Icon} size={18} />
        Add a place
      </a>
      <PageTitle sub="Paste a TikTok, Instagram Reel or YouTube link.">Save from a video</PageTitle>
      <form onSubmit={find} className="flex gap-2">
        <label className="flex h-[50px] min-w-0 flex-1 items-center rounded-full bg-secondary px-[18px]">
          <span className="sr-only">Video link</span>
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-muted-foreground"
          />
        </label>
        <button type="submit" disabled={busy || !url.trim()} className={buttonClass("primary", "md", "h-[50px] px-5")}>
          {busy && !found ? "Finding…" : "Find"}
        </button>
      </form>

      {found && (
        <section className="flex items-center gap-3 rounded-2xl border border-border p-3">
          {found.link.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={found.link.thumbnailUrl} alt="" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-xl object-cover" />
          ) : (
            <span className="size-16 shrink-0 rounded-xl bg-foreground/85" />
          )}
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-[15px] font-extrabold">{found.link.authorHandle ? `@${found.link.authorHandle}` : (found.link.authorName ?? "Video")}</strong>
            {found.link.title && <span className="line-clamp-2 text-[13px] font-semibold text-muted-foreground">{found.link.title}</span>}
          </span>
        </section>
      )}

      {found && top && (
        <section className="grid gap-3">
          <h2 className="text-[17px] font-black">We think it’s…</h2>
          <div className="flex items-center gap-3">
            <PlaceArt name={top.name} seed={top.id} className="size-14" rounded="rounded-[14px]" />
            <span className="grid min-w-0 flex-1 gap-1">
              <strong className="truncate text-base font-extrabold">{top.name}</strong>
              {top.address && <span className="truncate text-[13px] font-semibold text-muted-foreground">{top.address}</span>}
              <StatusPill status={top.status} className="w-fit" />
            </span>
          </div>
          <button type="button" onClick={() => save(top)} disabled={busy} className={buttonClass("primary", "lg")}>
            Save this place
          </button>
          <a href={`/search?q=${encodeURIComponent(found.link.title ?? "")}`} className="text-center text-sm font-extrabold text-foreground underline-offset-4 hover:underline">
            Not this place? Search
          </a>
        </section>
      )}

      {found && !top && (
        <section className="grid gap-3 rounded-[20px] bg-muted p-[18px]">
          <h2 className="text-[17px] font-black">{found.readable ? "Couldn’t match this video" : "This link doesn’t say where it is"}</h2>
          <p className="text-sm font-semibold text-subtle-foreground">Search for the place, or add it from Google Maps.</p>
          <div className="grid grid-cols-2 gap-2">
            <a href="/search" className={buttonClass("dark", "md")}>
              <Icon icon={Search01Icon} size={18} />
              Search
            </a>
            <a href="/add" className={buttonClass("outline", "md")}>
              Add it
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
