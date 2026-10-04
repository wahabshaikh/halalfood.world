"use client";

import { useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import type { FollowStatus } from "@halalfood/core/social";
import { signInAgainUrl } from "../lib/signed-out";

/**
 * Follow, request to follow, or unfollow. A private account turns a follow into
 * a request that waits for approval; the button says so instead of pretending
 * the follow went through.
 */
export default function FollowButton({
  handle,
  initialStatus,
  size = "lg",
  variant,
}: {
  handle: string;
  initialStatus: FollowStatus | null;
  size?: "default" | "sm" | "lg" | "xl";
  variant?: "default" | "outline";
}) {
  const [status, setStatus] = useState<FollowStatus | null>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/follows/${encodeURIComponent(handle)}`, {
        method: status ? "DELETE" : "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: FollowStatus | null;
        error?: string;
        loginUrl?: string;
      };
      if (response.status === 401 && body.loginUrl) {
        window.location.assign(signInAgainUrl(body));
        return;
      }
      if (!response.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus(body.status ?? null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? "…"
    : status === "accepted"
      ? "Following"
      : status === "pending"
        ? "Requested"
        : "Follow";

  return (
    <span className="inline-grid gap-1">
      <Button
        type="button"
        size={size}
        variant={variant ?? (status ? "outline" : "default")}
        disabled={busy}
        aria-pressed={status === "accepted"}
        title={status === "pending" ? "Tap to withdraw your request" : undefined}
        onClick={() => void toggle()}
      >
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-xs font-bold text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
