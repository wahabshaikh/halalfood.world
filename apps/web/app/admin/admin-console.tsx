"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@halalfood/ui/components/alert";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Input } from "@halalfood/ui/components/input";
import { Block, Loading } from "../../src/components/blocks";
import { FormMessage, InsufficientData, SectionIntro } from "../../src/components/section";

import { EVIDENCE_KIND_COPY, RELATIONSHIP_COPY, STATUS_COPY } from "@halalfood/core/halal-taxonomy";
import { REPORT_REASON_COPY } from "@halalfood/core/moderation";
import type { QueueEntry, ReportRow } from "../../src/lib/moderation-repository";
import type { PendingPlaceSubmission } from "../../src/lib/place-link-submissions";
import type { HiddenByModerator } from "../../src/lib/listing-moderation";
import EventsAdmin from "./events-admin";
import { signInAgainUrl } from "../../src/lib/signed-out";

/**
 * The moderation console.
 *
 * The evidence queue is ordered by an explainable priority score and every row
 * shows the reasons for its position, so a moderator can see why a submission
 * is at the top rather than trusting an opaque ranking. Every decision writes
 * an audit entry, and a rejection is required to carry a reason the
 * contributor can read.
 */

type Payload = {
  role: string;
  places: PendingPlaceSubmission[];
  hiddenPlaces?: HiddenByModerator[];
  evidence: QueueEntry[];
  edits: Array<Record<string, unknown>>;
  duplicates: Array<Record<string, unknown>>;
  reports: ReportRow[];
};

type AuditEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: number;
};

