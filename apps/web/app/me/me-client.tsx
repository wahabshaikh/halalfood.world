"use client";

import { useState, type ReactNode } from "react";
import { UserAdd01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@halalfood/ui/lib/utils";
import { Icon } from "../../src/components/kit";
import { Segmented, toast } from "../../src/components/kit-client";

type Tab = "passport" | "checks" | "lists";

export function MeTabs({ passport, checks, lists }: { passport: ReactNode; checks: ReactNode; lists: ReactNode }) {
  const [tab, setTab] = useState<Tab>("passport");
  return (
    <section className="grid gap-4 pt-6 lg:pt-0">
      <Segmented
        label="Your profile"
        value={tab}
        onChange={setTab}
        options={[
          { value: "passport", label: "Passport" },
          { value: "checks", label: "Checks" },
          { value: "lists", label: "Lists" },
        ]}
      />
      <div role="tabpanel">{tab === "passport" ? passport : tab === "checks" ? checks : lists}</div>
    </section>
  );
}

export function InviteButton({ handle, className }: { handle: string; className?: string }) {
  const copy = async () => {
    const url = `${window.location.origin}/invite/${handle}`;
    if (navigator.share) {
      try {
        await navigator.share({ url, title: "Join me on halalfood.world" });
        return;
      } catch {
        // Cancelled: fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied");
    } catch {
      toast("Couldn’t copy the link");
    }
  };
  return (
    <button type="button" onClick={copy} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-extrabold hover:bg-secondary", className)}>
      <Icon icon={UserAdd01Icon} size={18} />
      Invite friends
    </button>
  );
}
