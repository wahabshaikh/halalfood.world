"use client";

import { useState } from "react";
import { Avatar, buttonClass } from "../../../src/components/kit";
import { api, errorText, toast } from "../../../src/components/kit-client";
import { SwitchRow } from "../../../src/components/people-client";

type Settings = { isPrivate: boolean; listsPrivateDefault: boolean; showOnLeaderboards: boolean };
type Person = { handle: string; name: string; avatarUrl: string | null };

export function PrivacyView({ initial, requests, blocked }: { initial: Settings; requests: Person[]; blocked: Person[] }) {
  const [settings, setSettings] = useState(initial);
  const [pending, setPending] = useState(requests);
  const [blocks, setBlocks] = useState(blocked);

  const set = async (patch: Partial<Settings>) => {
    const previous = settings;
    setSettings({ ...settings, ...patch });
    try {
      await api("/api/me", { method: "PUT", json: patch });
      if (patch.isPrivate === false && pending.length) setPending([]);
    } catch (error) {
      setSettings(previous);
      toast(errorText(error));
    }
  };

  const answer = async (person: Person, accept: boolean) => {
    try {
      await api(`/api/follow-requests/${encodeURIComponent(person.handle)}`, { method: accept ? "POST" : "DELETE" });
      setPending((current) => current.filter((item) => item.handle !== person.handle));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const unblock = async (person: Person) => {
    try {
      await api(`/api/blocks/${encodeURIComponent(person.handle)}`, { method: "DELETE" });
      setBlocks((current) => current.filter((item) => item.handle !== person.handle));
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <div className="grid gap-8 pt-2">
      <section className="grid divide-y divide-border/70">
        <SwitchRow
          label="Private account"
          hint="Only followers you approve see your checks and lists."
          checked={settings.isPrivate}
          onChange={(isPrivate) => set({ isPrivate })}
        />
        <SwitchRow
          label="Lists private by default"
          hint="New lists start visible only to you."
          checked={settings.listsPrivateDefault}
          onChange={(listsPrivateDefault) => set({ listsPrivateDefault })}
        />
        <SwitchRow
          label="Show me on leaderboards"
          hint="Your name and points on Community."
          checked={settings.showOnLeaderboards}
          onChange={(showOnLeaderboards) => set({ showOnLeaderboards })}
        />
      </section>

      <section className="grid gap-2">
        <h2 className="text-[17px] font-black">Follow requests</h2>
        {pending.length ? (
          <ul className="grid">
            {pending.map((person) => (
              <li key={person.handle} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
                <PersonLine person={person} />
                <button type="button" onClick={() => answer(person, true)} className={buttonClass("primary", "sm", "min-h-9 px-4")}>
                  Accept
                </button>
                <button type="button" onClick={() => answer(person, false)} className={buttonClass("outline", "sm", "min-h-9 px-4")}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm font-semibold text-muted-foreground">No requests.</p>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="text-[17px] font-black">Blocked</h2>
        {blocks.length ? (
          <ul className="grid">
            {blocks.map((person) => (
              <li key={person.handle} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
                <PersonLine person={person} />
                <button type="button" onClick={() => unblock(person)} className={buttonClass("outline", "sm", "min-h-9 px-4")}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm font-semibold text-muted-foreground">You haven’t blocked anyone.</p>
        )}
      </section>
    </div>
  );
}

function PersonLine({ person }: { person: Person }) {
  return (
    <a href={`/u/${person.handle}`} className="flex min-w-0 flex-1 items-center gap-3 text-foreground">
      <Avatar name={person.name} seed={person.handle} src={person.avatarUrl} size={40} />
      <span className="grid min-w-0">
        <strong className="truncate text-[15px] font-extrabold">{person.name}</strong>
        <span className="truncate text-[13px] font-semibold text-muted-foreground">@{person.handle}</span>
      </span>
    </a>
  );
}