export default function AdminConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [listedPlaceId, setListedPlaceId] = useState<string | null>(null);
  const [pins, setPins] = useState<Record<string, { lat: string; lng: string }>>({});
  const [unpublishTarget, setUnpublishTarget] = useState("");
  const [unpublishReason, setUnpublishReason] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/admin/queue");
      if (response.status === 401) {
        const body = await response.json();
        if (typeof body.loginUrl === "string") window.location.href = signInAgainUrl(body);
        return;
      }
      if (response.status === 403) {
        setState("denied");
        return;
      }
      if (!response.ok) throw new Error();
      setData((await response.json()) as Payload);
      const auditResponse = await fetch("/api/admin/audit?limit=40");
      if (auditResponse.ok) {
        const body = await auditResponse.json();
        setAudit(Array.isArray(body.entries) ? body.entries : []);
      }
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function decide(kind: string, id: string, decision: string) {
    setMessage(null);
    setListedPlaceId(null);
    const pin = kind === "place" && decision === "approved" ? pins[id] : undefined;
    try {
      const response = await fetch(`/api/admin/review/${kind}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: reasons[id] ?? "",
          ...(pin && (pin.lat.trim() || pin.lng.trim()) ? { lat: pin.lat, lng: pin.lng } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 && typeof body.loginUrl === "string") {
        window.location.href = signInAgainUrl(body);
        return;
      }
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "That decision failed.");
        return;
      }
      if (kind === "place" && decision === "approved" && typeof body.placeId === "string") {
        setListedPlaceId(body.placeId);
        setMessage(
          pin && pin.lat.trim()
            ? "Listed. It is in search, its city page and the map now. Written to the audit log."
            : "Listed. It is in search and its city page now. Add a map pin on the place page to put it on the map. Written to the audit log.",
        );
      } else setMessage("Recorded, and written to the audit log.");
      await load();
    } catch {
      setMessage("Could not reach the server.");
    }
  }

  async function changeListing(placeId: string, action: "unpublish" | "restore", reason: string) {
    setMessage(null);
    setListedPlaceId(null);
    try {
      const response = await fetch(`/api/admin/places/${placeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 && typeof body.loginUrl === "string") {
        window.location.href = signInAgainUrl(body);
        return;
      }
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "That change failed.");
        return;
      }
      if (action === "restore") setListedPlaceId(placeId);
      setMessage(
        action === "unpublish"
          ? "Unpublished. It is hidden from search, city pages and the map, and can be restored below."
          : "Restored. It is listed again.",
      );
      if (action === "unpublish") {
        setUnpublishTarget("");
        setUnpublishReason("");
      }
      await load();
    } catch {
      setMessage("Could not reach the server.");
    }
  }

  function ReasonBox({ id, placeholder }: { id: string; placeholder: string }) {
    return (
      <Input
        aria-label={placeholder}
        value={reasons[id] ?? ""}
        placeholder={placeholder}
        onChange={(event) => setReasons((current) => ({ ...current, [id]: event.target.value }))}
      />
    );
  }

  if (state === "loading") return <Loading>Loading the queue…</Loading>;
  if (state === "denied")
    return (
      <InsufficientData>
        This console is for moderators. If you should have access, ask an admin to add your account
        to the moderators table.
      </InsufficientData>
    );
  if (state === "error" || !data)
    return <FormMessage tone="error">The console could not load.</FormMessage>;

  return (
    <div>
      {message && (
        <Alert role="status">
          <AlertDescription className="font-bold text-foreground">
            {message}
            {listedPlaceId && (
              <>
                {" "}
                <a className="underline" href={`/place/${listedPlaceId}`}>
                  Open the place
                </a>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Block title={<>Pending places ({data.places.length})</>}>
        <SectionIntro>
          Places sent from Add a place stay here until a moderator lists them or turns them down.
          Approve lists the place at once in search and on its city page. Add a pin to put it on
          the map too. A rejection needs a reason, and the person who sent it sees that reason on
          their contributions.
        </SectionIntro>
        {data.places.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.places.map((place) => (
              <li key={place.id}>
                <Card size="sm" className="gap-2 px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                    <span>
                      {place.name}
                      <span className="font-normal text-muted-foreground"> · {place.citySlug}</span>
                    </span>
                    <Badge variant="secondary">pending</Badge>
                  </div>
                  <p className="text-sm">{place.streetAddress}</p>
                  <p className="text-sm break-all [&_a]:font-semibold [&_a]:underline">
                    <a href={place.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                      {place.sourceUrl}
                    </a>
                  </p>
                  {place.googlePlaceId && (
                    <p className="text-xs text-muted-foreground">
                      Google place id {place.googlePlaceId}
                    </p>
                  )}
                  {place.filingNote && (
                    <p className="text-[13px] text-muted-foreground">{place.filingNote}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Reference {place.id}</p>
                  <ReasonBox
                    id={place.id}
                    placeholder="Reason (required to reject; the contributor sees it)"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label="Map pin latitude (optional)"
                      inputMode="decimal"
                      placeholder="Latitude (optional)"
                      value={pins[place.id]?.lat ?? ""}
                      onChange={(event) =>
                        setPins((current) => ({
                          ...current,
                          [place.id]: { lat: event.target.value, lng: current[place.id]?.lng ?? "" },
                        }))
                      }
                    />
                    <Input
                      aria-label="Map pin longitude (optional)"
                      inputMode="decimal"
                      placeholder="Longitude (optional)"
                      value={pins[place.id]?.lng ?? ""}
                      onChange={(event) =>
                        setPins((current) => ({
                          ...current,
                          [place.id]: { lat: current[place.id]?.lat ?? "", lng: event.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void decide("place", place.id, "approved")}>
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void decide("place", place.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={<>Unpublished places ({data.hiddenPlaces?.length ?? 0})</>}>
        <SectionIntro>
          Unpublishing hides a listed place from search, city pages and the map. Nothing is
          deleted, and it can be restored here. Places hidden by the listing rules, such as
          alcohol-led venues, are not listed here and cannot be restored.
        </SectionIntro>
        <form
          className="mb-4 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
              unpublishTarget,
            );
            if (!match) {
              setMessage("Paste a place link or id.");
              return;
            }
            if (!unpublishReason.trim()) {
              setMessage("Unpublishing needs a reason. It is kept on the audit log.");
              return;
            }
            void changeListing(match[1]!.toLowerCase(), "unpublish", unpublishReason.trim());
          }}
        >
          <Input
            aria-label="Place link or id to unpublish"
            placeholder="Place link or id"
            value={unpublishTarget}
            onChange={(event) => setUnpublishTarget(event.target.value)}
          />
          <Input
            aria-label="Reason for unpublishing (required)"
            placeholder="Reason (required; kept on the audit log)"
            value={unpublishReason}
            onChange={(event) => setUnpublishReason(event.target.value)}
          />
          <Button type="submit" variant="outline" className="justify-self-start">
            Unpublish
          </Button>
        </form>
        {!data.hiddenPlaces?.length ? (
          <InsufficientData>No places are unpublished.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.hiddenPlaces.map((place) => (
              <li key={place.placeId}>
                <Card size="sm" className="gap-2 px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                    <span>
                      {place.name}
                      <span className="font-normal text-muted-foreground"> · {place.citySlug}</span>
                    </span>
                    <Badge variant="secondary">unpublished</Badge>
                  </div>
                  {place.reason && (
                    <p className="text-[13px] text-muted-foreground">{place.reason}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Reference {place.placeId}</p>
                  <ReasonBox id={`restore-${place.placeId}`} placeholder="Note (optional)" />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        void changeListing(
                          place.placeId,
                          "restore",
                          reasons[`restore-${place.placeId}`] ?? "",
                        )
                      }
                    >
                      Restore
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={<>Evidence queue ({data.evidence.length})</>}>
        <SectionIntro>
          Ordered by conflict, open reports, declared interest, expiry, claim impact and how long a
          submission has waited.
        </SectionIntro>
        {data.evidence.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.evidence.map((entry) => (
              <li key={entry.id}>
                <Card size="sm" className="gap-2 px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold [&_a]:hover:underline">
                    <a href={`/place/${entry.placeId}`}>{entry.placeName}</a>
                    <Badge variant="secondary">priority {entry.priority}</Badge>
                  </div>
                  <p className="text-sm [&_a]:font-semibold [&_a]:hover:underline">
                    {EVIDENCE_KIND_COPY[entry.kind]} claiming{" "}
                    {STATUS_COPY[entry.claimedStatus].label} ·{" "}
                    {RELATIONSHIP_COPY[entry.relationship]}
                    {entry.incentivized ? " · rewarded" : ""}
                  </p>
                  {entry.note && (
                    <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                      {entry.note}
                    </p>
                  )}
                  <ul className="list-disc pl-4.5 text-xs text-muted-foreground">
                    {entry.rationale.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <ReasonBox
                    id={entry.id}
                    placeholder="Reason (required to reject; the contributor sees it)"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void decide("evidence", entry.id, "approved")}>
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void decide("evidence", entry.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={<>Factual edits ({data.edits.length})</>}>
        {data.edits.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.edits.map((edit) => {
              const id = String(edit.id);
              return (
                <li key={id}>
                  <Card size="sm" className="gap-2 px-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-semibold [&_a]:hover:underline">
                      <a href={`/place/${String(edit.place_id)}`}>{String(edit.place_name)}</a>
                      <Badge variant="secondary">{String(edit.field)}</Badge>
                    </div>
                    <p className="text-sm [&_a]:font-semibold [&_a]:hover:underline">
                      {String(edit.current_value ?? "(empty)")} →{" "}
                      <strong>{String(edit.proposed_value)}</strong>
                    </p>
                    {edit.source_url ? (
                      <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                        Source:{" "}
                        <a
                          href={String(edit.source_url)}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          {String(edit.source_url)}
                        </a>
                      </p>
                    ) : (
                      <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                        No source provided.
                      </p>
                    )}
                    {edit.note ? (
                      <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                        {String(edit.note)}
                      </p>
                    ) : null}
                    <ReasonBox id={id} placeholder="Reason for the contributor" />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void decide("edit", id, "accepted")}>Accept</Button>
                      <Button
                        variant="secondary"
                        onClick={() => void decide("edit", id, "needs-evidence")}
                      >
                        Needs evidence
                      </Button>
                      <Button variant="outline" onClick={() => void decide("edit", id, "rejected")}>
                        Reject
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block title={<>Duplicates ({data.duplicates.length})</>}>
        {data.duplicates.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.duplicates.map((report) => {
              const id = String(report.id);
              return (
                <li key={id}>
                  <Card size="sm" className="gap-2 px-4">
                    <p className="text-sm [&_a]:font-semibold [&_a]:hover:underline">
                      <a href={`/place/${String(report.place_id)}`}>{String(report.place_name)}</a>{" "}
                      duplicates{" "}
                      <a href={`/place/${String(report.duplicate_of_place_id)}`}>
                        {String(report.duplicate_of_name)}
                      </a>
                    </p>
                    {report.note ? (
                      <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                        {String(report.note)}
                      </p>
                    ) : null}
                    <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                      Merging moves every visit, evidence item, photo, save and list entry onto the
                      place that is kept.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void decide("duplicate", id, "merge")}>Merge</Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block title={<>Open reports ({data.reports.length})</>}>
        {data.reports.length === 0 ? (
          <InsufficientData>Nothing waiting.</InsufficientData>
        ) : (
          <ul className="grid gap-3">
            {data.reports.map((report) => (
              <li key={report.id}>
                <Card size="sm" className="gap-2 px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold [&_a]:hover:underline">
                    <span>{report.targetType}</span>
                    <Badge variant="secondary">
                      {REPORT_REASON_COPY[report.reason as keyof typeof REPORT_REASON_COPY] ??
                        report.reason}
                    </Badge>
                  </div>
                  {report.detail && (
                    <p className="text-[13px] break-words text-muted-foreground [&_a]:underline">
                      {report.detail}
                    </p>
                  )}
                  <ReasonBox id={report.id} placeholder="Resolution note" />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void decide("report", report.id, "upheld")}>
                      Uphold
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void decide("report", report.id, "dismissed")}
                    >
                      Dismiss
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <EventsAdmin />

      <Block title={<>Audit log</>}>
        <SectionIntro>
          Who changed halal- or ranking-sensitive data, when, why and from what source.
        </SectionIntro>
        <ul className="divide-y text-[13px]">
          {audit.map((entry) => (
            <li key={entry.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2">
              <span className="font-semibold text-muted-foreground tabular-nums">
                {new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")}
              </span>
              <span className="font-bold">{entry.action}</span>
              <span className="text-muted-foreground">
                {entry.targetType}/{entry.targetId.slice(0, 8)}
              </span>
              {entry.reason && <span className="basis-full">{entry.reason}</span>}
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}
