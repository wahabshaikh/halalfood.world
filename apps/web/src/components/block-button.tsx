"use client";

import { useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { signInAgainUrl } from "../lib/signed-out";

/** Block a diner after a confirmation. Blocking hides you from each other and removes any follow. */
export default function BlockButton({ handle }: { handle: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function block() {
    if (!window.confirm(`Block @${handle}? You will no longer see each other, and any follow between you is removed.`))
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/blocks/${encodeURIComponent(handle)}`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; loginUrl?: string };
      if (response.status === 401 && body.loginUrl) {
        window.location.assign(signInAgainUrl(body));
        return;
      }
      if (!response.ok) {
        setError(body.error ?? "Could not block. Please try again.");
        return;
      }
      window.location.assign("/settings");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-grid gap-1">
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void block()}>
        Block
      </Button>
      {error && (
        <span role="alert" className="text-xs font-bold text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
