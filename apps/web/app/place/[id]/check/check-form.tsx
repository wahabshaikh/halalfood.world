"use client";

import { useEffect, useRef, useState } from "react";
import { Camera01Icon, Cancel01Icon, PencilEdit02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { FACTS, type Answer, type Fact, type PlaceStatus } from "@halalfood/core/halal";
import { MAX_DISHES, VERDICTS, VERDICT_LABEL, type Verdict } from "@halalfood/core/check";
import { cn } from "@halalfood/ui/lib/utils";
import { Icon, IconLink, Meter, PlaceArt, buttonClass } from "../../../../src/components/kit";
import { api, errorText, toast } from "../../../../src/components/kit-client";
import { clearFormDraft, readFormDraft, saveFormDraft } from "../../../../src/lib/form-draft";

const QUESTIONS: Record<Fact, { title: string; hint: string }> = {
  owned: { title: "Is it Muslim-owned?", hint: "Ask the staff, or look for a sign." },
  certified: { title: "Is it halal certified?", hint: "Look for a certificate near the counter." },
  pork: { title: "Does it serve pork?", hint: "Check the menu." },
  alcohol: { title: "Does it serve alcohol?", hint: "Check the menu or the drinks fridge." },
};

const OPTIONS: { value: Exclude<Answer, null>; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

type Draft = {
  answers: Record<Fact, Answer>;
  verdict: Verdict | null;
  dishes: string[];
  note: string;
  share: boolean;
  key: string;
};

function newKey() {
  return crypto.randomUUID().replace(/-/g, "");
}

function emptyDraft(): Draft {
  return { answers: { owned: null, certified: null, pork: null, alcohol: null }, verdict: null, dishes: [], note: "", share: true, key: newKey() };
}

type Sent = { before: PlaceStatus; status: PlaceStatus; message: string };

export function CheckForm({ placeId, placeName, before, isPrivate }: { placeId: string; placeName: string; before: PlaceStatus; isPrivate: boolean }) {
  const storageKey = `halalfood:check-draft:${placeId}`;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [restored, setRestored] = useState(false);
  const [dishDraft, setDishDraft] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = readFormDraft(storageKey) as Partial<Draft> | null;
    if (saved && typeof saved === "object" && saved.answers) setDraft({ ...emptyDraft(), ...saved });
    setRestored(true);
  }, [storageKey]);
  useEffect(() => {
    if (restored && !sent) saveFormDraft(storageKey, draft);
  }, [draft, restored, sent, storageKey]);

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const ready = FACTS.some((fact) => draft.answers[fact] === "yes" || draft.answers[fact] === "no");

  const addDish = () => {
    const name = dishDraft.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!name) return;
    if (draft.dishes.length >= MAX_DISHES) return toast("Add up to 5 dishes.");
    if (!draft.dishes.some((dish) => dish.toLowerCase() === name.toLowerCase())) set({ dishes: [...draft.dishes, name] });
    setDishDraft("");
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await api<{ photo: { id: string; url: string } }>(`/api/places/${placeId}/photos`, { method: "POST", body: form });
      setPhotos((current) => [...current, result.photo]);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const result = await api<Sent>(`/api/places/${placeId}/checks`, {
        method: "POST",
        json: {
          ...draft.answers,
          verdict: draft.verdict,
          dishes: draft.dishes,
          note: draft.note,
          shared: draft.share,
          photoIds: photos.map((photo) => photo.id),
          idempotencyKey: draft.key,
        },
      });
      clearFormDraft(storageKey);
      setSent(result);
      window.scrollTo(0, 0);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (sent) return <CheckSent placeId={placeId} placeName={placeName} sent={sent} />;

  return (
    <div className="mx-auto max-w-md">
      <header className="flex items-center gap-1.5 px-4 pt-[18px] pb-1.5">
        <IconLink href={`/place/${placeId}`} label="Close" icon={Cancel01Icon} />
        <span className="flex min-w-0 items-center gap-2.5">
          <PlaceArt name={placeName} seed={placeId} className="size-9" rounded="rounded-[10px]" textSize="text-[13px]" />
          <span className="truncate text-base font-extrabold">{placeName}</span>
        </span>
      </header>

      <div className="grid gap-[22px] px-6 pt-3.5 pb-8">
        <div className="grid gap-1.5">
          <h1 className="text-[28px] leading-tight font-black tracking-tight">What did you see?</h1>
          <p className="text-[15px] font-semibold text-subtle-foreground">Answer what you know. Skip the rest.</p>
        </div>

        {FACTS.map((fact) => (
          <fieldset key={fact} className="grid gap-2.5">
            <legend className="mb-2.5 grid gap-0.5">
              <span className="text-[17px] font-black">{QUESTIONS[fact].title}</span>
              <span className="text-[13px] font-semibold text-muted-foreground">{QUESTIONS[fact].hint}</span>
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {OPTIONS.map((option) => {
                const on = draft.answers[fact] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ answers: { ...draft.answers, [fact]: on ? null : option.value } })}
                    className={cn(
                      "min-h-12 rounded-xl border text-[15px] font-extrabold",
                      on ? "border-foreground bg-foreground text-background" : "border-input bg-background",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="grid gap-2.5 border-t border-border pt-5">
          <div className="grid gap-0.5">
            <span className="text-[17px] font-black">
              How was it? <span className="text-sm font-semibold text-muted-foreground">(optional)</span>
            </span>
            <span className="text-[13px] font-semibold text-muted-foreground">For your friends. It doesn’t change the halal status.</span>
          </div>
          <div role="group" aria-label="How was it" className="grid grid-cols-4 gap-1.5">
            {VERDICTS.map((verdict) => {
              const on = draft.verdict === verdict;
              return (
                <button
                  key={verdict}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ verdict: on ? null : verdict })}
                  className={cn(
                    "min-h-12 rounded-xl border px-1 text-[13px] font-extrabold",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
                  )}
                >
                  {VERDICT_LABEL[verdict]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <label htmlFor="dish-input" className="text-sm font-extrabold">
            What did you order?
          </label>
          <div className="flex flex-wrap gap-2">
            {draft.dishes.map((dish) => (
              <button
                key={dish}
                type="button"
                aria-label={`Remove ${dish}`}
                onClick={() => set({ dishes: draft.dishes.filter((item) => item !== dish) })}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-foreground px-3 text-sm font-extrabold text-background"
              >
                {dish}
                <Icon icon={Cancel01Icon} size={12} strokeWidth={3} />
              </button>
            ))}
            {draft.dishes.length < MAX_DISHES && (
              <input
                id="dish-input"
                type="text"
                value={dishDraft}
                maxLength={60}
                enterKeyHint="done"
                onChange={(event) => setDishDraft(event.target.value)}
                onBlur={addDish}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    addDish();
                  }
                }}
                placeholder="Add a dish"
                className="h-9 min-w-[120px] flex-1 rounded-full border border-dashed border-muted-foreground px-3 text-sm"
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={uploading || photos.length >= 4}
            onClick={() => fileInput.current?.click()}
            className="flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-muted-foreground text-sm font-extrabold"
          >
            <Icon icon={Camera01Icon} size={18} />
            {uploading ? "Uploading…" : photos.length ? `Photo (${photos.length})` : "Photo"}
          </button>
          <button
            type="button"
            aria-expanded={noteOpen || Boolean(draft.note)}
            onClick={() => setNoteOpen(true)}
            className="flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-muted-foreground text-sm font-extrabold"
          >
            <Icon icon={PencilEdit02Icon} size={18} />
            Note
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </div>
        {photos.length > 0 && (
          <div className="flex gap-2">
            {photos.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={photo.id} src={photo.url} alt="" className="size-16 rounded-xl object-cover" />
            ))}
          </div>
        )}
        {(noteOpen || draft.note) && (
          <div className="-mt-2 grid gap-1.5">
            <label htmlFor="check-note" className="sr-only">
              Note
            </label>
            <textarea
              id="check-note"
              rows={2}
              maxLength={500}
              autoFocus={noteOpen && !draft.note}
              value={draft.note}
              onChange={(event) => set({ note: event.target.value })}
              placeholder="Anything the next person should know?"
              className="w-full resize-none rounded-[14px] border border-input px-3.5 py-3 text-[15px]"
            />
          </div>
        )}

        <div className="flex min-h-[52px] items-center justify-between gap-3 rounded-[14px] bg-muted px-3.5">
          <span className="grid">
            <span className="text-[15px] font-extrabold">Share with followers</span>
            <span className="text-xs font-semibold text-muted-foreground">
              {isPrivate ? "Only your followers see it" : "Shows in their Friends feed"}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.share}
            aria-label="Share with followers"
            onClick={() => set({ share: !draft.share })}
            className={cn("flex h-[30px] w-[50px] shrink-0 rounded-full p-[3px]", draft.share ? "justify-end bg-success" : "justify-start bg-input")}
          >
            <span className="size-6 rounded-full bg-white shadow" />
          </button>
        </div>

        <button type="button" onClick={send} disabled={!ready || busy} className={buttonClass("primary", "lg", "w-full")}>
          {busy ? "Sending…" : ready ? "Send check" : "Answer at least one"}
        </button>
      </div>
    </div>
  );
}

function progressOf(status: PlaceStatus): 0 | 1 | 2 | 3 {
  return status.kind === "verified" ? 3 : status.kind === "checking" ? status.progress : 0;
}

function CheckSent({ placeId, placeName, sent }: { placeId: string; placeName: string; sent: Sent }) {
  const filled = progressOf(sent.status);
  const tone = sent.status.kind === "verified" ? "bg-success-muted text-success" : sent.status.kind === "checking" ? "bg-warning-muted text-warning-strong" : "bg-neutral-pill text-foreground";
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-[110px] pb-10">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <span className="flex size-[76px] items-center justify-center rounded-full bg-success text-success-foreground">
          <Icon icon={Tick02Icon} size={38} strokeWidth={2.8} />
        </span>
        <h1 className="text-[28px] leading-tight font-black tracking-tight">Thanks, your check is in</h1>
        <p className="max-w-[300px] text-[15px] font-semibold text-subtle-foreground">It counts straight away. You’ll find it on your profile.</p>
      </div>
      <section className={cn("mt-9 grid gap-3 rounded-[20px] p-[18px]", tone)}>
        <div className="flex items-baseline justify-between gap-3">
          <strong className="text-base font-black text-foreground">{placeName}</strong>
          <span className="text-[13px] font-extrabold">{filled} of 3 match</span>
        </div>
        <Meter filled={filled} tone={sent.status.kind} size="lg" />
        <p className="text-sm font-bold">{sent.message}</p>
      </section>
      <div className="mt-auto grid gap-2.5 pt-10">
        <a href={`/place/${placeId}`} className={buttonClass("dark", "lg")}>
          Back to the place
        </a>
        <a href="/" className={buttonClass("outline", "lg")}>
          Find more places
        </a>
      </div>
    </div>
  );
}
