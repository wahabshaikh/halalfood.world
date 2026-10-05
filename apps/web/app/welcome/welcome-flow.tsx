"use client";

import { useEffect, useState } from "react";
import { Copy01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import type { Filter } from "@halalfood/core/halal";
import { cn } from "@halalfood/ui/lib/utils";
import { Avatar, FormCard, Icon, buttonClass } from "../../src/components/kit";
import { api, errorText, toast } from "../../src/components/kit-client";
import { AvatarPicker, FilterChecklist, FollowButton, HandleField, TextField, type HandleCheck } from "../../src/components/people-client";

type Initial = { displayName: string; handle: string; avatarUrl: string | null; filters: Filter[] };
type Person = { handle: string; name: string; avatarUrl: string | null; followers?: number };

export function WelcomeFlow({
  returnTo,
  seed,
  initial,
  city,
}: {
  returnTo: string;
  seed: string;
  initial: Initial;
  city: { slug: string; name: string } | null;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [name, setName] = useState(initial.displayName);
  const [handle, setHandle] = useState(initial.handle);
  const [savedHandle, setSavedHandle] = useState(initial.handle);
  const [handleCheck, setHandleCheck] = useState<HandleCheck>({ state: "idle", message: null });
  const [filters, setFilters] = useState<Filter[]>(initial.filters);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const saveProfile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ profile: { handle: string } }>("/api/me", {
        method: "PUT",
        json: { displayName: name, handle, ...(city ? { homeCitySlug: city.slug } : {}) },
      });
      setSavedHandle(result.profile.handle);
      await api("/api/me/onboarding", { method: "POST", json: { step: "profile" } });
      setStep(1);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const saveFilters = async (skip: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!skip) await api("/api/me", { method: "PUT", json: { defaultFilters: filters } });
      await api("/api/me/onboarding", { method: "POST", json: { step: "filters" } });
      setStep(2);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/me/onboarding", { method: "POST", json: { step: "done" } });
      window.location.assign(returnTo);
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };

  const profileReady = name.trim().length > 0 && handle.trim().length >= 3 && handleCheck.state !== "bad" && handleCheck.state !== "checking";

  return (
    <FormCard fill className="max-md:pb-4">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-3 gap-1.5" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={cn("h-1.5 rounded-full", index <= step ? "bg-foreground" : "bg-secondary")} />
          ))}
        </div>
        <a href="/" className="text-sm font-extrabold text-muted-foreground">
          Later
        </a>
      </div>

      {step === 0 && (
        <section className="mt-8 flex flex-1 flex-col gap-5">
          <div className="grid gap-1.5">
            <h1 className="text-[28px] leading-tight font-black tracking-tight">Make it yours</h1>
            <p className="text-[15px] font-semibold text-subtle-foreground">Friends find you by name or handle.</p>
          </div>
          <AvatarPicker name={name} seed={seed} initial={initial.avatarUrl} />
          <TextField label="Name" value={name} onChange={setName} maxLength={60} placeholder="Your name" />
          <HandleField value={handle} onChange={setHandle} original={initial.handle} onCheck={setHandleCheck} />
          <button type="button" onClick={saveProfile} disabled={!profileReady || busy} className={buttonClass("primary", "lg", "mt-auto")}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="mt-8 flex flex-1 flex-col gap-5">
          <div className="grid gap-1.5">
            <h1 className="text-[28px] leading-tight font-black tracking-tight">What matters to you?</h1>
            <p className="text-[15px] font-semibold text-subtle-foreground">We’ll filter Explore for you. Change it any time.</p>
          </div>
          <FilterChecklist value={filters} onChange={setFilters} />
          <div className="mt-auto grid gap-2.5">
            <button type="button" onClick={() => saveFilters(false)} disabled={busy} className={buttonClass("primary", "lg")}>
              Continue
            </button>
            <button type="button" onClick={() => saveFilters(true)} disabled={busy} className={buttonClass("ghost", "lg")}>
              Skip
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <FollowStep
          city={city}
          handle={savedHandle}
          following={following}
          onFollow={(who, on) =>
            setFollowing((current) => {
              const next = new Set(current);
              if (on) next.add(who);
              else next.delete(who);
              return next;
            })
          }
          onDone={finish}
          busy={busy}
        />
      )}
    </FormCard>
  );
}

function FollowStep({
  city,
  handle,
  following,
  onFollow,
  onDone,
  busy,
}: {
  city: { slug: string; name: string } | null;
  handle: string;
  following: Set<string>;
  onFollow: (handle: string, on: boolean) => void;
  onDone: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [suggested, setSuggested] = useState<Person[] | null>(null);
  const [results, setResults] = useState<Person[] | null>(null);

  useEffect(() => {
    api<{ people: Person[] }>(`/api/people/suggested${city ? `?city=${city.slug}` : ""}`)
      .then((body) => setSuggested(body.people))
      .catch(() => setSuggested([]));
  }, [city]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const body = await api<{ people?: Person[] }>(`/api/search?q=${encodeURIComponent(q)}&scope=people`);
        setResults(body.people ?? []);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/invite/${handle}`);
      toast("Invite link copied");
    } catch {
      toast("Couldn’t copy the link");
    }
  };

  const people = results ?? suggested ?? [];
  return (
    <section className="mt-8 flex flex-1 flex-col gap-5">
      <div className="grid gap-1.5">
        <h1 className="text-[28px] leading-tight font-black tracking-tight">Follow a few people</h1>
        <p className="text-[15px] font-semibold text-subtle-foreground">See where they eat and what they love.</p>
      </div>
      <label className="flex h-[50px] items-center gap-2.5 rounded-full bg-secondary px-[18px]">
        <Icon icon={Search01Icon} />
        <span className="sr-only">Search people</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or @handle"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-muted-foreground"
        />
      </label>
      {!results && suggested && suggested.length > 0 && (
        <h2 className="text-[17px] font-black">{city ? `Popular in ${city.name}` : "Popular"}</h2>
      )}
      <ul className="grid">
        {people.map((person) => (
          <li key={person.handle} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
            <Avatar name={person.name} seed={person.handle} src={person.avatarUrl} size={44} />
            <span className="grid min-w-0 flex-1">
              <strong className="truncate text-[15px] font-extrabold">{person.name}</strong>
              <span className="truncate text-[13px] font-semibold text-muted-foreground">@{person.handle}</span>
            </span>
            <FollowButton
              handle={person.handle}
              initial={following.has(person.handle) ? "following" : "none"}
              size="sm"
              onChange={(state) => onFollow(person.handle, state !== "none")}
            />
          </li>
        ))}
      </ul>
      {results && results.length === 0 && <p className="text-sm font-semibold text-muted-foreground">No one by that name yet.</p>}
      {!results && suggested?.length === 0 && (
        <p className="text-sm font-semibold text-muted-foreground">Invite friends and see where they eat.</p>
      )}
      <button type="button" onClick={copyInvite} className={buttonClass("outline", "md")}>
        <Icon icon={Copy01Icon} size={18} />
        Copy your invite link
      </button>
      <button type="button" onClick={onDone} disabled={busy} className={buttonClass("primary", "lg", "mt-auto")}>
        {following.size ? `Done · following ${following.size}` : "Skip for now"}
      </button>
    </section>
  );
}
