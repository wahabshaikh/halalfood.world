"use client";

import { useState } from "react";
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

  return (
    <section className="contribute-panel" aria-labelledby="contribute-title">
      <div className="place-section-heading">
        <div>
          <p className="eyebrow">IMPROVE THIS ENTRY</p>
          <h2 id="contribute-title">Correct, add or report</h2>
        </div>
      </div>

      <div className="chip-row contribute-tabs" role="tablist">
        {(
          [
            ["edit", "Correct a fact"],
            ["dish", "Add a dish"],
            ["duplicate", "Report a duplicate"],
            ["report", "Report a problem"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`filter-chip${tab === key ? " is-active" : ""}`}
            onClick={() => {
              setTab(key);
              setMessage(null);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "edit" && (
        <div className="contribute-form">
          <label className="check-in-select">
            <span>What is wrong?</span>
            <select
              className="ui-input"
              value={field}
              onChange={(event) => setField(event.target.value as EditableField)}
            >
              {EDITABLE_FIELDS.map((option) => (
                <option key={option} value={option}>
                  {EDITABLE_FIELD_COPY[option]}
                </option>
              ))}
            </select>
          </label>
          <input
            className="ui-input"
            value={proposedValue}
            placeholder="The correct value"
            onChange={(event) => setProposedValue(event.target.value)}
          />
          <input
            className="ui-input"
            value={sourceUrl}
            placeholder="Source link (https://…)"
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          <textarea
            className="ui-input"
            rows={2}
            value={note}
            placeholder="How do you know?"
            onChange={(event) => setNote(event.target.value)}
          />
          <label className="check-in-select">
            <span>Your relationship with this restaurant</span>
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
          {SENSITIVE_FIELDS.has(field) && (
            <p className="check-in-hint">
              This fact changes a halal conclusion, so it always goes to a
              moderator and needs a source or an explanation.
            </p>
          )}
          <button
            type="button"
            className="ui-button ui-button-default"
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
          </button>
        </div>
      )}

      {tab === "dish" && (
        <div className="contribute-form">
          <input
            className="ui-input"
            value={dishName}
            placeholder="Dish name"
            onChange={(event) => setDishName(event.target.value)}
          />
          <input
            className="ui-input"
            inputMode="decimal"
            value={dishPrice}
            placeholder="Price (optional)"
            onChange={(event) => setDishPrice(event.target.value)}
          />
          <label className="check-in-select">
            <span>Halal scope of this dish</span>
            <select
              className="ui-input"
              value={dishScope}
              onChange={(event) => setDishScope(event.target.value)}
            >
              <option value="unknown">Not sure</option>
              <option value="halal">Halal</option>
              <option value="not-halal">Not halal</option>
            </select>
          </label>
          <input
            className="ui-input"
            value={sourceUrl}
            placeholder="Menu link or source (https://…)"
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          <p className="check-in-hint">
            A dish with a cited source publishes immediately. Without one it
            waits for review, so the menu cannot be rewritten without provenance.
          </p>
          <button
            type="button"
            className="ui-button ui-button-default"
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
          </button>
        </div>
      )}

      {tab === "duplicate" && (
        <div className="contribute-form">
          <input
            className="ui-input"
            value={duplicateId}
            placeholder="The other place's id (from its URL)"
            onChange={(event) => setDuplicateId(event.target.value.trim())}
          />
          <textarea
            className="ui-input"
            rows={2}
            value={note}
            placeholder="How do you know they are the same venue?"
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="check-in-hint">
            A merge moves every visit, evidence item, photo, save and list entry
            onto the place that is kept. Nothing is discarded.
          </p>
          <button
            type="button"
            className="ui-button ui-button-default"
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
          </button>
        </div>
      )}

      {tab === "report" && (
        <div className="contribute-form">
          <label className="check-in-select">
            <span>What is the problem?</span>
            <select
              className="ui-input"
              value={reportReason}
              onChange={(event) =>
                setReportReason(event.target.value as (typeof REPORT_REASONS)[number])
              }
            >
              {REPORT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {REPORT_REASON_COPY[reason]}
                </option>
              ))}
            </select>
          </label>
          <textarea
            className="ui-input"
            rows={3}
            value={reportDetail}
            placeholder="What happened?"
            onChange={(event) => setReportDetail(event.target.value)}
          />
          <p className="check-in-hint">
            Every decision on a report can be appealed. You can follow yours on{" "}
            <a href="/contributions">your contributions page</a>.
          </p>
          <button
            type="button"
            className="ui-button ui-button-default"
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
          </button>
        </div>
      )}

      {message && (
        <p className="contribute-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="check-in-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
