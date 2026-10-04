"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Badge } from "@halalfood/ui/components/badge";
import { Field, FieldDescription, FieldLabel } from "@halalfood/ui/components/field";
import { Input } from "@halalfood/ui/components/input";
import { Progress } from "@halalfood/ui/components/progress";
import { ChipRow, Loading } from "../../src/components/blocks";
import { CheckboxField, ToggleChip } from "../../src/components/form-fields";
import { FormMessage } from "../../src/components/section";
import { PersonAvatar } from "../../src/components/person";
import FollowButton from "../../src/components/follow-button";
import { TONE_BADGE } from "../../src/components/status-tone";
import { cityName } from "../../src/lib/seo";
import {
  DEFAULT_ONBOARDING_STANDARD,
  MAX_WANT_TO_TRY,
  ONBOARDING_STEPS,
  STANDARD_PRESETS,
  STANDARD_PRESET_COPY,
  describeStandard,
  inviteLink,
  applyOnboardingStandard,
  type OnboardingStandard,
  type OnboardingStep,
} from "@halalfood/core/social";
import { DEFAULT_PREFERENCES } from "@halalfood/core/user-preferences";
import { STATUS_COPY, type HalalTaxonomyStatus } from "@halalfood/core/halal-taxonomy";

type Pick = {
  id: string;
  name: string;
  citySlug: string;
  neighbourhood: string | null;
  halalStatus: HalalTaxonomyStatus;
};

type Person = {
  handle: string;
  displayName: string | null;
  isPrivate: boolean;
  avatarUrl: string | null;
};

type HandleState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok" }
  | { state: "bad"; message: string };

/**
 * Six short steps after the first email-code login. Every step can be skipped
 * except name and handle, and it ends on the diner's own map. The halal
 * standard chosen here is written to the same preferences the dietary
 * standards page edits, so it filters every later screen.
 */
