"use client";

import { useState } from "react";
import { MoreHorizontalIcon, Share08Icon, UserBlock01Icon } from "@hugeicons/core-free-icons";
import type { Relation } from "@/lib/core/people";
import { Icon, buttonClass } from "@/components/hf/kit";
import { Sheet, api, errorText, toast, useSheet } from "@/components/hf/kit-client";
import { FollowButton } from "@/components/hf/people-client";
import { ReportButton } from "@/components/hf/report-sheet";
import { SendSheetButton } from "@/components/hf/send-sheet";

export function ProfileActions({ handle, relation }: { handle: string; relation: Relation }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <FollowButton handle={handle} initial={relation === "following" ? "following" : relation === "requested" ? "requested" : "none"} />
      <SendSheetButton target={null} to={handle} className={buttonClass("outline", "md")} label="Send a rec" />
    </div>
  );
}

export function ProfileMenu({ handle, userId, name, blocked }: { handle: string; userId: string; name: string; blocked: boolean }) {
  const menu = useSheet("more");
  const [confirming, setConfirming] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}/u/${handle}`;
    try {
      if (navigator.share) await navigator.share({ url, title: name });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied");
      }
    } catch {
      // Cancelled.
    }
  };

  const toggleBlock = async () => {
    try {
      await api(`/api/blocks/${encodeURIComponent(handle)}`, { method: blocked ? "DELETE" : "PUT" });
      window.location.reload();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const row = "flex min-h-12 w-full items-center gap-3 text-left text-[15px] font-bold";
  return (
    <>
      <button type="button" onClick={menu.show} aria-label="More" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-secondary">
        <Icon icon={MoreHorizontalIcon} />
      </button>
      <Sheet open={menu.open} onClose={menu.hide} title={`@${handle}`}>
        {confirming ? (
          <div className="grid gap-4">
            <p className="text-sm font-semibold text-subtle-foreground">
              {name} won’t be able to see your checks or lists, or follow you. You’ll stop following each other. They aren’t told.
            </p>
            <button type="button" onClick={toggleBlock} className={buttonClass("danger", "lg")}>
              Block @{handle}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass("ghost", "lg")}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="grid divide-y divide-border/70">
            <button type="button" onClick={share} className={row}>
              <Icon icon={Share08Icon} size={18} />
              Share profile
            </button>
            <ReportButton targetType="user" targetId={userId} subject={`@${handle}`} signedIn variant="menu" label="Report" />
            <button type="button" onClick={() => (blocked ? toggleBlock() : setConfirming(true))} className={`${row} text-destructive`}>
              <Icon icon={UserBlock01Icon} size={18} />
              {blocked ? "Unblock" : "Block"}
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
