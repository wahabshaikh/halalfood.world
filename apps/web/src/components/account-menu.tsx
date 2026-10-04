"use client";

import { useEffect, useState } from "react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@halalfood/ui/components/dropdown-menu";

type AccountState = "unknown" | "signed-out" | "signed-in" | "setup-unavailable" | "session-unavailable";

/**
 * Session and profile are separate. A profile 503 leaves the person signed in
 * and says setup is unavailable. The menu does not start from "Log in".
 */
export function AccountMenu() {
  const [state, setState] = useState<AccountState>("unknown");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
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
        setState(profile.status === 503 ? "setup-unavailable" : "signed-in");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState("session-unavailable");
      }
    })();
    return () => controller.abort();
  }, []);

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
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings">Open settings</a>
        </DropdownMenuItem>
      </>
    );
  }
  if (state === "session-unavailable") {
    return (
      <DropdownMenuItem disabled className="font-extrabold whitespace-normal">
        Session could not be checked. This is not a sign-out.
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild className="font-extrabold">
      <a href="/settings">Your account</a>
    </DropdownMenuItem>
  );
}
