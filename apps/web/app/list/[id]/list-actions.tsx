"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BookmarkAdd01Icon,
  BookmarkCheck01Icon,
  Cancel01Icon,
  Edit02Icon,
  Link01Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@halalfood/ui/components/button";
import { Input } from "@halalfood/ui/components/input";
import { Textarea } from "@halalfood/ui/components/textarea";
import { Field, FieldLabel } from "@halalfood/ui/components/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@halalfood/ui/components/sheet";
import { ChipRow } from "../../../src/components/blocks";
import { ChoiceChips, ToggleChip } from "../../../src/components/form-fields";
import { FormMessage, Note } from "../../../src/components/section";
import { PersonAvatar } from "../../../src/components/person";
import ShareButton from "../../../src/components/share-button";
import {
  LIST_CAPTION_MAX,
  canManageList,
  type ListStanding,
  type ListVisibility,
} from "@halalfood/core/place-lists";
import { call } from "./call";

type Person = {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: "invited" | "accepted";
};

export type EditableList = {
  title: string;
  caption: string | null;
  description: string | null;
  ranked: boolean;
  visibility: ListVisibility;
  coverPlaceId: string | null;
};

/**
 * Everything a reader can do to a list beyond reading it: save it, share it,
 * answer an invite or leave; and for the owner, edit it and plan it together.
 */
