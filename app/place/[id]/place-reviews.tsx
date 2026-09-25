"use client";

import { useEffect, useState } from "react";

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
      <h2 id="place-reviews-title" style={{ fontSize: 22, marginBottom: 6 }}>
        {reviews.length ? `${reviews.length} ${reviews.length === 1 ? "review" : "reviews"}` : "Reviews"}
      </h2>
      <p className="section-intro">
        What people ordered, what they saw, and whether they’d go back.
      </p>

      {loading && <p className="form-help">Loading reviews…</p>}
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}

      {!loading && !loadError && !reviews.length && (
        <p className="empty-state">No reviews yet. Be the first to say how it was.</p>
      )}

      {!loading && !loadError && !!reviews.length && (
        <ul className="entry-list">
          {reviews.map((review, index) => (
            <li className="entry" key={`${review.createdAt}-${index}`}>
              <div className="entry-head">
                <span className="avatar" aria-hidden="true">
                  {review.authorDisplayName.trim().slice(0, 1).toUpperCase() || "H"}
                </span>
                <div>
                  <strong>{review.authorDisplayName}</strong>
                  <span>
                    <time dateTime={review.createdAt}>{formatTimestamp(review.createdAt)}</time>
                    {review.updatedAt !== review.createdAt && " · edited"}
                  </span>
                </div>
              </div>
              {review.title && <p className="entry-meta">{review.title}</p>}
              <p className="entry-body">{review.body}</p>
              {review.isOwn && (
                <div className="button-row">
                  <button
                    type="button"
                    className="btn btn-line btn-sm"
                    onClick={startEditing}
                    disabled={busy !== null}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-line btn-sm"
                    onClick={() => void deleteReview()}
                    disabled={busy !== null}
                  >
                    {busy === "delete" ? "Deleting…" : "Delete"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {authState === "signed-out" && !loadError && (
        <div className="inline-card" style={{ marginTop: 16 }}>
          <strong>Eaten here?</strong>
          <p>Log in with a one-time email code to write a review.</p>
          <a className="btn btn-outline btn-sm" href={loginUrl(placeId)}>
            Log in to review
          </a>
        </div>
      )}
      {authState === "signed-in" && !loadError && (!ownReview || editing) && (
        <form className="stack-form" style={{ marginTop: 16 }} onSubmit={(event) => void submit(event)}>
          <h3>{editing ? "Edit your review" : "Write a review"}</h3>
          <p className="field-note">
            Mention what you ordered and anything a halal diner should know. Please keep
            staff and other guests out of it.
          </p>
          <label className="field">
            <span>Title (optional)</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={TITLE_MAX_LENGTH}
              placeholder="The lamb is worth the trip"
            />
          </label>
          <label className="field">
            <span>Your review</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={BODY_MAX_LENGTH}
              required
              rows={5}
              placeholder="What did you order? What should the next person know?"
            />
          </label>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <div className="button-row">
            <button type="submit" className="btn btn-dark" disabled={busy !== null}>
              {busy === "save" ? "Saving…" : editing ? "Update review" : "Post review"}
            </button>
            {editing && (
              <button type="button" className="btn btn-line" onClick={cancelEditing} disabled={busy !== null}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {success && <p className="form-success" style={{ marginTop: 12 }}>{success}</p>}
    </section>
  );
}
