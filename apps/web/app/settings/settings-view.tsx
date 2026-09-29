"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Field, FieldLabel, FieldGroup, FieldSet, FieldLegend, FieldDescription } from "@halalfood/ui/components/field";
import { Input } from "@halalfood/ui/components/input";
import { Textarea } from "@halalfood/ui/components/textarea";
import { Loading } from "../../src/components/blocks";
import { CheckboxField } from "../../src/components/form-fields";
import { FormMessage } from "../../src/components/section";
import { PersonAvatar } from "../../src/components/person";
import { describeStandard, inviteLink } from "@halalfood/core/social";
import type { UserPreferences } from "@halalfood/core/user-preferences";

type Profile = {
  handle: string;
  displayName: string | null;
  bio: string | null;
  isPrivate: boolean;
  showOnLeaderboards: boolean;
  avatarUrl: string | null;
  followers: number;
  following: number;
};

type Person = { handle: string; displayName: string | null; avatarUrl: string | null };

async function readJson<T>(response: Response): Promise<T & { error?: string; loginUrl?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string; loginUrl?: string };
}

export default function SettingsView() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [requests, setRequests] = useState<Person[]>([]);
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [profileRes, prefsRes, requestsRes, blocksRes] = await Promise.all([
        fetch("/api/profile", { cache: "no-store" }),
        fetch("/api/preferences", { cache: "no-store" }),
        fetch("/api/follow-requests", { cache: "no-store" }),
        fetch("/api/blocks", { cache: "no-store" }),
      ]);
      if (profileRes.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent("/settings")}`);
        return;
      }
      const profileBody = await readJson<{ profile?: Profile }>(profileRes);
      if (profileBody.profile) {
        setProfile(profileBody.profile);
        setName(profileBody.profile.displayName ?? "");
        setBio(profileBody.profile.bio ?? "");
      }
      const prefsBody = await readJson<{ preferences?: UserPreferences }>(prefsRes);
      if (prefsBody.preferences) setPreferences(prefsBody.preferences);
      setRequests((await readJson<{ requests?: Person[] }>(requestsRes)).requests ?? []);
      setBlocked((await readJson<{ blocked?: Person[] }>(blocksRes)).blocked ?? []);
    } catch {
      setError("Could not load your settings.");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<Response>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await action();
      const body = await readJson<Record<string, unknown>>(response);
      if (!response.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        return false;
      }
      setMessage(success);
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const putProfile = (patch: Record<string, unknown>, success: string) =>
    run(
      () =>
        fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
      success,
    ).then(async (ok) => {
      if (ok) await load();
      return ok;
    });

  if (!ready) return <Loading>Loading your settings…</Loading>;
  if (!profile) return <FormMessage tone="error">{error || "Could not load your profile."}</FormMessage>;

  const display = profile.displayName ?? profile.handle;

  return (
    <FieldGroup className="max-w-2xl gap-8">
      <FieldSet>
        <FieldLegend>Profile</FieldLegend>
        <div className="flex items-center gap-4">
          <PersonAvatar name={display} avatarUrl={profile.avatarUrl} size={72} />
          <div className="grid gap-1 text-sm">
            <label className="grid gap-1 font-bold">
              <span>{profile.avatarUrl ? "Change photo" : "Add a photo"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                className="text-xs font-normal"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  const form = new FormData();
                  form.set("file", file);
                  if (
                    await run(
                      () => fetch("/api/profile/avatar", { method: "POST", body: form }),
                      "Photo updated.",
                    )
                  )
                    await load();
                }}
              />
            </label>
            {profile.avatarUrl && (
              <Button
                variant="link"
                className="justify-self-start px-0 text-destructive"
                onClick={async () => {
                  if (await run(() => fetch("/api/profile/avatar", { method: "DELETE" }), "Photo removed."))
                    await load();
                }}
              >
                Remove photo
              </Button>
            )}
          </div>
        </div>
        <Field>
          <FieldLabel htmlFor="settings-name">Name</FieldLabel>
          <Input
            id="settings-name"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="settings-bio">Bio</FieldLabel>
          <Textarea
            id="settings-bio"
            maxLength={280}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
          <FieldDescription>
            {profile.followers} followers · {profile.following} following · your public link is
            halalfood.world/u/{profile.handle}
          </FieldDescription>
        </Field>
        <Button
          className="justify-self-start"
          disabled={busy || !name.trim()}
          onClick={() => void putProfile({ displayName: name, bio: bio || null }, "Profile saved.")}
        >
          Save profile
        </Button>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Privacy</FieldLegend>
        <CheckboxField
          id="settings-private"
          checked={profile.isPrivate}
          onCheckedChange={(checked) =>
            void putProfile(
              { isPrivate: checked },
              checked
                ? "Your account is private. New followers need your approval."
                : "Your account is public. Waiting requests were accepted.",
            )
          }
        >
          Private account. New followers need my approval, and only followers see my visits and
          lists.
        </CheckboxField>
        <CheckboxField
          id="settings-leaderboards"
          checked={profile.showOnLeaderboards && !profile.isPrivate}
          disabled={profile.isPrivate}
          onCheckedChange={(checked) =>
            void putProfile(
              { showOnLeaderboards: checked },
              checked
                ? "You will appear on the leaderboard when you have verified visits."
                : "You are hidden from the leaderboard.",
            )
          }
        >
          Show me on leaderboards. Ranked by verified visits, so it only ever lists diners who
          have eaten out and confirmed it. Private accounts are never listed.
        </CheckboxField>
        <FieldDescription>
          Your name, handle and photo stay visible so friends can find you. Visit and list
          visibility are also set on the{" "}
          <a className="underline" href="/preferences">
            dietary standards page
          </a>
          .
        </FieldDescription>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Follow requests</FieldLegend>
        {requests.length === 0 ? (
          <FieldDescription>No requests waiting.</FieldDescription>
        ) : (
          <ul className="grid gap-2.5">
            {requests.map((person) => (
              <li key={person.handle} className="flex items-center justify-between gap-3">
                <a className="flex items-center gap-3" href={`/u/${person.handle}`}>
                  <PersonAvatar
                    name={person.displayName ?? person.handle}
                    avatarUrl={person.avatarUrl}
                    size={40}
                  />
                  <span className="grid">
                    <strong>{person.displayName ?? person.handle}</strong>
                    <span className="text-xs text-muted-foreground">@{person.handle}</span>
                  </span>
                </a>
                <span className="flex gap-2">
                  {[true, false].map((accept) => (
                    <Button
                      key={String(accept)}
                      size="sm"
                      variant={accept ? "default" : "outline"}
                      disabled={busy}
                      onClick={async () => {
                        const ok = await run(
                          () =>
                            fetch(`/api/follow-requests/${encodeURIComponent(person.handle)}`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ accept }),
                            }),
                          accept ? "Request accepted." : "Request declined.",
                        );
                        if (ok) await load();
                      }}
                    >
                      {accept ? "Accept" : "Decline"}
                    </Button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </FieldSet>

      <FieldSet>
        <FieldLegend>Blocked people</FieldLegend>
        {blocked.length === 0 ? (
          <FieldDescription>
            You have not blocked anyone. Blocking hides you from each other and removes any
            follow between you.
          </FieldDescription>
        ) : (
          <ul className="grid gap-2.5">
            {blocked.map((person) => (
              <li key={person.handle} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3">
                  <PersonAvatar
                    name={person.displayName ?? person.handle}
                    avatarUrl={person.avatarUrl}
                    size={40}
                  />
                  <span className="grid">
                    <strong>{person.displayName ?? person.handle}</strong>
                    <span className="text-xs text-muted-foreground">@{person.handle}</span>
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await run(
                      () => fetch(`/api/blocks/${encodeURIComponent(person.handle)}`, { method: "DELETE" }),
                      "Unblocked.",
                    );
                    if (ok) await load();
                  }}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        )}
      </FieldSet>

      <FieldSet>
        <FieldLegend>Halal standard</FieldLegend>
        <p className="text-sm">
          {preferences ? describeStandard(preferences) : "Not set yet"} ·{" "}
          <a className="font-bold underline" href="/preferences">
            Change
          </a>
        </p>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Invite friends</FieldLegend>
        <FieldDescription>
          Your link opens a short setup and follows you when they join. It carries no contact
          data.
        </FieldDescription>
        <Button
          variant="outline"
          className="justify-self-start"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(inviteLink(profile.handle, window.location.origin));
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Link copied" : "Copy invite link"}
        </Button>
      </FieldSet>

      {error && <FormMessage tone="error">{error}</FormMessage>}
      {message && <FormMessage tone="success">{message}</FormMessage>}
    </FieldGroup>
  );
}
