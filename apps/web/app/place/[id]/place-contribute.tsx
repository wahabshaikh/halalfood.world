"use client";

import { useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Input } from "@halalfood/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@halalfood/ui/components/tabs";
import { Textarea } from "@halalfood/ui/components/textarea";
import { SelectField } from "../../../src/components/form-fields";
import { FormMessage, SectionHeading } from "../../../src/components/section";

import {
  EDITABLE_FIELDS,
  EDITABLE_FIELD_COPY,
  SENSITIVE_FIELDS,
  type EditableField,
} from "@halalfood/core/contributions";
import {
  RELATIONSHIPS,
  RELATIONSHIP_COPY,
} from "@halalfood/core/halal-taxonomy";
import {
  REPORT_REASONS,
  REPORT_REASON_COPY,
} from "@halalfood/core/moderation";

/**
 * Improving the database without a long onboarding: correct a fact, add a
 * missing dish, report a duplicate, or report a problem. Each submission comes
 * back with its status and the reason for it, so a contributor is never left
 * guessing whether their edit landed.
 */

type Tab = "edit" | "dish" | "duplicate" | "report";

async function post(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let parsed: Record<string, unknown> = {};
  try {
    const value = await response.json();
    if (value && typeof value === "object") parsed = value;
  } catch {
    parsed = {};
  }
  return { response, parsed };
}

