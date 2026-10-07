"use client";

import { useState } from "react";
import { signOut } from "@/lib/sign-out";
import { errorText, toast } from "./kit-client";

/** Ends the server session first, then clears local drafts and goes home. */
export function SignOutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={className}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
        } catch (error) {
          toast(error instanceof Error ? error.message : errorText(error));
          setBusy(false);
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
