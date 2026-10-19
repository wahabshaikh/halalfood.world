"use client";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MENU_BADGE_LABEL, MENU_BADGE_TOOLTIP } from "@/lib/core/menus";

/**
 * "Menu checked: no alcohol · no pork", for a clean menu check only. The
 * tooltip says what it is: an automated read of the published menu, not
 * halal certification and not a community check.
 */
export function MenuCheckBadge({ checkedOn }: { checkedOn: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full bg-secondary px-3.5 text-[13px] font-extrabold text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:min-h-11"
          >
            <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={3} aria-hidden="true" />
            {MENU_BADGE_LABEL}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 text-[13px] leading-snug">
          {MENU_BADGE_TOOLTIP} Read {checkedOn}.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
