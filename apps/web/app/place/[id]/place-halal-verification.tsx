"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@halalfood/ui/components/alert";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Field, FieldDescription, FieldLabel } from "@halalfood/ui/components/field";
import { Input } from "@halalfood/ui/components/input";
import { Textarea } from "@halalfood/ui/components/textarea";
import { cn } from "@halalfood/ui/lib/utils";
import { EmptyState, InlineCard, Loading } from "../../../src/components/blocks";
import { Disclosure, FormMessage, SectionIntro } from "../../../src/components/section";

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
      <h2 id="community-verification-title" className="mb-1.5 text-[22px]">
        How we know it’s halal
      </h2>
      <SectionIntro>
        Every check has a date. New checks show as “Awaiting review” until a moderator
        approves them.
      </SectionIntro>

      {statusView && (
        <Alert
          className={cn(
            "mb-4.5 gap-x-4 border-0 px-5 py-4.5",
            statusView.status === "evidence-backed"
              ? "bg-warning-muted text-warning-foreground"
              : "bg-muted",
          )}
          aria-label={`Halal evidence status: ${statusView.label}`}
          role="status"
        >
          <HugeiconsIcon icon={TaskDone01Icon} className="size-6.5!" aria-hidden="true" />
          <AlertTitle className="text-base font-extrabold text-foreground">
            {statusView.label}
          </AlertTitle>
          <AlertDescription
            className={
              statusView.status === "evidence-backed"
                ? "text-warning-foreground"
                : "text-muted-foreground"
            }
          >
            <p>{statusView.detail}</p>
            <p>{statusView.explanation}</p>
          </AlertDescription>
        </Alert>
      )}

      {loading && <Loading>Loading checks…</Loading>}
      {loadError && <FormMessage tone="error">{loadError}</FormMessage>}
      {!loading && !loadError && !verifications.length && (
        <EmptyState>Nobody has shared a check yet. Been here? It takes about a minute.</EmptyState>
      )}
      {!!verifications.length && (
        <ul className="divide-y">
          {verifications.map((verification) => {
            const answers = verification.answers
              ? (Object.keys(verification.answers) as GlanceQuestion[])
                  .map((question) => answerLabel(question, verification.answers?.[question] ?? null))
                  .filter((label): label is string => Boolean(label))
              : [];
            return (
              <li className="grid gap-2 py-5 first:pt-1" key={verification.id}>
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
                    aria-hidden="true"
                  >
                    <HugeiconsIcon icon={TaskDone01Icon} size={20} />
                  </span>
                  <div>
                    <strong className="block text-[15px]">
                      {answers.length ? "In-person check" : "Shared a source"}
                    </strong>
                    <span className="text-[13px] text-muted-foreground">
                      <time dateTime={verification.createdAt}>{formatDate(verification.createdAt)}</time>
                    </span>
                  </div>
                  <Badge
                    variant={verification.status === "approved" ? "success" : "warning"}
                    className="ml-auto font-extrabold"
                  >
                    {verification.status === "approved" ? "Approved" : "Awaiting review"}
                  </Badge>
                </div>
                {!!answers.length && (
                  <div className="flex flex-wrap gap-2">
                    {answers.map((label) => (
                      <Badge variant="secondary" className="h-7 px-3 text-[13px] font-bold" key={label}>
                        {label}
                      </Badge>
                    ))}
                  </div>
                )}
                {verification.note && <p className="text-[15px] leading-normal">{verification.note}</p>}
                {!!verification.evidence.length && (
                  <ul className="flex flex-wrap gap-2">
                    {verification.evidence.map((evidence, index) => (
                      <li key={`${verification.id}-${index}`}>
                        <Button asChild variant="outline" size="sm" className="rounded-full font-bold">
                          <a href={evidence.url} target="_blank" rel="noopener noreferrer nofollow">
                            <HugeiconsIcon
                              icon={evidence.kind === "link" ? Link01Icon : File01Icon}
                              size={14}
                              aria-hidden="true"
                            />
                            {evidence.kind === "link" ? sourceLabel(evidence.url) : evidence.fileName}
                          </a>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="my-4.5">
        <Button asChild size="xl">
          <a href={checkHref}>I’ve been here, let me check</a>
        </Button>
      </div>

      {authState === "signed-out" && (
        <InlineCard
          title="Have a certificate photo or a source?"
          description="Log in with a one-time email code to share it for review."
          action={
            <Button asChild variant="outline">
              <a href={`/login?returnTo=${encodeURIComponent(`/place/${placeId}`)}`}>
                Log in to share
              </a>
            </Button>
          }
        />
      )}
      {authState === "signed-in" && (
        <Card className="px-5.5 py-4">
          <Disclosure label="Share a source instead (link, certificate or menu)">
            <form className="mt-3.5 grid gap-4" onSubmit={submit}>
              <Field>
                <FieldLabel htmlFor="verification-links">Links, one per line</FieldLabel>
                <Textarea
                  id="verification-links"
                  value={links}
                  onChange={(event) => setLinks(event.target.value)}
                  maxLength={8192}
                  rows={3}
                  placeholder="https://www.instagram.com/p/…"
                />
                <FieldDescription>Zabihah, Instagram, TikTok or YouTube.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="verification-files">
                  Certificate, supplier document or menu
                </FieldLabel>
                <Input
                  id="verification-files"
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files || []))}
                />
                <FieldDescription>JPEG, PNG, WebP or PDF, up to 8 MB each.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="verification-note">Anything else? (optional)</FieldLabel>
                <Textarea
                  id="verification-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder="Helpful context for the reviewer"
                />
              </Field>
              {success && (
                <FormMessage tone="success">Thank you! It’s with our reviewers now.</FormMessage>
              )}
              {formError && <FormMessage tone="error">{formError}</FormMessage>}
              <Button size="lg" className="justify-self-start" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send for review"}
              </Button>
            </form>
          </Disclosure>
        </Card>
      )}
    </section>
  );
}
