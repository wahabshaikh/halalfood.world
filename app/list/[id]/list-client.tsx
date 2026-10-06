"use client";

import { useState } from "react";
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowUp01Icon, Delete02Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { PlaceStatus } from "@/lib/core/halal";
import { cn } from "@/lib/utils";
import { Icon, PlaceArt, StatusPill, buttonClass } from "@/components/hf/kit";
import { ShareAction, Sheet, api, errorText, toast, useSheet } from "@/components/hf/kit-client";
import { SendSheetButton } from "@/components/hf/send-sheet";
import { photoUrl } from "@/lib/place-view";
import { currentReturnPath, loginHref } from "@/lib/signed-out";

type Visibility = "public" | "followers" | "private";

export function ListHeaderActions({ list, signedIn }: { list: { id: string; title: string }; signedIn: boolean }) {
  const round = "flex size-11 items-center justify-center rounded-full bg-background text-foreground shadow-md";
  return (
    <div className="absolute inset-x-4 top-4 flex justify-between">
      <button type="button" onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/saved"))} aria-label="Back" className={round}>
        <Icon icon={ArrowLeft01Icon} />
      </button>
      <div className="flex gap-2">
        {signedIn && <SendSheetButton target={{ kind: "list", id: list.id, name: list.title }} className={round} label="" ariaLabel="Send to friends" />}
        <ShareAction url={`/list/${list.id}`} title={list.title} text={list.title} className={round} />
      </div>
    </div>
  );
}

export function ListActions({
  list,
  role,
  canAdd,
  savedByMe,
  signedIn,
}: {
  list: { id: string; title: string; caption: string | null; visibility: Visibility; kind: "ranked" | "plan" | "guide" };
  role: "owner" | "member" | "invited" | "viewer";
  canAdd: boolean;
  savedByMe: boolean;
  signedIn: boolean;
}) {
  const [saved, setSaved] = useState(savedByMe);
  const edit = useSheet("edit-list");
  const add = useSheet("add-place");

  const toggleSave = async () => {
    if (!signedIn) return window.location.assign(loginHref(currentReturnPath()));
    const next = !saved;
    setSaved(next);
    try {
      await api(`/api/lists/${list.id}/save`, { method: next ? "PUT" : "DELETE" });
    } catch (error) {
      setSaved(!next);
      toast(errorText(error));
    }
  };

  const accept = async () => {
    try {
      await api(`/api/lists/${list.id}/members/accept`, { method: "POST" });
      window.location.reload();
    } catch (error) {
      toast(errorText(error));
    }
  };

  if (role === "invited")
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-accent p-4">
        <span className="text-[15px] font-extrabold">You’re invited to plan this list.</span>
        <button type="button" onClick={accept} className={buttonClass("primary", "md", "px-5")}>
          Join
        </button>
      </div>
    );

  return (
    <div className="flex flex-wrap gap-2">
      {role === "viewer" && (
        <button type="button" onClick={toggleSave} aria-pressed={saved} className={buttonClass(saved ? "done" : "dark", "md", "px-5")}>
          {saved ? "Saved" : "Save list"}
        </button>
      )}
      {canAdd && (
        <button type="button" onClick={add.show} className={buttonClass("dark", "md", "px-5")}>
          Add place
        </button>
      )}
      {role === "owner" && list.kind === "plan" && (
        <SendSheetButton target={{ kind: "list", id: list.id, name: list.title }} mode="invite" className={buttonClass("outline", "md", "px-5")} label="Invite" icon={false} />
      )}
      {role === "owner" && (
        <button type="button" onClick={edit.show} className={buttonClass("outline", "md", "px-5")}>
          Edit
        </button>
      )}
      {role === "member" && <LeaveButton listId={list.id} />}
      <Sheet open={edit.open} onClose={edit.hide} title="Edit list">
        {edit.open && <EditForm list={list} />}
      </Sheet>
      <Sheet open={add.open} onClose={add.hide} title="Add a place">
        {add.open && <AddPlacePicker listId={list.id} />}
      </Sheet>
    </div>
  );
}

function LeaveButton({ listId }: { listId: string }) {
  const leave = async () => {
    try {
      const me = await api<{ profile: { handle: string } }>("/api/me");
      await api(`/api/lists/${listId}/members/${encodeURIComponent(me.profile.handle)}`, { method: "DELETE" });
      window.location.assign("/saved?tab=lists");
    } catch (error) {
      toast(errorText(error));
    }
  };
  return (
    <button type="button" onClick={leave} className={buttonClass("ghost", "md", "px-5")}>
      Leave
    </button>
  );
}

function EditForm({ list }: { list: { id: string; title: string; caption: string | null; visibility: Visibility } }) {
  const [title, setTitle] = useState(list.title);
  const [caption, setCaption] = useState(list.caption ?? "");
  const [visibility, setVisibility] = useState<Visibility>(list.visibility);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/lists/${list.id}`, { method: "PUT", json: { title, caption, visibility } });
      window.location.reload();
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${list.title}”? This can’t be undone.`)) return;
    try {
      await api(`/api/lists/${list.id}`, { method: "DELETE" });
      window.location.assign("/saved?tab=lists");
    } catch (error) {
      toast(errorText(error));
    }
  };
  const field = "rounded-[14px] border border-input px-3.5 text-[15px] font-semibold outline-none focus:border-foreground";
  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-sm font-extrabold">Name</span>
        <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 80))} className={cn(field, "h-[50px]")} />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-extrabold">Caption</span>
        <textarea value={caption} onChange={(event) => setCaption(event.target.value.slice(0, 200))} rows={2} className={cn(field, "resize-none py-3")} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        {(["public", "followers", "private"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={visibility === value}
            onClick={() => setVisibility(value)}
            className={cn("min-h-11 rounded-xl border text-sm font-extrabold", visibility === value ? "border-foreground bg-foreground text-background" : "border-input")}
          >
            {value === "public" ? "Everyone" : value === "followers" ? "Followers" : "Only me"}
          </button>
        ))}
      </div>
      <button type="button" onClick={save} disabled={!title.trim() || busy} className={buttonClass("primary", "lg")}>
        Save
      </button>
      <button type="button" onClick={remove} className={buttonClass("ghost", "lg", "text-destructive")}>
        Delete list
      </button>
    </div>
  );
}

