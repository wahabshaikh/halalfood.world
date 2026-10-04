"use client";

import { Button } from "@halalfood/ui/components/button";
import { FormMessage } from "../../../src/components/section";
import type { BlockFailure } from "../../../src/lib/failure-copy";
import { signedOutLoginPath } from "../../../src/lib/signed-out";

/**
 * One failed place-page block: the specific message, Try again when it can
 * help, and a sign-in link on a 401. Never both a retry and a sign-in.
 */
export function BlockLoadError({
  failure,
  returnTo,
  busy = false,
  onRetry,
}: {
  failure: BlockFailure;
  returnTo: string;
  busy?: boolean;
  onRetry: () => void;
}) {
  return (
    <FormMessage tone="error">
      {failure.message}{" "}
      {failure.retry && (
        <Button variant="link" className="h-auto p-0 font-bold" disabled={busy} onClick={onRetry}>
          Try again
        </Button>
      )}
      {failure.signIn && (
        <a
          className="font-bold underline"
          href={signedOutLoginPath(returnTo, failure.signIn === "signed-out")}
        >
          {failure.signIn === "signed-out" ? "Sign in again" : "Sign in"}
        </a>
      )}
    </FormMessage>
  );
}
