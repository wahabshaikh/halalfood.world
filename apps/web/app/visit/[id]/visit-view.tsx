"use client";

import { useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Textarea } from "@halalfood/ui/components/textarea";
import { MAX_COMMENT_LENGTH, commentReportTarget, relativeTime } from "@halalfood/core/feed";
import type { CommentView, FeedCard } from "../../../src/lib/feed-repository";
import { InitialsAvatar, Loading, monogram } from "../../../src/components/blocks";
import { EmptyPanel } from "../../../src/components/site-chrome";
import { FormMessage, Note } from "../../../src/components/section";
import { ReportButton } from "../../../src/components/report-button";
import { VisitCard, goToLogin } from "../../../src/components/visit-card";
import { loginHref } from "../../../src/lib/signed-out";

type Loaded = { visit: FeedCard; comments: CommentView[]; canComment: boolean };

function commenter(comment: CommentView): string {
  if (comment.author.isYou) return "You";
  return comment.author.displayName ?? comment.author.handle ?? "A diner";
}

export default function VisitView({ visitId }: { visitId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [data, setData] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/visits/${visitId}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 404) return setState("missing");
        if (!response.ok) throw new Error();
        setData((await response.json()) as Loaded);
        setState("ready");
      })
      .catch((caught) => {
        if ((caught as Error).name !== "AbortError") setState("error");
      });
    return () => controller.abort();
  }, [visitId]);

  async function post() {
    if (!data || !draft.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      const response = await fetch(`/api/visits/${visitId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (response.status === 401) {
        goToLogin("comment");
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        comment?: CommentView;
        error?: string;
      };
      if (!response.ok || !payload.comment) {
        setError(payload.error ?? "Could not post that comment.");
        return;
      }
      const comment = payload.comment;
      setData((current) =>
        current
          ? {
              ...current,
              comments: [...current.comments, comment],
              visit: { ...current.visit, comments: current.visit.comments + 1 },
            }
          : current,
      );
      setDraft("");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPosting(false);
    }
  }

  async function remove(comment: CommentView) {
    setError(null);
    try {
      const response = await fetch(`/api/visits/${visitId}/comments/${comment.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Could not remove that comment.");
        return;
      }
      setData((current) =>
        current
          ? {
              ...current,
              comments: current.comments.filter((entry) => entry.id !== comment.id),
              visit: { ...current.visit, comments: Math.max(0, current.visit.comments - 1) },
            }
          : current,
      );
    } catch {
      setError("Could not reach the server. Please try again.");
    }
  }

  if (state === "loading") return <Loading>Loading this visit…</Loading>;
  if (state === "missing")
    return (
      <EmptyPanel
        title="This visit isn't available"
        description="It may have been made private, removed, or come from someone you can't see."
      >
        <Button asChild size="xl">
          <a href="/feed">Back to your feed</a>
        </Button>
      </EmptyPanel>
    );
  if (state === "error" || !data)
    return <FormMessage tone="error">This visit could not load. Please try again.</FormMessage>;

  const { visit, comments, canComment } = data;
  return (
    <div className="grid gap-5">
      <VisitCard card={visit} detail />

      <section aria-labelledby="comments-title" className="grid gap-4">
        <h2 id="comments-title" className="text-xl">
          Comments
        </h2>
        {comments.length === 0 && <Note>No comments yet.</Note>}
        <ul className="grid gap-4">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <InitialsAvatar initials={monogram(commenter(comment))} size={36} />
              <div className="grid min-w-0 flex-1 gap-1">
                <p className="text-sm">
                  <span className="font-bold">
                    {comment.author.handle ? (
                      <a href={`/u/${comment.author.handle}`} className="hover:underline">
                        {commenter(comment)}
                      </a>
                    ) : (
                      commenter(comment)
                    )}
                  </span>{" "}
                  <span className="text-muted-foreground">{relativeTime(comment.createdAt)}</span>
                </p>
                <p className="break-words whitespace-pre-line">{comment.body}</p>
                <div className="flex gap-3">
                  {comment.canDelete && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-[13px] text-muted-foreground"
                      onClick={() => remove(comment)}
                    >
                      Remove
                    </Button>
                  )}
                  {!comment.author.isYou && (
                    <ReportButton
                      targetType="check-in"
                      targetId={commentReportTarget(comment.id)}
                      idPrefix={`report-${comment.id}`}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {canComment ? (
          <form
            className="grid gap-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              void post();
            }}
          >
            <Textarea
              aria-label="Add a comment"
              rows={2}
              maxLength={MAX_COMMENT_LENGTH}
              value={draft}
              placeholder="Add a comment…"
              onChange={(event) => setDraft(event.target.value)}
            />
            {error && <FormMessage tone="error">{error}</FormMessage>}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!draft.trim() || posting}>
                {posting ? "Posting…" : "Post"}
              </Button>
              <span className="text-[13px] text-muted-foreground">
                {draft.length}/{MAX_COMMENT_LENGTH}
              </span>
            </div>
          </form>
        ) : (
          <Note>
            <a className="underline" href={loginHref(`/visit/${visitId}`, "comment")}>
              Log in
            </a>{" "}
            to like and comment.
          </Note>
        )}
      </section>
    </div>
  );
}
