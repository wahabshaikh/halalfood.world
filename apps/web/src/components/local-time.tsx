"use client";

import { useEffect, useState } from "react";

function format(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: timeZone ? "short" : undefined,
  }).format(new Date(at));
}

/**
 * A moment shown in the visitor's own time zone. Events carry no time zone of
 * their own, so the server renders UTC and the browser swaps in local time once
 * it is mounted, which keeps the server and client markup identical at first.
 */
export function LocalTime({ at, className }: { at: number; className?: string }) {
  const [text, setText] = useState(() => format(at, "UTC"));
  useEffect(() => setText(format(at)), [at]);
  return (
    <time dateTime={new Date(at).toISOString()} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
