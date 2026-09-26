"use client";

import { useEffect, useState } from "react";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { FieldError } from "@halalfood/ui/components/field";
import { Spinner } from "@halalfood/ui/components/spinner";
import { cn } from "@halalfood/ui/lib/utils";
import { TextLink } from "../../../src/components/blocks";
import { Note, SectionHeading, SectionIntro } from "../../../src/components/section";
import { getClientSession } from "../../../src/lib/client-session";

const RATING_VALUES = [
  "mashallah",
  "alhamdulillah",
  "astaghfirullah",
] as const;

type PlaceRating = (typeof RATING_VALUES)[number];
type AuthState = "checking" | "signed-in" | "signed-out";
type RatingPayload = {
  rating: PlaceRating | null;
  counts: Record<PlaceRating, number> & { total: number };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPlaceRating(value: unknown): value is PlaceRating {
  return (
    typeof value === "string" &&
    (RATING_VALUES as readonly string[]).includes(value)
  );
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function readRatingPayload(value: unknown): RatingPayload | null {
  const body = record(value);
  const counts = record(body?.counts);
  if (!counts) return null;
  return {
    rating:
      body?.rating === null || isPlaceRating(body?.rating)
        ? body?.rating
        : null,
    counts: {
      mashallah: count(counts.mashallah),
      alhamdulillah: count(counts.alhamdulillah),
      astaghfirullah: count(counts.astaghfirullah),
      total: count(counts.total),
    },
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFrom(value: unknown, fallback: string) {
  const body = record(value);
  return typeof body?.error === "string" && body.error.trim()
    ? body.error
    : fallback;
}

function loginUrl(placeId: string) {
  return `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`;
}

const RATING_LABELS: Record<PlaceRating, string> = {
  mashallah: "MashaAllah",
  alhamdulillah: "Alhamdulillah",
  astaghfirullah: "Astaghfirullah",
};

const RATING_DESCRIPTIONS: Record<PlaceRating, string> = {
  mashallah: "A place you would happily return to",
  alhamdulillah: "A useful halal option for this visit",
  astaghfirullah: "A caution for the next visitor",
};

function label(rating: PlaceRating) {
  return RATING_LABELS[rating];
}

function description(rating: PlaceRating) {
  return RATING_DESCRIPTIONS[rating];
}

export default function PlaceRating({ placeId }: { placeId: string }) {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [payload, setPayload] = useState<RatingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<PlaceRating | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      setError("");
      try {
        const [ratingResponse, sessionUser] = await Promise.all([
          fetch(`/api/places/${encodeURIComponent(placeId)}/rating`, {
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json" },
          }),
          getClientSession(),
        ]);
        const ratingBody = await responseBody(ratingResponse);
        if (!mounted) return;
        setAuthState(
          sessionUser ? "signed-in" : "signed-out",
        );
        if (!ratingResponse.ok) {
          setError(errorFrom(ratingBody, "Halal reactions could not be loaded."));
          return;
        }
        const next = readRatingPayload(ratingBody);
        if (!next) {
          setError("Halal reactions could not be loaded. Please try again.");
          return;
        }
        setPayload(next);
      } catch {
        if (mounted) {
          setAuthState("signed-out");
          setError("Halal reactions could not be loaded. Please try again.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [placeId]);

  async function choose(rating: PlaceRating) {
    if (authState === "signed-out") {
      window.location.assign(loginUrl(placeId));
      return;
    }
    setError("");
    setBusy(rating);
    try {
      const response = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/rating`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ rating }),
        },
      );
      const body = await responseBody(response);
      if (response.status === 401) {
        window.location.assign(loginUrl(placeId));
        return;
      }
      if (!response.ok) {
        setError(errorFrom(body, "Could not save your halal reaction."));
        return;
      }
      const next = readRatingPayload(body);
      if (!next) {
        setError("Could not read the updated halal reactions. Please try again.");
        return;
      }
      setPayload(next);
      setAuthState("signed-in");
    } catch {
      setError("Could not save your halal reaction. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="place-rating-title">
      <SectionHeading
        id="place-rating-title"
        title="How was it?"
        action={
          payload && (
            <Badge variant="secondary">
              {payload.counts.total} {payload.counts.total === 1 ? "signal" : "signals"}
            </Badge>
          )
        }
      />
      <SectionIntro>
        A quick signal from your visit. It’s your impression, not a halal certificate.
      </SectionIntro>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </p>
      )}
      {!loading && error && <FieldError>{error}</FieldError>}
      {!loading && !error && payload && (
        <>
          <div
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
            role="group"
            aria-label="Choose a visit signal"
          >
            {RATING_VALUES.map((rating) => {
              const selected = payload.rating === rating;
              return (
                <Button
                  variant="outline"
                  className={cn(
                    "h-auto flex-col items-start gap-0.5 rounded-xl p-4 text-left whitespace-normal hover:border-foreground",
                    selected && "border-2 border-foreground bg-secondary",
                  )}
                  key={rating}
                  aria-pressed={selected}
                  aria-busy={busy === rating}
                  disabled={busy !== null || authState === "checking"}
                  onClick={() => void choose(rating)}
                >
                  <small className="text-xs font-bold text-muted-foreground">
                    {payload.counts[rating]}
                  </small>
                  <strong className="text-base">{busy === rating ? "Saving…" : label(rating)}</strong>
                  <span className="text-[13px] font-normal text-muted-foreground">
                    {selected ? "Your signal" : description(rating)}
                  </span>
                </Button>
              );
            })}
          </div>
          {authState === "signed-out" && (
            <Note className="mt-2.5">
              <TextLink href={loginUrl(placeId)}>Log in</TextLink> to add yours. You can change
              it any time.
            </Note>
          )}
        </>
      )}
    </section>
  );
}
