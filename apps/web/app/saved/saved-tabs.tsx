"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Segmented } from "../../src/components/kit-client";

type Tab = "places" | "lists";
const KEY = "halalfood:saved-tab";

/** Places / Lists, remembered in localStorage unless the URL names a tab. */
export function SavedTabs({ initial, places, lists }: { initial: Tab | null; places: ReactNode; lists: ReactNode }) {
  const [tab, setTab] = useState<Tab>(initial ?? "places");
  useEffect(() => {
    if (initial) return;
    try {
      if (window.localStorage.getItem(KEY) === "lists") setTab("lists");
    } catch {
      // Storage can be blocked; the default tab is fine.
    }
  }, [initial]);
  const change = (next: Tab) => {
    setTab(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Not remembered this time.
    }
  };
  return (
    <div className="grid gap-4">
      <Segmented
        label="Saved"
        value={tab}
        onChange={change}
        options={[
          { value: "places", label: "Places" },
          { value: "lists", label: "Lists" },
        ]}
      />
      <div role="tabpanel">{tab === "places" ? places : lists}</div>
    </div>
  );
}
