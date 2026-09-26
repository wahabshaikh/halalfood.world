"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@halalfood/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@halalfood/ui/components/input-group";
import { cn } from "@halalfood/ui/lib/utils";
import { Link01Icon, Share08Icon, Tick02Icon } from "@hugeicons/core-free-icons";

/**
 * Web Share where available, clipboard otherwise, and a selectable URL if both
 * are blocked (non-secure origins, locked-down browsers).
 */
export default function ShareButton({
  url,
  title,
  text,
  className,
  variant = "ghost",
}: {
  url: string;
  title: string;
  text?: string;
  className?: string;
  variant?: "outline" | "ghost" | "secondary";
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
    <span className="relative inline-flex flex-col">
      <Button type="button" variant={variant} size="lg" className={cn("font-extrabold", variant === "ghost" && "underline underline-offset-3", className)} onClick={share}>
        <HugeiconsIcon icon={state === "copied" ? Tick02Icon : Share08Icon} size={17} aria-hidden="true" />
        <span>{state === "copied" ? "Link copied" : "Share"}</span>
      </Button>
      {state === "failed" && (
        <InputGroup className="absolute top-[calc(100%+6px)] right-0 z-10 w-72 bg-popover shadow-lg" role="status">
          <InputGroupAddon>
            <HugeiconsIcon icon={Link01Icon} size={14} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            readOnly
            value={absolute}
            aria-label="Link to copy"
            onFocus={(e) => e.currentTarget.select()}
          />
        </InputGroup>
      )}
    </span>
  );
}
