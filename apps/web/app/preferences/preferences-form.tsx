"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@halalfood/ui/components/button";
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@halalfood/ui/components/field";
import { Input } from "@halalfood/ui/components/input";
import { ChipRow, Loading } from "../../src/components/blocks";
import { CheckboxField, ChoiceChips } from "../../src/components/form-fields";
import { FormMessage } from "../../src/components/section";

import {
  DEFAULT_PREFERENCES,
  MINIMUM_STATUS_OPTIONS,
  type UserPreferences,
} from "@halalfood/core/user-preferences";
import { STATUS_COPY } from "@halalfood/core/halal-taxonomy";

/**
 * Dietary standards.
 *
 * These are the user's own thresholds, not a platform ruling: the copy says so
 * explicitly, and the form is built so that leaving everything off is a valid,
 * fully working choice.
 */

const TOGGLES: Array<{
  key: keyof UserPreferences;
  label: string;
  hint: string;
}> = [
  {
    key: "requireCertification",
    label: "Require a named certification body",
    hint: "Hides places where no certifying body is on record.",
  },
  {
    key: "avoidAlcohol",
    label: "No alcohol served",
    hint: "A place with an unknown answer is flagged, not hidden.",
  },
  { key: "avoidPork", label: "No pork on the menu", hint: "Same rule for unknowns." },
  {
    key: "requireDedicatedKitchen",
    label: "Dedicated halal kitchen",
    hint: "Excludes venues known to share a kitchen or fryer.",
  },
  {
    key: "requirePrayerSpace",
    label: "Prayer space available",
    hint: "A practical filter, not a halal judgement.",
  },
  {
    key: "vegetarianOnly",
    label: "Vegetarian options needed",
    hint: "Useful when dining with a mixed group.",
  },
];

export default function PreferencesForm() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [state, setState] = useState<"loading" | "ready" | "saving">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allergyDraft, setAllergyDraft] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/preferences");
        if (response.status === 401) {
          const body = await response.json();
          if (typeof body.loginUrl === "string") window.location.href = body.loginUrl;
          return;
        }
        if (response.ok) {
          const body = await response.json();
          if (body?.preferences) setPreferences(body.preferences as UserPreferences);
        }
      } catch {
        setError("Could not load your standards. They are unchanged.");
      } finally {
        setState("ready");
      }
    })();
  }, []);

  async function save(next: UserPreferences) {
    setState("saving");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not save.");
        return;
      }
      setPreferences(body.preferences as UserPreferences);
      setMessage("Saved. These standards now apply on every place page.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setState("ready");
    }
  }

  if (state === "loading") return <Loading>Loading your standards…</Loading>;

  const set = (patch: Partial<UserPreferences>) =>
    setPreferences((current) => ({ ...current, ...patch }));

  return (
    <FieldGroup className="max-w-2xl gap-8">
      <FieldSet>
        <FieldLegend>The weakest status you will consider</FieldLegend>
        <ChoiceChips
          label="The weakest status you will consider"
          value={preferences.minimumStatus}
          onValueChange={(status) => status && set({ minimumStatus: status })}
          options={MINIMUM_STATUS_OPTIONS.map((status) => ({
            value: status,
            label: STATUS_COPY[status].label,
          }))}
        />
        <FieldDescription>{STATUS_COPY[preferences.minimumStatus].minimumEvidence}</FieldDescription>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Your factual requirements</FieldLegend>
        {TOGGLES.map((toggle) => (
          <CheckboxField
            key={String(toggle.key)}
            id={`preference-${String(toggle.key)}`}
            checked={Boolean(preferences[toggle.key])}
            onCheckedChange={(checked) =>
              set({ [toggle.key]: checked } as Partial<UserPreferences>)
            }
          >
            <span className="grid gap-0.5">
              <strong>{toggle.label}</strong>
              <small className="text-[13px] text-muted-foreground">{toggle.hint}</small>
            </span>
          </CheckboxField>
        ))}
      </FieldSet>

      <FieldSet>
        <FieldLegend>Evidence freshness</FieldLegend>
        <ChoiceChips
          label="Evidence freshness"
          value={String(preferences.maxEvidenceAgeDays ?? "any")}
          onValueChange={(days) =>
            days && set({ maxEvidenceAgeDays: days === "any" ? null : Number(days) })
          }
          options={["any", "90", "180", "365"].map((days) => ({
            value: days,
            label: days === "any" ? "Any age" : `Within ${days} days`,
          }))}
        />
      </FieldSet>

      <FieldSet>
        <FieldLegend>Allergies and other constraints</FieldLegend>
        <Input
          aria-label="Add an allergy or constraint"
          value={allergyDraft}
          placeholder="peanuts, shellfish…"
          onChange={(event) => setAllergyDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const value = allergyDraft.trim().toLowerCase();
            if (!value || preferences.allergies.includes(value)) return;
            set({ allergies: [...preferences.allergies, value] });
            setAllergyDraft("");
          }}
        />
        {preferences.allergies.length > 0 && (
          <ChipRow className="gap-2">
            {preferences.allergies.map((allergy) => (
              <Button
                key={allergy}
                variant="secondary"
                className="rounded-full border border-foreground font-semibold"
                aria-label={`Remove ${allergy}`}
                onClick={() =>
                  set({ allergies: preferences.allergies.filter((item) => item !== allergy) })
                }
              >
                {allergy}
                <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden="true" />
              </Button>
            ))}
          </ChipRow>
        )}
        <FieldDescription>
          Allergies always produce a reminder to confirm with the restaurant.
          The platform never claims a kitchen is safe for you.
        </FieldDescription>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Privacy</FieldLegend>
        <CheckboxField
          id="preference-private-visits"
          checked={preferences.visibilityVisits === "private"}
          onCheckedChange={(checked) => set({ visibilityVisits: checked ? "private" : "public" })}
        >
          Keep my visits off my public profile.
        </CheckboxField>
        <CheckboxField
          id="preference-private-lists"
          checked={preferences.visibilityLists === "private"}
          onCheckedChange={(checked) => set({ visibilityLists: checked ? "private" : "public" })}
        >
          Keep my lists private by default.
        </CheckboxField>
      </FieldSet>

      {error && <FormMessage tone="error">{error}</FormMessage>}
      {message && <FormMessage tone="success">{message}</FormMessage>}

      <Button
        size="xl"
        className="justify-self-start"
        disabled={state === "saving"}
        onClick={() => void save(preferences)}
      >
        {state === "saving" ? "Saving…" : "Save my standards"}
      </Button>
    </FieldGroup>
  );
}
