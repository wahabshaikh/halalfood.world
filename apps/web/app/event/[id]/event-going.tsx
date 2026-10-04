"use client";

import { useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { goingLine } from "@halalfood/core/events";
import { InitialsAvatar, monogram } from "../../../src/components/blocks";
import { FormMessage } from "../../../src/components/section";
import ShareButton from "../../../src/components/share-button";
import { goToLogin } from "../../../src/components/visit-card";
import { presentHttpFailure, presentTransportFailure, type PresentedFailure } from "../../../src/lib/failure-copy";

type Going = {
  signedIn: boolean;
  going: number;
  viewerGoing: boolean;
  friends: { handle: string; displayName: string | null; avatarUrl: string | null }[];
  line: string | null;
};

/**
 * "I'm going", who else is, and an invite. Signed-out visitors see the count;
 * friends are named only for a signed-in diner, and only people they follow.
 * Going is planning. It has no bearing on a vendor's halal status.
 */
export default function EventGoing({
  eventId,
  title,
  closed,
  initialGoing,
}: {
  eventId: string;
  title: string;
  closed: boolean;
  initialGoing: number;
}) {
  const [state, setState] = useState<Going>({
    signedIn: false,
    going: initialGoing,
    viewerGoing: false,
    friends: [],
    line: goingLine([], initialGoing),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PresentedFailure | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/events/${eventId}/going`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        setState((await response.json()) as Going);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId]);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/going`, {
        method: state.viewerGoing ? "DELETE" : "PUT",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) return goToLogin("event");
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        // The RSVP on screen stays. A failed request is not a change of mind.
        setError(presentHttpFailure("your RSVP", response.status, body.error));
        return;
      }
      setState((await response.json()) as Going);
    } catch (caught) {
      setError(presentTransportFailure("your RSVP", caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!closed && (
          <Button
            size="lg"
            variant={state.viewerGoing ? "outline" : "default"}
            aria-pressed={state.viewerGoing}
            disabled={busy}
            onClick={() => void toggle()}
          >
            {state.viewerGoing ? "You’re going" : "I’m going"}
          </Button>
        )}
        <ShareButton
          url={`/event/${eventId}`}
          title={title}
          text={`Come along: ${title}`}
          variant="outline"
        />
      </div>
      {state.friends.length > 0 && (
        <div className="flex items-center gap-2" data-testid="friends-going">
          <span className="flex -space-x-2">
            {state.friends.slice(0, 3).map((friend) => (
              <InitialsAvatar
                key={friend.handle}
                initials={monogram(friend.displayName ?? friend.handle)}
                size={28}
                className="ring-2 ring-background"
              />
            ))}
          </span>
          <span className="text-sm">{state.line}</span>
        </div>
      )}
      {state.friends.length === 0 && state.line && <p className="text-sm text-muted-foreground">{state.line}</p>}
      {error && (
        <FormMessage tone="error">
          {error.message}
          {error.retry && (
            <Button variant="link" disabled={busy} onClick={() => void toggle()}>
              Try again
            </Button>
          )}
        </FormMessage>
      )}
    </div>
  );
}
