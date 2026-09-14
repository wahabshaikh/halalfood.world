"use client";

import { useEffect, useRef, useState } from "react";

type AuthState = "checking" | "signed-in" | "signed-out";
type Evidence =
  | { kind: "link"; url: string }
  | { kind: "upload"; url: string; contentType: string; fileName: string };
type UploadedEvidence = {
  kind: "upload";
  key: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
};
type Verification = {
  id: string;
  status: "pending" | "approved";
  note: string | null;
  createdAt: string;
  evidence: Evidence[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function responseBody(response: Response) {
  try {
    return record(await response.json());
  } catch {
    return null;
  }
}

function errorFrom(body: Record<string, unknown> | null, fallback: string) {
  return typeof body?.error === "string" && body.error.trim()
    ? body.error
    : fallback;
}

function sourceLabel(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "zabihah.com") return "Zabihah source";
    if (host === "instagram.com" || host === "m.instagram.com") return "Instagram source";
    if (host.endsWith("tiktok.com")) return "TikTok source";
    return "YouTube source";
  } catch {
    return "Community source";
  }
}

function readVerifications(body: Record<string, unknown> | null): Verification[] {
  if (!Array.isArray(body?.verifications)) return [];
  return body.verifications.flatMap((value): Verification[] => {
    const item = record(value);
    const evidence = Array.isArray(item?.evidence)
      ? item.evidence.flatMap((raw): Evidence[] => {
          const entry = record(raw);
          if (entry?.kind === "link" && typeof entry.url === "string")
            return [{ kind: "link", url: entry.url }];
          if (
            entry?.kind === "upload" &&
            typeof entry.url === "string" &&
            typeof entry.contentType === "string" &&
            typeof entry.fileName === "string"
          )
            return [
              {
                kind: "upload",
                url: entry.url,
                contentType: entry.contentType,
                fileName: entry.fileName,
              },
            ];
          return [];
        })
      : [];
    return item &&
      typeof item.id === "string" &&
      (item.status === "approved" || item.status === "pending") &&
      (item.note === null || typeof item.note === "string") &&
      typeof item.createdAt === "string"
      ? [
          {
            id: item.id,
            status: item.status,
            note: item.note,
            createdAt: item.createdAt,
            evidence,
          },
        ]
      : [];
  });
}