export default function PlaceContribute({ placeId }: { placeId: string }) {
  const [tab, setTab] = useState<Tab>("edit");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [field, setField] = useState<EditableField>("telephone");
  const [proposedValue, setProposedValue] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [note, setNote] = useState("");
  const [relationship, setRelationship] = useState("none");

  const [dishName, setDishName] = useState("");
  const [dishPrice, setDishPrice] = useState("");
  const [dishScope, setDishScope] = useState("unknown");

  const [duplicateId, setDuplicateId] = useState("");

  const [reportReason, setReportReason] = useState<
    (typeof REPORT_REASONS)[number]
  >("factual-error");
  const [reportDetail, setReportDetail] = useState("");

  async function send(url: string, payload: unknown, success: (body: Record<string, unknown>) => string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { response, parsed } = await post(url, payload);
      if (response.status === 401 && typeof parsed.loginUrl === "string") {
        window.location.href = parsed.loginUrl;
        return;
      }
      if (!response.ok) {
        setError(typeof parsed.error === "string" ? parsed.error : "That did not work.");
        return;
      }
      setMessage(success(parsed));
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const hint = "text-[13px] text-muted-foreground [&_a]:underline";
  return (
    <section className="my-6" aria-labelledby="contribute-title">
      <SectionHeading
        id="contribute-title"
        eyebrow="IMPROVE THIS ENTRY"
        title="Correct, add or report"
      />

      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as Tab);
          setMessage(null);
          setError(null);
        }}
      >
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="edit">Correct a fact</TabsTrigger>
          <TabsTrigger value="dish">Add a dish</TabsTrigger>
          <TabsTrigger value="duplicate">Report a duplicate</TabsTrigger>
          <TabsTrigger value="report">Report a problem</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="mt-3 grid max-w-xl gap-3">
          <SelectField
            id="contribute-field"
            label="What is wrong?"
            value={field}
            onValueChange={setField}
            options={EDITABLE_FIELDS.map((option) => ({
              value: option,
              label: EDITABLE_FIELD_COPY[option],
            }))}
          />
          <Input
            aria-label="The correct value"
            value={proposedValue}
            placeholder="The correct value"
            onChange={(event) => setProposedValue(event.target.value)}
          />
          <Input
            aria-label="Source link"
            value={sourceUrl}
            placeholder="Source link (https://…)"
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          <Textarea
            aria-label="How do you know?"
            rows={2}
            value={note}
            placeholder="How do you know?"
            onChange={(event) => setNote(event.target.value)}
          />
          <SelectField
            id="contribute-relationship"
            label="Your relationship with this restaurant"
            value={relationship}
            onValueChange={setRelationship}
            options={RELATIONSHIPS.map((option) => ({
              value: option,
              label: RELATIONSHIP_COPY[option],
            }))}
          />
          {SENSITIVE_FIELDS.has(field) && (
            <p className={hint}>
              This fact changes a halal conclusion, so it always goes to a
              moderator and needs a source or an explanation.
            </p>
          )}
          <Button
            size="lg"
            className="justify-self-start"
            disabled={busy || !proposedValue.trim()}
            onClick={() =>
              send(
                `/api/places/${placeId}/edits`,
                {
                  field,
                  proposedValue,
                  sourceUrl: sourceUrl.trim() || undefined,
                  note: note.trim() || undefined,
                  relationship,
                },
                (parsed) =>
                  `${parsed.statusLabel ?? "Submitted"} — ${parsed.reason ?? "Thank you."}`,
              )
            }
          >
            Submit correction
          </Button>
        </TabsContent>

        <TabsContent value="dish" className="mt-3 grid max-w-xl gap-3">
          <Input
            aria-label="Dish name"
            value={dishName}
            placeholder="Dish name"
            onChange={(event) => setDishName(event.target.value)}
          />
          <Input
            aria-label="Price"
            inputMode="decimal"
            value={dishPrice}
            placeholder="Price (optional)"
            onChange={(event) => setDishPrice(event.target.value)}
          />
          <SelectField
            id="contribute-dish-scope"
            label="Halal scope of this dish"
            value={dishScope}
            onValueChange={setDishScope}
            options={[
              { value: "unknown", label: "Not sure" },
              { value: "halal", label: "Halal" },
              { value: "not-halal", label: "Not halal" },
            ]}
          />
          <Input
            aria-label="Menu link or source"
            value={sourceUrl}
            placeholder="Menu link or source (https://…)"
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          <p className={hint}>
            A dish with a cited source publishes immediately. Without one it
            waits for review, so the menu cannot be rewritten without provenance.
          </p>
          <Button
            size="lg"
            className="justify-self-start"
            disabled={busy || !dishName.trim()}
            onClick={() =>
              send(
                `/api/places/${placeId}/dishes`,
                {
                  name: dishName,
                  priceMinor: dishPrice.trim()
                    ? Math.round(Number(dishPrice.trim()) * 100)
                    : undefined,
                  currency: dishPrice.trim() ? "INR" : undefined,
                  halalScope: dishScope,
                  sourceUrl: sourceUrl.trim() || undefined,
                },
                (parsed) =>
                  parsed.status === "accepted"
                    ? "Added to the menu."
                    : "Submitted — it will appear once a moderator reviews it.",
              )
            }
          >
            Add dish
          </Button>
        </TabsContent>

        <TabsContent value="duplicate" className="mt-3 grid max-w-xl gap-3">
          <Input
            aria-label="The other place's id"
            value={duplicateId}
            placeholder="The other place's id (from its URL)"
            onChange={(event) => setDuplicateId(event.target.value.trim())}
          />
          <Textarea
            aria-label="How do you know they are the same venue?"
            rows={2}
            value={note}
            placeholder="How do you know they are the same venue?"
            onChange={(event) => setNote(event.target.value)}
          />
          <p className={hint}>
            A merge moves every visit, evidence item, photo, save and list entry
            onto the place that is kept. Nothing is discarded.
          </p>
          <Button
            size="lg"
            className="justify-self-start"
            disabled={busy || !duplicateId}
            onClick={() =>
              send(
                `/api/places/${placeId}/duplicates`,
                { duplicateOfPlaceId: duplicateId, note: note.trim() || undefined },
                () => "Reported. A moderator will review the merge.",
              )
            }
          >
            Report duplicate
          </Button>
        </TabsContent>

        <TabsContent value="report" className="mt-3 grid max-w-xl gap-3">
          <SelectField
            id="contribute-report-reason"
            label="What is the problem?"
            value={reportReason}
            onValueChange={setReportReason}
            options={REPORT_REASONS.map((reason) => ({
              value: reason,
              label: REPORT_REASON_COPY[reason],
            }))}
          />
          <Textarea
            aria-label="What happened?"
            rows={3}
            value={reportDetail}
            placeholder="What happened?"
            onChange={(event) => setReportDetail(event.target.value)}
          />
          <p className={hint}>
            Every decision on a report can be appealed. You can follow yours on{" "}
            <a href="/contributions">your contributions page</a>.
          </p>
          <Button
            size="lg"
            className="justify-self-start"
            disabled={busy}
            onClick={() =>
              send(
                "/api/reports",
                {
                  targetType: "place",
                  targetId: placeId,
                  reason: reportReason,
                  detail: reportDetail.trim() || undefined,
                },
                () => "Reported. You can track and appeal this from your contributions.",
              )
            }
          >
            Send report
          </Button>
        </TabsContent>
      </Tabs>

      {message && (
        <FormMessage tone="success" className="mt-3">
          {message}
        </FormMessage>
      )}
      {error && (
        <FormMessage tone="error" className="mt-3">
          {error}
        </FormMessage>
      )}
    </section>
  );
}
