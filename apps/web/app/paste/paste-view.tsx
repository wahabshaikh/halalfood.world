"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Input } from "@halalfood/ui/components/input";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@halalfood/ui/components/item";
import { FormCard } from "../../src/components/blocks";
import { FormMessage, Note } from "../../src/components/section";
import { cityName } from "../../src/lib/seo";

type Link = {
  platform: "instagram" | "tiktok" | "youtube";
  url: string;
  authorHandle: string | null;
  authorName: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  creatorPath: string | null;
};

type Candidate = {
  id: string;
  name: string;
  citySlug: string;
  address: string;
  confidence?: "high" | "medium";
  statusLabel?: string;
};

type Step =
  | { name: "paste" }
  | { name: "confirm"; link: Link; matches: Candidate[]; readable: boolean }
  | { name: "saved"; link: Link; place: Candidate; linked: boolean };

async function post<T>(url: string, body?: unknown): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => ({}))) as T & { error?: string; loginUrl?: string };
    if (response.status === 401 && typeof parsed.loginUrl === "string") {
      window.location.assign(parsed.loginUrl);
      return { ok: false, error: "Sign in to continue." };
    }
    if (!response.ok) return { ok: false, error: parsed.error ?? "Something went wrong. Please try again." };
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

const PLATFORM = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const;

/**
 * Paste, match, confirm, save. The match is a suggestion from the caption; the
 * diner picks the place, and saving never touches its halal status.
 */
export default function PasteView() {
  const [step, setStep] = useState<Step>({ name: "paste" });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Candidate[] | null>(null);

  async function match() {
    setBusy(true);
    setError("");
    const result = await post<{ link: Link; matches: Candidate[]; readable: boolean }>(
      "/api/media/match",
      { url },
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setFound(null);
    setQuery("");
    setStep({ name: "confirm", link: result.body.link, matches: result.body.matches, readable: result.body.readable });
  }

  async function search() {
    if (query.trim().length < 2) return;
    setError("");
    try {
      const response = await fetch(`/api/places/search?q=${encodeURIComponent(query.trim())}&limit=6`);
      if (!response.ok) throw new Error();
      const body = (await response.json()) as {
        places?: Array<{ id: string; name: string; city_slug: string; street_address: string }>;
      };
      setFound(
        (body.places ?? []).map((place) => ({
          id: place.id,
          name: place.name,
          citySlug: place.city_slug,
          address: place.street_address,
        })),
      );
    } catch {
      setError("Search is taking a moment. Please try again.");
    }
  }

  async function save(link: Link, place: Candidate) {
    setBusy(true);
    setError("");
    // Link the video first: it is public context on the place page and credits
    // the creator. Then keep the place on the diner's want-to-try list.
    const linked = await post<{ created: boolean }>(`/api/places/${place.id}/media`, { url: link.url });
    if (!linked.ok) {
      setBusy(false);
      return setError(linked.error);
    }
    const saved = await post(`/api/places/${place.id}/saved`);
    setBusy(false);
    if (!saved.ok) return setError(saved.error);
    setStep({ name: "saved", link, place, linked: linked.body.created });
  }

  if (step.name === "saved")
    return (
      <div className="grid gap-4 rounded-xl border p-5" role="status">
        <p className="flex items-center gap-2 text-lg font-extrabold">
          <HugeiconsIcon icon={Tick02Icon} size={20} aria-hidden="true" />
          Saved to want-to-try
        </p>
        <p>
          <a className="font-bold underline" href={`/place/${step.place.id}`}>
            {step.place.name}
          </a>{" "}
          is on your list.
          {step.linked ? " The video is linked on its page" : " The video was already linked on its page"}
          {step.link.authorHandle && (
            <>
              , credited to{" "}
              {step.link.creatorPath ? (
                <a className="font-bold underline" href={step.link.creatorPath}>
                  @{step.link.authorHandle}
                </a>
              ) : (
                <>@{step.link.authorHandle}</>
              )}
            </>
          )}
          .
        </p>
        <div className="flex flex-wrap gap-2.5">
          <Button size="lg" onClick={() => { setStep({ name: "paste" }); setUrl(""); }}>
            Paste another
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="/saved">See saved places</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={`/map?place=${step.place.id}`}>Show on the map</a>
          </Button>
        </div>
      </div>
    );

  if (step.name === "confirm") {
    const { link, matches, readable } = step;
    return (
      <div className="grid gap-5">
        <div className="rounded-xl border p-4">
          <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {PLATFORM[link.platform]}
            {link.authorHandle && <> · @{link.authorHandle}</>}
          </p>
          {link.title ? (
            <p className="mt-1 text-sm">“{link.title}”</p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {link.platform === "instagram"
                ? "Instagram doesn’t share captions, so we can’t read this one."
                : "We couldn’t read a caption for this link."}
            </p>
          )}
        </div>

        {matches.length > 0 ? (
          <div className="grid gap-2">
            <h2 className="text-lg font-extrabold">We think it’s</h2>
            {matches.map((place) => (
              <Item key={place.id} variant="outline" className="rounded-xl">
                <ItemContent>
                  <ItemTitle className="font-bold">{place.name}</ItemTitle>
                  <ItemDescription className="text-xs">
                    {place.address} · {cityName(place.citySlug)}
                  </ItemDescription>
                  {place.statusLabel && (
                    <Badge variant="muted" className="mt-1 w-fit">
                      {place.statusLabel}
                    </Badge>
                  )}
                </ItemContent>
                <Button disabled={busy} onClick={() => void save(link, place)}>
                  Save to want-to-try
                </Button>
              </Item>
            ))}
          </div>
        ) : (
          readable && (
            <p className="text-sm text-muted-foreground">
              No listed place matched that caption. Search for it below.
            </p>
          )
        )}

        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <h2 className="text-base font-extrabold">
            {matches.length ? "Not this place? Search instead" : "Find the place"}
          </h2>
          <div className="flex gap-2">
            <Input
              aria-label="Search for the place"
              value={query}
              maxLength={120}
              placeholder="Name of the restaurant"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={query.trim().length < 2}>
              <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
              Search
            </Button>
          </div>
          {found && found.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Not listed yet.{" "}
              <a className="font-bold underline" href={`/add?q=${encodeURIComponent(query)}`}>
                Add it from Google Maps
              </a>
              .
            </p>
          )}
          {found?.map((place) => (
            <Item key={place.id} variant="outline" className="rounded-xl px-3 py-2.5">
              <ItemContent>
                <ItemTitle>{place.name}</ItemTitle>
                <ItemDescription className="text-xs">{place.address}</ItemDescription>
              </ItemContent>
              <Button type="button" size="sm" disabled={busy} onClick={() => void save(link, place)}>
                Save to want-to-try
              </Button>
            </Item>
          ))}
        </form>

        {error && <FormMessage tone="error">{error}</FormMessage>}
        <div>
          <Button variant="ghost" onClick={() => setStep({ name: "paste" })}>
            Use a different link
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FormCard
      title="Paste a link"
      onSubmit={(event) => {
        event.preventDefault();
        if (url.trim()) void match();
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="Link to an Instagram, TikTok or YouTube video"
          type="url"
          value={url}
          maxLength={2048}
          placeholder="https://www.tiktok.com/@creator/video/…"
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          Find the place
        </Button>
      </div>
      <Note>
        A saved video is linked on the place page and credits the creator. It is context, not
        evidence: it never changes a place’s halal status.
      </Note>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </FormCard>
  );
}
