"use client";

import { useEffect, useState } from "react";
import { Navigation03Icon } from "@hugeicons/core-free-icons";
import { Icon, buttonClass } from "@/components/hf/kit";
import { directionsUrl, preferredMapsApp } from "@/lib/directions";
import { cn } from "@/lib/utils";

/** Keep directions usable before hydration and remember the member's maps app. */
export function DirectionsButton({ place, className }: { place: Parameters<typeof directionsUrl>[1]; className?: string }) {
  const [app, setApp] = useState<"google" | "apple">("google");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("hf:maps-app");
    } catch {
      // Device defaults still work when browser storage is unavailable.
    }
    setApp(preferredMapsApp(stored, navigator.userAgent));
  }, []);

  const href = directionsUrl(app, place);
  if (!href) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={buttonClass("primary", "md", "min-h-[50px] flex-1 rounded-[14px]")}>
        <Icon icon={Navigation03Icon} size={18} />
        Directions
      </a>
      <select
        aria-label="Maps app for directions"
        value={app}
        className={buttonClass("outline", "sm", "rounded-xl")}
        onChange={(event) => {
          const choice = preferredMapsApp(event.target.value, navigator.userAgent);
          setApp(choice);
          try {
            localStorage.setItem("hf:maps-app", choice);
          } catch {
            // Keep the current choice usable even when it cannot be saved.
          }
        }}
      >
        <option value="google">Google Maps</option>
        <option value="apple">Apple Maps</option>
      </select>
    </div>
  );
}
