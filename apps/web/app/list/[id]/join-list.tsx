"use client";

import { useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { FormMessage } from "../../../src/components/section";
import { call } from "./call";

/**
 * Shown when someone opens a list through its edit link. Joining makes them a
 * collaborator; the link says nothing about the list until they do.
 */
export default function JoinList({ listId, token }: { listId: string; token: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setError("");
    const result = await call(`/api/lists/${listId}/join`, "POST", { token });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    window.location.assign(`/list/${listId}`);
  }

  return (
    <div className="grid gap-3 rounded-xl border bg-secondary p-4">
      <p className="text-sm font-semibold">
        You’ve been invited to edit this list. Join to add places, leave notes and tick off visits.
      </p>
      <div>
        <Button size="lg" disabled={busy} onClick={() => void join()}>
          Join this list
        </Button>
      </div>
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}
