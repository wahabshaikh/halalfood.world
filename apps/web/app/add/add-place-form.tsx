"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Location01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import ShareButton from "../../src/components/share-button";
import { Illustration } from "../../src/components/art";
import { PageIntro } from "../../src/components/site-chrome";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { FieldDescription, FieldError } from "@halalfood/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@halalfood/ui/components/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@halalfood/ui/components/item";
import { Spinner } from "@halalfood/ui/components/spinner";

type AuthState = "checking" | "signed-in" | "signed-out";
type GooglePlace = { id: string; name: string; address: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function responseBody(response: Response) {
  try {
    return record(await response.json());
  } catch {
    return null;
  }
}

function errorFrom(body: Record<string, unknown> | null, fallback: string) {
  return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
}

const loginUrl = "/login?returnTo=%2Fadd";
const draftKey = "halalfood:add-place-draft";

/**
 * Places are added only by picking a Google Maps result. The name, address,
 * city and pin all come from Google on the server.
 */
export default function AddPlaceForm({
  initialQuery = "",
  area = null,
}: {
  initialQuery?: string;
  /** The visitor's approximate area, for a more specific placeholder. */
  area?: string | null;
} = {}) {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [query, setQuery] = useState(initialQuery);
  // Set when a signed-out search was interrupted by login, to finish it on return.
  const [resumeSearch, setResumeSearch] = useState(false);
  const [results, setResults] = useState<GooglePlace[]>([]);
  const [selected, setSelected] = useState<GooglePlace | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/get-session", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(responseBody)
      .then((body) => {
        if (active) setAuthState(typeof record(body?.user)?.id === "string" ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (active) setAuthState("signed-out");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      const draft = record(JSON.parse(sessionStorage.getItem(draftKey) || "null"));
      if (!draft) return;
      const saved = record(draft.selected);
      if (typeof saved?.id === "string" && typeof saved.name === "string" && typeof saved.address === "string")
        setSelected({ id: saved.id, name: saved.name, address: saved.address });
      if (typeof draft.query === "string") setQuery(draft.query);
      if (!saved && typeof draft.query === "string" && draft.query.trim().length >= 2)
        setResumeSearch(true);
    } catch {
      // A malformed or unavailable draft is ignored.
    }
  }, []);

  function saveDraft() {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ query, selected }));
    } catch {
      // The form still works without storage.
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore storage cleanup failures.
    }
  }

  async function search(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const term = query.trim();
    if (term.length < 2) {
      setSearchMessage("Type at least 2 letters.");
      return;
    }
    if (authState === "signed-out") {
      saveDraft();
      window.location.assign(loginUrl);
      return;
    }
    setSearchBusy(true);
    setSearchMessage("");
    try {
      const response = await fetch("/api/places/google-search?q=" + encodeURIComponent(term), {
        credentials: "include",
        cache: "no-store",
      });
      const body = await responseBody(response);
      if (response.status === 401) {
        setAuthState("signed-out");
        saveDraft();
        window.location.assign(loginUrl);
        return;
      }
      if (!response.ok) {
        setSearchMessage(errorFrom(body, "Google search didn’t work. Please try again."));
        return;
      }
      const places = (Array.isArray(body?.places) ? body.places : []).flatMap((value): GooglePlace[] => {
        const place = record(value);
        return typeof place?.id === "string" && typeof place.name === "string" && typeof place.address === "string"
          ? [{ id: place.id, name: place.name, address: place.address }]
          : [];
      });
      setResults(places);
      if (!places.length) setSearchMessage("Nothing on Google Maps matches that. Try the name and the area.");
    } catch {
      setSearchMessage("Google search didn’t work. Please try again.");
    } finally {
      setSearchBusy(false);
    }
  }

  // Back from logging in: pick up exactly where they left off.
  useEffect(() => {
    if (!resumeSearch || authState !== "signed-in") return;
    setResumeSearch(false);
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSearch, authState]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!selected) {
      setFormError("Pick the place from the Google results first.");
      return;
    }
    if (authState === "signed-out") {
      saveDraft();
      window.location.assign(loginUrl);
      return;
    }
    setSubmitBusy(true);
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        // Pressing "Add" is the confirmation; the button says so.
        body: JSON.stringify({ mode: "google", googlePlaceId: selected.id, halalConfirmed: true }),
      });
      const body = await responseBody(response);
      if (response.status === 401) {
        setAuthState("signed-out");
        saveDraft();
        window.location.assign(loginUrl);
        return;
      }
      if (!response.ok || typeof body?.id !== "string") {
        setFormError(errorFrom(body, "We couldn’t add that place. Please try again."));
        return;
      }
      clearDraft();
      setSuccess({ id: body.id, name: selected.name });
    } catch {
      setFormError("We couldn’t add that place. Please try again.");
    } finally {
      setSubmitBusy(false);
    }
  }

  if (success)
    return (
      <section aria-labelledby="add-success-title" className="mx-auto my-10 max-w-xl">
        <Card className="items-start gap-3.5 rounded-3xl px-9 py-9 shadow-lg ring-border">
          <Illustration name="visits" size={88} />
          <h1 id="add-success-title" className="text-[26px]">
            {success.name} is on the map
          </h1>
          <p className="text-muted-foreground">
            Thank you! Seen a certificate or the menu? Share it in a minute.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button asChild size="xl">
              <a href={`/place/${success.id}/check`}>Add a halal check</a>
            </Button>
            <Button asChild size="xl" variant="outline">
              <a href={`/place/${success.id}`}>See the place</a>
            </Button>
            <ShareButton
              url={`/place/${success.id}`}
              title={success.name}
              text={success.name + " is now on halalfood.world."}
            />
          </div>
        </Card>
      </section>
    );

  return (
    <section className="grid max-w-2xl gap-4" aria-labelledby="add-place-title">
      <PageIntro
        className="pb-2"
        titleId="add-place-title"
        title="Add a place"
        lead="Find it on Google Maps. We’ll fill in the rest."
      />

      {selected ? (
        <Item variant="outline" className="rounded-2xl p-4.5">
          <ItemMedia>
            <HugeiconsIcon icon={Location01Icon} size={24} aria-hidden="true" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="text-base font-extrabold">{selected.name}</ItemTitle>
            <ItemDescription>{selected.address}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="link"
              className="font-extrabold text-foreground underline"
              onClick={() => {
                setSelected(null);
                setFormError("");
              }}
            >
              Change
            </Button>
          </ItemActions>
        </Item>
      ) : (
        <Card className="gap-0 overflow-hidden rounded-2xl py-0 shadow-lg ring-border">
          <form className="p-2.5" role="search" onSubmit={(event) => void search(event)}>
            <InputGroup className="h-12 border-0 shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0">
              <InputGroupAddon>
                <HugeiconsIcon icon={Search01Icon} size={20} aria-hidden="true" />
              </InputGroupAddon>
              <label className="sr-only" htmlFor="google-place-search">
                Search Google Maps
              </label>
              <InputGroupInput
                id="google-place-search"
                type="search"
                maxLength={120}
                placeholder={area ? `Restaurant, ${area}` : "Restaurant name and area"}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="text-base"
              />
              <InputGroupAddon align="inline-end">
                <Button
                  size="lg"
                  type="submit"
                  disabled={searchBusy || authState === "checking"}
                >
                  {searchBusy && <Spinner />}
                  {searchBusy ? "Searching…" : "Search"}
                </Button>
              </InputGroupAddon>
            </InputGroup>
          </form>
          {results.length > 0 && (
            <ItemGroup
              className="gap-0 border-t"
              role="list"
              aria-label="Google Maps results"
            >
              {results.map((place) => (
                <Item
                  asChild
                  key={place.id}
                  className="rounded-none border-0 border-b px-4 py-3 last:border-b-0 hover:bg-muted"
                >
                  <button
                    type="button"
                    role="listitem"
                    onClick={() => {
                      setSelected(place);
                      setResults([]);
                      setSearchMessage("");
                    }}
                  >
                    <ItemMedia>
                      <HugeiconsIcon icon={Location01Icon} size={20} aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent className="text-left">
                      <ItemTitle className="font-bold">{place.name}</ItemTitle>
                      <ItemDescription>{place.address}</ItemDescription>
                    </ItemContent>
                  </button>
                </Item>
              ))}
            </ItemGroup>
          )}
          <div className="border-t bg-secondary px-4 py-2 text-xs text-muted-foreground">
            Results from Google
          </div>
        </Card>
      )}
      {searchMessage && <FieldDescription role="status">{searchMessage}</FieldDescription>}

      {selected && (
        <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
          {formError && <FieldError>{formError}</FieldError>}
          <Button size="xl" type="submit" disabled={submitBusy}>
            {submitBusy && <Spinner />}
            {submitBusy ? "Adding…" : `Add ${selected.name}`}
          </Button>
          <FieldDescription>By adding it, you’re telling us it serves halal food.</FieldDescription>
        </form>
      )}
      {!selected && (
        <FieldDescription>
          {authState === "signed-out"
            ? "You’ll confirm your email with a quick code, then we’ll run your search."
            : "Only places on Google Maps can be added, so the details stay accurate."}
        </FieldDescription>
      )}
    </section>
  );
}
