"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Location01Icon, Search01Icon } from "@hugeicons/core-free-icons";
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
import { GOOGLE_PLACE_QUERY_MIN_LENGTH } from "@halalfood/core/place-submission";
import { getClientSession } from "../../src/lib/client-session";
import { presentHttpFailure, presentTransportFailure } from "../../src/lib/failure-copy";
import { currentReturnPath, signedOutLoginPath, loginHref } from "../../src/lib/signed-out";
import { matchListedPlace } from "../../src/lib/place-match";

type AuthState = "checking" | "signed-in" | "signed-out";
/** A Google result we already have, from the search route or the listed matches. */
type ExistingMatch =
  | { status: "listed"; name: string; url: string }
  | { status: "pending" | "known"; name: string; url?: undefined };
type GooglePlace = { id: string; name: string; address: string; existing?: ExistingMatch | null };
type ListedPlace = { id: string; name: string; address: string };
type LinkDraft = { name: string; city: string; address: string; sourceUrl: string };

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

function errorFrom(body: Record<string, unknown> | null, status: number, fallback: string) {
  const server = typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
  return presentHttpFailure("this place", status, server).message;
}

function listedFrom(value: unknown, addressKey = "address"): ListedPlace[] {
  return (Array.isArray(value) ? value : []).flatMap((entry): ListedPlace[] => {
    const place = record(entry);
    return typeof place?.id === "string" && typeof place.name === "string"
      ? [
          {
            id: place.id,
            name: place.name,
            address: typeof place[addressKey] === "string" ? place[addressKey] : "",
          },
        ]
      : [];
  });
}

function existingFrom(value: unknown): ExistingMatch | null {
  const existing = record(value);
  if (!existing || typeof existing.name !== "string") return null;
  if (existing.status === "listed" && typeof existing.url === "string" && existing.url.startsWith("/place/"))
    return { status: "listed", name: existing.name, url: existing.url };
  if (existing.status === "pending" || existing.status === "known")
    return { status: existing.status, name: existing.name };
  return null;
}

