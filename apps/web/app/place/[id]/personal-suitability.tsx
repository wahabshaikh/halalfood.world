"use client";

import { useEffect, useState } from "react";
import type { Suitability } from "@halalfood/core/user-preferences";
import { SuitabilityNotice } from "../../../src/components/decision-summary";

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

  return <SuitabilityNotice suitability={suitability} className="mt-3.5" />;
}
