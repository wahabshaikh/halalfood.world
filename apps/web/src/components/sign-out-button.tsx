"use client";

import { useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { DropdownMenuItem } from "@halalfood/ui/components/dropdown-menu";
import { signOut } from "../lib/sign-out";

function useSignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** "Sign out" for the settings page. */
export function SignOutButton() {
  const { busy, error, run } = useSignOut();
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Sign out" inside the user menu. Keeps the menu open to show a failure. */
export function SignOutMenuItem() {
  const { busy, error, run } = useSignOut();
  return (
    <>
      <DropdownMenuItem
        disabled={busy}
        onSelect={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </DropdownMenuItem>
      {error && (
        <DropdownMenuItem disabled className="whitespace-normal text-destructive">
          {error}
        </DropdownMenuItem>
      )}
    </>
  );
}
