"use client";

import { useEffect, useState } from "react";
import { Copy01Icon, Search01Icon, SentIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { MAX_REC_NOTE_LENGTH, MAX_REC_RECIPIENTS } from "@halalfood/core/recs";
import { cn } from "@halalfood/ui/lib/utils";
import { Avatar, Icon, buttonClass } from "./kit";
import { Sheet, api, errorText, toast, useSheet } from "./kit-client";

export type SendTarget = { kind: "place" | "list" | "event"; id: string; name: string };
type Person = { handle: string; name: string; avatarUrl: string | null };

/**
 * "Send {target}" (spec §6.19). With no target (a profile's Send a rec), the
 * sheet first asks which place. In invite mode it invites people to a plan list.
 */
export function SendSheetButton({
  target,
  to,
  mode = "send",
  className,
  label = "Send",
  icon = true,
  ariaLabel,
}: {
  target: SendTarget | null;
  to?: string;
  mode?: "send" | "invite";
  className?: string;
  label?: string;
  icon?: boolean;
  ariaLabel?: string;
}) {
  const sheet = useSheet(mode === "invite" ? "invite" : "send");
  return (
    <>
      <button type="button" onClick={sheet.show} className={className} aria-label={ariaLabel}>
        {icon && <Icon icon={SentIcon} size={18} />}
        {label}
      </button>
      {sheet.open && <SendBody target={target} to={to} mode={mode} open={sheet.open} onClose={sheet.hide} />}
    </>
  );
}

function SendBody({
  target: initialTarget,
  to,
  mode,
  open,
  onClose,
}: {
  target: SendTarget | null;
  to?: string;
  mode: "send" | "invite";
  open: boolean;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<SendTarget | null>(initialTarget);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(to ? [to] : []));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ people: Person[] }>("/api/recs/recipients")
      .then((body) => setPeople(body.people))
      .catch(() => setPeople([]));
  }, []);

  const toggle = (handle: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(handle)) next.delete(handle);
      else if (next.size < MAX_REC_RECIPIENTS) next.add(handle);
      else toast(`Pick up to ${MAX_REC_RECIPIENTS} people.`);
      return next;
    });

  const copy = async () => {
    if (!target) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${target.kind}/${target.id}`);
      toast("Link copied");
    } catch {
      toast("Couldn’t copy the link");
    }
  };

  const send = async () => {
    if (!target || !picked.size || busy) return;
    setBusy(true);
    try {
      if (mode === "invite") {
        await api(`/api/lists/${target.id}/members`, { method: "POST", json: { handles: [...picked] } });
        toast(`Invited ${picked.size}`);
      } else {
        const result = await api<{ sent: number }>("/api/recs", {
          method: "POST",
          json: { to: [...picked], [`${target.kind}Id`]: target.id, note: note.trim() || undefined },
        });
        toast(`Sent to ${result.sent}`);
      }
      onClose();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const title = !target ? "Send a place" : mode === "invite" ? `Invite to ${target.name}` : `Send ${target.name}`;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {!target ? (
        <PlacePicker onPick={setTarget} />
      ) : (
        <div className="grid gap-4">
          {people === null ? (
            <p className="text-sm font-semibold text-muted-foreground">Loading…</p>
          ) : people.length === 0 ? (
            <p className="text-sm font-semibold text-muted-foreground">Follow people to send them places. You can still copy the link.</p>
          ) : (
            <ul className="grid grid-cols-4 gap-3">
              {people.map((person) => {
                const on = picked.has(person.handle);
                return (
                  <li key={person.handle}>
                    <button type="button" aria-pressed={on} onClick={() => toggle(person.handle)} className="grid w-full justify-items-center gap-1.5">
                      <span className="relative">
                        <Avatar name={person.name} seed={person.handle} src={person.avatarUrl} size={56} className={cn(on && "outline-3 outline-offset-2 outline-primary")} />
                        {on && (
                          <span className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                            <Icon icon={Tick02Icon} size={14} strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      <span className="w-full truncate text-center text-xs font-extrabold">{person.name.split(" ")[0]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {mode === "send" && (
            <label className="grid gap-1.5">
              <span className="flex justify-between text-sm font-extrabold">
                Add a note
                <span className="font-semibold text-muted-foreground">
                  {note.length}/{MAX_REC_NOTE_LENGTH}
                </span>
              </span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, MAX_REC_NOTE_LENGTH))}
                placeholder="Get the mixed grill"
                className="h-[50px] rounded-[14px] border border-input px-3.5 text-[15px] font-semibold outline-none focus:border-foreground"
              />
            </label>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            {mode === "send" && (
              <button type="button" onClick={copy} className={buttonClass("outline", "lg", "px-4")} aria-label="Copy link">
                <Icon icon={Copy01Icon} />
              </button>
            )}
            <button type="button" onClick={send} disabled={!picked.size || busy} className={buttonClass("primary", "lg", mode === "invite" ? "col-span-2" : "")}>
              {busy ? "Sending…" : mode === "invite" ? `Invite ${picked.size || ""}`.trim() : picked.size ? `Send to ${picked.size}` : "Pick people"}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function PlacePicker({ onPick }: { onPick: (target: SendTarget) => void }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<{ id: string; name: string; area: string }[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setPlaces([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const body = await api<{ places: { id: string; name: string; area: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`);
        setPlaces(body.places);
      } catch {
        setPlaces([]);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  return (
    <div className="grid gap-3">
      <label className="flex h-[50px] items-center gap-2.5 rounded-full bg-secondary px-[18px]">
        <Icon icon={Search01Icon} />
        <span className="sr-only">Search places</span>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Which place?"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
        />
      </label>
      <ul className="grid">
        {places.map((place) => (
          <li key={place.id}>
            <button type="button" onClick={() => onPick({ kind: "place", id: place.id, name: place.name })} className="grid w-full gap-0.5 border-b border-border/70 py-3 text-left">
              <strong className="text-[15px] font-extrabold">{place.name}</strong>
              <span className="text-[13px] font-semibold text-muted-foreground">{place.area}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
