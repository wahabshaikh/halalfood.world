"use client";

import { useState } from "react";
import { buttonClass } from "@/components/hf/kit";
import { api, errorText, toast } from "@/components/hf/kit-client";
import { TextField } from "@/components/hf/people-client";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

type Day = { day: number; closed: boolean; open: string; close: string };
type Dish = { name: string; section: string; description: string; price: string };
type View = { day: string; views: number };

function startDays(hours: { day: number; closed: boolean; open: string | null; close: string | null }[] | null): Day[] {
  return DAYS.map((_, day) => {
    const found = hours?.find((item) => item.day === day);
    if (!found) return { day, closed: false, open: "11:00", close: "22:00" };
    return { day, closed: found.closed, open: found.open || "11:00", close: found.close || "22:00" };
  });
}

/** Hours, menu, photos, certificate and the view count for a paid claim. */
export function ManagePanel({
  claimId,
  canEdit,
  statusLine,
  initialHours,
  initialNote,
  initialMenu,
  views,
}: {
  claimId: string;
  canEdit: boolean;
  statusLine: string;
  initialHours: { day: number; closed: boolean; open: string | null; close: string | null }[] | null;
  initialNote: string;
  initialMenu: Dish[];
  views: View[];
}) {
  const [days, setDays] = useState<Day[]>(() => startDays(initialHours));
  const [note, setNote] = useState(initialNote);
  const [dishes, setDishes] = useState<Dish[]>(initialMenu.length ? initialMenu : [{ name: "", section: "", description: "", price: "" }]);
  const [certifier, setCertifier] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const total = views.reduce((sum, row) => sum + row.views, 0);
  const recent = views.slice(-7);

  const saveHours = async () => {
    setBusy("hours");
    try {
      await api(`/api/owner-claims/${claimId}/hours`, {
        method: "PUT",
        json: {
          note,
          week: days.map((day) =>
            day.closed ? { day: day.day, closed: true, open: null, close: null } : { day: day.day, closed: false, open: day.open, close: day.close },
          ),
        },
      });
      toast("Hours saved");
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const saveMenu = async () => {
    setBusy("menu");
    try {
      const items = dishes
        .map((dish) => ({
          name: dish.name.trim(),
          section: dish.section.trim(),
          description: dish.description.trim(),
          price: dish.price.trim() === "" ? null : Number(dish.price),
          currency: "USD",
        }))
        .filter((dish) => dish.name);
      await api(`/api/owner-claims/${claimId}/menu`, { method: "PUT", json: { items } });
      toast("Menu saved");
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (path: "photos" | "certificate", file: File | null) => {
    if (!file) return;
    setBusy(path);
    try {
      const form = new FormData();
      form.set("file", file);
      if (path === "certificate") {
        form.set("certifier", certifier);
        if (expiresOn) form.set("expiresOn", expiresOn);
      }
      await api(`/api/owner-claims/${claimId}/${path}`, { method: "POST", body: form });
      toast(path === "certificate" ? "Certificate sent for review" : "Photo added");
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-8">
      <p className="text-sm font-extrabold text-foreground">{statusLine}</p>
      <section className="grid gap-2" aria-labelledby="views-title">
        <h2 id="views-title" className="text-[15px] font-black">
          Page views
        </h2>
        <p className="text-[28px] leading-none font-black tabular-nums">{total}</p>
        <p className="text-sm font-semibold text-muted-foreground">Last 30 days. One count per network per day. Not a bill.</p>
        <ul className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-muted-foreground">
          {recent.map((row) => (
            <li key={row.day} className="grid gap-1 rounded-xl bg-secondary px-1 py-2">
              <span className="text-sm font-black text-foreground tabular-nums">{row.views}</span>
              <span>{row.day.slice(5)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3" aria-labelledby="hours-title">
        <h2 id="hours-title" className="text-[15px] font-black">
          Hours
        </h2>
        <ul className="grid gap-2">
          {days.map((day, index) => (
            <li key={day.day} className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={!day.closed}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setDays((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, closed: !event.target.checked } : item)))
                  }
                />
                {DAYS[index]}
              </label>
              {day.closed ? (
                <span className="text-sm font-semibold text-muted-foreground">Closed</span>
              ) : (
                <span className="flex items-center gap-2">
                  <input
                    type="time"
                    value={day.open}
                    disabled={!canEdit}
                    onChange={(event) => setDays((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, open: event.target.value } : item)))}
                    className="rounded-xl border border-input px-2 py-1 text-sm font-semibold"
                  />
                  <input
                    type="time"
                    value={day.close}
                    disabled={!canEdit}
                    onChange={(event) => setDays((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, close: event.target.value } : item)))}
                    className="rounded-xl border border-input px-2 py-1 text-sm font-semibold"
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
        <TextField label="Note (optional)" value={note} onChange={setNote} maxLength={160} placeholder="Last seating 20:30" />
        <button type="button" disabled={!canEdit || busy !== null} onClick={saveHours} className={buttonClass("outline", "md")}>
          {busy === "hours" ? "Saving…" : "Save hours"}
        </button>
      </section>

      <section className="grid gap-3" aria-labelledby="menu-title">
        <h2 id="menu-title" className="text-[15px] font-black">
          Menu
        </h2>
        <p className="text-sm font-semibold text-muted-foreground">Shown as the restaurant’s menu. It does not change halal facts. Prices are in USD.</p>
        {dishes.map((dish, index) => (
          <div key={index} className="grid gap-2 rounded-2xl border border-border p-3">
            <TextField label="Dish" value={dish.name} onChange={(name) => setDishes((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, name } : item)))} maxLength={160} placeholder="Haleem" />
            <TextField label="Section" value={dish.section} onChange={(section) => setDishes((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, section } : item)))} maxLength={80} placeholder="Mains" />
            <TextField label="Price" value={dish.price} onChange={(price) => setDishes((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, price } : item)))} maxLength={12} placeholder="12.50" />
            <button type="button" className="justify-self-start text-sm font-bold text-muted-foreground underline" onClick={() => setDishes((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className={buttonClass("outline", "md")} onClick={() => setDishes((current) => [...current, { name: "", section: "", description: "", price: "" }])}>
          Add a dish
        </button>
        <button type="button" disabled={!canEdit || busy !== null} onClick={saveMenu} className={buttonClass("primary", "md")}>
          {busy === "menu" ? "Saving…" : "Save menu"}
        </button>
      </section>

      <section className="grid gap-3" aria-labelledby="photos-title">
        <h2 id="photos-title" className="text-[15px] font-black">
          Photos
        </h2>
        <p className="text-sm font-semibold text-muted-foreground">JPEG, PNG or WebP, up to 8 MB. They are labelled “Restaurant” once the claim is public.</p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={!canEdit || busy !== null}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            void upload("photos", file);
          }}
          className="text-sm font-semibold"
        />
      </section>

      <section className="grid gap-3" aria-labelledby="certificate-title">
        <h2 id="certificate-title" className="text-[15px] font-black">
          Halal certificate
        </h2>
        <p className="text-sm font-semibold text-muted-foreground">
          A photo of the certificate. A moderator reviews it before it can count as Halal certified. Paying does not approve it.
        </p>
        <TextField label="Certifier" value={certifier} onChange={setCertifier} maxLength={120} placeholder="HMC" />
        <label className="grid gap-1.5">
          <span className="text-sm font-extrabold">Expiry date</span>
          <input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} className="min-h-11 rounded-[14px] border border-input px-3 text-[15px] font-semibold" />
        </label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={!canEdit || busy !== null}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            void upload("certificate", file);
          }}
          className="text-sm font-semibold"
        />
      </section>
    </div>
  );
}
