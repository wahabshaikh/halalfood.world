"use client";

import { useEffect, useRef, useState } from "react";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type AuthState = "checking" | "signed-in" | "signed-out";
type Photo = {
  id: string;
  url: string;
  contentType: string;
  byteSize: number;
  fileName: string;
  createdAt: string;
  isOwn: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPhotosPayload(value: unknown): Photo[] | null {
  const photos = record(value)?.photos;
  if (!Array.isArray(photos)) return null;
  return photos.flatMap((value): Photo[] => {
    const item = record(value);
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.url !== "string" ||
      typeof item.contentType !== "string" ||
      typeof item.byteSize !== "number" ||
      typeof item.fileName !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.isOwn !== "boolean"
    )
      return [];
    return [
      {
        id: item.id,
        url: item.url,
        contentType: item.contentType,
        byteSize: item.byteSize,
        fileName: item.fileName,
        createdAt: item.createdAt,
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
  return date.toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(value / 1024))} KiB`;
}

export default function PlacePhotos({ placeId }: { placeId: string }) {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [photosResponse, sessionResponse] = await Promise.all([
          fetch(`/api/places/${encodeURIComponent(placeId)}/photos`, {
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
        const photosBody = await responseBody(photosResponse);
        const sessionBody = await responseBody(sessionResponse);
        const sessionUser = record(record(sessionBody)?.user);
        if (!mounted) return;
        setAuthState(
          typeof sessionUser?.id === "string" ? "signed-in" : "signed-out",
        );
        if (!photosResponse.ok) {
          setLoadError(errorFrom(photosBody, "Halal place photos could not be loaded."));
          return;
        }
        const next = readPhotosPayload(photosBody);
        if (!next) {
          setLoadError("Halal place photos could not be loaded. Please try again.");
          return;
        }
        setPhotos(next);
      } catch {
        if (mounted) {
          setAuthState("signed-out");
          setLoadError("Halal place photos could not be loaded. Please try again.");
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authState === "signed-out") {
      window.location.assign(loginUrl(placeId));
      return;
    }
    if (busy) return;
    if (!file) {
      setFormError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (!PHOTO_TYPES.has(file.type)) {
      setFormError("Upload a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setFormError("Photos must be 8 MiB or smaller.");
      return;
    }
    setFormError("");
    setSuccess("");
    setBusy("upload");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/photos`,
        {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
          body: form,
        },
      );
      const value = await responseBody(response);
      if (response.status === 401) {
        window.location.assign(loginUrl(placeId));
        return;
      }
      if (!response.ok) {
        setFormError(errorFrom(value, "Could not add your halal place photo."));
        return;
      }
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setSuccess("Your halal place photo was added.");
      setReloadToken((value) => value + 1);
    } catch {
      setFormError("Could not add your halal place photo. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function deletePhoto(photo: Photo) {
    if (busy) return;
    if (!window.confirm("Delete your halal place photo?")) return;
    setFormError("");
    setSuccess("");
    setBusy(photo.id);
    try {
      const response = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/photos/${encodeURIComponent(photo.id)}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
      const value = await responseBody(response);
      if (response.status === 401) {
        window.location.assign(loginUrl(placeId));
        return;
      }
      if (!response.ok) {
        setFormError(errorFrom(value, "Could not delete your halal place photo."));
        return;
      }
      setSuccess("Your halal place photo was deleted.");
      setReloadToken((value) => value + 1);
    } catch {
      setFormError("Could not delete your halal place photo. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="place-photos-title">
      <h2 id="place-photos-title" style={{ fontSize: 22, marginBottom: 6 }}>
        {photos.length ? `Photos (${photos.length})` : "Photos"}
      </h2>
      <p className="section-intro">
        The food, the menu, the certificate on the wall. Each photo shows the date it was added.
      </p>

      {loading && <p className="form-help">Loading photos…</p>}
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}

      {!loading && !loadError && !photos.length && (
        <p className="empty-state">No photos yet. Be the first to add one.</p>
      )}

      {!loading && !loadError && !!photos.length && (
        <ul className="photo-strip">
          {photos.map((photo) => (
            <li key={photo.id}>
              <figure>
                <a href={photo.url} target="_blank" rel="noopener noreferrer">
                  <img src={photo.url} alt="Community photo of this place" loading="lazy" />
                </a>
                <figcaption>
                  <time dateTime={photo.createdAt}>{formatTimestamp(photo.createdAt)}</time> ·{" "}
                  {formatBytes(photo.byteSize)}
                </figcaption>
                {photo.isOwn && (
                  <button type="button" onClick={() => void deletePhoto(photo)} disabled={busy !== null}>
                    {busy === photo.id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </figure>
            </li>
          ))}
        </ul>
      )}

      {authState === "signed-out" && !loadError && (
        <div className="inline-card" style={{ marginTop: 16 }}>
          <strong>Got a photo from your visit?</strong>
          <p>Log in with a one-time email code to add it.</p>
          <a className="btn btn-outline btn-sm" href={loginUrl(placeId)}>
            Log in to add a photo
          </a>
        </div>
      )}
      {authState === "signed-in" && !loadError && (
        <form className="stack-form" style={{ marginTop: 16 }} onSubmit={(event) => void submit(event)}>
          <h3>Add a photo</h3>
          <label className="field">
            <span>Photo</span>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setFormError("");
              }}
            />
            <small className="field-note">JPEG, PNG or WebP, up to 8 MB. Please keep people’s faces out of it.</small>
          </label>
          {success && <p className="form-success" role="status">{success}</p>}
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button className="btn btn-dark" type="submit" disabled={busy !== null}>
            {busy === "upload" ? "Uploading…" : "Add photo"}
          </button>
        </form>
      )}
    </section>
  );
}
