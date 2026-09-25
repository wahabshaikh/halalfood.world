"use client";

import { useEffect, useState } from "react";
import type { Suitability } from "../../../src/lib/user-preferences";

/**
 * The signed-in visitor's own dietary standards, applied to this place.
 *
 * The rest of the profile is server-rendered and publicly cacheable; only this
 * strip is personal, so it is fetched on the client and stays silent for a
 * signed-out visitor rather than nagging them to sign in.
 */
export default function PersonalSuitability({ placeId }: { placeId: string }) {
  const [suitability, setSuitability] = useState<Suitability | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/places/${placeId}/decision`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = await response.json();
        const value = body?.decision?.suitability;
        if (value && typeof value === "object") setSuitability(value as Suitability);
      } catch {
        // A personal overlay is never worth an error state on a public page.
      }
    })();
    return () => controller.abort();
  }, [placeId]);

  if (!suitability) return null;

  return (
    <div
      className={`suitability ${suitability.meets ? "is-met" : "is-blocked"}`}
      aria-live="polite"
    >
      <p className="suitability-verdict">
        {suitability.meets
          ? "This meets the dietary standards saved on your account."
          : "This does not meet the dietary standards saved on your account."}
      </p>
      {suitability.blockers.length > 0 && (
        <ul className="suitability-list">
          {suitability.blockers.map((note) => (
            <li key={note.code}>{note.message}</li>
          ))}
        </ul>
      )}
      {suitability.warnings.length > 0 && (
        <ul className="suitability-list is-warning">
          {suitability.warnings.map((note) => (
            <li key={note.code}>{note.message}</li>
          ))}
        </ul>
      )}
      <p className="suitability-note">
        <a href="/preferences">Change your dietary standards</a>
      </p>
    </div>
  );
}