export default function PlaceHalalVerification({ placeId }: { placeId: string }) {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [links, setLinks] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoadError("");
    try {
      const [verificationResponse, sessionResponse] = await Promise.all([
        fetch(`/api/places/${encodeURIComponent(placeId)}/verifications`, {
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
      const verificationBody = await responseBody(verificationResponse);
      const sessionBody = await responseBody(sessionResponse);
      const sessionUser = record(sessionBody?.user);
      setAuthState(typeof sessionUser?.id === "string" ? "signed-in" : "signed-out");
      if (!verificationResponse.ok) {
        setLoadError(errorFrom(verificationBody, "Verifications could not be loaded."));
        return;
      }
      setVerifications(readVerifications(verificationBody));
    } catch {
      setLoadError("Verifications could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // The place id is the only input for this page section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setSuccess(false);
    const linkValues = links
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!linkValues.length && !files.length) {
      setFormError("Add at least one evidence link or upload.");
      return;
    }
    if (linkValues.length + files.length > 8) {
      setFormError("Add no more than 8 evidence items.");
      return;
    }

    setBusy(true);
    try {
      const uploads: UploadedEvidence[] = [];
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        const uploadResponse = await fetch(
          `/api/uploads/r2?returnTo=${encodeURIComponent(`/place/${placeId}`)}`,
          { method: "POST", credentials: "include", body: form },
        );
        const uploadBody = await responseBody(uploadResponse);
        if (uploadResponse.status === 401) {
          setAuthState("signed-out");
          setFormError(errorFrom(uploadBody, "Sign in to upload evidence."));
          return;
        }
        if (!uploadResponse.ok) {
          setFormError(errorFrom(uploadBody, "This file could not be uploaded."));
          return;
        }
        if (
          typeof uploadBody?.key !== "string" ||
          typeof uploadBody.contentType !== "string" ||
          typeof uploadBody.sizeBytes !== "number" ||
          typeof uploadBody.fileName !== "string"
        ) {
          setFormError("The upload response was incomplete. Please try again.");
          return;
        }
        uploads.push({
          kind: "upload",
          key: uploadBody.key,
          contentType: uploadBody.contentType,
          sizeBytes: uploadBody.sizeBytes,
          fileName: uploadBody.fileName,
        });
      }

      const evidence = [
        ...linkValues.map((url) => ({ kind: "link" as const, url })),
        ...uploads.map((upload) => {
          return {
            kind: "upload" as const,
            key: upload.key,
            contentType: upload.contentType,
            sizeBytes: upload.sizeBytes,
            fileName: upload.fileName,
          };
        }),
      ];
      const verificationResponse = await fetch(
        `/api/places/${encodeURIComponent(placeId)}/verifications`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ note, evidence }),
        },
      );
      const verificationBody = await responseBody(verificationResponse);
      if (verificationResponse.status === 401) {
        setAuthState("signed-out");
        setFormError(errorFrom(verificationBody, "Sign in to submit evidence."));
        return;
      }
      if (!verificationResponse.ok) {
        setFormError(errorFrom(verificationBody, "We could not submit this verification."));
        return;
      }
      setLinks("");
      setNote("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      setSuccess(true);
      await load();
    } catch {
      setFormError("We could not submit this verification. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="community-verification" aria-labelledby="community-verification-title">
      <div className="community-verification-heading">
        <div>
          <p className="eyebrow">COMMUNITY EVIDENCE</p>
          <h2 id="community-verification-title">Halal verification</h2>
        </div>
        <span className="verification-count">
          {verifications.length} {verifications.length === 1 ? "submission" : "submissions"}
        </span>
      </div>
      <p className="verification-intro">
        See evidence shared by the community. Approved submissions are shown publicly;
        new submissions go to review.
      </p>

      {loading && <p className="form-help">Loading community evidence…</p>}
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}
      {!loading && !loadError && !verifications.length && (
        <p className="empty-state verification-empty">
          No community verification has been submitted yet. You can help by sharing a
          reliable source or document.
        </p>
      )}
      {!!verifications.length && (
        <ul className="verification-list">
          {verifications.map((verification) => (
            <li className="verification-card" key={verification.id}>
              <div className="verification-card-topline">
                <span className={`verification-status ${verification.status}`}>
                  {verification.status === "approved" ? "Approved" : "Pending review"}
                </span>
                <time dateTime={verification.createdAt}>
                  {new Date(verification.createdAt).toLocaleDateString()}
                </time>
              </div>
              {verification.note && <p className="verification-note">{verification.note}</p>}
              <ul className="verification-evidence-list">
                {verification.evidence.map((evidence, index) => (
                  <li key={`${verification.id}-${index}`}>
                    <a
                      href={evidence.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {evidence.kind === "link" ? sourceLabel(evidence.url) : `Uploaded ${evidence.fileName}`}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {authState === "checking" && !loading && (
        <p className="form-help">Checking sign-in…</p>
      )}
      {authState === "signed-out" && (
        <div className="verification-auth-card">
          <strong>Have halal evidence to share?</strong>
          <p>Sign in with a one-time email code to submit it for review.</p>
          <a
            className="action primary"
            href={`/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`}
          >
            Sign in to submit
          </a>
        </div>
      )}
      {authState === "signed-in" && (
        <form className="verification-form" onSubmit={submit}>
          <h3>Share halal evidence</h3>
          <p className="field-note">
            Add one link per line from Zabihah, Instagram, TikTok, or YouTube, and/or
            upload a certificate, supplier document, or menu.
          </p>
          <label className="field">
            <span>Evidence links</span>
            <textarea
              value={links}
              onChange={(event) => setLinks(event.target.value)}
              maxLength={8192}
              rows={3}
              placeholder="https://www.zabihah.com/..."
            />
          </label>
          <label className="field">
            <span>Documents or menus</span>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files || []))}
            />
            <small className="field-note">JPEG, PNG, WebP, or PDF · 8 MiB maximum per file</small>
          </label>
          <label className="field">
            <span>Optional note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Share helpful context for the review team"
            />
          </label>
          {success && <p className="form-success" role="status">Submitted for halal review. Thank you for helping the community.</p>}
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button className="action primary verification-submit" type="submit" disabled={busy}>
            {busy ? "Uploading and submitting…" : "Submit for review"}
          </button>
        </form>
      )}
    </section>
  );
}
