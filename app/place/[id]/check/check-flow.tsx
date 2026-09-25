"use client";

import { useEffect, useRef, useState } from "react";
import {
  Beef,
  CircleHelp,
  EyeOff,
  FileCheck,
  FileX,
  GlassWater,
  Hand,
  Settings2,
  Wine,
} from "lucide-react";
import { Illustration } from "../../../../src/components/art";

type Question = "certificate" | "alcohol" | "meat";
type Answers = Record<Question, string | null>;
type AuthState = "checking" | "signed-in" | "signed-out";

type Option = { value: string; label: string; icon: React.ReactNode };

const STEPS: { question: Question; title: string; hint: string; options: Option[] }[] = [
  {
    question: "certificate",
    title: "Can you see a halal certificate?",
    hint: "Have a look near the counter or the door. Just tell us what you see today.",
    options: [
      { value: "seen", label: "Yes, it’s on display", icon: <FileCheck size={30} strokeWidth={1.5} /> },
      { value: "not-seen", label: "No certificate", icon: <FileX size={30} strokeWidth={1.5} /> },
      { value: "unsure", label: "I couldn’t see", icon: <EyeOff size={30} strokeWidth={1.5} /> },
    ],
  },
  {
    question: "alcohol",
    title: "Is alcohol served here?",
    hint: "Check the menu or the fridge, or ask the staff.",
    options: [
      { value: "none", label: "No alcohol", icon: <GlassWater size={30} strokeWidth={1.5} /> },
      { value: "served", label: "Yes, it’s served", icon: <Wine size={30} strokeWidth={1.5} /> },
      { value: "unsure", label: "Not sure", icon: <CircleHelp size={30} strokeWidth={1.5} /> },
    ],
  },
  {
    question: "meat",
    title: "How is the meat slaughtered?",
    hint: "If you asked the staff or saw the supplier’s paperwork, tell us what they said.",
    options: [
      { value: "hand", label: "Hand-slaughtered", icon: <Hand size={30} strokeWidth={1.5} /> },
      { value: "machine", label: "Machine-slaughtered", icon: <Settings2 size={30} strokeWidth={1.5} /> },
      { value: "unsure", label: "I didn’t ask", icon: <Beef size={30} strokeWidth={1.5} /> },
    ],
  },
];

const PHOTO_STEP = STEPS.length;
const DONE_STEP = STEPS.length + 1;
const MAX_BYTES = 8 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function body(response: Response) {
  try {
    return record(await response.json());
  } catch {
    return null;
  }
}

function errorFrom(value: Record<string, unknown> | null, fallback: string) {
  return typeof value?.error === "string" && value.error.trim() ? value.error : fallback;
}

