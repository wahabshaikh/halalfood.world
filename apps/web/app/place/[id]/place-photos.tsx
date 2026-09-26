"use client";

import { Button } from "@halalfood/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@halalfood/ui/components/field";
import { Input } from "@halalfood/ui/components/input";
import { EmptyState, FormCard, InlineCard, Loading } from "../../../src/components/blocks";
import { FormMessage, SectionIntro } from "../../../src/components/section";

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
      <h2 id="place-photos-title" className="mb-1.5 text-[22px]">
        {photos.length ? `Photos (${photos.length})` : "Photos"}
      </h2>
      <SectionIntro>
        The food, the menu, the certificate on the wall. Each photo shows the date it was added.
      </SectionIntro>

      {loading && <Loading>Loading photos…</Loading>}
      {loadError && <FormMessage tone="error">{loadError}</FormMessage>}

      {!loading && !loadError && !photos.length && (
        <EmptyState>No photos yet. Be the first to add one.</EmptyState>
      )}

      {!loading && !loadError && !!photos.length && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          {photos.map((photo) => (
            <li key={photo.id}>
              <figure className="grid gap-1.5">
                <a href={photo.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={photo.url}
                    alt="Community photo of this place"
                    loading="lazy"
                    className="aspect-square w-full rounded-xl bg-secondary object-cover"
                  />
                </a>
                <figcaption className="text-xs text-muted-foreground">
                  <time dateTime={photo.createdAt}>{formatTimestamp(photo.createdAt)}</time> ·{" "}
                  {formatBytes(photo.byteSize)}
                </figcaption>
                {photo.isOwn && (
                  <Button
                    variant="link"
                    size="xs"
                    className="justify-self-start px-0 font-extrabold text-foreground underline"
                    onClick={() => void deletePhoto(photo)}
                    disabled={busy !== null}
                  >
                    {busy === photo.id ? "Deleting…" : "Delete"}
                  </Button>
                )}
              </figure>
            </li>
          ))}
        </ul>
      )}

      {authState === "signed-out" && !loadError && (
        <InlineCard
          className="mt-4"
          title="Got a photo from your visit?"
          description="Log in with a one-time email code to add it."
          action={
            <Button asChild variant="outline">
              <a href={loginUrl(placeId)}>Log in to add a photo</a>
            </Button>
          }
        />
      )}
      {authState === "signed-in" && !loadError && (
        <FormCard className="mt-4" title="Add a photo" onSubmit={(event) => void submit(event)}>
          <Field>
            <FieldLabel htmlFor="place-photo-file">Photo</FieldLabel>
            <Input
              id="place-photo-file"
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setFormError("");
              }}
            />
            <FieldDescription>
              JPEG, PNG or WebP, up to 8 MB. Please keep people’s faces out of it.
            </FieldDescription>
          </Field>
          {success && <FormMessage tone="success">{success}</FormMessage>}
          {formError && <FormMessage tone="error">{formError}</FormMessage>}
          <Button size="lg" className="justify-self-start" type="submit" disabled={busy !== null}>
            {busy === "upload" ? "Uploading…" : "Add photo"}
          </Button>
        </FormCard>
      )}
    </section>
  );
}
