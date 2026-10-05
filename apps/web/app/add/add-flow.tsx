"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon, Location01Icon, Search01Icon, Tick02Icon, Video01Icon } from "@hugeicons/core-free-icons";
import { FACTS, type Answer, type Fact } from "@halalfood/core/halal";
import { cn } from "@halalfood/ui/lib/utils";
import { FormCard, Icon, Meter, PageTitle, buttonClass } from "../../src/components/kit";
import { ShareAction, api, errorText, toast, type ApiError } from "../../src/components/kit-client";
import { presentHttpFailure } from "../../src/lib/failure-copy";
import { clearFormDraft, readFormDraft, saveFormDraft } from "../../src/lib/form-draft";
import { signedOutLoginPath } from "../../src/lib/signed-out";

type Picked = { id: string; name: string; address: string };
type Result = Picked & { existing: { placeId: string; url: string } | null };
type Added = { id: string; status: "unchecked" | "checking" };

const DRAFT_KEY = "halalfood:add-draft";

const SHORT: Record<Fact, string> = {
  owned: "Muslim-owned",
  certified: "Halal certified",
  pork: "Serves pork",
  alcohol: "Serves alcohol",
};

const OPTIONS: { value: Exclude<Answer, null>; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "?" },
];

function emptyAnswers(): Record<Fact, Answer> {
  return { owned: null, certified: null, pork: null, alcohol: null };
}

function newKey() {
  return crypto.randomUUID().replace(/-/g, "");
}

function resumePath(picked: Picked) {
  const query = new URLSearchParams({ g: picked.id, n: picked.name, a: picked.address });
  return `/add?${query}`;
}

export function AddFlow({ signedIn, initial }: { signedIn: boolean; initial: Picked | null }) {
  const [picked, setPicked] = useState<Picked | null>(initial);
  const [added, setAdded] = useState<Added | null>(null);

  if (added && picked) return <AddDone picked={picked} added={added} />;
  if (picked) return <AddConfirm picked={picked} signedIn={signedIn} onBack={() => setPicked(null)} onAdded={setAdded} />;
  return <AddSearch onPick={setPicked} />;
}

