"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@halalfood/ui/components/button";
import { Input } from "@halalfood/ui/components/input";
import { Textarea } from "@halalfood/ui/components/textarea";
import { Field, FieldDescription, FieldLabel } from "@halalfood/ui/components/field";
import { Block } from "../../src/components/blocks";
import { FormMessage, SectionIntro } from "../../src/components/section";
import type { EventSummary } from "../../src/lib/events-repository";

/** One vendor per line: `Name | what they sell | place id (optional)`. */
function parseVendorLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, note, placeId] = line.split("|").map((part) => part.trim());
      return { name, note: note || null, placeId: placeId || null };
    });
}

/**
 * Publish and cancel halal food events. A vendor with a place id shows that
 * place's evidence-based status; one without shows "Unverified", which only
 * means nobody has checked it on the site.
 */
export default function EventsAdmin() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/events", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { events?: EventSummary[] };
      setEvents(Array.isArray(body.events) ? body.events : []);
    } catch {
      // The list is a convenience; publishing still works without it.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const when = (key: string) => {
      const value = text(key);
      return value ? new Date(value).getTime() : null;
    };
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: text("title"),
          citySlug: text("citySlug"),
          venue: text("venue"),
          address: text("address") || null,
          description: text("description") || null,
          startsAt: when("startsAt"),
          endsAt: when("endsAt"),
          vendors: parseVendorLines(text("vendors")),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; path?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not publish the event.");
      setMessage({ tone: "success", text: `Published. ${body.path ?? ""}` });
      (event.target as HTMLFormElement).reset();
      void load();
    } catch (caught) {
      setMessage({ tone: "error", text: (caught as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      void load();
    } catch {
      setMessage({ tone: "error", text: "Could not cancel that event." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Block title={<>Events</>}>
      <SectionIntro>
        Iftar walks, Eid markets and food festivals. Times are in your time zone. Link a vendor to a listed
        place with its place id to show that place&rsquo;s status; leave it off and the vendor shows
        &ldquo;Unverified&rdquo;.
      </SectionIntro>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      <form className="mb-6 grid gap-3" onSubmit={(event) => void publish(event)}>
        <Field>
          <FieldLabel htmlFor="event-title">Title</FieldLabel>
          <Input id="event-title" name="title" required maxLength={80} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="event-city">City slug</FieldLabel>
            <Input id="event-city" name="citySlug" required placeholder="mumbai" />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-venue">Venue</FieldLabel>
            <Input id="event-venue" name="venue" required maxLength={120} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="event-address">Address (optional)</FieldLabel>
          <Input id="event-address" name="address" maxLength={200} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="event-starts">Starts</FieldLabel>
            <Input id="event-starts" name="startsAt" type="datetime-local" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-ends">Ends (optional)</FieldLabel>
            <Input id="event-ends" name="endsAt" type="datetime-local" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="event-description">Description (optional)</FieldLabel>
          <Textarea id="event-description" name="description" rows={3} maxLength={600} />
        </Field>
        <Field>
          <FieldLabel htmlFor="event-vendors">Vendors</FieldLabel>
          <Textarea
            id="event-vendors"
            name="vendors"
            rows={5}
            placeholder={"Malpua Lane | Malpua, phirni | 3f2504e0-4f89-11d3-9a0c-0305e82c3301\nStall 14 | Seekh"}
          />
          <FieldDescription>One per line: name | what they sell | place id (optional).</FieldDescription>
        </Field>
        <div>
          <Button type="submit" disabled={busy}>
            Publish event
          </Button>
        </div>
      </form>

      {events.length > 0 && (
        <ul className="divide-y text-sm">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <a href={`/event/${event.id}`} className="font-bold hover:underline">
                {event.title}
              </a>
              <span className="text-muted-foreground">
                {new Date(event.startsAt).toLocaleString()} · {event.going} going
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel(event.id)}>
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}