function AddPlacePicker({ listId }: { listId: string }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<{ id: string; name: string; area: string }[]>([]);
  const [timer, setTimer] = useState<number | null>(null);
  const search = (value: string) => {
    setQuery(value);
    if (timer) window.clearTimeout(timer);
    if (value.trim().length < 2) return setPlaces([]);
    setTimer(
      window.setTimeout(async () => {
        try {
          const body = await api<{ places: { id: string; name: string; area: string }[] }>(`/api/search?q=${encodeURIComponent(value.trim())}`);
          setPlaces(body.places);
        } catch {
          setPlaces([]);
        }
      }, 200),
    );
  };
  const add = async (placeId: string) => {
    try {
      await api(`/api/lists/${listId}/items/${placeId}`, { method: "POST", json: {} });
      window.location.reload();
    } catch (error) {
      toast(errorText(error));
    }
  };
  return (
    <div className="grid gap-3">
      <label className="flex h-[50px] items-center gap-2.5 rounded-full bg-secondary px-[18px]">
        <Icon icon={Search01Icon} />
        <span className="sr-only">Search places</span>
        <input autoFocus value={query} onChange={(event) => search(event.target.value)} placeholder="Search places" className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none" />
      </label>
      <ul className="grid">
        {places.map((place) => (
          <li key={place.id}>
            <button type="button" onClick={() => add(place.id)} className="grid w-full gap-0.5 border-b border-border/70 py-3 text-left">
              <strong className="text-[15px] font-extrabold">{place.name}</strong>
              <span className="text-[13px] font-semibold text-muted-foreground">{place.area}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Item = { id: string; name: string; area: string; status: PlaceStatus; photoKey: string | null; note: string | null; been: boolean; addedByUserId: string | null };

export function ListItems({
  listId,
  ranked,
  canReorder,
  viewerId,
  ownerId,
  items: initial,
}: {
  listId: string;
  ranked: boolean;
  canReorder: boolean;
  viewerId: string | null;
  ownerId: string;
  items: Item[];
}) {
  const [items, setItems] = useState(initial);

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    const previous = items;
    setItems(next);
    try {
      await api(`/api/lists/${listId}/items`, { method: "PUT", json: { placeIds: next.map((item) => item.id) } });
    } catch (error) {
      setItems(previous);
      toast(errorText(error));
    }
  };

  const remove = async (item: Item) => {
    const previous = items;
    setItems(items.filter((other) => other.id !== item.id));
    try {
      await api(`/api/lists/${listId}/items/${item.id}`, { method: "DELETE" });
    } catch (error) {
      setItems(previous);
      toast(errorText(error));
    }
  };

  if (!items.length) return <p className="py-8 text-center text-sm font-semibold text-muted-foreground">No places yet.</p>;
  return (
    <ol className="grid">
      {items.map((item, index) => (
        <li key={item.id} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
          <span className={cn("w-6 shrink-0 text-center font-black", ranked ? "text-lg" : "text-muted-foreground")}>{ranked ? index + 1 : "•"}</span>
          <a href={`/place/${item.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-foreground">
            <PlaceArt name={item.name} seed={item.id} src={photoUrl(item.photoKey)} className="size-14" rounded="rounded-[12px]" />
            <span className="grid min-w-0 gap-1">
              <strong className="truncate text-[15px] font-extrabold">{item.name}</strong>
              {item.area && <span className="truncate text-[13px] font-semibold text-muted-foreground">{item.area}</span>}
              <StatusPill status={item.status} short className="w-fit" />
              {item.note && <span className="text-[13px] font-semibold">“{item.note}”</span>}
            </span>
          </a>
          {viewerId &&
            (item.been ? (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground" aria-label="You’ve been">
                <Icon icon={Tick02Icon} size={16} strokeWidth={3} />
              </span>
            ) : (
              <a href={`/place/${item.id}/check`} className="flex size-8 shrink-0 rounded-full border-2 border-input" aria-label={`Check ${item.name}`} />
            ))}
          {canReorder && (
            <span className="flex flex-col">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${item.name} up`} className="size-8 rounded-full disabled:opacity-30">
                <Icon icon={ArrowUp01Icon} size={16} className="mx-auto" />
              </button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Move ${item.name} down`} className="size-8 rounded-full disabled:opacity-30">
                <Icon icon={ArrowDown01Icon} size={16} className="mx-auto" />
              </button>
            </span>
          )}
          {viewerId && (viewerId === ownerId || viewerId === item.addedByUserId) && (
            <button type="button" onClick={() => remove(item)} aria-label={`Remove ${item.name}`} className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-secondary">
              <Icon icon={Delete02Icon} size={16} className="mx-auto" />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
