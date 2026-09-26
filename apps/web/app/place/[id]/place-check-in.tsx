"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Camera01Icon, Cancel01Icon, Location01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import {
  DISH_VERDICTS,
  DISH_VERDICT_COPY,
  SERVICE_COPY,
  SERVICE_VERDICTS,
  VALUE_COPY,
  VALUE_VERDICTS,
  VISIT_CONTEXT_KEYS,
  VISIT_CONTEXT_VALUES,
  WOULD_RETURN,
  WOULD_RETURN_COPY,
  type DishVerdict,
  type ServiceVerdict,
  type ValueVerdict,
  type WouldReturn,
} from "@halalfood/core/check-in";
import { RELATIONSHIPS, RELATIONSHIP_COPY } from "@halalfood/core/halal-taxonomy";

/**
 * The ten-second check-in.
 *
 * The three primary answers are on one screen and reachable in three taps; the
 * note, photos, context and disclosures are all optional and sit below the
 * fold. Location proof is offered, never required — declining it records a
 * clearly labelled unverified visit rather than blocking the contribution.
 */

type DishEntry = { name: string; verdict: DishVerdict };
type Phase = "idle" | "open" | "saving" | "done";

const WOULD_RETURN_HINT: Record<WouldReturn, string> = {
  definitely: "I would come back without thinking about it",
  maybe: "I would come back in the right circumstances",
  no: "I would not come back",
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
}: {
  placeId: string;
  placeName: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [wouldReturn, setWouldReturn] = useState<WouldReturn | null>(null);
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
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ verified: boolean; note: string | null } | null>(
    null,
  );

  const ready = wouldReturn !== null && valueVerdict !== null;

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
          wouldReturn,
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
      if (response.status === 401 && typeof payload.loginUrl === "string") {
        window.location.href = payload.loginUrl;
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

    setResult({
      verified: payload.verificationMethod !== "none",
      note: typeof payload.verificationNote === "string" ? payload.verificationNote : null,
    });
    setPhase("done");
  }

  if (phase === "done")
    return (
      <section className="check-in is-done" aria-live="polite">
        <div className="check-in-done-mark" aria-hidden="true">
          <HugeiconsIcon icon={Tick02Icon} size={22} />
        </div>
        <h2>Visit recorded</h2>
        <p>
          {result?.verified
            ? "Verified by your location at the venue. Verified visits weigh more in every aggregate."
            : "Recorded as an unverified visit and labelled as such."}
        </p>
        {result?.note && <p className="check-in-hint">{result.note}</p>}
        <p className="check-in-hint">
          It is now on your <a href="/passport">food passport</a>.
        </p>
      </section>
    );

  if (phase === "idle")
    return (
      <section className="check-in is-collapsed">
        <div className="place-section-heading">
          <div>
            <p className="eyebrow">RECORD A VISIT</p>
            <h2>Been to {placeName}?</h2>
          </div>
        </div>
        <p className="section-intro">
          Three taps: would you return, what you ordered, was it worth it. No
          stars, no essay.
        </p>
        <button type="button" className="ui-button ui-button-default ui-button-lg" onClick={() => setPhase("open")}>
          Check in
        </button>
      </section>
    );

  return (
    <section className="check-in is-open" aria-labelledby="check-in-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">TEN SECOND CHECK-IN</p>
          <h2 id="check-in-title">How was {placeName}?</h2>
        </div>
        <button
          type="button"
          className="check-in-close"
          onClick={() => setPhase("idle")}
          aria-label="Close the check-in"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={18} />
        </button>
      </div>

      <fieldset className="check-in-field">
        <legend>Would you return?</legend>
        <div className="return-options">
          {WOULD_RETURN.map((option) => (
            <button
              key={option}
              type="button"
              className={`return-option is-${option}${wouldReturn === option ? " is-selected" : ""}`}
              aria-pressed={wouldReturn === option}
              onClick={() => setWouldReturn(option)}
            >
              <span className="return-option-dot" aria-hidden="true" />
              <span className="return-option-label">{WOULD_RETURN_COPY[option]}</span>
              <span className="return-option-hint">{WOULD_RETURN_HINT[option]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="check-in-field">
        <legend>What did you order?</legend>
        <div className="dish-input">
          <input
            className="ui-input"
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
          <button type="button" className="ui-button ui-button-secondary" onClick={addDish}>
            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden="true" />
            Add
          </button>
        </div>
        <ul className="dish-verdicts">
          {dishes.map((dish, index) => (
            <li key={dish.name}>
              <span className="dish-verdict-name">{dish.name}</span>
              <span className="dish-verdict-options">
                {DISH_VERDICTS.map((verdict) => (
                  <button
                    key={verdict}
                    type="button"
                    className={`dish-verdict-option is-${verdict}${dish.verdict === verdict ? " is-selected" : ""}`}
                    aria-pressed={dish.verdict === verdict}
                    onClick={() =>
                      setDishes(
                        dishes.map((entry, position) =>
                          position === index ? { ...entry, verdict } : entry,
                        ),
                      )
                    }
                  >
                    {DISH_VERDICT_COPY[verdict]}
                  </button>
                ))}
              </span>
              <button
                type="button"
                className="dish-verdict-remove"
                aria-label={`Remove ${dish.name}`}
                onClick={() => setDishes(dishes.filter((_, position) => position !== index))}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} />
              </button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="check-in-field">
        <legend>Was it worth it, and how was the service?</legend>
        <div className="chip-row">
          {VALUE_VERDICTS.map((option) => (
            <button
              key={option}
              type="button"
              className={`filter-chip${valueVerdict === option ? " is-active" : ""}`}
              aria-pressed={valueVerdict === option}
              onClick={() => setValueVerdict(option)}
            >
              {VALUE_COPY[option]}
            </button>
          ))}
        </div>
        <p className="check-in-hint">
          Service is asked separately, because good food with slow service is a
          different answer from both being good.
        </p>
        <div className="chip-row">
          {SERVICE_VERDICTS.map((option) => (
            <button
              key={option}
              type="button"
              className={`filter-chip${serviceVerdict === option ? " is-active" : ""}`}
              aria-pressed={serviceVerdict === option}
              onClick={() =>
                setServiceVerdict(serviceVerdict === option ? null : option)
              }
            >
              {SERVICE_COPY[option]}
            </button>
          ))}
        </div>
        <div className="spend-input">
          <input
            className="ui-input"
            inputMode="decimal"
            value={spend}
            placeholder="Spend per person (optional)"
            onChange={(event) => setSpend(event.target.value)}
          />
          <select
            className="ui-input"
            value={currency}
            aria-label="Currency"
            onChange={(event) => setCurrency(event.target.value)}
          >
            {["INR", "GBP", "USD", "EUR", "AED", "MYR", "SGD"].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <details className="check-in-more">
        <summary>Add context, a note, and disclosures</summary>

        {VISIT_CONTEXT_KEYS.map((key) => (
          <fieldset key={key} className="check-in-field">
            <legend>{key[0].toUpperCase() + key.slice(1)}</legend>
            <div className="chip-row">
              {VISIT_CONTEXT_VALUES[key].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`filter-chip${context[key] === value ? " is-active" : ""}`}
                  aria-pressed={context[key] === value}
                  onClick={() =>
                    setContext((current) => {
                      const next = { ...current };
                      if (next[key] === value) delete next[key];
                      else next[key] = value;
                      return next;
                    })
                  }
                >
                  {value.replace(/-/g, " ")}
                </button>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className="check-in-field">
          <legend>Anything worth writing down?</legend>
          <textarea
            className="ui-input check-in-note"
            rows={3}
            maxLength={2000}
            value={note}
            placeholder="Optional. The structured answers above already carry the signal."
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="check-in-hint">
            <HugeiconsIcon icon={Camera01Icon} size={14} aria-hidden="true" /> Photos can be added from the
            gallery on this page after you check in.
          </p>
        </fieldset>

        <fieldset className="check-in-field">
          <legend>Disclosures</legend>
          <label className="check-in-check">
            <input
              type="checkbox"
              checked={incentivized}
              onChange={(event) => setIncentivized(event.target.checked)}
            />
            <span>
              This visit or my feedback was rewarded in some way (a discount, a
              free item, payment).
            </span>
          </label>
          <label className="check-in-select">
            <span>My relationship with this restaurant</span>
            <select
              className="ui-input"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
            >
              {RELATIONSHIPS.map((option) => (
                <option key={option} value={option}>
                  {RELATIONSHIP_COPY[option]}
                </option>
              ))}
            </select>
          </label>
          {(incentivized || relationship !== "none") && (
            <p className="check-in-hint">
              Thank you for saying so. This check-in will be shown with a label
              and left out of the return-intent figures.
            </p>
          )}
        </fieldset>

        <fieldset className="check-in-field">
          <legend>Privacy</legend>
          <label className="check-in-check">
            <input
              type="checkbox"
              checked={shareLocation}
              onChange={(event) => setShareLocation(event.target.checked)}
            />
            <span>
              <HugeiconsIcon icon={Location01Icon} size={14} aria-hidden="true" /> Use my location to verify
              this visit. Only the result is stored — never the coordinates.
            </span>
          </label>
          <label className="check-in-check">
            <input
              type="checkbox"
              checked={visibility === "private"}
              onChange={(event) =>
                setVisibility(event.target.checked ? "private" : "public")
              }
            />
            <span>Keep this visit private on my profile.</span>
          </label>
        </fieldset>
      </details>

      {error && (
        <p className="check-in-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="ui-button ui-button-default ui-button-lg check-in-submit"
        disabled={!ready || phase === "saving"}
        onClick={submit}
      >
        {phase === "saving" ? "Recording…" : "Record this visit"}
      </button>
      <p className="check-in-hint">
        Nothing here asks for a star rating, and no restaurant can send you to
        this form — it only exists on the restaurant&rsquo;s own page.
      </p>
    </section>
  );
}