export default function OnboardingFlow({
  invitedBy,
  returnTo,
  citySlugs,
}: {
  invitedBy: string | null;
  returnTo: string;
  citySlugs: string[];
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleCheck, setHandleCheck] = useState<HandleState>({ state: "idle" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [homeCity, setHomeCity] = useState<string | null>(null);
  const [standard, setStandard] = useState<OnboardingStandard>(DEFAULT_ONBOARDING_STANDARD);
  const [standardTouched, setStandardTouched] = useState(false);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<{ handle: string; following: string | null } | null>(null);

  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [copied, setCopied] = useState(false);

  // Resume: someone who already finished goes straight on; someone with a saved
  // name keeps it if they reload half way.
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/onboarding", { cache: "no-store" });
        if (response.status === 401) {
          // Keep the invite (and any return path) through sign-in.
          window.location.assign(
            `/login?reason=join&returnTo=${encodeURIComponent(
              window.location.pathname + window.location.search,
            )}`,
          );
          return;
        }
        if (response.ok) {
          const body = (await response.json()) as {
            completed: boolean;
            profile: {
              handle: string;
              displayName: string | null;
              homeCitySlug: string | null;
              avatarUrl: string | null;
              handleChosen: boolean;
            };
          };
          if (body.completed) {
            window.location.replace(invitedBy ? `/u/${invitedBy}` : returnTo);
            return;
          }
          if (body.profile.displayName) setDisplayName(body.profile.displayName);
          if (body.profile.handleChosen) setHandle(body.profile.handle);
          setAvatarUrl(body.profile.avatarUrl);
          setHomeCity(body.profile.homeCitySlug);
        }
      } catch {
        // Fall through: the steps still work and the final save will report errors.
      }
      setLoading(false);
    })();
  }, [invitedBy, returnTo]);

  // Live handle check, debounced.
  useEffect(() => {
    if (!handle) {
      setHandleCheck({ state: "idle" });
      return;
    }
    setHandleCheck({ state: "checking" });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/handles/check?handle=${encodeURIComponent(handle)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = (await response.json()) as { available?: boolean; error?: string };
        setHandleCheck(
          body.available
            ? { state: "ok" }
            : { state: "bad", message: body.error ?? "That handle is not available." },
        );
      } catch {
        if (!controller.signal.aborted) setHandleCheck({ state: "idle" });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [handle]);

  const loadPicks = useCallback(async () => {
    setPicks(null);
    const params = new URLSearchParams({ preset: standard.preset });
    if (standard.avoidAlcohol) params.set("noAlcohol", "1");
    if (homeCity) params.set("city", homeCity);
    try {
      const response = await fetch(`/api/onboarding/picks?${params}`, { cache: "no-store" });
      const body = (await response.json()) as { places?: Pick[] };
      setPicks(response.ok ? (body.places ?? []) : []);
    } catch {
      setPicks([]);
    }
  }, [standard.preset, standard.avoidAlcohol, homeCity]);

  // People search on the friends step.
  useEffect(() => {
    if (step !== "friends" || query.trim().replace(/^@/, "").length < 2) {
      setPeople([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/people/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const body = (await response.json()) as { people?: Person[] };
        setPeople(body.people ?? []);
      } catch {
        // Keep whatever was showing; the next keystroke retries.
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, step]);

  const index = ONBOARDING_STEPS.indexOf(step);
  const go = (next: OnboardingStep) => {
    setError("");
    setStep(next);
    if (next === "picks") void loadPicks();
  };
  const next = () => go(ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)]!);
  const back = () => go(ONBOARDING_STEPS[Math.max(index - 1, 0)]!);

  async function uploadAvatar(file: File) {
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { avatarUrl?: string; error?: string };
      if (!response.ok) setError(body.error ?? "Could not upload that photo.");
      else setAvatarUrl(body.avatarUrl ?? null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          handle,
          standard: standardTouched ? standard : null,
          homeCitySlug: homeCity,
          wantToTry: chosen,
          invitedByHandle: invitedBy,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        profile?: { handle: string };
        followed?: string | null;
      };
      if (!response.ok || !body.profile) {
        setError(body.error ?? "Could not save your profile.");
        const failedStep = (body as { failedStep?: string }).failedStep;
        if (
          failedStep === "profile" ||
          failedStep === "standard" ||
          failedStep === "picks" ||
          failedStep === "friends"
        )
          setStep(failedStep);
        else if (response.status === 409 || response.status === 400) setStep("profile");
        return;
      }
      setFinished({ handle: body.profile.handle, following: body.followed ? invitedBy : null });
      setStep("ready");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading>Getting things ready…</Loading>;

  const profileReady =
    displayName.trim().length > 0 && handle.length >= 3 && handleCheck.state !== "bad";
  const preferences = applyOnboardingStandard(DEFAULT_PREFERENCES, standard);
  // The map opens on their city with their own standard already applied.
  const mapParams = new URLSearchParams();
  if (homeCity) mapParams.set("city", homeCity);
  if (standardTouched) mapParams.set("mine", "1");
  const mapHref = `/map${mapParams.size ? `?${mapParams}` : ""}`;

  return (
    <section aria-labelledby="onboarding-title" className="mx-auto my-6 grid max-w-xl gap-5">
      <div className="grid gap-2">
        <Progress
          value={((index + 1) / ONBOARDING_STEPS.length) * 100}
          aria-label={`Step ${index + 1} of ${ONBOARDING_STEPS.length}`}
        />
        <p className="text-xs font-bold text-muted-foreground">
          Step {index + 1} of {ONBOARDING_STEPS.length}
        </p>
      </div>

      <Card className="gap-5 rounded-3xl px-6 py-8 shadow-lg ring-border sm:px-9">
        {step === "welcome" && (
          <>
            <div className="grid gap-2">
              <h1 id="onboarding-title" className="text-[26px]">
                Find halal food through the people you trust
              </h1>
              <p className="text-base text-muted-foreground">
                Follow friends, see where they eat and keep your own list. Halal status still
                comes only from dated, moderated evidence, so no like or follower count can
                change a badge.
              </p>
            </div>
            {invitedBy && (
              <p className="rounded-2xl bg-secondary p-4 text-sm font-semibold">
                @{invitedBy} invited you. We will follow them once you finish.
              </p>
            )}
            <Button size="xl" onClick={next}>
              Get started
            </Button>
          </>
        )}

        {step === "profile" && (
          <>
            <div className="grid gap-2">
              <h1 id="onboarding-title" className="text-[26px]">
                Create your profile
              </h1>
              <p className="text-base text-muted-foreground">
                A photo is optional. Your name and handle are how friends find you.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <PersonAvatar name={displayName || handle || "You"} avatarUrl={avatarUrl} size={72} />
              <label className="grid gap-1 text-sm font-bold">
                <span>{avatarUrl ? "Change photo" : "Add a photo"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  className="text-xs font-normal"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadAvatar(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <Field>
              <FieldLabel htmlFor="onboarding-name" className="font-extrabold">
                Name
              </FieldLabel>
              <Input
                id="onboarding-name"
                autoComplete="name"
                required
                maxLength={60}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="h-12 text-base"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="onboarding-handle" className="font-extrabold">
                Handle
              </FieldLabel>
              <Input
                id="onboarding-handle"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={32}
                placeholder="ayesha_eats"
                value={handle}
                onChange={(event) =>
                  setHandle(event.target.value.replace(/^@/, "").toLowerCase().replace(/\s/g, ""))
                }
                aria-invalid={handleCheck.state === "bad"}
                aria-describedby="onboarding-handle-hint"
                className="h-12 text-base"
              />
              <FieldDescription id="onboarding-handle-hint" role="status">
                {handleCheck.state === "checking"
                  ? "Checking…"
                  : handleCheck.state === "ok"
                    ? `Available. Your public link is halalfood.world/u/${handle}`
                    : handleCheck.state === "bad"
                      ? handleCheck.message
                      : "Letters, numbers, - and _. Your handle is your public link."}
              </FieldDescription>
            </Field>
            {citySlugs.length > 0 && (
              <Field>
                <FieldLabel className="font-extrabold">Home city (optional)</FieldLabel>
                <ChipRow>
                  {citySlugs.map((slug) => (
                    <ToggleChip
                      key={slug}
                      pressed={homeCity === slug}
                      onPressedChange={(pressed) => setHomeCity(pressed ? slug : null)}
                    >
                      {cityName(slug)}
                    </ToggleChip>
                  ))}
                </ChipRow>
              </Field>
            )}
            {error && <FormMessage tone="error">{error}</FormMessage>}
            <div className="flex gap-3">
              <Button variant="outline" size="xl" onClick={back}>
                Back
              </Button>
              <Button size="xl" className="flex-1" disabled={!profileReady || busy} onClick={next}>
                Next
              </Button>
            </div>
          </>
        )}

        {step === "standard" && (
          <>
            <div className="grid gap-2">
              <h1 id="onboarding-title" className="text-[26px]">
                What is halal for you?
              </h1>
              <p className="text-base text-muted-foreground">
                We only show places that meet your standard. You can change it any time on the
                dietary standards page.
              </p>
            </div>
            <div role="radiogroup" aria-label="Halal standard" className="grid gap-2.5">
              {STANDARD_PRESETS.map((preset) => {
                const copy = STANDARD_PRESET_COPY[preset];
                const selected = standard.preset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setStandardTouched(true);
                      setStandard((current) => ({ ...current, preset }));
                    }}
                    className={`grid gap-0.5 rounded-2xl border p-4 text-left ${
                      selected ? "border-foreground bg-secondary" : "border-border"
                    }`}
                  >
                    <strong>{copy.label}</strong>
                    <span className="text-sm text-muted-foreground">{copy.hint}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2.5">
              <CheckboxField
                id="onboarding-no-alcohol"
                checked={standard.avoidAlcohol}
                onCheckedChange={(checked) => {
                  setStandardTouched(true);
                  setStandard((current) => ({ ...current, avoidAlcohol: checked }));
                }}
              >
                No alcohol served
              </CheckboxField>
              <CheckboxField
                id="onboarding-zabiha"
                checked={standard.preferHandSlaughter}
                onCheckedChange={(checked) => {
                  setStandardTouched(true);
                  setStandard((current) => ({ ...current, preferHandSlaughter: checked }));
                }}
              >
                Hand-slaughtered (zabiha)
              </CheckboxField>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" size="xl" onClick={back}>
                Back
              </Button>
              <Button size="xl" className="flex-1" onClick={next}>
                Next
              </Button>
            </div>
            <Button
              variant="link"
              className="justify-self-start px-0 font-extrabold text-foreground underline"
              onClick={() => {
                setStandardTouched(false);
                setStandard(DEFAULT_ONBOARDING_STANDARD);
                next();
              }}
            >
              Skip for now
            </Button>
          </>
        )}

        {step === "picks" && (
          <>
            <div className="grid gap-2">
              <h1 id="onboarding-title" className="text-[26px]">
                Pick {MAX_WANT_TO_TRY} places you want to try
              </h1>
              <p className="text-base text-muted-foreground">
                Only places that meet your standard are shown, each with its halal status.
              </p>
            </div>
            {picks === null ? (
              <Loading>Finding places…</Loading>
            ) : picks.length === 0 ? (
              <p className="rounded-2xl bg-secondary p-4 text-sm font-semibold">
                No places match that standard yet. You can save some from the map later.
              </p>
            ) : (
              <ul className="grid gap-2.5">
                {picks.map((place) => {
                  const selected = chosen.includes(place.id);
                  const full = chosen.length >= MAX_WANT_TO_TRY && !selected;
                  const copy = STATUS_COPY[place.halalStatus];
                  return (
                    <li key={place.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        disabled={full}
                        onClick={() =>
                          setChosen((current) =>
                            selected
                              ? current.filter((id) => id !== place.id)
                              : [...current, place.id],
                          )
                        }
                        className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left disabled:opacity-50 ${
                          selected ? "border-foreground bg-secondary" : "border-border"
                        }`}
                      >
                        <span className="grid gap-1">
                          <strong>{place.name}</strong>
                          <span className="text-sm text-muted-foreground">
                            {place.neighbourhood ?? cityName(place.citySlug)}
                          </span>
                          <Badge variant={TONE_BADGE[copy.tone]} className="justify-self-start">
                            {copy.label}
                          </Badge>
                        </span>
                        <span aria-hidden="true" className="text-xl font-extrabold">
                          {selected ? "✓" : "+"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex gap-3">
              <Button variant="outline" size="xl" onClick={back}>
                Back
              </Button>
              <Button size="xl" className="flex-1" onClick={next}>
                {chosen.length ? `Next (${chosen.length} picked)` : "Next"}
              </Button>
            </div>
            <Button
              variant="link"
              className="justify-self-start px-0 font-extrabold text-foreground underline"
              onClick={() => {
                setChosen([]);
                next();
              }}
            >
              Skip for now
            </Button>
          </>
        )}

        {step === "friends" && (
          <>
            <div className="grid gap-2">
              <h1 id="onboarding-title" className="text-[26px]">
                See which friends are here
              </h1>
              <p className="text-base text-muted-foreground">
                Search by handle. The invite link is available after you finish. We never upload,
                read or store your contacts.
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor="onboarding-search" className="font-extrabold">
                Search for friends
              </FieldLabel>
              <Input
                id="onboarding-search"
                type="search"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="@handle or name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-12 text-base"
              />
            </Field>
            {people.length > 0 && (
              <ul className="grid gap-2.5">
                {people.map((person) => (
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
                    <FollowButton handle={person.handle} initialStatus={null} size="sm" />
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 rounded-2xl bg-secondary p-4">
              <strong>Invite friends</strong>
              <p className="text-sm text-muted-foreground">
                The invite link turns on after Finish, once this profile can be opened.
                Sharing it earlier would send people to a page that does not exist yet.
              </p>
              <Button variant="outline" disabled>
                Copy invite link
              </Button>
            </div>
            {error && <FormMessage tone="error">{error}</FormMessage>}
            <div className="flex gap-3">
              <Button variant="outline" size="xl" onClick={back}>
                Back
              </Button>
              <Button size="xl" className="flex-1" disabled={busy} onClick={() => void finish()}>
                {busy ? "Saving…" : "Finish"}
              </Button>
            </div>
          </>
        )}

        {step === "ready" && finished && (
          <>
            <div className="grid gap-2">
              <h1 id="onboarding-title" className="text-[26px]">
                Your map is ready, {displayName.split(" ")[0]}
              </h1>
              <p className="text-base text-muted-foreground">
                {chosen.length} {chosen.length === 1 ? "place" : "places"} to try
                {finished.following ? ` · following @${finished.following}` : ""} ·{" "}
                {standardTouched ? `Showing ${describeStandard(preferences)}` : "No standard set yet"}
              </p>
            </div>
            {finished.following && (
              <FollowButton handle={finished.following} initialStatus="accepted" variant="outline" />
            )}
            <Button asChild size="xl">
              <a href={mapHref}>Let me in</a>
            </Button>
            <Button asChild variant="outline" size="xl">
              <a href={`/u/${finished.handle}`}>View my profile</a>
            </Button>
            <div className="grid gap-2 rounded-2xl bg-secondary p-4">
              <strong>Invite friends</strong>
              <p className="text-sm text-muted-foreground">
                This link opens your profile. When someone joins from it, we follow you
                and tell them so.
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      inviteLink(finished.handle, window.location.origin),
                    );
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Link copied" : "Copy invite link"}
              </Button>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
