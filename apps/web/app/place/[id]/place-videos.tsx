"use client";

import { useEffect, useState } from "react";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Input } from "@halalfood/ui/components/input";
import { EmptyState, Loading } from "../../../src/components/blocks";
import { FormMessage, Note, SectionIntro } from "../../../src/components/section";

import { HugeiconsIcon } from "@hugeicons/react";
import { LinkSquare02Icon, PlayIcon } from "@hugeicons/core-free-icons";

type Platform = "instagram" | "tiktok" | "youtube";
type Link = {
  id: string;
  platform: Platform;
  url: string;
  authorHandle: string | null;
  authorName: string | null;
  title: string | null;
  thumbnailUrl: string | null;
};

const LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readLinks(value: unknown): Link[] {
  const links = record(value)?.links;
  if (!Array.isArray(links)) return [];
  return links.flatMap((raw): Link[] => {
    const item = record(raw);
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.url !== "string" ||
      (item.platform !== "instagram" && item.platform !== "tiktok" && item.platform !== "youtube")
    )
      return [];
    const text = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : null);
    return [
      {
        id: item.id,
        platform: item.platform,
        url: item.url,
        authorHandle: text("authorHandle"),
        authorName: text("authorName"),
        title: text("title"),
        thumbnailUrl: text("thumbnailUrl"),
      },
    ];
  });
}

async function body(response: Response) {
  try {
    return record(await response.json());
  } catch {
    return null;
  }
}

export default function PlaceVideos({ placeId }: { placeId: string }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/places/${encodeURIComponent(placeId)}/media`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        if (!active) return;
        setLinks(response.ok ? readLinks(await response.json()) : []);
      })
      .catch(() => {
        if (active) setLinks([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [placeId, reload]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/places/${encodeURIComponent(placeId)}/media`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = await body(response);
      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`);
        return;
      }
      if (!response.ok) {
        setMessage({
          kind: "error",
          text: typeof payload?.error === "string" ? payload.error : "That link couldn’t be added.",
        });
        return;
      }
      const link = record(payload?.link);
      const who =
        typeof link?.authorHandle === "string"
          ? "@" + link.authorHandle
          : typeof link?.authorName === "string"
            ? link.authorName
            : "the creator";
      setMessage({
        kind: "success",
        text:
          payload?.created === false
            ? "That video is already here. Thanks all the same!"
            : `Thanks! We’ve credited ${who}.`,
      });
      setUrl("");
      setReload((value) => value + 1);
    } catch {
      setMessage({ kind: "error", text: "That link couldn’t be added. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="scroll-mt-24" id="videos" aria-labelledby="videos-title">
      <h2 id="videos-title" className="mb-1.5 text-[22px]">
        Seen on
      </h2>
      <SectionIntro>
        Videos from creators who ate here. Paste a link and we’ll credit the creator.
      </SectionIntro>
      {loading && <Loading>Loading videos…</Loading>}
      {!loading && !links.length && (
        <EmptyState>No videos yet. Seen this place on Instagram, TikTok or YouTube?</EmptyState>
      )}
      {!!links.length && <VideoTrack links={links} />}
      <form className="mt-4 flex gap-2" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="video-link">
          Video link
        </label>
        <Input
          id="video-link"
          type="url"
          inputMode="url"
          placeholder="Paste an Instagram, TikTok or YouTube link"
          value={url}
          maxLength={2048}
          onChange={(event) => setUrl(event.target.value)}
          className="h-12 min-w-0 flex-1"
        />
        <Button size="xl" type="submit" disabled={busy || !url.trim()}>
          {busy ? "Adding…" : "Add video"}
        </Button>
      </form>
      {message && (
        <FormMessage tone={message.kind === "error" ? "error" : "success"} className="mt-2.5">
          {message.text}
        </FormMessage>
      )}
      <Note className="mt-2 flex items-center gap-1">
        <HugeiconsIcon icon={LinkSquare02Icon} size={12} aria-hidden="true" /> Creator names and
        thumbnails come from the platform.
      </Note>
    </section>
  );
}

function VideoTrack({ links }: { links: Link[] }) {
  return (
    <ul className="mt-3.5 grid auto-cols-[160px] grid-flow-col gap-3 overflow-x-auto pb-1.5">
      {links.map((link) => {
        const creator = link.authorHandle ? "@" + link.authorHandle : link.authorName;
        return (
          <li key={link.id} className="grid content-start gap-2">
            <a
              className="relative flex aspect-[9/13] items-center justify-center overflow-hidden rounded-2xl bg-muted"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`Watch on ${LABELS[link.platform]}${creator ? " by " + creator : ""}`}
            >
              {link.thumbnailUrl ? (
                // Thumbnails come from the platform's oEmbed response.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={link.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              ) : (
                <HugeiconsIcon icon={PlayIcon} size={32} aria-hidden="true" />
              )}
              <Badge className="absolute top-2 left-2 bg-background/95 text-[11px] font-extrabold text-foreground">
                {LABELS[link.platform]}
              </Badge>
            </a>
            {link.authorHandle ? (
              <a
                href={`/creator/${link.platform}/${encodeURIComponent(link.authorHandle)}`}
                className="text-[13px] font-extrabold hover:underline"
              >
                {creator}
              </a>
            ) : (
              <strong className="text-[13px] font-extrabold">
                {creator || LABELS[link.platform] + " post"}
              </strong>
            )}
            {link.title && <span className="text-xs text-muted-foreground">{link.title}</span>}
          </li>
        );
      })}
    </ul>
  );
}
