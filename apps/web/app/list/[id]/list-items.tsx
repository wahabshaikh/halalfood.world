"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Cancel01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Input } from "@halalfood/ui/components/input";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@halalfood/ui/components/item";
import { FormMessage } from "../../../src/components/section";
import { canEditItems, type ListStanding } from "@halalfood/core/place-lists";
import type { ListPlace } from "../../../src/lib/lists-repository";
import { call } from "./call";

type Found = { id: string; name: string; street_address: string; city_slug: string };

/**
 * The places on a list. Everyone reads them; the owner and accepted
 * collaborators can add places, leave notes and take back their own picks. A
 * tick marks the places the reader has a recorded visit to.
 */
export default function ListItems({
  listId,
  initialItems,
  role,
  viewerId,
  ranked,
  visitedIds,
  shared,
}: {
  listId: string;
  initialItems: ListPlace[];
  role: ListStanding;
  viewerId: string | null;
  ranked: boolean;
  visitedIds: string[];
  /** The list has collaborators, so each pick says who added it. */
  shared: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const visited = new Set(visitedIds);
  const canEdit = canEditItems(role);

  // The owner can change anything; an editor only their own picks.
  const mayChange = (item: ListPlace) =>
    role === "owner" || (role === "editor" && item.addedByUserId === viewerId);

  async function search() {
    if (query.trim().length < 2) return;
    setError("");
    try {
      const response = await fetch(`/api/places/search?q=${encodeURIComponent(query.trim())}&limit=8`);
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { places?: Found[] };
      setFound(Array.isArray(body.places) ? body.places : []);
    } catch {
      setError("Search is taking a moment. Please try again.");
    }
  }

  async function add(place: Found) {
    setBusy(true);
    setError("");
    const result = await call<{ items: ListPlace[] }>(`/api/lists/${listId}/items`, "POST", {
      placeId: place.id,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setItems(result.body.items);
    setFound(null);
    setQuery("");
  }

  async function remove(item: ListPlace) {
    setBusy(true);
    setError("");
    const result = await call<{ items: ListPlace[] }>(
      `/api/lists/${listId}/items/${item.placeId}`,
      "DELETE",
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setItems(result.body.items);
  }

  async function saveNote(item: ListPlace) {
    setBusy(true);
    setError("");
    const result = await call<{ items: ListPlace[] }>(
      `/api/lists/${listId}/items/${item.placeId}`,
      "PATCH",
      { note: draft },
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setItems(result.body.items);
    setEditing(null);
  }

  return (
    <div className="grid gap-4">
      {canEdit && !(ranked && role !== "owner") && (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <div className="flex gap-2">
            <Input
              aria-label="Find a place to add"
              value={query}
              maxLength={120}
              placeholder="Add a place: name, dish or city"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={query.trim().length < 2}>
              <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
              Search
            </Button>
          </div>
          {found && (
            <ul className="grid gap-1.5" aria-label="Places found">
              {found.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  No listed place matches. <a className="font-bold underline" href={`/add?q=${encodeURIComponent(query)}`}>Add it</a>.
                </li>
              )}
              {found.map((place) => (
                <li key={place.id}>
                  <Item variant="outline" className="rounded-xl px-3 py-2.5">
                    <ItemContent>
                      <ItemTitle>{place.name}</ItemTitle>
                      <ItemDescription className="text-xs">{place.street_address}</ItemDescription>
                    </ItemContent>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || items.some((item) => item.placeId === place.id)}
                      onClick={() => void add(place)}
                    >
                      <HugeiconsIcon icon={Add01Icon} size={14} aria-hidden="true" />
                      {items.some((item) => item.placeId === place.id) ? "Added" : "Add"}
                    </Button>
                  </Item>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canEdit ? "Nothing here yet. Search above to add the first place." : "This list is empty so far."}
        </p>
      ) : (
        <ol className="grid gap-3">
          {items.map((item, index) => (
            <li key={item.placeId}>
              <Item variant="outline" className="items-start gap-3.5 rounded-xl px-4 py-3.5">
                {ranked && (
                  <ItemMedia className="min-w-7 text-xl font-bold text-muted-foreground">
                    {index + 1}
                  </ItemMedia>
                )}
                <ItemContent>
                  <ItemTitle>
                    <a href={`/place/${item.placeId}`} className="font-semibold hover:underline">
                      {item.name}
                    </a>
                    {viewerId && visited.has(item.placeId) && (
                      <Badge variant="muted" className="ml-2">
                        <HugeiconsIcon icon={Tick02Icon} size={12} aria-hidden="true" /> You’ve been
                      </Badge>
                    )}
                  </ItemTitle>
                  <ItemDescription className="text-xs">
                    {item.streetAddress}
                    {shared && item.addedByHandle && <> · added by @{item.addedByHandle}</>}
                  </ItemDescription>
                  {editing === item.placeId ? (
                    <form
                      className="mt-2 flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveNote(item);
                      }}
                    >
                      <Input
                        aria-label={`Note for ${item.name}`}
                        value={draft}
                        maxLength={500}
                        autoFocus
                        onChange={(event) => setDraft(event.target.value)}
                      />
                      <Button type="submit" size="sm" disabled={busy}>
                        Save
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    item.note && <p className="mt-1.5 text-[13px]">{item.note}</p>
                  )}
                </ItemContent>
                {mayChange(item) && editing !== item.placeId && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(item.placeId);
                        setDraft(item.note ?? "");
                      }}
                    >
                      {item.note ? "Edit note" : "Add note"}
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${item.name}`}
                      disabled={busy}
                      onClick={() => void remove(item)}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={15} aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </Item>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
