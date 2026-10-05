"use client";

import { useRef, useState } from "react";
import { ArrowLeft01Icon, Camera01Icon } from "@hugeicons/core-free-icons";
import { Avatar, Icon, buttonClass } from "../../../src/components/kit";
import { ReportButton } from "../../../src/components/report-sheet";
import { SendSheetButton } from "../../../src/components/send-sheet";
import { SaveHeart, ShareAction, Sheet, api, errorText, toast, useSheet } from "../../../src/components/kit-client";
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
          {step(2, "3 people agree → Community verified", "They have to be 3 different accounts, checking on their own.")}
          {step(3, "The latest checks win", "If a place changes, new answers replace old ones. If people disagree, it waits for 3 that match.")}
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
