"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Play } from "lucide-react";

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
    <section className="place-section" id="videos" aria-labelledby="videos-title">
      <h2 id="videos-title">Seen on</h2>
      <p className="section-intro">
        Videos from creators who ate here. Paste a link and we’ll credit the creator.
      </p>
      {loading && <p className="form-help">Loading videos…</p>}
      {!loading && !links.length && (
        <p className="empty-state">No videos yet. Seen this place on Instagram, TikTok or YouTube?</p>
      )}
      {!!links.length && (
        <ul className="video-track">
          {links.map((link) => {
            const creator = link.authorHandle ? "@" + link.authorHandle : link.authorName;
            return (
              <li key={link.id} className="video-card">
                <a
                  className="video-card-media"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={`Watch on ${LABELS[link.platform]}${creator ? " by " + creator : ""}`}
                >
                  {link.thumbnailUrl ? (
                    // Thumbnails come from the platform's oEmbed response.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={link.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <Play size={32} aria-hidden="true" />
                  )}
                  <span className="video-card-platform">{LABELS[link.platform]}</span>
                </a>
                {link.authorHandle ? (
                  <a href={`/creator/${link.platform}/${encodeURIComponent(link.authorHandle)}`}>
                    <strong>{creator}</strong>
                  </a>
                ) : (
                  <strong>{creator || LABELS[link.platform] + " post"}</strong>
                )}
                {link.title && <span>{link.title}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <form className="link-form" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="video-link">
          Video link
        </label>
        <input
          id="video-link"
          type="url"
          inputMode="url"
          placeholder="Paste an Instagram, TikTok or YouTube link"
          value={url}
          maxLength={2048}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button className="btn btn-dark" type="submit" disabled={busy || !url.trim()}>
          {busy ? "Adding…" : "Add video"}
        </button>
      </form>
      {message && (
        <p className={message.kind === "error" ? "form-error" : "form-success"} role="status" style={{ marginTop: 10 }}>
          {message.text}
        </p>
      )}
      <p className="field-note" style={{ marginTop: 8 }}>
        <ExternalLink size={12} aria-hidden="true" /> Creator names and thumbnails come from the platform.
      </p>
    </section>
  );
}