function AddSearch({ onPick }: { onPick: (picked: Picked) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults(null);
      setError(null);
      return;
    }
    const ticket = ++latest.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const body = await api<{ places?: Result[]; error?: string }>(`/api/places/google-search?q=${encodeURIComponent(q)}`);
        if (ticket !== latest.current) return;
        setResults(body.places ?? []);
        setError(body.places?.length ? null : (body.error ?? null));
      } catch (caught) {
        if (ticket !== latest.current) return;
        const failure = caught as Partial<ApiError>;
        setError(failure.status ? presentHttpFailure("Google search", failure.status, failure.error ?? "").message : errorText(caught));
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <FormCard className="grid gap-5">
      <PageTitle sub="Find it on Google Maps. It goes live straight away.">Add a place</PageTitle>
      <label className="flex h-[50px] items-center gap-2.5 rounded-full bg-secondary px-[18px]">
        <Icon icon={Search01Icon} />
        <span className="sr-only">Search Google Maps</span>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Restaurant name and area"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-muted-foreground"
        />
      </label>

      {results === null && !loading && (
        <a href="/add/video" className="flex items-center gap-3.5 rounded-2xl border border-border p-4 text-foreground">
          <span className="flex size-11 items-center justify-center rounded-full bg-accent text-primary">
            <Icon icon={Video01Icon} />
          </span>
          <span className="grid flex-1 gap-0.5">
            <strong className="text-[15px] font-black">Saw it in a video?</strong>
            <span className="text-[13px] font-semibold text-muted-foreground">Paste a TikTok, Reel or YouTube link.</span>
          </span>
          <Icon icon={ArrowRight01Icon} size={18} />
        </a>
      )}

      {loading && <p className="text-sm font-semibold text-muted-foreground">Searching…</p>}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}

      {results && results.length > 0 && (
        <ul className="grid">
          {results.map((result) => (
            <li key={result.id} className="border-b border-border/70 last:border-b-0">
              {result.existing ? (
                <a href={result.existing.url} className="flex items-center gap-3 py-3.5 text-foreground">
                  <ResultText result={result} />
                  <span className="rounded-full bg-success-muted px-2.5 py-1 text-xs font-extrabold text-success">Already listed</span>
                </a>
              ) : (
                <button type="button" onClick={() => onPick(result)} className="flex w-full items-center gap-3 py-3.5 text-left">
                  <ResultText result={result} />
                  <Icon icon={ArrowRight01Icon} size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {results && results.length === 0 && !error && !loading && (
        <p className="text-sm font-semibold text-muted-foreground">No matches on Google Maps. Try the name with the area.</p>
      )}

      <p className="text-[13px] font-semibold text-muted-foreground">
        Names, addresses and map pins come from Google Maps. Adding a place isn’t a halal certification.
      </p>
    </FormCard>
  );
}

function ResultText({ result }: { result: Result }) {
  return (
    <>
      <Icon icon={Location01Icon} className="shrink-0 text-muted-foreground" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <strong className="truncate text-[15px] font-extrabold">{result.name}</strong>
        <span className="truncate text-[13px] font-semibold text-muted-foreground">{result.address}</span>
      </span>
    </>
  );
}

type Draft = { googleId: string; answers: Record<Fact, Answer>; key: string };

function AddConfirm({
  picked,
  signedIn,
  onBack,
  onAdded,
}: {
  picked: Picked;
  signedIn: boolean;
  onBack: () => void;
  onAdded: (added: Added) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({ googleId: picked.id, answers: emptyAnswers(), key: newKey() }));
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = readFormDraft(DRAFT_KEY) as Partial<Draft> | null;
    if (saved && saved.googleId === picked.id && saved.answers && saved.key) setDraft(saved as Draft);
    setRestored(true);
  }, [picked.id]);
  useEffect(() => {
    if (restored) saveFormDraft(DRAFT_KEY, draft);
  }, [draft, restored]);

  const definite = FACTS.some((fact) => draft.answers[fact] === "yes" || draft.answers[fact] === "no");

  const submit = async () => {
    if (busy) return;
    if (!signedIn) {
      saveFormDraft(DRAFT_KEY, draft);
      window.location.assign(signedOutLoginPath(resumePath(picked), false));
      return;
    }
    setBusy(true);
    try {
      const added = await api<Added>("/api/places", {
        method: "POST",
        json: {
          googlePlaceId: picked.id,
          name: picked.name,
          address: picked.address,
          answers: draft.answers,
          idempotencyKey: draft.key,
        },
      });
      clearFormDraft(DRAFT_KEY);
      onAdded(added);
      window.scrollTo(0, 0);
    } catch (caught) {
      const failure = caught as Partial<ApiError>;
      const existing = failure.status === 409 && typeof failure.body?.id === "string" ? failure.body.id : null;
      if (existing) {
        clearFormDraft(DRAFT_KEY);
        window.location.assign(`/place/${existing}`);
        return;
      }
      toast(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormCard className="grid gap-5">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-extrabold">
        <Icon icon={ArrowLeft01Icon} size={18} />
        Search again
      </button>

      <section className="grid gap-3 rounded-[20px] bg-muted p-[18px]">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icon icon={Location01Icon} />
        </span>
        <div className="grid gap-1">
          <h1 className="text-[22px] leading-tight font-black">{picked.name}</h1>
          {picked.address && <p className="text-sm font-semibold text-muted-foreground">{picked.address}</p>}
        </div>
      </section>

      <section aria-labelledby="questions" className="grid gap-3">
        <div className="grid gap-0.5">
          <h2 id="questions" className="text-[17px] font-black">What do you know?</h2>
          <p className="text-[13px] font-semibold text-muted-foreground">Skip anything you’re not sure about.</p>
        </div>
        {FACTS.map((fact) => (
          <div key={fact} role="group" aria-label={SHORT[fact]} className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-extrabold">{SHORT[fact]}</span>
            <span className="grid grid-cols-3 gap-1.5">
              {OPTIONS.map((option) => {
                const on = draft.answers[fact] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={on}
                    aria-label={option.value === "unsure" ? "Not sure" : option.label}
                    onClick={() => setDraft({ ...draft, answers: { ...draft.answers, [fact]: on ? null : option.value } })}
                    className={cn(
                      "min-h-10 min-w-12 rounded-xl border px-3 text-sm font-extrabold",
                      on ? "border-foreground bg-foreground text-background" : "border-input bg-background",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </span>
          </div>
        ))}
      </section>

      <p className="text-sm font-semibold text-subtle-foreground">
        It goes live straight away as <strong className="text-foreground">{definite ? "1 of 3 checks" : "Not checked yet"}</strong>.
      </p>

      <button type="button" onClick={submit} disabled={busy} className={buttonClass("primary", "lg")}>
        {busy ? "Adding…" : signedIn ? "Add place" : "Sign in to add"}
      </button>
    </FormCard>
  );
}

function AddDone({ picked, added }: { picked: Picked; added: Added }) {
  const checking = added.status === "checking";
  return (
    <FormCard fill className="max-md:pt-12">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <span className="flex size-[76px] items-center justify-center rounded-full bg-success text-success-foreground">
          <Icon icon={Tick02Icon} size={38} strokeWidth={2.8} />
        </span>
        <h1 className="text-[28px] leading-tight font-black tracking-tight">{picked.name} is live</h1>
        <p className="max-w-[300px] text-[15px] font-semibold text-subtle-foreground">
          {checking ? "Your answers count as the first check. Two more that match verify it." : "Anyone who eats there can now check it."}
        </p>
      </div>
      <section className={cn("mt-9 grid gap-3 rounded-[20px] p-[18px]", checking ? "bg-warning-muted text-warning-strong" : "bg-neutral-pill")}>
        <div className="flex items-baseline justify-between gap-3">
          <strong className="text-base font-black text-foreground">{checking ? "Checking" : "Not checked yet"}</strong>
          <span className="text-[13px] font-extrabold">{checking ? 1 : 0} of 3</span>
        </div>
        <Meter filled={checking ? 1 : 0} tone={checking ? "checking" : "unchecked"} size="lg" />
      </section>
      <div className="mt-auto grid gap-2.5 pt-10">
        <a href={`/place/${added.id}`} className={buttonClass("dark", "lg")}>
          See the place
        </a>
        <div className={buttonClass("outline", "lg", "relative")}>
          Share the place
          <ShareAction
            url={`/place/${added.id}`}
            title={picked.name}
            text={`${picked.name} is on halalfood.world`}
            className="absolute inset-0 opacity-0"
          />
        </div>
      </div>
    </FormCard>
  );
}
