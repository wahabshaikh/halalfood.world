"use client";

import { useEffect, useState } from "react";
import { Add01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@halalfood/ui/lib/utils";
import { Icon, buttonClass } from "./kit";
import { Sheet, api, errorText, toast, useSheet } from "./kit-client";

type Kind = "plan" | "ranked" | "guide";
type Visibility = "public" | "followers" | "private";

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: "plan", label: "Plan with friends", hint: "Places to try together" },
  { value: "ranked", label: "My ranking", hint: "Your favourites, in order" },
  { value: "guide", label: "Guide", hint: "Moderators only" },
];

const VISIBILITIES: { value: Visibility; label: string }[] = [
  { value: "public", label: "Everyone" },
  { value: "followers", label: "Followers" },
  { value: "private", label: "Only me" },
];

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex min-h-[52px] items-center gap-3 rounded-[14px] px-3.5 text-left",
            value === option.value ? "border-2 border-foreground bg-muted" : "border border-input",
          )}
        >
          <span className={cn("size-5 shrink-0 rounded-full", value === option.value ? "border-[6px] border-foreground" : "border-2 border-muted-foreground")} />
          <span className="grid">
            <span className="text-[15px] font-extrabold">{option.label}</span>
            {option.hint && <span className="text-xs font-semibold text-muted-foreground">{option.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The New list form (spec §6.15). */
export function NewListForm({
  placeId,
  moderator,
  privateDefault,
  onCreated,
}: {
  placeId?: string;
  moderator: boolean;
  privateDefault: boolean;
  onCreated?: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("plan");
  const [visibility, setVisibility] = useState<Visibility>(privateDefault ? "private" : "public");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const result = await api<{ id: string }>("/api/lists", { method: "POST", json: { title, kind, visibility, placeId } });
      if (onCreated) onCreated(result.id);
      else window.location.assign(`/list/${result.id}`);
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-sm font-extrabold">Name</span>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, 80))}
          placeholder="Friday biryani run"
          className="h-[50px] rounded-[14px] border border-input px-3.5 text-[15px] font-semibold outline-none focus:border-foreground"
        />
      </label>
      <Choice label="Type" value={kind} onChange={setKind} options={KINDS.filter((option) => option.value !== "guide" || moderator)} />
      <div className="grid gap-1.5">
        <span className="text-sm font-extrabold">Who can see it</span>
        <div className="grid grid-cols-3 gap-2">
          {VISIBILITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={visibility === option.value}
              onClick={() => setVisibility(option.value)}
              className={cn(
                "min-h-11 rounded-xl border text-sm font-extrabold",
                visibility === option.value ? "border-foreground bg-foreground text-background" : "border-input",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" onClick={create} disabled={!title.trim() || busy} className={buttonClass("primary", "lg")}>
        {busy ? "Creating…" : "Create list"}
      </button>
    </div>
  );
}

export function NewListButton({ moderator, privateDefault, className }: { moderator: boolean; privateDefault: boolean; className?: string }) {
  const sheet = useSheet("new-list");
  return (
    <>
      <button type="button" onClick={sheet.show} className={className ?? buttonClass("dark", "md", "px-4")}>
        <Icon icon={Add01Icon} size={18} />
        New list
      </button>
      <Sheet open={sheet.open} onClose={sheet.hide} title="New list">
        {sheet.open && <NewListForm moderator={moderator} privateDefault={privateDefault} />}
      </Sheet>
    </>
  );
}

type Pickable = { id: string; title: string; kind: Kind; items: number; hasPlace: boolean };

/** "Add to a list" from a place: pick an existing list, or start a new one with the place in it. */
export function AddToListButton({ placeId, placeName, className }: { placeId: string; placeName: string; className?: string }) {
  const sheet = useSheet("add-to-list");
  const [lists, setLists] = useState<Pickable[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [me, setMe] = useState<{ privateDefault: boolean; moderator: boolean }>({ privateDefault: false, moderator: false });

  useEffect(() => {
    if (!sheet.open) return;
    api<{ lists: Pickable[] }>(`/api/lists/mine?place=${placeId}`)
      .then((body) => {
        setLists(body.lists);
        setCreating(body.lists.length === 0);
      })
      .catch(() => setLists([]));
    api<{ profile: { listsPrivateDefault: boolean } }>("/api/me")
      .then((body) => setMe((current) => ({ ...current, privateDefault: body.profile.listsPrivateDefault })))
      .catch(() => {});
  }, [sheet.open, placeId]);

  const toggle = async (list: Pickable) => {
    try {
      await api(`/api/lists/${list.id}/items/${placeId}`, { method: list.hasPlace ? "DELETE" : "POST", json: {} });
      setLists((current) => current?.map((item) => (item.id === list.id ? { ...item, hasPlace: !item.hasPlace } : item)) ?? null);
      toast(list.hasPlace ? `Removed from ${list.title}` : `Added to ${list.title}`);
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <>
      <button type="button" onClick={sheet.show} className={className}>
        <Icon icon={Add01Icon} size={18} />
        Add to a list
      </button>
      <Sheet open={sheet.open} onClose={sheet.hide} title={creating ? "New list" : `Add ${placeName}`}>
        {creating ? (
          <NewListForm placeId={placeId} moderator={me.moderator} privateDefault={me.privateDefault} />
        ) : lists === null ? (
          <p className="text-sm font-semibold text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-3">
            <ul className="grid">
              {lists.map((list) => (
                <li key={list.id}>
                  <button type="button" onClick={() => toggle(list)} aria-pressed={list.hasPlace} className="flex w-full items-center gap-3 border-b border-border/70 py-3 text-left">
                    <span className="grid flex-1">
                      <span className="text-[15px] font-extrabold">{list.title}</span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {list.items} {list.items === 1 ? "place" : "places"}
                      </span>
                    </span>
                    <span className={cn("flex size-7 items-center justify-center rounded-full border-2", list.hasPlace ? "border-foreground bg-foreground text-background" : "border-input")}>
                      {list.hasPlace && <Icon icon={Tick02Icon} size={14} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setCreating(true)} className={buttonClass("outline", "lg")}>
              <Icon icon={Add01Icon} size={18} />
              New list
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
