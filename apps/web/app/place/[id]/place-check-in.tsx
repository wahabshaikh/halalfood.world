"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { FieldLegend, FieldSet } from "@halalfood/ui/components/field";
import { Input } from "@halalfood/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@halalfood/ui/components/select";
import { Textarea } from "@halalfood/ui/components/textarea";
import { cn } from "@halalfood/ui/lib/utils";
import { CheckboxField, ChoiceChips, SelectField } from "../../../src/components/form-fields";
import {
  Disclosure,
  FormMessage,
  Note,
  SectionHeading,
  SectionIntro,
} from "../../../src/components/section";

import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Camera01Icon, Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import {
  DISH_VERDICTS,
  DISH_VERDICT_COPY,
  SERVICE_COPY,
  SERVICE_VERDICTS,
  VALUE_COPY,
  VALUE_VERDICTS,
  VERDICTS,
  VERDICT_COPY,
  VISIT_CONTEXT_KEYS,
  VISIT_CONTEXT_VALUES,
  type DishVerdict,
  type ServiceVerdict,
  type ValueVerdict,
  type Verdict,
} from "@halalfood/core/check-in";
import { RELATIONSHIPS, RELATIONSHIP_COPY } from "@halalfood/core/halal-taxonomy";
import {
  clearFormDraft,
  draftRecord,
  readFormDraft,
  restoredShareToFeed,
  saveFormDraft,
} from "../../../src/lib/form-draft";
import { currentReturnPath, signedOutLoginPath } from "../../../src/lib/signed-out";

/**
 * The ten-second check-in, and the "log a visit" sheet that feeds friends.
 *
 * The primary answers are on one screen: a four-step verdict, what you ordered,
 * whether it was worth it and a short note. A halal check, context and
 * disclosures are optional and sit below. The halal check goes to a moderator
 * before it counts, so it never changes a place's status by itself. Location
 * proof is offered, never required — declining it records a clearly labelled
 * unverified visit rather than blocking the contribution.
 */

type DishEntry = { name: string; verdict: DishVerdict };
type Phase = "idle" | "open" | "saving" | "done";

const VERDICT_HINT: Record<Verdict, string> = {
  disliked: "I would not go back",
  okay: "Fine, nothing special",
  liked: "Glad I went",
  favourite: "One of my best meals",
};

const VERDICT_DOT: Record<Verdict, string> = {
  disliked: "bg-destructive",
  okay: "bg-warning",
  liked: "bg-success",
  favourite: "bg-primary",
};

type CheckAnswers = {
  certificate: "seen" | "not-seen" | "unsure" | null;
  alcohol: "none" | "served" | "unsure" | null;
  meat: "hand" | "machine" | "unsure" | null;
};

type DoneResult = {
  verified: boolean;
  note: string | null;
  sharedToFeed: boolean;
  deduped: boolean;
  notification: "sent" | "skipped" | "failed";
  halalCheck: "submitted" | "not-sent" | "failed";
};

