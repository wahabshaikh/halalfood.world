"use client";

import { useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Input } from "@halalfood/ui/components/input";
import { ChipRow, FormCard, ListIndex, Loading } from "../../src/components/blocks";
import { ChoiceChips, ToggleChip } from "../../src/components/form-fields";
import { FormMessage, InsufficientData, Note } from "../../src/components/section";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import type { PlaceList } from "@halalfood/core/place-lists";

/**
 * Personal collections. A ranked list published to other people may only hold
 * places the owner has actually visited — the API enforces that, and the copy
 * here says so before someone hits the error.
 */
export default function ListsView() {
  const [lists, setLists] = useState<PlaceList[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [title, setTitle] = useState("");
  const [ranked, setRanked] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/lists");
      if (response.status === 401) {
        const body = await response.json();
        if (typeof body.loginUrl === "string") window.location.href = body.loginUrl;
        return;
      }
      if (!response.ok) throw new Error();
      const body = await response.json();
      setLists(Array.isArray(body.lists) ? body.lists : []);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setError(null);
    try {
      const response = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, ranked, visibility }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create that list.");
        return;
      }
      setTitle("");
      await load();
    } catch {
      setError("Could not reach the server.");
    }
  }

  if (state === "loading") return <Loading>Loading your lists…</Loading>;
  if (state === "error")
    return <FormMessage tone="error">Your lists could not load. Please try again.</FormMessage>;

  return (
    <div className="grid gap-6">
      <FormCard title="New list" onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) void create();
      }}>
        <div className="flex gap-2">
          <Input
            aria-label="List title"
            value={title}
            maxLength={120}
            placeholder="Top biryani in Mumbai"
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button type="submit" disabled={!title.trim()}>
            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
            Create
          </Button>
        </div>
        <ChipRow className="gap-2">
          <ToggleChip pressed={ranked} onPressedChange={setRanked}>
            Ranked
          </ToggleChip>
          <ChoiceChips
            label="Visibility"
            value={visibility}
            onValueChange={(option) => option && setVisibility(option)}
            options={(["public", "unlisted", "private"] as const).map((option) => ({
              value: option,
              label: option[0].toUpperCase() + option.slice(1),
            }))}
          />
        </ChipRow>
        <Note>
          A ranked list you publish may only contain places you have recorded a
          visit to. That is what makes it your ranking rather than a repackaged
          aggregate — keep it private while you are still building it.
        </Note>
        {error && <FormMessage tone="error">{error}</FormMessage>}
      </FormCard>

      {lists.length === 0 ? (
        <InsufficientData>You have not made a list yet.</InsufficientData>
      ) : (
        <ListIndex
          lists={lists.map((list) => ({
            ...list,
            meta: `${list.ranked ? "Ranked" : "Unranked"} · ${list.visibility}`,
          }))}
        />
      )}
    </div>
  );
}
