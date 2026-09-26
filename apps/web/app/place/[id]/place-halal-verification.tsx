"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, Link01Icon, TaskDone01Icon } from "@hugeicons/core-free-icons";
import {
  formatHalalStatus,
  parseHalalStatus,
  type HalalStatus,
} from "@halalfood/core/halal-status-view";
import { answerLabel, type GlanceQuestion } from "@halalfood/core/halal-glance-view";

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
type Answers = Record<GlanceQuestion, string | null>;
type Verification = {
  id: string;
  status: "pending" | "approved";
  note: string | null;
  createdAt: string;
  evidence: Evidence[];
  answers: Answers | null;
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
    if (host === "youtube.com" || host === "m.youtube.com") return "YouTube source";
    return "External source";
  } catch {
    return "Community source";
  }
}

function readAnswers(value: unknown): Answers | null {
  const item = record(value);
  if (!item) return null;
  const pick = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : null);
  return { certificate: pick("certificate"), alcohol: pick("alcohol"), meat: pick("meat") };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
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
            answers: readAnswers(item.answers),
          },
        ]
      : [];
  });
}

export default function PlaceHalalVerification({ placeId }: { placeId: string }) {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [statusSummary, setStatusSummary] = useState<HalalStatus | null>(null);
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
        setStatusSummary({ status: "unavailable" });
        setLoadError(errorFrom(verificationBody, "Verifications could not be loaded."));
        return;
      }
      setStatusSummary(parseHalalStatus(verificationBody?.summary));
      setVerifications(readVerifications(verificationBody));
    } catch {
      setStatusSummary({ status: "unavailable" });
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

  const statusView = statusSummary ? formatHalalStatus(statusSummary) : null;

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

  const checkHref = `/place/${encodeURIComponent(placeId)}/check`;

  return (
    <section aria-labelledby="community-verification-title">
      <h2 id="community-verification-title" style={{ fontSize: 22, marginBottom: 6 }}>
        How we know it’s halal
      </h2>
      <p className="section-intro">
        Every check has a date. New checks show as “Awaiting review” until a moderator
        approves them.
      </p>

      {statusView && (
        <div
          className={`status-banner is-${statusView.status}`}
          aria-label={`Halal evidence status: ${statusView.label}`}
          role="status"
        >
          <HugeiconsIcon icon={TaskDone01Icon} size={26} aria-hidden="true" />
          <div>
            <strong>{statusView.label}</strong>
            <p>{statusView.detail}</p>
            <p>{statusView.explanation}</p>
          </div>
        </div>
      )}

      {loading && <p className="form-help">Loading checks…</p>}
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}
      {!loading && !loadError && !verifications.length && (
        <p className="empty-state">
          Nobody has shared a check yet. Been here? It takes about a minute.
        </p>
      )}
      {!!verifications.length && (
        <ul className="entry-list">
          {verifications.map((verification) => {
            const answers = verification.answers
              ? (Object.keys(verification.answers) as GlanceQuestion[])
                  .map((question) => answerLabel(question, verification.answers?.[question] ?? null))
                  .filter((label): label is string => Boolean(label))
              : [];
            return (
              <li className="entry" key={verification.id}>
                <div className="entry-head">
                  <span className="avatar" aria-hidden="true">
                    <HugeiconsIcon icon={TaskDone01Icon} size={20} />
                  </span>
                  <div>
                    <strong>{answers.length ? "In-person check" : "Shared a source"}</strong>
                    <span>
                      <time dateTime={verification.createdAt}>{formatDate(verification.createdAt)}</time>
                    </span>
                  </div>
                  <span
                    className={`tag ${verification.status === "approved" ? "is-approved" : "is-pending"}`}
                    style={{ marginLeft: "auto" }}
                  >
                    {verification.status === "approved" ? "Approved" : "Awaiting review"}
                  </span>
                </div>
                {!!answers.length && (
                  <div className="answer-chips">
                    {answers.map((label) => (
                      <span className="answer-chip" key={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                {verification.note && <p className="entry-body">{verification.note}</p>}
                {!!verification.evidence.length && (
                  <ul className="entry-links">
                    {verification.evidence.map((evidence, index) => (
                      <li key={`${verification.id}-${index}`}>
                        <a href={evidence.url} target="_blank" rel="noopener noreferrer nofollow">
                          {evidence.kind === "link" ? (
                            <HugeiconsIcon icon={Link01Icon} size={14} aria-hidden="true" />
                          ) : (
                            <HugeiconsIcon icon={File01Icon} size={14} aria-hidden="true" />
                          )}
                          {evidence.kind === "link" ? sourceLabel(evidence.url) : evidence.fileName}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="button-row" style={{ margin: "18px 0" }}>
        <a className="btn btn-dark" href={checkHref}>
          I’ve been here, let me check
        </a>
      </div>

      {authState === "signed-out" && (
        <div className="inline-card">
          <strong>Have a certificate photo or a source?</strong>
          <p>Log in with a one-time email code to share it for review.</p>
          <a
            className="btn btn-outline btn-sm"
            href={`/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`}
          >
            Log in to share
          </a>
        </div>
      )}
      {authState === "signed-in" && (
        <details className="stack-form">
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>
            Share a source instead (link, certificate or menu)
          </summary>
          <form className="stack" onSubmit={submit} style={{ marginTop: 14 }}>
            <label className="field">
              <span>Links, one per line</span>
              <textarea
                value={links}
                onChange={(event) => setLinks(event.target.value)}
                maxLength={8192}
                rows={3}
                placeholder="https://www.instagram.com/p/…"
              />
              <small className="field-note">Zabihah, Instagram, TikTok or YouTube.</small>
            </label>
            <label className="field">
              <span>Certificate, supplier document or menu</span>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files || []))}
              />
              <small className="field-note">JPEG, PNG, WebP or PDF, up to 8 MB each.</small>
            </label>
            <label className="field">
              <span>Anything else? (optional)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="Helpful context for the reviewer"
              />
            </label>
            {success && (
              <p className="form-success" role="status">
                Thank you! It’s with our reviewers now.
              </p>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="btn btn-dark" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send for review"}
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