async function body(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Ask the browser for a position without ever letting a refusal block the flow. */
function currentPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation)
    return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export default function PlaceCheckIn({
  placeId,
  placeName,
  defaultOpen = false,
}: {
  placeId: string;
  placeName: string;
  /** Start with the sheet open, as on the "log a visit" page. */
  defaultOpen?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(defaultOpen ? "open" : "idle");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [valueVerdict, setValueVerdict] = useState<ValueVerdict | null>(null);
  const [serviceVerdict, setServiceVerdict] = useState<ServiceVerdict | null>(null);
  const [dishes, setDishes] = useState<DishEntry[]>([]);
  const [dishDraft, setDishDraft] = useState("");
  const [note, setNote] = useState("");
  const [spend, setSpend] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [context, setContext] = useState<Record<string, string>>({});
  const [relationship, setRelationship] = useState<string>("none");
  const [incentivized, setIncentivized] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [shareToFeed, setShareToFeed] = useState(false);
  const [check, setCheck] = useState<CheckAnswers>({
    certificate: null,
    alcohol: null,
    meat: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DoneResult | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const draftKey = `halalfood:check-in-draft:${placeId}`;

  useEffect(() => {
    const draft = draftRecord(readFormDraft(draftKey));
    if (!draft) return;
    if (draft.verdict === "disliked" || draft.verdict === "okay" || draft.verdict === "liked" || draft.verdict === "favourite")
      setVerdict(draft.verdict);
    if (draft.valueVerdict === "great" || draft.valueVerdict === "fair" || draft.valueVerdict === "overpriced")
      setValueVerdict(draft.valueVerdict);
    if (draft.serviceVerdict === "good" || draft.serviceVerdict === "fine" || draft.serviceVerdict === "poor")
      setServiceVerdict(draft.serviceVerdict);
    if (Array.isArray(draft.dishes)) {
      const dishes = draft.dishes.flatMap((item): DishEntry[] => {
        const dish = draftRecord(item);
        if (!dish || typeof dish.name !== "string") return [];
        if (dish.verdict !== "order-again" && dish.verdict !== "fine" && dish.verdict !== "avoid") return [];
        return [{ name: dish.name, verdict: dish.verdict }];
      });
      setDishes(dishes);
    }
    if (typeof draft.dishDraft === "string") setDishDraft(draft.dishDraft);
    if (typeof draft.note === "string") setNote(draft.note);
    if (typeof draft.spend === "string") setSpend(draft.spend);
    if (typeof draft.currency === "string") setCurrency(draft.currency);
    if (draftRecord(draft.context)) {
      const context: Record<string, string> = {};
      for (const [key, value] of Object.entries(draftRecord(draft.context) ?? {})) {
        if (typeof value === "string") context[key] = value;
      }
      setContext(context);
    }
    if (typeof draft.relationship === "string") setRelationship(draft.relationship);
    if (typeof draft.incentivized === "boolean") setIncentivized(draft.incentivized);
    if (typeof draft.shareLocation === "boolean") setShareLocation(draft.shareLocation);
    if (draft.visibility === "public" || draft.visibility === "private") setVisibility(draft.visibility);
    // Sharing is opt-in. Only a draft that records the diner ticking it brings
    // it back; anything else (an older draft, a missing flag) stays off.
    setShareToFeed(restoredShareToFeed(draft));
    const check = draftRecord(draft.check);
    if (check) {
      setCheck({
        certificate: check.certificate === "seen" || check.certificate === "not-seen" || check.certificate === "unsure" ? check.certificate : null,
        alcohol: check.alcohol === "none" || check.alcohol === "served" || check.alcohol === "unsure" ? check.alcohol : null,
        meat: check.meat === "hand" || check.meat === "machine" || check.meat === "unsure" ? check.meat : null,
      });
    }
    if (typeof draft.idempotencyKey === "string" && draft.idempotencyKey) idempotencyKey.current = draft.idempotencyKey;
    setPhase("open");
  }, [draftKey]);

  function saveVisitDraft() {
    saveFormDraft(draftKey, {
      verdict,
      valueVerdict,
      serviceVerdict,
      dishes,
      dishDraft,
      note,
      spend,
      currency,
      context,
      relationship,
      incentivized,
      shareLocation,
      visibility,
      shareToFeed,
      shareToFeedChosen: shareToFeed,
      check,
      idempotencyKey: idempotencyKey.current,
    });
  }

  const ready = verdict !== null && valueVerdict !== null;

  function addDish() {
    const name = dishDraft.trim();
    if (!name || dishes.length >= 20) return;
    if (dishes.some((dish) => dish.name.toLowerCase() === name.toLowerCase())) {
      setDishDraft("");
      return;
    }
    setDishes([...dishes, { name, verdict: "order-again" }]);
    setDishDraft("");
  }

  async function submit() {
    if (!ready) return;
    setPhase("saving");
    setError(null);

    let locationProof: Record<string, number> | undefined;
    if (shareLocation) {
      const position = await currentPosition();
      if (position)
        locationProof = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        };
    }

    const spendMinor = spend.trim()
      ? Math.round(Number(spend.trim()) * 100)
      : undefined;
    if (spendMinor !== undefined && !Number.isFinite(spendMinor)) {
      setError("Spend must be a number.");
      setPhase("open");
      return;
    }

    let response: Response;
    try {
      response = await fetch(`/api/places/${placeId}/check-ins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict,
          valueVerdict,
          serviceVerdict,
          dishes,
          note: note.trim() || undefined,
          spendMinor,
          currency: spendMinor !== undefined ? currency : undefined,
          context,
          relationship,
          incentivized,
          visibility,
          shareToFeed: visibility === "public" && shareToFeed,
          idempotencyKey: idempotencyKey.current,
          halalCheck: Object.values(check).some(Boolean) ? check : undefined,
          locationProof,
          utcOffsetMinutes: -new Date().getTimezoneOffset(),
          visitedAt: Date.now(),
        }),
      });
    } catch {
      setError("Could not reach the server. Please try again.");
      setPhase("open");
      return;
    }

    const payload = await body(response);
    if (!response.ok) {
      if (response.status === 401) {
        saveVisitDraft();
        window.location.assign(signedOutLoginPath(currentReturnPath()));
        return;
      }
      setError(
        typeof payload.error === "string"
          ? payload.error
          : "Could not record that visit.",
      );
      setPhase("open");
      return;
    }

    clearFormDraft(draftKey);
    setResult({
      verified: payload.verificationMethod !== "none",
      note: typeof payload.verificationNote === "string" ? payload.verificationNote : null,
      sharedToFeed: payload.sharedToFeed === true,
      deduped: payload.deduped === true,
      notification:
        payload.notification === "sent" || payload.notification === "failed"
          ? payload.notification
          : "skipped",
      halalCheck:
        payload.halalCheck === "submitted" || payload.halalCheck === "failed"
          ? payload.halalCheck
          : "not-sent",
    });
    setPhase("done");
  }

  if (phase === "done")
    return (
      <Card className="my-6 items-start gap-2 px-5 py-5" aria-live="polite">
        <span
          className="flex size-10 items-center justify-center rounded-full bg-success text-success-foreground"
          aria-hidden="true"
        >
          <HugeiconsIcon icon={Tick02Icon} size={22} />
        </span>
        <h2 className="text-[22px]">{result?.deduped ? "Visit already recorded" : "Visit recorded"}</h2>
        <p className="text-muted-foreground">
          {result?.verified
            ? "Verified by your location at the venue. Verified visits weigh more in every aggregate."
            : "Recorded as an unverified visit and labelled as such."}
        </p>
        {result?.note && <Hint>{result.note}</Hint>}
        {result?.halalCheck === "submitted" && (
          <Hint>
            Your halal check went to a moderator. It shows as your own
            observation until it is approved, and only approved checks can change
            this place&rsquo;s status.
          </Hint>
        )}
        {result?.halalCheck === "failed" && (
          <Hint>
            Your visit is saved, but the halal check could not be filed. You can
            add it again from the place page.
          </Hint>
        )}
        {result?.notification === "failed" && (
          <Hint>
            Your visit is saved, but friends who saved this place could not be notified.
          </Hint>
        )}
        <Hint>
          {result?.sharedToFeed
            ? "Your friends can see it in their "
            : "It is on your "}
          {result?.sharedToFeed ? <a href="/feed">feed</a> : <a href="/passport">food passport</a>}
          {result?.sharedToFeed ? (
            <>
              {" "}
              and it is on your <a href="/passport">food passport</a>.
            </>
          ) : (
            "."
          )}
        </Hint>
      </Card>
    );

  if (phase === "idle")
    return (
      <section className="my-6">
        <SectionHeading eyebrow="RECORD A VISIT" title={`Been to ${placeName}?`} />
        <SectionIntro>
          Three taps: how it was, what you ordered, was it worth it. No stars,
          no essay. Friends who follow you see it in their feed.
        </SectionIntro>
        <Button size="xl" onClick={() => setPhase("open")}>
          Check in
        </Button>
      </section>
    );

  return (
    <section className="my-6" aria-labelledby="check-in-title">
      <Card className="gap-5 px-5 py-5">
        <SectionHeading
          id="check-in-title"
          eyebrow="TEN SECOND CHECK-IN"
          title={`How was ${placeName}?`}
          className="mb-0"
          action={
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPhase("idle")}
              aria-label="Close the check-in"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} />
            </Button>
          }
        />

        <FieldSet>
          <FieldLegend>How was it?</FieldLegend>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {VERDICTS.map((option) => (
              <Button
                key={option}
                variant="outline"
                className={cn(
                  "h-auto flex-col items-start gap-1 rounded-xl p-3.5 text-left whitespace-normal hover:border-foreground",
                  verdict === option && "border-2 border-foreground bg-secondary",
                )}
                aria-pressed={verdict === option}
                onClick={() => setVerdict(option)}
              >
                <span className="flex items-center gap-2 text-base font-bold">
                  <span
                    className={cn("size-2.5 rounded-full", VERDICT_DOT[option])}
                    aria-hidden="true"
                  />
                  {VERDICT_COPY[option]}
                </span>
                <span className="text-[13px] font-normal text-muted-foreground">
                  {VERDICT_HINT[option]}
                </span>
              </Button>
            ))}
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend>What did you order?</FieldLegend>
          <div className="flex gap-2">
            <Input
              aria-label="Add a dish"
              value={dishDraft}
              placeholder="Add a dish"
              onChange={(event) => setDishDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addDish();
                }
              }}
            />
            <Button variant="secondary" onClick={addDish}>
              <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
              Add
            </Button>
          </div>
          {dishes.length > 0 && (
            <ul className="divide-y">
              {dishes.map((dish, index) => (
                <li key={dish.name} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="flex-1 font-semibold">{dish.name}</span>
                  <ChoiceChips
                    label={`Verdict on ${dish.name}`}
                    value={dish.verdict}
                    onValueChange={(verdict) =>
                      verdict &&
                      setDishes(
                        dishes.map((entry, position) =>
                          position === index ? { ...entry, verdict } : entry,
                        ),
                      )
                    }
                    options={DISH_VERDICTS.map((verdict) => ({
                      value: verdict,
                      label: DISH_VERDICT_COPY[verdict],
                    }))}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${dish.name}`}
                    onClick={() => setDishes(dishes.filter((_, position) => position !== index))}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </FieldSet>

        <FieldSet>
          <FieldLegend>Was it worth it, and how was the service?</FieldLegend>
          <ChoiceChips
            label="Value"
            value={valueVerdict}
            onValueChange={(next) => next && setValueVerdict(next)}
            options={VALUE_VERDICTS.map((option) => ({ value: option, label: VALUE_COPY[option] }))}
          />
          <Hint>
            Service is asked separately, because good food with slow service is a
            different answer from both being good.
          </Hint>
          <ChoiceChips
            label="Service"
            allowNone
            value={serviceVerdict}
            onValueChange={setServiceVerdict}
            options={SERVICE_VERDICTS.map((option) => ({
              value: option,
              label: SERVICE_COPY[option],
            }))}
          />
          <div className="flex gap-2">
            <Input
              aria-label="Spend per person"
              inputMode="decimal"
              value={spend}
              placeholder="Spend per person (optional)"
              onChange={(event) => setSpend(event.target.value)}
            />
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger aria-label="Currency" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Anything your friends should know?</FieldLegend>
          <Textarea
            aria-label="Note"
            rows={3}
            maxLength={2000}
            value={note}
            placeholder="Optional. What to order, when to go, what to skip."
            onChange={(event) => setNote(event.target.value)}
          />
          <Hint className="flex items-center gap-1">
            <HugeiconsIcon icon={Camera01Icon} size={14} aria-hidden="true" /> Photos can be
            added from the gallery on this page after you check in.
          </Hint>
        </FieldSet>

        <Disclosure label="Add a halal check (optional)">
          <div className="mt-3 grid gap-5">
            <Hint>
              Only say what you actually noticed. A moderator reviews it before it
              counts, and until then it shows as your own observation, not as the
              place&rsquo;s status. Owners, staff and paid creators can&rsquo;t raise
              a status &mdash; declare that under &ldquo;Disclosures&rdquo; below if it
              is you.
            </Hint>
            <FieldSet>
              <FieldLegend variant="label">A halal certificate on display?</FieldLegend>
              <ChoiceChips
                label="Halal certificate"
                allowNone
                value={check.certificate}
                onValueChange={(certificate) => setCheck({ ...check, certificate })}
                options={[
                  { value: "seen", label: "Yes" },
                  { value: "not-seen", label: "No" },
                  { value: "unsure", label: "Didn\u2019t look" },
                ]}
              />
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Alcohol served?</FieldLegend>
              <ChoiceChips
                label="Alcohol"
                allowNone
                value={check.alcohol}
                onValueChange={(alcohol) => setCheck({ ...check, alcohol })}
                options={[
                  { value: "served", label: "Yes" },
                  { value: "none", label: "No" },
                  { value: "unsure", label: "Not sure" },
                ]}
              />
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">
                Did staff say how the meat is slaughtered?
              </FieldLegend>
              <ChoiceChips
                label="How the meat is slaughtered"
                allowNone
                value={check.meat}
                onValueChange={(meat) => setCheck({ ...check, meat })}
                options={[
                  { value: "hand", label: "By hand (zabiha)" },
                  { value: "machine", label: "Machine" },
                  { value: "unsure", label: "Didn\u2019t ask" },
                ]}
              />
            </FieldSet>
          </div>
        </Disclosure>

        <Disclosure label="Add context and disclosures">
          <div className="mt-3 grid gap-5">
            {VISIT_CONTEXT_KEYS.map((key) => (
              <FieldSet key={key}>
                <FieldLegend variant="label">{key[0].toUpperCase() + key.slice(1)}</FieldLegend>
                <ChoiceChips
                  label={key}
                  allowNone
                  value={context[key] ?? null}
                  onValueChange={(value) =>
                    setContext((current) => {
                      const next = { ...current };
                      if (value) next[key] = value;
                      else delete next[key];
                      return next;
                    })
                  }
                  options={VISIT_CONTEXT_VALUES[key].map((value) => ({
                    value,
                    label: value[0].toUpperCase() + value.slice(1).replace(/-/g, " "),
                  }))}
                />
              </FieldSet>
            ))}

            <FieldSet>
              <FieldLegend variant="label">Disclosures</FieldLegend>
              <CheckboxField
                id="check-in-incentivized"
                checked={incentivized}
                onCheckedChange={setIncentivized}
              >
                This visit or my feedback was rewarded in some way (a discount, a
                free item, payment).
              </CheckboxField>
              <SelectField
                id="check-in-relationship"
                label="My relationship with this restaurant"
                value={relationship}
                onValueChange={setRelationship}
                options={RELATIONSHIPS.map((option) => ({
                  value: option,
                  label: RELATIONSHIP_COPY[option],
                }))}
              />
              {(incentivized || relationship !== "none") && (
                <Hint>
                  Thank you for saying so. This check-in will be shown with a label
                  and left out of the return-intent figures.
                </Hint>
              )}
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">Privacy</FieldLegend>
              <CheckboxField
                id="check-in-location"
                checked={shareLocation}
                onCheckedChange={setShareLocation}
              >
                Use my location to verify this visit. Only the result is stored — never the
                coordinates.
              </CheckboxField>
              <CheckboxField
                id="check-in-share"
                checked={visibility === "public" && shareToFeed}
                disabled={visibility === "private"}
                onCheckedChange={setShareToFeed}
              >
                Share this visit to my followers&rsquo; feeds.
              </CheckboxField>
              <CheckboxField
                id="check-in-private"
                checked={visibility === "private"}
                onCheckedChange={(checked) => setVisibility(checked ? "private" : "public")}
              >
                Keep this visit private on my profile.
              </CheckboxField>
            </FieldSet>
          </div>
        </Disclosure>

        {error && <FormMessage tone="error">{error}</FormMessage>}

        <Button
          size="xl"
          className="w-full sm:w-auto sm:justify-self-start"
          disabled={!ready || phase === "saving"}
          onClick={submit}
        >
          {phase === "saving" ? "Recording…" : "Record this visit"}
        </Button>
        <Hint>
          Nothing here asks for a star rating, and no restaurant can send you to
          this form — it only exists on the restaurant&rsquo;s own page.
        </Hint>
      </Card>
    </section>
  );
}

const CURRENCIES = ["INR", "GBP", "USD", "EUR", "AED", "MYR", "SGD"];

function Hint({ className, ...props }: React.ComponentProps<"p">) {
  return <Note className={cn("[&_a]:underline", className)} {...props} />;
}
