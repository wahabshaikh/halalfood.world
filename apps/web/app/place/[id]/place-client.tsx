"use client";

import { useRef, useState } from "react";
import { ArrowLeft01Icon, Camera01Icon } from "@hugeicons/core-free-icons";
import { Avatar, Icon, buttonClass } from "../../../src/components/kit";
import { ReportButton } from "../../../src/components/report-sheet";
import { SendSheetButton } from "../../../src/components/send-sheet";
import { SaveHeart, Segmented, ShareAction, Sheet, api, errorText, toast, useSheet } from "../../../src/components/kit-client";
import { currentReturnPath, loginHref } from "../../../src/lib/signed-out";
import type { PlaceNote } from "../../../src/lib/checks-repository";

export function HeroActions({
  placeId,
  name,
  shareText,
  saved,
  signedIn,
  backHref,
}: {
  placeId: string;
  name: string;
  shareText: string;
  saved: boolean;
  signedIn: boolean;
  backHref: string;
}) {
  const round = "flex size-11 items-center justify-center rounded-full bg-background text-foreground shadow-md";
  return (
    <div className="absolute inset-x-4 top-4 flex justify-between">
      <a href={backHref} aria-label="Back" className={round}>
        <Icon icon={ArrowLeft01Icon} />
      </a>
      <div className="flex gap-2">
        {signedIn && (
          <SendSheetButton target={{ kind: "place", id: placeId, name }} className={round} label="" ariaLabel="Send to friends" />
        )}
        <ShareAction url={`/place/${placeId}`} title={name} text={shareText} className={round} />
        <SaveHeart placeId={placeId} saved={saved} signedIn={signedIn} variant="floating" label={name} />
      </div>
    </div>
  );
}

export function HowItWorks() {
  const sheet = useSheet("how");
  const step = (n: number, head: string, body: string) => (
    <li className="flex gap-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[15px] font-black text-background">{n}</span>
      <span className="grid gap-0.5">
        <strong className="text-base font-black">{head}</strong>
        <span className="text-sm leading-relaxed font-semibold text-subtle-foreground">{body}</span>
      </span>
    </li>
  );
  return (
    <>
      <button type="button" onClick={sheet.show} className="w-fit text-sm font-extrabold text-inherit underline underline-offset-3">
        How verification works
      </button>
      <Sheet open={sheet.open} onClose={sheet.hide} title="How a place gets verified">
        <ol className="grid gap-[18px]">
          {step(1, "People who eat there answer 4 questions", "Muslim-owned? Halal certified? Serves pork? Serves alcohol?")}
          {step(2, "3 or more people agree → Verified", "They have to be different accounts, checking on their own. Three is the minimum; every matching check after that counts too.")}
          {step(3, "Certificates and menus count too", "A halal certificate or a menu photo, checked by a moderator, confirms the facts it shows. Map listings add context but never verify on their own.")}
          {step(4, "The latest evidence wins", "If a place changes, new answers replace old ones. If sources disagree, the fact waits until they match.")}
        </ol>
        <p className="mt-5 rounded-[14px] bg-secondary px-3.5 py-3 text-[13px] leading-relaxed font-bold text-subtle-foreground">
          We don’t certify restaurants. “Not checked yet” never means “not halal”.
        </p>
        <button type="button" onClick={sheet.hide} className={buttonClass("dark", "lg", "mt-5 w-full")}>
          Got it
        </button>
      </Sheet>
    </>
  );
}

export function ReportPlace({ placeId, placeName, signedIn }: { placeId: string; placeName: string; signedIn: boolean }) {
  return <ReportButton targetType="place" targetId={placeId} subject={placeName} signedIn={signedIn} />;
}

export function AddPhoto({ placeId, signedIn }: { placeId: string; signedIn: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      await api(`/api/places/${placeId}/photos`, { method: "POST", body: form });
      toast("Photo added");
      window.location.reload();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (signedIn ? input.current?.click() : window.location.assign(loginHref(currentReturnPath())))}
        className={buttonClass("outline", "sm")}
      >
        <Icon icon={Camera01Icon} size={16} />
        {busy ? "Uploading…" : "Add"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />
    </>
  );
}

