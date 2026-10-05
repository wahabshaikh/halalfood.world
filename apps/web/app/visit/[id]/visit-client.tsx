"use client";

import { useState } from "react";
import { Delete02Icon, SentIcon } from "@hugeicons/core-free-icons";
import { Avatar, Icon } from "../../../src/components/kit";
import { api, errorText, toast } from "../../../src/components/kit-client";
import { timeAgo } from "../../../src/components/time-ago";
import { LikeButton } from "../../../src/components/visit-card";
import { loginHref } from "../../../src/lib/signed-out";

export function LikeLine({ checkId, liked, likes, names, signedIn }: { checkId: string; liked: boolean; likes: number; names: string[]; signedIn: boolean }) {
  const others = Math.max(0, likes - names.length);
  const line = names.length ? `${names.join(", ")}${others ? ` and ${others} other${others === 1 ? "" : "s"}` : ""} liked this` : null;
  return (
    <div className="-ml-2 flex items-center gap-2">
      {signedIn ? (
        <LikeButton checkId={checkId} initial={liked} count={likes} />
      ) : (
        <a href={loginHref(`/visit/${checkId}`)} className="px-2 text-sm font-extrabold text-foreground">
          Sign in to like
        </a>
      )}
      {line && <span className="text-[13px] font-semibold text-muted-foreground">{line}</span>}
    </div>
  );
}

type CommentJson = {
  id: string;
  author: { userId: string; handle: string | null; name: string; avatarUrl: string | null };
  body: string;
  createdAt: number;
  mine: boolean;
};

export function Comments({ checkId, signedIn, initial }: { checkId: string; signedIn: boolean; initial: CommentJson[] }) {
  const [comments, setComments] = useState(initial);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const result = await api<{ comments: CommentJson[] }>(`/api/checks/${checkId}/comments`);
    setComments(result.comments);
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/api/checks/${checkId}/comments`, { method: "POST", json: { body } });
      setBody("");
      await refresh();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/comments/${id}`, { method: "DELETE" });
      setComments((current) => current.filter((comment) => comment.id !== id));
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <section id="comments" aria-labelledby="comments-title" className="grid gap-2 border-t border-border px-5 pt-4 pb-28 md:pb-10">
      <h2 id="comments-title" className="text-[17px] font-black">
        Comments {comments.length > 0 && <span className="text-muted-foreground">{comments.length}</span>}
      </h2>
      {comments.length === 0 && <p className="text-sm font-semibold text-muted-foreground">No comments yet.</p>}
      <ul className="grid gap-3">
        {comments.map((comment) => (
          <li key={comment.id} className="flex gap-3">
            <Avatar name={comment.author.name} seed={comment.author.userId} src={comment.author.avatarUrl} size={32} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="text-sm">
                <a href={comment.author.handle ? `/u/${comment.author.handle}` : "#"} className="font-black text-foreground">
                  {comment.author.name}
                </a>{" "}
                <span className="font-semibold text-muted-foreground">{timeAgo(comment.createdAt)}</span>
              </p>
              <p className="text-[15px] leading-relaxed break-words">{comment.body}</p>
            </div>
            {comment.mine && (
              <button type="button" onClick={() => remove(comment.id)} aria-label="Delete comment" className="size-9 shrink-0 rounded-full text-muted-foreground hover:bg-secondary">
                <Icon icon={Delete02Icon} size={16} className="mx-auto" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {signedIn ? (
        <form
          onSubmit={send}
          className="fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-border bg-background px-4 py-2.5 md:static md:mt-3 md:border-0 md:p-0"
        >
          <label className="flex h-11 min-w-0 flex-1 items-center rounded-full bg-secondary px-4">
            <span className="sr-only">Add a comment</span>
            <input
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, 500))}
              placeholder="Add a comment"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
            />
          </label>
          <button type="submit" disabled={!body.trim() || busy} aria-label="Send comment" className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
            <Icon icon={SentIcon} size={18} />
          </button>
        </form>
      ) : (
        <a href={loginHref(`/visit/${checkId}`)} className="mt-2 text-sm font-extrabold text-foreground underline">
          Sign in to comment
        </a>
      )}
    </section>
  );
}
