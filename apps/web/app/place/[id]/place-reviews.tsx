"use client";

import { useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Field, FieldLabel } from "@halalfood/ui/components/field";
import { Input } from "@halalfood/ui/components/input";
import { Textarea } from "@halalfood/ui/components/textarea";
import {
  EmptyState,
  EntryHead,
  FormCard,
  InlineCard,
  Loading,
} from "../../../src/components/blocks";
import { FormMessage, SectionIntro } from "../../../src/components/section";

const TITLE_MAX_LENGTH = 120;
const BODY_MAX_LENGTH = 5000;

type AuthState = "checking" | "signed-in" | "signed-out";
type BusyAction = "save" | "delete" | null;
type PlaceReview = {
  authorDisplayName: string;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  isOwn: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readReviewsPayload(value: unknown): PlaceReview[] | null {
  const reviews = record(value)?.reviews;
  if (!Array.isArray(reviews)) return null;
  return reviews.flatMap((value): PlaceReview[] => {
    const item = record(value);
    if (
      !item ||
      typeof item.authorDisplayName !== "string" ||
      typeof item.body !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string" ||
      typeof item.isOwn !== "boolean"
    )
      return [];
    return [
      {
        authorDisplayName: item.authorDisplayName,
        title: typeof item.title === "string" ? item.title : null,
        body: item.body,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        isOwn: item.isOwn,
      },
    ];
  });
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFrom(value: unknown, fallback: string): string {
  const body = record(value);
  return typeof body?.error === "string" && body.error.trim()
    ? body.error
    : fallback;
}

function loginUrl(placeId: string): string {
  return `/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function PlaceReviews({ placeId }: { placeId: string }) {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [reviews, setReviews] = useState<PlaceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [reviewsResponse, sessionResponse] = await Promise.all([
          fetch(`/api/places/${encodeURIComponent(placeId)}/reviews`, {
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json" },
          }),
          fetch("/api/auth/get-session", {
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json" },
          }),
        ]);
        const reviewsBody = await responseBody(reviewsResponse);
        const sessionBody = await responseBody(sessionResponse);
        const sessionUser = record(record(sessionBody)?.user);
        if (!mounted) return;
        setAuthState(
          typeof sessionUser?.id === "string" ? "signed-in" : "signed-out",
        );
        if (!reviewsResponse.ok) {
          setLoadError(errorFrom(reviewsBody, "Halal reviews could not be loaded."));
          return;
        }
        const next = readReviewsPayload(reviewsBody);
        if (!next) {
          setLoadError("Halal reviews could not be loaded. Please try again.");
          return;
        }
        setReviews(next);
      } catch {
        if (mounted) {
          setAuthState("signed-out");
          setLoadError("Halal reviews could not be loaded. Please try again.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [placeId, reloadToken]);

  const ownReview = reviews.find((review) => review.isOwn) ?? null;

  function startEditing() {
    if (!ownReview) return;
    setTitle(ownReview.title ?? "");
    setBody(ownReview.body);
    setEditing(true);
    setFormError("");
    setSuccess("");
  }

  function cancelEditing() {
    setEditing(false);
    setTitle("");
    setBody("");
    setFormError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authState === "signed-out") {
      window.location.assign(loginUrl(placeId));
      return;
    }
    if (busy) return;
    if (!body.trim()) {
      setFormError("Review body is required.");
      return;
    }
    const wasEditing = editing;
    setFormError("");
    setSuccess("");
    setBusy("save");
    try {
      const response = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/reviews`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title, body }),
        },
      );
      const responseValue = await responseBody(response);
      if (response.status === 401) {
        window.location.assign(loginUrl(placeId));
        return;
      }
      if (!response.ok) {
        setFormError(errorFrom(responseValue, "Could not save your halal review."));
        return;
      }
      setEditing(false);
      setTitle("");
      setBody("");
      setSuccess(wasEditing ? "Your halal review was updated." : "Your halal review was posted.");
      setReloadToken((value) => value + 1);
    } catch {
      setFormError("Could not save your halal review. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteReview() {
    if (!ownReview || busy) return;
    if (!window.confirm("Delete your halal review?")) return;
    setFormError("");
    setSuccess("");
    setBusy("delete");
    try {
      const response = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/reviews`,
        { method: "DELETE", credentials: "include", headers: { Accept: "application/json" } },
      );
      const responseValue = await responseBody(response);
      if (response.status === 401) {
        window.location.assign(loginUrl(placeId));
        return;
      }
      if (!response.ok) {
        setFormError(errorFrom(responseValue, "Could not delete your halal review."));
        return;
      }
      cancelEditing();
      setSuccess("Your halal review was deleted.");
      setReloadToken((value) => value + 1);
    } catch {
      setFormError("Could not delete your halal review. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="place-reviews-title">
      <h2 id="place-reviews-title" className="mb-1.5 text-[22px]">
        {reviews.length ? `${reviews.length} ${reviews.length === 1 ? "review" : "reviews"}` : "Reviews"}
      </h2>
      <SectionIntro>What people ordered, what they saw, and whether they’d go back.</SectionIntro>

      {loading && <Loading>Loading reviews…</Loading>}
      {loadError && <FormMessage tone="error">{loadError}</FormMessage>}

      {!loading && !loadError && !reviews.length && (
        <EmptyState>No reviews yet. Be the first to say how it was.</EmptyState>
      )}

      {!loading && !loadError && !!reviews.length && (
        <ul className="divide-y">
          {reviews.map((review, index) => (
            <li className="grid gap-2 py-5 first:pt-1" key={`${review.createdAt}-${index}`}>
              <EntryHead
                name={review.authorDisplayName}
                meta={
                  <>
                    <time dateTime={review.createdAt}>{formatTimestamp(review.createdAt)}</time>
                    {review.updatedAt !== review.createdAt && " · edited"}
                  </>
                }
              />
              {review.title && <p className="text-[13px] font-bold">{review.title}</p>}
              <p className="text-[15px] leading-normal">{review.body}</p>
              {review.isOwn && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={startEditing} disabled={busy !== null}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void deleteReview()}
                    disabled={busy !== null}
                  >
                    {busy === "delete" ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {authState === "signed-out" && !loadError && (
        <InlineCard
          className="mt-4"
          title="Eaten here?"
          description="Log in with a one-time email code to write a review."
          action={
            <Button asChild variant="outline">
              <a href={loginUrl(placeId)}>Log in to review</a>
            </Button>
          }
        />
      )}
      {authState === "signed-in" && !loadError && (!ownReview || editing) && (
        <FormCard
          className="mt-4"
          title={editing ? "Edit your review" : "Write a review"}
          description="Mention what you ordered and anything a halal diner should know. Please keep staff and other guests out of it."
          onSubmit={(event) => void submit(event)}
        >
          <Field>
            <FieldLabel htmlFor="review-title">Title (optional)</FieldLabel>
            <Input
              id="review-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={TITLE_MAX_LENGTH}
              placeholder="The lamb is worth the trip"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-body">Your review</FieldLabel>
            <Textarea
              id="review-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={BODY_MAX_LENGTH}
              required
              rows={5}
              placeholder="What did you order? What should the next person know?"
            />
          </Field>
          {formError && <FormMessage tone="error">{formError}</FormMessage>}
          <div className="flex flex-wrap gap-2.5">
            <Button type="submit" size="lg" disabled={busy !== null}>
              {busy === "save" ? "Saving…" : editing ? "Update review" : "Post review"}
            </Button>
            {editing && (
              <Button
                variant="outline"
                size="lg"
                onClick={cancelEditing}
                disabled={busy !== null}
              >
                Cancel
              </Button>
            )}
          </div>
        </FormCard>
      )}
      {success && (
        <FormMessage tone="success" className="mt-3">
          {success}
        </FormMessage>
      )}
    </section>
  );
}
