"use client";

import { useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { goToLogin } from "./visit-card";

type Relation = {
  following: boolean;
  requested: boolean;
  followedBy: boolean;
  blocking: boolean;
  blockedBy: boolean;
};

/**
 * Follow and block for a diner's profile. It reads the relationship only for a
 * signed-in visitor, hides itself on your own profile, and never says whether
 * someone has blocked you, only that following is unavailable.
 */
export default function FollowControls({ handle }: { handle: string }) {
  const [state, setState] = useState<"loading" | "signed-out" | "self" | "ready" | "error">(
    "loading",
  );
  const [relation, setRelation] = useState<Relation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/follows/${encodeURIComponent(handle)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 401) return setState("signed-out");
        if (!response.ok) throw new Error();
        const payload = (await response.json()) as { relation?: Relation; isSelf?: boolean };
        if (payload.isSelf) return setState("self");
        setRelation(payload.relation ?? null);
        setState("ready");
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setState("error");
      });
    return () => controller.abort();
  }, [handle]);

  async function send(path: "follows" | "blocks", method: "PUT" | "DELETE") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/${path}/${encodeURIComponent(handle)}`, { method });
      if (response.status === 401) {
        goToLogin("follow");
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        relation?: Relation;
        error?: string;
      };
      if (!response.ok) {
        setMessage(payload.error ?? "That didn’t work. Please try again.");
        return;
      }
      if (payload.relation) setRelation(payload.relation);
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "self" || state === "error" || state === "loading") return null;

  if (state === "signed-out")
    return (
      <Button size="lg" className="rounded-full font-bold" onClick={() => goToLogin("follow")}>
        Follow
      </Button>
    );

  if (!relation) return null;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {relation.blocking ? (
        <Button
          variant="outline"
          size="lg"
          className="rounded-full font-bold"
          disabled={busy}
          onClick={() => send("blocks", "DELETE")}
        >
          Unblock
        </Button>
      ) : (
        <>
          <Button
            size="lg"
            variant={relation.following ? "outline" : "default"}
            className="rounded-full font-bold"
            disabled={busy}
            aria-pressed={relation.following}
            onClick={() => send("follows", relation.following ? "DELETE" : "PUT")}
          >
            {relation.following ? "Following" : relation.followedBy ? "Follow back" : "Follow"}
          </Button>
          <Button
            variant="ghost"
            className="rounded-full text-muted-foreground"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Block this diner? You won’t see each other’s visits or comments."))
                void send("blocks", "PUT");
            }}
          >
            Block
          </Button>
        </>
      )}
      {message && (
        <span className="text-sm font-semibold text-destructive" role="alert">
          {message}
        </span>
      )}
    </div>
  );
}