/** The 409 from POST /api/places, as the same shape. */
function duplicateFrom(body: Record<string, unknown> | null, fallbackName: string): ExistingMatch {
  const url = typeof body?.url === "string" && body.url.startsWith("/place/") ? body.url : null;
  if (url) return { status: "listed", name: fallbackName, url };
  return { status: body?.code === "already_pending" ? "pending" : "known", name: fallbackName };
}

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
  const [listed, setListed] = useState<ListedPlace[]>([]);
  const [providerDown, setProviderDown] = useState(false);
  const [linkDraft, setLinkDraft] = useState<LinkDraft>({
    name: "",
    city: "",
    address: "",
    sourceUrl: "",
  });
  const [linkReceipt, setLinkReceipt] = useState<{ id: string; status: string; name: string } | null>(null);
  const [duplicateUrl, setDuplicateUrl] = useState("");
  const [selected, setSelected] = useState<GooglePlace | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // A picked result we already have: Add is off and the listed place is linked.
  const selectedExisting: ExistingMatch | null = selected
    ? (selected.existing ??
      (() => {
        const match = matchListedPlace(selected, listed);
        return match ? { status: "listed" as const, name: match.name, url: `/place/${match.id}` } : null;
      })())
    : null;

  useEffect(() => {
    let active = true;
    getClientSession()
      .then((user) => {
        if (active) setAuthState(user ? "signed-in" : "signed-out");
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
        setSelected({
          id: saved.id,
          name: saved.name,
          address: saved.address,
          existing: existingFrom(saved.existing),
        });
      if (typeof draft.query === "string") setQuery(draft.query);
      const link = record(draft.link);
      if (
        link &&
        typeof link.name === "string" &&
        typeof link.city === "string" &&
        typeof link.address === "string" &&
        typeof link.sourceUrl === "string"
      ) {
        setLinkDraft({
          name: link.name,
          city: link.city,
          address: link.address,
          sourceUrl: link.sourceUrl,
        });
        if (draft.providerDown === true) setProviderDown(true);
      }
      if (
        !saved &&
        typeof draft.query === "string" &&
        draft.query.trim().length >= GOOGLE_PLACE_QUERY_MIN_LENGTH
      )
        setResumeSearch(true);
    } catch {
      // A malformed or unavailable draft is ignored.
    }
  }, []);

  function saveDraft() {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ query, selected, providerDown, link: linkDraft }),
      );
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
    if (term.length < GOOGLE_PLACE_QUERY_MIN_LENGTH) {
      setSearchMessage("Type at least 3 letters.");
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
        saveDraft();
        window.location.assign(signedOutLoginPath(currentReturnPath()));
        return;
      }
      const embedded = listedFrom(body?.local);
      let already = embedded;
      if (embedded.length) {
        setListed(embedded);
      } else {
        const localResponse = await fetch(
          "/api/places/search?q=" + encodeURIComponent(term) + "&limit=5",
          { cache: "no-store" },
        );
        const localBody = await responseBody(localResponse);
        already = listedFrom(localBody?.places, "street_address");
        setListed(already);
      }
      if (response.status === 429) {
        setSearchMessage(
          presentHttpFailure(
            "Google search",
            429,
            typeof body?.error === "string" ? body.error : null,
          ).message,
        );
        return;
      }
      if (response.status === 400) {
        setSearchMessage(errorFrom(body, response.status, "Type at least 3 letters."));
        return;
      }
      if (!response.ok || body?.fallback === "link") {
        setProviderDown(true);
        setLinkDraft((current) => ({ ...current, name: current.name || term }));
        setSearchMessage(
          errorFrom(
            body,
            response.status,
            "Google search didn’t work. Add the place with a link instead. A moderator reviews it before it is listed.",
          ),
        );
        return;
      }
      const places = (Array.isArray(body?.places) ? body.places : []).flatMap((value): GooglePlace[] => {
        const place = record(value);
        return typeof place?.id === "string" && typeof place.name === "string" && typeof place.address === "string"
          ? [{ id: place.id, name: place.name, address: place.address, existing: existingFrom(place.existing) }]
          : [];
      });
      setProviderDown(false);
      setResults(places);
      if (!places.length)
        setSearchMessage(
          already.length
            ? "Nothing else on Google Maps matches that."
            : "Nothing on Google Maps matches that. Try the name and the area, or add it with a link.",
        );
      if (!places.length) setProviderDown(true);
    } catch (caught) {
      setProviderDown(true);
      setLinkDraft((current) => ({ ...current, name: current.name || term }));
      setSearchMessage(presentTransportFailure("this place", caught).message);
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
    if (selectedExisting) return;
    if (authState === "signed-out") {
      saveDraft();
      window.location.assign(loginHref(currentReturnPath()));
      return;
    }
    setSubmitBusy(true);
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        // Pressing "Add" is the confirmation; the button says so.
        body: JSON.stringify({
          mode: "google",
          googlePlaceId: selected.id,
          name: selected.name,
          address: selected.address,
          halalConfirmed: true,
        }),
      });
      const body = await responseBody(response);
      if (response.status === 401) {
        setAuthState("signed-out");
        saveDraft();
        window.location.assign(signedOutLoginPath(currentReturnPath()));
        return;
      }
      if (response.status === 409) {
        // The server refused a duplicate: mark the pick so Add stays off.
        const existing = duplicateFrom(body, selected.name);
        setSelected({ ...selected, existing });
        if (existing.url) setDuplicateUrl(existing.url);
        setFormError(errorFrom(body, response.status, "That place is already listed."));
        return;
      }
      if (!response.ok || typeof body?.id !== "string") {
        setFormError(errorFrom(body, response.status, "We couldn’t add that place. Please try again."));
        return;
      }
      clearDraft();
      setLinkReceipt({
        id: body.id,
        status: typeof body.status === "string" ? body.status : "pending",
        name: selected.name,
      });
    } catch (caught) {
      setFormError(presentTransportFailure("this place", caught).message);
    } finally {
      setSubmitBusy(false);
    }
  }

  async function submitLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setDuplicateUrl("");
    if (authState === "signed-out") {
      saveDraft();
      window.location.assign(loginHref(currentReturnPath()));
      return;
    }
    setSubmitBusy(true);
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          mode: "link",
          name: linkDraft.name,
          city: linkDraft.city,
          address: linkDraft.address,
          sourceUrl: linkDraft.sourceUrl,
          halalConfirmed: true,
        }),
      });
      const body = await responseBody(response);
      if (response.status === 401) {
        setAuthState("signed-out");
        saveDraft();
        window.location.assign(signedOutLoginPath(currentReturnPath()));
        return;
      }
      if (response.status === 409) {
        if (typeof body?.url === "string" && body.url.startsWith("/place/")) setDuplicateUrl(body.url);
        setFormError(errorFrom(body, response.status, "That place is already listed."));
        return;
      }
      if (!response.ok || typeof body?.id !== "string") {
        setFormError(errorFrom(body, response.status, "We couldn’t file that place. Please try again."));
        return;
      }
      clearDraft();
      setLinkReceipt({
        id: body.id,
        status: typeof body.status === "string" ? body.status : "pending",
        name: linkDraft.name,
      });
    } catch (caught) {
      setFormError(presentTransportFailure("this place", caught).message);
    } finally {
      setSubmitBusy(false);
    }
  }

  if (linkReceipt)
    return (
      <section aria-labelledby="add-link-title" className="mx-auto my-10 max-w-xl">
        <Card className="items-start gap-3.5 rounded-3xl px-9 py-9 shadow-lg ring-border">
          <h1 id="add-link-title" className="text-[26px]">
            Filed for review
          </h1>
          <p className="text-muted-foreground">
            {linkReceipt.name ? `${linkReceipt.name} is filed. ` : ""}
            Status: {linkReceipt.status}. Reference {linkReceipt.id}. A moderator reviews it
            before the place is listed. This is not a halal certification, and it is not on
            the map yet.
          </p>
          <Button asChild size="xl" variant="outline">
            <a href="/contributions">History is optional</a>
          </Button>
        </Card>
      </section>
    );

  return (
    <section className="grid max-w-2xl gap-4" aria-labelledby="add-place-title">
      <PageIntro
        className="pb-2"
        titleId="add-place-title"
        title="Help us map every halal spot"
        lead="Search and pick a place now. Sign in only when you add it. A person reviews it before it is listed."
      />

      {selected ? (
        <Item variant="outline" className="min-w-0 flex-nowrap items-start rounded-2xl p-4.5">
          <ItemMedia>
            <HugeiconsIcon icon={Location01Icon} size={24} aria-hidden="true" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="text-base font-extrabold break-words [overflow-wrap:anywhere]">
              {selected.name}
            </ItemTitle>
            <ItemDescription className="break-words [overflow-wrap:anywhere]">{selected.address}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="link"
              className="font-extrabold text-foreground underline"
              onClick={() => {
                setSelected(null);
                setFormError("");
                setDuplicateUrl("");
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
                  disabled={searchBusy}
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
                      setDuplicateUrl("");
                      setFormError("");
                      setResults([]);
                      setSearchMessage("");
                    }}
                  >
                    <ItemMedia>
                      <HugeiconsIcon icon={Location01Icon} size={20} aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent className="min-w-0 text-left">
                      <ItemTitle className="font-bold break-words [overflow-wrap:anywhere]">{place.name}</ItemTitle>
                      <ItemDescription className="break-words [overflow-wrap:anywhere]">{place.address}</ItemDescription>
                      {place.existing && (
                        <span className="text-xs font-bold text-muted-foreground">
                          {place.existing.status === "listed"
                            ? "Already listed"
                            : place.existing.status === "pending"
                              ? "Already sent, waiting for review"
                              : "Already reviewed"}
                        </span>
                      )}
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
      {listed.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-bold">Already listed</p>
          <ul className="grid gap-2">
            {listed.map((place) => (
              <li key={place.id}>
                <a className="font-bold underline" href={`/place/${place.id}`}>
                  {place.name}
                </a>
                {place.address ? (
                  <span className="text-sm text-muted-foreground"> · {place.address}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {searchMessage && <FieldDescription role="status">{searchMessage}</FieldDescription>}
      {formError && !selected && <FieldError>{formError}</FieldError>}
      {duplicateUrl && (
        <FieldDescription>
          <a className="font-bold underline" href={duplicateUrl}>
            Open the place that is already listed
          </a>
        </FieldDescription>
      )}

      {selected && (
        <form className="grid min-w-0 gap-3" onSubmit={(event) => void submit(event)}>
          {formError && <FieldError>{formError}</FieldError>}
          {selectedExisting && (
            <div role="status" className="grid gap-1 rounded-2xl border bg-secondary p-4 text-sm">
              <p className="font-extrabold">
                {selectedExisting.status === "listed"
                  ? "Already listed"
                  : selectedExisting.status === "pending"
                    ? "Already sent and waiting for review"
                    : "Already reviewed"}
              </p>
              {selectedExisting.url ? (
                <a className="font-bold underline break-words [overflow-wrap:anywhere]" href={selectedExisting.url}>
                  Open {selectedExisting.name}
                </a>
              ) : (
                <p className="text-muted-foreground">
                  A moderator has this one, so it can’t be added again.
                </p>
              )}
            </div>
          )}
          <Button
            size="xl"
            type="submit"
            disabled={submitBusy || Boolean(selectedExisting)}
            aria-describedby={selectedExisting ? undefined : "add-place-confirm"}
            className="h-auto min-h-12 w-full max-w-full py-3 whitespace-normal break-words text-center [overflow-wrap:anywhere]"
          >
            {submitBusy && <Spinner />}
            {submitBusy
              ? "Adding…"
              : selectedExisting
                ? selectedExisting.status === "listed"
                  ? "Already listed"
                  : "Can’t add this again"
                : authState === "signed-out"
                  ? `Sign in to add ${selected.name}`
                  : `Add ${selected.name}`}
          </Button>
          <FieldDescription id="add-place-confirm">
            By adding it, you’re telling us it serves halal food. A moderator reviews that
            before it is listed. This is not a certification.
          </FieldDescription>
        </form>
      )}
      {!selected && (
        <FieldDescription>
          {authState === "signed-out"
            ? "You can search and pick a place while signed out. Sign in at the last step, and your pick stays."
            : "Google fills in the pin. If search fails, send a link and a moderator reviews it before it is listed."}
        </FieldDescription>
      )}
      {!selected && (providerDown || linkDraft.sourceUrl) && (
        <form className="grid gap-3" onSubmit={(event) => void submitLink(event)}>
          <h2 className="text-lg">Add it with a link</h2>
          <p className="text-sm text-muted-foreground">
            This stays pending until someone checks the link. It does not publish a listing
            and it does not certify the food.
          </p>
          <InputGroup>
            <InputGroupInput
              aria-label="Place name"
              value={linkDraft.name}
              maxLength={120}
              placeholder="Place name"
              onChange={(event) => setLinkDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </InputGroup>
          <InputGroup>
            <InputGroupInput
              aria-label="City"
              value={linkDraft.city}
              maxLength={80}
              placeholder="City"
              onChange={(event) => setLinkDraft((current) => ({ ...current, city: event.target.value }))}
            />
          </InputGroup>
          <InputGroup>
            <InputGroupInput
              aria-label="Street address"
              value={linkDraft.address}
              maxLength={200}
              placeholder="Street address"
              onChange={(event) =>
                setLinkDraft((current) => ({ ...current, address: event.target.value }))
              }
            />
          </InputGroup>
          <InputGroup>
            <InputGroupInput
              aria-label="Link to the place"
              type="url"
              value={linkDraft.sourceUrl}
              maxLength={500}
              placeholder="https://maps.google.com/…"
              onChange={(event) =>
                setLinkDraft((current) => ({ ...current, sourceUrl: event.target.value }))
              }
            />
          </InputGroup>
          <Button size="xl" type="submit" disabled={submitBusy}>
            {submitBusy ? "Filing…" : "Submit for review"}
          </Button>
        </form>
      )}
    </section>
  );
}