export default function CheckFlow({ placeId, placeName }: { placeId: string; placeName: string }) {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({ certificate: null, alcohol: null, meat: null });
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const placeHref = `/place/${encodeURIComponent(placeId)}`;
  const selfHref = `${placeHref}/check`;

  useEffect(() => {
    let active = true;
    fetch("/api/auth/get-session", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(body)
      .then((payload) => {
        if (active) setAuth(typeof record(payload?.user)?.id === "string" ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (active) setAuth("signed-out");
      });
    return () => {
      active = false;
    };
  }, []);

  const informative = Object.values(answers).some((value) => value && value !== "unsure");

  async function send() {
    setError("");
    if (!informative && !file) {
      setError("Answer at least one question with yes or no, or add a photo.");
      return;
    }
    if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_BYTES)) {
      setError("Photos need to be JPEG, PNG or WebP, up to 8 MB.");
      return;
    }
    setBusy(true);
    try {
      const evidence: unknown[] = [];
      if (file) {
        const form = new FormData();
        form.set("file", file);
        const upload = await fetch(`/api/uploads/r2?returnTo=${encodeURIComponent(selfHref)}`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        const uploaded = await body(upload);
        if (upload.status === 401) {
          setAuth("signed-out");
          return;
        }
        if (
          !upload.ok ||
          typeof uploaded?.key !== "string" ||
          typeof uploaded.contentType !== "string" ||
          typeof uploaded.sizeBytes !== "number" ||
          typeof uploaded.fileName !== "string"
        ) {
          setError(errorFrom(uploaded, "That photo couldn’t be uploaded. Try another, or skip it."));
          return;
        }
        evidence.push({
          kind: "upload",
          key: uploaded.key,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          fileName: uploaded.fileName,
        });
      }
      const response = await fetch(`/api/places/${encodeURIComponent(placeId)}/verifications`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ answers, evidence, note }),
      });
      const payload = await body(response);
      if (response.status === 401) {
        setAuth("signed-out");
        return;
      }
      if (!response.ok) {
        setError(errorFrom(payload, "We couldn’t send your check. Please try again."));
        return;
      }
      setStep(DONE_STEP);
    } catch {
      setError("We couldn’t send your check. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const progress = Math.min(step, PHOTO_STEP + 1) / (PHOTO_STEP + 1);
  const current = STEPS[step];

  if (auth === "signed-out")
    return (
      <div className="stepper-body">
        <Illustration name="vouches" size={96} />
        <h1>Check {placeName}</h1>
        <p>
          Log in with a one-time email code so your check has a name on it. It takes a
          minute, and you’ll come straight back here.
        </p>
        <div className="button-row">
          <a className="btn btn-primary" href={`/login?returnTo=${encodeURIComponent(selfHref)}`}>
            Log in to check
          </a>
          <a className="btn btn-line" href={placeHref}>
            Not now
          </a>
        </div>
      </div>
    );

  if (step === DONE_STEP)
    return (
      <div className="stepper-body">
        <div className="thanks">
          <Illustration name="vouches" size={120} />
          <h1>Thank you!</h1>
          <p>
            Your check for {placeName} is with our reviewers. Once it’s approved, it’s the
            first thing the next person will see.
          </p>
          <div className="button-row" style={{ justifyContent: "center" }}>
            <a className="btn btn-dark" href={placeHref}>
              Back to {placeName}
            </a>
            <a className="btn btn-line" href="/leaderboard">
              See the community
            </a>
          </div>
        </div>
      </div>
    );

  return (
    <>
      <div className="stepper-body">
        <p className="eyebrow">At {placeName}</p>
        {current ? (
          <>
            <h1>{current.title}</h1>
            <p>{current.hint}</p>
            <div className="option-grid" role="group" aria-label={current.title}>
              {current.options.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className="option-tile"
                  aria-pressed={answers[current.question] === option.value}
                  onClick={() => {
                    setAnswers((previous) => ({ ...previous, [current.question]: option.value }));
                    setError("");
                  }}
                >
                  <span aria-hidden="true">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1>Snap a quick photo</h1>
            <p>
              A clear photo of the certificate or the menu helps everyone after you. It’s
              optional.
            </p>
            <label className="drop-zone">
              <Illustration name="photo" size={72} />
              <span className="btn btn-line">{file ? "Choose a different photo" : "Choose a photo"}</span>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="field-note">{file ? file.name : "JPEG, PNG or WebP, up to 8 MB"}</span>
            </label>
            <label className="field" style={{ marginTop: 8 }}>
              <span>Anything else? (optional)</span>
              <textarea
                value={note}
                maxLength={1000}
                rows={3}
                placeholder="The supplier’s name, when the certificate expires…"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <div className="note-honey">Checks go to a moderator before they show as approved.</div>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="stepper-footer">
        <div className="stepper-progress" aria-hidden="true">
          {[0, 1, 2].map((segment) => (
            <span key={segment}>
              <i style={{ width: `${Math.max(0, Math.min(1, progress * 3 - segment)) * 100}%` }} />
            </span>
          ))}
        </div>
        <div className="stepper-actions">
          {step === 0 ? (
            <a className="back" href={placeHref}>
              Back
            </a>
          ) : (
            <button type="button" className="back" onClick={() => setStep((value) => value - 1)}>
              Back
            </button>
          )}
          {step < PHOTO_STEP ? (
            <button
              type="button"
              className="btn btn-dark"
              disabled={auth === "checking"}
              onClick={() => setStep((value) => value + 1)}
            >
              {current && answers[current.question] ? "Next" : "Skip"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send()}>
              {busy ? "Sending…" : "Send check"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
