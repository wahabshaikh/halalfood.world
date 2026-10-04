"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Textarea } from "@halalfood/ui/components/textarea";
import { Input } from "@halalfood/ui/components/input";
import { Field, FieldDescription, FieldLabel } from "@halalfood/ui/components/field";
import {
  cleanRecNote,
  MAX_REC_NOTE_LENGTH,
  MAX_REC_RECIPIENTS,
  recShareUrl,
  whatsappShareUrl,
} from "@halalfood/core/recs";
import { InitialsAvatar, Loading, monogram } from "../../src/components/blocks";
import { CheckboxField } from "../../src/components/form-fields";
import { EmptyPanel } from "../../src/components/site-chrome";
import { FormMessage, Note } from "../../src/components/section";
import { goToLogin } from "../../src/components/visit-card";
import { presentHttpFailure, presentTransportFailure, type PresentedFailure } from "../../src/lib/failure-copy";
import { cityName } from "../../src/lib/seo";
import type { RecipientChoice, SendOutcome } from "../../src/lib/recs-repository";

type Target = { kind: "place" | "list"; id: string; name: string; detail: string };
type PlaceResult = { id: string; name: string; city_slug: string; street_address: string };

/** Search for a place to send when the page was opened without one. */
function PlaceSearch({ onPick }: { onPick: (target: Target) => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/places/search?q=${encodeURIComponent(query)}&limit=8`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const body = (await response.json()) as { places?: PlaceResult[] };
          setResults(Array.isArray(body.places) ? body.places : []);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return (
    <div className="grid gap-3">
      <Input
        type="search"
        aria-label="Search for a place to send"
        placeholder="Search by restaurant or area"
        autoComplete="off"
        maxLength={120}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      {results.length > 0 && (
        <ul className="divide-y rounded-2xl border">
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className="grid w-full gap-0.5 px-4 py-3.5 text-left hover:bg-secondary"
                onClick={() =>
                  onPick({ kind: "place", id: place.id, name: place.name, detail: place.city_slug })
                }
              >
                <span className="font-bold">{place.name}</span>
                <span className="text-sm text-muted-foreground">
                  {place.street_address ? `${place.street_address} · ` : ""}
                  {cityName(place.city_slug)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const OUTCOME_COPY: Record<SendOutcome["status"], string> = {
  sent: "Sent",
  "already-sent": "You already sent this to them",
  "not-a-friend": "Couldn’t send. You need to follow each other first",
};

export default function SendView({
  target: initial,
  unavailable,
  to,
}: {
  target: Target | null;
  unavailable: boolean;
  to: string | null;
}) {
  const [target, setTarget] = useState<Target | null>(initial);
  const [people, setPeople] = useState<RecipientChoice[] | null>(null);
  const [friendsState, setFriendsState] = useState<"loading" | "ready" | "error">("loading");
  const [signedOut, setSignedOut] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(to ? [to] : []));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PresentedFailure | null>(null);
  const [outcomes, setOutcomes] = useState<SendOutcome[] | null>(null);
  const [copied, setCopied] = useState(false);

  function loadFriends(signal?: AbortSignal) {
    setFriendsState("loading");
    setError(null);
    fetch("/api/recs/recipients", { signal, cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          setSignedOut(true);
          setFriendsState("ready");
          setPeople([]);
          return;
        }
        if (!response.ok) throw new Error();
        const body = (await response.json()) as { people?: RecipientChoice[] };
        setPeople(Array.isArray(body.people) ? body.people : []);
        setFriendsState("ready");
      })
      .catch((caught) => {
        if ((caught as Error).name === "AbortError") return;
        setPeople([]);
        setFriendsState("error");
        setError({ message: "Could not load your friends.", retry: false });
      });
  }

  useEffect(() => {
    const controller = new AbortController();
    loadFriends(controller.signal);
    return () => controller.abort();
  }, []);

  const shareUrl = useMemo(
    () =>
      target
        ? recShareUrl({ kind: target.kind, id: target.id }, typeof window === "undefined" ? undefined : window.location.origin)
        : "",
    [target],
  );

  function toggle(handle: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(handle);
      else next.delete(handle);
      return next;
    });
  }

  const noteCheck = cleanRecNote(note);

  async function send() {
    if (!target || !chosen.size) return;
    if (!noteCheck.ok) {
      setError({ message: noteCheck.error, retry: false });
      return;
    }
    if (chosen.size > MAX_REC_RECIPIENTS) {
      setError({
        message: `Send to at most ${MAX_REC_RECIPIENTS} friends at a time.`,
        retry: false,
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/recs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [target.kind === "place" ? "placeId" : "listId"]: target.id,
          recipients: [...chosen],
          note: noteCheck.ok ? noteCheck.note ?? undefined : undefined,
        }),
      });
      if (response.status === 401) return goToLogin("send");
      const body = (await response.json().catch(() => ({}))) as { outcomes?: SendOutcome[]; error?: string };
      if (!response.ok) {
        // The note and the people you picked stay on the form.
        setError(presentHttpFailure("this rec", response.status, body.error));
        return;
      }
      setOutcomes(body.outcomes ?? []);
    } catch (caught) {
      setError(presentTransportFailure("this rec", caught));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError({ message: "Copy is blocked here. Select the link instead.", retry: false });
    }
  }

  if (signedOut)
    return (
      <EmptyPanel art="visits" title="Sign in to send recs" description="Recs go to people you follow or who follow you.">
        <Button size="xl" onClick={() => goToLogin("send")}>
          Log in or sign up
        </Button>
      </EmptyPanel>
    );

  if (unavailable)
    return (
      <EmptyPanel
        art="visits"
        titleAs="h2"
        title="That can’t be sent"
        description="The place or list is missing, or it is private. Only public lists can be sent."
      >
        <Button asChild size="xl" variant="outline">
          <a href="/send">Pick something else</a>
        </Button>
      </EmptyPanel>
    );

  if (outcomes) {
    const sent = outcomes.filter((outcome) => outcome.status === "sent").length;
    return (
      <div className="grid gap-4">
        <FormMessage tone={sent ? "success" : "error"}>
          {sent
            ? `Sent to ${sent} ${sent === 1 ? "friend" : "friends"}.`
            : "Nothing was sent."}
        </FormMessage>
        <ul className="grid gap-1 text-sm">
          {outcomes.map((outcome) => (
            <li key={outcome.handle}>
              <strong>@{outcome.handle}</strong>: {OUTCOME_COPY[outcome.status]}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg">
            <a href="/recs?box=sent">See sent recs</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={target?.kind === "list" ? `/list/${target.id}` : `/place/${target?.id}`}>Back</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {target ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl bg-secondary p-4">
          <div>
            <p className="text-[13px] font-bold text-muted-foreground">
              {target.kind === "list" ? "List" : "Place"}
            </p>
            <strong>{target.name}</strong>
            <p className="text-[13px] text-muted-foreground">
              {target.kind === "place" ? cityName(target.detail) : target.detail}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="font-bold">What are you sending?</p>
          <PlaceSearch onPick={setTarget} />
          <Note>To send a list, open it and choose Send.</Note>
        </div>
      )}

      {target && (
        <>
          <fieldset className="grid gap-3">
            <legend className="mb-1 font-bold">
              Send to <span className="text-[13px] font-normal text-muted-foreground">(up to {MAX_REC_RECIPIENTS})</span>
            </legend>
            {friendsState === "loading" && <Loading>Finding your friends…</Loading>}
            {friendsState === "error" && (
              <Note>
                Friend lookup failed.{" "}
                <button type="button" className="underline" onClick={() => loadFriends()}>
                  Try again
                </button>
                , or copy the link and send it on WhatsApp.
              </Note>
            )}
            {friendsState === "ready" && people?.length === 0 && (
              <Note>
                You can send to people you follow and people who follow you.{" "}
                <a className="underline" href="/leaderboard">Find people to follow</a>.
                Copy the link if they are not here yet.
              </Note>
            )}
            {chosen.size >= MAX_REC_RECIPIENTS && (
              <Note>That’s the limit of {MAX_REC_RECIPIENTS} people for one rec.</Note>
            )}
            {people?.map((person) => {
              const name = person.displayName ?? `@${person.handle}`;
              return (
                <div key={person.handle} className="flex items-center gap-3">
                  <InitialsAvatar initials={monogram(name)} size={36} />
                  <CheckboxField
                    id={`send-${person.handle}`}
                    checked={chosen.has(person.handle)}
                    disabled={!chosen.has(person.handle) && chosen.size >= MAX_REC_RECIPIENTS}
                    onCheckedChange={(on) => toggle(person.handle, on)}
                  >
                    {name} <span className="text-muted-foreground">@{person.handle}</span>
                  </CheckboxField>
                </div>
              );
            })}
          </fieldset>

          <Field>
            <FieldLabel htmlFor="rec-note">Add a note</FieldLabel>
            <Textarea
              id="rec-note"
              rows={2}
              maxLength={MAX_REC_NOTE_LENGTH}
              placeholder="Friday after Jumuah? The seekh is unreal"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <FieldDescription>
              One short line, {note.length}/{MAX_REC_NOTE_LENGTH}. Friends can answer &ldquo;I&rsquo;m in&rdquo; or &ldquo;Want to try&rdquo;.
            </FieldDescription>
            {!noteCheck.ok && <FormMessage tone="error">{noteCheck.error}</FormMessage>}
          </Field>

          {error && (
            <FormMessage tone="error">
              {error.message}
              {error.retry && (
                <Button variant="link" disabled={busy} onClick={() => void send()}>
                  Try again
                </Button>
              )}
            </FormMessage>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="xl" disabled={busy || !chosen.size} onClick={() => void send()}>
              {busy ? "Sending…" : chosen.size ? `Send to ${chosen.size}` : "Pick a friend"}
            </Button>
          </div>

          <div className="grid gap-2 border-t pt-4">
            <p className="text-sm font-bold">Or share the link</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a
                  href={whatsappShareUrl(target.name, shareUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
              </Button>
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <Note>The link opens the public {target.kind} page, so anyone you send it to can see it.</Note>
          </div>
        </>
      )}
    </div>
  );
}
