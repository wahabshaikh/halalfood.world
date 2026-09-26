"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link01Icon, Share08Icon, Tick02Icon } from "@hugeicons/core-free-icons";

/**
 * Web Share where available, clipboard otherwise, and a selectable URL if both
 * are blocked (non-secure origins, locked-down browsers).
 */
export default function ShareButton({
  url,
  title,
  text,
  className = "share-button",
}: {
  url: string;
  title: string;
  text?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [absolute, setAbsolute] = useState(url);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function flash(next: "copied" | "failed") {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2600);
  }

  async function share() {
    const absolute = new URL(url, window.location.origin).href;
    setAbsolute(absolute);
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: absolute });
        return;
      } catch (error) {
        // A dismissed share sheet is not a failure worth reporting.
        if ((error as Error)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(absolute);
      flash("copied");
    } catch {
      flash("failed");
    }
  }

  return (
    <span className="share-control">
      <button type="button" className={className} onClick={share}>
        {state === "copied" ? <HugeiconsIcon icon={Tick02Icon} size={17} /> : <HugeiconsIcon icon={Share08Icon} size={17} />}
        <span>{state === "copied" ? "Link copied" : "Share"}</span>
      </button>
      {state === "failed" && (
        <span className="share-fallback" role="status">
          <HugeiconsIcon icon={Link01Icon} size={14} aria-hidden="true" />
          <input readOnly value={absolute} aria-label="Link to copy" onFocus={(e) => e.currentTarget.select()} />
        </span>
      )}
    </span>
  );
}
