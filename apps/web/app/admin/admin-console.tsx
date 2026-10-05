"use client";

import { useState } from "react";
import { ArrowDown01Icon, ArrowUp01Icon, Delete02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@halalfood/ui/lib/utils";
import { Icon, buttonClass } from "../../src/components/kit";
import { Segmented, api, errorText, toast } from "../../src/components/kit-client";
import { timeAgo } from "../../src/components/time-ago";

type Report = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  reasonLabel: string;
  detail: string | null;
  createdAt: number;
  reporter: string | null;
  target: { title: string; subtitle: string | null; href: string | null };
  primary: string;
  primaryLabel: string;
};

type EventRow = { id: string; title: string; citySlug: string; venue: string; startsAt: number; status: "draft" | "published" | "cancelled"; stalls: number };
type City = { slug: string; name: string };

export function AdminConsole({ reports, events, cities }: { reports: Report[]; events: EventRow[]; cities: City[] }) {
  const [tab, setTab] = useState<"reports" | "events">("reports");
  return (
    <div className="grid gap-5 px-5 pb-10">
      <div className="max-w-sm">
        <Segmented
          label="Moderation"
          value={tab}
          onChange={setTab}
          options={[
            { value: "reports", label: `Reports${reports.length ? ` · ${reports.length}` : ""}` },
            { value: "events", label: "Events" },
          ]}
        />
      </div>
      {tab === "reports" ? <Reports initial={reports} /> : <Events initial={events} cities={cities} />}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Reports                                                                   */
/* ------------------------------------------------------------------------ */

function Reports({ initial }: { initial: Report[] }) {
  const [reports, setReports] = useState(initial);
  const done = (id: string) => setReports((current) => current.filter((report) => report.id !== id));
  if (!reports.length) return <p className="py-10 text-center text-sm font-semibold text-muted-foreground">No open reports.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {reports.map((report) => (
        <ReportCard key={report.id} report={report} onDone={() => done(report.id)} />
      ))}
    </div>
  );
}

function ReportCard({ report, onDone }: { report: Report; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"idle" | "merge" | "fix">("idle");
  const [details, setDetails] = useState({ name: "", address: "", telephone: "", website: "" });

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await api(`/api/admin/reports/${report.id}`, { method: "POST", json: { action, ...extra } });
      toast(action === "dismiss" ? "Dismissed" : "Done");
      onDone();
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };

  const primary = () => {
    if (report.primary === "merge") return setMode("merge");
    if (report.primary === "fix-details") return setMode("fix");
    void act(report.primary);
  };

  return (
    <article className="grid gap-3 rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-warning-muted px-2.5 py-0.5 text-xs font-black text-warning-strong">{report.reasonLabel}</span>
        <span className="text-xs font-bold text-muted-foreground uppercase">{report.targetType}</span>
        <span className="ml-auto text-xs font-bold text-muted-foreground">{timeAgo(report.createdAt)}</span>
      </div>
      <div className="grid gap-0.5">
        {report.target.href ? (
          <a href={report.target.href} className="text-[15px] font-black text-foreground underline-offset-4 hover:underline">
            {report.target.title}
          </a>
        ) : (
          <strong className="text-[15px] font-black">{report.target.title}</strong>
        )}
        {report.target.subtitle && <span className="line-clamp-2 text-[13px] font-semibold text-muted-foreground">{report.target.subtitle}</span>}
      </div>
      {report.detail && <p className="rounded-xl bg-muted px-3 py-2 text-sm">“{report.detail}”</p>}
      <span className="text-xs font-bold text-muted-foreground">Reported by {report.reporter ? `@${report.reporter}` : "a deleted account"}</span>

      {mode === "merge" && <MergePicker sourceId={report.targetId} busy={busy} onPick={(intoPlaceId) => act("merge", { intoPlaceId })} />}
      {mode === "fix" && (
        <div className="grid gap-2">
          {(["name", "address", "telephone", "website"] as const).map((field) => (
            <input
              key={field}
              value={details[field]}
              onChange={(event) => setDetails({ ...details, [field]: event.target.value })}
              placeholder={field[0].toUpperCase() + field.slice(1)}
              className="h-11 rounded-xl border border-input px-3 text-sm font-semibold outline-none focus:border-foreground"
            />
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              act("fix-details", {
                details: Object.fromEntries(Object.entries(details).filter(([, value]) => value.trim())),
              })
            }
            className={buttonClass("dark", "md")}
          >
            Save details
          </button>
        </div>
      )}

      {mode === "idle" && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={primary} disabled={busy} className={buttonClass(report.primary === "suspend-user" ? "danger" : "dark", "md")}>
            {report.primaryLabel}
          </button>
          <button type="button" onClick={() => act("dismiss")} disabled={busy} className={buttonClass("outline", "md")}>
            Dismiss
          </button>
        </div>
      )}
    </article>
  );
}

function PlaceSearch({ onPick, placeholder }: { onPick: (place: { id: string; name: string; area: string }) => void; placeholder: string }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<{ id: string; name: string; area: string }[]>([]);
  const [timer, setTimer] = useState<number | null>(null);
  const search = (value: string) => {
    setQuery(value);
    if (timer) window.clearTimeout(timer);
    if (value.trim().length < 2) return setPlaces([]);
    setTimer(
      window.setTimeout(async () => {
        try {
          const body = await api<{ places: { id: string; name: string; area: string }[] }>(`/api/search?q=${encodeURIComponent(value.trim())}`);
          setPlaces(body.places);
        } catch {
          setPlaces([]);
        }
      }, 200),
    );
  };
  return (
    <div className="grid gap-1">
      <label className="flex h-11 items-center gap-2 rounded-xl border border-input px-3">
        <Icon icon={Search01Icon} size={16} />
        <span className="sr-only">{placeholder}</span>
        <input value={query} onChange={(event) => search(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
      </label>
      {places.map((place) => (
        <button
          key={place.id}
          type="button"
          onClick={() => {
            onPick(place);
            setQuery("");
            setPlaces([]);
          }}
          className="grid rounded-lg px-3 py-2 text-left hover:bg-muted"
        >
          <strong className="text-sm font-extrabold">{place.name}</strong>
          <span className="text-xs font-semibold text-muted-foreground">{place.area}</span>
        </button>
      ))}
    </div>
  );
}

function MergePicker({ sourceId, busy, onPick }: { sourceId: string; busy: boolean; onPick: (id: string) => void }) {
  const [into, setInto] = useState<{ id: string; name: string } | null>(null);
  return (
    <div className="grid gap-2">
      <span className="text-sm font-extrabold">Merge into…</span>
      {into ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2">
          <strong className="text-sm">{into.name}</strong>
          <button type="button" onClick={() => setInto(null)} className="text-xs font-extrabold underline">
            Change
          </button>
        </div>
      ) : (
        <PlaceSearch placeholder="Search the place to keep" onPick={(place) => place.id !== sourceId && setInto(place)} />
      )}
      <button type="button" disabled={!into || busy} onClick={() => into && onPick(into.id)} className={buttonClass("dark", "md")}>
        Merge
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Events                                                                    */
/* ------------------------------------------------------------------------ */

type Stall = { name: string; note: string; placeId: string | null; placeName: string | null };
type Draft = { id: string | null; title: string; citySlug: string; venue: string; address: string; startsAt: string; endsAt: string; description: string; stalls: Stall[] };

function toLocalInput(at: number | null): string {
  if (!at) return "";
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Events({ initial, cities }: { initial: EventRow[]; cities: City[] }) {
  const [events, setEvents] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);

  const open = async (id: string | null) => {
    if (!id) {
      setDraft({ id: null, title: "", citySlug: cities[0]?.slug ?? "", venue: "", address: "", startsAt: "", endsAt: "", description: "", stalls: [] });
      return;
    }
    try {
      const { event } = await api<{
        event: EventRow & { address: string | null; endsAt: number | null; description: string | null; stallList: { name: string; note: string | null; placeId: string | null; placeName: string | null }[] };
      }>(`/api/admin/events/${id}`);
      setDraft({
        id,
        title: event.title,
        citySlug: event.citySlug,
        venue: event.venue,
        address: event.address ?? "",
        startsAt: toLocalInput(event.startsAt),
        endsAt: toLocalInput(event.endsAt),
        description: event.description ?? "",
        stalls: event.stallList.map((stall) => ({ name: stall.name, note: stall.note ?? "", placeId: stall.placeId, placeName: stall.placeName })),
      });
    } catch (error) {
      toast(errorText(error));
    }
  };

  const reload = async () => {
    const body = await api<{ events: EventRow[] }>("/api/admin/events");
    setEvents(body.events);
  };

  if (draft) return <EventForm draft={draft} cities={cities} onClose={() => setDraft(null)} onSaved={async () => (setDraft(null), await reload())} />;

  return (
    <div className="grid gap-3">
      <button type="button" onClick={() => open(null)} className={buttonClass("dark", "md", "w-fit px-5")}>
        New event
      </button>
      <ul className="grid">
        {events.map((event) => (
          <li key={event.id}>
            <button type="button" onClick={() => open(event.id)} className="flex w-full items-center gap-3 border-b border-border/70 py-3 text-left">
              <span className="grid min-w-0 flex-1">
                <strong className="truncate text-[15px] font-extrabold">{event.title}</strong>
                <span className="truncate text-[13px] font-semibold text-muted-foreground">
                  {new Date(event.startsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {event.venue} · {event.stalls} stalls
                </span>
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-black",
                  event.status === "published" ? "bg-success-muted text-success" : event.status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-secondary",
                )}
              >
                {event.status === "published" ? "Live" : event.status === "cancelled" ? "Cancelled" : "Draft"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {events.length === 0 && <p className="text-sm font-semibold text-muted-foreground">No events yet.</p>}
    </div>
  );
}

function EventForm({ draft: initial, cities, onClose, onSaved }: { draft: Draft; cities: City[]; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [stallName, setStallName] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const field = "h-11 rounded-xl border border-input px-3 text-sm font-semibold outline-none focus:border-foreground";

  const save = async (status: "draft" | "published" | "cancelled") => {
    setBusy(true);
    try {
      const body = {
        title: draft.title,
        citySlug: draft.citySlug,
        venue: draft.venue,
        address: draft.address,
        description: draft.description,
        startsAt: draft.startsAt ? new Date(draft.startsAt).getTime() : null,
        endsAt: draft.endsAt ? new Date(draft.endsAt).getTime() : null,
        status,
        stalls: draft.stalls.map((stall) => ({ name: stall.name, note: stall.note, placeId: stall.placeId })),
      };
      await api(draft.id ? `/api/admin/events/${draft.id}` : "/api/admin/events", { method: draft.id ? "PUT" : "POST", json: body });
      toast(status === "published" ? "Published" : "Saved");
      onSaved();
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft.id || !window.confirm("Delete this event?")) return;
    try {
      await api(`/api/admin/events/${draft.id}`, { method: "DELETE" });
      onSaved();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const moveStall = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.stalls.length) return;
    const stalls = [...draft.stalls];
    [stalls[index], stalls[target]] = [stalls[target], stalls[index]];
    set({ stalls });
  };

  return (
    <div className="grid max-w-2xl gap-3">
      <button type="button" onClick={onClose} className="w-fit text-sm font-extrabold underline">
        Back to events
      </button>
      <input value={draft.title} onChange={(event) => set({ title: event.target.value })} placeholder="Title" aria-label="Title" className={field} />
      <select value={draft.citySlug} onChange={(event) => set({ citySlug: event.target.value })} aria-label="City" className={field}>
        {cities.map((city) => (
          <option key={city.slug} value={city.slug}>
            {city.name}
          </option>
        ))}
      </select>
      <input value={draft.venue} onChange={(event) => set({ venue: event.target.value })} placeholder="Venue" aria-label="Venue" className={field} />
      <input value={draft.address} onChange={(event) => set({ address: event.target.value })} placeholder="Address" aria-label="Address" className={field} />
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs font-extrabold">
          Starts
          <input type="datetime-local" value={draft.startsAt} onChange={(event) => set({ startsAt: event.target.value })} className={field} />
        </label>
        <label className="grid gap-1 text-xs font-extrabold">
          Ends
          <input type="datetime-local" value={draft.endsAt} onChange={(event) => set({ endsAt: event.target.value })} className={field} />
        </label>
      </div>
      <textarea
        value={draft.description}
        onChange={(event) => set({ description: event.target.value })}
        placeholder="Description"
        aria-label="Description"
        rows={3}
        className="resize-none rounded-xl border border-input px-3 py-2 text-sm font-semibold outline-none focus:border-foreground"
      />

      <section className="grid gap-2">
        <h3 className="text-[15px] font-black">Stalls</h3>
        <ul className="grid gap-1.5">
          {draft.stalls.map((stall, index) => (
            <li key={`${stall.name}-${index}`} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
              <span className="grid min-w-0 flex-1">
                <strong className="truncate text-sm">{stall.name}</strong>
                <span className="text-xs font-semibold text-muted-foreground">{stall.placeName ? `Linked: ${stall.placeName}` : "Not linked to a place"}</span>
              </span>
              <button type="button" onClick={() => moveStall(index, -1)} aria-label="Move up" className="size-8">
                <Icon icon={ArrowUp01Icon} size={14} className="mx-auto" />
              </button>
              <button type="button" onClick={() => moveStall(index, 1)} aria-label="Move down" className="size-8">
                <Icon icon={ArrowDown01Icon} size={14} className="mx-auto" />
              </button>
              <button type="button" onClick={() => set({ stalls: draft.stalls.filter((_, i) => i !== index) })} aria-label="Remove stall" className="size-8">
                <Icon icon={Delete02Icon} size={14} className="mx-auto" />
              </button>
            </li>
          ))}
        </ul>
        <PlaceSearch
          placeholder="Search a place to add as a stall"
          onPick={(place) => set({ stalls: [...draft.stalls, { name: place.name, note: "", placeId: place.id, placeName: place.name }] })}
        />
        <div className="flex gap-2">
          <input value={stallName} onChange={(event) => setStallName(event.target.value)} placeholder="Or type a stall name" aria-label="Stall name" className={cn(field, "flex-1")} />
          <button
            type="button"
            onClick={() => {
              if (!stallName.trim()) return;
              set({ stalls: [...draft.stalls, { name: stallName.trim(), note: "", placeId: null, placeName: null }] });
              setStallName("");
            }}
            className={buttonClass("outline", "md", "px-4")}
          >
            Add
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" onClick={() => save("published")} disabled={busy} className={buttonClass("primary", "md", "px-5")}>
          Publish
        </button>
        <button type="button" onClick={() => save("draft")} disabled={busy} className={buttonClass("outline", "md", "px-5")}>
          Save draft
        </button>
        {draft.id && (
          <>
            <button type="button" onClick={() => save("cancelled")} disabled={busy} className={buttonClass("ghost", "md", "px-5")}>
              Cancel event
            </button>
            <button type="button" onClick={remove} className={buttonClass("ghost", "md", "px-5 text-destructive")}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
