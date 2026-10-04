"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@halalfood/ui/components/dropdown-menu";
import { SignOutMenuItem } from "./sign-out-button";

type AccountState = "unknown" | "signed-out" | "signed-in" | "setup-unavailable" | "session-unavailable";

/**
 * Session and profile are separate. A profile 503 leaves the person signed in
 * and says setup is unavailable. The menu does not start from "Log in".
 */
export function AccountMenu() {
  const [state, setState] = useState<AccountState>("unknown");
  const [retrying, setRetrying] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const session = await fetch("/api/auth/get-session", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (session.status === 401) {
        setState("signed-out");
        return;
      }
      if (!session.ok) {
        setState("session-unavailable");
        return;
      }
      const body = (await session.json()) as { user?: { id?: string } | null };
      if (!body?.user?.id) {
        setState("signed-out");
        return;
      }
      const profile = await fetch("/api/profile", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (profile.status === 401) {
        setState("signed-out");
        return;
      }
      // Signed in either way; only a loaded profile counts as set up.
      setState(profile.ok ? "signed-in" : "setup-unavailable");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setState("session-unavailable");
    } finally {
      if (controllerRef.current === controller) setRetrying(false);
    }
  }, []);

  useEffect(() => {
    void check();
    return () => controllerRef.current?.abort();
  }, [check]);

  // Keep the menu open while the check runs again, so the result is visible.
  const retry = (event: Event) => {
    event.preventDefault();
    if (retrying) return;
    setRetrying(true);
    void check();
  };
  const retryItem = (
    <DropdownMenuItem onSelect={retry} disabled={retrying} className="font-bold">
      {retrying ? "Trying again…" : "Try again"}
    </DropdownMenuItem>
  );

  if (state === "unknown") {
    return (
      <DropdownMenuItem disabled className="font-extrabold">
        Checking your session
      </DropdownMenuItem>
    );
  }
  if (state === "signed-out") {
    return (
      <DropdownMenuItem asChild className="font-extrabold">
        <a href="/login?reason=join">Log in or sign up</a>
      </DropdownMenuItem>
    );
  }
  if (state === "setup-unavailable") {
    return (
      <>
        <DropdownMenuItem disabled className="font-extrabold whitespace-normal">
          Setup unavailable. You are still signed in.
        </DropdownMenuItem>
        {retryItem}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings">Open settings</a>
        </DropdownMenuItem>
        <SignOutMenuItem />
      </>
    );
  }
  if (state === "session-unavailable") {
    return (
      <>
        <DropdownMenuItem disabled className="font-extrabold whitespace-normal">
          Session could not be checked. This is not a sign-out.
        </DropdownMenuItem>
        {retryItem}
      </>
    );
  }
  return (
    <>
      <DropdownMenuItem asChild className="font-extrabold">
        <a href="/settings">Your account</a>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <SignOutMenuItem />
    </>
  );
}