export default function ListActions({
  listId,
  title,
  role,
  viewerHandle,
  signedIn,
  saved: initialSaved,
  saves: initialSaves,
  itemCount,
  editable,
  places,
  collaborators: initialCollaborators,
  editLinkPath: initialLink,
}: {
  listId: string;
  title: string;
  role: ListStanding;
  /** The signed-in diner's own handle, needed to answer or leave. */
  viewerHandle: string | null;
  signedIn: boolean;
  saved: boolean;
  saves: number;
  itemCount: number;
  editable: EditableList;
  places: Array<{ placeId: string; name: string }>;
  collaborators: Person[];
  editLinkPath: string | null;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [saves, setSaves] = useState(initialSaves);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const owner = canManageList(role);

  async function toggleSave() {
    if (!signedIn) {
      window.location.assign(`/login?reason=save&returnTo=${encodeURIComponent(`/list/${listId}`)}`);
      return;
    }
    setBusy(true);
    setError("");
    const result = await call<{ saved: boolean; saves: number }>(
      `/api/lists/${listId}/save`,
      saved ? "DELETE" : "PUT",
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSaved(result.body.saved);
    setSaves(result.body.saves);
  }

  async function answer(accept: boolean) {
    if (!viewerHandle) return;
    setBusy(true);
    setError("");
    const result = await call(
      `/api/lists/${listId}/collaborators/${encodeURIComponent(viewerHandle)}`,
      "PUT",
      { accept },
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    window.location.assign(accept ? `/list/${listId}` : "/lists");
  }

  async function leave() {
    if (!viewerHandle) return;
    setBusy(true);
    setError("");
    const result = await call(
      `/api/lists/${listId}/collaborators/${encodeURIComponent(viewerHandle)}`,
      "DELETE",
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    window.location.assign("/lists");
  }

  return (
    <div className="grid gap-3">
      {role === "invited" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-secondary p-4" role="status">
          <p className="flex-1 text-sm font-semibold">
            You’ve been invited to help build this list. You can add places, leave notes and tick
            off visits.
          </p>
          <Button disabled={busy} onClick={() => void answer(true)}>
            Accept
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void answer(false)}>
            Decline
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2.5">
        {!owner && role !== "invited" && (
          <Button
            variant={saved ? "secondary" : "default"}
            size="lg"
            disabled={busy}
            aria-pressed={saved}
            onClick={() => void toggleSave()}
          >
            <HugeiconsIcon icon={saved ? BookmarkCheck01Icon : BookmarkAdd01Icon} size={17} aria-hidden="true" />
            {saved ? "Saved" : "Save list"}
          </Button>
        )}
        {owner && (
          <>
            <EditSheet listId={listId} editable={editable} places={places} />
            <CollaborateSheet
              listId={listId}
              ranked={editable.ranked}
              initialCollaborators={initialCollaborators}
              initialLink={initialLink}
            />
          </>
        )}
        {role === "editor" && (
          <Button variant="outline" size="lg" disabled={busy} onClick={() => void leave()}>
            Leave list
          </Button>
        )}
        <ShareButton
          url={`/list/${listId}`}
          title={title}
          text={`${itemCount} halal places`}
          variant="outline"
        />
      </div>
      {!owner && saves > 0 && (
        <p className="text-sm text-muted-foreground">
          {saves} {saves === 1 ? "diner has" : "diners have"} saved this list.
        </p>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}

function EditSheet({
  listId,
  editable,
  places,
}: {
  listId: string;
  editable: EditableList;
  places: Array<{ placeId: string; name: string }>;
}) {
  const [values, setValues] = useState(editable);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    const result = await call(`/api/lists/${listId}`, "PUT", {
      title: values.title,
      caption: values.caption ?? "",
      description: values.description ?? "",
      ranked: values.ranked,
      visibility: values.visibility,
      coverPlaceId: values.coverPlaceId,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    window.location.reload();
  }

  async function remove() {
    if (!window.confirm("Delete this list for good?")) return;
    setBusy(true);
    const result = await call(`/api/lists/${listId}`, "DELETE");
    setBusy(false);
    if (!result.ok) return setError(result.error);
    window.location.assign("/lists");
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="lg" className="font-extrabold">
          <HugeiconsIcon icon={Edit02Icon} size={17} aria-hidden="true" />
          Edit
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg font-extrabold">Edit list</SheetTitle>
          <SheetDescription>Title, caption, cover and who can see it.</SheetDescription>
        </SheetHeader>
        <form
          className="grid gap-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field>
            <FieldLabel htmlFor="list-title">Title</FieldLabel>
            <Input
              id="list-title"
              value={values.title}
              maxLength={120}
              onChange={(event) => setValues({ ...values, title: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="list-caption">Caption</FieldLabel>
            <Input
              id="list-caption"
              value={values.caption ?? ""}
              maxLength={LIST_CAPTION_MAX}
              placeholder="A line that says what this list is for"
              onChange={(event) => setValues({ ...values, caption: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="list-description">About</FieldLabel>
            <Textarea
              id="list-description"
              value={values.description ?? ""}
              maxLength={1000}
              rows={3}
              onChange={(event) => setValues({ ...values, description: event.target.value })}
            />
          </Field>
          {places.length > 0 && (
            <Field>
              <FieldLabel htmlFor="list-cover">Cover</FieldLabel>
              <select
                id="list-cover"
                className="h-9 rounded-md border bg-background px-2.5 text-sm"
                value={values.coverPlaceId ?? ""}
                onChange={(event) =>
                  setValues({ ...values, coverPlaceId: event.target.value || null })
                }
              >
                <option value="">First place on the list</option>
                {places.map((place) => (
                  <option key={place.placeId} value={place.placeId}>
                    {place.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <ChipRow className="gap-2">
            <ToggleChip
              pressed={values.ranked}
              onPressedChange={(ranked) => setValues({ ...values, ranked })}
            >
              Ranked
            </ToggleChip>
            <ChoiceChips
              label="Visibility"
              value={values.visibility}
              onValueChange={(visibility) => visibility && setValues({ ...values, visibility })}
              options={(["public", "unlisted", "private"] as const).map((option) => ({
                value: option,
                label: option[0].toUpperCase() + option.slice(1),
              }))}
            />
          </ChipRow>
          <Note>
            A ranked list is your own ranking of places you have visited. Unranked lists can be
            planned with friends.
          </Note>
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <div className="flex gap-2">
            <Button type="submit" size="lg" disabled={busy || !values.title.trim()}>
              Save changes
            </Button>
            <Button type="button" size="lg" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function CollaborateSheet({
  listId,
  ranked,
  initialCollaborators,
  initialLink,
}: {
  listId: string;
  ranked: boolean;
  initialCollaborators: Person[];
  initialLink: string | null;
}) {
  const [people, setPeople] = useState(initialCollaborators);
  const [link, setLink] = useState(initialLink);
  const [handle, setHandle] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    setError("");
    setNotice("");
    const result = await call<{ collaborators: Person[] }>(
      `/api/lists/${listId}/collaborators`,
      "POST",
      { handle },
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setPeople(result.body.collaborators);
    setHandle("");
    setNotice("Invite sent. They can edit once they accept.");
  }

  async function remove(person: Person) {
    setBusy(true);
    setError("");
    const result = await call<{ collaborators: Person[] }>(
      `/api/lists/${listId}/collaborators/${encodeURIComponent(person.handle)}`,
      "DELETE",
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setPeople(result.body.collaborators);
  }

  async function toggleLink(enabled: boolean) {
    setBusy(true);
    setError("");
    const result = await call<{ path: string | null }>(`/api/lists/${listId}/edit-link`, "PUT", {
      enabled,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setLink(result.body.path);
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(new URL(link, window.location.origin).href);
      setNotice("Edit link copied.");
    } catch {
      setNotice(new URL(link, window.location.origin).href);
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="lg" className="font-extrabold">
          <HugeiconsIcon icon={UserAdd01Icon} size={17} aria-hidden="true" />
          Collaborate
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg font-extrabold">Invite to edit</SheetTitle>
          <SheetDescription>
            Collaborators can add places, leave notes and tick off visits. Good for a family trip
            or an Eid dinner shortlist.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 p-4">
          {ranked && (
            <FormMessage tone="error">
              A ranked list is one person’s ranking. Make it unranked in Edit to plan it with
              friends.
            </FormMessage>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (handle.trim()) void invite();
            }}
          >
            <Input
              aria-label="Handle to invite"
              value={handle}
              maxLength={32}
              placeholder="@handle"
              disabled={ranked}
              onChange={(event) => setHandle(event.target.value)}
            />
            <Button type="submit" disabled={busy || ranked || !handle.trim()}>
              Invite
            </Button>
          </form>

          {people.length > 0 && (
            <ul className="grid gap-2" aria-label="Collaborators">
              {people.map((person) => (
                <li key={person.handle} className="flex items-center gap-3">
                  <PersonAvatar
                    name={person.displayName ?? person.handle}
                    avatarUrl={person.avatarUrl}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{person.displayName ?? person.handle}</p>
                    <p className="text-xs text-muted-foreground">
                      @{person.handle} · {person.status === "accepted" ? "Can edit" : "Invited"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove @${person.handle}`}
                    disabled={busy}
                    onClick={() => void remove(person)}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={15} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-2 rounded-xl border p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold">Anyone with the link can edit</p>
                <p className="text-xs text-muted-foreground">
                  Off until you turn it on. Turning it off stops new people joining.
                </p>
              </div>
              <ToggleChip
                pressed={Boolean(link)}
                disabled={busy || ranked}
                onPressedChange={(next) => void toggleLink(next)}
              >
                {link ? "On" : "Off"}
              </ToggleChip>
            </div>
            {link && (
              <Button type="button" variant="outline" onClick={() => void copyLink()}>
                <HugeiconsIcon icon={Link01Icon} size={15} aria-hidden="true" />
                Copy edit link
              </Button>
            )}
          </div>
          {notice && <FormMessage tone="success">{notice}</FormMessage>}
          {error && <FormMessage tone="error">{error}</FormMessage>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