export function Notes({ placeId, initial, hasMore }: { placeId: string; initial: PlaceNote[]; hasMore: boolean }) {
  const [notes, setNotes] = useState(initial);
  const [more, setMore] = useState(hasMore);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const before = notes[notes.length - 1]?.createdAt;
      const result = await api<{ notes: PlaceNote[] }>(`/api/places/${placeId}/notes?before=${before ?? ""}`);
      setNotes((current) => [...current, ...result.notes]);
      setMore(result.notes.length === 10);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ul>
        {notes.map((note) => (
          <li key={note.checkId} className="flex gap-3 border-b border-border/70 py-3 last:border-b-0">
            <Avatar name={note.name} seed={note.userId} src={note.avatarKey && note.handle ? `/api/avatars/${note.handle}` : null} size={36} />
            <div className="grid gap-0.5">
              <span className="text-sm font-extrabold">
                {note.handle ? <a href={`/u/${note.handle}`} className="text-foreground">{note.name}</a> : note.name}{" "}
                <span className="font-semibold text-muted-foreground">
                  · {new Date(note.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </span>
              <p className="text-[15px] leading-relaxed">{note.note}</p>
            </div>
          </li>
        ))}
      </ul>
      {more && (
        <button type="button" onClick={load} disabled={busy} className={buttonClass("ghost", "sm", "w-fit")}>
          {busy ? "Loading…" : "See all"}
        </button>
      )}
    </>
  );
}

type EvidenceKind = "certificate" | "menu";
type MenuAnswer = "yes" | "no" | "";

/** Send a halal certificate or a menu photo for a moderator to review. */
export function AddEvidence({ placeId, signedIn }: { placeId: string; signedIn: boolean }) {
  const sheet = useSheet("evidence");
  const [kind, setKind] = useState<EvidenceKind>("certificate");
  const [file, setFile] = useState<File | null>(null);
  const [certifier, setCertifier] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [pork, setPork] = useState<MenuAnswer>("");
  const [alcohol, setAlcohol] = useState<MenuAnswer>("");
  const [busy, setBusy] = useState(false);
  const field = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold outline-none focus:border-foreground";
  const menuReady = kind === "certificate" || pork !== "" || alcohol !== "";

  const send = async () => {
    if (!file) return toast("Choose a photo first.");
    if (!menuReady) return toast("Say whether the menu shows pork or alcohol.");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const { photo } = await api<{ photo: { id: string } }>(`/api/places/${placeId}/photos`, { method: "POST", body: form });
      await api(`/api/places/${placeId}/evidence`, {
        method: "POST",
        json:
          kind === "certificate"
            ? { kind, photoId: photo.id, certifier: certifier || null, expiresOn: expiresOn || null }
            : { kind, photoId: photo.id, ...(pork ? { pork } : {}), ...(alcohol ? { alcohol } : {}) },
      });
      toast("Thanks. A moderator will review it.");
      sheet.hide();
      setFile(null);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const answer = (label: string, value: MenuAnswer, set: (value: MenuAnswer) => void) => (
    <label className="grid gap-1.5 text-sm font-extrabold">
      {label}
      <select value={value} onChange={(event) => set(event.target.value as MenuAnswer)} className={field}>
        <option value="">Can’t tell from the menu</option>
        <option value="yes">On the menu</option>
        <option value="no">Not on the menu</option>
      </select>
    </label>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => (signedIn ? sheet.show() : window.location.assign(loginHref(currentReturnPath())))}
        className="w-fit text-sm font-extrabold underline underline-offset-3"
      >
        Add a halal certificate or menu
      </button>
      <Sheet open={sheet.open} onClose={sheet.hide} title="Add a certificate or menu">
        <div className="grid gap-4">
          <Segmented
            label="What is it?"
            value={kind}
            onChange={setKind}
            options={[
              { value: "certificate", label: "Certificate" },
              { value: "menu", label: "Menu" },
            ]}
          />
          <label className="grid gap-1.5 text-sm font-extrabold">
            Photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-sm font-semibold"
            />
          </label>
          {kind === "certificate" ? (
            <>
              <label className="grid gap-1.5 text-sm font-extrabold">
                Certified by (optional)
                <input value={certifier} maxLength={120} onChange={(event) => setCertifier(event.target.value)} className={field} />
              </label>
              <label className="grid gap-1.5 text-sm font-extrabold">
                Valid until (optional)
                <input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} className={field} />
              </label>
            </>
          ) : (
            <>
              {answer("Pork", pork, setPork)}
              {answer("Alcohol", alcohol, setAlcohol)}
            </>
          )}
          <p className="text-[13px] leading-relaxed font-semibold text-subtle-foreground">
            A moderator checks it before it counts. The photo also appears in the place’s gallery.
          </p>
          <button type="button" disabled={busy || !file || !menuReady} onClick={() => void send()} className={buttonClass("dark", "lg", "w-full")}>
            {busy ? "Sending…" : "Send for review"}
          </button>
        </div>
      </Sheet>
    </>
  );
}
