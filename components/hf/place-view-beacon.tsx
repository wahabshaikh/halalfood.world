"use client";

import { useEffect } from "react";

/** Tell the server this document was opened, once per browser per UTC day. Failures stay quiet. */
export function PlaceViewBeacon({ placeId }: { placeId: string }) {
  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `hf-view:${placeId}:${day}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Private mode can refuse storage. The server still caps counts per network.
    }
    void fetch(`/api/places/${placeId}/view`, { method: "POST", credentials: "same-origin", keepalive: true });
  }, [placeId]);
  return null;
}
